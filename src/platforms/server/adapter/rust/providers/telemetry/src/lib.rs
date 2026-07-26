use std::{
    fs::{File, OpenOptions},
    io::Write,
    sync::Mutex,
};

use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};

pub struct Telemetry {
    output: Mutex<Option<File>>,
}

pub async fn create(context: DependencyContext) -> NativeResult<Telemetry> {
    let output = context
        .configuration
        .get("file")
        .filter(|path| !path.is_empty())
        .map(|path| {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(|error| NativeError::new("TelemetryFailure", error.to_string()))
        })
        .transpose()?;
    Ok(Telemetry {
        output: Mutex::new(output),
    })
}

impl Dependency for Telemetry {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let result = match operation {
            "record" => self.record(input),
            operation => Err(NativeError::new(
                "UnknownOperation",
                format!("Telemetry has no operation {operation:?}."),
            )),
        };
        Box::pin(async move { result })
    }
}

kit_server_runtime::dependency_operations!(Telemetry {
    operation_record => "record",
});

impl Telemetry {
    fn record(&self, input: Value) -> NativeResult<Value> {
        let mut output = self
            .output
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(output) = output.as_mut() else {
            return Ok(Value::Undefined);
        };
        let value = input.canonical_json()?;
        writeln!(output, "{value}")
            .map_err(|error| NativeError::new("TelemetryFailure", error.to_string()))?;
        Ok(Value::Undefined)
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs};

    use super::*;

    #[tokio::test]
    async fn writes_structured_measurements_when_configured() {
        let path = std::env::temp_dir().join(format!(
            "kit-telemetry-{}-{}.jsonl",
            std::process::id(),
            std::thread::current().name().unwrap_or("test"),
        ));
        let telemetry = create(DependencyContext {
            name: "telemetry".to_owned(),
            configuration: BTreeMap::from([(
                "file".to_owned(),
                path.to_string_lossy().into_owned(),
            )]),
            dependencies: BTreeMap::new(),
        })
        .await
        .expect("create telemetry");
        telemetry
            .call(
                Engine::new(),
                "record",
                Value::record([("name".to_owned(), Value::String("actor.calls".to_owned()))]),
                DependencyInvocation::direct("telemetry", "record", 1).expect("invocation"),
            )
            .await
            .expect("record");
        let output = fs::read_to_string(&path).expect("read telemetry");
        assert!(output.contains("actor.calls"));
        let _ = fs::remove_file(path);
    }
}
