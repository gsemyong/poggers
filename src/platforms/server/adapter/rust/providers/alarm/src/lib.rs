use std::{
    collections::BTreeMap,
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use async_nats::{
    HeaderMap,
    header::{NATS_SCHEDULE, NATS_SCHEDULE_TARGET},
    jetstream::{
        self, AckKind,
        consumer::{AckPolicy, PullConsumer, pull},
        kv::{CreateErrorKind, Store, UpdateErrorKind},
        stream::{DiscardPolicy, RetentionPolicy, StorageType, Stream},
    },
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::{StreamExt, stream::FuturesUnordered};
use kit_server_runtime::{
    Dependency, DependencyCancellation, DependencyContext, DependencyInvocation, Engine,
    NativeError, NativeFuture, NativeResult, Record, Value,
};
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::{sync::Notify, task::JoinHandle};

const DISPATCH_BATCH_SIZE: usize = 256;
const RETRY_DELAY: Duration = Duration::from_millis(25);
const ACK_WAIT: Duration = Duration::from_secs(30);
const SCHEDULE_SUBJECT_PREFIX: &str = "kit.alarm.schedule";
const DELIVERY_SUBJECT: &str = "kit.alarm.delivery";
const CONSUMER: &str = "kit-alarm-workers";

#[derive(Clone)]
struct ScheduledTarget {
    generation: u64,
    scheduled_at: f64,
    next_attempt_at: f64,
    attempt: u64,
    dependency: String,
    operation: String,
    input: Value,
    cancellation: DependencyCancellation,
    abort: DependencyCancellation,
}

#[derive(Default)]
struct LocalState {
    generation: u64,
    stopping: bool,
    scheduled: BTreeMap<String, ScheduledTarget>,
    active: BTreeMap<String, (u64, DependencyCancellation, DependencyCancellation)>,
}

struct LocalAlarm {
    state: Arc<Mutex<LocalState>>,
    notify: Arc<Notify>,
    worker: Arc<Mutex<Option<JoinHandle<()>>>>,
}

#[derive(Clone)]
struct SharedAlarm {
    context: jetstream::Context,
    stream: Stream,
    state: Store,
    consumer: PullConsumer,
    stopping: Arc<AtomicBool>,
    worker: Arc<Mutex<Option<JoinHandle<()>>>>,
    active: Arc<Mutex<BTreeMap<String, (u64, DependencyCancellation)>>>,
}

enum AlarmMode {
    Local(LocalAlarm),
    Shared(Box<SharedAlarm>),
}

pub struct Alarm {
    mode: AlarmMode,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DurableAlarm {
    id: String,
    generation: u64,
    status: DurableAlarmStatus,
    scheduled_at: f64,
    dependency: String,
    operation: String,
    input: serde_json::Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum DurableAlarmStatus {
    Scheduled,
    CancellationRequested,
    Cancelled,
    Delivered,
}

struct AlarmInput {
    id: String,
    at: f64,
    dependency: String,
    operation: String,
    input: Value,
}

pub async fn create(context: DependencyContext) -> NativeResult<Alarm> {
    let servers = context
        .configuration
        .get("servers")
        .map(String::as_str)
        .unwrap_or_default();
    if servers.is_empty() {
        return Ok(Alarm {
            mode: AlarmMode::Local(LocalAlarm {
                state: Arc::new(Mutex::new(LocalState::default())),
                notify: Arc::new(Notify::new()),
                worker: Arc::new(Mutex::new(None)),
            }),
        });
    }
    let stream = configuration(&context, "stream", "KIT_ALARMS");
    let state = configuration(&context, "state", "KIT_ALARM_STATE");
    let replicas = configuration(&context, "replicas", "1")
        .parse::<usize>()
        .map_err(|_| invalid("Alarm replicas must be a positive integer."))?;
    if replicas == 0 {
        return Err(invalid("Alarm replicas must be a positive integer."));
    }
    let client = async_nats::connect(servers).await.map_err(failure)?;
    let jetstream = jetstream::new(client);
    let schedule_stream = jetstream
        .get_or_create_stream(jetstream::stream::Config {
            name: stream.to_owned(),
            subjects: vec![
                format!("{SCHEDULE_SUBJECT_PREFIX}.>"),
                DELIVERY_SUBJECT.to_owned(),
            ],
            retention: RetentionPolicy::WorkQueue,
            discard: DiscardPolicy::Old,
            storage: StorageType::File,
            num_replicas: replicas,
            allow_rollup: true,
            allow_message_schedules: true,
            ..Default::default()
        })
        .await
        .map_err(failure)?;
    let configuration = &schedule_stream.cached_info().config;
    if !configuration
        .subjects
        .iter()
        .any(|subject| subject == &format!("{SCHEDULE_SUBJECT_PREFIX}.>"))
        || !configuration
            .subjects
            .iter()
            .any(|subject| subject == DELIVERY_SUBJECT)
        || configuration.retention != RetentionPolicy::WorkQueue
        || configuration.discard != DiscardPolicy::Old
        || configuration.storage != StorageType::File
        || configuration.num_replicas != replicas
        || !configuration.allow_message_schedules
    {
        return Err(invalid(
            "The existing JetStream stream does not match the Alarm contract.",
        ));
    }
    let state = get_or_create_state(&jetstream, state, replicas).await?;
    let consumer: PullConsumer = schedule_stream
        .get_or_create_consumer(
            CONSUMER,
            pull::Config {
                durable_name: Some(CONSUMER.to_owned()),
                ack_policy: AckPolicy::Explicit,
                ack_wait: ACK_WAIT,
                filter_subject: DELIVERY_SUBJECT.to_owned(),
                max_ack_pending: DISPATCH_BATCH_SIZE as i64,
                ..Default::default()
            },
        )
        .await
        .map_err(failure)?;
    let consumer_configuration = &consumer.cached_info().config;
    if consumer_configuration.durable_name.as_deref() != Some(CONSUMER)
        || consumer_configuration.ack_policy != AckPolicy::Explicit
        || consumer_configuration.filter_subject != DELIVERY_SUBJECT
    {
        return Err(invalid(
            "The existing JetStream consumer does not match the Alarm contract.",
        ));
    }
    Ok(Alarm {
        mode: AlarmMode::Shared(Box::new(SharedAlarm {
            context: jetstream,
            stream: schedule_stream,
            state,
            consumer,
            stopping: Arc::new(AtomicBool::new(false)),
            worker: Arc::new(Mutex::new(None)),
            active: Arc::new(Mutex::new(BTreeMap::new())),
        })),
    })
}

impl Dependency for Alarm {
    fn start(&self, engine: Engine) -> NativeFuture<()> {
        match &self.mode {
            AlarmMode::Local(_) => Box::pin(async { Ok(()) }),
            AlarmMode::Shared(shared) => {
                shared.start(engine);
                Box::pin(async { Ok(()) })
            }
        }
    }

    fn call(
        &self,
        engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let operation = operation.to_owned();
        match &self.mode {
            AlarmMode::Local(local) => {
                let state = local.state.clone();
                let notify = local.notify.clone();
                let worker = local.worker.clone();
                Box::pin(async move {
                    let input = input.as_record()?;
                    let id = required_string(&input, "id")?;
                    match operation.as_str() {
                        "schedule" => {
                            let target = parse_alarm(&input, id)?;
                            schedule_local(engine, state, notify.clone(), worker, target)?;
                            notify.notify_one();
                            Ok(Value::Undefined)
                        }
                        "cancel" => {
                            let mut state = lock(&state);
                            state.generation += 1;
                            if let Some((_, cancellation, abort)) = state.active.get(&id) {
                                cancellation.request();
                                abort.request();
                            }
                            if let Some(target) = state.scheduled.remove(&id) {
                                target.cancellation.request();
                                target.abort.request();
                            }
                            drop(state);
                            notify.notify_one();
                            Ok(Value::Undefined)
                        }
                        "requestCancellation" => {
                            let state = lock(&state);
                            if let Some((_, cancellation, _)) = state.active.get(&id) {
                                cancellation.request();
                            }
                            if let Some(target) = state.scheduled.get(&id) {
                                target.cancellation.request();
                            }
                            Ok(Value::Undefined)
                        }
                        operation => Err(unknown(operation)),
                    }
                })
            }
            AlarmMode::Shared(shared) => {
                let shared = shared.clone();
                Box::pin(async move {
                    shared.start(engine);
                    let input = input.as_record()?;
                    let id = required_string(&input, "id")?;
                    match operation.as_str() {
                        "schedule" => {
                            let target = parse_alarm(&input, id)?;
                            shared.schedule(target).await?;
                            Ok(Value::Undefined)
                        }
                        "cancel" => {
                            shared.cancel(id).await?;
                            Ok(Value::Undefined)
                        }
                        "requestCancellation" => {
                            shared.request_cancellation(id).await?;
                            Ok(Value::Undefined)
                        }
                        operation => Err(unknown(operation)),
                    }
                })
            }
        }
    }

    fn shutdown(&self) -> NativeFuture<()> {
        match &self.mode {
            AlarmMode::Local(local) => {
                let state = local.state.clone();
                let notify = local.notify.clone();
                let worker = local.worker.clone();
                Box::pin(async move {
                    {
                        let mut current = lock(&state);
                        current.stopping = true;
                        for target in current.scheduled.values() {
                            target.cancellation.request();
                            target.abort.request();
                        }
                        for (_, cancellation, abort) in current.active.values() {
                            cancellation.request();
                            abort.request();
                        }
                    }
                    notify.notify_waiters();
                    let task = lock(&worker).take();
                    if let Some(task) = task {
                        let _ = task.await;
                    }
                    lock(&state).scheduled.clear();
                    lock(&state).active.clear();
                    Ok(())
                })
            }
            AlarmMode::Shared(shared) => {
                let shared = shared.clone();
                Box::pin(async move {
                    shared.stopping.store(true, Ordering::Release);
                    for (_, cancellation) in lock(&shared.active).values() {
                        cancellation.request();
                    }
                    let task = lock(&shared.worker).take();
                    if let Some(task) = task {
                        task.abort();
                        let _ = task.await;
                    }
                    Ok(())
                })
            }
        }
    }
}

kit_server_runtime::dependency_operations!(Alarm {
    operation_schedule => "schedule",
    operation_cancel => "cancel",
    operation_request_cancellation => "requestCancellation",
});

impl SharedAlarm {
    fn start(&self, engine: Engine) {
        if self.stopping.load(Ordering::Acquire) {
            return;
        }
        let mut worker = lock(&self.worker);
        if worker.is_none() {
            let shared = self.clone();
            *worker = Some(tokio::spawn(async move {
                shared.run(engine).await;
            }));
        }
    }

    async fn schedule(&self, target: AlarmInput) -> NativeResult<()> {
        let key = alarm_key(&target.id);
        let input = target.input.canonical_json()?;
        replace_state(&self.state, &key, |previous| DurableAlarm {
            id: target.id.clone(),
            generation: previous.map_or(1, |state| state.generation.saturating_add(1)),
            status: DurableAlarmStatus::Scheduled,
            scheduled_at: target.at,
            dependency: target.dependency.clone(),
            operation: target.operation.clone(),
            input: input.clone(),
        })
        .await?;
        self.reconcile(&key).await
    }

    async fn cancel(&self, id: String) -> NativeResult<()> {
        if let Some((_, cancellation)) = lock(&self.active).get(&id) {
            cancellation.request();
        }
        let key = alarm_key(&id);
        replace_state(&self.state, &key, |previous| DurableAlarm {
            id: id.clone(),
            generation: previous.map_or(1, |state| state.generation.saturating_add(1)),
            status: DurableAlarmStatus::Cancelled,
            scheduled_at: 0.0,
            dependency: String::new(),
            operation: String::new(),
            input: serde_json::Value::Null,
        })
        .await?;
        self.reconcile(&key).await
    }

    async fn request_cancellation(&self, id: String) -> NativeResult<()> {
        if let Some((_, cancellation)) = lock(&self.active).get(&id) {
            cancellation.request();
        }
        let key = alarm_key(&id);
        for _ in 0..128 {
            let Some(entry) = self.state.entry(&key).await.map_err(failure)? else {
                return Ok(());
            };
            let mut state = decode_state(&entry.value)?;
            if state.status != DurableAlarmStatus::Scheduled {
                return Ok(());
            }
            state.status = DurableAlarmStatus::CancellationRequested;
            let payload = serde_json::to_vec(&state).map_err(failure)?;
            match self
                .state
                .update(&key, payload.into(), entry.revision)
                .await
            {
                Ok(_) => return self.reconcile(&key).await,
                Err(error) if error.kind() == UpdateErrorKind::WrongLastRevision => continue,
                Err(error) => return Err(failure(error)),
            }
        }
        Err(conflict("Alarm cancellation request remained contended."))
    }

    async fn reconcile(&self, key: &str) -> NativeResult<()> {
        for _ in 0..128 {
            let Some(entry) = self.state.entry(key).await.map_err(failure)? else {
                return Ok(());
            };
            let state = decode_state(&entry.value)?;
            match state.status {
                DurableAlarmStatus::Scheduled | DurableAlarmStatus::CancellationRequested => {
                    let mut headers = HeaderMap::new();
                    headers.insert(NATS_SCHEDULE, schedule_at(state.scheduled_at)?);
                    headers.insert(NATS_SCHEDULE_TARGET, DELIVERY_SUBJECT);
                    let payload = serde_json::to_vec(&state).map_err(failure)?;
                    self.context
                        .publish_with_headers(schedule_subject(key), headers, payload.into())
                        .await
                        .map_err(failure)?
                        .await
                        .map_err(failure)?;
                }
                DurableAlarmStatus::Cancelled | DurableAlarmStatus::Delivered => {
                    self.stream
                        .purge()
                        .filter(schedule_subject(key))
                        .await
                        .map_err(failure)?;
                }
            }
            if self
                .state
                .entry(key)
                .await
                .map_err(failure)?
                .is_some_and(|current| current.revision == entry.revision)
            {
                return Ok(());
            }
        }
        Err(conflict(
            "Alarm state changed continuously while reconciling.",
        ))
    }

    async fn run(self, engine: Engine) {
        let mut deliveries =
            FuturesUnordered::<Pin<Box<dyn Future<Output = ()> + Send + 'static>>>::new();
        while !self.stopping.load(Ordering::Acquire) {
            let mut messages = match self.consumer.messages().await {
                Ok(messages) => messages,
                Err(_) => {
                    tokio::time::sleep(RETRY_DELAY).await;
                    continue;
                }
            };
            loop {
                if self.stopping.load(Ordering::Acquire) {
                    return;
                }
                if deliveries.len() >= DISPATCH_BATCH_SIZE {
                    let _ = deliveries.next().await;
                    continue;
                }
                if deliveries.is_empty() {
                    let Some(message) = messages.next().await else {
                        break;
                    };
                    match message {
                        Ok(message) => {
                            let shared = self.clone();
                            let delivery_engine = engine.clone();
                            deliveries.push(Box::pin(async move {
                                shared.deliver(&delivery_engine, message).await;
                            }));
                        }
                        Err(_) => break,
                    }
                    continue;
                }
                tokio::select! {
                    _ = deliveries.next() => {}
                    message = messages.next() => {
                        let Some(message) = message else {
                            break;
                        };
                        match message {
                            Ok(message) => {
                                let shared = self.clone();
                                let delivery_engine = engine.clone();
                                deliveries.push(Box::pin(async move {
                                    shared.deliver(&delivery_engine, message).await;
                                }));
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        }
    }

    async fn deliver(&self, engine: &Engine, message: jetstream::Message) {
        let scheduled = match serde_json::from_slice::<DurableAlarm>(&message.payload) {
            Ok(scheduled) => scheduled,
            Err(_) => {
                let _ = message.ack_with(AckKind::Term).await;
                return;
            }
        };
        let key = alarm_key(&scheduled.id);
        let current = match self.state.entry(&key).await {
            Ok(Some(entry)) => decode_state(&entry.value).ok(),
            Ok(None) | Err(_) => None,
        };
        if current.as_ref().is_none_or(|current| {
            (current.status != DurableAlarmStatus::Scheduled
                && current.status != DurableAlarmStatus::CancellationRequested)
                || current.generation != scheduled.generation
        }) {
            let _ = message.double_ack().await;
            return;
        }
        let attempt = message
            .info()
            .map(|info| info.delivered.max(1) as u64)
            .unwrap_or(1);
        let cancellation = DependencyCancellation::default();
        let occupied = {
            let mut active = lock(&self.active);
            if active.contains_key(&scheduled.id) {
                true
            } else {
                active.insert(
                    scheduled.id.clone(),
                    (scheduled.generation, cancellation.clone()),
                );
                false
            }
        };
        if occupied {
            let _ = message.ack_with(AckKind::Nak(Some(RETRY_DELAY))).await;
            return;
        }
        let mut invocation = DependencyInvocation::new(
            format!("alarm:{}:{}", scheduled.id, scheduled.generation),
            attempt,
            scheduled.scheduled_at,
            now_millis(),
            None,
        );
        invocation.cancellation = cancellation.clone();
        if current
            .as_ref()
            .is_some_and(|current| current.status == DurableAlarmStatus::CancellationRequested)
        {
            cancellation.request();
        }
        let call = engine.call_dependency_with_invocation(
            &scheduled.dependency,
            &scheduled.operation,
            match Value::from_canonical_json(&scheduled.input) {
                value @ Value::Record(_) => value,
                _ => {
                    let _ = message.ack_with(AckKind::Term).await;
                    return;
                }
            },
            invocation,
        );
        tokio::pin!(call);
        let mut cancelled = false;
        let result = loop {
            tokio::select! {
                result = &mut call => break result,
                _ = tokio::time::sleep(ACK_WAIT / 2) => {
                    let _ = message.ack_with(AckKind::Progress).await;
                }
                _ = tokio::time::sleep(RETRY_DELAY) => {
                    let current = self.state.entry(&key).await.ok().flatten()
                        .and_then(|entry| decode_state(&entry.value).ok());
                    if current.as_ref().is_some_and(|current| {
                        current.status == DurableAlarmStatus::CancellationRequested
                            && current.generation == scheduled.generation
                    }) {
                        cancellation.request();
                    } else if current.as_ref().is_none_or(|current| {
                        current.status != DurableAlarmStatus::Scheduled
                            || current.generation != scheduled.generation
                    }) {
                        cancellation.request();
                        cancelled = true;
                        break Err(NativeError::new("AlarmCancelled", "Alarm delivery was cancelled."));
                    }
                }
            }
        };
        {
            let mut active = lock(&self.active);
            if active
                .get(&scheduled.id)
                .is_some_and(|(generation, _)| *generation == scheduled.generation)
            {
                active.remove(&scheduled.id);
            }
        }
        if cancelled {
            let _ = message.double_ack().await;
            return;
        }
        if result.is_err() {
            let _ = message.ack_with(AckKind::Nak(Some(RETRY_DELAY))).await;
            return;
        }
        match complete_state(&self.state, &key, scheduled.generation).await {
            Ok(true) => {
                let _ = self.reconcile(&key).await;
                let _ = message.double_ack().await;
            }
            Ok(false) => {
                let _ = message.double_ack().await;
            }
            Err(_) => {
                let _ = message.ack_with(AckKind::Nak(Some(RETRY_DELAY))).await;
            }
        }
    }
}

async fn get_or_create_state(
    context: &jetstream::Context,
    bucket: &str,
    replicas: usize,
) -> NativeResult<Store> {
    if let Ok(state) = context.get_key_value(bucket).await {
        return Ok(state);
    }
    match context
        .create_key_value(jetstream::kv::Config {
            bucket: bucket.to_owned(),
            history: 1,
            storage: StorageType::File,
            num_replicas: replicas,
            ..Default::default()
        })
        .await
    {
        Ok(state) => Ok(state),
        Err(_) => context.get_key_value(bucket).await.map_err(failure),
    }
}

async fn replace_state(
    store: &Store,
    key: &str,
    create: impl Fn(Option<&DurableAlarm>) -> DurableAlarm,
) -> NativeResult<(DurableAlarm, u64)> {
    for _ in 0..128 {
        let previous = store.entry(key).await.map_err(failure)?;
        let decoded = previous
            .as_ref()
            .map(|entry| decode_state(&entry.value))
            .transpose()?;
        let next = create(decoded.as_ref());
        let payload = serde_json::to_vec(&next).map_err(failure)?;
        let revision = match previous {
            Some(previous) => match store.update(key, payload.into(), previous.revision).await {
                Ok(revision) => revision,
                Err(error) if error.kind() == UpdateErrorKind::WrongLastRevision => continue,
                Err(error) => return Err(failure(error)),
            },
            None => match store.create(key, payload.into()).await {
                Ok(revision) => revision,
                Err(error) if error.kind() == CreateErrorKind::AlreadyExists => continue,
                Err(error) => return Err(failure(error)),
            },
        };
        return Ok((next, revision));
    }
    Err(conflict("Alarm state remained contended."))
}

async fn complete_state(store: &Store, key: &str, generation: u64) -> NativeResult<bool> {
    for _ in 0..128 {
        let Some(entry) = store.entry(key).await.map_err(failure)? else {
            return Ok(false);
        };
        let mut state = decode_state(&entry.value)?;
        if (state.status != DurableAlarmStatus::Scheduled
            && state.status != DurableAlarmStatus::CancellationRequested)
            || state.generation != generation
        {
            return Ok(false);
        }
        state.status = DurableAlarmStatus::Delivered;
        let payload = serde_json::to_vec(&state).map_err(failure)?;
        match store.update(key, payload.into(), entry.revision).await {
            Ok(_) => return Ok(true),
            Err(error) if error.kind() == UpdateErrorKind::WrongLastRevision => continue,
            Err(error) => return Err(failure(error)),
        }
    }
    Err(conflict("Alarm completion remained contended."))
}

fn schedule_local(
    engine: Engine,
    state: Arc<Mutex<LocalState>>,
    notify: Arc<Notify>,
    worker: Arc<Mutex<Option<JoinHandle<()>>>>,
    target: AlarmInput,
) -> NativeResult<()> {
    {
        let mut state = lock(&state);
        if state.stopping {
            return Err(NativeError::new("AlarmStopping", "Alarm is shutting down."));
        }
        state.generation += 1;
        let generation = state.generation;
        state.scheduled.insert(
            target.id,
            ScheduledTarget {
                generation,
                scheduled_at: target.at,
                next_attempt_at: target.at,
                attempt: 1,
                dependency: target.dependency,
                operation: target.operation,
                input: target.input,
                cancellation: DependencyCancellation::default(),
                abort: DependencyCancellation::default(),
            },
        );
    }
    let mut slot = lock(&worker);
    if slot.is_none() {
        *slot = Some(tokio::spawn(run_local(engine, state, notify)));
    }
    Ok(())
}

async fn run_local(engine: Engine, state: Arc<Mutex<LocalState>>, notify: Arc<Notify>) {
    let mut deliveries =
        FuturesUnordered::<Pin<Box<dyn Future<Output = ()> + Send + 'static>>>::new();
    loop {
        let now = now_millis();
        let (stopping, due, next_attempt_at) = {
            let state = lock(&state);
            let mut due = state
                .scheduled
                .iter()
                .filter(|(id, target)| {
                    target.next_attempt_at <= now && !state.active.contains_key(*id)
                })
                .map(|(id, target)| (id.clone(), target.clone()))
                .collect::<Vec<_>>();
            due.sort_by(|(left_id, left), (right_id, right)| {
                left.next_attempt_at
                    .total_cmp(&right.next_attempt_at)
                    .then_with(|| left_id.cmp(right_id))
            });
            due.truncate(DISPATCH_BATCH_SIZE);
            let next_attempt_at = state
                .scheduled
                .iter()
                .filter(|(id, _)| !state.active.contains_key(*id))
                .map(|(_, target)| target.next_attempt_at)
                .min_by(f64::total_cmp);
            (state.stopping, due, next_attempt_at)
        };
        if stopping {
            while deliveries.next().await.is_some() {}
            return;
        }
        if !due.is_empty() {
            for (id, target) in due {
                lock(&state).active.insert(
                    id.clone(),
                    (
                        target.generation,
                        target.cancellation.clone(),
                        target.abort.clone(),
                    ),
                );
                deliveries.push(Box::pin(deliver_local(
                    engine.clone(),
                    state.clone(),
                    id,
                    target,
                )));
            }
            continue;
        }
        if let Some(at) = next_attempt_at {
            if at > now {
                let delay = Duration::from_secs_f64((at - now) / 1_000.0);
                if deliveries.is_empty() {
                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = notify.notified() => {}
                    }
                } else {
                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = notify.notified() => {}
                        _ = deliveries.next() => {}
                    }
                }
            } else {
                tokio::task::yield_now().await;
            }
        } else if deliveries.is_empty() {
            notify.notified().await;
        } else {
            tokio::select! {
                _ = notify.notified() => {}
                _ = deliveries.next() => {}
            }
        }
    }
}

async fn deliver_local(
    engine: Engine,
    state: Arc<Mutex<LocalState>>,
    id: String,
    target: ScheduledTarget,
) {
    let mut invocation = DependencyInvocation::new(
        format!("alarm:{id}:{}", target.generation),
        target.attempt,
        target.scheduled_at,
        now_millis(),
        None,
    );
    invocation.cancellation = target.cancellation.clone();
    let call = engine.call_dependency_with_invocation(
        &target.dependency,
        &target.operation,
        target.input.clone(),
        invocation,
    );
    tokio::pin!(call);
    let aborted = target.abort.wait();
    tokio::pin!(aborted);
    let result = tokio::select! {
        result = &mut call => Some(result),
        _ = &mut aborted => None,
    };
    let mut state = lock(&state);
    if state
        .active
        .get(&id)
        .is_some_and(|(generation, _, _)| *generation == target.generation)
    {
        state.active.remove(&id);
    }
    if state.scheduled.get(&id).map(|current| current.generation) != Some(target.generation) {
        return;
    }
    let Some(result) = result else {
        return;
    };
    if result.is_ok() {
        state.scheduled.remove(&id);
    } else if let Some(current) = state.scheduled.get_mut(&id) {
        current.attempt += 1;
        current.next_attempt_at = now_millis() + RETRY_DELAY.as_millis() as f64;
    }
}

fn parse_alarm(input: &Record, id: String) -> NativeResult<AlarmInput> {
    let at = input
        .get("at")
        .ok_or_else(|| invalid("at is required."))?
        .number()?;
    if !at.is_finite() {
        return Err(invalid("Alarm schedule time must be finite."));
    }
    let target = input
        .get("target")
        .ok_or_else(|| invalid("target is required."))?
        .as_record()?;
    let dependency = required_string(&target, "dependency")?;
    let operation = required_string(&target, "operation")?;
    let target_input = target
        .get("input")
        .ok_or_else(|| invalid("target.input is required."))?
        .clone();
    target_input.as_record()?;
    Ok(AlarmInput {
        id,
        at,
        dependency,
        operation,
        input: target_input,
    })
}

fn required_string(input: &Record, name: &str) -> NativeResult<String> {
    input
        .get(name)
        .ok_or_else(|| invalid(format!("{name} is required.")))?
        .string()
}

fn decode_state(payload: &[u8]) -> NativeResult<DurableAlarm> {
    serde_json::from_slice(payload).map_err(failure)
}

fn alarm_key(id: &str) -> String {
    URL_SAFE_NO_PAD.encode(id)
}

fn schedule_subject(key: &str) -> String {
    format!("{SCHEDULE_SUBJECT_PREFIX}.{key}")
}

fn schedule_at(at: f64) -> NativeResult<String> {
    let nanoseconds = (at * 1_000_000.0).round() as i128;
    let timestamp = OffsetDateTime::from_unix_timestamp_nanos(nanoseconds)
        .map_err(|_| invalid("Alarm schedule time is outside the supported range."))?;
    timestamp
        .format(&Rfc3339)
        .map(|value| format!("@at {value}"))
        .map_err(failure)
}

fn configuration<'a>(context: &'a DependencyContext, name: &str, fallback: &'a str) -> &'a str {
    context
        .configuration
        .get(name)
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
}

fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs_f64() * 1_000.0)
        .unwrap_or_default()
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::new("InvalidInput", message)
}

fn conflict(message: impl Into<String>) -> NativeError {
    NativeError::new("AlarmConflict", message)
}

fn unknown(operation: &str) -> NativeError {
    NativeError::new(
        "UnknownOperation",
        format!("Alarm has no operation {operation:?}."),
    )
}

fn failure(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("AlarmFailure", error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        net::{TcpListener, TcpStream},
        process::{Child, Command, Stdio},
        sync::atomic::{AtomicUsize, Ordering},
        thread,
    };

    use super::*;

    struct TestNats {
        child: Child,
        directory: std::path::PathBuf,
    }

    impl Drop for TestNats {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    struct Recorder(Arc<AtomicUsize>);

    impl Dependency for Recorder {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            _input: Value,
            _invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
            let calls = self.0.clone();
            let amount = if operation == "first" { 1 } else { 10 };
            Box::pin(async move {
                calls.fetch_add(amount, Ordering::SeqCst);
                Ok(Value::Undefined)
            })
        }
    }

    struct CancellationRecorder {
        started: Arc<tokio::sync::Notify>,
        cancelled: Arc<tokio::sync::Notify>,
    }

    impl Dependency for CancellationRecorder {
        fn call(
            &self,
            _engine: Engine,
            _operation: &str,
            _input: Value,
            invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
            let started = self.started.clone();
            let cancelled = self.cancelled.clone();
            Box::pin(async move {
                started.notify_one();
                invocation.cancellation.wait().await;
                cancelled.notify_one();
                Ok(Value::Undefined)
            })
        }
    }

    struct ConcurrentRecorder {
        blocked_started: Arc<tokio::sync::Notify>,
        release_blocked: Arc<tokio::sync::Notify>,
        fast_completed: Arc<tokio::sync::Notify>,
    }

    impl Dependency for ConcurrentRecorder {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            _input: Value,
            _invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
            let operation = operation.to_owned();
            let blocked_started = self.blocked_started.clone();
            let release_blocked = self.release_blocked.clone();
            let fast_completed = self.fast_completed.clone();
            Box::pin(async move {
                if operation == "blocked" {
                    blocked_started.notify_one();
                    release_blocked.notified().await;
                } else {
                    fast_completed.notify_one();
                }
                Ok(Value::Undefined)
            })
        }
    }

    struct GenerationRecorder {
        started: Arc<AtomicUsize>,
        cancelled: Arc<AtomicUsize>,
        changed: Arc<tokio::sync::Notify>,
    }

    impl Dependency for GenerationRecorder {
        fn call(
            &self,
            _engine: Engine,
            operation: &str,
            _input: Value,
            invocation: DependencyInvocation,
        ) -> NativeFuture<Value> {
            let bit = if operation == "first" { 1 } else { 2 };
            let started = self.started.clone();
            let cancelled = self.cancelled.clone();
            let changed = self.changed.clone();
            Box::pin(async move {
                started.fetch_or(bit, Ordering::SeqCst);
                changed.notify_waiters();
                invocation.cancellation.wait().await;
                cancelled.fetch_or(bit, Ordering::SeqCst);
                changed.notify_waiters();
                Ok(Value::Undefined)
            })
        }
    }

    async fn wait_for_mask(value: &AtomicUsize, expected: usize, changed: &tokio::sync::Notify) {
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let notified = changed.notified();
                if value.load(Ordering::SeqCst) == expected {
                    return;
                }
                notified.await;
            }
        })
        .await
        .expect("Alarm state did not reach the expected mask.");
    }

    fn local_context() -> DependencyContext {
        DependencyContext {
            name: "alarm".to_owned(),
            configuration: BTreeMap::new(),
            dependencies: BTreeMap::new(),
        }
    }

    fn shared_context(servers: &str, suffix: &str) -> DependencyContext {
        DependencyContext {
            name: "alarm".to_owned(),
            configuration: BTreeMap::from([
                ("servers".to_owned(), servers.to_owned()),
                ("stream".to_owned(), format!("KIT_ALARMS_{suffix}")),
                ("state".to_owned(), format!("KIT_ALARM_STATE_{suffix}")),
                ("replicas".to_owned(), "1".to_owned()),
            ]),
            dependencies: BTreeMap::new(),
        }
    }

    fn start_test_nats() -> Option<(TestNats, String)> {
        if !Command::new("nats-server")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .ok()?
            .success()
        {
            return None;
        }
        let listener = TcpListener::bind("127.0.0.1:0").ok()?;
        let port = listener.local_addr().ok()?.port();
        drop(listener);
        let directory =
            std::env::temp_dir().join(format!("kit-alarm-{}-{}", std::process::id(), now_millis()));
        fs::create_dir_all(&directory).ok()?;
        let child = Command::new("nats-server")
            .args([
                "--jetstream",
                "--store_dir",
                directory.to_str()?,
                "--addr",
                "127.0.0.1",
                "--port",
                &port.to_string(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let mut server = TestNats { child, directory };
        for _ in 0..100 {
            if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                return Some((server, format!("nats://127.0.0.1:{port}")));
            }
            if server.child.try_wait().ok().flatten().is_some() {
                return None;
            }
            thread::sleep(Duration::from_millis(10));
        }
        None
    }

    fn scheduled(id: &str, at: f64, operation: &str) -> Value {
        Value::record([
            ("id".to_owned(), Value::String(id.to_owned())),
            ("at".to_owned(), Value::Number(at)),
            (
                "target".to_owned(),
                Value::record([
                    (
                        "dependency".to_owned(),
                        Value::String("recorder".to_owned()),
                    ),
                    ("operation".to_owned(), Value::String(operation.to_owned())),
                    ("input".to_owned(), Value::record([])),
                ]),
            ),
        ])
    }

    #[tokio::test]
    async fn replacement_dispatches_only_the_latest_dependency_target() {
        let alarm = create(local_context()).await.expect("create alarm");
        let engine = Engine::new();
        let calls = Arc::new(AtomicUsize::new(0));
        engine
            .register("recorder", Arc::new(Recorder(calls.clone())))
            .expect("register recorder");
        let at = now_millis() + 20.0;
        for operation in ["first", "second"] {
            alarm
                .call(
                    engine.clone(),
                    "schedule",
                    scheduled("same", at, operation),
                    DependencyInvocation::direct("alarm", "schedule", 1).expect("invocation"),
                )
                .await
                .expect("schedule");
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 10);
        alarm.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn cancellation_prevents_dependency_dispatch() {
        let alarm = create(local_context()).await.expect("create alarm");
        let engine = Engine::new();
        let calls = Arc::new(AtomicUsize::new(0));
        engine
            .register("recorder", Arc::new(Recorder(calls.clone())))
            .expect("register recorder");
        alarm
            .call(
                engine.clone(),
                "schedule",
                scheduled("cancelled", now_millis() + 20.0, "first"),
                DependencyInvocation::direct("alarm", "schedule", 1).expect("invocation"),
            )
            .await
            .expect("schedule");
        alarm
            .call(
                engine,
                "cancel",
                Value::record([("id".to_owned(), Value::String("cancelled".to_owned()))]),
                DependencyInvocation::direct("alarm", "cancel", 1).expect("invocation"),
            )
            .await
            .expect("cancel");
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        alarm.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn cancellation_request_reaches_an_active_dependency_target() {
        let alarm = create(local_context()).await.expect("create alarm");
        let engine = Engine::new();
        let started = Arc::new(tokio::sync::Notify::new());
        let cancelled = Arc::new(tokio::sync::Notify::new());
        engine
            .register(
                "recorder",
                Arc::new(CancellationRecorder {
                    started: started.clone(),
                    cancelled: cancelled.clone(),
                }),
            )
            .expect("register recorder");
        alarm
            .call(
                engine.clone(),
                "schedule",
                scheduled("active", 0.0, "blocked"),
                DependencyInvocation::direct("alarm", "schedule", 1).expect("invocation"),
            )
            .await
            .expect("schedule");
        tokio::time::timeout(Duration::from_secs(1), started.notified())
            .await
            .expect("dependency delivery did not start");

        alarm
            .call(
                engine,
                "requestCancellation",
                Value::record([("id".to_owned(), Value::String("active".to_owned()))]),
                DependencyInvocation::direct("alarm", "requestCancellation", 1)
                    .expect("invocation"),
            )
            .await
            .expect("request cancellation");
        tokio::time::timeout(Duration::from_secs(1), cancelled.notified())
            .await
            .expect("active dependency did not observe cancellation");
        alarm.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn one_blocked_local_delivery_does_not_delay_an_unrelated_target() {
        let alarm = create(local_context()).await.expect("create alarm");
        let engine = Engine::new();
        let blocked_started = Arc::new(tokio::sync::Notify::new());
        let release_blocked = Arc::new(tokio::sync::Notify::new());
        let fast_completed = Arc::new(tokio::sync::Notify::new());
        engine
            .register(
                "recorder",
                Arc::new(ConcurrentRecorder {
                    blocked_started: blocked_started.clone(),
                    release_blocked: release_blocked.clone(),
                    fast_completed: fast_completed.clone(),
                }),
            )
            .expect("register recorder");
        alarm
            .call(
                engine.clone(),
                "schedule",
                scheduled("blocked", 0.0, "blocked"),
                DependencyInvocation::direct("alarm", "schedule", 1).expect("invocation"),
            )
            .await
            .expect("schedule blocked");
        tokio::time::timeout(Duration::from_secs(1), blocked_started.notified())
            .await
            .expect("blocked delivery did not start");
        alarm
            .call(
                engine,
                "schedule",
                scheduled("fast", 0.0, "fast"),
                DependencyInvocation::direct("alarm", "schedule", 2).expect("invocation"),
            )
            .await
            .expect("schedule fast");
        tokio::time::timeout(Duration::from_secs(1), fast_completed.notified())
            .await
            .expect("unrelated delivery was blocked");
        release_blocked.notify_one();
        alarm.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn replacement_waits_for_active_generation_and_preserves_cancellation() {
        let alarm = create(local_context()).await.expect("create alarm");
        let engine = Engine::new();
        let started = Arc::new(AtomicUsize::new(0));
        let cancelled = Arc::new(AtomicUsize::new(0));
        let changed = Arc::new(tokio::sync::Notify::new());
        engine
            .register(
                "recorder",
                Arc::new(GenerationRecorder {
                    started: started.clone(),
                    cancelled: cancelled.clone(),
                    changed: changed.clone(),
                }),
            )
            .expect("register recorder");
        alarm
            .call(
                engine.clone(),
                "schedule",
                scheduled("same-active", 0.0, "first"),
                DependencyInvocation::direct("alarm", "schedule", 1).expect("invocation"),
            )
            .await
            .expect("schedule first");
        wait_for_mask(&started, 1, &changed).await;
        alarm
            .call(
                engine.clone(),
                "schedule",
                scheduled("same-active", 0.0, "second"),
                DependencyInvocation::direct("alarm", "schedule", 2).expect("invocation"),
            )
            .await
            .expect("schedule replacement");
        tokio::time::sleep(Duration::from_millis(25)).await;
        assert_eq!(started.load(Ordering::SeqCst), 1);

        alarm
            .call(
                engine,
                "requestCancellation",
                Value::record([("id".to_owned(), Value::String("same-active".to_owned()))]),
                DependencyInvocation::direct("alarm", "requestCancellation", 1)
                    .expect("invocation"),
            )
            .await
            .expect("request cancellation");
        wait_for_mask(&started, 3, &changed).await;
        wait_for_mask(&cancelled, 3, &changed).await;
        alarm.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn one_blocked_shared_delivery_does_not_delay_an_unrelated_target() {
        let Some((_nats, servers)) = start_test_nats() else {
            return;
        };
        let suffix = format!("concurrent-{}", now_millis() as u64);
        let alarm = create(shared_context(&servers, &suffix))
            .await
            .expect("create alarm");
        let engine = Engine::new();
        let blocked_started = Arc::new(tokio::sync::Notify::new());
        let release_blocked = Arc::new(tokio::sync::Notify::new());
        let fast_completed = Arc::new(tokio::sync::Notify::new());
        engine
            .register(
                "recorder",
                Arc::new(ConcurrentRecorder {
                    blocked_started: blocked_started.clone(),
                    release_blocked: release_blocked.clone(),
                    fast_completed: fast_completed.clone(),
                }),
            )
            .expect("register recorder");
        alarm.start(engine.clone()).await.expect("start alarm");
        alarm
            .call(
                engine.clone(),
                "schedule",
                scheduled("blocked", now_millis() + 10.0, "blocked"),
                DependencyInvocation::direct("alarm", "schedule", 1).expect("invocation"),
            )
            .await
            .expect("schedule blocked");
        tokio::time::timeout(Duration::from_secs(2), blocked_started.notified())
            .await
            .expect("blocked shared delivery did not start");
        alarm
            .call(
                engine,
                "schedule",
                scheduled("fast", now_millis() + 10.0, "fast"),
                DependencyInvocation::direct("alarm", "schedule", 2).expect("invocation"),
            )
            .await
            .expect("schedule fast");
        tokio::time::timeout(Duration::from_secs(2), fast_completed.notified())
            .await
            .expect("unrelated shared delivery was blocked");
        release_blocked.notify_one();
        alarm.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn shared_cancellation_request_reaches_an_active_dependency_target() {
        let Some((_nats, servers)) = start_test_nats() else {
            return;
        };
        let suffix = format!("cancellation-{}", now_millis() as u64);
        let alarm = create(shared_context(&servers, &suffix))
            .await
            .expect("create alarm");
        let engine = Engine::new();
        let started = Arc::new(tokio::sync::Notify::new());
        let cancelled = Arc::new(tokio::sync::Notify::new());
        engine
            .register(
                "recorder",
                Arc::new(CancellationRecorder {
                    started: started.clone(),
                    cancelled: cancelled.clone(),
                }),
            )
            .expect("register recorder");
        alarm.start(engine.clone()).await.expect("start alarm");
        alarm
            .call(
                engine.clone(),
                "schedule",
                scheduled("active", now_millis() + 10.0, "blocked"),
                DependencyInvocation::direct("alarm", "schedule", 1).expect("invocation"),
            )
            .await
            .expect("schedule active");
        tokio::time::timeout(Duration::from_secs(2), started.notified())
            .await
            .expect("shared delivery did not start");
        alarm
            .call(
                engine,
                "requestCancellation",
                Value::record([("id".to_owned(), Value::String("active".to_owned()))]),
                DependencyInvocation::direct("alarm", "requestCancellation", 1)
                    .expect("invocation"),
            )
            .await
            .expect("request cancellation");
        tokio::time::timeout(Duration::from_secs(2), cancelled.notified())
            .await
            .expect("shared delivery did not observe cancellation");
        alarm.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn durable_delivery_survives_scheduler_loss_and_a_missed_deadline() {
        let Some((_nats, servers)) = start_test_nats() else {
            return;
        };
        let suffix = format!("{}", now_millis() as u64);
        let first = create(shared_context(&servers, &suffix))
            .await
            .expect("create first alarm");
        let first_engine = Engine::new();
        first
            .start(first_engine.clone())
            .await
            .expect("start first alarm");
        first
            .call(
                first_engine,
                "schedule",
                scheduled("durable", now_millis() + 150.0, "first"),
                DependencyInvocation::direct("alarm", "schedule", 1).expect("invocation"),
            )
            .await
            .expect("schedule durable alarm");
        first.shutdown().await.expect("stop first alarm");

        tokio::time::sleep(Duration::from_millis(250)).await;

        let second = create(shared_context(&servers, &suffix))
            .await
            .expect("create recovered alarm");
        let second_engine = Engine::new();
        let calls = Arc::new(AtomicUsize::new(0));
        second_engine
            .register("recorder", Arc::new(Recorder(calls.clone())))
            .expect("register recorder");
        second
            .start(second_engine)
            .await
            .expect("start recovered alarm");
        for _ in 0..200 {
            if calls.load(Ordering::SeqCst) == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        second.shutdown().await.expect("stop recovered alarm");
    }
}
