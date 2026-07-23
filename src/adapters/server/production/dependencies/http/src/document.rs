use std::{
    collections::{BTreeMap, HashSet},
    fmt::Write,
    path::Path,
    time::Duration,
};

use percent_encoding::percent_decode_str;
use serde::Deserialize;
use serde_json::{Map, Value, json};

pub struct WebDocument {
    fallback: DocumentContent,
    routes: Vec<RouteDocument>,
    components: BTreeMap<String, Value>,
}

struct DocumentContent {
    html: String,
    etag: String,
    markdown: Option<String>,
    markdown_etag: Option<String>,
}

struct RouteDocument {
    route: RouteDefinition,
    score: usize,
    content: RouteContent,
    cache_control: String,
    shared: bool,
    response_cache: Option<WebResponseCachePolicy>,
}

enum RouteContent {
    Static(DocumentContent),
    Dynamic {
        document: Value,
        loader: bool,
        view: Value,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RouteManifest {
    version: u64,
    components: Vec<Value>,
    routes: Vec<RouteArtifact>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RouteArtifact {
    route: RouteDefinition,
    document: Value,
    request: RouteRequest,
}

#[derive(Deserialize)]
#[serde(untagged)]
#[allow(dead_code)]
enum RouteRequest {
    Disabled(bool),
    Dynamic(DynamicRouteRequest),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DynamicRouteRequest {
    loader: bool,
    view: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct RouteDefinition {
    feature: String,
    name: String,
    path: String,
    document: String,
    cache: RouteCache,
    metadata: Value,
    params: Vec<RouteParameter>,
    search: Vec<RouteParameter>,
    #[serde(default)]
    deferred: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", untagged)]
enum RouteCache {
    Disabled(bool),
    Policy(RouteCachePolicy),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RouteCachePolicy {
    scope: String,
    max_age: Option<String>,
    stale_while_revalidate: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RouteParameter {
    name: String,
    kind: String,
    optional: bool,
    #[serde(default)]
    repeated: bool,
    values: Option<Vec<Value>>,
    #[serde(default)]
    integer: bool,
    minimum: Option<f64>,
    maximum: Option<f64>,
    minimum_length: Option<usize>,
    maximum_length: Option<usize>,
    format: Option<String>,
    default: Option<Value>,
}

pub enum RouteLookup<'a> {
    Found {
        html: &'a str,
        etag: &'a str,
        markdown: Option<&'a str>,
        markdown_etag: Option<&'a str>,
        cache_control: &'a str,
    },
    Dynamic(WebRenderRequest),
    Invalid(String),
    NotFound,
}

#[derive(Clone)]
pub struct WebRenderRequest {
    pub route: String,
    pub location: String,
    pub params: Value,
    pub search: Value,
    pub loader: bool,
    pub deferred: Vec<String>,
    pub shared: bool,
    pub response_cache: Option<WebResponseCachePolicy>,
    pub markdown: bool,
    document: Value,
    view: Value,
    cache_control: String,
}

#[derive(Clone, Copy)]
pub struct WebResponseCachePolicy {
    pub max_age: Duration,
    pub stale_while_revalidate: Duration,
}

pub enum WebLoaderOutcome {
    Document {
        html: String,
        etag: String,
        markdown: Option<String>,
        markdown_etag: Option<String>,
        route_data: String,
        route_etag: String,
        cache_control: String,
        deferred: Option<WebDeferredDocument>,
    },
    Redirect(String),
}

pub struct WebDeferredDocument {
    boundaries: DeferredBoundaries,
    components: BTreeMap<String, Value>,
    emitted: HashSet<String>,
    fields: Vec<String>,
}

pub struct WebDeferredFrameOutput {
    pub html: String,
    pub record: String,
}

struct RouteValues {
    params: Map<String, Value>,
    search: Map<String, Value>,
}

enum LoaderResolution {
    Document {
        data: Option<Value>,
        metadata: Map<String, Value>,
    },
    Redirect(Value),
}

#[derive(PartialEq)]
enum Scalar {
    Boolean(bool),
    Number(f64),
    String(String),
}

impl WebDocument {
    pub fn load(root: &Path) -> Result<Self, String> {
        let source = std::fs::read_to_string(root.join("document.ir.json"))
            .map_err(|error| format!("read web document: {error}"))?;
        let document: Value = serde_json::from_str(&source)
            .map_err(|error| format!("decode web document: {error}"))?;
        let fallback = document_content(&document)?;
        let routes_path = root.join("routes.ir.json");
        let (mut routes, components) = if routes_path.exists() {
            let source = std::fs::read_to_string(&routes_path)
                .map_err(|error| format!("read web routes: {error}"))?;
            let manifest: RouteManifest = serde_json::from_str(&source)
                .map_err(|error| format!("decode web routes: {error}"))?;
            if manifest.version != 3 {
                return Err("unsupported web route document version".to_owned());
            }
            let components = component_map(manifest.components)?;
            let routes = manifest
                .routes
                .into_iter()
                .map(|entry| {
                    validate_route(&entry.route)?;
                    let cache_control = cache_control(&entry.route.cache)?;
                    let shared = matches!(
                        &entry.route.cache,
                        RouteCache::Policy(policy) if policy.scope == "public"
                    );
                    let response_cache = response_cache_policy(&entry.route.cache)?;
                    let content = match entry.request {
                        RouteRequest::Disabled(false) => {
                            RouteContent::Static(document_content(&entry.document)?)
                        }
                        RouteRequest::Disabled(true) => {
                            return Err("web Route request artifact cannot be true".to_owned());
                        }
                        RouteRequest::Dynamic(DynamicRouteRequest { loader, view }) => {
                            validate_render_node(&view)?;
                            RouteContent::Dynamic {
                                document: entry.document,
                                loader,
                                view,
                            }
                        }
                    };
                    Ok(RouteDocument {
                        score: route_score(&entry.route.path),
                        route: entry.route,
                        content,
                        cache_control,
                        shared,
                        response_cache,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            validate_routes(&routes)?;
            (routes, components)
        } else {
            (Vec::new(), BTreeMap::new())
        };
        routes.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then(left.route.path.cmp(&right.route.path))
        });
        Ok(Self {
            fallback,
            routes,
            components,
        })
    }

    pub fn lookup(&self, path: &str, query: Option<&str>) -> RouteLookup<'_> {
        if self.routes.is_empty() {
            return RouteLookup::Found {
                html: &self.fallback.html,
                etag: &self.fallback.etag,
                markdown: self.fallback.markdown.as_deref(),
                markdown_etag: self.fallback.markdown_etag.as_deref(),
                cache_control: "no-store",
            };
        }
        for route in &self.routes {
            match route_match(&route.route, path, query) {
                Ok(Some(values)) => match &route.content {
                    RouteContent::Static(content) => {
                        return RouteLookup::Found {
                            html: &content.html,
                            etag: &content.etag,
                            markdown: content.markdown.as_deref(),
                            markdown_etag: content.markdown_etag.as_deref(),
                            cache_control: &route.cache_control,
                        };
                    }
                    RouteContent::Dynamic {
                        document,
                        loader,
                        view,
                    } => {
                        return RouteLookup::Dynamic(WebRenderRequest {
                            route: route_identity(&route.route),
                            location: match query {
                                Some(query) if !query.is_empty() => format!("{path}?{query}"),
                                _ => path.to_owned(),
                            },
                            params: Value::Object(values.params),
                            search: Value::Object(values.search),
                            loader: *loader,
                            deferred: route.route.deferred.clone(),
                            shared: route.shared,
                            response_cache: route.response_cache,
                            markdown: route.route.document == "content"
                                && public_markdown_metadata(&route.route.metadata)
                                && (!*loader || route.shared),
                            document: document.clone(),
                            view: view.clone(),
                            cache_control: route.cache_control.clone(),
                        });
                    }
                },
                Ok(None) => {}
                Err(error) => return RouteLookup::Invalid(error),
            }
        }
        RouteLookup::NotFound
    }

    pub fn render_request(
        &self,
        request: &WebRenderRequest,
        outcome: Option<Value>,
    ) -> Result<WebLoaderOutcome, String> {
        let resolution = if request.loader {
            parse_loader_outcome(
                outcome.ok_or_else(|| "web Route loader returned no outcome".to_owned())?,
            )?
        } else {
            if outcome.is_some() {
                return Err("a loader-free web Route received loader output".to_owned());
            }
            LoaderResolution::Document {
                data: None,
                metadata: Map::new(),
            }
        };
        let LoaderResolution::Document { data, metadata } = resolution else {
            let LoaderResolution::Redirect(destination) = resolution else {
                unreachable!("exhaustive loader resolution")
            };
            return Ok(WebLoaderOutcome::Redirect(
                self.resolve_destination(&request.route, &destination)?,
            ));
        };
        let mut document = request.document.clone();
        let merged = merge_dynamic_metadata(&mut document, metadata)?;
        let scope = RenderScope {
            data: data
                .clone()
                .map(RuntimeValue::Json)
                .unwrap_or(RuntimeValue::Undefined),
            params: request.params.clone(),
            search: request.search.clone(),
            props: BTreeMap::new(),
            state: Value::Object(Map::new()),
            locals: BTreeMap::new(),
        };
        let mut boundaries = DeferredBoundaries::default();
        let pending = evaluate_render_node(
            &request.view,
            &scope,
            &self.components,
            &[],
            &mut boundaries,
        )?;
        validate_deferred_boundaries(&boundaries, &request.deferred)?;
        let mut sequence = RenderSequence::default();
        let root = pending
            .iter()
            .map(|node| lower_pending_node(node, &mut sequence))
            .collect::<Result<Vec<_>, _>>()?;
        let object = document
            .as_object_mut()
            .ok_or_else(|| "web document must be an object".to_owned())?;
        object.insert("rendering".to_owned(), Value::String("hydrate".to_owned()));
        object.insert("root".to_owned(), Value::Array(root));
        let hydration = json!({
            "version": 1,
            "route": route_identity_parts(&request.route),
            "location": request.location,
            "params": request.params,
            "search": request.search,
            "loader": match data {
                Some(data) => json!({ "data": data }),
                None => Value::Bool(false),
            },
            "metadata": merged,
        });
        object.insert("hydration".to_owned(), hydration.clone());
        let html = render(&document)?;
        let markdown = request
            .markdown
            .then(|| render_markdown(&document))
            .transpose()?;
        let markdown_etag = markdown
            .as_ref()
            .map(|body| crate::strong_etag(body.as_bytes()));
        let route_data = serde_json::to_string(&hydration)
            .map_err(|error| format!("encode web Route state: {error}"))?;
        Ok(WebLoaderOutcome::Document {
            etag: crate::strong_etag(html.as_bytes()),
            markdown,
            markdown_etag,
            route_etag: crate::strong_etag(route_data.as_bytes()),
            html,
            route_data,
            cache_control: request.cache_control.clone(),
            deferred: (!request.deferred.is_empty()).then(|| WebDeferredDocument {
                boundaries,
                components: self.components.clone(),
                emitted: HashSet::new(),
                fields: request.deferred.clone(),
            }),
        })
    }

    fn resolve_destination(&self, source: &str, destination: &Value) -> Result<String, String> {
        let destination = destination
            .as_object()
            .ok_or_else(|| "web Route redirect destination must be an object".to_owned())?;
        let to = destination
            .get("to")
            .and_then(Value::as_str)
            .ok_or_else(|| "web Route redirect destination requires to".to_owned())?;
        let source_feature = source
            .rsplit_once('.')
            .map(|(feature, _)| feature)
            .unwrap_or("");
        let local = (!source_feature.is_empty()).then(|| format!("{source_feature}.{to}"));
        let suffix = format!(".{to}");
        let mut matches = self.routes.iter().filter(|route| {
            let identity = route_identity(&route.route);
            identity == to
                || local
                    .as_ref()
                    .is_some_and(|candidate| identity == *candidate)
                || identity.ends_with(&suffix)
        });
        let route = matches
            .next()
            .ok_or_else(|| format!("unknown redirect web Route {to:?}"))?;
        if matches.next().is_some() {
            return Err(format!("ambiguous redirect web Route {to:?}"));
        }
        format_route_destination(&route.route, destination)
    }
}

impl WebDeferredDocument {
    pub fn boundaries(&self) -> Vec<String> {
        self.boundaries.order.clone()
    }

    pub fn emitted(&self, boundary: &str) -> bool {
        self.emitted.contains(boundary)
    }

    pub fn render_frame(
        &mut self,
        identity: &str,
        result: Result<Value, ()>,
    ) -> Result<WebDeferredFrameOutput, String> {
        if self.emitted.contains(identity) {
            return Err(format!(
                "web deferred boundary {identity:?} was already emitted"
            ));
        }
        let boundary = self
            .boundaries
            .values
            .get(identity)
            .cloned()
            .ok_or_else(|| format!("unknown web deferred boundary {identity:?}"))?;
        let (state, node, item_name, item) = match result {
            Ok(value) => (
                json!({ "status": "resolved", "value": value }),
                boundary.resolved,
                boundary.resolved_item,
                value,
            ),
            Err(()) => {
                let error = json!({ "message": "Deferred data failed." });
                (
                    json!({ "status": "rejected", "error": error }),
                    boundary.rejected,
                    boundary.rejected_item,
                    error,
                )
            }
        };
        let mut scope = boundary.scope;
        scope.locals.insert(item_name, RuntimeValue::Json(item));
        let pending = evaluate_render_node(
            &node,
            &scope,
            &self.components,
            &boundary.stack,
            &mut self.boundaries,
        )?;
        validate_deferred_boundaries(&self.boundaries, &self.fields)?;
        let mut sequence = RenderSequence {
            prefix: format!("{identity}:"),
            ..RenderSequence::default()
        };
        let root = pending
            .iter()
            .map(|node| lower_pending_node(node, &mut sequence))
            .collect::<Result<Vec<_>, _>>()?;
        let frame = json!({
            "version": 1,
            "boundary": identity,
            "field": boundary.field,
            "state": state,
            "root": root,
        });
        let record = serde_json::to_string(&frame)
            .map_err(|error| format!("encode deferred web Route frame: {error}"))?;
        let html = render_deferred_frame(&frame)?;
        self.emitted.insert(identity.to_owned());
        Ok(WebDeferredFrameOutput { html, record })
    }
}

fn validate_deferred_boundaries(
    boundaries: &DeferredBoundaries,
    fields: &[String],
) -> Result<(), String> {
    for (identity, boundary) in &boundaries.values {
        let index = identity
            .strip_prefix('d')
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| format!("invalid deferred web Route boundary {identity:?}"))?;
        if fields.get(index) != Some(&boundary.field) {
            return Err(format!(
                "deferred web Route boundary {identity:?} does not match field {:?}",
                boundary.field
            ));
        }
    }
    Ok(())
}

fn document_content(document: &Value) -> Result<DocumentContent, String> {
    let html = render(document)?;
    let etag = crate::strong_etag(html.as_bytes());
    let markdown = public_markdown_document(document)
        .then(|| render_markdown(document))
        .transpose()?;
    let markdown_etag = markdown
        .as_ref()
        .map(|body| crate::strong_etag(body.as_bytes()));
    Ok(DocumentContent {
        html,
        etag,
        markdown,
        markdown_etag,
    })
}

fn route_identity(route: &RouteDefinition) -> String {
    if route.feature.is_empty() {
        route.name.clone()
    } else {
        format!("{}.{}", route.feature, route.name)
    }
}

fn route_identity_parts(identity: &str) -> Value {
    match identity.rsplit_once('.') {
        Some((feature, name)) => json!({ "feature": feature, "name": name }),
        None => json!({ "feature": "", "name": identity }),
    }
}

fn component_map(values: Vec<Value>) -> Result<BTreeMap<String, Value>, String> {
    let mut components = BTreeMap::new();
    for component in values {
        validate_allowed_keys(
            &component,
            &["elements", "feature", "name", "span", "state", "view"],
            &["diagnostic"],
            "compiled web Component",
        )?;
        let feature = string(&component, "feature")?;
        let name = string(&component, "name")?;
        let elements = component
            .get("elements")
            .and_then(Value::as_object)
            .ok_or_else(|| "compiled web Component elements must be an object".to_owned())?;
        if elements.iter().any(|(name, tag)| {
            !valid_identifier(name) || !tag.as_str().is_some_and(|tag| valid_name(tag, false))
        }) {
            return Err("compiled web Component elements are invalid".to_owned());
        }
        let state = component
            .get("state")
            .and_then(Value::as_object)
            .ok_or_else(|| "compiled web Component state must be an object".to_owned())?;
        if state.values().any(|value| {
            !matches!(
                value,
                Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
            )
        }) {
            return Err("compiled web Component state must contain scalar values".to_owned());
        }
        let view = component
            .get("view")
            .ok_or_else(|| "compiled web Component view is required".to_owned())?;
        if view != &Value::Bool(false) {
            validate_render_node(view)?;
        }
        let identity = if feature.is_empty() {
            name.to_owned()
        } else {
            format!("{feature}.{name}")
        };
        if components.insert(identity.clone(), component).is_some() {
            return Err(format!("duplicate compiled web Component {identity:?}"));
        }
    }
    Ok(components)
}

fn validate_render_node(value: &Value) -> Result<(), String> {
    match string(value, "kind")? {
        "none" => validate_keys(value, &["kind"], "web render none"),
        "text" => {
            validate_keys(value, &["kind", "value"], "web render text")?;
            validate_render_value(required(value, "value")?)
        }
        "fragment" => {
            validate_keys(value, &["children", "kind"], "web render fragment")?;
            for child in array(value, "children")? {
                validate_render_node(child)?;
            }
            Ok(())
        }
        "conditional" => {
            validate_keys(
                value,
                &["alternate", "condition", "consequent", "kind"],
                "web render conditional",
            )?;
            validate_render_value(required(value, "condition")?)?;
            validate_render_node(required(value, "consequent")?)?;
            validate_render_node(required(value, "alternate")?)
        }
        "element" => {
            validate_keys(
                value,
                &["attributes", "children", "element", "kind", "tag"],
                "web render element",
            )?;
            let tag = string(value, "tag")?;
            if !valid_name(tag, false) {
                return Err(format!("invalid compiled web element {tag:?}"));
            }
            string(value, "element")?;
            for attribute in array(value, "attributes")? {
                validate_keys(attribute, &["name", "value"], "web render attribute")?;
                let name = string(attribute, "name")?;
                if !valid_name(name, true) || name == "data-poggers-h" {
                    return Err(format!("invalid compiled web attribute {name:?}"));
                }
                validate_render_value(required(attribute, "value")?)?;
            }
            for child in array(value, "children")? {
                validate_render_node(child)?;
            }
            Ok(())
        }
        "component" => {
            validate_keys(value, &["kind", "props", "target"], "web render Component")?;
            string(value, "target")?;
            for property in array(value, "props")? {
                validate_keys(property, &["name", "node", "value"], "web render prop")?;
                string(property, "name")?;
                let node = property
                    .get("node")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| "web render prop node must be boolean".to_owned())?;
                if node {
                    validate_render_node(required(property, "value")?)?;
                } else {
                    validate_render_value(required(property, "value")?)?;
                }
            }
            Ok(())
        }
        "each" => {
            validate_keys(
                value,
                &["body", "item", "kind", "values"],
                "web render each",
            )?;
            string(value, "item")?;
            validate_render_value(required(value, "values")?)?;
            validate_render_node(required(value, "body")?)
        }
        "await" => {
            validate_keys(
                value,
                &["error", "item", "kind", "pending", "resolved", "value"],
                "web render Await",
            )?;
            validate_render_value(required(value, "value")?)?;
            if !valid_identifier(string(value, "item")?) {
                return Err("web render Await item is invalid".to_owned());
            }
            validate_render_node(required(value, "pending")?)?;
            validate_render_node(required(value, "resolved")?)?;
            let error = required(value, "error")?;
            validate_keys(error, &["body", "item"], "web render Await error")?;
            if !valid_identifier(string(error, "item")?) {
                return Err("web render Await error item is invalid".to_owned());
            }
            validate_render_node(required(error, "body")?)
        }
        kind => Err(format!("unsupported web render node {kind:?}")),
    }
}

fn validate_render_value(value: &Value) -> Result<(), String> {
    match string(value, "kind")? {
        "literal" => {
            validate_keys(value, &["kind", "value"], "web render literal")?;
            if matches!(
                required(value, "value")?,
                Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
            ) {
                Ok(())
            } else {
                Err("web render literal must be scalar".to_owned())
            }
        }
        "path" => {
            validate_keys(value, &["kind", "path", "root"], "web render path")?;
            if !matches!(
                string(value, "root")?,
                "data" | "params" | "props" | "search" | "state"
            ) {
                return Err("unsupported web render path root".to_owned());
            }
            string_array(value, "path").map(|_| ())
        }
        "local" => {
            validate_keys(value, &["kind", "name", "path"], "web render local")?;
            string(value, "name")?;
            string_array(value, "path").map(|_| ())
        }
        "array" => {
            validate_keys(value, &["kind", "values"], "web render array")?;
            for item in array(value, "values")? {
                validate_render_value(item)?;
            }
            Ok(())
        }
        "record" => {
            validate_keys(value, &["fields", "kind"], "web render record")?;
            for field in array(value, "fields")? {
                validate_keys(field, &["name", "value"], "web render field")?;
                string(field, "name")?;
                validate_render_value(required(field, "value")?)?;
            }
            Ok(())
        }
        "binary" => {
            validate_keys(
                value,
                &["kind", "left", "operator", "right"],
                "web render binary",
            )?;
            if !matches!(
                string(value, "operator")?,
                "+" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "&&" | "||" | "??"
            ) {
                return Err("unsupported web render binary operator".to_owned());
            }
            validate_render_value(required(value, "left")?)?;
            validate_render_value(required(value, "right")?)
        }
        "unary" => {
            validate_keys(value, &["kind", "operator", "value"], "web render unary")?;
            if !matches!(string(value, "operator")?, "!" | "-") {
                return Err("unsupported web render unary operator".to_owned());
            }
            validate_render_value(required(value, "value")?)
        }
        "conditional" => {
            validate_keys(
                value,
                &["alternate", "condition", "consequent", "kind"],
                "web render value conditional",
            )?;
            validate_render_value(required(value, "condition")?)?;
            validate_render_value(required(value, "consequent")?)?;
            validate_render_value(required(value, "alternate")?)
        }
        kind => Err(format!("unsupported web render value {kind:?}")),
    }
}

fn parse_loader_outcome(value: Value) -> Result<LoaderResolution, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "web Route loader outcome must be an object".to_owned())?;
    let has_data = object.contains_key("data");
    let has_redirect = object.contains_key("redirect");
    if has_data == has_redirect {
        return Err("web Route loader must return exactly one of data or redirect".to_owned());
    }
    if object
        .keys()
        .any(|name| !matches!(name.as_str(), "data" | "metadata" | "redirect"))
    {
        return Err("web Route loader outcome has unsupported fields".to_owned());
    }
    let metadata = match object.get("metadata") {
        Some(value) => validate_dynamic_metadata(value)?.clone(),
        None => Map::new(),
    };
    if let Some(destination) = object.get("redirect") {
        return Ok(LoaderResolution::Redirect(destination.clone()));
    }
    Ok(LoaderResolution::Document {
        data: object.get("data").cloned(),
        metadata,
    })
}

fn validate_dynamic_metadata(value: &Value) -> Result<&Map<String, Value>, String> {
    validate_web_metadata(value, "dynamic web Route metadata")
}

fn validate_web_metadata<'a>(
    value: &'a Value,
    subject: &str,
) -> Result<&'a Map<String, Value>, String> {
    let metadata = value
        .as_object()
        .ok_or_else(|| format!("{subject} must be an object"))?;
    let allowed = [
        "alternates",
        "canonical",
        "description",
        "icons",
        "language",
        "manifest",
        "priorityImage",
        "robots",
        "social",
        "structuredData",
        "title",
    ];
    if metadata
        .keys()
        .any(|name| !allowed.contains(&name.as_str()))
    {
        return Err(format!("{subject} has unsupported fields"));
    }
    for name in [
        "canonical",
        "description",
        "language",
        "manifest",
        "robots",
        "title",
    ] {
        if metadata.get(name).is_some_and(|value| !value.is_string()) {
            return Err(format!("{subject} field {name:?} must be a string"));
        }
    }
    if let Some(alternates) = metadata.get("alternates") {
        let alternates = alternates
            .as_array()
            .ok_or_else(|| format!("{subject} alternates must be an array"))?;
        let mut languages = HashSet::new();
        for alternate in alternates {
            validate_keys(alternate, &["href", "language"], "web Route alternate")?;
            let language = string(alternate, "language")?;
            if language.is_empty()
                || string(alternate, "href")?.is_empty()
                || !languages.insert(language)
            {
                return Err(format!("{subject} has an invalid alternate"));
            }
        }
    }
    if let Some(social) = metadata.get("social") {
        validate_allowed_keys(
            social,
            &[],
            &["card", "description", "images", "siteName", "title", "type"],
            "web Route social metadata",
        )?;
        let social = social
            .as_object()
            .ok_or_else(|| format!("{subject} social metadata must be an object"))?;
        for name in ["description", "siteName", "title", "type"] {
            if social.get(name).is_some_and(|value| !value.is_string()) {
                return Err(format!("{subject} social field {name:?} must be a string"));
            }
        }
        if social
            .get("card")
            .is_some_and(|value| !matches!(value.as_str(), Some("summary" | "summary_large_image")))
        {
            return Err(format!("{subject} social card is invalid"));
        }
        if let Some(images) = social.get("images") {
            let images = images
                .as_array()
                .ok_or_else(|| format!("{subject} social images must be an array"))?;
            for image in images {
                validate_allowed_keys(
                    image,
                    &["url"],
                    &["alt", "height", "type", "width"],
                    "web Route social image",
                )?;
                if string(image, "url")?.is_empty() {
                    return Err(format!("{subject} social image URL is empty"));
                }
                for name in ["alt", "type"] {
                    if image.get(name).is_some_and(|value| !value.is_string()) {
                        return Err(format!("{subject} social image {name:?} must be a string"));
                    }
                }
                for name in ["width", "height"] {
                    if image
                        .get(name)
                        .is_some_and(|value| value.as_u64().is_none_or(|number| number == 0))
                    {
                        return Err(format!("{subject} social image {name:?} is invalid"));
                    }
                }
            }
        }
    }
    if let Some(icons) = metadata.get("icons") {
        let icons = icons
            .as_array()
            .ok_or_else(|| format!("{subject} icons must be an array"))?;
        for icon in icons {
            validate_allowed_keys(
                icon,
                &["url"],
                &["color", "media", "rel", "sizes", "type"],
                "web Route icon",
            )?;
            if string(icon, "url")?.is_empty() {
                return Err(format!("{subject} icon URL is empty"));
            }
            for name in ["color", "media", "sizes", "type"] {
                if icon.get(name).is_some_and(|value| !value.is_string()) {
                    return Err(format!("{subject} icon {name:?} must be a string"));
                }
            }
            if icon.get("rel").is_some_and(|value| {
                !matches!(
                    value.as_str(),
                    Some("icon" | "apple-touch-icon" | "mask-icon")
                )
            }) {
                return Err(format!("{subject} icon relation is invalid"));
            }
        }
    }
    if let Some(values) = metadata.get("structuredData") {
        let values = values
            .as_array()
            .ok_or_else(|| format!("{subject} structured data must be an array"))?;
        if values.iter().any(|value| !value.is_object()) {
            return Err(format!("{subject} structured data must contain objects"));
        }
    }
    if let Some(image) = metadata.get("priorityImage") {
        validate_allowed_keys(
            image,
            &["url"],
            &["sizes", "sourceSet", "type"],
            "web Route priority image",
        )?;
        if string(image, "url")?.is_empty() {
            return Err(format!("{subject} priority image URL is empty"));
        }
        for name in ["sizes", "sourceSet", "type"] {
            if image.get(name).is_some_and(|value| !value.is_string()) {
                return Err(format!(
                    "{subject} priority image {name:?} must be a string"
                ));
            }
        }
    }
    Ok(metadata)
}

fn merge_dynamic_metadata(
    document: &mut Value,
    dynamic: Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| "web document must be an object".to_owned())?;
    let mut merged = Map::new();
    merged.insert(
        "title".to_owned(),
        object
            .get("title")
            .cloned()
            .ok_or_else(|| "web document title is required".to_owned())?,
    );
    merged.insert(
        "language".to_owned(),
        object
            .get("language")
            .cloned()
            .ok_or_else(|| "web document language is required".to_owned())?,
    );
    let head = object
        .get("metadata")
        .and_then(Value::as_object)
        .ok_or_else(|| "web document metadata must be an object".to_owned())?;
    for (name, value) in head {
        merged.insert(name.clone(), value.clone());
    }
    for (name, value) in dynamic {
        merged.insert(name, value);
    }
    if let Some(title) = merged.get("title") {
        object.insert("title".to_owned(), title.clone());
    }
    if let Some(language) = merged.get("language") {
        object.insert("language".to_owned(), language.clone());
    }
    object.insert(
        "metadata".to_owned(),
        Value::Object(
            merged
                .iter()
                .filter(|(name, _)| !matches!(name.as_str(), "title" | "language"))
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect(),
        ),
    );
    Ok(merged)
}

#[derive(Clone)]
enum RuntimeValue {
    Undefined,
    Json(Value),
    Slot(Vec<PendingNode>),
}

#[derive(Clone)]
enum PendingNode {
    Element {
        tag: String,
        attributes: BTreeMap<String, String>,
        children: Vec<PendingNode>,
    },
    Text(String),
    Boundary {
        boundary: String,
        field: String,
        children: Vec<PendingNode>,
    },
}

#[derive(Clone)]
struct RenderScope {
    data: RuntimeValue,
    params: Value,
    search: Value,
    props: BTreeMap<String, RuntimeValue>,
    state: Value,
    locals: BTreeMap<String, RuntimeValue>,
}

#[derive(Clone)]
struct DeferredBoundary {
    field: String,
    resolved: Value,
    resolved_item: String,
    rejected: Value,
    rejected_item: String,
    scope: RenderScope,
    stack: Vec<String>,
}

#[derive(Default)]
struct DeferredBoundaries {
    values: BTreeMap<String, DeferredBoundary>,
    order: Vec<String>,
}

impl DeferredBoundaries {
    fn insert(&mut self, identity: String, boundary: DeferredBoundary) -> Result<(), String> {
        if self.values.contains_key(&identity) {
            return Err(format!(
                "Deferred web Route data {:?} must have one Await boundary.",
                boundary.field
            ));
        }
        self.order.push(identity.clone());
        self.values.insert(identity, boundary);
        Ok(())
    }
}

struct RenderSequence {
    element: usize,
    text: usize,
    prefix: String,
}

impl Default for RenderSequence {
    fn default() -> Self {
        Self {
            element: 0,
            text: 0,
            prefix: String::new(),
        }
    }
}

fn evaluate_render_node(
    node: &Value,
    scope: &RenderScope,
    components: &BTreeMap<String, Value>,
    stack: &[String],
    boundaries: &mut DeferredBoundaries,
) -> Result<Vec<PendingNode>, String> {
    match string(node, "kind")? {
        "none" => Ok(Vec::new()),
        "text" => render_value_nodes(
            evaluate_render_value(required(node, "value")?, scope)?,
            scope,
            components,
            stack,
        ),
        "fragment" => {
            let mut result = Vec::new();
            for child in array(node, "children")? {
                result.extend(evaluate_render_node(
                    child, scope, components, stack, boundaries,
                )?);
            }
            Ok(result)
        }
        "conditional" => {
            let condition = evaluate_render_value(required(node, "condition")?, scope)?;
            evaluate_render_node(
                required(
                    node,
                    if render_truthy(&condition) {
                        "consequent"
                    } else {
                        "alternate"
                    },
                )?,
                scope,
                components,
                stack,
                boundaries,
            )
        }
        "element" => {
            let mut attributes = BTreeMap::new();
            for attribute in array(node, "attributes")? {
                let name = string(attribute, "name")?;
                let value = evaluate_render_value(required(attribute, "value")?, scope)?;
                let Some(value) = render_attribute_value(&value, name)? else {
                    continue;
                };
                if attributes.insert(name.to_owned(), value).is_some() {
                    return Err(format!("duplicate web render attribute {name:?}"));
                }
            }
            let owner = compiled_component_runtime_name(stack.last().map(String::as_str));
            attributes.insert(
                "data-poggers-element".to_owned(),
                format!("{owner}/{}", string(node, "element")?),
            );
            let mut children = Vec::new();
            for child in array(node, "children")? {
                children.extend(evaluate_render_node(
                    child, scope, components, stack, boundaries,
                )?);
            }
            Ok(vec![PendingNode::Element {
                tag: string(node, "tag")?.to_owned(),
                attributes,
                children,
            }])
        }
        "component" => {
            let target = string(node, "target")?;
            if stack.len() >= 100 || stack.iter().any(|value| value == target) {
                return Err(format!("recursive server Component {target:?}"));
            }
            let component = components
                .get(target)
                .ok_or_else(|| format!("missing compiled web Component {target:?}"))?;
            let view = required(component, "view")?;
            if view == &Value::Bool(false) {
                let reason = component
                    .get("diagnostic")
                    .and_then(Value::as_object)
                    .and_then(|value| value.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Component meaning is missing");
                return Err(format!(
                    "cannot server-render Component {target:?}: {reason}"
                ));
            }
            let mut props = BTreeMap::new();
            for property in array(node, "props")? {
                let name = string(property, "name")?.to_owned();
                let value = if property
                    .get("node")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| "web render prop node must be boolean".to_owned())?
                {
                    RuntimeValue::Slot(evaluate_render_node(
                        required(property, "value")?,
                        scope,
                        components,
                        stack,
                        boundaries,
                    )?)
                } else {
                    evaluate_render_value(required(property, "value")?, scope)?
                };
                if props.insert(name.clone(), value).is_some() {
                    return Err(format!("duplicate web render prop {name:?}"));
                }
            }
            let component_scope = RenderScope {
                data: RuntimeValue::Undefined,
                params: Value::Object(Map::new()),
                search: Value::Object(Map::new()),
                props,
                state: required(component, "state")?.clone(),
                locals: BTreeMap::new(),
            };
            let mut child_stack = stack.to_vec();
            child_stack.push(target.to_owned());
            evaluate_render_node(view, &component_scope, components, &child_stack, boundaries)
        }
        "each" => {
            let values = evaluate_render_value(required(node, "values")?, scope)?;
            let RuntimeValue::Json(Value::Array(values)) = values else {
                return Err("web render each value must be an array".to_owned());
            };
            let name = string(node, "item")?;
            let mut result = Vec::new();
            for value in values {
                let mut locals = scope.locals.clone();
                locals.insert(name.to_owned(), RuntimeValue::Json(value));
                let item_scope = RenderScope {
                    data: scope.data.clone(),
                    params: scope.params.clone(),
                    search: scope.search.clone(),
                    props: scope.props.clone(),
                    state: scope.state.clone(),
                    locals,
                };
                result.extend(evaluate_render_node(
                    required(node, "body")?,
                    &item_scope,
                    components,
                    stack,
                    boundaries,
                )?);
            }
            Ok(result)
        }
        "await" => {
            let source = evaluate_render_value(required(node, "value")?, scope)?;
            let RuntimeValue::Json(source) = source else {
                return Err("Await requires one deferred Route data field.".to_owned());
            };
            let (boundary, field) = deferred_source(&source)?;
            let error = required(node, "error")?;
            boundaries.insert(
                boundary.clone(),
                DeferredBoundary {
                    field: field.clone(),
                    resolved: required(node, "resolved")?.clone(),
                    resolved_item: string(node, "item")?.to_owned(),
                    rejected: required(error, "body")?.clone(),
                    rejected_item: string(error, "item")?.to_owned(),
                    scope: scope.clone(),
                    stack: stack.to_vec(),
                },
            )?;
            Ok(vec![PendingNode::Boundary {
                boundary,
                field,
                children: evaluate_render_node(
                    required(node, "pending")?,
                    scope,
                    components,
                    stack,
                    boundaries,
                )?,
            }])
        }
        kind => Err(format!("unsupported web render node {kind:?}")),
    }
}

fn deferred_source(value: &Value) -> Result<(String, String), String> {
    validate_keys(
        value,
        &["boundary", "field", "kind", "state", "version"],
        "deferred web Route data",
    )?;
    if value.get("version").and_then(Value::as_u64) != Some(1)
        || string(value, "kind")? != "deferred"
    {
        return Err("Await requires one deferred Route data field.".to_owned());
    }
    let boundary = string(value, "boundary")?;
    let field = string(value, "field")?;
    if !valid_deferred_boundary(boundary) || !valid_identifier(field) {
        return Err("Await requires one deferred Route data field.".to_owned());
    }
    let state = required(value, "state")?;
    validate_keys(state, &["status"], "deferred web Route data state")?;
    if string(state, "status")? != "pending" {
        return Err("Await requires pending deferred Route data.".to_owned());
    }
    Ok((boundary.to_owned(), field.to_owned()))
}

fn compiled_component_runtime_name(component: Option<&str>) -> String {
    let Some(component) = component else {
        return "route".to_owned();
    };
    let Some((feature, name)) = component.rsplit_once('.') else {
        return component.to_owned();
    };
    format!("@feature/{feature}/component/{name}")
}

fn evaluate_render_value(value: &Value, scope: &RenderScope) -> Result<RuntimeValue, String> {
    match string(value, "kind")? {
        "literal" => Ok(RuntimeValue::Json(required(value, "value")?.clone())),
        "path" => {
            let root = match string(value, "root")? {
                "data" => scope.data.clone(),
                "params" => RuntimeValue::Json(scope.params.clone()),
                "search" => RuntimeValue::Json(scope.search.clone()),
                "props" => RuntimeValue::Json(Value::Object(
                    scope
                        .props
                        .iter()
                        .filter_map(|(name, value)| match value {
                            RuntimeValue::Json(value) => Some((name.clone(), value.clone())),
                            RuntimeValue::Undefined | RuntimeValue::Slot(_) => None,
                        })
                        .collect(),
                )),
                "state" => RuntimeValue::Json(scope.state.clone()),
                root => return Err(format!("unsupported web render path root {root:?}")),
            };
            if string(value, "root")? == "props" {
                let path = string_array(value, "path")?;
                if let Some((first, rest)) = path.split_first() {
                    return Ok(read_runtime_path(
                        scope
                            .props
                            .get(*first)
                            .cloned()
                            .unwrap_or(RuntimeValue::Undefined),
                        rest,
                    ));
                }
            }
            Ok(read_runtime_path(root, &string_array(value, "path")?))
        }
        "local" => Ok(read_runtime_path(
            scope
                .locals
                .get(string(value, "name")?)
                .cloned()
                .unwrap_or(RuntimeValue::Undefined),
            &string_array(value, "path")?,
        )),
        "array" => {
            let values = array(value, "values")?
                .iter()
                .map(|value| runtime_json(evaluate_render_value(value, scope)?))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(RuntimeValue::Json(Value::Array(values)))
        }
        "record" => {
            let mut fields = Map::new();
            for field in array(value, "fields")? {
                let name = string(field, "name")?.to_owned();
                let value = runtime_json(evaluate_render_value(required(field, "value")?, scope)?)?;
                if fields.insert(name.clone(), value).is_some() {
                    return Err(format!("duplicate web render field {name:?}"));
                }
            }
            Ok(RuntimeValue::Json(Value::Object(fields)))
        }
        "conditional" => {
            let condition = evaluate_render_value(required(value, "condition")?, scope)?;
            evaluate_render_value(
                required(
                    value,
                    if render_truthy(&condition) {
                        "consequent"
                    } else {
                        "alternate"
                    },
                )?,
                scope,
            )
        }
        "unary" => {
            let operand = evaluate_render_value(required(value, "value")?, scope)?;
            match string(value, "operator")? {
                "!" => Ok(RuntimeValue::Json(Value::Bool(!render_truthy(&operand)))),
                "-" => {
                    let number = runtime_number(&operand)?;
                    Ok(RuntimeValue::Json(number_json(-number)?))
                }
                operator => Err(format!(
                    "unsupported web render unary operator {operator:?}"
                )),
            }
        }
        "binary" => evaluate_render_binary(value, scope),
        kind => Err(format!("unsupported web render value {kind:?}")),
    }
}

fn evaluate_render_binary(value: &Value, scope: &RenderScope) -> Result<RuntimeValue, String> {
    let left = evaluate_render_value(required(value, "left")?, scope)?;
    match string(value, "operator")? {
        "&&" => {
            return if render_truthy(&left) {
                evaluate_render_value(required(value, "right")?, scope)
            } else {
                Ok(left)
            };
        }
        "||" => {
            return if render_truthy(&left) {
                Ok(left)
            } else {
                evaluate_render_value(required(value, "right")?, scope)
            };
        }
        "??" => {
            return if matches!(
                &left,
                RuntimeValue::Undefined | RuntimeValue::Json(Value::Null)
            ) {
                evaluate_render_value(required(value, "right")?, scope)
            } else {
                Ok(left)
            };
        }
        _ => {}
    }
    let right = evaluate_render_value(required(value, "right")?, scope)?;
    match string(value, "operator")? {
        "+" => match (&left, &right) {
            (RuntimeValue::Json(Value::String(_)), _)
            | (_, RuntimeValue::Json(Value::String(_))) => Ok(RuntimeValue::Json(Value::String(
                format!("{}{}", runtime_string(&left)?, runtime_string(&right)?),
            ))),
            _ => Ok(RuntimeValue::Json(number_json(
                runtime_number(&left)? + runtime_number(&right)?,
            )?)),
        },
        "===" | "!==" => {
            let equal = runtime_scalar_equal(&left, &right)?;
            Ok(RuntimeValue::Json(Value::Bool(
                if string(value, "operator")? == "===" {
                    equal
                } else {
                    !equal
                },
            )))
        }
        operator @ ("<" | "<=" | ">" | ">=") => Ok(RuntimeValue::Json(Value::Bool(
            runtime_compare(&left, &right, operator)?,
        ))),
        operator => Err(format!(
            "unsupported web render binary operator {operator:?}"
        )),
    }
}

fn read_runtime_path(mut value: RuntimeValue, path: &[&str]) -> RuntimeValue {
    for name in path {
        value = match value {
            RuntimeValue::Json(Value::Object(values)) => values
                .get(*name)
                .cloned()
                .map(RuntimeValue::Json)
                .unwrap_or(RuntimeValue::Undefined),
            RuntimeValue::Json(Value::Array(values)) => name
                .parse::<usize>()
                .ok()
                .and_then(|index| values.get(index).cloned())
                .map(RuntimeValue::Json)
                .unwrap_or(RuntimeValue::Undefined),
            RuntimeValue::Undefined | RuntimeValue::Json(_) | RuntimeValue::Slot(_) => {
                RuntimeValue::Undefined
            }
        };
    }
    value
}

fn runtime_json(value: RuntimeValue) -> Result<Value, String> {
    match value {
        RuntimeValue::Json(value) => Ok(value),
        RuntimeValue::Undefined => {
            Err("undefined cannot be embedded in web render data".to_owned())
        }
        RuntimeValue::Slot(_) => {
            Err("a Component slot cannot be embedded in render data".to_owned())
        }
    }
}

fn runtime_number(value: &RuntimeValue) -> Result<f64, String> {
    match value {
        RuntimeValue::Json(Value::Number(value)) => value
            .as_f64()
            .filter(|value| value.is_finite())
            .ok_or_else(|| "web render number must be finite".to_owned()),
        _ => Err("web render operation requires a number".to_owned()),
    }
}

fn number_json(value: f64) -> Result<Value, String> {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| "web render number must be finite".to_owned())
}

fn runtime_string(value: &RuntimeValue) -> Result<String, String> {
    match value {
        RuntimeValue::Undefined => Ok("undefined".to_owned()),
        RuntimeValue::Json(Value::Null) => Ok("null".to_owned()),
        RuntimeValue::Json(Value::Bool(value)) => Ok(value.to_string()),
        RuntimeValue::Json(Value::Number(value)) => Ok(json_number_text(value)),
        RuntimeValue::Json(Value::String(value)) => Ok(value.clone()),
        RuntimeValue::Json(Value::Array(_) | Value::Object(_)) | RuntimeValue::Slot(_) => {
            Err("web render string conversion supports only scalar values".to_owned())
        }
    }
}

fn runtime_scalar_equal(left: &RuntimeValue, right: &RuntimeValue) -> Result<bool, String> {
    match (left, right) {
        (RuntimeValue::Undefined, RuntimeValue::Undefined) => Ok(true),
        (RuntimeValue::Undefined, RuntimeValue::Json(_))
        | (RuntimeValue::Json(_), RuntimeValue::Undefined) => Ok(false),
        (RuntimeValue::Json(left), RuntimeValue::Json(right))
            if !left.is_array() && !left.is_object() && !right.is_array() && !right.is_object() =>
        {
            Ok(left == right)
        }
        _ => Err("web render equality supports only scalar values".to_owned()),
    }
}

fn runtime_compare(
    left: &RuntimeValue,
    right: &RuntimeValue,
    operator: &str,
) -> Result<bool, String> {
    match (left, right) {
        (RuntimeValue::Json(Value::Number(left)), RuntimeValue::Json(Value::Number(right))) => {
            compare_ordered(
                left.as_f64()
                    .ok_or_else(|| "invalid web render number".to_owned())?,
                right
                    .as_f64()
                    .ok_or_else(|| "invalid web render number".to_owned())?,
                operator,
            )
        }
        (RuntimeValue::Json(Value::String(left)), RuntimeValue::Json(Value::String(right))) => {
            compare_ordered(left, right, operator)
        }
        _ => Err(format!(
            "web render {operator} requires two numbers or two strings"
        )),
    }
}

fn compare_ordered<Value: PartialOrd>(
    left: Value,
    right: Value,
    operator: &str,
) -> Result<bool, String> {
    match operator {
        "<" => Ok(left < right),
        "<=" => Ok(left <= right),
        ">" => Ok(left > right),
        ">=" => Ok(left >= right),
        _ => Err(format!("unsupported web render comparison {operator:?}")),
    }
}

fn render_truthy(value: &RuntimeValue) -> bool {
    match value {
        RuntimeValue::Undefined | RuntimeValue::Json(Value::Null) => false,
        RuntimeValue::Json(Value::Bool(value)) => *value,
        RuntimeValue::Json(Value::Number(value)) => {
            value.as_f64().is_some_and(|value| value != 0.0)
        }
        RuntimeValue::Json(Value::String(value)) => !value.is_empty(),
        RuntimeValue::Json(Value::Array(_) | Value::Object(_)) | RuntimeValue::Slot(_) => true,
    }
}

fn render_attribute_value(value: &RuntimeValue, name: &str) -> Result<Option<String>, String> {
    match value {
        RuntimeValue::Undefined | RuntimeValue::Json(Value::Null | Value::Bool(false)) => Ok(None),
        RuntimeValue::Json(Value::Bool(value)) if name.starts_with("aria-") => {
            Ok(Some(value.to_string()))
        }
        RuntimeValue::Json(Value::Bool(true)) => Ok(Some(String::new())),
        RuntimeValue::Json(Value::Number(_) | Value::String(_)) => runtime_string(value).map(Some),
        RuntimeValue::Json(Value::Array(_) | Value::Object(_)) | RuntimeValue::Slot(_) => {
            Err(format!("web render attribute {name:?} must be scalar"))
        }
    }
}

fn render_value_nodes(
    value: RuntimeValue,
    _scope: &RenderScope,
    _components: &BTreeMap<String, Value>,
    _stack: &[String],
) -> Result<Vec<PendingNode>, String> {
    match value {
        RuntimeValue::Undefined | RuntimeValue::Json(Value::Null | Value::Bool(_)) => {
            Ok(Vec::new())
        }
        RuntimeValue::Json(Value::Number(value)) => {
            Ok(vec![PendingNode::Text(json_number_text(&value))])
        }
        RuntimeValue::Json(Value::String(value)) => Ok(vec![PendingNode::Text(value)]),
        RuntimeValue::Json(Value::Array(values)) => {
            let mut result = Vec::new();
            for value in values {
                result.extend(render_value_nodes(
                    RuntimeValue::Json(value),
                    _scope,
                    _components,
                    _stack,
                )?);
            }
            Ok(result)
        }
        RuntimeValue::Slot(nodes) => Ok(nodes),
        RuntimeValue::Json(Value::Object(_)) => {
            Err("web render text must be scalar UI or a Component slot".to_owned())
        }
    }
}

fn lower_pending_node(node: &PendingNode, sequence: &mut RenderSequence) -> Result<Value, String> {
    match node {
        PendingNode::Text(value) => {
            let hydration = format!("{}t{}", sequence.prefix, sequence.text);
            sequence.text += 1;
            Ok(json!({ "kind": "text", "hydration": hydration, "value": value }))
        }
        PendingNode::Boundary {
            boundary,
            field,
            children,
        } => {
            let mut child_sequence = RenderSequence {
                prefix: format!("{boundary}:"),
                ..RenderSequence::default()
            };
            let children = children
                .iter()
                .map(|child| lower_pending_node(child, &mut child_sequence))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(json!({
                "kind": "boundary",
                "boundary": boundary,
                "field": field,
                "children": children,
            }))
        }
        PendingNode::Element {
            tag,
            attributes,
            children,
        } => {
            if !valid_name(tag, false) {
                return Err(format!("invalid web render element {tag:?}"));
            }
            let hydration = format!("{}e{}", sequence.prefix, sequence.element);
            sequence.element += 1;
            let mut attributes = attributes.clone();
            attributes.insert("data-poggers-h".to_owned(), hydration.clone());
            let attributes = attributes
                .into_iter()
                .map(|(name, value)| json!({ "name": name, "value": value }))
                .collect::<Vec<_>>();
            let children = children
                .iter()
                .map(|child| lower_pending_node(child, sequence))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(json!({
                "kind": "element",
                "hydration": hydration,
                "tag": tag,
                "attributes": attributes,
                "children": children,
            }))
        }
    }
}

fn format_route_destination(
    route: &RouteDefinition,
    destination: &Map<String, Value>,
) -> Result<String, String> {
    if destination
        .keys()
        .any(|name| !matches!(name.as_str(), "hash" | "params" | "search" | "to"))
    {
        return Err("web Route destination has unsupported fields".to_owned());
    }
    let params = destination
        .get("params")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut segments = Vec::new();
    for segment in route.path.split('/') {
        if segment.is_empty() {
            continue;
        }
        if !segment.starts_with(':') && !segment.starts_with('*') {
            segments.push(segment.to_owned());
            continue;
        }
        let name = &segment[1..];
        let field = parameter(&route.params, name)?;
        let value = params
            .get(name)
            .ok_or_else(|| format!("missing path parameter {name}"))?;
        let scalar = scalar_from_json(value)?;
        validate_scalar(field, &scalar, "path")?;
        let encoded = encode_path(&scalar_text(&scalar));
        if segment.starts_with('*') {
            segments.extend(
                scalar_text(&scalar)
                    .split('/')
                    .map(encode_path)
                    .collect::<Vec<_>>(),
            );
        } else {
            segments.push(encoded);
        }
    }
    let supplied_search = destination
        .get("search")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for field in &route.search {
        let value = supplied_search.get(&field.name).or(field.default.as_ref());
        let Some(value) = value else {
            if !field.optional {
                return Err(format!("missing search parameter {}", field.name));
            }
            continue;
        };
        let values = match value {
            Value::Array(values) if field.repeated => values.clone(),
            Value::Array(_) => {
                return Err(format!("search parameter {} is not repeated", field.name));
            }
            value => vec![value.clone()],
        };
        let is_default = field.default.as_ref() == Some(value);
        let mut encoded = Vec::with_capacity(values.len());
        for value in values {
            let scalar = scalar_from_json(&value)?;
            validate_scalar(field, &scalar, "search")?;
            encoded.push(scalar_text(&scalar));
        }
        if !is_default {
            for value in encoded {
                serializer.append_pair(&field.name, &value);
            }
        }
    }
    let query = serializer.finish();
    let hash = match destination.get("hash") {
        Some(Value::String(value)) if !value.is_empty() => format!("#{}", encode_path(value)),
        Some(Value::String(_)) | None => String::new(),
        Some(_) => return Err("web Route destination hash must be a string".to_owned()),
    };
    Ok(format!(
        "/{}{}{}",
        segments.join("/"),
        if query.is_empty() {
            String::new()
        } else {
            format!("?{query}")
        },
        hash
    ))
}

fn scalar_text(value: &Scalar) -> String {
    match value {
        Scalar::Boolean(value) => value.to_string(),
        Scalar::Number(value) if value.fract() == 0.0 => format!("{value:.0}"),
        Scalar::Number(value) => value.to_string(),
        Scalar::String(value) => value.clone(),
    }
}

fn json_number_text(value: &serde_json::Number) -> String {
    value
        .as_f64()
        .map(|value| scalar_text(&Scalar::Number(value)))
        .unwrap_or_else(|| value.to_string())
}

fn encode_path(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn route_score(path: &str) -> usize {
    path.split('/')
        .map(|segment| {
            if segment.starts_with('*') {
                1
            } else if segment.starts_with(':') {
                10
            } else {
                100
            }
        })
        .sum()
}

fn route_match(
    route: &RouteDefinition,
    path: &str,
    query: Option<&str>,
) -> Result<Option<RouteValues>, String> {
    let pattern = segments(&route.path);
    let source = segments(path);
    let mut params = Map::new();
    let mut index = 0;
    while index < pattern.len() {
        let expected = pattern[index];
        if let Some(name) = expected.strip_prefix('*') {
            let value = source[index..]
                .iter()
                .map(|segment| decode_path(segment))
                .collect::<Result<Vec<_>, _>>()?
                .join("/");
            let value = decode_parameter(parameter(&route.params, name)?, &value, "path")?;
            params.insert(name.to_owned(), scalar_json(value)?);
            return Ok(Some(RouteValues {
                params,
                search: decode_search(&route.search, query)?,
            }));
        }
        let Some(actual) = source.get(index) else {
            return Ok(None);
        };
        let actual = decode_path(actual)?;
        if let Some(name) = expected.strip_prefix(':') {
            let value = decode_parameter(parameter(&route.params, name)?, &actual, "path")?;
            params.insert(name.to_owned(), scalar_json(value)?);
        } else if expected != actual {
            return Ok(None);
        }
        index += 1;
    }
    if index != source.len() {
        return Ok(None);
    }
    Ok(Some(RouteValues {
        params,
        search: decode_search(&route.search, query)?,
    }))
}

fn segments(value: &str) -> Vec<&str> {
    let value = value.strip_prefix('/').unwrap_or(value);
    let value = value.strip_suffix('/').unwrap_or(value);
    if value.is_empty() {
        Vec::new()
    } else {
        value.split('/').collect()
    }
}

fn decode_path(value: &str) -> Result<String, String> {
    percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| "invalid percent-encoded path".to_owned())
}

fn decode_search(
    fields: &[RouteParameter],
    query: Option<&str>,
) -> Result<Map<String, Value>, String> {
    let pairs = query
        .map(|query| url::form_urlencoded::parse(query.as_bytes()).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut result = Map::new();
    for field in fields {
        let values = pairs
            .iter()
            .filter_map(|(name, value)| (name == &field.name).then_some(value.as_ref()))
            .collect::<Vec<_>>();
        if values.is_empty() {
            if let Some(default) = &field.default {
                let value = scalar_from_json(default)?;
                validate_scalar(field, &value, "search")?;
                result.insert(field.name.clone(), scalar_json(value)?);
            } else if !field.optional {
                return Err(format!("missing search parameter {}", field.name));
            }
            continue;
        }
        if !field.repeated && values.len() != 1 {
            return Err(format!("search parameter {} must occur once", field.name));
        }
        let decoded = values
            .into_iter()
            .map(|value| decode_parameter(field, value, "search").and_then(scalar_json))
            .collect::<Result<Vec<_>, _>>()?;
        if field.repeated {
            result.insert(field.name.clone(), Value::Array(decoded));
        } else if let Some(value) = decoded.into_iter().next() {
            result.insert(field.name.clone(), value);
        }
    }
    Ok(result)
}

fn parameter<'a>(fields: &'a [RouteParameter], name: &str) -> Result<&'a RouteParameter, String> {
    fields
        .iter()
        .find(|field| field.name == name)
        .ok_or_else(|| format!("missing path field {name}"))
}

fn decode_parameter(field: &RouteParameter, raw: &str, location: &str) -> Result<Scalar, String> {
    let value = match field.kind.as_str() {
        "boolean" if raw == "true" => Scalar::Boolean(true),
        "boolean" if raw == "false" => Scalar::Boolean(false),
        "boolean" => return Err(invalid_parameter(location, &field.name)),
        "number" => {
            let value = raw
                .trim()
                .parse::<f64>()
                .map_err(|_| invalid_parameter(location, &field.name))?;
            if !value.is_finite() {
                return Err(invalid_parameter(location, &field.name));
            }
            Scalar::Number(value)
        }
        "string" => Scalar::String(raw.to_owned()),
        _ => return Err(format!("unsupported route parameter kind {}", field.kind)),
    };
    validate_scalar(field, &value, location)?;
    Ok(value)
}

fn validate_scalar(field: &RouteParameter, value: &Scalar, location: &str) -> Result<(), String> {
    let kind_matches = matches!(
        (&value, field.kind.as_str()),
        (Scalar::Boolean(_), "boolean")
            | (Scalar::Number(_), "number")
            | (Scalar::String(_), "string")
    );
    if !kind_matches {
        return Err(invalid_parameter(location, &field.name));
    }
    if let Some(values) = &field.values {
        let allowed = values
            .iter()
            .map(scalar_from_json)
            .collect::<Result<Vec<_>, _>>()?;
        if !allowed.contains(value) {
            return Err(invalid_parameter(location, &field.name));
        }
    }
    match value {
        Scalar::Number(number) => {
            if field.integer && number.fract() != 0.0
                || field.minimum.is_some_and(|minimum| *number < minimum)
                || field.maximum.is_some_and(|maximum| *number > maximum)
            {
                return Err(invalid_parameter(location, &field.name));
            }
        }
        Scalar::String(string) => {
            let length = string.encode_utf16().count();
            if field.minimum_length.is_some_and(|minimum| length < minimum)
                || field.maximum_length.is_some_and(|maximum| length > maximum)
                || field.format.as_deref() == Some("uuid") && !is_uuid(string)
            {
                return Err(invalid_parameter(location, &field.name));
            }
        }
        Scalar::Boolean(_) => {}
    }
    Ok(())
}

fn scalar_json(value: Scalar) -> Result<Value, String> {
    match value {
        Scalar::Boolean(value) => Ok(Value::Bool(value)),
        Scalar::Number(value) => serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| "route parameter number must be finite".to_owned()),
        Scalar::String(value) => Ok(Value::String(value)),
    }
}

fn scalar_from_json(value: &Value) -> Result<Scalar, String> {
    match value {
        Value::Bool(value) => Ok(Scalar::Boolean(*value)),
        Value::Number(value) => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(Scalar::Number)
            .ok_or_else(|| "route parameter number must be finite".to_owned()),
        Value::String(value) => Ok(Scalar::String(value.clone())),
        _ => Err("route parameter value must be scalar".to_owned()),
    }
}

fn invalid_parameter(location: &str, name: &str) -> String {
    format!("invalid {location} parameter {name}")
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 || [8, 13, 18, 23].iter().any(|index| bytes[*index] != b'-') {
        return false;
    }
    bytes.iter().enumerate().all(|(index, byte)| {
        if [8, 13, 18, 23].contains(&index) {
            return true;
        }
        byte.is_ascii_hexdigit()
            && (index != 14 || (b'1'..=b'8').contains(byte))
            && (index != 19 || matches!(byte.to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b'))
    })
}

fn validate_route(route: &RouteDefinition) -> Result<(), String> {
    if !route.path.starts_with('/') {
        return Err("web route path must be absolute".to_owned());
    }
    if route.document != "content" && route.document != "shell" {
        return Err("unsupported web route document plan".to_owned());
    }
    if route.path.contains('?') || route.path.contains('#') {
        return Err("web route path cannot contain search or hash syntax".to_owned());
    }
    validate_cache(&route.cache)?;
    validate_web_metadata(&route.metadata, "web Route metadata")?;
    let segments = route.path.split('/').skip(1).collect::<Vec<_>>();
    let mut path_names = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        if !segment.starts_with(':') && !segment.starts_with('*') {
            continue;
        }
        let name = &segment[1..];
        if !valid_identifier(name) || path_names.contains(&name) {
            return Err("web route has invalid path parameters".to_owned());
        }
        if segment.starts_with('*') && index != segments.len() - 1 {
            return Err("web route has a non-final wildcard".to_owned());
        }
        path_names.push(name);
    }
    let mut declared = route
        .params
        .iter()
        .map(|field| field.name.as_str())
        .collect::<Vec<_>>();
    path_names.sort_unstable();
    declared.sort_unstable();
    if path_names != declared {
        return Err("web route has inconsistent path parameters".to_owned());
    }
    validate_fields(&route.params, "path")?;
    validate_fields(&route.search, "search")?;
    let mut deferred = HashSet::new();
    if route
        .deferred
        .iter()
        .any(|field| !valid_identifier(field) || !deferred.insert(field))
    {
        return Err("web route has invalid deferred data".to_owned());
    }
    Ok(())
}

fn validate_routes(routes: &[RouteDocument]) -> Result<(), String> {
    let mut identities = HashSet::new();
    let mut patterns = BTreeMap::new();
    for route in routes {
        let identity = route_identity(&route.route);
        if !identities.insert(identity.clone()) {
            return Err(format!("duplicate web Route {identity:?}"));
        }
        let pattern = route
            .route
            .path
            .split('/')
            .skip(1)
            .map(|segment| {
                if segment.starts_with('*') {
                    "*"
                } else if segment.starts_with(':') {
                    ":"
                } else {
                    segment
                }
            })
            .collect::<Vec<_>>()
            .join("/");
        if let Some(previous) = patterns.insert(pattern, identity.clone()) {
            return Err(format!(
                "web Routes {previous:?} and {identity:?} are ambiguous"
            ));
        }
    }
    Ok(())
}

fn validate_fields(fields: &[RouteParameter], location: &str) -> Result<(), String> {
    let mut names = HashSet::new();
    for field in fields {
        if !valid_identifier(&field.name) || !names.insert(&field.name) {
            return Err(format!("web route has invalid {location} fields"));
        }
        if !matches!(field.kind.as_str(), "boolean" | "number" | "string") {
            return Err(format!("unsupported route parameter kind {}", field.kind));
        }
        if location == "path" && (field.optional || field.repeated || field.default.is_some()) {
            return Err(format!(
                "web route path field {} must be required and scalar without a default",
                field.name
            ));
        }
        if field.repeated && location != "search" {
            return Err(format!("web route field {} cannot repeat", field.name));
        }
        if field.integer && field.kind != "number" {
            return Err(format!(
                "web route field {} has numeric rules on a non-number",
                field.name
            ));
        }
        if (field.minimum.is_some() || field.maximum.is_some()) && field.kind != "number" {
            return Err(format!(
                "web route field {} has numeric bounds on a non-number",
                field.name
            ));
        }
        if (field.minimum_length.is_some() || field.maximum_length.is_some())
            && field.kind != "string"
        {
            return Err(format!(
                "web route field {} has length bounds on a non-string",
                field.name
            ));
        }
        if field.format.is_some() && field.kind != "string" {
            return Err(format!(
                "web route field {} has a string format on a non-string",
                field.name
            ));
        }
        if field
            .format
            .as_deref()
            .is_some_and(|format| format != "uuid")
        {
            return Err(format!(
                "web route field {} has an unsupported format",
                field.name
            ));
        }
        if field
            .minimum
            .zip(field.maximum)
            .is_some_and(|(minimum, maximum)| minimum > maximum)
        {
            return Err(format!(
                "web route field {} has inverted bounds",
                field.name
            ));
        }
        if field
            .minimum_length
            .zip(field.maximum_length)
            .is_some_and(|(minimum, maximum)| minimum > maximum)
        {
            return Err(format!(
                "web route field {} has inverted length bounds",
                field.name
            ));
        }
        for value in field.values.iter().flatten().chain(field.default.iter()) {
            let scalar = scalar_from_json(value)?;
            validate_scalar(field, &scalar, location)?;
        }
    }
    Ok(())
}

fn valid_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    characters.next().is_some_and(|character| {
        character == '_' || character == '$' || character.is_ascii_alphabetic()
    }) && characters
        .all(|character| character == '_' || character == '$' || character.is_ascii_alphanumeric())
}

fn validate_cache(cache: &RouteCache) -> Result<(), String> {
    match cache {
        RouteCache::Disabled(false) => Ok(()),
        RouteCache::Disabled(true) => Err("web route cache cannot be true".to_owned()),
        RouteCache::Policy(policy) => {
            if policy.scope != "public" && policy.scope != "private" {
                return Err("web route cache scope must be public or private".to_owned());
            }
            if policy
                .max_age
                .as_deref()
                .is_some_and(|value| !valid_duration(value))
                || policy
                    .stale_while_revalidate
                    .as_deref()
                    .is_some_and(|value| !valid_duration(value))
            {
                return Err("web route cache duration is invalid".to_owned());
            }
            Ok(())
        }
    }
}

fn valid_duration(value: &str) -> bool {
    let Some((index, _)) = value
        .char_indices()
        .find(|(_, character)| !character.is_ascii_digit())
    else {
        return false;
    };
    let (number, unit) = value.split_at(index);
    !number.is_empty()
        && number.chars().all(|character| character.is_ascii_digit())
        && matches!(unit, "ms" | "s" | "m" | "h" | "d")
}

fn cache_control(cache: &RouteCache) -> Result<String, String> {
    match cache {
        RouteCache::Disabled(false) => Ok("no-store".to_owned()),
        RouteCache::Disabled(true) => Err("web route cache cannot be true".to_owned()),
        RouteCache::Policy(policy) => {
            let mut directives = vec![policy.scope.clone()];
            match &policy.max_age {
                Some(value) => directives.push(format!("max-age={}", duration_seconds(value)?)),
                None if policy.scope == "public" => directives.push("max-age=0".to_owned()),
                None => directives.push("no-store".to_owned()),
            }
            if policy.max_age.is_some()
                && let Some(value) = &policy.stale_while_revalidate
            {
                directives.push(format!(
                    "stale-while-revalidate={}",
                    duration_seconds(value)?
                ));
            }
            Ok(directives.join(", "))
        }
    }
}

fn response_cache_policy(cache: &RouteCache) -> Result<Option<WebResponseCachePolicy>, String> {
    let RouteCache::Policy(policy) = cache else {
        return Ok(None);
    };
    if policy.scope != "public" {
        return Ok(None);
    }
    let Some(max_age) = &policy.max_age else {
        return Ok(None);
    };
    let max_age = duration_milliseconds(max_age)?;
    if max_age == 0 {
        return Ok(None);
    }
    Ok(Some(WebResponseCachePolicy {
        max_age: Duration::from_millis(max_age),
        stale_while_revalidate: Duration::from_millis(
            policy
                .stale_while_revalidate
                .as_deref()
                .map(duration_milliseconds)
                .transpose()?
                .unwrap_or(0),
        ),
    }))
}

fn duration_milliseconds(value: &str) -> Result<u64, String> {
    let index = value
        .char_indices()
        .find_map(|(index, character)| (!character.is_ascii_digit()).then_some(index))
        .ok_or_else(|| "web route cache duration is invalid".to_owned())?;
    let (number, unit) = value.split_at(index);
    let number = number
        .parse::<u64>()
        .map_err(|_| "web route cache duration is invalid".to_owned())?;
    let multiplier = match unit {
        "ms" => 1,
        "s" => 1_000,
        "m" => 60_000,
        "h" => 3_600_000,
        "d" => 86_400_000,
        _ => return Err("web route cache duration is invalid".to_owned()),
    };
    number
        .checked_mul(multiplier)
        .ok_or_else(|| "web route cache duration overflows".to_owned())
}

fn duration_seconds(value: &str) -> Result<u64, String> {
    duration_milliseconds(value)?
        .checked_add(999)
        .map(|value| value / 1_000)
        .ok_or_else(|| "web route cache duration overflows".to_owned())
}

fn public_markdown_document(document: &Value) -> bool {
    let has_content = document
        .get("root")
        .and_then(Value::as_array)
        .is_some_and(|root| !root.is_empty());
    has_content
        && document
            .get("metadata")
            .is_some_and(public_markdown_metadata)
}

fn public_markdown_metadata(metadata: &Value) -> bool {
    !metadata
        .as_object()
        .and_then(|metadata| metadata.get("robots"))
        .and_then(Value::as_str)
        .is_some_and(|robots| robots.split(',').any(|value| value.trim() == "noindex"))
}

fn render_markdown(document: &Value) -> Result<String, String> {
    let metadata = document
        .get("metadata")
        .and_then(Value::as_object)
        .ok_or_else(|| "web document metadata must be an object".to_owned())?;
    let mut output = String::from("---\n");
    for (name, value) in [
        ("title", document.get("title")),
        ("language", document.get("language")),
        ("description", metadata.get("description")),
        ("canonical", metadata.get("canonical")),
        ("robots", metadata.get("robots")),
    ] {
        if let Some(value) = value.and_then(Value::as_str) {
            writeln!(
                output,
                "{name}: {}",
                serde_json::to_string(value)
                    .map_err(|error| format!("encode Markdown frontmatter: {error}"))?
            )
            .expect("write Markdown frontmatter");
        }
    }
    output.push_str("---\n");
    let body = normalize_markdown(
        &array(document, "root")?
            .iter()
            .map(markdown_node)
            .collect::<Result<Vec<_>, _>>()?
            .join("\n\n"),
    );
    if !body.is_empty() {
        output.push('\n');
        output.push_str(&body);
        output.push('\n');
    }
    Ok(output)
}

fn markdown_node(node: &Value) -> Result<String, String> {
    match string(node, "kind")? {
        "text" => Ok(escape_markdown(string(node, "value")?)),
        "boundary" => Ok(array(node, "children")?
            .iter()
            .map(markdown_node)
            .collect::<Result<Vec<_>, _>>()?
            .join("")),
        "element" => {
            let tag = string(node, "tag")?.to_ascii_lowercase();
            let children = array(node, "children")?;
            let rendered = children
                .iter()
                .map(markdown_node)
                .collect::<Result<Vec<_>, _>>()?
                .join("");
            let text = normalize_markdown(&rendered);
            if tag.len() == 2 && tag.starts_with('h') && matches!(tag.as_bytes()[1], b'1'..=b'6') {
                return Ok(format!(
                    "{} {text}",
                    "#".repeat((tag.as_bytes()[1] - b'0') as usize)
                ));
            }
            match tag.as_str() {
                "p" | "li" => Ok(text),
                "br" => Ok("  \n".to_owned()),
                "hr" => Ok("---".to_owned()),
                "strong" | "b" => Ok(format!("**{text}**")),
                "em" | "i" => Ok(format!("*{text}*")),
                "code" => Ok(format!("`{}`", plain_web_text(node)?.replace('`', "\\`"))),
                "pre" => Ok(format!("```\n{}\n```", plain_web_text(node)?)),
                "blockquote" => Ok(text
                    .lines()
                    .map(|line| format!("> {line}"))
                    .collect::<Vec<_>>()
                    .join("\n")),
                "a" => Ok(match web_attribute(node, "href")? {
                    Some(href) => format!(
                        "[{}]({})",
                        if text.is_empty() { href } else { &text },
                        escape_markdown_destination(href)
                    ),
                    None => text,
                }),
                "img" => Ok(match web_attribute(node, "src")? {
                    Some(source) => format!(
                        "![{}]({})",
                        escape_markdown(web_attribute(node, "alt")?.unwrap_or("")),
                        escape_markdown_destination(source)
                    ),
                    None => String::new(),
                }),
                "ul" | "ol" => {
                    let mut index = 0usize;
                    let mut items = Vec::new();
                    for child in children {
                        if string(child, "kind")? != "element"
                            || string(child, "tag")?.to_ascii_lowercase() != "li"
                        {
                            continue;
                        }
                        index += 1;
                        let marker = if tag == "ol" {
                            format!("{index}.")
                        } else {
                            "-".to_owned()
                        };
                        items.push(format!(
                            "{marker} {}",
                            markdown_node(child)?.replace('\n', "\n  ")
                        ));
                    }
                    Ok(items.join("\n"))
                }
                "address" | "article" | "aside" | "dd" | "details" | "dialog" | "div" | "dl"
                | "dt" | "fieldset" | "figcaption" | "figure" | "footer" | "form" | "header"
                | "main" | "nav" | "section" => Ok(normalize_markdown(
                    &children
                        .iter()
                        .map(markdown_node)
                        .collect::<Result<Vec<_>, _>>()?
                        .join("\n\n"),
                )),
                _ => Ok(rendered),
            }
        }
        _ => Err("unsupported web document node kind".to_owned()),
    }
}

fn plain_web_text(node: &Value) -> Result<String, String> {
    if string(node, "kind")? == "text" {
        return Ok(string(node, "value")?.to_owned());
    }
    Ok(array(node, "children")?
        .iter()
        .map(plain_web_text)
        .collect::<Result<Vec<_>, _>>()?
        .join(""))
}

fn web_attribute<'a>(node: &'a Value, name: &str) -> Result<Option<&'a str>, String> {
    for attribute in array(node, "attributes")? {
        if string(attribute, "name")? == name {
            return Ok(Some(string(attribute, "value")?));
        }
    }
    Ok(None)
}

fn normalize_markdown(value: &str) -> String {
    let mut output = value
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned();
    while output.contains("\n\n\n") {
        output = output.replace("\n\n\n", "\n\n");
    }
    output
}

fn escape_markdown(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>') {
            output.push('\\');
        }
        output.push(character);
    }
    output
}

fn escape_markdown_destination(value: &str) -> String {
    value
        .replace(' ', "%20")
        .replace('(', "%28")
        .replace(')', "%29")
}

fn render(document: &Value) -> Result<String, String> {
    validate_keys(
        document,
        &[
            "entry",
            "hydration",
            "language",
            "metadata",
            "preloads",
            "rendering",
            "root",
            "styles",
            "title",
            "version",
        ],
        "web document",
    )?;
    if document.get("version").and_then(Value::as_u64) != Some(4) {
        return Err("unsupported web document version".to_owned());
    }
    let rendering = string(document, "rendering")?;
    if rendering != "hydrate" && rendering != "client" {
        return Err("unsupported web document rendering mode".to_owned());
    }
    let language = string(document, "language")?;
    if language.is_empty()
        || language
            .chars()
            .any(|character| character.is_whitespace() || "\"'<>".contains(character))
    {
        return Err("invalid web document language".to_owned());
    }
    let entry = string(document, "entry")?;
    if !entry.starts_with('/') {
        return Err("web document entry must be absolute".to_owned());
    }
    let styles = document
        .get("styles")
        .and_then(Value::as_array)
        .ok_or_else(|| "web document styles must be an array".to_owned())?;
    let preloads = document
        .get("preloads")
        .and_then(Value::as_array)
        .ok_or_else(|| "web document preloads must be an array".to_owned())?;
    let metadata = document
        .get("metadata")
        .and_then(Value::as_object)
        .ok_or_else(|| "web document metadata must be an object".to_owned())?;
    let hydration = document
        .get("hydration")
        .ok_or_else(|| "web document hydration must be present".to_owned())?;
    validate_hydration(hydration)?;
    for preload in preloads {
        let preload = preload
            .as_str()
            .ok_or_else(|| "web document preload must be a string".to_owned())?;
        if !preload.starts_with('/') {
            return Err("web document preload must be absolute".to_owned());
        }
    }
    let root = document
        .get("root")
        .and_then(Value::as_array)
        .ok_or_else(|| "web document root must be an array".to_owned())?;
    if rendering == "client" && !root.is_empty() {
        return Err("client-rendered web document root must be empty".to_owned());
    }

    let mut output = String::from("<!doctype html><html lang=\"");
    escape_attribute(&mut output, language);
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
    let mut modules = vec![entry];
    for preload in preloads {
        let preload = preload.as_str().expect("validated preload");
        if !modules.contains(&preload) {
            modules.push(preload);
        }
    }
    for module in modules {
        output.push_str("<link rel=\"modulepreload\" href=\"");
        escape_attribute(&mut output, module);
        output.push_str("\">");
    }
    output.push_str("<title>");
    let title = string(document, "title")?;
    escape_text(&mut output, title);
    output.push_str("</title>");
    render_metadata(&mut output, metadata, title)?;
    output.push_str("</head><body><div id=\"app\" data-poggers-rendering=\"");
    output.push_str(rendering);
    output.push_str("\">");
    let mut identities = HashSet::new();
    for node in root {
        render_node(&mut output, node, &mut identities)?;
    }
    output.push_str("</div>");
    if hydration != &Value::Bool(false) {
        output.push_str("<script id=\"poggers-hydration\" type=\"application/json\">");
        let payload = serde_json::to_string(hydration)
            .map_err(|error| format!("encode web Route hydration: {error}"))?;
        escape_embedded_json(&mut output, &payload);
        output.push_str("</script>");
    }
    output.push_str("<script type=\"module\" async src=\"");
    escape_attribute(&mut output, entry);
    output.push_str("\"></script></body></html>");
    Ok(output)
}

fn validate_hydration(value: &Value) -> Result<(), String> {
    if value == &Value::Bool(false) {
        return Ok(());
    }
    validate_keys(
        value,
        &[
            "loader", "location", "metadata", "params", "route", "search", "version",
        ],
        "web Route hydration",
    )?;
    if value.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("unsupported web Route hydration version".to_owned());
    }
    let route = value
        .get("route")
        .ok_or_else(|| "web Route hydration identity is required".to_owned())?;
    validate_keys(route, &["feature", "name"], "web Route hydration identity")?;
    string(route, "feature")?;
    string(route, "name")?;
    let location = string(value, "location")?;
    if !location.starts_with('/') {
        return Err("web Route hydration location must be absolute".to_owned());
    }
    value
        .get("params")
        .and_then(Value::as_object)
        .ok_or_else(|| "web Route hydration params must be an object".to_owned())?;
    value
        .get("search")
        .and_then(Value::as_object)
        .ok_or_else(|| "web Route hydration search must be an object".to_owned())?;
    validate_web_metadata(
        value
            .get("metadata")
            .ok_or_else(|| "web Route hydration metadata must be present".to_owned())?,
        "web Route hydration metadata",
    )?;
    let loader = value
        .get("loader")
        .ok_or_else(|| "web Route hydration loader is required".to_owned())?;
    if loader != &Value::Bool(false) {
        validate_keys(loader, &["data"], "web Route hydration loader")?;
    }
    Ok(())
}

fn escape_embedded_json(output: &mut String, value: &str) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("\\u0026"),
            '<' => output.push_str("\\u003c"),
            '\u{2028}' => output.push_str("\\u2028"),
            '\u{2029}' => output.push_str("\\u2029"),
            character => output.push(character),
        }
    }
}

fn render_metadata(
    output: &mut String,
    metadata: &Map<String, Value>,
    document_title: &str,
) -> Result<(), String> {
    validate_web_metadata(&Value::Object(metadata.clone()), "web document metadata")?;
    write_meta(
        output,
        "name",
        "description",
        metadata_string(metadata, "description"),
    );
    write_meta(
        output,
        "name",
        "robots",
        metadata_string(metadata, "robots"),
    );
    if let Some(canonical) = metadata_string(metadata, "canonical") {
        write_link(
            output,
            &[("rel", Some("canonical")), ("href", Some(canonical))],
        );
    }
    for alternate in metadata
        .get("alternates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        write_link(
            output,
            &[
                ("rel", Some("alternate")),
                (
                    "hreflang",
                    alternate.get("language").and_then(Value::as_str),
                ),
                ("href", alternate.get("href").and_then(Value::as_str)),
            ],
        );
    }
    if let Some(social) = metadata.get("social").and_then(Value::as_object) {
        let social_title = metadata_string(social, "title").unwrap_or(document_title);
        let social_description = metadata_string(social, "description")
            .or_else(|| metadata_string(metadata, "description"));
        write_meta(output, "property", "og:title", Some(social_title));
        write_meta(output, "property", "og:description", social_description);
        write_meta(
            output,
            "property",
            "og:type",
            metadata_string(social, "type"),
        );
        write_meta(
            output,
            "property",
            "og:site_name",
            metadata_string(social, "siteName"),
        );
        write_meta(
            output,
            "name",
            "twitter:card",
            metadata_string(social, "card"),
        );
        write_meta(output, "name", "twitter:title", Some(social_title));
        write_meta(output, "name", "twitter:description", social_description);
        let images = social
            .get("images")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        for image in images {
            let image = image.as_object().expect("validated social image");
            write_meta(
                output,
                "property",
                "og:image",
                metadata_string(image, "url"),
            );
            write_meta(
                output,
                "property",
                "og:image:alt",
                metadata_string(image, "alt"),
            );
            write_meta_number(output, "og:image:width", image.get("width"));
            write_meta_number(output, "og:image:height", image.get("height"));
            write_meta(
                output,
                "property",
                "og:image:type",
                metadata_string(image, "type"),
            );
        }
        if let Some(image) = images.first().and_then(Value::as_object) {
            write_meta(
                output,
                "name",
                "twitter:image",
                metadata_string(image, "url"),
            );
            write_meta(
                output,
                "name",
                "twitter:image:alt",
                metadata_string(image, "alt"),
            );
        }
    }
    for icon in metadata
        .get("icons")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let icon = icon.as_object().expect("validated web icon");
        write_link(
            output,
            &[
                ("rel", Some(metadata_string(icon, "rel").unwrap_or("icon"))),
                ("href", metadata_string(icon, "url")),
                ("type", metadata_string(icon, "type")),
                ("sizes", metadata_string(icon, "sizes")),
                ("media", metadata_string(icon, "media")),
                ("color", metadata_string(icon, "color")),
            ],
        );
    }
    if let Some(manifest) = metadata_string(metadata, "manifest") {
        write_link(
            output,
            &[("rel", Some("manifest")), ("href", Some(manifest))],
        );
    }
    for value in metadata
        .get("structuredData")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        output.push_str("<script type=\"application/ld+json\" data-poggers-route-head>");
        let value = serde_json::to_string(value)
            .map_err(|error| format!("encode web structured data: {error}"))?;
        escape_embedded_json(output, &value);
        output.push_str("</script>");
    }
    if let Some(image) = metadata.get("priorityImage").and_then(Value::as_object) {
        write_link(
            output,
            &[
                ("rel", Some("preload")),
                ("as", Some("image")),
                ("fetchpriority", Some("high")),
                ("href", metadata_string(image, "url")),
                ("imagesrcset", metadata_string(image, "sourceSet")),
                ("imagesizes", metadata_string(image, "sizes")),
                ("type", metadata_string(image, "type")),
            ],
        );
    }
    Ok(())
}

fn metadata_string<'a>(metadata: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    metadata.get(name).and_then(Value::as_str)
}

fn write_meta(output: &mut String, identity: &str, name: &str, content: Option<&str>) {
    let Some(content) = content else {
        return;
    };
    output.push_str("<meta ");
    output.push_str(identity);
    output.push_str("=\"");
    escape_attribute(output, name);
    output.push_str("\" content=\"");
    escape_attribute(output, content);
    output.push_str("\" data-poggers-route-head>");
}

fn write_meta_number(output: &mut String, name: &str, value: Option<&Value>) {
    if let Some(value) = value.and_then(Value::as_u64) {
        write_meta(output, "property", name, Some(&value.to_string()));
    }
}

fn write_link(output: &mut String, attributes: &[(&str, Option<&str>)]) {
    output.push_str("<link");
    for (name, value) in attributes {
        let Some(value) = value else {
            continue;
        };
        output.push(' ');
        output.push_str(name);
        if !value.is_empty() {
            output.push_str("=\"");
            escape_attribute(output, value);
            output.push('"');
        }
    }
    output.push_str(" data-poggers-route-head>");
}

fn render_deferred_frame(frame: &Value) -> Result<String, String> {
    validate_keys(
        frame,
        &["boundary", "field", "root", "state", "version"],
        "web deferred frame",
    )?;
    if frame.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("unsupported web deferred frame version".to_owned());
    }
    let boundary = string(frame, "boundary")?;
    let field = string(frame, "field")?;
    if !valid_deferred_boundary(boundary) || !valid_identifier(field) {
        return Err("invalid web deferred frame identity".to_owned());
    }
    let state = required(frame, "state")?;
    let status = string(state, "status")?;
    match status {
        "resolved" => validate_keys(state, &["status", "value"], "resolved web deferred state")?,
        "rejected" => {
            validate_keys(state, &["error", "status"], "rejected web deferred state")?;
            let error = required(state, "error")?;
            validate_keys(error, &["message"], "web deferred error")?;
            string(error, "message")?;
        }
        _ => return Err("invalid web deferred frame state".to_owned()),
    }
    let mut output = String::from("<template data-poggers-deferred-frame=\"");
    escape_attribute(&mut output, boundary);
    output.push_str("\" data-poggers-deferred-field=\"");
    escape_attribute(&mut output, field);
    output.push_str("\">");
    let mut identities = HashSet::new();
    for node in array(frame, "root")? {
        render_node(&mut output, node, &mut identities)?;
    }
    output.push_str("</template><script type=\"application/json\" data-poggers-deferred-state=\"");
    escape_attribute(&mut output, boundary);
    output.push_str("\">");
    let payload = serde_json::to_string(state)
        .map_err(|error| format!("encode web deferred state: {error}"))?;
    escape_embedded_json(&mut output, &payload);
    output.push_str("</script>");
    Ok(output)
}

fn render_node(
    output: &mut String,
    node: &Value,
    identities: &mut HashSet<String>,
) -> Result<(), String> {
    let kind = string(node, "kind")?;
    if kind == "boundary" {
        validate_keys(
            node,
            &["boundary", "children", "field", "kind"],
            "web deferred boundary",
        )?;
        let boundary = string(node, "boundary")?;
        let field = string(node, "field")?;
        if !valid_deferred_boundary(boundary)
            || !valid_identifier(field)
            || !identities.insert(boundary.to_owned())
        {
            return Err("invalid web deferred boundary".to_owned());
        }
        output.push_str("<template data-poggers-boundary-start=\"");
        escape_attribute(output, boundary);
        output.push_str("\" data-poggers-deferred-field=\"");
        escape_attribute(output, field);
        output.push_str("\"></template>");
        for child in array(node, "children")? {
            render_node(output, child, identities)?;
        }
        output.push_str("<template data-poggers-boundary-end=\"");
        escape_attribute(output, boundary);
        output.push_str("\"></template>");
        return Ok(());
    }
    let hydration = string(node, "hydration")?;
    if !valid_hydration(hydration) || !identities.insert(hydration.to_owned()) {
        return Err("invalid web hydration identity".to_owned());
    }
    if kind == "text" {
        validate_keys(node, &["hydration", "kind", "value"], "web text node")?;
        if hydration
            .rsplit_once(':')
            .map_or(hydration, |(_, value)| value)
            .starts_with('t')
            == false
        {
            return Err("web text hydration identity must start with t".to_owned());
        }
        output.push_str("<!--poggers:");
        output.push_str(hydration);
        output.push_str("-->");
        escape_text(output, string(node, "value")?);
        return Ok(());
    }
    if kind != "element" {
        return Err(format!("unsupported web document node {kind}"));
    }
    validate_keys(
        node,
        &["attributes", "children", "hydration", "kind", "tag"],
        "web element node",
    )?;
    if hydration
        .rsplit_once(':')
        .map_or(hydration, |(_, value)| value)
        .starts_with('e')
        == false
    {
        return Err("web element hydration identity must start with e".to_owned());
    }
    let tag = string(node, "tag")?;
    if !valid_name(tag, false) {
        return Err(format!("invalid web element {tag}"));
    }
    write!(output, "<{tag}").expect("write to String");
    let attributes = node
        .get("attributes")
        .and_then(Value::as_array)
        .ok_or_else(|| "web element attributes must be an array".to_owned())?;
    let mut names = HashSet::new();
    let mut hydration_attribute = None;
    for attribute in attributes {
        validate_keys(attribute, &["name", "value"], "web element attribute")?;
        let name = string(attribute, "name")?;
        if !valid_name(name, true) {
            return Err(format!("invalid web attribute {name}"));
        }
        let value = string(attribute, "value")?;
        if !names.insert(name) {
            return Err(format!("duplicate web attribute {name}"));
        }
        if name == "data-poggers-h" {
            hydration_attribute = Some(value);
        }
        output.push(' ');
        output.push_str(name);
        if !value.is_empty() {
            output.push_str("=\"");
            escape_attribute(output, value);
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
        return children
            .is_empty()
            .then_some(())
            .ok_or_else(|| format!("void web element {tag} cannot have children"));
    }
    for child in children {
        render_node(output, child, identities)?;
    }
    write!(output, "</{tag}>").expect("write to String");
    Ok(())
}

fn string<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("web document {name} must be a string"))
}

fn validate_keys(value: &Value, expected: &[&str], subject: &str) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{subject} must be an object"))?;
    if object.len() != expected.len() || expected.iter().any(|name| !object.contains_key(*name)) {
        return Err(format!("{subject} has unsupported fields"));
    }
    Ok(())
}

fn validate_allowed_keys(
    value: &Value,
    required: &[&str],
    optional: &[&str],
    subject: &str,
) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{subject} must be an object"))?;
    if required.iter().any(|name| !object.contains_key(*name))
        || object
            .keys()
            .any(|name| !required.contains(&name.as_str()) && !optional.contains(&name.as_str()))
    {
        return Err(format!("{subject} has unsupported fields"));
    }
    Ok(())
}

fn required<'a>(value: &'a Value, name: &str) -> Result<&'a Value, String> {
    value
        .get(name)
        .ok_or_else(|| format!("web artifact field {name} is required"))
}

fn array<'a>(value: &'a Value, name: &str) -> Result<&'a Vec<Value>, String> {
    required(value, name)?
        .as_array()
        .ok_or_else(|| format!("web artifact field {name} must be an array"))
}

fn string_array<'a>(value: &'a Value, name: &str) -> Result<Vec<&'a str>, String> {
    array(value, name)?
        .iter()
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| format!("web artifact field {name} must contain strings"))
        })
        .collect()
}

fn valid_hydration(value: &str) -> bool {
    let value = match value.rsplit_once(':') {
        Some((boundary, value)) if valid_deferred_boundary(boundary) => value,
        Some(_) => return false,
        None => value,
    };
    let mut characters = value.chars();
    matches!(characters.next(), Some('e' | 't'))
        && characters.clone().next().is_some()
        && characters.all(|character| character.is_ascii_digit())
}

fn valid_deferred_boundary(value: &str) -> bool {
    let Some(index) = value.strip_prefix('d') else {
        return false;
    };
    !index.is_empty() && index.chars().all(|character| character.is_ascii_digit())
}

fn valid_name(value: &str, attribute: bool) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
        && characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '-'
                || (attribute && matches!(character, '_' | '.' | ':'))
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

fn escape_text(output: &mut String, value: &str) {
    escape(output, value, false);
}

fn escape_attribute(output: &mut String, value: &str) {
    escape(output, value, true);
}

fn escape(output: &mut String, value: &str, attribute: bool) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' if attribute => output.push_str("&quot;"),
            '\'' if attribute => output.push_str("&#39;"),
            _ => output.push(character),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn document() -> Value {
        json!({
            "version": 4,
            "rendering": "hydrate",
            "language": "en",
            "title": "A < B & C",
            "metadata": {},
            "entry": "/app.js",
            "preloads": ["/shared.js"],
            "styles": [".root{color:red}"],
            "hydration": false,
            "root": [{
                "kind": "element",
                "hydration": "e0",
                "tag": "main",
                "attributes": [
                    { "name": "class", "value": "root" },
                    { "name": "data-poggers-h", "value": "e0" }
                ],
                "children": [{ "kind": "text", "hydration": "t0", "value": "<script>&\"'" }]
            }]
        })
    }

    #[test]
    fn renders_and_escapes_the_versioned_document() {
        let rendered = render(&document()).expect("render document");
        assert!(rendered.contains("<title>A &lt; B &amp; C</title>"));
        assert!(rendered.contains("<link rel=\"modulepreload\" href=\"/app.js\">"));
        assert!(rendered.contains("<link rel=\"modulepreload\" href=\"/shared.js\">"));
        assert!(rendered.contains("<!--poggers:t0-->&lt;script&gt;&amp;\"'"));
    }

    #[test]
    fn renders_markdown_from_the_same_versioned_document() {
        let rendered = render_markdown(&document()).expect("render Markdown");
        assert!(rendered.starts_with("---\ntitle: \"A < B & C\"\nlanguage: \"en\"\n---\n"));
        assert!(rendered.contains("\\<script\\>&\"'"));
    }

    #[test]
    fn renders_an_empty_client_owned_document() {
        let mut client = document();
        client["rendering"] = json!("client");
        client["root"] = json!([]);
        let rendered = render(&client).expect("render client document");
        assert!(rendered.contains("data-poggers-rendering=\"client\"></div>"));

        client["root"] = document()["root"].clone();
        assert!(render(&client).is_err());
    }

    #[test]
    fn rejects_unsafe_or_ambiguous_documents() {
        let mut style = document();
        style["styles"] = json!(["</style><script>"]);
        assert!(render(&style).is_err());

        let mut duplicate = document();
        duplicate["root"][0]["children"][0]["hydration"] = json!("e0");
        assert!(render(&duplicate).is_err());
    }

    #[test]
    fn renders_request_ir_with_components_and_safe_hydration_data() {
        let components = component_map(vec![json!({
            "feature": "tasks",
            "name": "Card",
            "elements": { "Root": "article", "Title": "h2" },
            "state": { "expanded": true },
            "view": {
                "kind": "element",
                "element": "Root",
                "tag": "article",
                "attributes": [{
                    "name": "data-kind",
                    "value": { "kind": "path", "root": "props", "path": ["kind"] }
                }],
                "children": [{
                    "kind": "element",
                    "element": "Title",
                    "tag": "h2",
                    "attributes": [],
                    "children": [{
                        "kind": "text",
                        "value": { "kind": "path", "root": "props", "path": ["title"] }
                    }]
                }]
            },
            "span": { "file": "feature.tsx", "line": 1, "column": 1, "length": 1 }
        })])
        .expect("compiled Components");
        let renderer = WebDocument {
            fallback: document_content(&document()).expect("fallback"),
            routes: Vec::new(),
            components,
        };
        let request = WebRenderRequest {
            route: "tasks.detail".to_owned(),
            location: "/tasks/42".to_owned(),
            params: json!({ "id": "42" }),
            search: json!({}),
            loader: true,
            deferred: Vec::new(),
            shared: false,
            response_cache: None,
            markdown: true,
            document: document(),
            view: json!({
                "kind": "component",
                "target": "tasks.Card",
                "props": [
                    {
                        "name": "title",
                        "node": false,
                        "value": { "kind": "path", "root": "data", "path": ["title"] }
                    },
                    {
                        "name": "kind",
                        "node": false,
                        "value": { "kind": "literal", "value": "request" }
                    }
                ]
            }),
            cache_control: "private, no-store".to_owned(),
        };
        let outcome = renderer
            .render_request(
                &request,
                Some(json!({
                    "data": { "title": "</script><script>bad()</script>" },
                    "metadata": { "title": "Task 42" }
                })),
            )
            .expect("render request");
        let WebLoaderOutcome::Document { html, .. } = outcome else {
            panic!("expected document");
        };
        assert!(html.contains("<title>Task 42</title>"));
        assert!(html.contains("&lt;/script&gt;&lt;script&gt;bad()&lt;/script&gt;"));
        assert!(html.contains("\\u003c/script>\\u003cscript>bad()\\u003c/script>"));
        assert!(!html.contains("</script><script>bad()"));
    }

    #[test]
    fn matches_static_parameter_and_wildcard_routes() {
        let route = |path: &str| RouteDefinition {
            feature: "test".to_owned(),
            name: "route".to_owned(),
            path: path.to_owned(),
            document: "shell".to_owned(),
            cache: RouteCache::Disabled(false),
            metadata: json!({}),
            params: path
                .split('/')
                .filter(|segment| segment.starts_with(':') || segment.starts_with('*'))
                .map(|segment| RouteParameter {
                    name: segment[1..].to_owned(),
                    kind: "string".to_owned(),
                    optional: false,
                    repeated: false,
                    values: None,
                    integer: false,
                    minimum: None,
                    maximum: None,
                    minimum_length: None,
                    maximum_length: None,
                    format: None,
                    default: None,
                })
                .collect(),
            search: Vec::new(),
            deferred: Vec::new(),
        };
        assert!(
            route_match(&route("/tasks"), "/tasks/", None)
                .unwrap()
                .is_some()
        );
        assert!(
            route_match(&route("/tasks/:id"), "/tasks/one", None)
                .unwrap()
                .is_some()
        );
        assert!(
            route_match(&route("/tasks/:id"), "/tasks/one/more", None)
                .unwrap()
                .is_none()
        );
        assert!(
            route_match(&route("/files/*rest"), "/files/a/b", None)
                .unwrap()
                .is_some()
        );
        assert!(
            route_match(&route("/tasks/new"), "/tasks/one", None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn decodes_and_validates_the_compiler_route_manifest() {
        let route: RouteDefinition = serde_json::from_value(json!({
            "feature": "tasks",
            "name": "edit",
            "path": "/tasks/:id",
            "document": "shell",
            "cache": false,
            "metadata": {},
            "params": [{
                "name": "id",
                "kind": "string",
                "optional": false,
                "format": "uuid"
            }],
            "search": [
                {
                    "name": "page",
                    "kind": "number",
                    "optional": false,
                    "integer": true,
                    "minimum": 1,
                    "default": 1
                },
                {
                    "name": "tag",
                    "kind": "string",
                    "optional": true,
                    "repeated": true,
                    "maximumLength": 4
                }
            ]
        }))
        .expect("decode route");
        let id = "8da942a4-835f-4d4e-bc08-89545d523963";

        assert!(
            route_match(&route, &format!("/tasks/{id}"), None)
                .unwrap()
                .is_some()
        );
        assert!(
            route_match(&route, &format!("/tasks/{id}"), Some("page=2&tag=a&tag=b"))
                .unwrap()
                .is_some()
        );
        assert!(route_match(&route, "/tasks/not-a-uuid", None).is_err());
        assert!(route_match(&route, &format!("/tasks/{id}"), Some("page=1.5")).is_err());
        assert!(route_match(&route, &format!("/tasks/{id}"), Some("tag=longer")).is_err());
        assert!(route_match(&route, "/tasks/%FF", None).is_err());
    }

    #[test]
    fn renders_validated_cache_policy_without_special_cases() {
        let cache = RouteCache::Policy(RouteCachePolicy {
            scope: "public".to_owned(),
            max_age: Some("2h".to_owned()),
            stale_while_revalidate: Some("30s".to_owned()),
        });
        assert_eq!(
            cache_control(&cache).unwrap(),
            "public, max-age=7200, stale-while-revalidate=30"
        );
        assert_eq!(duration_seconds("1500ms").unwrap(), 2);
        assert!(duration_seconds("18446744073709551615d").is_err());
        assert_eq!(
            cache_control(&RouteCache::Disabled(false)).unwrap(),
            "no-store"
        );
        assert_eq!(
            cache_control(&RouteCache::Policy(RouteCachePolicy {
                scope: "private".to_owned(),
                max_age: None,
                stale_while_revalidate: None,
            }))
            .unwrap(),
            "private, no-store"
        );
    }
}
