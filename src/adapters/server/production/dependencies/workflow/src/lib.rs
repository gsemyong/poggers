use std::{
    collections::{BTreeMap, HashMap, HashSet},
    future::poll_fn,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use kit_server_runtime::{
    Dependency, DependencyCancellation, DependencyContext, DependencyInvocation, Engine,
    NativeError, NativeFunction, NativeFuture, NativeResult, Record, Value,
};
use tokio::task::JoinHandle;

const WORKFLOW_LEASE_DURATION: f64 = 30_000.0;
const WORKFLOW_DEFINITION_VERSION: f64 = 1.0;
const WORKFLOW_PROTOCOL_VERSION: f64 = 9.0;
const DEFERRED_INVOCATION_MARKER: &str = "kit.dependency.deferred-invocation";

pub struct WorkflowRuntime;

pub async fn create(_context: DependencyContext) -> NativeResult<WorkflowRuntime> {
    Ok(WorkflowRuntime)
}

impl Dependency for WorkflowRuntime {
    fn call(
        &self,
        engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
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
    implementation: Arc<Record>,
    dependencies: Arc<Record>,
    active: Mutex<HashMap<String, Arc<Execution>>>,
    starting: tokio::sync::Mutex<()>,
    disposed: AtomicBool,
}

#[derive(Clone)]
struct WorkflowExecution {
    id: String,
    run: String,
}

impl WorkflowExecution {
    fn value(&self) -> Value {
        Value::record(BTreeMap::from([
            ("id".to_owned(), Value::String(self.id.clone())),
            ("run".to_owned(), Value::String(self.run.clone())),
        ]))
    }
}

impl Service {
    async fn create(engine: Engine, input: Value) -> NativeResult<Value> {
        let input = input.as_record()?;
        let definition = input
            .get("definition")
            .ok_or_else(|| invalid("workflow definition is missing."))?
            .as_record()?;
        let version = required_number(&definition, "version")?;
        if version != WORKFLOW_DEFINITION_VERSION {
            return Err(invalid(format!(
                "unsupported workflow definition version {version}."
            )));
        }
        let protocol_version = required_number(&definition, "protocolVersion")?;
        if protocol_version != WORKFLOW_PROTOCOL_VERSION {
            return Err(invalid(format!(
                "unsupported workflow protocol version {protocol_version}."
            )));
        }
        definition
            .get("schemas")
            .ok_or_else(|| invalid("workflow definition schemas are missing."))?
            .as_record()?;
        let implementation = input
            .get("implementation")
            .ok_or_else(|| invalid("workflow implementation is missing."))?
            .as_record()?;
        validate_activity_policies(&implementation)?;
        let dependencies = input
            .get("dependencies")
            .ok_or_else(|| invalid("workflow Dependencies are missing."))?
            .as_record()?;
        let name = required_string(&definition, "name")?;
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
                let run = engine
                    .call_dependency("identifiers", "create", Value::record(BTreeMap::new()))
                    .await?
                    .string()?;
                let execution = service
                    .ensure_started(&engine, &id, &run, workflow_input)
                    .await?;
                service.ensure_running(&engine, &id).await?;
                Ok(execution.value())
            })
        });
        let describe = service_function(self, |service, engine, input| {
            Box::pin(async move {
                let input = input.as_record()?;
                let execution = service.select_execution(&engine, &input).await?;
                service.ensure_running(&engine, &execution.id).await?;
                service.snapshot(&engine, &execution.id).await
            })
        });
        let result = service_function(self, |service, engine, input| {
            Box::pin(async move {
                let input = input.as_record()?;
                let execution = service.select_execution(&engine, &input).await?;
                service.ensure_running(&engine, &execution.id).await?;
                service.result(&engine, &execution.id).await
            })
        });
        let cancel = service_function(self, |service, engine, input| {
            Box::pin(async move {
                let input = input.as_record()?;
                let execution = service.select_execution(&engine, &input).await?;
                let id = execution.id;
                let history = read_history(&engine, &service.stream(&id)).await?;
                if terminal(&history).is_some() {
                    return Ok(Value::Undefined);
                }
                let reason = input
                    .get("reason")
                    .filter(|value| !value.is_undefined())
                    .map(|value| value.clone().string())
                    .transpose()?;
                if let Some(requested) = cancellation_request(&history) {
                    let stored_reason = optional_string(&requested.event, "reason")?;
                    if stored_reason != reason {
                        return Err(invalid(format!(
                            "Workflow {id:?} was cancelled with a different reason."
                        )));
                    }
                    return Ok(Value::Undefined);
                }
                let mut fields = BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.cancellation.requested".to_owned()),
                    ),
                    ("at".to_owned(), now(&engine).await?),
                ]);
                if let Some(reason) = &reason {
                    fields.insert("reason".to_owned(), Value::String(reason.clone()));
                }
                append(&engine, &service.stream(&id), Value::record(fields)).await?;
                if let Some(execution) = lock(&service.active).get(&id) {
                    execution.cancellation.request_with_reason(reason.clone());
                }
                service.ensure_running(&engine, &id).await?;
                Ok(Value::Undefined)
            })
        });
        let watch = {
            let service = self.clone();
            Value::Function(NativeFunction::new(move |engine, arguments| {
                let service = service.clone();
                Box::pin(async move {
                    let input = one(arguments)?.as_record()?;
                    let execution = service.select_execution(&engine, &input).await?;
                    service.watch(engine, execution.id).await
                })
            }))
        };
        let activities = Value::record(BTreeMap::from([
            (
                "complete".to_owned(),
                service_function(self, |service, engine, input| {
                    Box::pin(async move { service.complete_activity(&engine, input).await })
                }),
            ),
            (
                "fail".to_owned(),
                service_function(self, |service, engine, input| {
                    Box::pin(async move { service.fail_activity(&engine, input).await })
                }),
            ),
            (
                "heartbeat".to_owned(),
                service_function(self, |service, engine, input| {
                    Box::pin(async move { service.heartbeat_activity(&engine, input).await })
                }),
            ),
        ]));
        let signal = self.operation_group("signals", true)?;
        let query = self.operation_group("queries", false)?;
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
            ("describe".to_owned(), describe),
            ("result".to_owned(), result),
            ("cancel".to_owned(), cancel),
            ("watch".to_owned(), watch),
            ("activities".to_owned(), activities),
            ("signal".to_owned(), signal),
            ("query".to_owned(), query),
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

    async fn ensure_started(
        &self,
        engine: &Engine,
        id: &str,
        run: &str,
        input: Value,
    ) -> NativeResult<WorkflowExecution> {
        let stream = self.stream(id);
        for _ in 0..64 {
            let history = read_history(engine, &stream).await?;
            if let Some(started) = started(&history) {
                if canonical(started.event.property("input", false)?)? != canonical(input)? {
                    return Err(invalid(format!(
                        "Workflow {id:?} was started with different input."
                    )));
                }
                return Ok(WorkflowExecution {
                    id: id.to_owned(),
                    run: started.event.property("run", false)?.string()?,
                });
            }
            if !history.is_empty() {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} has no start event."
                )));
            }
            let initial = engine
                .invoke(
                    self.function("state")?,
                    vec![Value::record(BTreeMap::from([(
                        "input".to_owned(),
                        input.clone(),
                    )]))],
                )
                .await?;
            let event = Value::record(BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.started".to_owned()),
                ),
                (
                    "definitionVersion".to_owned(),
                    Value::Number(WORKFLOW_DEFINITION_VERSION),
                ),
                (
                    "protocolVersion".to_owned(),
                    Value::Number(WORKFLOW_PROTOCOL_VERSION),
                ),
                ("run".to_owned(), Value::String(run.to_owned())),
                ("input".to_owned(), portable(input.clone())?),
                ("state".to_owned(), portable(initial)?),
                ("at".to_owned(), now(engine).await?),
            ]));
            if append_expected(engine, &stream, 0, event).await?.is_some() {
                return Ok(WorkflowExecution {
                    id: id.to_owned(),
                    run: run.to_owned(),
                });
            }
        }
        Err(invalid(format!(
            "Workflow journal {stream:?} changed too frequently."
        )))
    }

    async fn select_execution(
        &self,
        engine: &Engine,
        input: &Record,
    ) -> NativeResult<WorkflowExecution> {
        let selector = input
            .get("execution")
            .ok_or_else(|| invalid("workflow execution is missing."))?
            .as_record()?;
        let id = required_string(&selector, "id")?;
        identifier(&id)?;
        let history = read_history(engine, &self.stream(&id)).await?;
        let started = require_started(&history, &id)?;
        let run = started.event.property("run", false)?.string()?;
        if let Some(selected) = selector
            .get("run")
            .filter(|value| !value.is_undefined())
            .map(|value| value.clone().string())
            .transpose()?
        {
            if selected != run {
                return Err(invalid(format!(
                    "Workflow {id:?} has run {run:?}, not {selected:?}."
                )));
            }
        }
        Ok(WorkflowExecution { id, run })
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
        let run = started.event.property("run", false)?.string()?;
        let input = started.event.property("input", false)?;
        let state = engine
            .invoke(
                self.function("state")?,
                vec![Value::record(BTreeMap::from([(
                    "input".to_owned(),
                    input.clone(),
                )]))],
            )
            .await?
            .into_mutable_record()?;
        let logical_time = non_negative_safe_integer(
            &started.event.property("at", false)?,
            "workflow start time",
        )?;
        let cancellation = DependencyCancellation::default();
        if let Some(requested) = cancellation_request(&history) {
            cancellation.request_with_reason(optional_string(&requested.event, "reason")?);
        }
        let execution = Arc::new(Execution {
            id: id.to_owned(),
            run,
            stream: self.stream(id),
            input,
            state,
            service: Arc::downgrade(self),
            engine: engine.clone(),
            owner: self.owner.clone(),
            sequence: AtomicU64::new(0),
            logical_time: AtomicU64::new(logical_time),
            delivered: tokio::sync::Mutex::new(HashSet::new()),
            cancellation,
            stopped: DependencyCancellation::default(),
            lease_lost: AtomicBool::new(false),
            task: Mutex::new(None),
            heartbeat: Mutex::new(None),
            control: Mutex::new(None),
            branches: Mutex::new(Vec::new()),
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
        let observer = execution.clone();
        let after = history.last().map_or(0, |stored| stored.revision);
        *lock(&execution.control) = Some(tokio::spawn(async move {
            observer.observe(after).await;
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

    async fn complete_activity(&self, engine: &Engine, input: Value) -> NativeResult<Value> {
        let input = input.as_record()?;
        let result = input.get("result").cloned().unwrap_or(Value::Undefined);
        let result = portable(result)?;
        for _ in 0..64 {
            let context = self.deferred_activity_context(engine, &input).await?;
            if let Some(completed) = context.history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.activity.completed")
                    && event_sequence(&stored.event).ok() == Some(context.sequence)
                    && event_attempt(&stored.event).ok() == Some(context.attempt)
            }) {
                if canonical(completed.event.property("result", false)?)?
                    != canonical(result.clone())?
                {
                    return Err(invalid(format!(
                        "Deferred Dependency invocation {:?} was completed with a different result.",
                        context.id
                    )));
                }
                return Ok(Value::Undefined);
            }
            if context.closed() {
                return Err(invalid(format!(
                    "Deferred Dependency invocation {:?} is no longer pending.",
                    context.id
                )));
            }
            let mut event = BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.activity.completed".to_owned()),
                ),
                (
                    "sequence".to_owned(),
                    Value::Number(context.sequence as f64),
                ),
                ("attempt".to_owned(), Value::Number(context.attempt as f64)),
                ("at".to_owned(), now(engine).await?),
            ]);
            if !result.is_undefined() {
                event.insert("result".to_owned(), result.clone());
            }
            let expected = context.history.last().map_or(0, |stored| stored.revision);
            if append_expected(engine, &context.stream, expected, Value::record(event))
                .await?
                .is_some()
            {
                return Ok(Value::Undefined);
            }
        }
        Err(invalid(
            "Deferred Workflow Activity completion could not be recorded.",
        ))
    }

    async fn fail_activity(&self, engine: &Engine, input: Value) -> NativeResult<Value> {
        let input = input.as_record()?;
        let failure = input
            .get("failure")
            .ok_or_else(|| invalid("deferred Activity failure is missing."))?
            .as_record()?;
        let failure_type = required_string(&failure, "type")?;
        let message = failure
            .get("message")
            .filter(|value| !value.is_undefined())
            .map(|value| value.clone().string())
            .transpose()?
            .unwrap_or_else(|| failure_type.clone());
        let data = portable(failure.get("data").cloned().unwrap_or(Value::Undefined))?;
        let retry_delay = failure
            .get("retry")
            .filter(|value| !value.is_undefined())
            .map(|retry| {
                let retry = retry.as_record()?;
                let delay = retry
                    .get("delay")
                    .ok_or_else(|| invalid("Dependency retry delay is required."))?;
                non_negative_safe_integer(delay, "Dependency retry delay")
            })
            .transpose()?;
        let mut error = BTreeMap::from([
            ("name".to_owned(), Value::String(failure_type.clone())),
            ("message".to_owned(), Value::String(message)),
        ]);
        if !data.is_undefined() {
            error.insert("data".to_owned(), data);
        }
        let error = Value::record(error);
        for _ in 0..64 {
            let context = self.deferred_activity_context(engine, &input).await?;
            if let Some(failed) = context.history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref()
                    == Some("workflow.activity.attempt.failed")
                    && event_sequence(&stored.event).ok() == Some(context.sequence)
                    && event_attempt(&stored.event).ok() == Some(context.attempt)
            }) {
                if canonical(failed.event.property("error", false)?)? != canonical(error.clone())? {
                    return Err(invalid(format!(
                        "Deferred Dependency invocation {:?} failed with a different failure.",
                        context.id
                    )));
                }
                return Ok(Value::Undefined);
            }
            if context.closed() {
                return Err(invalid(format!(
                    "Deferred Dependency invocation {:?} is no longer pending.",
                    context.id
                )));
            }
            let scheduled = context
                .history
                .iter()
                .find(|stored| {
                    event_type(&stored.event).ok().as_deref() == Some("workflow.activity.scheduled")
                        && event_sequence(&stored.event).ok() == Some(context.sequence)
                })
                .ok_or_else(|| invalid("deferred Activity schedule is missing."))?;
            let policy_value = scheduled.event.property("policy", false)?;
            let policy_record = policy_value.as_record()?;
            let policy = policy_from_value(policy_record.as_ref())?;
            let scheduled_at = scheduled.event.property("at", false)?.number()?;
            let now = now(engine).await?.number()?;
            let total_deadline = policy
                .timeout
                .total
                .map(|timeout| scheduled_at + timeout as f64);
            let retry_at = if context.attempt < policy.retry.attempts
                && !policy.retry.non_retryable.contains(&failure_type)
            {
                let delay =
                    retry_delay.map_or_else(|| policy.retry.delay(context.attempt), Ok)? as f64;
                Some(total_deadline.map_or(now + delay, |deadline| deadline.min(now + delay)))
            } else {
                None
            };
            let mut event = BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.activity.attempt.failed".to_owned()),
                ),
                (
                    "sequence".to_owned(),
                    Value::Number(context.sequence as f64),
                ),
                ("attempt".to_owned(), Value::Number(context.attempt as f64)),
                ("error".to_owned(), error.clone()),
                ("at".to_owned(), Value::Number(now)),
            ]);
            if let Some(retry_at) = retry_at {
                event.insert("retryAt".to_owned(), Value::Number(retry_at));
            }
            let expected = context.history.last().map_or(0, |stored| stored.revision);
            if append_expected(engine, &context.stream, expected, Value::record(event))
                .await?
                .is_some()
            {
                return Ok(Value::Undefined);
            }
        }
        Err(invalid(
            "Deferred Workflow Activity failure could not be recorded.",
        ))
    }

    async fn heartbeat_activity(&self, engine: &Engine, input: Value) -> NativeResult<Value> {
        let input = input.as_record()?;
        let details = portable(input.get("details").cloned().unwrap_or(Value::Undefined))?;
        for _ in 0..64 {
            let context = self.deferred_activity_context(engine, &input).await?;
            if context.closed() {
                return Err(invalid(format!(
                    "Deferred Dependency invocation {:?} is no longer pending.",
                    context.id
                )));
            }
            let event = Value::record(BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.activity.heartbeat".to_owned()),
                ),
                (
                    "sequence".to_owned(),
                    Value::Number(context.sequence as f64),
                ),
                ("attempt".to_owned(), Value::Number(context.attempt as f64)),
                ("details".to_owned(), details.clone()),
                ("at".to_owned(), now(engine).await?),
            ]));
            let expected = context.history.last().map_or(0, |stored| stored.revision);
            if append_expected(engine, &context.stream, expected, event)
                .await?
                .is_some()
            {
                return Ok(Value::Undefined);
            }
        }
        Err(invalid(
            "Deferred Workflow Activity heartbeat could not be recorded.",
        ))
    }

    async fn deferred_activity_context(
        &self,
        engine: &Engine,
        input: &Record,
    ) -> NativeResult<DeferredActivityContext> {
        let invocation = input
            .get("invocation")
            .ok_or_else(|| invalid("deferred Activity invocation is missing."))?
            .as_record()?;
        let id = required_string(&invocation, "id")?;
        let activity = required_string(&invocation, "activity")?;
        let attempt = required_u64(&invocation, "attempt")?;
        let execution = invocation
            .get("execution")
            .ok_or_else(|| invalid("deferred Activity execution is missing."))?
            .as_record()?;
        let workflow = required_string(&execution, "workflow")?;
        let execution_id = required_string(&execution, "id")?;
        let execution_run = required_string(&execution, "run")?;
        if workflow != self.name {
            return Err(invalid(
                "Deferred Dependency invocation does not belong to this Workflow.",
            ));
        }
        let stream = self.stream(&execution_id);
        let history = read_history(engine, &stream).await?;
        let started = require_started(&history, &execution_id)?;
        let run = started.event.property("run", false)?.string()?;
        if execution_run != run {
            return Err(invalid(format!(
                "Workflow {execution_id:?} has run {run:?}, not {execution_run:?}."
            )));
        }
        let scheduled = history.iter().find(|stored| {
            event_type(&stored.event).ok().as_deref() == Some("workflow.activity.scheduled")
                && stored
                    .event
                    .property("id", false)
                    .and_then(|value| value.string())
                    .is_ok_and(|value| value == activity)
        });
        let Some(scheduled) = scheduled else {
            return Err(invalid(format!(
                "Deferred Dependency invocation {id:?} is not pending."
            )));
        };
        let sequence = event_sequence(&scheduled.event)?;
        let deferred = history.iter().any(|stored| {
            event_type(&stored.event).ok().as_deref() == Some("workflow.activity.deferred")
                && event_sequence(&stored.event).ok() == Some(sequence)
                && event_attempt(&stored.event).ok() == Some(attempt)
                && stored
                    .event
                    .property("id", false)
                    .and_then(|value| value.string())
                    .is_ok_and(|value| value == id)
        });
        if !deferred {
            return Err(invalid(format!(
                "Deferred Dependency invocation {id:?} is not pending."
            )));
        }
        Ok(DeferredActivityContext {
            id,
            attempt,
            sequence,
            stream,
            history,
        })
    }

    async fn signal(
        self: &Arc<Self>,
        engine: &Engine,
        name: &str,
        input: Value,
    ) -> NativeResult<Value> {
        let input = input.as_record()?;
        let selected = self.select_execution(engine, &input).await?;
        let id = selected.id.clone();
        let signal_input = input.get("input").cloned().unwrap_or(Value::Undefined);
        let history = read_history(engine, &self.stream(&id)).await?;
        if terminal(&history).is_some() {
            return Err(invalid(format!("Workflow {id:?} has already finished.")));
        }
        let boundary = lock(&self.active)
            .get(&id)
            .map(|execution| execution.sequence.load(Ordering::SeqCst).max(1))
            .unwrap_or_else(|| workflow_signal_boundary(&history));
        append(
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
        let active_execution = lock(&self.active).get(&id).cloned();
        if let Some(execution) = active_execution {
            execution
                .deliver(execution.sequence.load(Ordering::SeqCst).max(1), u64::MAX)
                .await?;
        }
        Ok(selected.value())
    }

    async fn query(
        self: &Arc<Self>,
        engine: &Engine,
        name: &str,
        input: Value,
    ) -> NativeResult<Value> {
        let input = input.as_record()?;
        let execution = self.select_execution(engine, &input).await?;
        let id = execution.id;
        let consistency = required_string(&input, "consistency")?;
        match consistency.as_str() {
            "current" => self.ensure_running(engine, &id).await?,
            "eventual" => {}
            _ => {
                return Err(invalid(
                    "workflow query consistency must be \"eventual\" or \"current\".",
                ));
            }
        }
        let history = read_history(engine, &self.stream(&id)).await?;
        let state = state_from_history(&history, &id)?;
        let query = self
            .implementation
            .get("queries")
            .ok_or_else(|| invalid("workflow queries are missing."))?
            .property(name, false)?;
        engine
            .invoke(
                query,
                vec![Value::record(BTreeMap::from([
                    ("state".to_owned(), state),
                    (
                        "input".to_owned(),
                        input.get("input").cloned().unwrap_or(Value::Undefined),
                    ),
                ]))],
            )
            .await
    }

    async fn snapshot(&self, engine: &Engine, id: &str) -> NativeResult<Value> {
        let history = read_history(engine, &self.stream(id)).await?;
        require_started(&history, id)?;
        self.snapshot_from_history(id, &history)
    }

    fn snapshot_from_history(&self, id: &str, history: &[Stored]) -> NativeResult<Value> {
        let state = state_from_history(history, id)?;
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
            (
                "execution".to_owned(),
                WorkflowExecution {
                    id: id.to_owned(),
                    run: require_started(history, id)?
                        .event
                        .property("run", false)?
                        .string()?,
                }
                .value(),
            ),
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
    run: String,
    stream: String,
    input: Value,
    state: Value,
    service: std::sync::Weak<Service>,
    engine: Engine,
    owner: String,
    sequence: AtomicU64,
    logical_time: AtomicU64,
    delivered: tokio::sync::Mutex<HashSet<u64>>,
    cancellation: DependencyCancellation,
    stopped: DependencyCancellation,
    lease_lost: AtomicBool,
    task: Mutex<Option<JoinHandle<()>>>,
    heartbeat: Mutex<Option<JoinHandle<()>>>,
    control: Mutex<Option<JoinHandle<()>>>,
    branches: Mutex<Vec<JoinHandle<()>>>,
}

#[derive(Default)]
struct CancellationBranchResult {
    value: Mutex<Option<NativeResult<Value>>>,
    completed: tokio::sync::Notify,
}

impl CancellationBranchResult {
    fn complete(&self, value: NativeResult<Value>) {
        *lock(&self.value) = Some(value);
        self.completed.notify_waiters();
    }

    async fn wait(&self) -> NativeResult<Value> {
        loop {
            if let Some(value) = lock(&self.value).clone() {
                return value;
            }
            let completed = self.completed.notified();
            if let Some(value) = lock(&self.value).clone() {
                return value;
            }
            completed.await;
        }
    }
}

impl Execution {
    async fn run(self: &Arc<Self>) {
        let result = self.execute().await;
        for branch in lock(&self.branches).drain(..) {
            branch.abort();
        }
        if let Some(heartbeat) = lock(&self.heartbeat).take() {
            heartbeat.abort();
        }
        if let Some(control) = lock(&self.control).take() {
            control.abort();
        }
        if let Some(service) = self.service.upgrade() {
            if let Err(error) = result
                && !self.stopped.requested()
                && !self.lease_lost.load(Ordering::SeqCst)
            {
                let event = if error.name == "WorkflowCancelled" && self.cancellation.requested() {
                    let mut event = BTreeMap::from([
                        (
                            "type".to_owned(),
                            Value::String("workflow.cancelled".to_owned()),
                        ),
                        (
                            "state".to_owned(),
                            portable(self.state.clone()).unwrap_or(Value::Null),
                        ),
                        ("at".to_owned(), Value::Number(self.time())),
                    ]);
                    if let Some(reason) = self.cancellation.reason() {
                        event.insert("reason".to_owned(), Value::String(reason));
                    }
                    event
                } else {
                    BTreeMap::from([
                        (
                            "type".to_owned(),
                            Value::String("workflow.failed".to_owned()),
                        ),
                        ("error".to_owned(), error_value(&error)),
                        (
                            "state".to_owned(),
                            portable(self.state.clone()).unwrap_or(Value::Null),
                        ),
                        ("at".to_owned(), Value::Number(self.time())),
                    ])
                };
                let _ = self.append(Value::record(event)).await;
            }
            lock(&service.active).remove(&self.id);
        }
    }

    async fn execute(self: &Arc<Self>) -> NativeResult<()> {
        let service = self.service()?;
        let execute = service.function("execute")?;
        let result = self
            .engine
            .invoke(execute, vec![self.context(self.cancellation.clone())?])
            .await?;
        self.deliver(u64::MAX, u64::MAX).await?;
        self.assert_worker_running()?;
        let mut event = BTreeMap::from([
            (
                "type".to_owned(),
                Value::String("workflow.completed".to_owned()),
            ),
            ("state".to_owned(), portable(self.state.clone())?),
            ("at".to_owned(), Value::Number(self.time())),
        ]);
        if !result.is_undefined() {
            event.insert("result".to_owned(), portable(result)?);
        }
        self.append(Value::record(event)).await?;
        Ok(())
    }

    fn context(self: &Arc<Self>, cancellation: DependencyCancellation) -> NativeResult<Value> {
        Ok(Value::record(BTreeMap::from([
            ("input".to_owned(), self.input.clone()),
            (
                "dependencies".to_owned(),
                self.durable_dependencies(cancellation.clone())?,
            ),
            ("state".to_owned(), self.state.clone()),
            ("time".to_owned(), self.time_value()),
            (
                "sleep".to_owned(),
                self.sleep_function(cancellation.clone()),
            ),
            ("wait".to_owned(), self.wait_function(cancellation.clone())),
            (
                "cancellation".to_owned(),
                self.cancellation_value(cancellation),
            ),
        ])))
    }

    fn time(&self) -> f64 {
        self.logical_time.load(Ordering::SeqCst) as f64
    }

    fn time_value(self: &Arc<Self>) -> Value {
        let execution = self.clone();
        Value::record(BTreeMap::from([(
            "now".to_owned(),
            Value::Function(NativeFunction::new(move |_engine, _arguments| {
                let value = execution.time();
                Box::pin(async move { Ok(Value::Number(value)) })
            })),
        )]))
    }

    fn advance_time(&self, value: f64) -> NativeResult<f64> {
        let value = non_negative_safe_integer(&Value::Number(value), "workflow time")?;
        self.logical_time.fetch_max(value, Ordering::SeqCst);
        Ok(self.time())
    }

    async fn host_time(&self) -> NativeResult<f64> {
        let value = now(&self.engine).await?.number()?;
        non_negative_safe_integer(&Value::Number(value), "workflow clock time")?;
        Ok(self.time().max(value))
    }

    async fn heartbeat(self: &Arc<Self>) {
        while !self.stopped.requested() && !self.lease_lost.load(Ordering::SeqCst) {
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
            if slept.is_err() || self.stopped.requested() {
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

    async fn observe(self: &Arc<Self>, after: u64) {
        let source = self
            .engine
            .call_dependency(
                "events",
                "subscribe",
                Value::record(BTreeMap::from([
                    ("stream".to_owned(), Value::String(self.stream.clone())),
                    ("after".to_owned(), Value::Number(after as f64)),
                ])),
            )
            .await;
        let Ok(source) = source else {
            return;
        };
        loop {
            let next = self.engine.next(source.clone()).await;
            let Ok(Some(stored)) = next else {
                return;
            };
            let event = match stored.property("event", false) {
                Ok(event) => event,
                Err(_) => return,
            };
            let kind = match event_type(&event) {
                Ok(kind) => kind,
                Err(_) => return,
            };
            if kind == "workflow.cancellation.requested" {
                self.cancellation
                    .request_with_reason(optional_string(&event, "reason").ok().flatten());
                continue;
            }
            if matches!(
                kind.as_str(),
                "workflow.completed" | "workflow.failed" | "workflow.cancelled"
            ) {
                return;
            }
        }
    }

    fn durable_dependencies(
        self: &Arc<Self>,
        cancellation: DependencyCancellation,
    ) -> NativeResult<Value> {
        let service = self.service()?;
        let mut result = BTreeMap::new();
        for (name, value) in service.dependencies.iter() {
            if ["clock", "events", "identifiers", "timer", "workflowRuntime"]
                .contains(&name.as_str())
            {
                continue;
            }
            result.insert(
                name.clone(),
                self.durable_dependency(name, value.clone(), cancellation.clone())?,
            );
        }
        Ok(Value::record(result))
    }

    fn durable_dependency(
        self: &Arc<Self>,
        name: &str,
        value: Value,
        cancellation: DependencyCancellation,
    ) -> NativeResult<Value> {
        match value {
            Value::Dependency(dependency) => {
                let execution = self.clone();
                let name = name.to_owned();
                let cancellation = cancellation.clone();
                Ok(Value::intercepted_dependency(NativeFunction::new(
                    move |_engine, arguments| {
                        let execution = execution.clone();
                        let name = name.clone();
                        let dependency = dependency.clone();
                        let cancellation = cancellation.clone();
                        Box::pin(async move {
                            let operation = arguments
                                .first()
                                .cloned()
                                .unwrap_or(Value::Undefined)
                                .string()?;
                            let input = arguments.get(1).cloned().unwrap_or(Value::Undefined);
                            execution
                                .activity(
                                    ActivityTarget::Dependency(dependency),
                                    name,
                                    operation,
                                    input,
                                    cancellation,
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
                    let cancellation = cancellation.clone();
                    result.insert(
                        operation.clone(),
                        Value::Function(NativeFunction::new(move |_engine, arguments| {
                            let execution = execution.clone();
                            let dependency_name = dependency_name.clone();
                            let operation_name = operation_name.clone();
                            let function = function.clone();
                            let cancellation = cancellation.clone();
                            Box::pin(async move {
                                execution
                                    .activity(
                                        ActivityTarget::Function(function),
                                        dependency_name,
                                        operation_name,
                                        one(arguments)?,
                                        cancellation,
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

    async fn activity(
        self: &Arc<Self>,
        target: ActivityTarget,
        dependency: String,
        operation: String,
        input: Value,
        cancellation: DependencyCancellation,
    ) -> NativeResult<Value> {
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let result = async {
            self.assert_running(&cancellation)?;
            let service = self.service()?;
            let stream = service.stream(&self.id);
            let policy = activity_policy(&service.implementation, &dependency, &operation)?;
            let policy_value = policy.value();
            let activity_id = workflow_activity_id(&service.name, &self.id, sequence);
            let activity_input = portable(input.clone())?;
            let mut history = read_history(&self.engine, &stream).await?;
            if history.iter().any(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.state")
                    && stored
                        .event
                        .property("reason", false)
                        .and_then(|value| value.string())
                        .is_ok_and(|value| value == "activity")
                    && event_sequence(&stored.event).ok() == Some(sequence)
            }) {
                let checkpoint_revision =
                    self.checkpoint_revision(&history, "activity", sequence)?;
                self.deliver(sequence, checkpoint_revision).await?;
                self.verify_checkpoint(&history, "activity", sequence)?;
                self.deliver(sequence, u64::MAX).await?;
            } else {
                self.deliver(sequence, u64::MAX).await?;
                self.checkpoint("activity", sequence).await?;
            }
            history = read_history(&self.engine, &stream).await?;

            let scheduled_at = if let Some(scheduled) = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.activity.scheduled")
                    && event_sequence(&stored.event).ok() == Some(sequence)
            }) {
                if scheduled.event.property("id", false)?.string()? != activity_id
                    || scheduled.event.property("dependency", false)?.string()? != dependency
                    || scheduled.event.property("operation", false)?.string()? != operation
                    || canonical(scheduled.event.property("input", false)?)?
                        != canonical(activity_input.clone())?
                    || canonical(scheduled.event.property("policy", false)?)?
                        != canonical(policy_value.clone())?
                {
                    return Err(invalid(format!(
                        "Workflow {:?} changed durable Activity {sequence}.",
                        self.id
                    )));
                }
                scheduled.event.property("at", false)?.number()?
            } else {
                let scheduled_at = self.time();
                self.append(Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.activity.scheduled".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(sequence as f64)),
                    ("id".to_owned(), Value::String(activity_id.clone())),
                    ("dependency".to_owned(), Value::String(dependency.clone())),
                    ("operation".to_owned(), Value::String(operation.clone())),
                    ("input".to_owned(), activity_input),
                    ("policy".to_owned(), policy_value),
                    ("at".to_owned(), Value::Number(scheduled_at)),
                ])))
                .await?;
                scheduled_at
            };
            history = read_history(&self.engine, &stream).await?;

            if let Some(completed) = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.activity.completed")
                    && event_sequence(&stored.event).ok() == Some(sequence)
            }) {
                self.advance_time(completed.event.property("at", false)?.number()?)?;
                return completed.event.property("result", false);
            }
            if let Some(cancelled) = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.activity.cancelled")
                    && event_sequence(&stored.event).ok() == Some(sequence)
            }) {
                return Err(workflow_cancelled(optional_string(
                    &cancelled.event,
                    "reason",
                )?));
            }

            let previous_attempt = history
                .iter()
                .filter(|stored| {
                    event_type(&stored.event).ok().as_deref()
                        == Some("workflow.activity.attempt.started")
                        && event_sequence(&stored.event).ok() == Some(sequence)
                })
                .filter_map(|stored| event_attempt(&stored.event).ok())
                .max()
                .unwrap_or(0);
            let total_deadline = policy
                .timeout
                .total
                .map(|timeout| scheduled_at + timeout as f64);
            let current = now(&self.engine).await?.number()?;
            if previous_attempt == 0
                && policy
                    .timeout
                    .queue
                    .is_some_and(|timeout| current >= scheduled_at + timeout as f64)
            {
                return Err(activity_timeout("queue"));
            }
            let pending_deferred = history.iter().rev().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.activity.deferred")
                    && event_sequence(&stored.event).ok() == Some(sequence)
                    && event_attempt(&stored.event).is_ok_and(|attempt| {
                        !history.iter().any(|closing| {
                            event_sequence(&closing.event).ok() == Some(sequence)
                                && event_attempt(&closing.event).ok() == Some(attempt)
                                && matches!(
                                    event_type(&closing.event).ok().as_deref(),
                                    Some(
                                        "workflow.activity.attempt.abandoned"
                                            | "workflow.activity.attempt.failed"
                                            | "workflow.activity.completed"
                                    )
                                )
                        })
                    })
            });
            if let Some(deferred) = pending_deferred {
                let attempt = event_attempt(&deferred.event)?;
                let started_at = history
                .iter()
                .find(|stored| {
                    event_type(&stored.event).ok().as_deref()
                        == Some("workflow.activity.attempt.started")
                        && event_sequence(&stored.event).ok() == Some(sequence)
                        && event_attempt(&stored.event).ok() == Some(attempt)
                })
                .ok_or_else(|| {
                    invalid(format!(
                        "Workflow {:?} deferred Activity {sequence} before its attempt started.",
                        self.id
                    ))
                })?
                .event
                .property("at", false)?
                .number()?;
                let deadline = match (policy.timeout.attempt, total_deadline) {
                    (Some(attempt_timeout), Some(total)) => {
                        (started_at + attempt_timeout as f64).min(total)
                    }
                    (Some(attempt_timeout), None) => started_at + attempt_timeout as f64,
                    (None, Some(total)) => total,
                    (None, None) => unreachable!("validated Activity timeout"),
                };
                let timeout = if total_deadline == Some(deadline) {
                    "total"
                } else {
                    "attempt"
                };
                let heartbeat_at = history
                    .iter()
                    .rev()
                    .find(|stored| {
                        event_type(&stored.event).ok().as_deref()
                            == Some("workflow.activity.heartbeat")
                            && event_sequence(&stored.event).ok() == Some(sequence)
                            && event_attempt(&stored.event).ok() == Some(attempt)
                    })
                    .map(|stored| {
                        stored
                            .event
                            .property("at", false)
                            .and_then(|at| at.number())
                    })
                    .transpose()?
                    .unwrap_or(started_at);
                let pending = self.clone();
                let pending_cancellation = cancellation.clone();
                let (_heartbeat_sender, mut heartbeat_receiver) =
                    tokio::sync::mpsc::unbounded_channel::<Value>();
                let mut previous_heartbeat = history
                    .iter()
                    .rev()
                    .find(|stored| {
                        event_type(&stored.event).ok().as_deref()
                            == Some("workflow.activity.heartbeat")
                            && event_sequence(&stored.event).ok() == Some(sequence)
                            && event_attempt(&stored.event).ok() == Some(attempt)
                    })
                    .map(|stored| stored.event.property("details", false))
                    .transpose()?;
                if let Err(error) = self
                    .wait_for_activity(
                        Box::pin(async move {
                            pending
                                .wait_for_deferred_activity(sequence, attempt, pending_cancellation)
                                .await
                        }),
                        deadline,
                        timeout,
                        policy.timeout.heartbeat,
                        heartbeat_at,
                        sequence,
                        attempt,
                        &mut heartbeat_receiver,
                        &mut previous_heartbeat,
                        cancellation.clone(),
                    )
                    .await
                {
                    if error.name == "WorkflowCancelled" {
                        return Err(error);
                    }
                    let failed_at = now(&self.engine).await?.number()?;
                    let retry_at =
                        activity_retry_at(&error, &policy, attempt, total_deadline, failed_at)?;
                    let mut failure = BTreeMap::from([
                        (
                            "type".to_owned(),
                            Value::String("workflow.activity.attempt.failed".to_owned()),
                        ),
                        ("sequence".to_owned(), Value::Number(sequence as f64)),
                        ("attempt".to_owned(), Value::Number(attempt as f64)),
                        ("error".to_owned(), error_value(&error)),
                        ("at".to_owned(), Value::Number(failed_at)),
                    ]);
                    if let Some(retry_at) = retry_at {
                        failure.insert("retryAt".to_owned(), Value::Number(retry_at));
                    }
                    if let Some(result) = self
                        .append_activity_failure(sequence, attempt, Value::record(failure))
                        .await?
                    {
                        return Ok(result);
                    }
                    let Some(retry_at) = retry_at else {
                        return Err(error);
                    };
                    self.wait_until(retry_at, cancellation.clone()).await?;
                    history = read_history(&self.engine, &stream).await?;
                } else {
                    let completed = read_history(&self.engine, &stream)
                        .await?
                        .iter()
                        .find(|stored| {
                            event_type(&stored.event).ok().as_deref()
                                == Some("workflow.activity.completed")
                                && event_sequence(&stored.event).ok() == Some(sequence)
                                && event_attempt(&stored.event).ok() == Some(attempt)
                        })
                        .ok_or_else(|| invalid("deferred Activity completion was not persisted."))?
                        .event
                        .clone();
                    self.advance_time(completed.property("at", false)?.number()?)?;
                    return completed.property("result", false);
                }
            }
            let previous_closed = previous_attempt == 0
                || history.iter().any(|stored| {
                    event_sequence(&stored.event).ok() == Some(sequence)
                        && event_attempt(&stored.event).ok() == Some(previous_attempt)
                        && matches!(
                            event_type(&stored.event).ok().as_deref(),
                            Some(
                                "workflow.activity.attempt.abandoned"
                                    | "workflow.activity.attempt.failed"
                                    | "workflow.activity.completed"
                            )
                        )
                });
            if !previous_closed {
                self.append(Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.activity.attempt.abandoned".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(sequence as f64)),
                    ("attempt".to_owned(), Value::Number(previous_attempt as f64)),
                    ("reason".to_owned(), Value::String("worker-lost".to_owned())),
                    ("at".to_owned(), now(&self.engine).await?),
                ])))
                .await?;
                history = read_history(&self.engine, &stream).await?;
            }

            let previous_failure = history.iter().rev().find(|stored| {
                event_type(&stored.event).ok().as_deref()
                    == Some("workflow.activity.attempt.failed")
                    && event_sequence(&stored.event).ok() == Some(sequence)
            });
            if let Some(failure) = previous_failure {
                let retry_at = failure.event.property("retryAt", false)?;
                if !retry_at.is_undefined() {
                    let retry_at = retry_at.number()?;
                    let retry_at =
                        total_deadline.map_or(retry_at, |deadline| deadline.min(retry_at));
                    self.wait_until(retry_at, cancellation.clone()).await?;
                }
            }
            if let Some(total_deadline) = total_deadline {
                let current = now(&self.engine).await?.number()?;
                if current >= total_deadline {
                    return Err(activity_timeout("total"));
                }
            }
            if previous_attempt >= policy.retry.attempts {
                if let Some(failure) = previous_failure {
                    return Err(stored_workflow_error(
                        failure.event.property("error", false)?,
                    )?);
                }
                return Err(NativeError::new(
                    "WorkflowActivityAttemptsExhausted",
                    format!("Workflow Activity {activity_id:?} exhausted its attempts."),
                ));
            }

            let mut previous_heartbeat = history
                .iter()
                .rev()
                .find(|stored| {
                    event_type(&stored.event).ok().as_deref() == Some("workflow.activity.heartbeat")
                        && event_sequence(&stored.event).ok() == Some(sequence)
                })
                .map(|stored| stored.event.property("details", false))
                .transpose()?;
            let mut last_error = None;
            for attempt in previous_attempt + 1..=policy.retry.attempts {
                let started_at = now(&self.engine).await?.number()?;
                if total_deadline.is_some_and(|deadline| started_at >= deadline) {
                    return Err(activity_timeout("total"));
                }
                self.append(Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.activity.attempt.started".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(sequence as f64)),
                    ("attempt".to_owned(), Value::Number(attempt as f64)),
                    ("at".to_owned(), Value::Number(started_at)),
                ])))
                .await?;
                let deadline = match (policy.timeout.attempt, total_deadline) {
                    (Some(attempt_timeout), Some(total)) => {
                        (started_at + attempt_timeout as f64).min(total)
                    }
                    (Some(attempt_timeout), None) => started_at + attempt_timeout as f64,
                    (None, Some(total)) => total,
                    (None, None) => unreachable!("validated Activity timeout"),
                };
                let timeout = if total_deadline == Some(deadline) {
                    "total"
                } else {
                    "attempt"
                };
                let (heartbeat_sender, mut heartbeat_receiver) =
                    tokio::sync::mpsc::unbounded_channel::<Value>();
                let called: NativeFuture<Value> = match &target {
                    ActivityTarget::Dependency(name) => {
                        let engine = self.engine.clone();
                        let name = name.clone();
                        let operation = operation.clone();
                        let input = input.clone();
                        let id = activity_id.clone();
                        let activity = activity_id.clone();
                        let workflow = service.name.clone();
                        let execution = self.id.clone();
                        let run = self.run.clone();
                        let cancellation = cancellation.clone();
                        let previous_heartbeat = previous_heartbeat.clone();
                        Box::pin(async move {
                            let invocation = DependencyInvocation::new(
                                id,
                                attempt,
                                scheduled_at,
                                started_at,
                                Some(deadline),
                            )
                            .with_controls(
                                previous_heartbeat,
                                move |details| {
                                    heartbeat_sender.send(details).map_err(|_| {
                                        NativeError::new(
                                            "ActivityClosed",
                                            "Workflow Activity is no longer running.",
                                        )
                                    })
                                },
                                move |completion| {
                                    Ok(deferred_invocation(
                                        completion,
                                        activity.clone(),
                                        workflow.clone(),
                                        execution.clone(),
                                        run.clone(),
                                        attempt,
                                    ))
                                },
                                cancellation,
                            );
                            engine
                                .call_dependency_with_invocation(
                                    &name, &operation, input, invocation,
                                )
                                .await
                        })
                    }
                    ActivityTarget::Function(function) => {
                        drop(heartbeat_sender);
                        let engine = self.engine.clone();
                        let function = function.clone();
                        let input = input.clone();
                        Box::pin(async move { engine.invoke(function, vec![input]).await })
                    }
                };
                let mut called = self
                    .wait_for_activity(
                        called,
                        deadline,
                        timeout,
                        policy.timeout.heartbeat,
                        started_at,
                        sequence,
                        attempt,
                        &mut heartbeat_receiver,
                        &mut previous_heartbeat,
                        cancellation.clone(),
                    )
                    .await;
                if let Ok(result) = &called
                    && is_deferred_invocation(result)
                {
                    let deferred = result.clone().as_record()?;
                    let completion = required_string(deferred.as_ref(), "id")?;
                    self.append(Value::record(BTreeMap::from([
                        (
                            "type".to_owned(),
                            Value::String("workflow.activity.deferred".to_owned()),
                        ),
                        ("sequence".to_owned(), Value::Number(sequence as f64)),
                        ("attempt".to_owned(), Value::Number(attempt as f64)),
                        ("id".to_owned(), Value::String(completion)),
                        ("at".to_owned(), now(&self.engine).await?),
                    ])))
                    .await?;
                    let pending = self.clone();
                    let pending_cancellation = cancellation.clone();
                    called = self
                        .wait_for_activity(
                            Box::pin(async move {
                                pending
                                    .wait_for_deferred_activity(
                                        sequence,
                                        attempt,
                                        pending_cancellation,
                                    )
                                    .await
                            }),
                            deadline,
                            timeout,
                            policy.timeout.heartbeat,
                            started_at,
                            sequence,
                            attempt,
                            &mut heartbeat_receiver,
                            &mut previous_heartbeat,
                            cancellation.clone(),
                        )
                        .await;
                }
                match called {
                    Ok(result) => {
                        let history = read_history(&self.engine, &stream).await?;
                        if let Some(completed) = history.iter().find(|stored| {
                            event_type(&stored.event).ok().as_deref()
                                == Some("workflow.activity.completed")
                                && event_sequence(&stored.event).ok() == Some(sequence)
                                && event_attempt(&stored.event).ok() == Some(attempt)
                        }) {
                            self.advance_time(completed.event.property("at", false)?.number()?)?;
                            return Ok(result);
                        }
                        let completed_at = self.advance_time(self.host_time().await?)?;
                        let mut event = BTreeMap::from([
                            (
                                "type".to_owned(),
                                Value::String("workflow.activity.completed".to_owned()),
                            ),
                            ("sequence".to_owned(), Value::Number(sequence as f64)),
                            ("attempt".to_owned(), Value::Number(attempt as f64)),
                            ("at".to_owned(), Value::Number(completed_at)),
                        ]);
                        if !result.is_undefined() {
                            event.insert("result".to_owned(), portable(result.clone())?);
                        }
                        self.append(Value::record(event)).await?;
                        return Ok(result);
                    }
                    Err(error) => {
                        if error.name == "WorkflowCancelled" {
                            return Err(error);
                        }
                        let failed_at = now(&self.engine).await?.number()?;
                        let retry_at =
                            activity_retry_at(&error, &policy, attempt, total_deadline, failed_at)?;
                        let mut event = BTreeMap::from([
                            (
                                "type".to_owned(),
                                Value::String("workflow.activity.attempt.failed".to_owned()),
                            ),
                            ("sequence".to_owned(), Value::Number(sequence as f64)),
                            ("attempt".to_owned(), Value::Number(attempt as f64)),
                            ("error".to_owned(), error_value(&error)),
                            ("at".to_owned(), Value::Number(failed_at)),
                        ]);
                        if let Some(retry_at) = retry_at {
                            event.insert("retryAt".to_owned(), Value::Number(retry_at));
                        }
                        if let Some(result) = self
                            .append_activity_failure(sequence, attempt, Value::record(event))
                            .await?
                        {
                            return Ok(result);
                        }
                        last_error = Some(error);
                        let Some(retry_at) = retry_at else {
                            break;
                        };
                        previous_heartbeat = read_history(&self.engine, &self.stream)
                            .await?
                            .iter()
                            .rev()
                            .find(|stored| {
                                event_type(&stored.event).ok().as_deref()
                                    == Some("workflow.activity.heartbeat")
                                    && event_sequence(&stored.event).ok() == Some(sequence)
                            })
                            .map(|stored| stored.event.property("details", false))
                            .transpose()?;
                        self.wait_until(retry_at, cancellation.clone()).await?;
                    }
                }
            }
            Err(last_error.unwrap_or_else(|| invalid("workflow Activity failed.")))
        }
        .await;
        if result
            .as_ref()
            .is_err_and(|error| error.name == "WorkflowCancelled")
        {
            self.cancel_command("activity", sequence, cancellation.reason())
                .await?;
        }
        result
    }

    async fn wait_for_deferred_activity(
        &self,
        sequence: u64,
        attempt: u64,
        cancellation: DependencyCancellation,
    ) -> NativeResult<Value> {
        loop {
            self.assert_running(&cancellation)?;
            let history = read_history(&self.engine, &self.stream).await?;
            if let Some(completed) = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.activity.completed")
                    && event_sequence(&stored.event).ok() == Some(sequence)
                    && event_attempt(&stored.event).ok() == Some(attempt)
            }) {
                self.advance_time(completed.event.property("at", false)?.number()?)?;
                return completed.event.property("result", false);
            }
            if let Some(failed) = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref()
                    == Some("workflow.activity.attempt.failed")
                    && event_sequence(&stored.event).ok() == Some(sequence)
                    && event_attempt(&stored.event).ok() == Some(attempt)
            }) {
                let mut error = stored_workflow_error(failed.event.property("error", false)?)?
                    .with_field("recordedActivityFailure", Value::Boolean(true));
                if let Some(retry_at) = failed
                    .event
                    .as_record()?
                    .get("retryAt")
                    .filter(|value| !value.is_undefined())
                {
                    error = error.with_field("retryAt", retry_at.clone());
                }
                return Err(error);
            }
            let after = history.last().map_or(0, |stored| stored.revision);
            let changes = self
                .engine
                .call_dependency(
                    "events",
                    "subscribe",
                    Value::record(BTreeMap::from([
                        ("stream".to_owned(), Value::String(self.stream.clone())),
                        ("after".to_owned(), Value::Number(after as f64)),
                    ])),
                )
                .await?;
            tokio::select! {
                next = self.engine.next(changes) => {
                    if next?.is_none() {
                        return Err(invalid(format!(
                            "Deferred Workflow Activity {sequence} stopped before it was completed."
                        )));
                    }
                }
                _ = cancellation.wait() => {
                    return Err(self.cancellation_error(&cancellation));
                }
                _ = self.stopped.wait() => {
                    return Err(NativeError::new("WorkflowStopped", "Workflow worker stopped."));
                }
            }
        }
    }

    async fn append_activity_failure(
        &self,
        sequence: u64,
        attempt: u64,
        event: Value,
    ) -> NativeResult<Option<Value>> {
        self.assert_worker_running()?;
        let current = now(&self.engine).await?.number()?;
        if !ensure_workflow_lease(&self.engine, &self.stream, &self.owner, current).await? {
            self.lease_lost.store(true, Ordering::SeqCst);
            return Err(invalid(format!(
                "Workflow {:?} lost its worker lease.",
                self.id
            )));
        }
        for _ in 0..64 {
            let history = read_history(&self.engine, &self.stream).await?;
            if let Some(completed) = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.activity.completed")
                    && event_sequence(&stored.event).ok() == Some(sequence)
                    && event_attempt(&stored.event).ok() == Some(attempt)
            }) {
                return Ok(Some(completed.event.property("result", false)?));
            }
            if history.iter().any(|stored| {
                event_type(&stored.event).ok().as_deref()
                    == Some("workflow.activity.attempt.failed")
                    && event_sequence(&stored.event).ok() == Some(sequence)
                    && event_attempt(&stored.event).ok() == Some(attempt)
            }) {
                return Ok(None);
            }
            let expected = history.last().map_or(0, |stored| stored.revision);
            if append_expected(&self.engine, &self.stream, expected, event.clone())
                .await?
                .is_some()
            {
                return Ok(None);
            }
        }
        Err(invalid(format!(
            "Workflow journal {:?} changed too frequently.",
            self.stream
        )))
    }

    async fn wait_for_activity(
        &self,
        mut operation: NativeFuture<Value>,
        deadline: f64,
        timeout: &'static str,
        heartbeat_timeout: Option<u64>,
        started_at: f64,
        sequence: u64,
        attempt: u64,
        heartbeat_receiver: &mut tokio::sync::mpsc::UnboundedReceiver<Value>,
        previous_heartbeat: &mut Option<Value>,
        cancellation: DependencyCancellation,
    ) -> NativeResult<Value> {
        let mut heartbeat_at = started_at;
        let mut heartbeat_open = true;
        loop {
            self.assert_running(&cancellation)?;
            let heartbeat_deadline =
                heartbeat_timeout.map(|duration| heartbeat_at + duration as f64);
            let heartbeat_wins = heartbeat_deadline.is_some_and(|heartbeat| heartbeat < deadline);
            let active_deadline = if heartbeat_wins {
                heartbeat_deadline.expect("heartbeat deadline")
            } else {
                deadline
            };
            let active_timeout = if heartbeat_wins { "heartbeat" } else { timeout };
            if active_deadline <= now(&self.engine).await?.number()? {
                return Err(activity_timeout(active_timeout));
            }
            let timer = self.engine.call_dependency(
                "timer",
                "sleep",
                Value::record(BTreeMap::from([(
                    "until".to_owned(),
                    Value::Number(active_deadline),
                )])),
            );
            tokio::select! {
                result = &mut operation => {
                    while let Ok(details) = heartbeat_receiver.try_recv() {
                        self.record_activity_heartbeat(
                            sequence,
                            attempt,
                            details,
                            previous_heartbeat,
                        )
                        .await?;
                    }
                    return result;
                }
                heartbeat = heartbeat_receiver.recv(), if heartbeat_open => {
                    let Some(details) = heartbeat else {
                        heartbeat_open = false;
                        continue;
                    };
                    heartbeat_at = self
                        .record_activity_heartbeat(
                            sequence,
                            attempt,
                            details,
                            previous_heartbeat,
                        )
                        .await?;
                }
                result = timer => {
                    result?;
                    if heartbeat_timeout.is_some() {
                        let history = read_history(&self.engine, &self.stream).await?;
                        if let Some(heartbeat) = history.iter().rev().find(|stored| {
                            event_type(&stored.event).ok().as_deref()
                                == Some("workflow.activity.heartbeat")
                                && event_sequence(&stored.event).ok() == Some(sequence)
                                && event_attempt(&stored.event).ok() == Some(attempt)
                        }) {
                            let latest_at = heartbeat.event.property("at", false)?.number()?;
                            if latest_at > heartbeat_at {
                                heartbeat_at = latest_at;
                                *previous_heartbeat =
                                    Some(heartbeat.event.property("details", false)?);
                                continue;
                            }
                        }
                    }
                    return Err(activity_timeout(active_timeout));
                }
                _ = cancellation.wait() => {
                    return Err(self.cancellation_error(&cancellation));
                }
                _ = self.stopped.wait() => {
                    return Err(NativeError::new("WorkflowStopped", "Workflow worker stopped."));
                }
            }
        }
    }

    async fn record_activity_heartbeat(
        &self,
        sequence: u64,
        attempt: u64,
        details: Value,
        previous_heartbeat: &mut Option<Value>,
    ) -> NativeResult<f64> {
        let details = portable(details)?;
        let at = now(&self.engine).await?.number()?;
        self.append(Value::record(BTreeMap::from([
            (
                "type".to_owned(),
                Value::String("workflow.activity.heartbeat".to_owned()),
            ),
            ("sequence".to_owned(), Value::Number(sequence as f64)),
            ("attempt".to_owned(), Value::Number(attempt as f64)),
            ("details".to_owned(), details.clone()),
            ("at".to_owned(), Value::Number(at)),
        ])))
        .await?;
        *previous_heartbeat = Some(details);
        Ok(at)
    }

    async fn wait_until(
        &self,
        deadline: f64,
        cancellation: DependencyCancellation,
    ) -> NativeResult<()> {
        if deadline > now(&self.engine).await?.number()? {
            let timer = self.engine.call_dependency(
                "timer",
                "sleep",
                Value::record(BTreeMap::from([(
                    "until".to_owned(),
                    Value::Number(deadline),
                )])),
            );
            tokio::select! {
                result = timer => {
                    result?;
                }
                _ = cancellation.wait() => {
                    return Err(self.cancellation_error(&cancellation));
                }
                _ = self.stopped.wait() => {
                    return Err(NativeError::new("WorkflowStopped", "Workflow worker stopped."));
                }
            }
        }
        self.assert_running(&cancellation)
    }

    fn sleep_function(self: &Arc<Self>, cancellation: DependencyCancellation) -> Value {
        let execution = self.clone();
        Value::Function(NativeFunction::new(move |_engine, arguments| {
            let execution = execution.clone();
            let cancellation = cancellation.clone();
            Box::pin(async move {
                execution.sleep(one(arguments)?, cancellation).await?;
                Ok(Value::Undefined)
            })
        }))
    }

    async fn sleep(
        self: &Arc<Self>,
        input: Value,
        cancellation: DependencyCancellation,
    ) -> NativeResult<()> {
        let input = input.as_record()?;
        let duration = input
            .get("duration")
            .filter(|value| !value.is_undefined())
            .map(|value| non_negative_safe_integer(value, "workflow sleep duration"))
            .transpose()?
            .map(|value| value as f64);
        let requested_deadline = input
            .get("deadline")
            .filter(|value| !value.is_undefined())
            .map(|value| non_negative_safe_integer(value, "workflow sleep deadline"))
            .transpose()?
            .map(|value| value as f64);
        if duration.is_some() == requested_deadline.is_some() {
            return Err(invalid(
                "workflow sleep requires exactly one duration or deadline.",
            ));
        }
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let result = async {
            self.assert_running(&cancellation)?;
            let service = self.service()?;
            let stream = service.stream(&self.id);
            let history = read_history(&self.engine, &stream).await?;
            let completed = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.timer.completed")
                    && event_sequence(&stored.event).ok() == Some(sequence)
            });
            let cancelled = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.timer.cancelled")
                    && event_sequence(&stored.event).ok() == Some(sequence)
            });
            let scheduled = history.iter().find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.timer.scheduled")
                    && event_sequence(&stored.event).ok() == Some(sequence)
            });
            let deadline = if let Some(scheduled) = scheduled {
                let checkpoint_revision = self.checkpoint_revision(&history, "timer", sequence)?;
                self.deliver(sequence, checkpoint_revision).await?;
                self.verify_checkpoint(&history, "timer", sequence)?;
                self.deliver(sequence, u64::MAX).await?;
                let stored_duration = scheduled.event.property("duration", true)?;
                let changed = if let Some(duration) = duration {
                    stored_duration.is_undefined() || stored_duration.number()? != duration
                } else {
                    !stored_duration.is_undefined()
                        || scheduled.event.property("deadline", false)?.number()?
                            != requested_deadline.expect("validated absolute Workflow deadline")
                };
                if changed {
                    return Err(invalid(format!(
                        "Workflow {:?} changed timer {sequence}.",
                        self.id
                    )));
                }
                if let Some(completed) = completed {
                    self.advance_time(completed.event.property("at", false)?.number()?)?;
                    return Ok(());
                }
                if let Some(cancelled) = cancelled {
                    return Err(workflow_cancelled(optional_string(
                        &cancelled.event,
                        "reason",
                    )?));
                }
                scheduled.event.property("deadline", false)?.number()?
            } else {
                if completed.is_some() {
                    return Err(invalid(format!(
                        "Workflow {:?} has an incomplete timer {sequence}.",
                        self.id
                    )));
                }
                self.deliver(sequence, u64::MAX).await?;
                self.checkpoint("timer", sequence).await?;
                let deadline = match (duration, requested_deadline) {
                    (Some(duration), None) => self.time() + duration,
                    (None, Some(deadline)) => deadline,
                    _ => unreachable!("validated Workflow sleep timing"),
                };
                non_negative_safe_integer(&Value::Number(deadline), "workflow sleep deadline")?;
                let mut event = BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.timer.scheduled".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(sequence as f64)),
                    ("deadline".to_owned(), Value::Number(deadline)),
                    ("at".to_owned(), Value::Number(self.time())),
                ]);
                if let Some(duration) = duration {
                    event.insert("duration".to_owned(), Value::Number(duration));
                }
                self.append(Value::record(event)).await?;
                deadline
            };
            let timer = self.engine.call_dependency(
                "timer",
                "sleep",
                Value::record(BTreeMap::from([(
                    "until".to_owned(),
                    Value::Number(deadline),
                )])),
            );
            tokio::select! {
                result = timer => {
                    result?;
                }
                _ = cancellation.wait() => {
                    return Err(self.cancellation_error(&cancellation));
                }
                _ = self.stopped.wait() => {
                    return Err(NativeError::new("WorkflowStopped", "Workflow worker stopped."));
                }
            }
            self.assert_running(&cancellation)?;
            let completed_at = self.advance_time(self.host_time().await?)?;
            self.append(Value::record(BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.timer.completed".to_owned()),
                ),
                ("sequence".to_owned(), Value::Number(sequence as f64)),
                ("at".to_owned(), Value::Number(completed_at)),
            ])))
            .await?;
            Ok(())
        }
        .await;
        if result
            .as_ref()
            .is_err_and(|error| error.name == "WorkflowCancelled")
        {
            self.cancel_command("timer", sequence, cancellation.reason())
                .await?;
        }
        result
    }

    fn wait_function(self: &Arc<Self>, cancellation: DependencyCancellation) -> Value {
        let execution = self.clone();
        Value::Function(NativeFunction::new(move |_engine, arguments| {
            let execution = execution.clone();
            let cancellation = cancellation.clone();
            Box::pin(async move { execution.wait(one(arguments)?, cancellation).await })
        }))
    }

    async fn wait(
        self: &Arc<Self>,
        input: Value,
        cancellation: DependencyCancellation,
    ) -> NativeResult<Value> {
        let input = input.as_record()?;
        let condition = input
            .get("condition")
            .cloned()
            .ok_or_else(|| invalid("workflow condition is missing."))?;
        if !matches!(condition, Value::Function(_)) {
            return Err(invalid("workflow condition must be a function."));
        }
        let timeout = input
            .get("timeout")
            .filter(|value| !value.is_undefined())
            .map(|value| non_negative_safe_integer(value, "workflow condition timeout"))
            .transpose()?
            .map(|value| value as f64);
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let result = async {
            self.assert_running(&cancellation)?;
            let history = read_history(&self.engine, &self.stream).await?;
            let scheduled = history
                .iter()
                .find(|stored| {
                    event_type(&stored.event).ok().as_deref()
                        == Some("workflow.condition.scheduled")
                        && event_sequence(&stored.event).ok() == Some(sequence)
                })
                .map(|stored| stored.event.clone());
            let completed = history
                .iter()
                .find(|stored| {
                    event_type(&stored.event).ok().as_deref()
                        == Some("workflow.condition.completed")
                        && event_sequence(&stored.event).ok() == Some(sequence)
                })
                .map(|stored| (stored.revision, stored.event.clone()));
            let cancelled = history
                .iter()
                .find(|stored| {
                    event_type(&stored.event).ok().as_deref()
                        == Some("workflow.condition.cancelled")
                        && event_sequence(&stored.event).ok() == Some(sequence)
                })
                .map(|stored| stored.event.clone());
            if completed.is_some() && scheduled.is_none() {
                return Err(invalid(format!(
                    "Workflow {:?} has an incomplete condition {sequence}.",
                    self.id
                )));
            }
            let deadline = if let Some(scheduled) = scheduled {
                let checkpoint_revision =
                    self.checkpoint_revision(&history, "condition", sequence)?;
                self.deliver(sequence, checkpoint_revision).await?;
                self.verify_checkpoint(&history, "condition", sequence)?;
                let stored_timeout = scheduled.property("timeout", true)?;
                let stored_timeout = if stored_timeout.is_undefined() {
                    None
                } else {
                    Some(stored_timeout.number()?)
                };
                if stored_timeout != timeout {
                    return Err(invalid(format!(
                        "Workflow {:?} changed condition {sequence}.",
                        self.id
                    )));
                }
                self.deliver(
                    sequence,
                    completed
                        .as_ref()
                        .map(|(revision, _)| *revision)
                        .unwrap_or(u64::MAX),
                )
                .await?;
                if let Some((_, completed)) = completed {
                    let outcome = completed.property("outcome", false)?.string()?;
                    let satisfied = self.condition(condition.clone()).await?;
                    if (outcome == "satisfied") != satisfied {
                        return Err(invalid(format!(
                            "Workflow {:?} changed condition {sequence}.",
                            self.id
                        )));
                    }
                    self.advance_time(completed.property("at", false)?.number()?)?;
                    return Ok(Value::Boolean(outcome == "satisfied"));
                }
                if let Some(cancelled) = cancelled {
                    return Err(workflow_cancelled(optional_string(&cancelled, "reason")?));
                }
                let deadline = scheduled.property("deadline", true)?;
                if deadline.is_undefined() {
                    None
                } else {
                    Some(deadline.number()?)
                }
            } else {
                self.deliver(sequence, u64::MAX).await?;
                self.checkpoint("condition", sequence).await?;
                let at = self.time();
                non_negative_safe_integer(&Value::Number(at), "workflow condition schedule time")?;
                let deadline = timeout.map(|timeout| at + timeout);
                if let Some(deadline) = deadline {
                    non_negative_safe_integer(
                        &Value::Number(deadline),
                        "workflow condition deadline",
                    )?;
                }
                let mut event = BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.condition.scheduled".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(sequence as f64)),
                    ("at".to_owned(), Value::Number(at)),
                ]);
                if let (Some(timeout), Some(deadline)) = (timeout, deadline) {
                    event.insert("timeout".to_owned(), Value::Number(timeout));
                    event.insert("deadline".to_owned(), Value::Number(deadline));
                }
                self.append(Value::record(event)).await?;
                deadline
            };

            for _ in 0..64 {
                self.assert_running(&cancellation)?;
                self.deliver(sequence, u64::MAX).await?;
                let history = read_history(&self.engine, &self.stream).await?;
                let current = self.host_time().await?;
                if deadline.is_some_and(|deadline| current >= deadline) {
                    self.advance_time(current)?;
                }
                let outcome = if self.condition(condition.clone()).await? {
                    Some("satisfied")
                } else if deadline.is_some_and(|deadline| self.time() >= deadline) {
                    Some("timed-out")
                } else {
                    None
                };
                if let Some(outcome) = outcome {
                    if !ensure_workflow_lease(&self.engine, &self.stream, &self.owner, current)
                        .await?
                    {
                        self.lease_lost.store(true, Ordering::SeqCst);
                        return Err(invalid(format!(
                            "Workflow {:?} lost its worker lease.",
                            self.id
                        )));
                    }
                    let expected_revision =
                        history.last().map(|stored| stored.revision).unwrap_or(0);
                    if append_expected(
                        &self.engine,
                        &self.stream,
                        expected_revision,
                        Value::record(BTreeMap::from([
                            (
                                "type".to_owned(),
                                Value::String("workflow.condition.completed".to_owned()),
                            ),
                            ("sequence".to_owned(), Value::Number(sequence as f64)),
                            ("outcome".to_owned(), Value::String(outcome.to_owned())),
                            ("at".to_owned(), Value::Number(self.time())),
                        ])),
                    )
                    .await?
                    .is_some()
                    {
                        return Ok(Value::Boolean(outcome == "satisfied"));
                    }
                    continue;
                }
                self.wait_for_change(
                    history.last().map(|stored| stored.revision).unwrap_or(0),
                    deadline,
                    cancellation.clone(),
                )
                .await?;
            }
            Err(invalid(format!(
                "Workflow journal {:?} changed too frequently.",
                self.stream
            )))
        }
        .await;
        if result
            .as_ref()
            .is_err_and(|error| error.name == "WorkflowCancelled")
        {
            self.cancel_command("condition", sequence, cancellation.reason())
                .await?;
        }
        result
    }

    async fn condition(&self, condition: Value) -> NativeResult<bool> {
        let before = canonical(self.state.clone())?;
        let result = self.engine.invoke(condition, Vec::new()).await?;
        let result = match result {
            Value::Boolean(result) => result,
            value => {
                return Err(invalid(format!(
                    "workflow condition must return a boolean, received {value:?}."
                )));
            }
        };
        if before != canonical(self.state.clone())? {
            return Err(invalid("workflow condition must not mutate state."));
        }
        Ok(result)
    }

    async fn wait_for_change(
        &self,
        after: u64,
        deadline: Option<f64>,
        cancellation: DependencyCancellation,
    ) -> NativeResult<()> {
        let source = self
            .engine
            .call_dependency(
                "events",
                "subscribe",
                Value::record(BTreeMap::from([
                    ("stream".to_owned(), Value::String(self.stream.clone())),
                    ("after".to_owned(), Value::Number(after as f64)),
                ])),
            )
            .await?;
        let next = self.engine.next(source);
        if let Some(deadline) = deadline {
            tokio::select! {
                next = next => {
                    if next?.is_none() {
                        return Err(invalid("workflow event subscription ended."));
                    }
                }
                timer = self.wait_until(deadline, cancellation.clone()) => timer?,
                _ = cancellation.wait() => {
                    return Err(self.cancellation_error(&cancellation));
                }
                _ = self.stopped.wait() => {
                    return Err(NativeError::new("WorkflowStopped", "Workflow worker stopped."));
                }
            }
        } else {
            tokio::select! {
                next = next => {
                    if next?.is_none() {
                        return Err(invalid("workflow event subscription ended."));
                    }
                }
                _ = cancellation.wait() => {
                    return Err(self.cancellation_error(&cancellation));
                }
                _ = self.stopped.wait() => {
                    return Err(NativeError::new("WorkflowStopped", "Workflow worker stopped."));
                }
            }
        }
        self.assert_running(&cancellation)
    }

    fn cancellation_value(self: &Arc<Self>, cancellation: DependencyCancellation) -> Value {
        let requested = cancellation.clone();
        let execution = self.clone();
        let parent = cancellation.clone();
        Value::record(BTreeMap::from([
            (
                "requested".to_owned(),
                Value::Function(NativeFunction::new(move |_engine, _arguments| {
                    let requested = requested.requested();
                    Box::pin(async move { Ok(Value::Boolean(requested)) })
                })),
            ),
            (
                "start".to_owned(),
                Value::Function(NativeFunction::new(move |_engine, arguments| {
                    let execution = execution.clone();
                    let parent = parent.clone();
                    Box::pin(async move {
                        let input = one(arguments)?.as_record()?;
                        let propagation = required_string(&input, "propagation")?;
                        let inherits_parent = match propagation.as_str() {
                            "inherit" => true,
                            "shield" => false,
                            _ => {
                                return Err(invalid(
                                    "Workflow cancellation propagation must be inherit or shield.",
                                ));
                            }
                        };
                        let timeout = input
                            .get("timeout")
                            .filter(|value| !value.is_undefined())
                            .map(|value| {
                                non_negative_safe_integer(value, "Workflow cancellation timeout")
                            })
                            .transpose()?;
                        let execute = input.get("execute").cloned().ok_or_else(|| {
                            invalid("Workflow cancellation branch requires an execute function.")
                        })?;
                        if !matches!(execute, Value::Function(_)) {
                            return Err(invalid(
                                "Workflow cancellation branch requires an execute function.",
                            ));
                        }
                        let cancellation = parent.child(inherits_parent);
                        let timeout_cancellation = parent.child(false);
                        let result = Arc::new(CancellationBranchResult::default());
                        let running = execution.clone();
                        let completion = result.clone();
                        let branch_cancellation = cancellation.clone();
                        let (started_sender, started_receiver) = tokio::sync::oneshot::channel();
                        let task = tokio::spawn(async move {
                            let operation = running.run_cancellation_branch(
                                execute,
                                branch_cancellation,
                                timeout_cancellation,
                                timeout,
                            );
                            tokio::pin!(operation);
                            let mut started_sender = Some(started_sender);
                            let value = poll_fn(|context| {
                                let result = operation.as_mut().poll(context);
                                if let Some(sender) = started_sender.take() {
                                    let _ = sender.send(());
                                }
                                result
                            })
                            .await;
                            completion.complete(value);
                        });
                        started_receiver.await.map_err(|_| {
                            invalid("Workflow cancellation branch could not start.")
                        })?;
                        lock(&execution.branches).push(task);

                        let cancel = cancellation.clone();
                        let cancel =
                            Value::Function(NativeFunction::new(move |_engine, arguments| {
                                let cancel = cancel.clone();
                                Box::pin(async move {
                                    let input = one(arguments)?.as_record()?;
                                    let reason = input
                                        .get("reason")
                                        .filter(|value| !value.is_undefined())
                                        .map(|value| value.clone().string())
                                        .transpose()?;
                                    cancel.request_with_reason(reason);
                                    Ok(Value::Undefined)
                                })
                            }));
                        let branch_result = result.clone();
                        let result =
                            Value::Function(NativeFunction::new(move |_engine, _arguments| {
                                let branch_result = branch_result.clone();
                                Box::pin(async move { branch_result.wait().await })
                            }));
                        Ok(Value::record(BTreeMap::from([
                            ("cancel".to_owned(), cancel),
                            ("result".to_owned(), result),
                        ])))
                    })
                })),
            ),
        ]))
    }

    async fn run_cancellation_branch(
        self: &Arc<Self>,
        execute: Value,
        cancellation: DependencyCancellation,
        timeout_cancellation: DependencyCancellation,
        timeout: Option<u64>,
    ) -> NativeResult<Value> {
        let context = self.context(cancellation.clone())?;
        let mut operation = Box::pin(self.engine.invoke(execute, vec![context]));
        let Some(timeout) = timeout else {
            return operation.await;
        };
        let mut timeout_operation = Box::pin(self.sleep(
            Value::record(BTreeMap::from([(
                "duration".to_owned(),
                Value::Number(timeout as f64),
            )])),
            timeout_cancellation.clone(),
        ));
        tokio::select! {
            biased;
            timeout_result = &mut timeout_operation => {
                if timeout_result.is_ok() {
                    cancellation.request_with_reason(Some("timeout".to_owned()));
                }
                operation.await
            }
            result = &mut operation => {
                timeout_cancellation
                    .request_with_reason(Some("branch-completed".to_owned()));
                let _ = timeout_operation.await;
                result
            }
        }
    }

    async fn deliver(&self, boundary: u64, before_revision: u64) -> NativeResult<()> {
        let service = self.service()?;
        let stream = service.stream(&self.id);
        let history = read_history(&self.engine, &stream).await?;
        let mut delivered = self.delivered.lock().await;
        for stored in &history {
            if event_type(&stored.event)? != "workflow.signal.received"
                || event_number(&stored.event, "boundary")? as u64 > boundary
                || stored.revision >= before_revision
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
            self.advance_time(stored.event.property("at", false)?.number()?)?;
            self.engine
                .invoke(
                    signal,
                    vec![Value::record(BTreeMap::from([
                        ("state".to_owned(), self.state.clone()),
                        ("input".to_owned(), stored.event.property("input", false)?),
                    ]))],
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
            } else {
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
                    ("at".to_owned(), Value::Number(self.time())),
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
            ("at".to_owned(), Value::Number(self.time())),
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

    fn checkpoint_revision(
        &self,
        history: &[Stored],
        reason: &str,
        sequence: u64,
    ) -> NativeResult<u64> {
        history
            .iter()
            .find(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.state")
                    && stored
                        .event
                        .property("reason", false)
                        .and_then(|value| value.string())
                        .is_ok_and(|value| value == reason)
                    && event_sequence(&stored.event).ok() == Some(sequence)
            })
            .map(|stored| stored.revision)
            .ok_or_else(|| {
                invalid(format!(
                    "Workflow {:?} changed state before durable boundary {sequence}.",
                    self.id
                ))
            })
    }

    fn assert_worker_running(&self) -> NativeResult<()> {
        if self.stopped.requested() {
            Err(NativeError::new(
                "WorkflowStopped",
                format!("Workflow {:?} worker stopped.", self.id),
            ))
        } else if self.lease_lost.load(Ordering::SeqCst) {
            Err(invalid(format!(
                "Workflow {:?} lost its worker lease.",
                self.id
            )))
        } else {
            Ok(())
        }
    }

    fn assert_running(&self, cancellation: &DependencyCancellation) -> NativeResult<()> {
        self.assert_worker_running()?;
        if cancellation.requested() {
            Err(self.cancellation_error(cancellation))
        } else {
            Ok(())
        }
    }

    fn cancellation_error(&self, cancellation: &DependencyCancellation) -> NativeError {
        workflow_cancelled(cancellation.reason())
    }

    async fn cancel_command(
        &self,
        command: &str,
        sequence: u64,
        reason: Option<String>,
    ) -> NativeResult<()> {
        let history = read_history(&self.engine, &self.stream).await?;
        let kind = format!("workflow.{command}.cancelled");
        if history.iter().any(|stored| {
            event_type(&stored.event).ok().as_deref() == Some(kind.as_str())
                && event_sequence(&stored.event).ok() == Some(sequence)
        }) {
            return Ok(());
        }
        let mut event = BTreeMap::from([
            ("type".to_owned(), Value::String(kind)),
            ("sequence".to_owned(), Value::Number(sequence as f64)),
            ("at".to_owned(), now(&self.engine).await?),
        ]);
        if let Some(reason) = reason {
            event.insert("reason".to_owned(), Value::String(reason));
        }
        self.append(Value::record(event)).await?;
        Ok(())
    }

    fn stop(&self) {
        self.stopped.request();
        if let Some(heartbeat) = lock(&self.heartbeat).take() {
            heartbeat.abort();
        }
        if let Some(control) = lock(&self.control).take() {
            control.abort();
        }
        if let Some(task) = lock(&self.task).take() {
            task.abort();
        }
    }

    async fn append(&self, event: Value) -> NativeResult<Value> {
        self.assert_worker_running()?;
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

enum ActivityTarget {
    Dependency(String),
    Function(Value),
}

#[derive(Debug)]
struct Retry {
    attempts: u64,
    delay: u64,
    maximum_delay: Option<u64>,
    factor: f64,
    non_retryable: Vec<String>,
}

#[derive(Debug)]
struct ActivityTimeout {
    attempt: Option<u64>,
    total: Option<u64>,
    queue: Option<u64>,
    heartbeat: Option<u64>,
}

#[derive(Debug)]
struct ActivityPolicy {
    timeout: ActivityTimeout,
    retry: Retry,
}

impl Retry {
    fn delay(&self, attempt: u64) -> NativeResult<u64> {
        let calculated = self.delay as f64 * self.factor.powf(attempt.saturating_sub(1) as f64);
        let delay = self
            .maximum_delay
            .map_or(calculated, |maximum| calculated.min(maximum as f64));
        if !delay.is_finite()
            || delay < 0.0
            || delay.fract() != 0.0
            || delay > 9_007_199_254_740_991.0
        {
            return Err(invalid(
                "workflow Activity retry delay must be a non-negative safe integer.",
            ));
        }
        Ok(delay as u64)
    }

    fn value(&self) -> Value {
        Value::record(BTreeMap::from([
            ("attempts".to_owned(), Value::Number(self.attempts as f64)),
            ("delay".to_owned(), Value::Number(self.delay as f64)),
            ("factor".to_owned(), Value::Number(self.factor)),
            (
                "maximumDelay".to_owned(),
                self.maximum_delay
                    .map_or(Value::Null, |value| Value::Number(value as f64)),
            ),
            (
                "nonRetryable".to_owned(),
                Value::array(
                    self.non_retryable
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            ),
        ]))
    }
}

impl ActivityPolicy {
    fn value(&self) -> Value {
        Value::record(BTreeMap::from([
            (
                "timeout".to_owned(),
                Value::record(BTreeMap::from([
                    (
                        "attempt".to_owned(),
                        self.timeout
                            .attempt
                            .map_or(Value::Null, |value| Value::Number(value as f64)),
                    ),
                    (
                        "total".to_owned(),
                        self.timeout
                            .total
                            .map_or(Value::Null, |value| Value::Number(value as f64)),
                    ),
                    (
                        "queue".to_owned(),
                        self.timeout
                            .queue
                            .map_or(Value::Null, |value| Value::Number(value as f64)),
                    ),
                    (
                        "heartbeat".to_owned(),
                        self.timeout
                            .heartbeat
                            .map_or(Value::Null, |value| Value::Number(value as f64)),
                    ),
                ])),
            ),
            ("retry".to_owned(), self.retry.value()),
        ]))
    }
}

fn activity_policy(
    implementation: &Record,
    dependency: &str,
    operation: &str,
) -> NativeResult<ActivityPolicy> {
    let activities = implementation
        .get("activities")
        .filter(|value| !value.is_undefined())
        .ok_or_else(|| invalid("workflow Activity policies are missing."))?
        .as_record()?;
    let dependency_policy = activities
        .get(dependency)
        .ok_or_else(|| {
            invalid(format!(
                "workflow Activity policy {dependency:?} is missing."
            ))
        })?
        .as_record()?;
    let operation_policy = dependency_policy
        .get(operation)
        .ok_or_else(|| {
            invalid(format!(
                "workflow Activity policy {dependency}.{operation} is missing."
            ))
        })?
        .as_record()?;
    policy_from_value(&operation_policy)
}

fn validate_activity_policies(implementation: &Record) -> NativeResult<()> {
    let Some(activities) = implementation
        .get("activities")
        .filter(|value| !value.is_undefined())
    else {
        return Ok(());
    };
    for operations in activities.as_record()?.values() {
        for policy in operations.as_record()?.values() {
            let policy = policy.as_record()?;
            policy_from_value(&policy)?;
        }
    }
    Ok(())
}

fn policy_from_value(policy: &Record) -> NativeResult<ActivityPolicy> {
    let timeout = policy
        .get("timeout")
        .filter(|value| !value.is_undefined())
        .ok_or_else(|| invalid("workflow Activity timeout policy is required."))?
        .as_record()?;
    let attempt =
        optional_positive_duration(timeout.get("attempt"), "workflow Activity attempt timeout")?;
    let total =
        optional_positive_duration(timeout.get("total"), "workflow Activity total timeout")?;
    let queue =
        optional_positive_duration(timeout.get("queue"), "workflow Activity queue timeout")?;
    let heartbeat = optional_positive_duration(
        timeout.get("heartbeat"),
        "workflow Activity heartbeat timeout",
    )?;
    if attempt.is_none() && total.is_none() {
        return Err(invalid(
            "workflow Activity timeout requires attempt or total.",
        ));
    }
    if attempt
        .zip(total)
        .is_some_and(|(attempt, total)| attempt > total)
    {
        return Err(invalid(
            "workflow Activity attempt timeout must not exceed its total timeout.",
        ));
    }
    Ok(ActivityPolicy {
        timeout: ActivityTimeout {
            attempt,
            total,
            queue,
            heartbeat,
        },
        retry: retry_from_policy(policy)?,
    })
}

fn retry_from_policy(policy: &Record) -> NativeResult<Retry> {
    let Some(value) = policy.get("retry").filter(|value| !value.is_undefined()) else {
        return Ok(Retry {
            attempts: 1,
            delay: 0,
            maximum_delay: None,
            factor: 1.0,
            non_retryable: Vec::new(),
        });
    };
    let retry = value.as_record()?;
    let attempts = retry
        .get("attempts")
        .cloned()
        .unwrap_or(Value::Number(1.0))
        .number()?;
    if !attempts.is_finite()
        || attempts < 1.0
        || attempts.fract() != 0.0
        || attempts > 9_007_199_254_740_991.0
    {
        return Err(invalid(
            "workflow Activity retry attempts must be a positive safe integer.",
        ));
    }
    let delay = non_negative_safe_integer(
        retry.get("delay").unwrap_or(&Value::Number(0.0)),
        "workflow Activity retry delay",
    )?;
    let maximum_delay = retry
        .get("maximumDelay")
        .filter(|value| !value.is_undefined() && !matches!(value, Value::Null))
        .map(|value| non_negative_safe_integer(value, "workflow Activity maximum retry delay"))
        .transpose()?;
    if maximum_delay.is_some_and(|maximum| maximum < delay) {
        return Err(invalid(
            "workflow Activity maximum retry delay must not be less than its retry delay.",
        ));
    }
    let factor = retry
        .get("factor")
        .cloned()
        .unwrap_or(Value::Number(1.0))
        .number()?;
    if !factor.is_finite() || factor < 1.0 {
        return Err(invalid(
            "workflow Activity retry factor must be a finite number of at least 1.",
        ));
    }
    let non_retryable = retry
        .get("nonRetryable")
        .filter(|value| !value.is_undefined())
        .map(|value| {
            let values = value.as_array()?;
            let names = lock(&values)
                .iter()
                .map(|value| value.clone().string())
                .collect::<NativeResult<Vec<_>>>()?;
            if names.iter().any(String::is_empty) {
                return Err(invalid(
                    "workflow Activity non-retryable failures must be non-empty strings.",
                ));
            }
            if names.iter().collect::<HashSet<_>>().len() != names.len() {
                return Err(invalid(
                    "workflow Activity non-retryable failures must be unique.",
                ));
            }
            Ok(names)
        })
        .transpose()?
        .unwrap_or_default();
    Ok(Retry {
        attempts: attempts as u64,
        delay,
        maximum_delay,
        factor,
        non_retryable,
    })
}

fn optional_positive_duration(value: Option<&Value>, label: &str) -> NativeResult<Option<u64>> {
    value
        .filter(|value| !value.is_undefined() && !matches!(value, Value::Null))
        .map(|value| {
            let duration = non_negative_safe_integer(value, label)?;
            if duration == 0 {
                return Err(invalid(format!("{label} must be greater than zero.")));
            }
            Ok(duration)
        })
        .transpose()
}

fn non_negative_safe_integer(value: &Value, label: &str) -> NativeResult<u64> {
    let number = value.clone().number()?;
    if !number.is_finite()
        || number < 0.0
        || number.fract() != 0.0
        || number > 9_007_199_254_740_991.0
    {
        return Err(invalid(format!(
            "{label} must be a non-negative safe integer."
        )));
    }
    Ok(number as u64)
}

struct Stored {
    revision: u64,
    event: Value,
}

struct DeferredActivityContext {
    id: String,
    attempt: u64,
    sequence: u64,
    stream: String,
    history: Vec<Stored>,
}

impl DeferredActivityContext {
    fn closed(&self) -> bool {
        terminal(&self.history).is_some()
            || self.history.iter().any(|stored| {
                event_type(&stored.event).ok().as_deref() == Some("workflow.activity.cancelled")
                    && event_sequence(&stored.event).ok() == Some(self.sequence)
            })
            || self.history.iter().any(|stored| {
                event_sequence(&stored.event).ok() == Some(self.sequence)
                    && event_attempt(&stored.event).ok() == Some(self.attempt)
                    && matches!(
                        event_type(&stored.event).ok().as_deref(),
                        Some(
                            "workflow.activity.attempt.abandoned"
                                | "workflow.activity.attempt.failed"
                                | "workflow.activity.completed"
                        )
                    )
            })
    }
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
    let history = values
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
        .collect::<NativeResult<Vec<_>>>()?;
    validate_history(&history, stream)?;
    Ok(history)
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

fn validate_history(history: &[Stored], stream: &str) -> NativeResult<()> {
    if history.is_empty() {
        return Ok(());
    }
    let first = &history[0].event;
    if event_type(first)? != "workflow.started" {
        return Err(invalid(format!(
            "Workflow journal {stream:?} has no start event."
        )));
    }
    let definition_version = event_number(first, "definitionVersion")?;
    if definition_version != WORKFLOW_DEFINITION_VERSION {
        return Err(invalid(format!(
            "Workflow journal {stream:?} uses definition version {definition_version}; this runtime supports {WORKFLOW_DEFINITION_VERSION}."
        )));
    }
    let protocol_version = event_number(first, "protocolVersion")?;
    if protocol_version != WORKFLOW_PROTOCOL_VERSION {
        return Err(invalid(format!(
            "Workflow journal {stream:?} uses protocol version {protocol_version}; this runtime supports {WORKFLOW_PROTOCOL_VERSION}."
        )));
    }
    identifier(&first.property("run", false)?.string()?)?;
    let mut previous = 0;
    let mut starts = 0;
    let mut activity_checkpoints = HashSet::new();
    let mut timer_checkpoints = HashSet::new();
    let mut timers: HashMap<u64, bool> = HashMap::new();
    let mut condition_checkpoints = HashSet::new();
    let mut cancellation_requested = false;
    struct ConditionValidation {
        completed: bool,
        timeout: Option<f64>,
    }
    let mut conditions: HashMap<u64, ConditionValidation> = HashMap::new();
    struct ActivityValidation {
        attempts: HashSet<u64>,
        deferred: HashSet<u64>,
        closed: HashSet<u64>,
        completed: bool,
    }
    let mut activities: HashMap<u64, ActivityValidation> = HashMap::new();
    for stored in history {
        if stored.revision <= previous {
            return Err(invalid(format!(
                "Workflow journal {stream:?} has invalid revision order."
            )));
        }
        previous = stored.revision;
        let kind = event_type(&stored.event)?;
        if !matches!(
            kind.as_str(),
            "workflow.started"
                | "workflow.state"
                | "workflow.activity.scheduled"
                | "workflow.activity.attempt.started"
                | "workflow.activity.attempt.abandoned"
                | "workflow.activity.attempt.failed"
                | "workflow.activity.heartbeat"
                | "workflow.activity.deferred"
                | "workflow.activity.completed"
                | "workflow.activity.cancelled"
                | "workflow.timer.scheduled"
                | "workflow.timer.completed"
                | "workflow.timer.cancelled"
                | "workflow.condition.scheduled"
                | "workflow.condition.completed"
                | "workflow.condition.cancelled"
                | "workflow.cancellation.requested"
                | "workflow.signal.received"
                | "workflow.worker.claimed"
                | "workflow.worker.released"
                | "workflow.cancelled"
                | "workflow.completed"
                | "workflow.failed"
        ) {
            return Err(invalid(format!(
                "Workflow journal {stream:?} contains unknown event {kind:?}."
            )));
        }
        if kind == "workflow.started" {
            starts += 1;
        }
        if kind == "workflow.cancellation.requested" {
            if cancellation_requested {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} requests cancellation more than once."
                )));
            }
            optional_string(&stored.event, "reason")?;
            cancellation_requested = true;
        }
        if kind == "workflow.state" {
            let reason = stored.event.property("reason", false)?.string()?;
            if reason == "activity" {
                activity_checkpoints.insert(workflow_sequence(&stored.event, stream)?);
            }
            if reason == "condition" {
                condition_checkpoints.insert(workflow_sequence(&stored.event, stream)?);
            }
            if reason == "timer" {
                timer_checkpoints.insert(workflow_sequence(&stored.event, stream)?);
            }
        }
        if kind == "workflow.activity.scheduled" {
            let sequence = workflow_sequence(&stored.event, stream)?;
            if !activity_checkpoints.contains(&sequence) {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} schedules Activity {sequence} without a state checkpoint."
                )));
            }
            if activities
                .insert(
                    sequence,
                    ActivityValidation {
                        attempts: HashSet::new(),
                        deferred: HashSet::new(),
                        closed: HashSet::new(),
                        completed: false,
                    },
                )
                .is_some()
            {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} schedules Activity {sequence} more than once."
                )));
            }
        }
        if kind == "workflow.activity.attempt.started" {
            let sequence = workflow_sequence(&stored.event, stream)?;
            let attempt = workflow_attempt(&stored.event, stream)?;
            let Some(activity) = activities.get_mut(&sequence) else {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} starts an invalid Activity {sequence} attempt."
                )));
            };
            if activity.completed
                || attempt != activity.attempts.len() as u64 + 1
                || (attempt > 1 && !activity.closed.contains(&(attempt - 1)))
            {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} has invalid Activity {sequence} attempt order."
                )));
            }
            activity.attempts.insert(attempt);
        }
        if kind == "workflow.activity.heartbeat" {
            let sequence = workflow_sequence(&stored.event, stream)?;
            let attempt = workflow_attempt(&stored.event, stream)?;
            let Some(activity) = activities.get(&sequence) else {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} heartbeats an invalid Activity {sequence} attempt {attempt}."
                )));
            };
            if !activity.attempts.contains(&attempt) || activity.closed.contains(&attempt) {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} heartbeats an invalid Activity {sequence} attempt {attempt}."
                )));
            }
        }
        if kind == "workflow.activity.deferred" {
            let sequence = workflow_sequence(&stored.event, stream)?;
            let attempt = workflow_attempt(&stored.event, stream)?;
            let Some(activity) = activities.get_mut(&sequence) else {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} defers an invalid Activity {sequence} attempt {attempt}."
                )));
            };
            if !activity.attempts.contains(&attempt)
                || activity.closed.contains(&attempt)
                || !activity.deferred.insert(attempt)
            {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} defers an invalid Activity {sequence} attempt {attempt}."
                )));
            }
        }
        if matches!(
            kind.as_str(),
            "workflow.activity.attempt.abandoned"
                | "workflow.activity.attempt.failed"
                | "workflow.activity.completed"
        ) {
            let sequence = workflow_sequence(&stored.event, stream)?;
            let attempt = workflow_attempt(&stored.event, stream)?;
            let Some(activity) = activities.get_mut(&sequence) else {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} closes an invalid Activity {sequence} attempt {attempt}."
                )));
            };
            if !activity.attempts.contains(&attempt) || !activity.closed.insert(attempt) {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} closes an invalid Activity {sequence} attempt {attempt}."
                )));
            }
            if kind == "workflow.activity.completed" {
                if activity.completed {
                    return Err(invalid(format!(
                        "Workflow journal {stream:?} completes Activity {sequence} more than once."
                    )));
                }
                activity.completed = true;
            }
        }
        if kind == "workflow.activity.cancelled" {
            let sequence = workflow_sequence(&stored.event, stream)?;
            let Some(activity) = activities.get_mut(&sequence) else {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} cancels an invalid Activity {sequence}."
                )));
            };
            if activity.completed {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} closes Activity {sequence} more than once."
                )));
            }
            optional_string(&stored.event, "reason")?;
            activity.completed = true;
        }
        if kind == "workflow.timer.scheduled" {
            let sequence = workflow_sequence(&stored.event, stream)?;
            if !timer_checkpoints.contains(&sequence) {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} schedules timer {sequence} without a state checkpoint."
                )));
            }
            if timers.contains_key(&sequence) {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} schedules timer {sequence} more than once."
                )));
            }
            let duration = stored.event.property("duration", true)?;
            if !duration.is_undefined() {
                non_negative_safe_integer(&duration, "Workflow timer duration")?;
            }
            non_negative_safe_integer(
                &stored.event.property("deadline", false)?,
                "Workflow timer deadline",
            )?;
            timers.insert(sequence, false);
        }
        if matches!(
            kind.as_str(),
            "workflow.timer.completed" | "workflow.timer.cancelled"
        ) {
            let sequence = workflow_sequence(&stored.event, stream)?;
            let Some(completed) = timers.get_mut(&sequence) else {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} completes an invalid timer {sequence}."
                )));
            };
            if *completed {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} completes an invalid timer {sequence}."
                )));
            }
            if kind == "workflow.timer.cancelled" {
                optional_string(&stored.event, "reason")?;
            }
            *completed = true;
        }
        if kind == "workflow.condition.scheduled" {
            let sequence = workflow_sequence(&stored.event, stream)?;
            if !condition_checkpoints.contains(&sequence) {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} schedules condition {sequence} without a state checkpoint."
                )));
            }
            if conditions.contains_key(&sequence) {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} schedules condition {sequence} more than once."
                )));
            }
            let timeout = stored.event.property("timeout", true)?;
            let deadline = stored.event.property("deadline", true)?;
            if timeout.is_undefined() != deadline.is_undefined() {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} has invalid condition {sequence} timing."
                )));
            }
            let timeout = if timeout.is_undefined() {
                None
            } else {
                non_negative_safe_integer(&timeout, "Workflow condition timeout")?;
                non_negative_safe_integer(&deadline, "Workflow condition deadline")?;
                let at = stored.event.property("at", false)?;
                non_negative_safe_integer(&at, "Workflow condition schedule time")?;
                if deadline.number()? != at.number()? + timeout.number()? {
                    return Err(invalid(format!(
                        "Workflow journal {stream:?} has invalid condition {sequence} timing."
                    )));
                }
                Some(timeout.number()?)
            };
            conditions.insert(
                sequence,
                ConditionValidation {
                    completed: false,
                    timeout,
                },
            );
        }
        if matches!(
            kind.as_str(),
            "workflow.condition.completed" | "workflow.condition.cancelled"
        ) {
            let sequence = workflow_sequence(&stored.event, stream)?;
            let Some(condition) = conditions.get_mut(&sequence) else {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} completes an invalid condition {sequence}."
                )));
            };
            if condition.completed {
                return Err(invalid(format!(
                    "Workflow journal {stream:?} completes an invalid condition {sequence}."
                )));
            }
            if kind == "workflow.condition.completed" {
                let outcome = stored.event.property("outcome", false)?.string()?;
                if !matches!(outcome.as_str(), "satisfied" | "timed-out")
                    || (outcome == "timed-out" && condition.timeout.is_none())
                {
                    return Err(invalid(format!(
                        "Workflow journal {stream:?} completes an invalid condition {sequence}."
                    )));
                }
            } else {
                optional_string(&stored.event, "reason")?;
            }
            condition.completed = true;
        }
        if kind == "workflow.cancelled" && !cancellation_requested {
            return Err(invalid(format!(
                "Workflow journal {stream:?} is cancelled without a cancellation request."
            )));
        }
    }
    if starts != 1 {
        return Err(invalid(format!(
            "Workflow journal {stream:?} has {starts} start events."
        )));
    }
    Ok(())
}

fn workflow_sequence(event: &Value, stream: &str) -> NativeResult<u64> {
    positive_history_integer(
        event.property("sequence", false)?.number()?,
        format!("Workflow journal {stream:?} has an invalid command sequence."),
    )
}

fn workflow_attempt(event: &Value, stream: &str) -> NativeResult<u64> {
    positive_history_integer(
        event.property("attempt", false)?.number()?,
        format!("Workflow journal {stream:?} has an invalid Activity attempt."),
    )
}

fn positive_history_integer(value: f64, message: String) -> NativeResult<u64> {
    if !value.is_finite() || value < 1.0 || value.fract() != 0.0 || value > 9_007_199_254_740_991.0
    {
        return Err(invalid(message));
    }
    Ok(value as u64)
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
        "workflow.cancelled" => Err(workflow_cancelled(
            optional_string(&stored.event, "reason")?
                .or_else(|| Some(format!("Workflow {id:?} was cancelled."))),
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
            "workflow.state" | "workflow.completed" | "workflow.failed" | "workflow.cancelled"
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

fn workflow_signal_boundary(history: &[Stored]) -> u64 {
    let mut open = HashSet::new();
    for stored in history {
        let Ok(kind) = event_type(&stored.event) else {
            continue;
        };
        let Ok(sequence) = event_sequence(&stored.event) else {
            continue;
        };
        match kind.as_str() {
            "workflow.activity.scheduled"
            | "workflow.timer.scheduled"
            | "workflow.condition.scheduled" => {
                open.insert(sequence);
            }
            "workflow.activity.completed"
            | "workflow.activity.cancelled"
            | "workflow.timer.completed"
            | "workflow.timer.cancelled"
            | "workflow.condition.completed"
            | "workflow.condition.cancelled" => {
                open.remove(&sequence);
            }
            _ => {}
        }
    }
    open.into_iter()
        .max()
        .unwrap_or_else(|| next_sequence(history))
}

fn event_sequence(event: &Value) -> NativeResult<u64> {
    Ok(event.property("sequence", true)?.number()? as u64)
}

fn event_attempt(event: &Value) -> NativeResult<u64> {
    Ok(event.property("attempt", true)?.number()? as u64)
}

fn event_number(event: &Value, field: &str) -> NativeResult<f64> {
    event.property(field, false)?.number()
}

fn event_type(event: &Value) -> NativeResult<String> {
    event.property("type", false)?.string()
}

fn optional_string(event: &Value, field: &str) -> NativeResult<Option<String>> {
    let value = event.property(field, true)?;
    if value.is_undefined() {
        Ok(None)
    } else {
        Ok(Some(value.string()?))
    }
}

fn cancellation_request(history: &[Stored]) -> Option<&Stored> {
    history.iter().find(|stored| {
        event_type(&stored.event).ok().as_deref() == Some("workflow.cancellation.requested")
    })
}

fn workflow_cancelled(reason: Option<String>) -> NativeError {
    NativeError::new(
        "WorkflowCancelled",
        reason.unwrap_or_else(|| "Workflow was cancelled.".to_owned()),
    )
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

fn required_string(record: &Record, field: &str) -> NativeResult<String> {
    record
        .get(field)
        .cloned()
        .ok_or_else(|| invalid(format!("{field} is missing.")))?
        .string()
}

fn required_number(record: &Record, field: &str) -> NativeResult<f64> {
    record
        .get(field)
        .cloned()
        .ok_or_else(|| invalid(format!("{field} is missing.")))?
        .number()
}

fn required_u64(record: &Record, field: &str) -> NativeResult<u64> {
    let value = required_number(record, field)?;
    if !value.is_finite() || value.fract() != 0.0 || !(1.0..=u64::MAX as f64).contains(&value) {
        return Err(invalid(format!("{field} must be a positive integer.")));
    }
    Ok(value as u64)
}

fn portable(value: Value) -> NativeResult<Value> {
    Ok(Value::from_canonical_json(&value.canonical_json()?))
}

fn canonical(value: Value) -> NativeResult<String> {
    Ok(value.canonical_json()?.to_string())
}

fn error_value(error: &NativeError) -> Value {
    let mut value = BTreeMap::from([
        ("name".to_owned(), Value::String(error.name.clone())),
        ("message".to_owned(), Value::String(error.message.clone())),
    ]);
    if let Some(data) = error.fields.get("data") {
        value.insert("data".to_owned(), data.clone());
    }
    Value::record(value)
}

fn stored_workflow_error(value: Value) -> NativeResult<NativeError> {
    let failure = value.as_record()?;
    let mut error = NativeError::new(
        required_string(&failure, "name")?,
        required_string(&failure, "message")?,
    );
    if let Some(data) = failure.get("data").filter(|value| !value.is_undefined()) {
        error = error.with_field("data", data.clone());
    }
    Ok(error)
}

fn activity_timeout(timeout: &str) -> NativeError {
    NativeError::new(
        "WorkflowActivityTimeout",
        format!("Workflow Activity exceeded its {timeout} timeout."),
    )
    .with_field(
        "data",
        Value::record(BTreeMap::from([(
            "timeout".to_owned(),
            Value::String(timeout.to_owned()),
        )])),
    )
}

fn is_total_timeout(error: &NativeError) -> bool {
    error.name == "WorkflowActivityTimeout"
        && error
            .fields
            .get("data")
            .and_then(|data| data.property("timeout", false).ok())
            .and_then(|timeout| timeout.string().ok())
            .is_some_and(|timeout| timeout == "total")
}

fn activity_retry_at(
    error: &NativeError,
    policy: &ActivityPolicy,
    attempt: u64,
    total_deadline: Option<f64>,
    now: f64,
) -> NativeResult<Option<f64>> {
    if error
        .fields
        .get("recordedActivityFailure")
        .is_some_and(|value| matches!(value, Value::Boolean(true)))
    {
        return error.fields.get("retryAt").map(Value::number).transpose();
    }
    if attempt >= policy.retry.attempts
        || is_total_timeout(error)
        || policy.retry.non_retryable.contains(&error.name)
    {
        return Ok(None);
    }
    let retry_delay = error
        .fields
        .get("retryDelay")
        .map(Value::number)
        .transpose()?
        .unwrap_or(policy.retry.delay(attempt)? as f64);
    let retry_at = now + retry_delay;
    Ok(Some(
        total_deadline.map_or(retry_at, |deadline| deadline.min(retry_at)),
    ))
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

fn workflow_activity_id(name: &str, execution: &str, sequence: u64) -> String {
    format!(
        "activity:{}:{}:{sequence}",
        percent_encode(name),
        percent_encode(execution)
    )
}

fn deferred_invocation(
    id: String,
    activity: String,
    workflow: String,
    execution: String,
    run: String,
    attempt: u64,
) -> Value {
    Value::record(BTreeMap::from([
        (
            "$kit".to_owned(),
            Value::String(DEFERRED_INVOCATION_MARKER.to_owned()),
        ),
        ("id".to_owned(), Value::String(id)),
        ("activity".to_owned(), Value::String(activity)),
        (
            "execution".to_owned(),
            Value::record(BTreeMap::from([
                ("workflow".to_owned(), Value::String(workflow)),
                ("id".to_owned(), Value::String(execution)),
                ("run".to_owned(), Value::String(run)),
            ])),
        ),
        ("attempt".to_owned(), Value::Number(attempt as f64)),
    ]))
}

fn is_deferred_invocation(value: &Value) -> bool {
    value
        .property("$kit", false)
        .and_then(|marker| marker.string())
        .is_ok_and(|marker| marker == DEFERRED_INVOCATION_MARKER)
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
        changes: Arc<tokio::sync::Notify>,
    }

    impl Dependency for Events {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            input: Value,
            _invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
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
                "read" | "append" | "subscribe" => Some(self.streams.clone()),
                _ => None,
            };
            let changes = self.changes.clone();
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
                            drop(streams);
                            changes.notify_waiters();
                            Ok(Value::array(appended))
                        }
                        "subscribe" => {
                            let after = input
                                .get("after")
                                .and_then(serde_json::Value::as_u64)
                                .unwrap_or(0);
                            Ok(Value::stream(Box::pin(async_stream::stream! {
                                loop {
                                    let changed = changes.notified();
                                    let event = lock(&state)
                                        .get(&stream)
                                        .and_then(|events| events.get(after as usize))
                                        .cloned();
                                    if let Some(event) = event {
                                        yield Ok(Value::record(BTreeMap::from([
                                            ("stream".to_owned(), Value::String(stream.clone())),
                                            ("revision".to_owned(), Value::Number((after + 1) as f64)),
                                            ("event".to_owned(), event),
                                        ])));
                                        break;
                                    }
                                    changed.await;
                                }
                            })))
                        }
                        _ => unreachable!(),
                    }
                });
            }
            Box::pin(
                async move { Err(invalid(format!("unknown test event operation {operation}"))) },
            )
        }
    }

    struct Clock(AtomicU64);

    impl Dependency for Clock {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            _input: Value,
            _invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
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

    struct PendingTimer;

    impl Dependency for PendingTimer {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            _input: Value,
            _invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
            let operation = operation.to_owned();
            Box::pin(async move {
                if operation == "sleep" {
                    std::future::pending::<()>().await;
                    Ok(Value::Undefined)
                } else {
                    Err(invalid("unknown timer operation"))
                }
            })
        }
    }

    struct Identifiers;

    impl Dependency for Identifiers {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            _input: Value,
            _invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
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

    struct Messages {
        calls: Arc<AtomicUsize>,
        invocations: Arc<Mutex<Vec<DependencyInvocation>>>,
    }

    impl Dependency for Messages {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            input: Value,
            invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
            let calls = self.calls.clone();
            let invocations = self.invocations.clone();
            let operation = operation.to_owned();
            Box::pin(async move {
                if operation != "send" {
                    return Err(invalid("unknown messages operation"));
                }
                let call = calls.fetch_add(1, Ordering::SeqCst) + 1;
                invocation.heartbeat(Value::record(BTreeMap::from([(
                    "completed".to_owned(),
                    Value::Number(call as f64),
                )])))?;
                let previous_heartbeat = invocation.previous_heartbeat.clone();
                lock(&invocations).push(invocation);
                if call == 1 {
                    return Err(NativeError::new("temporary", "retry immediately")
                        .with_field("retryDelay", Value::Number(0.0)));
                }
                assert_eq!(
                    previous_heartbeat
                        .expect("previous heartbeat")
                        .property("completed", false)?
                        .number()?,
                    1.0
                );
                Ok(Value::record(BTreeMap::from([(
                    "message".to_owned(),
                    input.property("message", false)?,
                )])))
            })
        }
    }

    #[test]
    fn rejects_an_incompatible_durable_history_before_replay() {
        let history = [Stored {
            revision: 1,
            event: Value::record(BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.started".to_owned()),
                ),
                (
                    "definitionVersion".to_owned(),
                    Value::Number(WORKFLOW_DEFINITION_VERSION),
                ),
                ("protocolVersion".to_owned(), Value::Number(10.0)),
                ("run".to_owned(), Value::String("run-old".to_owned())),
            ])),
        }];

        let failure = validate_history(&history, "workflow:mail:old").expect_err("old protocol");

        assert!(
            failure
                .message
                .contains("uses protocol version 10; this runtime supports 9")
        );
    }

    #[test]
    fn rejects_terminal_cancellation_without_a_request() {
        let history = [
            Stored {
                revision: 1,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.started".to_owned()),
                    ),
                    (
                        "definitionVersion".to_owned(),
                        Value::Number(WORKFLOW_DEFINITION_VERSION),
                    ),
                    (
                        "protocolVersion".to_owned(),
                        Value::Number(WORKFLOW_PROTOCOL_VERSION),
                    ),
                    (
                        "run".to_owned(),
                        Value::String("run-invalid-cancellation".to_owned()),
                    ),
                    ("state".to_owned(), Value::record(BTreeMap::new())),
                ])),
            },
            Stored {
                revision: 2,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.cancelled".to_owned()),
                    ),
                    ("state".to_owned(), Value::record(BTreeMap::new())),
                ])),
            },
        ];

        let failure =
            validate_history(&history, "workflow:mail:invalid").expect_err("invalid cancellation");

        assert!(
            failure
                .message
                .contains("is cancelled without a cancellation request")
        );
    }

    #[test]
    fn rejects_an_impossible_activity_history_before_replay() {
        let history = [
            Stored {
                revision: 1,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.started".to_owned()),
                    ),
                    (
                        "definitionVersion".to_owned(),
                        Value::Number(WORKFLOW_DEFINITION_VERSION),
                    ),
                    (
                        "protocolVersion".to_owned(),
                        Value::Number(WORKFLOW_PROTOCOL_VERSION),
                    ),
                    (
                        "run".to_owned(),
                        Value::String("run-impossible-activity".to_owned()),
                    ),
                ])),
            },
            Stored {
                revision: 2,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.state".to_owned()),
                    ),
                    ("reason".to_owned(), Value::String("activity".to_owned())),
                    ("sequence".to_owned(), Value::Number(1.0)),
                ])),
            },
            Stored {
                revision: 3,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.activity.scheduled".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(1.0)),
                ])),
            },
            Stored {
                revision: 4,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.activity.completed".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(1.0)),
                    ("attempt".to_owned(), Value::Number(1.0)),
                ])),
            },
        ];

        assert!(
            validate_history(&history, "workflow:mail:impossible")
                .expect_err("impossible Activity")
                .message
                .contains("closes an invalid Activity 1 attempt 1")
        );
    }

    #[test]
    fn rejects_an_impossible_timer_history_before_replay() {
        let history = [
            Stored {
                revision: 1,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.started".to_owned()),
                    ),
                    (
                        "definitionVersion".to_owned(),
                        Value::Number(WORKFLOW_DEFINITION_VERSION),
                    ),
                    (
                        "protocolVersion".to_owned(),
                        Value::Number(WORKFLOW_PROTOCOL_VERSION),
                    ),
                    (
                        "run".to_owned(),
                        Value::String("run-impossible-timer".to_owned()),
                    ),
                ])),
            },
            Stored {
                revision: 2,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.timer.scheduled".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(1.0)),
                    ("deadline".to_owned(), Value::Number(100.0)),
                ])),
            },
        ];

        assert!(
            validate_history(&history, "workflow:mail:impossible-timer")
                .expect_err("impossible timer")
                .message
                .contains("schedules timer 1 without a state checkpoint")
        );
    }

    #[test]
    fn rejects_an_impossible_condition_history_before_replay() {
        let history = [
            Stored {
                revision: 1,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.started".to_owned()),
                    ),
                    (
                        "definitionVersion".to_owned(),
                        Value::Number(WORKFLOW_DEFINITION_VERSION),
                    ),
                    (
                        "protocolVersion".to_owned(),
                        Value::Number(WORKFLOW_PROTOCOL_VERSION),
                    ),
                    (
                        "run".to_owned(),
                        Value::String("run-impossible-condition".to_owned()),
                    ),
                ])),
            },
            Stored {
                revision: 2,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.state".to_owned()),
                    ),
                    ("reason".to_owned(), Value::String("condition".to_owned())),
                    ("sequence".to_owned(), Value::Number(1.0)),
                ])),
            },
            Stored {
                revision: 3,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.condition.scheduled".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(1.0)),
                    ("at".to_owned(), Value::Number(0.0)),
                ])),
            },
            Stored {
                revision: 4,
                event: Value::record(BTreeMap::from([
                    (
                        "type".to_owned(),
                        Value::String("workflow.condition.completed".to_owned()),
                    ),
                    ("sequence".to_owned(), Value::Number(1.0)),
                    ("outcome".to_owned(), Value::String("timed-out".to_owned())),
                ])),
            },
        ];

        assert!(
            validate_history(&history, "workflow:mail:impossible-condition")
                .expect_err("impossible condition")
                .message
                .contains("completes an invalid condition 1")
        );
    }

    #[test]
    fn validates_and_caps_declarative_activity_retry_policy() {
        let policy = Value::record(BTreeMap::from([(
            "retry".to_owned(),
            Value::record(BTreeMap::from([
                ("attempts".to_owned(), Value::Number(4.0)),
                ("delay".to_owned(), Value::Number(10.0)),
                ("factor".to_owned(), Value::Number(3.0)),
                ("maximumDelay".to_owned(), Value::Number(20.0)),
                (
                    "nonRetryable".to_owned(),
                    Value::array(vec![Value::String("declined".to_owned())]),
                ),
            ])),
        )]));
        let retry = retry_from_policy(&policy.as_record().expect("policy")).expect("retry");

        assert_eq!(retry.attempts, 4);
        assert_eq!(retry.delay(1).expect("first delay"), 10);
        assert_eq!(retry.delay(2).expect("second delay"), 20);
        assert_eq!(retry.delay(3).expect("third delay"), 20);
        assert_eq!(retry.non_retryable, ["declined"]);

        let invalid = Value::record(BTreeMap::from([(
            "retry".to_owned(),
            Value::record(BTreeMap::from([
                ("attempts".to_owned(), Value::Number(3.0)),
                ("delay".to_owned(), Value::Number(10.0)),
                ("maximumDelay".to_owned(), Value::Number(5.0)),
            ])),
        )]));
        assert!(
            retry_from_policy(&invalid.as_record().expect("invalid policy"))
                .expect_err("invalid maximum")
                .message
                .contains("must not be less")
        );
    }

    #[tokio::test]
    async fn executes_and_journals_intercepted_dependencies_natively() {
        let engine = Engine::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let invocations = Arc::new(Mutex::new(Vec::new()));
        let streams = Arc::new(Mutex::new(HashMap::new()));
        engine
            .register(
                "events",
                Arc::new(Events {
                    streams: streams.clone(),
                    changes: Arc::new(tokio::sync::Notify::new()),
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
            .register("timer", Arc::new(PendingTimer))
            .expect("timer");
        engine
            .register(
                "messages",
                Arc::new(Messages {
                    calls: calls.clone(),
                    invocations: invocations.clone(),
                }),
            )
            .expect("messages");

        let state = Value::Function(NativeFunction::new(|_engine, _arguments| {
            Box::pin(async {
                Ok(Value::record(BTreeMap::from([(
                    "phase".to_owned(),
                    Value::String("pending".to_owned()),
                )])))
            })
        }));
        let execute = Value::Function(NativeFunction::new(|engine, arguments| {
            Box::pin(async move {
                let context = arguments[0].clone();
                let input = context.property("input", false)?;
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
                        "definition".to_owned(),
                        Value::record(BTreeMap::from([
                            ("version".to_owned(), Value::Number(1.0)),
                            (
                                "protocolVersion".to_owned(),
                                Value::Number(WORKFLOW_PROTOCOL_VERSION),
                            ),
                            ("name".to_owned(), Value::String("mail".to_owned())),
                            ("schemas".to_owned(), Value::record(BTreeMap::new())),
                        ])),
                    ),
                    (
                        "implementation".to_owned(),
                        Value::record(BTreeMap::from([
                            ("state".to_owned(), state),
                            ("execute".to_owned(), execute),
                            (
                                "activities".to_owned(),
                                Value::record(BTreeMap::from([(
                                    "messages".to_owned(),
                                    Value::record(BTreeMap::from([(
                                        "send".to_owned(),
                                        ActivityPolicy {
                                            timeout: ActivityTimeout {
                                                attempt: Some(30_000),
                                                total: None,
                                                queue: None,
                                                heartbeat: None,
                                            },
                                            retry: Retry {
                                                attempts: 2,
                                                delay: 100,
                                                maximum_delay: None,
                                                factor: 1.0,
                                                non_retryable: Vec::new(),
                                            },
                                        }
                                        .value(),
                                    )])),
                                )])),
                            ),
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
                DependencyInvocation::direct("workflowRuntime", "create", 1).expect("invocation"),
            )
            .await
            .expect("workflow service");
        let execution = engine
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

        engine
            .method(
                service.clone(),
                "result",
                vec![Value::record(BTreeMap::from([
                    ("execution".to_owned(), execution.clone()),
                    ("follow".to_owned(), Value::String("run".to_owned())),
                ]))],
            )
            .await
            .expect("workflow result");
        let snapshot = engine
            .method(
                service.clone(),
                "describe",
                vec![Value::record(BTreeMap::from([(
                    "execution".to_owned(),
                    execution.clone(),
                )]))],
            )
            .await
            .expect("describe workflow");
        assert_eq!(
            canonical(snapshot.property("execution", false).expect("execution"))
                .expect("canonical execution"),
            canonical(execution).expect("canonical started execution")
        );
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
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let invocations = lock(&invocations);
        assert_eq!(invocations.len(), 2);
        assert_eq!(invocations[0].id, "activity:mail:one:1");
        assert_eq!(invocations[0].attempt, 1);
        assert!(invocations[0].started_at >= invocations[0].scheduled_at);
        assert!(invocations[0].previous_heartbeat.is_none());
        assert_eq!(invocations[1].id, "activity:mail:one:1");
        assert_eq!(invocations[1].attempt, 2);
        assert_eq!(
            invocations[1]
                .previous_heartbeat
                .as_ref()
                .expect("previous heartbeat")
                .property("completed", false)
                .expect("completed")
                .number()
                .expect("number"),
            1.0
        );
        let history = lock(&streams)
            .get("workflow:mail:one")
            .cloned()
            .expect("workflow history");
        let heartbeats = history
            .iter()
            .filter(|event| {
                event_type(event).ok().as_deref() == Some("workflow.activity.heartbeat")
            })
            .collect::<Vec<_>>();
        assert_eq!(
            heartbeats
                .iter()
                .map(|heartbeat| {
                    heartbeat
                        .property("details", false)
                        .expect("details")
                        .property("completed", false)
                        .expect("completed")
                        .number()
                        .expect("number")
                })
                .collect::<Vec<_>>(),
            [1.0, 2.0]
        );
        let failures = history
            .iter()
            .filter(|event| {
                event_type(event).ok().as_deref() == Some("workflow.activity.attempt.failed")
            })
            .collect::<Vec<_>>();
        assert_eq!(failures.len(), 1);
        assert!(
            failures[0]
                .property("retryAt", false)
                .expect("retryAt")
                .number()
                .expect("number")
                <= failures[0]
                    .property("at", false)
                    .expect("at")
                    .number()
                    .expect("number")
        );
    }

    #[tokio::test]
    async fn fences_replicas_and_allows_takeover_after_expiry() {
        let streams = Arc::new(Mutex::new(HashMap::new()));
        let stream = "workflow:mail:shared";
        lock(&streams).insert(
            stream.to_owned(),
            vec![Value::record(BTreeMap::from([
                (
                    "type".to_owned(),
                    Value::String("workflow.started".to_owned()),
                ),
                (
                    "definitionVersion".to_owned(),
                    Value::Number(WORKFLOW_DEFINITION_VERSION),
                ),
                (
                    "protocolVersion".to_owned(),
                    Value::Number(WORKFLOW_PROTOCOL_VERSION),
                ),
                ("run".to_owned(), Value::String("run-shared".to_owned())),
                ("input".to_owned(), Value::record(BTreeMap::new())),
                ("state".to_owned(), Value::record(BTreeMap::new())),
                ("at".to_owned(), Value::Number(0.0)),
            ]))],
        );
        let first = Engine::new();
        first
            .register(
                "events",
                Arc::new(Events {
                    streams: streams.clone(),
                    changes: Arc::new(tokio::sync::Notify::new()),
                }),
            )
            .expect("first events");
        let second = Engine::new();
        second
            .register(
                "events",
                Arc::new(Events {
                    streams,
                    changes: Arc::new(tokio::sync::Notify::new()),
                }),
            )
            .expect("second events");

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
