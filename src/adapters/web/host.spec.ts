import { afterEach, describe, expect, test, vi } from "vitest";

import { createWebHost, createWebServiceWorkerRuntime } from "@/adapters/web/host";
import type { WebRouteIR } from "@/adapters/web/routing";
import type { DependencyContractIR, DependencyOperationIR, TypeIR } from "@/compiler/ir";
import type { Navigation } from "@/platforms/web/platform";
import type { WebNavigation } from "@/platforms/web/routing";
import { scopeDependency } from "@/runtime/process";

const navigationDependency = dependency("navigation", [
  operation("back", false, { kind: "primitive", name: "void" }),
  operation("current", false, { kind: "opaque", name: "URL" }),
  operation("forward", false, { kind: "primitive", name: "void" }),
  operation("href", true, { kind: "primitive", name: "string" }),
  operation("navigate", true, { kind: "primitive", name: "void" }),
  operation("subscribe", true, { kind: "opaque", name: "Disposable" }),
]);
const serviceWorkerDependency = dependency("serviceWorker", []);

afterEach(() => vi.unstubAllGlobals());

describe("web host", () => {
  test("creates only the Dependencies required by one Program instance", () => {
    const added: string[] = [];
    const removed: string[] = [];
    vi.stubGlobal("location", new URL("http://localhost:3000/tasks"));
    vi.stubGlobal("addEventListener", (name: string) => added.push(name));
    vi.stubGlobal("removeEventListener", (name: string) => removed.push(name));

    expect(createWebHost({ dependencies: [] })).toEqual({});
    expect(added).toEqual([]);

    const host = createWebHost({ dependencies: [navigationDependency] });
    expect(Object.keys(host)).toEqual(["navigation"]);
    expect(added).toEqual(["popstate"]);
    (host.navigation as Navigation & Disposable)[Symbol.dispose]();
    expect(removed).toEqual(["popstate"]);
  });

  test("resolves one destination shape locally and globally across every history operation", () => {
    const calls: unknown[][] = [];
    const routes: WebRouteIR[] = [
      {
        feature: "tasks",
        name: "list",
        path: "/tasks",
        document: "content",
        cache: false,
        metadata: {},
        params: [],
        search: [],
        deferred: [],
      },
      {
        feature: "tasks",
        name: "edit",
        path: "/tasks/:id",
        document: "content",
        cache: false,
        metadata: {},
        params: [{ name: "id", kind: "string", optional: false }],
        search: [],
        deferred: [],
      },
    ];
    let popstate: (() => void) | undefined;
    vi.stubGlobal("location", new URL("http://localhost:3000/tasks"));
    vi.stubGlobal("addEventListener", (name: string, listener: () => void) => {
      if (name === "popstate") popstate = listener;
    });
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("history", {
      pushState: (...arguments_: unknown[]) => calls.push(["push", ...arguments_]),
      replaceState: (...arguments_: unknown[]) => calls.push(["replace", ...arguments_]),
      back: () => calls.push(["back"]),
      forward: () => calls.push(["forward"]),
    });
    const host = createWebHost({ dependencies: [navigationDependency], routes });
    const local = scopeDependency(host.navigation, {
      program: "browser",
      feature: "tasks",
    }) as TestNavigation;

    expect(host.navigation.href({ to: "tasks.list" })).toBe("/tasks");
    expect(local.href({ to: "edit", params: { id: "one" } })).toBe("/tasks/one");
    const receive = vi.fn();
    using _subscription = local.subscribe(receive);
    local.navigate({ to: "edit", params: { id: "two" } });
    local.navigate({ to: "list", replace: true });
    local.back();
    local.forward();
    popstate?.();

    expect(calls).toEqual([
      ["push", null, "", "/tasks/two"],
      ["replace", null, "", "/tasks"],
      ["back"],
      ["forward"],
    ]);
    expect(receive).toHaveBeenCalledTimes(3);
    (host.navigation as Navigation & Disposable)[Symbol.dispose]();
  });

  test("bridges service-worker events and extends each event lifetime", async () => {
    const listeners = new Map<string, (event: never) => void>();
    const posted: unknown[] = [];
    const notifications: unknown[] = [];
    const opened: string[] = [];
    const scope = {
      location: new URL("https://example.test/service-worker.js"),
      registration: {
        async showNotification(title: string, options?: NotificationOptions) {
          notifications.push({ title, options });
        },
      },
      clients: {
        async matchAll() {
          return [{ postMessage: (value: unknown) => posted.push(value) }];
        },
        async openWindow(url: string) {
          opened.push(url);
        },
      },
      addEventListener(name: string, listener: (event: never) => void) {
        listeners.set(name, listener);
      },
      removeEventListener(name: string, listener: (event: never) => void) {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
    } as unknown as Parameters<typeof createWebServiceWorkerRuntime>[0];
    const runtime = createWebServiceWorkerRuntime<unknown, unknown>(scope);
    const received: unknown[] = [];
    using _subscription = runtime.subscribe({
      async message(event) {
        received.push(event.data);
        event.respond("acknowledged");
      },
      push(event) {
        received.push(event.data);
      },
      synchronize(event) {
        received.push(`${event.tag}:${event.lastChance}`);
      },
      notificationClick(event) {
        received.push(`${event.action}:${String(event.data)}`);
      },
    });

    await dispatch(listeners, "message", {
      data: { kind: "refresh" },
      source: { postMessage: (value: unknown) => posted.push(value) },
    });
    await dispatch(listeners, "push", { data: { text: () => "payload" } });
    await dispatch(listeners, "sync", { tag: "outbox", lastChance: true });
    let closed = false;
    await dispatch(listeners, "notificationclick", {
      action: "open",
      notification: { data: 42, close: () => (closed = true) },
    });
    await runtime.showNotification({ title: "Ready", body: "Complete" });
    await runtime.broadcast({ kind: "updated" });
    await runtime.openWindow({ url: "/tasks" });

    expect(received).toEqual([{ kind: "refresh" }, "payload", "outbox:true", "open:42"]);
    expect(posted).toEqual(["acknowledged", { kind: "updated" }]);
    expect(notifications).toEqual([{ title: "Ready", options: { body: "Complete" } }]);
    expect(opened).toEqual(["https://example.test/tasks"]);
    expect(closed).toBe(true);
  });

  test("exposes the service-worker Dependency only in its matching environment", () => {
    expect(() => createWebHost({ dependencies: [serviceWorkerDependency] })).toThrow(/only/);
  });
});

async function dispatch(
  listeners: Map<string, (event: never) => void>,
  name: string,
  event: Record<string, unknown>,
): Promise<void> {
  const pending: PromiseLike<unknown>[] = [];
  listeners.get(name)?.({
    ...event,
    waitUntil(value: PromiseLike<unknown>) {
      pending.push(value);
    },
  } as never);
  await Promise.all(pending);
}

type TestNavigation = WebNavigation<{
  list: { Params: Record<never, never>; SearchInput: Record<never, never> };
  edit: { Params: { id: string }; SearchInput: Record<never, never> };
}>;

function dependency<const Name extends string>(
  name: Name,
  operations: readonly DependencyOperationIR[],
): DependencyContractIR & Readonly<{ name: Name }> {
  return { name, operations };
}

function operation(name: string, input: boolean, output: TypeIR): DependencyOperationIR {
  return {
    name,
    mode: "synchronous",
    input: input ? { kind: "opaque", name: "Input" } : { kind: "primitive", name: "void" },
    output,
  };
}
