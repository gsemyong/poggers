import type { ComponentIR, ProductIR, TypeIR } from "./ir";

export type HotManifest = Readonly<{
  revision: string;
  programs: readonly Readonly<{
    id: string;
    runtime: string;
    state?: TypeIR;
    components: readonly ComponentIR[];
  }>[];
}>;

export type HotActivation<Value, Snapshot> = Readonly<{
  value: Value;
  snapshot: Snapshot;
  dispose(): void | Promise<void>;
}>;

export type HotCandidate<Value, Snapshot> = Readonly<{
  manifest: HotManifest;
  prepare(previous: Snapshot | undefined): Promise<
    Readonly<{
      activate(): Promise<HotActivation<Value, Snapshot>>;
      rollback?(): void | Promise<void>;
    }>
  >;
}>;

export type HotUpdateResult<Value> =
  | Readonly<{ status: "activated"; value: Value }>
  | Readonly<{ status: "rejected"; reason: string }>;

export function createHotManifest(ir: ProductIR): HotManifest {
  const programs = ir.programs.map((program) => ({
    id: program.id,
    runtime: program.runtime.name,
    ...(program.ui ? { state: program.ui.state } : {}),
    components: program.ui?.components ?? [],
  }));
  return { revision: stableHash(JSON.stringify(programs)), programs };
}

export function isHotManifestCompatible(previous: HotManifest, next: HotManifest): boolean {
  const previousPrograms = new Map(previous.programs.map((program) => [program.id, program]));
  for (const program of next.programs) {
    const before = previousPrograms.get(program.id);
    if (!before) continue;
    if (before.runtime !== program.runtime) return false;
    if (before.state && program.state && !compatibleType(before.state, program.state)) return false;
    if (Boolean(before.state) !== Boolean(program.state)) return false;
    const beforeComponents = new Map(
      before.components.map((component) => [component.name, component]),
    );
    for (const component of program.components) {
      const previousComponent = beforeComponents.get(component.name);
      if (previousComponent && !compatibleComponent(previousComponent, component)) return false;
    }
  }
  return true;
}

function compatibleComponent(previous: ComponentIR, next: ComponentIR): boolean {
  if (!compatibleType(previous.state, next.state)) return false;
  if (!compatibleType(previous.parameters, next.parameters)) return false;
  if (JSON.stringify(previous.parts) !== JSON.stringify(next.parts)) return false;
  return JSON.stringify(previous.visualValues) === JSON.stringify(next.visualValues);
}

/** Serializes candidate activation and preserves the last live revision on failure. */
export class HotUpdateCoordinator<Value, Snapshot> {
  #active: HotActivation<Value, Snapshot> | undefined;
  #manifest: HotManifest | undefined;
  #transaction = Promise.resolve();

  get value(): Value | undefined {
    return this.#active?.value;
  }

  replace(candidate: HotCandidate<Value, Snapshot>): Promise<HotUpdateResult<Value>> {
    const transaction = this.#transaction.then(() => this.#replace(candidate));
    this.#transaction = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }

  async dispose(): Promise<void> {
    await this.#transaction;
    const active = this.#active;
    this.#active = undefined;
    this.#manifest = undefined;
    await active?.dispose();
  }

  async #replace(candidate: HotCandidate<Value, Snapshot>): Promise<HotUpdateResult<Value>> {
    if (this.#manifest && !isHotManifestCompatible(this.#manifest, candidate.manifest)) {
      return { status: "rejected", reason: "incompatible-manifest" };
    }

    let prepared: Awaited<ReturnType<typeof candidate.prepare>>;
    try {
      prepared = await candidate.prepare(this.#active?.snapshot);
    } catch {
      return { status: "rejected", reason: "prepare-failed" };
    }

    let activated: HotActivation<Value, Snapshot>;
    try {
      activated = await prepared.activate();
    } catch {
      await prepared.rollback?.();
      return { status: "rejected", reason: "activation-failed" };
    }

    const previous = this.#active;
    this.#active = activated;
    this.#manifest = candidate.manifest;
    await previous?.dispose();
    return { status: "activated", value: activated.value };
  }
}

function compatibleType(previous: TypeIR, next: TypeIR): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "record" && next.kind === "record") {
    const fields = new Map(next.fields.map((field) => [field.name, field]));
    return previous.fields.every((field) => {
      const candidate = fields.get(field.name);
      return candidate
        ? field.optional === candidate.optional && compatibleType(field.type, candidate.type)
        : true;
    });
  }
  if (previous.kind === "array" && next.kind === "array") {
    return compatibleType(previous.element, next.element);
  }
  if (previous.kind === "option" && next.kind === "option") {
    return compatibleType(previous.value, next.value);
  }
  if (previous.kind === "promise" && next.kind === "promise") {
    return compatibleType(previous.value, next.value);
  }
  return JSON.stringify(previous) === JSON.stringify(next);
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
