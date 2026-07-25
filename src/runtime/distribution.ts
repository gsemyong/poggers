import {
  dependencyOperationIdentity,
  type DependencyContractIR,
  type DependencyOperationIR,
} from "@/compiler/ir";
import { cloneData } from "@/core/data";
import {
  dependencyInvocation,
  invokeDependency,
  type DependencyInvocation,
  type DependencyInvocationAuthority,
} from "@/core/dependency";
import { conformExternalDependencies } from "@/runtime/process";
import {
  createDependencyRequestHandler,
  createRemoteDependency,
  type DependencyRequestAdmission,
  type DependencyRequestHandler,
  type DependencyTransport,
} from "@/runtime/transport";

export type ProcessContracts = Readonly<Record<string, Readonly<Record<string, string>>>>;

export type ProcessMember = Readonly<{
  id: string;
  target: string;
  program: string;
  version: string;
  failureEpoch: number;
  status: "active" | "draining";
  contracts: ProcessContracts;
  expiresAt: number;
}>;

export type ProcessMembership = Readonly<{
  revision: number;
  members: readonly ProcessMember[];
}>;

export type ProcessPartition = Readonly<{
  scope: string;
  program: string;
  dependency: string;
  partition: number;
}>;

export type ProcessOwnership = Readonly<{
  partition: ProcessPartition;
  owner: string;
  target: string;
  version: string;
  failureEpoch: number;
  epoch: number;
  membershipRevision: number;
  expiresAt: number;
}>;

export type ProcessDirectory = Readonly<{
  join(
    input: Readonly<{
      id: string;
      target: string;
      program: string;
      version: string;
      contracts: ProcessContracts;
      now: number;
      leaseDuration: number;
    }>,
  ): Promise<ProcessMember>;
  renew(
    input: Readonly<{
      id: string;
      failureEpoch: number;
      now: number;
      leaseDuration: number;
    }>,
  ): Promise<ProcessMember>;
  drain(input: Readonly<{ id: string; failureEpoch: number; now: number }>): Promise<void>;
  leave(input: Readonly<{ id: string; failureEpoch: number; now: number }>): Promise<void>;
  membership(input: Readonly<{ program: string; now: number }>): Promise<ProcessMembership>;
  locate(
    input: Readonly<{
      partition: ProcessPartition;
      operation: string;
      contract: string;
      now: number;
      leaseDuration: number;
    }>,
  ): Promise<ProcessOwnership>;
  renewOwnership(
    input: Readonly<{
      authority: DependencyInvocationAuthority;
      now: number;
      leaseDuration: number;
    }>,
  ): Promise<ProcessOwnership>;
  releaseOwnership(
    input: Readonly<{ authority: DependencyInvocationAuthority; now: number }>,
  ): Promise<void>;
  assertAuthority(
    input: Readonly<{ authority: DependencyInvocationAuthority; now: number }>,
  ): Promise<void>;
}>;

export class ProcessPlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessPlacementError";
  }
}

export class StaleProcessAuthorityError extends Error {
  constructor(readonly authority: DependencyInvocationAuthority) {
    super(`Process ownership ${authority.scope}@${authority.epoch} is stale.`);
    this.name = "StaleProcessAuthorityError";
  }
}

/** Compiler-derived operation identities advertised by one Process member. */
export function processContracts(contracts: readonly DependencyContractIR[]): ProcessContracts {
  return Object.freeze(
    Object.fromEntries(
      contracts.map((dependency) => [
        dependency.name,
        Object.freeze(
          Object.fromEntries(
            dependency.operations.map((operation) => [
              operation.name,
              dependencyOperationIdentity(operation),
            ]),
          ),
        ),
      ]),
    ),
  );
}

/** Stable logical partition for one identity-bound Dependency invocation. */
export function processPartition(
  program: string,
  contract: DependencyContractIR,
  input: unknown,
  count: number,
): ProcessPartition {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new TypeError("Process virtual partition count must be a positive safe integer.");
  }
  if (!contract.reference) {
    throw new TypeError(`Dependency ${JSON.stringify(contract.name)} has no identity reference.`);
  }
  if (!isRecord(input)) {
    throw new TypeError(
      `Dependency ${JSON.stringify(contract.name)} routing input must be an object.`,
    );
  }
  const binding = contract.reference.bindings.map((name) => {
    if (!Object.hasOwn(input, name)) {
      throw new TypeError(
        `Dependency ${JSON.stringify(contract.name)} routing input is missing binding ${JSON.stringify(name)}.`,
      );
    }
    return [name, cloneData(input[name], `${contract.name}.${name} binding`)] as const;
  });
  const identity = JSON.stringify([program, contract.name, binding]);
  const partition = stableHash(identity) % count;
  return Object.freeze({
    scope: JSON.stringify(["kit.process.partition", 1, program, contract.name, partition]),
    program,
    dependency: contract.name,
    partition,
  });
}

/** Deterministic in-memory reference for membership, placement, and fenced ownership. */
export function createMemoryProcessDirectory(): ProcessDirectory {
  const members = new Map<string, ProcessMember>();
  const failureEpochs = new Map<string, number>();
  const ownership = new Map<string, ProcessOwnership>();
  const ownershipEpochs = new Map<string, number>();
  let revision = 0;

  const expire = (now: number): void => {
    let changed = false;
    for (const [id, member] of members) {
      if (member.expiresAt > now) continue;
      members.delete(id);
      changed = true;
    }
    if (changed) revision += 1;
  };

  const currentMember = (id: string, failureEpoch: number, now: number): ProcessMember => {
    expire(now);
    const member = members.get(id);
    if (!member || member.failureEpoch !== failureEpoch) {
      throw new ProcessPlacementError(
        `Process member ${JSON.stringify(id)} failure epoch ${failureEpoch} is not active.`,
      );
    }
    return member;
  };

  const activeOwnership = (
    authority: DependencyInvocationAuthority,
    now: number,
  ): ProcessOwnership => {
    expire(now);
    const value = ownership.get(authority.scope);
    const member = value ? members.get(value.owner) : undefined;
    if (
      !value ||
      value.owner !== authority.owner ||
      value.failureEpoch !== authority.failureEpoch ||
      value.epoch !== authority.epoch ||
      value.expiresAt <= now ||
      member?.failureEpoch !== value.failureEpoch ||
      member.status !== "active"
    ) {
      throw new StaleProcessAuthorityError(authority);
    }
    return value;
  };

  return {
    async join(input) {
      assertLease(input.now, input.leaseDuration);
      expire(input.now);
      if (!input.id || !input.target || !input.program || !input.version) {
        throw new TypeError(
          "Process membership identity, target, Program, and version are required.",
        );
      }
      if (members.has(input.id)) {
        throw new ProcessPlacementError(
          `Process member ${JSON.stringify(input.id)} is already active.`,
        );
      }
      const failureEpoch = (failureEpochs.get(input.id) ?? 0) + 1;
      failureEpochs.set(input.id, failureEpoch);
      const member: ProcessMember = Object.freeze({
        id: input.id,
        target: input.target,
        program: input.program,
        version: input.version,
        failureEpoch,
        status: "active",
        contracts: input.contracts,
        expiresAt: input.now + input.leaseDuration,
      });
      members.set(input.id, member);
      revision += 1;
      return member;
    },
    async renew(input) {
      assertLease(input.now, input.leaseDuration);
      const member = currentMember(input.id, input.failureEpoch, input.now);
      if (member.status !== "active") {
        throw new ProcessPlacementError(`Process member ${JSON.stringify(input.id)} is draining.`);
      }
      const renewed = Object.freeze({
        ...member,
        expiresAt: input.now + input.leaseDuration,
      });
      members.set(member.id, renewed);
      return renewed;
    },
    async drain(input) {
      const member = currentMember(input.id, input.failureEpoch, input.now);
      if (member.status === "draining") return;
      members.set(member.id, Object.freeze({ ...member, status: "draining" as const }));
      revision += 1;
    },
    async leave(input) {
      currentMember(input.id, input.failureEpoch, input.now);
      members.delete(input.id);
      revision += 1;
    },
    async membership(input) {
      expire(input.now);
      return Object.freeze({
        revision,
        members: [...members.values()]
          .filter(({ program }) => program === input.program)
          .sort((left, right) => left.id.localeCompare(right.id)),
      });
    },
    async locate(input) {
      assertLease(input.now, input.leaseDuration);
      expire(input.now);
      const candidates = [...members.values()].filter(
        (member) =>
          member.program === input.partition.program &&
          member.status === "active" &&
          member.contracts[input.partition.dependency]?.[input.operation] === input.contract,
      );
      const winner = rendezvousOwner(input.partition.scope, candidates);
      if (!winner) {
        throw new ProcessPlacementError(
          `No active Process supports ${input.partition.dependency}.${input.operation}.`,
        );
      }
      const previous = ownership.get(input.partition.scope);
      if (
        previous &&
        previous.owner === winner.id &&
        previous.failureEpoch === winner.failureEpoch &&
        previous.expiresAt > input.now
      ) {
        const renewed = Object.freeze({
          ...previous,
          membershipRevision: revision,
          expiresAt: input.now + input.leaseDuration,
        });
        ownership.set(input.partition.scope, renewed);
        return renewed;
      }
      const epoch =
        Math.max(previous?.epoch ?? 0, ownershipEpochs.get(input.partition.scope) ?? 0) + 1;
      ownershipEpochs.set(input.partition.scope, epoch);
      const assigned: ProcessOwnership = Object.freeze({
        partition: input.partition,
        owner: winner.id,
        target: winner.target,
        version: winner.version,
        failureEpoch: winner.failureEpoch,
        epoch,
        membershipRevision: revision,
        expiresAt: input.now + input.leaseDuration,
      });
      ownership.set(input.partition.scope, assigned);
      return assigned;
    },
    async renewOwnership(input) {
      assertLease(input.now, input.leaseDuration);
      const value = activeOwnership(input.authority, input.now);
      const renewed = Object.freeze({
        ...value,
        expiresAt: input.now + input.leaseDuration,
      });
      ownership.set(value.partition.scope, renewed);
      return renewed;
    },
    async releaseOwnership(input) {
      expire(input.now);
      const value = ownership.get(input.authority.scope);
      const member = value ? members.get(value.owner) : undefined;
      if (
        !value ||
        value.owner !== input.authority.owner ||
        value.failureEpoch !== input.authority.failureEpoch ||
        value.epoch !== input.authority.epoch ||
        value.expiresAt <= input.now ||
        member?.failureEpoch !== value.failureEpoch
      ) {
        throw new StaleProcessAuthorityError(input.authority);
      }
      ownership.delete(value.partition.scope);
    },
    async assertAuthority(input) {
      activeOwnership(input.authority, input.now);
    },
  };
}

export type RoutedDependencyOptions = Readonly<{
  program: string;
  member: Readonly<{ id: string; failureEpoch: number }>;
  contract: DependencyContractIR;
  local: object;
  directory: ProcessDirectory;
  transport: DependencyTransport;
  partitionCount: number;
  ownershipLease: number;
  now(): number;
  admit?(): () => void;
  observe?(event: ProcessDistributionEvent): void;
}>;

type ProcessDistributionEvent =
  | Readonly<{ kind: "routed"; retry: boolean }>
  | Readonly<{ kind: "local"; authority: DependencyInvocationAuthority }>
  | Readonly<{ kind: "remote" }>
  | Readonly<{ kind: "failure" }>;

/** Routes one identity-bound Dependency while preserving its ordinary API. */
export function createRoutedDependency(options: RoutedDependencyOptions): unknown {
  if (!options.contract.reference) {
    throw new TypeError(
      `Dependency ${JSON.stringify(options.contract.name)} cannot be partition-routed without a reference.`,
    );
  }
  const operations = new Map(
    options.contract.operations.map((operation) => [operation.name, operation]),
  );
  const remote = new Map<string, object>();

  const dispatch = (
    operation: DependencyOperationIR,
    input: unknown,
    invocation: DependencyInvocation,
  ): unknown => {
    options.observe?.({ kind: "routed", retry: invocation.attempt > 1 });
    if (operation.mode === "synchronous") {
      throw new ProcessPlacementError(
        `Synchronous Dependency ${options.contract.name}.${operation.name} cannot be partition-routed.`,
      );
    }
    const run = async (): Promise<unknown> => {
      const partition = processPartition(
        options.program,
        options.contract,
        input,
        options.partitionCount,
      );
      const ownership = await options.directory.locate({
        partition,
        operation: operation.name,
        contract: dependencyOperationIdentity(operation),
        now: options.now(),
        leaseDuration: options.ownershipLease,
      });
      const authority: DependencyInvocationAuthority = Object.freeze({
        scope: partition.scope,
        owner: ownership.owner,
        failureEpoch: ownership.failureEpoch,
        epoch: ownership.epoch,
        expiresAt: ownership.expiresAt,
      });
      const invocationId = invocation.id.startsWith("direct:")
        ? `process:${options.member.id}:${options.member.failureEpoch}:${invocation.id}`
        : invocation.id;
      const routedInvocation: DependencyInvocation = {
        ...invocation,
        id: invocationId,
        authority: {
          ...authority,
          assert: () =>
            options.directory.assertAuthority({
              authority,
              now: options.now(),
            }),
        },
      };
      if (
        ownership.owner === options.member.id &&
        ownership.failureEpoch === options.member.failureEpoch
      ) {
        options.observe?.({ kind: "local", authority });
        await options.directory.assertAuthority({ authority, now: options.now() });
        return invokeDependency(options.local, operation.name, input, routedInvocation);
      }
      options.observe?.({ kind: "remote" });
      let dependency = remote.get(ownership.target);
      if (!dependency) {
        dependency = createRemoteDependency(
          options.contract,
          ownership.target,
          options.transport,
        ) as object;
        remote.set(ownership.target, dependency);
      }
      return invokeDependency(dependency, operation.name, input, routedInvocation);
    };

    if (operation.mode !== "stream") {
      const runAdmitted = async (): Promise<unknown> => {
        const release = options.admit?.();
        try {
          return await run();
        } catch (error) {
          options.observe?.({ kind: "failure" });
          throw error;
        } finally {
          release?.();
        }
      };
      return runAdmitted();
    }
    return {
      async *[Symbol.asyncIterator]() {
        const release = options.admit?.();
        try {
          const values = (await run()) as AsyncIterable<unknown>;
          yield* values;
        } catch (error) {
          options.observe?.({ kind: "failure" });
          throw error;
        } finally {
          release?.();
        }
      },
    };
  };

  const implementation = {
    [dependencyInvocation](
      operationName: string,
      input: unknown,
      invocation: DependencyInvocation,
    ): unknown {
      const operation = operations.get(operationName);
      if (!operation) {
        throw new ProcessPlacementError(
          `Dependency ${options.contract.name} has no operation ${JSON.stringify(operationName)}.`,
        );
      }
      return dispatch(operation, input, invocation);
    },
  };
  return conformExternalDependencies([options.contract], {
    [options.contract.name]: implementation,
  })[options.contract.name];
}

export type ProcessNetwork = DependencyTransport &
  Readonly<{
    bind(target: string, handler: DependencyRequestHandler): () => void;
  }>;

export type ProcessDistributionConfig = Readonly<{
  id: string;
  target: string;
  version: string;
  directory: ProcessDirectory;
  network: ProcessNetwork;
  partitionCount: number;
  membershipLease: number;
  ownershipLease: number;
  maxInflight?: number;
  now(): number;
}>;

export type ProcessDistributionMetrics = Readonly<{
  routedCalls: number;
  admittedCalls: number;
  localCalls: number;
  remoteCalls: number;
  retries: number;
  rejections: number;
  failures: number;
  ownershipMoves: number;
}>;

export type ProcessDistributionStatus = Readonly<{
  member: ProcessMember;
  healthy: boolean;
  ready: boolean;
  active: number;
  capacity: number;
  ownership: readonly DependencyInvocationAuthority[];
  metrics: ProcessDistributionMetrics;
}>;

export type RunningProcessDistribution = AsyncDisposable &
  Readonly<{
    readonly member: ProcessMember;
    dependency(contract: DependencyContractIR, local: object): unknown;
    renew(): Promise<void>;
    status(): ProcessDistributionStatus;
    rebalance(input?: Readonly<{ scope?: string }>): Promise<void>;
    drain(): Promise<void>;
  }>;

/**
 * Registers one ready Process and owns admission, routing, renewal, and drain.
 * The server adapter decides how often `renew` runs.
 */
export async function startProcessDistribution(
  program: string,
  contracts: readonly DependencyContractIR[],
  providers: Readonly<Record<string, unknown>>,
  config: ProcessDistributionConfig,
): Promise<RunningProcessDistribution> {
  const metrics = mutableProcessMetrics();
  const admissions = new AdmissionLedger(config.maxInflight ?? 1_024, () => {
    metrics.rejections += 1;
  });
  const ownership = new Map<string, DependencyInvocationAuthority>();
  let healthy = true;
  const admit: DependencyRequestAdmission = async ({ request, dependency }) => {
    const release = admissions.admit();
    metrics.admittedCalls += 1;
    try {
      let authority: DependencyInvocationAuthority | undefined;
      if (dependency.reference) {
        authority = request.invocation.authority;
        if (!authority) {
          throw new ProcessPlacementError(
            `Routed Dependency ${dependency.name} requires Process ownership authority.`,
          );
        }
        await config.directory.assertAuthority({ authority, now: config.now() });
      }
      return {
        release,
        ...(authority
          ? {
              assertAuthority: () =>
                config.directory.assertAuthority({ authority, now: config.now() }),
            }
          : {}),
      };
    } catch (error) {
      release();
      throw error;
    }
  };
  const handler = createDependencyRequestHandler(contracts, providers, admit);
  const unbind = config.network.bind(config.target, handler);
  let member: ProcessMember;
  try {
    member = await config.directory.join({
      id: config.id,
      target: config.target,
      program,
      version: config.version,
      contracts: processContracts(contracts),
      now: config.now(),
      leaseDuration: config.membershipLease,
    });
  } catch (error) {
    unbind();
    throw error;
  }
  let draining: Promise<void> | undefined;

  const running: RunningProcessDistribution = {
    get member() {
      return member;
    },
    dependency(contract, local) {
      return createRoutedDependency({
        program,
        member,
        contract,
        local,
        directory: config.directory,
        transport: config.network,
        partitionCount: config.partitionCount,
        ownershipLease: config.ownershipLease,
        now: config.now,
        admit: () => {
          const release = admissions.admit();
          metrics.admittedCalls += 1;
          return release;
        },
        observe(event) {
          switch (event.kind) {
            case "routed":
              metrics.routedCalls += 1;
              if (event.retry) metrics.retries += 1;
              break;
            case "local": {
              metrics.localCalls += 1;
              const previous = ownership.get(event.authority.scope);
              ownership.set(event.authority.scope, event.authority);
              if (previous?.epoch !== event.authority.epoch) metrics.ownershipMoves += 1;
              break;
            }
            case "remote":
              metrics.remoteCalls += 1;
              break;
            case "failure":
              metrics.failures += 1;
              break;
          }
        },
      });
    },
    async renew() {
      try {
        member = await config.directory.renew({
          id: member.id,
          failureEpoch: member.failureEpoch,
          now: config.now(),
          leaseDuration: config.membershipLease,
        });
      } catch (error) {
        healthy = false;
        admissions.stop();
        throw error;
      }
    },
    status() {
      return Object.freeze({
        member,
        healthy,
        ready: healthy && admissions.accepting,
        active: admissions.active,
        capacity: admissions.capacity,
        ownership: Object.freeze([...ownership.values()]),
        metrics: Object.freeze({ ...metrics }),
      });
    },
    async rebalance(input = {}) {
      const authorities = [...ownership.values()].filter(
        ({ scope }) => input.scope === undefined || input.scope === scope,
      );
      for (const authority of authorities) {
        await config.directory.releaseOwnership({ authority, now: config.now() });
        ownership.delete(authority.scope);
      }
    },
    drain() {
      if (draining) return draining;
      draining = (async () => {
        admissions.stop();
        await admissions.idle();
        try {
          await config.directory.drain({
            id: member.id,
            failureEpoch: member.failureEpoch,
            now: config.now(),
          });
          await running.rebalance();
          await config.directory.leave({
            id: member.id,
            failureEpoch: member.failureEpoch,
            now: config.now(),
          });
        } catch (error) {
          if (!(error instanceof ProcessPlacementError)) throw error;
        } finally {
          unbind();
        }
      })();
      return draining;
    },
    async [Symbol.asyncDispose]() {
      await running.drain();
    },
  };
  return running;
}

/** Admission gate for a routed provider. Product code cannot run under stale ownership. */
export function admitProcessInvocation(
  directory: ProcessDirectory,
  now: () => number,
): DependencyRequestAdmission {
  return async ({ request, dependency }) => {
    if (!dependency.reference) return;
    const authority = request.invocation.authority;
    if (!authority) {
      throw new ProcessPlacementError(
        `Routed Dependency ${dependency.name} requires Process ownership authority.`,
      );
    }
    await directory.assertAuthority({ authority, now: now() });
  };
}

function rendezvousOwner(
  scope: string,
  members: readonly ProcessMember[],
): ProcessMember | undefined {
  let winner: ProcessMember | undefined;
  let score = -1;
  for (const member of members) {
    const candidate = stableHash(`${scope}\u0000${member.id}\u0000${member.failureEpoch}`);
    if (
      candidate > score ||
      (candidate === score && winner !== undefined && member.id.localeCompare(winner.id) < 0)
    ) {
      winner = member;
      score = candidate;
    }
  }
  return winner;
}

class AdmissionLedger {
  #accepting = true;
  #active = 0;
  #idle: (() => void)[] = [];

  constructor(
    readonly capacity: number,
    private readonly reject: () => void,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError("Process invocation capacity must be a positive safe integer.");
    }
  }

  get accepting(): boolean {
    return this.#accepting;
  }

  get active(): number {
    return this.#active;
  }

  admit(): () => void {
    if (!this.#accepting || this.#active >= this.capacity) {
      this.reject();
      throw new ProcessPlacementError(
        this.#accepting ? "Process reached its invocation limit." : "Process is draining.",
      );
    }
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      if (this.#active !== 0) return;
      for (const resolve of this.#idle.splice(0)) resolve();
    };
  }

  stop(): void {
    this.#accepting = false;
  }

  idle(): Promise<void> {
    if (this.#active === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }
}

function mutableProcessMetrics(): {
  -readonly [Key in keyof ProcessDistributionMetrics]: ProcessDistributionMetrics[Key];
} {
  return {
    routedCalls: 0,
    admittedCalls: 0,
    localCalls: 0,
    remoteCalls: 0,
    retries: 0,
    rejections: 0,
    failures: 0,
    ownershipMoves: 0,
  };
}

function stableHash(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

function assertLease(now: number, duration: number): void {
  if (!Number.isFinite(now) || !Number.isFinite(duration) || duration <= 0) {
    throw new TypeError("Process lease time and duration must be finite and positive.");
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
