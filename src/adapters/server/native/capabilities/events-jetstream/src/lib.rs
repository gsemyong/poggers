use async_nats::{
    Client,
    jetstream::{
        self,
        context::{PublishErrorKind, traits::Publisher},
        message::PublishMessage,
        stream::{
            DirectGetErrorKind, DiscardPolicy, RawMessageErrorKind, RetentionPolicy, StorageType,
            Stream,
        },
    },
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use poggers_native_runtime::{
    Capability, CapabilityContext, Engine, NativeError, NativeFuture, NativeResult, Value,
};
use serde_json::{Value as JsonValue, json};

const PREFIX: &str = "poggers.events";

pub struct Events {
    client: Client,
    context: jetstream::Context,
    stream: Stream,
}

pub async fn create(context: CapabilityContext) -> NativeResult<Events> {
    let client = async_nats::connect(context.configuration("servers")?)
        .await
        .map_err(failure)?;
    let jetstream = jetstream::new(client.clone());
    let stream = jetstream
        .get_or_create_stream(jetstream::stream::Config {
            name: context.configuration("stream")?.to_owned(),
            subjects: vec![format!("{PREFIX}.>")],
            retention: RetentionPolicy::Limits,
            discard: DiscardPolicy::Old,
            storage: StorageType::File,
            allow_direct: true,
            ..Default::default()
        })
        .await
        .map_err(failure)?;
    let configuration = &stream.cached_info().config;
    if !configuration
        .subjects
        .iter()
        .any(|value| value == &format!("{PREFIX}.>"))
        || configuration.retention != RetentionPolicy::Limits
        || configuration.discard != DiscardPolicy::Old
        || configuration.storage != StorageType::File
        || !configuration.allow_direct
    {
        return Err(NativeError::new(
            "InvalidEventStore",
            "The existing JetStream stream is incompatible with the events contract.",
        ));
    }
    Ok(Events {
        client,
        context: jetstream,
        stream,
    })
}

impl Capability for Events {
    fn call(&self, _engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
        let client = self.client.clone();
        let context = self.context.clone();
        let stream = self.stream.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            let input = input.to_json()?;
            match operation.as_str() {
                "read" => {
                    let stream_name = string(&input, "stream")?;
                    let after = optional_integer(&input, "after")?.unwrap_or(0);
                    let events = read(&stream, stream_name, after).await?;
                    Ok(Value::from_json(&JsonValue::Array(events)))
                }
                "append" => append(&context, &stream, &input).await.map(|events| {
                    events.map_or(Value::Undefined, |events| {
                        Value::from_json(&JsonValue::Array(events))
                    })
                }),
                "subscribe" => subscribe(client, stream, input).await,
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("Events has no operation {operation:?}."),
                )),
            }
        })
    }

    fn shutdown(&self) -> NativeFuture<()> {
        let client = self.client.clone();
        Box::pin(async move {
            client.drain().await.map_err(failure)?;
            Ok(())
        })
    }
}

async fn append(
    context: &jetstream::Context,
    stream: &Stream,
    input: &JsonValue,
) -> NativeResult<Option<Vec<JsonValue>>> {
    let stream_name = string(input, "stream")?;
    let expected = integer(input, "expectedRevision")?;
    let events = input
        .get("events")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| NativeError::new("InvalidInput", "events must be an array."))?;
    if events.is_empty() {
        return Ok(Some(Vec::new()));
    }
    let subject = subject(stream_name);
    let last = match stream.get_last_raw_message_by_subject(&subject).await {
        Ok(message) => Some(message),
        Err(error) if matches!(error.kind(), RawMessageErrorKind::NoMessageFound) => None,
        Err(error) => return Err(failure(error)),
    };
    let current = match &last {
        Some(message) => batch_revision(&decode(&message.payload)?)?,
        None => 0,
    };
    if current != expected {
        return Ok(None);
    }
    let payload = serde_json::to_vec(&json!({
        "stream": stream_name,
        "expectedRevision": expected,
        "events": events,
    }))
    .map_err(failure)?;
    let message = PublishMessage::build()
        .payload(payload.into())
        .expected_last_subject_sequence(last.as_ref().map_or(0, |message| message.sequence))
        .outbound_message(subject);
    let published = context.publish_message(message).await.map_err(failure)?;
    match published.await {
        Ok(_) => Ok(Some(stored(stream_name, expected, events))),
        Err(error) if matches!(error.kind(), PublishErrorKind::WrongLastSequence) => Ok(None),
        Err(error) => Err(failure(error)),
    }
}

async fn read(stream: &Stream, name: &str, after: i64) -> NativeResult<Vec<JsonValue>> {
    let subject = subject(name);
    let mut sequence = None;
    let mut result = Vec::new();
    loop {
        let message = match stream.direct_get_next_for_subject(&subject, sequence).await {
            Ok(message) => message,
            Err(error) if matches!(error.kind(), DirectGetErrorKind::NotFound) => break,
            Err(error) => return Err(failure(error)),
        };
        sequence = Some(message.sequence.saturating_add(1));
        append_batch(&mut result, &decode(&message.payload)?, name, after)?;
    }
    Ok(result)
}

async fn subscribe(client: Client, stream: Stream, input: JsonValue) -> NativeResult<Value> {
    let name = string(&input, "stream")?.to_owned();
    let after = optional_integer(&input, "after")?.unwrap_or(0);
    let subject = subject(&name);
    let mut messages = client.subscribe(subject).await.map_err(failure)?;
    client.flush().await.map_err(failure)?;
    let initial = read(&stream, &name, after).await?;
    Ok(Value::stream(Box::pin(async_stream::try_stream! {
        let mut revision = after;
        for event in initial {
            revision = event["revision"].as_i64().unwrap_or(revision);
            yield Value::from_json(&event);
        }
        while let Some(message) = messages.next().await {
            let batch = decode(&message.payload)?;
            let mut events = Vec::new();
            append_batch(&mut events, &batch, &name, revision)?;
            for event in events {
                let next = event["revision"].as_i64().unwrap_or(0);
                if next != revision + 1 {
                    Err(NativeError::new(
                        "EventStoreGap",
                        format!("Expected {} at {name:?}, received {next}.", revision + 1),
                    ))?;
                }
                revision = next;
                yield Value::from_json(&event);
            }
        }
    })))
}

fn decode(payload: &[u8]) -> NativeResult<JsonValue> {
    serde_json::from_slice(payload).map_err(failure)
}

fn append_batch(
    target: &mut Vec<JsonValue>,
    batch: &JsonValue,
    stream: &str,
    after: i64,
) -> NativeResult<()> {
    if string(batch, "stream")? != stream {
        return Err(NativeError::new(
            "InvalidEventStore",
            "JetStream event batch has a mismatched stream.",
        ));
    }
    let expected = integer(batch, "expectedRevision")?;
    let events = batch
        .get("events")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| NativeError::new("InvalidEventStore", "Invalid JetStream event batch."))?;
    target.extend(
        stored(stream, expected, events)
            .into_iter()
            .filter(|event| {
                event["revision"]
                    .as_i64()
                    .is_some_and(|value| value > after)
            }),
    );
    Ok(())
}

fn stored(stream: &str, expected: i64, events: &[JsonValue]) -> Vec<JsonValue> {
    events
        .iter()
        .enumerate()
        .map(|(index, event)| {
            json!({
                "stream": stream,
                "revision": expected + index as i64 + 1,
                "event": event,
            })
        })
        .collect()
}

fn batch_revision(batch: &JsonValue) -> NativeResult<i64> {
    Ok(integer(batch, "expectedRevision")?
        + batch
            .get("events")
            .and_then(JsonValue::as_array)
            .ok_or_else(|| NativeError::new("InvalidEventStore", "Invalid JetStream event batch."))?
            .len() as i64)
}

fn subject(stream: &str) -> String {
    format!("{PREFIX}.{}", URL_SAFE_NO_PAD.encode(stream))
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
        .and_then(JsonValue::as_i64)
        .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be an integer.")))
}

fn optional_integer(value: &JsonValue, name: &str) -> NativeResult<Option<i64>> {
    match value.get(name) {
        None | Some(JsonValue::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be an integer."))),
    }
}

fn failure(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("EventStoreFailure", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subjects_are_stable_and_safe_for_arbitrary_stream_names() {
        assert_eq!(subject("orders/one"), "poggers.events.b3JkZXJzL29uZQ");
        assert_eq!(subject("orders one.*"), "poggers.events.b3JkZXJzIG9uZS4q");
    }

    #[test]
    fn stored_events_have_contiguous_logical_revisions() {
        assert_eq!(
            stored(
                "orders/one",
                4,
                &[json!({ "value": "a" }), json!({ "value": "b" })]
            ),
            vec![
                json!({ "stream": "orders/one", "revision": 5, "event": { "value": "a" } }),
                json!({ "stream": "orders/one", "revision": 6, "event": { "value": "b" } }),
            ]
        );
    }

    #[test]
    fn batches_filter_by_logical_revision() {
        let batch = json!({
            "stream": "orders/one",
            "expectedRevision": 3,
            "events": [{ "value": "a" }, { "value": "b" }],
        });
        let mut result = Vec::new();

        append_batch(&mut result, &batch, "orders/one", 4).expect("valid batch");

        assert_eq!(
            result,
            vec![json!({
                "stream": "orders/one",
                "revision": 5,
                "event": { "value": "b" },
            })]
        );
        assert_eq!(batch_revision(&batch).expect("valid revision"), 5);
    }

    #[test]
    fn mismatched_streams_are_rejected() {
        let mut result = Vec::new();
        let error = append_batch(
            &mut result,
            &json!({
                "stream": "orders/two",
                "expectedRevision": 0,
                "events": [],
            }),
            "orders/one",
            0,
        )
        .expect_err("mismatched stream");

        assert_eq!(error.name, "InvalidEventStore");
    }
}
