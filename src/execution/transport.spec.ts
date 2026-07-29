import { expect, test, vi } from "vitest";

import type { DependencyContractIR } from "@/compiler/ir";
import {
  dependencyInvocationControl,
  invokeDependency,
  type DependencyInvocation,
  type DependencyProviderInvocation,
} from "@/core/dependency";
import {
  createDependencyRequestHandler,
  createMemoryDependencyTransport,
  createRemoteDependency,
  DEPENDENCY_PROTOCOL_VERSION,
  type DependencyTransport,
  type DependencyTransportSession,
  type DependencyWireFrame,
} from "@/execution/transport";

const number = { kind: "primitive", name: "number" } as const;
const string = { kind: "primitive", name: "string" } as const;
const empty = { kind: "record", fields: [] } as const;
const workInput = {
  kind: "record",
  fields: [
    { name: "value", optional: false, type: number },
    { name: "fail", optional: true, type: { kind: "primitive", name: "boolean" } },
  ],
} as const;
const failures = {
  kind: "record",
  fields: [
    {
      name: "unavailable",
      optional: false,
      type: {
        kind: "record",
        fields: [{ name: "retryAt", optional: false, type: number }],
      },
    },
  ],
} as const;
const heartbeat = {
  kind: "record",
  fields: [{ name: "completed", optional: false, type: number }],
} as const;

const serviceContract: DependencyContractIR = {
  name: "service",
  operations: [
    {
      name: "changes",
      mode: "stream",
      input: empty,
      output: number,
    },
    {
      name: "local",
      mode: "synchronous",
      input: empty,
      output: string,
    },
    {
      name: "work",
      mode: "asynchronous",
      input: workInput,
      output: number,
      failures,
      heartbeat,
    },
  ],
};

test("runs unrelated asynchronous and stream Dependencies across one generic Process boundary", async () => {
  const invocations: DependencyInvocation[] = [];
  const network = createMemoryDependencyTransport();
  const unbind = network.bind(
    "worker-1",
    createDependencyRequestHandler([serviceContract], {
      service: {
        changes: async function* () {
          yield 1;
          yield 2;
        },
        local: () => "local",
        async work({
          input,
          invocation,
        }: {
          input: { value: number; fail?: boolean };
          invocation: DependencyProviderInvocation<
            {
              type: "unavailable";
              data: { retryAt: number };
              retry?: { delay: number };
            },
            { completed: number }
          >;
        }) {
          invocations.push(invocation);
          invocation.heartbeat({ details: { completed: input.value } });
          if (input.fail) {
            invocation.fail({
              type: "unavailable",
              data: { retryAt: 20 },
              retry: { delay: 5 },
            });
          }
          return input.value * 2;
        },
      },
    }),
  );
  const service = createRemoteDependency(serviceContract, "worker-1", network) as {
    changes(input: {}): AsyncIterable<number>;
    local(input: {}): string;
    work(input: { value: number; fail?: boolean }): Promise<number>;
  };
  const observed: unknown[] = [];

  await expect(
    invokeDependency(
      service,
      "work",
      { value: 3 },
      {
        id: "work-1",
        attempt: 2,
        scheduledAt: 10,
        startedAt: 20,
        trace: {
          traceparent: "00-abc-def-01",
          tracestate: "vendor=one",
          baggage: "tenant=acme",
        },
        [dependencyInvocationControl]: {
          previousHeartbeat: { completed: 1 },
          heartbeat(details) {
            observed.push(details);
          },
          cancellation: inactiveCancellation(),
        },
      },
    ),
  ).resolves.toBe(6);
  expect(observed).toEqual([{ completed: 3 }]);
  expect(invocations).toHaveLength(1);
  expect(invocations[0]).toMatchObject({
    id: "work-1",
    attempt: 2,
    scheduledAt: 10,
    startedAt: 20,
    previousHeartbeat: { completed: 1 },
    trace: {
      traceparent: "00-abc-def-01",
      tracestate: "vendor=one",
      baggage: "tenant=acme",
    },
  });

  const values: number[] = [];
  for await (const value of service.changes({})) values.push(value);
  expect(values).toEqual([1, 2]);
  expect(() => service.local({})).toThrow("cannot cross a Process boundary");

  const failure = await service.work({ value: 1, fail: true }).catch((error: unknown) => error);
  expect(failure).toMatchObject({
    name: "unavailable",
    data: { retryAt: 20 },
    retryDelay: 5,
  });
  unbind();
});

test("binds identity locally and sends only serializable reference operations", async () => {
  const requests: unknown[] = [];
  const contract: DependencyContractIR = {
    name: "counter",
    reference: { name: "get", argument: "input", bindings: ["key"], inputs: ["add"] },
    operations: [
      {
        name: "add",
        mode: "asynchronous",
        input: {
          kind: "record",
          fields: [
            { name: "key", optional: false, type: string },
            {
              name: "input",
              optional: false,
              type: {
                kind: "record",
                fields: [{ name: "amount", optional: false, type: number }],
              },
            },
          ],
        },
        output: number,
      },
    ],
  };
  const network = createMemoryDependencyTransport();
  network.bind(
    "counter-worker",
    createDependencyRequestHandler([contract], {
      counter: {
        async add({ input }: { input: unknown }) {
          requests.push(input);
          return 4;
        },
      },
    }),
  );
  const counter = createRemoteDependency(contract, "counter-worker", network) as {
    get(input: { key: string }): {
      add(input: { amount: number }): Promise<number>;
    };
  };

  await expect(counter.get({ key: "counter-1" }).add({ amount: 4 })).resolves.toBe(4);
  expect(requests).toEqual([{ key: "counter-1", input: { amount: 4 } }]);
});

test("rejects protocol, whole-Dependency contract, and frame mismatches before execution", async () => {
  const calls = vi.fn();
  const serverContract: DependencyContractIR = {
    ...serviceContract,
    operations: serviceContract.operations.map((operation) =>
      operation.name === "work" ? { ...operation, output: string } : operation,
    ),
  };
  const network = createMemoryDependencyTransport();
  network.bind(
    "worker",
    createDependencyRequestHandler([serverContract], {
      service: {
        changes: async function* () {},
        local: () => "local",
        work: async () => {
          calls();
          return "different";
        },
      },
    }),
  );
  const changed = createRemoteDependency(serviceContract, "worker", network) as {
    work(input: { value: number }): Promise<number>;
  };

  await expect(changed.work({ value: 1 })).rejects.toMatchObject({
    code: "contract-mismatch",
    uncertain: false,
  });
  expect(calls).not.toHaveBeenCalled();

  const invalidFrames = createRemoteDependency(serviceContract, "worker", {
    open: () =>
      session([
        {
          version: DEPENDENCY_PROTOCOL_VERSION,
          invocation: "direct:service:work:1",
          sequence: 2,
          kind: "result",
          value: 2,
        },
      ]),
  }) as { work(input: { value: number }): Promise<number> };
  await expect(invalidFrames.work({ value: 1 })).rejects.toMatchObject({
    code: "invalid-response",
    uncertain: true,
  });

  const extraOperationCalls = vi.fn();
  const extraOperationServer: DependencyContractIR = {
    ...serviceContract,
    operations: [
      ...serviceContract.operations,
      {
        name: "addedLater",
        mode: "asynchronous",
        input: empty,
        output: string,
      },
    ],
  };
  const extraOperationNetwork = createMemoryDependencyTransport();
  extraOperationNetwork.bind(
    "extra-operation-worker",
    createDependencyRequestHandler([extraOperationServer], {
      service: {
        addedLater: async () => "new",
        changes: async function* () {},
        local: () => "local",
        work: async ({ input }: { input: { value: number } }) => {
          extraOperationCalls();
          return input.value;
        },
      },
    }),
  );
  const extraOperation = createRemoteDependency(
    serviceContract,
    "extra-operation-worker",
    extraOperationNetwork,
  ) as { work(input: { value: number }): Promise<number> };
  await expect(extraOperation.work({ value: 2 })).rejects.toMatchObject({
    code: "contract-mismatch",
    uncertain: false,
  });
  expect(extraOperationCalls).not.toHaveBeenCalled();

  const wrongProtocol = createRemoteDependency(serviceContract, "extra-operation-worker", {
    open: ({ target, request }) =>
      extraOperationNetwork.open({
        target,
        request: { ...request, version: 2 as typeof DEPENDENCY_PROTOCOL_VERSION },
      }),
  }) as { work(input: { value: number }): Promise<number> };
  await expect(wrongProtocol.work({ value: 2 })).rejects.toMatchObject({
    code: "unsupported-protocol",
    uncertain: false,
  });
  expect(extraOperationCalls).not.toHaveBeenCalled();
});

test("accepts delayed frames and rejects duplicate stream delivery", async () => {
  const duplicate = createRemoteDependency(serviceContract, "worker", {
    open: ({ request }) =>
      delayedSession([
        {
          version: DEPENDENCY_PROTOCOL_VERSION,
          invocation: request.invocation.id,
          sequence: 1,
          kind: "item",
          value: 1,
        },
        {
          version: DEPENDENCY_PROTOCOL_VERSION,
          invocation: request.invocation.id,
          sequence: 1,
          kind: "item",
          value: 1,
        },
      ]),
  }) as { changes(input: {}): AsyncIterable<number> };
  const values: number[] = [];

  await expect(
    (async () => {
      for await (const value of duplicate.changes({})) values.push(value);
    })(),
  ).rejects.toMatchObject({ code: "invalid-response", uncertain: true });
  expect(values).toEqual([1]);
});

test("reports loss as uncertain and leaves retries explicit with stable invocation identity", async () => {
  const attempts: DependencyInvocation[] = [];
  const network = createMemoryDependencyTransport();
  const handler = createDependencyRequestHandler([serviceContract], {
    service: {
      changes: async function* () {},
      local: () => "local",
      async work({
        input,
        invocation,
      }: {
        input: { value: number };
        invocation: DependencyInvocation;
      }) {
        attempts.push(invocation);
        return input.value;
      },
    },
  });
  network.bind("worker", handler);
  let drop = true;
  const lossy: DependencyTransport = {
    open(input) {
      if (drop) {
        drop = false;
        return session([]);
      }
      return network.open(input);
    },
  };
  const remote = createRemoteDependency(serviceContract, "worker", lossy) as object;
  const first = invocation("retry-1", 1);

  await expect(invokeDependency(remote, "work", { value: 7 }, first)).rejects.toMatchObject({
    code: "transport-closed",
    uncertain: true,
  });
  await expect(
    invokeDependency(remote, "work", { value: 7 }, { ...first, attempt: 2 }),
  ).resolves.toBe(7);
  expect(attempts.map(({ id, attempt }) => ({ id, attempt }))).toEqual([
    { id: "retry-1", attempt: 2 },
  ]);
});

test("propagates cancellation and deadlines", async () => {
  const cancellation = cancellable();
  const providerCancelled = vi.fn();
  const logicalDeadlineStarted = vi.fn();
  const network = createMemoryDependencyTransport();
  network.bind(
    "worker",
    createDependencyRequestHandler([serviceContract], {
      service: {
        changes: async function* () {},
        local: () => "local",
        async work({
          input,
          invocation,
        }: {
          input: { value: number };
          invocation: DependencyProviderInvocation<never, { completed: number }>;
        }) {
          if (input.value === 1) {
            await invocation.cancellation.wait();
            providerCancelled();
            return 1;
          }
          if (input.value === 4) logicalDeadlineStarted();
          await new Promise((resolve) => setTimeout(resolve, 100));
          return input.value;
        },
      },
    }),
  );
  const remote = createRemoteDependency(serviceContract, "worker", network) as object;
  const pending = invokeDependency(
    remote,
    "work",
    { value: 1 },
    {
      ...invocation("cancel-1", 1),
      [dependencyInvocationControl]: {
        heartbeat: () => undefined,
        cancellation,
      },
    },
  ) as Promise<number>;
  cancellation.request();
  await expect(pending).rejects.toMatchObject({ code: "cancelled", uncertain: true });
  await expect.poll(() => providerCancelled.mock.calls.length).toBe(1);

  await expect(
    invokeDependency(
      remote,
      "work",
      { value: 3 },
      {
        ...invocation("deadline-3", 1),
        deadline: Date.now() + 10,
      },
    ),
  ).rejects.toMatchObject({ code: "deadline-exceeded", uncertain: true });

  await expect(
    invokeDependency(
      remote,
      "work",
      { value: 4 },
      {
        ...invocation("logical-deadline-4", 1),
        scheduledAt: 0,
        startedAt: 0,
        deadline: 10,
      },
    ),
  ).rejects.toMatchObject({ code: "deadline-exceeded", uncertain: true });
  expect(logicalDeadlineStarted).toHaveBeenCalledOnce();
});

function invocation(id: string, attempt: number): DependencyInvocation {
  return {
    id,
    attempt,
    scheduledAt: Date.now(),
    startedAt: Date.now(),
  };
}

function inactiveCancellation() {
  return {
    requested: () => false,
    wait: () => new Promise<void>(() => {}),
    subscribe: () => () => undefined,
  };
}

function cancellable() {
  let requested = false;
  const listeners = new Set<() => void>();
  let resolve!: () => void;
  const wait = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    requested: () => requested,
    wait: () => wait,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request() {
      requested = true;
      resolve();
      for (const listener of listeners) listener();
      listeners.clear();
    },
  };
}

function session(frames: readonly DependencyWireFrame[]): DependencyTransportSession {
  return {
    frames: {
      async *[Symbol.asyncIterator]() {
        for (const frame of frames) yield frame;
      },
    },
    cancel: () => undefined,
  };
}

function delayedSession(frames: readonly DependencyWireFrame[]): DependencyTransportSession {
  return {
    frames: {
      async *[Symbol.asyncIterator]() {
        for (const frame of frames) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          yield frame;
        }
      },
    },
    cancel: () => undefined,
  };
}
