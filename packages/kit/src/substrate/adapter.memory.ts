import { programIdentity, type ApplicationManifest } from "#kernel/manifest";
import {
  ProgramDefinitionChangedError,
  SourceHistoryUnavailableError,
  SourceCursorError,
  sameProgramRegistration,
  sameAssignment,
  sourceCursor,
  sourceSplit,
  type CommittedEventSource,
  type DeploymentRequest,
  type ProgramAssignment,
  type ProgramCoordination,
  type ProgramDelivery,
  type ProgramLease,
  type ProgramProgress,
  type ProgramRegistration,
  type ResourceAuthority,
  type SourceCursor,
  type SourceRead,
  type SourceReadRequest,
  type SourceSplit,
  type SourceTopology,
  type SubstrateAdapter,
} from "#substrate/adapter";
import {
  createMemoryJournal,
  encodeJournalValue,
  type CommandRecord,
  type Journal,
} from "#substrate/journal";
import {
  ProgramConsumerDefinitionError,
  createJournalProgramProgressStore,
  type ProgramConsumerDefinition,
  type ProgramEventCursor,
  type ProgramProgressStore,
} from "#substrate/program";

const singleSplit = sourceSplit("commits/0");
const singleTopology: SourceTopology = Object.freeze({
  version: "single/1",
  splits: Object.freeze([{ id: singleSplit, predecessors: Object.freeze([]) }]),
});

type MutableLease = {
  assignment: ProgramAssignment;
  owner: string;
  fence: number;
  expiresAt: number;
};

export type MemorySubstrateOptions = Readonly<{
  now?: () => number;
}>;

export type MemorySubstrate = SubstrateAdapter &
  Readonly<{
    testing: Readonly<{
      retainAfter(cursor: SourceCursor): void;
      forgetProgramAssignments(program: string): void;
    }>;
  }>;

export function createMemorySubstrate(options: MemorySubstrateOptions = {}): MemorySubstrate {
  return createSingleNodeSubstrate(createMemoryJournal(), options);
}

export function createJournalAuthority(journal: Journal): ResourceAuthority {
  return {
    load: (address) => journal.load(address),
    commit: (input) => journal.append(input),
    receipt: (address, intentId) => journal.receipt(address, intentId),
    addresses: () => journal.addresses(),
    saveSnapshot: (snapshot) => journal.saveSnapshot(snapshot),
  };
}

export function createSingleNodeSubstrate(
  journal: Journal,
  options: MemorySubstrateOptions = {},
): MemorySubstrate {
  const now = options.now ?? Date.now;
  const leases = new Map<string, MutableLease>();
  const fences = new Map<string, number>();
  let floorPosition = retainedFloor(journal);
  let closed = false;

  const authority = createJournalAuthority(journal);

  const events: CommittedEventSource = {
    async topology() {
      assertOpen();
      return singleTopology;
    },
    async bounds(split) {
      assertSplit(split);
      const highWater = await journal.position();
      return {
        origin: cursor(0),
        floor: cursor(floorPosition),
        highWater: cursor(highWater),
      };
    },
    async read<Record extends CommandRecord>(
      request: SourceReadRequest,
    ): Promise<SourceRead<Record>> {
      assertSplit(request.split);
      assertLimit(request.maxRecords, "record");
      assertLimit(request.maxBytes, "byte");
      request.signal?.throwIfAborted();
      const after = position(request.after);
      const highWater = await journal.position();
      if (after < floorPosition) {
        return {
          status: "cursor-expired",
          floor: cursor(floorPosition),
          highWater: cursor(highWater),
        };
      }
      const records = [];
      let bytes = 0;
      let next = request.after;
      for await (const record of journal.scan<Record>(after)) {
        request.signal?.throwIfAborted();
        if (record.address.resource.startsWith("$poggers.")) {
          next = cursor(record.position);
          continue;
        }
        const size = encodeJournalValue(record).length;
        if (
          records.length > 0 &&
          (records.length >= request.maxRecords || bytes + size > request.maxBytes)
        ) {
          break;
        }
        records.push({
          cursor: cursor(record.position),
          commit: { address: record.address, revision: record.revision },
          record,
        });
        next = cursor(record.position);
        bytes += size;
        if (records.length >= request.maxRecords || bytes >= request.maxBytes) break;
      }
      return {
        status: "read",
        records,
        next,
        caughtUp: position(next) >= highWater,
      };
    },
    async wait(split, after, signal) {
      assertSplit(split);
      const afterPosition = position(after);
      signal.throwIfAborted();
      if ((await journal.position()) > afterPosition) return;
      const available = Promise.withResolvers<void>();
      const subscription = await journal.subscribe(afterPosition, () => available.resolve());
      const abort = () => available.reject(signal.reason ?? new Error("Source wait aborted."));
      signal.addEventListener("abort", abort, { once: true });
      try {
        await available.promise;
      } finally {
        signal.removeEventListener("abort", abort);
        await subscription.stop();
      }
    },
    compare(left, right) {
      return position(left) - position(right);
    },
  };

  const coordination: ProgramCoordination = {
    async acquire(assignment, owner, ttlMs) {
      assertOpen();
      assertOwner(owner);
      assertTtl(ttlMs);
      const key = assignmentKey(assignment);
      const current = leases.get(key);
      const currentTime = now();
      if (current && current.expiresAt > currentTime && current.owner !== owner) return null;
      if (current && current.expiresAt > currentTime && current.owner === owner) {
        current.expiresAt = currentTime + ttlMs;
        return freezeLease(current);
      }
      const fence = (fences.get(key) ?? 0) + 1;
      fences.set(key, fence);
      const next = { assignment, owner, fence, expiresAt: currentTime + ttlMs };
      leases.set(key, next);
      return freezeLease(next);
    },
    async renew(lease, ttlMs) {
      assertTtl(ttlMs);
      const current = currentLease(lease);
      if (!current || current.expiresAt <= now()) return null;
      current.expiresAt = now() + ttlMs;
      return freezeLease(current);
    },
    async release(lease) {
      const key = assignmentKey(lease.assignment);
      if (!currentLease(lease)) return "stale";
      leases.delete(key);
      return "released";
    },
    async owns(lease) {
      const current = currentLease(lease);
      return current !== null && current.expiresAt > now();
    },
  };

  const durableProgress = createJournalProgramProgressStore(journal, "substrate");
  const assignmentProgress = new Map<string, Promise<string>>();
  const ensureAssignmentProgress = async (assignment: ProgramAssignment): Promise<string> => {
    assertAssignment(assignment);
    const consumerId = programAssignmentProgressId(assignment);
    const existing = assignmentProgress.get(consumerId);
    if (existing) return existing;
    const initialize = (async () => {
      const definition = await requiredConsumer(durableProgress, assignment.program);
      try {
        await durableProgress.registerConsumer({
          consumerId,
          definition: definition.definition,
          initialSourcePosition: definition.sourcePosition,
        });
      } catch (error) {
        if (error instanceof ProgramConsumerDefinitionError) {
          throw new ProgramDefinitionChangedError(assignment.program);
        }
        throw error;
      }
      return consumerId;
    })();
    assignmentProgress.set(consumerId, initialize);
    try {
      return await initialize;
    } catch (error) {
      assignmentProgress.delete(consumerId);
      throw error;
    }
  };
  const programs: ProgramProgress = {
    async register(registration) {
      assertRegistration(registration);
      try {
        const existing = await durableProgress.getConsumerDefinition(registration.id);
        if (!existing && registration.source.replay === "all" && floorPosition > 0) {
          throw new SourceHistoryUnavailableError(registration.id);
        }
        return await durableProgress.registerConsumer({
          consumerId: registration.id,
          definition: encodeDefinition(registration),
          initialSourcePosition:
            registration.source.replay === "all" ? 0 : await journal.position(),
        });
      } catch (error) {
        if (error instanceof ProgramConsumerDefinitionError) {
          throw new ProgramDefinitionChangedError(registration.id);
        }
        throw error;
      }
    },
    async registration(program) {
      const definition = await durableProgress.getConsumerDefinition(program);
      return definition ? decodeDefinition(program, definition) : null;
    },
    async checkpoint(assignment) {
      const consumerId = await ensureAssignmentProgress(assignment);
      const value = await durableProgress.getSourcePosition(consumerId);
      return value === undefined ? null : cursor(value);
    },
    async claim({ lease, delivery }) {
      if (!(await coordination.owns(lease))) return { status: "stale" };
      assertDelivery(lease.assignment, delivery);
      const consumerId = await ensureAssignmentProgress(lease.assignment);
      const claimed = await durableProgress.claim({
        consumerId,
        scopeId: delivery.key,
        key: delivery.id,
        cursor: eventCursor(delivery.cursor, delivery.index),
      });
      return claimed.status === "completed"
        ? claimed
        : {
            status: "claimed",
            invocation: {
              delivery,
              attempt: claimed.invocation.attempt,
              epoch: claimed.invocation.epoch,
              uncertainAttempts: claimed.invocation.uncertainAttempts,
            },
          };
    },
    async complete({ lease, invocation }) {
      if (!(await coordination.owns(lease))) return "stale";
      const consumerId = await ensureAssignmentProgress(lease.assignment);
      return durableProgress.complete({
        consumerId,
        scopeId: invocation.delivery.key,
        key: invocation.delivery.id,
        cursor: eventCursor(invocation.delivery.cursor, invocation.delivery.index),
        epoch: invocation.epoch,
      });
    },
    async advance({ lease, cursor: next }) {
      if (!(await coordination.owns(lease))) return "stale";
      const consumerId = await ensureAssignmentProgress(lease.assignment);
      const nextPosition = position(next);
      const current = await requiredConsumer(durableProgress, consumerId);
      if (
        current.scopes.some(
          ({ invocation }) =>
            invocation?.status === "running" && invocation.cursor.position <= nextPosition,
        )
      ) {
        throw new Error("Program progress cannot cross unfinished delivery work.");
      }
      await durableProgress.setSourcePosition(consumerId, nextPosition);
      return "advanced";
    },
  };

  function currentLease(lease: ProgramLease): MutableLease | null {
    const current = leases.get(assignmentKey(lease.assignment));
    return current &&
      current.owner === lease.owner &&
      current.fence === lease.fence &&
      sameAssignment(current.assignment, lease.assignment)
      ? current
      : null;
  }

  function assertOpen(): void {
    if (closed) throw new Error("The substrate adapter is closed.");
  }

  return {
    authority,
    events,
    programs,
    coordination,
    async validate(manifest: ApplicationManifest, deployment: DeploymentRequest) {
      assertOpen();
      if (deployment.instances !== 1) {
        throw new Error("The single-node substrate requires exactly one application instance.");
      }
      const identities = new Set<string>();
      for (const scope of manifest.scopes) {
        for (const program of scope.programs) {
          const id = programIdentity(scope.path, program.environment, program.name);
          if (identities.has(id))
            throw new Error(`Duplicate Program identity ${JSON.stringify(id)}.`);
          identities.add(id);
          if (program.kind !== "events") continue;
          const expected: ProgramRegistration = {
            id,
            source: {
              events: program.events.map((event) => manifestEvent(scope.path, event)),
              replay: program.replay,
              key: program.key,
              version: program.version,
            },
          };
          assertRegistration(expected);
          const existing = await programs.registration(id);
          if (existing && !sameProgramRegistration(existing, expected)) {
            throw new ProgramDefinitionChangedError(id);
          }
          if (!existing && expected.source.replay === "all" && floorPosition > 0) {
            throw new SourceHistoryUnavailableError(id);
          }
        }
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await journal.close();
    },
    testing: {
      retainAfter(next) {
        assertOpen();
        const nextPosition = position(next);
        if (nextPosition < floorPosition) {
          throw new Error("A source retention floor cannot move backwards.");
        }
        floorPosition = nextPosition;
      },
      forgetProgramAssignments(program) {
        for (const consumer of assignmentProgress.keys()) {
          if (parseProgramAssignmentProgressId(consumer)?.program === program) {
            assignmentProgress.delete(consumer);
          }
        }
      },
    },
  };
}

function manifestEvent(path: string, event: string): string {
  if (path.length === 0) return event;
  const dot = event.indexOf(".");
  if (dot <= 0 || dot === event.length - 1) {
    throw new TypeError(`Feature Program event ${JSON.stringify(event)} is malformed.`);
  }
  return `@feature/${path}/resource/${event.slice(0, dot)}.${event.slice(dot + 1)}`;
}

function retainedFloor(journal: Journal): number {
  const candidate = journal as Journal & { retainedFloor?: () => number };
  const floor = candidate.retainedFloor?.() ?? 0;
  if (!Number.isSafeInteger(floor) || floor < 0) {
    throw new Error("A Journal returned an invalid retained floor.");
  }
  return floor;
}

function encodeDefinition(registration: ProgramRegistration): ProgramConsumerDefinition {
  return {
    events: registration.source.events,
    startAt: registration.source.replay === "all" ? "origin" : "now",
    version: registration.source.version,
    partition: JSON.stringify({
      key: registration.source.key,
    }),
  };
}

function decodeDefinition(id: string, definition: ProgramConsumerDefinition): ProgramRegistration {
  const encoded = parseDefinition(definition.partition);
  return {
    id,
    source: {
      events: definition.events,
      replay: definition.startAt === "origin" ? "all" : "new",
      key: encoded.key,
      version: definition.version,
    },
  };
}

function parseDefinition(value: string): Readonly<{
  key: "resource" | Readonly<{ version: number }>;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Stored Program definition is malformed.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored Program definition is malformed.");
  }
  const definition = parsed as { key?: unknown };
  const validKey =
    definition.key === "resource" ||
    (definition.key !== null &&
      typeof definition.key === "object" &&
      !Array.isArray(definition.key) &&
      Number.isSafeInteger((definition.key as { version?: unknown }).version) &&
      ((definition.key as { version: number }).version ?? 0) > 0);
  if (!validKey) {
    throw new Error("Stored Program definition is malformed.");
  }
  return definition as {
    key: "resource" | Readonly<{ version: number }>;
  };
}

async function requiredConsumer(progress: ProgramProgressStore, program: string) {
  const consumer = await progress.inspectConsumer(program);
  if (!consumer) throw new Error(`Program ${JSON.stringify(program)} is not registered.`);
  return consumer;
}

function assertAssignment(assignment: ProgramAssignment): void {
  assertSplit(assignment.split);
  assignmentKey(assignment);
}

const assignmentProgressMarker = "/$assignment/";

export function programAssignmentProgressId(assignment: ProgramAssignment): string {
  assertAssignment(assignment);
  return `${assignment.program}${assignmentProgressMarker}${encodeURIComponent(assignment.split)}/${assignment.keyGroup}`;
}

export function parseProgramAssignmentProgressId(value: string): ProgramAssignment | undefined {
  const marker = value.lastIndexOf(assignmentProgressMarker);
  if (marker <= 0) return undefined;
  const program = value.slice(0, marker);
  const suffix = value.slice(marker + assignmentProgressMarker.length);
  const separator = suffix.lastIndexOf("/");
  if (separator <= 0) return undefined;
  const keyGroup = Number(suffix.slice(separator + 1));
  if (!Number.isSafeInteger(keyGroup) || keyGroup < 0) return undefined;
  let split: string;
  try {
    split = decodeURIComponent(suffix.slice(0, separator));
  } catch {
    return undefined;
  }
  if (split.length === 0) return undefined;
  return { program, split: sourceSplit(split), keyGroup };
}

function cursor(value: number): SourceCursor {
  return sourceCursor(singleSplit, String(value));
}

function eventCursor(value: SourceCursor, index: number): ProgramEventCursor {
  return { position: position(value), index };
}

function position(value: SourceCursor): number {
  if (value.split !== singleSplit)
    throw new SourceCursorError("A cursor belongs to another split.");
  const parsed = Number(value.value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value.value) {
    throw new SourceCursorError("The memory source cursor is malformed.");
  }
  return parsed;
}

function assertSplit(split: SourceSplit): void {
  if (split !== singleSplit)
    throw new SourceCursorError(`Unknown source split ${JSON.stringify(split)}.`);
}

function assertLimit(value: number, unit: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`The source ${unit} limit must be a positive integer.`);
  }
}

function assertOwner(owner: string): void {
  if (owner.length === 0) throw new TypeError("A Program owner cannot be empty.");
}

function assertTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError("A Program lease lifetime must be positive.");
  }
}

function assignmentKey(assignment: ProgramAssignment): string {
  if (!Number.isSafeInteger(assignment.keyGroup) || assignment.keyGroup < 0) {
    throw new TypeError("A Program key group must be a non-negative integer.");
  }
  if (assignment.program.length === 0) throw new TypeError("A Program id cannot be empty.");
  return `${assignment.program}\u0000${assignment.split}\u0000${assignment.keyGroup}`;
}

function freezeLease(lease: MutableLease): ProgramLease {
  return Object.freeze({ ...lease });
}

function assertRegistration(registration: ProgramRegistration): void {
  if (registration.id.length === 0) throw new TypeError("A Program id cannot be empty.");
  if (registration.source.events.length === 0) {
    throw new TypeError("A durable Program must select at least one event.");
  }
  if (new Set(registration.source.events).size !== registration.source.events.length) {
    throw new TypeError("A durable Program cannot select an event more than once.");
  }
  if (!Number.isSafeInteger(registration.source.version) || registration.source.version <= 0) {
    throw new TypeError("A Program definition version must be positive.");
  }
  if (
    registration.source.key !== "resource" &&
    (!Number.isSafeInteger(registration.source.key.version) || registration.source.key.version <= 0)
  ) {
    throw new TypeError("A custom Program key version must be positive.");
  }
}

function assertDelivery(assignment: ProgramAssignment, delivery: ProgramDelivery): void {
  if (delivery.id.length === 0) throw new TypeError("A Program delivery id cannot be empty.");
  if (delivery.cursor.split !== assignment.split) {
    throw new SourceCursorError("A Program delivery cursor belongs to another assignment split.");
  }
  if (!Number.isSafeInteger(delivery.index) || delivery.index < 0) {
    throw new TypeError("A Program event index must be a non-negative integer.");
  }
}
