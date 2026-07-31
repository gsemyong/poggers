export type HotActivation<Value, Snapshot> = Readonly<{
  value: Value;
  snapshot: Snapshot;
  resume?(): void;
  dispose(): void | Promise<void>;
}>;

export type HotCandidate<Value, Snapshot, Manifest = unknown> = Readonly<{
  manifest: Manifest;
  prepare(previous: Snapshot | undefined): Promise<
    Readonly<{
      activate(): Promise<HotActivation<Value, Snapshot>>;
      rollback?(): void | Promise<void>;
    }>
  >;
}>;

export type HotUpdateResult<Value> =
  | Readonly<{ status: "activated"; value: Value }>
  | Readonly<{ status: "rejected"; reason: string; cause?: unknown }>;

/** Serializes candidate activation and preserves the last live revision on failure. */
export class HotUpdateCoordinator<Value, Snapshot, Manifest = unknown> {
  #active: HotActivation<Value, Snapshot> | undefined;
  #manifest: Manifest | undefined;
  #transaction = Promise.resolve();

  constructor(private readonly same: (previous: Manifest, next: Manifest) => boolean = Object.is) {}

  get value(): Value | undefined {
    return this.#active?.value;
  }

  replace(candidate: HotCandidate<Value, Snapshot, Manifest>): Promise<HotUpdateResult<Value>> {
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

  async #replace(
    candidate: HotCandidate<Value, Snapshot, Manifest>,
  ): Promise<HotUpdateResult<Value>> {
    if (this.#manifest !== undefined && !this.same(this.#manifest, candidate.manifest)) {
      return { status: "rejected", reason: "manifest-changed" };
    }

    let prepared: Awaited<ReturnType<typeof candidate.prepare>>;
    try {
      prepared = await candidate.prepare(this.#active?.snapshot);
    } catch (cause) {
      return { status: "rejected", reason: "prepare-failed", cause };
    }

    let activated: HotActivation<Value, Snapshot>;
    try {
      activated = await prepared.activate();
    } catch (cause) {
      await prepared.rollback?.();
      return { status: "rejected", reason: "activation-failed", cause };
    }

    const previous = this.#active;
    this.#active = activated;
    this.#manifest = candidate.manifest;
    await previous?.dispose();
    activated.resume?.();
    return { status: "activated", value: activated.value };
  }
}
