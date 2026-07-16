export type DurabilityFailure = "busy" | "capacity" | "corrupt" | "unavailable" | "closed";

/** Persistence guarantee selected at the runtime boundary, independent of its adapter. */
export type DurabilityProfile = "power-safe" | "process-safe";

export const defaultDurabilityProfile: DurabilityProfile = "power-safe";

export function parseDurabilityProfile(value: unknown): DurabilityProfile {
  if (value === undefined || value === "") return defaultDurabilityProfile;
  if (value === "power-safe" || value === "process-safe") return value;
  throw new TypeError(
    `Durability must be "power-safe" or "process-safe", received ${JSON.stringify(value)}.`,
  );
}

/** A small, adapter-independent failure vocabulary for durable state. */
export class DurabilityError extends Error {
  readonly failure: DurabilityFailure;
  readonly retryable: boolean;

  constructor(
    failure: DurabilityFailure,
    message: string,
    options: ErrorOptions & Readonly<{ retryable?: boolean }> = {},
  ) {
    super(message, options);
    this.name = "DurabilityError";
    this.failure = failure;
    this.retryable = options.retryable ?? (failure === "busy" || failure === "unavailable");
  }
}

export function isDurabilityError(error: unknown): error is DurabilityError {
  return error instanceof DurabilityError;
}
