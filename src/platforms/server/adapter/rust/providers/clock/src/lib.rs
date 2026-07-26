use std::time::{SystemTime, UNIX_EPOCH};

use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};

pub struct Clock {
    offset: f64,
}

pub async fn create(context: DependencyContext) -> NativeResult<Clock> {
    let offset = context
        .configuration
        .get("offset")
        .map(String::as_str)
        .unwrap_or("0")
        .parse::<f64>()
        .map_err(|error| NativeError::new("InvalidConfiguration", error.to_string()))?;
    if !offset.is_finite() {
        return Err(NativeError::new(
            "InvalidConfiguration",
            "Clock offset must be finite.",
        ));
    }
    Ok(Clock { offset })
}

impl Dependency for Clock {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        _input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let result = match operation {
            "now" => SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| Value::Number(duration.as_millis() as f64 + self.offset))
                .map_err(|error| NativeError::new("ClockFailure", error.to_string())),
            operation => Err(NativeError::new(
                "UnknownOperation",
                format!("Clock has no operation {operation:?}."),
            )),
        };
        Box::pin(async move { result })
    }
}

kit_server_runtime::dependency_operations!(Clock {
    operation_now => "now",
});

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    #[tokio::test]
    async fn returns_unix_milliseconds() {
        let clock = create(DependencyContext {
            name: "clock".to_owned(),
            configuration: BTreeMap::from([("offset".to_owned(), "125".to_owned())]),
            dependencies: BTreeMap::new(),
        })
        .await
        .expect("create clock");
        let value = clock
            .call(
                Engine::new(),
                "now",
                Value::Undefined,
                DependencyInvocation::direct("clock", "now", 1).expect("invocation"),
            )
            .await
            .expect("read clock")
            .number()
            .expect("number");
        let system = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis() as f64;
        assert!(value >= system + 100.0);
        assert!(value <= system + 250.0);
    }
}
