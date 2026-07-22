use std::{
    fs::{File, OpenOptions},
    io::Write,
    sync::{Arc, Mutex},
};

use poggers_native_runtime::{
    Capability, CapabilityContext, Engine, NativeError, NativeFuture, NativeResult, Value,
};

pub struct Recorder {
    input: Value,
    output: Arc<Mutex<File>>,
}

pub async fn create(context: CapabilityContext) -> NativeResult<Recorder> {
    let output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(context.configuration("output")?)
        .map_err(|error| NativeError::new("RecorderFailure", error.to_string()))?;
    Ok(Recorder {
        input: Value::from_json(
            &serde_json::from_str(context.configuration("input")?)
                .map_err(|error| NativeError::new("RecorderFailure", error.to_string()))?,
        ),
        output: Arc::new(Mutex::new(output)),
    })
}

impl Capability for Recorder {
    fn call(&self, _engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
        let output = self.output.clone();
        let input_value = self.input.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            if operation == "read" {
                return Ok(input_value);
            }
            if operation != "record" {
                return Err(NativeError::new(
                    "UnknownOperation",
                    format!("Recorder has no operation {operation:?}."),
                ));
            }
            let mut output = output
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            writeln!(output, "{}", input.to_json()?)
                .and_then(|_| output.flush())
                .map_err(|error| NativeError::new("RecorderFailure", error.to_string()))?;
            Ok(Value::Undefined)
        })
    }
}
