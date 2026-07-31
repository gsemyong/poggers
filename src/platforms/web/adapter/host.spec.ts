import { afterEach, describe, expect, test, vi } from "vitest";

import type { DependencyContractIR, DependencyOperationIR, TypeIR } from "@/compiler/ir";
import { scopeDependency } from "@/execution/process";
import {
  browserReplicationProvider,
  type Replication,
  type ReplicationCommandResult,
  type ReplicationEnvelope,
} from "@/features/replica";
import { replicationConformance, replicationConformanceRecords } from "@/features/replica/testing";
import type { ConnectionContext, Navigation } from "@/platforms/web";
import { createWebHost, createWebServiceWorkerRuntime } from "@/platforms/web/adapter/host";
import type { WebRouteIR } from "@/platforms/web/adapter/lowering";
import {
  parseWebRealtimeServerFrame,
  serializeWebRealtimeServerFrames,
  WEB_REALTIME_MAX_FRAME_BYTES,
} from "@/platforms/web/adapter/transport";
import type { WebNavigation } from "@/platforms/web/routing";

const navigationDependency = dependency("navigation", [
  operation("back", false, { kind: "primitive", name: "void" }),
  operation("current", false, { kind: "opaque", name: "URL" }),
  operation("forward", false, { kind: "primitive", name: "void" }),
  operation("href", true, { kind: "primitive", name: "string" }),
  operation("navigate", true, { kind: "primitive", name: "void" }),
  operation("subscribe", true, { kind: "opaque", name: "Disposable" }),
]);
const serviceWorkerDependency = dependency("serviceWorker", []);
const connectionDependency = dependency("connection", [
  operation("refresh", false, { kind: "primitive", name: "void" }),
]);
const replicationDependency = dependency("replication", [
  {
    name: "pull",
    mode: "asynchronous",
    input: { kind: "opaque", name: "Pull" },
    output: { kind: "opaque", name: "Result" },
  },
  {
    name: "command",
    mode: "asynchronous",
    input: { kind: "opaque", name: "Command" },
    output: { kind: "opaque", name: "Result" },
  },
  {
    name: "changes",
    mode: "asynchronous",
    input: { kind: "opaque", name: "Changes" },
    output: { kind: "opaque", name: "Stream" },
  },
]);

afterEach(() => vi.unstubAllGlobals());

replicationConformance.test({
  name: "web WebSocket",
  async create() {
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("location", new URL("http://replication-conformance.test/tasks"));
    vi.stubGlobal(
      "WebSocket",
      class extends FakeWebSocket {
        constructor(url: URL) {
          super(url);
          sockets.push(this);
        }
      },
    );
    const host = await createReplicationHost();
    return {
      api: host.replication,
      dispose() {
        for (const socket of sockets) socket.close();
      },
    };
  },
});

describe("web host", () => {
  test("partitions large streaming bodies into bounded lossless frames", () => {
    const value = `${'"\\\n'.repeat(40_000)}${"content".repeat(20_000)}😀`;
    const serialized = serializeWebRealtimeServerFrames({
      type: "chunk",
      id: "large-response",
      value,
    });

    expect(serialized.length).toBeGreaterThan(1);
    expect(
      serialized.every(
        (frame) => new TextEncoder().encode(frame).byteLength <= WEB_REALTIME_MAX_FRAME_BYTES,
      ),
    ).toBe(true);
    expect(
      serialized
        .map((frame) => parseWebRealtimeServerFrame(frame))
        .map((frame) => (frame.type === "chunk" ? frame.value : ""))
        .join(""),
    ).toBe(value);
  });

  test("multiplexes Replica traffic over one same-origin WebSocket", async () => {
    const sockets: FakeWebSocket[] = [];
    const fetched = vi.fn();
    vi.stubGlobal("location", new URL("http://realtime.test/tasks"));
    vi.stubGlobal("fetch", fetched);
    vi.stubGlobal(
      "WebSocket",
      class extends FakeWebSocket {
        constructor(url: URL) {
          super(url);
          sockets.push(this);
        }
      },
    );

    const host = await createReplicationHost();
    const replication = host.replication;
    const first = replication.pull({ replica: "tasks" });
    const second = replication.command({
      replica: "tasks",
      command: "create",
      value: { id: "one" },
      idempotencyKey: "command-one",
    });

    await expect(first).resolves.toEqual(replicationEnvelope(1));
    await expect(second).resolves.toEqual({
      result: { request: 2 },
      pull: replicationEnvelope(2),
    });
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe("ws://realtime.test/_kit/realtime");
    expect(sockets[0]?.requests).toEqual([
      expect.objectContaining({ path: "/api/replicas/tasks" }),
      expect.objectContaining({
        path: "/api/replicas/tasks/create",
        method: "POST",
        body: '{"id":"one"}',
        headers: { "x-kit-command": "command-one" },
      }),
    ]);
    expect(fetched).not.toHaveBeenCalled();
  });

  test("keeps Replica change streams open across independently framed records", async () => {
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("location", new URL("http://realtime-stream.test/tasks"));
    vi.stubGlobal(
      "WebSocket",
      class extends FakeWebSocket {
        constructor(url: URL) {
          super(url);
          sockets.push(this);
        }
      },
    );

    const host = await createReplicationHost();
    const replication = host.replication;
    const changes = await replication.changes({
      replica: "tasks",
      observations: {},
      sequence: 0,
    });
    const received: ReplicationEnvelope[] = [];
    for await (const change of changes) received.push(change);

    expect(received).toEqual([replicationEnvelope(1), replicationEnvelope(2)]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.requests).toEqual([
      expect.objectContaining({
        path: "/api/replicas/tasks/changes?after=%7B%7D&sequence=0",
      }),
    ]);
  });

  test("reconnects persistent transports after the connection context changes", async () => {
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("location", new URL("http://realtime-refresh.test/tasks"));
    vi.stubGlobal(
      "WebSocket",
      class extends FakeWebSocket {
        constructor(url: URL) {
          super(url);
          sockets.push(this);
        }
      },
    );

    const host = await createReplicationHost(true);
    const replication = host.replication;
    const connection = host.connection;

    await expect(replication.pull({ replica: "tasks" })).resolves.toEqual(replicationEnvelope(1));
    connection.refresh();
    await expect(replication.pull({ replica: "tasks" })).resolves.toEqual(replicationEnvelope(1));

    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.closed).toBe(true);
  });

  test("keeps commands pending when replication authentication must be refreshed", async () => {
    vi.stubGlobal("location", new URL("http://replication-auth.test/tasks"));
    vi.stubGlobal("WebSocket", undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "Authentication is required." }, { status: 401 })),
    );
    const host = await createReplicationHost();

    await expect(host.replication.pull({ replica: "tasks" })).rejects.toMatchObject({
      name: "ReplicationAuthenticationRequired",
      message: "Authentication is required.",
    });
  });

  test("creates only the Dependencies required by one Program instance", async () => {
    const added: string[] = [];
    const removed: string[] = [];
    vi.stubGlobal("location", new URL("http://localhost:3000/tasks"));
    vi.stubGlobal("addEventListener", (name: string) => added.push(name));
    vi.stubGlobal("removeEventListener", (name: string) => removed.push(name));

    await expect(createWebHost({ dependencies: [] })).resolves.toEqual({});
    expect(added).toEqual([]);

    const host = await createWebHost({ dependencies: [navigationDependency] });
    expect(Object.keys(host)).toEqual(["navigation"]);
    expect(added).toEqual(["popstate"]);
    (host.navigation as Navigation & Disposable)[Symbol.dispose]();
    expect(removed).toEqual(["popstate"]);
  });

  test("realizes a compiler-selected Feature provider without a host name branch", async () => {
    vi.stubGlobal("location", new URL("http://localhost:3000/"));
    const probeDependency = dependency("probe", [
      operation("read", true, { kind: "primitive", name: "string" }),
    ]);
    const host = await createWebHost({
      dependencies: [probeDependency],
      providers: [
        {
          dependency: "probe",
          feature: "owner",
          platform: "web",
          development: true,
          developmentIdentity: "provider-v1",
          span: { file: "owner.ts", line: 1, column: 1 },
        },
      ],
      system: {
        features: {
          owner: {
            providers: {
              web: {
                probe: {
                  development({ context }: { context: string }) {
                    return {
                      read({ input }: { input: { value: string } }) {
                        return `${context}:${input.value}`;
                      },
                    };
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(
      (host as Readonly<Record<string, { read(input: { value: string }): string }>>).probe!.read({
        value: "ready",
      }),
    ).toBe("window:ready");
  });

  test("keeps server-projected Route loader Dependencies out of browser activation", async () => {
    const greetings = dependency("greetings", [
      operation("message", true, { kind: "primitive", name: "string" }),
    ]);

    await expect(createWebHost({ dependencies: [greetings] })).rejects.toThrow(
      "cannot implement Dependency greetings",
    );
    const host = await createWebHost({
      dependencies: [greetings],
      routeDependencies: ["greetings"],
    });
    expect(() =>
      (
        host as Readonly<{
          greetings: { message(input: { name: string }): string };
        }>
      ).greetings.message({ name: "Ada" }),
    ).toThrow("available to server Route loaders but has no browser provider");
  });

  test("resolves one destination shape locally and globally across every history operation", async () => {
    const calls: unknown[][] = [];
    const routes: WebRouteIR[] = [
      {
        feature: "tasks",
        name: "list",
        path: "/tasks",
        status: 200,
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
        status: 200,
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
    const host = (await createWebHost({ dependencies: [], routes })) as Readonly<{
      navigation: Navigation & Disposable;
    }>;
    const local = scopeDependency(host.navigation, {
      program: "browser",
      feature: "tasks",
    }) as TestNavigation;

    expect(host.navigation.href({ feature: "tasks", route: "list" })).toBe("/tasks");
    expect(local.href({ route: "edit", params: { id: "one" } })).toBe("/tasks/one");
    const receive =
      vi.fn<(location: URL, type: "push" | "replace" | "traverse" | "reload") => void>();
    using _subscription = local.subscribe(receive);
    local.navigate({ route: "edit", params: { id: "two" } });
    local.navigate({ route: "list", replace: true });
    local.back();
    local.forward();
    popstate?.();
    local.reload();

    expect(calls).toEqual([
      ["push", null, "", "/tasks/two"],
      ["replace", null, "", "/tasks"],
      ["back"],
      ["forward"],
    ]);
    expect(receive).toHaveBeenCalledTimes(4);
    expect(receive.mock.calls.map(([, type]) => type)).toEqual([
      "push",
      "replace",
      "traverse",
      "reload",
    ]);
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

  test("registers semantic handlers with the physical service-worker event router", () => {
    const subscriptions = new Set<object>();
    const scope = {
      __kitServiceWorkerSubscriptions: subscriptions,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Parameters<typeof createWebServiceWorkerRuntime>[0];
    const runtime = createWebServiceWorkerRuntime(scope);
    const handlers = { message: vi.fn() };
    const subscription = runtime.subscribe(handlers);

    expect(subscriptions).toEqual(new Set([handlers]));
    expect(scope.addEventListener).not.toHaveBeenCalled();
    subscription[Symbol.dispose]();
    expect(subscriptions).toEqual(new Set());
  });

  test("exposes the service-worker Dependency only in its matching environment", async () => {
    await expect(createWebHost({ dependencies: [serviceWorkerDependency] })).rejects.toThrow(
      /only/,
    );
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

async function createReplicationHost(connection = false): Promise<
  Readonly<{
    replication: Replication;
    connection: ConnectionContext;
  }>
> {
  return (await createWebHost({
    dependencies: connection
      ? [connectionDependency, replicationDependency]
      : [replicationDependency],
    providers: [
      {
        dependency: "replication",
        feature: "replica",
        platform: "web",
        development: true,
        developmentIdentity: "replication-v1",
        span: { file: "replica.ts", line: 1, column: 1 },
      },
    ],
    system: {
      features: {
        replica: {
          providers: {
            web: {
              replication: browserReplicationProvider,
            },
          },
        },
      },
    },
  })) as unknown as Readonly<{
    replication: Replication;
    connection: ConnectionContext;
  }>;
}

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

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  readonly url: string;
  readonly requests: object[] = [];
  closed = false;
  readyState = 0;

  constructor(url: URL) {
    super();
    this.url = url.toString();
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(value: string): void {
    const request = JSON.parse(value) as Readonly<{
      id: string;
      type: string;
      path?: string;
      method?: string;
      headers?: Readonly<Record<string, string>>;
    }>;
    if (request.type !== "request") return;
    this.requests.push(request);
    const ordinal = this.requests.length;
    queueMicrotask(() => {
      this.message({
        type: "response",
        id: request.id,
        status: 200,
        headers: [["content-type", "application/json"]],
      });
      if ("path" in request && `${request.path}`.includes("/changes?")) {
        const conformance = this.url.includes("replication-conformance.test");
        this.message({
          type: "chunk",
          id: request.id,
          value: `${JSON.stringify(
            conformance ? replicationConformanceRecords.changed : replicationEnvelope(1),
          )}\n${JSON.stringify(
            conformance ? replicationConformanceRecords.admitted.pull : replicationEnvelope(2),
          )}\n`,
        });
        this.message({ type: "end", id: request.id });
        return;
      }
      const conformancePayload = !this.url.includes("replication-conformance.test")
        ? undefined
        : request.path === "/api/replicas/tasks?after=10"
          ? replicationConformanceRecords.changed
          : request.path === "/api/replicas/tasks"
            ? replicationConformanceRecords.initial
            : request.path === "/api/replicas/tasks/complete"
              ? replicationConformanceRecords.admitted
              : undefined;
      const payload =
        conformancePayload ??
        (request.method === "POST"
          ? ({
              result: { request: ordinal },
              pull: replicationEnvelope(ordinal),
            } satisfies ReplicationCommandResult)
          : replicationEnvelope(ordinal));
      this.message({
        type: "chunk",
        id: request.id,
        value: JSON.stringify(payload),
      });
      this.message({ type: "end", id: request.id });
    });
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    const event = new Event("close") as Event & { code: number; reason: string };
    Object.defineProperties(event, {
      code: { value: code },
      reason: { value: reason },
    });
    this.dispatchEvent(event);
  }

  private message(value: object): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}

function replicationEnvelope(sequence: number): ReplicationEnvelope {
  return {
    version: 1,
    sequence,
    observations: { source: `${sequence}` },
    invocations: [],
    cursor: `${sequence}`,
    changes: [],
  };
}
