import { describe, expect, test, vi } from "vitest";

import { createWebResponseCache } from "@/adapters/web/development/cache";

const policy = {
  scope: "public",
  maxAge: "10s",
  staleWhileRevalidate: "20s",
} as const;

describe("web response cache", () => {
  test("bypasses private and no-store work", async () => {
    const cache = createWebResponseCache<number>({ capacity: 2 });
    let value = 0;
    expect(await cache.read("a", false, async () => ++value)).toMatchObject({
      status: "bypass",
      value: 1,
    });
    expect(
      await cache.read("a", { scope: "private", maxAge: "1h" }, async () => ++value),
    ).toMatchObject({ status: "bypass", value: 2 });
    expect(cache.size).toBe(0);
  });

  test("coalesces misses and serves fresh values", async () => {
    const cache = createWebResponseCache<number>({ capacity: 2 });
    const load = vi.fn(async () => 42);
    const [left, right] = await Promise.all([
      cache.read("a", policy, load),
      cache.read("a", policy, load),
    ]);
    expect([left.status, right.status]).toEqual(["miss", "miss"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.read("a", policy, load)).toEqual({ status: "fresh", value: 42 });
  });

  test("serves stale immediately and starts one refresh", async () => {
    let now = 0;
    let release!: (value: number) => void;
    const refresh = new Promise<number>((resolve) => (release = resolve));
    const cache = createWebResponseCache<number>({ capacity: 2, now: () => now });
    await cache.read("a", policy, async () => 1);
    now = 10_000;
    const load = vi.fn(() => refresh);
    expect(await cache.read("a", policy, load)).toEqual({ status: "stale", value: 1 });
    expect(await cache.read("a", policy, load)).toEqual({ status: "stale", value: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    release(2);
    await refresh;
    await vi.waitFor(() =>
      expect(cache.read("a", policy, load)).resolves.toEqual({ status: "fresh", value: 2 }),
    );
  });

  test("blocks after stale expiry and retains bounded LRU entries", async () => {
    let now = 0;
    const cache = createWebResponseCache<number>({ capacity: 2, now: () => now });
    await cache.read("a", policy, async () => 1);
    await cache.read("b", policy, async () => 2);
    await cache.read("a", policy, async () => 9);
    await cache.read("c", policy, async () => 3);
    expect(cache.size).toBe(2);
    now = 31_000;
    expect(await cache.read("a", policy, async () => 4)).toEqual({ status: "miss", value: 4 });
    expect(await cache.read("b", policy, async () => 5)).toEqual({ status: "miss", value: 5 });
  });

  test("does not replace stale data when a background refresh fails", async () => {
    let now = 0;
    const errors: unknown[] = [];
    const cache = createWebResponseCache<number>({
      capacity: 1,
      now: () => now,
      onRefreshError: (error) => errors.push(error),
    });
    await cache.read("a", policy, async () => 1);
    now = 10_000;
    expect(await cache.read("a", policy, async () => Promise.reject(new Error("offline")))).toEqual(
      {
        status: "stale",
        value: 1,
      },
    );
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(await cache.read("a", policy, async () => 2)).toEqual({ status: "stale", value: 1 });
  });

  test("bounds retained bytes and evicts the least recently used entries", async () => {
    const cache = createWebResponseCache<string>({
      capacity: 10,
      maxBytes: 4,
      size: (value) => value.length,
    });
    await cache.read("a", policy, async () => "aa");
    await cache.read("b", policy, async () => "bbb");
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(3);
    expect(await cache.read("a", policy, async () => "a")).toEqual({ status: "miss", value: "a" });
    expect(cache.bytes).toBe(4);
  });

  test("bypasses values that cannot be retained", async () => {
    const cache = createWebResponseCache<string>({
      capacity: 2,
      maxBytes: 3,
      size: (value) => value.length,
      cacheable: (value) => value !== "private",
    });
    expect(await cache.read("large", policy, async () => "large")).toEqual({
      status: "bypass",
      value: "large",
    });
    expect(await cache.read("private", policy, async () => "private")).toEqual({
      status: "bypass",
      value: "private",
    });
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  test("bounds concurrent stale refresh work", async () => {
    let now = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const cache = createWebResponseCache<number>({
      capacity: 2,
      refreshConcurrency: 1,
      now: () => now,
    });
    await cache.read("a", policy, async () => 1);
    await cache.read("b", policy, async () => 2);
    now = 10_000;
    const refreshA = vi.fn(async () => {
      await blocked;
      return 3;
    });
    const refreshB = vi.fn(async () => 4);
    expect(await cache.read("a", policy, refreshA)).toEqual({ status: "stale", value: 1 });
    expect(await cache.read("b", policy, refreshB)).toEqual({ status: "stale", value: 2 });
    expect(refreshA).toHaveBeenCalledTimes(1);
    expect(refreshB).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() =>
      expect(cache.read("a", policy, refreshA)).resolves.toEqual({ status: "fresh", value: 3 }),
    );
    expect(await cache.read("b", policy, refreshB)).toEqual({ status: "stale", value: 2 });
    await vi.waitFor(() => expect(refreshB).toHaveBeenCalledTimes(1));
  });

  test("clear releases retained byte accounting", async () => {
    const cache = createWebResponseCache<string>({
      capacity: 2,
      maxBytes: 10,
      size: (value) => value.length,
    });
    await cache.read("a", policy, async () => "value");
    expect(cache.bytes).toBe(5);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});
