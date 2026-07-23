use poggers_server_runtime::{
    Dependency, DependencyContext, Engine, NativeError, NativeFuture, NativeResult, Value,
};
use uuid::Uuid;

pub struct Identifiers;

pub async fn create(_context: DependencyContext) -> NativeResult<Identifiers> {
    Ok(Identifiers)
}

impl Dependency for Identifiers {
    fn call(&self, _engine: Engine, operation: &str, _input: Value) -> NativeFuture<Value> {
        let result = match operation {
            "create" => Ok(Value::String(Uuid::new_v4().to_string())),
            operation => Err(NativeError::new(
                "UnknownOperation",
                format!("Identifiers has no operation {operation:?}."),
            )),
        };
        Box::pin(async move { result })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, HashSet};

    use super::*;

    #[tokio::test]
    async fn creates_distinct_uuid_v4_identifiers() {
        let identifiers = create(DependencyContext {
            name: "identifiers".to_owned(),
            configuration: BTreeMap::new(),
            dependencies: BTreeMap::new(),
        })
        .await
        .expect("create identifiers");
        let mut values = HashSet::new();
        for _ in 0..32 {
            let value = identifiers
                .call(Engine::new(), "create", Value::Undefined)
                .await
                .expect("create identifier")
                .string()
                .expect("string");
            assert_eq!(Uuid::parse_str(&value).expect("UUID").get_version_num(), 4);
            assert!(values.insert(value));
        }
    }
}
