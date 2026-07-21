/** Stable Rust support owned by the server production adapter. */
export const SERVER_RUNTIME_MANIFEST = `[package]
name = "poggers_server_runtime"
version = "0.0.0"
edition = "2024"

[dependencies]
argon2 = "0.5.3"
async-stream = "0.3.6"
axum = "0.8.9"
bytes = "1.10.1"
rusqlite = { version = "0.40.1", features = ["bundled"] }
serde_json = "1.0.145"
tokio = { version = "1.48.0", features = ["net", "signal", "sync"] }
tower-http = { version = "0.6.6", features = ["cors", "fs"] }
uuid = { version = "1.18.1", features = ["v4"] }
`;

export const SERVER_RUNTIME_SOURCE = `use std::{
    collections::HashMap,
    convert::Infallible,
    env,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use async_stream::stream;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use bytes::Bytes;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
};
use uuid::Uuid;

pub type DomainFunction = fn(Value) -> Value;

#[derive(Clone, Copy)]
pub struct IdentitySpec {
    pub name: &'static str,
    pub project: DomainFunction,
}

#[derive(Clone, Copy)]
pub struct EntitySpec {
    pub name: &'static str,
    pub create: DomainFunction,
    pub update: DomainFunction,
    pub authorize: DomainFunction,
    pub matches: Option<DomainFunction>,
}

#[derive(Clone)]
struct AppState {
    database: Arc<Mutex<Connection>>,
    channels: Arc<Mutex<HashMap<String, broadcast::Sender<Value>>>>,
    identity: IdentitySpec,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    details: Value,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            details: json!({}),
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "code": self.code, "message": self.message, "details": self.details })),
        )
            .into_response()
    }
}

fn text(value: &Value, name: &str) -> Result<String, ApiError> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid-input",
                format!("{name} is required."),
            )
        })
}

fn initialize_database(path: &PathBuf) -> Result<Connection, ApiError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(ApiError::internal)?;
    }
    let database = Connection::open(path).map_err(ApiError::internal)?;
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
             ) STRICT;
             CREATE TABLE IF NOT EXISTS poggers_events (
               stream TEXT NOT NULL,
               revision INTEGER NOT NULL,
               event TEXT NOT NULL,
               PRIMARY KEY (stream, revision)
             ) STRICT;",
        )
        .map_err(ApiError::internal)?;
    Ok(database)
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (name, value) = cookie.trim().split_once('=')?;
                (name == "poggers_session").then(|| value.to_owned())
            })
        })
}

fn authenticated_user(state: &AppState, headers: &HeaderMap) -> Result<Value, ApiError> {
    let token = session_token(headers).ok_or_else(|| {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "unauthenticated",
            "Authentication is required.",
        )
    })?;
    let database = state.database.lock().map_err(ApiError::internal)?;
    database
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
        .map_err(ApiError::internal)?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "unauthenticated",
                "Authentication is required.",
            )
        })
}

fn principal(state: &AppState, headers: &HeaderMap) -> Result<Value, ApiError> {
    Ok((state.identity.project)(authenticated_user(state, headers)?))
}

fn session_response(user: Value, token: &str) -> Response {
    let mut response = Json(json!({ "user": user })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "poggers_session={token}; Path=/; HttpOnly; SameSite=Lax"
        ))
        .expect("valid session cookie"),
    );
    response
}

async fn sign_up(State(state): State<AppState>, Json(input): Json<Value>) -> Response {
    let result = (|| -> Result<Response, ApiError> {
        let name = text(&input, "name")?;
        let email = text(&input, "email")?.to_lowercase();
        let password = text(&input, "password")?;
        if password.len() < 8 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid-input",
                "Password must contain at least eight characters.",
            ));
        }
        let id = Uuid::new_v4().to_string();
        let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes()).map_err(ApiError::internal)?;
        let password_hash = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(ApiError::internal)?
            .to_string();
        let token = Uuid::new_v4().to_string();
        let database = state.database.lock().map_err(ApiError::internal)?;
        if database
            .query_row(
                "SELECT 1 FROM poggers_users WHERE email = ?1",
                params![email],
                |_| Ok(()),
            )
            .optional()
            .map_err(ApiError::internal)?
            .is_some()
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "conflict",
                "An account with this email already exists.",
            ));
        }
        database
            .execute(
                "INSERT INTO poggers_users (id, name, email, password_hash) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, email, password_hash],
            )
            .map_err(ApiError::internal)?;
        database
            .execute(
                "INSERT INTO poggers_sessions (token, user_id) VALUES (?1, ?2)",
                params![token, id],
            )
            .map_err(ApiError::internal)?;
        Ok(session_response(
            json!({ "id": id, "name": name, "email": email }),
            &token,
        ))
    })();
    result.unwrap_or_else(IntoResponse::into_response)
}

async fn sign_in(State(state): State<AppState>, Json(input): Json<Value>) -> Response {
    let result = (|| -> Result<Response, ApiError> {
        let email = text(&input, "email")?.to_lowercase();
        let password = text(&input, "password")?;
        let database = state.database.lock().map_err(ApiError::internal)?;
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
            .map_err(ApiError::internal)?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::UNAUTHORIZED,
                    "unauthenticated",
                    "Invalid email or password.",
                )
            })?;
        let parsed = PasswordHash::new(&account.3).map_err(ApiError::internal)?;
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .map_err(|_| {
                ApiError::new(
                    StatusCode::UNAUTHORIZED,
                    "unauthenticated",
                    "Invalid email or password.",
                )
            })?;
        let token = Uuid::new_v4().to_string();
        database
            .execute(
                "INSERT INTO poggers_sessions (token, user_id) VALUES (?1, ?2)",
                params![token, account.0],
            )
            .map_err(ApiError::internal)?;
        Ok(session_response(
            json!({ "id": account.0, "name": account.1, "email": account.2 }),
            &token,
        ))
    })();
    result.unwrap_or_else(IntoResponse::into_response)
}

async fn get_session(State(state): State<AppState>, headers: HeaderMap) -> Response {
    match authenticated_user(&state, &headers) {
        Ok(user) => Json(json!({ "user": user })).into_response(),
        Err(_) => Json(Value::Null).into_response(),
    }
}

async fn sign_out(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = session_token(&headers)
        && let Ok(database) = state.database.lock()
    {
        let _ = database.execute(
            "DELETE FROM poggers_sessions WHERE token = ?1",
            params![token],
        );
    }
    let mut response = Json(json!({ "success": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("poggers_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"),
    );
    response
}

fn stream_name(spec: EntitySpec, principal: &Value) -> Result<String, ApiError> {
    let id = principal.get("id").and_then(Value::as_str).ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid-principal",
            "Identity principal requires id.",
        )
    })?;
    Ok(format!("{}:{}", spec.name, id))
}

fn read_history(database: &Connection, stream: &str) -> Result<Vec<(i64, Value)>, ApiError> {
    let mut statement = database
        .prepare("SELECT revision, event FROM poggers_events WHERE stream = ?1 ORDER BY revision")
        .map_err(ApiError::internal)?;
    let rows = statement
        .query_map(params![stream], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(ApiError::internal)?;
    rows.map(|row| {
        let (revision, event) = row.map_err(ApiError::internal)?;
        Ok((
            revision,
            serde_json::from_str(&event).map_err(ApiError::internal)?,
        ))
    })
    .collect()
}

fn snapshot(history: &[(i64, Value)]) -> Value {
    let mut entities: Vec<Value> = Vec::new();
    for (_, event) in history {
        match event.get("type").and_then(Value::as_str) {
            Some("entity.created") | Some("entity.replaced") => {
                if let Some(entity) = event.get("entity") {
                    let id = entity.get("id").and_then(Value::as_str);
                    if let Some(index) = entities
                        .iter()
                        .position(|value| value.get("id").and_then(Value::as_str) == id)
                    {
                        entities[index] = entity.clone();
                    } else {
                        entities.push(entity.clone());
                    }
                }
            }
            Some("entity.removed") => {
                let id = event.get("id").and_then(Value::as_str);
                entities.retain(|entity| entity.get("id").and_then(Value::as_str) != id);
            }
            _ => {}
        }
    }
    json!({
        "revision": history.last().map(|(revision, _)| *revision).unwrap_or(0),
        "entities": entities,
    })
}

fn truth(value: &Value) -> bool {
    value.as_bool().unwrap_or(false)
}

fn visible(spec: EntitySpec, principal: &Value, snapshot: Value, filter: Option<&Value>) -> Value {
    let revision = snapshot.get("revision").cloned().unwrap_or(json!(0));
    let entities = snapshot
        .get("entities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|entity| {
            let authorized = (spec.authorize)(json!({
                "operation": "read",
                "principal": principal,
                "entity": entity,
            }));
            if !truth(&authorized) {
                return false;
            }
            match (filter, spec.matches) {
                (Some(filter), Some(matches)) => truth(&matches(json!({
                    "principal": principal,
                    "entity": entity,
                    "filter": filter,
                }))),
                _ => true,
            }
        })
        .cloned()
        .collect::<Vec<_>>();
    json!({ "revision": revision, "entities": entities })
}

fn channel(state: &AppState, stream: &str) -> broadcast::Sender<Value> {
    let mut channels = state.channels.lock().expect("channel lock");
    channels
        .entry(stream.to_owned())
        .or_insert_with(|| broadcast::channel(256).0)
        .clone()
}

fn current_snapshot(state: &AppState, stream: &str) -> Result<Value, ApiError> {
    let database = state.database.lock().map_err(ApiError::internal)?;
    Ok(snapshot(&read_history(&database, stream)?))
}

fn publish(state: &AppState, stream: &str, value: Value) {
    let _ = channel(state, stream).send(value);
}

fn command_header(headers: &HeaderMap, name: &'static str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_millis() as i64
}

fn find_entity(snapshot: &Value, id: &str) -> Option<Value> {
    snapshot
        .get("entities")?
        .as_array()?
        .iter()
        .find(|entity| entity.get("id").and_then(Value::as_str) == Some(id))
        .cloned()
}

fn authorize(spec: EntitySpec, input: Value) -> Result<(), ApiError> {
    if truth(&(spec.authorize)(input.clone())) {
        return Ok(());
    }
    let operation = input
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("access");
    Err(ApiError::new(
        StatusCode::FORBIDDEN,
        "forbidden",
        format!("The {operation} operation is not allowed."),
    ))
}

fn append_event(
    state: &AppState,
    stream: &str,
    command: Option<&str>,
    decide: impl FnOnce(&Value) -> Result<(Value, Value), ApiError>,
) -> Result<Value, ApiError> {
    let database = state.database.lock().map_err(ApiError::internal)?;
    let history = read_history(&database, stream)?;
    if let Some(command) = command
        && let Some(event) = history.iter().find_map(|(_, event)| {
            (event.get("commandId").and_then(Value::as_str) == Some(command)).then_some(event)
        })
        && let Some(entity) = event.get("entity")
    {
        return Ok(entity.clone());
    }
    let before = snapshot(&history);
    let (event, result) = decide(&before)?;
    let revision = history
        .last()
        .map(|(revision, _)| revision + 1)
        .unwrap_or(1);
    database
        .execute(
            "INSERT INTO poggers_events (stream, revision, event) VALUES (?1, ?2, ?3)",
            params![stream, revision, event.to_string()],
        )
        .map_err(ApiError::internal)?;
    let mut next = history;
    next.push((revision, event));
    let after = snapshot(&next);
    drop(database);
    publish(state, stream, after);
    Ok(result)
}

fn parse_filter(query: &HashMap<String, String>) -> Result<Option<Value>, ApiError> {
    query
        .get("filter")
        .map(|value| serde_json::from_str(value).map_err(ApiError::internal))
        .transpose()
}

async fn list_entities(
    spec: EntitySpec,
    state: AppState,
    headers: HeaderMap,
    query: HashMap<String, String>,
) -> Result<Value, ApiError> {
    let principal = principal(&state, &headers)?;
    let stream = stream_name(spec, &principal)?;
    let filter = parse_filter(&query)?;
    Ok(visible(
        spec,
        &principal,
        current_snapshot(&state, &stream)?,
        filter.as_ref(),
    ))
}

async fn get_entity(
    spec: EntitySpec,
    state: AppState,
    headers: HeaderMap,
    id: String,
) -> Result<Value, ApiError> {
    let principal = principal(&state, &headers)?;
    let stream = stream_name(spec, &principal)?;
    let entity = find_entity(&current_snapshot(&state, &stream)?, &id).ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "not-found",
            format!("Entity {id} was not found."),
        )
    })?;
    authorize(
        spec,
        json!({ "operation": "read", "principal": principal, "entity": entity }),
    )?;
    Ok(entity)
}

async fn create_entity(
    spec: EntitySpec,
    state: AppState,
    headers: HeaderMap,
    input: Value,
) -> Result<Value, ApiError> {
    let principal = principal(&state, &headers)?;
    let stream = stream_name(spec, &principal)?;
    let command = command_header(&headers, "x-poggers-command");
    let entity_id =
        command_header(&headers, "x-poggers-entity").unwrap_or_else(|| Uuid::new_v4().to_string());
    append_event(&state, &stream, command.as_deref(), |_| {
        let entity =
            (spec.create)(json!({ "id": entity_id, "principal": principal, "input": input }));
        authorize(
            spec,
            json!({ "operation": "create", "principal": principal, "entity": entity }),
        )?;
        let mut event = json!({ "type": "entity.created", "entity": entity, "at": now() });
        if let Some(command) = &command {
            event["commandId"] = json!(command);
        }
        Ok((event, entity))
    })
}

async fn update_entity(
    spec: EntitySpec,
    state: AppState,
    headers: HeaderMap,
    id: String,
    input: Value,
) -> Result<Value, ApiError> {
    let principal = principal(&state, &headers)?;
    let stream = stream_name(spec, &principal)?;
    let command = command_header(&headers, "x-poggers-command");
    append_event(&state, &stream, command.as_deref(), |snapshot| {
        let previous = find_entity(snapshot, &id).ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "not-found",
                format!("Entity {id} was not found."),
            )
        })?;
        let entity =
            (spec.update)(json!({ "principal": principal, "previous": previous, "input": input }));
        if entity.get("id") != previous.get("id") {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid-entity",
                "An update cannot change an entity id.",
            ));
        }
        authorize(
            spec,
            json!({
                "operation": "update",
                "principal": principal,
                "previous": previous,
                "entity": entity,
            }),
        )?;
        let mut event = json!({ "type": "entity.replaced", "entity": entity, "at": now() });
        if let Some(command) = &command {
            event["commandId"] = json!(command);
        }
        Ok((event, entity))
    })
}

async fn remove_entity(
    spec: EntitySpec,
    state: AppState,
    headers: HeaderMap,
    id: String,
) -> Result<Value, ApiError> {
    let principal = principal(&state, &headers)?;
    let stream = stream_name(spec, &principal)?;
    let command = command_header(&headers, "x-poggers-command");
    append_event(&state, &stream, command.as_deref(), |snapshot| {
        let entity = find_entity(snapshot, &id).ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "not-found",
                format!("Entity {id} was not found."),
            )
        })?;
        authorize(
            spec,
            json!({ "operation": "remove", "principal": principal, "entity": entity }),
        )?;
        let mut event =
            json!({ "type": "entity.removed", "id": id, "entity": entity, "at": now() });
        if let Some(command) = &command {
            event["commandId"] = json!(command);
        }
        Ok((event, entity))
    })
}

async fn changes(
    spec: EntitySpec,
    state: AppState,
    headers: HeaderMap,
    query: HashMap<String, String>,
) -> Result<Response, ApiError> {
    let principal = principal(&state, &headers)?;
    let stream_name = stream_name(spec, &principal)?;
    let filter = parse_filter(&query)?;
    let mut receiver = channel(&state, &stream_name).subscribe();
    let initial = visible(
        spec,
        &principal,
        current_snapshot(&state, &stream_name)?,
        filter.as_ref(),
    );
    let output = stream! {
        yield Ok::<Bytes, Infallible>(Bytes::from(format!("{}\n", initial)));
        loop {
            match receiver.recv().await {
                Ok(snapshot) => {
                    let snapshot = visible(spec, &principal, snapshot, filter.as_ref());
                    yield Ok(Bytes::from(format!("{}\n", snapshot)));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    if let Ok(snapshot) = current_snapshot(&state, &stream_name) {
                        let snapshot = visible(spec, &principal, snapshot, filter.as_ref());
                        yield Ok(Bytes::from(format!("{}\n", snapshot)));
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    let mut response = Body::from_stream(output).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/x-ndjson"),
    );
    Ok(response)
}

fn json_response(result: Result<Value, ApiError>) -> Response {
    result
        .map(Json)
        .map(IntoResponse::into_response)
        .unwrap_or_else(IntoResponse::into_response)
}

fn created_response(result: Result<Value, ApiError>) -> Response {
    result
        .map(|value| (StatusCode::CREATED, Json(value)).into_response())
        .unwrap_or_else(IntoResponse::into_response)
}

fn entity_routes(mut router: Router<AppState>, spec: EntitySpec) -> Router<AppState> {
    let collection = format!("/api/{}", spec.name);
    let changes_path = format!("{collection}/changes");
    let entity = format!("{collection}/{{id}}");
    let list_spec = spec;
    let create_spec = spec;
    let changes_spec = spec;
    let get_spec = spec;
    let update_spec = spec;
    let remove_spec = spec;
    router = router.route(
        &collection,
        get(
            move |State(state): State<AppState>,
                  headers: HeaderMap,
                  Query(query): Query<HashMap<String, String>>| async move {
                json_response(list_entities(list_spec, state, headers, query).await)
            },
        )
        .post(
            move |State(state): State<AppState>, headers: HeaderMap, Json(input): Json<Value>| async move {
                created_response(create_entity(create_spec, state, headers, input).await)
            },
        ),
    );
    router = router.route(
        &changes_path,
        get(
            move |State(state): State<AppState>,
                  headers: HeaderMap,
                  Query(query): Query<HashMap<String, String>>| async move {
                changes(changes_spec, state, headers, query)
                    .await
                    .unwrap_or_else(IntoResponse::into_response)
            },
        ),
    );
    router.route(
        &entity,
        get(
            move |State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>| async move {
                json_response(get_entity(get_spec, state, headers, id).await)
            },
        )
        .patch(
            move |State(state): State<AppState>,
                  headers: HeaderMap,
                  Path(id): Path<String>,
                  Json(input): Json<Value>| async move {
                json_response(update_entity(update_spec, state, headers, id, input).await)
            },
        )
        .delete(
            move |State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>| async move {
                json_response(remove_entity(remove_spec, state, headers, id).await)
            },
        ),
    )
}

pub async fn serve(
    application: &'static str,
    program: &'static str,
    identity: IdentitySpec,
    entities: &[EntitySpec],
) {
    let database_path = env::var("POGGERS_DATABASE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(".data/application.sqlite"));
    let database = initialize_database(&database_path).unwrap_or_else(|error| {
        eprintln!("{}", error.message);
        std::process::exit(1);
    });
    let state = AppState {
        database: Arc::new(Mutex::new(database)),
        channels: Arc::new(Mutex::new(HashMap::new())),
        identity,
    };
    let web_origin =
        env::var("POGGERS_WEB_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".to_owned());
    let allow_origin = HeaderValue::from_str(&web_origin).expect("valid POGGERS_WEB_ORIGIN");
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::exact(allow_origin))
        .allow_credentials(true)
        .allow_headers([
            header::CONTENT_TYPE,
            header::COOKIE,
            HeaderName::from_static("x-poggers-command"),
            HeaderName::from_static("x-poggers-entity"),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ]);
    let mut router = Router::new()
        .route(
            &format!("/api/{}/sign-up/email", identity.name),
            post(sign_up),
        )
        .route(
            &format!("/api/{}/sign-in/email", identity.name),
            post(sign_in),
        )
        .route(
            &format!("/api/{}/get-session", identity.name),
            get(get_session),
        )
        .route(
            &format!("/api/{}/sign-out", identity.name),
            post(sign_out),
        );
    for spec in entities {
        router = entity_routes(router, *spec);
    }
    let router = if let Ok(root) = env::var("POGGERS_WEB_ROOT") {
        let root = PathBuf::from(root);
        router.fallback_service(ServeDir::new(&root).fallback(ServeFile::new(root.join("index.html"))))
    } else {
        router
    };
    let app = router.layer(cors).with_state(state);
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
    let port = env::var("PORT").unwrap_or_else(|_| "3010".to_owned());
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}"))
        .await
        .expect("bind native server");
    println!("{application} {program} listening on http://{host}:{port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve native application");
}
`;
