use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};
use rusqlite::{Connection, Error as SqliteError, ErrorCode, OptionalExtension, params};
use serde_json::{Value as JsonValue, json};
use uuid::Uuid;

pub struct Authentication {
    database: Arc<Mutex<Connection>>,
}

pub struct Credentials {
    issuer: String,
    signing_id: String,
    signing: Arc<SigningKey>,
    verification: Arc<HashMap<String, VerifyingKey>>,
    ttl_ms: u64,
    revoked: Arc<Mutex<HashMap<String, u64>>>,
    revocations: Arc<Mutex<Connection>>,
    stop: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

pub async fn create(context: DependencyContext) -> NativeResult<Authentication> {
    let path = context.configuration("database")?;
    if path != ":memory:"
        && let Some(parent) = Path::new(path).parent()
    {
        fs::create_dir_all(parent).map_err(|error| failure("AuthenticationFailure", error))?;
    }
    let database =
        Connection::open(path).map_err(|error| failure("AuthenticationFailure", error))?;
    database
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| failure("AuthenticationFailure", error))?;
    database
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS kit_users (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               email TEXT NOT NULL UNIQUE,
               password_hash TEXT NOT NULL
             ) STRICT;
             CREATE TABLE IF NOT EXISTS kit_sessions (
               token TEXT PRIMARY KEY,
               user_id TEXT NOT NULL REFERENCES kit_users(id) ON DELETE CASCADE
             ) STRICT;",
        )
        .map_err(|error| failure("AuthenticationFailure", error))?;
    Ok(Authentication {
        database: Arc::new(Mutex::new(database)),
    })
}

pub async fn create_credentials(context: DependencyContext) -> NativeResult<Credentials> {
    let ttl_ms = context
        .configuration("ttl")?
        .parse::<u64>()
        .map_err(|error| failure("CredentialConfiguration", error))?;
    if !(30_000..=3_600_000).contains(&ttl_ms) {
        return Err(NativeError::new(
            "CredentialConfiguration",
            "Identity credential TTL must be between 30 seconds and one hour.",
        ));
    }
    let poll_ms = context
        .configuration("poll")?
        .parse::<u64>()
        .map_err(|error| failure("CredentialConfiguration", error))?;
    if !(10..=60_000).contains(&poll_ms) {
        return Err(NativeError::new(
            "CredentialConfiguration",
            "Identity revocation polling must be between 10ms and one minute.",
        ));
    }
    let (signing_id, signing, verification) = credential_key_ring(context.configuration("keys")?)?;
    let revocation_path = context.configuration("revocations")?;
    if revocation_path != ":memory:"
        && let Some(parent) = Path::new(revocation_path).parent()
    {
        fs::create_dir_all(parent).map_err(|error| failure("CredentialConfiguration", error))?;
    }
    let revocation_database = Connection::open(revocation_path)
        .map_err(|error| failure("CredentialConfiguration", error))?;
    revocation_database
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| failure("CredentialConfiguration", error))?;
    let revocations = Arc::new(Mutex::new(revocation_database));
    initialize_revocation_database(&lock(&revocations))?;
    let revoked = Arc::new(Mutex::new(HashMap::new()));
    refresh_revocations(&revocations, &revoked)?;
    let stop = Arc::new(AtomicBool::new(false));
    let polling_database = revocations.clone();
    let polling_revoked = revoked.clone();
    let polling_stop = stop.clone();
    let worker = std::thread::spawn(move || {
        while !polling_stop.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(poll_ms));
            if polling_stop.load(Ordering::Acquire) {
                break;
            }
            let _ = refresh_revocations(&polling_database, &polling_revoked);
        }
    });
    Ok(Credentials {
        issuer: context.configuration("issuer")?.to_owned(),
        signing_id,
        signing: Arc::new(signing),
        verification: Arc::new(verification),
        ttl_ms,
        revoked,
        revocations,
        stop,
        worker: Mutex::new(Some(worker)),
    })
}

fn initialize_revocation_database(database: &Connection) -> NativeResult<()> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match database.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS kit_identity_revocations (
               token TEXT PRIMARY KEY,
               expires_at INTEGER NOT NULL
             ) STRICT;",
        ) {
            Ok(()) => return Ok(()),
            Err(error) if sqlite_is_busy(&error) && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(failure("CredentialConfiguration", error)),
        }
    }
}

fn sqlite_is_busy(error: &SqliteError) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(ErrorCode::DatabaseBusy) | Some(ErrorCode::DatabaseLocked)
    )
}

impl Drop for Credentials {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = lock(&self.worker).take() {
            let _ = worker.join();
        }
    }
}

impl Dependency for Authentication {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let database = self.database.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            let input = input.to_json()?;
            match operation.as_str() {
                "authenticate" => authenticate(&database, optional_string(&input, "cookie")?)
                    .map(|user| user.map_or(Value::Undefined, |value| Value::from_json(&value))),
                "handle" => handle(&database, &input),
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("Authentication has no operation {operation:?}."),
                )),
            }
        })
    }
}

impl Dependency for Credentials {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let operation = operation.to_owned();
        let issuer = self.issuer.clone();
        let signing_id = self.signing_id.clone();
        let signing = self.signing.clone();
        let verification = self.verification.clone();
        let ttl_ms = self.ttl_ms;
        let revoked = self.revoked.clone();
        let revocations = self.revocations.clone();
        Box::pin(async move {
            let input = input.to_json()?;
            match operation.as_str() {
                "issue" => issue_credential(&issuer, &signing_id, &signing, ttl_ms, &input),
                "verify" => verify_credential(&issuer, &verification, &revoked, &input),
                "refresh" => refresh_credential(
                    &issuer,
                    &signing_id,
                    &signing,
                    &verification,
                    ttl_ms,
                    &revocations,
                    &revoked,
                    &input,
                ),
                "revoke" => revoke_credential(&revocations, &revoked, &input),
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("IdentityCredentials has no operation {operation:?}."),
                )),
            }
        })
    }
}

kit_server_runtime::dependency_operations!(Authentication {
    operation_authenticate => "authenticate",
    operation_handle => "handle",
});

kit_server_runtime::dependency_operations!(Credentials {
    operation_issue => "issue",
    operation_verify => "verify",
    operation_refresh => "refresh",
    operation_revoke => "revoke",
});

fn issue_credential(
    issuer: &str,
    signing_id: &str,
    signing: &SigningKey,
    ttl_ms: u64,
    input: &JsonValue,
) -> NativeResult<Value> {
    let audience = string(input, "audience")?;
    let subject = string(input, "subject")?;
    let session = string(input, "session")?;
    let policy_version = integer(input, "policyVersion")?;
    let principal = input
        .get("principal")
        .filter(|value| value.is_object())
        .ok_or_else(|| NativeError::new("InvalidInput", "principal must be a record."))?
        .clone();
    let issued_at = now_ms()? / 1_000 * 1_000;
    let expires_at = issued_at + ttl_ms;
    let token = Uuid::new_v4().to_string();
    let header = encode_json(&json!({ "alg": "EdDSA", "typ": "at+jwt", "kid": signing_id }))?;
    let payload = encode_json(&json!({
        "iss": issuer,
        "sub": subject,
        "aud": audience,
        "iat": issued_at / 1_000,
        "exp": expires_at / 1_000,
        "jti": token,
        "sid": session,
        "pv": policy_version,
        "principal": principal,
    }))?;
    let unsigned = format!("{header}.{payload}");
    let credential = format!(
        "{unsigned}.{}",
        URL_SAFE_NO_PAD.encode(signing.sign(unsigned.as_bytes()).to_bytes())
    );
    Ok(Value::from_json(&json!({
        "credential": credential,
        "claims": {
            "audience": audience,
            "expiresAt": expires_at,
            "issuedAt": issued_at,
            "issuer": issuer,
            "policyVersion": policy_version,
            "principal": principal,
            "session": session,
            "subject": subject,
            "token": token,
        }
    })))
}

fn verify_credential(
    issuer: &str,
    verification: &HashMap<String, VerifyingKey>,
    revoked: &Mutex<HashMap<String, u64>>,
    input: &JsonValue,
) -> NativeResult<Value> {
    let audience = string(input, "audience")?;
    let credential = string(input, "credential")?;
    Ok(
        verify_claims(issuer, verification, revoked, audience, credential)?
            .map_or(Value::Undefined, |claims| claims.value()),
    )
}

fn refresh_credential(
    issuer: &str,
    signing_id: &str,
    signing: &SigningKey,
    verification: &HashMap<String, VerifyingKey>,
    ttl_ms: u64,
    revocations: &Mutex<Connection>,
    revoked: &Mutex<HashMap<String, u64>>,
    input: &JsonValue,
) -> NativeResult<Value> {
    let audience = string(input, "audience")?;
    let credential = string(input, "credential")?;
    let expires_within = integer(input, "expiresWithin")?;
    let policy_version = integer(input, "policyVersion")?;
    let Some(claims) = verify_claims(issuer, verification, revoked, audience, credential)? else {
        return Ok(Value::Undefined);
    };
    if claims.policy_version != policy_version
        || claims.expires_at.saturating_sub(now_ms()?) > expires_within
    {
        return Ok(Value::Undefined);
    }
    let refreshed = issue_credential(
        issuer,
        signing_id,
        signing,
        ttl_ms,
        &json!({
            "audience": claims.audience,
            "policyVersion": claims.policy_version,
            "principal": claims.principal,
            "session": claims.session,
            "subject": claims.subject,
        }),
    )?;
    revoke_credential(
        revocations,
        revoked,
        &json!({ "token": claims.token, "expiresAt": claims.expires_at }),
    )?;
    Ok(refreshed)
}

struct VerifiedCredential {
    audience: String,
    expires_at: u64,
    issued_at: u64,
    issuer: String,
    policy_version: u64,
    principal: JsonValue,
    session: String,
    subject: String,
    token: String,
}

impl VerifiedCredential {
    fn value(&self) -> Value {
        Value::from_json(&json!({
            "audience": self.audience,
            "expiresAt": self.expires_at,
            "issuedAt": self.issued_at,
            "issuer": self.issuer,
            "policyVersion": self.policy_version,
            "principal": self.principal,
            "session": self.session,
            "subject": self.subject,
            "token": self.token,
        }))
    }
}

fn verify_claims(
    issuer: &str,
    verification: &HashMap<String, VerifyingKey>,
    revoked: &Mutex<HashMap<String, u64>>,
    audience: &str,
    received: &str,
) -> NativeResult<Option<VerifiedCredential>> {
    let Some(credential) = application_access_token(received) else {
        return Ok(None);
    };
    let mut parts = credential.split('.');
    let Some(header_part) = parts.next() else {
        return Ok(None);
    };
    let Some(payload_part) = parts.next() else {
        return Ok(None);
    };
    let Some(signature) = parts.next() else {
        return Ok(None);
    };
    if parts.next().is_some() {
        return Ok(None);
    }
    let Some(header) = decode_json(header_part) else {
        return Ok(None);
    };
    let Some(payload) = decode_json(payload_part) else {
        return Ok(None);
    };
    if string_optional(&header, "alg") != Some("EdDSA")
        || string_optional(&header, "typ") != Some("at+jwt")
        || string_optional(&payload, "iss") != Some(issuer)
        || string_optional(&payload, "aud") != Some(audience)
    {
        return Ok(None);
    }
    let Some(key_id) = string_optional(&header, "kid") else {
        return Ok(None);
    };
    let Some(public_key) = verification.get(key_id) else {
        return Ok(None);
    };
    let Ok(signature) = URL_SAFE_NO_PAD.decode(signature) else {
        return Ok(None);
    };
    let Ok(signature) = Signature::from_slice(&signature) else {
        return Ok(None);
    };
    let unsigned = format!("{header_part}.{payload_part}");
    if public_key.verify(unsigned.as_bytes(), &signature).is_err() {
        return Ok(None);
    }
    let Some(subject) = string_optional(&payload, "sub") else {
        return Ok(None);
    };
    let Some(session) = string_optional(&payload, "sid") else {
        return Ok(None);
    };
    let Some(token) = string_optional(&payload, "jti") else {
        return Ok(None);
    };
    let Some(issued_at) = unsigned_integer(&payload, "iat") else {
        return Ok(None);
    };
    let Some(expires_at) = unsigned_integer(&payload, "exp") else {
        return Ok(None);
    };
    let Some(policy_version) = unsigned_integer(&payload, "pv") else {
        return Ok(None);
    };
    let Some(principal) = payload.get("principal").filter(|value| value.is_object()) else {
        return Ok(None);
    };
    let now = now_ms()?;
    let issued_at = issued_at * 1_000;
    let expires_at = expires_at * 1_000;
    let mut revoked = lock(revoked);
    revoked.retain(|_, expiry| *expiry > now);
    if issued_at > now + 30_000 || expires_at <= now || revoked.contains_key(token) {
        return Ok(None);
    }
    Ok(Some(VerifiedCredential {
        audience: audience.to_owned(),
        expires_at,
        issued_at,
        issuer: issuer.to_owned(),
        policy_version,
        principal: principal.clone(),
        session: session.to_owned(),
        subject: subject.to_owned(),
        token: token.to_owned(),
    }))
}

fn revoke_credential(
    revocations: &Mutex<Connection>,
    revoked: &Mutex<HashMap<String, u64>>,
    input: &JsonValue,
) -> NativeResult<Value> {
    let token = string(input, "token")?;
    let expires_at = unsigned_integer(input, "expiresAt")
        .ok_or_else(|| NativeError::new("InvalidInput", "expiresAt must be an integer."))?;
    if expires_at > now_ms()? {
        lock(revocations)
            .execute(
                "INSERT INTO kit_identity_revocations (token, expires_at)
                 VALUES (?1, ?2)
                 ON CONFLICT(token) DO UPDATE
                 SET expires_at = MAX(expires_at, excluded.expires_at)",
                params![token, expires_at as i64],
            )
            .map_err(|error| failure("CredentialFailure", error))?;
        lock(revoked).insert(token.to_owned(), expires_at);
    }
    Ok(Value::Undefined)
}

fn refresh_revocations(
    database: &Mutex<Connection>,
    revoked: &Mutex<HashMap<String, u64>>,
) -> NativeResult<()> {
    let now = now_ms()?;
    let database = lock(database);
    database
        .execute(
            "DELETE FROM kit_identity_revocations WHERE expires_at <= ?1",
            params![now as i64],
        )
        .map_err(|error| failure("CredentialFailure", error))?;
    let mut statement = database
        .prepare("SELECT token, expires_at FROM kit_identity_revocations WHERE expires_at > ?1")
        .map_err(|error| failure("CredentialFailure", error))?;
    let rows = statement
        .query_map(params![now as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64))
        })
        .map_err(|error| failure("CredentialFailure", error))?;
    let mut next = HashMap::new();
    for row in rows {
        let (token, expires_at) = row.map_err(|error| failure("CredentialFailure", error))?;
        next.insert(token, expires_at);
    }
    *lock(revoked) = next;
    Ok(())
}

fn credential_key_ring(
    value: &str,
) -> NativeResult<(String, SigningKey, HashMap<String, VerifyingKey>)> {
    let parsed: JsonValue =
        serde_json::from_str(value).map_err(|error| failure("CredentialConfiguration", error))?;
    let active = string(&parsed, "active")?.to_owned();
    let keys = parsed
        .get("keys")
        .and_then(JsonValue::as_object)
        .ok_or_else(|| {
            NativeError::new(
                "CredentialConfiguration",
                "Identity credential keys require an active version and key map.",
            )
        })?;
    let mut verification = HashMap::new();
    let mut signing = None;
    for (id, key) in keys {
        let public = decode_credential_key(key, "public")?;
        let public = VerifyingKey::from_bytes(&public)
            .map_err(|error| failure("CredentialConfiguration", error))?;
        verification.insert(id.clone(), public);
        if id == &active {
            let private = decode_credential_key(key, "private")?;
            let private = SigningKey::from_bytes(&private);
            if private.verifying_key() != public {
                return Err(NativeError::new(
                    "CredentialConfiguration",
                    "The active Identity credential key pair does not match.",
                ));
            }
            signing = Some(private);
        }
    }
    let signing = signing.ok_or_else(|| {
        NativeError::new(
            "CredentialConfiguration",
            "The active Identity credential key is not present in the key map.",
        )
    })?;
    Ok((active, signing, verification))
}

fn decode_credential_key(value: &JsonValue, name: &str) -> NativeResult<[u8; 32]> {
    let encoded = string(value, name)?;
    URL_SAFE_NO_PAD
        .decode(encoded)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| {
            NativeError::new(
                "CredentialConfiguration",
                format!("Identity credential {name} key must contain 32 bytes."),
            )
        })
}

fn encode_json(value: &JsonValue) -> NativeResult<String> {
    serde_json::to_vec(value)
        .map(|value| URL_SAFE_NO_PAD.encode(value))
        .map_err(|error| failure("CredentialFailure", error))
}

fn decode_json(value: &str) -> Option<JsonValue> {
    URL_SAFE_NO_PAD
        .decode(value)
        .ok()
        .and_then(|value| serde_json::from_slice(&value).ok())
        .filter(JsonValue::is_object)
}

fn application_access_token(value: &str) -> Option<&str> {
    if !value.contains('=') {
        return (!value.is_empty()).then_some(value);
    }
    value.split(';').find_map(|field| {
        let (name, value) = field.trim().split_once('=')?;
        (name == "kit_access" && !value.is_empty()).then_some(value)
    })
}

fn now_ms() -> NativeResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .map_err(|error| failure("CredentialFailure", error))
}

fn integer(value: &JsonValue, name: &str) -> NativeResult<u64> {
    unsigned_integer(value, name)
        .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be an integer.")))
}

fn unsigned_integer(value: &JsonValue, name: &str) -> Option<u64> {
    value.get(name)?.as_u64()
}

fn string_optional<'a>(value: &'a JsonValue, name: &str) -> Option<&'a str> {
    value.get(name)?.as_str()
}

fn authenticate(
    database: &Mutex<Connection>,
    cookie: Option<&str>,
) -> NativeResult<Option<JsonValue>> {
    let Some(token) = cookie.and_then(session_token) else {
        return Ok(None);
    };
    lock(database)
        .query_row(
            "SELECT users.id, users.name, users.email
             FROM kit_sessions sessions
             JOIN kit_users users ON users.id = sessions.user_id
             WHERE sessions.token = ?1",
            params![token],
            |row| {
                Ok(json!({
                    "session": token,
                    "user": {
                        "id": row.get::<_, String>(0)?,
                        "name": row.get::<_, String>(1)?,
                        "email": row.get::<_, String>(2)?,
                    },
                }))
            },
        )
        .optional()
        .map_err(|error| failure("AuthenticationFailure", error))
}

fn handle(database: &Mutex<Connection>, input: &JsonValue) -> NativeResult<Value> {
    let request = input
        .get("request")
        .ok_or_else(|| NativeError::new("InvalidInput", "Authentication request is required."))?;
    let mounted = string(input, "path")?;
    let path = string(request, "path")?;
    let endpoint = path.strip_prefix(mounted).unwrap_or(path);
    let method = string(request, "method")?;
    let cookie = header(request, "cookie");
    match (method, endpoint) {
        ("GET", "/get-session") => match authenticate(database, cookie)? {
            Some(user) => response(200, json!({ "user": user }), None),
            None => response(200, JsonValue::Null, None),
        },
        ("POST", "/sign-up/email") => sign_up(database, body(request)?),
        ("POST", "/sign-in/email") => sign_in(database, body(request)?),
        ("POST", "/sign-out") => sign_out(database, cookie),
        _ => response(404, json!({ "message": "Not found." }), None),
    }
}

fn sign_up(database: &Mutex<Connection>, input: JsonValue) -> NativeResult<Value> {
    let name = required_text(&input, "name")?;
    let email = required_text(&input, "email")?.to_lowercase();
    let password = required_text(&input, "password")?;
    if password.len() < 8 {
        return response(
            400,
            json!({ "message": "Password must contain at least eight characters." }),
            None,
        );
    }
    let database = lock(database);
    if database
        .query_row(
            "SELECT 1 FROM kit_users WHERE email = ?1",
            params![email],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| failure("AuthenticationFailure", error))?
        .is_some()
    {
        return response(
            409,
            json!({ "message": "An account with this email already exists." }),
            None,
        );
    }
    let id = Uuid::new_v4().to_string();
    let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes())
        .map_err(|error| failure("AuthenticationFailure", error))?;
    let password_hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| failure("AuthenticationFailure", error))?
        .to_string();
    database
        .execute(
            "INSERT INTO kit_users (id, name, email, password_hash) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, email, password_hash],
        )
        .map_err(|error| failure("AuthenticationFailure", error))?;
    session(&database, json!({ "id": id, "name": name, "email": email }))
}

fn sign_in(database: &Mutex<Connection>, input: JsonValue) -> NativeResult<Value> {
    let email = required_text(&input, "email")?.to_lowercase();
    let password = required_text(&input, "password")?;
    let database = lock(database);
    let account = database
        .query_row(
            "SELECT id, name, email, password_hash FROM kit_users WHERE email = ?1",
            params![email],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| failure("AuthenticationFailure", error))?;
    let Some(account) = account else {
        return response(
            401,
            json!({ "message": "Invalid email or password." }),
            None,
        );
    };
    let valid = PasswordHash::new(&account.3).ok().is_some_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    });
    if !valid {
        return response(
            401,
            json!({ "message": "Invalid email or password." }),
            None,
        );
    }
    session(
        &database,
        json!({ "id": account.0, "name": account.1, "email": account.2 }),
    )
}

fn sign_out(database: &Mutex<Connection>, cookie: Option<&str>) -> NativeResult<Value> {
    if let Some(token) = cookie.and_then(session_token) {
        lock(database)
            .execute("DELETE FROM kit_sessions WHERE token = ?1", params![token])
            .map_err(|error| failure("AuthenticationFailure", error))?;
    }
    response(
        200,
        json!({ "success": true }),
        Some("kit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"),
    )
}

fn session(database: &Connection, user: JsonValue) -> NativeResult<Value> {
    let token = Uuid::new_v4().to_string();
    database
        .execute(
            "INSERT INTO kit_sessions (token, user_id) VALUES (?1, ?2)",
            params![token, string(&user, "id")?],
        )
        .map_err(|error| failure("AuthenticationFailure", error))?;
    response(
        200,
        json!({ "user": user }),
        Some(&format!(
            "kit_session={token}; Path=/; HttpOnly; SameSite=Lax"
        )),
    )
}

fn response(status: i64, body: JsonValue, cookie: Option<&str>) -> NativeResult<Value> {
    let mut headers = vec![field("content-type", "application/json")];
    if let Some(cookie) = cookie {
        headers.push(field("set-cookie", cookie));
    }
    Ok(Value::record(std::collections::BTreeMap::from([
        ("status".to_owned(), Value::Number(status as f64)),
        ("headers".to_owned(), Value::array(headers)),
        ("body".to_owned(), Value::String(body.to_string())),
        ("stream".to_owned(), Value::Undefined),
    ])))
}

fn field(name: &str, value: &str) -> Value {
    Value::record(std::collections::BTreeMap::from([
        ("name".to_owned(), Value::String(name.to_owned())),
        ("value".to_owned(), Value::String(value.to_owned())),
    ]))
}

fn body(request: &JsonValue) -> NativeResult<JsonValue> {
    let source = string(request, "body")?;
    serde_json::from_str(source)
        .map_err(|error| NativeError::new("InvalidInput", error.to_string()))
}

fn header<'a>(request: &'a JsonValue, name: &str) -> Option<&'a str> {
    request
        .get("headers")
        .and_then(JsonValue::as_array)?
        .iter()
        .find(|field| field.get("name").and_then(JsonValue::as_str) == Some(name))?
        .get("value")
        .and_then(JsonValue::as_str)
}

fn session_token(cookie: &str) -> Option<&str> {
    cookie.split(';').find_map(|value| {
        let (name, value) = value.trim().split_once('=')?;
        (name == "kit_session" && !value.is_empty()).then_some(value)
    })
}

fn required_text(value: &JsonValue, name: &str) -> NativeResult<String> {
    let value = string(value, name)?;
    if value.is_empty() {
        Err(NativeError::new(
            "InvalidInput",
            format!("{name} is required."),
        ))
    } else {
        Ok(value.to_owned())
    }
}

fn string<'a>(value: &'a JsonValue, name: &str) -> NativeResult<&'a str> {
    value
        .get(name)
        .and_then(JsonValue::as_str)
        .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be a string.")))
}

fn optional_string<'a>(value: &'a JsonValue, name: &str) -> NativeResult<Option<&'a str>> {
    match value.get(name) {
        None | Some(JsonValue::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(Some)
            .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be a string."))),
    }
}

fn failure(name: &str, error: impl std::fmt::Display) -> NativeError {
    NativeError::new(name, error.to_string())
}

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
