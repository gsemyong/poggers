use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, HeaderName, HeaderValue, Request, Response, StatusCode, header},
    routing::any,
};
use bytes::Bytes;
use kit_server_runtime::{
    Dependency, DependencyContext, Engine, NativeError, NativeFunction, NativeFuture, NativeResult,
    Value,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::{
    sync::{Semaphore, oneshot, watch},
    task::{JoinHandle, JoinSet},
};
use tower::ServiceBuilder;
use tower_http::{
    catch_panic::CatchPanicLayer,
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    timeout::TimeoutLayer,
};

mod document;

use document::{RouteLookup, WebDeferredDocument, WebDocument, WebLoaderOutcome};

pub struct Http {
    state: Arc<HttpState>,
}

struct HttpState {
    routes: RwLock<BTreeMap<u64, Route>>,
    web_loader: RwLock<Option<(u64, Engine, Value)>>,
    next_route: AtomicU64,
    web_origins: BTreeSet<String>,
    web: WebArtifacts,
    web_cache: Mutex<WebResponseCache>,
    web_cache_refreshes: Arc<Semaphore>,
    request_timeout: Duration,
    shutdown_timeout: Duration,
    stream_shutdown: watch::Sender<bool>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    server: Mutex<Option<JoinHandle<std::io::Result<()>>>>,
}

#[derive(Clone)]
struct WebArtifact {
    identity: Arc<str>,
    origin: Arc<str>,
    root: Arc<PathBuf>,
    document: Arc<WebDocument>,
    assets: Arc<BTreeMap<String, WebAsset>>,
}

#[derive(Clone, Default)]
struct WebArtifacts {
    default: Option<WebArtifact>,
    authorities: BTreeMap<String, WebArtifact>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WebInterfaceConfiguration {
    identity: String,
    origin: String,
    root: String,
}

#[derive(Clone)]
struct WebAsset {
    relative: PathBuf,
    content_type: String,
    cache_control: &'static str,
    etag: String,
    size: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WebAssetManifest {
    version: u64,
    assets: Vec<WebAssetEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WebAssetEntry {
    path: String,
    etag: String,
    size: u64,
    immutable: bool,
}

#[derive(Clone)]
struct Route {
    path: String,
    engine: Engine,
    handle: Value,
}

struct WebDeferredTask {
    boundary: String,
    function: Value,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WebRepresentation {
    Document,
    Markdown,
    RouteData,
}

#[derive(Clone)]
enum CachedWebOutcome {
    Document {
        html: String,
        etag: String,
        markdown: Option<String>,
        markdown_etag: Option<String>,
        route_data: String,
        route_etag: String,
        cache_control: String,
    },
}

#[derive(Clone)]
struct CachedWebEntry {
    outcome: CachedWebOutcome,
    stored_at: Instant,
    bytes: usize,
}

struct WebResponseCache {
    capacity: usize,
    max_bytes: usize,
    bytes: usize,
    entries: BTreeMap<String, CachedWebEntry>,
    order: VecDeque<String>,
    pending: BTreeMap<String, watch::Sender<WebCacheCompletion>>,
}

#[derive(Clone)]
enum WebCacheCompletion {
    Pending,
    Complete {
        outcome: Option<CachedWebOutcome>,
        cached: bool,
    },
}

enum WebCacheLookup {
    Fresh(CachedWebOutcome),
    Stale {
        outcome: CachedWebOutcome,
        refresh: bool,
    },
    Miss,
    Wait(watch::Receiver<WebCacheCompletion>),
}

enum WebDeferredSettlement {
    Resolved(serde_json::Value),
    Rejected,
    Invalid(String),
}

struct RenderedWebOutcome {
    outcome: WebLoaderOutcome,
    deferred_tasks: Vec<WebDeferredTask>,
    deferred_engine: Option<Engine>,
}

impl WebResponseCache {
    fn new(capacity: usize, max_bytes: usize) -> Self {
        Self {
            capacity,
            max_bytes,
            bytes: 0,
            entries: BTreeMap::new(),
            order: VecDeque::new(),
            pending: BTreeMap::new(),
        }
    }

    fn lookup(&mut self, key: &str, policy: document::WebResponseCachePolicy) -> WebCacheLookup {
        if let Some(entry) = self.entries.get(key).cloned() {
            let age = entry.stored_at.elapsed();
            if age < policy.max_age {
                self.touch(key);
                return WebCacheLookup::Fresh(entry.outcome);
            }
            if age < policy.max_age.saturating_add(policy.stale_while_revalidate) {
                self.touch(key);
                let refresh = !self.pending.contains_key(key);
                if refresh {
                    let (pending, _) = watch::channel(WebCacheCompletion::Pending);
                    self.pending.insert(key.to_owned(), pending);
                }
                return WebCacheLookup::Stale {
                    outcome: entry.outcome,
                    refresh,
                };
            }
            self.remove(key);
        }
        if let Some(pending) = self.pending.get(key) {
            return WebCacheLookup::Wait(pending.subscribe());
        }
        let (pending, _) = watch::channel(WebCacheCompletion::Pending);
        self.pending.insert(key.to_owned(), pending);
        WebCacheLookup::Miss
    }

    fn complete(&mut self, key: String, outcome: Option<CachedWebOutcome>) -> bool {
        let mut cached = false;
        if let Some(outcome) = outcome.as_ref() {
            let entry_bytes = outcome.bytes();
            if entry_bytes <= self.max_bytes {
                self.remove(&key);
                self.entries.insert(
                    key.clone(),
                    CachedWebEntry {
                        outcome: outcome.clone(),
                        stored_at: Instant::now(),
                        bytes: entry_bytes,
                    },
                );
                self.bytes += entry_bytes;
                self.order.push_back(key.clone());
                while self.entries.len() > self.capacity || self.bytes > self.max_bytes {
                    let Some(expired) = self.order.pop_front() else {
                        break;
                    };
                    if let Some(entry) = self.entries.remove(&expired) {
                        self.bytes = self.bytes.saturating_sub(entry.bytes);
                    }
                }
                cached = self.entries.contains_key(&key);
            }
        }
        if let Some(pending) = self.pending.remove(&key) {
            let _ = pending.send(WebCacheCompletion::Complete { outcome, cached });
        }
        cached
    }

    fn touch(&mut self, key: &str) {
        self.order.retain(|value| value != key);
        self.order.push_back(key.to_owned());
    }

    fn remove(&mut self, key: &str) {
        if let Some(entry) = self.entries.remove(key) {
            self.bytes = self.bytes.saturating_sub(entry.bytes);
        }
        self.order.retain(|value| value != key);
    }
}

impl CachedWebOutcome {
    fn bytes(&self) -> usize {
        match self {
            Self::Document {
                html,
                etag,
                markdown,
                markdown_etag,
                route_data,
                route_etag,
                cache_control,
            } => html
                .len()
                .saturating_add(etag.len())
                .saturating_add(markdown.as_ref().map_or(0, String::len))
                .saturating_add(markdown_etag.as_ref().map_or(0, String::len))
                .saturating_add(route_data.len())
                .saturating_add(route_etag.len())
                .saturating_add(cache_control.len()),
        }
    }
}

pub async fn create(context: DependencyContext) -> NativeResult<Http> {
    let host = context.configuration("host")?;
    let port = configuration_number::<u16>(&context, "port", "PORT")?;
    let body_limit = configuration_number::<usize>(&context, "bodyLimit", "KIT_HTTP_BODY_LIMIT")?;
    let web_cache_capacity =
        configuration_number::<usize>(&context, "webCacheCapacity", "KIT_WEB_CACHE_CAPACITY")?;
    let web_cache_bytes =
        configuration_number::<usize>(&context, "webCacheBytes", "KIT_WEB_CACHE_BYTES")?;
    let web_cache_refreshes =
        configuration_number::<usize>(&context, "webCacheRefreshes", "KIT_WEB_CACHE_REFRESHES")?;
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
    if body_limit == 0
        || web_cache_capacity == 0
        || web_cache_bytes == 0
        || web_cache_refreshes == 0
        || request_timeout.is_zero()
        || shutdown_timeout.is_zero()
    {
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
    let web_origin = context.configuration("webOrigin")?.trim_end_matches('/');
    let web_root = context.configuration("webRoot")?;
    let default_web = if web_root.is_empty() {
        None
    } else {
        Some(load_web_artifact("default", web_origin, web_root)?)
    };
    let web_interfaces = context.configuration("webInterfaces")?;
    let mut authorities = BTreeMap::new();
    let mut web_origins = BTreeSet::new();
    if !web_origin.is_empty() {
        web_origins.insert(web_origin.to_owned());
    }
    if !web_interfaces.is_empty() {
        let interfaces = serde_json::from_str::<Vec<WebInterfaceConfiguration>>(web_interfaces)
            .map_err(|error| {
                NativeError::new(
                    "InvalidConfiguration",
                    format!("KIT_WEB_INTERFACES: {error}"),
                )
            })?;
        for interface in interfaces {
            let origin = interface.origin.trim_end_matches('/');
            let authority = web_authority(origin)?;
            let artifact = load_web_artifact(&interface.identity, origin, &interface.root)?;
            if authorities.insert(authority.clone(), artifact).is_some() {
                return Err(NativeError::new(
                    "InvalidConfiguration",
                    format!("duplicate web interface authority {authority:?}"),
                ));
            }
            web_origins.insert(origin.to_owned());
        }
    }
    let web = WebArtifacts {
        default: default_web,
        authorities,
    };
    let state = Arc::new(HttpState {
        routes: RwLock::new(BTreeMap::new()),
        web_loader: RwLock::new(None),
        next_route: AtomicU64::new(0),
        web_origins,
        web,
        web_cache: Mutex::new(WebResponseCache::new(web_cache_capacity, web_cache_bytes)),
        web_cache_refreshes: Arc::new(Semaphore::new(web_cache_refreshes)),
        request_timeout,
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

fn load_web_artifact(identity: &str, origin: &str, directory: &str) -> NativeResult<WebArtifact> {
    let root = PathBuf::from(directory);
    let document = WebDocument::load(&root)
        .map_err(|error| NativeError::new("InvalidWebArtifact", format!("{directory}: {error}")))?;
    let assets = load_assets(&root)
        .map_err(|error| NativeError::new("InvalidWebArtifact", format!("{directory}: {error}")))?;
    Ok(WebArtifact {
        identity: Arc::from(identity),
        origin: Arc::from(origin),
        root: Arc::new(root),
        document: Arc::new(document),
        assets: Arc::new(assets),
    })
}

fn web_authority(origin: &str) -> NativeResult<String> {
    let url = url::Url::parse(origin).map_err(|error| {
        NativeError::new(
            "InvalidConfiguration",
            format!("invalid web interface origin {origin:?}: {error}"),
        )
    })?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(NativeError::new(
            "InvalidConfiguration",
            format!("web interface origin must be an HTTP origin: {origin:?}"),
        ));
    }
    Ok(url[url::Position::BeforeHost..url::Position::AfterPort].to_ascii_lowercase())
}

fn select_web_artifact(web: &WebArtifacts, headers: &HeaderMap) -> Option<WebArtifact> {
    let authority = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(str::to_ascii_lowercase);
    authority
        .as_ref()
        .and_then(|authority| web.authorities.get(authority))
        .cloned()
        .or_else(|| web.default.clone())
}

impl Dependency for Http {
    fn call(&self, engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
        let state = self.state.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            if operation == "@web-loader" {
                if state.web.default.is_none() && state.web.authorities.is_empty() {
                    return Err(NativeError::new(
                        "InvalidWebArtifact",
                        "A web loader requires a configured web artifact.",
                    ));
                }
                let input = input.as_record()?;
                let handle = input.get("handle").cloned().ok_or_else(|| {
                    NativeError::new("InvalidInput", "Web loader handle is required.")
                })?;
                let id = state.next_route.fetch_add(1, Ordering::Relaxed);
                {
                    let mut loader = write(&state.web_loader);
                    if loader.is_some() {
                        return Err(NativeError::new(
                            "DuplicateWebLoader",
                            "The HTTP Dependency already has a web loader.",
                        ));
                    }
                    *loader = Some((id, engine, handle));
                }
                let dispose_state = Arc::downgrade(&state);
                let dispose = NativeFunction::new(move |_engine, _arguments| {
                    let state = dispose_state.clone();
                    Box::pin(async move {
                        if let Some(state) = state.upgrade() {
                            let mut loader = write(&state.web_loader);
                            if loader.as_ref().is_some_and(|(active, _, _)| *active == id) {
                                *loader = None;
                            }
                        }
                        Ok(Value::Undefined)
                    })
                });
                return Ok(Value::record(BTreeMap::from([(
                    "@dispose".to_owned(),
                    Value::Function(dispose),
                )])));
            }
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

async fn dispatch(State(state): State<Arc<HttpState>>, request: Request<Body>) -> Response<Body> {
    let origin = request.headers().get(header::ORIGIN).cloned();
    if request.method() == axum::http::Method::OPTIONS {
        return cors(
            &state,
            origin.as_ref(),
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
        return cors(
            &state,
            origin.as_ref(),
            web_response(state.clone(), request).await,
        );
    };
    let request = match request_value(request).await {
        Ok(request) => request,
        Err(error) => return cors(&state, origin.as_ref(), response(400, &error.message)),
    };
    let result = route.engine.invoke(route.handle, vec![request]).await;
    let rendered = match result {
        Ok(value) => response_value(route.engine, value, state.stream_shutdown.subscribe()),
        Err(error) => {
            eprintln!("[kit] HTTP route failed: {error}");
            Ok(response(500, "Internal server error."))
        }
    };
    cors(
        &state,
        origin.as_ref(),
        rendered.unwrap_or_else(|error| {
            eprintln!("[kit] HTTP response failed: {error}");
            response(500, "Internal server error.")
        }),
    )
}

async fn web_response(state: Arc<HttpState>, request: Request<Body>) -> Response<Body> {
    let deadline = Instant::now() + state.request_timeout;
    let Some(web) = select_web_artifact(&state.web, request.headers()) else {
        return response(404, "Not found.");
    };
    if request.method() != axum::http::Method::GET && request.method() != axum::http::Method::HEAD {
        return Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header(header::ALLOW, "GET, HEAD")
            .body(Body::empty())
            .expect("static HTTP response");
    }
    let head = request.method() == axum::http::Method::HEAD;
    let representation = web_representation(request.headers());
    let markdown = representation == WebRepresentation::Markdown;
    let path = request.uri().path();
    if let Some(asset) = web.assets.get(path) {
        let source = web.root.join(&asset.relative);
        if request_matches(&request, &asset.etag) {
            return not_modified(&asset.etag, asset.cache_control);
        }
        return match tokio::fs::read(&source).await {
            Ok(bytes) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, &asset.content_type)
                .header(header::CONTENT_LENGTH, asset.size.to_string())
                .header(header::CACHE_CONTROL, asset.cache_control)
                .header(header::ETAG, &asset.etag)
                .body(if head {
                    Body::empty()
                } else {
                    Body::from(bytes)
                })
                .expect("static asset response"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                response(404, "Not found.")
            }
            Err(error) => {
                eprintln!("[kit] cannot read web asset {}: {error}", source.display());
                response(500, "Internal server error.")
            }
        };
    }
    if path
        .rsplit('/')
        .next()
        .is_some_and(|segment| segment.contains('.'))
    {
        return response(404, "Not found.");
    }
    let (document, etag, markdown_document, markdown_etag, cache_control) = match web
        .document
        .lookup(path, request.uri().query())
    {
        RouteLookup::Found {
            html,
            etag,
            markdown,
            markdown_etag,
            cache_control,
        } => (html, etag, markdown, markdown_etag, cache_control),
        RouteLookup::Dynamic(render) => {
            match resolve_dynamic_web(state.clone(), web.clone(), render, request.headers()).await {
                Ok((rendered, status)) => {
                    return dynamic_web_response(
                        &request,
                        head,
                        representation,
                        rendered,
                        status,
                        deadline,
                    );
                }
                Err(error) => {
                    eprintln!("[kit] dynamic web Route failed: {error}");
                    return response(500, "Internal server error.");
                }
            }
        }
        RouteLookup::Invalid(message) => {
            eprintln!("[kit] invalid web request: {message}");
            return response(400, "Invalid request.");
        }
        RouteLookup::NotFound => return response(404, "Not found."),
    };
    let (body, etag, content_type) = if markdown {
        let (Some(body), Some(etag)) = (markdown_document, markdown_etag) else {
            return not_acceptable();
        };
        (body, etag, "text/markdown; charset=utf-8")
    } else {
        (document, etag, "text/html; charset=utf-8")
    };
    if request_matches(&request, etag) {
        let mut response = not_modified(etag, cache_control);
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("Accept"));
        return response;
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, body.len().to_string())
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::ETAG, etag)
        .header(header::VARY, "Accept")
        .body(if head {
            Body::empty()
        } else {
            Body::from(body.to_owned())
        })
        .expect("web document response")
}

fn web_request_headers(headers: &HeaderMap) -> serde_json::Map<String, serde_json::Value> {
    headers
        .keys()
        .map(|name| {
            let values = headers
                .get_all(name)
                .iter()
                .filter_map(|value| value.to_str().ok())
                .collect::<Vec<_>>()
                .join(", ");
            (name.as_str().to_owned(), serde_json::Value::String(values))
        })
        .collect()
}

async fn render_dynamic_web(
    state: &HttpState,
    web: &WebArtifact,
    render: &document::WebRenderRequest,
    headers: &HeaderMap,
) -> Result<RenderedWebOutcome, String> {
    let (outcome, deferred_tasks, deferred_engine) = if render.loader {
        let loader = read(&state.web_loader)
            .as_ref()
            .map(|(_, engine, handle)| (engine.clone(), handle.clone()));
        let Some((engine, handle)) = loader else {
            return Err("dynamic web Route has no registered loader".to_owned());
        };
        let mut input = serde_json::Map::from_iter([
            (
                "route".to_owned(),
                serde_json::Value::String(render.route.clone()),
            ),
            ("params".to_owned(), render.params.clone()),
            ("search".to_owned(), render.search.clone()),
        ]);
        if !render.shared {
            let url = if web.origin.is_empty() {
                render.location.clone()
            } else {
                format!("{}{}", web.origin.trim_end_matches('/'), render.location)
            };
            input.insert(
                "request".to_owned(),
                serde_json::json!({
                    "url": url,
                    "headers": web_request_headers(headers),
                }),
            );
        }
        let value = engine
            .invoke(
                handle,
                vec![Value::from_json(&serde_json::Value::Object(input))],
            )
            .await
            .map_err(|error| format!("web Route loader failed: {error}"))?;
        let (value, tasks) = prepare_web_loader_outcome(render, value)
            .map_err(|error| format!("web Route loader output failed: {error}"))?;
        (Some(value), tasks, Some(engine))
    } else {
        (None, Vec::new(), None)
    };
    let outcome = web
        .document
        .render_request(render, outcome)
        .map_err(|error| format!("web Route rendering failed: {error}"))?;
    Ok(RenderedWebOutcome {
        outcome,
        deferred_tasks,
        deferred_engine,
    })
}

fn cacheable_web_outcome(rendered: &RenderedWebOutcome) -> Option<CachedWebOutcome> {
    if !rendered.deferred_tasks.is_empty() {
        return None;
    }
    match &rendered.outcome {
        WebLoaderOutcome::Document {
            html,
            etag,
            markdown,
            markdown_etag,
            route_data,
            route_etag,
            cache_control,
            deferred: None,
        } => Some(CachedWebOutcome::Document {
            html: html.clone(),
            etag: etag.clone(),
            markdown: markdown.clone(),
            markdown_etag: markdown_etag.clone(),
            route_data: route_data.clone(),
            route_etag: route_etag.clone(),
            cache_control: cache_control.clone(),
        }),
        WebLoaderOutcome::Document { .. } | WebLoaderOutcome::Redirect(_) => None,
    }
}

fn rendered_from_cache(outcome: CachedWebOutcome) -> RenderedWebOutcome {
    let outcome = match outcome {
        CachedWebOutcome::Document {
            html,
            etag,
            markdown,
            markdown_etag,
            route_data,
            route_etag,
            cache_control,
        } => WebLoaderOutcome::Document {
            html,
            etag,
            markdown,
            markdown_etag,
            route_data,
            route_etag,
            cache_control,
            deferred: None,
        },
    };
    RenderedWebOutcome {
        outcome,
        deferred_tasks: Vec::new(),
        deferred_engine: None,
    }
}

async fn resolve_dynamic_web(
    state: Arc<HttpState>,
    web: WebArtifact,
    render: document::WebRenderRequest,
    headers: &HeaderMap,
) -> Result<(RenderedWebOutcome, &'static str), String> {
    let Some(policy) = render.response_cache else {
        return render_dynamic_web(&state, &web, &render, headers)
            .await
            .map(|outcome| (outcome, "bypass"));
    };
    let key = format!("{}\0{}\0{}", web.identity, render.route, render.location);
    loop {
        let lookup = lock(&state.web_cache).lookup(&key, policy);
        match lookup {
            WebCacheLookup::Fresh(outcome) => {
                return Ok((rendered_from_cache(outcome), "fresh"));
            }
            WebCacheLookup::Stale { outcome, refresh } => {
                if refresh {
                    if let Ok(permit) = state.web_cache_refreshes.clone().try_acquire_owned() {
                        let state = state.clone();
                        let web = web.clone();
                        let render = render.clone();
                        let key = key.clone();
                        tokio::spawn(async move {
                            let _permit = permit;
                            let cached =
                                match render_dynamic_web(&state, &web, &render, &HeaderMap::new())
                                    .await
                                {
                                    Ok(rendered) => cacheable_web_outcome(&rendered),
                                    Err(error) => {
                                        eprintln!(
                                            "[kit] background web cache refresh failed: {error}"
                                        );
                                        None
                                    }
                                };
                            let _ = lock(&state.web_cache).complete(key, cached);
                        });
                    } else {
                        let _ = lock(&state.web_cache).complete(key.clone(), None);
                    }
                }
                return Ok((rendered_from_cache(outcome), "stale"));
            }
            WebCacheLookup::Wait(mut pending) => {
                if pending.changed().await.is_ok() {
                    let completion = pending.borrow().clone();
                    if let WebCacheCompletion::Complete {
                        outcome: Some(outcome),
                        cached,
                    } = completion
                    {
                        return Ok((
                            rendered_from_cache(outcome),
                            if cached { "miss" } else { "bypass" },
                        ));
                    }
                }
            }
            WebCacheLookup::Miss => {
                let rendered = match render_dynamic_web(&state, &web, &render, headers).await {
                    Ok(rendered) => rendered,
                    Err(error) => {
                        let _ = lock(&state.web_cache).complete(key.clone(), None);
                        return Err(error);
                    }
                };
                let cached = cacheable_web_outcome(&rendered);
                let retained = lock(&state.web_cache).complete(key.clone(), cached);
                let status = if retained { "miss" } else { "bypass" };
                return Ok((rendered, status));
            }
        }
    }
}

fn dynamic_web_response(
    request: &Request<Body>,
    head: bool,
    representation: WebRepresentation,
    rendered: RenderedWebOutcome,
    cache_status: &'static str,
    deadline: Instant,
) -> Response<Body> {
    let route_data = representation == WebRepresentation::RouteData;
    let markdown_requested = representation == WebRepresentation::Markdown;
    match rendered.outcome {
        WebLoaderOutcome::Document {
            html,
            etag,
            markdown,
            markdown_etag,
            route_data: route_body,
            route_etag,
            cache_control,
            deferred,
        } => {
            if !rendered.deferred_tasks.is_empty() {
                if markdown_requested {
                    return not_acceptable();
                }
                let Some(deferred) = deferred else {
                    eprintln!("[kit] deferred web Route has no reachable Await boundary");
                    return response(500, "Internal server error.");
                };
                let Some(engine) = rendered.deferred_engine else {
                    unreachable!("deferred tasks require their loader engine")
                };
                return deferred_web_response(
                    head,
                    route_data,
                    html,
                    route_body,
                    cache_control,
                    deferred,
                    rendered.deferred_tasks,
                    engine,
                    cache_status,
                    deadline,
                );
            }
            let (body, etag, content_type) = if route_data {
                (route_body, route_etag, "application/vnd.kit.route+json")
            } else if markdown_requested {
                let (Some(body), Some(etag)) = (markdown, markdown_etag) else {
                    return not_acceptable();
                };
                (body, etag, "text/markdown; charset=utf-8")
            } else {
                (html, etag, "text/html; charset=utf-8")
            };
            if request_matches(request, &etag) {
                let mut response = not_modified(&etag, &cache_control);
                response
                    .headers_mut()
                    .insert("x-kit-cache", HeaderValue::from_static(cache_status));
                return response;
            }
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CONTENT_LENGTH, body.len().to_string())
                .header(header::CACHE_CONTROL, cache_control)
                .header(header::ETAG, etag)
                .header(header::VARY, "Accept")
                .header("x-kit-cache", cache_status)
                .body(if head {
                    Body::empty()
                } else {
                    Body::from(body)
                })
                .expect("dynamic web document response")
        }
        WebLoaderOutcome::Redirect(location) => {
            if route_data {
                let body = serde_json::json!({
                    "version": 1,
                    "redirect": location,
                })
                .to_string();
                let etag = strong_etag(body.as_bytes());
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/vnd.kit.route+json")
                    .header(header::CONTENT_LENGTH, body.len().to_string())
                    .header(header::CACHE_CONTROL, "no-store")
                    .header(header::ETAG, etag)
                    .header(header::VARY, "Accept")
                    .header("x-kit-cache", cache_status)
                    .body(if head {
                        Body::empty()
                    } else {
                        Body::from(body)
                    })
                    .expect("web Route data redirect");
            }
            Response::builder()
                .status(StatusCode::FOUND)
                .header(header::LOCATION, location)
                .header(header::CACHE_CONTROL, "no-store")
                .header("x-kit-cache", cache_status)
                .body(Body::empty())
                .expect("web Route redirect")
        }
    }
}

fn prepare_web_loader_outcome(
    render: &document::WebRenderRequest,
    value: Value,
) -> Result<(serde_json::Value, Vec<WebDeferredTask>), String> {
    let outcome = value
        .as_record()
        .map_err(|error| format!("web Route loader outcome must be a record: {error}"))?;
    let has_data = outcome.contains_key("data");
    let has_redirect = outcome.contains_key("redirect");
    if has_data == has_redirect {
        return Err("web Route loader must return exactly one of data or redirect".to_owned());
    }
    if outcome
        .keys()
        .any(|name| !matches!(name.as_str(), "data" | "metadata" | "redirect"))
    {
        return Err("web Route loader outcome has unsupported fields".to_owned());
    }
    if has_redirect || render.deferred.is_empty() {
        return value
            .to_json()
            .map(|value| (value, Vec::new()))
            .map_err(|error| error.to_string());
    }

    let data = outcome
        .get("data")
        .ok_or_else(|| "web Route loader data is required".to_owned())?
        .as_record()
        .map_err(|error| format!("deferred web Route data must be a record: {error}"))?;
    let mut json_data = serde_json::Map::new();
    let mut tasks = Vec::with_capacity(render.deferred.len());
    for (name, item) in data.iter() {
        let Some(index) = render.deferred.iter().position(|field| field == name) else {
            json_data.insert(
                name.clone(),
                item.to_json().map_err(|error| error.to_string())?,
            );
            continue;
        };
        if !matches!(item, Value::Function(_)) {
            return Err(format!(
                "deferred web Route data {name:?} must be a function"
            ));
        }
        let boundary = format!("d{index}");
        json_data.insert(
            name.clone(),
            serde_json::json!({
                "version": 1,
                "kind": "deferred",
                "boundary": boundary,
                "field": name,
                "state": { "status": "pending" },
            }),
        );
        tasks.push(WebDeferredTask {
            boundary,
            function: item.clone(),
        });
    }
    for field in &render.deferred {
        if !data.contains_key(field) {
            return Err(format!(
                "deferred web Route data {field:?} must be a function"
            ));
        }
    }
    tasks.sort_by_key(|task| {
        task.boundary
            .strip_prefix('d')
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(usize::MAX)
    });
    let mut json_outcome = serde_json::Map::new();
    json_outcome.insert("data".to_owned(), serde_json::Value::Object(json_data));
    if let Some(metadata) = outcome.get("metadata") {
        json_outcome.insert(
            "metadata".to_owned(),
            metadata.to_json().map_err(|error| error.to_string())?,
        );
    }
    Ok((serde_json::Value::Object(json_outcome), tasks))
}

fn deferred_web_response(
    head: bool,
    route_data: bool,
    html: String,
    route_body: String,
    cache_control: String,
    mut deferred: WebDeferredDocument,
    tasks: Vec<WebDeferredTask>,
    engine: Engine,
    cache_status: &'static str,
    deadline: Instant,
) -> Response<Body> {
    if deferred.boundaries().is_empty() {
        eprintln!("[kit] deferred web Route data has no reachable Await boundary");
        return response(500, "Internal server error.");
    }
    let (prefix, tail, content_type) = if route_data {
        (
            format!("{route_body}\n"),
            String::new(),
            "application/vnd.kit.route+json; framing=ndjson",
        )
    } else {
        let Some(boundary) = html.rfind("</body>") else {
            eprintln!("[kit] streamed web document has no body terminator");
            return response(500, "Internal server error.");
        };
        (
            html[..boundary].to_owned(),
            html[boundary..].to_owned(),
            "text/html; charset=utf-8",
        )
    };
    if head {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, cache_control)
            .header(header::VARY, "Accept")
            .header("x-kit-cache", cache_status)
            .body(Body::empty())
            .expect("deferred web HEAD response");
    }

    let expected = tasks
        .iter()
        .map(|task| task.boundary.clone())
        .collect::<std::collections::HashSet<_>>();
    let mut work = JoinSet::new();
    for task in tasks {
        let engine = engine.clone();
        work.spawn(async move {
            let settlement = match engine.invoke(task.function, Vec::new()).await {
                Ok(value) => match value.to_json() {
                    Ok(value) => WebDeferredSettlement::Resolved(value),
                    Err(error) => WebDeferredSettlement::Invalid(error.to_string()),
                },
                Err(_) => WebDeferredSettlement::Rejected,
            };
            (task.boundary, settlement)
        });
    }

    let body = Body::from_stream(async_stream::stream! {
        yield Ok::<Bytes, std::io::Error>(Bytes::from(prefix));
        let mut settlements = BTreeMap::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let result = match tokio::time::timeout(remaining, work.join_next()).await {
                Ok(Some(result)) => result,
                Ok(None) => break,
                Err(_) => {
                    yield Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "deferred web response exceeded its request deadline",
                    ));
                    return;
                }
            };
            let (identity, settlement) = match result {
                Ok(result) => result,
                Err(error) => {
                    yield Err(std::io::Error::other(format!("deferred web Route task failed: {error}")));
                    return;
                }
            };
            settlements.insert(identity, settlement);
            loop {
                let mut progress = false;
                for identity in deferred.boundaries() {
                    if deferred.emitted(&identity) {
                        continue;
                    }
                    let Some(settlement) = settlements.remove(&identity) else {
                        continue;
                    };
                    let result = match settlement {
                        WebDeferredSettlement::Resolved(value) => Ok(value),
                        WebDeferredSettlement::Rejected => Err(()),
                        WebDeferredSettlement::Invalid(error) => {
                            yield Err(std::io::Error::other(format!(
                                "deferred web Route data is not serializable: {error}"
                            )));
                            return;
                        }
                    };
                    let frame = match deferred.render_frame(&identity, result) {
                        Ok(frame) => frame,
                        Err(error) => {
                            yield Err(std::io::Error::other(error));
                            return;
                        }
                    };
                    let chunk = if route_data {
                        format!("{}\n", frame.record)
                    } else {
                        frame.html
                    };
                    yield Ok(Bytes::from(chunk));
                    progress = true;
                }
                if !progress {
                    break;
                }
            }
        }
        if expected.iter().any(|identity| !deferred.emitted(identity)) {
            yield Err(std::io::Error::other(
                "deferred web Route data has no reachable Await boundary"
            ));
            return;
        }
        if !tail.is_empty() {
            yield Ok(Bytes::from(tail));
        }
    });
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::VARY, "Accept")
        .header("x-kit-cache", cache_status)
        .body(body)
        .expect("deferred web response")
}

fn load_assets(root: &Path) -> Result<BTreeMap<String, WebAsset>, String> {
    let source = std::fs::read_to_string(root.join("assets.ir.json"))
        .map_err(|error| format!("read web assets: {error}"))?;
    let manifest: WebAssetManifest =
        serde_json::from_str(&source).map_err(|error| format!("decode web assets: {error}"))?;
    if manifest.version != 1 {
        return Err("unsupported web asset manifest version".to_owned());
    }
    let canonical_root =
        std::fs::canonicalize(root).map_err(|error| format!("resolve web root: {error}"))?;
    let mut assets = BTreeMap::new();
    for entry in manifest.assets {
        let relative = manifest_asset_path(&entry.path)?;
        let source = root.join(&relative);
        let canonical = std::fs::canonicalize(&source)
            .map_err(|error| format!("resolve web asset {}: {error}", entry.path))?;
        if !canonical.starts_with(&canonical_root) {
            return Err(format!("web asset {} escapes the web root", entry.path));
        }
        let bytes = std::fs::read(&canonical)
            .map_err(|error| format!("read web asset {}: {error}", entry.path))?;
        let size = u64::try_from(bytes.len())
            .map_err(|_| format!("web asset {} is too large", entry.path))?;
        if size != entry.size || strong_etag(&bytes) != entry.etag {
            return Err(format!(
                "web asset {} failed its integrity check",
                entry.path
            ));
        }
        let asset = WebAsset {
            relative,
            content_type: mime_guess::from_path(&canonical)
                .first_or_octet_stream()
                .to_string(),
            cache_control: if entry.immutable {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            },
            etag: entry.etag,
            size,
        };
        if assets.insert(entry.path.clone(), asset).is_some() {
            return Err(format!("duplicate web asset {}", entry.path));
        }
    }
    Ok(assets)
}

fn manifest_asset_path(value: &str) -> Result<PathBuf, String> {
    let relative = value
        .strip_prefix('/')
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("invalid web asset path {value:?}"))?;
    let path = Path::new(relative);
    if !path
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(format!("invalid web asset path {value:?}"));
    }
    if matches!(
        relative,
        "assets.ir.json" | "document.ir.json" | "index.html" | "routes.ir.json"
    ) {
        return Err(format!("web asset path {value:?} is reserved"));
    }
    Ok(path.to_owned())
}

fn web_representation(headers: &HeaderMap) -> WebRepresentation {
    let Some(accept) = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
    else {
        return WebRepresentation::Document;
    };
    let mut route_data = false;
    let mut markdown = false;
    for range in accept.split(',') {
        let mut parts = range.split(';').map(str::trim);
        let media = parts.next().unwrap_or_default().to_ascii_lowercase();
        let quality = parts
            .find_map(|part| part.strip_prefix("q="))
            .and_then(|value| value.parse::<f32>().ok())
            .unwrap_or(1.0);
        if quality <= 0.0 {
            continue;
        }
        route_data |= media == "application/vnd.kit.route+json";
        markdown |= media == "text/markdown";
    }
    if route_data {
        WebRepresentation::RouteData
    } else if markdown {
        WebRepresentation::Markdown
    } else {
        WebRepresentation::Document
    }
}

fn request_matches(request: &Request<Body>, etag: &str) -> bool {
    request
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.split(',').any(|candidate| {
                let candidate = candidate.trim();
                candidate == "*" || candidate == etag || candidate.strip_prefix("W/") == Some(etag)
            })
        })
}

fn not_modified(etag: &str, cache_control: &str) -> Response<Body> {
    Response::builder()
        .status(StatusCode::NOT_MODIFIED)
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::ETAG, etag)
        .body(Body::empty())
        .expect("not modified response")
}

fn not_acceptable() -> Response<Body> {
    Response::builder()
        .status(StatusCode::NOT_ACCEPTABLE)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::VARY, "Accept")
        .body(Body::from(
            "This Route does not expose a public Markdown representation.\n",
        ))
        .expect("not acceptable response")
}

fn strong_etag(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(2 + digest.len() * 2);
    output.push('"');
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("write to String");
    }
    output.push('"');
    output
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
                    Ok(Some(Value::String(value))) => yield Ok::<Bytes, std::io::Error>(Bytes::from(value)),
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

fn cors(
    state: &HttpState,
    origin: Option<&HeaderValue>,
    mut response: Response<Body>,
) -> Response<Body> {
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if !origin
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| state.web_origins.contains(value.trim_end_matches('/')))
    {
        return response;
    }
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.unwrap().clone());
    headers.append(header::VARY, HeaderValue::from_static("Origin"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, x-kit-command, x-kit-entity"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PATCH, DELETE, OPTIONS"),
    );
    response
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

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(body: &str) -> CachedWebOutcome {
        CachedWebOutcome::Document {
            html: body.to_owned(),
            etag: String::new(),
            markdown: None,
            markdown_etag: None,
            route_data: String::new(),
            route_etag: String::new(),
            cache_control: String::new(),
        }
    }

    fn policy() -> document::WebResponseCachePolicy {
        document::WebResponseCachePolicy {
            max_age: Duration::from_secs(10),
            stale_while_revalidate: Duration::from_secs(20),
        }
    }

    #[test]
    fn web_cache_bounds_entries_and_bytes_by_lru() {
        let mut cache = WebResponseCache::new(10, 4);
        assert!(matches!(cache.lookup("a", policy()), WebCacheLookup::Miss));
        assert!(cache.complete("a".to_owned(), Some(outcome("aa"))));
        assert!(matches!(cache.lookup("b", policy()), WebCacheLookup::Miss));
        assert!(cache.complete("b".to_owned(), Some(outcome("bbb"))));
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.bytes, 3);
        assert!(cache.entries.contains_key("b"));

        assert!(matches!(cache.lookup("a", policy()), WebCacheLookup::Miss));
        assert!(cache.complete("a".to_owned(), Some(outcome("a"))));
        assert_eq!(cache.entries.len(), 2);
        assert_eq!(cache.bytes, 4);
    }

    #[tokio::test]
    async fn web_cache_coalesces_oversized_results_without_retaining_them() {
        let mut cache = WebResponseCache::new(2, 2);
        assert!(matches!(cache.lookup("a", policy()), WebCacheLookup::Miss));
        let WebCacheLookup::Wait(mut waiting) = cache.lookup("a", policy()) else {
            panic!("concurrent lookup should wait");
        };
        assert!(!cache.complete("a".to_owned(), Some(outcome("large"))));
        waiting.changed().await.expect("cache completion");
        match waiting.borrow().clone() {
            WebCacheCompletion::Complete {
                outcome: Some(value),
                cached: false,
            } => assert_eq!(value.bytes(), 5),
            _ => panic!("waiter should receive the unretained result"),
        }
        assert!(cache.entries.is_empty());
        assert_eq!(cache.bytes, 0);
    }

    #[test]
    fn failed_stale_refresh_preserves_the_previous_entry() {
        let mut cache = WebResponseCache::new(1, 10);
        assert!(matches!(cache.lookup("a", policy()), WebCacheLookup::Miss));
        assert!(cache.complete("a".to_owned(), Some(outcome("old"))));
        cache.entries.get_mut("a").expect("cached entry").stored_at =
            Instant::now() - Duration::from_secs(10);
        assert!(matches!(
            cache.lookup("a", policy()),
            WebCacheLookup::Stale { refresh: true, .. }
        ));
        assert!(!cache.complete("a".to_owned(), None));
        assert!(cache.entries.contains_key("a"));
        assert!(matches!(
            cache.lookup("a", policy()),
            WebCacheLookup::Stale { refresh: true, .. }
        ));
    }
}
