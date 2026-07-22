use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use poggers_native_runtime::{
    Capability, CapabilityContext, Engine, NativeError, NativeFuture, NativeResult, Value,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value as JsonValue, json};
use uuid::Uuid;

pub struct Authentication {
    database: Arc<Mutex<Connection>>,
}

pub async fn create(context: CapabilityContext) -> NativeResult<Authentication> {
    let path = context.configuration("database")?;
    if path != ":memory:"
        && let Some(parent) = Path::new(path).parent()
    {
        fs::create_dir_all(parent).map_err(|error| failure("AuthenticationFailure", error))?;
    }
    let database =
        Connection::open(path).map_err(|error| failure("AuthenticationFailure", error))?;
    database
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS poggers_users (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               email TEXT NOT NULL UNIQUE,
               password_hash TEXT NOT NULL
             ) STRICT;
             CREATE TABLE IF NOT EXISTS poggers_sessions (
               token TEXT PRIMARY KEY,
               user_id TEXT NOT NULL REFERENCES poggers_users(id) ON DELETE CASCADE
             ) STRICT;",
        )
        .map_err(|error| failure("AuthenticationFailure", error))?;
    Ok(Authentication {
        database: Arc::new(Mutex::new(database)),
    })
}

impl Capability for Authentication {
    fn call(&self, _engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
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
             FROM poggers_sessions sessions
             JOIN poggers_users users ON users.id = sessions.user_id
             WHERE sessions.token = ?1",
            params![token],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "email": row.get::<_, String>(2)?,
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
            "SELECT 1 FROM poggers_users WHERE email = ?1",
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
            "INSERT INTO poggers_users (id, name, email, password_hash) VALUES (?1, ?2, ?3, ?4)",
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
            "SELECT id, name, email, password_hash FROM poggers_users WHERE email = ?1",
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
            .execute(
                "DELETE FROM poggers_sessions WHERE token = ?1",
                params![token],
            )
            .map_err(|error| failure("AuthenticationFailure", error))?;
    }
    response(
        200,
        json!({ "success": true }),
        Some("poggers_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"),
    )
}

fn session(database: &Connection, user: JsonValue) -> NativeResult<Value> {
    let token = Uuid::new_v4().to_string();
    database
        .execute(
            "INSERT INTO poggers_sessions (token, user_id) VALUES (?1, ?2)",
            params![token, string(&user, "id")?],
        )
        .map_err(|error| failure("AuthenticationFailure", error))?;
    response(
        200,
        json!({ "user": user }),
        Some(&format!(
            "poggers_session={token}; Path=/; HttpOnly; SameSite=Lax"
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
        (name == "poggers_session" && !value.is_empty()).then_some(value)
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn context() -> CapabilityContext {
        CapabilityContext {
            name: "authentication".to_owned(),
            configuration: BTreeMap::from([("database".to_owned(), ":memory:".to_owned())]),
            dependencies: BTreeMap::new(),
        }
    }

    fn request(path: &str, body: JsonValue, cookie: Option<&str>) -> Value {
        let mut headers = Vec::new();
        if let Some(cookie) = cookie {
            headers.push(json!({ "name": "cookie", "value": cookie }));
        }
        Value::from_json(&json!({
            "path": "/auth",
            "request": {
                "method": "POST",
                "path": path,
                "query": [],
                "headers": headers,
                "body": body.to_string()
            }
        }))
    }

    async fn invoke(authentication: &Authentication, operation: &str, input: Value) -> JsonValue {
        authentication
            .call(Engine::new(), operation, input)
            .await
            .expect("authentication operation")
            .to_json()
            .expect("serialize response")
    }

    fn response_cookie(response: &JsonValue) -> &str {
        response["headers"]
            .as_array()
            .expect("headers")
            .iter()
            .find(|field| field["name"] == "set-cookie")
            .and_then(|field| field["value"].as_str())
            .expect("set-cookie")
    }

    #[tokio::test]
    async fn signs_up_authenticates_signs_in_and_revokes_sessions() {
        let authentication = create(context()).await.expect("create authentication");
        let sign_up = invoke(
            &authentication,
            "handle",
            request(
                "/auth/sign-up/email",
                json!({ "name": "Ada", "email": "ADA@example.com", "password": "correct horse" }),
                None,
            ),
        )
        .await;
        assert_eq!(sign_up["status"], 200);
        let cookie = response_cookie(&sign_up).to_owned();

        let session = invoke(
            &authentication,
            "authenticate",
            Value::from_json(&json!({ "cookie": cookie })),
        )
        .await;
        assert_eq!(session["email"], "ada@example.com");

        let invalid = invoke(
            &authentication,
            "handle",
            request(
                "/auth/sign-in/email",
                json!({ "email": "ada@example.com", "password": "incorrect" }),
                None,
            ),
        )
        .await;
        assert_eq!(invalid["status"], 401);

        let sign_out = invoke(
            &authentication,
            "handle",
            request("/auth/sign-out", json!({}), Some(&cookie)),
        )
        .await;
        assert_eq!(sign_out["status"], 200);
        let revoked = invoke(
            &authentication,
            "authenticate",
            Value::from_json(&json!({ "cookie": cookie })),
        )
        .await;
        assert!(revoked.is_null());
    }
}
