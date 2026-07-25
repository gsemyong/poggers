import {
  dependencyOperationIdentity,
  type DependencyContractIR,
  type DependencyOperationIR,
} from "@/compiler/ir";
import { cloneData } from "@/core/data";
import {
  createDeferredDependencyInvocation,
  DependencyFailureError,
  dependencyInvocation,
  dependencyInvocationControl,
  invokeDependency,
  isDeferredDependencyInvocation,
  type DependencyInvocation,
  type DependencyInvocationAuthority,
} from "@/core/dependency";
import {
  assertDependencyFailure,
  assertRuntimeType,
  conformExternalDependencies,
} from "@/runtime/process";

export const DEPENDENCY_PROTOCOL_VERSION = 1 as const;

type WireInvocation = Readonly<{
  id: string;
  attempt: number;
  scheduledAt: number;
  startedAt: number;
  deadline?: number;
  previousHeartbeat?: unknown;
  trace?: DependencyInvocation["trace"];
  authority?: Omit<DependencyInvocationAuthority, "assert">;
}>;

export type DependencyWireRequest = Readonly<{
  version: typeof DEPENDENCY_PROTOCOL_VERSION;
  dependency: string;
  operation: string;
  contract: string;
  invocation: WireInvocation;
  input: unknown;
}>;

type WireFrameBase = Readonly<{
  version: typeof DEPENDENCY_PROTOCOL_VERSION;
  invocation: string;
  sequence: number;
}>;

export type DependencyWireFrame =
  | (WireFrameBase & Readonly<{ kind: "heartbeat"; details: unknown }>)
  | (WireFrameBase & Readonly<{ kind: "result"; value: unknown }>)
  | (WireFrameBase & Readonly<{ kind: "deferred"; id: string }>)
  | (WireFrameBase & Readonly<{ kind: "item"; value: unknown }>)
  | (WireFrameBase & Readonly<{ kind: "complete" }>)
  | (WireFrameBase &
      Readonly<{
        kind: "failure";
        failure: Readonly<{
          type: string;
          data: unknown;
          message?: string;
          retry?: Readonly<{ delay: number }>;
        }>;
      }>)
  | (WireFrameBase &
      Readonly<{
        kind: "error";
        error: Readonly<{ code: string; message: string; uncertain: boolean }>;
      }>);
type WireFramePayload = DependencyWireFrame extends infer Frame
  ? Frame extends unknown
    ? Omit<Frame, keyof WireFrameBase>
    : never
  : never;

export type DependencyTransportSession = Readonly<{
  frames: AsyncIterable<DependencyWireFrame>;
  /** Requests provider cancellation and terminates the response stream. */
  cancel(reason?: string): void;
}>;

export type DependencyTransport = Readonly<{
  open(
    input: Readonly<{ target: string; request: DependencyWireRequest }>,
  ): DependencyTransportSession;
}>;

export type DependencyRequestHandler = Readonly<{
  open(request: DependencyWireRequest): DependencyTransportSession;
}>;

export type DependencyRequestAdmissionResult = Readonly<{
  release?(): void;
  assertAuthority?(): void | PromiseLike<void>;
}>;

export type DependencyRequestAdmission = (
  input: Readonly<{
    request: DependencyWireRequest;
    dependency: DependencyContractIR;
    operation: DependencyOperationIR;
  }>,
) =>
  | void
  | (() => void)
  | DependencyRequestAdmissionResult
  | PromiseLike<void | (() => void) | DependencyRequestAdmissionResult>;

export class RemoteDependencyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly uncertain: boolean,
  ) {
    super(message);
    this.name = "RemoteDependencyError";
  }
}

export function encodeDependencyWireMessage(
  message: DependencyWireRequest | DependencyWireFrame,
): string {
  return JSON.stringify(cloneData(message, "Dependency wire message"));
}

export function decodeDependencyWireRequest(message: string): DependencyWireRequest {
  const value = decodeWireMessage(message);
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    !("dependency" in value) ||
    !("operation" in value) ||
    !("contract" in value) ||
    !("invocation" in value)
  ) {
    throw new RemoteDependencyError("invalid-request", "Dependency request is invalid.", false);
  }
  return value as DependencyWireRequest;
}

export function decodeDependencyWireFrame(message: string): DependencyWireFrame {
  const value = decodeWireMessage(message);
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    !("invocation" in value) ||
    !("sequence" in value) ||
    !("kind" in value)
  ) {
    throw new RemoteDependencyError("invalid-response", "Dependency response is invalid.", true);
  }
  return value as DependencyWireFrame;
}

/**
 * Creates one protocol handler for compiler-derived Dependency contracts.
 * Network adapters own framing and delivery; this handler owns semantic
 * validation and provider invocation.
 */
export function createDependencyRequestHandler(
  contracts: readonly DependencyContractIR[],
  implementations: Readonly<Record<string, unknown>>,
  admit?: DependencyRequestAdmission,
): DependencyRequestHandler {
  const byName = new Map(contracts.map((contract) => [contract.name, contract]));
  const dependencies = conformExternalDependencies(contracts, implementations);

  return {
    open(request) {
      const frames = new FrameQueue();
      const cancellation = new CancellationState();
      const invocationId =
        request.invocation &&
        typeof request.invocation === "object" &&
        typeof request.invocation.id === "string"
          ? request.invocation.id
          : "invalid";
      let sequence = 0;
      const emit = (frame: WireFramePayload) => {
        frames.push({
          ...frame,
          version: DEPENDENCY_PROTOCOL_VERSION,
          invocation: invocationId,
          sequence: ++sequence,
        } as DependencyWireFrame);
      };

      void (async () => {
        let release: (() => void) | undefined;
        let assertAuthority: (() => void | PromiseLike<void>) | undefined;
        try {
          const { operation, dependency } = validateRequest(request, byName);
          const admitted = await admit?.({ request, dependency, operation });
          if (typeof admitted === "function") release = admitted;
          else if (admitted) {
            release = admitted.release;
            assertAuthority = admitted.assertAuthority;
          }
          const invocation: DependencyInvocation = {
            id: request.invocation.id,
            attempt: request.invocation.attempt,
            scheduledAt: request.invocation.scheduledAt,
            startedAt: request.invocation.startedAt,
            ...(request.invocation.deadline === undefined
              ? {}
              : { deadline: request.invocation.deadline }),
            ...(request.invocation.trace ? { trace: request.invocation.trace } : {}),
            ...(request.invocation.authority
              ? {
                  authority: {
                    ...request.invocation.authority,
                    ...(assertAuthority ? { assert: assertAuthority } : {}),
                  },
                }
              : {}),
            [dependencyInvocationControl]: {
              ...(request.invocation.previousHeartbeat === undefined
                ? {}
                : { previousHeartbeat: request.invocation.previousHeartbeat }),
              heartbeat: (details) => emit({ kind: "heartbeat", details }),
              defer: ({ id }) =>
                createDeferredDependencyInvocation({
                  id,
                  activity: request.invocation.id,
                  execution: { workflow: "remote", id: "remote", run: "remote" },
                  attempt: request.invocation.attempt,
                }),
              cancellation,
            },
          };
          const result = invokeDependency(
            dependencies[dependency.name] as object,
            operation.name,
            request.input,
            invocation,
          );
          if (operation.mode === "stream") {
            for await (const value of result as AsyncIterable<unknown>) {
              emit({ kind: "item", value });
            }
            emit({ kind: "complete" });
          } else {
            const value = await Promise.resolve(result);
            if (isDeferredDependencyInvocation(value)) emit({ kind: "deferred", id: value.id });
            else emit({ kind: "result", value });
          }
        } catch (error) {
          if (error instanceof DependencyFailureError) {
            emit({
              kind: "failure",
              failure: {
                type: error.name,
                data: error.data,
                message: error.message,
                ...(error.retryDelay === undefined ? {} : { retry: { delay: error.retryDelay } }),
              },
            });
          } else {
            const normalized =
              error instanceof RemoteDependencyError
                ? error
                : new RemoteDependencyError(
                    "provider-error",
                    error instanceof Error ? error.message : String(error),
                    false,
                  );
            emit({
              kind: "error",
              error: {
                code: normalized.code,
                message: normalized.message,
                uncertain: normalized.uncertain,
              },
            });
          }
        } finally {
          release?.();
          frames.close();
        }
      })();

      return {
        frames,
        cancel(reason) {
          cancellation.request(reason);
          frames.close();
        },
      };
    },
  };
}

/**
 * Projects a remote Process binding through the ordinary Dependency API.
 * Identity references remain local; only their serializable operations reach
 * this dispatcher.
 */
export function createRemoteDependency(
  contract: DependencyContractIR,
  target: string,
  transport: DependencyTransport,
): unknown {
  const operations = new Map(contract.operations.map((operation) => [operation.name, operation]));
  const implementation = {
    [dependencyInvocation](
      operationName: string,
      input: unknown,
      invocation: DependencyInvocation,
    ): unknown {
      const operation = operations.get(operationName);
      if (!operation) {
        throw new RemoteDependencyError(
          "unsupported-operation",
          `Dependency ${contract.name} has no operation ${JSON.stringify(operationName)}.`,
          false,
        );
      }
      if (operation.mode === "synchronous") {
        throw new RemoteDependencyError(
          "synchronous-remote-operation",
          `Dependency ${contract.name}.${operation.name} is synchronous and cannot cross a Process boundary.`,
          false,
        );
      }
      const control = invocation[dependencyInvocationControl];
      const authority = invocation.authority;
      const request: DependencyWireRequest = {
        version: DEPENDENCY_PROTOCOL_VERSION,
        dependency: contract.name,
        operation: operation.name,
        contract: dependencyOperationIdentity(operation),
        invocation: {
          id: invocation.id,
          attempt: invocation.attempt,
          scheduledAt: invocation.scheduledAt,
          startedAt: invocation.startedAt,
          ...(invocation.deadline === undefined ? {} : { deadline: invocation.deadline }),
          ...(control?.previousHeartbeat === undefined
            ? {}
            : { previousHeartbeat: control.previousHeartbeat }),
          ...(invocation.trace ? { trace: invocation.trace } : {}),
          ...(authority
            ? {
                authority: {
                  scope: authority.scope,
                  owner: authority.owner,
                  failureEpoch: authority.failureEpoch,
                  epoch: authority.epoch,
                  expiresAt: authority.expiresAt,
                },
              }
            : {}),
        },
        input,
      };
      if (invocation.deadline !== undefined && invocation.deadline <= Date.now()) {
        throw new RemoteDependencyError(
          "deadline-exceeded",
          `Dependency ${contract.name}.${operation.name} deadline elapsed before dispatch.`,
          false,
        );
      }
      if (control?.cancellation.requested()) {
        throw new RemoteDependencyError(
          "cancelled",
          `Dependency ${contract.name}.${operation.name} was cancelled before dispatch.`,
          false,
        );
      }
      const session = transport.open({ target, request });
      return operation.mode === "stream"
        ? remoteStream(contract, operation, invocation, session)
        : remoteResult(contract, operation, invocation, session);
    },
  };
  return conformExternalDependencies([contract], { [contract.name]: implementation })[
    contract.name
  ];
}

/** Deterministic Process-addressed transport used by conformance and simulation. */
export function createMemoryDependencyTransport(): DependencyTransport &
  Readonly<{ bind(target: string, handler: DependencyRequestHandler): () => void }> {
  const handlers = new Map<string, DependencyRequestHandler>();
  return {
    bind(target, handler) {
      if (!target || handlers.has(target)) {
        throw new Error(`Dependency transport target ${JSON.stringify(target)} is already bound.`);
      }
      handlers.set(target, handler);
      return () => {
        if (handlers.get(target) === handler) handlers.delete(target);
      };
    },
    open({ target, request }) {
      const handler = handlers.get(target);
      if (!handler) {
        throw new RemoteDependencyError(
          "target-unavailable",
          `Dependency transport target ${JSON.stringify(target)} is unavailable.`,
          false,
        );
      }
      const remote = handler.open(
        decodeDependencyWireRequest(encodeDependencyWireMessage(request)),
      );
      return {
        frames: {
          async *[Symbol.asyncIterator]() {
            for await (const frame of remote.frames) {
              yield decodeDependencyWireFrame(encodeDependencyWireMessage(frame));
            }
          },
        },
        cancel: (reason) => remote.cancel(reason),
      };
    },
  };
}

function decodeWireMessage(message: string): unknown {
  try {
    return JSON.parse(message) as unknown;
  } catch {
    throw new RemoteDependencyError(
      "invalid-wire-data",
      "Dependency wire message is not valid canonical JSON.",
      true,
    );
  }
}

function validateRequest(
  request: DependencyWireRequest,
  contracts: ReadonlyMap<string, DependencyContractIR>,
): Readonly<{ dependency: DependencyContractIR; operation: DependencyOperationIR }> {
  if (request.version !== DEPENDENCY_PROTOCOL_VERSION) {
    throw new RemoteDependencyError(
      "unsupported-protocol",
      `Unsupported Dependency protocol version ${String(request.version)}.`,
      false,
    );
  }
  if (
    !request.invocation?.id ||
    !Number.isSafeInteger(request.invocation.attempt) ||
    request.invocation.attempt < 1 ||
    !Number.isFinite(request.invocation.scheduledAt) ||
    !Number.isFinite(request.invocation.startedAt) ||
    (request.invocation.deadline !== undefined && !Number.isFinite(request.invocation.deadline)) ||
    (request.invocation.trace !== undefined &&
      (!request.invocation.trace ||
        typeof request.invocation.trace.traceparent !== "string" ||
        !request.invocation.trace.traceparent)) ||
    (request.invocation.authority !== undefined &&
      (!request.invocation.authority ||
        typeof request.invocation.authority.scope !== "string" ||
        !request.invocation.authority.scope ||
        typeof request.invocation.authority.owner !== "string" ||
        !request.invocation.authority.owner ||
        !Number.isSafeInteger(request.invocation.authority.failureEpoch) ||
        request.invocation.authority.failureEpoch < 1 ||
        !Number.isSafeInteger(request.invocation.authority.epoch) ||
        request.invocation.authority.epoch < 1 ||
        !Number.isFinite(request.invocation.authority.expiresAt)))
  ) {
    throw new RemoteDependencyError("invalid-request", "Dependency invocation is invalid.", false);
  }
  const dependency = contracts.get(request.dependency);
  const operation = dependency?.operations.find(({ name }) => name === request.operation);
  if (!dependency || !operation) {
    throw new RemoteDependencyError(
      "unsupported-operation",
      `Dependency operation ${request.dependency}.${request.operation} is unavailable.`,
      false,
    );
  }
  if (operation.mode === "synchronous") {
    throw new RemoteDependencyError(
      "synchronous-remote-operation",
      `Dependency ${dependency.name}.${operation.name} is synchronous and cannot cross a Process boundary.`,
      false,
    );
  }
  if (request.contract !== dependencyOperationIdentity(operation)) {
    throw new RemoteDependencyError(
      "incompatible-contract",
      `Dependency ${dependency.name}.${operation.name} has an incompatible operation contract.`,
      false,
    );
  }
  if (request.invocation.deadline !== undefined && request.invocation.deadline <= Date.now()) {
    throw new RemoteDependencyError(
      "deadline-exceeded",
      `Dependency ${dependency.name}.${operation.name} deadline elapsed before execution.`,
      false,
    );
  }
  return { dependency, operation };
}

async function remoteResult(
  dependency: DependencyContractIR,
  operation: DependencyOperationIR,
  invocation: DependencyInvocation,
  session: DependencyTransportSession,
): Promise<unknown> {
  return withControls(invocation, operation, session, async (cancelled) => {
    let sequence = 0;
    for await (const frame of session.frames) {
      assertFrame(frame, invocation.id, ++sequence);
      switch (frame.kind) {
        case "heartbeat":
          receiveHeartbeat(dependency, operation, invocation, frame.details);
          break;
        case "result":
          return frame.value;
        case "deferred": {
          const control = invocation[dependencyInvocationControl];
          if (!control) {
            throw new RemoteDependencyError(
              "unsupported-deferred-result",
              `Dependency ${dependency.name}.${operation.name} deferred without runtime ownership.`,
              false,
            );
          }
          return control.defer({ id: frame.id });
        }
        case "failure":
          assertDependencyFailure(
            frame.failure,
            operation.failures,
            `${dependency.name}.${operation.name}`,
          );
          throw new DependencyFailureError(frame.failure);
        case "error":
          throw new RemoteDependencyError(
            frame.error.code,
            frame.error.message,
            frame.error.uncertain,
          );
        case "item":
        case "complete":
          throw new RemoteDependencyError(
            "invalid-response",
            `Dependency ${dependency.name}.${operation.name} returned a stream frame for an asynchronous operation.`,
            true,
          );
      }
    }
    throw (
      cancelled() ??
      new RemoteDependencyError(
        "transport-closed",
        `Dependency ${dependency.name}.${operation.name} transport closed without a result.`,
        true,
      )
    );
  });
}

function remoteStream(
  dependency: DependencyContractIR,
  operation: DependencyOperationIR,
  invocation: DependencyInvocation,
  session: DependencyTransportSession,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      const controls = monitorControls(invocation, operation, session);
      try {
        let sequence = 0;
        for await (const frame of session.frames) {
          assertFrame(frame, invocation.id, ++sequence);
          switch (frame.kind) {
            case "heartbeat":
              receiveHeartbeat(dependency, operation, invocation, frame.details);
              break;
            case "item":
              assertRuntimeType(
                frame.value,
                operation.output,
                `${dependency.name}.${operation.name} stream item`,
              );
              yield frame.value;
              break;
            case "complete":
              return;
            case "failure":
              assertDependencyFailure(
                frame.failure,
                operation.failures,
                `${dependency.name}.${operation.name}`,
              );
              throw new DependencyFailureError(frame.failure);
            case "error":
              throw new RemoteDependencyError(
                frame.error.code,
                frame.error.message,
                frame.error.uncertain,
              );
            case "result":
            case "deferred":
              throw new RemoteDependencyError(
                "invalid-response",
                `Dependency ${dependency.name}.${operation.name} returned a result frame for a stream.`,
                true,
              );
          }
        }
        throw (
          controls.cancelled() ??
          new RemoteDependencyError(
            "transport-closed",
            `Dependency ${dependency.name}.${operation.name} transport closed before completion.`,
            true,
          )
        );
      } finally {
        controls.dispose();
      }
    },
  };
}

async function withControls<Value>(
  invocation: DependencyInvocation,
  operation: DependencyOperationIR,
  session: DependencyTransportSession,
  consume: (cancelled: () => RemoteDependencyError | undefined) => Promise<Value>,
): Promise<Value> {
  const controls = monitorControls(invocation, operation, session);
  try {
    return await consume(controls.cancelled);
  } finally {
    controls.dispose();
  }
}

function monitorControls(
  invocation: DependencyInvocation,
  operation: DependencyOperationIR,
  session: DependencyTransportSession,
): Readonly<{
  cancelled(): RemoteDependencyError | undefined;
  dispose(): void;
}> {
  const control = invocation[dependencyInvocationControl];
  let cancellation: RemoteDependencyError | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cancel = (code: string, message: string, uncertain: boolean) => {
    if (cancellation) return;
    cancellation = new RemoteDependencyError(code, message, uncertain);
    session.cancel(message);
  };
  const unsubscribe = control?.cancellation.subscribe(() =>
    cancel(
      "cancelled",
      `Dependency invocation ${invocation.id} was cancelled while awaiting a remote result.`,
      true,
    ),
  );
  if (invocation.deadline !== undefined) {
    timeout = setTimeout(
      () =>
        cancel(
          "deadline-exceeded",
          `Dependency operation ${operation.name} exceeded its remote deadline.`,
          true,
        ),
      Math.max(0, invocation.deadline - Date.now()),
    );
  }
  return {
    cancelled: () => cancellation,
    dispose() {
      unsubscribe?.();
      if (timeout !== undefined) clearTimeout(timeout);
    },
  };
}

function receiveHeartbeat(
  dependency: DependencyContractIR,
  operation: DependencyOperationIR,
  invocation: DependencyInvocation,
  details: unknown,
): void {
  if (!operation.heartbeat) {
    throw new RemoteDependencyError(
      "invalid-response",
      `Dependency ${dependency.name}.${operation.name} emitted an undeclared heartbeat.`,
      true,
    );
  }
  assertRuntimeType(details, operation.heartbeat, `${dependency.name}.${operation.name} heartbeat`);
  invocation[dependencyInvocationControl]?.heartbeat(details);
}

function assertFrame(frame: DependencyWireFrame, invocation: string, sequence: number): void {
  if (
    !frame ||
    typeof frame !== "object" ||
    frame.version !== DEPENDENCY_PROTOCOL_VERSION ||
    frame.invocation !== invocation ||
    frame.sequence !== sequence ||
    !Number.isSafeInteger(frame.sequence) ||
    !["heartbeat", "result", "deferred", "item", "complete", "failure", "error"].includes(
      frame.kind,
    )
  ) {
    throw new RemoteDependencyError(
      "invalid-response",
      `Dependency response frame ${String(frame.sequence)} is invalid or out of order.`,
      true,
    );
  }
  if (
    (frame.kind === "deferred" && (!frame.id || typeof frame.id !== "string")) ||
    (frame.kind === "failure" &&
      (!frame.failure ||
        typeof frame.failure !== "object" ||
        typeof frame.failure.type !== "string")) ||
    (frame.kind === "error" &&
      (!frame.error ||
        typeof frame.error !== "object" ||
        typeof frame.error.code !== "string" ||
        typeof frame.error.message !== "string" ||
        typeof frame.error.uncertain !== "boolean"))
  ) {
    throw new RemoteDependencyError(
      "invalid-response",
      `Dependency response frame ${String(frame.sequence)} has an invalid payload.`,
      true,
    );
  }
}

class CancellationState {
  #requested = false;
  readonly #listeners = new Set<() => void>();
  readonly #wait: Promise<void>;
  #resolve!: () => void;

  constructor() {
    this.#wait = new Promise<void>((resolve) => {
      this.#resolve = resolve;
    });
  }

  requested(): boolean {
    return this.#requested;
  }

  wait(): Promise<void> {
    return this.#requested ? Promise.resolve() : this.#wait;
  }

  subscribe(request: () => void): () => void {
    if (this.#requested) {
      request();
      return () => undefined;
    }
    this.#listeners.add(request);
    return () => this.#listeners.delete(request);
  }

  request(_reason?: string): void {
    if (this.#requested) return;
    this.#requested = true;
    this.#resolve();
    for (const listener of this.#listeners) listener();
    this.#listeners.clear();
  }
}

class FrameQueue implements AsyncIterable<DependencyWireFrame> {
  readonly #frames: DependencyWireFrame[] = [];
  readonly #waiters: Array<(result: IteratorResult<DependencyWireFrame, undefined>) => void> = [];
  #closed = false;

  push(frame: DependencyWireFrame): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value: frame });
    else this.#frames.push(frame);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<DependencyWireFrame> {
    return {
      next: () => {
        const frame = this.#frames.shift();
        if (frame) return Promise.resolve({ done: false, value: frame });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
      return: async () => {
        this.close();
        return { done: true, value: undefined };
      },
    };
  }
}
