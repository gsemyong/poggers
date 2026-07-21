use std::{
    collections::{HashMap, HashSet},
    convert::Infallible,
    env,
    fmt::Write,
    path::{Path as FilePath, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use async_stream::stream;
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use bytes::Bytes;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
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
    document: Option<Arc<Value>>,
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
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            error.to_string(),
        )
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
    Ok((state.identity.project)(authenticated_user(
        state, headers,
    )?))
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
        yield Ok::<Bytes, Infallible>(Bytes::from(format!("{}
    ", initial)));
        loop {
            match receiver.recv().await {
                Ok(snapshot) => {
                    let snapshot = visible(spec, &principal, snapshot, filter.as_ref());
                    yield Ok(Bytes::from(format!("{}
    ", snapshot)));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    if let Ok(snapshot) = current_snapshot(&state, &stream_name) {
                        let snapshot = visible(spec, &principal, snapshot, filter.as_ref());
                        yield Ok(Bytes::from(format!("{}
    ", snapshot)));
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
    router =
        router.route(
            &collection,
            get(
                move |State(state): State<AppState>,
                      headers: HeaderMap,
                      Query(query): Query<HashMap<String, String>>| async move {
                    json_response(list_entities(list_spec, state, headers, query).await)
                },
            )
            .post(
                move |State(state): State<AppState>,
                      headers: HeaderMap,
                      Json(input): Json<Value>| async move {
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

fn load_web_document(root: &FilePath) -> Result<Value, String> {
    let source = std::fs::read_to_string(root.join("document.ir.json"))
        .map_err(|error| format!("read web document: {error}"))?;
    let document: Value =
        serde_json::from_str(&source).map_err(|error| format!("decode web document: {error}"))?;
    render_web_document(&document)?;
    Ok(document)
}

fn document_string<'a>(document: &'a Value, name: &str) -> Result<&'a str, String> {
    document
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("web document {name} must be a string"))
}

fn render_web_document(document: &Value) -> Result<String, String> {
    validate_object_keys(
        document,
        &[
            "entry",
            "language",
            "rendering",
            "root",
            "styles",
            "title",
            "version",
        ],
        "web document",
    )?;
    if document.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("unsupported web document version".to_owned());
    }
    if document_string(document, "rendering")? != "initial-state-ssr" {
        return Err("unsupported web document rendering mode".to_owned());
    }
    let language = document_string(document, "language")?;
    if language.is_empty()
        || language
            .chars()
            .any(|character| character.is_whitespace() || "\"'<>".contains(character))
    {
        return Err("invalid web document language".to_owned());
    }
    let title = document_string(document, "title")?;
    let entry = document_string(document, "entry")?;
    if !entry.starts_with('/') {
        return Err("web document entry must be absolute".to_owned());
    }
    let styles = document
        .get("styles")
        .and_then(Value::as_array)
        .ok_or_else(|| "web document styles must be an array".to_owned())?;
    let root = document
        .get("root")
        .and_then(Value::as_array)
        .ok_or_else(|| "web document root must be an array".to_owned())?;
    let mut output = String::from("<!doctype html><html lang=\"");
    escape_html_attribute(&mut output, language);
    output.push_str("\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">");
    if !styles.is_empty() {
        output.push_str("<style data-poggers-ssr>");
        for style in styles {
            let style = style
                .as_str()
                .ok_or_else(|| "web document style must be a string".to_owned())?;
            if style.to_ascii_lowercase().contains("</style") {
                return Err("web document style cannot close the style element".to_owned());
            }
            output.push_str(style);
        }
        output.push_str("</style>");
    }
    output.push_str("<title>");
    escape_html_text(&mut output, title);
    output.push_str(
        "</title></head><body><div id=\"app\" data-poggers-rendering=\"initial-state-ssr\">",
    );
    let mut identities = HashSet::new();
    for node in root {
        render_web_node(&mut output, node, &mut identities)?;
    }
    output.push_str("</div><script type=\"module\" src=\"");
    escape_html_attribute(&mut output, entry);
    output.push_str("\"></script></body></html>");
    Ok(output)
}

fn render_web_node(
    output: &mut String,
    node: &Value,
    identities: &mut HashSet<String>,
) -> Result<(), String> {
    let kind = document_string(node, "kind")?;
    let hydration = document_string(node, "hydration")?;
    if !valid_hydration_identity(hydration) || !identities.insert(hydration.to_owned()) {
        return Err("invalid web hydration identity".to_owned());
    }
    if kind == "text" {
        validate_object_keys(node, &["hydration", "kind", "value"], "web text node")?;
        if !hydration.starts_with('t') {
            return Err("web text hydration identity must start with t".to_owned());
        }
        output.push_str("<!--poggers:");
        output.push_str(hydration);
        output.push_str("-->");
        escape_html_text(output, document_string(node, "value")?);
        return Ok(());
    }
    if kind != "element" {
        return Err(format!("unsupported web document node {kind}"));
    }
    validate_object_keys(
        node,
        &["attributes", "children", "hydration", "kind", "tag"],
        "web element node",
    )?;
    if !hydration.starts_with('e') {
        return Err("web element hydration identity must start with e".to_owned());
    }
    let tag = document_string(node, "tag")?;
    if !valid_html_name(tag) {
        return Err(format!("invalid web element {tag}"));
    }
    write!(output, "<{tag}").expect("write to String");
    let attributes = node
        .get("attributes")
        .and_then(Value::as_array)
        .ok_or_else(|| "web element attributes must be an array".to_owned())?;
    let mut attribute_names = HashSet::new();
    let mut hydration_attribute = None;
    for attribute in attributes {
        validate_object_keys(attribute, &["name", "value"], "web element attribute")?;
        let name = document_string(attribute, "name")?;
        if !valid_html_attribute(name) {
            return Err(format!("invalid web attribute {name}"));
        }
        let value = document_string(attribute, "value")?;
        if !attribute_names.insert(name) {
            return Err(format!("duplicate web attribute {name}"));
        }
        if name == "data-poggers-h" {
            hydration_attribute = Some(value);
        }
        output.push(' ');
        output.push_str(name);
        if !value.is_empty() {
            output.push_str("=\"");
            escape_html_attribute(output, value);
            output.push('"');
        }
    }
    if hydration_attribute != Some(hydration) {
        return Err(format!(
            "web element {hydration} has a mismatched hydration attribute"
        ));
    }
    output.push('>');
    let children = node
        .get("children")
        .and_then(Value::as_array)
        .ok_or_else(|| "web element children must be an array".to_owned())?;
    if is_void_element(tag) {
        return if children.is_empty() {
            Ok(())
        } else {
            Err(format!("void web element {tag} cannot have children"))
        };
    }
    for child in children {
        render_web_node(output, child, identities)?;
    }
    write!(output, "</{tag}>").expect("write to String");
    Ok(())
}

fn validate_object_keys(value: &Value, expected: &[&str], subject: &str) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{subject} must be an object"))?;
    if object.len() != expected.len() || expected.iter().any(|name| !object.contains_key(*name)) {
        return Err(format!("{subject} has unsupported fields"));
    }
    Ok(())
}

fn valid_hydration_identity(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some('e' | 't'))
        && characters.clone().next().is_some()
        && characters.all(|character| character.is_ascii_digit())
}

fn valid_html_name(value: &str) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn valid_html_attribute(value: &str) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
        && characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_' | '.' | ':')
        })
}

fn is_void_element(value: &str) -> bool {
    matches!(
        value,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "source"
            | "track"
            | "wbr"
    )
}

fn escape_html_text(output: &mut String, value: &str) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            _ => output.push(character),
        }
    }
}

fn escape_html_attribute(output: &mut String, value: &str) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            _ => output.push(character),
        }
    }
}

async fn web_document(State(state): State<AppState>, method: Method, uri: Uri) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    if uri
        .path()
        .rsplit('/')
        .next()
        .is_some_and(|segment| segment.contains('.'))
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(document) = state.document.as_deref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match render_web_document(document) {
        Ok(html) => {
            let body = if method == Method::HEAD {
                String::new()
            } else {
                html
            };
            ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response()
        }
        Err(error) => {
            eprintln!("render web document: {error}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
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
    let web_root = env::var("POGGERS_WEB_ROOT").ok().map(PathBuf::from);
    let document = web_root.as_ref().map(|root| {
        Arc::new(load_web_document(root).unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        }))
    });
    let state = AppState {
        database: Arc::new(Mutex::new(database)),
        channels: Arc::new(Mutex::new(HashMap::new())),
        identity,
        document,
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
        .route(&format!("/api/{}/sign-out", identity.name), post(sign_out));
    for spec in entities {
        router = entity_routes(router, *spec);
    }
    let router = if let Some(root) = web_root {
        router
            .route_service("/app.js", ServeFile::new(root.join("app.js")))
            .nest_service("/assets", ServeDir::new(root.join("assets")))
            .nest_service("/workers", ServeDir::new(root.join("workers")))
            .fallback(web_document)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> Value {
        json!({
            "version": 1,
            "rendering": "initial-state-ssr",
            "language": "en",
            "title": "A < B & C",
            "entry": "/app.js",
            "styles": [".root{color:red}"],
            "root": [{
                "kind": "element",
                "hydration": "e0",
                "tag": "main",
                "attributes": [
                    { "name": "class", "value": "root" },
                    { "name": "data-poggers-h", "value": "e0" }
                ],
                "children": [{
                    "kind": "text",
                    "hydration": "t0",
                    "value": "<script>&\"'"
                }]
            }]
        })
    }

    #[test]
    fn renders_the_versioned_document_and_escapes_content() {
        let rendered = render_web_document(&document()).expect("render document");
        assert!(rendered.starts_with("<!doctype html><html lang=\"en\">"));
        assert!(rendered.contains("<style data-poggers-ssr>.root{color:red}</style>"));
        assert!(rendered.contains("<title>A &lt; B &amp; C</title>"));
        assert!(rendered.contains("<!--poggers:t0-->&lt;script&gt;&amp;\"'"));
        assert!(
            rendered.ends_with("<script type=\"module\" src=\"/app.js\"></script></body></html>")
        );
    }

    #[test]
    fn rejects_unknown_versions_and_unsafe_names() {
        let mut version = document();
        version["version"] = json!(2);
        assert_eq!(
            render_web_document(&version).expect_err("reject version"),
            "unsupported web document version"
        );

        let mut tag = document();
        tag["root"][0]["tag"] = json!("script><script");
        assert_eq!(
            render_web_document(&tag).expect_err("reject tag"),
            "invalid web element script><script"
        );

        let mut style = document();
        style["styles"] = json!(["</style><script>alert(1)</script>"]);
        assert_eq!(
            render_web_document(&style).expect_err("reject style terminator"),
            "web document style cannot close the style element"
        );

        let mut duplicate = document();
        duplicate["root"][0]["children"] = json!([{
            "kind": "text",
            "hydration": "e0",
            "value": "duplicate"
        }]);
        assert_eq!(
            render_web_document(&duplicate).expect_err("reject duplicate identity"),
            "invalid web hydration identity"
        );
    }
}
