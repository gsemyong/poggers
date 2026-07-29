use std::{
    fs::{File, OpenOptions},
    io::Write,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};

pub struct Recorder {
    input: Value,
    output: Arc<Mutex<File>>,
    started: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}

pub async fn create(context: DependencyContext) -> NativeResult<Recorder> {
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
        started: Arc::new(AtomicBool::new(false)),
        cancelled: Arc::new(AtomicBool::new(false)),
    })
}

impl Dependency for Recorder {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let output = self.output.clone();
        let input_value = self.input.clone();
        let started = self.started.clone();
        let cancelled = self.cancelled.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            if operation == "read" {
                return Ok(input_value);
            }
            if operation == "evaluate" {
                return Ok(Value::record([
                    ("type".to_owned(), Value::String("complete".to_owned())),
                    ("output".to_owned(), Value::record([])),
                ]));
            }
            if operation == "search" {
                if input
                    .property("query", false)?
                    .string()
                    .is_ok_and(|query| query == "cancel")
                {
                    started.store(true, Ordering::SeqCst);
                    invocation.cancellation.wait().await;
                    cancelled.store(true, Ordering::SeqCst);
                    return Ok(Value::record([(
                        "answer".to_owned(),
                        Value::String("cancelled".to_owned()),
                    )]));
                }
                return Ok(Value::record([(
                    "answer".to_owned(),
                    Value::String(String::new()),
                )]));
            }
            if operation == "status" {
                return Ok(Value::record([
                    (
                        "started".to_owned(),
                        Value::Boolean(started.load(Ordering::SeqCst)),
                    ),
                    (
                        "cancelled".to_owned(),
                        Value::Boolean(cancelled.load(Ordering::SeqCst)),
                    ),
                ]));
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

kit_server_runtime::dependency_operations!(Recorder {
    operation_evaluate => "evaluate",
    operation_read => "read",
    operation_record => "record",
    operation_search => "search",
    operation_status => "status",
});
