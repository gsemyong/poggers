use async_nats::{
    Client,
    jetstream::{
        self,
        consumer::{AckPolicy, DeliverPolicy, pull},
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
use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};
use serde_json::{Value as JsonValue, json};

const PREFIX: &str = "kit.events";

pub struct Events {
    client: Client,
    context: jetstream::Context,
    stream: Stream,
}

pub async fn create(context: DependencyContext) -> NativeResult<Events> {
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
            "The existing JetStream stream does not match the events contract.",
        ));
    }
    Ok(Events {
        client,
        context: jetstream,
        stream,
    })
}

impl Dependency for Events {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
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
                    let limit = optional_integer(&input, "limit")?.unwrap_or(i64::MAX);
                    if limit < 1 {
                        return Err(NativeError::new(
                            "InvalidInput",
                            "EventStore read limit must be positive.",
                        ));
                    }
                    let events = read(&stream, stream_name, after, limit as usize).await?;
                    Ok(Value::from_json(&JsonValue::Array(events)))
                }
                "scan" => {
                    let limit = optional_integer(&input, "limit")?.unwrap_or(i64::MAX);
                    if limit < 1 {
                        return Err(NativeError::new(
                            "InvalidInput",
                            "EventStore scan limit must be positive.",
                        ));
                    }
                    let events =
                        scan(&stream, optional_cursor(&input, "after")?, limit as usize).await?;
                    Ok(Value::from_json(&JsonValue::Array(events)))
                }
                "append" => append(&context, &stream, &input).await.map(|events| {
                    events.map_or(Value::Undefined, |events| {
                        Value::from_json(&JsonValue::Array(events))
                    })
                }),
                "subscribe" => subscribe(client, stream, input).await,
                "subscribeAll" => subscribe_all(stream, input).await,
                "loadSnapshot" => load_snapshot(&stream, &input).await.map(|snapshot| {
                    snapshot.map_or(Value::Undefined, |snapshot| Value::from_json(&snapshot))
                }),
                "saveSnapshot" => save_snapshot(&context, &stream, &input)
                    .await
                    .map(Value::Boolean),
                "compact" => {
                    compact(&stream, &input).await?;
                    Ok(Value::Undefined)
                }
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

kit_server_runtime::dependency_operations!(Events {
    operation_read => "read",
    operation_scan => "scan",
    operation_append => "append",
    operation_subscribe => "subscribe",
    operation_subscribe_all => "subscribeAll",
    operation_load_snapshot => "loadSnapshot",
    operation_save_snapshot => "saveSnapshot",
    operation_compact => "compact",
});

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
    }
    .max(snapshot_revision(stream, stream_name).await?);
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

async fn load_snapshot(stream: &Stream, input: &JsonValue) -> NativeResult<Option<JsonValue>> {
    let stream_name = string(input, "stream")?;
    let subject = snapshot_subject(stream_name);
    match stream.get_last_raw_message_by_subject(&subject).await {
        Ok(message) => {
            let snapshot = decode(&message.payload)?;
            validate_snapshot(&snapshot, stream_name)?;
            Ok(Some(snapshot))
        }
        Err(error) if matches!(error.kind(), RawMessageErrorKind::NoMessageFound) => Ok(None),
        Err(error) => Err(failure(error)),
    }
}

async fn save_snapshot(
    context: &jetstream::Context,
    stream: &Stream,
    input: &JsonValue,
) -> NativeResult<bool> {
    let stream_name = string(input, "stream")?;
    let expected = integer(input, "expectedRevision")?;
    let revision = integer(input, "revision")?;
    let snapshot = input
        .get("snapshot")
        .ok_or_else(|| NativeError::new("InvalidInput", "snapshot is required."))?;
    let snapshot_topic = snapshot_subject(stream_name);
    let previous = match stream
        .get_last_raw_message_by_subject(&snapshot_topic)
        .await
    {
        Ok(message) => Some(message),
        Err(error) if matches!(error.kind(), RawMessageErrorKind::NoMessageFound) => None,
        Err(error) => return Err(failure(error)),
    };
    let current = match &previous {
        Some(message) => {
            let stored = decode(&message.payload)?;
            validate_snapshot(&stored, stream_name)?;
            integer(&stored, "revision")?
        }
        None => 0,
    };
    if current != expected {
        return Ok(false);
    }
    let event_subject = subject(stream_name);
    let event_revision = match stream.get_last_raw_message_by_subject(&event_subject).await {
        Ok(message) => batch_revision(&decode(&message.payload)?)?,
        Err(error) if matches!(error.kind(), RawMessageErrorKind::NoMessageFound) => 0,
        Err(error) => return Err(failure(error)),
    };
    if revision > event_revision.max(current) {
        return Ok(false);
    }
    let payload = serde_json::to_vec(&json!({
        "stream": stream_name,
        "revision": revision,
        "snapshot": snapshot,
    }))
    .map_err(failure)?;
    let message = PublishMessage::build()
        .payload(payload.into())
        .expected_last_subject_sequence(previous.as_ref().map_or(0, |message| message.sequence))
        .outbound_message(snapshot_topic.clone());
    let published = context.publish_message(message).await.map_err(failure)?;
    match published.await {
        Ok(_) => {
            stream
                .purge()
                .filter(snapshot_topic)
                .keep(1)
                .await
                .map_err(failure)?;
            Ok(true)
        }
        Err(error) if matches!(error.kind(), PublishErrorKind::WrongLastSequence) => Ok(false),
        Err(error) => Err(failure(error)),
    }
}

async fn compact(stream: &Stream, input: &JsonValue) -> NativeResult<()> {
    let stream_name = string(input, "stream")?;
    let through = integer(input, "through")?;
    if through == 0 {
        return Ok(());
    }
    if snapshot_revision(stream, stream_name).await? < through {
        return Err(NativeError::new(
            "UnsafeCompaction",
            format!("EventStore stream {stream_name:?} has no safe snapshot."),
        ));
    }
    let subject = subject(stream_name);
    let mut sequence = None;
    let mut purge_through = None;
    loop {
        let message = match stream.direct_get_next_for_subject(&subject, sequence).await {
            Ok(message) => message,
            Err(error) if matches!(error.kind(), DirectGetErrorKind::NotFound) => break,
            Err(error) => return Err(failure(error)),
        };
        sequence = Some(message.sequence.saturating_add(1));
        if batch_revision(&decode(&message.payload)?)? <= through {
            purge_through = Some(message.sequence);
        }
    }
    if let Some(sequence) = purge_through {
        stream
            .purge()
            .filter(subject)
            .sequence(sequence.saturating_add(1))
            .await
            .map_err(failure)?;
    }
    Ok(())
}

async fn snapshot_revision(stream: &Stream, name: &str) -> NativeResult<i64> {
    let subject = snapshot_subject(name);
    match stream.get_last_raw_message_by_subject(&subject).await {
        Ok(message) => {
            let snapshot = decode(&message.payload)?;
            validate_snapshot(&snapshot, name)?;
            integer(&snapshot, "revision")
        }
        Err(error) if matches!(error.kind(), RawMessageErrorKind::NoMessageFound) => Ok(0),
        Err(error) => Err(failure(error)),
    }
}

fn validate_snapshot(snapshot: &JsonValue, stream: &str) -> NativeResult<()> {
    if string(snapshot, "stream")? != stream || snapshot.get("snapshot").is_none() {
        return Err(NativeError::new(
            "InvalidEventStore",
            "Invalid JetStream snapshot.",
        ));
    }
    integer(snapshot, "revision")?;
    Ok(())
}

async fn read(
    stream: &Stream,
    name: &str,
    after: i64,
    limit: usize,
) -> NativeResult<Vec<JsonValue>> {
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
        if result.len() >= limit {
            result.truncate(limit);
            break;
        }
    }
    Ok(result)
}

async fn scan(
    stream: &Stream,
    after: Option<(u64, usize)>,
    limit: usize,
) -> NativeResult<Vec<JsonValue>> {
    let subject = format!("{PREFIX}.*");
    let mut sequence = after.map(|(sequence, _)| sequence);
    let mut result = Vec::new();
    loop {
        let message = match stream.direct_get_next_for_subject(&subject, sequence).await {
            Ok(message) => message,
            Err(error) if matches!(error.kind(), DirectGetErrorKind::NotFound) => break,
            Err(error) => return Err(failure(error)),
        };
        sequence = Some(message.sequence.saturating_add(1));
        let batch = decode(&message.payload)?;
        let stream_name = string(&batch, "stream")?;
        let expected = integer(&batch, "expectedRevision")?;
        let events = batch
            .get("events")
            .and_then(JsonValue::as_array)
            .ok_or_else(|| NativeError::new("InvalidEventStore", "Invalid event batch."))?;
        for (index, event) in events.iter().enumerate() {
            if after.is_some_and(|(cursor_sequence, cursor_index)| {
                message.sequence < cursor_sequence
                    || (message.sequence == cursor_sequence && index <= cursor_index)
            }) {
                continue;
            }
            result.push(json!({
                "cursor": format!("{}:{index}", message.sequence),
                "stream": stream_name,
                "revision": expected + index as i64 + 1,
                "event": event,
            }));
            if result.len() >= limit {
                return Ok(result);
            }
        }
    }
    Ok(result)
}

async fn subscribe(client: Client, stream: Stream, input: JsonValue) -> NativeResult<Value> {
    let name = string(&input, "stream")?.to_owned();
    let after = optional_integer(&input, "after")?.unwrap_or(0);
    let subject = subject(&name);
    let mut messages = client.subscribe(subject).await.map_err(failure)?;
    client.flush().await.map_err(failure)?;
    let initial = read(&stream, &name, after, usize::MAX).await?;
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

#[derive(Clone)]
struct StreamFilter {
    prefix: String,
    after: Option<(u64, usize)>,
}

async fn subscribe_all(stream: Stream, input: JsonValue) -> NativeResult<Value> {
    let filters = stream_filters(&input)?;
    let earliest = filters
        .iter()
        .filter_map(|filter| filter.after.map(|(sequence, _)| sequence))
        .min();
    let consumer = stream
        .create_consumer(pull::Config {
            deliver_policy: earliest.map_or(DeliverPolicy::All, |start_sequence| {
                DeliverPolicy::ByStartSequence { start_sequence }
            }),
            ack_policy: AckPolicy::None,
            filter_subject: format!("{PREFIX}.*"),
            ..Default::default()
        })
        .await
        .map_err(failure)?;
    let mut messages = consumer.messages().await.map_err(failure)?;
    Ok(Value::stream(Box::pin(async_stream::try_stream! {
        while let Some(message) = messages.next().await {
            let message = message.map_err(failure)?;
            let sequence = message.info().map_err(failure)?.stream_sequence;
            let batch = decode(&message.payload)?;
            let stream_name = string(&batch, "stream")?;
            let expected = integer(&batch, "expectedRevision")?;
            let events = batch
                .get("events")
                .and_then(JsonValue::as_array)
                .ok_or_else(|| NativeError::new("InvalidEventStore", "Invalid event batch."))?;
            for (index, event) in events.iter().enumerate() {
                if stream_filter_includes(stream_name, sequence, index, &filters) {
                    yield Value::from_json(&json!({
                        "cursor": format!("{sequence}:{index}"),
                        "stream": stream_name,
                        "revision": expected + index as i64 + 1,
                        "event": event,
                    }));
                }
            }
        }
    })))
}

fn stream_filters(input: &JsonValue) -> NativeResult<Vec<StreamFilter>> {
    input
        .get("streams")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| NativeError::new("InvalidInput", "streams must be an array."))?
        .iter()
        .map(|value| {
            Ok(StreamFilter {
                prefix: string(value, "prefix")?.to_owned(),
                after: optional_cursor(value, "after")?,
            })
        })
        .collect()
}

fn stream_filter_includes(
    stream: &str,
    sequence: u64,
    index: usize,
    filters: &[StreamFilter],
) -> bool {
    filters.iter().any(|filter| {
        if !stream.starts_with(&filter.prefix) {
            return false;
        }
        match filter.after {
            None => true,
            Some((after_sequence, after_index)) => {
                sequence > after_sequence || (sequence == after_sequence && index > after_index)
            }
        }
    })
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

fn snapshot_subject(stream: &str) -> String {
    format!("{PREFIX}.snapshot.{}", URL_SAFE_NO_PAD.encode(stream))
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

fn optional_cursor(value: &JsonValue, name: &str) -> NativeResult<Option<(u64, usize)>> {
    let Some(value) = value.get(name) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let cursor = value
        .as_str()
        .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be a cursor.")))?;
    let (sequence, index) = cursor
        .split_once(':')
        .ok_or_else(|| NativeError::new("InvalidInput", format!("{name} must be a cursor.")))?;
    let sequence = sequence
        .parse::<u64>()
        .map_err(|_| NativeError::new("InvalidInput", format!("{name} must be a cursor.")))?;
    let index = index
        .parse::<usize>()
        .map_err(|_| NativeError::new("InvalidInput", format!("{name} must be a cursor.")))?;
    if sequence == 0 || format!("{sequence}:{index}") != cursor {
        return Err(NativeError::new(
            "InvalidInput",
            format!("{name} must be a cursor."),
        ));
    }
    Ok(Some((sequence, index)))
}

fn failure(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("EventStoreFailure", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subjects_are_stable_and_safe_for_arbitrary_stream_names() {
        assert_eq!(subject("orders/one"), "kit.events.b3JkZXJzL29uZQ");
        assert_eq!(subject("orders one.*"), "kit.events.b3JkZXJzIG9uZS4q");
        assert_eq!(
            snapshot_subject("orders/one"),
            "kit.events.snapshot.b3JkZXJzL29uZQ"
        );
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
