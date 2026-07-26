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

kit_server_runtime::dependency_operations!(Timer {
    operation_sleep => "sleep",
});
