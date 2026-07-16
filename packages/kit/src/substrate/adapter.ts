import type { ApplicationManifest } from "#kernel/manifest";
import type {
  CommandRecord,
  CommittedCommandRecord,
  JournalAppend,
  JournalAppendResult,
  JournalLoad,
  JournalSnapshot,
  ResourceAddress,
  SnapshotSaveResult,
} from "#substrate/journal";

export type SourceSplit = string & { readonly __sourceSplit: unique symbol };

export type SourceCursor = Readonly<{
  split: SourceSplit;
  value: string;
}>;

export type SourceBounds = Readonly<{
  origin: SourceCursor;
  floor: SourceCursor;
  highWater: SourceCursor;
}>;

export type SourceTopology = Readonly<{
  version: string;
  splits: readonly Readonly<{
    id: SourceSplit;
    predecessors: readonly SourceSplit[];
  }>[];
}>;

export type SourceRecord<Record extends CommandRecord = CommandRecord> = Readonly<{
  cursor: SourceCursor;
  commit: Readonly<{
    address: ResourceAddress;
    revision: number;
  }>;
  record: CommittedCommandRecord<Record>;
}>;

export type SourceRead<Record extends CommandRecord = CommandRecord> =
  | Readonly<{
      status: "read";
      records: readonly SourceRecord<Record>[];
      next: SourceCursor;
      caughtUp: boolean;
    }>
  | Readonly<{
      status: "cursor-expired";
      floor: SourceCursor;
      highWater: SourceCursor;
    }>;

export type SourceReadRequest = Readonly<{
  split: SourceSplit;
  after: SourceCursor;
  maxRecords: number;
  maxBytes: number;
  signal?: AbortSignal;
}>;

export interface ResourceAuthority {
  load<Record extends CommandRecord = CommandRecord, State = unknown>(
    address: ResourceAddress,
  ): Promise<JournalLoad<Record, State>>;

  commit<Record extends CommandRecord>(
    input: JournalAppend<Record>,
  ): Promise<JournalAppendResult<Record>>;

  receipt<Record extends CommandRecord = CommandRecord>(
    address: ResourceAddress,
    intentId: string,
  ): Promise<CommittedCommandRecord<Record> | null>;

  addresses(): AsyncIterable<ResourceAddress>;
  saveSnapshot<State>(snapshot: JournalSnapshot<State>): Promise<SnapshotSaveResult>;
}

export interface CommittedEventSource {
  topology(): Promise<SourceTopology>;
  bounds(split: SourceSplit): Promise<SourceBounds>;
  read<Record extends CommandRecord = CommandRecord>(
    request: SourceReadRequest,
  ): Promise<SourceRead<Record>>;
  wait(split: SourceSplit, after: SourceCursor, signal: AbortSignal): Promise<void>;
  compare(left: SourceCursor, right: SourceCursor): number;
}

export type ProgramSourceDefinition = Readonly<{
  events: readonly string[];
  replay: "all" | "new";
  key: "resource" | Readonly<{ version: number }>;
  version: number;
}>;

export type ProgramRegistration = Readonly<{
  id: string;
  source: ProgramSourceDefinition;
}>;

export type ProgramAssignment = Readonly<{
  program: string;
  split: SourceSplit;
  keyGroup: number;
}>;

export type ProgramLease = Readonly<{
  assignment: ProgramAssignment;
  owner: string;
  fence: number;
  expiresAt: number;
}>;

export type ProgramDelivery = Readonly<{
  id: string;
  cursor: SourceCursor;
  index: number;
  key: string;
}>;

export type ProgramInvocation = Readonly<{
  delivery: ProgramDelivery;
  attempt: number;
  epoch: number;
  uncertainAttempts: readonly number[];
}>;

export interface ProgramProgress {
  register(registration: ProgramRegistration): Promise<"created" | "existing">;
  registration(program: string): Promise<ProgramRegistration | null>;
  checkpoint(assignment: ProgramAssignment): Promise<SourceCursor | null>;
  claim(
    input: Readonly<{ lease: ProgramLease; delivery: ProgramDelivery }>,
  ): Promise<
    | Readonly<{ status: "completed" | "stale" }>
    | Readonly<{ status: "claimed"; invocation: ProgramInvocation }>
  >;
  complete(
    input: Readonly<{ lease: ProgramLease; invocation: ProgramInvocation }>,
  ): Promise<"completed" | "stale">;
  advance(
    input: Readonly<{ lease: ProgramLease; cursor: SourceCursor }>,
  ): Promise<"advanced" | "stale">;
}

export interface ProgramCoordination {
  acquire(
    assignment: ProgramAssignment,
    owner: string,
    ttlMs: number,
  ): Promise<ProgramLease | null>;
  renew(lease: ProgramLease, ttlMs: number): Promise<ProgramLease | null>;
  release(lease: ProgramLease): Promise<"released" | "stale">;
  owns(lease: ProgramLease): Promise<boolean>;
}

export type DeploymentRequest = Readonly<{
  instances: number;
}>;

export interface SubstrateAdapter {
  readonly authority: ResourceAuthority;
  readonly events: CommittedEventSource;
  readonly programs: ProgramProgress;
  readonly coordination: ProgramCoordination;
  validate(manifest: ApplicationManifest, deployment: DeploymentRequest): Promise<void>;
  close(): Promise<void>;
}

export class ProgramDefinitionChangedError extends Error {
  constructor(program: string) {
    super(`Program ${JSON.stringify(program)} changed without a progress migration.`);
    this.name = "ProgramDefinitionChangedError";
  }
}

export class SourceCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceCursorError";
  }
}

export class SourceHistoryUnavailableError extends Error {
  constructor(program: string) {
    super(
      `Program ${JSON.stringify(program)} requires source history that has already been retained.`,
    );
    this.name = "SourceHistoryUnavailableError";
  }
}

export function sourceSplit(value: string): SourceSplit {
  if (value.length === 0) throw new TypeError("A source split cannot be empty.");
  return value as SourceSplit;
}

export function sourceCursor(split: SourceSplit, value: string): SourceCursor {
  if (value.length === 0) throw new TypeError("A source cursor cannot be empty.");
  return Object.freeze({ split, value });
}

export function sameAssignment(left: ProgramAssignment, right: ProgramAssignment): boolean {
  return (
    left.program === right.program && left.split === right.split && left.keyGroup === right.keyGroup
  );
}

export function sameProgramRegistration(
  left: ProgramRegistration,
  right: ProgramRegistration,
): boolean {
  return (
    left.id === right.id &&
    left.source.replay === right.source.replay &&
    left.source.version === right.source.version &&
    sameStrings(left.source.events, right.source.events) &&
    (left.source.key === right.source.key ||
      (left.source.key !== "resource" &&
        right.source.key !== "resource" &&
        left.source.key.version === right.source.key.version))
  );
}

export type ProgramPlacement = Readonly<{
  assignment: ProgramAssignment;
  owner: string;
}>;

export function allocateProgramTopology(
  input: Readonly<{
    program: string;
    splits: readonly SourceSplit[];
    keyGroups: number;
    owners: readonly string[];
  }>,
): readonly ProgramPlacement[] {
  if (input.program.length === 0) throw new TypeError("A Program id cannot be empty.");
  if (!Number.isSafeInteger(input.keyGroups) || input.keyGroups <= 0) {
    throw new TypeError("A Program topology requires a positive key-group count.");
  }
  const splits = uniqueSorted(input.splits, "source split");
  const owners = uniqueSorted(input.owners, "Program owner");
  if (splits.length === 0) throw new TypeError("A Program topology requires a source split.");
  if (owners.length === 0) throw new TypeError("A Program topology requires an owner.");
  const placements: ProgramPlacement[] = [];
  for (const split of splits) {
    for (let keyGroup = 0; keyGroup < input.keyGroups; keyGroup += 1) {
      const assignment = { program: input.program, split, keyGroup };
      const identity = `${input.program}\u0000${split}\u0000${keyGroup}`;
      let owner = owners[0]!;
      let score = topologyHash(`${identity}\u0000${owner}`);
      for (let index = 1; index < owners.length; index += 1) {
        const candidate = owners[index]!;
        const candidateScore = topologyHash(`${identity}\u0000${candidate}`);
        if (candidateScore > score || (candidateScore === score && candidate < owner)) {
          owner = candidate;
          score = candidateScore;
        }
      }
      placements.push(Object.freeze({ assignment: Object.freeze(assignment), owner }));
    }
  }
  return Object.freeze(placements);
}

export function programKeyGroup(key: string, keyGroups: number): number {
  if (!Number.isSafeInteger(keyGroups) || keyGroups <= 0) {
    throw new TypeError("A Program topology requires a positive key-group count.");
  }
  return topologyHash(key) % keyGroups;
}

export function assertSourceTopology(topology: SourceTopology, previous?: SourceTopology): void {
  if (topology.version.length === 0)
    throw new TypeError("A source topology version cannot be empty.");
  const current = new Set<SourceSplit>();
  const prior = new Set(previous?.splits.map(({ id }) => id) ?? []);
  for (const descriptor of topology.splits) {
    if (current.has(descriptor.id)) {
      throw new TypeError(`Duplicate source split ${JSON.stringify(descriptor.id)}.`);
    }
    current.add(descriptor.id);
    const predecessors = new Set<SourceSplit>();
    for (const predecessor of descriptor.predecessors) {
      if (predecessor === descriptor.id) {
        throw new TypeError("A source split cannot descend from itself.");
      }
      if (predecessors.has(predecessor)) {
        throw new TypeError(`Duplicate predecessor ${JSON.stringify(predecessor)}.`);
      }
      if (previous && !prior.has(predecessor)) {
        throw new TypeError(`Unknown predecessor ${JSON.stringify(predecessor)}.`);
      }
      predecessors.add(predecessor);
    }
  }
  if (current.size === 0) throw new TypeError("A source topology requires at least one split.");
  if (previous && previous.version === topology.version) {
    throw new TypeError("A changed source topology requires a new version.");
  }
  if (previous) {
    const descendants = new Set(topology.splits.flatMap(({ predecessors }) => predecessors));
    for (const descriptor of previous.splits) {
      if (!current.has(descriptor.id) && !descendants.has(descriptor.id)) {
        throw new TypeError(
          `Removed source split ${JSON.stringify(descriptor.id)} has no successor lineage.`,
        );
      }
    }
  }
}

function uniqueSorted<Value extends string>(values: readonly Value[], label: string): Value[] {
  const sorted = [...values].sort();
  if (sorted.some((value) => value.length === 0))
    throw new TypeError(`A ${label} cannot be empty.`);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      throw new TypeError(`Duplicate ${label} ${JSON.stringify(sorted[index])}.`);
    }
  }
  return sorted;
}

function topologyHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
