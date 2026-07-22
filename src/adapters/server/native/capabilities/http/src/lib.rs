use std::{
    collections::BTreeMap,
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicU64, Ordering},
    },
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderName, HeaderValue, Request, Response, StatusCode, header},
    routing::any,
};
use bytes::Bytes;
use poggers_native_runtime::{
    Capability, CapabilityContext, Engine, NativeError, NativeFunction, NativeFuture, NativeResult,
    Value,
};
use tokio::{sync::oneshot, task::JoinHandle};

mod document;

use document::WebDocument;

pub struct Http {
    state: Arc<HttpState>,
}

struct HttpState {
    routes: RwLock<BTreeMap<u64, Route>>,
    next_route: AtomicU64,
    web_origin: String,
    web: Option<WebArtifact>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    server: Mutex<Option<JoinHandle<std::io::Result<()>>>>,
}

#[derive(Clone)]
struct WebArtifact {
    root: Arc<PathBuf>,
    document: Arc<WebDocument>,
}

#[derive(Clone)]
struct Route {
    path: String,
    engine: Engine,
    handle: Value,
}

pub async fn create(context: CapabilityContext) -> NativeResult<Http> {
    let host = context.configuration("host")?;
    let port = context
        .configuration("port")?
        .parse::<u16>()
        .map_err(|_| NativeError::new("InvalidConfiguration", "PORT must be a valid port."))?;
    let listener = tokio::net::TcpListener::bind((host, port))
        .await
        .map_err(|error| NativeError::new("HttpFailure", error.to_string()))?;
    let (shutdown, stopped) = oneshot::channel();
    let web_root = context.configuration("webRoot")?;
    let web = if web_root.is_empty() {
        None
    } else {
        let root = PathBuf::from(web_root);
        let document = WebDocument::load(&root).map_err(|error| {
            NativeError::new("InvalidWebArtifact", format!("{web_root}: {error}"))
        })?;
        Some(WebArtifact {
            root: Arc::new(root),
            document: Arc::new(document),
        })
    };
    let state = Arc::new(HttpState {
        routes: RwLock::new(BTreeMap::new()),
        next_route: AtomicU64::new(0),
        web_origin: context.configuration("webOrigin")?.to_owned(),
        web,
        shutdown: Mutex::new(Some(shutdown)),
        server: Mutex::new(None),
    });
    let router = Router::new()
        .fallback(any(dispatch))
        .with_state(state.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = stopped.await;
            })
            .await
    });
    *lock(&state.server) = Some(server);
    Ok(Http { state })
}

impl Capability for Http {
    fn call(&self, engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
        let state = self.state.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            if operation != "route" {
                return Err(NativeError::new(
                    "UnknownOperation",
                    format!("Http has no operation {operation:?}."),
                ));
            }
            let input = input.as_record()?;
            let path = input
                .get("path")
                .ok_or_else(|| NativeError::new("InvalidInput", "HTTP route path is required."))?
                .string()?;
            if !path.starts_with('/') {
                return Err(NativeError::new(
                    "InvalidInput",
                    "HTTP route path must be absolute.",
                ));
            }
            let handle = input.get("handle").cloned().ok_or_else(|| {
                NativeError::new("InvalidInput", "HTTP route handle is required.")
            })?;
            let id = state.next_route.fetch_add(1, Ordering::Relaxed);
            write(&state.routes).insert(
                id,
                Route {
                    path,
                    engine,
                    handle,
                },
            );
            let dispose_state = Arc::downgrade(&state);
            let dispose = NativeFunction::new(move |_engine, _arguments| {
                let state = dispose_state.clone();
                Box::pin(async move {
                    if let Some(state) = state.upgrade() {
                        write(&state.routes).remove(&id);
                    }
                    Ok(Value::Undefined)
                })
            });
            Ok(Value::record(BTreeMap::from([(
                "@dispose".to_owned(),
                Value::Function(dispose),
            )])))
        })
    }

    fn shutdown(&self) -> NativeFuture<()> {
        let state = self.state.clone();
        Box::pin(async move {
            let shutdown = { lock(&state.shutdown).take() };
            if let Some(shutdown) = shutdown {
                let _ = shutdown.send(());
            }
            let server = { lock(&state.server).take() };
            if let Some(server) = server {
                server
                    .await
                    .map_err(|error| NativeError::new("HttpFailure", error.to_string()))?
                    .map_err(|error| NativeError::new("HttpFailure", error.to_string()))?;
            }
            Ok(())
        })
    }
}

async fn dispatch(State(state): State<Arc<HttpState>>, request: Request<Body>) -> Response<Body> {
    if request.method() == axum::http::Method::OPTIONS {
        return cors(
            &state,
            Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Body::empty())
                .expect("static HTTP response"),
        );
    }
    let route = {
        let path = request.uri().path();
        read(&state.routes)
            .values()
            .filter(|route| matches_path(&route.path, path))
            .max_by_key(|route| route.path.len())
            .cloned()
    };
    let Some(route) = route else {
        return cors(&state, web_response(&state, request).await);
    };
    let request = match request_value(request).await {
        Ok(request) => request,
        Err(error) => return cors(&state, response(400, &error.message)),
    };
    let result = route.engine.invoke(route.handle, vec![request]).await;
    let rendered = match result {
        Ok(value) => response_value(route.engine, value),
        Err(error) => Ok(response(500, &error.message)),
    };
    cors(
        &state,
        rendered.unwrap_or_else(|error| response(500, &error.message)),
    )
}

async fn web_response(state: &HttpState, request: Request<Body>) -> Response<Body> {
    let Some(web) = &state.web else {
        return response(404, "Not found.");
    };
    if request.method() != axum::http::Method::GET && request.method() != axum::http::Method::HEAD {
        return Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(Body::empty())
            .expect("static HTTP response");
    }
    let head = request.method() == axum::http::Method::HEAD;
    let path = request.uri().path();
    if let Some(relative) = asset_path(path) {
        let source = web.root.join(&relative);
        return match tokio::fs::read(&source).await {
            Ok(bytes) => Response::builder()
                .status(StatusCode::OK)
                .header(
                    header::CONTENT_TYPE,
                    mime_guess::from_path(&source)
                        .first_or_octet_stream()
                        .as_ref(),
                )
                .header(
                    header::CACHE_CONTROL,
                    if path.starts_with("/assets/") {
                        "public, max-age=31536000, immutable"
                    } else {
                        "no-cache"
                    },
                )
                .body(if head {
                    Body::empty()
                } else {
                    Body::from(bytes)
                })
                .expect("static asset response"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                response(404, "Not found.")
            }
            Err(error) => response(500, &error.to_string()),
        };
    }
    if path
        .rsplit('/')
        .next()
        .is_some_and(|segment| segment.contains('.'))
    {
        return response(404, "Not found.");
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(if head {
            Body::empty()
        } else {
            Body::from(web.document.html().to_owned())
        })
        .expect("web document response")
}

fn asset_path(path: &str) -> Option<PathBuf> {
    let relative = path.strip_prefix('/')?;
    if relative != "app.js"
        && relative != "styles.css"
        && !relative.starts_with("assets/")
        && !relative.starts_with("workers/")
    {
        return None;
    }
    let path = Path::new(relative);
    path.components()
        .all(|component| matches!(component, Component::Normal(_)))
        .then(|| path.to_owned())
}

async fn request_value(request: Request<Body>) -> NativeResult<Value> {
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    let query = request
        .uri()
        .query()
        .map(|value| {
            url::form_urlencoded::parse(value.as_bytes())
                .map(|(name, value)| field(&name, &value))
                .collect()
        })
        .unwrap_or_default();
    let headers = request
        .headers()
        .iter()
        .filter_map(|(name, value)| value.to_str().ok().map(|value| field(name.as_str(), value)))
        .collect();
    let body = to_bytes(request.into_body(), 16 * 1024 * 1024)
        .await
        .map_err(|error| NativeError::new("HttpFailure", error.to_string()))?;
    let body = String::from_utf8(body.to_vec())
        .map_err(|error| NativeError::new("HttpFailure", error.to_string()))?;
    Ok(Value::record(BTreeMap::from([
        ("method".to_owned(), Value::String(method)),
        ("path".to_owned(), Value::String(path)),
        ("query".to_owned(), Value::array(query)),
        ("headers".to_owned(), Value::array(headers)),
        ("body".to_owned(), Value::String(body)),
    ])))
}

fn response_value(engine: Engine, value: Value) -> NativeResult<Response<Body>> {
    let value = value.as_record()?;
    let status = value
        .get("status")
        .ok_or_else(|| NativeError::new("InvalidResponse", "HTTP response status is required."))?
        .number()? as u16;
    let mut response = Response::builder().status(status);
    let headers = value
        .get("headers")
        .ok_or_else(|| NativeError::new("InvalidResponse", "HTTP response headers are required."))?
        .as_array()?;
    for field in lock(&headers).iter() {
        let field = field.as_record()?;
        let name = field
            .get("name")
            .ok_or_else(|| NativeError::new("InvalidResponse", "Header name is required."))?
            .string()?;
        let value = field
            .get("value")
            .ok_or_else(|| NativeError::new("InvalidResponse", "Header value is required."))?
            .string()?;
        response = response.header(
            HeaderName::try_from(name)
                .map_err(|error| NativeError::new("InvalidResponse", error.to_string()))?,
            HeaderValue::try_from(value)
                .map_err(|error| NativeError::new("InvalidResponse", error.to_string()))?,
        );
    }
    let stream = value.get("stream").cloned().unwrap_or(Value::Undefined);
    let body = if matches!(stream, Value::Undefined | Value::Null) {
        match value.get("body") {
            Some(Value::String(body)) => Body::from(body.clone()),
            _ => Body::empty(),
        }
    } else {
        Body::from_stream(async_stream::stream! {
            loop {
                match engine.next(stream.clone()).await {
                    Ok(Some(Value::String(value))) => yield Ok::<Bytes, std::io::Error>(Bytes::from(value)),
                    Ok(Some(value)) => {
                        eprintln!("[poggers] HTTP response stream emitted {value:?} instead of a string.");
                        yield Err(std::io::Error::other(format!("HTTP stream emitted {value:?}.")));
                    }
                    Ok(None) => break,
                    Err(error) => {
                        eprintln!("[poggers] HTTP response stream failed: {error}");
                        yield Err(std::io::Error::other(error.to_string()));
                        break;
                    }
                }
            }
        })
    };
    response
        .body(body)
        .map_err(|error| NativeError::new("InvalidResponse", error.to_string()))
}

fn response(status: u16, message: &str) -> Response<Body> {
    let body = serde_json::json!({ "message": message }).to_string();
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .expect("static HTTP response")
}

fn cors(state: &HttpState, mut response: Response<Body>) -> Response<Body> {
    let headers = response.headers_mut();
    if let Ok(origin) = HeaderValue::try_from(&state.web_origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, x-poggers-command, x-poggers-entity"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PATCH, DELETE, OPTIONS"),
    );
    response
}

fn field(name: &str, value: &str) -> Value {
    Value::record(BTreeMap::from([
        ("name".to_owned(), Value::String(name.to_owned())),
        ("value".to_owned(), Value::String(value.to_owned())),
    ]))
}

fn matches_path(route: &str, path: &str) -> bool {
    path == route
        || path
            .strip_prefix(route)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn read<T>(value: &RwLock<T>) -> std::sync::RwLockReadGuard<'_, T> {
    value
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn write<T>(value: &RwLock<T>) -> std::sync::RwLockWriteGuard<'_, T> {
    value
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
