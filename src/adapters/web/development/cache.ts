import type { WebRouteIR } from "@/adapters/web/routing";

export type WebCacheResult<Value> = Readonly<{
  value: Value;
  status: "bypass" | "miss" | "fresh" | "stale";
}>;

export type WebResponseCache<Value> = Readonly<{
  read(
    key: string,
    policy: WebRouteIR["cache"],
    load: () => Promise<Value>,
  ): Promise<WebCacheResult<Value>>;
  clear(): void;
  readonly bytes: number;
  readonly size: number;
}>;

/** A bounded, request-locality cache shared by development and production contract tests. */
export function createWebResponseCache<Value>(options: {
  capacity: number;
  maxBytes?: number;
  refreshConcurrency?: number;
  size?: (value: Value) => number;
  cacheable?: (value: Value) => boolean;
  now?: () => number;
  onRefreshError?: (error: unknown) => void;
}): WebResponseCache<Value> {
  if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) {
    throw new TypeError("Web response cache capacity must be a positive integer.");
  }
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const refreshConcurrency = options.refreshConcurrency ?? 8;
  if (
    !(maxBytes > 0) ||
    (!Number.isSafeInteger(maxBytes) && maxBytes !== Number.POSITIVE_INFINITY)
  ) {
    throw new TypeError("Web response cache byte capacity must be positive.");
  }
  if (!Number.isSafeInteger(refreshConcurrency) || refreshConcurrency < 1) {
    throw new TypeError("Web response cache refresh concurrency must be a positive integer.");
  }
  const now = options.now ?? Date.now;
  type Entry = Readonly<{ value: Value; storedAt: number; bytes: number }>;
  type Filled = Readonly<{ value: Value; cached: boolean }>;
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Filled>>();
  let generation = 0;
  let bytes = 0;
  let refreshing = 0;

  const remove = (key: string): void => {
    const entry = entries.get(key);
    if (entry) bytes -= entry.bytes;
    entries.delete(key);
  };
  const touch = (key: string, entry: Entry) => {
    entries.delete(key);
    entries.set(key, entry);
  };
  const store = (key: string, value: Value, startedGeneration: number): boolean => {
    if (generation !== startedGeneration || options.cacheable?.(value) === false) return false;
    const entryBytes = options.size?.(value) ?? 1;
    if (!Number.isSafeInteger(entryBytes) || entryBytes < 0) {
      throw new TypeError("Web response cache entry size must be a non-negative integer.");
    }
    if (entryBytes > maxBytes) return false;
    remove(key);
    const entry = Object.freeze({ value, storedAt: now(), bytes: entryBytes });
    entries.set(key, entry);
    bytes += entryBytes;
    while (entries.size > options.capacity || bytes > maxBytes) {
      remove(entries.keys().next().value!);
    }
    return entries.get(key) === entry;
  };
  const fill = (key: string, load: () => Promise<Value>): Promise<Filled> => {
    const current = pending.get(key);
    if (current) return current;
    const startedGeneration = generation;
    const request = Promise.resolve()
      .then(load)
      .then((value) => {
        return Object.freeze({ value, cached: store(key, value, startedGeneration) });
      })
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };

  return Object.freeze({
    async read(key, policy, load) {
      if (policy === false || policy.scope !== "public" || policy.maxAge === undefined) {
        return Object.freeze({ value: await load(), status: "bypass" as const });
      }
      const maxAge = durationMilliseconds(policy.maxAge);
      const staleWhileRevalidate = policy.staleWhileRevalidate
        ? durationMilliseconds(policy.staleWhileRevalidate)
        : 0;
      if (maxAge === 0) {
        return Object.freeze({ value: await load(), status: "bypass" as const });
      }
      const entry = entries.get(key);
      if (entry) {
        const age = Math.max(0, now() - entry.storedAt);
        if (age < maxAge) {
          touch(key, entry);
          return Object.freeze({ value: entry.value, status: "fresh" as const });
        }
        if (age < maxAge + staleWhileRevalidate) {
          touch(key, entry);
          if (!pending.has(key) && refreshing < refreshConcurrency) {
            refreshing += 1;
            void fill(key, load)
              .catch((error: unknown) => options.onRefreshError?.(error))
              .finally(() => (refreshing -= 1));
          }
          return Object.freeze({ value: entry.value, status: "stale" as const });
        }
        remove(key);
      }
      const filled = await fill(key, load);
      return Object.freeze({
        value: filled.value,
        status: filled.cached ? ("miss" as const) : ("bypass" as const),
      });
    },
    clear() {
      generation += 1;
      entries.clear();
      bytes = 0;
      pending.clear();
    },
    get bytes() {
      return bytes;
    },
    get size() {
      return entries.size;
    },
  });
}

export function durationMilliseconds(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new TypeError("Invalid web cache duration.");
  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  const duration = amount * multiplier[match[2] as keyof typeof multiplier];
  if (!Number.isSafeInteger(duration)) throw new TypeError("Web cache duration overflows.");
  return duration;
}
