import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { beforeAll, describe, expect, test } from "vitest";

import type {
  ExpressionIR,
  ExtensionIR,
  FunctionIR,
  ProgramContributionIR,
  SourceSpan,
  SystemIR,
  TypeIR,
} from "@/compiler/ir";
import { collectProgramManifest, linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import {
  DependencyFailureError,
  createDependencyCancellation,
  dependencyInvocation,
  dependencyInvocationControl,
  forwardDependencyCancellation,
  invokeDependency,
  type Dependency,
  type DependencyCancellation,
  type DependencyInvocation,
  type DependencyInvocationControl,
} from "@/core/dependency";
import { createMemoryProcessDirectory, startProcessDistribution } from "@/execution/distribution";
import { executePortableFunctionIR } from "@/execution/interpreter";
import {
  createDependencyRequestHandler,
  createMemoryDependencyTransport,
  createRemoteDependency,
} from "@/execution/transport";
import type {
  Workflow,
  WorkflowRegistry,
  WorkflowScheduleDescription,
  WorkflowSourceCompilation,
} from "@/features/workflow";
import type { Child, Parent } from "@/features/workflow/children.typecheck";
import {
  compileWorkflowSource,
  lowerWorkflowAdvanceFunctionIR,
  lowerWorkflowTransferFunctionIR,
  workflowArtifactIR,
  workflowCompilerExtension,
  workflowCompilerIR,
} from "@/features/workflow/compiler";
import {
  advanceWorkflowExecutable,
  replayWorkflowExecutable,
  transferWorkflowExecutable,
} from "@/features/workflow/executor";
import type { Fulfillment, Shipment } from "@/features/workflow/fulfillment.typecheck";
import {
  advanceWorkflowIRExecution,
  createWorkflowIRExecution,
  requestWorkflowIRCancellation,
  resumeWorkflowIRExecution,
  updateWorkflowIRState,
  type WorkflowIRData,
  type WorkflowIRExecution,
} from "@/features/workflow/ir";
import {
  SERVER_COMPILER_IR_VERSION,
  serverCompilerExtension,
  serverProgramExecution,
} from "@/platforms/server/adapter";
import { buildServerProgram } from "@/platforms/server/adapter/rust/compiler";
import {
  buildRustProgram,
  runRustProgram,
} from "@/platforms/server/adapter/rust/fixtures/conformance";
import { defineServerProductionDependency } from "@/platforms/server/adapter/rust/providers";
import { executeServerLinkedProgramIR } from "@/platforms/server/adapter/typescript/runtime";
import { compileSystemFixture } from "@/testing/compiler";
import { createMemoryEventStore } from "@/testing/event-store";

type Search = Dependency<{
  Operations: {
    search(input: Readonly<{ query: string }>): Promise<Readonly<{ evidence: string }>>;
  };
  Heartbeats: {
    search: Readonly<{ completed: number }>;
  };
}>;

type Research = Workflow<{
  Name: "research";
  Id: string;
  Input: Readonly<{
    question: string;
    attempt?: number;
    heartbeat?: number;
    total?: number;
    nonRetryable?: string;
    cancellation?: "wait" | "request" | "abandon";
    continuations?: number;
  }>;
  State: {
    phase: "planning" | "working" | "review" | "completed";
    approved: boolean;
    passes: number;
  };
  Visibility: {
    phase: true;
    approved: true;
    passes: true;
  };
  Result: Readonly<{ report: string }>;
  Dependencies: { search: Search };
  Actions: {
    revise: Workflow.Action<Readonly<{ instruction: string }>, Readonly<{ revised: true }>>;
    approve: Workflow.Action<undefined, Readonly<{ approved: true }>>;
  };
}>;

type Calculation = Dependency<{
  Operations: {
    value(input: Readonly<{ value: number }>): Promise<Readonly<{ value: number }>>;
  };
}>;

type ConcurrentWorkflow = Workflow<{
  Name: "concurrent";
  Id: string;
  Input: Readonly<{ left: number; right: number }>;
  State: { total: number };
  Result: Readonly<{ total: number }>;
  Dependencies: { calculation: Calculation };
  Actions: {};
}>;

type ConcurrentSettledWorkflow = Workflow<{
  Name: "concurrent-settled";
  Id: string;
  Input: Readonly<{ left: number; right: number }>;
  State: { completed: number };
  Result: Readonly<{ completed: number }>;
  Dependencies: { calculation: Calculation };
  Actions: {};
}>;

type ConcurrentRaceWorkflow = Workflow<{
  Name: "concurrent-race";
  Id: string;
  Input: Readonly<{ left: number; right: number }>;
  State: { winner: number };
  Result: Readonly<{ winner: number }>;
  Dependencies: { calculation: Calculation };
  Actions: {};
}>;

type CleanupWork = Dependency<{
  Operations: {
    perform(input: Readonly<{ id: string }>): Promise<Readonly<{ accepted: true }>>;
    release(input: Readonly<{ id: string }>): Promise<Readonly<{ released: true }>>;
  };
}>;

type CleanupWorkflow = Workflow<{
  Name: "cleanup";
  Id: string;
  Input: Readonly<{ id: string }>;
  State: { phase: "working" | "cleaning" | "completed" };
  Result: Readonly<{ completed: true }>;
  Dependencies: { work: CleanupWork };
  Actions: {};
}>;

type UpgradeWorkflow = Workflow<{
  Name: "upgrade";
  Id: string;
  Input: undefined;
  State: { approved: boolean; marker: string };
  Result: Readonly<{ marker: string }>;
  Actions: {
    approve: Workflow.Action<undefined, Readonly<{ approved: true }>>;
  };
}>;

let compiledWorkflowSourceFixture: ReturnType<typeof compileSystem> | undefined;
let compiledWorkflowFixture: ReturnType<typeof compileSystem> | undefined;
let compiledWorkflowIRFixture: ReturnType<typeof compileSystem> | undefined;
let compiledWorkflowCancellationFixture: ReturnType<typeof compileSystem> | undefined;
let compiledWorkflowChildrenFixture: ReturnType<typeof compileSystem> | undefined;
let compiledWorkflowFulfillmentFixture: ReturnType<typeof compileSystem> | undefined;
let compiledDynamicWorkflowFixture: ReturnType<typeof compileSystem> | undefined;

function workflowFixtureSystem(): ReturnType<typeof compileSystem> {
  compiledWorkflowFixture ??= selectWorkflowFixture("research");
  return compiledWorkflowFixture;
}

function workflowCancellationFixtureSystem(): ReturnType<typeof compileSystem> {
  compiledWorkflowCancellationFixture ??= selectWorkflowFixture("cleanup");
  return compiledWorkflowCancellationFixture;
}

function selectWorkflowFixture(root: string): SystemIR {
  compiledWorkflowSourceFixture ??= compileSystemFixture(
    resolve(import.meta.dirname, "feature.typecheck.ts"),
    [serverCompilerExtension, workflowCompilerExtension],
  );
  const owns = (path: string) => path === root || path.startsWith(`${root}.`);
  return {
    ...compiledWorkflowSourceFixture,
    features: compiledWorkflowSourceFixture.features.filter(({ path }) => owns(path)),
    programs: compiledWorkflowSourceFixture.programs.flatMap((program) => {
      const contributions = program.contributions.filter(({ feature }) => owns(feature));
      return contributions.length === 0 ? [] : [{ ...program, contributions }];
    }),
  };
}

function workflowIRFixtureSystem(): ReturnType<typeof compileSystem> {
  compiledWorkflowIRFixture ??= compileSystemFixture(
    resolve(import.meta.dirname, "ir.typecheck.ts"),
    [serverCompilerExtension, workflowCompilerExtension],
  );
  return compiledWorkflowIRFixture;
}

function workflowChildrenFixtureSystem(): ReturnType<typeof compileSystem> {
  compiledWorkflowChildrenFixture ??= compileSystemFixture(
    resolve(import.meta.dirname, "children.typecheck.ts"),
    [serverCompilerExtension, workflowCompilerExtension],
  );
  return compiledWorkflowChildrenFixture;
}

function workflowFulfillmentFixtureSystem(): ReturnType<typeof compileSystem> {
  compiledWorkflowFulfillmentFixture ??= compileSystemFixture(
    resolve(import.meta.dirname, "fulfillment.typecheck.ts"),
    [serverCompilerExtension, workflowCompilerExtension],
  );
  return compiledWorkflowFulfillmentFixture;
}

function dynamicWorkflowFixtureSystem(): ReturnType<typeof compileSystem> {
  compiledDynamicWorkflowFixture ??= compileSystemFixture(
    resolve(import.meta.dirname, "dynamic.typecheck.ts"),
    [serverCompilerExtension, workflowCompilerExtension],
  );
  return compiledDynamicWorkflowFixture;
}

beforeAll(() => {
  workflowFixtureSystem();
}, 60_000);

type AutomationRegistry = WorkflowRegistry<{
  Name: "automations";
  Dependencies: { search: Search };
}>;

type DynamicResearchController = Workflow<{
  Name: "dynamic-research";
  Id: string;
  Input: Readonly<{ question: string }>;
  State: {
    phase: "working" | "review" | "completed";
    approved: boolean;
  };
  Result: Readonly<{ report: string }>;
  Revision: 2;
  Dependencies: { search: Search };
  Actions: {
    approve: Workflow.Action<undefined, Readonly<{ approved: true }>>;
  };
}>;

function dynamicResearchSource(revision: 1 | 2 | 3): string {
  const initialPhase = revision === 3 ? "review" : "working";
  return `
type Search = Dependency<{
  Operations: {
    search(input: Readonly<{ query: string }>): Promise<Readonly<{ evidence: string }>>;
  };
}>;

type DynamicResearch = Workflow<{
  Name: "dynamic-research";
  Id: string;
  Input: Readonly<{ question: string }>;
  State: {
    phase: "working" | "review" | "completed";
    approved: boolean;
  };
  Result: Readonly<{ report: string }>;
  Revision: ${revision};
  Dependencies: { search: Search };
  Actions: {
    approve: Workflow.Action<undefined, Readonly<{ approved: true }>>;
  };
}>;

export default createWorkflow<DynamicResearch>({
  state: () => ({ phase: "${initialPhase}", approved: false }),
  actions: {
    approve({ state }) {
      state.approved = true;
      return { approved: true };
    },
  },
  async run({ input, state, dependencies, wait }) {
    const result = await dependencies.search.search({ query: input.question });
    state.phase = "review";
    await wait(() => state.approved);
    state.phase = "completed";
    return { report: "v${revision}:" + result.evidence };
  },
});
`;
}

const unauthorizedWorkflowSource = `
type Secret = Dependency<{
  Operations: {
    read(input: Readonly<{ key: string }>): Promise<Readonly<{ value: string }>>;
  };
}>;

type Unauthorized = Workflow<{
  Name: "unauthorized";
  Id: string;
  Input: undefined;
  State: {};
  Result: {};
  Dependencies: { secret: Secret };
}>;

export default createWorkflow<Unauthorized>({
  state: () => ({}),
  actions: {},
  async run({ dependencies }) {
    await dependencies.secret.read({ key: "private" });
    return {};
  },
});
`;

test(
  "Workflow lowers to ordinary Feature, Program, and Dependency meaning",
  { tags: ["compiler"], timeout: 10_000 },
  () => {
    const ir = workflowFixtureSystem();
    const server = ir.programs.find(({ name }) => name === "server");

    expect(
      server?.contributions.map((contribution) => {
        const execution = serverProgramExecution(contribution, server);
        return execution.kind === "source"
          ? { kind: execution.kind, diagnostic: execution.diagnostic?.message }
          : { kind: execution.kind };
      }),
    ).toEqual([{ kind: "portable" }, { kind: "portable" }, { kind: "portable" }]);
    expect(
      server?.contributions.flatMap(({ provides }) => provides.map(({ name }) => name)).sort(),
    ).toEqual(["research", "research:workflow", "research:workflow-schedule"]);
    expect(JSON.stringify(ir)).not.toContain('"kind":"workflow"');
    expect(JSON.stringify(ir).length).toBeLessThan(10 * 1024 * 1024);
  },
);

test(
  "lowers a dynamic Workflow registry to ordinary Actor and Dependency meaning",
  { tags: ["compiler"], timeout: 30_000 },
  () => {
    const ir = dynamicWorkflowFixtureSystem();
    const server = ir.programs.find(({ name }) => name === "server");

    expect(
      server?.contributions.flatMap(({ provides }) => provides.map(({ name }) => name)).sort(),
    ).toEqual(["automations", "automations:workflow", "automations:workflow-definitions"]);
    expect(
      server?.contributions.every(
        (contribution) => serverProgramExecution(contribution, server).kind === "portable",
      ),
    ).toBe(true);
    expect(JSON.stringify(ir)).not.toContain('"kind":"workflow"');
  },
);

test(
  "persists dynamic definitions, pins execution meaning, and enforces lifecycle authority",
  { tags: ["compiler"], timeout: 60_000 },
  async () => {
    const server = dynamicWorkflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Dynamic Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    const compiledDependencies: object[] = [];
    const artifactDependencies: object[] = [];
    const artifacts = new Map<string, ReturnType<typeof compileWorkflowSource>>();
    let searches = 0;
    const start = () => {
      const { calendar: _calendar, ...host } = createWorkflowHost(events, alarm.clock);
      return executeServerLinkedProgramIR(linkProgram(server), {
        ...host,
        alarm: alarm.dependency,
        workflowCompiler: directDependency({
          async compile({
            input,
          }: {
            input: Readonly<{ source: string; dependencies: object }>;
          }): Promise<WorkflowSourceCompilation> {
            compiledDependencies.push(input.dependencies);
            try {
              const artifact =
                artifacts.get(input.source) ??
                compileWorkflowSource(input.source, [serverCompilerExtension]);
              artifacts.set(input.source, artifact);
              artifactDependencies.push(artifact.definition.contract.dependencies);
              return {
                status: "compiled",
                artifact,
              };
            } catch (error) {
              return {
                status: "rejected",
                diagnostics: [
                  { message: error instanceof Error ? error.message : "Compilation failed." },
                ],
              };
            }
          },
        }),
        search: directDependency({
          async search({ input }: { input: { query: string } }) {
            searches += 1;
            return { evidence: input.query };
          },
        }),
      });
    };

    let firstArtifact = "";
    {
      await using running = await start();
      const workflows = running.dependencies
        .automations as Workflow.RegistryReference<AutomationRegistry>;
      const created = await workflows.create(
        { source: dynamicResearchSource(1) },
        { idempotencyKey: "create-v1" },
      );
      if (created.status === "rejected") {
        throw new Error(
          `Dynamic Workflow definition was rejected: ${JSON.stringify({
            created,
            compiledDependencies,
            artifactDependencies,
          })}`,
        );
      }
      expect(created).toMatchObject({
        status: "created",
        definition: {
          name: "dynamic-research",
          revisions: [{ revision: 1, status: "current" }],
        },
      });
      firstArtifact = created.definition.current ?? "";
      expect(firstArtifact).toMatch(/^sha256:[0-9a-f]{64}$/);
      await expect(
        workflows.create(
          { source: dynamicResearchSource(1) },
          { idempotencyKey: "create-v1-again" },
        ),
      ).resolves.toMatchObject({ status: "existing" });

      const invalidExecution = workflows.get({ id: "invalid-input" });
      await expect(
        invalidExecution.start(
          { definition: "dynamic-research", input: { question: 42 } },
          { idempotencyKey: "start-invalid" },
        ),
      ).rejects.toThrow("Workflow Input");
      await expect(invalidExecution.state()).resolves.toEqual({
        status: "idle",
        revision: 0,
      });

      const execution = workflows.get({ id: "old-definition" });
      await expect(
        execution.start(
          { definition: "dynamic-research", input: { question: "old" } },
          { idempotencyKey: "start-old" },
        ),
      ).resolves.toEqual({ status: "started", run: 1 });
      const migration = workflows.get({ id: "migrated-definition" });
      await expect(
        migration.start(
          { definition: "dynamic-research", input: { question: "migrated" } },
          { idempotencyKey: "start-migrated" },
        ),
      ).resolves.toEqual({ status: "started", run: 1 });
      await alarm.runDue(running.dependencies);
      await expect(execution.state()).resolves.toMatchObject({
        status: "running",
        state: { phase: "review", approved: false },
      });
      await expect(execution.describe()).resolves.toMatchObject({ artifact: firstArtifact });
      await expect(migration.describe()).resolves.toMatchObject({ artifact: firstArtifact });
    }

    await using restarted = await start();
    const workflows = restarted.dependencies
      .automations as Workflow.RegistryReference<AutomationRegistry>;
    await expect(workflows.definition({ name: "dynamic-research" })).resolves.toMatchObject({
      current: firstArtifact,
      revisions: [{ revision: 1, status: "current" }],
    });
    const revised = await workflows.revise(
      {
        name: "dynamic-research",
        source: dynamicResearchSource(2),
        expected: firstArtifact,
      },
      { idempotencyKey: "revise-v2" },
    );
    if (revised.status === "rejected") {
      throw new Error(`Dynamic Workflow revision was rejected: ${JSON.stringify(revised)}`);
    }
    expect(revised).toMatchObject({
      status: "revised",
      definition: {
        name: "dynamic-research",
        revisions: [
          { revision: 1, status: "superseded" },
          { revision: 2, status: "current" },
        ],
      },
    });
    const secondArtifact = revised.definition.current ?? "";
    expect(secondArtifact).not.toBe(firstArtifact);
    await expect(
      workflows.revise(
        {
          name: "dynamic-research",
          source: dynamicResearchSource(2),
          expected: firstArtifact,
        },
        { idempotencyKey: "stale-revision" },
      ),
    ).resolves.toMatchObject({ status: "existing" });

    const oldExecution = workflows.get({ id: "old-definition" });
    const secondDefinition = {
      name: "dynamic-research",
      artifact: secondArtifact,
    } as Workflow.DynamicDefinition<DynamicResearchController>;
    const migratedExecution = workflows.get({
      id: "migrated-definition",
      definition: secondDefinition,
    });
    const newExecution = workflows.get({
      id: "new-definition",
      definition: secondDefinition,
    });
    await expect(migratedExecution.migrate({ idempotencyKey: "migrate-v1-v2" })).resolves.toEqual({
      status: "migrated",
      from: firstArtifact,
      to: secondArtifact,
    });
    await expect(migratedExecution.describe()).resolves.toMatchObject({
      artifact: secondArtifact,
    });
    await expect(
      newExecution.start({ input: { question: "new" } }, { idempotencyKey: "start-new" }),
    ).resolves.toEqual({ status: "started", run: 1 });
    await alarm.runDue(restarted.dependencies);
    const incompatible = await workflows.revise(
      {
        name: "dynamic-research",
        source: dynamicResearchSource(3),
        expected: secondArtifact,
      },
      { idempotencyKey: "revise-v3" },
    );
    if (incompatible.status === "rejected") {
      throw new Error(
        `Dynamic Workflow incompatible revision was rejected: ${JSON.stringify(incompatible)}`,
      );
    }
    expect(incompatible).toMatchObject({ status: "revised" });
    const thirdArtifact = incompatible.definition.current ?? "";
    const thirdDefinition = {
      name: "dynamic-research",
      artifact: thirdArtifact,
    } as Workflow.DynamicDefinition<DynamicResearchController>;
    const incompatibleExecution = workflows.get({
      id: "new-definition",
      definition: thirdDefinition,
    });
    await expect(
      incompatibleExecution.migrate({ idempotencyKey: "migrate-v2-v3" }),
    ).resolves.toMatchObject({
      status: "incompatible",
      from: secondArtifact,
      to: thirdArtifact,
      reason: expect.stringContaining("State initialization"),
    });
    await expect(newExecution.describe()).resolves.toMatchObject({
      artifact: secondArtifact,
    });
    await expect(
      oldExecution.action(
        { name: "approve", input: { unexpected: true } },
        { idempotencyKey: "approve-invalid" },
      ),
    ).rejects.toThrow("Workflow Action");
    await oldExecution.action(
      { name: "approve", wait: "completed" },
      { idempotencyKey: "approve-old" },
    );
    await newExecution.action(
      { name: "approve", wait: "completed" },
      { idempotencyKey: "approve-new" },
    );
    await migratedExecution.action(
      { name: "approve", wait: "completed" },
      { idempotencyKey: "approve-migrated" },
    );
    await expect(oldExecution.result()).resolves.toEqual({
      status: "succeeded",
      value: { report: "v1:old" },
    });
    await expect(newExecution.join()).resolves.toEqual({
      status: "succeeded",
      value: { report: "v2:new" },
    });
    await expect(migratedExecution.result()).resolves.toEqual({
      status: "succeeded",
      value: { report: "v2:migrated" },
    });
    await expect(oldExecution.describe()).resolves.toMatchObject({ artifact: firstArtifact });
    await expect(newExecution.describe()).resolves.toMatchObject({ artifact: secondArtifact });

    const retired = await workflows.retire(
      { name: "dynamic-research", expected: thirdArtifact },
      { idempotencyKey: "retire-v3" },
    );
    expect(retired).toMatchObject({ status: "retired" });
    expect(retired.definition.current).toBeUndefined();
    await expect(
      workflows
        .get({ id: "after-retirement" })
        .start(
          { definition: "dynamic-research", input: { question: "retired" } },
          { idempotencyKey: "start-retired" },
        ),
    ).resolves.toEqual({
      status: "missing-definition",
      definition: "dynamic-research",
    });
    await expect(
      workflows.delete(
        { name: "dynamic-research", artifact: thirdArtifact },
        { idempotencyKey: "delete-v3" },
      ),
    ).resolves.toMatchObject({ status: "deleted" });
    await expect(
      workflows.delete(
        { name: "dynamic-research", artifact: secondArtifact },
        { idempotencyKey: "delete-v2" },
      ),
    ).resolves.toMatchObject({ status: "deleted" });
    await expect(workflows.definitions()).resolves.toMatchObject({
      definitions: [
        {
          name: "dynamic-research",
          revisions: [{ artifact: firstArtifact, revision: 1 }],
        },
      ],
      done: true,
    });
    expect(compiledDependencies).toEqual([
      { search: expect.any(Object) },
      { search: expect.any(Object) },
      { search: expect.any(Object) },
      { search: expect.any(Object) },
      { search: expect.any(Object) },
    ]);
    expect(searches).toBe(3);
  },
);

test(
  "rejects unauthorized, invalid, forged, and excessive dynamic Workflow source",
  { tags: ["compiler"], timeout: 30_000 },
  async () => {
    const server = dynamicWorkflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Dynamic Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    let compilerCalls = 0;
    const { calendar: _calendar, ...host } = createWorkflowHost(events, alarm.clock);
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...host,
      alarm: alarm.dependency,
      workflowCompiler: directDependency({
        async compile({
          input,
        }: {
          input: Readonly<{ source: string }>;
        }): Promise<WorkflowSourceCompilation> {
          compilerCalls += 1;
          if (input.source === "forged") {
            return { status: "compiled", artifact: {} };
          }
          try {
            return {
              status: "compiled",
              artifact: compileWorkflowSource(input.source, [serverCompilerExtension]),
            };
          } catch (error) {
            return {
              status: "rejected",
              diagnostics: [
                { message: error instanceof Error ? error.message : "Compilation failed." },
              ],
            };
          }
        },
      }),
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const workflows = running.dependencies
      .automations as Workflow.RegistryReference<AutomationRegistry>;

    await expect(
      workflows.create({ source: unauthorizedWorkflowSource }, { idempotencyKey: "unauthorized" }),
    ).resolves.toMatchObject({
      status: "rejected",
      diagnostics: [{ message: expect.stringContaining("was not delegated") }],
    });
    await expect(
      workflows.create(
        { source: 'import value from "somewhere";\nexport default value;' },
        { idempotencyKey: "import" },
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      diagnostics: [{ message: expect.stringContaining("cannot import modules") }],
    });
    await expect(
      workflows.create({ source: "forged" }, { idempotencyKey: "forged" }),
    ).resolves.toMatchObject({
      status: "rejected",
      diagnostics: [{ message: "The Workflow compiler returned an invalid artifact." }],
    });
    const callsBeforeLimit = compilerCalls;
    await expect(
      workflows.create({ source: " ".repeat(262_145) }, { idempotencyKey: "source-limit" }),
    ).resolves.toEqual({
      status: "rejected",
      diagnostics: [{ message: "Workflow source exceeds the 262144 character limit." }],
    });
    expect(compilerCalls).toBe(callsBeforeLimit);
    await expect(workflows.definitions()).resolves.toEqual({
      cursor: 0,
      definitions: [],
      done: true,
    });
  },
);

test(
  "lowers typed continuation to one canonical Workflow transfer",
  { tags: ["compiler"], timeout: 10_000 },
  () => {
    const system = workflowFixtureSystem();
    const feature = system.features.find(({ path }) => path === "research");
    const definition = workflowCompilerIR(feature?.extensions?.workflow);
    const continuations = definition.blocks.filter(
      ({ terminator }) => terminator.kind === "continue-as-new",
    );

    expect(continuations).toHaveLength(1);
    expect(continuations[0]?.terminator).toMatchObject({
      kind: "continue-as-new",
      input: { kind: "record-merge" },
    });
  },
);

test(
  "lowers typed Workflow references to canonical child commands",
  { tags: ["compiler"], timeout: 30_000 },
  () => {
    const system = workflowChildrenFixtureSystem();
    const parent = system.features.find(({ path }) => path === "parent");
    const definition = workflowCompilerIR(parent?.extensions?.workflow);

    expect(definition.contract.children).toEqual(["child"]);
    expect(
      definition.blocks
        .map(({ terminator }) => terminator)
        .filter((terminator) => terminator.kind === "child")
        .map(({ dependency, operation }) => ({ dependency, operation })),
    ).toEqual([
      { dependency: "child", operation: "start" },
      { dependency: "child", operation: "approve" },
      { dependency: "child", operation: "$join" },
    ]);
  },
);

test(
  "executes static and retained Workflow state machines in generated Rust",
  { tags: ["compiler", "native"], timeout: 180_000 },
  async () => {
    const system = workflowFixtureSystem();
    const feature = system.features.find(({ path }) => path === "research");
    const definition = workflowCompilerIR(feature?.extensions?.workflow);
    const server = system.programs.find(({ name }) => name === "server");
    const retainedExecution = server?.contributions
      .map((contribution) => serverProgramExecution(contribution, server))
      .find(
        (execution) =>
          execution.kind === "portable" &&
          execution.functions.some(({ name }) => name === "advanceWorkflowExecutable"),
      );
    if (retainedExecution?.kind !== "portable") {
      throw new Error("Workflow fixture has no retained executable interpreter.");
    }
    const retainedAdvance = retainedExecution.functions.find(
      ({ name }) => name === "advanceWorkflowExecutable",
    );
    if (!retainedAdvance) {
      throw new Error("Workflow retained executable interpreter is missing.");
    }
    const retainedReplay = retainedExecution.functions.find(
      ({ name }) => name === "replayWorkflowExecutable",
    );
    if (!retainedReplay) {
      throw new Error("Workflow retained executable replay verifier is missing.");
    }
    const retainedTransfer = retainedExecution.functions.find(
      ({ name }) => name === "transferWorkflowExecutable",
    );
    if (!retainedTransfer) {
      throw new Error("Workflow retained executable transfer is missing.");
    }
    const retainedArtifact = workflowArtifactIR(definition);
    const initial = createWorkflowIRExecution(
      definition,
      {
        question: "Generated Rust state machine",
        attempt: 60_000,
        total: 120_000,
        cancellation: "request",
      },
      {
        phase: "planning",
        approved: false,
        passes: 0,
        observedAt: 0,
        timedOut: false,
      },
      0,
    );
    const expected = advanceWorkflowIRExecution(definition, JSON.parse(JSON.stringify(initial)));
    const retainedExpected = advanceWorkflowExecutable(
      retainedArtifact.executable,
      JSON.parse(JSON.stringify(initial)) as object,
    );
    const migrationArtifact = workflowArtifactIR({
      ...definition,
      contract: { ...definition.contract, revision: 2 },
    });
    const migrationTrace = {
      input: initial.input,
      time: initial.time,
      initialState: initial.state,
      steps: [
        {
          kind: "advance",
          history: initial.history,
        },
      ],
      expected,
    };
    const migrationExpected = replayWorkflowExecutable(
      migrationArtifact.executable,
      migrationTrace,
    );
    const continuationInitial = createWorkflowIRExecution(
      definition,
      {
        question: "Generated Rust continuation",
        continuations: 1,
      },
      {
        phase: "planning",
        approved: false,
        passes: 0,
        observedAt: 0,
        timedOut: false,
      },
      0,
    );
    const continued = advanceWorkflowIRExecution(
      definition,
      JSON.parse(JSON.stringify(continuationInitial)),
    );
    const executionType = { kind: "opaque", name: "WorkflowExecution" } as const;
    const span = { file: "workflow-rust-conformance.ts", line: 1, column: 1 };
    const advance = lowerWorkflowAdvanceFunctionIR(definition, executionType, executionType, span);
    const transfer = lowerWorkflowTransferFunctionIR(
      definition,
      executionType,
      { kind: "opaque", name: "WorkflowTransfer" },
      executionType,
      span,
    );
    const conformanceScenarios: Array<{
      function: FunctionIR;
      arguments: ExpressionIR[];
      expected: object;
    }> = [];
    const addAdvanceParity = (
      artifact: ReturnType<typeof workflowArtifactIR>,
      staticAdvance: FunctionIR,
      staticInput: WorkflowIRExecution,
      parityExpected: WorkflowIRExecution,
      retainedInput: WorkflowIRExecution = staticInput,
    ) => {
      expect(advanceWorkflowExecutable(artifact.executable, retainedInput)).toEqual(parityExpected);
      conformanceScenarios.push(
        {
          function: staticAdvance,
          arguments: [workflowPortableData(staticInput as unknown as ExtensionIR, span)],
          expected: parityExpected,
        },
        {
          function: retainedAdvance,
          arguments: [
            workflowPortableData(artifact.executable as unknown as ExtensionIR, span),
            workflowPortableData(retainedInput as unknown as ExtensionIR, span),
          ],
          expected: parityExpected,
        },
      );
    };
    const addTransferParity = (
      artifact: ReturnType<typeof workflowArtifactIR>,
      staticTransfer: FunctionIR,
      input: WorkflowIRExecution,
      frameTransfer: object,
      parityExpected: WorkflowIRExecution,
    ) => {
      expect(transferWorkflowExecutable(artifact.executable, input, frameTransfer)).toEqual(
        parityExpected,
      );
      conformanceScenarios.push(
        {
          function: staticTransfer,
          arguments: [
            workflowPortableData(input as unknown as ExtensionIR, span),
            workflowPortableData(frameTransfer as ExtensionIR, span),
          ],
          expected: parityExpected,
        },
        {
          function: retainedTransfer,
          arguments: [
            workflowPortableData(artifact.executable as unknown as ExtensionIR, span),
            workflowPortableData(input as unknown as ExtensionIR, span),
            workflowPortableData(frameTransfer as ExtensionIR, span),
          ],
          expected: parityExpected,
        },
      );
    };
    addAdvanceParity(retainedArtifact, advance, initial, expected);
    expect(retainedExpected).toEqual(expected);

    const waiting = expected.pending;
    if (waiting?.kind !== "wait" || waiting.until === undefined) {
      throw new Error("Expected generated Workflow wait.");
    }
    const approvedInput = updateWorkflowIRState(JSON.parse(JSON.stringify(expected)), {
      ...expected.state,
      approved: true,
    });
    const approved = advanceWorkflowIRExecution(
      definition,
      JSON.parse(JSON.stringify(approvedInput)),
    );
    addAdvanceParity(retainedArtifact, advance, approvedInput, approved);

    const timeoutFrame = JSON.parse(JSON.stringify(expected)) as WorkflowIRExecution;
    const { pending: _waiting, ...timeoutRunning } = timeoutFrame;
    const timeoutInput: WorkflowIRExecution = {
      ...timeoutRunning,
      status: "running",
      time: waiting.until,
      block: waiting.next,
      locals: {
        ...timeoutFrame.locals,
        [waiting.result]: false,
      },
    };
    const timedOut = resumeWorkflowIRExecution(definition, JSON.parse(JSON.stringify(expected)), {
      kind: "wait",
      sequence: waiting.sequence,
      at: waiting.until,
      timedOut: true,
    });
    addAdvanceParity(retainedArtifact, advance, timeoutInput, timedOut);

    const sleep = approved.pending;
    if (sleep?.kind !== "sleep") throw new Error("Expected generated Workflow sleep.");
    const sleepFrame = JSON.parse(JSON.stringify(approved)) as WorkflowIRExecution;
    const { pending: _sleep, ...sleepRunning } = sleepFrame;
    const sleepInput: WorkflowIRExecution = {
      ...sleepRunning,
      status: "running",
      time: sleep.at,
      block: sleep.next,
    };
    const working = resumeWorkflowIRExecution(definition, JSON.parse(JSON.stringify(approved)), {
      kind: "sleep",
      sequence: sleep.sequence,
      at: sleep.at,
    });
    addAdvanceParity(retainedArtifact, advance, sleepInput, working);

    const work = working.pending;
    if (work?.kind !== "effect") throw new Error("Expected generated Workflow effect.");
    const completedFrame = JSON.parse(JSON.stringify(working)) as WorkflowIRExecution;
    const { pending: _work, ...completionRunning } = completedFrame;
    const completionInput: WorkflowIRExecution = {
      ...completionRunning,
      status: "running",
      time: sleep.at + 5,
      block: work.next,
      locals: {
        ...completedFrame.locals,
        [work.result]: { evidence: "Generated Rust evidence" },
      },
    };
    const completed = resumeWorkflowIRExecution(definition, JSON.parse(JSON.stringify(working)), {
      kind: "effect",
      sequence: work.sequence,
      at: sleep.at + 5,
      outcome: {
        status: "succeeded",
        value: { evidence: "Generated Rust evidence" },
      },
    });
    addAdvanceParity(retainedArtifact, advance, completionInput, completed);

    const providerFailure = { name: "ProviderFailure", message: "provider failed" };
    const effectFailure = {
      type: "effect",
      dependency: work.dependency,
      operation: work.operation,
      failure: providerFailure,
    };
    const failed = resumeWorkflowIRExecution(definition, JSON.parse(JSON.stringify(working)), {
      kind: "effect",
      sequence: work.sequence,
      at: sleep.at + 6,
      outcome: { status: "failed", failure: providerFailure },
    });
    addTransferParity(
      retainedArtifact,
      transfer,
      {
        ...JSON.parse(JSON.stringify(working)),
        time: sleep.at + 6,
      },
      { kind: "fail", failure: effectFailure },
      failed,
    );

    conformanceScenarios.push({
      function: retainedReplay,
      arguments: [
        workflowPortableData(migrationArtifact.executable as unknown as ExtensionIR, span),
        workflowPortableData(migrationTrace as unknown as ExtensionIR, span),
      ],
      expected: migrationExpected,
    });
    addAdvanceParity(retainedArtifact, advance, continuationInitial, continued);
    const cleanupSystem = workflowCancellationFixtureSystem();
    const cleanupFeature = cleanupSystem.features.find(({ path }) => path === "cleanup");
    const cleanupDefinition = workflowCompilerIR(cleanupFeature?.extensions?.workflow);
    const cleanupArtifact = workflowArtifactIR(cleanupDefinition);
    const cleanupInitial = createWorkflowIRExecution(
      cleanupDefinition,
      { id: "native-cleanup" },
      { phase: "working" },
      0,
    );
    const cleanupWorking = advanceWorkflowIRExecution(
      cleanupDefinition,
      JSON.parse(JSON.stringify(cleanupInitial)),
    );
    const cancellation = { at: 1, reason: { type: "native-test" } } as const;
    const cleanupCancelling = requestWorkflowIRCancellation(
      cleanupDefinition,
      JSON.parse(JSON.stringify(cleanupWorking)),
      cancellation,
    );
    const cleanupAdvance = lowerWorkflowAdvanceFunctionIR(
      cleanupDefinition,
      executionType,
      executionType,
      span,
    );
    const cleanupTransfer = lowerWorkflowTransferFunctionIR(
      cleanupDefinition,
      executionType,
      { kind: "opaque", name: "WorkflowTransfer" },
      executionType,
      span,
    );
    addAdvanceParity(cleanupArtifact, cleanupAdvance, cleanupInitial, cleanupWorking);
    const childrenSystem = workflowChildrenFixtureSystem();
    const parentFeature = childrenSystem.features.find(({ path }) => path === "parent");
    const parentDefinition = workflowCompilerIR(parentFeature?.extensions?.workflow);
    const parentArtifact = workflowArtifactIR(parentDefinition);
    const parentInitial = createWorkflowIRExecution(
      parentDefinition,
      {
        child: "native-child",
        value: 7,
        mode: "join",
        parentClose: "cancel",
        cancellation: "wait",
      },
      { child: "native-child" },
      0,
    );
    const parentStarted = advanceWorkflowIRExecution(
      parentDefinition,
      JSON.parse(JSON.stringify(parentInitial)),
    );
    const parentAdvance = lowerWorkflowAdvanceFunctionIR(
      parentDefinition,
      executionType,
      executionType,
      span,
    );
    addAdvanceParity(parentArtifact, parentAdvance, parentInitial, parentStarted);
    const concurrencyCases = [
      {
        path: "concurrent",
        input: { left: 2, right: 5 },
        state: { total: 0 },
        completions: [
          {
            sequence: 1,
            at: 1,
            outcome: { status: "succeeded", value: { value: 5 } },
          },
          {
            sequence: 0,
            at: 2,
            outcome: { status: "succeeded", value: { value: 2 } },
          },
        ],
      },
      {
        path: "concurrentSettled",
        input: { left: -1, right: 5 },
        state: { completed: 0 },
        completions: [
          {
            sequence: 0,
            at: 1,
            outcome: {
              status: "failed",
              failure: { name: "ExpectedBranchFailure", message: "expected branch failure" },
            },
          },
          {
            sequence: 1,
            at: 2,
            outcome: { status: "succeeded", value: { value: 5 } },
          },
        ],
      },
      {
        path: "concurrentRace",
        input: { left: 2, right: 5 },
        state: { winner: 0 },
        completions: [
          {
            sequence: 1,
            at: 1,
            outcome: { status: "succeeded", value: { value: 5 } },
          },
        ],
      },
    ] as const;
    const concurrencySystem = workflowIRFixtureSystem();
    for (const concurrencyCase of concurrencyCases) {
      const concurrentFeature = concurrencySystem.features.find(
        ({ path }) => path === concurrencyCase.path,
      );
      const concurrentDefinition = workflowCompilerIR(concurrentFeature?.extensions?.workflow);
      const concurrentArtifact = workflowArtifactIR(concurrentDefinition);
      const concurrentInitial = createWorkflowIRExecution(
        concurrentDefinition,
        concurrencyCase.input,
        concurrencyCase.state,
        0,
      );
      let concurrentExecution = advanceWorkflowIRExecution(
        concurrentDefinition,
        JSON.parse(JSON.stringify(concurrentInitial)),
      );
      const concurrentSteps: object[] = [
        {
          kind: "advance",
          history: concurrentInitial.history,
        },
      ];
      const concurrentAdvance = lowerWorkflowAdvanceFunctionIR(
        concurrentDefinition,
        executionType,
        executionType,
        span,
      );
      addAdvanceParity(
        concurrentArtifact,
        concurrentAdvance,
        concurrentInitial,
        concurrentExecution,
      );
      for (const completion of concurrencyCase.completions) {
        const pending = concurrentExecution.pending;
        if (pending?.kind !== "concurrent") {
          throw new Error(`Workflow ${concurrencyCase.path} lost its concurrent frame.`);
        }
        const command = JSON.parse(JSON.stringify(pending)) as object;
        const effect = pending.effects.find(({ sequence }) => sequence === completion.sequence);
        if (effect === undefined) {
          throw new Error(`Workflow ${concurrencyCase.path} has no concurrent effect.`);
        }
        const replayOutcome =
          completion.outcome.status === "succeeded"
            ? completion.outcome
            : {
                status: "failed" as const,
                failure: {
                  type: "effect" as const,
                  dependency: effect.dependency,
                  operation: effect.operation,
                  failure: completion.outcome.failure,
                },
              };
        concurrentSteps.push({
          kind: "effect",
          command,
          sequence: completion.sequence,
          at: completion.at,
          outcome: replayOutcome,
        });
        const completedEffects = pending.effects.map((candidate) =>
          candidate.sequence !== completion.sequence
            ? candidate
            : completion.outcome.status === "succeeded"
              ? {
                  ...candidate,
                  status: "succeeded" as const,
                  value: completion.outcome.value,
                }
              : {
                  ...candidate,
                  status: "failed" as const,
                  failure: {
                    type: "effect" as const,
                    dependency: effect.dependency,
                    operation: effect.operation,
                    failure: completion.outcome.failure,
                  },
                },
        );
        const concurrentInput: WorkflowIRExecution = {
          ...JSON.parse(JSON.stringify(concurrentExecution)),
          time: completion.at,
          pending: {
            ...JSON.parse(JSON.stringify(pending)),
            effects: completedEffects,
          },
        };
        const concurrentExpected = resumeWorkflowIRExecution(
          concurrentDefinition,
          JSON.parse(JSON.stringify(concurrentExecution)),
          {
            kind: "concurrent",
            sequence: completion.sequence,
            at: completion.at,
            outcome: completion.outcome,
          },
        );
        const settled = completedEffects.filter(({ status }) => status !== "pending");
        let staticInput = concurrentInput;
        if (
          (pending.operation === "race" && settled.length > 0) ||
          (pending.operation !== "race" && settled.length === completedEffects.length)
        ) {
          const { pending: _concurrent, ...running } = concurrentInput;
          const requiredValue = (value: WorkflowIRData | undefined): WorkflowIRData => {
            if (value === undefined) {
              throw new Error(`Workflow ${concurrencyCase.path} has no concurrent result.`);
            }
            return value;
          };
          const values: WorkflowIRData =
            pending.operation === "race"
              ? requiredValue(settled[0]?.value)
              : pending.operation === "all"
                ? completedEffects.map(({ value }) => requiredValue(value))
                : completedEffects.map(
                    (completedEffect): WorkflowIRData =>
                      completedEffect.status === "succeeded"
                        ? {
                            status: "fulfilled",
                            ...(completedEffect.value === undefined
                              ? {}
                              : { value: completedEffect.value }),
                          }
                        : {
                            status: "rejected",
                            reason: completedEffect.failure as unknown as WorkflowIRData,
                          },
                  );
          staticInput = {
            ...running,
            status: "running",
            block: pending.next,
            locals: {
              ...concurrentInput.locals,
              [pending.result]: values,
            },
          };
        }
        addAdvanceParity(
          concurrentArtifact,
          concurrentAdvance,
          staticInput,
          concurrentExpected,
          concurrentInput,
        );
        concurrentExecution = concurrentExpected;
      }
      if (concurrentExecution.status === "suspended") {
        throw new Error(`Workflow ${concurrencyCase.path} did not settle.`);
      }
      concurrentSteps.push({
        kind: "advance",
        history: concurrentExecution.history,
      });
      const concurrentTrace = {
        input: concurrencyCase.input,
        time: concurrentInitial.time,
        initialState: concurrencyCase.state,
        steps: concurrentSteps,
        expected: concurrentExecution,
      };
      const replayed = replayWorkflowExecutable(concurrentArtifact.executable, concurrentTrace);
      conformanceScenarios.push({
        function: retainedReplay,
        arguments: [
          workflowPortableData(concurrentArtifact.executable as unknown as ExtensionIR, span),
          workflowPortableData(concurrentTrace as unknown as ExtensionIR, span),
        ],
        expected: replayed,
      });
    }
    const cancellationInput = {
      ...JSON.parse(JSON.stringify(cleanupWorking)),
      time: cancellation.at,
      cancellation,
    } as WorkflowIRExecution;
    const cleanupPending = cleanupCancelling.pending;
    if (cleanupPending?.kind !== "effect") {
      throw new Error("Expected generated cleanup effect.");
    }
    const cleanupCompleted = resumeWorkflowIRExecution(
      cleanupDefinition,
      JSON.parse(JSON.stringify(cleanupCancelling)),
      {
        kind: "effect",
        sequence: cleanupPending.sequence,
        at: 2,
        outcome: { status: "succeeded", value: { released: true } },
      },
    );
    const { pending: _cleanupPending, ...cleanupFrame } = JSON.parse(
      JSON.stringify(cleanupCancelling),
    ) as WorkflowIRExecution;
    const cleanupResumed: WorkflowIRExecution = {
      ...cleanupFrame,
      status: "running",
      time: 2,
      block: cleanupPending.next,
      locals: {
        ...cleanupCancelling.locals,
        [cleanupPending.result]: { released: true },
      },
    };
    expect(
      (
        await executePortableFunctionIR({
          entry: cleanupTransfer,
          arguments: [
            JSON.parse(JSON.stringify(cancellationInput)),
            { kind: "cancel", cancellation },
          ],
        })
      ).result,
    ).toEqual(cleanupCancelling);
    addTransferParity(
      cleanupArtifact,
      cleanupTransfer,
      cancellationInput,
      { kind: "cancel", cancellation },
      cleanupCancelling,
    );
    addAdvanceParity(cleanupArtifact, cleanupAdvance, cleanupResumed, cleanupCompleted);
    const contribution = workflowAdvanceConformanceContribution(
      conformanceScenarios,
      executionType,
      span,
      [
        ...workflowReachableFunctions(retainedAdvance, retainedExecution.functions),
        ...workflowReachableFunctions(retainedTransfer, retainedExecution.functions),
        ...workflowReachableFunctions(retainedReplay, retainedExecution.functions),
      ],
    );
    const directory = await mkdtemp(resolve(tmpdir(), "kit-workflow-advance-"));
    try {
      const executable = resolve(directory, "workflow-advance");
      await buildRustProgram(contribution, executable);
      const result = (await runRustProgram(executable, {
        responses: {
          "recorder.record": Array.from({ length: conformanceScenarios.length }, () => ({
            ok: null,
          })),
        },
      })) as Readonly<{
        calls: readonly Readonly<{ input: unknown }>[];
        result: unknown;
      }>;
      expect(result.result).toEqual({ ok: null });
      const expectedCalls = conformanceScenarios.map(({ expected: input }) => ({
        dependency: "recorder",
        operation: "record",
        input,
      }));
      expect(result.calls).toHaveLength(expectedCalls.length);
      for (const [index, expectedCall] of expectedCalls.entries()) {
        expect(result.calls[index], `generated Workflow scenario ${index}`).toEqual(expectedCall);
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

function workflowReachableFunctions(
  root: FunctionIR,
  candidates: readonly FunctionIR[],
): readonly FunctionIR[] {
  const available = new Map(candidates.map((function_) => [function_.id, function_]));
  const selected = new Map<string, FunctionIR>();
  const pending = [root.id];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || selected.has(id)) continue;
    const function_ = available.get(id);
    if (!function_) throw new Error(`Missing portable Workflow helper ${id}.`);
    selected.set(id, function_);
    const references = new Set<string>();
    collectPortableFunctionReferences(function_.body, references);
    for (const reference of references) {
      if (!selected.has(reference)) pending.push(reference);
    }
  }
  return [...selected.values()];
}

function collectPortableFunctionReferences(value: unknown, references: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPortableFunctionReferences(item, references);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    (record.kind === "call" || record.kind === "closure") &&
    typeof record.function === "string"
  ) {
    references.add(record.function);
  }
  for (const item of Object.values(record)) {
    collectPortableFunctionReferences(item, references);
  }
}

function workflowAdvanceConformanceContribution(
  scenarios: readonly Readonly<{
    function: FunctionIR;
    arguments: readonly ExpressionIR[];
  }>[],
  executionType: TypeIR,
  span: SourceSpan,
  support: readonly FunctionIR[] = [],
): ProgramContributionIR {
  const voidType: TypeIR = { kind: "primitive", name: "void" };
  const recorderType: TypeIR = {
    kind: "record",
    fields: [
      {
        name: "record",
        optional: false,
        type: {
          kind: "function",
          parameters: [{ name: "input", optional: false, type: executionType }],
          result: { kind: "promise", value: voidType },
        },
      },
    ],
  };
  const argumentUses = new Map<string, Readonly<{ expression: ExpressionIR; count: number }>>();
  for (const scenario of scenarios) {
    for (const argument of scenario.arguments) {
      const key = JSON.stringify(argument);
      const existing = argumentUses.get(key);
      argumentUses.set(key, {
        expression: existing?.expression ?? argument,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }
  const sharedArguments = new Map<string, string>();
  const sharedDeclarations: FunctionIR["body"][number][] = [];
  for (const [key, { expression, count }] of argumentUses) {
    if (count < 2 || !workflowExecutableArgument(expression)) continue;
    const name = `scenario${sharedArguments.size}`;
    sharedArguments.set(key, name);
    sharedDeclarations.push({
      kind: "let",
      name,
      mutable: false,
      value: expression,
      span,
    });
  }
  const scenarioArgument = (argument: ExpressionIR): ExpressionIR => {
    const name = sharedArguments.get(JSON.stringify(argument));
    return name === undefined
      ? argument
      : {
          kind: "local",
          name,
          type: argument.type,
          span,
        };
  };
  const entry: FunctionIR = {
    id: "start",
    name: "start",
    asynchronous: true,
    captures: [],
    parameters: [],
    result: voidType,
    body: [
      ...sharedDeclarations,
      ...scenarios.map(
        (scenario): Extract<FunctionIR["body"][number], { kind: "expression" }> => ({
          kind: "expression",
          expression: {
            kind: "dependency-call",
            dependency: "recorder",
            operation: "record",
            arguments: [
              {
                kind: "call",
                function: scenario.function.id,
                arguments: scenario.arguments.map(scenarioArgument),
                awaited: false,
                type: executionType,
                span,
              },
            ],
            awaited: true,
            type: { kind: "promise", value: voidType },
            span,
          },
          span,
        }),
      ),
      {
        kind: "return",
        value: { kind: "none", type: voidType, span },
        span,
      },
    ],
    span,
  };
  return {
    id: "feature/workflow-advance/program/server",
    feature: "workflow-advance",
    requires: [{ name: "recorder", type: recorderType }],
    provides: [],
    extensions: {
      server: {
        version: SERVER_COMPILER_IR_VERSION,
        execution: {
          kind: "portable",
          entry,
          functions: [
            ...new Map(
              [...support, ...scenarios.map(({ function: scenario }) => scenario)].map(
                (function_) => [function_.id, function_],
              ),
            ).values(),
          ],
        },
      } as unknown as ExtensionIR,
    },
    span,
  };
}

function workflowExecutableArgument(expression: ExpressionIR): boolean {
  if (expression.kind !== "record") return false;
  const fields = new Set(expression.fields.map(({ name }) => name));
  return (
    fields.has("version") &&
    fields.has("revision") &&
    fields.has("initialization") &&
    fields.has("actionHandlers") &&
    fields.has("run")
  );
}

function workflowPortableData(value: ExtensionIR, span: SourceSpan): ExpressionIR {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return {
      kind: "literal",
      value,
      type:
        value === null
          ? { kind: "primitive", name: "null" }
          : typeof value === "boolean"
            ? { kind: "primitive", name: "boolean" }
            : typeof value === "number"
              ? { kind: "primitive", name: "number" }
              : { kind: "primitive", name: "string" },
      span,
    };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      values: value.map((item) => workflowPortableData(item, span)),
      type: { kind: "array", element: { kind: "opaque", name: "WorkflowData" } },
      span,
    };
  }
  return {
    kind: "record",
    fields: Object.entries(value).map(([name, item]) => ({
      name,
      value: workflowPortableData(item, span),
    })),
    type: { kind: "opaque", name: "WorkflowData" },
    span,
  };
}

test(
  "matches Actor-backed Workflow journals and outcomes in generated Rust",
  { tags: ["production"], timeout: 360_000 },
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-workflow-native-"));
    try {
      const source = resolve(directory, "src/system.ts");
      await mkdir(resolve(directory, "src"), { recursive: true });
      await writeFile(
        resolve(directory, "tsconfig.json"),
        JSON.stringify({
          extends: resolve(import.meta.dirname, "../../../tsconfig.json"),
          compilerOptions: {
            paths: { "@/*": [resolve(import.meta.dirname, "../../*")] },
            types: [],
          },
        }),
      );
      await writeFile(source, workflowNativeFixtureSource());
      const ir = compileSystem(source, [serverCompilerExtension, workflowCompilerExtension]);
      const program = ir.programs.find(({ name }) => name === "server");
      if (!program) throw new Error("Workflow fixture has no server Program.");
      const build = await buildServerProgram({
        system: ir.system.name,
        ir,
        dependencies: [
          defineServerProductionDependency({
            name: "workflow-search-fixture",
            dependency: "search",
            configuration: [
              { name: "output", environment: "KIT_RECORDER_OUTPUT", required: true },
              { name: "input", environment: "KIT_RECORDER_INPUT", required: true },
            ],
            crate: {
              package: "kit-server-recorder",
              directory: resolve(
                import.meta.dirname,
                "../../platforms/server/adapter/rust/fixtures/recorder",
              ),
            },
            rust: {
              type: "kit_server_recorder::Recorder",
              constructor: "kit_server_recorder::create",
            },
          }),
          defineServerProductionDependency({
            name: "workflow-recorder-fixture",
            dependency: "recorder",
            configuration: [
              { name: "output", environment: "KIT_RECORDER_OUTPUT", required: true },
              { name: "input", environment: "KIT_RECORDER_INPUT", required: true },
            ],
            crate: {
              package: "kit-server-recorder",
              directory: resolve(
                import.meta.dirname,
                "../../platforms/server/adapter/rust/fixtures/recorder",
              ),
            },
            rust: {
              type: "kit_server_recorder::Recorder",
              constructor: "kit_server_recorder::create",
            },
          }),
        ],
        directory,
        output: resolve(directory, "workflow-server"),
        profile: "release",
        program,
      });

      await expect(access(build.executable)).resolves.toBeUndefined();
      expect(build.profile).toBe("release");
      const reference: unknown[] = [];
      const events = createMemoryEventStore<object>();
      const alarm = createManualAlarm();
      let providerStarted = false;
      let providerCancelled = false;
      await using _execution = await executeServerLinkedProgramIR(linkProgram(program), {
        ...createWorkflowHost(events, alarm.clock),
        alarm: alarm.dependency,
        search: directDependency({
          async search({
            input,
            invocation,
          }: {
            input: { query: string };
            invocation: { cancellation: DependencyCancellation };
          }) {
            if (input.query === "cancel") {
              providerStarted = true;
              await invocation.cancellation.wait();
              providerCancelled = true;
              return { answer: "cancelled" };
            }
            return { answer: "" };
          },
          async status() {
            return { started: providerStarted, cancelled: providerCancelled };
          },
        }),
        recorder: directDependency({
          async record({ input }: { input: object }) {
            reference.push(input);
          },
        }),
      });
      try {
        await alarm.runConcurrent(_execution.dependencies);
      } catch (error) {
        const workflows = _execution.dependencies.research as Workflow.Reference<Research>;
        const normal = await workflows.get({ id: "native" }).result();
        const cancellation = await workflows.get({ id: "cancelled" }).result();
        throw new Error(
          `${error instanceof Error ? error.message : "Workflow reference failed."} provider=${JSON.stringify(
            { started: providerStarted, cancelled: providerCancelled },
          )}; workflows=${JSON.stringify({ normal, cancellation })}; output=${JSON.stringify(
            reference,
          )}.`,
        );
      }
      expect(JSON.stringify(reference)).toContain("actor.outbound.scheduled");
      expect(JSON.stringify(reference)).toContain("actor.outbound.completed");
      const native = await runWorkflowNativeFixture(
        build.executable,
        resolve(directory, "native-workflow.jsonl"),
        resolve(directory, "native-workflow.sqlite"),
      );
      expect(native).toEqual(reference);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test(
  "runs State, Actions, and run through the public durable reference",
  { timeout: 10_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    let searches = 0;
    let artifact = "";
    const searchAttempts: number[] = [];
    const start = () =>
      executeServerLinkedProgramIR(linkProgram(server), {
        ...createWorkflowHost(events, alarm.clock),
        alarm: alarm.dependency,
        search: directDependency({
          async search({
            input,
            invocation,
          }: {
            input: { query: string };
            invocation: { attempt: number };
          }) {
            searches += 1;
            searchAttempts.push(invocation.attempt);
            if (input.query === "durable workflows" && invocation.attempt === 1) {
              throw new DependencyFailureError({
                type: "temporary",
                data: {},
                retry: { delay: 100 },
              });
            }
            return { evidence: `Evidence: ${input.query}` };
          },
        }),
      });

    {
      await using running = await start();
      const workflows = running.dependencies.research as Workflow.Reference<Research>;
      const execution = workflows.get({ id: "research-1" });

      await expect(
        execution.start(
          { input: { question: "durable workflows" } },
          { idempotencyKey: "start-1" },
        ),
      ).resolves.toEqual({ status: "started", run: 1 });
      const description = await execution.describe();
      expect(description.artifact).toMatch(/^sha256:[0-9a-f]{64}$/);
      artifact = description.artifact ?? "";
      await expect(execution.state()).resolves.toEqual({
        status: "running",
        revision: 2,
        state: {
          phase: "review",
          approved: false,
          passes: 1,
          observedAt: 0,
          timedOut: false,
        },
      });
      await expect(
        execution.approve({ wait: "completed", idempotencyKey: "approve-1" }),
      ).resolves.toEqual({
        status: "succeeded",
        value: { approved: true },
      });
      await alarm.runDue(running.dependencies);
      const completedState = await execution.state();
      expect(completedState).toEqual({
        status: "succeeded",
        revision: 9,
        state: {
          phase: "completed",
          approved: true,
          passes: 1,
          observedAt: 1_000,
          timedOut: false,
        },
      });

      await expect(execution.result()).resolves.toEqual({
        status: "succeeded",
        value: { report: "Evidence: durable workflows" },
      });
      const changes = execution.observe({ after: 4 })[Symbol.asyncIterator]();
      await expect(changes.next()).resolves.toMatchObject({
        done: false,
        value: {
          cursor: 5,
          status: "running",
          pendingEffects: 0,
          pendingTimers: 0,
          time: 1_000,
        },
      });
      await expect(changes.next()).resolves.toMatchObject({
        done: false,
        value: { cursor: 6, status: "running", pendingEffects: 1, pendingTimers: 0 },
      });
      await expect(changes.next()).resolves.toMatchObject({
        done: false,
        value: { cursor: 7, status: "running", pendingEffects: 1, pendingTimers: 0 },
      });
      await expect(changes.next()).resolves.toMatchObject({
        done: false,
        value: { cursor: 8, status: "running", pendingEffects: 0, pendingTimers: 0 },
      });
      await expect(changes.next()).resolves.toMatchObject({
        done: false,
        value: { cursor: 9, status: "succeeded", pendingEffects: 0, pendingTimers: 0 },
      });
      await changes.return?.();
      expect(searches).toBe(2);
      expect(searchAttempts).toEqual([1, 2]);

      const timed = workflows.get({ id: "research-timeout" });
      await expect(
        timed.start({ input: { question: "logical time" } }, { idempotencyKey: "start-timeout" }),
      ).resolves.toEqual({ status: "started", run: 1 });
      await expect(
        timed.start({ input: { question: "duplicate" } }, { idempotencyKey: "conflict-running" }),
      ).resolves.toEqual({ status: "conflict", run: 1, lifecycle: "running" });
      await expect(
        timed.start(
          { input: { question: "duplicate" }, conflict: "use" },
          { idempotencyKey: "use-running" },
        ),
      ).resolves.toEqual({ status: "existing", run: 1, lifecycle: "running" });
      await alarm.runDue(running.dependencies);
      await expect(timed.state()).resolves.toEqual({
        status: "succeeded",
        revision: 8,
        state: {
          phase: "completed",
          approved: false,
          passes: 1,
          observedAt: 2_600,
          timedOut: true,
        },
      });
      expect(searches).toBe(3);
      expect(searchAttempts).toEqual([1, 2, 1]);
      await expect(
        timed.start(
          { input: { question: "retry only" }, reuse: "failed" },
          { idempotencyKey: "reuse-failed" },
        ),
      ).resolves.toEqual({ status: "conflict", run: 1, lifecycle: "succeeded" });
      await expect(
        timed.start(
          { input: { question: "second run" }, reuse: "allow" },
          { idempotencyKey: "reuse-allow" },
        ),
      ).resolves.toEqual({ status: "started", run: 2 });
      await expect(timed.describe()).resolves.toMatchObject({
        id: "research-timeout",
        run: 2,
        status: "running",
      });
      await expect(
        timed.start(
          { input: { question: "replacement run" }, conflict: "terminate" },
          { idempotencyKey: "replace-running" },
        ),
      ).resolves.toEqual({ status: "started", run: 3 });
      await expect(timed.describe()).resolves.toMatchObject({
        id: "research-timeout",
        run: 3,
        status: "running",
      });
      await timed.terminate({ idempotencyKey: "terminate-third-run" });
    }

    await using restarted = await start();
    const restored = (restarted.dependencies.research as Workflow.Reference<Research>).get({
      id: "research-1",
    });
    await expect(restored.result()).resolves.toEqual({
      status: "succeeded",
      value: { report: "Evidence: durable workflows" },
    });
    await expect(restored.describe()).resolves.toMatchObject({ artifact });
    expect(searches).toBe(3);
    expect(searchAttempts).toEqual([1, 2, 1]);
  },
);

test(
  "dispatches one typed effect to server, browser, and reconnecting device providers",
  { timeout: 15_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const search = collectProgramManifest(server).bindings.find(({ name }) => name === "search");
    if (!search) throw new Error("Workflow fixture has no Search Dependency contract.");

    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    const network = createMemoryDependencyTransport();
    const providerCalls: Array<Readonly<{ platform: string; id: string; attempt: number }>> = [];
    const routedCalls: Array<Readonly<{ platform: string; id: string; attempt: number }>> = [];
    const provider = (platform: "server" | "browser" | "device") => ({
      async search({
        input,
        invocation,
      }: {
        input: Readonly<{ query: string }>;
        invocation: Readonly<{ id: string; attempt: number }>;
      }) {
        providerCalls.push({ platform, id: invocation.id, attempt: invocation.attempt });
        return { evidence: `${platform}:${input.query}` };
      },
    });
    const serverProvider = directDependency(provider("server"));
    const browserTarget = "memory://browser-provider";
    const deviceTarget = "memory://device-provider";
    const releaseBrowser = network.bind(
      browserTarget,
      createDependencyRequestHandler([search], { search: provider("browser") }),
    );
    const deviceHandler = createDependencyRequestHandler([search], {
      search: provider("device"),
    });
    const browserProvider = createRemoteDependency(search, browserTarget, network) as object;
    const deviceProvider = createRemoteDependency(search, deviceTarget, network) as object;
    let releaseDevice: (() => void) | undefined;
    const routedProvider = {
      [dependencyInvocation](operation: string, input: unknown, invocation: DependencyInvocation) {
        const platform = (input as Readonly<{ query: string }>).query as
          | "server"
          | "browser"
          | "device";
        routedCalls.push({ platform, id: invocation.id, attempt: invocation.attempt });
        const selected =
          platform === "server"
            ? serverProvider
            : platform === "browser"
              ? browserProvider
              : deviceProvider;
        try {
          return invokeDependency(selected, operation, input, invocation);
        } catch (error) {
          if (platform === "device" && releaseDevice === undefined) {
            releaseDevice = network.bind(deviceTarget, deviceHandler);
          }
          throw error;
        }
      },
    };

    try {
      await using running = await executeServerLinkedProgramIR(linkProgram(server), {
        ...createWorkflowHost(events, alarm.clock),
        alarm: alarm.dependency,
        search: routedProvider,
      });
      const workflows = running.dependencies.research as Workflow.Reference<Research>;
      const execute = async (platform: "server" | "browser" | "device") => {
        const execution = workflows.get({ id: `cross-platform-${platform}` });
        await execution.start(
          { input: { question: platform } },
          { idempotencyKey: `cross-platform:${platform}:start` },
        );
        await execution.approve({
          wait: "completed",
          idempotencyKey: `cross-platform:${platform}:approve`,
        });
        await alarm.runDue(running.dependencies);
        return await execution.result();
      };

      await expect(execute("server")).resolves.toEqual({
        status: "succeeded",
        value: { report: "server:server" },
      });
      await expect(execute("browser")).resolves.toEqual({
        status: "succeeded",
        value: { report: "browser:browser" },
      });
      await expect(execute("device")).resolves.toEqual({
        status: "succeeded",
        value: { report: "device:device" },
      });

      expect(providerCalls.map(({ platform }) => platform)).toEqual([
        "server",
        "browser",
        "device",
      ]);
      const deviceAttempts = routedCalls.filter(({ platform }) => platform === "device");
      expect(deviceAttempts.map(({ attempt }) => attempt)).toEqual([1, 2]);
      expect(new Set(deviceAttempts.map(({ id }) => id))).toHaveLength(1);
    } finally {
      releaseDevice?.();
      releaseBrowser();
    }
  },
);

test(
  "joins terminal Workflow completion without blocking its control surface",
  { timeout: 10_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      timer: directDependency({
        async sleep() {
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
        },
      }),
      search: directDependency({
        async search({ input }: { input: Readonly<{ query: string }> }) {
          return { evidence: `joined:${input.query}` };
        },
      }),
    });
    const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
      id: "joined-workflow",
    });

    await execution.start({ input: { question: "completion" } });
    let settled = false;
    const joined = execution.join().then((result) => {
      settled = true;
      return result;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    await execution.approve();
    await alarm.runDue(running.dependencies);
    await expect(joined).resolves.toEqual({
      status: "succeeded",
      value: { report: "joined:completion" },
    });
  },
);

test(
  "durably admits and deduplicates an Action by explicit idempotency key",
  { timeout: 15_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
      id: "accepted-action",
    });

    await execution.start(
      { input: { question: "accepted action" } },
      { idempotencyKey: "accepted-action:start" },
    );
    await expect(
      execution.revise(
        { instruction: "Retain one durable invocation." },
        { wait: "accepted", idempotencyKey: "accepted-action:revise" },
      ),
    ).resolves.toEqual({ id: "idempotency:accepted-action:revise" });
    await expect(
      execution.revise(
        { instruction: "Retain one durable invocation." },
        { wait: "completed", idempotencyKey: "accepted-action:revise" },
      ),
    ).resolves.toEqual({
      status: "succeeded",
      value: { revised: true },
    });
    await expect(execution.state()).resolves.toMatchObject({
      status: "running",
      state: { phase: "working" },
    });
  },
);

test(
  "relocates Workflow authority and resumes observation across generic Processes",
  { timeout: 20_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const linked = linkProgram(server);
    const manifest = collectProgramManifest(server);
    const researchContract = manifest.bindings.find(({ name }) => name === "research");
    if (!researchContract) throw new Error("Workflow fixture has no public Workflow contract.");

    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    const directory = createMemoryProcessDirectory();
    const network = createMemoryDependencyTransport();
    const distributions = new Map<string, Awaited<ReturnType<typeof startProcessDistribution>>>();
    const processes = new Map<string, Awaited<ReturnType<typeof executeServerLinkedProgramIR>>>();
    const start = async (id: string) => {
      const process = await executeServerLinkedProgramIR(
        linked,
        {
          ...createWorkflowHost(events, alarm.clock),
          alarm: alarm.dependency,
          identifiers: directDependency({ create: () => `workflow-${id}` }),
          search: directDependency({
            async search({ input }: { input: Readonly<{ query: string }> }) {
              return { evidence: `relocated:${input.query}` };
            },
          }),
        },
        {
          distribute: async ({ program, contracts, providers }) => {
            const distribution = await startProcessDistribution(program, contracts, providers, {
              id,
              target: `memory://workflow-${id}`,
              version: "v1",
              directory,
              network,
              partitionCount: 32,
              membershipLease: 1_000_000,
              ownershipLease: 100_000,
              now: alarm.now,
            });
            distributions.set(id, distribution);
            return distribution;
          },
        },
      );
      processes.set(id, process);
      return process;
    };

    try {
      const first = await start("a");
      const second = await start("b");
      const firstWorkflows = first.dependencies.research as Workflow.Reference<Research>;
      const secondWorkflows = second.dependencies.research as Workflow.Reference<Research>;
      const executionId = "relocated-workflow";
      await firstWorkflows.get({ id: executionId }).start({
        input: { question: "authority" },
      });

      const initialChanges = secondWorkflows
        .get({ id: executionId })
        .observe({ after: 0 })
        [Symbol.asyncIterator]();
      const initial = await initialChanges.next();
      if (initial.done) throw new Error("Workflow observation ended before its initial change.");
      const cursor = initial.value.cursor;
      await initialChanges.return?.();

      await firstWorkflows.get({ id: executionId }).state();
      const owner = [...distributions].find(([, distribution]) =>
        distribution.status().ownership.some(({ scope }) => {
          const identity = JSON.parse(scope) as readonly unknown[];
          return identity[3] === "research";
        }),
      );
      if (!owner) throw new Error("Workflow public Dependency acquired no Process authority.");
      const [ownerId, ownerDistribution] = owner;
      const oldAuthority = ownerDistribution.status().ownership.find(({ scope }) => {
        const identity = JSON.parse(scope) as readonly unknown[];
        return identity[3] === "research";
      });
      if (!oldAuthority) throw new Error("Workflow public Dependency authority disappeared.");
      const oldMember = ownerDistribution.status().member;
      await directory.drain({
        id: oldMember.id,
        failureEpoch: oldMember.failureEpoch,
        now: alarm.now(),
      });

      const survivorId = ownerId === "a" ? "b" : "a";
      const survivor = processes.get(survivorId);
      if (!survivor) throw new Error("Workflow survivor Process is unavailable.");
      const survivorWorkflows = survivor.dependencies.research as Workflow.Reference<Research>;
      await survivorWorkflows.get({ id: executionId }).state();

      const stale = createRemoteDependency(researchContract, oldMember.target, network) as object;
      await expect(
        invokeDependency(
          stale,
          "state",
          { id: executionId },
          {
            id: "stale-workflow-provider",
            attempt: 1,
            scheduledAt: alarm.now(),
            startedAt: alarm.now(),
            authority: oldAuthority,
          },
        ),
      ).rejects.toThrow("stale");

      const retired = processes.get(ownerId);
      if (!retired) throw new Error("Workflow owner Process is unavailable.");
      await retired[Symbol.asyncDispose]();
      processes.delete(ownerId);

      await survivorWorkflows.get({ id: executionId }).approve();
      await alarm.runDue(survivor.dependencies);
      await expect(survivorWorkflows.get({ id: executionId }).result()).resolves.toEqual({
        status: "succeeded",
        value: { report: "relocated:authority" },
      });

      const resumedChanges = survivorWorkflows
        .get({ id: executionId })
        .observe({ after: cursor })
        [Symbol.asyncIterator]();
      let latestCursor = cursor;
      let finalStatus = "";
      for (let index = 0; index < 32 && finalStatus !== "succeeded"; index += 1) {
        const change = await resumedChanges.next();
        if (change.done) break;
        expect(change.value.cursor).toBeGreaterThan(latestCursor);
        latestCursor = change.value.cursor;
        finalStatus = change.value.status;
      }
      await resumedChanges.return?.();
      expect(finalStatus).toBe("succeeded");
    } finally {
      for (const process of [...processes.values()].reverse()) {
        await Promise.resolve(process[Symbol.asyncDispose]()).catch(() => undefined);
      }
    }
  },
);

test(
  "runs durable schedule lifecycle and overlap policy through the Workflow reference",
  { timeout: 15_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const workflows = running.dependencies.research as Workflow.Reference<Research>;

    await expect(
      workflows.createSchedule(
        {
          id: "daily",
          definition: {
            input: { question: "scheduled" },
            timing: { every: 100 },
            active: { until: 300 },
            catchUp: 1_000,
            overlap: "skip",
          },
        },
        { idempotencyKey: "create-daily" },
      ),
    ).resolves.toMatchObject({
      status: "created",
      schedule: {
        id: "daily",
        status: "active",
        revision: 1,
        next: { nominal: 100, at: 100, source: "schedule" },
      },
    });
    await expect(
      workflows.createSchedule(
        {
          id: "daily",
          definition: {
            input: { question: "duplicate" },
            timing: { every: 100 },
          },
        },
        { idempotencyKey: "duplicate-daily" },
      ),
    ).resolves.toMatchObject({ status: "existing" });
    expect(alarm.nextAt()).toBe(100);

    const started = await advanceWorkflowScheduleUntil(
      workflows,
      "daily",
      alarm,
      running.dependencies,
      (schedule) => schedule.recent.some(({ status }) => status === "started"),
    );
    expect(started.active).toHaveLength(1);
    expect(started.recent).toEqual([
      expect.objectContaining({
        status: "started",
        occurrence: expect.objectContaining({ nominal: 100 }),
      }),
    ]);

    const overlapped = await advanceWorkflowScheduleUntil(
      workflows,
      "daily",
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.nominal === 200 && status === "skipped",
        ),
    );
    expect(overlapped.active).toHaveLength(1);
    expect(overlapped.recent).toEqual([
      expect.objectContaining({ status: "started" }),
      expect.objectContaining({
        status: "skipped",
        occurrence: expect.objectContaining({ nominal: 200 }),
      }),
    ]);

    await expect(
      workflows.backfillSchedule(
        { id: "daily", from: 100, through: 200 },
        { idempotencyKey: "backfill-daily" },
      ),
    ).resolves.toEqual({ status: "accepted", occurrences: 0 });
    const paused = await workflows.pauseSchedule(
      { id: "daily" },
      { idempotencyKey: "pause-daily" },
    );
    expect(paused).toMatchObject({
      status: "paused",
      schedule: { status: "paused" },
    });
    expect(paused.schedule.next).toBeUndefined();
    await expect(
      workflows.resumeSchedule({ id: "daily" }, { idempotencyKey: "resume-daily" }),
    ).resolves.toMatchObject({
      status: "resumed",
      schedule: {
        status: "active",
        next: { nominal: 300 },
      },
    });
    await expect(
      workflows.triggerSchedule({ id: "daily" }, { idempotencyKey: "trigger-daily" }),
    ).resolves.toMatchObject({ status: "triggered" });
    await advanceWorkflowScheduleUntil(
      workflows,
      "daily",
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.source === "trigger" && status === "skipped",
        ),
    );
    await expect(
      workflows.deleteSchedule({ id: "daily" }, { idempotencyKey: "delete-daily" }),
    ).resolves.toMatchObject({
      status: "deleted",
      schedule: { status: "deleted" },
    });
    const deleted = await workflows.describeSchedule({ id: "daily" });
    expect(deleted.status).toBe("deleted");
    expect(deleted.definition).toBeUndefined();
  },
);

test("enforces every Workflow schedule overlap policy", { timeout: 30_000 }, async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const policies = [
    "skip",
    "buffer-one",
    "buffer-all",
    "cancel-current",
    "terminate-current",
    "concurrent",
  ] as const;

  for (const policy of policies) {
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const workflows = running.dependencies.research as Workflow.Reference<Research>;
    const id = `overlap-${policy}`;
    await workflows.createSchedule(
      {
        id,
        definition: {
          input: { question: policy },
          timing: { every: 1_000_000 },
          active: { from: 1_000_000, until: 1_000_000 },
          overlap: policy,
        },
      },
      { idempotencyKey: `${id}:create` },
    );
    const first = await workflows.triggerSchedule({ id }, { idempotencyKey: `${id}:first` });
    if (first.status !== "triggered") throw new Error(`Schedule ${id} is missing.`);
    const firstStarted = await advanceWorkflowScheduleUntil(
      workflows,
      id,
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.id === first.occurrence && status === "started",
        ),
    );
    const firstExecution = firstStarted.recent.find(
      ({ occurrence }) => occurrence.id === first.occurrence,
    )?.execution;
    expect(firstExecution).toBeDefined();

    const second = await workflows.triggerSchedule({ id }, { idempotencyKey: `${id}:second` });
    if (second.status !== "triggered") throw new Error(`Schedule ${id} is missing.`);
    await expect(
      workflows.triggerSchedule({ id }, { idempotencyKey: `${id}:second` }),
    ).resolves.toEqual(second);

    if (policy === "skip") {
      const skipped = await advanceWorkflowScheduleUntil(
        workflows,
        id,
        alarm,
        running.dependencies,
        (schedule) =>
          schedule.recent.some(
            ({ occurrence, status }) => occurrence.id === second.occurrence && status === "skipped",
          ),
      );
      expect(skipped.active).toHaveLength(1);
      expect(skipped.buffered).toBe(0);
    } else if (policy === "buffer-one" || policy === "buffer-all") {
      const third = await workflows.triggerSchedule({ id }, { idempotencyKey: `${id}:third` });
      if (third.status !== "triggered") throw new Error(`Schedule ${id} is missing.`);
      for (let delivery = 0; delivery < 32 && alarm.nextAt() === alarm.now(); delivery += 1) {
        await alarm.runNext(running.dependencies);
      }
      const buffered = await workflows.describeSchedule({ id });
      expect(buffered.active).toHaveLength(1);
      expect(buffered.buffered, `${policy}: ${JSON.stringify(buffered)}`).toBe(
        policy === "buffer-one" ? 1 : 2,
      );
    } else if (policy === "concurrent") {
      const third = await workflows.triggerSchedule({ id }, { idempotencyKey: `${id}:third` });
      if (third.status !== "triggered") throw new Error(`Schedule ${id} is missing.`);
      const concurrent = await advanceWorkflowScheduleUntil(
        workflows,
        id,
        alarm,
        running.dependencies,
        (schedule) => schedule.recent.filter(({ status }) => status === "started").length === 3,
      );
      expect(concurrent.active).toHaveLength(3);
      expect(concurrent.buffered).toBe(0);
    } else {
      const replaced = await advanceWorkflowScheduleUntil(
        workflows,
        id,
        alarm,
        running.dependencies,
        (schedule) =>
          schedule.active.length === 1 &&
          schedule.recent.some(
            ({ occurrence, status }) => occurrence.id === second.occurrence && status === "started",
          ),
      );
      expect(replaced.active[0]?.occurrence).toBe(second.occurrence);
      await expect(workflows.get({ id: firstExecution as string }).result()).resolves.toMatchObject(
        {
          status: policy === "cancel-current" ? "cancelled" : "terminated",
        },
      );
    }
  }
});

test(
  "handles schedule catch-up, jitter, lifecycle, and civil-calendar delegation",
  { timeout: 30_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");

    {
      const events = createMemoryEventStore<object>();
      const alarm = createManualAlarm();
      await using running = await executeServerLinkedProgramIR(linkProgram(server), {
        ...createWorkflowHost(events, alarm.clock),
        alarm: alarm.dependency,
        search: directDependency({
          async search({ input }: { input: { query: string } }) {
            return { evidence: input.query };
          },
        }),
      });
      const workflows = running.dependencies.research as Workflow.Reference<Research>;
      await workflows.createSchedule(
        {
          id: "catch-up",
          definition: {
            input: { question: "catch-up" },
            timing: { every: 100 },
            active: { from: 100, until: 300 },
            catchUp: 50,
          },
        },
        { idempotencyKey: "catch-up:create" },
      );
      alarm.advance(350);
      const recovered = await advanceWorkflowScheduleUntil(
        workflows,
        "catch-up",
        alarm,
        running.dependencies,
        (schedule) =>
          schedule.recent.some(
            ({ occurrence, status }) => occurrence.nominal === 300 && status === "started",
          ),
      );
      expect(
        recovered.recent.map(({ occurrence, status }) => [occurrence.nominal, status]),
      ).toEqual([
        [100, "skipped"],
        [200, "skipped"],
        [300, "started"],
      ]);
    }

    {
      const events = createMemoryEventStore<object>();
      const alarm = createManualAlarm();
      await using running = await executeServerLinkedProgramIR(linkProgram(server), {
        ...createWorkflowHost(events, alarm.clock),
        alarm: alarm.dependency,
        search: directDependency({
          async search({ input }: { input: { query: string } }) {
            return { evidence: input.query };
          },
        }),
      });
      const workflows = running.dependencies.research as Workflow.Reference<Research>;
      const definition = {
        input: { question: "jitter" },
        timing: { every: 100 },
        jitter: 100,
      } as const;
      const created = await workflows.createSchedule(
        { id: "jitter", definition },
        { idempotencyKey: "jitter:create" },
      );
      expect(created.schedule.next?.nominal).toBe(100);
      expect(created.schedule.next?.at).toBeGreaterThanOrEqual(100);
      expect(created.schedule.next?.at).toBeLessThan(200);
      const updated = await workflows.updateSchedule(
        { id: "jitter", definition },
        { idempotencyKey: "jitter:update" },
      );
      expect(updated.schedule.next).toEqual(created.schedule.next);
      await expect(
        workflows.updateSchedule({ id: "jitter", definition }, { idempotencyKey: "jitter:update" }),
      ).resolves.toEqual(updated);
      const shifted = await workflows.updateSchedule(
        {
          id: "jitter",
          definition: {
            input: { question: "shifted" },
            timing: { every: 200, offset: 50 },
          },
        },
        { idempotencyKey: "jitter:shift" },
      );
      expect(shifted.schedule.next).toMatchObject({ nominal: 50, at: 50 });

      await workflows.pauseSchedule({ id: "jitter" }, { idempotencyKey: "jitter:pause" });
      const triggered = await workflows.triggerSchedule(
        { id: "jitter" },
        { idempotencyKey: "jitter:trigger" },
      );
      if (triggered.status !== "triggered") throw new Error("Jitter schedule is missing.");
      const started = await advanceWorkflowScheduleUntil(
        workflows,
        "jitter",
        alarm,
        running.dependencies,
        (schedule) =>
          schedule.recent.some(
            ({ occurrence, status }) =>
              occurrence.id === triggered.occurrence && status === "started",
          ),
      );
      const execution = started.recent.find(
        ({ occurrence }) => occurrence.id === triggered.occurrence,
      )?.execution;
      expect(execution).toBeDefined();
      await workflows.deleteSchedule({ id: "jitter" }, { idempotencyKey: "jitter:delete" });
      await expect(workflows.get({ id: execution as string }).describe()).resolves.toMatchObject({
        status: "running",
      });
    }

    {
      const events = createMemoryEventStore<object>();
      const alarm = createManualAlarm();
      const requests: object[] = [];
      const calendar = directDependency({
        async next({
          input,
        }: {
          input: Readonly<{
            after: number;
            through: number;
            timeZone: string;
            pattern: object;
          }>;
        }) {
          requests.push(input);
          return input.after < 100 ? { at: 100 } : input.after < 200 ? { at: 200 } : undefined;
        },
      });
      await using running = await executeServerLinkedProgramIR(linkProgram(server), {
        ...createWorkflowHost(events, alarm.clock),
        alarm: alarm.dependency,
        calendar,
        search: directDependency({
          async search({ input }: { input: { query: string } }) {
            return { evidence: input.query };
          },
        }),
      });
      const workflows = running.dependencies.research as Workflow.Reference<Research>;
      await workflows.createSchedule(
        {
          id: "calendar",
          definition: {
            input: { question: "calendar" },
            timing: {
              cron: "0 * * * * *",
              timeZone: "Europe/Bratislava",
            },
          },
        },
        { idempotencyKey: "calendar:create" },
      );
      const first = await advanceWorkflowScheduleUntil(
        workflows,
        "calendar",
        alarm,
        running.dependencies,
        (schedule) =>
          schedule.recent.some(
            ({ occurrence, status }) => occurrence.nominal === 100 && status === "started",
          ),
      );
      expect(first.next).toMatchObject({ nominal: 200, source: "schedule" });
      expect(requests.length).toBeGreaterThanOrEqual(3);
      expect(requests[0]).toMatchObject({
        after: 0,
        timeZone: "Europe/Bratislava",
        pattern: { cron: "0 * * * * *" },
      });
      expect(requests[1]).toMatchObject({ after: 100 });
      expect(requests).toContainEqual(expect.objectContaining({ after: 200 }));
    }
  },
);

test(
  "unions composite schedule timings and subtracts calendar exclusions",
  { timeout: 15_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    const requested: object[] = [];
    const calendar = directDependency({
      async next({
        input,
      }: {
        input: Readonly<{
          after: number;
          through: number;
          pattern: Readonly<{ cron: string }> | Readonly<{ calendar: object }>;
        }>;
      }) {
        requested.push(input);
        const candidates =
          "cron" in input.pattern ? [50, 150, 250] : input.pattern.calendar && [50, 150];
        const at = candidates.find((candidate) => candidate > input.after);
        return at === undefined || at > input.through ? undefined : { at };
      },
    });
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      calendar,
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const workflows = running.dependencies.research as Workflow.Reference<Research>;
    const created = await workflows.createSchedule(
      {
        id: "composite",
        definition: {
          input: { question: "composite" },
          timing: {
            any: [{ every: 100 }, { cron: "synthetic" }],
            except: [{ calendar: { second: 50 } }],
          },
          active: { until: 250 },
        },
      },
      { idempotencyKey: "composite:create" },
    );
    expect(created.schedule.next).toMatchObject({ nominal: 100, at: 100 });

    const started = await advanceWorkflowScheduleUntil(
      workflows,
      "composite",
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.nominal === 100 && status === "started",
        ),
    );
    expect(started.next).toMatchObject({ nominal: 200, at: 200 });
    expect(
      requested.some(
        (request) =>
          "pattern" in request &&
          typeof request.pattern === "object" &&
          request.pattern !== null &&
          "calendar" in request.pattern,
      ),
    ).toBe(true);

    await expect(
      workflows.createSchedule(
        {
          id: "empty-composite",
          definition: {
            input: { question: "invalid" },
            timing: { any: [] },
          },
        },
        { idempotencyKey: "empty-composite:create" },
      ),
    ).rejects.toThrow("timing.any must contain at least one timing");
  },
);

test(
  "controls initial state, action limits, notes, and scoped overlap",
  { timeout: 20_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const workflows = running.dependencies.research as Workflow.Reference<Research>;
    const created = await workflows.createSchedule(
      {
        id: "controlled",
        definition: {
          input: { question: "controlled" },
          timing: { every: 100 },
          overlap: "concurrent",
        },
        paused: true,
        trigger: true,
        note: "Waiting for approval.",
        remaining: 1,
      },
      { idempotencyKey: "controlled:create" },
    );
    expect(created.schedule).toMatchObject({
      status: "paused",
      note: "Waiting for approval.",
      remaining: 1,
    });
    expect(created.schedule.next).toBeUndefined();

    const immediate = await advanceWorkflowScheduleUntil(
      workflows,
      "controlled",
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.source === "trigger" && status === "started",
        ),
    );
    expect(immediate.remaining).toBe(1);

    const resumed = await workflows.resumeSchedule(
      { id: "controlled", note: "Approved." },
      { idempotencyKey: "controlled:resume" },
    );
    expect(resumed.schedule).toMatchObject({
      status: "active",
      note: "Approved.",
      remaining: 1,
      next: { nominal: 100 },
    });
    const limited = await advanceWorkflowScheduleUntil(
      workflows,
      "controlled",
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.remaining === 0 &&
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.nominal === 100 && status === "started",
        ),
    );
    expect(limited.next).toBeUndefined();

    await workflows.createSchedule(
      {
        id: "scoped-overlap",
        definition: {
          input: { question: "scoped-overlap" },
          timing: { every: 1_000_000 },
          overlap: "skip",
        },
      },
      { idempotencyKey: "scoped-overlap:create" },
    );
    const first = await workflows.triggerSchedule(
      { id: "scoped-overlap" },
      { idempotencyKey: "scoped-overlap:first" },
    );
    if (first.status !== "triggered") throw new Error("Scoped schedule is missing.");
    await advanceWorkflowScheduleUntil(
      workflows,
      "scoped-overlap",
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.id === first.occurrence && status === "started",
        ),
    );
    const second = await workflows.triggerSchedule(
      { id: "scoped-overlap", overlap: "concurrent" },
      { idempotencyKey: "scoped-overlap:second" },
    );
    if (second.status !== "triggered") throw new Error("Scoped schedule is missing.");
    const concurrent = await advanceWorkflowScheduleUntil(
      workflows,
      "scoped-overlap",
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.id === second.occurrence && status === "started",
        ),
    );
    expect(concurrent.active).toHaveLength(2);
    expect(concurrent.definition?.overlap).toBe("skip");
  },
);

test(
  "lists Workflows, schedules, and retained scheduled runs with stable cursors",
  { timeout: 60_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const workflows = running.dependencies.research as Workflow.Reference<Research>;
    const alpha = workflows.get({ id: "visible-alpha" });
    const beta = workflows.get({ id: "visible-beta" });
    const gamma = workflows.get({ id: "visible-gamma" });
    await alpha.start({ input: { question: "alpha" } }, { idempotencyKey: "visible-alpha:start" });
    await beta.start({ input: { question: "beta" } }, { idempotencyKey: "visible-beta:start" });
    await gamma.start({ input: { question: "gamma" } }, { idempotencyKey: "visible-gamma:start" });
    await beta.revise({ instruction: "Work now." }, { idempotencyKey: "visible-beta:revise" });
    expect(await events.read({ stream: "actor-registry:17:research:workflow" })).toHaveLength(3);
    const visible = await workflows.list({ limit: 10 });
    expect(visible.workflows.map(({ workflow }) => workflow.id)).toEqual([
      "visible-alpha",
      "visible-beta",
      "visible-gamma",
    ]);
    expect(visible.workflows[0]).toMatchObject({
      workflow: { status: "running", startedAt: 0 },
      state: { phase: "review", approved: false, passes: 1 },
    });

    const first = await workflows.list({
      limit: 1,
      where: {
        status: ["running"],
        state: {
          phase: { equals: "review" },
          approved: { equals: false },
          passes: { atLeast: 1, atMost: 1 },
        },
      },
    });
    expect(first).toMatchObject({
      workflows: [
        {
          workflow: { id: "visible-alpha", status: "running", startedAt: 0 },
          state: { phase: "review", approved: false, passes: 1 },
        },
      ],
      done: false,
    });
    const second = await workflows.list({
      after: first.cursor,
      limit: 1,
      where: { state: { phase: { equals: "review" } } },
    });
    expect(second).toMatchObject({ workflows: [], done: false });
    const third = await workflows.list({
      after: second.cursor,
      limit: 1,
      where: { state: { phase: { equals: "review" } } },
    });
    expect(third).toMatchObject({
      workflows: [{ workflow: { id: "visible-gamma" } }],
      done: false,
    });
    const end = await workflows.list({
      after: third.cursor,
      limit: 1,
      where: { state: { phase: { equals: "review" } } },
    });
    expect(end).toMatchObject({ workflows: [], done: true });
    expect(third.cursor).toBeGreaterThan(second.cursor);
    await gamma.cancel({ idempotencyKey: "visible-gamma:cancel" });
    await expect(gamma.describe()).resolves.toMatchObject({
      status: "cancelled",
      startedAt: 0,
      closedAt: 0,
    });
    const closed = await workflows.list({
      limit: 10,
      where: {
        status: ["cancelled"],
        closedAt: { from: 0, through: 0 },
      },
    });
    expect(closed.workflows.map(({ workflow }) => workflow.id)).toEqual(["visible-gamma"]);

    await workflows.createSchedule(
      {
        id: "visible-paused",
        definition: {
          input: { question: "scheduled" },
          timing: { every: 1_000_000 },
        },
        paused: true,
      },
      { idempotencyKey: "visible-paused:create" },
    );
    await workflows.createSchedule(
      {
        id: "visible-active",
        definition: {
          input: { question: "scheduled" },
          timing: { every: 1_000_000 },
        },
      },
      { idempotencyKey: "visible-active:create" },
    );
    const schedules = await workflows.listSchedules({
      where: { status: ["paused"] },
    });
    expect(schedules.schedules.map(({ id }) => id)).toEqual(["visible-paused"]);

    const trigger = await workflows.triggerSchedule(
      { id: "visible-paused" },
      { idempotencyKey: "visible-paused:trigger" },
    );
    if (trigger.status !== "triggered") throw new Error("Visible schedule is missing.");
    await advanceWorkflowScheduleUntil(
      workflows,
      "visible-paused",
      alarm,
      running.dependencies,
      (schedule) =>
        schedule.recent.some(
          ({ occurrence, status }) => occurrence.id === trigger.occurrence && status === "started",
        ),
    );
    const runs = await workflows.listScheduleRuns({ id: "visible-paused" });
    expect(runs).toMatchObject({
      runs: [
        {
          occurrence: trigger.occurrence,
          workflow: { status: "running" },
          state: { phase: "review", approved: false, passes: 1 },
        },
      ],
      done: true,
    });
  },
);

test("recovers a committed schedule start intent after restart", { timeout: 15_000 }, async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const firstAlarm = createManualAlarm();
  let occurrence = "";

  {
    await using first = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, firstAlarm.clock),
      alarm: firstAlarm.dependency,
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const workflows = first.dependencies.research as Workflow.Reference<Research>;
    await workflows.createSchedule(
      {
        id: "schedule-restart",
        definition: {
          input: { question: "schedule restart" },
          timing: { every: 1_000_000 },
        },
      },
      { idempotencyKey: "schedule-restart:create" },
    );
    const triggered = await workflows.triggerSchedule(
      { id: "schedule-restart" },
      { idempotencyKey: "schedule-restart:trigger" },
    );
    if (triggered.status !== "triggered") throw new Error("Restart schedule is missing.");
    occurrence = triggered.occurrence;
    expect(firstAlarm.next()?.operation).toBe("$scheduleStart");
  }

  const recoveredAlarm = createManualAlarm();
  await using recovered = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, recoveredAlarm.clock),
    alarm: recoveredAlarm.dependency,
    search: directDependency({
      async search({ input }: { input: { query: string } }) {
        return { evidence: input.query };
      },
    }),
  });
  const workflows = recovered.dependencies.research as Workflow.Reference<Research>;
  const schedule = await advanceWorkflowScheduleUntil(
    workflows,
    "schedule-restart",
    recoveredAlarm,
    recovered.dependencies,
    (description) =>
      description.recent.some(
        ({ occurrence: candidate, status }) => candidate.id === occurrence && status === "started",
      ),
  );
  const execution = schedule.recent.find(
    ({ occurrence: candidate }) => candidate.id === occurrence,
  )?.execution;
  expect(execution).toBeDefined();
  await expect(workflows.get({ id: execution as string }).describe()).resolves.toMatchObject({
    run: 1,
  });
  expect(schedule.recent.filter(({ occurrence: item }) => item.id === occurrence)).toHaveLength(1);
});

test(
  "recovers schedule provider-completion uncertainty without a duplicate run",
  { timeout: 15_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    let failCompletion = true;
    const faultedEvents = new Proxy(events, {
      get(target, property, receiver) {
        if (property !== "append") return Reflect.get(target, property, receiver);
        return async (input: {
          stream: string;
          expectedRevision: number;
          events: readonly object[];
        }) => {
          if (
            failCompletion &&
            input.stream === actorStream("research:workflow-schedule", "schedule-provider-crash") &&
            input.events.some(
              (event) => (event as Readonly<{ type?: string }>).type === "actor.outbound.completed",
            )
          ) {
            failCompletion = false;
            throw new Error("injected crash after schedule provider completion");
          }
          return await events.append(input);
        };
      },
    });
    const firstAlarm = createManualAlarm();
    let occurrence = "";

    {
      await using first = await executeServerLinkedProgramIR(linkProgram(server), {
        ...createWorkflowHost(faultedEvents, firstAlarm.clock),
        alarm: firstAlarm.dependency,
        search: directDependency({
          async search({ input }: { input: { query: string } }) {
            return { evidence: input.query };
          },
        }),
      });
      const workflows = first.dependencies.research as Workflow.Reference<Research>;
      await workflows.createSchedule(
        {
          id: "schedule-provider-crash",
          definition: {
            input: { question: "provider completion" },
            timing: { every: 1_000_000 },
          },
        },
        { idempotencyKey: "schedule-provider-crash:create" },
      );
      const triggered = await workflows.triggerSchedule(
        { id: "schedule-provider-crash" },
        { idempotencyKey: "schedule-provider-crash:trigger" },
      );
      if (triggered.status !== "triggered") throw new Error("Provider schedule is missing.");
      occurrence = triggered.occurrence;
      await expect(firstAlarm.runNext(first.dependencies)).rejects.toThrow(
        "injected crash after schedule provider completion",
      );
    }

    const recoveredAlarm = createManualAlarm();
    await using recovered = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, recoveredAlarm.clock),
      alarm: recoveredAlarm.dependency,
      search: directDependency({
        async search({ input }: { input: { query: string } }) {
          return { evidence: input.query };
        },
      }),
    });
    const workflows = recovered.dependencies.research as Workflow.Reference<Research>;
    const schedule = await advanceWorkflowScheduleUntil(
      workflows,
      "schedule-provider-crash",
      recoveredAlarm,
      recovered.dependencies,
      (description) =>
        description.recent.some(
          ({ occurrence: candidate, status }) =>
            candidate.id === occurrence && status === "started",
        ),
    );
    const execution = schedule.recent.find(
      ({ occurrence: candidate }) => candidate.id === occurrence,
    )?.execution;
    expect(execution).toBeDefined();
    await expect(workflows.get({ id: execution as string }).describe()).resolves.toMatchObject({
      run: 1,
    });
    const journal = await events.read({
      stream: actorStream("research:workflow-schedule", "schedule-provider-crash"),
    });
    expect(
      journal.filter(
        ({ event }) => (event as Readonly<{ type?: string }>).type === "actor.outbound.completed",
      ),
    ).toHaveLength(1);
    expect(schedule.recent.filter(({ occurrence: item }) => item.id === occurrence)).toHaveLength(
      1,
    );
  },
);

test(
  "retains pinned meaning and admits only replay-compatible worker migration",
  { tags: ["compiler"], timeout: 60_000 },
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-workflow-upgrade-"));
    try {
      await mkdir(resolve(directory, "src"), { recursive: true });
      await writeFile(
        resolve(directory, "tsconfig.json"),
        JSON.stringify({
          extends: resolve(import.meta.dirname, "../../../tsconfig.json"),
          compilerOptions: {
            paths: { "@/*": [resolve(import.meta.dirname, "../../*")] },
            types: [],
          },
        }),
      );
      const oldSource = resolve(directory, "src/old.ts");
      const newSource = resolve(directory, "src/new.ts");
      const compatibleSource = resolve(directory, "src/compatible.ts");
      await writeFile(oldSource, workflowUpgradeFixtureSource("old"));
      await writeFile(newSource, workflowUpgradeFixtureSource("new"));
      await writeFile(compatibleSource, workflowUpgradeFixtureSource("compatible"));
      const oldProgram = compileSystem(oldSource, [
        serverCompilerExtension,
        workflowCompilerExtension,
      ]).programs.find(({ name }) => name === "server");
      const newProgram = compileSystem(newSource, [
        serverCompilerExtension,
        workflowCompilerExtension,
      ]).programs.find(({ name }) => name === "server");
      const compatibleProgram = compileSystem(compatibleSource, [
        serverCompilerExtension,
        workflowCompilerExtension,
      ]).programs.find(({ name }) => name === "server");
      if (!oldProgram || !newProgram || !compatibleProgram) {
        throw new Error("Workflow upgrade fixture has no server Program.");
      }

      const events = createMemoryEventStore<object>();
      const alarm = createManualAlarm();
      {
        await using oldWorker = await executeServerLinkedProgramIR(linkProgram(oldProgram), {
          ...createWorkflowHost(events, alarm.clock),
          alarm: alarm.dependency,
        });
        const workflows = oldWorker.dependencies.upgrade as Workflow.Reference<UpgradeWorkflow>;
        for (const id of ["retained", "compatible"]) {
          await expect(workflows.get({ id }).start({ input: undefined })).resolves.toEqual({
            status: "started",
            run: 1,
          });
        }
        await alarm.runDue(oldWorker.dependencies);
        await expect(workflows.get({ id: "retained" }).state()).resolves.toMatchObject({
          status: "running",
          state: { approved: false, marker: "old-state" },
        });
      }

      let newArtifact = "";
      {
        await using newWorker = await executeServerLinkedProgramIR(linkProgram(newProgram), {
          ...createWorkflowHost(events, alarm.clock),
          alarm: alarm.dependency,
        });
        const workflows = newWorker.dependencies.upgrade as Workflow.Reference<UpgradeWorkflow>;
        const retained = workflows.get({ id: "retained" });
        await expect(retained.migrate()).resolves.toMatchObject({
          status: "incompatible",
        });
        const retainedArtifact = (await retained.describe()).artifact;
        await expect(retained.approve()).resolves.toEqual({
          status: "succeeded",
          value: { approved: true },
        });
        await alarm.runDue(newWorker.dependencies);
        await expect(retained.result()).resolves.toEqual({
          status: "succeeded",
          value: { marker: "old-action:old-run" },
        });

        const fresh = workflows.get({ id: "fresh" });
        await fresh.start({ input: undefined });
        await alarm.runDue(newWorker.dependencies);
        await fresh.approve();
        await alarm.runDue(newWorker.dependencies);
        await expect(fresh.result()).resolves.toEqual({
          status: "succeeded",
          value: { marker: "new-action:new-run" },
        });
        const freshDescription = await fresh.describe();
        newArtifact = freshDescription.artifact ?? "";
        expect(retainedArtifact).not.toBe(freshDescription.artifact);
      }

      await using compatibleWorker = await executeServerLinkedProgramIR(
        linkProgram(compatibleProgram),
        {
          ...createWorkflowHost(events, alarm.clock),
          alarm: alarm.dependency,
        },
      );
      const compatible = (
        compatibleWorker.dependencies.upgrade as Workflow.Reference<UpgradeWorkflow>
      ).get({ id: "compatible" });
      const before = await compatible.describe();
      await expect(compatible.migrate()).resolves.toMatchObject({
        status: "migrated",
        from: before.artifact,
      });
      const after = await compatible.describe();
      expect(after.definition).toBe(2);
      expect(after.artifact).not.toBe(before.artifact);
      expect(after.artifact).not.toBe(newArtifact);
      await expect(compatible.migrate()).resolves.toEqual({
        status: "current",
        artifact: after.artifact,
      });
      await compatible.approve();
      await alarm.runDue(compatibleWorker.dependencies);
      await expect(compatible.result()).resolves.toEqual({
        status: "succeeded",
        value: { marker: "old-action:old-run" },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test("continues under one Workflow identity with bounded retained run summaries", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const alarm = createManualAlarm();

  await using running = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, alarm.clock),
    alarm: alarm.dependency,
    search: directDependency({
      async search({ input }: { input: { query: string } }) {
        return { evidence: `Evidence: ${input.query}` };
      },
    }),
  });
  const workflows = running.dependencies.research as Workflow.Reference<Research>;
  const execution = workflows.get({ id: "continued-research" });

  await expect(
    execution.start({
      input: {
        question: "bounded history",
        continuations: 70,
      },
    }),
  ).resolves.toEqual({ status: "started", run: 1 });
  await expect.poll(async () => (await execution.describe()).run, { timeout: 10_000 }).toBe(71);

  const description = await execution.describe();
  expect(description).toMatchObject({
    id: "continued-research",
    artifact: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    run: 71,
    status: "running",
    history: {
      events: 1,
      continueSuggested: false,
      retainedRuns: 64,
    },
  });
  const journal = await events.read({
    stream: actorStream("research:workflow", "continued-research"),
  });
  const artifactIds = new Set(
    journal.flatMap(({ event }) => {
      const state = (
        event as Readonly<{
          state?: Readonly<{
            artifact?: Readonly<{ id?: string }>;
            closedRuns?: readonly Readonly<{ artifact?: string }>[];
          }>;
        }>
      ).state;
      return [
        ...(state?.artifact?.id === undefined ? [] : [state.artifact.id]),
        ...(state?.closedRuns ?? []).flatMap(({ artifact: closed }) =>
          closed === undefined ? [] : [closed],
        ),
      ];
    }),
  );
  expect([...artifactIds]).toEqual([description.artifact]);
  await expect(execution.state()).resolves.toMatchObject({
    status: "running",
    state: { phase: "review", passes: 1 },
  });
});

test(
  "starts, controls, joins, and observes a typed child Workflow durably",
  { timeout: 30_000 },
  async () => {
    const server = workflowChildrenFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow child fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
    });
    const parents = running.dependencies.parent as Workflow.Reference<Parent>;
    const parent = parents.get({ id: "parent-1" });

    await expect(
      parent.start(
        {
          input: {
            child: "child-1",
            value: 42,
            mode: "join",
            parentClose: "cancel",
            cancellation: "wait",
          },
        },
        { idempotencyKey: "parent:start" },
      ),
    ).resolves.toEqual({ status: "started", run: 1 });
    await alarm.runDue(running.dependencies);

    await expect(parent.result()).resolves.toEqual({
      status: "succeeded",
      value: { status: "succeeded" },
    });
    const child = (running.dependencies.child as Workflow.Reference<Child>).get({
      id: "child-1",
    });
    await expect(child.result()).resolves.toEqual({
      status: "succeeded",
      value: { value: 42 },
    });
    const changes = parent.observe({ after: 0 })[Symbol.asyncIterator]();
    let linked = false;
    for (let index = 0; index < 32 && !linked; index += 1) {
      const change = await changes.next();
      linked =
        change.done === false &&
        change.value.children?.some(
          ({ dependency, id, status }) =>
            dependency === "child" && id === "child-1" && status === "closed",
        ) === true;
    }
    await changes.return?.();
    expect(linked).toBe(true);
  },
);

test(
  "composes retry, approval, child shipping, and compensation as one fulfillment",
  { timeout: 30_000 },
  async () => {
    const server = workflowFulfillmentFixtureSystem().programs.find(
      ({ name }) => name === "server",
    );
    if (!server) throw new Error("Workflow fulfillment fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    const chargeAttempts = new Map<string, number[]>();
    const chargeInvocations = new Map<string, string[]>();
    const refunds: string[] = [];

    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      payments: directDependency({
        async charge({
          input,
          invocation,
        }: {
          input: { order: string };
          invocation: { id: string; attempt: number };
        }) {
          chargeAttempts.set(input.order, [
            ...(chargeAttempts.get(input.order) ?? []),
            invocation.attempt,
          ]);
          chargeInvocations.set(input.order, [
            ...(chargeInvocations.get(input.order) ?? []),
            invocation.id,
          ]);
          if (input.order === "order-success" && invocation.attempt === 1) {
            throw new DependencyFailureError({
              type: "temporary",
              data: {},
              retry: { delay: 10 },
            });
          }
          return { receipt: `receipt:${input.order}` };
        },
        async refund({ input }: { input: { receipt: string } }) {
          refunds.push(input.receipt);
          return { refunded: true as const };
        },
      }),
    });
    const fulfillments = running.dependencies.fulfillment as Workflow.Reference<Fulfillment>;
    const shipments = running.dependencies.shipment as Workflow.Reference<Shipment>;

    const successful = fulfillments.get({ id: "fulfillment-success" });
    await successful.start(
      {
        input: {
          order: "order-success",
          shipment: "shipment-success",
          amount: 4_200,
        },
      },
      { idempotencyKey: "fulfillment-success:start" },
    );
    await expect(
      successful.approve({
        wait: "completed",
        idempotencyKey: "fulfillment-success:premature-approval",
      }),
    ).resolves.toEqual({
      status: "failed",
      failure: { type: "unavailable", data: { phase: "charging" } },
    });
    await expect(successful.state()).resolves.toMatchObject({
      status: "running",
      state: { phase: "charging", approved: false, charged: false },
    });
    await alarm.runDue(running.dependencies);
    await expect(successful.state()).resolves.toMatchObject({
      status: "running",
      state: { phase: "approval", approved: false, charged: true },
    });
    await successful.approve({
      wait: "completed",
      idempotencyKey: "fulfillment-success:approve",
    });
    await alarm.runDue(running.dependencies);
    await expect(successful.join()).resolves.toEqual({
      status: "succeeded",
      value: {
        receipt: "receipt:order-success",
        shipment: "shipment-success",
      },
    });
    await expect(shipments.get({ id: "shipment-success" }).join()).resolves.toEqual({
      status: "succeeded",
      value: { tracking: "shipment-success" },
    });
    expect(chargeAttempts.get("order-success")).toEqual([1, 2]);
    expect(new Set(chargeInvocations.get("order-success"))).toHaveLength(1);

    const cancelled = fulfillments.get({ id: "fulfillment-cancelled" });
    await cancelled.start(
      {
        input: {
          order: "order-cancelled",
          shipment: "shipment-cancelled",
          amount: 2_100,
        },
      },
      { idempotencyKey: "fulfillment-cancelled:start" },
    );
    await alarm.runDue(running.dependencies);
    await expect(cancelled.cancel()).resolves.toEqual({ status: "cancelling" });
    await alarm.runDue(running.dependencies);
    await expect(cancelled.join()).resolves.toEqual({ status: "cancelled" });
    expect(refunds).toEqual(["receipt:order-cancelled"]);
    await expect(shipments.get({ id: "shipment-cancelled" }).state()).resolves.toEqual({
      status: "idle",
      revision: 0,
    });
  },
);

test(
  "applies child cancellation and parent-close policies outside the parent turn",
  { timeout: 20_000 },
  async () => {
    const server = workflowChildrenFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow child fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
    });
    const parents = running.dependencies.parent as Workflow.Reference<Parent>;
    const children = running.dependencies.child as Workflow.Reference<Child>;

    const waiting = parents.get({ id: "parent-wait" });
    await waiting.start(
      {
        input: {
          child: "child-wait",
          value: 1,
          mode: "wait",
          parentClose: "terminate",
          cancellation: "wait",
        },
      },
      { idempotencyKey: "parent-wait:start" },
    );
    await alarm.runDue(running.dependencies);
    const waitingJournal = await events.read({
      stream: actorStream("parent:workflow", "parent-wait"),
    });
    const waitingState = waitingJournal
      .map(({ event }) => event as Readonly<{ state?: Readonly<{ children?: readonly object[] }> }>)
      .filter(({ state }) => state !== undefined)
      .at(-1)?.state;
    expect(waitingState?.children).toEqual([
      expect.objectContaining({
        dependency: "child",
        id: "child-wait",
        status: "running",
      }),
    ]);
    await expect(waiting.cancel()).resolves.toEqual({ status: "cancelling" });
    await expect(waiting.state()).resolves.toMatchObject({ status: "cancelling" });
    await alarm.runDue(running.dependencies);
    await expect(waiting.result()).resolves.toEqual({ status: "cancelled" });
    await expect(children.get({ id: "child-wait" }).result()).resolves.toEqual({
      status: "cancelled",
    });

    const requested = parents.get({ id: "parent-request" });
    await requested.start(
      {
        input: {
          child: "child-request",
          value: 2,
          mode: "wait",
          parentClose: "terminate",
          cancellation: "request",
        },
      },
      { idempotencyKey: "parent-request:start" },
    );
    await alarm.runDue(running.dependencies);
    await expect(requested.cancel()).resolves.toEqual({ status: "cancelled" });
    await expect(requested.result()).resolves.toEqual({ status: "cancelled" });
    await alarm.runDue(running.dependencies);
    await expect(children.get({ id: "child-request" }).result()).resolves.toEqual({
      status: "cancelled",
    });

    const cancellationAbandoned = parents.get({ id: "parent-cancellation-abandon" });
    await cancellationAbandoned.start(
      {
        input: {
          child: "child-cancellation-abandon",
          value: 3,
          mode: "wait",
          parentClose: "terminate",
          cancellation: "abandon",
        },
      },
      { idempotencyKey: "parent-cancellation-abandon:start" },
    );
    await alarm.runDue(running.dependencies);
    await expect(cancellationAbandoned.cancel()).resolves.toEqual({
      status: "cancelled",
    });
    await alarm.runDue(running.dependencies);
    await expect(children.get({ id: "child-cancellation-abandon" }).state()).resolves.toMatchObject(
      {
        status: "running",
      },
    );

    const abandoned = parents.get({ id: "parent-abandon" });
    await abandoned.start(
      {
        input: {
          child: "child-abandon",
          value: 4,
          mode: "complete",
          parentClose: "abandon",
          cancellation: "request",
        },
      },
      { idempotencyKey: "parent-abandon:start" },
    );
    await alarm.runDue(running.dependencies);
    await expect(abandoned.result()).resolves.toEqual({
      status: "succeeded",
      value: { status: "succeeded" },
    });
    await expect(children.get({ id: "child-abandon" }).state()).resolves.toMatchObject({
      status: "running",
    });

    const cancelled = parents.get({ id: "parent-cancel-child" });
    await cancelled.start(
      {
        input: {
          child: "child-cancel",
          value: 5,
          mode: "complete",
          parentClose: "cancel",
          cancellation: "request",
        },
      },
      { idempotencyKey: "parent-cancel-child:start" },
    );
    await alarm.runDue(running.dependencies);
    await expect(cancelled.result()).resolves.toMatchObject({ status: "succeeded" });
    await expect(children.get({ id: "child-cancel" }).result()).resolves.toEqual({
      status: "cancelled",
    });

    const terminated = parents.get({ id: "parent-terminate-child" });
    await terminated.start(
      {
        input: {
          child: "child-terminate",
          value: 6,
          mode: "complete",
          parentClose: "terminate",
          cancellation: "request",
        },
      },
      { idempotencyKey: "parent-terminate-child:start" },
    );
    await alarm.runDue(running.dependencies);
    await expect(terminated.result()).resolves.toMatchObject({ status: "succeeded" });
    await expect(children.get({ id: "child-terminate" }).result()).resolves.toEqual({
      status: "terminated",
    });
  },
);

test(
  "recovers child start and completion uncertainty across process restart",
  { timeout: 30_000 },
  async () => {
    const server = workflowChildrenFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow child fixture has no server Program.");
    const linked = linkProgram(server);

    const startEvents = createMemoryEventStore<object>();
    const initialAlarm = createManualAlarm();
    {
      await using initial = await executeServerLinkedProgramIR(linked, {
        ...createWorkflowHost(startEvents, initialAlarm.clock),
        alarm: initialAlarm.dependency,
      });
      const parent = (initial.dependencies.parent as Workflow.Reference<Parent>).get({
        id: "parent-start-recovery",
      });
      await parent.start(
        {
          input: {
            child: "child-start-recovery",
            value: 4,
            mode: "join",
            parentClose: "cancel",
            cancellation: "wait",
          },
        },
        { idempotencyKey: "parent-start-recovery:start" },
      );
      expect(initialAlarm.next()).toMatchObject({
        operation: "$wake",
      });
    }

    const recoveredAlarm = createManualAlarm();
    await using recovered = await executeServerLinkedProgramIR(linked, {
      ...createWorkflowHost(startEvents, recoveredAlarm.clock),
      alarm: recoveredAlarm.dependency,
    });
    await recoveredAlarm.runDue(recovered.dependencies);
    await expect(
      (recovered.dependencies.parent as Workflow.Reference<Parent>)
        .get({ id: "parent-start-recovery" })
        .result(),
    ).resolves.toEqual({
      status: "succeeded",
      value: { status: "succeeded" },
    });
    await expect(
      (recovered.dependencies.child as Workflow.Reference<Child>)
        .get({ id: "child-start-recovery" })
        .result(),
    ).resolves.toEqual({
      status: "succeeded",
      value: { value: 4 },
    });

    const closeEvents = createMemoryEventStore<object>();
    let failChildCloseCompletion = false;
    const faultedEvents = new Proxy(closeEvents, {
      get(target, property, receiver) {
        if (property !== "append") return Reflect.get(target, property, receiver);
        return async (input: {
          stream: string;
          expectedRevision: number;
          events: readonly object[];
        }) => {
          if (
            failChildCloseCompletion &&
            input.events.some(
              (event) =>
                (event as Readonly<{ type?: string; outbound?: string }>).type ===
                  "actor.outbound.completed" &&
                (event as Readonly<{ outbound?: string }>).outbound?.includes(":child-close:") ===
                  true,
            )
          ) {
            failChildCloseCompletion = false;
            throw new Error("injected crash after child provider completion");
          }
          return await closeEvents.append(input);
        };
      },
    });
    const closeAlarm = createManualAlarm();
    {
      await using initial = await executeServerLinkedProgramIR(linked, {
        ...createWorkflowHost(faultedEvents, closeAlarm.clock),
        alarm: closeAlarm.dependency,
      });
      const parent = (initial.dependencies.parent as Workflow.Reference<Parent>).get({
        id: "parent-close-recovery",
      });
      await parent.start(
        {
          input: {
            child: "child-close-recovery",
            value: 5,
            mode: "wait",
            parentClose: "terminate",
            cancellation: "wait",
          },
        },
        { idempotencyKey: "parent-close-recovery:start" },
      );
      await closeAlarm.runDue(initial.dependencies);
      await expect(parent.cancel()).resolves.toEqual({ status: "cancelling" });
      expect(closeAlarm.next()).toMatchObject({ operation: "$childClose" });
      failChildCloseCompletion = true;
      await expect(closeAlarm.runNext(initial.dependencies)).rejects.toThrow(
        "injected crash after child provider completion",
      );
    }

    const closeRecoveryAlarm = createManualAlarm();
    await using closeRecovery = await executeServerLinkedProgramIR(linked, {
      ...createWorkflowHost(closeEvents, closeRecoveryAlarm.clock),
      alarm: closeRecoveryAlarm.dependency,
    });
    await closeRecoveryAlarm.runDue(closeRecovery.dependencies);
    await expect(
      (closeRecovery.dependencies.parent as Workflow.Reference<Parent>)
        .get({ id: "parent-close-recovery" })
        .result(),
    ).resolves.toEqual({ status: "cancelled" });
    await expect(
      (closeRecovery.dependencies.child as Workflow.Reference<Child>)
        .get({ id: "child-close-recovery" })
        .result(),
    ).resolves.toEqual({ status: "cancelled" });

    const childJournal = await closeEvents.read({
      stream: actorStream("child:workflow", "child-close-recovery"),
    });
    expect(
      childJournal.filter(
        ({ event }) =>
          (event as Readonly<{ type?: string; operation?: string }>).type ===
            "actor.command.accepted" &&
          (event as Readonly<{ operation?: string }>).operation === "cancel",
      ),
    ).toHaveLength(1);
  },
);

describe("concurrent Workflow execution", { tags: ["compiler"] }, () => {
  beforeAll(() => {
    workflowIRFixtureSystem();
  }, 120_000);

  test(
    "runs concurrent Dependency branches durably and preserves authored result order",
    { timeout: 60_000 },
    async () => {
      const server = workflowIRFixtureSystem().programs.find(({ name }) => name === "server");
      if (!server) throw new Error("Workflow IR fixture has no server Program.");
      const events = createMemoryEventStore<object>();
      const alarm = createManualAlarm();
      const completed: number[] = [];
      let releaseSlow: (() => void) | undefined;
      const slow = new Promise<void>((resolveSlow) => {
        releaseSlow = resolveSlow;
      });
      let phase: "all" | "settled" | "race" = "all";
      await using running = await executeServerLinkedProgramIR(linkProgram(server), {
        ...createWorkflowHost(events, alarm.clock),
        alarm: alarm.dependency,
        search: directDependency({
          async search() {
            return { evidence: "unused" };
          },
        }),
        calculation: directDependency({
          async value({
            input,
            invocation,
          }: {
            input: { value: number };
            invocation: { cancellation: DependencyCancellation };
          }) {
            if (input.value === -1) throw new Error("expected branch failure");
            if (input.value === 2) {
              if (phase === "all") await slow;
              if (phase === "race") await invocation.cancellation.wait();
            } else if (phase === "all") {
              releaseSlow?.();
            }
            completed.push(input.value);
            return { value: input.value };
          },
        }),
      });
      const workflows = running.dependencies.concurrent as Workflow.Reference<ConcurrentWorkflow>;
      const execution = workflows.get({ id: "parallel" });

      await expect(
        execution.start({ input: { left: 2, right: 5 } }, { idempotencyKey: "parallel-start" }),
      ).resolves.toEqual({ status: "started", run: 1 });
      await alarm.runConcurrent(running.dependencies);

      expect(completed).toEqual([5, 2]);
      await expect(execution.result()).resolves.toEqual({
        status: "succeeded",
        value: { total: 7 },
      });

      phase = "settled";
      const settled = (
        running.dependencies["concurrent-settled"] as Workflow.Reference<ConcurrentSettledWorkflow>
      ).get({ id: "settled" });
      await settled.start({ input: { left: -1, right: 5 } }, { idempotencyKey: "settled-start" });
      await alarm.runConcurrent(running.dependencies);
      await expect(settled.result()).resolves.toEqual({
        status: "succeeded",
        value: { completed: 2 },
      });

      phase = "race";
      const racing = (
        running.dependencies["concurrent-race"] as Workflow.Reference<ConcurrentRaceWorkflow>
      ).get({ id: "race" });
      await racing.start({ input: { left: 2, right: 5 } }, { idempotencyKey: "race-start" });
      await alarm.runConcurrent(running.dependencies);
      await expect(racing.result()).resolves.toEqual({
        status: "succeeded",
        value: { winner: 5 },
      });
    },
  );

  test(
    "recovers every concurrent policy after provider completion precedes its durable commit",
    { timeout: 45_000 },
    async () => {
      const server = workflowIRFixtureSystem().programs.find(({ name }) => name === "server");
      if (!server) throw new Error("Workflow IR fixture has no server Program.");
      const linked = linkProgram(server);
      const scenarios = [
        {
          dependency: "concurrent",
          id: "all-completion-crash",
          input: { left: 2, right: 5 },
          result: { status: "succeeded", value: { total: 7 } },
          identities: 2,
        },
        {
          dependency: "concurrent-settled",
          id: "settled-completion-crash",
          input: { left: -1, right: 5 },
          result: { status: "succeeded", value: { completed: 2 } },
          identities: 2,
        },
        {
          dependency: "concurrent-race",
          id: "race-completion-crash",
          input: { left: 2, right: 5 },
          result: { status: "succeeded", value: { winner: 2 } },
          identities: 1,
        },
      ] as const;

      for (const scenario of scenarios) {
        const events = createMemoryEventStore<object>();
        const invocations: string[] = [];
        let providerReturned = false;
        const calculation = directDependency({
          async value({
            input,
            invocation,
          }: {
            input: { value: number };
            invocation: { id: string };
          }) {
            invocations.push(invocation.id);
            providerReturned = true;
            if (input.value === -1) throw new Error("expected branch failure");
            return { value: input.value };
          },
        });
        let failCompletion = true;
        const stream = actorStream(`${scenario.dependency}:workflow`, scenario.id);
        const faultedEvents = new Proxy(events, {
          get(target, property, receiver) {
            if (property !== "append") return Reflect.get(target, property, receiver);
            return async (input: Parameters<typeof events.append>[0]) => {
              if (
                failCompletion &&
                providerReturned &&
                input.stream === stream &&
                input.events.some(
                  (event) =>
                    (event as Readonly<{ type?: string }>).type === "actor.command.completed",
                )
              ) {
                failCompletion = false;
                throw new Error("injected concurrent completion crash");
              }
              return await events.append(input);
            };
          },
        });
        const firstAlarm = createManualAlarm();
        {
          await using first = await executeServerLinkedProgramIR(linked, {
            ...createWorkflowHost(faultedEvents, firstAlarm.clock),
            alarm: firstAlarm.dependency,
            search: directDependency({
              async search() {
                return { evidence: "unused" };
              },
            }),
            calculation,
          });
          const execution = (
            first.dependencies[scenario.dependency] as Workflow.Reference<ConcurrentWorkflow>
          ).get({ id: scenario.id });
          await execution.start(
            { input: scenario.input },
            { idempotencyKey: `${scenario.id}:start` },
          );
          await expect(firstAlarm.runDue(first.dependencies)).rejects.toThrow(
            "injected concurrent completion crash",
          );
        }

        const recoveredAlarm = createManualAlarm();
        await using recovered = await executeServerLinkedProgramIR(linked, {
          ...createWorkflowHost(events, recoveredAlarm.clock),
          alarm: recoveredAlarm.dependency,
          search: directDependency({
            async search() {
              return { evidence: "unused" };
            },
          }),
          calculation,
        });
        await recoveredAlarm.runDue(recovered.dependencies);
        const execution = (
          recovered.dependencies[scenario.dependency] as Workflow.Reference<ConcurrentWorkflow>
        ).get({ id: scenario.id });
        await expect(execution.result()).resolves.toEqual(scenario.result);
        const identities = new Set(invocations);
        expect(identities.size).toBe(scenario.identities);
        for (const identity of identities) {
          expect(
            invocations.filter((candidate) => candidate === identity).length,
          ).toBeLessThanOrEqual(2);
        }
      }
    },
  );
});

test(
  "keeps lifecycle operations responsive while a Dependency effect is in flight",
  { timeout: 15_000 },
  async () => {
    const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
    if (!server) throw new Error("Workflow fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    let releaseEffect: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    let markCancelled: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      markCancelled = resolve;
    });
    const blocked = new Promise<Readonly<{ evidence: string }>>((resolve) => {
      releaseEffect = () => resolve({ evidence: "Evidence: slow effect" });
    });
    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      search: directDependency({
        async search({
          invocation,
        }: {
          invocation: Readonly<{ cancellation: DependencyCancellation }>;
        }) {
          markStarted?.();
          return await Promise.race([
            blocked,
            invocation.cancellation.wait().then(() => {
              markCancelled?.();
              return { evidence: "Evidence: cancelled effect" };
            }),
          ]);
        },
      }),
    });
    const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
      id: "responsive",
    });
    await execution.start(
      { input: { question: "slow effect" } },
      { idempotencyKey: "responsive-start" },
    );
    await execution.approve({ wait: "completed", idempotencyKey: "responsive-approve" });
    for (let step = 0; alarm.next()?.dependency !== "research" && step < 32; step += 1) {
      await alarm.runNext(running.dependencies);
    }
    expect(alarm.next()).toMatchObject({ dependency: "research", operation: "$effect" });
    const delivery = alarm.runNext(running.dependencies);
    await started;

    await expect(execution.state()).resolves.toMatchObject({
      status: "running",
      state: { phase: "review" },
    });
    await expect(
      execution.revise(
        { instruction: "Keep the blocked work observable." },
        { idempotencyKey: "responsive-revise" },
      ),
    ).resolves.toEqual({
      status: "succeeded",
      value: { revised: true },
    });
    await expect(execution.pause()).resolves.toEqual({ status: "paused" });
    await expect(execution.cancel()).resolves.toEqual({ status: "cancelled" });
    await cancelled;
    releaseEffect?.();
    await delivery;
    await expect(execution.state()).resolves.toMatchObject({
      status: "cancelled",
      state: { phase: "working" },
    });
    await alarm.runDue(running.dependencies);
    await expect(execution.result()).resolves.toEqual({ status: "cancelled" });
  },
);

test(
  "runs shielded cleanup durably after cancelling in-flight work",
  { timeout: 20_000 },
  async () => {
    const server = workflowCancellationFixtureSystem().programs.find(
      ({ name }) => name === "server",
    );
    if (!server) throw new Error("Workflow cancellation fixture has no server Program.");
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    let markWorkStarted: (() => void) | undefined;
    let markWorkCancelled: (() => void) | undefined;
    let markCleanupStarted: (() => void) | undefined;
    let releaseCleanup: (() => void) | undefined;
    const workStarted = new Promise<void>((resolve) => {
      markWorkStarted = resolve;
    });
    const workCancelled = new Promise<void>((resolve) => {
      markWorkCancelled = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });
    const cleanupBlocked = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let cleanupCalls = 0;

    await using running = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, alarm.clock),
      alarm: alarm.dependency,
      work: directDependency({
        async perform({
          invocation,
        }: {
          invocation: Readonly<{ cancellation: DependencyCancellation }>;
        }) {
          markWorkStarted?.();
          await invocation.cancellation.wait();
          markWorkCancelled?.();
          return { accepted: true };
        },
        async release() {
          cleanupCalls += 1;
          markCleanupStarted?.();
          await cleanupBlocked;
          return { released: true };
        },
      }),
    });
    const execution = (running.dependencies.cleanup as Workflow.Reference<CleanupWorkflow>).get({
      id: "cleanup-1",
    });
    await execution.start({ input: { id: "resource-1" } }, { idempotencyKey: "cleanup:start" });
    await nextWorkflowEffect(alarm, running.dependencies, "cleanup");
    const workDelivery = alarm.runNext(running.dependencies);
    await workStarted;

    await expect(execution.cancel({ idempotencyKey: "cleanup:cancel" })).resolves.toEqual({
      status: "cancelling",
    });
    await workCancelled;
    await workDelivery;
    await nextWorkflowEffect(alarm, running.dependencies, "cleanup");
    const cleanupDelivery = alarm.runNext(running.dependencies);
    await cleanupStarted;
    await expect(execution.state()).resolves.toMatchObject({
      status: "cancelling",
      state: { phase: "cleaning" },
    });

    releaseCleanup?.();
    await cleanupDelivery;
    await alarm.runDue(running.dependencies);
    await expect(execution.result()).resolves.toEqual({ status: "cancelled" });
    expect(cleanupCalls).toBe(1);
  },
);

test("waits for cooperative Dependency cancellation only when the effect requests it", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const alarm = createManualAlarm();
  let markStarted: (() => void) | undefined;
  let markCancelled: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const cancelled = new Promise<void>((resolve) => {
    markCancelled = resolve;
  });
  await using running = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, alarm.clock),
    alarm: alarm.dependency,
    search: directDependency({
      async search({
        invocation,
      }: {
        invocation: Readonly<{ cancellation: DependencyCancellation }>;
      }) {
        markStarted?.();
        await invocation.cancellation.wait();
        markCancelled?.();
        return { evidence: "Evidence: cancellation acknowledged" };
      },
    }),
  });
  const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
    id: "wait-cancellation",
  });
  await execution.start(
    { input: { question: "wait cancellation", cancellation: "wait" } },
    { idempotencyKey: "wait-cancellation:start" },
  );
  await execution.approve({
    wait: "completed",
    idempotencyKey: "wait-cancellation:approve",
  });
  await nextWorkflowEffect(alarm, running.dependencies);
  const delivery = alarm.runNext(running.dependencies);
  await started;

  await expect(execution.cancel()).resolves.toEqual({ status: "cancelling" });
  await cancelled;
  await delivery;
  await expect(execution.result()).resolves.toEqual({ status: "cancelled" });
});

test("recovers a durable wait-cancellation request before provider dispatch", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const firstAlarm = createManualAlarm();
  let calls = 0;
  const search = directDependency({
    async search() {
      calls += 1;
      return { evidence: "Evidence: should not dispatch" };
    },
  });

  {
    await using first = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, firstAlarm.clock),
      alarm: firstAlarm.dependency,
      search,
    });
    const execution = (first.dependencies.research as Workflow.Reference<Research>).get({
      id: "recover-wait-cancellation",
    });
    await execution.start(
      { input: { question: "recover cancellation", cancellation: "wait" } },
      { idempotencyKey: "recover-wait-cancellation:start" },
    );
    await execution.approve({
      wait: "completed",
      idempotencyKey: "recover-wait-cancellation:approve",
    });
    await nextWorkflowEffect(firstAlarm, first.dependencies);
    await expect(execution.cancel()).resolves.toEqual({ status: "cancelling" });
  }

  const recoveredAlarm = createManualAlarm();
  await using recovered = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, recoveredAlarm.clock),
    alarm: recoveredAlarm.dependency,
    search,
  });
  await recoveredAlarm.runDue(recovered.dependencies);
  const execution = (recovered.dependencies.research as Workflow.Reference<Research>).get({
    id: "recover-wait-cancellation",
  });
  await expect(execution.result()).resolves.toEqual({ status: "cancelled" });
  expect(calls).toBe(0);
});

test("abandons an in-flight Dependency without signalling its provider", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const alarm = createManualAlarm();
  let markStarted: (() => void) | undefined;
  let release: (() => void) | undefined;
  let cancellation: DependencyCancellation | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await using running = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, alarm.clock),
    alarm: alarm.dependency,
    search: directDependency({
      async search({
        invocation,
      }: {
        invocation: Readonly<{ cancellation: DependencyCancellation }>;
      }) {
        cancellation = invocation.cancellation;
        markStarted?.();
        await blocked;
        return { evidence: "Evidence: abandoned provider finished" };
      },
    }),
  });
  const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
    id: "abandon-cancellation",
  });
  await execution.start(
    { input: { question: "abandon cancellation", cancellation: "abandon" } },
    { idempotencyKey: "abandon-cancellation:start" },
  );
  await execution.approve({
    wait: "completed",
    idempotencyKey: "abandon-cancellation:approve",
  });
  await nextWorkflowEffect(alarm, running.dependencies);
  const delivery = alarm.runNext(running.dependencies);
  await started;

  await expect(execution.cancel()).resolves.toEqual({ status: "cancelled" });
  expect(cancellation?.requested()).toBe(false);
  release?.();
  await delivery;
  await expect(execution.result()).resolves.toEqual({ status: "cancelled" });
});

test("durably times out a blocked attempt, retries, and fences its late result", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const alarm = createManualAlarm();
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstResult = new Promise<Readonly<{ evidence: string }>>((resolve) => {
    releaseFirst = () => resolve({ evidence: "Evidence: late attempt" });
  });
  const attempts: number[] = [];
  const invocations: string[] = [];
  await using running = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, alarm.clock),
    alarm: alarm.dependency,
    search: directDependency({
      async search({ invocation }: { invocation: Readonly<{ id: string; attempt: number }> }) {
        attempts.push(invocation.attempt);
        invocations.push(invocation.id);
        if (invocation.attempt === 1) {
          markFirstStarted?.();
          return await firstResult;
        }
        return { evidence: "Evidence: recovered attempt" };
      },
    }),
  });
  const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
    id: "attempt-timeout",
  });
  await execution.start(
    { input: { question: "timeout recovery", attempt: 1_000 } },
    { idempotencyKey: "attempt-timeout:start" },
  );
  await execution.approve({
    wait: "completed",
    idempotencyKey: "attempt-timeout:approve",
  });
  await nextWorkflowEffect(alarm, running.dependencies);
  const lateDelivery = alarm.runNext(running.dependencies);
  await firstStarted;

  const timeoutAt = alarm.nextAt();
  expect(timeoutAt).toBeDefined();
  alarm.advance((timeoutAt as number) - alarm.now());
  await alarm.runNext(running.dependencies);
  await alarm.runDue(running.dependencies);

  await expect(execution.result()).resolves.toEqual({
    status: "succeeded",
    value: { report: "Evidence: recovered attempt" },
  });
  expect(attempts).toEqual([1, 2]);
  expect(new Set(invocations).size).toBe(1);
  expect(
    JSON.stringify(
      await events.read({ stream: actorStream("research:workflow", "attempt-timeout") }),
    ),
  ).toContain("WorkflowEffectTimeout");

  releaseFirst?.();
  await lateDelivery;
  await expect(execution.result()).resolves.toEqual({
    status: "succeeded",
    value: { report: "Evidence: recovered attempt" },
  });
});

test("enforces one total effect deadline across attempts and retry delay", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const alarm = createManualAlarm();
  let releaseEffect: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<Readonly<{ evidence: string }>>((resolve) => {
    releaseEffect = () => resolve({ evidence: "Evidence: late total-timeout result" });
  });
  let attempts = 0;
  await using running = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, alarm.clock),
    alarm: alarm.dependency,
    search: directDependency({
      async search() {
        attempts += 1;
        markStarted?.();
        return await blocked;
      },
    }),
  });
  const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
    id: "total-timeout",
  });
  await execution.start(
    { input: { question: "total timeout", total: 1_000, attempt: 5_000 } },
    { idempotencyKey: "total-timeout:start" },
  );
  await execution.approve({
    wait: "completed",
    idempotencyKey: "total-timeout:approve",
  });
  await nextWorkflowEffect(alarm, running.dependencies);
  const lateDelivery = alarm.runNext(running.dependencies);
  await started;

  const timeoutAt = alarm.nextAt();
  expect(timeoutAt).toBeDefined();
  alarm.advance((timeoutAt as number) - alarm.now());
  await alarm.runNext(running.dependencies);
  await alarm.runDue(running.dependencies);

  await expect(execution.result()).resolves.toEqual({
    status: "failed",
    failure: {
      type: "dependency",
      data: {
        dependency: "search",
        operation: "search",
        name: "WorkflowEffectTimeout",
        message: "Workflow effect 0 attempt 1 exceeded its deadline.",
      },
    },
  });
  expect(attempts).toBe(1);
  releaseEffect?.();
  await lateDelivery;
  await expect(execution.result()).resolves.toMatchObject({ status: "failed" });
});

test("does not retry a declared non-retryable Dependency failure", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const alarm = createManualAlarm();
  let attempts = 0;
  await using running = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, alarm.clock),
    alarm: alarm.dependency,
    search: directDependency({
      async search() {
        attempts += 1;
        throw new DependencyFailureError({
          type: "fatal",
          data: { reason: "invalid request" },
          retry: { delay: 1 },
        });
      },
    }),
  });
  const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
    id: "non-retryable",
  });
  await execution.start(
    { input: { question: "fatal", nonRetryable: "fatal" } },
    { idempotencyKey: "non-retryable:start" },
  );
  await execution.approve({
    wait: "completed",
    idempotencyKey: "non-retryable:approve",
  });
  await alarm.runDue(running.dependencies);

  await expect(execution.result()).resolves.toEqual({
    status: "failed",
    failure: {
      type: "dependency",
      data: {
        dependency: "search",
        operation: "search",
        name: "fatal",
        message: "fatal",
      },
    },
  });
  expect(attempts).toBe(1);
});

test("renews a durable heartbeat deadline and carries its checkpoint into retry", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const alarm = createManualAlarm();
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  let sendHeartbeat: ((details: object) => Promise<void>) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstResult = new Promise<Readonly<{ evidence: string }>>((resolve) => {
    releaseFirst = () => resolve({ evidence: "Evidence: stale heartbeat attempt" });
  });
  const checkpoints: unknown[] = [];
  await using running = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, alarm.clock),
    alarm: alarm.dependency,
    search: directDependency({
      async search({
        invocation,
      }: {
        invocation: Readonly<{
          attempt: number;
          [dependencyInvocationControl]?: DependencyInvocationControl;
        }>;
      }) {
        const control = invocation[dependencyInvocationControl];
        checkpoints.push(control?.previousHeartbeat);
        if (invocation.attempt === 1) {
          sendHeartbeat = async (details) => {
            await control?.heartbeat(details);
          };
          markFirstStarted?.();
          return await firstResult;
        }
        return { evidence: "Evidence: resumed from heartbeat" };
      },
    }),
  });
  const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
    id: "heartbeat-timeout",
  });
  await execution.start(
    { input: { question: "heartbeat recovery", heartbeat: 1_000 } },
    { idempotencyKey: "heartbeat-timeout:start" },
  );
  await execution.approve({
    wait: "completed",
    idempotencyKey: "heartbeat-timeout:approve",
  });
  await nextWorkflowEffect(alarm, running.dependencies);
  const lateDelivery = alarm.runNext(running.dependencies);
  await firstStarted;

  const originalTimeout = alarm.nextAt();
  expect(originalTimeout).toBeDefined();
  alarm.advance(500);
  await sendHeartbeat?.({ completed: 3 });
  const renewedTimeout = alarm.nextAt();
  expect(renewedTimeout).toBeDefined();
  expect(renewedTimeout).toBeGreaterThan(originalTimeout as number);

  alarm.advance((renewedTimeout as number) - alarm.now());
  await alarm.runNext(running.dependencies);
  await alarm.runDue(running.dependencies);
  await expect(execution.result()).resolves.toEqual({
    status: "succeeded",
    value: { report: "Evidence: resumed from heartbeat" },
  });
  expect(checkpoints).toEqual([undefined, { completed: 3 }]);

  releaseFirst?.();
  await lateDelivery;
});

test("repairs a committed outbound intent after restart before dispatch", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const firstAlarm = createManualAlarm();
  const invocations: string[] = [];
  const search = directDependency({
    async search({ input, invocation }: { input: { query: string }; invocation: { id: string } }) {
      invocations.push(invocation.id);
      return { evidence: `Evidence: ${input.query}` };
    },
  });

  {
    await using first = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(events, firstAlarm.clock),
      alarm: firstAlarm.dependency,
      search,
    });
    const execution = (first.dependencies.research as Workflow.Reference<Research>).get({
      id: "restart-outbound",
    });
    await execution.start(
      { input: { question: "restart recovery" } },
      { idempotencyKey: "restart-outbound:start" },
    );
    await execution.approve({
      wait: "completed",
      idempotencyKey: "restart-outbound:approve",
    });
    await nextWorkflowEffect(firstAlarm, first.dependencies);
    expect(invocations).toEqual([]);
  }

  const recoveredAlarm = createManualAlarm();
  await using recovered = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, recoveredAlarm.clock),
    alarm: recoveredAlarm.dependency,
    search,
  });
  await recoveredAlarm.runDue(recovered.dependencies);
  const execution = (recovered.dependencies.research as Workflow.Reference<Research>).get({
    id: "restart-outbound",
  });
  await expect(execution.result()).resolves.toEqual({
    status: "succeeded",
    value: { report: "Evidence: restart recovery" },
  });
  expect(invocations).toHaveLength(1);
});

test("recovers provider-completion uncertainty with one stable invocation identity", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const firstAlarm = createManualAlarm();
  const invocations: string[] = [];
  const outcomes = new Map<string, Readonly<{ evidence: string }>>();
  const search = directDependency({
    async search({ input, invocation }: { input: { query: string }; invocation: { id: string } }) {
      invocations.push(invocation.id);
      const retained = outcomes.get(invocation.id);
      if (retained !== undefined) return retained;
      const outcome = { evidence: `Evidence: ${input.query}` };
      outcomes.set(invocation.id, outcome);
      return outcome;
    },
  });
  let failCompletion = true;
  const faultedEvents = new Proxy(events, {
    get(target, property, receiver) {
      if (property !== "append") return Reflect.get(target, property, receiver);
      return async (input: {
        stream: string;
        expectedRevision: number;
        events: readonly object[];
      }) => {
        if (
          failCompletion &&
          input.events.some(
            (event) => (event as Readonly<{ type?: string }>).type === "actor.outbound.completed",
          )
        ) {
          failCompletion = false;
          throw new Error("injected crash after provider completion");
        }
        return await events.append(input);
      };
    },
  });

  {
    await using first = await executeServerLinkedProgramIR(linkProgram(server), {
      ...createWorkflowHost(faultedEvents, firstAlarm.clock),
      alarm: firstAlarm.dependency,
      search,
    });
    const execution = (first.dependencies.research as Workflow.Reference<Research>).get({
      id: "completion-crash",
    });
    await execution.start(
      { input: { question: "completion recovery" } },
      { idempotencyKey: "completion-crash:start" },
    );
    await execution.approve({
      wait: "completed",
      idempotencyKey: "completion-crash:approve",
    });
    await nextWorkflowEffect(firstAlarm, first.dependencies);
    await expect(firstAlarm.runNext(first.dependencies)).rejects.toThrow(
      "injected crash after provider completion",
    );
  }

  const recoveredAlarm = createManualAlarm();
  await using recovered = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, recoveredAlarm.clock),
    alarm: recoveredAlarm.dependency,
    search,
  });
  await recoveredAlarm.runDue(recovered.dependencies);
  const execution = (recovered.dependencies.research as Workflow.Reference<Research>).get({
    id: "completion-crash",
  });
  await expect(execution.result()).resolves.toEqual({
    status: "succeeded",
    value: { report: "Evidence: completion recovery" },
  });
  expect(invocations).toHaveLength(2);
  expect(new Set(invocations).size).toBe(1);
});

test("fences a stale outbound provider and deduplicates duplicate delivery", async () => {
  const server = workflowFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Workflow fixture has no server Program.");
  const events = createMemoryEventStore<object>();
  const alarm = createManualAlarm();
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstResult = new Promise<Readonly<{ evidence: string }>>((resolve) => {
    releaseFirst = () => resolve({ evidence: "Evidence: stale provider" });
  });
  const invocations: string[] = [];
  let calls = 0;
  const search = directDependency({
    async search({ invocation }: { invocation: { id: string } }) {
      calls += 1;
      invocations.push(invocation.id);
      if (calls === 1) {
        markFirstStarted?.();
        return await firstResult;
      }
      return { evidence: "Evidence: current provider" };
    },
  });
  await using running = await executeServerLinkedProgramIR(linkProgram(server), {
    ...createWorkflowHost(events, alarm.clock),
    alarm: alarm.dependency,
    search,
  });
  const execution = (running.dependencies.research as Workflow.Reference<Research>).get({
    id: "stale-provider",
  });
  await execution.start(
    { input: { question: "fencing" } },
    { idempotencyKey: "stale-provider:start" },
  );
  await execution.approve({
    wait: "completed",
    idempotencyKey: "stale-provider:approve",
  });
  const target = await nextWorkflowEffect(alarm, running.dependencies);
  const staleDelivery = alarm.runNext(running.dependencies);
  await firstStarted;
  alarm.advance(30_001);
  await alarm.deliver(target, running.dependencies, "alarm:duplicate-after-lease");
  releaseFirst?.();
  await staleDelivery;
  await alarm.deliver(target, running.dependencies, "alarm:duplicate-after-completion");

  await expect(execution.result()).resolves.toEqual({
    status: "succeeded",
    value: { report: "Evidence: current provider" },
  });
  expect(calls).toBe(2);
  expect(new Set(invocations).size).toBe(1);
  const journal = await events.read({
    stream: actorStream("research:workflow", "stale-provider"),
  });
  expect(
    journal
      .map(({ event }) => event as Readonly<{ type?: string; attempt?: number }>)
      .filter((event) => event.type === "actor.outbound.claimed")
      .map((event) => event.attempt),
  ).toEqual([1, 2]);
  expect(
    journal.filter(
      ({ event }) => (event as Readonly<{ type?: string }>).type === "actor.outbound.completed",
    ),
  ).toHaveLength(1);
});

async function nextWorkflowEffect(
  alarm: ReturnType<typeof createManualAlarm>,
  dependencies: Readonly<Record<string, unknown>>,
  dependency = "research",
): Promise<Readonly<{ dependency: string; operation: string; input: object }>> {
  for (let step = 0; step < 64; step += 1) {
    const target = alarm.next();
    if (target?.dependency === dependency && target.operation === "$effect") {
      return target;
    }
    if (!(await alarm.runNext(dependencies))) break;
  }
  throw new Error("Workflow effect was not scheduled.");
}

async function advanceWorkflowScheduleUntil(
  workflows: Workflow.Reference<Research>,
  id: string,
  alarm: ReturnType<typeof createManualAlarm>,
  dependencies: Readonly<Record<string, unknown>>,
  predicate: (schedule: WorkflowScheduleDescription<Research>) => boolean,
): Promise<WorkflowScheduleDescription<Research>> {
  for (let delivery = 0; delivery < 128; delivery += 1) {
    const schedule = await workflows.describeSchedule({ id });
    if (predicate(schedule)) return schedule;
    if (!(await alarm.runNext(dependencies))) {
      throw new Error(`Workflow schedule ${id} stopped making durable progress.`);
    }
  }
  throw new Error(`Workflow schedule ${id} did not reach the expected state.`);
}

function actorStream(name: string, key: string): string {
  return `actor:${name.length}:${name}:${key.length}:${key}`;
}

function workflowUpgradeFixtureSource(version: "old" | "new" | "compatible"): string {
  const meaning = version === "new" ? "new" : "old";
  const revision = version === "old" ? 1 : 2;
  return `
import { createSystem } from "@/core/system";
import { createWorkflow, type Workflow } from "@/features/workflow";

type Upgrade = Workflow<{
  Name: "upgrade";
  Id: string;
  Input: undefined;
  State: { approved: boolean; marker: string };
  Result: { marker: string };
  Revision: ${revision};
  Actions: {
    approve: Workflow.Action<undefined, { approved: true }>;
  };
}>;

const workflow = createWorkflow<Upgrade>({
  state: () => ({ approved: false, marker: "${meaning}-state" }),
  actions: {
    approve({ state }) {
      state.approved = true;
      state.marker = "${meaning}-action";
      return { approved: true };
    },
  },
  async run({ state, wait }) {
    await wait(() => state.approved);
    return { marker: state.marker + ":${meaning}-run" };
  },
});

export default createSystem({ features: { workflow } });
`;
}

function workflowNativeFixtureSource(): string {
  return `
import { type Dependency } from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { createSystem } from "@/core/system";
import { createWorkflow, type Workflow } from "@/features/workflow";
import type {
  Alarm,
  Clock,
  EventStore,
  ServerProcess,
} from "@/platforms/server";

type Search = Dependency<{
  Operations: {
    search(input: { query: string }): Promise<{ answer: string }>;
    status(input: {}): Promise<{ started: boolean; cancelled: boolean }>;
  };
}>;

type Recorder = Dependency<{
  Operations: {
    record(input: { value: string }): Promise<void>;
  };
}>;

type NativeWorkflow = Workflow<{
  Name: "research";
  Id: string;
  Input: { query: string };
  State: { answer: string };
  Visibility: { answer: true };
  Result: { answer: string };
  Dependencies: { search: Search };
}>;

const workflow = createWorkflow<NativeWorkflow>({
  state: () => ({ answer: "" }),
  actions: {},
  async run({ input, state, dependencies }) {
    const result = await dependencies.search.search(
      { query: input.query },
      {
        retry: { maximumAttempts: 2, initialDelay: 10 },
        timeout: { total: 120_000, attempt: 60_000 },
        cancellation: input.query === "cancel" ? "wait" : "request",
      },
    );
    state.answer = result.answer;
    return { answer: result.answer };
  },
});

type Driver = Dependency<{
  Operations: {
    run(input: {}): Promise<{}>;
  };
}>;

async function normalizedJournal(
  events: EventStore<object>,
  key: string,
): Promise<readonly object[]> {
  const stream =
    key === "native"
      ? "actor:17:research:workflow:6:native"
      : key === "cancelled"
        ? "actor:17:research:workflow:9:cancelled"
        : "actor:26:research:workflow-schedule:6:native";
  const stored = await events.read({ stream });
  const normalized: object[] = [];
  const invocations: Partial<Record<string, string>> = {};
  for (const entry of stored) {
    const event = entry.event as {
      type: string;
      invocation?: string;
      operation?: string;
      attempt?: number;
      timer?: string;
      generation?: number;
      outbound?: string;
      state?: { status?: string; result?: object };
      outcome?: { status?: string };
      target?: { dependency?: string; operation?: string };
    };
    if (event.type === "actor.command.accepted") {
      if (event.invocation !== undefined && event.operation === "cancel") {
        invocations[event.invocation] = "direct:cancel";
      }
      normalized.push({
        type: event.type,
        invocation:
          event.invocation === undefined
            ? undefined
            : (invocations[event.invocation] ?? event.invocation),
        operation: event.operation,
      });
    } else if (event.type === "actor.command.claimed") {
      normalized.push({
        type: event.type,
        invocation:
          event.invocation === undefined
            ? undefined
            : (invocations[event.invocation] ?? event.invocation),
        attempt: event.attempt,
      });
    } else if (event.type === "actor.command.completed") {
      normalized.push({
        type: event.type,
        invocation:
          event.invocation === undefined
            ? undefined
            : (invocations[event.invocation] ?? event.invocation),
        outcome: event.outcome?.status,
        status: event.state?.status,
        result: event.state?.result,
      });
    } else if (
      event.type === "actor.timer.scheduled" ||
      event.type === "actor.timer.fired" ||
      event.type === "actor.timer.cancelled"
    ) {
      normalized.push({
        type: event.type,
        timer: event.timer,
        generation: event.generation,
      });
    } else if (event.type === "actor.outbound.scheduled") {
      normalized.push({
        type: event.type,
        outbound: event.outbound,
        generation: event.generation,
        dependency: event.target?.dependency,
        operation: event.target?.operation,
      });
    } else if (
      event.type === "actor.outbound.claimed" ||
      event.type === "actor.outbound.completed"
    ) {
      normalized.push({
        type: event.type,
        outbound: event.outbound,
        generation: event.generation,
        attempt: event.attempt,
      });
    } else if (event.type === "actor.outbound.cancellation-requested") {
      normalized.push({
        type: event.type,
        outbound: event.outbound,
        generation: event.generation,
      });
    }
  }
  return normalized;
}

type DriverFeature = {
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: {
        alarm: Alarm;
          clock: Clock;
          events: EventStore<object>;
          recorder: Recorder;
          research: Workflow.Reference<typeof workflow>;
          search: Search;
      };
      Provides: { driver: Driver };
    };
  };
};

const driver = createFeature<DriverFeature>({
  programs: {
    server: {
      start({ dependencies }) {
        return {
          driver: {
            async run() {
              const normal = dependencies.research.get({ id: "native" });
              const cancellation = dependencies.research.get({ id: "cancelled" });
              await dependencies.research.createSchedule(
                {
                  id: "native",
                  definition: {
                    input: { query: "scheduled" },
                    timing: { every: 1_000_000 },
                  },
                  paused: true,
                  trigger: true,
                  note: "Native schedule.",
                  remaining: 1,
                },
                { idempotencyKey: "native-schedule:create" },
              );
              await normal.start(
                { input: { query: "equivalence" }, conflict: "use" },
                { idempotencyKey: "native:start" },
              );
              await cancellation.start(
                { input: { query: "cancel" }, conflict: "use" },
                { idempotencyKey: "cancelled:start" },
              );
              const provider = await dependencies.search.status({});
              const cancellationState = await cancellation.state();
              if (
                provider.started &&
                (cancellationState.status === "running" || cancellationState.status === "paused")
              ) {
                await cancellation.cancel();
              }
              const normalResult = await normal.result();
              const cancellationResult = await cancellation.result();
              let schedule = await dependencies.research.describeSchedule({ id: "native" });
              const scheduleControl = {
                status: schedule.status,
                note: schedule.note,
                remaining: schedule.remaining,
              };
              if (
                schedule.status !== "deleted" &&
                schedule.recent.some((item) => item.status === "started")
              ) {
                await dependencies.research.deleteSchedule(
                  { id: "native" },
                  { idempotencyKey: "native-schedule:delete" },
                );
                schedule = await dependencies.research.describeSchedule({ id: "native" });
              }
              if (
                normalResult.status === "idle" ||
                normalResult.status === "running" ||
                normalResult.status === "paused" ||
                normalResult.status === "cancelling" ||
                cancellationResult.status === "idle" ||
                cancellationResult.status === "running" ||
                cancellationResult.status === "paused" ||
                cancellationResult.status === "cancelling" ||
                !provider.cancelled ||
                schedule.status !== "deleted"
              ) {
                await dependencies.alarm.schedule({
                  id: "workflow-native:poll",
                  at: dependencies.clock.now({}) + 10,
                  target: {
                    dependency: "driver",
                    operation: "run",
                    input: {},
                  },
                });
              } else {
                const visible = await dependencies.research.list({ limit: 20 });
                const schedules = await dependencies.research.listSchedules({ limit: 20 });
                const runs = await dependencies.research.listScheduleRuns({
                  id: "native",
                  limit: 20,
                });
                const normalJournal = await normalizedJournal(dependencies.events, "native");
                const cancellationJournal = await normalizedJournal(
                  dependencies.events,
                  "cancelled",
                );
                const scheduleJournal = await normalizedJournal(
                  dependencies.events,
                  "schedule",
                );
                await dependencies.recorder.record({
                  value:
                    "native:" +
                    JSON.stringify({
                      normal: { result: normalResult, journal: normalJournal },
                      cancellation: {
                        result: cancellationResult,
                        journal: cancellationJournal,
                      },
                      schedule: {
                        control: scheduleControl,
                        status: schedule.status,
                        listed: schedules.schedules.map((item) => ({
                          id: item.id,
                          status: item.status,
                        })),
                        runs: runs.runs.map((item) => ({
                          occurrence: item.occurrence,
                          status: item.workflow.status,
                          state: item.state,
                        })),
                        recent: schedule.recent.map((item) => ({
                          source: item.occurrence.source,
                          status: item.status,
                        })),
                        journal: scheduleJournal,
                      },
                      visibility: {
                        normal: visible.workflows
                          .filter((item) => item.workflow.id === "native")
                          .map((item) => ({
                            id: item.workflow.id,
                            status: item.workflow.status,
                            state: item.state,
                          })),
                        cancellation: visible.workflows
                          .filter((item) => item.workflow.id === "cancelled")
                          .map((item) => ({
                            id: item.workflow.id,
                            status: item.workflow.status,
                            state: item.state,
                          })),
                        scheduled: visible.workflows
                          .filter(
                            (item) =>
                              item.workflow.id !== "native" &&
                              item.workflow.id !== "cancelled",
                          )
                          .map((item) => ({
                            id: item.workflow.id,
                            status: item.workflow.status,
                            state: item.state,
                          })),
                      },
                      provider,
                    }),
                });
              }
              return {};
            },
          },
        };
      },
    },
  },
}) as Feature<DriverFeature>;

type StarterFeature = {
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: { driver: Driver };
    };
  };
};

const starter = createFeature<StarterFeature>({
  programs: {
    server: {
      async start({ dependencies }) {
        await dependencies.driver.run({});
      },
    },
  },
}) as Feature<StarterFeature>;

export default createSystem({
  features: { workflow, driver, starter },
});
`;
}

async function runWorkflowNativeFixture(
  executable: string,
  output: string,
  database: string,
): Promise<readonly unknown[]> {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      KIT_DATABASE: database,
      KIT_RECORDER_INPUT: "{}",
      KIT_RECORDER_OUTPUT: output,
    },
    stdio: "pipe",
  });
  let error = "";
  child.stderr.setEncoding("utf8").on("data", (value: string) => {
    error += value;
  });
  let pollFailure: unknown;
  try {
    await expect
      .poll(
        async () => {
          const contents = await readFile(output, "utf8").catch(() => "");
          return contents.includes("native:");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  } catch (failure) {
    pollFailure = failure;
  } finally {
    child.kill(pollFailure === undefined ? "SIGINT" : "SIGKILL");
  }
  await new Promise<void>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (
        code === 0 ||
        signal === "SIGINT" ||
        (pollFailure !== undefined && signal === "SIGKILL")
      ) {
        resolveExit();
      } else reject(new Error(error || `Production Workflow fixture exited ${code ?? signal}.`));
    });
  });
  if (pollFailure !== undefined) {
    const contents = await readFile(output, "utf8").catch(() => "");
    throw new Error(
      `Production Workflow fixture did not complete.\nstderr:\n${error}\noutput:\n${contents}`,
      { cause: pollFailure },
    );
  }
  return (await readFile(output, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function createWorkflowHost(events: object, clock?: ReturnType<typeof createManualAlarm>["clock"]) {
  let now = 0;
  return {
    events: {
      [dependencyInvocation](operation: string, input: unknown) {
        const implementation = Reflect.get(events, operation);
        if (typeof implementation !== "function") {
          throw new Error(`Unknown EventStore operation ${operation}.`);
        }
        return Reflect.apply(implementation, events, [input]);
      },
    },
    executionContext: directDependency({
      current() {
        return [];
      },
      async run({ input: { task } }: { input: { task(): Promise<object> } }) {
        return await task();
      },
    }),
    synchronization: directDependency({
      async exclusive({ input: { task } }: { input: { task(): Promise<object> } }) {
        return await task();
      },
    }),
    calendar: directDependency({
      async next() {
        return undefined;
      },
    }),
    telemetry: directDependency({ record() {} }),
    clock: clock ?? directDependency({ now: () => ++now }),
    identifiers: directDependency({ create: () => "workflow-worker" }),
    timer: directDependency({ async sleep() {} }),
  };
}

function directDependency<Api extends object>(
  api: Api,
): Api & {
  [dependencyInvocation](
    operation: string,
    input: unknown,
    invocation: Readonly<{ attempt: number }>,
  ): unknown;
} {
  return Object.assign(api, {
    [dependencyInvocation](
      operation: string,
      input: unknown,
      invocation: Readonly<{ attempt: number }>,
    ) {
      const method = Reflect.get(api, operation);
      if (typeof method !== "function") {
        throw new Error(`Unknown test Dependency operation ${operation}.`);
      }
      return Reflect.apply(method, api, [{ input, invocation }]);
    },
  });
}

function createManualAlarm() {
  let now = 0;
  const active = new Map<string, ReturnType<typeof createDependencyCancellation>>();
  const scheduled = new Map<
    string,
    Readonly<{
      at: number;
      target: Readonly<{ dependency: string; operation: string; input: object }>;
      cancellation: ReturnType<typeof createDependencyCancellation>;
    }>
  >();
  const next = () =>
    [...scheduled]
      .filter(([id]) => !active.has(id))
      .sort(
        ([left], [right]) => (scheduled.get(left)?.at ?? 0) - (scheduled.get(right)?.at ?? 0),
      )[0];
  const deliver = async (
    target: Readonly<{ dependency: string; operation: string; input: object }>,
    dependencies: Readonly<Record<string, unknown>>,
    invocation: Readonly<{
      id: string;
      attempt: number;
      scheduledAt: number;
      startedAt: number;
      [dependencyInvocationControl]?: DependencyInvocationControl;
    }>,
  ) => {
    const dependency = dependencies[target.dependency];
    if (!dependency || (typeof dependency !== "object" && typeof dependency !== "function")) {
      throw new Error(`Alarm targets unavailable Dependency ${target.dependency}.`);
    }
    await invokeDependency(dependency as object, target.operation, target.input, invocation);
  };
  return {
    clock: directDependency({ now: () => now }),
    dependency: directDependency({
      async schedule({
        input: { id, at, target },
      }: {
        input: {
          id: string;
          at: number;
          target: Readonly<{ dependency: string; operation: string; input: object }>;
        };
      }) {
        scheduled.set(id, { at, target, cancellation: createDependencyCancellation() });
      },
      async cancel({ input: { id } }: { input: { id: string } }) {
        active.get(id)?.request();
        scheduled.get(id)?.cancellation.request();
        scheduled.delete(id);
      },
      async requestCancellation({ input: { id } }: { input: { id: string } }) {
        active.get(id)?.request();
        scheduled.get(id)?.cancellation.request();
      },
    }),
    next: () => next()?.[1].target,
    clear() {
      for (const cancellation of active.values()) cancellation.request();
      for (const entry of scheduled.values()) entry.cancellation.request();
      active.clear();
      scheduled.clear();
    },
    advance(duration: number) {
      now += duration;
    },
    now: () => now,
    nextAt: () => next()?.[1].at,
    async deliver(
      target: Readonly<{ dependency: string; operation: string; input: object }>,
      dependencies: Readonly<Record<string, unknown>>,
      id = "manual:duplicate",
    ) {
      const cancellation = createDependencyCancellation();
      await deliver(target, dependencies, {
        id,
        attempt: 1,
        scheduledAt: now,
        startedAt: now,
        [dependencyInvocationControl]: {
          heartbeat() {},
          cancellation: forwardDependencyCancellation(cancellation),
        },
      });
    },
    async runNext(dependencies: Readonly<Record<string, unknown>>) {
      const pending = next();
      if (pending === undefined) return false;
      const [id, entry] = pending;
      active.set(id, entry.cancellation);
      now = Math.max(now, entry.at);
      try {
        await deliver(entry.target, dependencies, {
          id: `alarm:${id}`,
          attempt: 1,
          scheduledAt: entry.at,
          startedAt: now,
          [dependencyInvocationControl]: {
            heartbeat() {},
            cancellation: forwardDependencyCancellation(entry.cancellation),
          },
        });
        if (scheduled.get(id) === entry) scheduled.delete(id);
      } finally {
        if (active.get(id) === entry.cancellation) active.delete(id);
      }
      return true;
    },
    async runDue(dependencies: Readonly<Record<string, unknown>>) {
      for (let attempt = 0; scheduled.size > 0 && attempt < 128; attempt += 1) {
        await this.runNext(dependencies);
      }
      if (scheduled.size > 0) {
        throw new Error("Manual alarm did not quiesce after 128 deliveries.");
      }
    },
    async runConcurrent(dependencies: Readonly<Record<string, unknown>>) {
      const deliveries = new Set<Promise<void>>();
      for (let attempt = 0; attempt < 512; attempt += 1) {
        const pending = next();
        if (pending !== undefined) {
          const delivery = this.runNext(dependencies).then(() => {});
          deliveries.add(delivery);
          void delivery.then(
            () => deliveries.delete(delivery),
            () => deliveries.delete(delivery),
          );
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        } else if (deliveries.size > 0) {
          await Promise.race(deliveries);
        } else {
          return;
        }
      }
      throw new Error(
        `Concurrent manual alarm did not quiesce after 512 deliveries; pending=${JSON.stringify([
          ...scheduled.keys(),
        ])}; active=${JSON.stringify([...active.keys()])}.`,
      );
    },
  };
}
