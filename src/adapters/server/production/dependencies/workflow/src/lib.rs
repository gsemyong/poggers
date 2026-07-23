use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use kit_server_runtime::{
    Dependency, DependencyContext, Engine, NativeError, NativeFunction, NativeFuture, NativeResult,
    Value,
};
use tokio::task::JoinHandle;

const WORKFLOW_LEASE_DURATION: f64 = 30_000.0;

pub struct WorkflowRuntime;

pub async fn create(_context: DependencyContext) -> NativeResult<WorkflowRuntime> {
    Ok(WorkflowRuntime)
}

impl Dependency for WorkflowRuntime {
    fn call(&self, engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
        let operation = operation.to_owned();
        Box::pin(async move {
            match operation.as_str() {
                "create" => Service::create(engine, input).await,
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("Workflow runtime has no operation {operation:?}."),
                )),
            }
        })
    }
}

struct Service {
    name: String,
    owner: String,
    implementation: Arc<BTreeMap<String, Value>>,
    dependencies: Arc<BTreeMap<String, Value>>,
    active: Mutex<HashMap<String, Arc<Execution>>>,
    starting: tokio::sync::Mutex<()>,
    disposed: AtomicBool,
}

impl Service {
    async fn create(engine: Engine, input: Value) -> NativeResult<Value> {
        let input = input.as_record()?;
        let implementation = input
            .get("implementation")
            .ok_or_else(|| invalid("workflow implementation is missing."))?
            .as_record()?;
        let dependencies = input
            .get("dependencies")
            .ok_or_else(|| invalid("workflow Dependencies are missing."))?
            .as_record()?;
        let name = required_string(&implementation, "name")?;
        let owner = engine
            .call_dependency("identifiers", "create", Value::record(BTreeMap::new()))
            .await?
            .string()?;
        let service = Arc::new(Self {
            name,
            owner,
            implementation,
            dependencies,
            active: Mutex::new(HashMap::new()),
            starting: tokio::sync::Mutex::new(()),
            disposed: AtomicBool::new(false),
        });
        service.value(engine)
    }

    fn value(self: &Arc<Self>, _engine: Engine) -> NativeResult<Value> {
        let start = service_function(self, |service, engine, input| {
            Box::pin(async move {
                let input = input.as_record()?;
                let id = required_string(&input, "id")?;
                identifier(&id)?;
                let workflow_input = input.get("input").cloned().unwrap_or(Value::Undefined);
                service.ensure_started(&engine, &id, workflow_input).await?;
                service.ensure_running(&engine, &id).await?;
                service.snapshot(&engine, &id).await
            })
        });
        let get = service_function(self, |service, engine, input| {
            Box::pin(async move {
                let input = input.as_record()?;
                let id = required_string(&input, "id")?;
                service.ensure_running(&engine, &id).await?;
                service.snapshot(&engine, &id).await
            })
        });
        let result = service_function(self, |service, engine, input| {
            Box::pin(async move {
                let input = input.as_record()?;
                let id = required_string(&input, "id")?;
                service.ensure_running(&engine, &id).await?;
                service.result(&engine, &id).await
            })
        });
        let cancel = service_function(self, |service, engine, input| {
            Box::pin(async move {
                let input = input.as_record()?;
                let id = required_string(&input, "id")?;
                let history = read_history(&engine, &service.stream(&id)).await?;
                require_started(&history, &id)?;
                if terminal(&history).is_some() {
                    return Ok(Value::Undefined);
                }
                let mut fields = BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.cancelled".to_owned()),
                    ),
                    ("at".to_owned(), now(&engine).await?),
                ]);
                if let Some(reason) = input.get("reason")
                    && !reason.is_undefined()
                {
                    fields.insert("reason".to_owned(), reason.clone());
                }
                append(&engine, &service.stream(&id), Value::record(fields)).await?;
                if let Some(execution) = lock(&service.active).get(&id) {
                    execution.cancelled.store(true, Ordering::SeqCst);
                }
                Ok(Value::Undefined)
            })
        });
        let watch = {
            let service = self.clone();
            Value::Function(NativeFunction::new(move |engine, arguments| {
                let service = service.clone();
                Box::pin(async move {
                    let input = one(arguments)?.as_record()?;
                    let id = required_string(&input, "id")?;
                    service.watch(engine, id).await
                })
            }))
        };
        let signals = self.operation_group("signals", true)?;
        let queries = self.operation_group("queries", false)?;
        let dispose = {
            let service = self.clone();
            Value::Function(NativeFunction::new(move |_engine, _arguments| {
                let service = service.clone();
                Box::pin(async move {
                    service.disposed.store(true, Ordering::SeqCst);
                    let active = lock(&service.active)
                        .drain()
                        .map(|(_, value)| value)
                        .collect::<Vec<_>>();
                    for execution in active {
                        execution.stop();
                        execution.release().await?;
                    }
                    Ok(Value::Undefined)
                })
            }))
        };
        Ok(Value::record(BTreeMap::from([
            ("start".to_owned(), start),
            ("get".to_owned(), get),
            ("result".to_owned(), result),
            ("cancel".to_owned(), cancel),
            ("watch".to_owned(), watch),
            ("signals".to_owned(), signals),
            ("queries".to_owned(), queries),
            ("@asyncDispose".to_owned(), dispose),
        ])))
    }

    fn operation_group(self: &Arc<Self>, field: &str, signal: bool) -> NativeResult<Value> {
        let operations = self
            .implementation
            .get(field)
            .ok_or_else(|| invalid(format!("workflow {field} are missing.")))?
            .as_record()?;
        let mut result = BTreeMap::new();
        for name in operations.keys() {
            let name_for_call = name.clone();
            let function = if signal {
                service_function(self, move |service, engine, input| {
                    let name = name_for_call.clone();
                    Box::pin(async move { service.signal(&engine, &name, input).await })
                })
            } else {
                service_function(self, move |service, engine, input| {
                    let name = name_for_call.clone();
                    Box::pin(async move { service.query(&engine, &name, input).await })
                })
            };
            result.insert(name.clone(), function);
        }
        Ok(Value::record(result))
    }

    async fn ensure_started(&self, engine: &Engine, id: &str, input: Value) -> NativeResult<()> {
        let stream = self.stream(id);
        for _ in 0..64 {
            let history = read_history(engine, &stream).await?;
            if let Some(started) = started(&history) {
                if canonical(started.event.property("input", false)?)? != canonical(input)? {
                    return Err(invalid(format!(
                        "Workflow {id:?} was started with different input."
                    )));
                }
                return Ok(());
            }
            if !history.is_empty() {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} has no start event."
                )));
            }
            let initial = engine
                .invoke(self.function("state")?, vec![input.clone()])
                .await?;
            let event = Value::record(BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.started".to_owned()),
                ),
                ("input".to_owned(), portable(input.clone())?),
                ("state".to_owned(), portable(initial)?),
                ("at".to_owned(), now(engine).await?),
            ]));
            if append_expected(engine, &stream, 0, event).await?.is_some() {
                return Ok(());
            }
        }
        Err(invalid(format!(
            "Workflow journal {stream:?} changed too frequently."
        )))
    }

    async fn ensure_running(self: &Arc<Self>, engine: &Engine, id: &str) -> NativeResult<()> {
        self.assert_active()?;
        if lock(&self.active).contains_key(id) {
            return Ok(());
        }
        let _starting = self.starting.lock().await;
        if lock(&self.active).contains_key(id) {
            return Ok(());
        }
        let history = read_history(engine, &self.stream(id)).await?;
        let started = require_started(&history, id)?;
        if terminal(&history).is_some() {
            return Ok(());
        }
        if !claim_workflow(
            engine,
            &self.stream(id),
            &self.owner,
            now(engine).await?.number()?,
        )
        .await?
        {
            return Ok(());
        }
        let input = started.event.property("input", false)?;
        let state = engine
            .invoke(self.function("state")?, vec![input.clone()])
            .await?
            .into_mutable_record()?;
        let execution = Arc::new(Execution {
            id: id.to_owned(),
            stream: self.stream(id),
            input,
            state,
            service: Arc::downgrade(self),
            engine: engine.clone(),
            owner: self.owner.clone(),
            sequence: AtomicU64::new(0),
            delivered: tokio::sync::Mutex::new(HashSet::new()),
            cancelled: AtomicBool::new(false),
            lease_lost: AtomicBool::new(false),
            task: Mutex::new(None),
            heartbeat: Mutex::new(None),
        });
        lock(&self.active).insert(id.to_owned(), execution.clone());
        let running = execution.clone();
        let task = tokio::spawn(async move {
            running.run().await;
        });
        *lock(&execution.task) = Some(task);
        let pulse = execution.clone();
        *lock(&execution.heartbeat) = Some(tokio::spawn(async move {
            pulse.heartbeat().await;
        }));
        Ok(())
    }

    async fn result(self: &Arc<Self>, engine: &Engine, id: &str) -> NativeResult<Value> {
        loop {
            let history = read_history(engine, &self.stream(id)).await?;
            require_started(&history, id)?;
            if let Some(event) = terminal(&history) {
                return terminal_result(event, id);
            }
            let after = history.last().map(|event| event.revision).unwrap_or(0);
            let changes = engine
                .call_dependency(
                    "events",
                    "subscribe",
                    Value::record(BTreeMap::from([
                        ("stream".to_owned(), Value::String(self.stream(id))),
                        ("after".to_owned(), Value::Number(after as f64)),
                    ])),
                )
                .await?;
            if engine.next(changes).await?.is_none() {
                return Err(invalid(format!("Workflow {id:?} ended without a result.")));
            }
        }
    }

    async fn watch(self: &Arc<Self>, engine: Engine, id: String) -> NativeResult<Value> {
        let service = self.clone();
        Ok(Value::stream(Box::pin(async_stream::try_stream! {
            loop {
                let history = read_history(&engine, &service.stream(&id)).await?;
                require_started(&history, &id)?;
                yield service.snapshot_from_history(&id, &history)?;
                if terminal(&history).is_some() {
                    break;
                }
                let after = history.last().map(|event| event.revision).unwrap_or(0);
                let changes = engine
                    .call_dependency(
                        "events",
                        "subscribe",
                        Value::record(BTreeMap::from([
                            ("stream".to_owned(), Value::String(service.stream(&id))),
                            ("after".to_owned(), Value::Number(after as f64)),
                        ])),
                    )
                    .await?;
                if engine.next(changes).await?.is_none() {
                    break;
                }
            }
        })))
    }

    async fn signal(
        self: &Arc<Self>,
        engine: &Engine,
        name: &str,
        input: Value,
    ) -> NativeResult<Value> {
        let input = input.as_record()?;
        let id = required_string(&input, "id")?;
        let signal_input = input.get("input").cloned().unwrap_or(Value::Undefined);
        let history = read_history(engine, &self.stream(&id)).await?;
        require_started(&history, &id)?;
        if terminal(&history).is_some() {
            return Err(invalid(format!("Workflow {id:?} has already finished.")));
        }
        let boundary = lock(&self.active)
            .get(&id)
            .map(|execution| execution.sequence.load(Ordering::SeqCst).max(1))
            .unwrap_or_else(|| next_sequence(&history));
        let appended = append(
            engine,
            &self.stream(&id),
            Value::record(BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.signal.received".to_owned()),
                ),
                ("name".to_owned(), Value::String(name.to_owned())),
                ("input".to_owned(), portable(signal_input)?),
                ("boundary".to_owned(), Value::Number(boundary as f64)),
                ("at".to_owned(), now(engine).await?),
            ])),
        )
        .await?;
        let execution = lock(&self.active).get(&id).cloned();
        if let Some(execution) = execution {
            execution
                .deliver(execution.sequence.load(Ordering::SeqCst).max(1))
                .await?;
        }
        Ok(appended)
    }

    async fn query(
        self: &Arc<Self>,
        engine: &Engine,
        name: &str,
        input: Value,
    ) -> NativeResult<Value> {
        let input = input.as_record()?;
        let id = required_string(&input, "id")?;
        self.ensure_running(engine, &id).await?;
        let state = if let Some(execution) = lock(&self.active).get(&id) {
            portable(execution.state.clone())?
        } else {
            let history = read_history(engine, &self.stream(&id)).await?;
            state_from_history(&history, &id)?
        };
        let query = self
            .implementation
            .get("queries")
            .ok_or_else(|| invalid("workflow queries are missing."))?
            .property(name, false)?;
        engine
            .invoke(
                query,
                vec![
                    Value::record(BTreeMap::from([("state".to_owned(), state)])),
                    input.get("input").cloned().unwrap_or(Value::Undefined),
                ],
            )
            .await
    }

    async fn snapshot(&self, engine: &Engine, id: &str) -> NativeResult<Value> {
        let history = read_history(engine, &self.stream(id)).await?;
        require_started(&history, id)?;
        self.snapshot_from_history(id, &history)
    }

    fn snapshot_from_history(&self, id: &str, history: &[Stored]) -> NativeResult<Value> {
        let state = if let Some(execution) = lock(&self.active).get(id) {
            portable(execution.state.clone())?
        } else {
            state_from_history(history, id)?
        };
        let terminal = terminal(history);
        let status = terminal
            .map(|stored| event_type(&stored.event))
            .transpose()?
            .map(|kind| match kind.as_str() {
                "workflow.completed" => "completed",
                "workflow.failed" => "failed",
                "workflow.cancelled" => "cancelled",
                _ => "running",
            })
            .unwrap_or("running");
        let mut snapshot = BTreeMap::from([
            ("id".to_owned(), Value::String(id.to_owned())),
            (
                "revision".to_owned(),
                Value::Number(history.last().map(|event| event.revision).unwrap_or(0) as f64),
            ),
            ("status".to_owned(), Value::String(status.to_owned())),
            ("state".to_owned(), state),
        ]);
        if let Some(terminal) = terminal {
            match event_type(&terminal.event)?.as_str() {
                "workflow.completed" => {
                    snapshot.insert(
                        "result".to_owned(),
                        terminal.event.property("result", false)?,
                    );
                }
                "workflow.failed" => {
                    snapshot.insert("error".to_owned(), terminal.event.property("error", false)?);
                }
                _ => {}
            }
        }
        Ok(Value::record(snapshot))
    }

    fn function(&self, name: &str) -> NativeResult<Value> {
        let value = self
            .implementation
            .get(name)
            .cloned()
            .ok_or_else(|| invalid(format!("workflow implementation is missing {name:?}.")))?;
        if !matches!(value, Value::Function(_)) {
            return Err(invalid(format!("workflow {name:?} must be a function.")));
        }
        Ok(value)
    }

    fn stream(&self, id: &str) -> String {
        format!("workflow:{}:{}", self.name, percent_encode(id))
    }

    fn assert_active(&self) -> NativeResult<()> {
        if self.disposed.load(Ordering::SeqCst) {
            Err(invalid(format!(
                "Workflow Feature {} is disposed.",
                self.name
            )))
        } else {
            Ok(())
        }
    }
}

struct Execution {
    id: String,
    stream: String,
    input: Value,
    state: Value,
    service: std::sync::Weak<Service>,
    engine: Engine,
    owner: String,
    sequence: AtomicU64,
    delivered: tokio::sync::Mutex<HashSet<u64>>,
    cancelled: AtomicBool,
    lease_lost: AtomicBool,
    task: Mutex<Option<JoinHandle<()>>>,
    heartbeat: Mutex<Option<JoinHandle<()>>>,
}

impl Execution {
    async fn run(self: &Arc<Self>) {
        let result = self.execute().await;
        if let Some(heartbeat) = lock(&self.heartbeat).take() {
            heartbeat.abort();
        }
        if let Some(service) = self.service.upgrade() {
            if let Err(error) = result
                && !self.cancelled.load(Ordering::SeqCst)
                && !self.lease_lost.load(Ordering::SeqCst)
            {
                let _ = self
                    .append(Value::record(BTreeMap::from([
                        (
                            "type".to_owned(),
                            Value::String("workflow.failed".to_owned()),
                        ),
                        ("error".to_owned(), error_value(&error)),
                        (
                            "state".to_owned(),
                            portable(self.state.clone()).unwrap_or(Value::Null),
                        ),
                        (
                            "at".to_owned(),
                            now(&self.engine).await.unwrap_or(Value::Number(0.0)),
                        ),
                    ])))
                    .await;
            }
            lock(&service.active).remove(&self.id);
        }
    }

    async fn execute(self: &Arc<Self>) -> NativeResult<()> {
        let service = self.service()?;
        let run = service.function("run")?;
        let context = Value::record(BTreeMap::from([
            ("dependencies".to_owned(), self.durable_dependencies()?),
            ("state".to_owned(), self.state.clone()),
            ("sleep".to_owned(), self.sleep_function()),
            ("cancelled".to_owned(), self.cancelled_function()),
        ]));
        let result = self
            .engine
            .invoke(run, vec![context, self.input.clone()])
            .await?;
        self.deliver(u64::MAX).await?;
        if self.cancelled.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.append(Value::record(BTreeMap::from([
            (
                "type".to_owned(),
                Value::String("workflow.completed".to_owned()),
            ),
            ("result".to_owned(), portable(result)?),
            ("state".to_owned(), portable(self.state.clone())?),
            ("at".to_owned(), now(&self.engine).await?),
        ])))
        .await?;
        Ok(())
    }

    async fn heartbeat(self: &Arc<Self>) {
        while !self.cancelled.load(Ordering::SeqCst) && !self.lease_lost.load(Ordering::SeqCst) {
            let current = match now(&self.engine).await.and_then(|value| value.number()) {
                Ok(value) => value,
                Err(_) => break,
            };
            let slept = self
                .engine
                .call_dependency(
                    "timer",
                    "sleep",
                    Value::record(BTreeMap::from([(
                        "until".to_owned(),
                        Value::Number(current + WORKFLOW_LEASE_DURATION / 3.0),
                    )])),
                )
                .await;
            if slept.is_err() || self.cancelled.load(Ordering::SeqCst) {
                break;
            }
            let current = match now(&self.engine).await.and_then(|value| value.number()) {
                Ok(value) => value,
                Err(_) => break,
            };
            match renew_workflow(&self.engine, &self.stream, &self.owner, current).await {
                Ok(true) => {}
                Ok(false) | Err(_) => {
                    self.lease_lost.store(true, Ordering::SeqCst);
                    if let Some(task) = lock(&self.task).take() {
                        task.abort();
                    }
                    if let Some(service) = self.service.upgrade() {
                        lock(&service.active).remove(&self.id);
                    }
                    break;
                }
            }
        }
    }

    fn durable_dependencies(self: &Arc<Self>) -> NativeResult<Value> {
        let service = self.service()?;
        let mut result = BTreeMap::new();
        for (name, value) in service.dependencies.iter() {
            if ["clock", "events", "identifiers", "timer", "workflowRuntime"]
                .contains(&name.as_str())
            {
                continue;
            }
            result.insert(name.clone(), self.durable_dependency(name, value.clone())?);
        }
        Ok(Value::record(result))
    }

    fn durable_dependency(self: &Arc<Self>, name: &str, value: Value) -> NativeResult<Value> {
        match value {
            Value::Dependency(dependency) => {
                let execution = self.clone();
                let name = name.to_owned();
                Ok(Value::intercepted_dependency(NativeFunction::new(
                    move |_engine, arguments| {
                        let execution = execution.clone();
                        let name = name.clone();
                        let dependency = dependency.clone();
                        Box::pin(async move {
                            let operation = arguments
                                .first()
                                .cloned()
                                .unwrap_or(Value::Undefined)
                                .string()?;
                            let input = arguments.get(1).cloned().unwrap_or(Value::Undefined);
                            execution
                                .effect(
                                    EffectTarget::Dependency(dependency),
                                    name,
                                    operation,
                                    input,
                                )
                                .await
                        })
                    },
                )))
            }
            Value::Record(operations) => {
                let mut result = BTreeMap::new();
                for (operation, function) in operations.iter() {
                    if !matches!(function, Value::Function(_)) {
                        result.insert(operation.clone(), function.clone());
                        continue;
                    }
                    let execution = self.clone();
                    let dependency_name = name.to_owned();
                    let operation_name = operation.clone();
                    let function = function.clone();
                    result.insert(
                        operation.clone(),
                        Value::Function(NativeFunction::new(move |_engine, arguments| {
                            let execution = execution.clone();
                            let dependency_name = dependency_name.clone();
                            let operation_name = operation_name.clone();
                            let function = function.clone();
                            Box::pin(async move {
                                execution
                                    .effect(
                                        EffectTarget::Function(function),
                                        dependency_name,
                                        operation_name,
                                        one(arguments)?,
                                    )
                                    .await
                            })
                        })),
                    );
                }
                Ok(Value::record(result))
            }
            value => Ok(value),
        }
    }

    async fn effect(
        self: &Arc<Self>,
        target: EffectTarget,
        dependency: String,
        operation: String,
        input: Value,
    ) -> NativeResult<Value> {
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        self.deliver(sequence).await?;
        self.assert_running()?;
        let service = self.service()?;
        let stream = service.stream(&self.id);
        let history = read_history(&self.engine, &stream).await?;
        if let Some(existing) = history.iter().find(|stored| {
            event_type(&stored.event).ok().as_deref() == Some("workflow.effect.completed")
                && event_sequence(&stored.event).ok() == Some(sequence)
        }) {
            self.verify_checkpoint(&history, "effect", sequence)?;
            if existing.event.property("dependency", false)?.string()? != dependency
                || existing.event.property("operation", false)?.string()? != operation
                || canonical(existing.event.property("input", false)?)? != canonical(input.clone())?
            {
                return Err(invalid(format!(
                    "Workflow {:?} changed durable effect {sequence}.",
                    self.id
                )));
            }
            return existing.event.property("result", false);
        }
        self.checkpoint("effect", sequence).await?;
        let retry = retry_policy(&service.implementation)?;
        let mut last_error = None;
        for attempt in 1..=retry.attempts {
            let called = match &target {
                EffectTarget::Dependency(name) => {
                    self.engine
                        .call_dependency(name, &operation, input.clone())
                        .await
                }
                EffectTarget::Function(function) => {
                    self.engine
                        .invoke(function.clone(), vec![input.clone()])
                        .await
                }
            };
            match called {
                Ok(result) => {
                    self.append(Value::record(BTreeMap::from([
                        (
                            "type".to_owned(),
                            Value::String("workflow.effect.completed".to_owned()),
                        ),
                        ("sequence".to_owned(), Value::Number(sequence as f64)),
                        ("dependency".to_owned(), Value::String(dependency)),
                        ("operation".to_owned(), Value::String(operation)),
                        ("input".to_owned(), portable(input)?),
                        ("result".to_owned(), portable(result.clone())?),
                        ("at".to_owned(), now(&self.engine).await?),
                    ])))
                    .await?;
                    return Ok(result);
                }
                Err(error) => {
                    last_error = Some(error);
                    if attempt >= retry.attempts {
                        break;
                    }
                    let delay = retry
                        .delay(&self.engine, attempt, last_error.as_ref().unwrap())
                        .await?;
                    if delay > 0 {
                        let deadline = now(&self.engine).await?.number()? + delay as f64;
                        self.engine
                            .call_dependency(
                                "timer",
                                "sleep",
                                Value::record(BTreeMap::from([(
                                    "until".to_owned(),
                                    Value::Number(deadline),
                                )])),
                            )
                            .await?;
                    }
                    self.assert_running()?;
                }
            }
        }
        Err(last_error.unwrap_or_else(|| invalid("workflow effect failed.")))
    }

    fn sleep_function(self: &Arc<Self>) -> Value {
        let execution = self.clone();
        Value::Function(NativeFunction::new(move |_engine, arguments| {
            let execution = execution.clone();
            Box::pin(async move {
                execution.sleep(one(arguments)?).await?;
                Ok(Value::Undefined)
            })
        }))
    }

    async fn sleep(self: &Arc<Self>, input: Value) -> NativeResult<()> {
        let milliseconds = input.property("milliseconds", false)?.number()?;
        if !milliseconds.is_finite() || milliseconds < 0.0 || milliseconds.fract() != 0.0 {
            return Err(invalid("workflow sleep must be a non-negative integer."));
        }
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        self.deliver(sequence).await?;
        self.assert_running()?;
        let service = self.service()?;
        let stream = service.stream(&self.id);
        let history = read_history(&self.engine, &stream).await?;
        let completed = history.iter().any(|stored| {
            event_type(&stored.event).ok().as_deref() == Some("workflow.timer.completed")
                && event_sequence(&stored.event).ok() == Some(sequence)
        });
        let scheduled = history.iter().find(|stored| {
            event_type(&stored.event).ok().as_deref() == Some("workflow.timer.scheduled")
                && event_sequence(&stored.event).ok() == Some(sequence)
        });
        let deadline = if let Some(scheduled) = scheduled {
            self.verify_checkpoint(&history, "timer", sequence)?;
            if scheduled.event.property("milliseconds", false)?.number()? != milliseconds {
                return Err(invalid(format!(
                    "Workflow {:?} changed timer {sequence}.",
                    self.id
                )));
            }
            if completed {
                return Ok(());
            }
            scheduled.event.property("deadline", false)?.number()?
        } else {
            if completed {
                return Err(invalid(format!(
                    "Workflow {:?} has an incomplete timer {sequence}.",
                    self.id
                )));
            }
            self.checkpoint("timer", sequence).await?;
            let deadline = now(&self.engine).await?.number()? + milliseconds;
            self.append(Value::record(BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.timer.scheduled".to_owned()),
                ),
                ("sequence".to_owned(), Value::Number(sequence as f64)),
                ("milliseconds".to_owned(), Value::Number(milliseconds)),
                ("deadline".to_owned(), Value::Number(deadline)),
                ("at".to_owned(), now(&self.engine).await?),
            ])))
            .await?;
            deadline
        };
        self.engine
            .call_dependency(
                "timer",
                "sleep",
                Value::record(BTreeMap::from([(
                    "until".to_owned(),
                    Value::Number(deadline),
                )])),
            )
            .await?;
        self.assert_running()?;
        self.append(Value::record(BTreeMap::from([
            (
                "type".to_owned(),
                Value::String("workflow.timer.completed".to_owned()),
            ),
            ("sequence".to_owned(), Value::Number(sequence as f64)),
            ("at".to_owned(), now(&self.engine).await?),
        ])))
        .await?;
        Ok(())
    }

    fn cancelled_function(self: &Arc<Self>) -> Value {
        let execution = self.clone();
        Value::Function(NativeFunction::new(move |_engine, _arguments| {
            let cancelled = execution.cancelled.load(Ordering::SeqCst);
            Box::pin(async move { Ok(Value::Boolean(cancelled)) })
        }))
    }

    async fn deliver(&self, boundary: u64) -> NativeResult<()> {
        let service = self.service()?;
        let stream = service.stream(&self.id);
        let history = read_history(&self.engine, &stream).await?;
        let mut delivered = self.delivered.lock().await;
        for stored in &history {
            if event_type(&stored.event)? != "workflow.signal.received"
                || event_number(&stored.event, "boundary")? as u64 > boundary
                || delivered.contains(&stored.revision)
            {
                continue;
            }
            let name = stored.event.property("name", false)?.string()?;
            let signal = service
                .implementation
                .get("signals")
                .ok_or_else(|| invalid("workflow signals are missing."))?
                .property(&name, false)?;
            self.engine
                .invoke(
                    signal,
                    vec![
                        Value::record(BTreeMap::from([("state".to_owned(), self.state.clone())])),
                        stored.event.property("input", false)?,
                    ],
                )
                .await?;
            delivered.insert(stored.revision);
            let persisted = history.iter().find(|candidate| {
                event_type(&candidate.event).ok().as_deref() == Some("workflow.state")
                    && candidate
                        .event
                        .property("signalRevision", true)
                        .ok()
                        .and_then(|value| value.number().ok())
                        == Some(stored.revision as f64)
            });
            if let Some(persisted) = persisted {
                if canonical(persisted.event.property("state", false)?)?
                    != canonical(self.state.clone())?
                {
                    return Err(invalid(format!(
                        "Workflow {:?} changed state after signal {name:?}.",
                        self.id
                    )));
                }
            } else if !self.cancelled.load(Ordering::SeqCst) {
                self.append(Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.state".to_owned()),
                    ),
                    ("state".to_owned(), portable(self.state.clone())?),
                    ("reason".to_owned(), Value::String("signal".to_owned())),
                    (
                        "signalRevision".to_owned(),
                        Value::Number(stored.revision as f64),
                    ),
                    ("at".to_owned(), now(&self.engine).await?),
                ])))
                .await?;
            }
        }
        Ok(())
    }

    async fn checkpoint(&self, reason: &str, sequence: u64) -> NativeResult<()> {
        self.append(Value::record(BTreeMap::from([
            (
                "type".to_owned(),
                Value::String("workflow.state".to_owned()),
            ),
            ("state".to_owned(), portable(self.state.clone())?),
            ("reason".to_owned(), Value::String(reason.to_owned())),
            ("sequence".to_owned(), Value::Number(sequence as f64)),
            ("at".to_owned(), now(&self.engine).await?),
        ])))
        .await?;
        Ok(())
    }

    fn verify_checkpoint(
        &self,
        history: &[Stored],
        reason: &str,
        sequence: u64,
    ) -> NativeResult<()> {
        let checkpoint = history.iter().find(|stored| {
            event_type(&stored.event).ok().as_deref() == Some("workflow.state")
                && stored
                    .event
                    .property("reason", false)
                    .and_then(|value| value.string())
                    .is_ok_and(|value| value == reason)
                && event_sequence(&stored.event).ok() == Some(sequence)
        });
        let matches = checkpoint
            .map(|checkpoint| {
                Ok(canonical(checkpoint.event.property("state", false)?)?
                    == canonical(self.state.clone())?)
            })
            .transpose()?
            .unwrap_or(false);
        if !matches {
            return Err(invalid(format!(
                "Workflow {:?} changed state before durable boundary {sequence}.",
                self.id
            )));
        }
        Ok(())
    }

    fn assert_running(&self) -> NativeResult<()> {
        if self.lease_lost.load(Ordering::SeqCst) {
            Err(invalid(format!(
                "Workflow {:?} lost its worker lease.",
                self.id
            )))
        } else if self.cancelled.load(Ordering::SeqCst) {
            Err(NativeError::new(
                "WorkflowCancelled",
                format!("Workflow {:?} was cancelled.", self.id),
            ))
        } else {
            Ok(())
        }
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(heartbeat) = lock(&self.heartbeat).take() {
            heartbeat.abort();
        }
        if let Some(task) = lock(&self.task).take() {
            task.abort();
        }
    }

    async fn append(&self, event: Value) -> NativeResult<Value> {
        self.assert_running()?;
        let stream = &self.stream;
        let current = now(&self.engine).await?.number()?;
        if !ensure_workflow_lease(&self.engine, stream, &self.owner, current).await? {
            self.lease_lost.store(true, Ordering::SeqCst);
            return Err(invalid(format!(
                "Workflow {:?} lost its worker lease.",
                self.id
            )));
        }
        append(&self.engine, stream, event).await
    }

    async fn release(&self) -> NativeResult<()> {
        release_workflow(
            &self.engine,
            &self.stream,
            &self.owner,
            now(&self.engine).await?.number()?,
        )
        .await
    }

    fn service(&self) -> NativeResult<Arc<Service>> {
        self.service
            .upgrade()
            .ok_or_else(|| invalid("workflow service is disposed."))
    }
}

enum EffectTarget {
    Dependency(String),
    Function(Value),
}

struct Retry {
    attempts: u64,
    delay: Value,
}

impl Retry {
    async fn delay(&self, engine: &Engine, attempt: u64, error: &NativeError) -> NativeResult<u64> {
        let value = match &self.delay {
            Value::Function(_) => {
                engine
                    .invoke(
                        self.delay.clone(),
                        vec![Value::record(BTreeMap::from([
                            ("attempt".to_owned(), Value::Number(attempt as f64)),
                            ("error".to_owned(), error_value(error)),
                        ]))],
                    )
                    .await?
            }
            value => value.clone(),
        };
        if value.is_undefined() {
            return Ok(0);
        }
        let delay = value.number()?;
        if !delay.is_finite() || delay < 0.0 || delay.fract() != 0.0 {
            return Err(invalid(
                "workflow retry delay must be a non-negative integer.",
            ));
        }
        Ok(delay as u64)
    }
}

fn retry_policy(implementation: &BTreeMap<String, Value>) -> NativeResult<Retry> {
    let Some(value) = implementation
        .get("retry")
        .filter(|value| !value.is_undefined())
    else {
        return Ok(Retry {
            attempts: 1,
            delay: Value::Number(0.0),
        });
    };
    let retry = value.as_record()?;
    let attempts = retry
        .get("attempts")
        .cloned()
        .unwrap_or(Value::Number(1.0))
        .number()?;
    if !attempts.is_finite() || attempts < 1.0 || attempts.fract() != 0.0 {
        return Err(invalid(
            "workflow retry attempts must be a positive integer.",
        ));
    }
    Ok(Retry {
        attempts: attempts as u64,
        delay: retry.get("delay").cloned().unwrap_or(Value::Number(0.0)),
    })
}

struct Stored {
    revision: u64,
    event: Value,
}

async fn read_history(engine: &Engine, stream: &str) -> NativeResult<Vec<Stored>> {
    let value = engine
        .call_dependency(
            "events",
            "read",
            Value::record(BTreeMap::from([(
                "stream".to_owned(),
                Value::String(stream.to_owned()),
            )])),
        )
        .await?;
    let values = value.as_array()?;
    let values = lock(&values).clone();
    values
        .into_iter()
        .map(|value| {
            let record = value.as_record()?;
            Ok(Stored {
                revision: required_number(&record, "revision")? as u64,
                event: record
                    .get("event")
                    .cloned()
                    .ok_or_else(|| invalid("stored workflow event is missing event data."))?,
            })
        })
        .collect()
}

async fn append(engine: &Engine, stream: &str, event: Value) -> NativeResult<Value> {
    for _ in 0..64 {
        let history = read_history(engine, stream).await?;
        if let Some(appended) = append_expected(
            engine,
            stream,
            history.last().map(|item| item.revision).unwrap_or(0),
            event.clone(),
        )
        .await?
        {
            return Ok(appended);
        }
    }
    Err(invalid(format!(
        "Workflow journal {stream:?} changed too frequently."
    )))
}

async fn append_expected(
    engine: &Engine,
    stream: &str,
    revision: u64,
    event: Value,
) -> NativeResult<Option<Value>> {
    let value = engine
        .call_dependency(
            "events",
            "append",
            Value::record(BTreeMap::from([
                ("stream".to_owned(), Value::String(stream.to_owned())),
                (
                    "expectedRevision".to_owned(),
                    Value::Number(revision as f64),
                ),
                ("events".to_owned(), Value::array(vec![event])),
            ])),
        )
        .await?;
    if value.is_undefined() {
        return Ok(None);
    }
    let values = value.as_array()?;
    Ok(lock(&values).first().cloned())
}

struct WorkerLease {
    owner: String,
    expires_at: f64,
}

async fn claim_workflow(
    engine: &Engine,
    stream: &str,
    owner: &str,
    current: f64,
) -> NativeResult<bool> {
    for _ in 0..64 {
        let history = read_history(engine, stream).await?;
        if terminal(&history).is_some() {
            return Ok(false);
        }
        let lease = workflow_lease(&history)?;
        if let Some(lease) = &lease {
            if lease.owner != owner && lease.expires_at > current {
                return Ok(false);
            }
            if lease.owner == owner && lease.expires_at > current {
                return Ok(true);
            }
        }
        let claimed = Value::record(BTreeMap::from([
            (
                "type".to_owned(),
                Value::String("workflow.worker.claimed".to_owned()),
            ),
            ("owner".to_owned(), Value::String(owner.to_owned())),
            (
                "expiresAt".to_owned(),
                Value::Number(current + WORKFLOW_LEASE_DURATION),
            ),
            ("at".to_owned(), Value::Number(current)),
        ]));
        if append_expected(
            engine,
            stream,
            history.last().map(|stored| stored.revision).unwrap_or(0),
            claimed,
        )
        .await?
        .is_some()
        {
            return Ok(true);
        }
    }
    Err(invalid(format!(
        "Workflow journal {stream:?} changed too frequently."
    )))
}

async fn renew_workflow(
    engine: &Engine,
    stream: &str,
    owner: &str,
    current: f64,
) -> NativeResult<bool> {
    for _ in 0..64 {
        let history = read_history(engine, stream).await?;
        if terminal(&history).is_some()
            || workflow_lease(&history)?.is_none_or(|lease| lease.owner != owner)
        {
            return Ok(false);
        }
        let claimed = Value::record(BTreeMap::from([
            (
                "type".to_owned(),
                Value::String("workflow.worker.claimed".to_owned()),
            ),
            ("owner".to_owned(), Value::String(owner.to_owned())),
            (
                "expiresAt".to_owned(),
                Value::Number(current + WORKFLOW_LEASE_DURATION),
            ),
            ("at".to_owned(), Value::Number(current)),
        ]));
        if append_expected(
            engine,
            stream,
            history.last().map(|stored| stored.revision).unwrap_or(0),
            claimed,
        )
        .await?
        .is_some()
        {
            return Ok(true);
        }
    }
    Err(invalid(format!(
        "Workflow journal {stream:?} changed too frequently."
    )))
}

async fn ensure_workflow_lease(
    engine: &Engine,
    stream: &str,
    owner: &str,
    current: f64,
) -> NativeResult<bool> {
    let history = read_history(engine, stream).await?;
    let Some(lease) = workflow_lease(&history)? else {
        return Ok(false);
    };
    if lease.owner != owner || lease.expires_at <= current {
        return Ok(false);
    }
    if lease.expires_at - current > WORKFLOW_LEASE_DURATION / 3.0 {
        return Ok(true);
    }
    renew_workflow(engine, stream, owner, current).await
}

async fn release_workflow(
    engine: &Engine,
    stream: &str,
    owner: &str,
    current: f64,
) -> NativeResult<()> {
    for _ in 0..64 {
        let history = read_history(engine, stream).await?;
        if terminal(&history).is_some()
            || workflow_lease(&history)?.is_none_or(|lease| lease.owner != owner)
        {
            return Ok(());
        }
        let released = Value::record(BTreeMap::from([
            (
                "type".to_owned(),
                Value::String("workflow.worker.released".to_owned()),
            ),
            ("owner".to_owned(), Value::String(owner.to_owned())),
            ("at".to_owned(), Value::Number(current)),
        ]));
        if append_expected(
            engine,
            stream,
            history.last().map(|stored| stored.revision).unwrap_or(0),
            released,
        )
        .await?
        .is_some()
        {
            return Ok(());
        }
    }
    Err(invalid(format!(
        "Workflow journal {stream:?} changed too frequently."
    )))
}

fn workflow_lease(history: &[Stored]) -> NativeResult<Option<WorkerLease>> {
    let mut lease: Option<WorkerLease> = None;
    for stored in history {
        match event_type(&stored.event)?.as_str() {
            "workflow.worker.claimed" => {
                lease = Some(WorkerLease {
                    owner: stored.event.property("owner", false)?.string()?,
                    expires_at: stored.event.property("expiresAt", false)?.number()?,
                });
            }
            "workflow.worker.released"
                if lease.as_ref().is_some_and(|lease| {
                    stored
                        .event
                        .property("owner", false)
                        .and_then(|owner| owner.string())
                        .is_ok_and(|owner| owner == lease.owner)
                }) =>
            {
                lease = None;
            }
            _ => {}
        }
    }
    Ok(lease)
}

async fn now(engine: &Engine) -> NativeResult<Value> {
    engine
        .call_dependency("clock", "now", Value::record(BTreeMap::new()))
        .await
}

fn started(history: &[Stored]) -> Option<&Stored> {
    history
        .iter()
        .find(|stored| event_type(&stored.event).ok().as_deref() == Some("workflow.started"))
}

fn require_started<'a>(history: &'a [Stored], id: &str) -> NativeResult<&'a Stored> {
    started(history).ok_or_else(|| invalid(format!("Workflow {id:?} does not exist.")))
}

fn terminal(history: &[Stored]) -> Option<&Stored> {
    history.iter().rev().find(|stored| {
        matches!(
            event_type(&stored.event).ok().as_deref(),
            Some("workflow.completed" | "workflow.failed" | "workflow.cancelled")
        )
    })
}

fn terminal_result(stored: &Stored, id: &str) -> NativeResult<Value> {
    match event_type(&stored.event)?.as_str() {
        "workflow.completed" => stored.event.property("result", false),
        "workflow.failed" => {
            let failure = stored.event.property("error", false)?;
            let failure_record = failure.as_record()?;
            Err(NativeError::new(
                required_string(&failure_record, "name")?,
                required_string(&failure_record, "message")?,
            ))
        }
        "workflow.cancelled" => Err(NativeError::new(
            "WorkflowCancelled",
            format!("Workflow {id:?} was cancelled."),
        )),
        _ => Err(invalid("workflow is not terminal.")),
    }
}

fn state_from_history(history: &[Stored], id: &str) -> NativeResult<Value> {
    let started = require_started(history, id)?;
    let mut state = started.event.property("state", false)?;
    for stored in history {
        if matches!(
            event_type(&stored.event)?.as_str(),
            "workflow.state" | "workflow.completed" | "workflow.failed"
        ) {
            state = stored.event.property("state", false)?;
        }
    }
    Ok(state)
}

fn next_sequence(history: &[Stored]) -> u64 {
    history
        .iter()
        .filter_map(|stored| event_sequence(&stored.event).ok())
        .max()
        .unwrap_or(0)
        + 1
}

fn event_sequence(event: &Value) -> NativeResult<u64> {
    Ok(event.property("sequence", true)?.number()? as u64)
}

fn event_number(event: &Value, field: &str) -> NativeResult<f64> {
    event.property(field, false)?.number()
}

fn event_type(event: &Value) -> NativeResult<String> {
    event.property("type", false)?.string()
}

fn service_function(
    service: &Arc<Service>,
    function: impl Fn(Arc<Service>, Engine, Value) -> NativeFuture<Value> + Send + Sync + 'static,
) -> Value {
    let service = service.clone();
    let function = Arc::new(function);
    Value::Function(NativeFunction::new(move |engine, arguments| {
        let service = service.clone();
        let function = function.clone();
        match one(arguments) {
            Ok(input) => function(service, engine, input),
            Err(error) => Box::pin(async move { Err(error) }),
        }
    }))
}

fn one(mut arguments: Vec<Value>) -> NativeResult<Value> {
    if arguments.len() > 1 {
        return Err(invalid("workflow operations accept one input object."));
    }
    Ok(arguments.pop().unwrap_or(Value::Undefined))
}

fn required_string(record: &BTreeMap<String, Value>, field: &str) -> NativeResult<String> {
    record
        .get(field)
        .cloned()
        .ok_or_else(|| invalid(format!("{field} is missing.")))?
        .string()
}

fn required_number(record: &BTreeMap<String, Value>, field: &str) -> NativeResult<f64> {
    record
        .get(field)
        .cloned()
        .ok_or_else(|| invalid(format!("{field} is missing.")))?
        .number()
}

fn portable(value: Value) -> NativeResult<Value> {
    Ok(Value::from_canonical_json(&value.canonical_json()?))
}

fn canonical(value: Value) -> NativeResult<String> {
    Ok(value.canonical_json()?.to_string())
}

fn error_value(error: &NativeError) -> Value {
    Value::record(BTreeMap::from([
        ("name".to_owned(), Value::String(error.name.clone())),
        ("message".to_owned(), Value::String(error.message.clone())),
    ]))
}

fn identifier(value: &str) -> NativeResult<()> {
    if value.is_empty() || value.len() > 512 {
        Err(invalid(
            "A workflow id must contain between 1 and 512 characters.",
        ))
    } else {
        Ok(())
    }
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect()
            }
        })
        .collect()
}

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::new("WorkflowFailure", message)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct Events {
        streams: Arc<Mutex<HashMap<String, Vec<Value>>>>,
    }

    impl Dependency for Events {
        fn call(&self, _engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
            let operation = operation.to_owned();
            let input = input.to_json();
            let streams = match input {
                Ok(input) => {
                    let stream = input
                        .get("stream")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    Ok((stream, input))
                }
                Err(error) => Err(error),
            };
            let state = match &operation[..] {
                "read" | "append" => Some(self.streams.clone()),
                _ => None,
            };
            if let Some(state) = state {
                return Box::pin(async move {
                    let (stream, input) = streams?;
                    match operation.as_str() {
                        "read" => {
                            let after = input
                                .get("after")
                                .and_then(serde_json::Value::as_u64)
                                .unwrap_or(0);
                            let values = lock(&state)
                                .get(&stream)
                                .cloned()
                                .unwrap_or_default()
                                .into_iter()
                                .enumerate()
                                .filter(|(index, _)| (*index as u64) + 1 > after)
                                .map(|(index, event)| {
                                    Value::record(BTreeMap::from([
                                        ("stream".to_owned(), Value::String(stream.clone())),
                                        ("revision".to_owned(), Value::Number((index + 1) as f64)),
                                        ("event".to_owned(), event),
                                    ]))
                                })
                                .collect();
                            Ok(Value::array(values))
                        }
                        "append" => {
                            let expected = input
                                .get("expectedRevision")
                                .and_then(serde_json::Value::as_u64)
                                .unwrap_or(0);
                            let events = input
                                .get("events")
                                .and_then(serde_json::Value::as_array)
                                .cloned()
                                .unwrap_or_default();
                            let mut streams = lock(&state);
                            let target = streams.entry(stream.clone()).or_default();
                            if target.len() as u64 != expected {
                                return Ok(Value::Undefined);
                            }
                            let mut appended = Vec::new();
                            for event in events {
                                let event = Value::from_json(&event);
                                target.push(event.clone());
                                appended.push(Value::record(BTreeMap::from([
                                    ("stream".to_owned(), Value::String(stream.clone())),
                                    ("revision".to_owned(), Value::Number(target.len() as f64)),
                                    ("event".to_owned(), event),
                                ])));
                            }
                            Ok(Value::array(appended))
                        }
                        _ => unreachable!(),
                    }
                });
            }
            Box::pin(async move {
                if operation == "subscribe" {
                    Ok(Value::stream(Box::pin(async_stream::stream! {
                        if false {
                            yield Ok(Value::Undefined);
                        }
                    })))
                } else {
                    Err(invalid(format!("unknown test event operation {operation}")))
                }
            })
        }
    }

    struct Clock(AtomicU64);

    impl Dependency for Clock {
        fn call(&self, _engine: Engine, operation: &str, _input: Value) -> NativeFuture<Value> {
            let value = self.0.fetch_add(1, Ordering::SeqCst);
            let operation = operation.to_owned();
            Box::pin(async move {
                if operation == "now" {
                    Ok(Value::Number(value as f64))
                } else {
                    Err(invalid("unknown clock operation"))
                }
            })
        }
    }

    struct Immediate;

    impl Dependency for Immediate {
        fn call(&self, _engine: Engine, operation: &str, _input: Value) -> NativeFuture<Value> {
            let operation = operation.to_owned();
            Box::pin(async move {
                if operation == "sleep" {
                    Ok(Value::Undefined)
                } else {
                    Err(invalid("unknown timer operation"))
                }
            })
        }
    }

    struct Identifiers;

    impl Dependency for Identifiers {
        fn call(&self, _engine: Engine, operation: &str, _input: Value) -> NativeFuture<Value> {
            let operation = operation.to_owned();
            Box::pin(async move {
                if operation == "create" {
                    Ok(Value::String("native-worker".to_owned()))
                } else {
                    Err(invalid("unknown identifier operation"))
                }
            })
        }
    }

    struct Messages(Arc<AtomicUsize>);

    impl Dependency for Messages {
        fn call(&self, _engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
            let calls = self.0.clone();
            let operation = operation.to_owned();
            Box::pin(async move {
                if operation != "send" {
                    return Err(invalid("unknown messages operation"));
                }
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(Value::record(BTreeMap::from([(
                    "message".to_owned(),
                    input.property("message", false)?,
                )])))
            })
        }
    }

    #[tokio::test]
    async fn executes_and_journals_intercepted_dependencies_natively() {
        let engine = Engine::new();
        let calls = Arc::new(AtomicUsize::new(0));
        engine
            .register(
                "events",
                Arc::new(Events {
                    streams: Arc::new(Mutex::new(HashMap::new())),
                }),
            )
            .expect("events");
        engine
            .register("clock", Arc::new(Clock(AtomicU64::new(1))))
            .expect("clock");
        engine
            .register("identifiers", Arc::new(Identifiers))
            .expect("identifiers");
        engine
            .register("timer", Arc::new(Immediate))
            .expect("timer");
        engine
            .register("messages", Arc::new(Messages(calls.clone())))
            .expect("messages");

        let state = Value::Function(NativeFunction::new(|_engine, _arguments| {
            Box::pin(async {
                Ok(Value::record(BTreeMap::from([(
                    "phase".to_owned(),
                    Value::String("pending".to_owned()),
                )])))
            })
        }));
        let run = Value::Function(NativeFunction::new(|engine, arguments| {
            Box::pin(async move {
                let context = arguments[0].clone();
                let input = arguments[1].clone();
                let messages = context
                    .property("dependencies", false)?
                    .property("messages", false)?;
                let result = engine
                    .method(
                        messages,
                        "send",
                        vec![Value::record(BTreeMap::from([(
                            "message".to_owned(),
                            input.property("message", false)?,
                        )]))],
                    )
                    .await?;
                engine.assign_property(
                    context.property("state", false)?,
                    "phase",
                    "=",
                    Value::String("sent".to_owned()),
                )?;
                Ok(result)
            })
        }));
        let runtime = WorkflowRuntime;
        let service = runtime
            .call(
                engine.clone(),
                "create",
                Value::record(BTreeMap::from([
                    (
                        "implementation".to_owned(),
                        Value::record(BTreeMap::from([
                            ("name".to_owned(), Value::String("mail".to_owned())),
                            ("state".to_owned(), state),
                            ("run".to_owned(), run),
                            ("signals".to_owned(), Value::record(BTreeMap::new())),
                            ("queries".to_owned(), Value::record(BTreeMap::new())),
                        ])),
                    ),
                    (
                        "dependencies".to_owned(),
                        Value::record(BTreeMap::from([
                            (
                                "messages".to_owned(),
                                Value::Dependency("messages".to_owned()),
                            ),
                            ("clock".to_owned(), Value::Dependency("clock".to_owned())),
                            ("events".to_owned(), Value::Dependency("events".to_owned())),
                            ("timer".to_owned(), Value::Dependency("timer".to_owned())),
                        ])),
                    ),
                ])),
            )
            .await
            .expect("workflow service");
        engine
            .method(
                service.clone(),
                "start",
                vec![Value::record(BTreeMap::from([
                    ("id".to_owned(), Value::String("one".to_owned())),
                    (
                        "input".to_owned(),
                        Value::record(BTreeMap::from([(
                            "message".to_owned(),
                            Value::String("hello".to_owned()),
                        )])),
                    ),
                ]))],
            )
            .await
            .expect("start workflow");

        let mut snapshot = Value::Undefined;
        for _ in 0..100 {
            snapshot = engine
                .method(
                    service.clone(),
                    "get",
                    vec![Value::record(BTreeMap::from([(
                        "id".to_owned(),
                        Value::String("one".to_owned()),
                    )]))],
                )
                .await
                .expect("get workflow");
            if snapshot
                .property("status", false)
                .expect("status")
                .string()
                .expect("status string")
                == "completed"
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(
            snapshot
                .property("state", false)
                .expect("state")
                .property("phase", false)
                .expect("phase")
                .string()
                .expect("phase string"),
            "sent"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn fences_replicas_and_allows_takeover_after_expiry() {
        let streams = Arc::new(Mutex::new(HashMap::new()));
        let first = Engine::new();
        first
            .register(
                "events",
                Arc::new(Events {
                    streams: streams.clone(),
                }),
            )
            .expect("first events");
        let second = Engine::new();
        second
            .register("events", Arc::new(Events { streams }))
            .expect("second events");
        let stream = "workflow:mail:shared";

        assert!(
            claim_workflow(&first, stream, "first", 0.0)
                .await
                .expect("first claim")
        );
        assert!(
            !claim_workflow(&second, stream, "second", 0.0)
                .await
                .expect("blocked second claim")
        );
        assert!(
            renew_workflow(&first, stream, "first", 10_000.0)
                .await
                .expect("renewal")
        );
        assert!(
            !claim_workflow(&second, stream, "second", 30_001.0)
                .await
                .expect("still blocked")
        );
        assert!(
            claim_workflow(&second, stream, "second", 40_001.0)
                .await
                .expect("takeover")
        );
        assert!(
            !ensure_workflow_lease(&first, stream, "first", 40_001.0)
                .await
                .expect("first fenced")
        );
    }
}
