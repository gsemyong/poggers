use std::{
    collections::BTreeMap,
    fmt,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex, RwLock},
};

use futures_util::{Stream, StreamExt};
use serde_json::{Map as JsonMap, Value as JsonValue};

pub type NativeResult<T> = Result<T, NativeError>;
pub type NativeFuture<T> = Pin<Box<dyn Future<Output = NativeResult<T>> + Send>>;
pub type NativeStream = Pin<Box<dyn Stream<Item = NativeResult<Value>> + Send>>;

#[derive(Clone)]
pub enum Value {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(String),
    Array(Arc<Mutex<Vec<Value>>>),
    Record(Arc<BTreeMap<String, Value>>),
    Function(NativeFunction),
    Dependency(String),
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
            Self::Function(_) => formatter.write_str("NativeFunction"),
            Self::Dependency(value) => write!(formatter, "Dependency({value})"),
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
    fn call(&self, engine: Engine, operation: &str, input: Value) -> NativeFuture<Value>;

    fn shutdown(&self) -> NativeFuture<()> {
        Box::pin(async { Ok(()) })
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
    fn call(&self, engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
        // Operations prefixed with @ are private adapter integration, never Program API.
        if operation.starts_with('@') {
            return self.implementation.call(engine, operation, input);
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
        let output = self.implementation.call(engine, operation, input);
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

fn validate_value(value: &Value, contract: &TypeContract, path: &str) -> NativeResult<()> {
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
    provided: RwLock<BTreeMap<String, Value>>,
    resources: Mutex<Vec<Value>>,
}

impl Engine {
    pub fn new() -> Self {
        Self(Arc::new(EngineState {
            external: RwLock::new(BTreeMap::new()),
            provided: RwLock::new(BTreeMap::new()),
            resources: Mutex::new(Vec::new()),
        }))
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

    pub fn dependency_value(&self, name: &str) -> NativeResult<Value> {
        if let Some(value) = read(&self.0.provided).get(name) {
            return Ok(value.clone());
        }
        if read(&self.0.external).contains_key(name) {
            return Ok(Value::Dependency(name.to_owned()));
        }
        Err(NativeError::new(
            "MissingDependency",
            format!("Missing Dependency {name:?}."),
        ))
    }

    pub fn retain(&self, value: Value) {
        if !value.is_undefined() {
            lock(&self.0.resources).push(value);
        }
    }

    pub fn provide(&self, names: &[&str], value: Value) -> NativeResult<()> {
        let record = value.as_record()?;
        let actual = record.keys().map(String::as_str).collect::<Vec<_>>();
        if actual != names {
            return Err(NativeError::new(
                "InvalidProvision",
                format!("Provided {actual:?}, declared {names:?}."),
            ));
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
        Ok(())
    }

    pub fn has_live_resources(&self) -> bool {
        !lock(&self.0.resources).is_empty()
    }

    pub async fn shutdown(&self) -> NativeResult<()> {
        let resources = std::mem::take(&mut *lock(&self.0.resources));
        let mut errors = Vec::new();
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

    pub async fn next(&self, stream: Value) -> NativeResult<Option<Value>> {
        match stream {
            Value::Stream(stream) => stream.lock().await.next().await.transpose(),
            Value::Record(record) => {
                let iterator = if record.contains_key("next") {
                    Value::Record(record)
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

    pub async fn call_dependency(
        &self,
        name: &str,
        operation: &str,
        input: Value,
    ) -> NativeResult<Value> {
        let provided = { read(&self.0.provided).get(name).cloned() };
        if let Some(value) = provided {
            return self.method(value, operation, vec![input]).await;
        }
        let dependency = { read(&self.0.external).get(name).cloned() }.ok_or_else(|| {
            NativeError::new(
                "MissingDependency",
                format!("Missing Dependency {name}.{operation}."),
            )
        })?;
        dependency.call(self.clone(), operation, input).await
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
        let Value::Record(record) = value else {
            return Ok(());
        };
        if let Some(dispose) = record
            .get("@asyncDispose")
            .or_else(|| record.get("@dispose"))
        {
            self.invoke(dispose.clone(), Vec::new()).await?;
        }
        Ok(())
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Value {
    pub fn record(values: BTreeMap<String, Value>) -> Self {
        Self::Record(Arc::new(values))
    }

    pub fn array(values: Vec<Value>) -> Self {
        Self::Array(Arc::new(Mutex::new(values)))
    }

    pub fn stream(stream: NativeStream) -> Self {
        Self::Stream(Arc::new(tokio::sync::Mutex::new(stream)))
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
            JsonValue::Object(values) => Self::record(
                values
                    .iter()
                    .map(|(name, value)| (name.clone(), Self::from_json(value)))
                    .collect(),
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
                    .map(|(name, value)| (name.clone(), Self::from_canonical_json(value)))
                    .collect(),
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
            Self::Error(value) => Ok(JsonValue::String(value.message.clone())),
            _ => Err(NativeError::new("TypeError", "Value is not serializable.")),
        }
    }

    pub fn as_record(&self) -> NativeResult<Arc<BTreeMap<String, Value>>> {
        match self {
            Self::Record(value) => Ok(value.clone()),
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
            Self::Record(_) => "[object Object]".to_owned(),
            Self::Error(value) => format!("{}: {}", value.name, value.message),
            Self::Function(_) | Self::Dependency(_) | Self::Stream(_) => format!("{self:?}"),
        }
    }

    pub fn property(&self, name: &str, optional: bool) -> NativeResult<Value> {
        if matches!(self, Self::Undefined | Self::Null) && optional {
            return Ok(Self::Undefined);
        }
        match self {
            Self::Record(value) => Ok(value.get(name).cloned().unwrap_or(Self::Undefined)),
            Self::Error(value) => Ok(match name {
                "name" => Self::String(value.name.clone()),
                "message" => Self::String(value.message.clone()),
                _ => value.fields.get(name).cloned().unwrap_or(Self::Undefined),
            }),
            Self::Array(value) if name == "length" => Ok(Self::Number(lock(value).len() as f64)),
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
    use super::*;

    struct Noop;

    impl Dependency for Noop {
        fn call(&self, _engine: Engine, operation: &str, _input: Value) -> NativeFuture<Value> {
            let operation = operation.to_owned();
            Box::pin(async move {
                Err(NativeError::new(
                    "UnknownOperation",
                    format!("Noop has no operation {operation:?}."),
                ))
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
