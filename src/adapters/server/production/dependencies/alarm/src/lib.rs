use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};
use tokio::task::{AbortHandle, JoinHandle};

type Scheduled = BTreeMap<String, (u64, AbortHandle)>;

pub struct Alarm {
    handlers: Arc<Mutex<BTreeMap<String, Value>>>,
    scheduled: Arc<Mutex<Scheduled>>,
    generation: Arc<Mutex<u64>>,
}

pub async fn create(_context: DependencyContext) -> NativeResult<Alarm> {
    Ok(Alarm {
        handlers: Arc::new(Mutex::new(BTreeMap::new())),
        scheduled: Arc::new(Mutex::new(BTreeMap::new())),
        generation: Arc::new(Mutex::new(0)),
    })
}

impl Dependency for Alarm {
    fn call(
        &self,
        engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let operation = operation.to_owned();
        let handlers = self.handlers.clone();
        let scheduled = self.scheduled.clone();
        let generation = self.generation.clone();
        Box::pin(async move {
            let input = input.as_record()?;
            let id = input
                .get("id")
                .ok_or_else(|| NativeError::new("InvalidInput", "id is required."))?
                .string()?;
            match operation.as_str() {
                "register" => {
                    let run = input
                        .get("run")
                        .ok_or_else(|| NativeError::new("InvalidInput", "run is required."))?
                        .clone();
                    handlers
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .insert(id, run);
                    Ok(Value::Undefined)
                }
                "schedule" => {
                    let at = input
                        .get("at")
                        .ok_or_else(|| NativeError::new("InvalidInput", "at is required."))?
                        .number()?;
                    let run = handlers
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .get(&id)
                        .cloned()
                        .ok_or_else(|| {
                            NativeError::new(
                                "UnregisteredAlarm",
                                format!("Alarm {id:?} is not registered."),
                            )
                        })?;
                    let next_generation = {
                        let mut value =
                            generation.lock().unwrap_or_else(|error| error.into_inner());
                        *value += 1;
                        *value
                    };
                    if let Some((_, previous)) = scheduled
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .remove(&id)
                    {
                        previous.abort();
                    }
                    let task = schedule(
                        engine,
                        scheduled.clone(),
                        id.clone(),
                        next_generation,
                        at,
                        run,
                    );
                    scheduled
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .insert(id, (next_generation, task.abort_handle()));
                    Ok(Value::Undefined)
                }
                "cancel" => {
                    if let Some((_, task)) = scheduled
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .remove(&id)
                    {
                        task.abort();
                    }
                    Ok(Value::Undefined)
                }
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("Alarm has no operation {operation:?}."),
                )),
            }
        })
    }

    fn shutdown(&self) -> NativeFuture<()> {
        let handlers = self.handlers.clone();
        let scheduled = self.scheduled.clone();
        Box::pin(async move {
            let tasks =
                std::mem::take(&mut *scheduled.lock().unwrap_or_else(|error| error.into_inner()));
            for (_, (_, task)) in tasks {
                task.abort();
            }
            handlers
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clear();
            Ok(())
        })
    }
}

fn schedule(
    engine: Engine,
    scheduled: Arc<Mutex<Scheduled>>,
    id: String,
    generation: u64,
    at: f64,
    run: Value,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis() as f64)
            .unwrap_or(at);
        if at > now {
            tokio::time::sleep(Duration::from_secs_f64((at - now) / 1_000.0)).await;
        }
        let current = scheduled
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&id)
            .map(|(value, _)| *value);
        if current != Some(generation) {
            return;
        }
        scheduled
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&id);
        let _ = engine.invoke(run, Vec::new()).await;
    })
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use kit_server_runtime::NativeFunction;

    use super::*;

    #[tokio::test]
    async fn replacement_runs_only_the_latest_callback() {
        let alarm = create(DependencyContext {
            name: "alarm".to_owned(),
            configuration: BTreeMap::new(),
            dependencies: BTreeMap::new(),
        })
        .await
        .expect("create alarm");
        let calls = Arc::new(AtomicUsize::new(0));
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("wall clock")
            .as_millis() as f64
            + 20.0;
        for generation in 1_u64..=2 {
            let calls = calls.clone();
            let callback = Value::Function(NativeFunction::new(move |_engine, _arguments| {
                let calls = calls.clone();
                Box::pin(async move {
                    calls.fetch_add(generation as usize, Ordering::SeqCst);
                    Ok(Value::Undefined)
                })
            }));
            alarm
                .call(
                    Engine::new(),
                    "register",
                    Value::record([
                        ("id".to_owned(), Value::String("same".to_owned())),
                        ("run".to_owned(), callback),
                    ]),
                    DependencyInvocation::direct("alarm", "schedule", generation)
                        .expect("invocation"),
                )
                .await
                .expect("register");
            alarm
                .call(
                    Engine::new(),
                    "schedule",
                    Value::record([
                        ("id".to_owned(), Value::String("same".to_owned())),
                        ("at".to_owned(), Value::Number(at)),
                    ]),
                    DependencyInvocation::direct("alarm", "schedule", generation)
                        .expect("invocation"),
                )
                .await
                .expect("schedule");
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
