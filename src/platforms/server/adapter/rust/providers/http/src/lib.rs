use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderName, HeaderValue, Request, Response, StatusCode, header},
    routing::any,
};
use bytes::Bytes;
use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFunction,
    NativeFuture, NativeResult, Value,
};
use tokio::{
    sync::{oneshot, watch},
    task::JoinHandle,
};
use tower::ServiceBuilder;
use tower_http::{
    catch_panic::CatchPanicLayer,
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    timeout::TimeoutLayer,
};

pub struct Http {
    state: Arc<HttpState>,
}

struct HttpState {
    routes: RwLock<BTreeMap<u64, Route>>,
    next_route: AtomicU64,
    shutdown_timeout: Duration,
    stream_shutdown: watch::Sender<bool>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    server: Mutex<Option<JoinHandle<std::io::Result<()>>>>,
}

#[derive(Clone)]
struct Route {
    path: String,
    engine: Engine,
    handle: Value,
}

pub async fn create(context: DependencyContext) -> NativeResult<Http> {
    let host = context.configuration("host")?;
    let port = configuration_number::<u16>(&context, "port", "PORT")?;
    let body_limit = configuration_number::<usize>(&context, "bodyLimit", "KIT_HTTP_BODY_LIMIT")?;
    let request_timeout = Duration::from_millis(configuration_number::<u64>(
        &context,
        "requestTimeout",
        "KIT_HTTP_TIMEOUT_MS",
    )?);
    let shutdown_timeout = Duration::from_millis(configuration_number::<u64>(
        &context,
        "shutdownTimeout",
        "KIT_HTTP_SHUTDOWN_TIMEOUT_MS",
    )?);
    if body_limit == 0 || request_timeout.is_zero() || shutdown_timeout.is_zero() {
        return Err(NativeError::new(
            "InvalidConfiguration",
            "HTTP limits and timeouts must be greater than zero.",
        ));
    }

    let listener = tokio::net::TcpListener::bind((host, port))
        .await
        .map_err(|error| NativeError::new("HttpFailure", error.to_string()))?;
    let (shutdown, stopped) = oneshot::channel();
    let (stream_shutdown, _) = watch::channel(false);
    let state = Arc::new(HttpState {
        routes: RwLock::new(BTreeMap::new()),
        next_route: AtomicU64::new(0),
        shutdown_timeout,
        stream_shutdown,
        shutdown: Mutex::new(Some(shutdown)),
        server: Mutex::new(None),
    });
    let request_id = HeaderName::from_static("x-request-id");
    let router = Router::new()
        .fallback(any(dispatch))
        .layer(
            ServiceBuilder::new()
                .layer(SetRequestIdLayer::new(request_id.clone(), MakeRequestUuid))
                .layer(PropagateRequestIdLayer::new(request_id))
                .layer(CatchPanicLayer::new())
                .layer(RequestBodyLimitLayer::new(body_limit))
                .layer(TimeoutLayer::with_status_code(
                    StatusCode::REQUEST_TIMEOUT,
                    request_timeout,
                )),
        )
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

impl Dependency for Http {
    fn call(
        &self,
        engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
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
            let _ = state.stream_shutdown.send(true);
            let shutdown = { lock(&state.shutdown).take() };
            if let Some(shutdown) = shutdown {
                let _ = shutdown.send(());
            }
            let server = { lock(&state.server).take() };
            if let Some(mut server) = server {
                match tokio::time::timeout(state.shutdown_timeout, &mut server).await {
                    Ok(result) => result
                        .map_err(|error| NativeError::new("HttpFailure", error.to_string()))?
                        .map_err(|error| NativeError::new("HttpFailure", error.to_string()))?,
                    Err(_) => {
                        server.abort();
                        let _ = server.await;
                    }
                }
            }
            Ok(())
        })
    }
}

kit_server_runtime::dependency_operations!(Http {
    operation_route => "route",
});

async fn dispatch(State(state): State<Arc<HttpState>>, request: Request<Body>) -> Response<Body> {
    let route = {
        let path = request.uri().path();
        read(&state.routes)
            .values()
            .filter(|route| matches_path(&route.path, path))
            .max_by_key(|route| route.path.len())
            .cloned()
    };
    let Some(route) = route else {
        return response(404, "Not found.");
    };
    let request = match request_value(request).await {
        Ok(request) => request,
        Err(error) => return response(400, &error.message),
    };
    let result = route.engine.invoke(route.handle, vec![request]).await;
    let mut response = match result {
        Ok(value) => response_value(route.engine, value, state.stream_shutdown.subscribe())
            .unwrap_or_else(|error| {
                eprintln!("[kit] HTTP response failed: {error}");
                response(500, "Internal server error.")
            }),
        Err(error) => {
            eprintln!("[kit] HTTP route failed: {error}");
            response(500, "Internal server error.")
        }
    };
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
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

fn response_value(
    engine: Engine,
    value: Value,
    mut shutdown: watch::Receiver<bool>,
) -> NativeResult<Response<Body>> {
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
                if *shutdown.borrow() {
                    break;
                }
                let next = tokio::select! {
                    changed = shutdown.changed() => {
                        if changed.is_err() || *shutdown.borrow() {
                            break;
                        }
                        continue;
                    }
                    next = engine.next(stream.clone()) => next,
                };
                match next {
                    Ok(Some(Value::String(value))) => {
                        yield Ok::<Bytes, std::io::Error>(Bytes::from(value));
                    }
                    Ok(Some(value)) => {
                        eprintln!("[kit] HTTP response stream emitted {value:?} instead of a string.");
                        yield Err(std::io::Error::other(format!("HTTP stream emitted {value:?}.")));
                    }
                    Ok(None) => break,
                    Err(error) => {
                        eprintln!("[kit] HTTP response stream failed: {error}");
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

fn configuration_number<Value>(
    context: &DependencyContext,
    name: &str,
    environment: &str,
) -> NativeResult<Value>
where
    Value: std::str::FromStr,
{
    context.configuration(name)?.parse::<Value>().map_err(|_| {
        NativeError::new(
            "InvalidConfiguration",
            format!("{environment} must be a valid positive integer."),
        )
    })
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
