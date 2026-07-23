import { describe, expect, it } from "vitest";

import {
  Await,
  createDeferredResource,
  createHydratedDeferredResource,
  needsNativePropertyWrite,
} from "@/adapters/web/ui/component/runtime";
import { publishWebDeferredState } from "@/adapters/web/ui/stream";

describe("web Structure native property writes", () => {
  it("materializes an authored empty reflected attribute exactly once", () => {
    expect(needsNativePropertyWrite("", "", null)).toBe(true);
    expect(needsNativePropertyWrite("", "", "")).toBe(false);
    expect(needsNativePropertyWrite("warm.svg", "cool.svg", "warm.svg")).toBe(true);
  });
});

describe("web deferred Route data", () => {
  it("invokes deferred work once and reveals its resolved value", async () => {
    let calls = 0;
    const value = createDeferredResource(async () => {
      calls += 1;
      return "Activity";
    });

    expect(renderAwait(value)).toBe("Loading");
    await settlePromises();
    expect(renderAwait(value)).toBe("Activity");
    expect(calls).toBe(1);
  });

  it("renders a local error result after deferred work rejects", async () => {
    const value = createDeferredResource(() => Promise.reject(new Error("Unavailable")));

    expect(renderAwait(value)).toBe("Loading");
    await settlePromises();
    expect(renderAwait(value)).toBe("Error: Unavailable");
  });

  it("does not publish a result after its owner aborts", async () => {
    const controller = new AbortController();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((complete) => {
      resolve = complete;
    });
    const value = createDeferredResource(() => pending, controller.signal);

    await Promise.resolve();
    controller.abort();
    resolve("Too late");
    await settlePromises();
    expect(renderAwait(value)).toBe("Loading");
  });

  it("adopts a streamed server result without invoking work in the browser", () => {
    const value = createHydratedDeferredResource<string>({
      version: 1,
      kind: "deferred",
      boundary: "d100",
      field: "activity",
      state: { status: "pending" },
    });

    expect(renderAwait(value)).toBe("Loading");
    publishWebDeferredState("d100", { status: "resolved", value: "From server" });
    expect(renderAwait(value)).toBe("From server");
  });

  it("ignores streamed completion after navigation aborts", () => {
    const controller = new AbortController();
    const value = createHydratedDeferredResource<string>(
      {
        version: 1,
        kind: "deferred",
        boundary: "d101",
        field: "activity",
        state: { status: "pending" },
      },
      controller.signal,
    );

    controller.abort();
    publishWebDeferredState("d101", { status: "resolved", value: "Stale" });
    expect(renderAwait(value)).toBe("Loading");
  });
});

function renderAwait(value: Parameters<typeof Await<string>>[0]["value"]): unknown {
  return Await({
    value,
    fallback: "Loading",
    children: (result) => result,
    error: (error) => `Error: ${error instanceof Error ? error.message : String(error)}`,
  }) as unknown;
}

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
