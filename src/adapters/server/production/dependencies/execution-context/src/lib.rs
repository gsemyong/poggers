use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};

tokio::task_local! {
    static SCOPES: Vec<Value>;
}

pub struct ExecutionContext;

pub async fn create(_context: DependencyContext) -> NativeResult<ExecutionContext> {
    Ok(ExecutionContext)
}

impl Dependency for ExecutionContext {
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
                "current" => Ok(Value::array(
                    SCOPES.try_with(Clone::clone).unwrap_or_default(),
                )),
                "run" => {
                    let input = input.as_record()?;
                    let scope = input
                        .get("scope")
                        .cloned()
                        .ok_or_else(|| NativeError::new("InvalidInput", "scope is required."))?;
                    let task = input
                        .get("task")
                        .cloned()
                        .ok_or_else(|| NativeError::new("InvalidInput", "task is required."))?;
                    let mut scopes = SCOPES.try_with(Clone::clone).unwrap_or_default();
                    scopes.push(scope);
                    SCOPES
                        .scope(scopes, async move { engine.invoke(task, Vec::new()).await })
                        .await
                }
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("ExecutionContext has no operation {operation:?}."),
                )),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, sync::Arc};

    use kit_server_runtime::NativeFunction;

    use super::*;

    #[tokio::test]
    async fn preserves_scopes_across_async_callbacks_without_leaking_them() {
        let engine = Engine::new();
        engine
            .register(
                "executionContext",
                Arc::new(
                    create(DependencyContext {
                        name: "executionContext".to_owned(),
                        configuration: BTreeMap::new(),
                        dependencies: BTreeMap::new(),
                    })
                    .await
                    .expect("context"),
                ),
            )
            .expect("register");
        let task = Value::Function(NativeFunction::new(|engine, _arguments| {
            Box::pin(async move {
                tokio::task::yield_now().await;
                engine
                    .call_dependency("executionContext", "current", Value::record([]))
                    .await
            })
        }));

        let inside = engine
            .call_dependency(
                "executionContext",
                "run",
                Value::record([
                    ("scope".to_owned(), Value::String("actor:one".to_owned())),
                    ("task".to_owned(), task),
                ]),
            )
            .await
            .expect("run");
        assert_eq!(
            inside.canonical_json().expect("json"),
            serde_json::json!(["actor:one"])
        );

        let outside = engine
            .call_dependency("executionContext", "current", Value::record([]))
            .await
            .expect("current");
        assert_eq!(
            outside.canonical_json().expect("json"),
            serde_json::json!([])
        );
    }
}
