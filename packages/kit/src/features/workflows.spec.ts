import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";

import {
  createFunctions,
  createWorkflowProgram,
  createWorkflowRuntime,
  NonRetriableError,
  referenceFunction,
  RetryAfterError,
  StepError,
  testFunctions,
  type DefineFunctions,
  type DurationLike,
  type FunctionExperimentSelector,
  type FunctionsFeature,
  type InstantLike,
  type FunctionSchema,
  type WorkflowClock,
  type WorkflowDefinition,
  type WorkflowFeature,
  type WorkflowRetry,
} from "#features/workflows";
import { serve } from "#host/server";
import { createWebSocketSyncTransport } from "#host/sync.websocket";
import { defineApp, type FeatureDef } from "#kernel/app";
import { featureResourceName } from "#kernel/feature";
import { createSingleNodeSubstrate } from "#substrate/adapter.memory";
import { connect } from "#substrate/client";
import { createMemoryJournal } from "#substrate/journal";
import { createSqliteJournal } from "#substrate/journal.sqlite";
import { testFeature, type TestFeatureProgramCommandBoundary } from "#testing/application";
import { createMemoryClientReplica } from "#testing/replica";
import { poll } from "#testing/wait";

type Workflows = {
  Workflows: {
    order: {
      Input: { id: string; approval: boolean; delayMs: number };
      Output: { value: string; reviewerId?: string };
      Signals: { approve: { reviewerId: string } };
      Queries: {
        progress: {
          Input: null;
          Output: { status: string; completed: number };
        };
      };
    };
    shipment: {
      Input: { orderId: string };
      Output: { trackingId: string };
    };
  };
  Dependencies: {
    work: {
      execute(
        id: string,
        context: {
          idempotencyKey: string;
          attempt: number;
          signal: AbortSignal;
          uncertainAttempts: readonly number[];
        },
      ): Promise<string>;
    };
  };
};

type WorkflowApp = {
  Actor: { id: string };
  Resources: {};
  Features: { workflows: WorkflowFeature<Workflows> };
};

class VirtualClock implements WorkflowClock {
  time = 0;
  readonly sleepers: Array<{
    readonly at: number;
    readonly signal: AbortSignal;
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
  }> = [];

  now = () => this.time;

  sleepUntil = (at: number, signal: AbortSignal): Promise<void> => {
    if (at <= this.time) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const sleeper = { at, signal, resolve, reject };
      this.sleepers.push(sleeper);
      signal.addEventListener(
        "abort",
        () => {
          const index = this.sleepers.indexOf(sleeper);
          if (index >= 0) this.sleepers.splice(index, 1);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  };

  advance(ms: number): void {
    this.time += ms;
    const ready = this.sleepers.filter(({ at }) => at <= this.time);
    for (const sleeper of ready) {
      this.sleepers.splice(this.sleepers.indexOf(sleeper), 1);
      sleeper.resolve();
    }
  }
}

type WorkDependency = Workflows["Dependencies"]["work"];

function commandContainsTransition(
  boundary: TestFeatureProgramCommandBoundary,
  type: string,
  kind?: string,
): boolean {
  const contains = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(contains);
    if (typeof value !== "object" || value === null) return false;
    if (Reflect.get(value, "type") === type) {
      if (kind === undefined || Reflect.get(value, "kind") === kind) return true;
      const operation = Reflect.get(value, "operation");
      if (
        typeof operation === "object" &&
        operation !== null &&
        Reflect.get(operation, "kind") === kind
      ) {
        return true;
      }
    }
    return Object.values(value).some(contains);
  };
  return boundary.args.some(contains);
}

function permutations<Value>(values: readonly Value[]): readonly (readonly Value[])[] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [
      value,
      ...rest,
    ]),
  );
}

async function drainVirtual(runtime: { readonly drain: () => Promise<void> }): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
    await runtime.drain();
  }
}

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

type FunctionTestContract = {
  Events: {
    "job/started": { id: string };
    "job/restarted": { id: string };
    "job/approved": { id: string; reviewer: string };
    "job/completed": { id: string; value: string };
  };
  Functions: {
    job: {
      Input: { id: string };
      Output: { value: string; reviewer: string };
    };
    child: {
      Input: { value: string };
      Output: { value: string };
    };
    audit: {
      Input: { id: string; value: string };
      Output: { recorded: string };
    };
  };
  Dependencies: {
    work: { execute(id: string): Promise<string> };
  };
};

type FunctionTestApp = {
  Actor: { id: string };
  Resources: {};
  Features: { jobs: FunctionsFeature<FunctionTestContract> };
};

type DirectStepContract = {
  Events: {
    "test/run": { id: string };
    "test/approved": { id: string };
  };
  Functions: {
    test: { Input: { id: string }; Output: string };
    child: { Input: { id: string }; Output: string };
  };
  Dependencies: {};
};

type DirectStepApp = {
  Actor: { id: string };
  Resources: {};
  Features: { steps: FunctionsFeature<DirectStepContract> };
};

function createDirectStepTest(define: DefineFunctions<DirectStepContract>) {
  const feature = createFunctions<DirectStepApp, DirectStepContract>({ dependencies: {} }, define);
  return testFunctions(feature, { dependencies: {} });
}

const directStepEvent = {
  id: "event",
  name: "test/run",
  data: { id: "input" },
  ts: 123,
} as const;

type AdmissionModelContract = {
  Events: { "model/run": { group: string; priority: number } };
  Functions: {
    model: {
      Input: { group: string; priority: number };
      Output: { id: string };
    };
  };
  Dependencies: {};
};

type AdmissionModelApp = {
  Actor: { id: string };
  Resources: {};
  Features: { model: FunctionsFeature<AdmissionModelContract> };
};

describe("createFunctions", () => {
  it("normalizes intentional void function and step results at the durable boundary", async () => {
    type VoidContract = {
      Events: { "notification/requested": { id: string } };
      Functions: {
        notify: { Input: { id: string }; Output: void };
        deliver: { Input: void; Output: { delivered: boolean } };
      };
      Dependencies: {};
    };
    type VoidApp = {
      Actor: { id: string };
      Resources: {};
      Features: { notifications: FunctionsFeature<VoidContract> };
    };
    const feature = createFunctions<VoidApp, VoidContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        const deliver = createFunction({ id: "deliver" }, async () => ({ delivered: true }));
        createFunction(
          { id: "notify", triggers: { event: "notification/requested" } },
          async ({ step }) => {
            await step.invoke("deliver-child", { function: deliver });
            await step.run("deliver", () => undefined);
          },
        );
      },
    );
    const app = defineApp<VoidApp>({
      version: 1,
      resources: {},
      features: { notifications: feature },
    });
    const fixture = await testFeature(app, "notifications", { actor: { id: "owner" } });
    fixtures.push(fixture);

    await fixture.api.send({
      id: "notification-1",
      name: "notification/requested",
      data: { id: "notification-1" },
    });
    await fixture.drain();

    expect(fixture.api.getFunction("notify", "notification-1:notify").run).toMatchObject({
      status: "completed",
      output: null,
    });
    expect(
      fixture.api.getFunction("notify", "notification-1:notify").details?.operations.deliver,
    ).toMatchObject({ status: "succeeded", result: null });
  });

  it("executes one function directly with exact events, dependencies, and step mocks", async () => {
    type DirectContract = {
      Events: { "job/run": { id: string } };
      Functions: { job: { Input: { id: string }; Output: { value: string } } };
      Dependencies: { prefix: string };
    };
    type DirectApp = {
      Actor: { id: string };
      Resources: {};
      Features: { jobs: FunctionsFeature<DirectContract> };
    };
    const observed: string[] = [];
    const feature = createFunctions<DirectApp, DirectContract>(
      { dependencies: { prefix: "production" } },
      ({ createFunction, dependencies }) => {
        createFunction(
          { id: "job", triggers: { event: "job/run" } },
          async ({ event, runId, step }) => {
            observed.push(`${runId}:${event.id}`);
            const value = await step.run("work", () => `${dependencies.prefix}:${event.data.id}`);
            await step.sleep("pause", "1 hour");
            return { value };
          },
        );
      },
    );
    const test = testFunctions(feature, { dependencies: { prefix: "test" } });

    const execution = await test.execute("job", {
      events: [{ id: "event", name: "job/run", data: { id: "input" }, ts: 123 }],
      runId: "direct",
      steps: [{ id: "work", handler: () => "mocked" }],
    });

    expect(execution).toEqual({
      result: { value: "mocked" },
      steps: [
        { id: "work", kind: "run", result: "mocked" },
        { id: "pause", kind: "sleep" },
      ],
    });
    expect(observed).toEqual(["direct:event"]);
  });

  describe("FunctionsTest.start", () => {
    it("advances to a resolved function checkpoint", async () => {
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          await step.run("step-a", () => "a");
          return "done";
        });
      });

      const checkpoint = await test
        .start("test", { events: [directStepEvent] })
        .waitFor("function-resolved");

      expect(checkpoint).toEqual({
        type: "function-resolved",
        data: "done",
        steps: [{ id: "step-a", kind: "run", result: "a" }],
      });
    });

    it("advances through prior steps to a matching step checkpoint", async () => {
      const effects: string[] = [];
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          await step.run("step-a", () => {
            effects.push("a");
            return "a";
          });
          await step.run("step-b", () => {
            effects.push("b");
            return "b";
          });
          return "done";
        });
      });
      const run = test.start("test", { events: [directStepEvent] });

      expect(await run.waitFor("step-ran", { step: { id: "step-b" } })).toEqual({
        type: "step-ran",
        step: { id: "step-b", kind: "run", result: "b" },
      });
      expect(effects).toEqual(["a", "b"]);
    });

    it("discovers one parallel frontier without running its handlers", async () => {
      const effects: string[] = [];
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          const [a, b] = await Promise.all([
            step.run("parallel-a", () => {
              effects.push("a");
              return "a";
            }),
            step.run("parallel-b", () => {
              effects.push("b");
              return "b";
            }),
          ]);
          return `${a}-${b}`;
        });
      });
      const run = test.start("test", { events: [directStepEvent] });

      expect(await run.waitFor("steps-found", { steps: [{ id: "parallel-a" }] })).toEqual({
        type: "steps-found",
        steps: [
          { id: "parallel-a", kind: "run" },
          { id: "parallel-b", kind: "run" },
        ],
      });
      expect(effects).toEqual([]);
    });

    it("rejects with the actual terminal checkpoint when the requested one cannot occur", async () => {
      const failure = new Error("boom");
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async () => {
          throw failure;
        });
      });
      const run = test.start("test", { events: [directStepEvent] });

      expect(run.waitFor("function-resolved")).rejects.toMatchObject({
        type: "function-rejected",
        error: failure,
      });
    });

    it("retains checkpoint state and executes supplied mocks once across waits", async () => {
      let mockCalls = 0;
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          const a = await step.run("step-a", () => "unmocked-a");
          const b = await step.run("step-b", () => `${a}-b`);
          return `${a}:${b}`;
        });
      });
      const run = test.start("test", {
        events: [directStepEvent],
        steps: [
          {
            id: "step-a",
            handler() {
              mockCalls += 1;
              return "mocked-a";
            },
          },
        ],
      });

      expect(await run.waitFor("steps-found", { steps: [{ id: "step-b" }] })).toEqual({
        type: "steps-found",
        steps: [{ id: "step-b", kind: "run" }],
      });
      expect(await run.waitFor("step-ran", { step: { id: "step-b" } })).toEqual({
        type: "step-ran",
        step: { id: "step-b", kind: "run", result: "mocked-a-b" },
      });
      expect(await run.waitFor("function-resolved")).toMatchObject({
        type: "function-resolved",
        data: "mocked-a:mocked-a-b",
      });
      expect(mockCalls).toBe(1);
    });
  });

  it("injects the function logger in hosted and direct execution", async () => {
    type LoggingContract = {
      Events: { "log/run": { value: string } };
      Functions: { log: { Input: { value: string }; Output: string } };
      Dependencies: {};
    };
    type LoggingApp = {
      Actor: { id: string };
      Resources: {};
      Features: { logging: FunctionsFeature<LoggingContract> };
    };
    const messages: string[] = [];
    const logger = {
      debug: (...values: unknown[]) => messages.push(`debug:${values.join(":")}`),
      info: (...values: unknown[]) => messages.push(`info:${values.join(":")}`),
      warn: (...values: unknown[]) => messages.push(`warn:${values.join(":")}`),
      error: (...values: unknown[]) => messages.push(`error:${values.join(":")}`),
    };
    const feature = createFunctions<LoggingApp, LoggingContract>(
      { appVersion: "logging-1", dependencies: { logger } },
      ({ createFunction }) => {
        createFunction(
          { id: "log", triggers: { event: "log/run" } },
          ({ event, logger: executionLogger }) => {
            executionLogger.info("handled", event.data.value);
            return event.data.value;
          },
        );
      },
    );
    const app = defineApp<LoggingApp>({
      version: 1,
      resources: {},
      features: { logging: feature },
    });
    const fixture = await testFeature(app, "logging", { actor: { id: "owner" } });
    fixtures.push(fixture);

    await fixture.api.send({ id: "hosted", name: "log/run", data: { value: "hosted" } });
    await fixture.drain();
    expect(fixture.api.getFunction("log", "hosted:log").run).toMatchObject({
      status: "completed",
      version: "logging-1",
      output: "hosted",
    });

    const direct = testFunctions(feature, { dependencies: { logger } });
    expect(
      await direct.execute("log", {
        events: [{ id: "direct", name: "log/run", data: { value: "direct" }, ts: 0 }],
      }),
    ).toMatchObject({ result: "direct" });
    expect(messages).toEqual(["info:handled:hosted", "info:handled:direct"]);
  });

  it("rejects cross-application references consistently without a routing capability", async () => {
    const remoteChild = referenceFunction<{ value: string }, { value: string }>({
      functionId: "child",
      appId: "remote",
    });
    const feature = createFunctions<FunctionTestApp, FunctionTestContract>(
      {
        dependencies: {
          work: {
            async execute(id) {
              return id;
            },
          },
        },
      },
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" } },
          async ({ event, step }) => {
            const child = await step.invoke("remote-child", {
              function: remoteChild,
              data: { value: event.data.id },
            });
            return { value: child.value, reviewer: "remote" };
          },
        );
      },
    );
    const direct = testFunctions(feature, {
      dependencies: {
        work: {
          async execute(id) {
            return id;
          },
        },
      },
    });
    const directExecution = await direct.execute("job", {
      events: [{ id: "direct", name: "job/started", data: { id: "one" }, ts: 0 }],
    });

    if (!("error" in directExecution)) throw new Error("Expected direct execution to fail.");
    expect(directExecution.error).toBeInstanceOf(NonRetriableError);
    expect((directExecution.error as Error).message).toBe(
      'Function references across applications require an external routing capability; "remote" is not mounted.',
    );

    const fixture = await testFeature(
      defineApp<FunctionTestApp>({ version: 1, resources: {}, features: { jobs: feature } }),
      "jobs",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);
    await fixture.api.send({ id: "hosted", name: "job/started", data: { id: "one" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "hosted:job").run).toMatchObject({
      status: "failed",
      error: {
        name: "NonRetriableError",
        message:
          'Function references across applications require an external routing capability; "remote" is not mounted.',
      },
    });
  });

  it("fails an invocation of an unregistered local function durably", async () => {
    const missing = referenceFunction<{ value: string }, void>({ functionId: "missing" });
    const feature = createFunctions<FunctionTestApp, FunctionTestContract>(
      {
        dependencies: {
          work: { execute: async (id) => id },
        },
      },
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" }, retries: 0 },
          async ({ event, step }) => {
            await step.invoke("missing", {
              function: missing,
              data: { value: event.data.id },
            });
            return { value: event.data.id, reviewer: "unreachable" };
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<FunctionTestApp>({ version: 1, resources: {}, features: { jobs: feature } }),
      "jobs",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "missing", name: "job/started", data: { id: "one" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "missing:job").run).toMatchObject({
      status: "failed",
      error: {
        name: "Error",
        message: "Unknown workflow missing.",
      },
    });
  });

  it("routes cross-application references through one typed semantic dependency", async () => {
    const calls: Array<{
      readonly request: unknown;
      readonly idempotencyKey: string;
      readonly runId: string;
      readonly operationId: string;
      readonly timeoutMs?: number;
      readonly deadline?: number;
    }> = [];
    const remoteChild = referenceFunction<{ value: string }, { value: string }>({
      functionId: "child",
      appId: "remote",
    });
    const routing = {
      invoke(
        request: {
          readonly appId: string;
          readonly functionId: string;
          readonly data: unknown;
        },
        context: {
          readonly idempotencyKey: string;
          readonly runId: string;
          readonly operationId: string;
          readonly timeoutMs?: number;
          readonly deadline?: number;
        },
      ) {
        calls.push({
          request,
          idempotencyKey: context.idempotencyKey,
          runId: context.runId,
          operationId: context.operationId,
          ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }),
          ...(context.deadline === undefined ? {} : { deadline: context.deadline }),
        });
        const data = request.data as { readonly value: string };
        return { value: `remote:${data.value}` };
      },
    };
    const feature = createFunctions<FunctionTestApp, FunctionTestContract>(
      {
        dependencies: {
          work: { execute: async (id) => id },
          routing,
        },
      },
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" } },
          async ({ event, step }) => {
            const child = await step.invoke("remote-child", {
              function: remoteChild,
              data: { value: event.data.id },
              timeout: "250ms",
            });
            return { value: child.value, reviewer: "remote" };
          },
        );
      },
    );
    const direct = testFunctions(feature, {
      dependencies: { work: { execute: async (id) => id }, routing },
    });

    expect(
      await direct.execute("job", {
        events: [{ id: "direct", name: "job/started", data: { id: "one" }, ts: 0 }],
        runId: "direct-run",
      }),
    ).toEqual({
      result: { value: "remote:one", reviewer: "remote" },
      steps: [{ id: "remote-child", kind: "invoke", result: { value: "remote:one" } }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      request: { appId: "remote", functionId: "child", data: { value: "one" } },
      idempotencyKey: "function-test:direct-run:remote-child",
      runId: "direct-run",
      operationId: "remote-child",
      timeoutMs: 250,
    });
    expect(calls[0]!.deadline! - calls[0]!.timeoutMs!).toBeGreaterThan(0);
  });

  it("reuses remote invocation identity and reports uncertainty after restart", async () => {
    const calls: Array<{
      readonly idempotencyKey: string;
      readonly attempt: number;
      readonly uncertainAttempts: readonly number[];
    }> = [];
    const remoteChild = referenceFunction<{ value: string }, { value: string }>({
      functionId: "child",
      appId: "remote",
    });
    const routing = {
      invoke(
        _request: unknown,
        context: {
          readonly idempotencyKey: string;
          readonly attempt: number;
          readonly uncertainAttempts: readonly number[];
          readonly signal: AbortSignal;
        },
      ): Promise<{ value: string }> {
        calls.push({
          idempotencyKey: context.idempotencyKey,
          attempt: context.attempt,
          uncertainAttempts: [...context.uncertainAttempts],
        });
        if (calls.length > 1) return Promise.resolve({ value: "recovered" });
        return new Promise((_, reject) => {
          const abort = () => reject(context.signal.reason);
          if (context.signal.aborted) abort();
          else context.signal.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const feature = createFunctions<FunctionTestApp, FunctionTestContract>(
      {
        dependencies: {
          work: { execute: async (id) => id },
          routing,
        },
      },
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" }, retries: 0 },
          async ({ step }) => {
            const child = await step.invoke("remote-child", {
              function: remoteChild,
              data: { value: "input" },
            });
            return { value: child.value, reviewer: "remote" };
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<FunctionTestApp>({ version: 1, resources: {}, features: { jobs: feature } }),
      "jobs",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);
    await fixture.api.send({ id: "recover", name: "job/started", data: { id: "one" } });
    await poll(() => calls.length === 1);
    await fixture.restart();
    await fixture.drain();

    expect(fixture.api.getFunction("job", "recover:job").run).toMatchObject({
      status: "completed",
      output: { value: "recovered", reviewer: "remote" },
    });
    expect(calls).toEqual([
      {
        idempotencyKey: 'workflow:{"ownerId":"owner","id":"recover:job"}:0:"remote-child"',
        attempt: 1,
        uncertainAttempts: [],
      },
      {
        idempotencyKey: 'workflow:{"ownerId":"owner","id":"recover:job"}:0:"remote-child"',
        attempt: 2,
        uncertainAttempts: [1],
      },
    ]);
  });

  it("atomically schedules and starts a new durable effect", async () => {
    type AtomicContract = {
      Events: { "job/run": { id: string } };
      Functions: { job: { Input: { id: string }; Output: { value: string } } };
      Dependencies: {};
    };
    type AtomicApp = {
      Actor: { id: string };
      Resources: {};
      Features: { jobs: FunctionsFeature<AtomicContract> };
    };
    const feature = createFunctions<AtomicApp, AtomicContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        createFunction({ id: "job", triggers: { event: "job/run" } }, async ({ event, step }) => ({
          value: await step.run("work", () => event.data.id),
        }));
      },
    );
    const fixture = await testFeature(
      defineApp<AtomicApp>({ version: 1, resources: {}, features: { jobs: feature } }),
      "jobs",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "atomic", name: "job/run", data: { id: "one" } });
    await fixture.drain();

    const starts = fixture
      .events()
      .filter(
        ({ resource, event }) =>
          resource === featureResourceName("jobs", "runs") &&
          event.name === "transitioned" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          ((event.payload as { type?: string }).type === "operationScheduled" ||
            (event.payload as { type?: string }).type === "operationStarted") &&
          ((event.payload as { id?: string }).id === "work" ||
            (event.payload as { operation?: { id?: string } }).operation?.id === "work"),
      );
    expect(starts.map(({ event }) => (event.payload as { type: string }).type)).toEqual([
      "operationScheduled",
      "operationStarted",
    ]);
    expect(starts[1]!.event.seq).toBe(starts[0]!.event.seq + 1);
    expect(starts[0]!.event.id.replace(/:event:\d+$/, "")).toBe(
      starts[1]!.event.id.replace(/:event:\d+$/, ""),
    );
  });

  describe("FunctionsTest.executeStep", () => {
    it("executes only the requested runnable step and returns its metadata", async () => {
      let caught = false;
      let continued = false;
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          let result = "unreachable";
          try {
            result = await step.run("step-a", () => "result-a");
          } catch {
            caught = true;
          }
          continued = true;
          await step.run("step-b", () => "result-b");
          return result;
        });
      });

      const output = await test.executeStep("test", "step-a", { events: [directStepEvent] });

      expect(output).toEqual({
        result: "result-a",
        step: { id: "step-a", kind: "run", result: "result-a" },
      });
      expect(caught).toBe(false);
      expect(continued).toBe(false);
    });

    it("replays mocked prior steps before executing the requested step", async () => {
      let priorRan = false;
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          const prior = await step.run("step-a", () => {
            priorRan = true;
            return "unmocked-a";
          });
          return step.run("step-b", () => `from-${prior}`);
        });
      });

      const output = await test.executeStep("test", "step-b", {
        events: [directStepEvent],
        steps: [{ id: "step-a", handler: () => "mocked-a" }],
      });

      expect(output).toEqual({
        result: "from-mocked-a",
        step: { id: "step-b", kind: "run", result: "from-mocked-a" },
      });
      expect(priorRan).toBe(false);
    });

    it("discovers the requested step among parallel declarations", async () => {
      let siblingRan = false;
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ group, step }) =>
          group.parallel(() =>
            Promise.race([
              step.run("sibling", () => {
                siblingRan = true;
                return "sibling";
              }),
              step.run("target", () => "target"),
            ]),
          ),
        );
      });

      expect(await test.executeStep("test", "target", { events: [directStepEvent] })).toEqual({
        result: "target",
        step: { id: "target", kind: "run", result: "target" },
      });
      expect(siblingRan).toBe(false);
    });

    it("discovers sleep and wait steps without running beyond them", async () => {
      let continuedAfterSleep = false;
      const sleeping = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          await step.sleep("wait", "1 day");
          continuedAfterSleep = true;
          return "finished";
        });
      });
      const waiting = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          await step.waitForEvent("approval", {
            event: "test/approved",
            timeout: "1 hour",
          });
          return "finished";
        });
      });

      expect(await sleeping.executeStep("test", "wait", { events: [directStepEvent] })).toEqual({
        result: undefined,
        step: { id: "wait", kind: "sleep" },
      });
      expect(continuedAfterSleep).toBe(false);
      expect(await waiting.executeStep("test", "approval", { events: [directStepEvent] })).toEqual({
        result: undefined,
        step: { id: "approval", kind: "waitForEvent" },
      });
    });

    it("discovers invoked functions without executing the child", async () => {
      let childRan = false;
      const test = createDirectStepTest(({ createFunction }) => {
        const child = createFunction({ id: "child" }, async () => {
          childRan = true;
          return "child";
        });
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ event, step }) =>
          step.invoke("child", { function: child, data: { id: event.data.id } }),
        );
      });

      expect(await test.executeStep("test", "child", { events: [directStepEvent] })).toEqual({
        result: undefined,
        step: { id: "child", kind: "invoke" },
      });
      expect(
        await test.executeStep("test", "child", {
          events: [directStepEvent],
          steps: [{ id: "child", handler: () => "mocked-child" }],
        }),
      ).toEqual({
        result: "mocked-child",
        step: { id: "child", kind: "invoke", result: "mocked-child" },
      });
      expect(childRan).toBe(false);
    });

    it("uses mocks to cross non-runnable prior steps", async () => {
      const approval = {
        id: "approval",
        name: "test/approved",
        data: { id: "input" },
        ts: 456,
      } as const;
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          await step.sleep("pause", "1 minute");
          const event = await step.waitForEvent("approval", {
            event: "test/approved",
            timeout: "1 hour",
          });
          return step.run("after-approval", () => event?.data.id ?? "missing");
        });
      });

      expect(
        await test.executeStep("test", "after-approval", {
          events: [directStepEvent],
          steps: [
            { id: "pause", handler: () => undefined },
            { id: "approval", handler: () => approval },
          ],
        }),
      ).toEqual({
        result: "input",
        step: { id: "after-approval", kind: "run", result: "input" },
      });
    });

    it("returns the requested step error without continuing the function", async () => {
      const failure = new Error("step failed");
      let continued = false;
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          await step.run("failing-step", () => {
            throw failure;
          });
          continued = true;
          return "unreachable";
        });
      });

      const output = await test.executeStep("test", "failing-step", {
        events: [directStepEvent],
      });

      expect(output).toEqual({
        error: failure,
        step: { id: "failing-step", kind: "run", error: failure },
      });
      expect(continued).toBe(false);
    });

    it("fails clearly when an unmocked prior step blocks the target", async () => {
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async ({ step }) => {
          await step.run("prior", () => "must-not-run");
          return step.run("target", () => "target");
        });
      });

      expect(test.executeStep("test", "target", { events: [directStepEvent] })).rejects.toThrow(
        'Function step "target" was not reached because prior step "prior" requires a mock.',
      );
    });

    it("fails clearly when the requested step does not exist", async () => {
      const test = createDirectStepTest(({ createFunction }) => {
        createFunction({ id: "test", triggers: { event: "test/run" } }, async () => "finished");
      });

      expect(test.executeStep("test", "missing", { events: [directStepEvent] })).rejects.toThrow(
        'Function step "missing" was not reached by function "test".',
      );
    });
  });

  it("runs a typed durable failure function after retries are exhausted", async () => {
    type FailureContract = {
      Events: { "job/run": { id: string } };
      Functions: { job: { Input: { id: string }; Output: null } };
      Dependencies: {};
    };
    type FailureApp = {
      Actor: { id: string };
      Resources: {};
      Features: { failures: FunctionsFeature<FailureContract> };
    };
    const cleanup: string[] = [];
    const observed: Array<{
      readonly attempt: number;
      readonly error: string;
      readonly functionId: string;
      readonly originalId: string;
      readonly runId: string;
    }> = [];
    const feature = createFunctions<FailureApp, FailureContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/run" },
            retries: 0,
            async onFailure({ attempt, error, event, step }) {
              observed.push({
                attempt,
                error: error.message,
                functionId: event.data.function_id,
                originalId: event.data.event.data.id,
                runId: event.data.run_id,
              });
              await step.run("notify", () => {
                cleanup.push("notify");
                return null;
              });
              await step.run("release", () => {
                cleanup.push("release");
                return null;
              });
            },
          },
          async () => {
            throw new Error("deliberate failure");
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<FailureApp>({ version: 1, resources: {}, features: { failures: feature } }),
      "failures",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "event", name: "job/run", data: { id: "input" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "event:job").run).toMatchObject({
      status: "failed",
      error: { name: "Error", message: "deliberate failure" },
    });
    expect(observed).toEqual([
      {
        attempt: 0,
        error: "deliberate failure",
        functionId: "job",
        originalId: "input",
        runId: "event:job",
      },
    ]);
    expect(cleanup).toEqual(["notify", "release"]);
  });

  it("recovers an interrupted failure step with its own durable identity", async () => {
    type FailureContract = {
      Events: { "job/run": { id: string } };
      Functions: { job: { Input: { id: string }; Output: null } };
      Dependencies: {};
    };
    type FailureApp = {
      Actor: { id: string };
      Resources: {};
      Features: { failures: FunctionsFeature<FailureContract> };
    };
    let handlerEntries = 0;
    let effectCalls = 0;
    const never = new Promise<null>(() => undefined);
    const feature = createFunctions<FailureApp, FailureContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/run" },
            retries: 0,
            async onFailure({ step }) {
              handlerEntries += 1;
              await step.run("recover", () => {
                effectCalls += 1;
                return effectCalls === 1 ? never : null;
              });
            },
          },
          async () => {
            throw new Error("fail");
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<FailureApp>({ version: 1, resources: {}, features: { failures: feature } }),
      "failures",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "event", name: "job/run", data: { id: "input" } });
    await poll(() => effectCalls === 1);
    await fixture.restart();
    await fixture.drain();

    expect(fixture.api.getFunction("job", "event:job").run?.status).toBe("failed");
    expect(handlerEntries).toBe(2);
    expect(effectCalls).toBe(2);
  });

  it("does not retry a failed failure handler or its durable step", async () => {
    type FailureContract = {
      Events: { "job/run": { id: string } };
      Functions: { job: { Input: { id: string }; Output: null } };
      Dependencies: {};
    };
    type FailureApp = {
      Actor: { id: string };
      Resources: {};
      Features: { failures: FunctionsFeature<FailureContract> };
    };
    let handlerEntries = 0;
    let stepCalls = 0;
    const feature = createFunctions<FailureApp, FailureContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/run" },
            retries: 0,
            async onFailure({ step }) {
              handlerEntries += 1;
              await step.run("notify", () => {
                stepCalls += 1;
                throw new Error("notification unavailable");
              });
            },
          },
          async () => {
            throw new Error("job failed");
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<FailureApp>({ version: 1, resources: {}, features: { failures: feature } }),
      "failures",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "event", name: "job/run", data: { id: "input" } });
    await fixture.drain();

    expect(handlerEntries).toBe(1);
    expect(stepCalls).toBe(1);
  });

  it("persists function retries, attempt context, non-retryable failure, and retry-after", async () => {
    type RetryContract = {
      Events: {
        "retry/run": { id: string };
        "stop/run": { id: string };
        "later/run": { id: string };
      };
      Functions: {
        retry: { Input: { id: string }; Output: { attempt: number } };
        stop: { Input: { id: string }; Output: { attempt: number } };
        later: { Input: { id: string }; Output: { attempt: number } };
      };
      Dependencies: {};
    };
    type RetryApp = {
      Actor: { id: string };
      Resources: {};
      Features: { retries: FunctionsFeature<RetryContract> };
    };
    const attempts = { retry: [] as number[], stop: [] as number[], later: [] as number[] };
    const clock = new VirtualClock();
    const feature = createFunctions<RetryApp, RetryContract>(
      { dependencies: { clock } },
      ({ createFunction }) => {
        createFunction(
          { id: "retry", triggers: [{ event: "retry/run" }], retries: 2 },
          async ({ attempt }) => {
            attempts.retry.push(attempt);
            if (attempt < 2) throw new Error(`retry:${attempt}`);
            return { attempt };
          },
        );
        createFunction(
          { id: "stop", triggers: [{ event: "stop/run" }], retries: 3 },
          async ({ attempt }) => {
            attempts.stop.push(attempt);
            throw new NonRetriableError("stop now");
          },
        );
        createFunction(
          { id: "later", triggers: [{ event: "later/run" }], retries: 1 },
          async ({ attempt }) => {
            attempts.later.push(attempt);
            if (attempt === 0) throw new RetryAfterError("later", "1s");
            return { attempt };
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<RetryApp>({ version: 1, resources: {}, features: { retries: feature } }),
      "retries",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "retry", name: "retry/run", data: { id: "retry" } });
    await fixture.drain();
    const retried = fixture.api.getFunction("retry", "retry:retry").run;
    expect(retried).toMatchObject({ status: "completed", attempt: 2, output: { attempt: 2 } });
    expect(attempts.retry).toEqual([0, 1, 2]);

    await fixture.api.send({ id: "stop", name: "stop/run", data: { id: "stop" } });
    await fixture.drain();
    const stopped = fixture.api.getFunction("stop", "stop:stop").run;
    expect(stopped).toMatchObject({
      status: "failed",
      attempt: 0,
      error: { name: "NonRetriableError", message: "stop now" },
    });
    expect(attempts.stop).toEqual([0]);

    await fixture.api.send({ id: "later", name: "later/run", data: { id: "later" } });
    const later = fixture.api.getFunction("later", "later:later");
    await poll(() => later.run?.retryAt === 1_000);
    expect(attempts.later).toEqual([0]);
    clock.advance(1_000);
    await fixture.drain();
    expect(later.run).toMatchObject({ status: "completed", attempt: 1, output: { attempt: 1 } });
    expect(attempts.later).toEqual([0, 1]);
  });

  it("applies retry controls inside durable steps and exposes the failed step identity", async () => {
    const clock = new VirtualClock();
    let permanentCalls = 0;
    let delayedCalls = 0;
    const caught: StepError[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" }, retries: 3 },
          async ({ event, step }) => {
            try {
              await step.run("permanent", () => {
                permanentCalls += 1;
                throw new NonRetriableError("permanent", {
                  cause: new Error("root cause"),
                });
              });
            } catch (error) {
              if (!(error instanceof StepError)) throw error;
              caught.push(error);
            }
            const delayed = await step.run("delayed", () => {
              delayedCalls += 1;
              if (delayedCalls === 1) throw new RetryAfterError("later", "1 second");
              return "done";
            });
            return {
              value: `${event.data.id}:${delayed}`,
              reviewer: caught.at(-1)?.stepId ?? "missing",
            };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "step-retry", name: "job/started", data: { id: "job" } });
    const job = fixture.api.getFunction("job", "step-retry:job");
    await poll(() => job.details?.operations.delayed?.wakeAt === 1_000);
    expect(permanentCalls).toBe(1);
    expect(delayedCalls).toBe(1);
    expect(caught[0]).toMatchObject({
      name: "NonRetriableError",
      message: "permanent",
      stepId: "permanent",
      cause: { name: "Error", message: "root cause" },
    });

    clock.advance(1_000);
    await fixture.drain();

    expect(job.details).toMatchObject({
      status: "completed",
      output: { value: "job:done", reviewer: "permanent" },
      operations: {
        permanent: { status: "failed", attempt: 1 },
        delayed: { status: "succeeded", attempt: 2 },
      },
    });
    expect(permanentCalls).toBe(1);
    expect(delayedCalls).toBe(2);
  });

  it("adds one linear declaration replay after an interrupted retained execution", async () => {
    type RecoveryContract = {
      Events: { "scale/run": { count: number } };
      Functions: { scale: { Input: { count: number }; Output: { total: number } } };
      Dependencies: { work: { execute(index: number): Promise<number> } };
    };
    type RecoveryApp = {
      Actor: { id: string };
      Resources: {};
      Features: { scale: FunctionsFeature<RecoveryContract> };
    };
    let entries = 0;
    let declarations = 0;
    let interrupt = true;
    const blocked = Promise.withResolvers<void>();
    const feature = createFunctions<RecoveryApp, RecoveryContract>(
      {
        dependencies: {
          work: {
            async execute(index) {
              if (index === 50 && interrupt) {
                interrupt = false;
                await blocked.promise;
              }
              return index;
            },
          },
        },
      },
      ({ createFunction, dependencies }) => {
        createFunction(
          { id: "scale", triggers: { event: "scale/run" }, retries: 0 },
          async ({ event, step }) => {
            entries += 1;
            let total = 0;
            for (let index = 0; index < event.data.count; index += 1) {
              declarations += 1;
              total += await step.run(`step-${index}`, () => dependencies.work.execute(index));
            }
            return { total };
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<RecoveryApp>({ version: 1, resources: {}, features: { scale: feature } }),
      "scale",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "recover", name: "scale/run", data: { count: 100 } });
    const run = fixture.api.getFunction("scale", "recover:scale");
    await poll(() => run.details?.operations["step-50"]?.status === "running");
    await fixture.restart();
    blocked.resolve();
    await fixture.drain();

    expect(run.run?.status).toBe("completed");
    expect(run.run?.output).toEqual({ total: 4_950 });
    expect(entries).toBe(2);
    expect(declarations).toBe(151);
    expect(run.details?.operations["step-50"]?.uncertainAttempts).toEqual([1]);
  });

  it("collects Inngest-shaped definitions and recollects them with replaced dependencies", async () => {
    let collections = 0;
    const feature = createFunctions<FunctionTestApp, FunctionTestContract>(
      {
        dependencies: {
          work: {
            async execute(id) {
              return `normal:${id}`;
            },
          },
        },
      },
      ({ createFunction, dependencies }) => {
        collections += 1;
        createFunction(
          { id: "audit", triggers: { event: "job/completed" } },
          async ({ event }) => ({ recorded: `${event.data.id}:${event.data.value}` }),
        );
        createFunction({ id: "child" }, async ({ event }) => ({
          value: `child:${event.data.value}`,
        }));
        const child = referenceFunction<{ value: string }, { value: string }>({
          functionId: "child",
        });
        createFunction(
          { id: "job", triggers: { event: "job/started" }, retries: 2 },
          async ({ event, step }) => {
            const value = await step.run(
              { id: "work", name: "Execute work" },
              (id) => dependencies.work.execute(id),
              event.data.id,
            );
            const approval = await step.waitForEvent("approval", {
              event: "job/approved",
              match: "data.id",
            });
            if (!approval) throw new Error("approval timed out");
            const result = await step.invoke("child", {
              function: child,
              data: { value },
            });
            await step.sendEvent("completed", {
              name: "job/completed",
              data: { id: event.data.id, value: result.value },
            });
            return { value: result.value, reviewer: approval.data.reviewer };
          },
        );
      },
    );
    expect(collections).toBe(1);
    const app = defineApp<FunctionTestApp>({
      version: 1,
      resources: {},
      features: { jobs: feature },
    });
    const fixture = await testFeature(app, "jobs", {
      actor: { id: "owner" },
      dependencies: {
        server: {
          work: {
            async execute(id) {
              return `replacement:${id}`;
            },
          },
        },
      },
    });
    expect(collections).toBe(2);

    try {
      await fixture.api.send({
        id: "job-1",
        name: "job/started",
        data: { id: "one" },
      });
      const job = fixture.api.getFunction("job", "job-1:job");
      await poll(() => job.details?.operations.approval?.status === "scheduled");
      expect(collections).toBe(2);
      await fixture.restart();
      expect(collections).toBe(3);
      await fixture.api.send({
        id: "approval-other",
        name: "job/approved",
        data: { id: "other", reviewer: "Grace" },
      });
      await fixture.api.send({
        id: "approval-1",
        name: "job/approved",
        data: { id: "one", reviewer: "Ada" },
        ts: 123,
      });
      await fixture.drain();

      expect(job.run).toMatchObject({
        status: "completed",
        output: { value: "child:replacement:one", reviewer: "Ada" },
      });
      expect(job.details?.messages).toEqual([
        {
          id: "approval-1",
          name: "job/approved",
          payload: {
            id: "approval-1",
            name: "job/approved",
            data: { id: "one", reviewer: "Ada" },
            ts: 123,
          },
          consumedBy: "approval",
        },
      ]);
      expect(fixture.api.getFunction("child", "job-1:job:child").run).toMatchObject({
        status: "completed",
        parent: { operationId: "child" },
      });
      expect(fixture.api.getFunction("audit", "job-1:job:completed:0:audit").run).toMatchObject({
        status: "completed",
        output: { recorded: "one:child:replacement:one" },
      });
      expect(collections).toBe(3);
    } finally {
      await fixture.dispose();
    }
  });

  it("isolates repeated and nested factory instances through semantic Feature ownership", async () => {
    type Coordinator = {
      Resources: {};
      Components: {};
      Features: { jobs: FunctionsFeature<FunctionTestContract> };
      API: {};
    };
    type CompositionApp = {
      Actor: { id: string };
      Resources: {};
      Features: {
        primary: FunctionsFeature<FunctionTestContract>;
        secondary: FunctionsFeature<FunctionTestContract>;
        domain: Coordinator;
      };
    };
    const createInstance = (prefix: string) =>
      createFunctions<CompositionApp, FunctionTestContract>(
        {
          dependencies: {
            work: {
              async execute(id) {
                return `${prefix}:${id}`;
              },
            },
          },
        },
        ({ createFunction, dependencies }) => {
          createFunction(
            { id: "job", triggers: { event: "job/started" } },
            async ({ event, step }) => ({
              value: await step.run("work", () => dependencies.work.execute(event.data.id)),
              reviewer: prefix,
            }),
          );
        },
      );
    const app = defineApp<CompositionApp>({
      version: 1,
      resources: {},
      features: {
        primary: createInstance("primary"),
        secondary: createInstance("secondary"),
        domain: {
          resources: {},
          components: {},
          features: { jobs: createInstance("nested") },
        },
      },
    });
    expect(app.def.featureManifest?.entries.map(({ path }) => path)).toEqual([
      "domain",
      "domain.jobs",
      "primary",
      "secondary",
    ]);

    const primary = await testFeature(app, "primary", { actor: { id: "owner" } });
    const secondary = await testFeature(app, "secondary", { actor: { id: "owner" } });
    const nested = await testFeature(app, "domain.jobs", { actor: { id: "owner" } });
    fixtures.push(primary, secondary, nested);
    for (const fixture of [primary, secondary, nested]) {
      await fixture.api.send({ id: "same", name: "job/started", data: { id: "one" } });
    }
    await Promise.all([primary.drain(), secondary.drain(), nested.drain()]);

    expect(primary.api.getFunction("job", "same:job").run?.output).toEqual({
      value: "primary:one",
      reviewer: "primary",
    });
    expect(secondary.api.getFunction("job", "same:job").run?.output).toEqual({
      value: "secondary:one",
      reviewer: "secondary",
    });
    expect(nested.api.getFunction("job", "same:job").run?.output).toEqual({
      value: "nested:one",
      reviewer: "nested",
    });
  });

  it("rejects duplicate function identities at definition time", () => {
    expect(() =>
      createFunctions<FunctionTestApp, FunctionTestContract>(
        {
          dependencies: {
            work: {
              async execute(id) {
                return id;
              },
            },
          },
        },
        ({ createFunction }) => {
          createFunction({ id: "child" }, async ({ event }) => ({ value: event.data.value }));
          createFunction({ id: "child" }, async ({ event }) => ({ value: event.data.value }));
        },
      ),
    ).toThrow('Function "child" is defined more than once.');
  });

  it("deduplicates repeated event ids regardless of payload", async () => {
    let runs = 0;
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction({ id: "audit", triggers: { event: "job/completed" } }, async ({ event }) => {
        runs += 1;
        return { recorded: `${event.data.id}:${event.data.value}` };
      });
    });

    for (let index = 0; index < 5; index += 1) {
      expect(
        await fixture.api.send({
          id: "event-1",
          name: "job/completed",
          data: { id: "one", value: `value-${index}` },
        }),
      ).toEqual({ ids: ["event-1"] });
    }
    await fixture.drain();

    expect(runs).toBe(1);
    expect(fixture.api.getFunction("audit", "event-1:audit").run).toMatchObject({
      status: "completed",
      output: { recorded: "one:value-0" },
    });
  });

  it("preserves the exact event for every trigger", async () => {
    const seen: unknown[] = [];
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: [{ event: "job/started" }, { event: "job/restarted" }],
        },
        async ({ event, maxAttempts }) => {
          seen.push({ event, maxAttempts });
          return { value: event.name, reviewer: event.id };
        },
      );
    });

    await fixture.api.send({
      id: "restart-1",
      name: "job/restarted",
      data: { id: "one" },
      ts: 456,
      v: "2026-07-15",
      meta: { sessions: { account: 42, device: "phone" } },
    });
    await fixture.drain();

    expect(seen).toEqual([
      {
        event: {
          id: "restart-1",
          name: "job/restarted",
          data: { id: "one" },
          ts: 456,
          v: "2026-07-15",
          meta: { sessions: { account: "42", device: "phone" } },
        },
        maxAttempts: 4,
      },
    ]);
  });

  it("dispatches wildcard triggers through a typed event-name family", async () => {
    type WildcardContract = {
      Events: {
        [Name in `document/${string}`]: { id: string };
      } & {
        "other/event": { id: string };
      };
      Functions: {
        index: { Input: { id: string }; Output: { event: string } };
      };
      Dependencies: {};
    };
    type WildcardApp = {
      Actor: { id: string };
      Resources: {};
      Features: { functions: FunctionsFeature<WildcardContract> };
    };
    const feature = createFunctions<WildcardApp, WildcardContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        createFunction({ id: "index", triggers: { event: "document/*" } }, async ({ event }) => ({
          event: event.name,
        }));
      },
    );
    const app = defineApp<WildcardApp>({
      version: 1,
      resources: {},
      features: { functions: feature },
    });
    const fixture = await testFeature(app, "functions", { actor: { id: "owner" } });
    fixtures.push(fixture);

    await fixture.api.send([
      { id: "created", name: "document/created", data: { id: "one" } },
      { id: "updated", name: "document/updated", data: { id: "one" } },
      { id: "other", name: "other/event", data: { id: "one" } },
    ]);
    await fixture.drain();

    expect(fixture.api.getFunction("index", "created:index").run?.output).toEqual({
      event: "document/created",
    });
    expect(fixture.api.getFunction("index", "updated:index").run?.output).toEqual({
      event: "document/updated",
    });
    expect(fixture.api.getFunction("index", "other:index").run).toBeNull();
  });

  it("validates wildcard trigger payloads before entering the handler", async () => {
    type WildcardContract = {
      Events: {
        [Name in `schema/${string}`]: { nested: { message: string | number } };
      };
      Functions: {
        wildcard: {
          Input: { nested: { message: string | number } };
          Output: string;
        };
      };
      Dependencies: {};
    };
    type WildcardApp = {
      Actor: { id: string };
      Resources: {};
      Features: { schema: FunctionsFeature<WildcardContract> };
    };
    let entries = 0;
    const schema = {
      "~standard": {
        validate(value: unknown) {
          const input = value as { nested?: { message?: unknown } };
          return typeof input.nested?.message === "string"
            ? { value: input as { nested: { message: string } } }
            : { issues: [{ message: "message must be a string", path: ["nested", "message"] }] };
        },
      },
    };
    const feature = createFunctions<WildcardApp, WildcardContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        createFunction({ id: "wildcard", triggers: { event: "schema/*", schema } }, ({ event }) => {
          entries += 1;
          return String(event.data.nested.message);
        });
      },
    );
    const fixture = await testFeature(
      defineApp<WildcardApp>({ version: 1, resources: {}, features: { schema: feature } }),
      "schema",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({
      id: "valid",
      name: "schema/valid",
      data: { nested: { message: "accepted" } },
    });
    await fixture.api.send({
      id: "invalid",
      name: "schema/invalid",
      data: { nested: { message: 42 } },
    });
    await fixture.drain();

    expect(fixture.api.getFunction("wildcard", "valid:wildcard").run).toMatchObject({
      status: "completed",
      output: "accepted",
    });
    expect(fixture.api.getFunction("wildcard", "invalid:wildcard").run).toMatchObject({
      status: "failed",
      error: {
        name: "FunctionEventValidationError",
        message: expect.stringContaining("nested.message: message must be a string"),
      },
    });
    expect(entries).toBe(1);
  });

  it("accepts Temporal-compatible durations and instants", async () => {
    const clock = new VirtualClock();
    const duration = {
      [Symbol.toStringTag]: "Temporal.Duration",
      total: ({ unit }: { readonly unit: "milliseconds" }) => (unit === "milliseconds" ? 100 : 0),
    } satisfies DurationLike & {
      total(options: { readonly unit: "milliseconds" }): number;
    };
    const instant: InstantLike & { toString(): string } = {
      [Symbol.toStringTag]: "Temporal.Instant",
      toString: () => "1970-01-01T00:00:00.250Z",
    };
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" } },
          async ({ event, step }) => {
            await step.sleep("duration", duration);
            await step.sleepUntil("instant", instant);
            return { value: event.data.id, reviewer: "finished" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "temporal", name: "job/started", data: { id: "one" } });
    await poll(() => clock.sleepers.some(({ at }) => at === 100));
    clock.advance(100);
    await poll(() => clock.sleepers.some(({ at }) => at === 250));
    clock.advance(150);
    await fixture.drain();

    expect(fixture.api.getFunction("job", "temporal:job").details).toMatchObject({
      status: "completed",
      operations: {
        duration: { status: "succeeded", wakeAt: 100 },
        instant: { status: "succeeded", wakeAt: 250 },
      },
    });
  });

  it("persists standard fetch responses and replaces the transport in direct tests", async () => {
    type FetchContract = {
      Events: { "fetch/run": { path: string } };
      Functions: {
        fetch: {
          Input: { path: string };
          Output: { body: string; status: number; trace: string | null };
        };
      };
      Dependencies: {};
    };
    type FetchApp = {
      Actor: { id: string };
      Resources: {};
      Features: { fetch: FunctionsFeature<FetchContract> };
    };
    const requests: string[] = [];
    const define: DefineFunctions<FetchContract> = ({ createFunction }) => {
      createFunction(
        { id: "fetch", triggers: { event: "fetch/run" }, retries: 0 },
        async ({ event, step }) => {
          const response = await step.fetch("request", `https://example.test${event.data.path}`);
          return {
            body: await response.text(),
            status: response.status,
            trace: response.headers.get("x-trace"),
          };
        },
      );
    };
    const feature = createFunctions<FetchApp, FetchContract>(
      {
        dependencies: {
          async fetch(input) {
            requests.push(new Request(input).url);
            return new Response("production", {
              status: 201,
              headers: { "x-trace": "durable" },
            });
          },
        },
      },
      define,
    );
    const fixture = await testFeature(
      defineApp<FetchApp>({ version: 1, resources: {}, features: { fetch: feature } }),
      "fetch",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "fetch", name: "fetch/run", data: { path: "/resource" } });
    await fixture.drain();
    expect(fixture.api.getFunction("fetch", "fetch:fetch").details).toMatchObject({
      status: "completed",
      output: { body: "production", status: 201, trace: "durable" },
      operations: { request: { status: "succeeded" } },
    });
    expect(requests).toEqual(["https://example.test/resource"]);

    const direct = testFunctions(feature, {
      dependencies: {
        async fetch() {
          return new Response("test", { headers: { "x-trace": "replaced" } });
        },
      },
    });
    const execution = await direct.execute("fetch", {
      events: [{ id: "direct", name: "fetch/run", data: { path: "/direct" }, ts: 0 }],
    });
    expect(execution).toMatchObject({
      result: { body: "test", status: 200, trace: "replaced" },
      steps: [{ id: "request", kind: "fetch" }],
    });
  });

  it("routes one owner-scoped signal after restart through the durable registry", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction({ id: "job", triggers: { event: "job/started" } }, async ({ event, step }) => {
        const approval = await step.waitForSignal<{ reviewer: string }>("approval", {
          signal: `approval:${event.data.id}`,
          timeout: "1 day",
          onConflict: "fail",
        });
        return {
          value: event.data.id,
          reviewer: approval?.data.reviewer ?? "timeout",
        };
      });
    });

    expect(
      await fixture.api.sendSignal({ signal: "approval:one", data: { reviewer: "Ada" } }),
    ).toEqual({
      runId: undefined,
    });
    await fixture.api.send({ id: "signal-start", name: "job/started", data: { id: "one" } });
    const job = fixture.api.getFunction("job", "signal-start:job");
    await poll(() => job.details?.operations.approval?.status === "scheduled");
    await fixture.drain();
    await fixture.restart();

    expect(
      await fixture.api.sendSignal({ signal: "approval:one", data: { reviewer: "Ada" } }),
    ).toEqual({ runId: "signal-start:job" });
    await fixture.drain();

    expect(job.details).toMatchObject({
      status: "completed",
      output: { value: "one", reviewer: "Ada" },
      operations: { approval: { status: "succeeded", result: { reviewer: "Ada" } } },
    });
    expect(await fixture.api.sendSignal({ signal: "approval:one" })).toEqual({
      runId: undefined,
    });
  });

  it("delivers a signal from one durable function step to another function", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction({ id: "job", triggers: { event: "job/started" } }, async ({ event, step }) => {
        const message = await step.waitForSignal<{ value: string }>("message", {
          signal: `job:${event.data.id}`,
          timeout: "1 day",
          onConflict: "fail",
        });
        return {
          value: message?.data.value ?? "timeout",
          reviewer: "signal",
        };
      });
      createFunction(
        { id: "audit", triggers: { event: "job/completed" } },
        async ({ event, step }) => {
          const delivered = await step.sendSignal("notify", {
            signal: `job:${event.data.id}`,
            data: { value: event.data.value },
          });
          return { recorded: delivered.runId ?? "missing" };
        },
      );
    });

    await fixture.api.send({ id: "receiver", name: "job/started", data: { id: "one" } });
    const receiver = fixture.api.getFunction("job", "receiver:job");
    await poll(() => receiver.details?.operations.message?.status === "scheduled");
    await fixture.drain();
    await fixture.api.send({
      id: "sender",
      name: "job/completed",
      data: { id: "one", value: "delivered" },
    });
    await fixture.drain();

    expect(receiver.run).toMatchObject({
      status: "completed",
      output: { value: "delivered", reviewer: "signal" },
    });
    expect(fixture.api.getFunction("audit", "sender:audit").run).toMatchObject({
      status: "completed",
      output: { recorded: "receiver:job" },
    });
  });

  it("fails a conflicting signal waiter without displacing the first waiter", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/started" }, retries: 0 },
        async ({ event, step }) => {
          const message = await step.waitForSignal<{ reviewer: string }>("message", {
            signal: "one-waiter",
            timeout: "1 day",
            onConflict: "fail",
          });
          return { value: event.data.id, reviewer: message?.data.reviewer ?? "timeout" };
        },
      );
    });

    await fixture.api.send({ id: "first", name: "job/started", data: { id: "first" } });
    await poll(
      () =>
        fixture.api.getFunction("job", "first:job").details?.operations.message?.status ===
        "scheduled",
    );
    await fixture.drain();
    await fixture.api.send({ id: "second", name: "job/started", data: { id: "second" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "second:job").details).toMatchObject({
      status: "failed",
      operations: {
        message: {
          status: "failed",
          error: { name: "FunctionSignalConflictError" },
        },
      },
    });
    expect(
      await fixture.api.sendSignal({ signal: "one-waiter", data: { reviewer: "Ada" } }),
    ).toEqual({
      runId: "first:job",
    });
    await fixture.drain();
    expect(fixture.api.getFunction("job", "first:job").run).toMatchObject({
      status: "completed",
      output: { value: "first", reviewer: "Ada" },
    });
  });

  it("replaces a signal waiter while leaving the displaced wait alive until timeout", async () => {
    const clock = new VirtualClock();
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" } },
          async ({ event, step }) => {
            const message = await step.waitForSignal<{ reviewer: string }>("message", {
              signal: "replaceable",
              timeout: "1 second",
              onConflict: "replace",
            });
            return { value: event.data.id, reviewer: message?.data.reviewer ?? "timeout" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "old", name: "job/started", data: { id: "old" } });
    await poll(
      () =>
        fixture.api.getFunction("job", "old:job").details?.operations.message?.status ===
        "scheduled",
    );
    await fixture.drain();
    await fixture.api.send({ id: "new", name: "job/started", data: { id: "new" } });
    await poll(
      () =>
        fixture.api.getFunction("job", "new:job").details?.operations.message?.status ===
        "scheduled",
    );
    await fixture.drain();

    expect(
      await fixture.api.sendSignal({ signal: "replaceable", data: { reviewer: "Grace" } }),
    ).toEqual({
      runId: "new:job",
    });
    await fixture.drain();
    expect(fixture.api.getFunction("job", "new:job").run).toMatchObject({
      status: "completed",
      output: { value: "new", reviewer: "Grace" },
    });
    expect(fixture.api.getFunction("job", "old:job").run?.status).toBe("running");

    clock.advance(1_000);
    await fixture.drain();
    expect(fixture.api.getFunction("job", "old:job").run).toMatchObject({
      status: "completed",
      output: { value: "old", reviewer: "timeout" },
    });
    expect(await fixture.api.sendSignal({ signal: "replaceable" })).toEqual({
      runId: undefined,
    });
  });

  it("validates and evaluates CEL trigger conditions before dispatch", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started", if: 'event.data.id == "run"' },
        },
        async ({ event }) => ({ value: event.data.id, reviewer: "matched" }),
      );
    });

    await fixture.api.send({ id: "skip", name: "job/started", data: { id: "skip" } });
    await fixture.api.send({ id: "run", name: "job/started", data: { id: "run" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "skip:job").run).toBeNull();
    expect(fixture.api.getFunction("job", "run:job").run).toMatchObject({
      status: "completed",
      output: { value: "run", reviewer: "matched" },
    });
  });

  it("validates trigger data with Standard Schema before entering the handler", async () => {
    type SchemaContract = {
      Events: { "schema/run": { id: string | number } };
      Functions: { job: { Input: { id: string | number }; Output: null } };
      Dependencies: {};
    };
    type SchemaApp = {
      Actor: { id: string };
      Resources: {};
      Features: { functions: FunctionsFeature<SchemaContract> };
    };
    let handlerEntries = 0;
    const failures: string[] = [];
    const schema = {
      "~standard": {
        validate(value: unknown) {
          if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
            return { value: { id: value.id } };
          }
          return { issues: [{ message: "must be a string", path: ["id"] }] };
        },
      },
    } satisfies FunctionSchema<{ id: string | number }>;
    const feature = createFunctions<SchemaApp, SchemaContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "schema/run", schema },
            async onFailure({ error }) {
              failures.push(`${error.name}:${error.message}`);
            },
          },
          async () => {
            handlerEntries += 1;
            return null;
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<SchemaApp>({ version: 1, resources: {}, features: { functions: feature } }),
      "functions",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "valid", name: "schema/run", data: { id: "one" } });
    await fixture.api.send({ id: "invalid", name: "schema/run", data: { id: 42 } });
    await fixture.drain();

    expect(handlerEntries).toBe(1);
    expect(fixture.api.getFunction("job", "valid:job").run?.status).toBe("completed");
    expect(fixture.api.getFunction("job", "invalid:job").run).toMatchObject({
      status: "failed",
      error: {
        name: "FunctionEventValidationError",
        message: 'Event "schema/run" failed validation: id: must be a string',
      },
    });
    expect(failures).toEqual([
      'FunctionEventValidationError:Event "schema/run" failed validation: id: must be a string',
    ]);
  });

  it("memoizes experiment selection and replays only the selected durable variant", async () => {
    type ExperimentContract = {
      Events: { "experiment/run": { id: string } };
      Functions: { experiment: { Input: { id: string }; Output: { selected: string } } };
      Dependencies: {};
    };
    type ExperimentApp = {
      Actor: { id: string };
      Resources: {};
      Features: { functions: FunctionsFeature<ExperimentContract> };
    };
    let selections = 0;
    let variantEffects = 0;
    const interrupted = new Promise<string>(() => undefined);
    const select: FunctionExperimentSelector = Object.assign(
      () => {
        selections += 1;
        return "new";
      },
      { __experimentConfig: { strategy: "fixed" } },
    );
    const feature = createFunctions<ExperimentApp, ExperimentContract>(
      { dependencies: {} },
      ({ createFunction }) => {
        createFunction(
          { id: "experiment", triggers: { event: "experiment/run" } },
          async ({ group, step }) => {
            const experiment = await group.experiment("checkout", {
              select,
              variants: {
                control: () => step.run("control", () => "control"),
                new: () =>
                  step.run("new", () => {
                    variantEffects += 1;
                    return variantEffects === 1 ? interrupted : "new";
                  }),
              },
            });
            return { selected: `${experiment.variant}:${experiment.result}` };
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<ExperimentApp>({ version: 1, resources: {}, features: { functions: feature } }),
      "functions",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await fixture.api.send({ id: "run", name: "experiment/run", data: { id: "one" } });
    const run = fixture.api.getFunction("experiment", "run:experiment");
    await poll(
      () =>
        run.details?.operations.checkout?.status === "succeeded" &&
        run.details.operations.new?.status === "running",
    );
    await fixture.restart();
    await fixture.drain();

    expect(selections).toBe(1);
    expect(variantEffects).toBe(2);
    expect(run.details).toMatchObject({
      status: "completed",
      output: { selected: "new:new" },
      operations: {
        checkout: { status: "succeeded", result: "new" },
        new: { status: "succeeded", result: "new" },
      },
    });

    const direct = testFunctions(feature, { dependencies: {} });
    const execution = await direct.execute("experiment", {
      events: [{ id: "direct", name: "experiment/run", data: { id: "two" }, ts: 0 }],
    });
    expect(execution).toMatchObject({
      result: { selected: "new:new" },
      steps: [
        { id: "checkout", kind: "run", result: "new" },
        { id: "new", kind: "run", result: "new" },
      ],
    });
  });

  it("rejects invalid CEL conditions when the factory is defined", () => {
    expect(() =>
      createFunctions<FunctionTestApp, FunctionTestContract>(
        {
          dependencies: {
            work: {
              async execute(id) {
                return id;
              },
            },
          },
        },
        ({ createFunction }) => {
          createFunction(
            { id: "job", triggers: { event: "job/started", if: "event.data.(" } },
            async ({ event }) => ({ value: event.data.id, reviewer: "unreachable" }),
          );
        },
      ),
    ).toThrow('Function "job" trigger if is not a valid CEL expression.');
  });

  it("runs overlapping cron triggers once and restores the next occurrence after restart", async () => {
    type CronContract = {
      Events: {};
      Functions: { tick: { Input: { manual: string }; Output: null } };
      Dependencies: {};
    };
    type CronApp = {
      Actor: { id: string };
      Resources: {};
      Features: { cron: FunctionsFeature<CronContract> };
    };
    const clock = new VirtualClock();
    const seen: Array<{ readonly cron: string; readonly name: string; readonly ts: number }> = [];
    const feature = createFunctions<CronApp, CronContract>(
      { dependencies: { clock } },
      ({ createFunction }) => {
        createFunction(
          {
            id: "tick",
            triggers: [{ cron: "* * * * *" }, { cron: "* * * * *" }],
          },
          async ({ event }) => {
            seen.push({ cron: event.data.cron, name: event.name, ts: event.ts });
            return null;
          },
        );
      },
    );
    const fixture = await testFeature(
      defineApp<CronApp>({ version: 1, resources: {}, features: { cron: feature } }),
      "cron",
      { actor: { id: "owner" } },
    );
    fixtures.push(fixture);

    await poll(() => clock.sleepers.some(({ at }) => at === 60_000));
    await fixture.restart();
    await poll(() => clock.sleepers.some(({ at }) => at === 60_000));

    clock.advance(60_000);
    await fixture.drain();

    expect(seen).toEqual([{ cron: "* * * * *", name: "inngest/scheduled.timer", ts: 60_000 }]);
    expect(fixture.api.getFunction("tick", "tick:cron:60000").run?.status).toBe("completed");
    expect(clock.sleepers.some(({ at }) => at === 120_000)).toBe(true);
  });

  it("rejects invalid cron schedules and out-of-range jitter at definition time", () => {
    type CronContract = {
      Events: {};
      Functions: { tick: { Input: {}; Output: null } };
      Dependencies: {};
    };
    type CronApp = {
      Actor: { id: string };
      Resources: {};
      Features: { cron: FunctionsFeature<CronContract> };
    };
    const create = (trigger: { readonly cron: string; readonly jitter?: string }) =>
      createFunctions<CronApp, CronContract>({ dependencies: {} }, ({ createFunction }) => {
        createFunction({ id: "tick", triggers: trigger }, async () => null);
      });

    expect(() => create({ cron: "not a cron" })).toThrow("is not a valid five-part cron schedule");
    expect(() => create({ cron: "* * * * *", jitter: "999ms" })).toThrow(
      "cron jitter must be between 1 second and 5 minutes",
    );
  });

  it("rejects a shared concurrency scope without a queue key at runtime", () => {
    expect(() =>
      createFunctions<FunctionTestApp, FunctionTestContract>(
        { dependencies: { work: { execute: async (id) => id } } },
        ({ createFunction }) => {
          createFunction(
            {
              id: "job",
              triggers: { event: "job/started" },
              concurrency: { limit: 1, scope: "env" } as never,
            },
            async ({ event }) => ({ value: event.data.id, reviewer: "unreachable" }),
          );
        },
      ),
    ).toThrow("env concurrency requires a key");
  });

  it("cancels active runs from typed correlated events", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          cancelOn: [
            {
              event: "job/approved",
              if: 'async.data.id == event.data.id && async.data.reviewer == "Ada"',
            },
          ],
        },
        async ({ event, step }) => {
          await step.waitForEvent("never", { event: "job/completed", timeout: "1 day" });
          return { value: event.data.id, reviewer: "completed" };
        },
      );
    });

    await fixture.api.send({ id: "start-1", name: "job/started", data: { id: "one" } });
    const job = fixture.api.getFunction("job", "start-1:job");
    await poll(() => job.details?.operations.never?.status === "scheduled");

    await fixture.api.send({
      id: "wrong-reviewer",
      name: "job/approved",
      data: { id: "one", reviewer: "Grace" },
    });
    await fixture.drain();
    expect(job.run?.status).toBe("running");

    await fixture.api.send({
      id: "matching-reviewer",
      name: "job/approved",
      data: { id: "one", reviewer: "Ada" },
    });
    await fixture.drain();
    expect(job.details).toMatchObject({
      status: "cancelled",
      error: "cancelled_by:job/approved",
      operations: { never: { status: "cancelled" } },
    });
  });

  it("does not cancel a run after an absolute cancellation deadline", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          cancelOn: [
            {
              event: "job/approved",
              match: "data.id",
              timeout: new Date(0),
            },
          ],
        },
        async ({ event, step }) => {
          await step.waitForEvent("never", { event: "job/completed", timeout: "1 day" });
          return { value: event.data.id, reviewer: "completed" };
        },
      );
    });

    await fixture.api.send({ id: "start-1", name: "job/started", data: { id: "one" } });
    const job = fixture.api.getFunction("job", "start-1:job");
    await poll(() => job.details?.operations.never?.status === "scheduled");
    await fixture.api.send({
      id: "expired",
      name: "job/approved",
      data: { id: "one", reviewer: "Ada" },
    });
    await fixture.drain();

    expect(job.run?.status).toBe("running");
  });

  it("retains correlated cancellation indexes across a Program restart", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          cancelOn: [{ event: "job/approved", match: "data.id" }],
        },
        async ({ event, step }) => {
          await step.waitForEvent("never", { event: "job/completed", timeout: "1 day" });
          return { value: event.data.id, reviewer: "completed" };
        },
      );
    });

    await fixture.api.send([
      { id: "start-one", name: "job/started", data: { id: "one" } },
      { id: "start-two", name: "job/started", data: { id: "two" } },
    ]);
    const one = fixture.api.getFunction("job", "start-one:job");
    const two = fixture.api.getFunction("job", "start-two:job");
    await poll(
      () =>
        one.details?.operations.never?.status === "scheduled" &&
        two.details?.operations.never?.status === "scheduled",
    );
    await fixture.restart();
    await fixture.api.send({
      id: "approve-two",
      name: "job/approved",
      data: { id: "two", reviewer: "Ada" },
    });
    await fixture.drain();

    expect(one.run?.status).toBe("running");
    expect(two.run).toMatchObject({
      status: "cancelled",
      error: "cancelled_by:job/approved",
    });
  });

  it("times out a child invocation without cancelling the child", async () => {
    const clock = new VirtualClock();
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        const child = createFunction({ id: "child" }, async ({ event, step }) => {
          await step.waitForEvent("continue", {
            event: "job/completed",
            timeout: "1 day",
          });
          return { value: event.data.value };
        });
        createFunction(
          { id: "job", triggers: { event: "job/started" } },
          async ({ event, step }) => {
            const result = await step.invoke("child", {
              function: child,
              data: { value: event.data.id },
              timeout: "1 second",
            });
            return { value: result.value, reviewer: "child" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "start-1", name: "job/started", data: { id: "one" } });
    const parent = fixture.api.getFunction("job", "start-1:job");
    const child = fixture.api.getFunction("child", "start-1:job:child");
    await poll(() => parent.details?.operations.child?.status === "scheduled");
    await fixture.drain();
    expect(parent.run?.status).toBe("running");
    expect(child.run?.status).toBe("running");
    await poll(() => clock.sleepers.length === 1);

    clock.advance(1_000);
    await fixture.drain();

    expect(parent.details).toMatchObject({
      status: "failed",
      error: { name: "Error", message: "timeout", stepId: "child" },
      operations: { child: { status: "failed", error: "timeout" } },
    });
    expect(child.run?.status).toBe("running");
  });

  it("applies the invoked function's run-admission policy", async () => {
    const clock = new VirtualClock();
    const children: string[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        const child = createFunction(
          { id: "child", throttle: { limit: 1, period: "1 second" } },
          async ({ event }) => {
            children.push(event.data.value);
            return { value: event.data.value };
          },
        );
        createFunction(
          { id: "job", triggers: { event: "job/started" } },
          async ({ event, step }) => {
            const [first, second] = await Promise.all([
              step.invoke("first", { function: child, data: { value: `${event.data.id}:first` } }),
              step.invoke("second", {
                function: child,
                data: { value: `${event.data.id}:second` },
              }),
            ]);
            return { value: `${first.value}:${second.value}`, reviewer: "children" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "invoke", name: "job/started", data: { id: "job" } });
    await poll(() => children.length === 1 && clock.sleepers.some(({ at }) => at === 1_000));
    expect(fixture.api.getFunction("job", "invoke:job").run?.status).toBe("running");

    clock.advance(1_000);
    await fixture.drain();

    expect(children).toEqual(["job:first", "job:second"]);
    expect(fixture.api.getFunction("job", "invoke:job").run).toMatchObject({
      status: "completed",
      output: { value: "job:first:job:second", reviewer: "children" },
    });
  });

  it("fails an invocation durably when the target admission policy skips it", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      const child = createFunction(
        { id: "child", rateLimit: { limit: 1, period: "1 minute" } },
        async ({ event }) => ({ value: event.data.value }),
      );
      createFunction({ id: "job", triggers: { event: "job/started" } }, async ({ event, step }) => {
        await step.invoke("first", { function: child, data: { value: `${event.data.id}:first` } });
        await step.invoke("second", {
          function: child,
          data: { value: `${event.data.id}:second` },
        });
        return { value: event.data.id, reviewer: "unreachable" };
      });
    });

    await fixture.api.send({ id: "limited", name: "job/started", data: { id: "job" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "limited:job").details).toMatchObject({
      status: "failed",
      operations: {
        first: { status: "succeeded" },
        second: {
          status: "failed",
          error: {
            name: "FunctionSkippedError",
            reason: "rate_limit",
          },
        },
      },
    });
  });

  it("cancels a function at its durable finish deadline", async () => {
    const clock = new VirtualClock();
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            timeouts: { finish: "1 second" },
          },
          async ({ event, step }) => {
            await step.waitForEvent("never", { event: "job/completed", timeout: "1 day" });
            return { value: event.data.id, reviewer: "completed" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "start-1", name: "job/started", data: { id: "one" } });
    const job = fixture.api.getFunction("job", "start-1:job");
    await poll(() => clock.sleepers[0]?.at === 1_000);
    expect(job.run?.status).toBe("running");

    clock.advance(1_000);
    await fixture.drain();

    expect(job.details).toMatchObject({
      status: "cancelled",
      error: "finish_timeout",
      operations: { never: { status: "cancelled" } },
    });
  });

  it("returns the exact event that satisfies a wait", async () => {
    let approval: unknown;
    let entries = 0;
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction({ id: "job", triggers: { event: "job/started" } }, async ({ event, step }) => {
        entries += 1;
        approval = await step.waitForEvent("approval", {
          event: "job/approved",
          if: 'event.data.id == async.data.id && event.data.reviewer == "Ada"',
        });
        return {
          value: event.data.id,
          reviewer: approval && typeof approval === "object" ? "received" : "missing",
        };
      });
    });

    await fixture.api.send({ id: "start-1", name: "job/started", data: { id: "one" } });
    const job = fixture.api.getFunction("job", "start-1:job");
    await poll(() => job.details?.operations.approval?.status === "scheduled");
    await fixture.api.send({
      id: "approval-skipped",
      name: "job/approved",
      data: { id: "one", reviewer: "Grace" },
    });
    await fixture.api.send({
      id: "approval-2",
      name: "job/approved",
      data: { id: "one", reviewer: "Ada" },
      ts: 789,
    });
    await fixture.drain();

    expect(approval).toEqual({
      id: "approval-2",
      name: "job/approved",
      data: { id: "one", reviewer: "Ada" },
      ts: 789,
    });
    expect(entries).toBe(1);
  });

  it("validates a waited event with Standard Schema after restart", async () => {
    const schema = {
      "~standard": {
        validate(value: unknown) {
          if (
            value &&
            typeof value === "object" &&
            "reviewer" in value &&
            typeof value.reviewer === "string"
          ) {
            return { value: value as { id: string; reviewer: string } };
          }
          return { issues: [{ message: "must be a string", path: ["reviewer"] }] };
        },
      },
    } satisfies FunctionSchema<{ id: string; reviewer: string }>;
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/started" }, retries: 0 },
        async ({ event, step }) => {
          const approval = await step.waitForEvent("approval", {
            event: "job/approved",
            schema,
          });
          return {
            value: event.data.id,
            reviewer: approval?.data.reviewer ?? "missing",
          };
        },
      );
    });

    await fixture.api.send({ id: "start-schema", name: "job/started", data: { id: "one" } });
    const job = fixture.api.getFunction("job", "start-schema:job");
    await poll(() => job.details?.operations.approval?.status === "scheduled");
    await fixture.restart();
    await fixture.api.send({
      id: "invalid-approval",
      name: "job/approved",
      data: { id: "one", reviewer: 42 },
    } as never);
    await fixture.drain();

    expect(job.run).toMatchObject({
      status: "failed",
      error: {
        name: "FunctionEventValidationError",
        message: 'Event "job/approved" failed validation: reviewer: must be a string',
      },
    });
  });

  it("routes parallel same-name events to their exact matching waits", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction({ id: "job", triggers: { event: "job/started" } }, async ({ event, step }) => {
        const [ada, grace] = await Promise.all([
          step.waitForEvent("ada", {
            event: "job/approved",
            if: 'event.data.id == async.data.id && event.data.reviewer == "Ada"',
          }),
          step.waitForEvent("grace", {
            event: "job/approved",
            if: 'event.data.id == async.data.id && event.data.reviewer == "Grace"',
          }),
        ]);
        return {
          value: event.data.id,
          reviewer: `${ada?.data.reviewer}:${grace?.data.reviewer}`,
        };
      });
    });

    await fixture.api.send({ id: "start-1", name: "job/started", data: { id: "one" } });
    const job = fixture.api.getFunction("job", "start-1:job");
    await poll(
      () =>
        job.details?.operations.ada?.status === "scheduled" &&
        job.details.operations.grace?.status === "scheduled",
    );

    await fixture.api.send({
      id: "ada",
      name: "job/approved",
      data: { id: "one", reviewer: "Ada" },
    });
    await fixture.drain();
    expect(job.details).toMatchObject({
      status: "running",
      operations: { ada: { status: "succeeded" }, grace: { status: "scheduled" } },
    });

    await fixture.api.send({
      id: "grace",
      name: "job/approved",
      data: { id: "one", reviewer: "Grace" },
    });
    await fixture.drain();
    expect(job.run).toMatchObject({
      status: "completed",
      output: { value: "one", reviewer: "Ada:Grace" },
    });
  });

  it("settles a parallel race and cancels its losing durable operations", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/started" } },
        async ({ event, group, step }) => {
          const winner = await group.parallel({ mode: "race" }, () =>
            Promise.race([
              step.run("slow", () => new Promise<string>(() => {})),
              step.run("fast", () => "fast"),
            ]),
          );
          return { value: `${event.data.id}:${winner}`, reviewer: "race" };
        },
      );
    });

    await fixture.api.send({ id: "race", name: "job/started", data: { id: "job" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "race:job").details).toMatchObject({
      status: "completed",
      output: { value: "job:fast", reviewer: "race" },
      operations: {
        fast: { status: "succeeded", race: "$race:0" },
        slow: { status: "cancelled", race: "$race:0" },
      },
    });
  });

  it("applies direct parallelMode race semantics to one declaration turn", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction({ id: "job", triggers: { event: "job/started" } }, async ({ event, step }) => {
        const winner = await Promise.race([
          step.sleep({ id: "slow", parallelMode: "race" }, "1 hour").then(() => "slow"),
          step.run({ id: "fast", parallelMode: "race" }, () => "fast"),
        ]);
        const outside = await step.run("outside", () => "outside");
        return { value: `${event.data.id}:${winner}`, reviewer: outside };
      });
    });

    await fixture.api.send({ id: "direct-race", name: "job/started", data: { id: "job" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "direct-race:job").details).toMatchObject({
      status: "completed",
      output: { value: "job:fast", reviewer: "outside" },
      races: { "$race:0": { winner: "fast", settled: true } },
      operations: {
        fast: { status: "succeeded", race: "$race:0" },
        slow: { status: "cancelled", race: "$race:0" },
        outside: { status: "succeeded" },
      },
    });
  });

  it("preserves durable timers outside a settled parallel race", async () => {
    const clock = new VirtualClock();
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" } },
          async ({ event, group, step }) => {
            const outside = step.sleep("outside", "1 second");
            const winner = await group.parallel(() =>
              Promise.race([
                step.sleep("slow", "1 hour").then(() => "slow"),
                step.run("fast", () => "fast"),
              ]),
            );
            await outside;
            return { value: `${event.data.id}:${winner}`, reviewer: "timer" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "race-timer", name: "job/started", data: { id: "job" } });
    const job = fixture.api.getFunction("job", "race-timer:job");
    await poll(
      () =>
        job.details?.operations.fast?.status === "succeeded" &&
        job.details.operations.slow?.status === "cancelled" &&
        job.details.operations.outside?.status === "scheduled",
    );
    expect(clock.sleepers.some(({ at }) => at === 1_000)).toBe(true);

    clock.advance(1_000);
    await fixture.drain();

    expect(job.details).toMatchObject({
      status: "completed",
      output: { value: "job:fast", reviewer: "timer" },
      operations: {
        fast: { status: "succeeded", race: "$race:0" },
        slow: { status: "cancelled", race: "$race:0" },
        outside: { status: "succeeded" },
      },
    });
  });

  it("settles a rejected parallel race and cancels its losing operation", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/started" }, retries: 0 },
        async ({ event, group, step }) => {
          try {
            await group.parallel(() =>
              Promise.race([
                step.run("failure", () => {
                  throw new Error("race failed");
                }),
                step.sleep("slow", "1 hour"),
              ]),
            );
          } catch {
            return { value: event.data.id, reviewer: "caught" };
          }
          return { value: event.data.id, reviewer: "unexpected" };
        },
      );
    });

    await fixture.api.send({ id: "race-failure", name: "job/started", data: { id: "job" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "race-failure:job").details).toMatchObject({
      status: "completed",
      output: { value: "job", reviewer: "caught" },
      operations: {
        failure: { status: "failed", race: "$race:0" },
        slow: { status: "cancelled", race: "$race:0" },
      },
    });
  });

  it("replays a parallel event race with stable identity after restart", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/started" } },
        async ({ event, group, step }) => {
          const winner = await group.parallel(() =>
            Promise.race([
              step.waitForEvent("ada", {
                event: "job/approved",
                if: 'event.data.id == async.data.id && event.data.reviewer == "Ada"',
              }),
              step.waitForEvent("grace", {
                event: "job/approved",
                if: 'event.data.id == async.data.id && event.data.reviewer == "Grace"',
              }),
            ]),
          );
          return {
            value: event.data.id,
            reviewer: winner?.data.reviewer ?? "missing",
          };
        },
      );
    });

    await fixture.api.send({ id: "race-restart", name: "job/started", data: { id: "job" } });
    const job = fixture.api.getFunction("job", "race-restart:job");
    await poll(
      () =>
        job.details?.operations.ada?.status === "scheduled" &&
        job.details.operations.grace?.status === "scheduled",
    );
    await fixture.restart();
    await fixture.api.send({
      id: "race-winner",
      name: "job/approved",
      data: { id: "job", reviewer: "Ada" },
    });
    await fixture.drain();

    expect(job.details).toMatchObject({
      status: "completed",
      output: { value: "job", reviewer: "Ada" },
      operations: {
        ada: { status: "succeeded", race: "$race:0" },
        grace: { status: "cancelled", race: "$race:0" },
      },
    });
  });

  it("isolates an asynchronous parallel scope from overlapping outside steps", async () => {
    const release = Promise.withResolvers<void>();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/started" } },
        async ({ event, group, step }) => {
          const grouped = group.parallel(async () => {
            await release.promise;
            return step.run("inside", () => "inside");
          });
          const outside = step.run("outside", () => {
            release.resolve();
            return "outside";
          });
          const [inside, outsideResult] = await Promise.all([grouped, outside]);
          return {
            value: `${event.data.id}:${inside}`,
            reviewer: outsideResult,
          };
        },
      );
    });

    await fixture.api.send({ id: "race-scope", name: "job/started", data: { id: "job" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "race-scope:job").details).toMatchObject({
      status: "completed",
      output: { value: "job:inside", reviewer: "outside" },
      operations: {
        inside: { status: "succeeded", race: "$race:0" },
        outside: { status: "succeeded" },
      },
    });
  });

  it("commits exactly one durable winner when race effects finish together", async () => {
    const completions = new Map<string, ReturnType<typeof Promise.withResolvers<string>>>();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/started" } },
        async ({ event, group, step }) => {
          const winner = await group.parallel(() =>
            Promise.race(
              (["a", "b"] as const).map((name) =>
                step.run(name, () => {
                  const completion = Promise.withResolvers<string>();
                  completions.set(`${event.data.id}:${name}`, completion);
                  return completion.promise;
                }),
              ),
            ),
          );
          return { value: `${event.data.id}:${winner}`, reviewer: "atomic" };
        },
      );
    });

    for (let index = 0; index < 20; index += 1) {
      const id = `atomic-${index}`;
      await fixture.api.send({ id, name: "job/started", data: { id } });
      await poll(() => completions.has(`${id}:a`) && completions.has(`${id}:b`));
      const first = index % 2 === 0 ? "a" : "b";
      const second = first === "a" ? "b" : "a";
      completions.get(`${id}:${first}`)?.resolve(first);
      completions.get(`${id}:${second}`)?.resolve(second);
      await fixture.drain();

      const run = fixture.api.getFunction("job", `${id}:job`).details;
      const terminal = Object.values(run?.operations ?? {}).filter(
        ({ status }) => status === "succeeded" || status === "failed",
      );
      expect(terminal).toHaveLength(1);
      expect(run).toMatchObject({
        status: "completed",
        output: { value: `${id}:${terminal[0]?.id}`, reviewer: "atomic" },
      });
    }
  });

  it("cancels an active invoked function when it loses a parallel race", async () => {
    const fast = Promise.withResolvers<string>();
    let childEntered = false;
    const fixture = await createFunctionFixture(({ createFunction }) => {
      const child = createFunction({ id: "child" }, async ({ event, step }) => {
        await step.run("child-work", () => {
          childEntered = true;
          return new Promise<string>(() => {});
        });
        return { value: event.data.value };
      });
      createFunction(
        { id: "job", triggers: { event: "job/started" } },
        async ({ event, group, step }) => {
          const winner = await group.parallel(() =>
            Promise.race([
              step.invoke("invoke-child", {
                function: child,
                data: { value: event.data.id },
              }),
              step.run("fast", () => fast.promise),
            ]),
          );
          return {
            value: typeof winner === "string" ? winner : winner.value,
            reviewer: "child-race",
          };
        },
      );
    });

    await fixture.api.send({ id: "invoke-race", name: "job/started", data: { id: "job" } });
    await poll(() => childEntered);
    fast.resolve("fast");
    await fixture.drain();

    expect(fixture.api.getFunction("job", "invoke-race:job").details).toMatchObject({
      status: "completed",
      output: { value: "fast", reviewer: "child-race" },
      operations: {
        fast: { status: "succeeded", race: "$race:0" },
        "invoke-child": { status: "cancelled", race: "$race:0" },
      },
    });
    expect(fixture.api.getFunction("child", "invoke-race:job:invoke-child").details).toMatchObject({
      status: "cancelled",
      operations: { "child-work": { status: "cancelled" } },
    });
  });

  it("rejects race topology drift during recovery", async () => {
    let grouped = false;
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/started" }, retries: 0 },
        async ({ event, group, step }) => {
          if (grouped) {
            await group.parallel(() => step.run("stable", () => new Promise<string>(() => {})));
          } else {
            await step.run("stable", () => new Promise<string>(() => {}));
          }
          return { value: event.data.id, reviewer: "stable" };
        },
      );
    });

    await fixture.api.send({ id: "topology", name: "job/started", data: { id: "job" } });
    const job = fixture.api.getFunction("job", "topology:job");
    await poll(() => job.details?.operations.stable?.status === "running");
    grouped = true;
    await fixture.restart();
    await fixture.drain();

    expect(job.run).toMatchObject({
      status: "failed",
      error: {
        name: "TypeError",
        message: expect.stringContaining("changed from effect/unscoped to effect/$race:0"),
      },
    });
  });

  it("rejects recovery that silently omits a previously durable operation", async () => {
    const clock = new VirtualClock();
    let includeStable = true;
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" }, retries: 0 },
          async ({ event, step }) => {
            if (includeStable) await step.run("stable", () => "persisted");
            await step.sleep("pause", "1 second");
            return { value: event.data.id, reviewer: "complete" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "omitted", name: "job/started", data: { id: "job" } });
    await poll(
      () =>
        fixture.api.getFunction("job", "omitted:job").details?.operations.pause?.status ===
        "scheduled",
    );
    includeStable = false;
    await fixture.restart();
    clock.advance(1_000);
    await fixture.drain();

    expect(fixture.api.getFunction("job", "omitted:job").run).toMatchObject({
      status: "failed",
      error: {
        name: "TypeError",
        message: 'Workflow recovery completed without replaying operations ["stable"].',
      },
    });
  });

  it("allows recovery to append new durable work after replaying the old graph", async () => {
    const clock = new VirtualClock();
    let includeTail = false;
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" }, retries: 0 },
          async ({ event, step }) => {
            await step.run("stable", () => "persisted");
            await step.sleep("pause", "1 second");
            const tail = includeTail ? await step.run("tail", () => "added") : "absent";
            return { value: event.data.id, reviewer: tail };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "extended", name: "job/started", data: { id: "job" } });
    await poll(
      () =>
        fixture.api.getFunction("job", "extended:job").details?.operations.pause?.status ===
        "scheduled",
    );
    includeTail = true;
    await fixture.restart();
    clock.advance(1_000);
    await fixture.drain();

    expect(fixture.api.getFunction("job", "extended:job").run).toMatchObject({
      status: "completed",
      output: { value: "job", reviewer: "added" },
    });
    expect(fixture.api.getFunction("job", "extended:job").details?.operations.tail).toMatchObject({
      status: "succeeded",
      result: "added",
    });
  });

  it("admits queued runs by concurrency and priority, then releases the lease", async () => {
    const entered: string[] = [];
    const completions = new Map<
      string,
      { promise: Promise<null>; resolve(value: null): void; reject(reason?: unknown): void }
    >();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          concurrency: 1,
          priority: { run: 'event.data.id == "high" ? 100 : 0' },
        },
        async ({ event, step }) => {
          await step.run("complete", () => {
            entered.push(event.data.id);
            const completion = Promise.withResolvers<null>();
            completions.set(event.data.id, completion);
            return completion.promise;
          });
          return { value: event.data.id, reviewer: "complete" };
        },
      );
    });

    await fixture.api.send([
      { id: "first", name: "job/started", data: { id: "first" } },
      { id: "low", name: "job/started", data: { id: "low" } },
      { id: "high", name: "job/started", data: { id: "high" } },
    ]);
    await poll(() => entered.length === 1);
    expect(entered).toEqual(["first"]);
    expect(fixture.api.getFunction("job", "low:job").run?.status).toBe("running");
    expect(fixture.api.getFunction("job", "high:job").run?.status).toBe("running");

    completions.get("first")?.resolve(null);
    await poll(() => entered.length === 2);
    expect(entered).toEqual(["first", "high"]);

    completions.get("high")?.resolve(null);
    await poll(() => entered.length === 3);
    completions.get("low")?.resolve(null);
    await fixture.drain();
    expect(entered).toEqual(["first", "high", "low"]);
  });

  it("ages queued work so the full priority range cannot starve it forever", async () => {
    const clock = new VirtualClock();
    const entered: string[] = [];
    const completions = new Map<string, ReturnType<typeof Promise.withResolvers<null>>>();
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            concurrency: 1,
            priority: {
              run: 'event.data.id == "low" ? -600 : event.data.id == "high" ? 600 : 0',
            },
          },
          async ({ event, step }) => {
            await step.run("complete", () => {
              entered.push(event.data.id);
              const completion = Promise.withResolvers<null>();
              completions.set(event.data.id, completion);
              return completion.promise;
            });
            return { value: event.data.id, reviewer: "complete" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "first", name: "job/started", data: { id: "first" } });
    await poll(() => entered.length === 1);
    await fixture.api.send({ id: "low", name: "job/started", data: { id: "low" } });
    clock.advance(1_200_001);
    await fixture.api.send({ id: "high", name: "job/started", data: { id: "high" } });

    completions.get("first")?.resolve(null);
    await poll(() => entered.length === 2);
    expect(entered).toEqual(["first", "low"]);
    completions.get("low")?.resolve(null);
    await poll(() => entered.length === 3);
    completions.get("high")?.resolve(null);
    await fixture.drain();
    expect(entered).toEqual(["first", "low", "high"]);
  });

  it("does not let a saturated concurrency key block an independent key", async () => {
    const entered: string[] = [];
    const completions = new Map<string, ReturnType<typeof Promise.withResolvers<null>>>();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          concurrency: { limit: 1, key: "event.data.id" },
        },
        async ({ event, step }) => {
          await step.run("complete", () => {
            entered.push(event.id);
            const completion = Promise.withResolvers<null>();
            completions.set(event.id, completion);
            return completion.promise;
          });
          return { value: event.data.id, reviewer: "complete" };
        },
      );
    });

    await fixture.api.send([
      { id: "a-1", name: "job/started", data: { id: "a" } },
      { id: "a-2", name: "job/started", data: { id: "a" } },
      { id: "b-1", name: "job/started", data: { id: "b" } },
    ]);
    await poll(() => entered.length === 2);
    expect(entered).toEqual(["a-1", "b-1"]);

    completions.get("a-1")?.resolve(null);
    await poll(() => entered.length === 3);
    expect(entered).toEqual(["a-1", "b-1", "a-2"]);
    completions.get("a-2")?.resolve(null);
    completions.get("b-1")?.resolve(null);
    await fixture.drain();
  });

  it("requires every concurrency constraint before admitting a run", async () => {
    const entered: string[] = [];
    const completions = new Map<string, ReturnType<typeof Promise.withResolvers<null>>>();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          concurrency: [{ limit: 2 }, { limit: 1, key: "event.data.id" }],
        },
        async ({ event, step }) => {
          await step.run("complete", () => {
            entered.push(event.id);
            const completion = Promise.withResolvers<null>();
            completions.set(event.id, completion);
            return completion.promise;
          });
          return { value: event.data.id, reviewer: "complete" };
        },
      );
    });

    await fixture.api.send([
      { id: "a-1", name: "job/started", data: { id: "a" } },
      { id: "a-2", name: "job/started", data: { id: "a" } },
      { id: "b-1", name: "job/started", data: { id: "b" } },
      { id: "c-1", name: "job/started", data: { id: "c" } },
    ]);
    await poll(() => entered.length === 2);
    expect(entered).toEqual(["a-1", "b-1"]);

    completions.get("b-1")?.resolve(null);
    await poll(() => entered.length === 3);
    expect(entered).toEqual(["a-1", "b-1", "c-1"]);
    completions.get("a-1")?.resolve(null);
    await poll(() => entered.length === 4);
    completions.get("a-2")?.resolve(null);
    completions.get("c-1")?.resolve(null);
    await fixture.drain();
    expect(entered).toEqual(["a-1", "b-1", "c-1", "a-2"]);
  });

  it("does not hold function concurrency while a run sleeps", async () => {
    const clock = new VirtualClock();
    const entered: string[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            concurrency: 1,
          },
          async ({ event, step }) => {
            if (event.data.id === "sleeping") {
              await step.sleep("pause", "1 second");
            } else {
              await step.run("work", () => {
                entered.push(event.data.id);
                return null;
              });
            }
            return { value: event.data.id, reviewer: "complete" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send([
      { id: "sleeping", name: "job/started", data: { id: "sleeping" } },
      { id: "working", name: "job/started", data: { id: "working" } },
    ]);
    await poll(() => entered.length === 1 && clock.sleepers.some(({ at }) => at === 1_000));

    expect(entered).toEqual(["working"]);
    expect(fixture.api.getFunction("job", "sleeping:job").run?.status).toBe("running");
    clock.advance(1_000);
    await fixture.drain();
  });

  it("applies function concurrency independently to parallel steps in one run", async () => {
    let active = 0;
    let maximum = 0;
    const entered: string[] = [];
    const completions = new Map<string, ReturnType<typeof Promise.withResolvers<null>>>();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          concurrency: 1,
        },
        async ({ event, step }) => {
          const execute = (id: string) =>
            step.run(id, async () => {
              active += 1;
              maximum = Math.max(maximum, active);
              entered.push(id);
              const completion = Promise.withResolvers<null>();
              completions.set(id, completion);
              try {
                return await completion.promise;
              } finally {
                active -= 1;
              }
            });
          await Promise.all([execute("first"), execute("second")]);
          return { value: event.data.id, reviewer: "complete" };
        },
      );
    });

    await fixture.api.send({ id: "parallel", name: "job/started", data: { id: "parallel" } });
    await poll(() => entered.length === 1);
    expect(maximum).toBe(1);
    completions.get(entered[0]!)?.resolve(null);
    await poll(() => entered.length === 2);
    expect(maximum).toBe(1);
    completions.get(entered[1]!)?.resolve(null);
    await fixture.drain();
    expect(fixture.api.getFunction("job", "parallel:job").run?.status).toBe("completed");
  });

  it("releases a queue of hundreds of parallel execution segments", async () => {
    const count = 300;
    let handlerEntries = 0;
    let active = 0;
    let maximum = 0;
    const completed = new Set<number>();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          concurrency: 16,
        },
        async ({ event, step }) => {
          handlerEntries += 1;
          await Promise.all(
            Array.from({ length: count }, (_, index) =>
              step.run(`segment-${index}`, async () => {
                active += 1;
                maximum = Math.max(maximum, active);
                await Promise.resolve();
                completed.add(index);
                active -= 1;
                return index;
              }),
            ),
          );
          return { value: event.data.id, reviewer: "complete" };
        },
      );
    });

    await fixture.api.send({ id: "segments", name: "job/started", data: { id: "segments" } });
    await fixture.drain();

    expect(completed.size).toBe(count);
    expect(handlerEntries).toBe(1);
    expect(maximum).toBeLessThanOrEqual(16);
    expect(fixture.api.getFunction("job", "segments:job").run?.status).toBe("completed");
  });

  it("recovers queued and uncertain execution leases after a Program restart", async () => {
    const entered: string[] = [];
    const completions = new Map<string, ReturnType<typeof Promise.withResolvers<null>>>();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          concurrency: 1,
        },
        async ({ event, step }) => {
          await step.run("work", () => {
            entered.push(event.id);
            const completion = Promise.withResolvers<null>();
            completions.set(event.id, completion);
            return completion.promise;
          });
          return { value: event.data.id, reviewer: "complete" };
        },
      );
    });

    await fixture.api.send([
      { id: "first", name: "job/started", data: { id: "first" } },
      { id: "second", name: "job/started", data: { id: "second" } },
    ]);
    await poll(() => entered.length === 1);
    const first = entered[0]!;

    const restarting = fixture.restart();
    await poll(() => entered.length === 2);
    expect(entered).toEqual([first, first]);

    completions.get(first)?.resolve(null);
    await poll(() => entered.some((id) => id !== first));
    const second = entered.find((id) => id !== first)!;
    completions.get(second)?.resolve(null);
    await restarting;

    expect(new Set([first, second])).toEqual(new Set(["first", "second"]));
    expect(fixture.api.getFunction("job", "first:job").run?.status).toBe("completed");
    expect(fixture.api.getFunction("job", "second:job").run?.status).toBe("completed");
  });

  it("batches matching events and bypasses ineligible events", async () => {
    const seen: Array<{ readonly event: string; readonly events: readonly string[] }> = [];
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          batchEvents: {
            maxSize: 2,
            timeout: "1 second",
            key: "event.data.id",
            if: 'event.data.id != "immediate"',
          },
        },
        async ({ event, events }) => {
          seen.push({ event: event.id, events: events.map(({ id }) => id) });
          return { value: event.data.id, reviewer: "batched" };
        },
      );
    });

    await fixture.api.send({
      id: "immediate",
      name: "job/started",
      data: { id: "immediate" },
    });
    await fixture.api.send([
      { id: "batch-a", name: "job/started", data: { id: "group" } },
      { id: "batch-b", name: "job/started", data: { id: "group" } },
    ]);
    await fixture.drain();

    expect(seen).toEqual([
      { event: "immediate", events: ["immediate"] },
      { event: "batch-a", events: ["batch-a", "batch-b"] },
    ]);
    expect(fixture.api.getFunction("job", "batch-a:job:batch").run?.status).toBe("completed");
  });

  it("flushes an incomplete batch at its durable timeout", async () => {
    const clock = new VirtualClock();
    const seen: string[][] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            batchEvents: { maxSize: 3, timeout: "1 second", key: '"shared"' },
          },
          async ({ event, events }) => {
            seen.push(events.map(({ id }) => id));
            return { value: event.data.id, reviewer: "batched" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send([
      { id: "one", name: "job/started", data: { id: "one" } },
      { id: "two", name: "job/started", data: { id: "two" } },
    ]);
    await fixture.drain();
    expect(seen).toEqual([]);
    await fixture.restart();
    expect(seen).toEqual([]);
    await poll(() => clock.sleepers.some(({ at }) => at === 1_000));
    clock.advance(1_000);
    await fixture.drain();
    expect(seen).toEqual([["one", "two"]]);
  });

  it("debounces to the latest event and survives a Program restart", async () => {
    const clock = new VirtualClock();
    const seen: string[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            debounce: { key: '"shared"', period: "1 second", timeout: "3 seconds" },
          },
          async ({ event }) => {
            seen.push(event.data.id);
            return { value: event.data.id, reviewer: "debounced" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "one", name: "job/started", data: { id: "one" } });
    clock.advance(500);
    await fixture.api.send({ id: "two", name: "job/started", data: { id: "two" } });
    await fixture.restart();
    expect(seen).toEqual([]);
    await poll(() => clock.sleepers.some(({ at }) => at === 1_500));
    clock.advance(1_000);
    await fixture.drain();

    expect(seen).toEqual(["two"]);
    expect(fixture.api.getFunction("job", "one:job:debounce").run).toMatchObject({
      status: "completed",
      output: { value: "two", reviewer: "debounced" },
    });
  });

  it("caps repeated debounce replacement at its maximum timeout", async () => {
    const clock = new VirtualClock();
    const seen: string[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            debounce: { key: '"shared"', period: "1 second", timeout: "2 seconds" },
          },
          async ({ event }) => {
            seen.push(event.data.id);
            return { value: event.data.id, reviewer: "debounced" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send({ id: "one", name: "job/started", data: { id: "one" } });
    await fixture.drain();
    await poll(() => clock.sleepers.some(({ at }) => at === 1_000));
    clock.advance(800);
    await fixture.api.send({ id: "two", name: "job/started", data: { id: "two" } });
    await fixture.drain();
    await poll(() => clock.sleepers.some(({ at }) => at === 1_800));
    clock.advance(800);
    await fixture.api.send({ id: "three", name: "job/started", data: { id: "three" } });
    await fixture.drain();
    expect(seen).toEqual([]);
    await poll(() => clock.sleepers.some(({ at }) => at === 2_000));

    clock.advance(400);
    await fixture.drain();
    expect(seen).toEqual(["three"]);
  });

  it("applies idempotency and lossy rate limits before creating runs", async () => {
    const seen: string[] = [];
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          idempotency: "event.data.id",
          rateLimit: { limit: 1, period: "1 hour" },
        },
        async ({ event }) => {
          seen.push(event.id);
          return { value: event.data.id, reviewer: "accepted" };
        },
      );
    });

    await fixture.api.send([
      { id: "one-a", name: "job/started", data: { id: "one" } },
      { id: "one-b", name: "job/started", data: { id: "one" } },
      { id: "two", name: "job/started", data: { id: "two" } },
    ]);
    await fixture.drain();

    expect(seen).toEqual(["one-a", "two"]);
    expect(fixture.api.getFunction("job", "one-b:job").run).toBeNull();
  });

  it("applies keyed sliding-window rate limits independently", async () => {
    const clock = new VirtualClock();
    const seen: string[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            rateLimit: { key: "event.data.id", limit: 2, period: "1 second" },
          },
          async ({ event }) => {
            seen.push(event.id);
            return { value: event.data.id, reviewer: "accepted" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send([
      { id: "a-1", name: "job/started", data: { id: "a" } },
      { id: "a-2", name: "job/started", data: { id: "a" } },
      { id: "a-3", name: "job/started", data: { id: "a" } },
      { id: "b-1", name: "job/started", data: { id: "b" } },
    ]);
    await fixture.drain();
    expect(seen).toEqual(["a-1", "a-2", "b-1"]);

    clock.advance(1_001);
    await fixture.api.send({ id: "a-4", name: "job/started", data: { id: "a" } });
    await fixture.drain();
    expect(seen).toEqual(["a-1", "a-2", "b-1", "a-4"]);
  });

  it("smooths throttled starts with one durable clock waiter", async () => {
    const clock = new VirtualClock();
    const seen: string[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            throttle: { limit: 2, period: "1 second" },
          },
          async ({ event }) => {
            seen.push(event.data.id);
            return { value: event.data.id, reviewer: "throttled" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send([
      { id: "one", name: "job/started", data: { id: "one" } },
      { id: "two", name: "job/started", data: { id: "two" } },
      { id: "three", name: "job/started", data: { id: "three" } },
    ]);
    await fixture.drain();
    expect(seen).toEqual(["one"]);
    await poll(() => clock.sleepers.length === 1 && clock.sleepers[0]?.at === 500);

    clock.advance(500);
    await fixture.drain();
    expect(seen).toEqual(["one", "two"]);
    await poll(() => clock.sleepers.length === 1 && clock.sleepers[0]?.at === 1_000);

    clock.advance(500);
    await fixture.drain();
    expect(seen).toEqual(["one", "two", "three"]);
  });

  it("uses every recovered throttle token after a delayed wake", async () => {
    const clock = new VirtualClock();
    const seen: string[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            throttle: { limit: 4, period: "1 second", burst: 2 },
          },
          async ({ event }) => {
            seen.push(event.data.id);
            return { value: event.data.id, reviewer: "throttled" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send([
      { id: "one", name: "job/started", data: { id: "one" } },
      { id: "two", name: "job/started", data: { id: "two" } },
      { id: "three", name: "job/started", data: { id: "three" } },
      { id: "four", name: "job/started", data: { id: "four" } },
    ]);
    await fixture.drain();
    expect(seen).toEqual(["one", "two"]);
    await poll(() => clock.sleepers.some(({ at }) => at === 250));

    clock.advance(1_000);
    await fixture.drain();
    expect(seen).toEqual(["one", "two", "three", "four"]);
    expect(clock.sleepers).toHaveLength(0);
  });

  it("records a queued run as cancelled when its start deadline expires", async () => {
    const clock = new VirtualClock();
    const first = Promise.withResolvers<null>();
    const entered: string[] = [];
    const fixture = await createFunctionFixture(
      ({ createFunction }) => {
        createFunction(
          {
            id: "job",
            triggers: { event: "job/started" },
            throttle: { limit: 1, period: "10 seconds" },
            timeouts: { start: "1 second" },
          },
          async ({ event, step }) => {
            entered.push(event.data.id);
            if (event.data.id === "first") await step.run("hold", () => first.promise);
            return { value: event.data.id, reviewer: "started" };
          },
        );
      },
      { clock },
    );

    await fixture.api.send([
      { id: "first", name: "job/started", data: { id: "first" } },
      { id: "expired", name: "job/started", data: { id: "expired" } },
    ]);
    await poll(() => entered.length === 1 && clock.sleepers.some(({ at }) => at === 1_000));
    clock.advance(1_000);
    await poll(() => fixture.api.getFunction("job", "expired:job").run?.status === "cancelled");

    expect(entered).toEqual(["first"]);
    expect(fixture.api.getFunction("job", "expired:job").details).toMatchObject({
      status: "cancelled",
      error: "start_timeout",
      history: [{ transition: { type: "rejected", reason: "start_timeout" } }],
    });
    first.resolve(null);
    await fixture.drain();
  });

  it("replaces a singleton run without overlapping handlers", async () => {
    const entered: string[] = [];
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          singleton: { key: '"shared"', mode: "cancel" },
        },
        async ({ event, step }) => {
          entered.push(event.data.id);
          await step.waitForEvent("complete", {
            event: "job/completed",
            match: "data.id",
          });
          return { value: event.data.id, reviewer: "complete" };
        },
      );
    });

    await fixture.api.send({ id: "one", name: "job/started", data: { id: "one" } });
    await poll(() => entered.length === 1);
    await fixture.api.send({ id: "two", name: "job/started", data: { id: "two" } });
    await fixture.drain();

    expect(fixture.api.getFunction("job", "one:job").run).toMatchObject({
      status: "cancelled",
      error: "singleton_replaced",
    });
    expect(entered).toEqual(["one", "two"]);
  });

  it("skips a singleton replacement without creating a run", async () => {
    const entered: string[] = [];
    const complete = Promise.withResolvers<null>();
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/started" },
          singleton: { key: '"shared"', mode: "skip" },
        },
        async ({ event, step }) => {
          entered.push(event.data.id);
          await step.run("complete", () => complete.promise);
          return { value: event.data.id, reviewer: "complete" };
        },
      );
    });

    await fixture.api.send([
      { id: "one", name: "job/started", data: { id: "one" } },
      { id: "two", name: "job/started", data: { id: "two" } },
    ]);
    await poll(() => entered.length === 1);
    expect(entered).toEqual(["one"]);
    expect(fixture.api.getFunction("job", "two:job").run).toBeNull();

    complete.resolve(null);
    await fixture.drain();
    expect(entered).toEqual(["one"]);
  });

  it("keeps reactive execution projection bounded while retaining explicit details", async () => {
    const count = 1_000;
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction({ id: "job", triggers: { event: "job/started" } }, async ({ event, step }) => {
        let total = 0;
        for (let index = 0; index < count; index += 1) {
          total += await step.run(`operation-${index}`, () => index);
        }
        return { value: `${event.data.id}:${total}`, reviewer: "projection" };
      });
    });

    await fixture.api.send({ id: "bounded", name: "job/started", data: { id: "one" } });
    await fixture.drain();

    const handle = fixture.api.getFunction("job", "bounded:job");
    expect(handle.run).toMatchObject({
      status: "completed",
      output: { value: "one:499500", reviewer: "projection" },
      transitionCount: 3_002,
    });
    expect("operations" in (handle.run ?? {})).toBe(false);
    expect(JSON.stringify(handle.run).length).toBeLessThan(2_048);
    expect(Object.keys(handle.details?.operations ?? {})).toHaveLength(count);
  });

  it("routes cancellation through the bounded execution projection", async () => {
    const fixture = await createFunctionFixture(({ createFunction }) => {
      createFunction({ id: "job", triggers: { event: "job/started" } }, async ({ event, step }) => {
        await step.waitForEvent("release", { event: "job/completed" });
        return { value: event.data.id, reviewer: "released" };
      });
    });

    await fixture.api.send({ id: "cancel", name: "job/started", data: { id: "one" } });
    const handle = fixture.api.getFunction("job", "cancel:job");
    await poll(
      () =>
        handle.run?.status === "running" &&
        handle.details?.operations.release?.status === "scheduled",
    );

    expect(await handle.cancel("user")).toMatchObject({ ok: true });
    await fixture.drain();
    expect(handle.run).toMatchObject({ status: "cancelled", error: "user" });
    expect(handle.details?.operations.release?.status).toBe("cancelled");
    expect(await handle.cancel("again")).toMatchObject({ ok: false, error: "not_running" });
  });

  it("matches the keyed priority reference model for generated traces", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            group: fc.integer({ min: 0, max: 3 }).map(String),
            priority: fc.integer({ min: 0, max: 3 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (input) => {
          const entered = new Map<string, string[]>();
          const completions = new Map<string, ReturnType<typeof Promise.withResolvers<null>>>();
          const feature = createFunctions<AdmissionModelApp, AdmissionModelContract>(
            { dependencies: {} },
            ({ createFunction }) => {
              createFunction(
                {
                  id: "model",
                  triggers: { event: "model/run" },
                  concurrency: { limit: 1, key: "event.data.group" },
                  priority: { run: "event.data.priority" },
                },
                async ({ event, step }) => {
                  await step.run("complete", () => {
                    const group = event.data.group;
                    (entered.get(group) ?? entered.set(group, []).get(group)!).push(event.id);
                    const completion = Promise.withResolvers<null>();
                    completions.set(event.id, completion);
                    return completion.promise;
                  });
                  return { id: event.id };
                },
              );
            },
          );
          const app = defineApp<AdmissionModelApp>({
            version: 1,
            resources: {},
            features: { model: feature },
          });
          const fixture = await testFeature(app, "model", { actor: { id: "model" } });
          try {
            const events = input.map((data, index) => ({
              id: `event-${index}`,
              name: "model/run" as const,
              data,
            }));
            await fixture.api.send(events);
            const groups = [...new Set(input.map(({ group }) => group))].sort();
            await poll(() => groups.every((group) => entered.get(group)?.length === 1));

            for (const group of groups) {
              const expected = events.filter(({ data }) => data.group === group);
              const [first, ...queued] = expected;
              queued.sort(
                (left, right) =>
                  right.data.priority - left.data.priority ||
                  Number(left.id.slice(6)) - Number(right.id.slice(6)),
              );
              const order = first ? [first, ...queued] : queued;
              for (let index = 0; index < order.length; index += 1) {
                const event = order[index]!;
                await poll(() => entered.get(group)?.[index] === event.id);
                completions.get(event.id)?.resolve(null);
                await poll(
                  () =>
                    fixture.api.getFunction("model", `${event.id}:model`).run?.status ===
                    "completed",
                );
              }
              expect(entered.get(group)).toEqual(order.map(({ id }) => id));
            }
            await fixture.drain();
          } finally {
            await fixture.dispose();
          }
        },
      ),
      { numRuns: 20 },
    );
  }, 20_000);
});

async function createFunctionFixture(
  define: DefineFunctions<FunctionTestContract>,
  options: { readonly clock?: WorkflowClock } = {},
) {
  const feature = createFunctions<FunctionTestApp, FunctionTestContract>(
    {
      dependencies: {
        clock: options.clock,
        work: {
          async execute(id) {
            return id;
          },
        },
      },
    },
    define,
  );
  const app = defineApp<FunctionTestApp>({
    version: 1,
    resources: {},
    features: { jobs: feature },
  });
  const fixture = await testFeature(app, "jobs", { actor: { id: "owner" } });
  fixtures.push(fixture);
  return fixture;
}

async function createFixture(options: {
  readonly run: WorkflowDefinition<Workflows, "order">["run"];
  readonly shipment?: WorkflowDefinition<Workflows, "shipment">["run"];
  readonly work: WorkDependency;
  readonly clock?: WorkflowClock;
  readonly replacement?: WorkDependency;
  readonly runtimeVersion?: string;
  readonly programVersion?: string;
  readonly retry?: WorkflowRetry;
  readonly timeoutMs?: number;
}) {
  const runtime = createWorkflowRuntime<WorkflowApp, Workflows>({
    ...(options.runtimeVersion === undefined ? {} : { version: options.runtimeVersion }),
    queries: {
      order: {
        progress(run) {
          return {
            status: run.status,
            completed: Object.values(run.operations).filter(({ status }) => status === "succeeded")
              .length,
          };
        },
      },
    },
  });
  const feature = {
    resources: runtime.resources,
    features: {},
    dependencies: {
      server: { work: options.work, ...(options.clock ? { clock: options.clock } : {}) },
    },
    programs: {
      server: createWorkflowProgram<WorkflowApp, Workflows>({
        ...(options.programVersion === undefined ? {} : { version: options.programVersion }),
        workflows: {
          order: {
            run: options.run,
            ...(options.retry === undefined ? {} : { retry: options.retry }),
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          },
          shipment: {
            run:
              options.shipment ??
              (async (_context, input) => ({ trackingId: `tracking:${input.orderId}` })),
          },
        },
      }),
    },
    api: runtime.api,
    components: {},
  } satisfies FeatureDef<WorkflowApp, WorkflowFeature<Workflows>>;
  const app = defineApp<WorkflowApp>({
    version: 1,
    resources: {},
    features: { workflows: feature },
  });
  const fixture = await testFeature(app, "workflows", {
    actor: { id: "owner" },
    dependencies: options.replacement ? { server: { work: options.replacement } } : undefined,
  });
  fixtures.push(fixture);
  return fixture;
}

describe("workflow Feature", () => {
  it("runs compatible versions and rejects a mismatched Program before user code", async () => {
    let compatibleEntries = 0;
    const compatible = await createFixture({
      runtimeVersion: "release-1",
      programVersion: "release-1",
      work: { execute: async (id) => id },
      async run(_context, input) {
        compatibleEntries += 1;
        return { value: input.id };
      },
    });
    const accepted = compatible.api.getWorkflow("order", "version-compatible");
    await accepted.start({ id: "accepted", approval: false, delayMs: 0 });
    await compatible.drain();
    expect(accepted.run).toMatchObject({
      status: "completed",
      version: "release-1",
      output: { value: "accepted" },
    });
    expect(compatibleEntries).toBe(1);

    let mismatchedEntries = 0;
    const mismatched = await createFixture({
      runtimeVersion: "release-1",
      programVersion: "release-2",
      work: { execute: async (id) => id },
      async run(_context, input) {
        mismatchedEntries += 1;
        return { value: input.id };
      },
    });
    const rejected = mismatched.api.getWorkflow("order", "version-mismatch");
    await rejected.start({ id: "rejected", approval: false, delayMs: 0 });
    await mismatched.drain();
    expect(rejected.run).toMatchObject({
      status: "failed",
      version: "release-1",
      error: {
        name: "WorkflowVersionMismatchError",
        startedVersion: "release-1",
        currentVersion: "release-2",
      },
    });
    expect(mismatchedEntries).toBe(0);
  });

  it("executes a durable effect and exposes typed run queries", async () => {
    const calls: Array<{ id: string; idempotencyKey: string; attempt: number }> = [];
    const fixture = await createFixture({
      work: {
        async execute(id, context) {
          calls.push({ id, ...context });
          return `done:${id}`;
        },
      },
      async run({ perform }, input, { work }) {
        const value = await perform("execute", (context) => work.execute(input.id, context));
        return { value };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-1");

    expect(await order.start({ id: "one", approval: false, delayMs: 0 })).toEqual({
      ok: true,
      cursor: 1,
    });
    await fixture.drain();

    expect(order.run).toMatchObject({ status: "completed", output: { value: "done:one" } });
    expect(order.run?.history.map(({ transition }) => transition.type)).toEqual([
      "started",
      "operationScheduled",
      "operationStarted",
      "operationSucceeded",
      "completed",
    ]);
    expect(order.run?.history.map(({ seq }) => seq)).toEqual([1, 2, 3, 4, 5]);
    expect(order.query("progress", null)).toEqual({ status: "completed", completed: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: "one", attempt: 1 });
    expect(calls[0]?.idempotencyKey).toContain("execute");
    expect(await order.start({ id: "one", approval: false, delayMs: 0 })).toEqual({
      ok: false,
      error: "already_started",
      data: undefined,
    });
  });

  it("continues as new with bounded generation state and fresh effect identities", async () => {
    const keys: string[] = [];
    const fixture = await createFixture({
      work: {
        async execute(id, { idempotencyKey }) {
          keys.push(idempotencyKey);
          return id;
        },
      },
      async run({ continueAsNew, perform }, input, { work }) {
        const value = await perform("generation", (context) => work.execute(input.id, context));
        if (input.delayMs < 3) {
          continueAsNew({ ...input, delayMs: input.delayMs + 1 });
        }
        return { value };
      },
    });
    const order = fixture.api.getWorkflow("order", "continue-as-new");

    await order.start({ id: "order", approval: false, delayMs: 0 });
    await fixture.drain();

    expect(order.run).toMatchObject({
      status: "completed",
      generation: 3,
      input: { id: "order", approval: false, delayMs: 3 },
      output: { value: "order" },
    });
    expect(Object.keys(order.run?.operations ?? {})).toEqual(["generation"]);
    expect(order.run?.history.map(({ transition }) => transition.type)).toEqual([
      "continued",
      "operationScheduled",
      "operationStarted",
      "operationSucceeded",
      "completed",
    ]);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
  });

  it("releases a timed wait as soon as its signal wins", async () => {
    const clock = new VirtualClock();
    const fixture = await createFixture({
      clock,
      work: {
        async execute(id) {
          return id;
        },
      },
      async run({ waitFor }, input) {
        const approval = await waitFor("approval", "approve", { timeoutMs: 1_000 });
        return { value: input.id, reviewerId: approval.reviewerId };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-signal");

    await order.start({ id: "two", approval: true, delayMs: 0 });
    await poll(() => clock.sleepers.length === 1);
    expect(order.run).toMatchObject({ status: "running" });
    expect(order.run?.operations.approval).toMatchObject({ kind: "signal", status: "scheduled" });

    await order.signal("approve", { reviewerId: "reviewer" });
    await fixture.drain();
    expect(clock.sleepers).toHaveLength(0);
    expect(order.run).toMatchObject({
      status: "completed",
      output: { value: "two", reviewerId: "reviewer" },
    });
  });

  it("retries effects with virtual time and one stable idempotency key", async () => {
    const clock = new VirtualClock();
    const keys: string[] = [];
    const fixture = await createFixture({
      clock,
      work: {
        async execute(id, context) {
          keys.push(context.idempotencyKey);
          if (context.attempt === 1) throw new Error("temporary");
          return id;
        },
      },
      async run({ perform }, input, { work }) {
        const value = await perform("retry", (context) => work.execute(input.id, context), {
          retry: { attempts: 2, delayMs: 100 },
        });
        return { value };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-retry");

    await order.start({ id: "three", approval: false, delayMs: 0 });
    await poll(() => clock.sleepers.length === 1);
    expect(order.run?.operations.retry).toMatchObject({ status: "waiting", attempt: 1 });

    clock.advance(100);
    await fixture.drain();
    expect(order.run).toMatchObject({ status: "completed", output: { value: "three" } });
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it("executes parallel branches within one run without merging their order", async () => {
    const started: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fixture = await createFixture({
      work: {
        async execute(id) {
          started.push(id);
          if (id === "first") await first;
          return id;
        },
      },
      async run({ perform }, _input, { work }) {
        const [firstValue, secondValue] = await Promise.all([
          perform("first", (context) => work.execute("first", context)),
          perform("second", (context) => work.execute("second", context)),
        ]);
        return { value: `${firstValue}:${secondValue}` };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-parallel");

    await order.start({ id: "parallel", approval: false, delayMs: 0 });
    await poll(() => started.includes("second"));
    expect(started).toEqual(["first", "second"]);
    expect(order.run).toMatchObject({ status: "running" });

    releaseFirst();
    await fixture.drain();
    expect(order.run).toMatchObject({
      status: "completed",
      output: { value: "first:second" },
    });
  });

  it("fails deterministically when operation identities are duplicated", async () => {
    let calls = 0;
    const fixture = await createFixture({
      work: {
        async execute(id) {
          calls += 1;
          return id;
        },
      },
      async run({ perform }, input, { work }) {
        await Promise.all([
          perform("duplicate", (context) => work.execute(input.id, context)),
          perform("duplicate", (context) => work.execute(input.id, context)),
        ]);
        return { value: input.id };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-duplicate");

    await order.start({ id: "duplicate", approval: false, delayMs: 0 });
    await fixture.drain();

    expect(calls).toBe(0);
    expect(order.run).toMatchObject({
      status: "failed",
      error: {
        name: "TypeError",
        message: 'Workflow operation "duplicate" is declared more than once.',
      },
    });
  });

  it("invokes a typed child as an independently durable run", async () => {
    let parentEntries = 0;
    let childEntries = 0;
    const fixture = await createFixture({
      work: {
        async execute(id) {
          return id;
        },
      },
      async run({ invoke }, input) {
        parentEntries += 1;
        const shipment = await invoke("shipment", "shipment", { orderId: input.id });
        return { value: shipment.trackingId };
      },
      async shipment(_context, input) {
        childEntries += 1;
        return { trackingId: `shipped:${input.orderId}` };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-parent");

    await order.start({ id: "seven", approval: false, delayMs: 0 });
    await fixture.drain();

    expect(order.run).toMatchObject({
      status: "completed",
      output: { value: "shipped:seven" },
      operations: {
        shipment: {
          kind: "workflow",
          runId: "run-parent:shipment",
          status: "succeeded",
        },
      },
    });
    expect(fixture.api.getWorkflow("shipment", "run-parent:shipment").run).toMatchObject({
      status: "completed",
      parent: {
        key: { ownerId: "owner", id: "run-parent" },
        operationId: "shipment",
      },
    });
    expect({ childEntries, parentEntries }).toEqual({ childEntries: 1, parentEntries: 1 });
  });

  it("uses the virtual clock for durable sleep", async () => {
    const clock = new VirtualClock();
    let entries = 0;
    const fixture = await createFixture({
      clock,
      work: {
        async execute(id) {
          return id;
        },
      },
      async run({ sleep }, input) {
        entries += 1;
        await sleep("pause", input.delayMs);
        return { value: input.id };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-sleep");

    await order.start({ id: "four", approval: false, delayMs: 1_000 });
    await poll(() => clock.sleepers.length === 1);
    expect(order.run).toMatchObject({ status: "running" });
    expect(entries).toBe(1);
    await fixture.drain();

    await fixture.restart();
    await poll(() => clock.sleepers.length === 1);
    expect(order.run).toMatchObject({ status: "running" });
    expect(entries).toBe(1);

    clock.advance(1_000);
    await fixture.drain();
    expect(order.run).toMatchObject({ status: "completed", output: { value: "four" } });
    expect(entries).toBe(2);
  });

  it("advances the retained execution clock at durable resume boundaries", async () => {
    const clock = new VirtualClock();
    const observed: number[] = [];
    const fixture = await createFixture({
      clock,
      work: {
        async execute(id) {
          return id;
        },
      },
      async run(context, input) {
        await context.sleep("first", input.delayMs);
        observed.push(context.now);
        await context.sleep("second", input.delayMs);
        return { value: input.id };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-resume-clock");

    await order.start({ id: "clock", approval: false, delayMs: 100 });
    await poll(() => clock.sleepers.some(({ at }) => at === 100));
    clock.advance(100);
    await poll(() => clock.sleepers.some(({ at }) => at === 200));

    expect(observed).toEqual([100]);
    expect(order.run).toMatchObject({
      status: "running",
      operations: { second: { status: "scheduled", wakeAt: 200 } },
    });

    clock.advance(100);
    await fixture.drain();
    expect(order.run).toMatchObject({ status: "completed", output: { value: "clock" } });
  });

  it("parks hundreds of durable sleeps behind one non-occupying clock waiter", async () => {
    const clock = new VirtualClock();
    const fixture = await createFixture({
      clock,
      work: {
        async execute(id) {
          return id;
        },
      },
      async run({ sleep }, input) {
        await sleep("pause", input.delayMs);
        return { value: input.id };
      },
    });
    const runs = Array.from({ length: 300 }, (_, index) =>
      fixture.api.getWorkflow("order", `sleep-${index}`),
    );

    await Promise.all(
      runs.map((run, index) => run.start({ id: String(index), approval: false, delayMs: 60_000 })),
    );
    await fixture.drain();

    expect(clock.sleepers).toHaveLength(1);
    expect(runs.every((run) => run.run?.status === "running")).toBe(true);

    clock.advance(60_000);
    await fixture.drain();
    expect(runs.every((run) => run.run?.status === "completed")).toBe(true);
  });

  it("aborts active effects when a run is cancelled", async () => {
    let started = false;
    let aborted = false;
    const fixture = await createFixture({
      work: {
        execute(_id, { signal }) {
          started = true;
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
      async run({ perform }, input, { work }) {
        const value = await perform("long", (context) => work.execute(input.id, context));
        return { value };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-cancel");

    await order.start({ id: "five", approval: false, delayMs: 0 });
    await poll(() => started);
    await order.cancel("user");
    await fixture.drain();

    expect(aborted).toBe(true);
    expect(order.run).toMatchObject({ status: "cancelled", error: "user" });
  });

  it("replays an uncertain effect after a Program restart", async () => {
    const keys: string[] = [];
    const uncertainAttempts: Array<readonly number[]> = [];
    let attempts = 0;
    const fixture = await createFixture({
      work: {
        execute(id, { idempotencyKey, signal, uncertainAttempts: uncertain }) {
          attempts += 1;
          keys.push(idempotencyKey);
          uncertainAttempts.push(uncertain);
          if (attempts > 1) return Promise.resolve(`recovered:${id}`);
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
      async run({ perform }, input, { work }) {
        const value = await perform("uncertain", (context) => work.execute(input.id, context));
        return { value };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-restart");

    await order.start({ id: "restart", approval: false, delayMs: 0 });
    await poll(() => attempts === 1);
    await fixture.restart();

    expect(attempts).toBe(2);
    expect(new Set(keys).size).toBe(1);
    expect(uncertainAttempts).toEqual([[], [1]]);
    expect(order.run).toMatchObject({
      status: "completed",
      output: { value: "recovered:restart" },
    });
  });

  it("converges successful effects across every Program write barrier", async () => {
    const boundaries = [
      {
        name: "effect schedule and start",
        matches: (boundary: TestFeatureProgramCommandBoundary) =>
          commandContainsTransition(boundary, "operationScheduled"),
      },
      {
        name: "effect settlement",
        matches: (boundary: TestFeatureProgramCommandBoundary) =>
          commandContainsTransition(boundary, "operationSucceeded"),
      },
      {
        name: "terminal settlement",
        matches: (boundary: TestFeatureProgramCommandBoundary) =>
          commandContainsTransition(boundary, "completed"),
      },
    ] as const;

    for (const boundary of boundaries) {
      for (const phase of ["before", "after"] as const) {
        const results = new Map<string, string>();
        const identities: string[] = [];
        let effects = 0;
        const fixture = await createFixture({
          work: {
            async execute(id, { idempotencyKey }) {
              identities.push(idempotencyKey);
              const previous = results.get(idempotencyKey);
              if (previous !== undefined) return previous;
              effects += 1;
              const result = `result:${id}`;
              results.set(idempotencyKey, result);
              return result;
            },
          },
          async run({ perform }, input, { work }) {
            const value = await perform("work", (context) => work.execute(input.id, context));
            return { value };
          },
        });
        const observed: Array<{ command: string; args: readonly unknown[] }> = [];
        fixture.interruptNextProgramCommand({
          phase,
          when(candidate) {
            observed.push({ command: candidate.command, args: candidate.args });
            return boundary.matches(candidate);
          },
        });
        const order = fixture.api.getWorkflow("order", `${boundary.name}:${phase}`);

        await order.start({ id: `${boundary.name}:${phase}`, approval: false, delayMs: 0 });
        const interruption = await fixture.drain().then(
          () => undefined,
          (error: unknown) => error,
        );
        if (interruption === undefined) {
          throw new Error(
            `Did not interrupt ${boundary.name} ${phase}: ${JSON.stringify({ observed, run: order.run })}.`,
          );
        }
        if (!(interruption instanceof Error)) {
          throw new Error(`Command interruption rejected with ${JSON.stringify(interruption)}.`);
        }
        expect(interruption.message).toMatch(
          new RegExp(`Interrupted .* ${phase} the command decision\\.`),
        );
        await fixture.restart();

        expect(order.run).toMatchObject({
          status: "completed",
          output: { value: `result:${boundary.name}:${phase}` },
        });
        expect(effects).toBe(1);
        expect(new Set(identities).size).toBe(1);
        const transitionTypes = order.run?.history.map(({ transition }) => transition.type) ?? [];
        expect(transitionTypes.filter((type) => type === "started")).toHaveLength(1);
        expect(transitionTypes.filter((type) => type === "operationScheduled")).toHaveLength(1);
        expect(transitionTypes.filter((type) => type === "operationSucceeded")).toHaveLength(1);
        expect(transitionTypes.filter((type) => type === "completed")).toHaveLength(1);
        await fixture.dispose();
      }
    }
  });

  it("converges retry and failure settlement across both command outcomes", async () => {
    for (const phase of ["before", "after"] as const) {
      const retryClock = new VirtualClock();
      const retryIdentities: string[] = [];
      let retryCalls = 0;
      const retrying = await createFixture({
        clock: retryClock,
        work: {
          async execute(id, { idempotencyKey }) {
            retryCalls += 1;
            retryIdentities.push(idempotencyKey);
            if (retryCalls === 1) throw new Error("temporary");
            return id;
          },
        },
        async run({ perform }, input, { work }) {
          const value = await perform("retry", (context) => work.execute(input.id, context), {
            retry: { attempts: 2, delayMs: 100 },
          });
          return { value };
        },
      });
      retrying.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "operationRetryScheduled"),
      });
      const retried = retrying.api.getWorkflow("order", `retry-settlement:${phase}`);

      await retried.start({ id: phase, approval: false, delayMs: 0 });
      await expect(retrying.drain()).rejects.toThrow(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await retrying.restart();
      retryClock.advance(100);
      await retrying.drain();

      expect(retried.run).toMatchObject({ status: "completed", output: { value: phase } });
      expect(retryCalls).toBe(2);
      expect(new Set(retryIdentities).size).toBe(1);
      expect(
        retried.run?.history.filter(
          ({ transition }) => transition.type === "operationRetryScheduled",
        ),
      ).toHaveLength(phase === "before" ? 0 : 1);
      expect(
        retried.run?.history.filter(({ transition }) => transition.type === "operationSucceeded"),
      ).toHaveLength(1);
      await retrying.dispose();

      const failedIdentities: string[] = [];
      let failedCalls = 0;
      const failing = await createFixture({
        work: {
          async execute(_id, { idempotencyKey }) {
            failedCalls += 1;
            failedIdentities.push(idempotencyKey);
            throw new NonRetriableError("expected failure");
          },
        },
        async run({ perform }, input, { work }) {
          const value = await perform("fail", (context) => work.execute(input.id, context));
          return { value };
        },
      });
      failing.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "operationFailed"),
      });
      const failed = failing.api.getWorkflow("order", `failed-settlement:${phase}`);

      await failed.start({ id: phase, approval: false, delayMs: 0 });
      await expect(failing.drain()).rejects.toThrow(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await failing.restart();

      expect(failed.run).toMatchObject({ status: "failed" });
      expect(failed.run?.operations.fail).toMatchObject({ status: "failed" });
      expect(failedCalls).toBe(phase === "before" ? 2 : 1);
      expect(new Set(failedIdentities).size).toBe(1);
      expect(
        failed.run?.history.filter(({ transition }) => transition.type === "operationFailed"),
      ).toHaveLength(1);
      expect(
        failed.run?.history.filter(({ transition }) => transition.type === "failed"),
      ).toHaveLength(1);
      await failing.dispose();

      const terminal = await createFixture({
        work: {
          async execute() {
            throw new NonRetriableError("expected terminal failure");
          },
        },
        async run({ perform }, input, { work }) {
          const value = await perform("fail", (context) => work.execute(input.id, context));
          return { value };
        },
      });
      terminal.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "failed"),
      });
      const terminallyFailed = terminal.api.getWorkflow("order", `terminal-failure:${phase}`);

      await terminallyFailed.start({ id: phase, approval: false, delayMs: 0 });
      await expect(terminal.drain()).rejects.toThrow(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await terminal.restart();

      expect(terminallyFailed.run).toMatchObject({ status: "failed" });
      expect(
        terminallyFailed.run?.history.filter(
          ({ transition }) => transition.type === "operationFailed",
        ),
      ).toHaveLength(1);
      expect(
        terminallyFailed.run?.history.filter(({ transition }) => transition.type === "failed"),
      ).toHaveLength(1);
      await terminal.dispose();
    }
  });

  it("converges workflow retry scheduling and wake settlement across both command outcomes", async () => {
    for (const phase of ["before", "after"] as const) {
      const scheduleClock = new VirtualClock();
      let scheduleEntries = 0;
      const scheduling = await createFixture({
        clock: scheduleClock,
        retry: { attempts: 2, delayMs: 100 },
        work: { execute: async (id) => id },
        async run(_context, input) {
          scheduleEntries += 1;
          if (scheduleEntries === 1) throw new Error("retry workflow");
          return { value: input.id };
        },
      });
      scheduling.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "executionRetryScheduled"),
      });
      const scheduled = scheduling.api.getWorkflow("order", `workflow-retry-schedule:${phase}`);

      await scheduled.start({ id: phase, approval: false, delayMs: 0 });
      await expect(scheduling.drain()).rejects.toThrow(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await scheduling.restart();
      scheduleClock.advance(100);
      await scheduling.drain();

      expect(scheduled.run).toMatchObject({ status: "completed", output: { value: phase } });
      expect(scheduleEntries).toBe(2);
      expect(
        scheduled.run?.history.filter(
          ({ transition }) => transition.type === "executionRetryScheduled",
        ),
      ).toHaveLength(phase === "before" ? 0 : 1);
      expect(
        scheduled.run?.history.filter(
          ({ transition }) => transition.type === "executionRetryStarted",
        ),
      ).toHaveLength(phase === "before" ? 0 : 1);
      await scheduling.dispose();

      const wakeClock = new VirtualClock();
      let wakeEntries = 0;
      const waking = await createFixture({
        clock: wakeClock,
        retry: { attempts: 2, delayMs: 100 },
        work: { execute: async (id) => id },
        async run(_context, input) {
          wakeEntries += 1;
          if (wakeEntries === 1) throw new Error("retry workflow");
          return { value: input.id };
        },
      });
      const awakened = waking.api.getWorkflow("order", `workflow-retry-wake:${phase}`);
      await awakened.start({ id: phase, approval: false, delayMs: 0 });
      await poll(() => awakened.run?.retryAt === 100);
      waking.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "executionRetryStarted"),
      });

      wakeClock.advance(100);
      let wakeInterruption: unknown;
      await poll(async () => {
        try {
          await waking.drain();
          return false;
        } catch (error) {
          wakeInterruption = error;
          return true;
        }
      });
      if (!(wakeInterruption instanceof Error)) {
        throw new Error(
          `Workflow retry wake interruption rejected with ${JSON.stringify(wakeInterruption)}.`,
        );
      }
      expect(wakeInterruption.message).toMatch(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await waking.restart();

      expect(awakened.run).toMatchObject({ status: "completed", output: { value: phase } });
      expect(wakeEntries).toBe(2);
      expect(
        awakened.run?.history.filter(
          ({ transition }) => transition.type === "executionRetryScheduled",
        ),
      ).toHaveLength(1);
      expect(
        awakened.run?.history.filter(
          ({ transition }) => transition.type === "executionRetryStarted",
        ),
      ).toHaveLength(1);
      await waking.dispose();
    }
  });

  it("converges timer scheduling and wake settlement across both command outcomes", async () => {
    for (const phase of ["before", "after"] as const) {
      const scheduleClock = new VirtualClock();
      const scheduling = await createFixture({
        clock: scheduleClock,
        work: { execute: async (id) => id },
        async run({ sleep }, input) {
          await sleep("pause", 100);
          return { value: input.id };
        },
      });
      scheduling.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "operationScheduled", "sleep"),
      });
      const scheduled = scheduling.api.getWorkflow("order", `timer-schedule:${phase}`);

      await scheduled.start({ id: phase, approval: false, delayMs: 0 });
      await expect(scheduling.drain()).rejects.toThrow(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await scheduling.restart();
      scheduleClock.advance(100);
      await scheduling.drain();

      expect(scheduled.run).toMatchObject({ status: "completed", output: { value: phase } });
      expect(
        scheduled.run?.history.filter(({ transition }) => transition.type === "operationScheduled"),
      ).toHaveLength(1);
      expect(
        scheduled.run?.history.filter(({ transition }) => transition.type === "operationSucceeded"),
      ).toHaveLength(1);
      await scheduling.dispose();

      const wakeClock = new VirtualClock();
      const waking = await createFixture({
        clock: wakeClock,
        work: { execute: async (id) => id },
        async run({ sleep }, input) {
          await sleep("pause", 100);
          return { value: input.id };
        },
      });
      const awakened = waking.api.getWorkflow("order", `timer-wake:${phase}`);
      await awakened.start({ id: phase, approval: false, delayMs: 0 });
      await waking.drain();
      waking.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "operationSucceeded", "sleep"),
      });

      wakeClock.advance(100);
      let wakeInterruption: unknown;
      await poll(async () => {
        try {
          await waking.drain();
          return false;
        } catch (error) {
          wakeInterruption = error;
          return true;
        }
      });
      if (!(wakeInterruption instanceof Error)) {
        throw new Error(
          `Timer wake interruption rejected with ${JSON.stringify(wakeInterruption)}.`,
        );
      }
      expect(wakeInterruption.message).toMatch(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await waking.restart();

      expect(awakened.run).toMatchObject({ status: "completed", output: { value: phase } });
      expect(
        awakened.run?.history.filter(({ transition }) => transition.type === "operationSucceeded"),
      ).toHaveLength(1);
      expect(
        awakened.run?.history.filter(({ transition }) => transition.type === "completed"),
      ).toHaveLength(1);
      await waking.dispose();
    }
  });

  it("converges signal consumption and generation rollover across both command outcomes", async () => {
    for (const phase of ["before", "after"] as const) {
      const signalClock = new VirtualClock();
      const signaling = await createFixture({
        clock: signalClock,
        work: { execute: async (id) => id },
        async run({ waitFor }, input) {
          const approval = await waitFor("approval", "approve", { timeoutMs: 1_000 });
          return { value: input.id, reviewerId: approval.reviewerId };
        },
      });
      const signaled = signaling.api.getWorkflow("order", `signal-settlement:${phase}`);
      await signaled.start({ id: phase, approval: false, delayMs: 0 });
      await poll(() => signaled.run?.operations.approval?.status === "scheduled");
      signaling.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "operationSucceeded", "signal"),
      });

      await signaled.signal("approve", { reviewerId: `reviewer:${phase}` });
      let signalInterruption: unknown;
      await poll(async () => {
        try {
          await signaling.drain();
          return false;
        } catch (error) {
          signalInterruption = error;
          return true;
        }
      });
      if (!(signalInterruption instanceof Error)) {
        throw new Error(`Signal interruption rejected with ${JSON.stringify(signalInterruption)}.`);
      }
      expect(signalInterruption.message).toMatch(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await signaling.restart();

      expect(signaled.run).toMatchObject({
        status: "completed",
        output: { value: phase, reviewerId: `reviewer:${phase}` },
      });
      expect(
        signaled.run?.history.filter(({ transition }) => transition.type === "operationSucceeded"),
      ).toHaveLength(1);
      expect(signaled.run?.messages).toHaveLength(1);
      await signaling.dispose();

      const continuing = await createFixture({
        work: { execute: async (id) => id },
        async run({ continueAsNew }, input) {
          if (input.delayMs === 0) continueAsNew({ ...input, delayMs: 1 });
          return { value: input.id };
        },
      });
      continuing.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "continued"),
      });
      const continued = continuing.api.getWorkflow("order", `continue-settlement:${phase}`);

      await continued.start({ id: phase, approval: false, delayMs: 0 });
      await expect(continuing.drain()).rejects.toThrow(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await continuing.restart();

      expect(continued.run).toMatchObject({
        status: "completed",
        generation: 1,
        input: { id: phase, approval: false, delayMs: 1 },
        output: { value: phase },
      });
      expect(
        continued.run?.history.filter(({ transition }) => transition.type === "continued"),
      ).toHaveLength(1);
      await continuing.dispose();
    }
  });

  it("converges coordinated race settlement across both command outcomes", async () => {
    for (const phase of ["before", "after"] as const) {
      const fixture = await createFunctionFixture(({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" } },
          async ({ event, group, step }) => {
            const winner = await group.parallel({ mode: "race" }, () =>
              Promise.race([
                step.run("slow", () => new Promise<string>(() => {})),
                step.run("fast", () => "fast"),
              ]),
            );
            return { value: `${event.data.id}:${winner}`, reviewer: phase };
          },
        );
      });
      fixture.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "raceSettled"),
      });

      await fixture.api.send({ id: `race:${phase}`, name: "job/started", data: { id: phase } });
      await expect(fixture.drain()).rejects.toThrow(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await fixture.restart();

      const raced = fixture.api.getFunction("job", `race:${phase}:job`).details;
      expect(raced).toMatchObject({
        status: "completed",
        output: { value: `${phase}:fast`, reviewer: phase },
        operations: {
          fast: { status: "succeeded" },
          slow: { status: "cancelled" },
        },
      });
      expect(
        raced?.history.filter(({ transition }) => transition.type === "raceSettled"),
      ).toHaveLength(1);
      await fixture.dispose();
    }
  });

  it("converges child start, child completion, and parent settlement across both command outcomes", async () => {
    const boundaries = [
      {
        name: "child start",
        matches: (boundary: TestFeatureProgramCommandBoundary) =>
          commandContainsTransition(boundary, "started"),
      },
      {
        name: "child completion",
        matches: (boundary: TestFeatureProgramCommandBoundary) =>
          commandContainsTransition(boundary, "completed"),
      },
      {
        name: "parent settlement",
        matches: (boundary: TestFeatureProgramCommandBoundary) =>
          commandContainsTransition(boundary, "operationSucceeded", "workflow"),
      },
    ] as const;

    for (const boundary of boundaries) {
      for (const phase of ["before", "after"] as const) {
        const fixture = await createFixture({
          work: { execute: async (id) => id },
          async run({ invoke }, input) {
            const shipment = await invoke("shipment", "shipment", { orderId: input.id });
            return { value: shipment.trackingId };
          },
          async shipment(_context, input) {
            return { trackingId: `tracking:${input.orderId}` };
          },
        });
        fixture.interruptNextProgramCommand({ phase, when: boundary.matches });
        const parentId = `${boundary.name}:${phase}`;
        const parent = fixture.api.getWorkflow("order", parentId);

        await parent.start({ id: parentId, approval: false, delayMs: 0 });
        await expect(fixture.drain()).rejects.toThrow(
          new RegExp(`Interrupted .* ${phase} the command decision\\.`),
        );
        await fixture.restart();

        const child = fixture.api.getWorkflow("shipment", `${parentId}:shipment`);
        expect(parent.run).toMatchObject({
          status: "completed",
          output: { value: `tracking:${parentId}` },
          operations: { shipment: { kind: "workflow", status: "succeeded" } },
        });
        expect(child.run).toMatchObject({
          status: "completed",
          output: { trackingId: `tracking:${parentId}` },
        });
        expect(
          child.run?.history.filter(({ transition }) => transition.type === "started"),
        ).toHaveLength(1);
        expect(
          child.run?.history.filter(({ transition }) => transition.type === "completed"),
        ).toHaveLength(1);
        expect(
          parent.run?.history.filter(({ transition }) => transition.type === "operationSucceeded"),
        ).toHaveLength(1);
        await fixture.dispose();
      }
    }
  });

  it("converges an admission handoff across both command outcomes", async () => {
    for (const phase of ["before", "after"] as const) {
      const first = Promise.withResolvers<string>();
      const entered: string[] = [];
      const effects: string[] = [];
      const results = new Map<string, string>();
      const fixture = await createFunctionFixture(({ createFunction }) => {
        createFunction(
          { id: "job", triggers: { event: "job/started" }, concurrency: 1 },
          async ({ event, step }) => {
            const value = await step.run("work", async () => {
              entered.push(event.data.id);
              const previous = results.get(event.data.id);
              if (previous !== undefined) return previous;
              const result = event.data.id === "first" ? await first.promise : event.data.id;
              effects.push(event.data.id);
              results.set(event.data.id, result);
              return result;
            });
            return { value, reviewer: "admitted" };
          },
        );
      });

      await fixture.api.send({ id: "first", name: "job/started", data: { id: "first" } });
      await poll(() => entered.length === 1);
      await fixture.api.send({ id: "second", name: "job/started", data: { id: "second" } });
      await poll(
        () =>
          fixture.api.getFunction("job", "second:job").details?.operations.work?.status ===
          "scheduled",
      );
      fixture.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "operationAdmitted"),
      });

      first.resolve("first");
      let admissionInterruption: unknown;
      await poll(async () => {
        try {
          await fixture.drain();
          return false;
        } catch (error) {
          admissionInterruption = error;
          return true;
        }
      });
      if (!(admissionInterruption instanceof Error)) {
        throw new Error(
          `Admission interruption rejected with ${JSON.stringify(admissionInterruption)}.`,
        );
      }
      expect(admissionInterruption.message).toMatch(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await fixture.restart();

      expect(fixture.api.getFunction("job", "first:job").run).toMatchObject({
        status: "completed",
        output: { value: "first", reviewer: "admitted" },
      });
      expect(fixture.api.getFunction("job", "second:job").run).toMatchObject({
        status: "completed",
        output: { value: "second", reviewer: "admitted" },
      });
      expect(entered.filter((id) => id === "first")).toHaveLength(1);
      expect(entered.filter((id) => id === "second").length).toBeGreaterThanOrEqual(1);
      expect(entered.filter((id) => id === "second").length).toBeLessThanOrEqual(2);
      expect(effects).toEqual(["first", "second"]);
      expect(
        fixture.api
          .getFunction("job", "second:job")
          .details?.history.filter(({ transition }) => transition.type === "operationAdmitted"),
      ).toHaveLength(1);
      await fixture.dispose();
    }
  });

  it("converges scheduler cancellation and admission rejection across both command outcomes", async () => {
    for (const phase of ["before", "after"] as const) {
      const finishClock = new VirtualClock();
      const finishing = await createFunctionFixture(
        ({ createFunction }) => {
          createFunction(
            {
              id: "job",
              triggers: { event: "job/started" },
              timeouts: { finish: "1 second" },
            },
            async ({ event, step }) => {
              await step.waitForEvent("never", { event: "job/completed", timeout: "1 day" });
              return { value: event.data.id, reviewer: "completed" };
            },
          );
        },
        { clock: finishClock },
      );
      await finishing.api.send({ id: `finish:${phase}`, name: "job/started", data: { id: phase } });
      const timed = finishing.api.getFunction("job", `finish:${phase}:job`);
      await poll(() => finishClock.sleepers.some(({ at }) => at === 1_000));
      finishing.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "cancelled"),
      });

      finishClock.advance(1_000);
      let finishInterruption: unknown;
      await poll(
        async () => {
          try {
            await finishing.drain();
            return false;
          } catch (error) {
            finishInterruption = error;
            return true;
          }
        },
        { timeoutMs: 500 },
      );
      if (!(finishInterruption instanceof Error)) {
        throw new Error(
          `Finish cancellation interruption rejected with ${JSON.stringify(finishInterruption)}.`,
        );
      }
      expect(finishInterruption.message).toMatch(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await finishing.restart();

      expect(timed.details).toMatchObject({
        status: "cancelled",
        error: "finish_timeout",
        operations: { never: { status: "cancelled" } },
      });
      expect(
        timed.details?.history.filter(({ transition }) => transition.type === "cancelled"),
      ).toHaveLength(1);
      await finishing.dispose();

      const startClock = new VirtualClock();
      const entered: string[] = [];
      const rejecting = await createFunctionFixture(
        ({ createFunction }) => {
          createFunction(
            {
              id: "job",
              triggers: { event: "job/started" },
              throttle: { limit: 1, period: "10 seconds" },
              timeouts: { start: "1 second" },
            },
            async ({ event }) => {
              entered.push(event.data.id);
              return { value: event.data.id, reviewer: "started" };
            },
          );
        },
        { clock: startClock },
      );
      await rejecting.api.send([
        { id: `first:${phase}`, name: "job/started", data: { id: "first" } },
        { id: `expired:${phase}`, name: "job/started", data: { id: "expired" } },
      ]);
      const expired = rejecting.api.getFunction("job", `expired:${phase}:job`);
      await poll(() => entered.length === 1 && startClock.sleepers.some(({ at }) => at === 1_000));
      rejecting.interruptNextProgramCommand({
        phase,
        when: (boundary) => commandContainsTransition(boundary, "rejected"),
      });

      startClock.advance(1_000);
      let rejectionInterruption: unknown;
      await poll(
        async () => {
          try {
            await rejecting.drain();
            return false;
          } catch (error) {
            rejectionInterruption = error;
            return true;
          }
        },
        { timeoutMs: 500 },
      );
      if (!(rejectionInterruption instanceof Error)) {
        throw new Error(
          `Admission rejection interruption rejected with ${JSON.stringify(rejectionInterruption)}.`,
        );
      }
      expect(rejectionInterruption.message).toMatch(
        new RegExp(`Interrupted .* ${phase} the command decision\\.`),
      );
      await rejecting.restart();

      expect(expired.details).toMatchObject({ status: "cancelled", error: "start_timeout" });
      expect(
        expired.details?.history.filter(({ transition }) => transition.type === "rejected"),
      ).toHaveLength(1);
      expect(entered).toEqual(["first"]);
      await rejecting.drain();
      await rejecting.dispose();
    }
  });

  it("matches the exhaustive virtual-time deadline and cancellation ordering model", async () => {
    const waitCompetitors = ["signal", "wait", "finish", "cancel"] as const;
    for (const order of permutations(waitCompetitors)) {
      const clock = new VirtualClock();
      const waitAt = (order.indexOf("wait") + 1) * 100;
      const finishAt = (order.indexOf("finish") + 1) * 100;
      const fixture = await createFunctionFixture(
        ({ createFunction }) => {
          createFunction(
            {
              id: "job",
              triggers: { event: "job/started" },
              timeouts: { finish: `${finishAt} milliseconds` },
            },
            async ({ event, step }) => {
              const approval = await step.waitForEvent("approval", {
                event: "job/approved",
                timeout: waitAt,
                if: "event.data.id == async.data.id",
              });
              return {
                value: event.data.id,
                reviewer: approval?.data.reviewer ?? "timeout",
              };
            },
          );
        },
        { clock },
      );
      const id = order.join(":");
      await fixture.api.send({ id, name: "job/started", data: { id } });
      const run = fixture.api.getFunction("job", `${id}:job`);
      await poll(() => run.details?.operations.approval?.status === "scheduled");

      for (let index = 0; index < order.length; index += 1) {
        const competitor = order[index]!;
        clock.advance((index + 1) * 100 - clock.time);
        if (competitor === "signal") {
          await fixture.api.send({
            id: `approval:${id}`,
            name: "job/approved",
            data: { id, reviewer: "approved" },
          });
        } else if (competitor === "cancel") {
          await run.cancel("model_cancel");
        }
        await drainVirtual(fixture);
        if (run.run?.status !== "running") break;
      }

      const winner = order[0]!;
      if (winner === "signal") {
        expect(run.run).toMatchObject({
          status: "completed",
          output: { value: id, reviewer: "approved" },
        });
      } else if (winner === "wait") {
        expect(run.run).toMatchObject({
          status: "completed",
          output: { value: id, reviewer: "timeout" },
        });
      } else {
        expect(run.run).toMatchObject({
          status: "cancelled",
          error: winner === "finish" ? "finish_timeout" : "model_cancel",
        });
      }
      expect(
        run.details?.history.filter(
          ({ transition }) =>
            transition.type === "completed" ||
            transition.type === "failed" ||
            transition.type === "cancelled" ||
            transition.type === "rejected",
        ),
      ).toHaveLength(1);
      await fixture.dispose();
    }

    const retryCompetitors = ["retry", "finish", "cancel"] as const;
    for (const order of permutations(retryCompetitors)) {
      const clock = new VirtualClock();
      const retryAt = (order.indexOf("retry") + 1) * 100;
      const finishAt = (order.indexOf("finish") + 1) * 100;
      let calls = 0;
      const fixture = await createFixture({
        clock,
        timeoutMs: finishAt,
        work: {
          async execute(id, { attempt }) {
            calls += 1;
            if (attempt === 1) throw new Error("temporary");
            return id;
          },
        },
        async run({ perform }, input, { work }) {
          const value = await perform("retry", (context) => work.execute(input.id, context), {
            retry: { attempts: 2, delayMs: retryAt },
          });
          return { value };
        },
      });
      const id = order.join(":");
      const run = fixture.api.getWorkflow("order", id);
      await run.start({ id, approval: false, delayMs: 0 });
      await poll(() => run.run?.operations.retry?.status === "waiting");

      for (let index = 0; index < order.length; index += 1) {
        const competitor = order[index]!;
        clock.advance((index + 1) * 100 - clock.time);
        if (competitor === "cancel") await run.cancel("model_cancel");
        await drainVirtual(fixture);
        if (run.run?.status !== "running") break;
      }

      const winner = order[0]!;
      if (winner === "retry") {
        expect(run.run).toMatchObject({ status: "completed", output: { value: id } });
        expect(calls).toBe(2);
      } else {
        expect(run.run).toMatchObject({
          status: "cancelled",
          error: winner === "finish" ? "finish_timeout" : "model_cancel",
        });
        expect(calls).toBe(1);
      }
      expect(
        run.run?.history.filter(
          ({ transition }) =>
            transition.type === "completed" ||
            transition.type === "failed" ||
            transition.type === "cancelled" ||
            transition.type === "rejected",
        ),
      ).toHaveLength(1);
      await fixture.dispose();
    }
  });

  it("runs against test-replaced semantic dependencies", async () => {
    const fixture = await createFixture({
      work: {
        async execute() {
          return "normal";
        },
      },
      replacement: {
        async execute() {
          return "replacement";
        },
      },
      async run({ perform }, input, { work }) {
        const value = await perform("replace", (context) => work.execute(input.id, context));
        return { value };
      },
    });
    const order = fixture.api.getWorkflow("order", "run-replaced");

    await order.start({ id: "six", approval: false, delayMs: 0 });
    await fixture.drain();
    expect(order.run).toMatchObject({ output: { value: "replacement" } });
  });

  it("matches the retry model for generated failure schedules", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          attempts: fc.integer({ min: 1, max: 5 }),
          failures: fc.integer({ min: 0, max: 6 }),
        }),
        async ({ attempts, failures }) => {
          const clock = new VirtualClock();
          const keys: string[] = [];
          let calls = 0;
          const fixture = await createFixture({
            clock,
            work: {
              async execute(id, { idempotencyKey }) {
                calls += 1;
                keys.push(idempotencyKey);
                if (calls <= failures) throw new Error(`failure:${calls}`);
                return id;
              },
            },
            async run({ perform }, input, { work }) {
              const value = await perform(
                "generated-retry",
                (context) => work.execute(input.id, context),
                { retry: { attempts, delayMs: 1 } },
              );
              return { value };
            },
          });
          const order = fixture.api.getWorkflow("order", `retry:${attempts}:${failures}`);

          await order.start({ id: "generated", approval: false, delayMs: 0 });
          for (let retry = 0; retry < Math.min(failures, attempts - 1); retry += 1) {
            await poll(() => clock.sleepers.length === 1, { intervalMs: 0 });
            clock.advance((clock.sleepers[0]?.at ?? clock.time) - clock.time);
          }
          await fixture.drain();

          expect(calls).toBe(Math.min(failures + 1, attempts));
          expect(new Set(keys).size).toBe(1);
          expect(order.run?.operations["generated-retry"]?.attempt).toBe(calls);
          expect(order.run?.status).toBe(failures < attempts ? "completed" : "failed");
          await fixture.dispose();
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("persistent Functions boundary", () => {
  it("drains gated parallel steps through bounded production delivery", async () => {
    const segmentCount = Number(Bun.env.POGGERS_WORKFLOW_STRESS_SEGMENTS ?? 64);
    const timeoutMs = Math.max(10_000, segmentCount * 20);
    type Contract = {
      Events: { "job/run": { count: number } };
      Functions: { job: { Input: { count: number }; Output: { completed: number } } };
      Dependencies: {};
    };
    type App = {
      Actor: { id: string };
      Resources: {};
      Features: { jobs: FunctionsFeature<Contract> };
    };

    let handlerEntries = 0;
    const completed = new Set<number>();
    const feature = createFunctions<App, Contract>({ dependencies: {} }, ({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/run" }, concurrency: 4, retries: 0 },
        async ({ event, step }) => {
          handlerEntries += 1;
          await Promise.all(
            Array.from({ length: event.data.count }, (_, index) =>
              step.run(`segment-${index}`, () => {
                completed.add(index);
                return index;
              }),
            ),
          );
          return { completed: completed.size };
        },
      );
    });
    const app = defineApp<App>({ version: 1, resources: {}, features: { jobs: feature } });
    const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-backpressure-"));
    const journal = createSqliteJournal({
      file: join(directory, "journal.sqlite"),
      durability: "strict",
      commit: "group",
    });
    const program = app.def.programs?.server;
    if (!program) throw new Error("The Functions Feature did not contribute its Program.");
    const handle = serve(app, {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      programs: [
        {
          env: "server",
          deps: { jobs: {} },
          actor: { id: "owner" },
          programId: "workflow-backpressure-test",
          maxPendingEvents: 8,
        },
      ],
    });
    let client: Awaited<ReturnType<typeof connect<App>>> | undefined;
    try {
      await handle.ready;
      const connected = await connect(app, {
        wsUrl: new URL("/ws", handle.url).href.replace("http", "ws"),
        token: "owner",
        replica: createMemoryClientReplica(),
        transport: createWebSocketSyncTransport,
      });
      client = connected;
      await poll(() => connected.connected);
      const api = app.createAPIs({
        actor: { id: "owner" },
        resolveResource(path, name) {
          const resource = Reflect.get(connected, featureResourceName(path, name));
          if (typeof resource !== "function") {
            throw new Error(`Missing client Resource ${featureResourceName(path, name)}.`);
          }
          return resource;
        },
      }).features.jobs.api;

      await api.send({ id: "bounded", name: "job/run", data: { count: segmentCount } });
      await poll(() => api.getFunction("job", "bounded:job").run?.status === "completed", {
        timeoutMs,
      });
      expect(completed.size).toBe(segmentCount);
      expect(handlerEntries).toBe(1);
      await poll(() => api.getFunction("job", "bounded:job").details?.output !== undefined, {
        timeoutMs,
      });
      expect(api.getFunction("job", "bounded:job").details?.output).toEqual({
        completed: segmentCount,
      });
    } finally {
      client?.dispose();
      await handle.stop();
      await journal.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects an in-flight run when a new appVersion reopens the same Journal", async () => {
    type Contract = {
      Events: {
        "job/run": { value: string };
        "job/release": { value: string };
      };
      Functions: { job: { Input: { value: string }; Output: string } };
      Dependencies: {};
    };
    type App = {
      Actor: { id: string };
      Resources: {};
      Features: { jobs: FunctionsFeature<Contract> };
    };

    let releaseEntries = 0;
    const createVersionedApp = (appVersion: string) => {
      const feature = createFunctions<App, Contract>(
        { appVersion, dependencies: {} },
        ({ createFunction }) => {
          createFunction(
            { id: "job", triggers: { event: "job/run" }, retries: 0 },
            async ({ event, step }) => {
              if (appVersion === "release-2") releaseEntries += 1;
              const released = await step.waitForEvent("release", {
                event: "job/release",
                timeout: "1 hour",
              });
              return `${event.data.value}:${released?.data.value ?? "timeout"}`;
            },
          );
        },
      );
      return defineApp<App>({ version: 1, resources: {}, features: { jobs: feature } });
    };

    const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-version-"));
    const file = join(directory, "journal.sqlite");
    const start = async (app: ReturnType<typeof createVersionedApp>) => {
      const journal = createSqliteJournal({ file, durability: "strict", commit: "group" });
      const program = app.def.programs?.server;
      if (!program) throw new Error("The Functions Feature did not contribute its Program.");
      const handle = serve(app, {
        port: 0,
        substrate: createSingleNodeSubstrate(journal),
        programs: [
          {
            env: "server",
            deps: { jobs: {} },
            actor: { id: "owner" },
            programId: "workflow-version-test",
          },
        ],
      });
      await handle.ready;
      const client = await connect(app, {
        wsUrl: new URL("/ws", handle.url).href.replace("http", "ws"),
        token: "owner",
        replica: createMemoryClientReplica(),
        transport: createWebSocketSyncTransport,
      });
      await poll(() => client.connected);
      const api = app.createAPIs({
        actor: { id: "owner" },
        resolveResource(path, name) {
          const resource = Reflect.get(client, featureResourceName(path, name));
          if (typeof resource !== "function") {
            throw new Error(`Missing client Resource ${featureResourceName(path, name)}.`);
          }
          return resource;
        },
      }).features.jobs.api;
      return {
        api,
        async stop() {
          client.dispose();
          await handle.stop();
          await journal.close();
        },
      };
    };

    let runtime: Awaited<ReturnType<typeof start>> | undefined;
    try {
      runtime = await start(createVersionedApp("release-1"));
      await runtime.api.send({ id: "job", name: "job/run", data: { value: "work" } });
      await poll(
        () =>
          runtime?.api.getFunction("job", "job:job").details?.operations.release?.status ===
          "scheduled",
      );
      expect(runtime.api.getFunction("job", "job:job").run).toMatchObject({
        status: "running",
        version: "release-1",
      });
      await runtime.stop();

      runtime = await start(createVersionedApp("release-2"));
      await poll(() => runtime?.api.getFunction("job", "job:job").run?.status === "failed");
      expect(runtime.api.getFunction("job", "job:job").run).toMatchObject({
        status: "failed",
        version: "release-1",
        error: {
          name: "WorkflowVersionMismatchError",
          startedVersion: "release-1",
          currentVersion: "release-2",
        },
      });
      expect(releaseEntries).toBe(0);
    } finally {
      await runtime?.stop();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("enforces environment concurrency across independent owners", async () => {
    type Contract = {
      Events: { "job/run": { value: string } };
      Functions: { job: { Input: { value: string }; Output: { value: string } } };
      Dependencies: {};
    };
    type App = {
      Actor: { id: string };
      Resources: {};
      Features: { jobs: FunctionsFeature<Contract> };
    };

    const entered: string[] = [];
    const gates = new Map<
      string,
      {
        readonly promise: Promise<void>;
        readonly resolve: (value?: void | PromiseLike<void>) => void;
      }
    >();
    const feature = createFunctions<App, Contract>({ dependencies: {} }, ({ createFunction }) => {
      createFunction(
        {
          id: "job",
          triggers: { event: "job/run" },
          concurrency: { limit: 1, scope: "env", key: '"shared"' },
        },
        async ({ event, step }) => {
          const value = await step.run("work", async () => {
            entered.push(event.data.value);
            const gate = Promise.withResolvers<void>();
            gates.set(event.data.value, gate);
            await gate.promise;
            return event.data.value;
          });
          return { value };
        },
      );
    });
    const app = defineApp<App>({
      version: 1,
      resources: {},
      features: { jobs: feature },
    });
    const program = app.def.programs?.server;
    if (!program) throw new Error("The Functions Feature did not contribute its Program.");
    const journal = createMemoryJournal();
    const handle = serve(app, {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      programs: [
        {
          env: "server",
          deps: { jobs: {} },
          actor: { id: "server" },
          programId: "environment-concurrency-test",
        },
      ],
    });
    await handle.ready;

    const wsUrl = new URL("/ws", handle.url).href.replace("http", "ws");
    const clients = await Promise.all(
      ["ada", "grace"].map((ownerId) =>
        connect(app, {
          wsUrl,
          token: ownerId,
          replica: createMemoryClientReplica(),
          transport: createWebSocketSyncTransport,
        }),
      ),
    );
    try {
      await poll(() => clients.every(({ connected }) => connected));
      const apis = clients.map(
        (client, index) =>
          app.createAPIs({
            actor: { id: index === 0 ? "ada" : "grace" },
            resolveResource(path, name) {
              const resource = Reflect.get(client, featureResourceName(path, name));
              if (typeof resource !== "function") {
                throw new Error(`Missing client Resource ${featureResourceName(path, name)}.`);
              }
              return resource;
            },
          }).features.jobs.api,
      );

      await apis[0]!.send({ id: "run", name: "job/run", data: { value: "ada" } });
      await poll(() => entered.length === 1);
      await apis[1]!.send({ id: "run", name: "job/run", data: { value: "grace" } });
      await Bun.sleep(25);
      expect(entered).toEqual(["ada"]);

      gates.get("ada")?.resolve();
      await poll(() => entered.length === 2);
      expect(entered).toEqual(["ada", "grace"]);
      gates.get("grace")?.resolve();
      await poll(
        () =>
          apis[0]!.getFunction("job", "run:job").run?.status === "completed" &&
          apis[1]!.getFunction("job", "run:job").run?.status === "completed",
      );
    } finally {
      for (const client of clients) client.dispose();
      await handle.stop();
      await journal.close();
    }
  });

  it("executes from cold state, snapshots, reopens, and continues through the client API", async () => {
    type Contract = {
      Events: { "job/run": { value: number } };
      Functions: { job: { Input: { value: number }; Output: { value: number } } };
      Dependencies: {};
    };
    type App = {
      Actor: { id: string };
      Resources: {};
      Features: { jobs: FunctionsFeature<Contract> };
    };

    const feature = createFunctions<App, Contract>({ dependencies: {} }, ({ createFunction }) => {
      createFunction(
        { id: "job", triggers: { event: "job/run" }, retries: 0 },
        async ({ event, step }) => ({
          value: await step.run("double", () => event.data.value * 2),
        }),
      );
    });
    const app = defineApp<App>({
      version: 1,
      resources: {},
      features: { jobs: feature },
    });
    const directory = await mkdtemp(join(tmpdir(), "poggers-workflows-"));
    const file = join(directory, "journal.sqlite");

    const start = async () => {
      const journal = createSqliteJournal({ file, durability: "strict", commit: "group" });
      const program = app.def.programs?.server;
      if (!program) throw new Error("The Functions Feature did not contribute its Program.");
      const handle = serve(app, {
        port: 0,
        substrate: createSingleNodeSubstrate(journal),
        snapshotIntervalMs: 60_000,
        snapshotRecords: 1,
        programs: [
          {
            env: "server",
            deps: { jobs: {} },
            actor: { id: "owner" },
            programId: "persistent-functions-test",
          },
        ],
      });
      await handle.ready;
      const client = await connect(app, {
        wsUrl: new URL("/ws", handle.url).href.replace("http", "ws"),
        token: "owner",
        replica: createMemoryClientReplica(),
        transport: createWebSocketSyncTransport,
      });
      await poll(() => client.connected);
      const api = app.createAPIs({
        actor: { id: "owner" },
        resolveResource(path, name) {
          const resource = Reflect.get(client, featureResourceName(path, name));
          if (typeof resource !== "function") {
            throw new Error(`Missing client Resource ${featureResourceName(path, name)}.`);
          }
          return resource;
        },
      }).features.jobs.api;
      let stopped = false;
      return {
        api,
        async stop() {
          if (stopped) return;
          stopped = true;
          client.dispose();
          await handle.stop();
          await journal.close();
        },
      };
    };

    let runtime: Awaited<ReturnType<typeof start>> | undefined;
    try {
      runtime = await start();
      await runtime.api.send({ id: "first", name: "job/run", data: { value: 21 } });
      await poll(() => runtime?.api.getFunction("job", "first:job").run?.status === "completed");
      expect(runtime.api.getFunction("job", "first:job").run).toMatchObject({
        output: { value: 42 },
      });
      await runtime.stop();

      runtime = await start();
      await poll(() => runtime?.api.getFunction("job", "first:job").run?.status === "completed");
      await runtime.api.send({ id: "second", name: "job/run", data: { value: 7 } });
      await poll(() => runtime?.api.getFunction("job", "second:job").run?.status === "completed");
      expect(runtime.api.getFunction("job", "second:job").run).toMatchObject({
        output: { value: 14 },
      });
    } finally {
      await runtime?.stop();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
