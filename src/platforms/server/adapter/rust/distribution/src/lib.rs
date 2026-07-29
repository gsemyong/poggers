use std::{
    collections::BTreeMap,
    future::pending,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use async_nats::jetstream::{
    self,
    context::{PublishErrorKind, traits::Publisher},
    message::PublishMessage,
    stream::{DiscardPolicy, RawMessageErrorKind, RetentionPolicy, StorageType, Stream},
};
use async_nats::{Client, Subscriber};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use kit_server_runtime::{
    DependencyAuthority, DependencyCancellation, DependencyInvocation, DependencyRouter, Engine,
    NativeError, NativeFuture, NativeResult, TypeContract, Value, validate_value,
};

#[derive(Clone, Debug)]
pub struct DistributionOperation {
    pub name: &'static str,
    pub identity: &'static str,
    pub mode: DistributionOperationMode,
    pub input: TypeContract,
    pub output: TypeContract,
    pub heartbeat: Option<TypeContract>,
    pub failures: BTreeMap<&'static str, TypeContract>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DistributionOperationMode {
    Asynchronous,
    Stream,
}

#[derive(Clone, Debug)]
pub struct DistributionContract {
    pub name: &'static str,
    pub identity: &'static str,
    pub bindings: Vec<&'static str>,
    pub operations: Vec<DistributionOperation>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct DirectoryState {
    revision: u64,
    failure_epochs: BTreeMap<String, u64>,
    members: BTreeMap<String, ProcessMember>,
    ownership: BTreeMap<String, ProcessOwnership>,
    ownership_epochs: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
struct ProcessMember {
    id: String,
    target: String,
    program: String,
    version: String,
    failure_epoch: u64,
    status: MemberStatus,
    contracts: BTreeMap<String, BTreeMap<String, String>>,
    expires_at: f64,
}

#[derive(Clone, Debug)]
struct ProcessRegistration {
    id: String,
    target: String,
    program: String,
    version: String,
    contracts: BTreeMap<String, BTreeMap<String, String>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum MemberStatus {
    Active,
    Draining,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
struct ProcessPartition {
    scope: String,
    program: String,
    dependency: String,
    partition: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
struct ProcessOwnership {
    partition: ProcessPartition,
    owner: String,
    target: String,
    version: String,
    failure_epoch: u64,
    epoch: u64,
    membership_revision: u64,
    expires_at: f64,
}

#[derive(Clone, Debug)]
struct ProcessAuthority {
    scope: String,
    owner: String,
    failure_epoch: u64,
    epoch: u64,
}

#[derive(Clone)]
struct NatsDirectory {
    context: jetstream::Context,
    stream: Stream,
    subject: String,
}

impl NatsDirectory {
    async fn connect(
        client: async_nats::Client,
        stream_name: &str,
        cluster: &str,
    ) -> NativeResult<Self> {
        let context = jetstream::new(client);
        let stream = context
            .get_or_create_stream(jetstream::stream::Config {
                name: stream_name.to_owned(),
                subjects: vec!["kit.distribution.>".to_owned()],
                retention: RetentionPolicy::Limits,
                discard: DiscardPolicy::Old,
                storage: StorageType::File,
                max_messages_per_subject: 1,
                allow_direct: true,
                ..Default::default()
            })
            .await
            .map_err(distribution_failure)?;
        let configuration = &stream.cached_info().config;
        if !configuration
            .subjects
            .iter()
            .any(|subject| subject == "kit.distribution.>")
            || configuration.retention != RetentionPolicy::Limits
            || configuration.discard != DiscardPolicy::Old
            || configuration.storage != StorageType::File
            || configuration.max_messages_per_subject != 1
            || !configuration.allow_direct
        {
            return Err(invalid(
                "The existing JetStream stream does not match Process distribution.",
            ));
        }
        Ok(Self {
            context,
            stream,
            subject: format!("kit.distribution.directory.{}", subject_token(cluster)),
        })
    }

    async fn update<Result, Operation>(&self, mut operation: Operation) -> NativeResult<Result>
    where
        Operation: FnMut(&mut DirectoryState) -> NativeResult<Result>,
    {
        for _ in 0..128 {
            let previous = match self
                .stream
                .get_last_raw_message_by_subject(&self.subject)
                .await
            {
                Ok(message) => Some(message),
                Err(error) if matches!(error.kind(), RawMessageErrorKind::NoMessageFound) => None,
                Err(error) => return Err(distribution_failure(error)),
            };
            let mut state = match &previous {
                Some(message) => {
                    serde_json::from_slice(&message.payload).map_err(distribution_failure)?
                }
                None => DirectoryState::default(),
            };
            let result = operation(&mut state)?;
            let payload = serde_json::to_vec(&state).map_err(distribution_failure)?;
            let message = PublishMessage::build()
                .payload(payload.into())
                .expected_last_subject_sequence(
                    previous.as_ref().map_or(0, |message| message.sequence),
                )
                .outbound_message(self.subject.clone());
            let published = self
                .context
                .publish_message(message)
                .await
                .map_err(distribution_failure)?;
            match published.await {
                Ok(_) => return Ok(result),
                Err(error) if matches!(error.kind(), PublishErrorKind::WrongLastSequence) => {}
                Err(error) => return Err(distribution_failure(error)),
            }
        }
        Err(placement(
            "Process directory exceeded its optimistic retry limit.",
        ))
    }

    async fn join(
        &self,
        registration: &ProcessRegistration,
        now: f64,
        lease_duration: f64,
    ) -> NativeResult<ProcessMember> {
        self.update(|state| state.join(registration.clone(), now, lease_duration))
            .await
    }

    async fn renew(
        &self,
        id: &str,
        failure_epoch: u64,
        now: f64,
        lease_duration: f64,
    ) -> NativeResult<ProcessMember> {
        self.update(|state| state.renew(id, failure_epoch, now, lease_duration))
            .await
    }

    async fn drain(&self, id: &str, failure_epoch: u64, now: f64) -> NativeResult<()> {
        self.update(|state| state.drain(id, failure_epoch, now))
            .await
    }

    async fn leave(&self, id: &str, failure_epoch: u64, now: f64) -> NativeResult<()> {
        self.update(|state| state.leave(id, failure_epoch, now))
            .await
    }

    async fn locate(
        &self,
        partition: &ProcessPartition,
        contracts: &BTreeMap<String, BTreeMap<String, String>>,
        now: f64,
        lease_duration: f64,
    ) -> NativeResult<ProcessOwnership> {
        self.update(|state| state.locate(partition.clone(), contracts, now, lease_duration))
            .await
    }

    async fn assert_authority(&self, authority: &ProcessAuthority, now: f64) -> NativeResult<()> {
        self.update(|state| state.assert_authority(authority, now))
            .await
    }

    async fn renew_ownership(
        &self,
        authority: &ProcessAuthority,
        now: f64,
        lease_duration: f64,
    ) -> NativeResult<ProcessOwnership> {
        self.update(|state| state.renew_ownership(authority, now, lease_duration))
            .await
    }

    async fn release_ownership(&self, authority: &ProcessAuthority, now: f64) -> NativeResult<()> {
        self.update(|state| state.release_ownership(authority, now))
            .await
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireAuthority {
    scope: String,
    owner: String,
    failure_epoch: u64,
    epoch: u64,
    expires_at: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireInvocation {
    id: String,
    attempt: u64,
    scheduled_at: f64,
    started_at: f64,
    deadline: Option<f64>,
    previous_heartbeat: Option<serde_json::Value>,
    trace: Option<WireTrace>,
    authority: Option<WireAuthority>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WireTrace {
    traceparent: String,
    tracestate: Option<String>,
    baggage: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireRequest {
    version: u64,
    dependency: String,
    operation: String,
    contract: String,
    invocation: WireInvocation,
    input: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireCancel {
    kind: String,
    invocation: String,
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
enum WireInbound {
    Request(Box<WireRequest>),
    Cancel(WireCancel),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WireFrame {
    version: u64,
    invocation: String,
    sequence: u64,
    #[serde(flatten)]
    payload: WireFramePayload,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WireFramePayload {
    Heartbeat { details: serde_json::Value },
    Result { value: serde_json::Value },
    Item { value: serde_json::Value },
    Complete,
    Failure { failure: WireFailure },
    Error { error: WireError },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WireFailure {
    #[serde(rename = "type")]
    failure_type: String,
    data: serde_json::Value,
    message: String,
    retry: Option<WireRetry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WireRetry {
    delay: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WireError {
    code: String,
    message: String,
    uncertain: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
enum WireControlRequest {
    Status,
    Drain,
    Rebalance { scope: Option<String> },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireControlResponse {
    version: u64,
    member: ProcessMember,
    healthy: bool,
    ready: bool,
    active: usize,
    capacity: usize,
    ownership: Vec<WireOwnership>,
    metrics: WireProcessMetrics,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireOwnership {
    scope: String,
    failure_epoch: u64,
    epoch: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireProcessMetrics {
    routed_calls: u64,
    admitted_calls: u64,
    local_calls: u64,
    remote_calls: u64,
    retries: u64,
    rejections: u64,
    failures: u64,
    ownership_moves: u64,
}

#[derive(Default)]
struct ProcessMetrics {
    routed_calls: AtomicU64,
    admitted_calls: AtomicU64,
    local_calls: AtomicU64,
    remote_calls: AtomicU64,
    retries: AtomicU64,
    rejections: AtomicU64,
    failures: AtomicU64,
    ownership_moves: AtomicU64,
}

impl ProcessMetrics {
    fn snapshot(&self) -> WireProcessMetrics {
        WireProcessMetrics {
            routed_calls: self.routed_calls.load(Ordering::Relaxed),
            admitted_calls: self.admitted_calls.load(Ordering::Relaxed),
            local_calls: self.local_calls.load(Ordering::Relaxed),
            remote_calls: self.remote_calls.load(Ordering::Relaxed),
            retries: self.retries.load(Ordering::Relaxed),
            rejections: self.rejections.load(Ordering::Relaxed),
            failures: self.failures.load(Ordering::Relaxed),
            ownership_moves: self.ownership_moves.load(Ordering::Relaxed),
        }
    }
}

#[derive(Clone)]
struct ProcessRouter {
    program: String,
    member: Arc<Mutex<ProcessMember>>,
    contracts: BTreeMap<String, DistributionContract>,
    directory: NatsDirectory,
    client: Client,
    partition_count: u64,
    membership_lease: f64,
    ownership_lease: f64,
    drain_timeout: Duration,
    max_inflight: usize,
    stopping: Arc<AtomicBool>,
    healthy: Arc<AtomicBool>,
    admission: Arc<tokio::sync::Semaphore>,
    metrics: Arc<ProcessMetrics>,
    active: Arc<Mutex<BTreeMap<String, DependencyCancellation>>>,
    owned: Arc<Mutex<BTreeMap<String, ProcessAuthority>>>,
    listener: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    control: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    renewal: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

/**
 * Enables production Process distribution when `KIT_NATS_URL` is configured.
 *
 * The generated Program remains unchanged. This adapter installs one generic
 * router only for compiler-declared identity-bound provided Dependencies.
 */
pub async fn start(
    engine: Engine,
    program: &str,
    version: &str,
    contracts: Vec<DistributionContract>,
) -> NativeResult<bool> {
    if contracts.is_empty() {
        return Ok(false);
    }
    let servers = std::env::var("KIT_NATS_URL").unwrap_or_default();
    if servers.is_empty() {
        return Ok(false);
    }
    let cluster = environment("KIT_PROCESS_CLUSTER", "default");
    let stream = environment("KIT_DISTRIBUTION_STREAM", "KIT_DISTRIBUTION");
    let id = environment(
        "KIT_PROCESS_ID",
        &format!("{program}-{}", std::process::id()),
    );
    let partition_count = environment_u64("KIT_PROCESS_PARTITIONS", 1_024)?;
    let max_inflight: usize = environment_u64("KIT_PROCESS_MAX_INFLIGHT", 1_024)?
        .try_into()
        .map_err(|_| invalid("KIT_PROCESS_MAX_INFLIGHT exceeds this platform's limit."))?;
    let membership_lease = environment_duration("KIT_PROCESS_MEMBERSHIP_LEASE_MS", 15_000.0)?;
    let ownership_lease = environment_duration("KIT_PROCESS_OWNERSHIP_LEASE_MS", 10_000.0)?;
    let drain_timeout = environment_duration("KIT_PROCESS_DRAIN_TIMEOUT_MS", 10_000.0)?;
    let client = async_nats::connect(servers)
        .await
        .map_err(distribution_failure)?;
    let directory = NatsDirectory::connect(client.clone(), &stream, &cluster).await?;
    let target = format!(
        "kit.process.{}.{}.{}",
        subject_token(&cluster),
        subject_token(program),
        subject_token(&format!("{id}-{}", std::process::id()))
    );
    let subscription = client
        .subscribe(target.clone())
        .await
        .map_err(distribution_failure)?;
    let control_target = format!(
        "kit.process.control.{}.{}.{}",
        subject_token(&cluster),
        subject_token(program),
        subject_token(&id),
    );
    let control = client
        .subscribe(control_target)
        .await
        .map_err(distribution_failure)?;
    client.flush().await.map_err(distribution_failure)?;
    let advertised = contracts
        .iter()
        .map(|contract| {
            (
                contract.name.to_owned(),
                contract
                    .operations
                    .iter()
                    .map(|operation| (operation.name.to_owned(), operation.identity.to_owned()))
                    .collect(),
            )
        })
        .collect();
    let member = match directory
        .join(
            &ProcessRegistration {
                id: id.clone(),
                target: target.clone(),
                program: program.to_owned(),
                version: version.to_owned(),
                contracts: advertised,
            },
            now_millis(),
            membership_lease,
        )
        .await
    {
        Ok(member) => member,
        Err(error) => {
            drop(subscription);
            drop(control);
            client.drain().await.map_err(distribution_failure)?;
            return Err(error);
        }
    };
    let router = Arc::new(ProcessRouter {
        program: program.to_owned(),
        member: Arc::new(Mutex::new(member)),
        contracts: contracts
            .into_iter()
            .map(|contract| (contract.name.to_owned(), contract))
            .collect(),
        directory,
        client,
        partition_count,
        membership_lease,
        ownership_lease,
        drain_timeout: Duration::from_secs_f64(drain_timeout / 1_000.0),
        max_inflight,
        stopping: Arc::new(AtomicBool::new(false)),
        healthy: Arc::new(AtomicBool::new(true)),
        admission: Arc::new(tokio::sync::Semaphore::new(max_inflight)),
        metrics: Arc::new(ProcessMetrics::default()),
        active: Arc::new(Mutex::new(BTreeMap::new())),
        owned: Arc::new(Mutex::new(BTreeMap::new())),
        listener: Arc::new(Mutex::new(None)),
        control: Arc::new(Mutex::new(None)),
        renewal: Arc::new(Mutex::new(None)),
    });
    router.start_listener(engine.clone(), subscription);
    router.start_control(control);
    router.start_renewal();
    engine.install_router(router)?;
    Ok(true)
}

impl ProcessRouter {
    fn start_listener(self: &Arc<Self>, engine: Engine, mut subscription: Subscriber) {
        let router = self.clone();
        *lock(&self.listener) = Some(tokio::spawn(async move {
            while let Some(message) = subscription.next().await {
                if router.stopping.load(Ordering::Acquire) {
                    return;
                }
                let inbound = serde_json::from_slice::<WireInbound>(&message.payload);
                match inbound {
                    Ok(WireInbound::Cancel(cancel)) if cancel.kind == "cancel" => {
                        if let Some(cancellation) = lock(&router.active).get(&cancel.invocation) {
                            cancellation.request_with_reason(cancel.reason);
                        }
                    }
                    Ok(WireInbound::Request(request)) => {
                        let Some(reply) = message.reply else {
                            continue;
                        };
                        if !router.healthy.load(Ordering::Acquire) {
                            router.metrics.rejections.fetch_add(1, Ordering::Relaxed);
                            let frame = WireFrame {
                                version: 1,
                                invocation: request.invocation.id,
                                sequence: 1,
                                payload: error_payload(unavailable(
                                    "Process lost its distribution lease.",
                                )),
                            };
                            let _ = router.publish_frame(&reply, frame).await;
                            continue;
                        }
                        let Ok(permit) = router.admission.clone().try_acquire_owned() else {
                            router.metrics.rejections.fetch_add(1, Ordering::Relaxed);
                            let frame = WireFrame {
                                version: 1,
                                invocation: request.invocation.id,
                                sequence: 1,
                                payload: error_payload(unavailable(
                                    "Process reached its inbound invocation limit.",
                                )),
                            };
                            let _ = router.publish_frame(&reply, frame).await;
                            continue;
                        };
                        let cancellation = DependencyCancellation::default();
                        router
                            .metrics
                            .admitted_calls
                            .fetch_add(1, Ordering::Relaxed);
                        let invocation = request.invocation.id.clone();
                        let duplicate = {
                            use std::collections::btree_map::Entry;

                            match lock(&router.active).entry(invocation) {
                                Entry::Vacant(entry) => {
                                    entry.insert(cancellation.clone());
                                    false
                                }
                                Entry::Occupied(_) => true,
                            }
                        };
                        if duplicate {
                            let frame = WireFrame {
                                version: 1,
                                invocation: request.invocation.id,
                                sequence: 1,
                                payload: error_payload(remote_error(
                                    "duplicate-invocation",
                                    "Dependency invocation is already active on this Process.",
                                    false,
                                )),
                            };
                            let _ = router.publish_frame(&reply, frame).await;
                            continue;
                        }
                        let router = router.clone();
                        let engine = engine.clone();
                        tokio::spawn(async move {
                            let _permit = permit;
                            let id = request.invocation.id.clone();
                            router
                                .serve(engine, *request, reply.to_string(), cancellation)
                                .await;
                            lock(&router.active).remove(&id);
                        });
                    }
                    _ => {
                        let Some(reply) = message.reply else {
                            continue;
                        };
                        let frame = WireFrame {
                            version: 1,
                            invocation: "invalid".to_owned(),
                            sequence: 1,
                            payload: error_payload(protocol("Dependency request is invalid.")),
                        };
                        let _ = router.publish_frame(&reply, frame).await;
                    }
                }
            }
            if !router.stopping.load(Ordering::Acquire) {
                router.fail_closed("Process distribution listener closed.");
            }
        }));
    }

    fn start_control(self: &Arc<Self>, mut subscription: Subscriber) {
        let router = self.clone();
        *lock(&self.control) = Some(tokio::spawn(async move {
            while let Some(message) = subscription.next().await {
                let Some(reply) = message.reply else {
                    continue;
                };
                let request = serde_json::from_slice::<WireControlRequest>(&message.payload);
                let response = match request {
                    Ok(WireControlRequest::Status) => Ok(router.status()),
                    Ok(WireControlRequest::Rebalance { scope }) => router
                        .rebalance(scope.as_deref())
                        .await
                        .map(|()| router.status()),
                    Ok(WireControlRequest::Drain) => {
                        router.drain_member().await.map(|()| router.status())
                    }
                    Err(error) => Err(protocol(format!(
                        "Process control request is invalid: {error}",
                    ))),
                };
                let payload = match response {
                    Ok(response) => serde_json::to_vec(&response),
                    Err(error) => serde_json::to_vec(&WireFramePayload::Error {
                        error: WireError {
                            code: error.name,
                            message: error.message,
                            uncertain: false,
                        },
                    }),
                };
                if let Ok(payload) = payload {
                    let _ = router.client.publish(reply, payload.into()).await;
                }
            }
        }));
    }

    fn start_renewal(self: &Arc<Self>) {
        let router = self.clone();
        *lock(&self.renewal) = Some(tokio::spawn(async move {
            let delay = Duration::from_secs_f64(
                router.membership_lease.min(router.ownership_lease) / 2_000.0,
            );
            loop {
                tokio::time::sleep(delay).await;
                if router.stopping.load(Ordering::Acquire) {
                    return;
                }
                let member = lock(&router.member).clone();
                match tokio::time::timeout(
                    delay,
                    router.directory.renew(
                        &member.id,
                        member.failure_epoch,
                        now_millis(),
                        router.membership_lease,
                    ),
                )
                .await
                {
                    Ok(Ok(member)) => {
                        *lock(&router.member) = member;
                        let owned = lock(&router.owned).values().cloned().collect::<Vec<_>>();
                        for authority in owned {
                            if !matches!(
                                tokio::time::timeout(
                                    delay,
                                    router.directory.renew_ownership(
                                        &authority,
                                        now_millis(),
                                        router.ownership_lease,
                                    ),
                                )
                                .await,
                                Ok(Ok(_))
                            ) {
                                lock(&router.owned).remove(&authority.scope);
                            }
                        }
                    }
                    Ok(Err(_)) | Err(_) => {
                        router.fail_closed("Process distribution lease renewal failed.");
                        return;
                    }
                }
            }
        }));
    }

    fn fail_closed(&self, reason: &str) {
        if !self.healthy.swap(false, Ordering::AcqRel) {
            return;
        }
        for cancellation in lock(&self.active).values() {
            cancellation.request_with_reason(Some(reason.to_owned()));
        }
        lock(&self.owned).clear();
    }

    fn status(&self) -> WireControlResponse {
        let ownership = lock(&self.owned)
            .values()
            .map(|authority| WireOwnership {
                scope: authority.scope.clone(),
                failure_epoch: authority.failure_epoch,
                epoch: authority.epoch,
            })
            .collect();
        let healthy = self.healthy.load(Ordering::Acquire);
        WireControlResponse {
            version: 1,
            member: lock(&self.member).clone(),
            healthy,
            ready: healthy && !self.stopping.load(Ordering::Acquire),
            active: lock(&self.active).len(),
            capacity: self.max_inflight,
            ownership,
            metrics: self.metrics.snapshot(),
        }
    }

    async fn rebalance(&self, scope: Option<&str>) -> NativeResult<()> {
        let authorities = lock(&self.owned)
            .values()
            .filter(|authority| scope.is_none_or(|scope| scope == authority.scope))
            .cloned()
            .collect::<Vec<_>>();
        for authority in authorities {
            self.directory
                .release_ownership(&authority, now_millis())
                .await?;
            lock(&self.owned).remove(&authority.scope);
        }
        Ok(())
    }

    async fn drain_member(&self) -> NativeResult<()> {
        if self.stopping.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let member = lock(&self.member).clone();
        let now = now_millis();
        self.directory
            .drain(&member.id, member.failure_epoch, now)
            .await?;
        let listener = { lock(&self.listener).take() };
        if let Some(listener) = listener {
            listener.abort();
            let _ = listener.await;
        }
        let idle = async {
            while !lock(&self.active).is_empty()
                || self.admission.available_permits() != self.max_inflight
            {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        if tokio::time::timeout(self.drain_timeout, idle)
            .await
            .is_err()
        {
            for cancellation in lock(&self.active).values() {
                cancellation
                    .request_with_reason(Some("Process drain deadline elapsed.".to_owned()));
            }
        }
        self.rebalance(None).await?;
        self.directory
            .leave(&member.id, member.failure_epoch, now_millis())
            .await?;
        Ok(())
    }

    async fn serve(
        &self,
        engine: Engine,
        request: WireRequest,
        reply: String,
        cancellation: DependencyCancellation,
    ) {
        let invocation_id = request.invocation.id.clone();
        let mut sequence = 0;
        let result = self
            .serve_request(engine, &request, &reply, &mut sequence, cancellation)
            .await;
        if let Err(error) = result {
            self.metrics.failures.fetch_add(1, Ordering::Relaxed);
            sequence += 1;
            let frame = WireFrame {
                version: 1,
                invocation: invocation_id,
                sequence,
                payload: error_payload(error),
            };
            let _ = self.publish_frame(&reply, frame).await;
        }
    }

    async fn serve_request(
        &self,
        engine: Engine,
        request: &WireRequest,
        reply: &str,
        sequence: &mut u64,
        cancellation: DependencyCancellation,
    ) -> NativeResult<()> {
        if request.version != 1 {
            return Err(protocol("Unsupported Dependency protocol version."));
        }
        let contract = self
            .contracts
            .get(&request.dependency)
            .ok_or_else(|| protocol("Dependency is unavailable on the target Process."))?;
        let operation = contract
            .operations
            .iter()
            .find(|operation| operation.name == request.operation)
            .ok_or_else(|| {
                protocol("Dependency operation is unavailable on the target Process.")
            })?;
        if contract.identity != request.contract {
            return Err(protocol("Dependency contract does not match."));
        }
        validate_wire_invocation(&request.invocation)?;
        let input = Value::from_canonical_json(&request.input);
        validate_value(
            &input,
            &operation.input,
            &format!("{}.{} remote input", request.dependency, request.operation),
        )?;
        let authority = request
            .invocation
            .authority
            .clone()
            .ok_or_else(|| protocol("Routed Dependency invocation has no authority."))?;
        let process_authority = ProcessAuthority {
            scope: authority.scope.clone(),
            owner: authority.owner.clone(),
            failure_epoch: authority.failure_epoch,
            epoch: authority.epoch,
        };
        self.directory
            .assert_authority(&process_authority, now_millis())
            .await?;
        lock(&self.owned).insert(process_authority.scope.clone(), process_authority.clone());
        let directory = self.directory.clone();
        let asserted = process_authority.clone();
        let (heartbeat_sender, mut heartbeat_receiver) =
            tokio::sync::mpsc::unbounded_channel::<Value>();
        let invocation = DependencyInvocation::new(
            request.invocation.id.clone(),
            request.invocation.attempt,
            request.invocation.scheduled_at,
            request.invocation.started_at,
            request.invocation.deadline,
        )
        .with_controls(
            request
                .invocation
                .previous_heartbeat
                .as_ref()
                .map(Value::from_canonical_json),
            move |details| {
                heartbeat_sender.send(details).map_err(|_| {
                    remote_error(
                        "transport-closed",
                        "Remote Dependency heartbeat channel is closed.",
                        true,
                    )
                })
            },
            cancellation.clone(),
        );
        let invocation = match &request.invocation.trace {
            Some(trace) => invocation.with_trace(
                trace.traceparent.clone(),
                trace.tracestate.clone(),
                trace.baggage.clone(),
            ),
            None => invocation,
        };
        let invocation = invocation.with_authority(
            DependencyAuthority::new(
                authority.scope,
                authority.owner,
                authority.failure_epoch,
                authority.epoch,
                authority.expires_at,
            )
            .with_assertion(move || {
                let directory = directory.clone();
                let authority = asserted.clone();
                Box::pin(async move { directory.assert_authority(&authority, now_millis()).await })
            }),
        );
        let called = engine.call_provided_with_invocation(
            &request.dependency,
            &request.operation,
            input,
            invocation,
        );
        tokio::pin!(called);
        let mut heartbeats_open = true;
        let value = loop {
            tokio::select! {
                biased;
                heartbeat = heartbeat_receiver.recv(), if heartbeats_open => {
                    match heartbeat {
                        Some(heartbeat) => {
                            validate_heartbeat(
                                operation,
                                &heartbeat,
                                &request.dependency,
                            )?;
                            self.emit(
                                reply,
                                &request.invocation.id,
                                sequence,
                                WireFramePayload::Heartbeat {
                                    details: heartbeat.canonical_json()?,
                                },
                            ).await?;
                        }
                        None => heartbeats_open = false,
                    }
                }
                result = &mut called => break result,
                _ = cancellation.wait() => {
                    return Err(remote_error(
                        "cancelled",
                        cancellation.reason().unwrap_or_else(|| {
                            "Remote Dependency invocation was cancelled.".to_owned()
                        }),
                        true,
                    ));
                }
                _ = wait_for_deadline(request.invocation.deadline) => {
                    cancellation.request_with_reason(Some(
                        "Remote Dependency invocation deadline elapsed.".to_owned(),
                    ));
                    return Err(remote_error(
                        "deadline-exceeded",
                        "Remote Dependency invocation deadline elapsed.",
                        true,
                    ));
                }
            }
        };
        while let Ok(heartbeat) = heartbeat_receiver.try_recv() {
            validate_heartbeat(operation, &heartbeat, &request.dependency)?;
            self.emit(
                reply,
                &request.invocation.id,
                sequence,
                WireFramePayload::Heartbeat {
                    details: heartbeat.canonical_json()?,
                },
            )
            .await?;
        }
        match value {
            Ok(value) if operation.mode == DistributionOperationMode::Stream => loop {
                let next = engine.next(value.clone());
                tokio::pin!(next);
                let item = loop {
                    tokio::select! {
                            biased;
                            heartbeat = heartbeat_receiver.recv(), if heartbeats_open => {
                                match heartbeat {
                                    Some(heartbeat) => {
                                        validate_heartbeat(
                                            operation,
                                            &heartbeat,
                                            &request.dependency,
                                        )?;
                                        self.emit(
                                            reply,
                                            &request.invocation.id,
                                            sequence,
                                            WireFramePayload::Heartbeat {
                                                details: heartbeat.canonical_json()?,
                                            },
                                        ).await?;
                                    }
                                    None => heartbeats_open = false,
                                }
                    }
                    item = &mut next => break item?,
                    _ = cancellation.wait() => {
                        return Err(remote_error(
                            "cancelled",
                            cancellation.reason().unwrap_or_else(|| {
                                "Remote Dependency stream was cancelled.".to_owned()
                            }),
                            true,
                        ));
                    }
                    _ = wait_for_deadline(request.invocation.deadline) => {
                        cancellation.request_with_reason(Some(
                            "Remote Dependency stream deadline elapsed.".to_owned(),
                        ));
                        return Err(remote_error(
                            "deadline-exceeded",
                            "Remote Dependency stream deadline elapsed.",
                            true,
                        ));
                    }
                    }
                };
                while let Ok(heartbeat) = heartbeat_receiver.try_recv() {
                    validate_heartbeat(operation, &heartbeat, &request.dependency)?;
                    self.emit(
                        reply,
                        &request.invocation.id,
                        sequence,
                        WireFramePayload::Heartbeat {
                            details: heartbeat.canonical_json()?,
                        },
                    )
                    .await?;
                }
                match item {
                    Some(value) => {
                        validate_value(
                            &value,
                            &operation.output,
                            &format!(
                                "{}.{} remote stream item",
                                request.dependency, request.operation
                            ),
                        )?;
                        self.emit(
                            reply,
                            &request.invocation.id,
                            sequence,
                            WireFramePayload::Item {
                                value: value.canonical_json()?,
                            },
                        )
                        .await?;
                    }
                    None => {
                        self.emit(
                            reply,
                            &request.invocation.id,
                            sequence,
                            WireFramePayload::Complete,
                        )
                        .await?;
                        return Ok(());
                    }
                }
            },
            Ok(value) => {
                validate_value(
                    &value,
                    &operation.output,
                    &format!("{}.{} remote output", request.dependency, request.operation),
                )?;
                let payload = WireFramePayload::Result {
                    value: value.canonical_json()?,
                };
                self.emit(reply, &request.invocation.id, sequence, payload)
                    .await
            }
            Err(error) if operation.failures.contains_key(error.name.as_str()) => {
                let data = error.fields.get("data").cloned().unwrap_or(Value::Null);
                validate_value(
                    &data,
                    &operation.failures[error.name.as_str()],
                    &format!(
                        "{}.{} remote failure {}",
                        request.dependency, request.operation, error.name
                    ),
                )?;
                self.emit(
                    reply,
                    &request.invocation.id,
                    sequence,
                    WireFramePayload::Failure {
                        failure: WireFailure {
                            failure_type: error.name,
                            data: data.canonical_json()?,
                            message: error.message,
                            retry: error
                                .fields
                                .get("retryDelay")
                                .map(Value::number)
                                .transpose()?
                                .map(|delay| WireRetry { delay }),
                        },
                    },
                )
                .await
            }
            Err(error) => Err(error),
        }
    }

    async fn emit(
        &self,
        reply: &str,
        invocation: &str,
        sequence: &mut u64,
        payload: WireFramePayload,
    ) -> NativeResult<()> {
        *sequence += 1;
        self.publish_frame(
            reply,
            WireFrame {
                version: 1,
                invocation: invocation.to_owned(),
                sequence: *sequence,
                payload,
            },
        )
        .await
    }

    async fn publish_frame(&self, reply: &str, frame: WireFrame) -> NativeResult<()> {
        let payload = serde_json::to_vec(&frame).map_err(distribution_failure)?;
        self.client
            .publish(reply.to_owned(), payload.into())
            .await
            .map_err(distribution_failure)
    }

    async fn remote(
        &self,
        ownership: &ProcessOwnership,
        contract: &DistributionContract,
        operation: &DistributionOperation,
        input: Value,
        invocation: DependencyInvocation,
    ) -> NativeResult<Value> {
        let inbox = self.client.new_inbox();
        let responses = self
            .client
            .subscribe(inbox.clone())
            .await
            .map_err(distribution_failure)?;
        let authority = invocation
            .authority
            .as_ref()
            .ok_or_else(|| protocol("Routed Dependency invocation has no authority."))?;
        let request = WireRequest {
            version: 1,
            dependency: contract.name.to_owned(),
            operation: operation.name.to_owned(),
            contract: contract.identity.to_owned(),
            invocation: WireInvocation {
                id: invocation.id.clone(),
                attempt: invocation.attempt,
                scheduled_at: invocation.scheduled_at,
                started_at: invocation.started_at,
                deadline: invocation.deadline,
                previous_heartbeat: invocation
                    .previous_heartbeat
                    .as_ref()
                    .map(Value::canonical_json)
                    .transpose()?,
                trace: invocation.trace.as_ref().map(|trace| WireTrace {
                    traceparent: trace.traceparent.clone(),
                    tracestate: trace.tracestate.clone(),
                    baggage: trace.baggage.clone(),
                }),
                authority: Some(WireAuthority {
                    scope: authority.scope.clone(),
                    owner: authority.owner.clone(),
                    failure_epoch: authority.failure_epoch,
                    epoch: authority.epoch,
                    expires_at: authority.expires_at,
                }),
            },
            input: input.canonical_json()?,
        };
        let payload = serde_json::to_vec(&request).map_err(distribution_failure)?;
        self.client
            .publish_with_reply(ownership.target.clone(), inbox, payload.into())
            .await
            .map_err(distribution_failure)?;
        let session = RemoteSession {
            client: self.client.clone(),
            target: ownership.target.clone(),
            invocation,
            operation: operation.clone(),
            responses,
            sequence: 0,
            terminal: false,
        };
        if operation.mode == DistributionOperationMode::Stream {
            Ok(session.stream())
        } else {
            session.result().await
        }
    }
}

struct RemoteSession {
    client: Client,
    target: String,
    invocation: DependencyInvocation,
    operation: DistributionOperation,
    responses: Subscriber,
    sequence: u64,
    terminal: bool,
}

impl RemoteSession {
    async fn result(mut self) -> NativeResult<Value> {
        loop {
            match self.next_frame().await?.payload {
                WireFramePayload::Heartbeat { details } => {
                    let details = Value::from_canonical_json(&details);
                    validate_heartbeat(&self.operation, &details, "remote")?;
                    self.invocation.heartbeat(details)?;
                }
                WireFramePayload::Result { value } => {
                    self.terminal = true;
                    let value = Value::from_canonical_json(&value);
                    validate_value(&value, &self.operation.output, "remote Dependency output")?;
                    return Ok(value);
                }
                WireFramePayload::Failure { failure } => {
                    self.terminal = true;
                    return Err(wire_failure(failure, &self.operation)?);
                }
                WireFramePayload::Error { error } => {
                    self.terminal = true;
                    return Err(remote_error(error.code, error.message, error.uncertain));
                }
                WireFramePayload::Item { .. } | WireFramePayload::Complete => {
                    return Err(remote_error(
                        "invalid-response",
                        "Remote asynchronous Dependency returned a stream frame.",
                        true,
                    ));
                }
            }
        }
    }

    fn stream(mut self) -> Value {
        Value::stream(Box::pin(async_stream::try_stream! {
            loop {
                match self.next_frame().await?.payload {
                    WireFramePayload::Heartbeat { details } => {
                        let details = Value::from_canonical_json(&details);
                        validate_heartbeat(&self.operation, &details, "remote")?;
                        self.invocation
                            .heartbeat(details)?;
                    }
                    WireFramePayload::Item { value } => {
                        let value = Value::from_canonical_json(&value);
                        validate_value(
                            &value,
                            &self.operation.output,
                            "remote Dependency stream item",
                        )?;
                        yield value;
                    }
                    WireFramePayload::Complete => {
                        self.finish();
                        return;
                    }
                    WireFramePayload::Failure { failure } => {
                        self.finish();
                        Err(wire_failure(failure, &self.operation)?)?;
                    }
                    WireFramePayload::Error { error } => {
                        self.finish();
                        Err(remote_error(error.code, error.message, error.uncertain))?;
                    }
                    WireFramePayload::Result { .. } => {
                        Err(remote_error(
                            "invalid-response",
                            "Remote stream Dependency returned a result frame.",
                            true,
                        ))?;
                    }
                }
            }
        }))
    }

    async fn next_frame(&mut self) -> NativeResult<WireFrame> {
        if self.invocation.cancellation.requested() {
            let reason = self.invocation.cancellation.reason();
            self.cancel(reason.clone()).await;
            return Err(remote_error(
                "cancelled",
                reason.unwrap_or_else(|| "Remote Dependency invocation was cancelled.".to_owned()),
                true,
            ));
        }
        let cancellation = self.invocation.cancellation.clone();
        let deadline = self.invocation.deadline;
        let message = tokio::select! {
            response = self.responses.next() => response.ok_or_else(|| {
                remote_error(
                    "transport-closed",
                    "Remote Process closed without a terminal response.",
                    true,
                )
            })?,
            _ = cancellation.wait() => {
                let reason = cancellation.reason();
                self.cancel(reason.clone()).await;
                return Err(remote_error(
                    "cancelled",
                    reason.unwrap_or_else(|| {
                        "Remote Dependency invocation was cancelled.".to_owned()
                    }),
                    true,
                ));
            }
            _ = wait_for_deadline(deadline) => {
                self.cancel(Some("Remote Dependency invocation deadline elapsed.".to_owned()))
                    .await;
                return Err(remote_error(
                    "deadline-exceeded",
                    "Remote Dependency invocation deadline elapsed.",
                    true,
                ));
            }
        };
        let frame: WireFrame =
            serde_json::from_slice(&message.payload).map_err(distribution_failure)?;
        self.sequence += 1;
        if frame.version != 1
            || frame.invocation != self.invocation.id
            || frame.sequence != self.sequence
        {
            return Err(remote_error(
                "invalid-response",
                "Remote Dependency response frame is invalid or out of order.",
                true,
            ));
        }
        Ok(frame)
    }

    async fn cancel(&mut self, reason: Option<String>) {
        self.finish();
        publish_cancel(
            self.client.clone(),
            self.target.clone(),
            self.invocation.id.clone(),
            reason,
        )
        .await;
    }

    fn finish(&mut self) {
        self.terminal = true;
    }
}

impl Drop for RemoteSession {
    fn drop(&mut self) {
        if self.terminal {
            return;
        }
        let client = self.client.clone();
        let target = self.target.clone();
        let invocation = self.invocation.id.clone();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                publish_cancel(
                    client,
                    target,
                    invocation,
                    Some("Remote Dependency response was abandoned.".to_owned()),
                )
                .await;
            });
        }
    }
}

async fn publish_cancel(
    client: Client,
    target: String,
    invocation: String,
    reason: Option<String>,
) {
    let payload = serde_json::to_vec(&WireCancel {
        kind: "cancel".to_owned(),
        invocation,
        reason,
    });
    if let Ok(payload) = payload {
        let _ = client.publish(target, payload.into()).await;
    }
}

impl DependencyRouter for ProcessRouter {
    fn handles(&self, name: &str) -> bool {
        self.contracts.contains_key(name)
    }

    fn route(
        &self,
        engine: Engine,
        name: &str,
        operation_name: &str,
        input: Value,
        mut invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let name = name.to_owned();
        let operation_name = operation_name.to_owned();
        let contract = self.contracts.get(&name).cloned();
        let program = self.program.clone();
        let member = lock(&self.member).clone();
        let directory = self.directory.clone();
        let partition_count = self.partition_count;
        let ownership_lease = self.ownership_lease;
        let router = self.clone();
        Box::pin(async move {
            router.metrics.routed_calls.fetch_add(1, Ordering::Relaxed);
            if invocation.attempt > 1 {
                router.metrics.retries.fetch_add(1, Ordering::Relaxed);
            }
            if !router.healthy.load(Ordering::Acquire) || router.stopping.load(Ordering::Acquire) {
                router.metrics.rejections.fetch_add(1, Ordering::Relaxed);
                return Err(unavailable("Process distribution is unavailable."));
            }
            let _permit = router.admission.clone().try_acquire_owned().map_err(|_| {
                router.metrics.rejections.fetch_add(1, Ordering::Relaxed);
                unavailable("Process reached its invocation limit.")
            })?;
            let contract =
                contract.ok_or_else(|| protocol("Distributed Dependency is unknown."))?;
            let operation = contract
                .operations
                .iter()
                .find(|operation| operation.name == operation_name)
                .cloned()
                .ok_or_else(|| {
                    protocol(format!(
                        "Distributed Dependency {name:?} operation {operation_name:?} is unknown.",
                    ))
                })?;
            validate_value(
                &input,
                &operation.input,
                &format!("{name}.{operation_name} remote input"),
            )?;
            let partition = process_partition(
                &program,
                &contract,
                &input.canonical_json()?,
                partition_count,
            )?;
            let ownership = directory
                .locate(&partition, &member.contracts, now_millis(), ownership_lease)
                .await?;
            let authority = ProcessAuthority {
                scope: ownership.partition.scope.clone(),
                owner: ownership.owner.clone(),
                failure_epoch: ownership.failure_epoch,
                epoch: ownership.epoch,
            };
            let asserted_directory = directory.clone();
            let asserted_authority = authority.clone();
            invocation.id = if invocation.id.starts_with("direct:") {
                format!(
                    "process:{}:{}:{}",
                    member.id, member.failure_epoch, invocation.id
                )
            } else {
                invocation.id
            };
            invocation = invocation.with_authority(
                DependencyAuthority::new(
                    authority.scope.clone(),
                    authority.owner.clone(),
                    authority.failure_epoch,
                    authority.epoch,
                    ownership.expires_at,
                )
                .with_assertion(move || {
                    let directory = asserted_directory.clone();
                    let authority = asserted_authority.clone();
                    Box::pin(
                        async move { directory.assert_authority(&authority, now_millis()).await },
                    )
                }),
            );
            let result = if ownership.owner == member.id
                && ownership.failure_epoch == member.failure_epoch
            {
                router.metrics.local_calls.fetch_add(1, Ordering::Relaxed);
                directory.assert_authority(&authority, now_millis()).await?;
                let moved = lock(&router.owned)
                    .insert(authority.scope.clone(), authority.clone())
                    .is_none_or(|previous| previous.epoch != authority.epoch);
                if moved {
                    router
                        .metrics
                        .ownership_moves
                        .fetch_add(1, Ordering::Relaxed);
                }
                engine
                    .call_provided_with_invocation(&name, &operation_name, input, invocation)
                    .await
            } else {
                router.metrics.remote_calls.fetch_add(1, Ordering::Relaxed);
                router
                    .remote(&ownership, &contract, &operation, input, invocation)
                    .await
            };
            if result.is_err() {
                router.metrics.failures.fetch_add(1, Ordering::Relaxed);
            }
            result
        })
    }

    fn shutdown(&self) -> NativeFuture<()> {
        let router = self.clone();
        Box::pin(async move {
            router.healthy.store(false, Ordering::Release);
            let _ = router.drain_member().await;
            let renewal = { lock(&router.renewal).take() };
            if let Some(task) = renewal {
                task.abort();
                let _ = task.await;
            }
            let listener = { lock(&router.listener).take() };
            if let Some(task) = listener {
                task.abort();
                let _ = task.await;
            }
            let control = { lock(&router.control).take() };
            if let Some(task) = control {
                task.abort();
                let _ = task.await;
            }
            router.client.drain().await.map_err(distribution_failure)?;
            Ok(())
        })
    }
}

impl DirectoryState {
    fn expire(&mut self, now: f64) {
        let before = self.members.len();
        self.members.retain(|_, member| member.expires_at > now);
        if self.members.len() != before {
            self.revision += 1;
        }
    }

    fn join(
        &mut self,
        registration: ProcessRegistration,
        now: f64,
        lease_duration: f64,
    ) -> NativeResult<ProcessMember> {
        assert_lease(now, lease_duration)?;
        self.expire(now);
        if registration.id.is_empty()
            || registration.target.is_empty()
            || registration.program.is_empty()
            || registration.version.is_empty()
        {
            return Err(invalid(
                "Process identity, target, Program, and version are required.",
            ));
        }
        if self.members.contains_key(&registration.id) {
            return Err(placement(format!(
                "Process member {:?} is already active.",
                registration.id
            )));
        }
        let failure_epoch = self
            .failure_epochs
            .get(&registration.id)
            .copied()
            .unwrap_or_default()
            + 1;
        self.failure_epochs
            .insert(registration.id.clone(), failure_epoch);
        let member = ProcessMember {
            id: registration.id.clone(),
            target: registration.target,
            program: registration.program,
            version: registration.version,
            failure_epoch,
            status: MemberStatus::Active,
            contracts: registration.contracts,
            expires_at: now + lease_duration,
        };
        self.members.insert(registration.id, member.clone());
        self.revision += 1;
        Ok(member)
    }

    fn renew(
        &mut self,
        id: &str,
        failure_epoch: u64,
        now: f64,
        lease_duration: f64,
    ) -> NativeResult<ProcessMember> {
        assert_lease(now, lease_duration)?;
        self.expire(now);
        let member = self.current_member(id, failure_epoch)?.clone();
        if member.status != MemberStatus::Active {
            return Err(placement(format!("Process member {id:?} is draining.")));
        }
        let renewed = ProcessMember {
            expires_at: now + lease_duration,
            ..member
        };
        self.members.insert(id.to_owned(), renewed.clone());
        Ok(renewed)
    }

    fn drain(&mut self, id: &str, failure_epoch: u64, now: f64) -> NativeResult<()> {
        self.expire(now);
        let member = self.current_member(id, failure_epoch)?.clone();
        if member.status == MemberStatus::Draining {
            return Ok(());
        }
        self.members.insert(
            id.to_owned(),
            ProcessMember {
                status: MemberStatus::Draining,
                ..member
            },
        );
        self.revision += 1;
        Ok(())
    }

    fn leave(&mut self, id: &str, failure_epoch: u64, now: f64) -> NativeResult<()> {
        self.expire(now);
        self.current_member(id, failure_epoch)?;
        self.members.remove(id);
        self.revision += 1;
        Ok(())
    }

    fn locate(
        &mut self,
        partition: ProcessPartition,
        contracts: &BTreeMap<String, BTreeMap<String, String>>,
        now: f64,
        lease_duration: f64,
    ) -> NativeResult<ProcessOwnership> {
        assert_lease(now, lease_duration)?;
        self.expire(now);
        let candidates = self
            .members
            .values()
            .filter(|member| {
                member.program == partition.program
                    && member.status == MemberStatus::Active
                    && &member.contracts == contracts
            })
            .cloned()
            .collect::<Vec<_>>();
        let winner = rendezvous_owner(&partition.scope, &candidates).ok_or_else(|| {
            placement(format!(
                "No active Process has the exact contract for {}.",
                partition.dependency
            ))
        })?;
        if let Some(current) = self.ownership.get(&partition.scope)
            && current.owner == winner.id
            && current.failure_epoch == winner.failure_epoch
            && current.expires_at > now
        {
            return Ok(current.clone());
        }
        let epoch = self
            .ownership_epochs
            .get(&partition.scope)
            .copied()
            .unwrap_or_default()
            + 1;
        self.ownership_epochs.insert(partition.scope.clone(), epoch);
        let ownership = ProcessOwnership {
            partition: partition.clone(),
            owner: winner.id.clone(),
            target: winner.target.clone(),
            version: winner.version.clone(),
            failure_epoch: winner.failure_epoch,
            epoch,
            membership_revision: self.revision,
            expires_at: now + lease_duration,
        };
        self.ownership
            .insert(partition.scope.clone(), ownership.clone());
        Ok(ownership)
    }

    fn renew_ownership(
        &mut self,
        authority: &ProcessAuthority,
        now: f64,
        lease_duration: f64,
    ) -> NativeResult<ProcessOwnership> {
        assert_lease(now, lease_duration)?;
        let current = self.active_ownership(authority, now)?.clone();
        let renewed = ProcessOwnership {
            expires_at: now + lease_duration,
            ..current
        };
        self.ownership
            .insert(authority.scope.clone(), renewed.clone());
        Ok(renewed)
    }

    fn release_ownership(&mut self, authority: &ProcessAuthority, now: f64) -> NativeResult<()> {
        self.expire(now);
        let ownership = self.ownership.get(&authority.scope);
        let member = ownership.and_then(|ownership| self.members.get(&ownership.owner));
        if ownership.is_none_or(|ownership| {
            ownership.owner != authority.owner
                || ownership.failure_epoch != authority.failure_epoch
                || ownership.epoch != authority.epoch
                || ownership.expires_at <= now
                || member.is_none_or(|member| member.failure_epoch != ownership.failure_epoch)
        }) {
            return Err(stale(authority));
        }
        self.ownership.remove(&authority.scope);
        Ok(())
    }

    fn assert_authority(&mut self, authority: &ProcessAuthority, now: f64) -> NativeResult<()> {
        self.active_ownership(authority, now).map(|_| ())
    }

    fn current_member(&self, id: &str, failure_epoch: u64) -> NativeResult<&ProcessMember> {
        let member = self.members.get(id);
        if member.is_none_or(|member| member.failure_epoch != failure_epoch) {
            return Err(placement(format!(
                "Process member {id:?} failure epoch {failure_epoch} is not active."
            )));
        }
        Ok(member.expect("checked member"))
    }

    fn active_ownership(
        &mut self,
        authority: &ProcessAuthority,
        now: f64,
    ) -> NativeResult<&ProcessOwnership> {
        self.expire(now);
        let ownership = self.ownership.get(&authority.scope);
        let member = ownership.and_then(|ownership| self.members.get(&ownership.owner));
        if ownership.is_none_or(|ownership| {
            ownership.owner != authority.owner
                || ownership.failure_epoch != authority.failure_epoch
                || ownership.epoch != authority.epoch
                || ownership.expires_at <= now
                || member.is_none_or(|member| {
                    member.failure_epoch != ownership.failure_epoch
                        || member.status != MemberStatus::Active
                })
        }) {
            return Err(stale(authority));
        }
        Ok(ownership.expect("checked ownership"))
    }
}

fn process_partition(
    program: &str,
    contract: &DistributionContract,
    input: &serde_json::Value,
    partition_count: u64,
) -> NativeResult<ProcessPartition> {
    if partition_count == 0 {
        return Err(invalid("Process virtual partition count must be positive."));
    }
    let input = input
        .as_object()
        .ok_or_else(|| invalid("Distributed Dependency input must be an object."))?;
    let mut bindings = Vec::new();
    for name in &contract.bindings {
        let value = input.get(*name).ok_or_else(|| {
            invalid(format!(
                "Dependency {:?} routing input is missing binding {name:?}.",
                contract.name
            ))
        })?;
        bindings.push((name, value));
    }
    let identity =
        serde_json::to_string(&(program, contract.name, bindings)).map_err(serialization)?;
    let partition = u64::from(stable_hash(&identity)) % partition_count;
    Ok(ProcessPartition {
        scope: serde_json::to_string(&(
            "kit.process.partition",
            1,
            program,
            contract.name,
            partition,
        ))
        .map_err(serialization)?,
        program: program.to_owned(),
        dependency: contract.name.to_owned(),
        partition,
    })
}

fn rendezvous_owner<'a>(scope: &str, members: &'a [ProcessMember]) -> Option<&'a ProcessMember> {
    members.iter().max_by(|left, right| {
        let left_score = stable_hash(&format!("{scope}\0{}\0{}", left.id, left.failure_epoch));
        let right_score = stable_hash(&format!("{scope}\0{}\0{}", right.id, right.failure_epoch));
        left_score
            .cmp(&right_score)
            .then_with(|| right.id.cmp(&left.id))
    })
}

fn stable_hash(value: &str) -> u32 {
    let mut hash = 0x811c_9dc5_u32;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

fn assert_lease(now: f64, duration: f64) -> NativeResult<()> {
    if !now.is_finite() || !duration.is_finite() || duration <= 0.0 {
        return Err(invalid(
            "Process lease time and duration must be finite and positive.",
        ));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::new("InvalidProcessDistribution", message)
}

fn placement(message: impl Into<String>) -> NativeError {
    NativeError::new("ProcessPlacementError", message)
}

fn stale(authority: &ProcessAuthority) -> NativeError {
    NativeError::new(
        "StaleProcessAuthorityError",
        format!(
            "Process ownership {}@{} is stale.",
            authority.scope, authority.epoch
        ),
    )
}

fn serialization(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("ProcessDistributionSerialization", error.to_string())
}

fn distribution_failure(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("ProcessDistributionFailure", error.to_string())
}

fn subject_token(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(value)
}

fn validate_wire_invocation(invocation: &WireInvocation) -> NativeResult<()> {
    if invocation.id.is_empty()
        || invocation.attempt == 0
        || !invocation.scheduled_at.is_finite()
        || !invocation.started_at.is_finite()
        || invocation
            .deadline
            .is_some_and(|deadline| !deadline.is_finite())
        || invocation
            .trace
            .as_ref()
            .is_some_and(|trace| trace.traceparent.is_empty())
        || invocation.authority.as_ref().is_some_and(|authority| {
            authority.scope.is_empty()
                || authority.owner.is_empty()
                || authority.failure_epoch == 0
                || authority.epoch == 0
                || !authority.expires_at.is_finite()
        })
    {
        return Err(protocol("Dependency invocation metadata is invalid."));
    }
    if invocation
        .deadline
        .is_some_and(|deadline| deadline <= now_millis())
    {
        return Err(remote_error(
            "deadline-exceeded",
            "Dependency invocation deadline elapsed before execution.",
            false,
        ));
    }
    Ok(())
}

fn error_payload(error: NativeError) -> WireFramePayload {
    WireFramePayload::Error {
        error: WireError {
            code: error.name,
            message: error.message,
            uncertain: error
                .fields
                .get("uncertain")
                .and_then(|value| match value {
                    Value::Boolean(value) => Some(*value),
                    _ => None,
                })
                .unwrap_or(false),
        },
    }
}

fn validate_heartbeat(
    operation: &DistributionOperation,
    value: &Value,
    dependency: &str,
) -> NativeResult<()> {
    let contract = operation
        .heartbeat
        .as_ref()
        .ok_or_else(|| protocol("Dependency emitted an undeclared heartbeat."))?;
    validate_value(
        value,
        contract,
        &format!("{dependency}.{} remote heartbeat", operation.name),
    )
}

fn wire_failure(
    failure: WireFailure,
    operation: &DistributionOperation,
) -> NativeResult<NativeError> {
    let contract = operation
        .failures
        .get(failure.failure_type.as_str())
        .ok_or_else(|| protocol("Remote Dependency returned an undeclared failure."))?;
    let data = Value::from_canonical_json(&failure.data);
    validate_value(
        &data,
        contract,
        &format!("remote Dependency failure {}", failure.failure_type),
    )?;
    let mut error =
        NativeError::new(failure.failure_type, failure.message).with_field("data", data);
    if let Some(retry) = failure.retry {
        error = error.with_field("retryDelay", Value::Number(retry.delay));
    }
    Ok(error)
}

async fn wait_for_deadline(deadline: Option<f64>) {
    match deadline {
        Some(deadline) => {
            tokio::time::sleep(Duration::from_secs_f64(
                ((deadline - now_millis()).max(0.0)) / 1_000.0,
            ))
            .await;
        }
        None => pending::<()>().await,
    }
}

fn protocol(message: impl Into<String>) -> NativeError {
    remote_error("invalid-request", message, false)
}

fn unavailable(message: impl Into<String>) -> NativeError {
    remote_error("process-unavailable", message, true)
}

fn remote_error(
    code: impl Into<String>,
    message: impl Into<String>,
    uncertain: bool,
) -> NativeError {
    NativeError::new(code, message).with_field("uncertain", Value::Boolean(uncertain))
}

fn environment(name: &str, default: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.to_owned())
}

fn environment_u64(name: &str, default: u64) -> NativeResult<u64> {
    let value = environment(name, &default.to_string())
        .parse::<u64>()
        .map_err(|error| invalid(format!("{name} is invalid: {error}")))?;
    if value == 0 {
        return Err(invalid(format!("{name} must be positive.")));
    }
    Ok(value)
}

fn environment_duration(name: &str, default: f64) -> NativeResult<f64> {
    let value = environment(name, &default.to_string())
        .parse::<f64>()
        .map_err(|error| invalid(format!("{name} is invalid: {error}")))?;
    if !value.is_finite() || value <= 0.0 {
        return Err(invalid(format!("{name} must be finite and positive.")));
    }
    Ok(value)
}

fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as f64)
        .unwrap_or_default()
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::OsString,
        fs,
        net::{TcpListener, TcpStream},
        process::{Child, Command, Stdio},
        thread,
    };

    use serde_json::json;

    use super::*;
    use kit_server_runtime::FieldContract;

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

    struct TestEnvironment(Vec<(String, Option<OsString>)>);

    impl TestEnvironment {
        fn set(values: &[(&str, String)]) -> Self {
            let previous = values
                .iter()
                .map(|(name, _)| ((*name).to_owned(), std::env::var_os(name)))
                .collect();
            for (name, value) in values {
                // This test owns these adapter variables for its full process lifetime.
                unsafe { std::env::set_var(name, value) };
            }
            Self(previous)
        }

        fn replace(&self, name: &str, value: &str) {
            // The only concurrent tests in this crate do not read adapter variables.
            unsafe { std::env::set_var(name, value) };
        }
    }

    impl Drop for TestEnvironment {
        fn drop(&mut self) {
            for (name, value) in self.0.drain(..) {
                match value {
                    Some(value) => {
                        // Restore the process environment captured by this test.
                        unsafe { std::env::set_var(name, value) };
                    }
                    None => {
                        // Restore the process environment captured by this test.
                        unsafe { std::env::remove_var(name) };
                    }
                }
            }
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
        let directory = std::env::temp_dir().join(format!(
            "kit-distribution-{}-{}",
            std::process::id(),
            now_millis()
        ));
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

    fn contracts(identity: &str) -> BTreeMap<String, BTreeMap<String, String>> {
        BTreeMap::from([(
            "counter".to_owned(),
            BTreeMap::from([("add".to_owned(), identity.to_owned())]),
        )])
    }

    fn registration(id: &str, target: &str) -> ProcessRegistration {
        registration_with(id, target, contracts("contract"))
    }

    fn registration_with(
        id: &str,
        target: &str,
        contracts: BTreeMap<String, BTreeMap<String, String>>,
    ) -> ProcessRegistration {
        ProcessRegistration {
            id: id.to_owned(),
            target: target.to_owned(),
            program: "server".to_owned(),
            version: "one".to_owned(),
            contracts,
        }
    }

    fn service_contract() -> DistributionContract {
        let input = || {
            TypeContract::Record(vec![
                FieldContract {
                    name: "key",
                    optional: false,
                    value: TypeContract::Primitive("string"),
                },
                FieldContract {
                    name: "value",
                    optional: false,
                    value: TypeContract::Primitive("number"),
                },
            ])
        };
        let unavailable = || {
            TypeContract::Record(vec![FieldContract {
                name: "retryAt",
                optional: false,
                value: TypeContract::Primitive("number"),
            }])
        };
        let tenant_input = || {
            TypeContract::Record(vec![
                FieldContract {
                    name: "key",
                    optional: false,
                    value: TypeContract::Primitive("string"),
                },
                FieldContract {
                    name: "tenant",
                    optional: false,
                    value: TypeContract::Primitive("string"),
                },
                FieldContract {
                    name: "token",
                    optional: false,
                    value: TypeContract::Primitive("string"),
                },
            ])
        };
        let tenant = || {
            TypeContract::Record(vec![FieldContract {
                name: "tenant",
                optional: false,
                value: TypeContract::Primitive("string"),
            }])
        };
        DistributionContract {
            name: "service",
            identity: "service-v1",
            bindings: vec!["key"],
            operations: vec![
                DistributionOperation {
                    name: "authorize",
                    identity: "authorize-v1",
                    mode: DistributionOperationMode::Asynchronous,
                    input: tenant_input(),
                    output: tenant(),
                    heartbeat: None,
                    failures: BTreeMap::from([("forbidden", tenant())]),
                },
                DistributionOperation {
                    name: "badFailure",
                    identity: "bad-failure-v1",
                    mode: DistributionOperationMode::Asynchronous,
                    input: input(),
                    output: TypeContract::Primitive("void"),
                    heartbeat: None,
                    failures: BTreeMap::from([("unavailable", unavailable())]),
                },
                DistributionOperation {
                    name: "badHeartbeat",
                    identity: "bad-heartbeat-v1",
                    mode: DistributionOperationMode::Asynchronous,
                    input: input(),
                    output: TypeContract::Primitive("number"),
                    heartbeat: Some(TypeContract::Record(vec![FieldContract {
                        name: "completed",
                        optional: false,
                        value: TypeContract::Primitive("number"),
                    }])),
                    failures: BTreeMap::new(),
                },
                DistributionOperation {
                    name: "badOutput",
                    identity: "bad-output-v1",
                    mode: DistributionOperationMode::Asynchronous,
                    input: input(),
                    output: TypeContract::Primitive("number"),
                    heartbeat: None,
                    failures: BTreeMap::new(),
                },
                DistributionOperation {
                    name: "badStream",
                    identity: "bad-stream-v1",
                    mode: DistributionOperationMode::Stream,
                    input: input(),
                    output: TypeContract::Primitive("number"),
                    heartbeat: None,
                    failures: BTreeMap::new(),
                },
                DistributionOperation {
                    name: "changes",
                    identity: "changes-v1",
                    mode: DistributionOperationMode::Stream,
                    input: input(),
                    output: TypeContract::Primitive("number"),
                    heartbeat: None,
                    failures: BTreeMap::new(),
                },
                DistributionOperation {
                    name: "fail",
                    identity: "fail-v1",
                    mode: DistributionOperationMode::Asynchronous,
                    input: input(),
                    output: TypeContract::Primitive("void"),
                    heartbeat: None,
                    failures: BTreeMap::from([("unavailable", unavailable())]),
                },
                DistributionOperation {
                    name: "wait",
                    identity: "wait-v1",
                    mode: DistributionOperationMode::Asynchronous,
                    input: input(),
                    output: TypeContract::Primitive("boolean"),
                    heartbeat: None,
                    failures: BTreeMap::new(),
                },
                DistributionOperation {
                    name: "watch",
                    identity: "watch-v1",
                    mode: DistributionOperationMode::Stream,
                    input: input(),
                    output: TypeContract::Primitive("number"),
                    heartbeat: None,
                    failures: BTreeMap::new(),
                },
                DistributionOperation {
                    name: "work",
                    identity: "work-v1",
                    mode: DistributionOperationMode::Asynchronous,
                    input: input(),
                    output: TypeContract::Primitive("number"),
                    heartbeat: Some(TypeContract::Record(vec![FieldContract {
                        name: "completed",
                        optional: false,
                        value: TypeContract::Primitive("number"),
                    }])),
                    failures: BTreeMap::new(),
                },
            ],
        }
    }

    fn provide_service(engine: &Engine, abandoned: Arc<AtomicBool>) -> NativeResult<()> {
        engine.declare_provided(&["service"])?;
        let dispatcher = kit_server_runtime::NativeFunction::new(move |engine, mut arguments| {
            let abandoned = abandoned.clone();
            Box::pin(async move {
                if arguments.len() != 3 {
                    return Err(invalid("Service dispatcher requires three arguments."));
                }
                let invocation = arguments.pop().expect("checked arguments");
                let input = arguments.pop().expect("checked arguments");
                let operation = arguments.pop().expect("checked arguments").string()?;
                match operation.as_str() {
                    "authorize" => {
                        let tenant = input.property("tenant", false)?.string()?;
                        let token = input.property("token", false)?.string()?;
                        if token != "allowed" {
                            return Err(NativeError::new("forbidden", "Tenant access denied.")
                                .with_field(
                                    "data",
                                    Value::record([("tenant".to_owned(), Value::String(tenant))]),
                                ));
                        }
                        Ok(Value::record([(
                            "tenant".to_owned(),
                            Value::String(tenant),
                        )]))
                    }
                    "badFailure" => Err(NativeError::new(
                        "unavailable",
                        "Malformed service failure.",
                    )
                    .with_field(
                        "data",
                        Value::record([("retryAt".to_owned(), Value::String("later".to_owned()))]),
                    )),
                    "badHeartbeat" => {
                        let heartbeat = invocation.property("heartbeat", false)?;
                        engine
                            .invoke(
                                heartbeat,
                                vec![Value::record([(
                                    "details".to_owned(),
                                    Value::record([(
                                        "completed".to_owned(),
                                        Value::String("done".to_owned()),
                                    )]),
                                )])],
                            )
                            .await?;
                        Ok(Value::Number(1.0))
                    }
                    "badOutput" => Ok(Value::String("one".to_owned())),
                    "badStream" => Ok(Value::stream(Box::pin(async_stream::try_stream! {
                        yield Value::String("one".to_owned());
                    }))),
                    "changes" => Ok(Value::stream(Box::pin(async_stream::try_stream! {
                        yield Value::Number(1.0);
                        yield Value::Number(2.0);
                    }))),
                    "fail" => Err(NativeError::new("unavailable", "Service unavailable.")
                        .with_field(
                            "data",
                            Value::record([("retryAt".to_owned(), Value::Number(20.0))]),
                        )
                        .with_field("retryDelay", Value::Number(5.0))),
                    "wait" => {
                        let cancellation = invocation.property("cancellation", false)?;
                        engine.method(cancellation, "wait", Vec::new()).await?;
                        Ok(Value::Boolean(true))
                    }
                    "watch" => {
                        let cancellation = invocation.property("cancellation", false)?;
                        Ok(Value::stream(Box::pin(async_stream::try_stream! {
                            yield Value::Number(1.0);
                            engine.method(cancellation, "wait", Vec::new()).await?;
                            abandoned.store(true, Ordering::Release);
                        })))
                    }
                    "work" => {
                        let heartbeat = invocation.property("heartbeat", false)?;
                        let value = input.property("value", false)?.number()?;
                        if value == 3.0 {
                            let trace = invocation.property("trace", false)?;
                            let traceparent = trace.property("traceparent", false)?.string()?;
                            let baggage = trace.property("baggage", false)?.string()?;
                            if traceparent != "00-abc-def-01" || baggage != "tenant=acme" {
                                return Err(protocol("Dependency trace was not preserved."));
                            }
                        }
                        engine
                            .invoke(
                                heartbeat,
                                vec![Value::record([(
                                    "details".to_owned(),
                                    Value::record([("completed".to_owned(), Value::Number(value))]),
                                )])],
                            )
                            .await?;
                        Ok(Value::Number(value * 2.0))
                    }
                    _ => Err(invalid("Unknown service operation.")),
                }
            })
        });
        engine.provide(
            &["service"],
            Value::record([(
                "service".to_owned(),
                Value::record([(
                    "@dependencyInvocation".to_owned(),
                    Value::Function(dispatcher),
                )]),
            )]),
        )
    }

    fn partition(index: u64) -> ProcessPartition {
        ProcessPartition {
            scope: format!("partition:{index}"),
            program: "server".to_owned(),
            dependency: "counter".to_owned(),
            partition: index,
        }
    }

    #[test]
    fn matches_the_typescript_utf16_partition_hash() {
        let contract = DistributionContract {
            name: "counter",
            identity: "counter-v1",
            bindings: vec!["key"],
            operations: Vec::new(),
        };
        assert_eq!(
            process_partition(
                "server",
                &contract,
                &json!({ "key": "inventory-\u{1f680}" }),
                1_024
            )
            .expect("partition")
            .partition,
            519
        );
    }

    #[test]
    fn joins_places_fences_drains_and_restarts_processes() {
        let mut directory = DirectoryState::default();
        let first = directory
            .join(registration("first", "first-target"), 0.0, 100.0)
            .expect("join first");
        let second = directory
            .join(registration("second", "second-target"), 0.0, 100.0)
            .expect("join second");
        assert_eq!(first.failure_epoch, 1);
        assert_eq!(second.failure_epoch, 1);

        let located = directory
            .locate(partition(7), &first.contracts, 1.0, 20.0)
            .expect("locate");
        let authority = ProcessAuthority {
            scope: located.partition.scope.clone(),
            owner: located.owner.clone(),
            failure_epoch: located.failure_epoch,
            epoch: located.epoch,
        };
        directory
            .assert_authority(&authority, 2.0)
            .expect("current authority");
        directory
            .drain(&located.owner, located.failure_epoch, 2.0)
            .expect("drain owner");
        assert_eq!(
            directory
                .assert_authority(&authority, 2.0)
                .expect_err("stale authority")
                .name,
            "StaleProcessAuthorityError"
        );
        let relocated = directory
            .locate(partition(7), &first.contracts, 2.0, 20.0)
            .expect("relocate");
        assert_ne!(relocated.owner, located.owner);
        assert!(relocated.epoch > located.epoch);

        directory
            .leave(&located.owner, located.failure_epoch, 2.0)
            .expect("leave");
        let restarted = directory
            .join(registration(&located.owner, &located.target), 3.0, 100.0)
            .expect("restart");
        assert_eq!(restarted.failure_epoch, 2);
    }

    #[test]
    fn renews_membership_and_ownership_without_changing_failure_identity() {
        let mut directory = DirectoryState::default();
        let member = directory
            .join(registration("worker", "target"), 0.0, 10.0)
            .expect("join");
        let renewed = directory
            .renew(&member.id, member.failure_epoch, 5.0, 10.0)
            .expect("renew member");
        assert_eq!(renewed.failure_epoch, member.failure_epoch);
        assert_eq!(renewed.expires_at, 15.0);
        let ownership = directory
            .locate(partition(1), &member.contracts, 5.0, 5.0)
            .expect("locate");
        let authority = ProcessAuthority {
            scope: ownership.partition.scope.clone(),
            owner: ownership.owner,
            failure_epoch: ownership.failure_epoch,
            epoch: ownership.epoch,
        };
        let renewed = directory
            .renew_ownership(&authority, 8.0, 5.0)
            .expect("renew ownership");
        assert_eq!(renewed.epoch, authority.epoch);
        assert_eq!(renewed.expires_at, 13.0);
        directory
            .release_ownership(&authority, 9.0)
            .expect("release ownership");
    }

    #[test]
    fn places_only_members_with_the_exact_whole_program_contract() {
        let mut directory = DirectoryState::default();
        let contracts = BTreeMap::from([(
            "service".to_owned(),
            BTreeMap::from([("work".to_owned(), "work-v1".to_owned())]),
        )]);
        let changed = BTreeMap::from([(
            "service".to_owned(),
            BTreeMap::from([("work".to_owned(), "work-v2".to_owned())]),
        )]);
        let first = directory
            .join(
                registration_with("first", "first-target", contracts.clone()),
                0.0,
                100.0,
            )
            .expect("join current member");
        directory
            .join(
                registration_with("second", "second-target", changed),
                0.0,
                100.0,
            )
            .expect("join changed member");
        let partition = ProcessPartition {
            scope: "contract-partition".to_owned(),
            program: "server".to_owned(),
            dependency: "service".to_owned(),
            partition: 1,
        };
        let placed = directory
            .locate(partition.clone(), &contracts, 1.0, 10.0)
            .expect("place current contract");
        assert_eq!(placed.owner, first.id);

        directory
            .drain(&first.id, first.failure_epoch, 2.0)
            .expect("drain current member");
        assert_eq!(
            directory
                .locate(partition.clone(), &contracts, 2.0, 10.0)
                .expect_err("changed member is excluded")
                .name,
            "ProcessPlacementError"
        );

        let extra_operation = BTreeMap::from([(
            "service".to_owned(),
            BTreeMap::from([
                ("inspect".to_owned(), "inspect-v1".to_owned()),
                ("work".to_owned(), "work-v1".to_owned()),
            ]),
        )]);
        let next = directory
            .join(
                registration_with("next", "next-target", extra_operation),
                3.0,
                100.0,
            )
            .expect("join extra-operation member");
        assert_eq!(
            directory
                .locate(partition.clone(), &contracts, 3.0, 10.0)
                .expect_err("extra-operation member is excluded")
                .name,
            "ProcessPlacementError"
        );
        directory
            .drain(&next.id, next.failure_epoch, 4.0)
            .expect("drain extra-operation member");
        let exact = directory
            .join(
                registration_with("exact", "exact-target", contracts.clone()),
                4.0,
                100.0,
            )
            .expect("join exact member");
        let placed = directory
            .locate(partition, &contracts, 4.0, 10.0)
            .expect("place exact contract");
        assert_eq!(placed.owner, exact.id);
    }

    #[tokio::test]
    async fn preserves_generic_remote_dependency_controls_and_streams_over_nats() {
        let Some((mut server, url)) = start_test_nats() else {
            return;
        };
        let cluster = format!("distribution-test-{}", std::process::id());
        let environment = TestEnvironment::set(&[
            ("KIT_NATS_URL", url.clone()),
            ("KIT_PROCESS_CLUSTER", cluster.clone()),
            (
                "KIT_DISTRIBUTION_STREAM",
                format!("KIT_DISTRIBUTION_TEST_{}", std::process::id()),
            ),
            ("KIT_PROCESS_MEMBERSHIP_LEASE_MS", "2000".to_owned()),
            ("KIT_PROCESS_OWNERSHIP_LEASE_MS", "1000".to_owned()),
            ("KIT_PROCESS_MAX_INFLIGHT", "1".to_owned()),
            ("KIT_PROCESS_PARTITIONS", "64".to_owned()),
            ("KIT_PROCESS_ID", "p1".to_owned()),
        ]);
        let contract = service_contract();
        let first = Engine::new();
        let first_abandoned = Arc::new(AtomicBool::new(false));
        provide_service(&first, first_abandoned.clone()).expect("provide first service");
        assert!(
            start(first.clone(), "server", "one", vec![contract.clone()])
                .await
                .expect("start first router")
        );
        environment.replace("KIT_PROCESS_ID", "p2");
        let second = Engine::new();
        provide_service(&second, Arc::new(AtomicBool::new(false))).expect("provide second service");
        assert!(
            start(second.clone(), "server", "one", vec![contract.clone()])
                .await
                .expect("start second router")
        );

        let key = key_owned_by("p1", &contract);
        let input = |value: f64| {
            Value::record([
                ("key".to_owned(), Value::String(key.clone())),
                ("value".to_owned(), Value::Number(value)),
            ])
        };
        let heartbeats = Arc::new(Mutex::new(Vec::new()));
        let received = heartbeats.clone();
        let now = now_millis();
        let result = second
            .call_dependency_with_invocation(
                "service",
                "work",
                input(3.0),
                DependencyInvocation::new("work-one", 1, now, now, None)
                    .with_trace(
                        "00-abc-def-01",
                        Some("vendor=one".to_owned()),
                        Some("tenant=acme".to_owned()),
                    )
                    .with_controls(
                        None,
                        move |value| {
                            lock(&received).push(value);
                            Ok(())
                        },
                        DependencyCancellation::default(),
                    ),
            )
            .await
            .expect("remote work");
        assert_eq!(result.number().expect("work result"), 6.0);
        assert_eq!(
            lock(&heartbeats)[0]
                .property("completed", false)
                .expect("heartbeat completed")
                .number()
                .expect("heartbeat number"),
            3.0
        );

        let authorized = second
            .call_dependency(
                "service",
                "authorize",
                Value::record([
                    ("key".to_owned(), Value::String(key.clone())),
                    ("tenant".to_owned(), Value::String("acme".to_owned())),
                    ("token".to_owned(), Value::String("allowed".to_owned())),
                ]),
            )
            .await
            .expect("authorized remote call");
        assert_eq!(
            authorized
                .property("tenant", false)
                .expect("authorized tenant")
                .string()
                .expect("tenant string"),
            "acme"
        );
        let forbidden = second
            .call_dependency(
                "service",
                "authorize",
                Value::record([
                    ("key".to_owned(), Value::String(key.clone())),
                    ("tenant".to_owned(), Value::String("other".to_owned())),
                    ("token".to_owned(), Value::String("denied".to_owned())),
                ]),
            )
            .await
            .expect_err("typed authorization failure");
        assert_eq!(forbidden.name, "forbidden");
        assert_eq!(
            forbidden
                .fields
                .get("data")
                .expect("failure data")
                .property("tenant", false)
                .expect("failed tenant")
                .string()
                .expect("failed tenant string"),
            "other"
        );

        let stream = second
            .call_dependency("service", "changes", input(0.0))
            .await
            .expect("remote stream");
        assert_eq!(
            second
                .next(stream.clone())
                .await
                .expect("first stream item")
                .expect("first item")
                .number()
                .expect("first number"),
            1.0
        );
        assert_eq!(
            second
                .next(stream.clone())
                .await
                .expect("second stream item")
                .expect("second item")
                .number()
                .expect("second number"),
            2.0
        );
        assert!(
            second
                .next(stream)
                .await
                .expect("stream completion")
                .is_none()
        );

        let abandoned = second
            .call_dependency("service", "watch", input(0.0))
            .await
            .expect("remote watched stream");
        assert_eq!(
            second
                .next(abandoned.clone())
                .await
                .expect("watched stream item")
                .expect("first watched item")
                .number()
                .expect("watched number"),
            1.0
        );
        drop(abandoned);
        for _ in 0..100 {
            if first_abandoned.load(Ordering::Acquire) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(first_abandoned.load(Ordering::Acquire));

        let failure = second
            .call_dependency("service", "fail", input(0.0))
            .await
            .expect_err("declared failure");
        assert_eq!(failure.name, "unavailable");
        assert_eq!(
            failure
                .fields
                .get("retryDelay")
                .expect("retry delay")
                .number()
                .expect("retry number"),
            5.0
        );

        let invalid_input = second
            .call_dependency(
                "service",
                "work",
                Value::record([("key".to_owned(), Value::String(key.clone()))]),
            )
            .await
            .expect_err("invalid remote input");
        assert_eq!(invalid_input.name, "DependencyContractViolation");

        for operation in ["badFailure", "badHeartbeat", "badOutput"] {
            let violation = second
                .call_dependency("service", operation, input(0.0))
                .await
                .expect_err("invalid provider value");
            assert_eq!(violation.name, "DependencyContractViolation");
        }

        let malformed_stream = second
            .call_dependency("service", "badStream", input(0.0))
            .await
            .expect("malformed stream handle");
        let violation = second
            .next(malformed_stream)
            .await
            .expect_err("invalid stream item");
        assert_eq!(violation.name, "DependencyContractViolation");

        let cancellation = DependencyCancellation::default();
        let cancelled = {
            let engine = second.clone();
            let cancellation = cancellation.clone();
            let input = input(0.0);
            tokio::spawn(async move {
                engine
                    .call_dependency_with_invocation(
                        "service",
                        "wait",
                        input,
                        DependencyInvocation::new("wait-one", 1, now, now, None).with_controls(
                            None,
                            |_| Ok(()),
                            cancellation,
                        ),
                    )
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        let overloaded = second
            .call_dependency("service", "wait", input(0.0))
            .await
            .expect_err("bounded remote admission");
        assert_eq!(overloaded.name, "process-unavailable");
        cancellation.request_with_reason(Some("stop".to_owned()));
        let cancelled = cancelled
            .await
            .expect("join cancelled call")
            .expect_err("cancel remote call");
        assert_eq!(cancelled.name, "cancelled");

        let deadline = second
            .call_dependency_with_invocation(
                "service",
                "wait",
                input(0.0),
                DependencyInvocation::new(
                    "deadline-one",
                    1,
                    now_millis(),
                    now_millis(),
                    Some(now_millis() + 50.0),
                ),
            )
            .await
            .expect_err("remote deadline");
        assert_eq!(deadline.name, "deadline-exceeded");

        let control = async_nats::connect(&url).await.expect("control client");
        let control_subject = |id: &str| {
            format!(
                "kit.process.control.{}.{}.{}",
                subject_token(&cluster),
                subject_token("server"),
                subject_token(id),
            )
        };
        let status = control
            .request(
                control_subject("p2"),
                serde_json::to_vec(&json!({ "operation": "status" }))
                    .expect("status request")
                    .into(),
            )
            .await
            .expect("status response");
        let status: WireControlResponse =
            serde_json::from_slice(&status.payload).expect("status payload");
        assert!(status.healthy);
        assert!(status.ready);
        assert_eq!(status.capacity, 1);
        assert!(status.metrics.routed_calls > 0);
        assert!(status.metrics.remote_calls > 0);
        assert!(status.metrics.rejections > 0);

        let rebalanced = control
            .request(
                control_subject("p1"),
                serde_json::to_vec(&json!({ "operation": "rebalance" }))
                    .expect("rebalance request")
                    .into(),
            )
            .await
            .expect("rebalance response");
        let rebalanced: WireControlResponse =
            serde_json::from_slice(&rebalanced.payload).expect("rebalance payload");
        assert!(rebalanced.ownership.is_empty());

        let drained = control
            .request(
                control_subject("p2"),
                serde_json::to_vec(&json!({ "operation": "drain" }))
                    .expect("drain request")
                    .into(),
            )
            .await
            .expect("drain response");
        let drained: WireControlResponse =
            serde_json::from_slice(&drained.payload).expect("drain payload");
        assert!(!drained.ready);
        let rejected = second
            .call_dependency("service", "work", input(1.0))
            .await
            .expect_err("drained Process rejects work");
        assert_eq!(rejected.name, "process-unavailable");

        server.child.kill().expect("stop NATS");
        server.child.wait().expect("join NATS");
        tokio::time::sleep(Duration::from_millis(1_200)).await;
        let unavailable = first
            .call_dependency("service", "work", input(1.0))
            .await
            .expect_err("fail closed after lease renewal loss");
        assert_eq!(unavailable.name, "process-unavailable");
    }

    fn key_owned_by(owner: &str, contract: &DistributionContract) -> String {
        let contracts = BTreeMap::from([(
            "service".to_owned(),
            contract
                .operations
                .iter()
                .map(|operation| (operation.name.to_owned(), operation.identity.to_owned()))
                .collect(),
        )]);
        let members = ["p1", "p2"]
            .map(|id| ProcessMember {
                id: id.to_owned(),
                target: format!("target-{id}"),
                program: "server".to_owned(),
                version: "one".to_owned(),
                failure_epoch: 1,
                status: MemberStatus::Active,
                contracts: contracts.clone(),
                expires_at: f64::MAX,
            })
            .to_vec();
        for index in 0..10_000 {
            let key = format!("key-{index}");
            let partition =
                process_partition("server", contract, &json!({ "key": key, "value": 0 }), 64)
                    .expect("partition");
            if rendezvous_owner(&partition.scope, &members).is_some_and(|member| member.id == owner)
            {
                return key;
            }
        }
        panic!("Unable to find a key owned by {owner}.");
    }
}
