use std::time::{Duration, SystemTime, UNIX_EPOCH};

use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};

pub struct Timer;

pub async fn create(_context: DependencyContext) -> NativeResult<Timer> {
    Ok(Timer)
}

impl Dependency for Timer {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let operation = operation.to_owned();
        Box::pin(async move {
            match operation.as_str() {
                "sleep" => {
                    let input = input.to_json()?;
                    let until = input
                        .get("until")
                        .and_then(serde_json::Value::as_f64)
                        .ok_or_else(|| {
                            NativeError::new("InvalidInput", "until must be a number.")
                        })?;
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map_err(|error| NativeError::new("TimerFailure", error.to_string()))?
                        .as_millis() as f64;
                    if until > now {
                        tokio::time::sleep(Duration::from_secs_f64((until - now) / 1000.0)).await;
                    }
                    Ok(Value::Undefined)
                }
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("Timer has no operation {operation:?}."),
                )),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn resolves_elapsed_deadlines_without_waiting() {
        let timer = create(DependencyContext {
            name: "timer".to_owned(),
            configuration: BTreeMap::new(),
            dependencies: BTreeMap::new(),
        })
        .await
        .expect("create timer");
        let started = std::time::Instant::now();
        timer
            .call(
                Engine::new(),
                "sleep",
                Value::from_json(&json!({ "until": 0 })),
                DependencyInvocation::direct("timer", "sleep", 1).expect("invocation"),
            )
            .await
            .expect("sleep");
        assert!(started.elapsed() < Duration::from_millis(50));
    }
}
