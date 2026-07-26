use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, Weak},
};

use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};
use tokio::sync::Mutex as AsyncMutex;

type Locks = Arc<Mutex<BTreeMap<String, Weak<AsyncMutex<()>>>>>;

pub struct Synchronization {
    locks: Locks,
}

pub async fn create(_context: DependencyContext) -> NativeResult<Synchronization> {
    Ok(Synchronization {
        locks: Arc::new(Mutex::new(BTreeMap::new())),
    })
}

impl Dependency for Synchronization {
    fn call(
        &self,
        engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        if operation != "exclusive" {
            let operation = operation.to_owned();
            return Box::pin(async move {
                Err(NativeError::new(
                    "UnknownOperation",
                    format!("Synchronization has no operation {operation:?}."),
                ))
            });
        }
        let locks = self.locks.clone();
        Box::pin(async move {
            let input = input.as_record()?;
            let key = match input.get("key") {
                Some(Value::String(key)) => key.clone(),
                _ => return Err(NativeError::new("InvalidInput", "key must be a string.")),
            };
            let task = input
                .get("task")
                .cloned()
                .ok_or_else(|| NativeError::new("InvalidInput", "task is required."))?;
            let lock = {
                let mut entries = locks
                    .lock()
                    .map_err(|_| NativeError::new("Synchronization", "Lock table is poisoned."))?;
                match entries.get(&key).and_then(Weak::upgrade) {
                    Some(lock) => lock,
                    None => {
                        let lock = Arc::new(AsyncMutex::new(()));
                        entries.insert(key, Arc::downgrade(&lock));
                        lock
                    }
                }
            };
            let _guard = lock.lock().await;
            engine.invoke(task, Vec::new()).await
        })
    }
}

kit_server_runtime::dependency_operations!(Synchronization {
    operation_exclusive => "exclusive",
});

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use kit_server_runtime::NativeFunction;

    use super::*;

    #[tokio::test]
    async fn serializes_tasks_sharing_one_key() {
        let engine = Engine::new();
        engine
            .register(
                "synchronization",
                Arc::new(
                    create(DependencyContext {
                        name: "synchronization".to_owned(),
                        configuration: BTreeMap::new(),
                        dependencies: BTreeMap::new(),
                    })
                    .await
                    .expect("synchronization"),
                ),
            )
            .expect("register");
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let task = |value: i64| {
            let active = active.clone();
            let maximum = maximum.clone();
            Value::Function(NativeFunction::new(move |_engine, _arguments| {
                let active = active.clone();
                let maximum = maximum.clone();
                Box::pin(async move {
                    let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum.fetch_max(current, Ordering::SeqCst);
                    tokio::task::yield_now().await;
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(Value::Number(value as f64))
                })
            }))
        };
        let call = |task| {
            engine.call_dependency(
                "synchronization",
                "exclusive",
                Value::record([
                    ("key".to_owned(), Value::String("same".to_owned())),
                    ("task".to_owned(), task),
                ]),
            )
        };

        let (first, second) = tokio::join!(call(task(1)), call(task(2)));

        assert!(matches!(first.expect("first"), Value::Number(value) if value == 1.0));
        assert!(matches!(second.expect("second"), Value::Number(value) if value == 2.0));
        assert_eq!(maximum.load(Ordering::SeqCst), 1);
    }
}
