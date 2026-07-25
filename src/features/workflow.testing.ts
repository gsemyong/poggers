import type { EventStore } from "@/features/entity";
import { createMemoryEventStore } from "@/features/entity.testing";
import {
  WORKFLOW_DEFINITION_VERSION,
  WORKFLOW_PROTOCOL_VERSION,
  type DefinedWorkflow,
  type WorkflowApi,
  type WorkflowDefinition,
  type WorkflowImplementation,
  type WorkflowJournalEvent,
  type WorkflowModelDefinition,
  type WorkflowRuntime,
  type WorkflowTimer,
  createWorkflowServer,
  createWorkflowService,
  workflowImplementation,
} from "@/features/workflow";
import { createProgramContributionInstance } from "@/runtime/process";

export type WorkflowTestClock = Readonly<{
  now(): number;
  advance(input: { milliseconds: number }): void;
  timer: WorkflowTimer;
}>;

let workflowFixtureIdentity = 0;

type WorkflowRuntimeInput<Model extends WorkflowModelDefinition> = Readonly<{
  definition: WorkflowDefinition<Model>;
  implementation: WorkflowImplementation<Model>;
  dependencies: Parameters<typeof createWorkflowService<Model>>[2];
}>;

/** Creates deterministic virtual time shared by workflow tests and restarts. */
export function createWorkflowTestClock(initial = 0): WorkflowTestClock {
  let now = initial;
  const waits = new Set<Readonly<{ until: number; resolve(): void }>>();
  const flush = () => {
    for (const wait of waits) {
      if (wait.until > now) continue;
      waits.delete(wait);
      wait.resolve();
    }
  };
  return Object.freeze({
    now: () => now,
    advance({ milliseconds }) {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
        throw new TypeError("Virtual time must advance by a non-negative safe integer.");
      }
      now += milliseconds;
      flush();
    },
    timer: {
      sleep({ until }) {
        if (until <= now) return Promise.resolve();
        return new Promise<void>((resolve) => {
          waits.add({ until, resolve });
        });
      },
    },
  });
}

/** Mounts a specialized workflow Feature with a restartable in-memory journal. */
export async function createWorkflowFixture<Model extends WorkflowModelDefinition>(
  workflow: DefinedWorkflow<Model>,
  input: Readonly<{
    name: Model["Name"];
    dependencies: Model["Dependencies"];
    clock?: WorkflowTestClock;
    events?: EventStore<WorkflowJournalEvent<Model>>;
  }>,
): Promise<
  AsyncDisposable &
    Readonly<{
      readonly api: WorkflowApi<Model>;
      clock: WorkflowTestClock;
      events: EventStore<WorkflowJournalEvent<Model>>;
      restart(): Promise<void>;
    }>
> {
  const clock = input.clock ?? createWorkflowTestClock();
  const events = input.events ?? createMemoryEventStore<WorkflowJournalEvent<Model>>();
  const definition = testWorkflowDefinition<Model>(input.name);
  const server = createWorkflowServer(workflow[workflowImplementation], () => definition);
  let instance = await start();
  let api = Reflect.get(await instance.start(), input.name) as WorkflowApi<Model>;

  async function start() {
    return createProgramContributionInstance(server.programs.server as never, {
      address: { program: "server", feature: input.name },
      provides: [input.name],
      dependencies: {
        ...input.dependencies,
        clock: { now: () => clock.now() },
        events,
        identifiers: { create: () => `workflow-test-worker-${++workflowFixtureIdentity}` },
        timer: clock.timer,
        workflowRuntime: createTestWorkflowRuntime(),
      },
    });
  }

  return {
    get api() {
      return api;
    },
    clock,
    events,
    async restart() {
      await instance.dispose();
      instance = await start();
      api = Reflect.get(await instance.start(), input.name) as WorkflowApi<Model>;
    },
    async [Symbol.asyncDispose]() {
      await instance.dispose();
    },
  };
}

function createTestWorkflowRuntime(): WorkflowRuntime {
  return Object.freeze({
    async create(input) {
      const { definition, implementation, dependencies } =
        input as WorkflowRuntimeInput<WorkflowModelDefinition>;
      return createWorkflowService(definition, implementation, dependencies);
    },
  });
}

function testWorkflowDefinition<Model extends WorkflowModelDefinition>(
  name: Model["Name"],
): WorkflowDefinition<Model> {
  const schema = Object.freeze({});
  return Object.freeze({
    version: WORKFLOW_DEFINITION_VERSION,
    protocolVersion: WORKFLOW_PROTOCOL_VERSION,
    name,
    schemas: Object.freeze({
      input: schema,
      result: schema,
      state: schema,
      dependencies: schema,
      signals: schema,
      queries: schema,
      failures: schema,
    }),
  });
}
