use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    task::{Context, Poll},
    time::{SystemTime, UNIX_EPOCH},
};

use futures_util::{Stream, StreamExt, task::noop_waker_ref};
use indexmap::IndexMap;
use serde_json::{Map as JsonMap, Value as JsonValue};

pub type NativeResult<T> = Result<T, NativeError>;
pub type NativeFuture<T> = Pin<Box<dyn Future<Output = NativeResult<T>> + Send>>;
pub type NativeStream = Pin<Box<dyn Stream<Item = NativeResult<Value>> + Send>>;
pub type Record = IndexMap<String, Value>;

const DEFERRED_DEPENDENCY_INVOCATION: &str = "kit.dependency.deferred-invocation";

#[derive(Clone)]
pub enum Value {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(String),
    Array(Arc<Mutex<Vec<Value>>>),
    Record(Arc<Record>),
    MutableRecord(Arc<Mutex<Record>>),
    Function(NativeFunction),
    Dependency(String),
    InterceptedDependency(NativeFunction),
    Stream(Arc<tokio::sync::Mutex<NativeStream>>),
    Error(Arc<NativeError>),
}

#[derive(Clone)]
pub struct NativeFunction(Arc<dyn Fn(Engine, Vec<Value>) -> NativeFuture<Value> + Send + Sync>);

impl NativeFunction {
    pub fn new(
        function: impl Fn(Engine, Vec<Value>) -> NativeFuture<Value> + Send + Sync + 'static,
    ) -> Self {
        Self(Arc::new(function))
    }

    fn call(&self, engine: Engine, arguments: Vec<Value>) -> NativeFuture<Value> {
        (self.0)(engine, arguments)
    }

    fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl fmt::Debug for Value {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Undefined => formatter.write_str("undefined"),
            Self::Null => formatter.write_str("null"),
            Self::Boolean(value) => value.fmt(formatter),
            Self::Number(value) => value.fmt(formatter),
            Self::String(value) => value.fmt(formatter),
            Self::Array(value) => lock(value).fmt(formatter),
            Self::Record(value) => value.fmt(formatter),
            Self::MutableRecord(value) => lock(value).fmt(formatter),
            Self::Function(_) => formatter.write_str("NativeFunction"),
            Self::Dependency(value) => write!(formatter, "Dependency({value})"),
            Self::InterceptedDependency(_) => formatter.write_str("InterceptedDependency"),
            Self::Stream(_) => formatter.write_str("Stream"),
            Self::Error(value) => value.fmt(formatter),
        }
    }
}

#[derive(Clone, Debug)]
pub struct NativeError {
    pub name: String,
    pub message: String,
    pub fields: BTreeMap<String, Value>,
}

impl NativeError {
    pub fn new(name: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            message: message.into(),
            fields: BTreeMap::new(),
        }
    }

    pub fn with_field(mut self, name: impl Into<String>, value: Value) -> Self {
        self.fields.insert(name.into(), value);
        self
    }
}

impl fmt::Display for NativeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.name, self.message)
    }
}

impl std::error::Error for NativeError {}

pub trait Dependency: Send + Sync {
    fn start(&self, _engine: Engine) -> NativeFuture<()> {
        Box::pin(async { Ok(()) })
    }

    fn call(
        &self,
        engine: Engine,
        operation: &str,
        input: Value,
        invocation: DependencyInvocation,
    ) -> NativeFuture<Value>;

    fn shutdown(&self) -> NativeFuture<()> {
        Box::pin(async { Ok(()) })
    }
}

/** Adapter-owned routing for compiler-declared provided Dependencies. */
pub trait DependencyRouter: Send + Sync {
    fn handles(&self, name: &str) -> bool;

    fn route(
        &self,
        engine: Engine,
        name: &str,
        operation: &str,
        input: Value,
        invocation: DependencyInvocation,
    ) -> NativeFuture<Value>;

    fn shutdown(&self) -> NativeFuture<()> {
        Box::pin(async { Ok(()) })
    }
}

type DependencyHeartbeat = Arc<dyn Fn(Value) -> NativeResult<()> + Send + Sync>;
type DependencyDefer = Arc<dyn Fn(String) -> NativeResult<Value> + Send + Sync>;
type DependencyAuthorityAssert = Arc<dyn Fn() -> NativeFuture<()> + Send + Sync>;

#[derive(Default)]
struct DependencyCancellationState {
    requested: Arc<AtomicBool>,
    notification: Arc<tokio::sync::Notify>,
    reason: Mutex<Option<String>>,
}

#[derive(Clone, Default)]
pub struct DependencyCancellation {
    state: Arc<DependencyCancellationState>,
    parent: Option<Arc<DependencyCancellation>>,
    inherits_parent: bool,
}

impl DependencyCancellation {
    pub fn requested(&self) -> bool {
        self.state.requested.load(Ordering::SeqCst)
            || (self.inherits_parent
                && self
                    .parent
                    .as_ref()
                    .is_some_and(|parent| parent.requested()))
    }

    pub fn reason(&self) -> Option<String> {
        if self.state.requested.load(Ordering::SeqCst) {
            return lock(&self.state.reason).clone();
        }
        if self.inherits_parent {
            return self.parent.as_ref().and_then(|parent| parent.reason());
        }
        None
    }

    pub fn child(&self, inherits_parent: bool) -> Self {
        Self {
            state: Arc::new(DependencyCancellationState::default()),
            parent: Some(Arc::new(self.clone())),
            inherits_parent,
        }
    }

    pub fn request(&self) {
        self.request_with_reason(None);
    }

    pub fn request_with_reason(&self, reason: Option<String>) {
        if !self.state.requested.swap(true, Ordering::SeqCst) {
            *lock(&self.state.reason) = reason;
            self.state.notification.notify_waiters();
        }
    }

    pub async fn wait(&self) {
        if self.requested() {
            return;
        }
        let notified = self.state.notification.notified();
        if self.requested() {
            return;
        }
        if self.inherits_parent
            && let Some(parent) = &self.parent
        {
            tokio::select! {
                _ = notified => {}
                _ = Box::pin(parent.wait()) => {}
            }
        } else {
            notified.await;
        }
    }
}

#[derive(Clone)]
pub struct DependencyAuthority {
    pub scope: String,
    pub owner: String,
    pub failure_epoch: u64,
    pub epoch: u64,
    pub expires_at: f64,
    assertion: Option<DependencyAuthorityAssert>,
}

impl DependencyAuthority {
    pub fn new(
        scope: impl Into<String>,
        owner: impl Into<String>,
        failure_epoch: u64,
        epoch: u64,
        expires_at: f64,
    ) -> Self {
        Self {
            scope: scope.into(),
            owner: owner.into(),
            failure_epoch,
            epoch,
            expires_at,
            assertion: None,
        }
    }

    pub fn with_assertion(
        mut self,
        assertion: impl Fn() -> NativeFuture<()> + Send + Sync + 'static,
    ) -> Self {
        self.assertion = Some(Arc::new(assertion));
        self
    }

    pub async fn assert(&self) -> NativeResult<()> {
        match &self.assertion {
            Some(assertion) => assertion().await,
            None => Ok(()),
        }
    }
}

impl fmt::Debug for DependencyAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DependencyAuthority")
            .field("scope", &self.scope)
            .field("owner", &self.owner)
            .field("failure_epoch", &self.failure_epoch)
            .field("epoch", &self.epoch)
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyTrace {
    pub traceparent: String,
    pub tracestate: Option<String>,
    pub baggage: Option<String>,
}

#[derive(Clone)]
pub struct DependencyInvocation {
    pub id: String,
    pub attempt: u64,
    pub scheduled_at: f64,
    pub started_at: f64,
    pub deadline: Option<f64>,
    pub previous_heartbeat: Option<Value>,
    pub trace: Option<DependencyTrace>,
    pub authority: Option<DependencyAuthority>,
    heartbeat: Option<DependencyHeartbeat>,
    defer: Option<DependencyDefer>,
    pub cancellation: DependencyCancellation,
}

impl fmt::Debug for DependencyInvocation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DependencyInvocation")
            .field("id", &self.id)
            .field("attempt", &self.attempt)
            .field("scheduled_at", &self.scheduled_at)
            .field("started_at", &self.started_at)
            .field("deadline", &self.deadline)
            .field("previous_heartbeat", &self.previous_heartbeat)
            .field("trace", &self.trace)
            .finish_non_exhaustive()
    }
}

impl DependencyInvocation {
    pub fn new(
        id: impl Into<String>,
        attempt: u64,
        scheduled_at: f64,
        started_at: f64,
        deadline: Option<f64>,
    ) -> Self {
        Self {
            id: id.into(),
            attempt,
            scheduled_at,
            started_at,
            deadline,
            previous_heartbeat: None,
            trace: None,
            authority: None,
            heartbeat: None,
            defer: None,
            cancellation: DependencyCancellation::default(),
        }
    }

    pub fn direct(name: &str, operation: &str, sequence: u64) -> NativeResult<Self> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| NativeError::new("ClockFailure", error.to_string()))?
            .as_secs_f64()
            * 1_000.0;
        Ok(Self::new(
            format!("direct:{name}:{operation}:{sequence}"),
            1,
            now,
            now,
            None,
        ))
    }

    pub fn with_controls(
        mut self,
        previous_heartbeat: Option<Value>,
        heartbeat: impl Fn(Value) -> NativeResult<()> + Send + Sync + 'static,
        defer: impl Fn(String) -> NativeResult<Value> + Send + Sync + 'static,
        cancellation: DependencyCancellation,
    ) -> Self {
        self.previous_heartbeat = previous_heartbeat;
        self.heartbeat = Some(Arc::new(heartbeat));
        self.defer = Some(Arc::new(defer));
        self.cancellation = cancellation;
        self
    }

    pub fn with_authority(mut self, authority: DependencyAuthority) -> Self {
        self.authority = Some(authority);
        self
    }

    pub fn with_trace(
        mut self,
        traceparent: impl Into<String>,
        tracestate: Option<String>,
        baggage: Option<String>,
    ) -> Self {
        self.trace = Some(DependencyTrace {
            traceparent: traceparent.into(),
            tracestate,
            baggage,
        });
        self
    }

    pub fn heartbeat(&self, details: Value) -> NativeResult<()> {
        self.heartbeat
            .as_ref()
            .map_or_else(|| Ok(()), |heartbeat| heartbeat(details))
    }

    pub fn defer(&self, id: impl Into<String>) -> NativeResult<Value> {
        let defer = self.defer.as_ref().ok_or_else(|| {
            NativeError::new(
                "InvalidDependencyInvocation",
                "Direct Dependency invocations cannot be completed externally.",
            )
        })?;
        defer(id.into())
    }

    fn to_value(&self) -> Value {
        let heartbeat = self.heartbeat.clone();
        let defer = self.defer.clone();
        let requested = self.cancellation.clone();
        let wait = self.cancellation.clone();
        let mut value = IndexMap::from([
            ("id".to_owned(), Value::String(self.id.clone())),
            ("attempt".to_owned(), Value::Number(self.attempt as f64)),
            ("scheduledAt".to_owned(), Value::Number(self.scheduled_at)),
            ("startedAt".to_owned(), Value::Number(self.started_at)),
            (
                "heartbeat".to_owned(),
                Value::Function(NativeFunction::new(move |_engine, arguments| {
                    let heartbeat = heartbeat.clone();
                    Box::pin(async move {
                        let input = arguments
                            .into_iter()
                            .next()
                            .ok_or_else(|| {
                                NativeError::new("TypeError", "heartbeat requires input.")
                            })?
                            .as_record()?;
                        let details = input.get("details").cloned().ok_or_else(|| {
                            NativeError::new("TypeError", "Heartbeat details are required.")
                        })?;
                        if let Some(heartbeat) = heartbeat {
                            heartbeat(details)?;
                        }
                        Ok(Value::Undefined)
                    })
                })),
            ),
            (
                "defer".to_owned(),
                Value::Function(NativeFunction::new(move |_engine, arguments| {
                    let defer = defer.clone();
                    Box::pin(async move {
                        let input = arguments
                            .into_iter()
                            .next()
                            .ok_or_else(|| NativeError::new("TypeError", "defer requires input."))?
                            .as_record()?;
                        let id = input
                            .get("id")
                            .ok_or_else(|| {
                                NativeError::new(
                                    "TypeError",
                                    "Deferred Dependency invocation id is required.",
                                )
                            })?
                            .clone()
                            .string()?;
                        if id.is_empty() {
                            return Err(NativeError::new(
                                "TypeError",
                                "Deferred Dependency invocation id is required.",
                            ));
                        }
                        let defer = defer.ok_or_else(|| {
                            NativeError::new(
                                "InvalidDependencyInvocation",
                                "Direct Dependency invocations cannot be completed externally.",
                            )
                        })?;
                        defer(id)
                    })
                })),
            ),
            (
                "cancellation".to_owned(),
                Value::record(IndexMap::from([
                    (
                        "requested".to_owned(),
                        Value::Function(NativeFunction::new(move |_engine, _arguments| {
                            let requested = requested.clone();
                            Box::pin(async move { Ok(Value::Boolean(requested.requested())) })
                        })),
                    ),
                    (
                        "wait".to_owned(),
                        Value::Function(NativeFunction::new(move |_engine, _arguments| {
                            let wait = wait.clone();
                            Box::pin(async move {
                                wait.wait().await;
                                Ok(Value::Undefined)
                            })
                        })),
                    ),
                ])),
            ),
            (
                "fail".to_owned(),
                Value::Function(NativeFunction::new(|_engine, arguments| {
                    Box::pin(async move {
                        let input = arguments
                            .into_iter()
                            .next()
                            .ok_or_else(|| NativeError::new("TypeError", "fail requires input."))?
                            .as_record()?;
                        let failure_type = input
                            .get("type")
                            .ok_or_else(|| {
                                NativeError::new("TypeError", "Failure type is required.")
                            })?
                            .clone()
                            .string()?;
                        let message = input
                            .get("message")
                            .filter(|value| !value.is_undefined())
                            .map(|value| value.clone().string())
                            .transpose()?
                            .unwrap_or_else(|| failure_type.clone());
                        let mut error = NativeError::new(failure_type, message);
                        if let Some(data) = input.get("data").filter(|value| !value.is_undefined())
                        {
                            error = error.with_field("data", data.clone());
                        }
                        if let Some(retry) =
                            input.get("retry").filter(|value| !value.is_undefined())
                        {
                            let delay = retry
                                .as_record()?
                                .get("delay")
                                .ok_or_else(|| {
                                    NativeError::new(
                                        "TypeError",
                                        "Dependency retry delay is required.",
                                    )
                                })?
                                .number()?;
                            if !delay.is_finite()
                                || delay.fract() != 0.0
                                || !(0.0..=9_007_199_254_740_991.0).contains(&delay)
                            {
                                return Err(NativeError::new(
                                    "TypeError",
                                    "Dependency retry delay must be a non-negative safe integer.",
                                ));
                            }
                            error = error.with_field("retryDelay", Value::Number(delay));
                        }
                        Err(error)
                    })
                })),
            ),
        ]);
        if let Some(deadline) = self.deadline {
            value.insert("deadline".to_owned(), Value::Number(deadline));
        }
        if let Some(previous_heartbeat) = &self.previous_heartbeat {
            value.insert("previousHeartbeat".to_owned(), previous_heartbeat.clone());
        }
        if let Some(trace) = &self.trace {
            let mut fields = IndexMap::from([(
                "traceparent".to_owned(),
                Value::String(trace.traceparent.clone()),
            )]);
            if let Some(tracestate) = &trace.tracestate {
                fields.insert("tracestate".to_owned(), Value::String(tracestate.clone()));
            }
            if let Some(baggage) = &trace.baggage {
                fields.insert("baggage".to_owned(), Value::String(baggage.clone()));
            }
            value.insert("trace".to_owned(), Value::record(fields));
        }
        if let Some(authority) = &self.authority {
            let assertion = authority.clone();
            value.insert(
                "authority".to_owned(),
                Value::record(IndexMap::from([
                    ("scope".to_owned(), Value::String(authority.scope.clone())),
                    ("owner".to_owned(), Value::String(authority.owner.clone())),
                    (
                        "failureEpoch".to_owned(),
                        Value::Number(authority.failure_epoch as f64),
                    ),
                    ("epoch".to_owned(), Value::Number(authority.epoch as f64)),
                    ("expiresAt".to_owned(), Value::Number(authority.expires_at)),
                    (
                        "assert".to_owned(),
                        Value::Function(NativeFunction::new(move |_engine, _arguments| {
                            let assertion = assertion.clone();
                            Box::pin(async move {
                                assertion.assert().await?;
                                Ok(Value::Undefined)
                            })
                        })),
                    ),
                ])),
            );
        }
        Value::record(value)
    }
}

#[derive(Clone, Debug)]
pub enum TypeContract {
    Primitive(&'static str),
    Opaque(&'static str),
    LiteralBoolean(bool),
    LiteralNumber(f64),
    LiteralString(&'static str),
    Array(Box<TypeContract>),
    Tuple(Vec<TypeContract>),
    Option(Box<TypeContract>),
    Union(Vec<TypeContract>),
    Record(Vec<FieldContract>),
    Stream(Box<TypeContract>),
    Function,
}

#[derive(Clone, Debug)]
pub struct FieldContract {
    pub name: &'static str,
    pub optional: bool,
    pub value: TypeContract,
}

#[derive(Clone, Debug)]
pub struct OperationContract {
    pub name: &'static str,
    pub input: TypeContract,
    pub output: TypeContract,
}

/** Enforces the compiler-derived semantic Dependency contract around one host implementation. */
pub struct ContractDependency<Implementation> {
    name: &'static str,
    operations: BTreeMap<&'static str, OperationContract>,
    implementation: Implementation,
}

impl<Implementation> ContractDependency<Implementation> {
    pub fn new(
        name: &'static str,
        operations: Vec<OperationContract>,
        implementation: Implementation,
    ) -> NativeResult<Self> {
        let mut indexed = BTreeMap::new();
        for operation in operations {
            if indexed.insert(operation.name, operation).is_some() {
                return Err(NativeError::new(
                    "InvalidDependencyContract",
                    format!("Dependency {name:?} declares a duplicate operation."),
                ));
            }
        }
        Ok(Self {
            name,
            operations: indexed,
            implementation,
        })
    }
}

impl<Implementation> Dependency for ContractDependency<Implementation>
where
    Implementation: Dependency + 'static,
{
    fn start(&self, engine: Engine) -> NativeFuture<()> {
        self.implementation.start(engine)
    }

    fn call(
        &self,
        engine: Engine,
        operation: &str,
        input: Value,
        invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        // Operations prefixed with @ are private adapter integration, never Program API.
        if operation.starts_with('@') {
            return self
                .implementation
                .call(engine, operation, input, invocation);
        }
        let Some(contract) = self.operations.get(operation).cloned() else {
            let name = self.name;
            let operation = operation.to_owned();
            return Box::pin(async move {
                Err(NativeError::new(
                    "UnknownOperation",
                    format!("Dependency {name:?} has no operation {operation:?}."),
                ))
            });
        };
        let path = format!("{}.{} input", self.name, operation);
        if let Err(error) = validate_value(&input, &contract.input, &path) {
            return Box::pin(async move { Err(error) });
        }
        let output = self
            .implementation
            .call(engine, operation, input, invocation);
        let path = format!("{}.{} output", self.name, operation);
        Box::pin(async move {
            let value = output.await?;
            validate_value(&value, &contract.output, &path)?;
            Ok(value)
        })
    }

    fn shutdown(&self) -> NativeFuture<()> {
        self.implementation.shutdown()
    }
}

pub fn validate_value(value: &Value, contract: &TypeContract, path: &str) -> NativeResult<()> {
    let valid = match contract {
        TypeContract::Primitive("boolean") => matches!(value, Value::Boolean(_)),
        TypeContract::Primitive("null") => matches!(value, Value::Null),
        TypeContract::Primitive("number") => matches!(value, Value::Number(_)),
        TypeContract::Primitive("string") => matches!(value, Value::String(_)),
        TypeContract::Primitive("void") => matches!(value, Value::Undefined),
        TypeContract::Primitive(_) | TypeContract::Opaque(_) => true,
        TypeContract::LiteralBoolean(expected) => {
            matches!(value, Value::Boolean(actual) if actual == expected)
        }
        TypeContract::LiteralNumber(expected) => {
            matches!(value, Value::Number(actual) if actual == expected)
        }
        TypeContract::LiteralString(expected) => {
            matches!(value, Value::String(actual) if actual == expected)
        }
        TypeContract::Array(element) => match value {
            Value::Array(values) => {
                for (index, value) in lock(values).iter().enumerate() {
                    validate_value(value, element, &format!("{path}[{index}]"))?;
                }
                true
            }
            _ => false,
        },
        TypeContract::Tuple(elements) => match value {
            Value::Array(values) => {
                let values = lock(values);
                if values.len() != elements.len() {
                    false
                } else {
                    for (index, (value, contract)) in values.iter().zip(elements).enumerate() {
                        validate_value(value, contract, &format!("{path}[{index}]"))?;
                    }
                    true
                }
            }
            _ => false,
        },
        TypeContract::Option(inner) => {
            matches!(value, Value::Undefined) || validate_value(value, inner, path).is_ok()
        }
        TypeContract::Union(variants) => variants
            .iter()
            .any(|variant| validate_value(value, variant, path).is_ok()),
        TypeContract::Record(fields) => match value {
            Value::Record(values) => {
                for field in fields {
                    match values.get(field.name) {
                        Some(Value::Undefined) if field.optional => {}
                        Some(value) => {
                            validate_value(value, &field.value, &format!("{path}.{}", field.name))?
                        }
                        None if field.optional => {}
                        None => {
                            return Err(NativeError::new(
                                "DependencyContractViolation",
                                format!("{path} is missing field {:?}.", field.name),
                            ));
                        }
                    }
                }
                true
            }
            Value::MutableRecord(values) => {
                let values = lock(values);
                for field in fields {
                    match values.get(field.name) {
                        Some(Value::Undefined) if field.optional => {}
                        Some(value) => {
                            validate_value(value, &field.value, &format!("{path}.{}", field.name))?
                        }
                        None if field.optional => {}
                        None => {
                            return Err(NativeError::new(
                                "DependencyContractViolation",
                                format!("{path} is missing field {:?}.", field.name),
                            ));
                        }
                    }
                }
                true
            }
            _ => false,
        },
        TypeContract::Stream(_) => matches!(value, Value::Stream(_)),
        TypeContract::Function => matches!(value, Value::Function(_)),
    };
    if valid {
        Ok(())
    } else {
        Err(NativeError::new(
            "DependencyContractViolation",
            format!("{path} does not satisfy {contract:?}; received {value:?}."),
        ))
    }
}

#[derive(Clone)]
pub struct DependencyContext {
    pub name: String,
    pub configuration: BTreeMap<String, String>,
    pub dependencies: BTreeMap<String, Arc<dyn Dependency>>,
}

impl DependencyContext {
    pub fn configuration(&self, name: &str) -> NativeResult<&str> {
        self.configuration
            .get(name)
            .map(String::as_str)
            .ok_or_else(|| {
                NativeError::new(
                    "MissingConfiguration",
                    format!(
                        "Dependency {:?} requires configuration {name:?}.",
                        self.name
                    ),
                )
            })
    }

    pub fn dependency(&self, name: &str) -> NativeResult<Arc<dyn Dependency>> {
        self.dependencies.get(name).cloned().ok_or_else(|| {
            NativeError::new(
                "MissingDependency",
                format!("Dependency {:?} requires Dependency {name:?}.", self.name),
            )
        })
    }
}

#[derive(Clone)]
pub struct Engine(Arc<EngineState>);

struct EngineState {
    external: RwLock<BTreeMap<String, Arc<dyn Dependency>>>,
    declared: RwLock<BTreeSet<String>>,
    provided: RwLock<BTreeMap<String, Value>>,
    provided_envelopes: RwLock<BTreeSet<String>>,
    resources: Mutex<Vec<Value>>,
    stable_functions: Mutex<BTreeMap<String, NativeFunction>>,
    tasks: AtomicUsize,
    task_completion: tokio::sync::Notify,
    invocations: Mutex<BTreeMap<String, u64>>,
    router: RwLock<Option<Arc<dyn DependencyRouter>>>,
}

impl Engine {
    pub fn new() -> Self {
        Self(Arc::new(EngineState {
            external: RwLock::new(BTreeMap::new()),
            declared: RwLock::new(BTreeSet::new()),
            provided: RwLock::new(BTreeMap::new()),
            provided_envelopes: RwLock::new(BTreeSet::new()),
            resources: Mutex::new(Vec::new()),
            stable_functions: Mutex::new(BTreeMap::new()),
            tasks: AtomicUsize::new(0),
            task_completion: tokio::sync::Notify::new(),
            invocations: Mutex::new(BTreeMap::new()),
            router: RwLock::new(None),
        }))
    }

    pub fn install_router(&self, router: Arc<dyn DependencyRouter>) -> NativeResult<()> {
        let mut installed = write(&self.0.router);
        if installed.is_some() {
            return Err(NativeError::new(
                "DuplicateDependencyRouter",
                "A Dependency router is already installed.",
            ));
        }
        *installed = Some(router);
        Ok(())
    }

    pub fn register(
        &self,
        name: impl Into<String>,
        dependency: Arc<dyn Dependency>,
    ) -> NativeResult<()> {
        let name = name.into();
        let mut external = write(&self.0.external);
        if external.contains_key(&name) {
            return Err(NativeError::new(
                "DuplicateDependency",
                format!("Dependency {name:?} is already registered."),
            ));
        }
        external.insert(name, dependency);
        Ok(())
    }

    pub async fn start_dependencies(&self) -> NativeResult<()> {
        let dependencies = read(&self.0.external).values().cloned().collect::<Vec<_>>();
        for dependency in dependencies {
            dependency.start(self.clone()).await?;
        }
        Ok(())
    }

    pub fn dependency_value(&self, name: &str) -> NativeResult<Value> {
        if let Some(value) = read(&self.0.provided).get(name) {
            return Ok(if read(&self.0.provided_envelopes).contains(name) {
                Value::Dependency(name.to_owned())
            } else {
                value.clone()
            });
        }
        if read(&self.0.external).contains_key(name) {
            return Ok(Value::Dependency(name.to_owned()));
        }
        if read(&self.0.declared).contains(name) {
            return Ok(Value::Dependency(name.to_owned()));
        }
        Err(NativeError::new(
            "MissingDependency",
            format!("Missing Dependency {name:?}."),
        ))
    }

    pub fn declare_provided(&self, names: &[&str]) -> NativeResult<()> {
        let external = read(&self.0.external);
        let provided = read(&self.0.provided);
        let mut declared = write(&self.0.declared);
        for name in names {
            if external.contains_key(*name)
                || provided.contains_key(*name)
                || declared.contains(*name)
            {
                return Err(NativeError::new(
                    "DuplicateDependency",
                    format!("Dependency {name:?} is already registered or declared."),
                ));
            }
            declared.insert((*name).to_owned());
        }
        Ok(())
    }

    pub fn retain(&self, value: Value) {
        if !value.is_undefined() {
            lock(&self.0.resources).push(value);
        }
    }

    pub fn provide(
        &self,
        names: &[&str],
        envelope_names: &[&str],
        value: Value,
    ) -> NativeResult<()> {
        let record = value.as_record()?;
        let actual = record.keys().map(String::as_str).collect::<Vec<_>>();
        if actual != names {
            return Err(NativeError::new(
                "InvalidProvision",
                format!("Provided {actual:?}, declared {names:?}."),
            ));
        }
        for name in envelope_names {
            if !names.contains(name) {
                return Err(NativeError::new(
                    "InvalidProvision",
                    format!("Envelope Dependency {name:?} is not provided by this contribution."),
                ));
            }
        }
        let mut provided = write(&self.0.provided);
        for name in names {
            if provided.contains_key(*name) {
                return Err(NativeError::new(
                    "DuplicateDependency",
                    format!("Dependency {name:?} is already provided."),
                ));
            }
        }
        for name in names {
            let value = record.get(*name).cloned().ok_or_else(|| {
                NativeError::new("InvalidProvision", format!("Missing {name:?}."))
            })?;
            provided.insert((*name).to_owned(), value.clone());
            lock(&self.0.resources).push(value);
        }
        write(&self.0.provided_envelopes)
            .extend(envelope_names.iter().map(|name| (*name).to_owned()));
        Ok(())
    }

    pub fn has_live_resources(&self) -> bool {
        !lock(&self.0.resources).is_empty() || read(&self.0.router).is_some()
    }

    pub async fn shutdown(&self) -> NativeResult<()> {
        while self.0.tasks.load(Ordering::Acquire) > 0 {
            let completion = self.0.task_completion.notified();
            if self.0.tasks.load(Ordering::Acquire) == 0 {
                break;
            }
            completion.await;
        }
        let mut errors = Vec::new();
        let router = { write(&self.0.router).take() };
        let router_shutdown = match router {
            Some(router) => router.shutdown().await,
            None => Ok(()),
        };
        if let Err(error) = router_shutdown {
            errors.push(error);
        }
        let resources = std::mem::take(&mut *lock(&self.0.resources));
        for resource in resources.into_iter().rev() {
            if let Err(error) = self.dispose(resource).await {
                errors.push(error);
            }
        }
        let dependencies = read(&self.0.external).values().cloned().collect::<Vec<_>>();
        for dependency in dependencies.into_iter().rev() {
            if let Err(error) = dependency.shutdown().await {
                errors.push(error);
            }
        }
        match errors.len() {
            0 => Ok(()),
            1 => Err(errors.remove(0)),
            count => Err(NativeError::new(
                "ShutdownFailure",
                format!("{count} native resources failed to stop."),
            )),
        }
    }

    pub async fn invoke(&self, function: Value, arguments: Vec<Value>) -> NativeResult<Value> {
        match function {
            Value::Function(function) => function.call(self.clone(), arguments).await,
            value => Err(NativeError::new(
                "TypeError",
                format!("Value {value:?} is not callable."),
            )),
        }
    }

    pub fn stable_function(&self, identity: &str, function: NativeFunction) -> NativeFunction {
        let mut functions = lock(&self.0.stable_functions);
        functions
            .entry(identity.to_owned())
            .or_insert(function)
            .clone()
    }

    pub fn object_keys(&self, value: Value) -> NativeResult<Value> {
        let keys = match value {
            Value::Record(record) => record.keys().cloned().collect::<Vec<_>>(),
            Value::MutableRecord(record) => lock(&record).keys().cloned().collect::<Vec<_>>(),
            value => {
                return Err(NativeError::new(
                    "TypeError",
                    format!("Object.keys requires a record, received {value:?}."),
                ));
            }
        };
        Ok(Value::array(keys.into_iter().map(Value::String).collect()))
    }

    pub async fn concurrent_all(
        &self,
        operations: Vec<NativeFuture<Value>>,
    ) -> NativeResult<Value> {
        let mut started = self.start_concurrent(operations);
        let mut values = vec![None; started.settled.len()];
        for (index, result) in started.settled.iter_mut().enumerate() {
            if let Some(result) = result.take() {
                values[index] = Some(result?);
            }
        }
        while started.pending > 0 {
            let (index, result) = started.next().await?;
            values[index] = Some(result?);
        }
        Ok(Value::array(
            values
                .into_iter()
                .map(|value| value.unwrap_or(Value::Undefined))
                .collect(),
        ))
    }

    pub async fn concurrent_race(
        &self,
        operations: Vec<NativeFuture<Value>>,
    ) -> NativeResult<Value> {
        if operations.is_empty() {
            return Err(NativeError::new(
                "InvalidPromiseComposition",
                "Promise.race requires at least one operation.",
            ));
        }
        let mut started = self.start_concurrent(operations);
        for result in &mut started.settled {
            if let Some(result) = result.take() {
                return result;
            }
        }
        let (_, result) = started.next().await?;
        result
    }

    pub async fn concurrent_all_settled(
        &self,
        operations: Vec<NativeFuture<Value>>,
    ) -> NativeResult<Value> {
        let mut started = self.start_concurrent(operations);
        let mut values = vec![None; started.settled.len()];
        for (index, result) in started.settled.iter_mut().enumerate() {
            if let Some(result) = result.take() {
                values[index] = Some(settled_value(result));
            }
        }
        while started.pending > 0 {
            let (index, result) = started.next().await?;
            values[index] = Some(settled_value(result));
        }
        Ok(Value::array(
            values
                .into_iter()
                .map(|value| value.unwrap_or(Value::Undefined))
                .collect(),
        ))
    }

    fn start_concurrent(&self, operations: Vec<NativeFuture<Value>>) -> ConcurrentOperations {
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        let mut settled = Vec::with_capacity(operations.len());
        let mut pending = 0;
        let waker = noop_waker_ref();
        let mut context = Context::from_waker(waker);
        for (index, mut operation) in operations.into_iter().enumerate() {
            match operation.as_mut().poll(&mut context) {
                Poll::Ready(result) => settled.push(Some(result)),
                Poll::Pending => {
                    settled.push(None);
                    pending += 1;
                    let sender = sender.clone();
                    self.0.tasks.fetch_add(1, Ordering::AcqRel);
                    let state = self.0.clone();
                    tokio::spawn(async move {
                        let _task = ConcurrentTask(state);
                        let _ = sender.send((index, operation.await));
                    });
                }
            }
        }
        drop(sender);
        ConcurrentOperations {
            pending,
            receiver,
            settled,
        }
    }

    pub async fn next(&self, stream: Value) -> NativeResult<Option<Value>> {
        match stream {
            Value::Stream(stream) => stream.lock().await.next().await.transpose(),
            iterator @ (Value::Record(_) | Value::MutableRecord(_)) => {
                let record = iterator.as_record()?;
                let iterator = if record.contains_key("next") {
                    iterator
                } else {
                    let iterator = record.get("@asyncIterator").cloned().ok_or_else(|| {
                        NativeError::new("TypeError", "Value is not an asynchronous stream.")
                    })?;
                    self.invoke(iterator, Vec::new()).await?
                };
                let next = self
                    .method(iterator, "next", Vec::new())
                    .await?
                    .as_record()?;
                if next.get("done").map(Value::truthy).unwrap_or(false) {
                    Ok(None)
                } else {
                    Ok(Some(next.get("value").cloned().unwrap_or(Value::Undefined)))
                }
            }
            value => Err(NativeError::new(
                "TypeError",
                format!("Value {value:?} is not an asynchronous stream."),
            )),
        }
    }

    pub async fn map_stream(&self, source: Value, transform: Value) -> NativeResult<Value> {
        let iterator = self.method(source, "iterator", Vec::new()).await?;
        let engine = self.clone();
        Ok(Value::stream(Box::pin(async_stream::try_stream! {
            while let Some(value) = engine.next(iterator.clone()).await? {
                yield engine.invoke(transform.clone(), vec![value]).await?;
            }
        })))
    }

    pub async fn distinct_stream(&self, source: Value, select: Value) -> NativeResult<Value> {
        let iterator = self.method(source, "iterator", Vec::new()).await?;
        let engine = self.clone();
        Ok(Value::stream(Box::pin(async_stream::try_stream! {
            let mut previous: Option<serde_json::Value> = None;
            while let Some(value) = engine.next(iterator.clone()).await? {
                let selected = engine.invoke(select.clone(), vec![value.clone()]).await?;
                let selected = selected.to_json()?;
                if previous.as_ref() == Some(&selected) {
                    continue;
                }
                previous = Some(selected);
                yield value;
            }
        })))
    }

    pub async fn call_dependency(
        &self,
        name: &str,
        operation: &str,
        input: Value,
    ) -> NativeResult<Value> {
        self.call_dependency_scoped("runtime", name, operation, input)
            .await
    }

    pub async fn call_dependency_scoped(
        &self,
        scope: &str,
        name: &str,
        operation: &str,
        input: Value,
    ) -> NativeResult<Value> {
        let sequence = {
            let mut invocations = lock(&self.0.invocations);
            let sequence = invocations.entry(format!("{scope}\0{name}")).or_default();
            *sequence += 1;
            *sequence
        };
        self.call_dependency_with_invocation(
            name,
            operation,
            input,
            DependencyInvocation::direct(name, operation, sequence)?,
        )
        .await
    }

    pub async fn call_dependency_with_invocation(
        &self,
        name: &str,
        operation: &str,
        input: Value,
        invocation: DependencyInvocation,
    ) -> NativeResult<Value> {
        if invocation.id.is_empty()
            || invocation.attempt == 0
            || !invocation.scheduled_at.is_finite()
            || !invocation.started_at.is_finite()
            || invocation
                .deadline
                .is_some_and(|deadline| !deadline.is_finite())
            || invocation
                .trace
                .as_ref()
                .is_some_and(|trace| trace.traceparent.is_empty())
        {
            return Err(NativeError::new(
                "InvalidDependencyInvocation",
                format!("Dependency {name}.{operation} received invalid invocation metadata."),
            ));
        }
        if read(&self.0.provided).contains_key(name) {
            let router = read(&self.0.router).clone();
            if let Some(router) = router
                && router.handles(name)
            {
                return router
                    .route(self.clone(), name, operation, input, invocation)
                    .await;
            }
            return self
                .call_provided_with_invocation(name, operation, input, invocation)
                .await;
        }
        if read(&self.0.declared).contains(name) {
            return Err(NativeError::new(
                "UnreadyDependency",
                format!("Dependency {name:?} is not ready."),
            ));
        }
        let dependency = { read(&self.0.external).get(name).cloned() }.ok_or_else(|| {
            NativeError::new(
                "MissingDependency",
                format!("Missing Dependency {name}.{operation}."),
            )
        })?;
        dependency
            .call(self.clone(), operation, input, invocation)
            .await
    }

    /** Invokes one local provided Dependency without consulting the adapter router. */
    pub async fn call_provided_with_invocation(
        &self,
        name: &str,
        operation: &str,
        input: Value,
        invocation: DependencyInvocation,
    ) -> NativeResult<Value> {
        let value = read(&self.0.provided).get(name).cloned().ok_or_else(|| {
            NativeError::new(
                "MissingDependency",
                format!("Missing provided Dependency {name}.{operation}."),
            )
        })?;
        if read(&self.0.provided_envelopes).contains(name) {
            let dispatcher = value.as_record()?.get("@dependencyInvocation").cloned();
            if let Some(dispatcher) = dispatcher {
                return self
                    .invoke(
                        dispatcher,
                        vec![
                            Value::String(operation.to_owned()),
                            input,
                            invocation.to_value(),
                        ],
                    )
                    .await;
            }
        }
        let input = if read(&self.0.provided_envelopes).contains(name) {
            Value::record(IndexMap::from([
                ("input".to_owned(), input),
                ("invocation".to_owned(), invocation.to_value()),
            ]))
        } else {
            input
        };
        self.method(value, operation, vec![input]).await
    }

    pub fn assign_property(
        &self,
        target: Value,
        property: &str,
        operator: &str,
        right: Value,
    ) -> NativeResult<()> {
        let Value::MutableRecord(record) = target else {
            return Err(NativeError::new(
                "TypeError",
                format!("Cannot assign property {property:?} on {target:?}."),
            ));
        };
        let mut record = lock(&record);
        let left = record.get(property).cloned().unwrap_or(Value::Undefined);
        record.insert(property.to_owned(), assign(operator, left, right)?);
        Ok(())
    }

    pub fn method(
        &self,
        receiver: Value,
        method: &str,
        arguments: Vec<Value>,
    ) -> NativeFuture<Value> {
        let engine = self.clone();
        let method = method.to_owned();
        Box::pin(async move {
            if let Value::Dependency(name) = &receiver {
                return engine
                    .call_dependency(
                        name,
                        &method,
                        arguments.into_iter().next().unwrap_or(Value::Undefined),
                    )
                    .await;
            }
            if let Value::InterceptedDependency(function) = &receiver {
                let input = arguments.into_iter().next().unwrap_or(Value::Undefined);
                return engine
                    .invoke(
                        Value::Function(function.clone()),
                        vec![Value::String(method), input],
                    )
                    .await;
            }
            if method == "find" {
                let values = receiver.as_array()?.lock().expect("array lock").clone();
                let predicate = arguments
                    .into_iter()
                    .next()
                    .ok_or_else(|| NativeError::new("TypeError", "find requires a predicate."))?;
                for value in values {
                    if engine
                        .invoke(predicate.clone(), vec![value.clone()])
                        .await?
                        .truthy()
                    {
                        return Ok(value);
                    }
                }
                return Ok(Value::Undefined);
            }
            if method == "map" {
                let values = receiver.as_array()?.lock().expect("array lock").clone();
                let transform = arguments
                    .into_iter()
                    .next()
                    .ok_or_else(|| NativeError::new("TypeError", "map requires a transform."))?;
                let mut mapped = Vec::with_capacity(values.len());
                for value in values {
                    mapped.push(engine.invoke(transform.clone(), vec![value]).await?);
                }
                return Ok(Value::array(mapped));
            }
            if method == "startsWith" {
                let prefix = arguments
                    .first()
                    .cloned()
                    .unwrap_or(Value::Undefined)
                    .string()?;
                return Ok(Value::Boolean(receiver.string()?.starts_with(&prefix)));
            }
            if method == "slice" {
                let from = arguments
                    .first()
                    .cloned()
                    .unwrap_or(Value::Number(0.0))
                    .number()? as usize;
                return Ok(Value::String(
                    receiver.string()?.chars().skip(from).collect(),
                ));
            }
            if method == "iterator" {
                return match receiver {
                    Value::Stream(_) => Ok(receiver),
                    Value::Record(record) => {
                        let function = record.get("@asyncIterator").cloned().ok_or_else(|| {
                            NativeError::new("TypeError", "Value has no async iterator.")
                        })?;
                        engine.invoke(function, Vec::new()).await
                    }
                    Value::MutableRecord(record) => {
                        let function =
                            lock(&record)
                                .get("@asyncIterator")
                                .cloned()
                                .ok_or_else(|| {
                                    NativeError::new("TypeError", "Value has no async iterator.")
                                })?;
                        engine.invoke(function, Vec::new()).await
                    }
                    _ => Err(NativeError::new(
                        "TypeError",
                        "Value has no async iterator.",
                    )),
                };
            }
            if let Value::Record(record) = &receiver
                && let Some(function) = record.get(&method)
            {
                return engine.invoke(function.clone(), arguments).await;
            }
            let mutable_method = match &receiver {
                Value::MutableRecord(record) => lock(record).get(&method).cloned(),
                _ => None,
            };
            if let Some(function) = mutable_method {
                return engine.invoke(function, arguments).await;
            }
            if method == "next" {
                return Ok(match engine.next(receiver).await? {
                    Some(value) => Value::record(BTreeMap::from([
                        ("done".to_owned(), Value::Boolean(false)),
                        ("value".to_owned(), value),
                    ])),
                    None => Value::record(BTreeMap::from([
                        ("done".to_owned(), Value::Boolean(true)),
                        ("value".to_owned(), Value::Undefined),
                    ])),
                });
            }
            if method == "return" {
                return Ok(Value::record(BTreeMap::from([
                    ("done".to_owned(), Value::Boolean(true)),
                    ("value".to_owned(), Value::Undefined),
                ])));
            }
            let record = receiver.as_record()?;
            let function = record.get(&method).cloned().ok_or_else(|| {
                NativeError::new("TypeError", format!("Value has no {method} method."))
            })?;
            engine.invoke(function, arguments).await
        })
    }

    async fn dispose(&self, value: Value) -> NativeResult<()> {
        let dispose = match value {
            Value::Record(record) => record
                .get("@asyncDispose")
                .or_else(|| record.get("@dispose"))
                .cloned(),
            Value::MutableRecord(record) => {
                let record = lock(&record);
                record
                    .get("@asyncDispose")
                    .or_else(|| record.get("@dispose"))
                    .cloned()
            }
            _ => None,
        };
        if let Some(dispose) = dispose {
            self.invoke(dispose, Vec::new()).await?;
        }
        Ok(())
    }
}

struct ConcurrentOperations {
    pending: usize,
    receiver: tokio::sync::mpsc::UnboundedReceiver<(usize, NativeResult<Value>)>,
    settled: Vec<Option<NativeResult<Value>>>,
}

struct ConcurrentTask(Arc<EngineState>);

impl Drop for ConcurrentTask {
    fn drop(&mut self) {
        self.0.tasks.fetch_sub(1, Ordering::AcqRel);
        self.0.task_completion.notify_waiters();
    }
}

impl ConcurrentOperations {
    async fn next(&mut self) -> NativeResult<(usize, NativeResult<Value>)> {
        let result = self.receiver.recv().await.ok_or_else(|| {
            NativeError::new(
                "ConcurrentTaskFailure",
                "A Promise operation ended without reporting its result.",
            )
        })?;
        self.pending -= 1;
        Ok(result)
    }
}

fn settled_value(result: NativeResult<Value>) -> Value {
    match result {
        Ok(value) => Value::record([
            ("status".to_owned(), Value::String("fulfilled".to_owned())),
            ("value".to_owned(), value),
        ]),
        Err(error) => Value::record([
            ("status".to_owned(), Value::String("rejected".to_owned())),
            ("reason".to_owned(), Value::Error(Arc::new(error))),
        ]),
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Value {
    pub fn record(values: impl IntoIterator<Item = (String, Value)>) -> Self {
        Self::Record(Arc::new(values.into_iter().collect()))
    }

    pub fn mutable_record(values: impl IntoIterator<Item = (String, Value)>) -> Self {
        Self::MutableRecord(Arc::new(Mutex::new(values.into_iter().collect())))
    }

    pub fn into_mutable_record(self) -> NativeResult<Self> {
        match self {
            Self::Record(values) => Ok(Self::mutable_record((*values).clone())),
            Self::MutableRecord(_) => Ok(self),
            value => Err(NativeError::new(
                "TypeError",
                format!("Expected record, received {value:?}."),
            )),
        }
    }

    pub fn array(values: Vec<Value>) -> Self {
        Self::Array(Arc::new(Mutex::new(values)))
    }

    pub fn stream(stream: NativeStream) -> Self {
        Self::Stream(Arc::new(tokio::sync::Mutex::new(stream)))
    }

    pub fn intercepted_dependency(function: NativeFunction) -> Self {
        Self::InterceptedDependency(function)
    }

    pub fn is_undefined(&self) -> bool {
        matches!(self, Self::Undefined)
    }

    pub fn from_json(value: &JsonValue) -> Self {
        match value {
            JsonValue::Null => Self::Null,
            JsonValue::Bool(value) => Self::Boolean(*value),
            JsonValue::Number(value) => Self::Number(value.as_f64().unwrap_or(0.0)),
            JsonValue::String(value) => Self::String(value.clone()),
            JsonValue::Array(values) => Self::array(values.iter().map(Self::from_json).collect()),
            JsonValue::Object(values) => Self::mutable_record(
                values
                    .iter()
                    .map(|(name, value)| (name.clone(), Self::from_json(value))),
            ),
        }
    }

    pub fn from_canonical_json(value: &JsonValue) -> Self {
        if let JsonValue::Object(values) = value
            && values.len() == 1
            && let Some(JsonValue::String(number)) = values.get("$number")
        {
            return match number.as_str() {
                "nan" => Self::Number(f64::NAN),
                "positive-infinity" => Self::Number(f64::INFINITY),
                "negative-infinity" => Self::Number(f64::NEG_INFINITY),
                "negative-zero" => Self::Number(-0.0),
                _ => Self::from_json(value),
            };
        }
        match value {
            JsonValue::Array(values) => {
                Self::array(values.iter().map(Self::from_canonical_json).collect())
            }
            JsonValue::Object(values) => Self::record(
                values
                    .iter()
                    .map(|(name, value)| (name.clone(), Self::from_canonical_json(value))),
            ),
            _ => Self::from_json(value),
        }
    }

    pub fn canonical_json(&self) -> NativeResult<JsonValue> {
        match self {
            Self::Number(value) if value.is_nan() => Ok(serde_json::json!({ "$number": "nan" })),
            Self::Number(value) if *value == f64::INFINITY => {
                Ok(serde_json::json!({ "$number": "positive-infinity" }))
            }
            Self::Number(value) if *value == f64::NEG_INFINITY => {
                Ok(serde_json::json!({ "$number": "negative-infinity" }))
            }
            Self::Number(value) if *value == 0.0 && value.is_sign_negative() => {
                Ok(serde_json::json!({ "$number": "negative-zero" }))
            }
            Self::Array(values) => Ok(JsonValue::Array(
                lock(values)
                    .iter()
                    .map(Value::canonical_json)
                    .collect::<NativeResult<_>>()?,
            )),
            Self::Record(values) => {
                let mut result = JsonMap::new();
                for (name, value) in values.iter() {
                    if !matches!(value, Self::Undefined) {
                        result.insert(name.clone(), value.canonical_json()?);
                    }
                }
                Ok(JsonValue::Object(result))
            }
            Self::MutableRecord(values) => {
                let mut result = JsonMap::new();
                for (name, value) in lock(values).iter() {
                    if !matches!(value, Self::Undefined) {
                        result.insert(name.clone(), value.canonical_json()?);
                    }
                }
                Ok(JsonValue::Object(result))
            }
            _ => self.to_json(),
        }
    }

    pub fn to_json(&self) -> NativeResult<JsonValue> {
        match self {
            Self::Undefined | Self::Null => Ok(JsonValue::Null),
            Self::Boolean(value) => Ok(JsonValue::Bool(*value)),
            Self::Number(value)
                if value.is_finite()
                    && value.fract() == 0.0
                    && *value >= i64::MIN as f64
                    && *value <= i64::MAX as f64 =>
            {
                Ok(JsonValue::Number(serde_json::Number::from(*value as i64)))
            }
            Self::Number(value) => serde_json::Number::from_f64(*value)
                .map(JsonValue::Number)
                .ok_or_else(|| NativeError::new("TypeError", "Number is not finite.")),
            Self::String(value) => Ok(JsonValue::String(value.clone())),
            Self::Array(values) => Ok(JsonValue::Array(
                lock(values)
                    .iter()
                    .map(Value::to_json)
                    .collect::<NativeResult<_>>()?,
            )),
            Self::Record(values) => {
                let mut result = JsonMap::new();
                for (name, value) in values.iter() {
                    if !matches!(value, Self::Undefined) {
                        result.insert(name.clone(), value.to_json()?);
                    }
                }
                Ok(JsonValue::Object(result))
            }
            Self::MutableRecord(values) => {
                let mut result = JsonMap::new();
                for (name, value) in lock(values).iter() {
                    if !matches!(value, Self::Undefined) {
                        result.insert(name.clone(), value.to_json()?);
                    }
                }
                Ok(JsonValue::Object(result))
            }
            Self::Error(value) => Ok(JsonValue::String(value.message.clone())),
            _ => Err(NativeError::new("TypeError", "Value is not serializable.")),
        }
    }

    pub fn as_record(&self) -> NativeResult<Arc<Record>> {
        match self {
            Self::Record(value) => Ok(value.clone()),
            Self::MutableRecord(value) => Ok(Arc::new(lock(value).clone())),
            _ => Err(NativeError::new(
                "TypeError",
                format!("Expected record, received {self:?}."),
            )),
        }
    }

    pub fn as_array(&self) -> NativeResult<Arc<Mutex<Vec<Value>>>> {
        match self {
            Self::Array(value) => Ok(value.clone()),
            _ => Err(NativeError::new(
                "TypeError",
                format!("Expected array, received {self:?}."),
            )),
        }
    }

    pub fn string(&self) -> NativeResult<String> {
        match self {
            Self::String(value) => Ok(value.clone()),
            _ => Err(NativeError::new(
                "TypeError",
                format!("Expected string, received {self:?}."),
            )),
        }
    }

    pub fn number(&self) -> NativeResult<f64> {
        match self {
            Self::Number(value) => Ok(*value),
            _ => Err(NativeError::new(
                "TypeError",
                format!("Expected number, received {self:?}."),
            )),
        }
    }

    pub fn truthy(&self) -> bool {
        match self {
            Self::Undefined | Self::Null => false,
            Self::Boolean(value) => *value,
            Self::Number(value) => *value != 0.0 && !value.is_nan(),
            Self::String(value) => !value.is_empty(),
            _ => true,
        }
    }

    pub fn to_text(&self) -> String {
        match self {
            Self::Undefined => "undefined".to_owned(),
            Self::Null => "null".to_owned(),
            Self::Boolean(value) => value.to_string(),
            Self::Number(value) if value.is_nan() => "NaN".to_owned(),
            Self::Number(value) if *value == f64::INFINITY => "Infinity".to_owned(),
            Self::Number(value) if *value == f64::NEG_INFINITY => "-Infinity".to_owned(),
            Self::Number(value) if *value == 0.0 => "0".to_owned(),
            Self::Number(value) => value.to_string(),
            Self::String(value) => value.clone(),
            Self::Array(values) => lock(values)
                .iter()
                .map(Value::to_text)
                .collect::<Vec<_>>()
                .join(","),
            Self::Record(_) | Self::MutableRecord(_) => "[object Object]".to_owned(),
            Self::Error(value) => format!("{}: {}", value.name, value.message),
            Self::Function(_)
            | Self::Dependency(_)
            | Self::InterceptedDependency(_)
            | Self::Stream(_) => format!("{self:?}"),
        }
    }

    pub fn property(&self, name: &str, optional: bool) -> NativeResult<Value> {
        if matches!(self, Self::Undefined | Self::Null) && optional {
            return Ok(Self::Undefined);
        }
        match self {
            Self::Record(value) => Ok(value.get(name).cloned().unwrap_or(Self::Undefined)),
            Self::MutableRecord(value) => {
                Ok(lock(value).get(name).cloned().unwrap_or(Self::Undefined))
            }
            Self::Error(value) => Ok(match name {
                "name" => Self::String(value.name.clone()),
                "message" => Self::String(value.message.clone()),
                _ => value.fields.get(name).cloned().unwrap_or(Self::Undefined),
            }),
            Self::Array(value) => {
                let values = lock(value);
                if name == "length" {
                    return Ok(Self::Number(values.len() as f64));
                }
                let index = name
                    .parse::<usize>()
                    .ok()
                    .filter(|index| index.to_string() == name);
                Ok(index
                    .and_then(|index| values.get(index).cloned())
                    .unwrap_or(Self::Undefined))
            }
            Self::String(value) if name == "length" => {
                Ok(Self::Number(value.chars().count() as f64))
            }
            _ => Err(NativeError::new(
                "TypeError",
                format!("Cannot read {name} from {self:?}."),
            )),
        }
    }

    pub fn into_error(self) -> NativeError {
        match self {
            Self::Error(value) => (*value).clone(),
            value => NativeError::new("Error", format!("{value:?}")),
        }
    }
}

/** Creates the process-local marker used to carry a deferred result across a router. */
pub fn deferred_dependency_invocation(id: impl Into<String>) -> Value {
    Value::record([
        (
            "$kit".to_owned(),
            Value::String(DEFERRED_DEPENDENCY_INVOCATION.to_owned()),
        ),
        ("id".to_owned(), Value::String(id.into())),
    ])
}

/** Returns the completion id when a routed provider deferred its result. */
pub fn deferred_dependency_invocation_id(value: &Value) -> Option<String> {
    let marker = value.property("$kit", false).ok()?.string().ok()?;
    if marker != DEFERRED_DEPENDENCY_INVOCATION {
        return None;
    }
    value.property("id", false).ok()?.string().ok()
}

pub fn binary(operator: &str, left: Value, right: Value) -> NativeResult<Value> {
    match operator {
        "+" => match (&left, &right) {
            (Value::Number(left), Value::Number(right)) => Ok(Value::Number(left + right)),
            (Value::String(left), Value::String(right)) => {
                Ok(Value::String(format!("{left}{right}")))
            }
            _ => Err(NativeError::new(
                "TypeError",
                "+ requires matching numbers or strings.",
            )),
        },
        "-" => Ok(Value::Number(left.number()? - right.number()?)),
        "*" => Ok(Value::Number(left.number()? * right.number()?)),
        "/" => Ok(Value::Number(left.number()? / right.number()?)),
        "%" => Ok(Value::Number(left.number()? % right.number()?)),
        "===" => Ok(Value::Boolean(equal(&left, &right))),
        "!==" => Ok(Value::Boolean(!equal(&left, &right))),
        "<" => Ok(Value::Boolean(left.number()? < right.number()?)),
        "<=" => Ok(Value::Boolean(left.number()? <= right.number()?)),
        ">" => Ok(Value::Boolean(left.number()? > right.number()?)),
        ">=" => Ok(Value::Boolean(left.number()? >= right.number()?)),
        value => Err(NativeError::new("UnsupportedOperator", value)),
    }
}

pub fn assign(operator: &str, left: Value, right: Value) -> NativeResult<Value> {
    match operator {
        "=" => Ok(right),
        "+=" => binary("+", left, right),
        "-=" => binary("-", left, right),
        "*=" => binary("*", left, right),
        "/=" => binary("/", left, right),
        "??=" if matches!(left, Value::Undefined | Value::Null) => Ok(right),
        "??=" => Ok(left),
        value => Err(NativeError::new("UnsupportedOperator", value)),
    }
}

fn equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Undefined, Value::Undefined) | (Value::Null, Value::Null) => true,
        (Value::Boolean(left), Value::Boolean(right)) => left == right,
        (Value::Number(left), Value::Number(right)) => left == right,
        (Value::String(left), Value::String(right)) => left == right,
        (Value::Function(left), Value::Function(right)) => left.ptr_eq(right),
        _ => false,
    }
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
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct Noop;

    impl Dependency for Noop {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            _input: Value,
            _invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
            let operation = operation.to_owned();
            Box::pin(async move {
                Err(NativeError::new(
                    "UnknownOperation",
                    format!("Noop has no operation {operation:?}."),
                ))
            })
        }
    }

    struct PassThroughRouter(Arc<AtomicUsize>);

    impl DependencyRouter for PassThroughRouter {
        fn handles(&self, name: &str) -> bool {
            name == "peer"
        }

        fn route(
            &self,
            engine: Engine,
            name: &str,
            operation: &str,
            input: Value,
            invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
            self.0.fetch_add(1, Ordering::SeqCst);
            let name = name.to_owned();
            let operation = operation.to_owned();
            Box::pin(async move {
                engine
                    .call_provided_with_invocation(&name, &operation, input, invocation)
                    .await
            })
        }
    }

    #[test]
    fn preserves_json_values_and_javascript_primitive_semantics() {
        let source = serde_json::json!({ "items": [true, 2, "three"], "missing": null });
        assert_eq!(Value::from_json(&source).to_json().expect("JSON"), source);
        assert_eq!(
            binary("+", Value::Number(2.0), Value::Number(3.0))
                .expect("addition")
                .number()
                .expect("number"),
            5.0
        );
        assert!(!Value::String(String::new()).truthy());
        let values = Value::array(vec![Value::String("first".to_owned())]);
        assert_eq!(
            values
                .property("0", false)
                .expect("array index")
                .string()
                .expect("string"),
            "first"
        );
        assert!(
            values
                .property("1", false)
                .expect("missing array index")
                .is_undefined()
        );
    }

    #[test]
    fn rejects_duplicate_external_dependencies() {
        let engine = Engine::new();
        engine.register("noop", Arc::new(Noop)).expect("register");
        let error = engine
            .register("noop", Arc::new(Noop))
            .expect_err("duplicate must fail");
        assert_eq!(error.name, "DuplicateDependency");
    }

    #[tokio::test]
    async fn exposes_declared_dependencies_and_rejects_calls_until_the_provider_is_ready() {
        let engine = Engine::new();
        engine
            .declare_provided(&["peer"])
            .expect("declare internal Dependency");
        assert!(matches!(
            engine.dependency_value("peer").expect("declared value"),
            Value::Dependency(name) if name == "peer"
        ));

        let error = engine
            .call_dependency("peer", "read", Value::Undefined)
            .await
            .expect_err("unready call must fail");
        assert_eq!(error.name, "UnreadyDependency");

        engine
            .provide(
                &["peer"],
                &[],
                Value::record(IndexMap::from([(
                    "peer".to_owned(),
                    Value::record(IndexMap::new()),
                )])),
            )
            .expect("bind internal Dependency");
        assert!(matches!(
            engine.dependency_value("peer").expect("provided value"),
            Value::Record(_)
        ));
    }

    #[tokio::test]
    async fn routes_provided_dependencies_through_one_adapter_owned_hook() {
        let engine = Engine::new();
        let routes = Arc::new(AtomicUsize::new(0));
        engine
            .install_router(Arc::new(PassThroughRouter(routes.clone())))
            .expect("install router");
        let read = NativeFunction::new(|_engine, arguments| {
            Box::pin(async move { Ok(arguments.into_iter().next().unwrap_or(Value::Undefined)) })
        });
        engine
            .provide(
                &["peer"],
                &[],
                Value::record(IndexMap::from([(
                    "peer".to_owned(),
                    Value::record(IndexMap::from([("read".to_owned(), Value::Function(read))])),
                )])),
            )
            .expect("provide peer");

        let result = engine
            .call_dependency("peer", "read", Value::String("routed".to_owned()))
            .await
            .expect("routed call");

        assert_eq!(result.string().expect("string result"), "routed");
        assert_eq!(routes.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn creates_structured_failures_from_portable_provider_invocations() {
        let engine = Engine::new();
        let invocation = DependencyInvocation::new("activity:one", 2, 10.0, 20.0, Some(30.0));
        let error = engine
            .method(
                invocation.to_value(),
                "fail",
                vec![Value::record(IndexMap::from([
                    ("type".to_owned(), Value::String("unavailable".to_owned())),
                    (
                        "data".to_owned(),
                        Value::record(IndexMap::from([(
                            "retryAt".to_owned(),
                            Value::Number(42.0),
                        )])),
                    ),
                    (
                        "message".to_owned(),
                        Value::String("Try again later.".to_owned()),
                    ),
                    (
                        "retry".to_owned(),
                        Value::record(IndexMap::from([("delay".to_owned(), Value::Number(25.0))])),
                    ),
                ]))],
            )
            .await
            .expect_err("provider failure");

        assert_eq!(error.name, "unavailable");
        assert_eq!(error.message, "Try again later.");
        assert_eq!(
            error
                .fields
                .get("data")
                .expect("failure data")
                .property("retryAt", false)
                .expect("retryAt")
                .number()
                .expect("number"),
            42.0
        );
        assert_eq!(
            error
                .fields
                .get("retryDelay")
                .expect("retry delay")
                .number()
                .expect("number"),
            25.0
        );
    }

    #[tokio::test]
    async fn projects_heartbeat_and_cancellation_into_portable_provider_invocations() {
        let engine = Engine::new();
        let heartbeats = Arc::new(Mutex::new(Vec::new()));
        let received = heartbeats.clone();
        let cancellation = DependencyCancellation::default();
        let invocation = DependencyInvocation::new("activity:one", 2, 10.0, 20.0, Some(30.0))
            .with_controls(
                Some(Value::record(IndexMap::from([(
                    "completed".to_owned(),
                    Value::Number(1.0),
                )]))),
                move |details| {
                    lock(&received).push(details);
                    Ok(())
                },
                |id| {
                    Ok(Value::record(IndexMap::from([(
                        "id".to_owned(),
                        Value::String(id),
                    )])))
                },
                cancellation.clone(),
            )
            .to_value();

        assert_eq!(
            invocation
                .property("previousHeartbeat", false)
                .expect("previous heartbeat")
                .property("completed", false)
                .expect("completed")
                .number()
                .expect("number"),
            1.0
        );
        engine
            .method(
                invocation.clone(),
                "heartbeat",
                vec![Value::record(IndexMap::from([(
                    "details".to_owned(),
                    Value::record(IndexMap::from([(
                        "completed".to_owned(),
                        Value::Number(2.0),
                    )])),
                )]))],
            )
            .await
            .expect("heartbeat");
        assert_eq!(
            lock(&heartbeats)[0]
                .property("completed", false)
                .expect("completed")
                .number()
                .expect("number"),
            2.0
        );
        assert_eq!(
            engine
                .method(
                    invocation.clone(),
                    "defer",
                    vec![Value::record(IndexMap::from([(
                        "id".to_owned(),
                        Value::String("completion:one".to_owned()),
                    )]))],
                )
                .await
                .expect("deferred invocation")
                .property("id", false)
                .expect("completion id")
                .string()
                .expect("string"),
            "completion:one"
        );

        let cancellation_value = invocation
            .property("cancellation", false)
            .expect("cancellation");
        assert!(
            !engine
                .method(cancellation_value.clone(), "requested", Vec::new())
                .await
                .expect("requested")
                .truthy()
        );
        let waiting = tokio::spawn({
            let engine = engine.clone();
            let cancellation_value = cancellation_value.clone();
            async move { engine.method(cancellation_value, "wait", Vec::new()).await }
        });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        cancellation.request();
        waiting
            .await
            .expect("cancellation task")
            .expect("cancellation wait");
        assert!(
            engine
                .method(cancellation_value, "requested", Vec::new())
                .await
                .expect("requested")
                .truthy()
        );
    }

    #[tokio::test]
    async fn composes_inherited_and_shielded_cancellation() {
        let parent = DependencyCancellation::default();
        let inherited = parent.child(true);
        let shielded = parent.child(false);
        let inherited_wait = tokio::spawn({
            let inherited = inherited.clone();
            async move { inherited.wait().await }
        });
        let shielded_wait = tokio::spawn({
            let shielded = shielded.clone();
            async move { shielded.wait().await }
        });

        tokio::task::yield_now().await;
        parent.request_with_reason(Some("parent-request".to_owned()));
        inherited_wait.await.expect("inherited cancellation");
        assert!(inherited.requested());
        assert_eq!(inherited.reason().as_deref(), Some("parent-request"));
        assert!(!shielded.requested());
        assert!(!shielded_wait.is_finished());

        shielded.request_with_reason(Some("local-request".to_owned()));
        shielded_wait.await.expect("shielded cancellation");
        assert!(shielded.requested());
        assert_eq!(shielded.reason().as_deref(), Some("local-request"));
    }

    #[test]
    fn accepts_absent_and_undefined_optional_record_fields() {
        let contract = TypeContract::Record(vec![FieldContract {
            name: "cookie",
            optional: true,
            value: TypeContract::Primitive("string"),
        }]);
        validate_value(&Value::record(BTreeMap::new()), &contract, "input")
            .expect("absent optional field");
        validate_value(
            &Value::record(BTreeMap::from([("cookie".to_owned(), Value::Undefined)])),
            &contract,
            "input",
        )
        .expect("undefined optional field");
        assert!(
            validate_value(
                &Value::record(BTreeMap::from([("cookie".to_owned(), Value::Number(1.0),)])),
                &contract,
                "input",
            )
            .is_err()
        );
    }

    #[tokio::test]
    async fn preserves_promise_order_settlement_and_uncancelled_race_losers() {
        let engine = Engine::new();
        let (first_sender, first_receiver) = tokio::sync::oneshot::channel();
        let (second_sender, second_receiver) = tokio::sync::oneshot::channel();
        let all = tokio::spawn({
            let engine = engine.clone();
            async move {
                engine
                    .concurrent_all(vec![
                        Box::pin(async move {
                            first_receiver.await.expect("first result");
                            Ok(Value::Number(1.0))
                        }),
                        Box::pin(async move {
                            second_receiver.await.expect("second result");
                            Ok(Value::Number(2.0))
                        }),
                    ])
                    .await
            }
        });
        second_sender.send(()).expect("send second");
        first_sender.send(()).expect("send first");
        let ordered = all.await.expect("all task").expect("all");
        assert_eq!(
            lock(&ordered.as_array().expect("ordered array"))
                .iter()
                .map(|value| value.number().expect("number"))
                .collect::<Vec<_>>(),
            vec![1.0, 2.0]
        );

        let settled = engine
            .concurrent_all_settled(vec![
                Box::pin(async { Ok(Value::String("ready".to_owned())) }),
                Box::pin(async { Err(NativeError::new("Expected", "rejected")) }),
            ])
            .await
            .expect("all settled");
        let settled = lock(&settled.as_array().expect("settled array")).clone();
        assert_eq!(
            settled[0]
                .property("status", false)
                .expect("status")
                .string()
                .expect("status string"),
            "fulfilled"
        );
        assert_eq!(
            settled[1]
                .property("status", false)
                .expect("status")
                .string()
                .expect("status string"),
            "rejected"
        );

        let (loser_sender, loser_receiver) = tokio::sync::oneshot::channel();
        let loser_finished = Arc::new(AtomicBool::new(false));
        let loser_observation = loser_finished.clone();
        let raced = engine
            .concurrent_race(vec![
                Box::pin(async { Ok(Value::Number(1.0)) }),
                Box::pin(async move {
                    loser_receiver.await.expect("loser release");
                    loser_observation.store(true, Ordering::Release);
                    Ok(Value::Number(2.0))
                }),
            ])
            .await
            .expect("race");
        assert_eq!(raced.number().expect("race number"), 1.0);
        assert!(!loser_finished.load(Ordering::Acquire));
        loser_sender.send(()).expect("release loser");
        engine.shutdown().await.expect("shutdown");
        assert!(loser_finished.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn advances_mutable_portable_iterator_records() {
        let engine = Engine::new();
        let delivered = Arc::new(AtomicBool::new(false));
        let next = NativeFunction::new({
            let delivered = delivered.clone();
            move |_engine, _arguments| {
                let done = delivered.swap(true, Ordering::AcqRel);
                Box::pin(async move {
                    Ok(Value::mutable_record([
                        ("done".to_owned(), Value::Boolean(done)),
                        (
                            "value".to_owned(),
                            if done {
                                Value::Undefined
                            } else {
                                Value::String("first".to_owned())
                            },
                        ),
                    ]))
                })
            }
        });
        let iterator = Value::mutable_record([("next".to_owned(), Value::Function(next))]);

        assert_eq!(
            engine
                .next(iterator.clone())
                .await
                .expect("first iteration")
                .expect("first value")
                .string()
                .expect("string"),
            "first"
        );
        assert!(
            engine
                .next(iterator)
                .await
                .expect("completed iteration")
                .is_none()
        );
    }

    #[tokio::test]
    async fn disposes_program_resources_in_reverse_acquisition_order() {
        let engine = Engine::new();
        let observed = Arc::new(Mutex::new(Vec::new()));
        for name in ["first", "second"] {
            let observed = observed.clone();
            let name = name.to_owned();
            let dispose = NativeFunction::new(move |_engine, _arguments| {
                let observed = observed.clone();
                let name = name.clone();
                Box::pin(async move {
                    lock(&observed).push(name);
                    Ok(Value::Undefined)
                })
            });
            engine.retain(Value::record(BTreeMap::from([(
                "@dispose".to_owned(),
                Value::Function(dispose),
            )])));
        }
        engine.shutdown().await.expect("shutdown");
        assert_eq!(&*lock(&observed), &["second", "first"]);
    }
}
