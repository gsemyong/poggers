import { createHash } from "node:crypto";

import type {
  ActorOf,
  App,
  AppEventName,
  AppProgramRunners,
  AppSpec,
  EnvironmentDeps,
  EnvironmentName,
  JsonValue,
  ProgramCleanup,
  ProgramEventItem,
  ProgramResource,
  InternalProgramContext,
  ResourceSpec,
} from "#kernel/app";
import { featureResourceName } from "#kernel/feature";
import {
  sourceCursor,
  type ProgramAssignment as AdapterProgramAssignment,
  type ProgramLease as AdapterProgramLease,
  type SubstrateAdapter,
} from "#substrate/adapter";
import {
  JournalCorruptionError,
  addressKey,
  type CommandRecord,
  type Journal,
  type JournalHead,
  type ResourceAddress,
} from "#substrate/journal";
import { scopeId } from "#substrate/protocol";

const sourceCheckpointInterval = 128;
const sourceCheckpointMaxDelayMs = 100;
const defaultMaxPendingEvents = 1_024;
const defaultMaxPendingBytes = 16 * 1024 * 1024;
const programProgressSchema = "poggers-program-progress:3";

export type ProgramRestartPolicy = Readonly<{
  initialDelayMs: number;
  maximumDelayMs: number;
  factor: number;
  jitter: number;
  healthyAfterMs: number;
  now: () => number;
  random: () => number;
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
}>;

export type ProgramRuntimeHealth = Readonly<{
  status: "running" | "failed" | "restarting" | "stopped";
  generation: number;
  consecutiveFailures: number;
  startedAt?: number;
  failedAt?: number;
  restartAt?: number;
  error?: unknown;
}>;

type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;

type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;

type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<Spec, Resource>["Views"][View];
};

export type ProgramEventRecord<Spec extends AppSpec = AppSpec> = Readonly<{
  resource: ResourceName<Spec>;
  key: JsonValue;
  event: Readonly<{
    id: string;
    seq: number;
    position: number;
    index: number;
    at: number;
    version: number;
    hash?: string;
    actor: ActorOf<Spec>;
    name: string;
    payload: unknown;
  }>;
}>;

export type ProgramEventCursor = Readonly<{
  position: number;
  index: number;
}>;

export type ProgramConsumerDefinition = Readonly<{
  events: readonly string[];
  startAt: "origin" | "now";
  partition: string;
  version: number;
}>;

export class ProgramConsumerDefinitionError extends Error {
  constructor(consumerId: string) {
    super(`Program consumer ${JSON.stringify(consumerId)} changed without a progress migration.`);
    this.name = "ProgramConsumerDefinitionError";
  }
}

export type ProgramInvocation = Readonly<{
  key: string;
  cursor: ProgramEventCursor;
  attempt: number;
  epoch: number;
  status: "running" | "completed";
  uncertainAttempts: readonly number[];
}>;

export type ProgramInvocationClaim =
  | Readonly<{ status: "completed" }>
  | Readonly<{ status: "running"; invocation: ProgramInvocation }>;

export type ProgramConsumerProgress = Readonly<{
  consumerId: string;
  definition: ProgramConsumerDefinition;
  sourcePosition: number;
  scopes: readonly Readonly<{
    scopeId: string;
    checkpoint: ProgramEventCursor | null;
    invocation: ProgramInvocation | null;
  }>[];
}>;

export type ProgramProgressStore = {
  registerConsumer(input: {
    consumerId: string;
    definition: ProgramConsumerDefinition;
    initialSourcePosition: number;
  }): "created" | "existing" | Promise<"created" | "existing">;
  getConsumerDefinition(
    consumerId: string,
  ): ProgramConsumerDefinition | undefined | Promise<ProgramConsumerDefinition | undefined>;
  claim(input: {
    key: string;
    consumerId: string;
    scopeId: string;
    cursor: ProgramEventCursor;
  }): ProgramInvocationClaim | Promise<ProgramInvocationClaim>;
  complete(input: {
    key: string;
    consumerId: string;
    scopeId: string;
    cursor: ProgramEventCursor;
    epoch: number;
  }): "completed" | "stale" | Promise<"completed" | "stale">;
  getCheckpoint(
    consumerId: string,
    scopeId: string,
  ): ProgramEventCursor | undefined | Promise<ProgramEventCursor | undefined>;
  getInvocation(
    consumerId: string,
    scopeId: string,
  ): ProgramInvocation | null | Promise<ProgramInvocation | null>;
  getSourcePosition(consumerId: string): number | undefined | Promise<number | undefined>;
  setSourcePosition(consumerId: string, position: number): void | Promise<void>;
  inspectConsumer(
    consumerId: string,
  ): ProgramConsumerProgress | undefined | Promise<ProgramConsumerProgress | undefined>;
  resetConsumer(
    input:
      | { consumerId: string; startAt: "origin" }
      | { consumerId: string; startAt: "now"; sourcePosition: number },
  ): void | Promise<void>;
  moveConsumer(input: { from: string; to: string }): void | Promise<void>;
  removeConsumer(consumerId: string): void | Promise<void>;
};

export function createMemoryProgramProgressStore(): ProgramProgressStore {
  const scopes = new Map<string, MutableProgramScopeState>();
  const scopeIds = new Map<string, Set<string>>();
  const sourcePositions = new Map<string, number>();
  const definitions = new Map<string, ProgramConsumerDefinition>();
  const rememberScope = (consumerId: string, scope: string): void => {
    const ids = scopeIds.get(consumerId) ?? new Set();
    ids.add(scope);
    scopeIds.set(consumerId, ids);
  };
  const inspectConsumer = (consumerId: string): ProgramConsumerProgress | undefined => {
    const definition = definitions.get(consumerId);
    if (!definition) return undefined;
    return {
      consumerId,
      definition,
      sourcePosition: sourcePositions.get(consumerId) ?? 0,
      scopes: [...(scopeIds.get(consumerId) ?? [])].sort().map((scope) => {
        const state = scopes.get(checkpointKey(consumerId, scope)) ?? {
          checkpoint: null,
          invocation: null,
        };
        return { scopeId: scope, ...structuredClone(state) };
      }),
    };
  };
  const deleteConsumer = (consumerId: string): void => {
    for (const scope of scopeIds.get(consumerId) ?? []) {
      scopes.delete(checkpointKey(consumerId, scope));
    }
    scopeIds.delete(consumerId);
    sourcePositions.delete(consumerId);
    definitions.delete(consumerId);
  };
  return {
    registerConsumer(input) {
      assertConsumerRegistration(input);
      const current = definitions.get(input.consumerId);
      if (current) {
        if (!sameConsumerDefinition(current, input.definition)) {
          throw new ProgramConsumerDefinitionError(input.consumerId);
        }
        return "existing";
      }
      definitions.set(input.consumerId, freezeConsumerDefinition(input.definition));
      sourcePositions.set(input.consumerId, input.initialSourcePosition);
      return "created";
    },
    getConsumerDefinition: (consumerId) => definitions.get(consumerId),
    claim(input) {
      rememberScope(input.consumerId, input.scopeId);
      const mapKey = checkpointKey(input.consumerId, input.scopeId);
      const state = scopes.get(mapKey) ?? { checkpoint: null, invocation: null };
      if (!scopes.has(mapKey)) scopes.set(mapKey, state);
      assertProgramProgressInput(input.key, input.cursor);
      if (state.checkpoint && compareEventCursors(input.cursor, state.checkpoint) <= 0) {
        return { status: "completed" };
      }
      const previous = state.invocation;
      if (previous?.status === "running" && previous.key !== input.key) {
        throw new JournalCorruptionError(
          `Program tried to claim ${JSON.stringify(input.key)} before completing ${JSON.stringify(previous.key)}.`,
        );
      }
      const retry = previous?.status === "running" && previous.key === input.key ? previous : null;
      const invocation: ProgramInvocation = {
        key: input.key,
        cursor: input.cursor,
        attempt: (retry?.attempt ?? 0) + 1,
        epoch: (retry?.epoch ?? 0) + 1,
        status: "running",
        uncertainAttempts: retry ? [...retry.uncertainAttempts, retry.attempt] : [],
      };
      state.invocation = invocation;
      return { status: "running", invocation };
    },
    complete(input) {
      rememberScope(input.consumerId, input.scopeId);
      const mapKey = checkpointKey(input.consumerId, input.scopeId);
      const state = scopes.get(mapKey) ?? { checkpoint: null, invocation: null };
      if (!scopes.has(mapKey)) scopes.set(mapKey, state);
      assertProgramProgressInput(input.key, input.cursor);
      if (!Number.isSafeInteger(input.epoch) || input.epoch <= 0) {
        throw new TypeError("A Program assignment epoch must be a positive integer.");
      }
      if (state.checkpoint && compareEventCursors(input.cursor, state.checkpoint) <= 0) {
        return "completed";
      }
      const current = state.invocation;
      if (
        !current ||
        current.status !== "running" ||
        current.key !== input.key ||
        compareEventCursors(current.cursor, input.cursor) !== 0 ||
        current.epoch !== input.epoch
      ) {
        return "stale";
      }
      state.checkpoint = input.cursor;
      state.invocation = { ...current, status: "completed" };
      return "completed";
    },
    getCheckpoint: (consumerId, scope) =>
      scopes.get(checkpointKey(consumerId, scope))?.checkpoint ?? undefined,
    getInvocation: (consumerId, scope) =>
      scopes.get(checkpointKey(consumerId, scope))?.invocation ?? null,
    getSourcePosition: (consumerId) => sourcePositions.get(consumerId),
    setSourcePosition(consumerId, position) {
      assertProgramSourcePosition(position);
      if (!definitions.has(consumerId)) {
        throw new Error(`Program consumer ${JSON.stringify(consumerId)} is not registered.`);
      }
      sourcePositions.set(consumerId, Math.max(sourcePositions.get(consumerId) ?? 0, position));
    },
    inspectConsumer,
    resetConsumer(input) {
      const sourcePosition = resetSourcePosition(input);
      if (!definitions.has(input.consumerId)) {
        throw new Error(`Program consumer ${JSON.stringify(input.consumerId)} is not registered.`);
      }
      const current = inspectConsumer(input.consumerId)!;
      assertConsumerIsIdle(current);
      for (const scope of scopeIds.get(input.consumerId) ?? []) {
        scopes.delete(checkpointKey(input.consumerId, scope));
      }
      scopeIds.delete(input.consumerId);
      sourcePositions.set(input.consumerId, sourcePosition);
    },
    moveConsumer({ from, to }) {
      if (from === to) return;
      const current = inspectConsumer(from);
      if (!current) throw new Error(`Program consumer ${JSON.stringify(from)} is not registered.`);
      if (definitions.has(to)) {
        throw new Error(`Program consumer ${JSON.stringify(to)} is already registered.`);
      }
      if (current.scopes.some(({ invocation }) => invocation?.status === "running")) {
        throw new Error(`Program consumer ${JSON.stringify(from)} has unfinished work.`);
      }
      definitions.set(to, current.definition);
      sourcePositions.set(to, current.sourcePosition);
      for (const state of current.scopes) {
        rememberScope(to, state.scopeId);
        scopes.set(checkpointKey(to, state.scopeId), {
          checkpoint: state.checkpoint,
          invocation: state.invocation,
        });
      }
      deleteConsumer(from);
    },
    removeConsumer(consumerId) {
      if (!definitions.has(consumerId)) return;
      assertConsumerIsIdle(inspectConsumer(consumerId)!);
      deleteConsumer(consumerId);
    },
  };
}

type ProgramProgress =
  | Readonly<{
      kind: "register";
      definition: ProgramConsumerDefinition;
      position: number;
    }>
  | Readonly<{
      kind: "claim";
      key: string;
      cursor: ProgramEventCursor;
      attempt: number;
      epoch: number;
      uncertainAttempts: readonly number[];
    }>
  | Readonly<{
      kind: "complete";
      key: string;
      cursor: ProgramEventCursor;
      epoch: number;
    }>
  | Readonly<{ kind: "source"; position: number }>
  | Readonly<{ kind: "replaceScope"; state: ProgramScopeState }>
  | Readonly<{
      kind: "replaceSource";
      definition: ProgramConsumerDefinition | null;
      position: number;
    }>;

type ProgramProgressRecord = CommandRecord<
  ProgramProgress,
  ProgramProgress & Readonly<{ events: readonly [] }>
>;

export function createJournalProgramProgressStore(
  journal: Journal,
  programId: string,
): ProgramProgressStore {
  if (programId.length === 0) throw new TypeError("A Program id cannot be empty.");
  const writes = new Map<string, Promise<void>>();

  const serialize = <Value>(
    address: ResourceAddress,
    operation: () => Promise<Value>,
  ): Promise<Value> => {
    const key = addressKey(address);
    const next = (writes.get(key) ?? Promise.resolve()).then(operation);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    writes.set(key, tail);
    void tail.then(() => {
      if (writes.get(key) === tail) writes.delete(key);
    });
    return next;
  };

  const settled = async (address: ResourceAddress): Promise<void> => {
    await writes.get(addressKey(address));
  };

  const consumerScopes = async (
    consumerId: string,
  ): Promise<readonly Readonly<{ scopeId: string; address: ResourceAddress }>[]> => {
    const entries: Array<Readonly<{ scopeId: string; address: ResourceAddress }>> = [];
    for await (const address of journal.addresses()) {
      const scope = programScopeFromAddress(address, programId, consumerId);
      if (scope !== undefined) entries.push({ scopeId: scope, address });
    }
    return entries.sort((left, right) => left.scopeId.localeCompare(right.scopeId));
  };

  const inspectConsumer = async (
    consumerId: string,
  ): Promise<ProgramConsumerProgress | undefined> => {
    const sourceAddress = programSourceAddress(programId, consumerId);
    await settled(sourceAddress);
    const source = (await loadProgramSource(journal, sourceAddress)).state;
    if (!source.definition) return undefined;
    const scopes = [] as Array<ProgramConsumerProgress["scopes"][number]>;
    for (const { scopeId: id, address } of await consumerScopes(consumerId)) {
      await settled(address);
      const state = (await loadProgramScope(journal, address)).state;
      scopes.push({ scopeId: id, ...state });
    }
    return {
      consumerId,
      definition: source.definition,
      sourcePosition: source.position,
      scopes,
    };
  };

  const replaceScope = (address: ResourceAddress, state: ProgramScopeState): Promise<void> =>
    serialize(address, async () => {
      for (;;) {
        const current = await loadProgramScope(journal, address);
        const progress: ProgramProgress = { kind: "replaceScope", state };
        const result = await appendProgramProgress(
          journal,
          address,
          current.head,
          `replace-scope:${current.head.revision + 1}:${programStateHash(state)}`,
          progress,
        );
        if (result === null) continue;
        await saveProgramSnapshot(journal, address, result, state);
        return;
      }
    });

  const replaceSource = (consumerId: string, state: ProgramSourceState): Promise<void> => {
    const address = programSourceAddress(programId, consumerId);
    return serialize(address, async () => {
      for (;;) {
        const current = await loadProgramSource(journal, address);
        const progress: ProgramProgress = {
          kind: "replaceSource",
          definition: state.definition,
          position: state.position,
        };
        const result = await appendProgramProgress(
          journal,
          address,
          current.head,
          `replace-source:${current.head.revision + 1}:${programStateHash(state)}`,
          progress,
        );
        if (result === null) continue;
        await saveProgramSnapshot(journal, address, result, state);
        return;
      }
    });
  };

  return {
    registerConsumer(input) {
      assertConsumerRegistration(input);
      const address = programSourceAddress(programId, input.consumerId);
      return serialize(address, async () => {
        for (;;) {
          const current = await loadProgramSource(journal, address);
          if (current.state.definition) {
            if (!sameConsumerDefinition(current.state.definition, input.definition)) {
              throw new ProgramConsumerDefinitionError(input.consumerId);
            }
            return "existing";
          }
          const progress: ProgramProgress = {
            kind: "register",
            definition: freezeConsumerDefinition(input.definition),
            position: input.initialSourcePosition,
          };
          const result = await appendProgramProgress(
            journal,
            address,
            current.head,
            `register:${consumerDefinitionHash(progress.definition)}:${progress.position}`,
            progress,
          );
          if (result === null) continue;
          await saveProgramSnapshot(journal, address, result, {
            definition: progress.definition,
            position: progress.position,
          });
          return "created";
        }
      });
    },
    async getConsumerDefinition(consumerId) {
      const address = programSourceAddress(programId, consumerId);
      await settled(address);
      return (await loadProgramSource(journal, address)).state.definition ?? undefined;
    },
    claim(input) {
      const address = programScopeAddress(programId, input.consumerId, input.scopeId);
      return serialize(address, async () => {
        for (;;) {
          const current = await loadProgramScope(journal, address);
          const claimed = claimProgramInvocation(current.state, input.key, input.cursor);
          if (claimed.claim.status === "completed") return claimed.claim;
          const invocation = claimed.claim.invocation;
          const progress: ProgramProgress = {
            kind: "claim",
            key: invocation.key,
            cursor: invocation.cursor,
            attempt: invocation.attempt,
            epoch: invocation.epoch,
            uncertainAttempts: invocation.uncertainAttempts,
          };
          const result = await appendProgramProgress(
            journal,
            address,
            current.head,
            `claim:${input.key}:${invocation.epoch}`,
            progress,
          );
          if (result === null) continue;
          return claimed.claim;
        }
      });
    },
    complete(input) {
      const address = programScopeAddress(programId, input.consumerId, input.scopeId);
      return serialize(address, async () => {
        for (;;) {
          const current = await loadProgramScope(journal, address);
          const completed = completeProgramInvocation(
            current.state,
            input.key,
            input.cursor,
            input.epoch,
          );
          if (completed.status === "stale" || completed.state === current.state) {
            return completed.status;
          }
          const progress: ProgramProgress = {
            kind: "complete",
            key: input.key,
            cursor: input.cursor,
            epoch: input.epoch,
          };
          const result = await appendProgramProgress(
            journal,
            address,
            current.head,
            `complete:${input.key}:${input.epoch}`,
            progress,
          );
          if (result === null) continue;
          await saveProgramSnapshot(journal, address, result, completed.state);
          return "completed";
        }
      });
    },
    async getCheckpoint(consumerId, scope) {
      const address = programScopeAddress(programId, consumerId, scope);
      await settled(address);
      return (await loadProgramScope(journal, address)).state.checkpoint ?? undefined;
    },
    async getInvocation(consumerId, scope) {
      const address = programScopeAddress(programId, consumerId, scope);
      await settled(address);
      return (await loadProgramScope(journal, address)).state.invocation;
    },
    async getSourcePosition(consumerId) {
      const address = programSourceAddress(programId, consumerId);
      await settled(address);
      const state = (await loadProgramSource(journal, address)).state;
      return state.definition ? state.position : undefined;
    },
    setSourcePosition(consumerId, position) {
      assertProgramSourcePosition(position);
      const address = programSourceAddress(programId, consumerId);
      return serialize(address, async () => {
        for (;;) {
          const current = await loadProgramSource(journal, address);
          if (!current.state.definition) {
            throw new Error(`Program consumer ${JSON.stringify(consumerId)} is not registered.`);
          }
          if (position <= current.state.position) return;
          const progress: ProgramProgress = { kind: "source", position };
          const result = await appendProgramProgress(
            journal,
            address,
            current.head,
            `source:${position}`,
            progress,
          );
          if (result === null) continue;
          await saveProgramSnapshot(journal, address, result, {
            definition: current.state.definition,
            position,
          });
          return;
        }
      });
    },
    inspectConsumer,
    async resetConsumer(input) {
      const sourcePosition = resetSourcePosition(input);
      const current = await inspectConsumer(input.consumerId);
      if (!current) {
        throw new Error(`Program consumer ${JSON.stringify(input.consumerId)} is not registered.`);
      }
      assertConsumerIsIdle(current);
      for (const { address } of await consumerScopes(input.consumerId)) {
        await replaceScope(address, emptyProgramScopeState());
      }
      await replaceSource(input.consumerId, {
        definition: current.definition,
        position: sourcePosition,
      });
    },
    async moveConsumer({ from, to }) {
      if (from === to) return;
      const current = await inspectConsumer(from);
      if (!current) throw new Error(`Program consumer ${JSON.stringify(from)} is not registered.`);
      if (await inspectConsumer(to)) {
        throw new Error(`Program consumer ${JSON.stringify(to)} is already registered.`);
      }
      if (current.scopes.some(({ invocation }) => invocation?.status === "running")) {
        throw new Error(`Program consumer ${JSON.stringify(from)} has unfinished work.`);
      }
      await replaceSource(to, {
        definition: current.definition,
        position: current.sourcePosition,
      });
      for (const scope of current.scopes) {
        await replaceScope(programScopeAddress(programId, to, scope.scopeId), {
          checkpoint: scope.checkpoint,
          invocation: scope.invocation,
        });
      }
      for (const { address } of await consumerScopes(from)) {
        await replaceScope(address, emptyProgramScopeState());
      }
      await replaceSource(from, { definition: null, position: 0 });
    },
    async removeConsumer(consumerId) {
      const current = await inspectConsumer(consumerId);
      if (!current) return;
      assertConsumerIsIdle(current);
      for (const { address } of await consumerScopes(consumerId)) {
        await replaceScope(address, emptyProgramScopeState());
      }
      await replaceSource(consumerId, { definition: null, position: 0 });
    },
  };
}

/** Connects the keyed Program executor to adapter-owned durable progress and fencing. */
export function createSubstrateProgramProgressStore(
  substrate: SubstrateAdapter,
  options: Readonly<{
    owner: string;
    signal: AbortSignal;
    leaseMs?: number;
  }>,
): ProgramProgressStore {
  const leaseMs = options.leaseMs ?? 30_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new TypeError("Program leaseMs must be a positive integer.");
  }
  const assignments = new Map<string, AdapterProgramAssignment>();
  const leases = new Map<string, AdapterProgramLease>();
  const renewalTasks = new Map<string, ReturnType<typeof setInterval>>();

  const assignment = (consumerId: string): AdapterProgramAssignment => {
    const value = assignments.get(consumerId);
    if (!value) throw new Error(`Program ${JSON.stringify(consumerId)} is not registered.`);
    return value;
  };

  const lease = async (consumerId: string): Promise<AdapterProgramLease> => {
    const target = assignment(consumerId);
    const current = leases.get(consumerId);
    if (current) {
      const renewed = await substrate.coordination.renew(current, leaseMs);
      if (renewed) {
        leases.set(consumerId, renewed);
        return renewed;
      }
    }
    const acquired = await substrate.coordination.acquire(target, options.owner, leaseMs);
    if (!acquired) {
      throw new Error(`Program assignment ${JSON.stringify(consumerId)} is owned elsewhere.`);
    }
    leases.set(consumerId, acquired);
    return acquired;
  };

  const startRenewal = (consumerId: string): void => {
    if (renewalTasks.has(consumerId)) return;
    const timer = setInterval(
      () => {
        if (options.signal.aborted) return;
        void lease(consumerId).catch(() => {
          leases.delete(consumerId);
        });
      },
      Math.max(1, Math.floor(leaseMs / 3)),
    );
    renewalTasks.set(consumerId, timer);
  };

  options.signal.addEventListener(
    "abort",
    () => {
      for (const timer of renewalTasks.values()) clearInterval(timer);
      renewalTasks.clear();
      for (const current of leases.values()) void substrate.coordination.release(current);
      leases.clear();
    },
    { once: true },
  );

  return {
    async registerConsumer(input) {
      const splits = (await substrate.events.topology()).splits.map(({ id }) => id);
      if (splits.length !== 1 || !splits[0]) {
        throw new Error("This Program executor requires exactly one committed-event split.");
      }
      const target: AdapterProgramAssignment = {
        program: input.consumerId,
        split: splits[0],
        keyGroup: 0,
      };
      assignments.set(input.consumerId, target);
      const result = await substrate.programs.register({
        id: input.consumerId,
        source: {
          events: input.definition.events,
          replay: input.definition.startAt === "origin" ? "all" : "new",
          key:
            input.definition.partition === "resource"
              ? "resource"
              : { version: customPartitionVersion(input.definition.partition) },
          version: input.definition.version,
        },
      });
      await lease(input.consumerId);
      startRenewal(input.consumerId);
      return result;
    },
    async getConsumerDefinition(consumerId) {
      const registration = await substrate.programs.registration(consumerId);
      return registration
        ? {
            events: registration.source.events,
            startAt: registration.source.replay === "all" ? "origin" : "now",
            partition:
              registration.source.key === "resource"
                ? "resource"
                : `custom:${registration.source.key.version}`,
            version: registration.source.version,
          }
        : undefined;
    },
    async claim(input) {
      for (;;) {
        const current = await lease(input.consumerId);
        const claimed = await substrate.programs.claim({
          lease: current,
          delivery: {
            id: input.key,
            cursor: sourceCursor(current.assignment.split, String(input.cursor.position)),
            index: input.cursor.index,
            key: input.scopeId,
          },
        });
        if (claimed.status !== "claimed") {
          if (claimed.status === "completed") return { status: "completed" };
          leases.delete(input.consumerId);
          continue;
        }
        return {
          status: "running",
          invocation: {
            key: input.key,
            cursor: input.cursor,
            attempt: claimed.invocation.attempt,
            epoch: claimed.invocation.epoch,
            status: "running",
            uncertainAttempts: claimed.invocation.uncertainAttempts,
          },
        };
      }
    },
    async complete(input) {
      const current = await lease(input.consumerId);
      return substrate.programs.complete({
        lease: current,
        invocation: {
          delivery: {
            id: input.key,
            cursor: sourceCursor(current.assignment.split, String(input.cursor.position)),
            index: input.cursor.index,
            key: input.scopeId,
          },
          attempt: 1,
          epoch: input.epoch,
          uncertainAttempts: [],
        },
      });
    },
    async getCheckpoint(consumerId) {
      const current = await substrate.programs.checkpoint(assignment(consumerId));
      return current ? { position: Number(current.value), index: 0 } : undefined;
    },
    async getInvocation() {
      return null;
    },
    async getSourcePosition(consumerId) {
      const current = await substrate.programs.checkpoint(assignment(consumerId));
      return current ? Number(current.value) : undefined;
    },
    async setSourcePosition(consumerId, position) {
      const current = await lease(consumerId);
      const status = await substrate.programs.advance({
        lease: current,
        cursor: sourceCursor(current.assignment.split, String(position)),
      });
      if (status === "stale") leases.delete(consumerId);
    },
    async inspectConsumer(consumerId) {
      const definition = await this.getConsumerDefinition(consumerId);
      if (!definition) return undefined;
      return {
        consumerId,
        definition,
        sourcePosition: (await this.getSourcePosition(consumerId)) ?? 0,
        scopes: [],
      };
    },
    resetConsumer() {
      throw new Error("Program progress migration belongs to substrate administration.");
    },
    moveConsumer() {
      throw new Error("Program progress migration belongs to substrate administration.");
    },
    removeConsumer() {
      throw new Error("Program progress migration belongs to substrate administration.");
    },
  };
}

function customPartitionVersion(value: string): number {
  const match = /^custom:([1-9]\d*)$/.exec(value);
  if (!match) throw new Error(`Unsupported Program partition ${JSON.stringify(value)}.`);
  return Number(match[1]);
}

type ProgramScopeState = Readonly<{
  checkpoint: ProgramEventCursor | null;
  invocation: ProgramInvocation | null;
}>;

type MutableProgramScopeState = {
  checkpoint: ProgramEventCursor | null;
  invocation: ProgramInvocation | null;
};

type ProgramSourceState = Readonly<{
  definition: ProgramConsumerDefinition | null;
  position: number;
}>;

function emptyProgramScopeState(): ProgramScopeState {
  return { checkpoint: null, invocation: null };
}

function claimProgramInvocation(
  state: ProgramScopeState,
  key: string,
  cursor: ProgramEventCursor,
): Readonly<{ state: ProgramScopeState; claim: ProgramInvocationClaim }> {
  assertProgramProgressInput(key, cursor);
  if (state.checkpoint && compareEventCursors(cursor, state.checkpoint) <= 0) {
    return { state, claim: { status: "completed" } };
  }
  const previous = state.invocation;
  if (previous && previous.status === "running" && previous.key !== key) {
    throw new JournalCorruptionError(
      `Program tried to claim ${JSON.stringify(key)} before completing ${JSON.stringify(previous.key)}.`,
    );
  }
  const retry = previous?.status === "running" && previous.key === key ? previous : null;
  const invocation: ProgramInvocation = {
    key,
    cursor,
    attempt: (retry?.attempt ?? 0) + 1,
    epoch: (retry?.epoch ?? 0) + 1,
    status: "running",
    uncertainAttempts: retry ? [...retry.uncertainAttempts, retry.attempt] : [],
  };
  return { state: { ...state, invocation }, claim: { status: "running", invocation } };
}

function completeProgramInvocation(
  state: ProgramScopeState,
  key: string,
  cursor: ProgramEventCursor,
  epoch: number,
): Readonly<{ state: ProgramScopeState; status: "completed" | "stale" }> {
  assertProgramProgressInput(key, cursor);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) {
    throw new TypeError("A Program assignment epoch must be a positive integer.");
  }
  if (state.checkpoint && compareEventCursors(cursor, state.checkpoint) <= 0) {
    return { state, status: "completed" };
  }
  const current = state.invocation;
  if (
    !current ||
    current.status !== "running" ||
    current.key !== key ||
    compareEventCursors(current.cursor, cursor) !== 0 ||
    current.epoch !== epoch
  ) {
    return { state, status: "stale" };
  }
  return {
    state: {
      checkpoint: cursor,
      invocation: { ...current, status: "completed" },
    },
    status: "completed",
  };
}

async function loadProgramScope(
  journal: Journal,
  address: ResourceAddress,
): Promise<Readonly<{ state: ProgramScopeState; head: JournalHead }>> {
  const loaded = await journal.load<ProgramProgressRecord, ProgramScopeState>(address);
  if (loaded.snapshot) assertProgramProgressSchema(loaded.snapshot.schema);
  let state = loaded.snapshot
    ? assertProgramScopeState(loaded.snapshot.state)
    : emptyProgramScopeState();
  if (loaded.snapshot) assertProgramSnapshotHash(loaded.snapshot.state, loaded.snapshot.stateHash);
  for (const record of loaded.records) {
    assertProgramProgressSchema(record.schema);
    const progress = record.decision;
    if (progress.kind === "replaceScope") {
      state = assertProgramScopeState(progress.state);
    } else if (progress.kind === "claim") {
      state = claimProgramInvocation(state, progress.key, progress.cursor).state;
      const invocation = state.invocation!;
      if (
        invocation.attempt !== progress.attempt ||
        invocation.epoch !== progress.epoch ||
        JSON.stringify(invocation.uncertainAttempts) !== JSON.stringify(progress.uncertainAttempts)
      ) {
        throw new JournalCorruptionError("Program claim metadata does not match its history.");
      }
    } else if (progress.kind === "complete") {
      const completed = completeProgramInvocation(
        state,
        progress.key,
        progress.cursor,
        progress.epoch,
      );
      if (completed.status !== "completed") {
        throw new JournalCorruptionError("Program history contains a stale completion.");
      }
      state = completed.state;
    } else {
      throw new JournalCorruptionError("Program scope history contains source progress.");
    }
  }
  return { state, head: loaded.head };
}

async function loadProgramSource(
  journal: Journal,
  address: ResourceAddress,
): Promise<Readonly<{ state: ProgramSourceState; head: JournalHead }>> {
  const loaded = await journal.load<ProgramProgressRecord, ProgramSourceState>(address);
  if (loaded.snapshot) assertProgramProgressSchema(loaded.snapshot.schema);
  let state = loaded.snapshot
    ? assertProgramSourceState(loaded.snapshot.state)
    : { definition: null, position: 0 };
  if (loaded.snapshot) assertProgramSnapshotHash(loaded.snapshot.state, loaded.snapshot.stateHash);
  for (const record of loaded.records) {
    assertProgramProgressSchema(record.schema);
    if (record.decision.kind === "replaceSource") {
      assertProgramSourcePosition(record.decision.position);
      if (record.decision.definition !== null) {
        assertConsumerDefinition(record.decision.definition);
      }
      state = {
        definition:
          record.decision.definition === null
            ? null
            : freezeConsumerDefinition(record.decision.definition),
        position: record.decision.position,
      };
      continue;
    }
    if (record.decision.kind === "register") {
      if (state.definition) {
        throw new JournalCorruptionError("Program source history registers a consumer twice.");
      }
      state = {
        definition: freezeConsumerDefinition(record.decision.definition),
        position: record.decision.position,
      };
      continue;
    }
    if (record.decision.kind !== "source") {
      throw new JournalCorruptionError("Program source history contains invocation progress.");
    }
    if (!state.definition) {
      throw new JournalCorruptionError("Program source history advances an unregistered consumer.");
    }
    if (record.decision.position < state.position) {
      throw new JournalCorruptionError("Program source position moved backwards.");
    }
    state = { ...state, position: record.decision.position };
  }
  return { state, head: loaded.head };
}

async function appendProgramProgress(
  journal: Journal,
  address: ResourceAddress,
  expected: JournalHead,
  intentId: string,
  progress: ProgramProgress,
): Promise<JournalHead | null> {
  const result = await journal.append<ProgramProgressRecord>({
    address,
    expected,
    record: {
      schema: programProgressSchema,
      intent: { id: intentId, inputHash: intentId, value: progress },
      decision: { ...progress, events: [] },
    },
  });
  return result.status === "conflict"
    ? null
    : { revision: result.record.revision, position: result.record.position };
}

async function saveProgramSnapshot<State>(
  journal: Journal,
  address: ResourceAddress,
  head: JournalHead,
  state: State,
): Promise<void> {
  try {
    await journal.saveSnapshot({
      address,
      ...head,
      schema: programProgressSchema,
      stateHash: programStateHash(state),
      state,
      storedAt: Date.now(),
    });
  } catch {
    // Progress records are authoritative; this snapshot only bounds replay work.
  }
}

function assertProgramScopeState(value: unknown): ProgramScopeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JournalCorruptionError("Program scope snapshot is malformed.");
  }
  const state = value as Partial<ProgramScopeState>;
  if (state.checkpoint !== null) {
    assertProgramEventCursor(state.checkpoint);
  }
  if (state.checkpoint === undefined) {
    throw new JournalCorruptionError("Program scope checkpoint is malformed.");
  }
  if (state.invocation !== null) assertProgramInvocation(state.invocation);
  return state as ProgramScopeState;
}

function assertProgramSourceState(value: unknown): ProgramSourceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JournalCorruptionError("Program source snapshot is malformed.");
  }
  const state = value as Partial<ProgramSourceState>;
  if (!Number.isSafeInteger(state.position) || state.position! < 0) {
    throw new JournalCorruptionError("Program source position is malformed.");
  }
  if (state.definition !== null) assertConsumerDefinition(state.definition);
  if (state.definition === undefined) {
    throw new JournalCorruptionError("Program source definition is malformed.");
  }
  return state as ProgramSourceState;
}

function assertProgramInvocation(value: unknown): asserts value is ProgramInvocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JournalCorruptionError("Program invocation snapshot is malformed.");
  }
  const invocation = value as Partial<ProgramInvocation>;
  assertProgramEventCursor(invocation.cursor);
  if (
    typeof invocation.key !== "string" ||
    !Number.isSafeInteger(invocation.attempt) ||
    invocation.attempt! <= 0 ||
    !Number.isSafeInteger(invocation.epoch) ||
    invocation.epoch! <= 0 ||
    (invocation.status !== "running" && invocation.status !== "completed") ||
    !Array.isArray(invocation.uncertainAttempts) ||
    !invocation.uncertainAttempts.every((attempt) => Number.isSafeInteger(attempt) && attempt > 0)
  ) {
    throw new JournalCorruptionError("Program invocation snapshot is malformed.");
  }
}

function assertProgramSnapshotHash(state: unknown, expected: string): void {
  if (programStateHash(state) !== expected) {
    throw new JournalCorruptionError("Program progress snapshot failed its state checksum.");
  }
}

function assertProgramProgressInput(key: string, cursor: ProgramEventCursor): void {
  if (key.length === 0) throw new TypeError("A Program invocation key cannot be empty.");
  assertProgramEventCursor(cursor);
}

function assertProgramSourcePosition(position: number): void {
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new TypeError("A Program source position must be a non-negative integer.");
  }
}

function resetSourcePosition(
  input:
    | { readonly startAt: "origin" }
    | { readonly startAt: "now"; readonly sourcePosition: number },
): number {
  if (input.startAt === "origin") return 0;
  assertProgramSourcePosition(input.sourcePosition);
  return input.sourcePosition;
}

function assertConsumerIsIdle(progress: ProgramConsumerProgress): void {
  if (progress.scopes.some(({ invocation }) => invocation?.status === "running")) {
    throw new Error(`Program consumer ${JSON.stringify(progress.consumerId)} has unfinished work.`);
  }
}

function assertProgramProgressSchema(schema: string): void {
  if (schema !== programProgressSchema) {
    throw new JournalCorruptionError(
      `Unsupported Program progress schema ${JSON.stringify(schema)}; expected ${JSON.stringify(programProgressSchema)}.`,
    );
  }
}

function assertProgramEventRecord<Spec extends AppSpec>(value: ProgramEventRecord<Spec>): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("A Program event record must be an object.");
  }
  const record = value as Partial<ProgramEventRecord>;
  if (typeof record.resource !== "string" || record.resource.length === 0 || !record.event) {
    throw new TypeError("A Program event record is malformed.");
  }
  const event = record.event;
  assertProgramEventCursor(event);
  if (
    typeof event.id !== "string" ||
    event.id.length === 0 ||
    !Number.isSafeInteger(event.seq) ||
    event.seq <= 0 ||
    !Number.isFinite(event.at) ||
    !Number.isSafeInteger(event.version) ||
    event.version <= 0 ||
    typeof event.name !== "string" ||
    event.name.length === 0
  ) {
    throw new TypeError("A Program event record is malformed.");
  }
}

function assertProgramEventCursor(value: unknown): asserts value is ProgramEventCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("A Program event cursor must be an object.");
  }
  const cursor = value as Partial<ProgramEventCursor>;
  if (
    !Number.isSafeInteger(cursor.position) ||
    cursor.position! <= 0 ||
    !Number.isSafeInteger(cursor.index) ||
    cursor.index! < 0
  ) {
    throw new TypeError("A Program event cursor must contain a positive position and index.");
  }
}

function assertConsumerRegistration(input: {
  consumerId: string;
  definition: ProgramConsumerDefinition;
  initialSourcePosition: number;
}): void {
  if (input.consumerId.length === 0) throw new TypeError("A Program consumer id cannot be empty.");
  if (!Number.isSafeInteger(input.initialSourcePosition) || input.initialSourcePosition < 0) {
    throw new TypeError("A Program consumer source position must be a non-negative integer.");
  }
  assertConsumerDefinition(input.definition);
}

function assertConsumerDefinition(value: unknown): asserts value is ProgramConsumerDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("A Program consumer definition must be an object.");
  }
  const definition = value as Partial<ProgramConsumerDefinition>;
  if (
    !Array.isArray(definition.events) ||
    definition.events.length === 0 ||
    !definition.events.every((event) => typeof event === "string" && event.length > 0) ||
    new Set(definition.events).size !== definition.events.length ||
    (definition.startAt !== "origin" && definition.startAt !== "now") ||
    typeof definition.partition !== "string" ||
    definition.partition.length === 0 ||
    !Number.isSafeInteger(definition.version) ||
    definition.version! <= 0
  ) {
    throw new TypeError("A Program consumer definition is malformed.");
  }
}

function freezeConsumerDefinition(
  definition: ProgramConsumerDefinition,
): ProgramConsumerDefinition {
  assertConsumerDefinition(definition);
  return Object.freeze({
    events: Object.freeze([...definition.events].sort()),
    startAt: definition.startAt,
    partition: definition.partition,
    version: definition.version,
  });
}

function sameConsumerDefinition(
  left: ProgramConsumerDefinition,
  right: ProgramConsumerDefinition,
): boolean {
  return consumerDefinitionHash(left) === consumerDefinitionHash(right);
}

function consumerDefinitionHash(definition: ProgramConsumerDefinition): string {
  const normalized = freezeConsumerDefinition(definition);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function compareEventCursors(left: ProgramEventCursor, right: ProgramEventCursor): number {
  return left.position === right.position
    ? left.index - right.index
    : left.position - right.position;
}

function programScopeAddress(program: string, consumer: string, scope: string): ResourceAddress {
  return { resource: "$poggers.program", key: { program, consumer, scope } };
}

function programScopeFromAddress(
  address: ResourceAddress,
  program: string,
  consumer: string,
): string | undefined {
  if (
    address.resource !== "$poggers.program" ||
    !address.key ||
    typeof address.key !== "object" ||
    Array.isArray(address.key)
  ) {
    return undefined;
  }
  return address.key.program === program &&
    address.key.consumer === consumer &&
    typeof address.key.scope === "string"
    ? address.key.scope
    : undefined;
}

function programSourceAddress(program: string, consumer: string): ResourceAddress {
  return { resource: "$poggers.program-source", key: { program, consumer } };
}

function programStateHash(state: unknown): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export type ProgramCommand<Spec extends AppSpec> = <Resource extends ResourceName<Spec>>(
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  command: keyof ResourceFor<Spec, Resource>["Commands"] & string,
  args: readonly unknown[],
  commandId: string,
  actor?: ActorOf<Spec>,
  at?: number,
) => ProgramCommandResult;

export type ProgramCommandResult = Promise<
  Readonly<{ ok: true; cursor?: number }> | Readonly<{ ok: false; error: string; data?: unknown }>
>;

type ProgramSetPresence<Spec extends AppSpec> = (
  resource: ResourceName<Spec>,
  key: JsonValue,
  value: JsonValue,
  actor?: ActorOf<Spec>,
) => void;

export type AppProgram<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = NonNullable<
  AppProgramRunners<Spec>[Env]
>;

export type StartProgramOptions<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
> = Readonly<{
  env: Env;
  deps: EnvironmentDeps<Spec, Env>;
  programId?: string;
  actor?: ActorOf<Spec>;
  progress?: ProgramProgressStore;
  maxPendingEvents?: number;
  maxPendingBytes?: number;
  signal?: AbortSignal;
  sourcePosition?: () => number | Promise<number>;
  onConsumersChanged?: () => void;
  restartPolicy?: Partial<ProgramRestartPolicy>;
  readViews: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
    actor?: ActorOf<Spec>,
  ) => ViewShape<Spec, Resource>;
  command: ProgramCommand<Spec>;
  setPresence?: ProgramSetPresence<Spec>;
  onError?: (error: unknown) => void;
}>;

export type ProgramRuntime<Spec extends AppSpec = AppSpec> = Readonly<{
  enqueue(events: ProgramEventRecord<Spec> | readonly ProgramEventRecord<Spec>[]): Promise<void>;
  checkpoint(scopeId: string): Promise<ProgramEventCursor | undefined>;
  sourcePosition(): Promise<number>;
  advanceSource(position: number): Promise<void>;
  health(): ProgramRuntimeHealth;
  drain(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
}>;

function normalizeProgramRestartPolicy(
  input: Partial<ProgramRestartPolicy> | undefined,
): ProgramRestartPolicy {
  const policy: ProgramRestartPolicy = {
    initialDelayMs: input?.initialDelayMs ?? 25,
    maximumDelayMs: input?.maximumDelayMs ?? 5_000,
    factor: input?.factor ?? 2,
    jitter: input?.jitter ?? 0.2,
    healthyAfterMs: input?.healthyAfterMs ?? 30_000,
    now: input?.now ?? Date.now,
    random: input?.random ?? Math.random,
    sleep:
      input?.sleep ??
      ((delayMs, signal) =>
        new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason ?? new Error("Program runtime stopped."));
            return;
          }
          const abort = () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("Program runtime stopped."));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, delayMs);
          signal.addEventListener("abort", abort, { once: true });
        })),
  };
  if (!Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs < 0) {
    throw new TypeError("Program restart initialDelayMs must be non-negative.");
  }
  if (!Number.isFinite(policy.maximumDelayMs) || policy.maximumDelayMs < policy.initialDelayMs) {
    throw new TypeError("Program restart maximumDelayMs must not be below initialDelayMs.");
  }
  if (!Number.isFinite(policy.factor) || policy.factor < 1) {
    throw new TypeError("Program restart factor must be at least one.");
  }
  if (!Number.isFinite(policy.jitter) || policy.jitter < 0 || policy.jitter > 1) {
    throw new TypeError("Program restart jitter must be between zero and one.");
  }
  if (!Number.isFinite(policy.healthyAfterMs) || policy.healthyAfterMs < 0) {
    throw new TypeError("Program restart healthyAfterMs must be non-negative.");
  }
  return Object.freeze(policy);
}

export function run<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  app: App<Spec>,
  options: StartProgramOptions<Spec, Env>,
): ProgramRuntime<Spec> {
  const program = app.def.programs?.[options.env] as AppProgram<Spec, Env> | undefined;
  if (!program)
    throw new Error(`App has no Program for environment ${JSON.stringify(options.env)}.`);
  return startProgram(app, program, options);
}

export function startProgram<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  app: App<Spec>,
  program: AppProgram<Spec, Env>,
  options: StartProgramOptions<Spec, Env>,
): ProgramRuntime<Spec> {
  const programId = options.programId ?? String(options.env);
  const actor = options.actor ?? ({ id: programId } as ActorOf<Spec>);
  const progress = options.progress ?? createMemoryProgramProgressStore();
  const maxPendingEvents = options.maxPendingEvents ?? defaultMaxPendingEvents;
  if (!Number.isSafeInteger(maxPendingEvents) || maxPendingEvents <= 0) {
    throw new TypeError("Program maxPendingEvents must be a positive integer.");
  }
  const maxPendingBytes = options.maxPendingBytes ?? defaultMaxPendingBytes;
  if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0) {
    throw new TypeError("Program maxPendingBytes must be a positive integer.");
  }
  const root = new AbortController();
  const restartPolicy = normalizeProgramRestartPolicy(options.restartPolicy);
  let generation: ProgramGeneration<Spec> | undefined;
  let generationNumber = 0;
  let consecutiveFailures = 0;
  let restartTask: Promise<void> | undefined;
  let health: ProgramRuntimeHealth = {
    status: "running",
    generation: 0,
    consecutiveFailures: 0,
  };

  if (options.signal) {
    if (options.signal.aborted) root.abort(options.signal.reason);
    else {
      options.signal.addEventListener("abort", () => root.abort(options.signal?.reason), {
        once: true,
      });
    }
  }

  const waitUntilIdle = async (current: ProgramGeneration<Spec>): Promise<void> => {
    for (;;) {
      if (current.failure !== noProgramFailure) {
        await current.done;
        throw current.failure;
      }
      if (current.pendingChecks.size > 0) {
        try {
          await Promise.all(current.pendingChecks);
        } catch (error) {
          if (current.failure === noProgramFailure) throw error;
          await current.done;
          throw current.failure;
        }
        continue;
      }
      if (![...current.consumers].some((consumer) => consumer.isBusy())) return;
      await new Promise<void>((resolve) => current.idleWaiters.add(resolve));
    }
  };

  const startGeneration = (): ProgramGeneration<Spec> => {
    generationNumber += 1;
    const startedAt = restartPolicy.now();
    health = {
      status: "running",
      generation: generationNumber,
      consecutiveFailures,
      startedAt,
    };
    const controller = new AbortController();
    let resolveDone!: () => void;
    let rejectDone!: (error: unknown) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const current: ProgramGeneration<Spec> = {
      controller,
      consumers: new Set(),
      consumersByEvent: new Map(),
      consumerIds: new Set(),
      registrations: new Set(),
      pendingChecks: new Set(),
      idleWaiters: new Set(),
      resourceObservers: new Map(),
      fail: (error) => finish(error),
      failure: noProgramFailure,
      settled: false,
      programTask: Promise.resolve(),
      cleanupStarted: false,
      done,
    };
    const abort = () => {
      health = { ...health, status: "stopped", restartAt: undefined };
      finish(noProgramFailure);
    };
    if (root.signal.aborted) abort();
    else root.signal.addEventListener("abort", abort, { once: true });

    const notifyIdle = (): void => {
      if (current.idleWaiters.size === 0) return;
      const waiters = [...current.idleWaiters];
      current.idleWaiters.clear();
      for (const waiter of waiters) waiter();
    };
    function finish(failure: unknown | typeof noProgramFailure): void {
      if (current.settled) return;
      current.settled = true;
      current.failure = failure;
      if (failure !== noProgramFailure) {
        current.failedConsumerIds = [...current.consumerIds];
        const failedAt = restartPolicy.now();
        if (failedAt - startedAt >= restartPolicy.healthyAfterMs) consecutiveFailures = 0;
        consecutiveFailures += 1;
        health = {
          status: "failed",
          generation: generationNumber,
          consecutiveFailures,
          startedAt,
          failedAt,
          error: failure,
        };
      }
      if (failure !== noProgramFailure) options.onError?.(failure);
      controller.abort(failure === noProgramFailure ? undefined : failure);
      for (const consumer of current.consumers) consumer.close();
      root.signal.removeEventListener("abort", abort);
      notifyIdle();
      void (async () => {
        let result: void | ProgramCleanup;
        try {
          result = await current.programTask;
        } catch {
          result = undefined;
        }
        if (typeof result === "function") current.cleanup = result;
        if (!current.cleanup || current.cleanupStarted) {
          resolveDone();
          return;
        }
        current.cleanupStarted = true;
        try {
          await current.cleanup();
          resolveDone();
        } catch (cleanupError) {
          const reported =
            failure === noProgramFailure
              ? cleanupError
              : new AggregateError(
                  [failure, cleanupError],
                  "Program failure was followed by a cleanup failure.",
                );
          options.onError?.(reported);
          rejectDone(reported);
        }
      })();
    }
    const track = (task: Promise<void>): void => {
      current.pendingChecks.add(task);
      const settled = () => {
        current.pendingChecks.delete(task);
        notifyIdle();
      };
      void task.then(settled, (error) => {
        settled();
        finish(error);
      });
    };
    const trackRegistration = (task: Promise<void>): void => {
      current.registrations.add(task);
      track(task);
      const settled = () => {
        current.registrations.delete(task);
        notifyIdle();
      };
      void task.then(settled, settled);
    };
    const context = createProgramContext(
      app,
      actor,
      options.readViews,
      options.command,
      options.setPresence,
      progress,
      options.sourcePosition,
      controller.signal,
      current.consumers,
      current.consumersByEvent,
      current.consumerIds,
      current.resourceObservers,
      maxPendingEvents,
      maxPendingBytes,
      track,
      trackRegistration,
      finish,
      notifyIdle,
      options.onConsumersChanged,
    );
    generation = current;
    try {
      current.programTask = Promise.resolve(program(context, options.deps));
      void current.programTask.then((result) => {
        if (typeof result === "function") current.cleanup = result;
      }, finish);
    } catch (error) {
      finish(error);
    }
    return current;
  };

  const waitForRegistrations = async (current: ProgramGeneration<Spec>): Promise<void> => {
    while (current.registrations.size > 0) {
      await Promise.all(current.registrations);
    }
  };

  const currentGeneration = (): ProgramGeneration<Spec> => {
    if (root.signal.aborted) throw root.signal.reason ?? new Error("Program runtime stopped.");
    if (!generation) return startGeneration();
    return generation;
  };

  const failedSourcePosition = async (current: ProgramGeneration<Spec>): Promise<number> => {
    const ids = current.failedConsumerIds ?? [];
    if (ids.length === 0) return Number.POSITIVE_INFINITY;
    let position = Number.POSITIVE_INFINITY;
    for (const id of ids) {
      position = Math.min(position, (await progress.getSourcePosition(id)) ?? 0);
    }
    return position;
  };

  if (!root.signal.aborted) startGeneration();

  return {
    async enqueue(events) {
      const current = currentGeneration();
      await waitForRegistrations(current);
      if (current.failure !== noProgramFailure) return;
      const records = Array.isArray(events) ? events : [events];
      let previous: ProgramEventCursor | undefined;
      for (const stored of records) {
        assertProgramEventRecord(stored);
        const cursor = eventCursor(stored);
        if (previous && compareEventCursors(cursor, previous) <= 0) {
          throw new TypeError("Program event batches must be in strict source order.");
        }
        previous = cursor;
        const event = upcastEvent(app, stored);
        const observers =
          current.resourceObservers.size === 0
            ? undefined
            : current.resourceObservers.get(scopeId(event.resource, event.key));
        if (observers) {
          try {
            for (const observer of observers) observer.notify();
          } catch (error) {
            current.fail(error);
            throw error;
          }
        }
        const consumers = current.consumersByEvent.get(
          programEventKey(event.resource, event.event.name),
        );
        if (!consumers || consumers.size === 0) continue;
        if (consumers.size === 1) {
          const pending = consumers.values().next().value!.enqueue(event);
          if (pending) await pending;
          continue;
        }
        const pending: Promise<void>[] = [];
        for (const consumer of consumers) {
          const delivery = consumer.enqueue(event);
          if (delivery) pending.push(delivery);
        }
        if (pending.length > 0) await Promise.all(pending);
      }
    },
    async checkpoint(id) {
      const current = generation;
      if (current && current.failure !== noProgramFailure) {
        const consumers = current.failedConsumerIds ?? [];
        let cursor: ProgramEventCursor | undefined;
        for (const consumer of consumers) {
          const checkpoint = await progress.getCheckpoint(consumer, id);
          if (checkpoint && (!cursor || compareEventCursors(checkpoint, cursor) < 0)) {
            cursor = checkpoint;
          }
        }
        return cursor;
      }
      if (!current || current.consumers.size === 0) return undefined;
      let cursor: ProgramEventCursor | undefined;
      for (const consumer of current.consumers) {
        const checkpoint = await progress.getCheckpoint(consumer.durableId, id);
        if (checkpoint && (!cursor || compareEventCursors(checkpoint, cursor) < 0)) {
          cursor = checkpoint;
        }
      }
      return cursor;
    },
    async sourcePosition() {
      const current = currentGeneration();
      await waitForRegistrations(current);
      if (current.failure !== noProgramFailure) return failedSourcePosition(current);
      if (current.consumers.size === 0) return Number.POSITIVE_INFINITY;
      let position = Number.POSITIVE_INFINITY;
      for (const consumer of current.consumers) {
        position = Math.min(position, await consumer.sourcePosition());
      }
      return position;
    },
    async advanceSource(position) {
      assertProgramSourcePosition(position);
      const current = currentGeneration();
      await waitForRegistrations(current);
      if (current.failure !== noProgramFailure) return;
      for (const consumer of current.consumers) consumer.advanceSource(position);
    },
    health() {
      return Object.freeze({ ...health });
    },
    async drain() {
      if (!generation) return;
      await waitForRegistrations(generation);
      await waitUntilIdle(generation);
      await Promise.all([...generation.consumers].map((consumer) => consumer.sourcePosition()));
    },
    async restart() {
      if (root.signal.aborted) throw root.signal.reason ?? new Error("Program runtime stopped.");
      if (!generation || generation.failure === noProgramFailure) return;
      if (restartTask) return restartTask;
      const failedGeneration = generation;
      restartTask = (async () => {
        await failedGeneration.done.catch(() => undefined);
        const base = Math.min(
          restartPolicy.maximumDelayMs,
          restartPolicy.initialDelayMs *
            restartPolicy.factor ** Math.max(0, consecutiveFailures - 1),
        );
        const spread = base * restartPolicy.jitter;
        const delay = Math.max(0, base - spread + restartPolicy.random() * spread * 2);
        health = {
          ...health,
          status: "restarting",
          restartAt: restartPolicy.now() + delay,
        };
        await restartPolicy.sleep(delay, root.signal);
        if (root.signal.aborted) {
          throw root.signal.reason ?? new Error("Program runtime stopped.");
        }
        if (generation !== failedGeneration) return;
        generation = undefined;
        startGeneration();
      })().finally(() => {
        restartTask = undefined;
      });
      return restartTask;
    },
    async stop() {
      const current = generation;
      if (current) {
        await Promise.allSettled(
          [...current.consumers].map((consumer) => consumer.sourcePosition()),
        );
      }
      if (!root.signal.aborted) root.abort("Program runtime stopped.");
      health = { ...health, status: "stopped", restartAt: undefined };
      if (!current) return;
      current.controller.abort(root.signal.reason);
      for (const consumer of current.consumers) consumer.close();
      for (const waiter of current.idleWaiters) waiter();
      current.idleWaiters.clear();
      await current.done;
    },
  };
}

const noProgramFailure = Symbol("no Program failure");

type ProgramGeneration<Spec extends AppSpec> = {
  readonly controller: AbortController;
  readonly consumers: Set<ProgramConsumer<Spec>>;
  readonly consumersByEvent: Map<string, Set<ProgramConsumer<Spec>>>;
  readonly consumerIds: Set<string>;
  readonly registrations: Set<Promise<void>>;
  readonly pendingChecks: Set<Promise<void>>;
  readonly idleWaiters: Set<() => void>;
  readonly resourceObservers: ProgramResourceObservers;
  readonly fail: (error: unknown) => void;
  failure: unknown | typeof noProgramFailure;
  failedConsumerIds?: readonly string[];
  settled: boolean;
  programTask: Promise<void | ProgramCleanup>;
  cleanup?: ProgramCleanup;
  cleanupStarted: boolean;
  done: Promise<void>;
};

type ProgramResourceObserver = Readonly<{ notify(): void }>;
type ProgramResourceObservers = Map<string, Set<ProgramResourceObserver>>;
type ProgramResourceSubscriber = (
  resource: string,
  key: JsonValue,
  actor: () => unknown,
  observer: (view: Readonly<Record<string, unknown>>) => void,
) => () => void;

type ProgramPendingEvent<Spec extends AppSpec> = Readonly<{
  stored: ProgramEventRecord<Spec>;
  completionKey: string;
  scope: string;
  bytes: number;
}>;

type ProgramConsumer<Spec extends AppSpec> = {
  readonly durableId: string;
  readonly eventKeys: readonly string[];
  readonly done: Promise<void>;
  enqueue(stored: ProgramEventRecord<Spec>): void | Promise<void>;
  advanceSource(position: number): void;
  sourcePosition(): Promise<number>;
  isBusy(): boolean;
  close(): void;
};

function programEventKey(resource: string, name: string): string {
  return `${resource}\u0000${name}`;
}

function eventCursor(event: ProgramEventRecord): ProgramEventCursor {
  return { position: event.event.position, index: event.event.index };
}

class MinHeap {
  readonly #values: number[] = [];

  peek(): number | undefined {
    return this.#values[0];
  }

  push(value: number): void {
    const values = this.#values;
    let index = values.length;
    values.push(value);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (values[parent]! <= value) break;
      values[index] = values[parent]!;
      index = parent;
    }
    values[index] = value;
  }

  pop(): number | undefined {
    const values = this.#values;
    const first = values[0];
    const last = values.pop();
    if (values.length === 0 || last === undefined) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= values.length) break;
      const right = left + 1;
      const child = right < values.length && values[right]! < values[left]! ? right : left;
      if (values[child]! >= last) break;
      values[index] = values[child]!;
      index = child;
    }
    values[index] = last;
    return first;
  }
}

function createProgramContext<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  readViews: StartProgramOptions<Spec, Env>["readViews"],
  command: ProgramCommand<Spec>,
  setPresence: ProgramSetPresence<Spec> | undefined,
  progress: ProgramProgressStore,
  sourcePosition: (() => number | Promise<number>) | undefined,
  signal: AbortSignal,
  consumers: Set<ProgramConsumer<Spec>>,
  consumersByEvent: Map<string, Set<ProgramConsumer<Spec>>>,
  consumerIds: Set<string>,
  resourceObservers: ProgramResourceObservers,
  maxPendingEvents: number,
  maxPendingBytes: number,
  track: (task: Promise<void>) => void,
  trackRegistration: (task: Promise<void>) => void,
  fail: (error: unknown) => void,
  notifyIdle: () => void,
  onConsumersChanged: (() => void) | undefined,
): InternalProgramContext<Spec, Env> {
  const hooks: Record<PropertyKey, unknown> = { actor, signal };
  const subscribeResource: ProgramResourceSubscriber = (resource, key, getActor, observer) => {
    const id = scopeId(resource, key);
    const entry: ProgramResourceObserver = {
      notify() {
        observer(
          readViews(
            resource as ResourceName<Spec>,
            key as never,
            getActor() as ActorOf<Spec> | undefined,
          ),
        );
      },
    };
    const entries = resourceObservers.get(id) ?? new Set();
    entries.add(entry);
    resourceObservers.set(id, entries);
    const close = (): void => {
      entries.delete(entry);
      if (entries.size === 0) resourceObservers.delete(id);
    };
    signal.addEventListener("abort", close, { once: true });
    try {
      entry.notify();
    } catch (error) {
      close();
      throw error;
    }
    return close;
  };
  const apis = app.createAPIs({
    actor,
    resolveResource(path, name) {
      const resource = (path ? featureResourceName(path, name) : name) as ResourceName<Spec>;
      return (key: JsonValue) =>
        createProgramResource(
          app,
          readViews,
          command,
          setPresence,
          () => null,
          () => actor,
          resource,
          key as never,
          subscribeResource,
        );
    },
  });
  hooks.api = apis.api;
  hooks[Symbol.for("poggers.featureAPIs")] = apis;
  const resources: Record<string, unknown> = {};
  for (const resource of Object.keys(app.def.resources)) {
    resources[resource] = (key: JsonValue) =>
      createProgramResource(
        app,
        readViews,
        command,
        setPresence,
        () => null,
        () => actor,
        resource as ResourceName<Spec>,
        key as never,
        subscribeResource,
      );
  }
  hooks.resources = Object.freeze(resources);
  const registerConsumer = async (options: {
    id: string;
    events: readonly AppEventName<Spec>[];
    startAt: "origin" | "now";
    signal?: AbortSignal;
    concurrency?: number;
    partitionBy?: (input: {
      event: ProgramEventItem<Spec, AppEventName<Spec>>["event"];
    }) => JsonValue;
    partitionRevision?: number;
    version?: number;
    run: (item: ProgramEventItem<Spec, AppEventName<Spec>>) => void | Promise<void>;
  }) => {
    if (!options?.id) throw new Error("A durable Program requires an id.");
    if (!Array.isArray(options.events) || options.events.length === 0) {
      throw new TypeError("consume() requires at least one event name.");
    }
    if (new Set(options.events).size !== options.events.length) {
      throw new TypeError("consume() event names must be unique.");
    }
    if (options.startAt !== "origin" && options.startAt !== "now") {
      throw new TypeError("A durable Program replay policy must be 'origin' or 'now'.");
    }
    const version = options.version ?? 1;
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new TypeError("A durable Program definition version must be positive.");
    }
    const concurrency = options.concurrency ?? 1;
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
      throw new TypeError("Program concurrency must be a positive integer.");
    }
    if (options.partitionBy) {
      if (!Number.isSafeInteger(options.partitionRevision) || options.partitionRevision! <= 0) {
        throw new TypeError("A custom Program partition requires a positive partitionRevision.");
      }
    } else if (options.partitionRevision !== undefined) {
      throw new TypeError("partitionRevision requires partitionBy.");
    }
    const parsedEvents = options.events.map((eventName) => {
      const parsed = parseEventName<Spec>(eventName);
      if (!app.def.resources[parsed.resource]?.events[parsed.name]) {
        throw new Error(`Unknown app event ${JSON.stringify(eventName)}.`);
      }
      return { eventName, ...parsed };
    });
    const durableId = options.id;
    if (consumerIds.has(durableId)) {
      throw new Error(`Program consumer id ${JSON.stringify(options.id)} is repeated.`);
    }
    consumerIds.add(durableId);
    const consumerSignal = options.signal ?? signal;
    const initialSourcePosition =
      options.startAt === "origin"
        ? 0
        : sourcePosition
          ? await sourcePosition()
          : (() => {
              throw new Error("consume({ startAt: 'now' }) requires a source position provider.");
            })();
    try {
      await progress.registerConsumer({
        consumerId: durableId,
        definition: {
          events: parsedEvents.map(({ eventName }) => eventName),
          startAt: options.startAt,
          partition: options.partitionBy ? `custom:${options.partitionRevision}` : "resource",
          version,
        },
        initialSourcePosition,
      });
    } catch (error) {
      consumerIds.delete(durableId);
      throw error;
    }
    if (consumerSignal.aborted) {
      consumerIds.delete(durableId);
      return Object.freeze({ close() {} });
    }
    const consumer = createConsumer(
      app,
      actor,
      readViews,
      command,
      setPresence,
      progress,
      durableId,
      parsedEvents.map(({ resource, name }) => programEventKey(resource, name)),
      concurrency,
      options.partitionBy,
      options.run,
      maxPendingEvents,
      maxPendingBytes,
      options.signal ?? signal,
      subscribeResource,
      track,
      notifyIdle,
    );
    consumers.add(consumer);
    for (const eventKey of consumer.eventKeys) {
      const matchingConsumers = consumersByEvent.get(eventKey) ?? new Set();
      matchingConsumers.add(consumer);
      consumersByEvent.set(eventKey, matchingConsumers);
    }
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      consumers.delete(consumer);
      consumerIds.delete(consumer.durableId);
      for (const eventKey of consumer.eventKeys) {
        const matchingConsumers = consumersByEvent.get(eventKey);
        matchingConsumers?.delete(consumer);
        if (matchingConsumers?.size === 0) consumersByEvent.delete(eventKey);
      }
      if (!signal.aborted) onConsumersChanged?.();
    };
    const close = () => {
      consumer.close();
      remove();
      notifyIdle();
    };
    consumerSignal.addEventListener("abort", close, { once: true });
    void consumer.done.then(remove, (error) => {
      remove();
      fail(error);
    });
    onConsumersChanged?.();
    return Object.freeze({ close });
  };
  hooks.consume = (options: Parameters<typeof registerConsumer>[0]) => {
    const registration = registerConsumer(options);
    trackRegistration(registration.then(() => undefined));
    return registration;
  };
  return hooks as InternalProgramContext<Spec, Env>;
}

function createConsumer<Spec extends AppSpec>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  readViews: StartProgramOptions<Spec, EnvironmentName<Spec>>["readViews"],
  command: ProgramCommand<Spec>,
  setPresence: ProgramSetPresence<Spec> | undefined,
  progress: ProgramProgressStore,
  durableId: string,
  eventKeys: readonly string[],
  concurrency: number,
  partitionBy:
    | ((input: { event: ProgramEventItem<Spec, AppEventName<Spec>>["event"] }) => JsonValue)
    | undefined,
  handle: (item: ProgramEventItem<Spec, AppEventName<Spec>>) => void | Promise<void>,
  maxPendingEvents: number,
  maxPendingBytes: number,
  signal: AbortSignal,
  subscribeResource: ProgramResourceSubscriber,
  track: (task: Promise<void>) => void,
  notifyIdle: () => void,
): ProgramConsumer<Spec> {
  const queues = new Map<string, ProgramPendingEvent<Spec>[]>();
  const readyScopes: string[] = [];
  const activeScopes = new Set<string>();
  const scheduled = new Set<string>();
  const pendingSourceCounts = new Map<number, number>();
  const pendingSourcePositions = new MinHeap();
  const capacityWaiters = new Set<() => void>();
  let pendingBytes = 0;
  let activeCount = 0;
  let closed = false;
  let settled = false;
  let sourceHighWater = 0;
  let requestedSourcePosition = 0;
  let sourceFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  let sourceWrites = Promise.resolve();
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const notifyCapacity = (): void => {
    if (capacityWaiters.size === 0) return;
    const waiters = [...capacityWaiters];
    capacityWaiters.clear();
    for (const waiter of waiters) waiter();
  };

  const close = (): void => {
    if (closed) return;
    if (sourceFlushTimer !== undefined) clearTimeout(sourceFlushTimer);
    sourceFlushTimer = undefined;
    requestSourceFlush(true);
    closed = true;
    queues.clear();
    pendingBytes = 0;
    scheduled.clear();
    readyScopes.length = 0;
    notifyCapacity();
    if (!settled) {
      settled = true;
      void sourceWrites.then(resolveDone, rejectDone);
    }
    notifyIdle();
  };
  const fail = (error: unknown): void => {
    if (closed) return;
    if (sourceFlushTimer !== undefined) clearTimeout(sourceFlushTimer);
    sourceFlushTimer = undefined;
    closed = true;
    queues.clear();
    pendingBytes = 0;
    scheduled.clear();
    readyScopes.length = 0;
    notifyCapacity();
    if (!settled) {
      settled = true;
      rejectDone(error);
    }
    notifyIdle();
  };

  const addPendingSource = (position: number): void => {
    const count = pendingSourceCounts.get(position) ?? 0;
    pendingSourceCounts.set(position, count + 1);
    if (count === 0) pendingSourcePositions.push(position);
  };

  const safeSourcePosition = (): number => {
    while (
      pendingSourcePositions.peek() !== undefined &&
      !pendingSourceCounts.has(pendingSourcePositions.peek()!)
    ) {
      pendingSourcePositions.pop();
    }
    const firstPending = pendingSourcePositions.peek();
    return firstPending === undefined || firstPending > sourceHighWater
      ? sourceHighWater
      : Math.max(0, firstPending - 1);
  };

  const requestSourceFlush = (force: boolean): void => {
    const safe = safeSourcePosition();
    if (safe <= requestedSourcePosition) return;
    if (!force && safe - requestedSourcePosition < sourceCheckpointInterval) {
      if (sourceFlushTimer === undefined) {
        sourceFlushTimer = setTimeout(() => {
          sourceFlushTimer = undefined;
          requestSourceFlush(true);
        }, sourceCheckpointMaxDelayMs);
      }
      return;
    }
    if (sourceFlushTimer !== undefined) clearTimeout(sourceFlushTimer);
    sourceFlushTimer = undefined;
    requestedSourcePosition = safe;
    sourceWrites = sourceWrites.then(() => progress.setSourcePosition(durableId, safe));
    void sourceWrites.catch(fail);
  };

  const completeSource = (position: number): void => {
    const count = pendingSourceCounts.get(position);
    if (count === undefined) return;
    if (count > 1) pendingSourceCounts.set(position, count - 1);
    else pendingSourceCounts.delete(position);
    requestSourceFlush(false);
  };

  const createItem = (
    pending: ProgramPendingEvent<Spec>,
    invocation: ProgramInvocation,
  ): ProgramEventItem<Spec, AppEventName<Spec>> => {
    const execution = {
      key: pending.completionKey,
      commandIndex: 0,
      epoch: invocation.epoch,
      at: pending.stored.event.at,
    };
    const event = {
      ...pending.stored.event,
      resource: pending.stored.resource,
      key: pending.stored.key,
    } as unknown as ProgramEventItem<Spec, AppEventName<Spec>>["event"];
    const resourceHandle = createProgramResource(
      app,
      readViews,
      command,
      setPresence,
      () => execution,
      () => pending.stored.event.actor,
      pending.stored.resource,
      pending.stored.key as never,
      subscribeResource,
    );
    return {
      event,
      resource: pending.stored.resource,
      key: pending.stored.key,
      view: readViews(
        pending.stored.resource,
        pending.stored.key as never,
        pending.stored.event.actor,
      ),
      delivery: {
        attempt: invocation.attempt,
        uncertainAttempts: invocation.uncertainAttempts,
      },
      createIdempotencyKey(label: string) {
        if (label.length === 0) throw new TypeError("An idempotency label cannot be empty.");
        return `${pending.completionKey}:effect:${JSON.stringify(label)}`;
      },
      [pending.stored.resource]: resourceHandle,
    } as unknown as ProgramEventItem<Spec, AppEventName<Spec>>;
  };

  let pump = (): void => undefined;
  const process = async (pending: ProgramPendingEvent<Spec>): Promise<boolean> => {
    const claim = await progress.claim({
      key: pending.completionKey,
      consumerId: durableId,
      scopeId: pending.scope,
      cursor: eventCursor(pending.stored),
    });
    if (claim.status === "completed") return true;
    if (closed || signal.aborted) return false;
    try {
      await handle(createItem(pending, claim.invocation));
    } catch (error) {
      if (closed || signal.aborted) return false;
      throw error;
    }
    if (closed || signal.aborted) return false;
    const status = await progress.complete({
      key: pending.completionKey,
      consumerId: durableId,
      scopeId: pending.scope,
      cursor: eventCursor(pending.stored),
      epoch: claim.invocation.epoch,
    });
    if (status === "stale") {
      throw new Error(`Program invocation ${JSON.stringify(pending.completionKey)} is stale.`);
    }
    return true;
  };

  const start = (pending: ProgramPendingEvent<Spec>): void => {
    activeCount++;
    activeScopes.add(pending.scope);
    const task = process(pending)
      .then((completed) => {
        if (!completed) return;
        scheduled.delete(pending.completionKey);
        pendingBytes -= pending.bytes;
        notifyCapacity();
        completeSource(pending.stored.event.position);
      })
      .finally(() => {
        activeCount--;
        activeScopes.delete(pending.scope);
        const queue = queues.get(pending.scope);
        if (queue?.length) readyScopes.push(pending.scope);
        else queues.delete(pending.scope);
        notifyIdle();
        pump();
      });
    void task.catch(fail);
    track(task);
  };

  pump = (): void => {
    while (!closed && !signal.aborted && activeCount < concurrency) {
      let scope: string | undefined;
      while ((scope = readyScopes.shift())) {
        if (!activeScopes.has(scope) && queues.get(scope)?.length) break;
      }
      if (!scope) return;
      const pending = queues.get(scope)!.shift()!;
      start(pending);
    }
  };

  if (signal.aborted) close();
  else signal.addEventListener("abort", close, { once: true });

  return {
    durableId,
    eventKeys,
    done,
    enqueue(stored) {
      const resourceScope = scopeId(stored.resource, stored.key);
      const completionKey = `${durableId}:${resourceScope}:${stored.event.id}`;
      if (scheduled.has(completionKey)) return;
      const event = partitionBy
        ? ({
            ...stored.event,
            resource: stored.resource,
            key: stored.key,
          } as unknown as ProgramEventItem<Spec, AppEventName<Spec>>["event"])
        : undefined;
      const bytes = estimatedProgramEventBytes(stored);
      const hasCapacity = (): boolean =>
        scheduled.size < maxPendingEvents &&
        (pendingBytes === 0 || pendingBytes + bytes <= maxPendingBytes);
      const schedule = (): void => {
        if (closed || signal.aborted || scheduled.has(completionKey)) return;
        scheduled.add(completionKey);
        pendingBytes += bytes;
        const scope = partitionBy
          ? scopeId(stored.resource, partitionBy({ event: event! }))
          : resourceScope;
        const queue = queues.get(scope) ?? [];
        if (!queues.has(scope)) queues.set(scope, queue);
        queue.push({ stored, completionKey, scope, bytes });
        addPendingSource(stored.event.position);
        if (!activeScopes.has(scope) && queue.length === 1) readyScopes.push(scope);
        pump();
      };
      if (hasCapacity()) {
        schedule();
        return;
      }
      return (async () => {
        while (!closed && !signal.aborted && !hasCapacity()) {
          await new Promise<void>((resolve) => capacityWaiters.add(resolve));
          if (scheduled.has(completionKey)) return;
        }
        schedule();
      })();
    },
    advanceSource(position) {
      sourceHighWater = Math.max(sourceHighWater, position);
      requestSourceFlush(false);
    },
    async sourcePosition() {
      for (;;) {
        if (sourceFlushTimer !== undefined) clearTimeout(sourceFlushTimer);
        sourceFlushTimer = undefined;
        requestSourceFlush(true);
        await sourceWrites;
        if (safeSourcePosition() <= requestedSourcePosition) break;
      }
      return (await progress.getSourcePosition(durableId)) ?? 0;
    },
    isBusy: () => activeCount > 0 || queues.size > 0,
    close,
  };
}

function estimatedProgramEventBytes(event: ProgramEventRecord): number {
  return JSON.stringify(event).length * 2;
}

function createProgramResource<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  readViews: StartProgramOptions<Spec, EnvironmentName<Spec>>["readViews"],
  command: ProgramCommand<Spec>,
  setPresence: ProgramSetPresence<Spec> | undefined,
  getExecution: () => { key: string; commandIndex: number; at: number } | null,
  getActor: () => ActorOf<Spec> | undefined,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  subscribeResource: ProgramResourceSubscriber,
): ProgramResource<Spec, Resource> {
  const commands: Record<
    string,
    ((...args: unknown[]) => ProgramCommandResult) & {
      identified(id: string, ...args: unknown[]): ProgramCommandResult;
    }
  > = {};
  for (const commandName of Object.keys(app.def.resources[resource].commands ?? {})) {
    const invoke = (id: string | undefined, args: unknown[]): ProgramCommandResult => {
      const execution = getExecution();
      const commandId = execution
        ? id === undefined
          ? `${execution.key}:${commandName}:${execution.commandIndex++}`
          : `${execution.key}:${commandName}:identified:${JSON.stringify(id)}`
        : crypto.randomUUID();
      return command(resource, key, commandName, args, commandId, getActor(), execution?.at);
    };
    const run = ((...args: unknown[]) => invoke(undefined, args)) as (typeof commands)[string];
    run.identified = (id, ...args) => {
      if (id.length === 0) throw new TypeError("A Program command identity cannot be empty.");
      return invoke(id, args);
    };
    commands[commandName] = run;
  }
  return new Proxy(
    {
      sync: { cursor: 0, syncing: false, stale: false, error: null },
      get view() {
        return readViews(resource, key, getActor());
      },
      subscribe(observer: (view: ViewShape<Spec, Resource>) => void) {
        return subscribeResource(resource, key, getActor, observer as never);
      },
      setPresence(value: JsonValue) {
        if (!setPresence) throw new Error("This Program runtime does not support Presence.");
        setPresence(resource, key, value, getActor());
      },
    },
    {
      get(target, property: string) {
        if (property in target) return Reflect.get(target, property);
        return (
          commands[property] ??
          readViews(resource, key, getActor())[property as keyof ViewShape<Spec, Resource>]
        );
      },
    },
  ) as unknown as ProgramResource<Spec, Resource>;
}

function parseEventName<Spec extends AppSpec>(eventName: AppEventName<Spec>) {
  const value = String(eventName);
  const delimiter = value.lastIndexOf(".");
  const resource = value.slice(0, delimiter);
  const name = value.slice(delimiter + 1);
  if (!resource || !name) throw new Error('App event names must be formatted as "resource.event".');
  return { resource: resource as ResourceName<Spec>, name };
}

function upcastEvent<Spec extends AppSpec>(
  app: App<Spec>,
  stored: ProgramEventRecord<Spec>,
): ProgramEventRecord<Spec> {
  const upcasted = app.upcastEvent(
    stored.resource,
    { name: stored.event.name, payload: stored.event.payload },
    stored.event.version,
    stored.event.hash,
  );
  return {
    ...stored,
    event: {
      ...stored.event,
      version: upcasted.version,
      ...(upcasted.hash ? { hash: upcasted.hash } : {}),
      name: upcasted.name,
      payload: upcasted.payload,
    },
  };
}

function checkpointKey(consumerId: string, scope: string): string {
  return `${consumerId}:${scope}`;
}

export type { EnvironmentDeps, EnvironmentName };
