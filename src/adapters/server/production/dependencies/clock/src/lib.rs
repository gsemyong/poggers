use std::time::{SystemTime, UNIX_EPOCH};

use kit_server_runtime::{
    Dependency, DependencyContext, Engine, NativeError, NativeFuture, NativeResult, Value,
};

pub struct Clock;

pub async fn create(_context: DependencyContext) -> NativeResult<Clock> {
    Ok(Clock)
}

impl Dependency for Clock {
    fn call(&self, _engine: Engine, operation: &str, _input: Value) -> NativeFuture<Value> {
        let result = match operation {
            "now" => SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| Value::Number(duration.as_millis() as f64))
                .map_err(|error| NativeError::new("ClockFailure", error.to_string())),
            operation => Err(NativeError::new(
                "UnknownOperation",
                format!("Clock has no operation {operation:?}."),
            )),
        };
        Box::pin(async move { result })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    #[tokio::test]
    async fn returns_unix_milliseconds() {
        let clock = create(DependencyContext {
            name: "clock".to_owned(),
            configuration: BTreeMap::new(),
            dependencies: BTreeMap::new(),
        })
        .await
        .expect("create clock");
        let value = clock
            .call(Engine::new(), "now", Value::Undefined)
            .await
            .expect("read clock")
            .number()
            .expect("number");
        assert!(value >= 1_700_000_000_000.0);
    }
}
