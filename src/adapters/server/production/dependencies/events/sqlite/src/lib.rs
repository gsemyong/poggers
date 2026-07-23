use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use kit_server_runtime::{
    Dependency, DependencyContext, Engine, NativeError, NativeFuture, NativeResult, Value,
};
use rusqlite::{Connection, params};
use serde_json::{Value as JsonValue, json};
use tokio::sync::broadcast;

pub struct Events {
    state: Arc<State>,
}

struct State {
    database: Mutex<Connection>,
    channels: Mutex<HashMap<String, broadcast::Sender<JsonValue>>>,
}

pub async fn create(context: DependencyContext) -> NativeResult<Events> {
    let path = context.configuration("database")?;
    if path != ":memory:"
        && let Some(parent) = Path::new(path).parent()
    {
        fs::create_dir_all(parent)
            .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
    }
    let database = Connection::open(path)
        .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
    database
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS kit_events (
               stream TEXT NOT NULL,
               revision INTEGER NOT NULL,
               event TEXT NOT NULL,
               PRIMARY KEY (stream, revision)
             ) STRICT;",
        )
        .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
    Ok(Events {
        state: Arc::new(State {
            database: Mutex::new(database),
            channels: Mutex::new(HashMap::new()),
        }),
    })
}

impl Dependency for Events {
    fn call(&self, _engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
        let state = self.state.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            let input = input.to_json()?;
            match operation.as_str() {
                "read" => {
                    let stream = string(&input, "stream")?;
                    let after = optional_integer(&input, "after")?.unwrap_or(0);
                    let events = read_events(&state, stream, after)?;
                    Ok(Value::from_json(&JsonValue::Array(events)))
                }
                "append" => append(&state, &input).map(|value| match value {
                    Some(events) => Value::from_json(&JsonValue::Array(events)),
                    None => Value::Undefined,
                }),
                "subscribe" => subscribe(state, input),
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("Events has no operation {operation:?}."),
                )),
            }
        })
    }
}

fn append(state: &State, input: &JsonValue) -> NativeResult<Option<Vec<JsonValue>>> {
    let stream = string(input, "stream")?;
    let expected = integer(input, "expectedRevision")?;
    let events = input
        .get("events")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| NativeError::new("InvalidInput", "events must be an array."))?;
    let mut database = lock(&state.database);
    let transaction = database
        .transaction()
        .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
    let current: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(revision), 0) FROM kit_events WHERE stream = ?1",
            params![stream],
            |row| row.get(0),
        )
        .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
    if current != expected {
        return Ok(None);
    }
    let mut stored = Vec::with_capacity(events.len());
    for (index, event) in events.iter().enumerate() {
        let revision = expected + index as i64 + 1;
        transaction
            .execute(
                "INSERT INTO kit_events (stream, revision, event) VALUES (?1, ?2, ?3)",
                params![stream, revision, event.to_string()],
            )
            .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
        stored.push(json!({ "stream": stream, "revision": revision, "event": event }));
    }
    transaction
        .commit()
        .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
    drop(database);
    if let Some(channel) = lock(&state.channels).get(stream).cloned() {
        for event in &stored {
            let _ = channel.send(event.clone());
        }
    }
    Ok(Some(stored))
}

fn subscribe(state: Arc<State>, input: JsonValue) -> NativeResult<Value> {
    let stream = string(&input, "stream")?.to_owned();
    let after = optional_integer(&input, "after")?.unwrap_or(0);
    let mut receiver = channel(&state, &stream).subscribe();
    let initial = read_events(&state, &stream, after)?;
    Ok(Value::stream(Box::pin(async_stream::try_stream! {
        let mut revision = after;
        for event in initial {
            revision = event.get("revision").and_then(JsonValue::as_i64).unwrap_or(revision);
            yield Value::from_json(&event);
        }
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    let next = event.get("revision").and_then(JsonValue::as_i64).unwrap_or(0);
                    if next > revision {
                        revision = next;
                        yield Value::from_json(&event);
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    for event in read_events(&state, &stream, revision)? {
                        revision = event.get("revision").and_then(JsonValue::as_i64).unwrap_or(revision);
                        yield Value::from_json(&event);
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    })))
}

fn read_events(state: &State, stream: &str, after: i64) -> NativeResult<Vec<JsonValue>> {
    let database = lock(&state.database);
    let mut statement = database
        .prepare(
            "SELECT revision, event FROM kit_events
             WHERE stream = ?1 AND revision > ?2 ORDER BY revision",
        )
        .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
    let rows = statement
        .query_map(params![stream, after], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
    rows.map(|row| {
        let (revision, event) =
            row.map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
        let event = serde_json::from_str::<JsonValue>(&event)
            .map_err(|error| NativeError::new("EventStoreFailure", error.to_string()))?;
        Ok(json!({ "stream": stream, "revision": revision, "event": event }))
    })
    .collect()
}

fn channel(state: &State, stream: &str) -> broadcast::Sender<JsonValue> {
    lock(&state.channels)
        .entry(stream.to_owned())
        .or_insert_with(|| broadcast::channel(256).0)
        .clone()
}

fn string<'a>(value: &'a JsonValue, name: &str) -> NativeResult<&'a str> {
    value
        .get(name)
        .and_then(JsonValue::as_str)
        .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be a string.")))
}

fn integer(value: &JsonValue, name: &str) -> NativeResult<i64> {
    value
        .get(name)
        .and_then(json_integer)
        .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be an integer.")))
}

fn optional_integer(value: &JsonValue, name: &str) -> NativeResult<Option<i64>> {
    match value.get(name) {
        None | Some(JsonValue::Null) => Ok(None),
        Some(value) => json_integer(value)
            .map(Some)
            .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be an integer."))),
    }
}

fn json_integer(value: &JsonValue) -> Option<i64> {
    value.as_i64().or_else(|| {
        let number = value.as_f64()?;
        (number.is_finite()
            && number.fract() == 0.0
            && number >= i64::MIN as f64
            && number <= i64::MAX as f64)
            .then_some(number as i64)
    })
}

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn context(database: &str) -> DependencyContext {
        DependencyContext {
            name: "events".to_owned(),
            configuration: BTreeMap::from([("database".to_owned(), database.to_owned())]),
            dependencies: BTreeMap::new(),
        }
    }

    fn value(value: JsonValue) -> Value {
        Value::from_json(&value)
    }

    async fn call(events: &Events, operation: &str, input: JsonValue) -> NativeResult<Value> {
        events.call(Engine::new(), operation, value(input)).await
    }

    #[tokio::test]
    async fn appends_compares_reads_and_subscribes_in_revision_order() {
        let events = create(context(":memory:")).await.expect("create events");
        let first = call(
            &events,
            "append",
            json!({ "stream": "order/1", "expectedRevision": 0, "events": [{ "type": "Created" }] }),
        )
        .await
        .expect("append first")
        .to_json()
        .expect("serialize first");
        assert_eq!(first[0]["revision"], 1);

        let conflict = call(
            &events,
            "append",
            json!({ "stream": "order/1", "expectedRevision": 0, "events": [{ "type": "Duplicate" }] }),
        )
        .await
        .expect("revision conflict");
        assert!(conflict.is_undefined());

        let stream = call(
            &events,
            "subscribe",
            json!({ "stream": "order/1", "after": 0 }),
        )
        .await
        .expect("subscribe");
        let engine = Engine::new();
        let replayed = engine
            .next(stream.clone())
            .await
            .expect("read replay")
            .expect("replayed event")
            .to_json()
            .expect("serialize replay");
        assert_eq!(replayed["event"]["type"], "Created");

        call(
            &events,
            "append",
            json!({ "stream": "order/1", "expectedRevision": 1, "events": [{ "type": "Renamed" }] }),
        )
        .await
        .expect("append second");
        let live = engine
            .next(stream)
            .await
            .expect("read live")
            .expect("live event")
            .to_json()
            .expect("serialize live");
        assert_eq!(live["revision"], 2);

        let read = call(&events, "read", json!({ "stream": "order/1", "after": 1 }))
            .await
            .expect("read")
            .to_json()
            .expect("serialize read");
        assert_eq!(read.as_array().expect("event array").len(), 1);
        assert_eq!(read[0]["event"]["type"], "Renamed");
    }

    #[tokio::test]
    async fn persists_events_across_adapter_restarts() {
        let path = std::env::temp_dir().join(format!(
            "kit-events-{}-{}.sqlite",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let path_text = path.to_string_lossy();
        {
            let events = create(context(&path_text)).await.expect("create events");
            call(
                &events,
                "append",
                json!({ "stream": "order/2", "expectedRevision": 0, "events": [42] }),
            )
            .await
            .expect("append");
        }
        let restarted = create(context(&path_text)).await.expect("reopen events");
        let read = call(&restarted, "read", json!({ "stream": "order/2" }))
            .await
            .expect("read after restart")
            .to_json()
            .expect("serialize read");
        assert_eq!(read[0]["event"], 42);
        drop(restarted);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    }
}
