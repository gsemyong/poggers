import { resolve } from "node:path";

import { beforeAll, describe, expect, test } from "vitest";

import type { SystemIR } from "@/compiler/ir";
import { compileSystemSources } from "@/compiler/source";
import type { TypeSchema } from "@/core/intrinsic";
import { executePortableFunctionIR } from "@/execution/interpreter";
import {
  compileWorkflowSource,
  lowerWorkflowAdvanceFunctionIR,
  lowerWorkflowTransferFunctionIR,
  workflowArtifactIR,
  workflowCompilerExtension,
  workflowCompilerIR,
  workflowControllerSource,
  workflowExecutableIR,
} from "@/features/workflow/compiler";
import {
  advanceWorkflowExecutable,
  executeWorkflowExecutableProcedure,
  replayWorkflowExecutable,
  transferWorkflowExecutable,
} from "@/features/workflow/executor";
import {
  advanceWorkflowIRExecution,
  createWorkflowIRExecution,
  requestWorkflowIRCancellation,
  resumeWorkflowIRExecution,
  updateWorkflowIRState,
  validateWorkflowDefinitionIR,
  verifyWorkflowIRReplay,
  WORKFLOW_IR_VERSION,
  WORKFLOW_LANGUAGE_VERSION,
  type WorkflowDefinitionIR,
  type WorkflowIRData,
  type WorkflowIRExecution,
  type WorkflowIRReplayTrace,
} from "@/features/workflow/ir";
import { serverCompilerExtension } from "@/platforms/server/adapter";
import { compileSystemFixture } from "@/testing/compiler";

const schema = {} as TypeSchema;
let compiledSystem: SystemIR;
let cleanupSystem: SystemIR | undefined;

describe("canonical Workflow IR", { tags: ["compiler"] }, () => {
  beforeAll(() => {
    compiledSystem = compileSystemFixture(resolve(import.meta.dirname, "ir.typecheck.ts"), [
      serverCompilerExtension,
      workflowCompilerExtension,
    ]);
  }, 60_000);

  test("lowers the existing state/actions/run source through a Feature-owned extension", () => {
    const feature = compiledSystem.features.find(({ path }) => path === "research");
    const definition = workflowCompilerIR(feature?.extensions?.workflow);

    expect(definition).toMatchObject({
      version: WORKFLOW_IR_VERSION,
      language: WORKFLOW_LANGUAGE_VERSION,
      compiler: "kit/workflow:1",
      contract: {
        name: "research",
        revision: 1,
        actions: {
          approve: {},
          revise: {},
        },
        dependencies: {
          search: {},
        },
        visibility: ["approved", "passes", "phase"],
      },
    });
    expect(definition.blocks.map(({ terminator }) => terminator.kind)).toEqual([
      "branch",
      "continue-as-new",
      "jump",
      "wait",
      "sleep",
      "effect",
      "return",
    ]);

    let execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(
        definition,
        {
          question: "Compiled Workflow",
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
      ),
    );
    expect(execution).toMatchObject({
      status: "suspended",
      state: { phase: "review", passes: 1 },
      pending: { kind: "wait", sequence: 0, until: 500 },
    });

    execution = advanceWorkflowIRExecution(
      definition,
      updateWorkflowIRState(restart(execution), {
        ...execution.state,
        approved: true,
      }),
    );
    expect(execution).toMatchObject({
      status: "suspended",
      state: { timedOut: false },
      pending: { kind: "sleep", sequence: 1, at: 1_000 },
    });

    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "sleep",
      sequence: 1,
      at: 1_000,
    });
    expect(execution).toMatchObject({
      status: "suspended",
      state: { observedAt: 1_000 },
      pending: {
        kind: "effect",
        sequence: 2,
        dependency: "search",
        operation: "search",
        input: { query: "Compiled Workflow" },
        options: {
          retry: { maximumAttempts: 3, initialDelay: 100 },
          timeout: { total: 120_000, attempt: 60_000 },
          cancellation: "request",
        },
      },
    });

    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "effect",
      sequence: 2,
      at: 1_005,
      outcome: { status: "succeeded", value: { evidence: "Compiled evidence" } },
    });
    expect(execution).toMatchObject({
      status: "succeeded",
      state: { phase: "completed", approved: true },
      time: 1_005,
      result: { report: "Compiled evidence" },
    });
  });

  test("captures State initialization and typed Action transitions in the canonical definition", () => {
    const feature = compiledSystem.features.find(({ path }) => path === "research");
    const definition = workflowCompilerIR(feature?.extensions?.workflow);

    const initialized = advanceWorkflowIRExecution(
      selectWorkflowProcedure(definition, definition.initialization),
      createWorkflowIRExecution(
        selectWorkflowProcedure(definition, definition.initialization),
        { question: "Canonical definition" },
        {},
        5,
        { identity: "research-1" },
      ),
    );
    expect(initialized).toMatchObject({
      status: "succeeded",
      identity: "research-1",
      result: {
        phase: "planning",
        approved: false,
        passes: 0,
        observedAt: 0,
        timedOut: false,
      },
    });

    const revise = definition.actionHandlers.revise;
    if (!revise) throw new Error("Compiled Workflow has no revise Action.");
    const revised = advanceWorkflowIRExecution(
      selectWorkflowProcedure(definition, revise),
      createWorkflowIRExecution(
        selectWorkflowProcedure(definition, revise),
        { instruction: "Use canonical Action meaning." },
        initialized.result as Readonly<Record<string, WorkflowIRData>>,
        10,
        {
          identity: "research-1",
          invocation: { id: "revise-1", at: 10 },
        },
      ),
    );
    expect(revised).toMatchObject({
      status: "succeeded",
      identity: "research-1",
      invocation: { id: "revise-1", at: 10 },
      state: { phase: "working", approved: false },
      result: { revised: true },
    });
  });

  test("content-addresses State initialization, Actions, and run as one immutable artifact", () => {
    const feature = compiledSystem.features.find(({ path }) => path === "research");
    const definition = workflowCompilerIR(feature?.extensions?.workflow);
    const copy = JSON.parse(JSON.stringify(definition)) as WorkflowDefinitionIR;

    expect(workflowArtifactIR(copy).id).toBe(workflowArtifactIR(definition).id);
    const reordered: WorkflowDefinitionIR = {
      ...definition,
      contract: {
        ...definition.contract,
        actions: Object.fromEntries(Object.entries(definition.contract.actions).reverse()),
        dependencies: Object.fromEntries(
          Object.entries(definition.contract.dependencies).reverse(),
        ),
      },
    };
    expect(workflowArtifactIR(reordered).id).toBe(workflowArtifactIR(definition).id);

    const initialization = {
      ...definition.initialization,
      blocks: definition.initialization.blocks.map((block, index) =>
        index === 0
          ? {
              ...block,
              body: [
                ...block.body,
                {
                  kind: "let" as const,
                  name: "changedInitialization",
                  value: { kind: "literal" as const, value: true },
                },
              ],
            }
          : block,
      ),
    };
    expect(workflowArtifactIR({ ...definition, initialization }).id).not.toBe(
      workflowArtifactIR(definition).id,
    );

    const revise = definition.actionHandlers.revise;
    if (!revise) throw new Error("Compiled Workflow has no revise Action.");
    const actionHandlers = {
      ...definition.actionHandlers,
      revise: {
        ...revise,
        blocks: revise.blocks.map((block, index) =>
          index === 0
            ? {
                ...block,
                body: [
                  ...block.body,
                  {
                    kind: "let" as const,
                    name: "changedAction",
                    value: { kind: "literal" as const, value: true },
                  },
                ],
              }
            : block,
        ),
      },
    };
    expect(workflowArtifactIR({ ...definition, actionHandlers }).id).not.toBe(
      workflowArtifactIR(definition).id,
    );
  });

  test(
    "compiles runtime-authored source into the canonical Workflow artifact",
    { timeout: 30_000 },
    () => {
      const source = `
type Search = Dependency<{
  Operations: {
    search(input: Readonly<{ query: string }>): Promise<Readonly<{ evidence: string }>>;
  };
}>;

type DynamicResearch = Workflow<{
  Name: "dynamic-research";
  Id: string;
  Input: Readonly<{ question: string }>;
  State: { phase: "working" | "completed" };
  Result: Readonly<{ report: string }>;
  Dependencies: { search: Search };
  Actions: {};
}>;

export default createWorkflow<DynamicResearch>({
  state: () => ({ phase: "working" }),
  actions: {},
  async run({ input, state, dependencies }) {
    const result = await dependencies.search.search({ query: input.question });
    state.phase = "completed";
    return { report: result.evidence };
  },
});
`;
      const first = compileWorkflowSource(source, [serverCompilerExtension]);
      const second = compileWorkflowSource(`\n${source}`, [serverCompilerExtension]);

      expect(first).toMatchObject({
        id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        definition: {
          version: WORKFLOW_IR_VERSION,
          language: WORKFLOW_LANGUAGE_VERSION,
          contract: {
            name: "dynamic-research",
            revision: 1,
            dependencies: { search: {} },
          },
        },
        executable: { revision: 1 },
      });
      expect(first.executable).toEqual(second.executable);
      expect(first.id).toBe(second.id);
      expect(first.definition.blocks.map(({ terminator }) => terminator.kind)).toEqual([
        "effect",
        "return",
      ]);
    },
  );

  test(
    "generates a typed controller module for one immutable dynamic artifact",
    { timeout: 30_000 },
    () => {
      const artifact = compileWorkflowSource(
        `
type Search = Dependency<{
  Operations: {
    search(input: Readonly<{ query: string }>): Promise<Readonly<{ evidence: string }>>;
  };
}>;

type DynamicResearch = Workflow<{
  Name: "dynamic-research";
  Id: string;
  Input: Readonly<{ question: string }>;
  State: { phase: "working" | "completed" };
  Result: Readonly<{ report: string }>;
  Dependencies: { search: Search };
  Actions: {
    approve: Workflow.Action<undefined, Readonly<{ approved: true }>>;
    revise: Workflow.Action<
      Readonly<{ instruction: string }>,
      Readonly<{ revised: boolean }>
    >;
  };
}>;

export default createWorkflow<DynamicResearch>({
  state: () => ({ phase: "working" }),
  actions: {
    approve() {
      return { approved: true };
    },
    revise({ input }) {
      return { revised: input.instruction.length > 0 };
    },
  },
  async run({ input, state, dependencies }) {
    const result = await dependencies.search.search({ query: input.question });
    state.phase = "completed";
    return { report: result.evidence };
  },
});
`,
        [serverCompilerExtension],
      );
      const directory = resolve(import.meta.dirname, "../../../.kit-virtual/workflow-controller");
      const entry = resolve(directory, "system.ts");
      const controller = resolve(directory, "dynamic-research.ts");
      const packageManifest = resolve(directory, "node_modules/kit/package.json");
      const packageIndex = resolve(directory, "node_modules/kit/index.d.ts");
      const packageWorkflow = resolve(directory, "node_modules/kit/features/workflow.d.ts");
      const generated = workflowControllerSource(artifact);
      const sources = {
        [packageManifest]: JSON.stringify({
          name: "kit",
          exports: {
            ".": "./index.d.ts",
            "./features/workflow": "./features/workflow.d.ts",
          },
        }),
        [packageIndex]:
          'export { createFeature } from "@/core/feature";\n' +
          'export { createSystem } from "@/core/system";\n',
        [packageWorkflow]:
          'export { createWorkflowRegistry } from "@/features/workflow";\n' +
          'export type { Workflow, WorkflowRegistry } from "@/features/workflow";\n',
        [controller]: generated,
        [entry]: `
import type { Dependency } from "@/core/dependency";
import { createFeature, createSystem } from "kit";
import {
  createWorkflowRegistry,
  type Workflow,
  type WorkflowRegistry,
} from "kit/features/workflow";
import type { ServerProcess } from "@/platforms/server";
import dynamicResearch from "./dynamic-research";

type Search = Dependency<{
  Operations: {
    search(input: Readonly<{ query: string }>): Promise<Readonly<{ evidence: string }>>;
  };
}>;

type Automations = WorkflowRegistry<{
  Name: "automations";
  Dependencies: { search: Search };
}>;

const automations = createWorkflowRegistry<Automations>();

type Driver = {
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: {
        automations: Workflow.RegistryReference<typeof automations>;
      };
    };
  };
};

const driver = createFeature<Driver>({
  programs: {
    server: {
      async start({ dependencies }) {
        const execution = dependencies.automations.get({
          id: "research-1",
          definition: dynamicResearch,
        });
        await execution.start({ input: { question: "Typed controller" } });
        await execution.action({ name: "approve" });
        await execution.action({
          name: "revise",
          input: { instruction: "Use the retained definition." },
        });
        await execution.migrate();
      },
    },
  },
});

export default createSystem({ features: { automations, driver } });
`,
      };

      const first = compileSystemSources(entry, sources, [
        serverCompilerExtension,
        workflowCompilerExtension,
      ]);

      expect(generated).toContain('name: "dynamic-research"');
      expect(generated).toContain(`artifact: ${JSON.stringify(artifact.id)}`);
      expect(workflowControllerSource(artifact)).toBe(generated);
      expect(first.programs.find(({ name }) => name === "server")).toBeDefined();
      expect(() =>
        workflowControllerSource({
          ...artifact,
          id: `sha256:${"0".repeat(64)}`,
        }),
      ).toThrow("Workflow controller artifact identity is invalid");
    },
  );

  test(
    "bounds runtime-authored control flow with the deterministic interpreter budget",
    { timeout: 30_000 },
    () => {
      const artifact = compileWorkflowSource(
        `
type Endless = Workflow<{
  Name: "endless";
  Id: string;
  Input: undefined;
  State: { iterations: number };
  Result: Readonly<{ iterations: number }>;
  Actions: {};
}>;

export default createWorkflow<Endless>({
  state: () => ({ iterations: 0 }),
  actions: {},
  run({ state }) {
    while (true) {
      state.iterations += 1;
    }
    return { iterations: state.iterations };
  },
});
`,
        [serverCompilerExtension],
      );
      const initialized = executeWorkflowExecutableProcedure(artifact.executable.initialization, {
        definition: artifact.executable.revision,
        state: {},
        time: 0,
      }) as Readonly<{ status: string; result?: object }>;
      if (initialized.status !== "succeeded" || initialized.result === undefined) {
        throw new Error("Dynamic Workflow State initialization failed.");
      }

      const exhausted = advanceWorkflowExecutable(artifact.executable, {
        definition: artifact.executable.revision,
        status: "running",
        history: { events: 0, continueSuggested: false },
        state: initialized.result,
        block: artifact.executable.run.entry,
        locals: {},
        sequence: 0,
        time: 0,
      });

      expect(exhausted).toMatchObject({
        status: "failed",
        failure: { type: "resource", limit: 10_000 },
      });
    },
  );

  test("rejects imports and ambient APIs in runtime-authored Workflow source", () => {
    expect(() =>
      compileWorkflowSource(
        `
import { readFile } from "node:fs/promises";
export default readFile;
`,
        [serverCompilerExtension],
      ),
    ).toThrow("Runtime-authored Workflow source cannot import modules");

    expect(() =>
      compileWorkflowSource(
        `
type Ambient = Workflow<{
  Name: "ambient";
  Id: string;
  Input: undefined;
  State: { observedAt: number };
  Result: { observedAt: number };
}>;

export default createWorkflow<Ambient>({
  state: () => ({ observedAt: 0 }),
  actions: {},
  run({ state }) {
    state.observedAt = Date.now();
    return { observedAt: state.observedAt };
  },
});
`,
        [serverCompilerExtension],
      ),
    ).toThrow();
  });

  test("rejects suspending Action handlers before publishing a Workflow artifact", () => {
    expect(() =>
      compileWorkflowSource(
        `
type Search = Dependency<{
  Operations: {
    search(input: Readonly<{ query: string }>): Promise<Readonly<{ result: string }>>;
  };
}>;

type Interactive = Workflow<{
  Name: "interactive";
  Id: string;
  Input: undefined;
  State: { query: string };
  Result: { done: true };
  Dependencies: { search: Search };
  Actions: {
    search: Workflow.Action<Readonly<{ query: string }>, Readonly<{ accepted: true }>>;
  };
}>;

export default createWorkflow<Interactive>({
  state: () => ({ query: "" }),
  actions: {
    async search({ input, state, dependencies }) {
      const result = await dependencies.search.search({ query: input.query });
      state.query = result.result;
      return { accepted: true };
    },
  },
  run() {
    return { done: true };
  },
});
`,
        [serverCompilerExtension],
      ),
    ).toThrow();
  });

  test("lowers source branches and loops into restartable basic blocks", () => {
    const feature = compiledSystem.features.find(({ path }) => path === "controlFlow");
    const definition = workflowCompilerIR(feature?.extensions?.workflow);
    const terminators = definition.blocks.map(({ terminator }) => terminator.kind);

    expect(terminators.filter((kind) => kind === "branch")).toHaveLength(4);
    expect(terminators).toContain("jump");

    const execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, { limit: 5, skip: 2 }, { sum: 0 }, 0),
    );
    expect(execution).toMatchObject({
      status: "succeeded",
      state: { sum: 12 },
      result: { sum: 12 },
    });
  });

  test("lowers and resumes concurrent Dependency calls in deterministic result order", () => {
    const feature = compiledSystem.features.find(({ path }) => path === "concurrent");
    const definition = workflowCompilerIR(feature?.extensions?.workflow);
    expect(definition.blocks.map(({ terminator }) => terminator.kind)).toEqual([
      "concurrent",
      "return",
    ]);

    let execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, { left: 2, right: 5 }, { total: 0 }, 10),
    );
    expect(execution).toMatchObject({
      status: "suspended",
      sequence: 2,
      pending: {
        kind: "concurrent",
        operation: "all",
        effects: [
          {
            sequence: 0,
            dependency: "calculation",
            operation: "value",
            input: { value: 2 },
          },
          {
            sequence: 1,
            dependency: "calculation",
            operation: "value",
            input: { value: 5 },
          },
        ],
      },
    });

    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "concurrent",
      sequence: 1,
      at: 20,
      outcome: { status: "succeeded", value: { value: 5 } },
    });
    expect(execution.status).toBe("suspended");

    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "concurrent",
      sequence: 0,
      at: 21,
      outcome: { status: "succeeded", value: { value: 2 } },
    });
    expect(execution).toMatchObject({
      status: "succeeded",
      state: { total: 7 },
      result: { total: 7 },
      time: 21,
    });
  });

  test("defines all-settled and race completion semantics without scheduling strings", () => {
    const settledDefinition = concurrentWorkflowIR("all-settled");
    let settled = advanceWorkflowIRExecution(
      settledDefinition,
      createWorkflowIRExecution(settledDefinition, undefined, {}, 0),
    );
    settled = resumeWorkflowIRExecution(settledDefinition, settled, {
      kind: "concurrent",
      sequence: 0,
      at: 1,
      outcome: { status: "failed", failure: { reason: "left" } },
    });
    settled = resumeWorkflowIRExecution(settledDefinition, settled, {
      kind: "concurrent",
      sequence: 1,
      at: 2,
      outcome: { status: "succeeded", value: { side: "right" } },
    });
    expect(settled).toMatchObject({
      status: "succeeded",
      result: [
        {
          status: "rejected",
          reason: {
            type: "effect",
            dependency: "work",
            operation: "left",
            failure: { reason: "left" },
          },
        },
        { status: "fulfilled", value: { side: "right" } },
      ],
    });

    const raceDefinition = concurrentWorkflowIR("race");
    const racing = advanceWorkflowIRExecution(
      raceDefinition,
      createWorkflowIRExecution(raceDefinition, undefined, {}, 0),
    );
    const won = resumeWorkflowIRExecution(raceDefinition, racing, {
      kind: "concurrent",
      sequence: 1,
      at: 1,
      outcome: { status: "succeeded", value: { side: "right" } },
    });
    expect(won).toMatchObject({
      status: "succeeded",
      result: { side: "right" },
    });
    expect(() =>
      resumeWorkflowIRExecution(raceDefinition, racing, {
        kind: "concurrent",
        sequence: 9,
        at: 1,
        outcome: { status: "succeeded", value: { side: "stale" } },
      }),
    ).toThrow("stale or unknown");
  });

  test("resumes effects, logical time, and State waits from serialized frames", () => {
    const definition = researchWorkflowIR();
    let execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(
        definition,
        { question: "What is durable execution?" },
        { phase: "planning", approved: false },
        10,
      ),
    );

    expect(execution).toMatchObject({
      status: "suspended",
      state: { phase: "searching", approved: false },
      sequence: 1,
      pending: {
        kind: "effect",
        sequence: 0,
        dependency: "search",
        operation: "find",
        input: { query: "What is durable execution?" },
      },
    });

    execution = restart(execution);
    execution = resumeWorkflowIRExecution(definition, execution, {
      kind: "effect",
      sequence: 0,
      at: 20,
      outcome: { status: "succeeded", value: { answer: "Durable evidence" } },
    });
    expect(execution).toMatchObject({
      status: "suspended",
      state: { phase: "cooling" },
      sequence: 2,
      time: 20,
      pending: { kind: "sleep", sequence: 1, at: 120 },
    });

    execution = restart(execution);
    execution = resumeWorkflowIRExecution(definition, execution, {
      kind: "sleep",
      sequence: 1,
      at: 120,
    });
    expect(execution).toMatchObject({
      status: "suspended",
      state: { phase: "review" },
      sequence: 3,
      time: 120,
      pending: { kind: "wait", sequence: 2, until: 1_120 },
    });

    execution = restart(execution);
    execution = advanceWorkflowIRExecution(
      definition,
      updateWorkflowIRState(execution, {
        ...execution.state,
        approved: true,
      }),
    );
    expect(execution).toEqual({
      definition: 1,
      status: "succeeded",
      input: { question: "What is durable execution?" },
      history: { events: 0, continueSuggested: false },
      state: { phase: "completed", approved: true },
      block: "done",
      locals: {
        question: "What is durable execution?",
        evidence: { answer: "Durable evidence" },
        approved: true,
      },
      sequence: 3,
      time: 120,
      result: { report: "Durable evidence" },
    });
  });

  test("verifies canonical history independently and rejects definition or outcome drift", () => {
    const definition = researchWorkflowIR();
    const trace: WorkflowIRReplayTrace = {
      input: { question: "What is durable execution?" },
      state: { phase: "planning", approved: false },
      time: 10,
      steps: [
        {
          command: {
            kind: "effect",
            sequence: 0,
            cancellable: true,
            dependency: "search",
            operation: "find",
            input: { query: "What is durable execution?" },
            result: "evidence",
            next: "cooling",
          },
          resolution: {
            kind: "completion",
            completion: {
              kind: "effect",
              sequence: 0,
              at: 20,
              outcome: { status: "succeeded", value: { answer: "Durable evidence" } },
            },
          },
        },
        {
          command: {
            kind: "sleep",
            sequence: 1,
            cancellable: true,
            at: 120,
            next: "review",
          },
          resolution: {
            kind: "completion",
            completion: { kind: "sleep", sequence: 1, at: 120 },
          },
        },
        {
          command: {
            kind: "wait",
            sequence: 2,
            cancellable: true,
            condition: { kind: "state", path: ["approved"] },
            until: 1_120,
            result: "approved",
            next: "decision",
          },
          resolution: {
            kind: "state",
            state: { phase: "review", approved: true },
          },
        },
      ],
      outcome: {
        status: "succeeded",
        state: { phase: "completed", approved: true },
        result: { report: "Durable evidence" },
      },
    };

    expect(verifyWorkflowIRReplay(definition, trace)).toMatchObject(trace.outcome);

    const changedDefinition: WorkflowDefinitionIR = {
      ...definition,
      blocks: definition.blocks.map((block) =>
        block.id === "search" && block.terminator.kind === "effect"
          ? {
              ...block,
              terminator: { ...block.terminator, operation: "changed" },
            }
          : block,
      ),
    };
    expect(() => verifyWorkflowIRReplay(changedDefinition, trace)).toThrow(
      "Workflow replay diverged at command 0.",
    );

    expect(() =>
      verifyWorkflowIRReplay(definition, {
        ...trace,
        outcome: {
          ...trace.outcome,
          result: { report: "Changed evidence" },
        },
      }),
    ).toThrow("Workflow replay diverged at its terminal outcome.");
  });

  test("persists a timeout decision instead of rerunning prior work", () => {
    const definition = researchWorkflowIR();
    let execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(
        definition,
        { question: "Timeout?" },
        { phase: "planning", approved: false },
        0,
      ),
    );
    execution = resumeWorkflowIRExecution(definition, execution, {
      kind: "effect",
      sequence: 0,
      at: 1,
      outcome: { status: "succeeded", value: { answer: "Evidence" } },
    });
    execution = resumeWorkflowIRExecution(definition, execution, {
      kind: "sleep",
      sequence: 1,
      at: 101,
    });
    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "wait",
      sequence: 2,
      at: 1_101,
      timedOut: true,
    });

    expect(execution).toMatchObject({
      status: "failed",
      state: { phase: "review", approved: false },
      sequence: 3,
      time: 1_101,
      failure: {
        type: "declared",
        value: { type: "approvalTimedOut" },
      },
    });
  });

  test("executes branches and loops under an explicit deterministic block budget", () => {
    const definition = loopWorkflowIR();
    const execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, { limit: 4 }, { progress: 0 }, 0),
    );

    expect(execution).toMatchObject({
      status: "succeeded",
      state: { progress: 4 },
      result: { count: 4 },
    });

    const exhausted = advanceWorkflowIRExecution(
      infiniteWorkflowIR(),
      createWorkflowIRExecution(infiniteWorkflowIR(), undefined, {}, 0),
      4,
    );
    expect(exhausted).toMatchObject({
      status: "failed",
      failure: { type: "resource", limit: 4 },
    });
  });

  test("fences mismatched completions and rejects malformed control flow", () => {
    const definition = researchWorkflowIR();
    const execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(
        definition,
        { question: "Fence?" },
        { phase: "planning", approved: false },
        0,
      ),
    );

    expect(() =>
      resumeWorkflowIRExecution(definition, execution, {
        kind: "effect",
        sequence: 1,
        at: 1,
        outcome: { status: "succeeded", value: { answer: "stale" } },
      }),
    ).toThrow("does not match effect:0");

    expect(() =>
      validateWorkflowDefinitionIR({
        ...definition,
        entry: "missing",
      }),
    ).toThrow('Workflow run entry block "missing" does not exist');

    expect(() =>
      validateWorkflowDefinitionIR({
        ...definition,
        version: WORKFLOW_IR_VERSION + 1,
      } as unknown as WorkflowDefinitionIR),
    ).toThrow(`Unsupported Workflow IR version ${WORKFLOW_IR_VERSION + 1}`);
  });

  test("persists cleanup continuation without running cleanup at suspension", () => {
    const definition = cleanupWorkflowIR();
    let execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, undefined, { cleanups: 0 }, 0),
    );
    expect(execution).toMatchObject({
      status: "suspended",
      state: { cleanups: 0 },
      pending: { kind: "effect", sequence: 0, cancellable: true },
      scope: { id: "work", phase: "body" },
    });

    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "effect",
      sequence: 0,
      at: 1,
      outcome: { status: "succeeded", value: { accepted: true } },
    });
    expect(execution).toMatchObject({
      status: "suspended",
      state: { cleanups: 1 },
      pending: { kind: "sleep", sequence: 1, at: 6 },
      scope: {
        id: "work",
        phase: "cleanup",
        completion: { kind: "continue", next: "done" },
      },
    });

    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "sleep",
      sequence: 1,
      at: 6,
    });
    expect(execution).toMatchObject({
      status: "succeeded",
      state: { cleanups: 1 },
      result: { cleanups: 1 },
    });
    expect(execution.scope).toBeUndefined();
  });

  test("unwinds effect failure through cleanup exactly once across restart", () => {
    const definition = cleanupWorkflowIR();
    let execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, undefined, { cleanups: 0 }, 0),
    );
    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "effect",
      sequence: 0,
      at: 1,
      outcome: { status: "failed", failure: { code: "provider-failed" } },
    });
    expect(execution).toMatchObject({
      status: "suspended",
      state: { cleanups: 1 },
      pending: { kind: "sleep", sequence: 1, at: 6 },
      scope: {
        phase: "cleanup",
        completion: {
          kind: "fail",
          failure: {
            type: "effect",
            dependency: "work",
            operation: "perform",
          },
        },
      },
    });

    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "sleep",
      sequence: 1,
      at: 6,
    });
    expect(execution).toMatchObject({
      status: "failed",
      state: { cleanups: 1 },
      failure: {
        type: "effect",
        dependency: "work",
        operation: "perform",
        failure: { code: "provider-failed" },
      },
    });
  });

  test("admits cancellation durably and permits only shielded cleanup to suspend", () => {
    const definition = shieldedCleanupWorkflowIR();
    let execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, undefined, { cleanups: 0 }, 0),
    );
    execution = requestWorkflowIRCancellation(definition, restart(execution), {
      at: 2,
      reason: { type: "user" },
    });
    expect(execution).toMatchObject({
      status: "suspended",
      state: { cleanups: 1 },
      cancellation: { at: 2, reason: { type: "user" } },
      pending: {
        kind: "effect",
        sequence: 1,
        cancellable: false,
        dependency: "cleanup",
        operation: "release",
      },
      scope: {
        id: "cleanup-shield",
        cancellable: false,
        parent: {
          id: "work",
          phase: "cleanup",
          completion: { kind: "cancel" },
        },
      },
    });

    const duplicate = requestWorkflowIRCancellation(definition, restart(execution), {
      at: 3,
      reason: { type: "duplicate" },
    });
    expect(duplicate).toEqual(execution);
    expect(() =>
      resumeWorkflowIRExecution(definition, restart(execution), {
        kind: "effect",
        sequence: 0,
        at: 3,
        outcome: { status: "succeeded", value: { stale: true } },
      }),
    ).toThrow("does not match effect:1");

    execution = resumeWorkflowIRExecution(definition, restart(execution), {
      kind: "effect",
      sequence: 1,
      at: 4,
      outcome: { status: "succeeded", value: { released: true } },
    });
    expect(execution).toMatchObject({
      status: "cancelled",
      state: { cleanups: 1 },
      time: 4,
      cancellation: { at: 2, reason: { type: "user" } },
    });
    expect(execution.pending).toBeUndefined();
    expect(execution.scope).toBeUndefined();
  });

  test("routes declared failure through catch and finally with standard ordering", () => {
    const definition = caughtWorkflowIR();
    const execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, undefined, { caught: "none", cleanups: 0 }, 0),
    );
    expect(execution).toMatchObject({
      status: "succeeded",
      state: { caught: "boom", cleanups: 1 },
      result: { caught: "boom", cleanups: 1 },
    });
  });

  test("continues as new after cleanup with deterministic history metadata", async () => {
    const definition = continuationWorkflowIR();
    const created: WorkflowIRExecution = {
      ...createWorkflowIRExecution(definition, { cursor: 1 }, { cursor: 7, cleanups: 0 }, 10),
      history: { events: 10_000, continueSuggested: true },
    };
    const expected = advanceWorkflowIRExecution(definition, restart(created));

    expect(expected).toMatchObject({
      status: "continued",
      state: { cursor: 7, cleanups: 1 },
      continuedInput: {
        cursor: 7,
        events: 10_000,
        suggested: true,
      },
    });
    expect(expected.scope).toBeUndefined();

    const executionType = { kind: "opaque", name: "WorkflowExecution" } as const;
    const span = { file: "workflow-continuation.spec.ts", line: 1, column: 1 };
    const entry = lowerWorkflowAdvanceFunctionIR(definition, executionType, executionType, span);
    const generated = (
      await executePortableFunctionIR({
        entry,
        arguments: [restart(created)],
      })
    ).result as WorkflowIRExecution;
    expect(generated).toEqual(expected);
  });

  test(
    "lowers authored try/finally and shield to reference-equivalent portable frames",
    { timeout: 60_000 },
    async () => {
      cleanupSystem ??= compileSystemFixture(resolve(import.meta.dirname, "feature.typecheck.ts"), [
        serverCompilerExtension,
        workflowCompilerExtension,
      ]);
      const feature = cleanupSystem.features.find(({ path }) => path === "cleanup");
      const definition = workflowCompilerIR(feature?.extensions?.workflow);
      expect(definition.blocks.map(({ terminator }) => terminator.kind)).toEqual([
        "enter-scope",
        "effect",
        "leave-scope",
        "enter-scope",
        "effect",
        "leave-scope",
        "complete-cleanup",
        "return",
      ]);
      const executionType = { kind: "opaque", name: "WorkflowExecution" } as const;
      const span = { file: "workflow.spec.ts", line: 1, column: 1 };
      const entry = lowerWorkflowAdvanceFunctionIR(definition, executionType, executionType, span);
      const generatedAdvance = async (execution: WorkflowIRExecution) =>
        (
          await executePortableFunctionIR({
            entry,
            arguments: [restart(execution)],
          })
        ).result as WorkflowIRExecution;
      const transferEntry = lowerWorkflowTransferFunctionIR(
        definition,
        executionType,
        { kind: "opaque", name: "WorkflowTransfer" },
        executionType,
        span,
      );
      const generatedTransfer = async (execution: WorkflowIRExecution, transfer: object) =>
        (
          await executePortableFunctionIR({
            entry: transferEntry,
            arguments: [restart(execution), transfer],
          })
        ).result as WorkflowIRExecution;

      const created = createWorkflowIRExecution(
        definition,
        { id: "work-1" },
        { phase: "working" },
        0,
      );
      const working = advanceWorkflowIRExecution(definition, restart(created));
      expect(await generatedAdvance(created)).toEqual(working);

      const work = working.pending;
      if (work?.kind !== "effect") throw new Error("Expected work effect.");
      const worked = resumeWorkflowIRExecution(definition, restart(working), {
        kind: "effect",
        sequence: work.sequence,
        at: 1,
        outcome: { status: "succeeded", value: { accepted: true } },
      });
      const { pending: _work, ...workingFrame } = restart(working);
      const workResumed: WorkflowIRExecution = {
        ...workingFrame,
        status: "running",
        time: 1,
        block: work.next,
        locals: {
          ...working.locals,
          [work.result]: { accepted: true },
        },
      };
      expect(await generatedAdvance(workResumed)).toEqual(worked);
      expect(worked).toMatchObject({
        status: "suspended",
        state: { phase: "cleaning" },
        pending: {
          kind: "effect",
          cancellable: false,
          dependency: "work",
          operation: "release",
        },
      });

      const release = worked.pending;
      if (release?.kind !== "effect") throw new Error("Expected release effect.");
      const completed = resumeWorkflowIRExecution(definition, restart(worked), {
        kind: "effect",
        sequence: release.sequence,
        at: 2,
        outcome: { status: "succeeded", value: { released: true } },
      });
      const { pending: _release, ...releaseFrame } = restart(worked);
      const releaseResumed: WorkflowIRExecution = {
        ...releaseFrame,
        status: "running",
        time: 2,
        block: release.next,
        locals: {
          ...worked.locals,
          [release.result]: { released: true },
        },
      };
      expect(await generatedAdvance(releaseResumed)).toEqual(completed);
      expect(completed).toMatchObject({
        status: "succeeded",
        state: { phase: "cleaning" },
        result: { completed: true },
      });

      const cancellation = { at: 3, reason: { type: "user" } } as const;
      const cancelled = requestWorkflowIRCancellation(definition, restart(working), cancellation);
      const cancellationAdmitted: WorkflowIRExecution = {
        ...restart(working),
        time: cancellation.at,
        cancellation,
      };
      expect(await generatedAdvance(cancellationAdmitted)).toEqual(cancelled);
      expect(cancelled).toMatchObject({
        status: "suspended",
        cancellation,
        pending: { kind: "effect", cancellable: false, operation: "release" },
      });

      const cancelledRelease = cancelled.pending;
      if (cancelledRelease?.kind !== "effect") {
        throw new Error("Expected cancellation cleanup effect.");
      }
      const cancelledComplete = resumeWorkflowIRExecution(definition, restart(cancelled), {
        kind: "effect",
        sequence: cancelledRelease.sequence,
        at: 4,
        outcome: { status: "succeeded", value: { released: true } },
      });
      const { pending: _cancelledRelease, ...cancelledFrame } = restart(cancelled);
      const cancellationResumed: WorkflowIRExecution = {
        ...cancelledFrame,
        status: "running",
        time: 4,
        block: cancelledRelease.next,
        locals: {
          ...cancelled.locals,
          [cancelledRelease.result]: { released: true },
        },
      };
      expect(await generatedAdvance(cancellationResumed)).toEqual(cancelledComplete);
      expect(cancelledComplete.status).toBe("cancelled");

      const failed = resumeWorkflowIRExecution(definition, restart(working), {
        kind: "effect",
        sequence: work.sequence,
        at: 5,
        outcome: { status: "failed", failure: { code: "provider-failed" } },
      });
      const failure = {
        type: "effect",
        dependency: work.dependency,
        operation: work.operation,
        failure: { code: "provider-failed" },
      } as const;
      expect(
        await generatedTransfer({ ...restart(working), time: 5 }, { kind: "fail", failure }),
      ).toEqual(failed);
      expect(failed).toMatchObject({
        status: "suspended",
        pending: { kind: "effect", cancellable: false, operation: "release" },
        scope: {
          id: "scope/1",
          parent: {
            id: "scope/0",
            phase: "cleanup",
            completion: { kind: "fail", failure },
          },
        },
      });
    },
  );

  test("unwinds nested cleanup from inner to outer", () => {
    const definition = nestedCleanupWorkflowIR();
    const execution = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, undefined, { order: "" }, 0),
    );
    expect(execution).toMatchObject({
      status: "failed",
      state: { order: "inner,outer" },
      failure: { type: "declared", value: { code: "boom" } },
    });
  });

  test("lowers static advancement to generic portable IR with reference-equivalent frames", async () => {
    const definitions = [
      researchWorkflowIR(),
      loopWorkflowIR(),
      concurrentWorkflowIR("all"),
    ] as const;
    const executions = [
      createWorkflowIRExecution(
        definitions[0],
        { question: "Portable advancement" },
        { phase: "planning", approved: false },
        10,
      ),
      createWorkflowIRExecution(definitions[1], { limit: 4 }, { progress: 0 }, 0),
      createWorkflowIRExecution(definitions[2], undefined, {}, 0),
    ] as const;
    const executionType = { kind: "opaque", name: "WorkflowExecution" } as const;
    const span = { file: "workflow.spec.ts", line: 1, column: 1 };

    for (const [index, definition] of definitions.entries()) {
      const initial = restart(executions[index]!);
      const expected = advanceWorkflowIRExecution(definition, restart(initial));
      const entry = lowerWorkflowAdvanceFunctionIR(definition, executionType, executionType, span);
      const actual = await executePortableFunctionIR({
        entry,
        arguments: [restart(initial)],
      });
      expect(actual.calls).toEqual([]);
      expect(actual.result).toEqual(expected);
    }

    const compiledFeature = compiledSystem.features.find(({ path }) => path === "research");
    const compiledDefinition = workflowCompilerIR(compiledFeature?.extensions?.workflow);
    const waiting = advanceWorkflowIRExecution(
      compiledDefinition,
      createWorkflowIRExecution(
        compiledDefinition,
        {
          question: "Portable wait",
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
      ),
    );
    const ready = updateWorkflowIRState(restart(waiting), {
      ...waiting.state,
      approved: true,
    });
    const expected = advanceWorkflowIRExecution(compiledDefinition, restart(ready));
    const entry = lowerWorkflowAdvanceFunctionIR(
      compiledDefinition,
      executionType,
      executionType,
      span,
    );
    const actual = await executePortableFunctionIR({
      entry,
      arguments: [restart(ready)],
    });
    expect(actual.result).toEqual(expected);
  });

  test("executes retained bytecode with reference-equivalent frames", async () => {
    const cases = [
      {
        definition: researchWorkflowIR(),
        input: { question: "Retained research" },
        state: { phase: "planning", approved: false },
        time: 10,
      },
      {
        definition: loopWorkflowIR(),
        input: { limit: 4 },
        state: { progress: 0 },
        time: 0,
      },
      {
        definition: concurrentWorkflowIR("all"),
        input: undefined,
        state: {},
        time: 0,
      },
      {
        definition: concurrentWorkflowIR("all-settled"),
        input: undefined,
        state: {},
        time: 0,
      },
      {
        definition: concurrentWorkflowIR("race"),
        input: undefined,
        state: {},
        time: 0,
      },
      {
        definition: cleanupWorkflowIR(),
        input: undefined,
        state: { cleanups: 0 },
        time: 0,
      },
      {
        definition: shieldedCleanupWorkflowIR(),
        input: undefined,
        state: { cleanups: 0 },
        time: 0,
      },
      {
        definition: caughtWorkflowIR(),
        input: undefined,
        state: { caught: "none", cleanups: 0 },
        time: 0,
      },
      {
        definition: nestedCleanupWorkflowIR(),
        input: undefined,
        state: { order: "" },
        time: 0,
      },
      {
        definition: continuationWorkflowIR(),
        input: { cursor: 7 },
        state: { cursor: 0, cleanups: 0 },
        time: 0,
      },
    ] as const;

    for (const fixture of cases) {
      const initial = createWorkflowIRExecution(
        fixture.definition,
        fixture.input,
        fixture.state,
        fixture.time,
      );
      const expected = advanceWorkflowIRExecution(fixture.definition, restart(initial));
      const actual = advanceWorkflowExecutable(
        workflowExecutableIR(fixture.definition),
        restart(initial),
      );
      expect(actual).toEqual(expected);
    }

    const definition = cleanupWorkflowIR();
    const executable = workflowExecutableIR(definition);
    const working = advanceWorkflowIRExecution(
      definition,
      createWorkflowIRExecution(definition, undefined, { cleanups: 0 }, 0),
    );
    const pending = working.pending;
    if (pending?.kind !== "effect") throw new Error("Expected retained work effect.");
    const failure = {
      type: "effect",
      dependency: pending.dependency,
      operation: pending.operation,
      failure: { code: "provider-failed" },
    } as const;
    const executionType = { kind: "opaque", name: "WorkflowExecution" } as const;
    const transferEntry = lowerWorkflowTransferFunctionIR(
      definition,
      executionType,
      { kind: "opaque", name: "WorkflowTransfer" },
      executionType,
      { file: "workflow-retained.spec.ts", line: 1, column: 1 },
    );
    const expectedTransfer = (
      await executePortableFunctionIR({
        entry: transferEntry,
        arguments: [
          { ...restart(working), time: 5 },
          { kind: "fail", failure },
        ],
      })
    ).result;
    expect(
      transferWorkflowExecutable(
        executable,
        { ...restart(working), time: 5 },
        { kind: "fail", failure },
      ),
    ).toEqual(expectedTransfer);

    const compiledFeature = compiledSystem.features.find(({ path }) => path === "research");
    const compiled = workflowCompilerIR(compiledFeature?.extensions?.workflow);
    const compiledExecutable = workflowExecutableIR(compiled);
    const initialized = advanceWorkflowIRExecution(
      selectWorkflowProcedure(compiled, compiled.initialization),
      createWorkflowIRExecution(
        selectWorkflowProcedure(compiled, compiled.initialization),
        { question: "Retained initialization" },
        {},
        5,
        { identity: "research-1" },
      ),
    );
    expect(
      executeWorkflowExecutableProcedure(compiledExecutable.initialization, {
        definition: compiled.contract.revision,
        identity: "research-1",
        input: { question: "Retained initialization" },
        state: {},
        time: 5,
      }),
    ).toEqual(initialized);

    const revise = compiled.actionHandlers.revise;
    const executableRevise = compiledExecutable.actionHandlers.revise;
    if (!revise || !executableRevise) throw new Error("Compiled Workflow has no revise Action.");
    const revised = advanceWorkflowIRExecution(
      selectWorkflowProcedure(compiled, revise),
      createWorkflowIRExecution(
        selectWorkflowProcedure(compiled, revise),
        { instruction: "Retain old meaning." },
        initialized.result as Readonly<Record<string, WorkflowIRData>>,
        10,
        {
          identity: "research-1",
          invocation: { id: "revise-1", at: 10 },
        },
      ),
    );
    expect(
      executeWorkflowExecutableProcedure(executableRevise, {
        definition: compiled.contract.revision,
        identity: "research-1",
        invocation: { id: "revise-1", at: 10 },
        input: { instruction: "Retain old meaning." },
        state: initialized.result as object,
        time: 10,
      }),
    ).toEqual(revised);
  });

  test("admits an artifact migration only after replaying State, Actions, and commands", () => {
    const base = baseDefinition("migration");
    const definition: WorkflowDefinitionIR = {
      ...base,
      contract: {
        ...base.contract,
        revision: 1,
        actions: {
          increment: {
            input: schema,
            result: schema,
            failures: schema,
          },
        },
        dependencies: { work: schema },
      },
      initialization: {
        entry: "initialize",
        blocks: [
          {
            id: "initialize",
            body: [],
            terminator: {
              kind: "return",
              value: {
                kind: "record",
                fields: [{ name: "count", value: { kind: "literal", value: 0 } }],
              },
            },
          },
        ],
      },
      actionHandlers: {
        increment: {
          entry: "increment",
          blocks: [
            {
              id: "increment",
              body: [
                {
                  kind: "state",
                  path: ["count"],
                  operator: "+=",
                  value: { kind: "literal", value: 1 },
                },
              ],
              terminator: {
                kind: "return",
                value: {
                  kind: "record",
                  fields: [{ name: "count", value: { kind: "state", path: ["count"] } }],
                },
              },
            },
          ],
        },
      },
      entry: "work",
      blocks: [
        {
          id: "work",
          body: [],
          terminator: {
            kind: "effect",
            dependency: "work",
            operation: "perform",
            input: { kind: "record", fields: [] },
            result: "performed",
            next: "done",
          },
        },
        {
          id: "done",
          body: [],
          terminator: {
            kind: "return",
            value: {
              kind: "record",
              fields: [{ name: "count", value: { kind: "state", path: ["count"] } }],
            },
          },
        },
      ],
    };
    const initial = createWorkflowIRExecution(definition, undefined, { count: 0 }, 10, {
      identity: "migration-1",
    });
    const suspended = advanceWorkflowIRExecution(definition, initial);
    const pending = suspended.pending;
    if (pending?.kind !== "effect") throw new Error("Expected migration effect.");
    const actionState = updateWorkflowIRState(suspended, { count: 1 });
    const resumed = resumeWorkflowIRExecution(definition, actionState, {
      kind: "effect",
      sequence: pending.sequence,
      at: 20,
      outcome: { status: "succeeded", value: { performed: true } },
    });
    const completed = advanceWorkflowIRExecution(definition, resumed);
    const completedWithHistory = {
      ...completed,
      history: { events: 3, continueSuggested: false },
    };
    const candidate = {
      ...definition,
      contract: { ...definition.contract, revision: 2 },
    } satisfies WorkflowDefinitionIR;
    const trace = {
      identity: "migration-1",
      time: 10,
      initialState: { count: 0 },
      steps: [
        {
          kind: "advance",
          history: { events: 0, continueSuggested: false },
        },
        {
          kind: "action",
          action: "increment",
          invocation: { id: "increment-1", at: 12 },
          time: 10,
          state: { count: 1 },
          result: { count: 1 },
        },
        {
          kind: "effect",
          command: pending,
          sequence: pending.sequence,
          at: 20,
          outcome: { status: "succeeded", value: { performed: true } },
        },
        {
          kind: "advance",
          history: { events: 3, continueSuggested: false },
        },
      ],
      expected: completedWithHistory,
    };

    expect(replayWorkflowExecutable(workflowExecutableIR(candidate), trace)).toEqual({
      ...completedWithHistory,
      definition: 2,
    });

    const changedCommand = {
      ...candidate,
      blocks: candidate.blocks.map((block) =>
        block.id === "work" && block.terminator.kind === "effect"
          ? {
              ...block,
              terminator: { ...block.terminator, operation: "changed" },
            }
          : block,
      ),
    } satisfies WorkflowDefinitionIR;
    expect(() => replayWorkflowExecutable(workflowExecutableIR(changedCommand), trace)).toThrow(
      "Workflow replay diverged at command 2.",
    );

    const increment = candidate.actionHandlers.increment;
    if (increment === undefined) throw new Error("Expected migration Action.");
    const changedAction = {
      ...candidate,
      actionHandlers: {
        ...candidate.actionHandlers,
        increment: {
          ...increment,
          blocks: increment.blocks.map((block) => ({
            ...block,
            body: block.body.map((instruction) =>
              instruction.kind === "state"
                ? { ...instruction, value: { kind: "literal" as const, value: 2 } }
                : instruction,
            ),
          })),
        },
      },
    } satisfies WorkflowDefinitionIR;
    expect(() => replayWorkflowExecutable(workflowExecutableIR(changedAction), trace)).toThrow(
      "Workflow replay diverged at Action 1.",
    );
  });

  test("replays a failed Dependency command and its recorded transfer separately", () => {
    const base = baseDefinition("failure-replay");
    const definition = {
      ...base,
      contract: {
        ...base.contract,
        dependencies: { work: schema },
      },
      entry: "work",
      blocks: [
        {
          id: "work",
          body: [],
          terminator: {
            kind: "effect" as const,
            dependency: "work",
            operation: "perform",
            input: { kind: "record" as const, fields: [] },
            result: "performed",
            next: "done",
          },
        },
        {
          id: "done",
          body: [],
          terminator: {
            kind: "return" as const,
            value: { kind: "local" as const, name: "performed" },
          },
        },
      ],
    } satisfies WorkflowDefinitionIR;
    const initial = createWorkflowIRExecution(definition, undefined, {}, 10);
    const suspended = advanceWorkflowIRExecution(definition, initial);
    const pending = suspended.pending;
    if (pending?.kind !== "effect") throw new Error("Expected a failed replay effect.");
    const providerFailure = { code: "provider-failed" };
    const failure = {
      type: "effect",
      dependency: pending.dependency,
      operation: pending.operation,
      failure: providerFailure,
    };
    const failed = resumeWorkflowIRExecution(definition, suspended, {
      kind: "effect",
      sequence: pending.sequence,
      at: 20,
      outcome: { status: "failed", failure: providerFailure },
    });

    expect(
      replayWorkflowExecutable(workflowExecutableIR(definition), {
        time: 10,
        initialState: {},
        steps: [
          { kind: "advance", history: initial.history },
          {
            kind: "effect",
            command: pending,
            sequence: pending.sequence,
            at: 20,
            outcome: { status: "failed", failure },
          },
          {
            kind: "transfer",
            pending,
            transfer: { kind: "fail", failure },
          },
        ],
        expected: failed,
      }),
    ).toEqual(failed);
  });
});

function researchWorkflowIR(): WorkflowDefinitionIR {
  return {
    version: WORKFLOW_IR_VERSION,
    language: WORKFLOW_LANGUAGE_VERSION,
    compiler: "test",
    contract: {
      name: "research",
      revision: 1,
      input: schema,
      state: schema,
      result: schema,
      failures: schema,
      actions: {},
      dependencies: { search: schema },
      children: [],
      visibility: [],
    },
    initialization: emptyInitialization(),
    actionHandlers: {},
    entry: "search",
    blocks: [
      {
        id: "search",
        body: [
          {
            kind: "let",
            name: "question",
            value: { kind: "input", path: ["question"] },
          },
          {
            kind: "state",
            path: ["phase"],
            operator: "=",
            value: { kind: "literal", value: "searching" },
          },
        ],
        terminator: {
          kind: "effect",
          dependency: "search",
          operation: "find",
          input: {
            kind: "record",
            fields: [
              {
                name: "query",
                value: { kind: "local", name: "question" },
              },
            ],
          },
          result: "evidence",
          next: "cooling",
        },
      },
      {
        id: "cooling",
        body: [
          {
            kind: "state",
            path: ["phase"],
            operator: "=",
            value: { kind: "literal", value: "cooling" },
          },
        ],
        terminator: {
          kind: "sleep",
          timing: { kind: "for", value: { kind: "literal", value: 100 } },
          next: "review",
        },
      },
      {
        id: "review",
        body: [
          {
            kind: "state",
            path: ["phase"],
            operator: "=",
            value: { kind: "literal", value: "review" },
          },
        ],
        terminator: {
          kind: "wait",
          condition: { kind: "state", path: ["approved"] },
          timeout: { kind: "for", value: { kind: "literal", value: 1_000 } },
          result: "approved",
          next: "decision",
        },
      },
      {
        id: "decision",
        body: [],
        terminator: {
          kind: "branch",
          condition: { kind: "local", name: "approved" },
          consequent: "done",
          alternate: "timed-out",
        },
      },
      {
        id: "done",
        body: [
          {
            kind: "state",
            path: ["phase"],
            operator: "=",
            value: { kind: "literal", value: "completed" },
          },
        ],
        terminator: {
          kind: "return",
          value: {
            kind: "record",
            fields: [
              {
                name: "report",
                value: {
                  kind: "property",
                  value: { kind: "local", name: "evidence" },
                  name: "answer",
                },
              },
            ],
          },
        },
      },
      {
        id: "timed-out",
        body: [],
        terminator: {
          kind: "fail",
          value: {
            kind: "record",
            fields: [
              {
                name: "type",
                value: { kind: "literal", value: "approvalTimedOut" },
              },
            ],
          },
        },
      },
    ],
  };
}

function loopWorkflowIR(): WorkflowDefinitionIR {
  return {
    ...baseDefinition("loop"),
    entry: "initialize",
    blocks: [
      {
        id: "initialize",
        body: [{ kind: "let", name: "count", value: { kind: "literal", value: 0 } }],
        terminator: { kind: "jump", next: "check" },
      },
      {
        id: "check",
        body: [],
        terminator: {
          kind: "branch",
          condition: {
            kind: "binary",
            operator: "<",
            left: { kind: "local", name: "count" },
            right: { kind: "input", path: ["limit"] },
          },
          consequent: "increment",
          alternate: "done",
        },
      },
      {
        id: "increment",
        body: [
          {
            kind: "assign",
            name: "count",
            operator: "+=",
            value: { kind: "literal", value: 1 },
          },
          {
            kind: "state",
            path: ["progress"],
            operator: "=",
            value: { kind: "local", name: "count" },
          },
        ],
        terminator: { kind: "jump", next: "check" },
      },
      {
        id: "done",
        body: [],
        terminator: {
          kind: "return",
          value: {
            kind: "record",
            fields: [{ name: "count", value: { kind: "local", name: "count" } }],
          },
        },
      },
    ],
  };
}

function infiniteWorkflowIR(): WorkflowDefinitionIR {
  return {
    ...baseDefinition("infinite"),
    entry: "again",
    blocks: [
      {
        id: "again",
        body: [],
        terminator: { kind: "jump", next: "again" },
      },
    ],
  };
}

function concurrentWorkflowIR(operation: "all" | "all-settled" | "race"): WorkflowDefinitionIR {
  return {
    ...baseDefinition(`concurrent-${operation}`),
    entry: "work",
    blocks: [
      {
        id: "work",
        body: [],
        terminator: {
          kind: "concurrent",
          operation,
          effects: [
            {
              kind: "effect",
              dependency: "work",
              operation: "left",
              input: { kind: "record", fields: [] },
            },
            {
              kind: "effect",
              dependency: "work",
              operation: "right",
              input: { kind: "record", fields: [] },
            },
          ],
          result: "result",
          next: "done",
        },
      },
      {
        id: "done",
        body: [],
        terminator: {
          kind: "return",
          value: { kind: "local", name: "result" },
        },
      },
    ],
  };
}

function cleanupWorkflowIR(): WorkflowDefinitionIR {
  return {
    ...baseDefinition("cleanup"),
    entry: "entry",
    blocks: [
      {
        id: "entry",
        body: [],
        terminator: {
          kind: "enter-scope",
          id: "work",
          cancellable: true,
          body: "work",
          cleanup: "cleanup",
          next: "done",
        },
      },
      {
        id: "work",
        body: [],
        terminator: {
          kind: "effect",
          dependency: "work",
          operation: "perform",
          input: { kind: "record", fields: [] },
          result: "work",
          next: "work-complete",
        },
      },
      {
        id: "work-complete",
        body: [],
        terminator: { kind: "leave-scope" },
      },
      {
        id: "cleanup",
        body: [
          {
            kind: "state",
            path: ["cleanups"],
            operator: "+=",
            value: { kind: "literal", value: 1 },
          },
        ],
        terminator: {
          kind: "sleep",
          timing: { kind: "for", value: { kind: "literal", value: 5 } },
          next: "cleanup-complete",
        },
      },
      {
        id: "cleanup-complete",
        body: [],
        terminator: { kind: "complete-cleanup" },
      },
      {
        id: "done",
        body: [],
        terminator: {
          kind: "return",
          value: {
            kind: "record",
            fields: [
              {
                name: "cleanups",
                value: { kind: "state", path: ["cleanups"] },
              },
            ],
          },
        },
      },
    ],
  };
}

function shieldedCleanupWorkflowIR(): WorkflowDefinitionIR {
  return {
    ...baseDefinition("shielded-cleanup"),
    entry: "entry",
    blocks: [
      {
        id: "entry",
        body: [],
        terminator: {
          kind: "enter-scope",
          id: "work",
          cancellable: true,
          body: "work",
          cleanup: "cleanup",
          next: "done",
        },
      },
      {
        id: "work",
        body: [],
        terminator: {
          kind: "effect",
          dependency: "work",
          operation: "perform",
          input: { kind: "record", fields: [] },
          result: "work",
          next: "work-complete",
        },
      },
      {
        id: "work-complete",
        body: [],
        terminator: { kind: "leave-scope" },
      },
      {
        id: "cleanup",
        body: [],
        terminator: {
          kind: "enter-scope",
          id: "cleanup-shield",
          cancellable: false,
          body: "release",
          next: "cleanup-complete",
        },
      },
      {
        id: "release",
        body: [
          {
            kind: "state",
            path: ["cleanups"],
            operator: "+=",
            value: { kind: "literal", value: 1 },
          },
        ],
        terminator: {
          kind: "effect",
          dependency: "cleanup",
          operation: "release",
          input: { kind: "record", fields: [] },
          result: "released",
          next: "release-complete",
        },
      },
      {
        id: "release-complete",
        body: [],
        terminator: { kind: "leave-scope" },
      },
      {
        id: "cleanup-complete",
        body: [],
        terminator: { kind: "complete-cleanup" },
      },
      {
        id: "done",
        body: [],
        terminator: {
          kind: "return",
          value: { kind: "record", fields: [] },
        },
      },
    ],
  };
}

function caughtWorkflowIR(): WorkflowDefinitionIR {
  return {
    ...baseDefinition("caught"),
    entry: "entry",
    blocks: [
      {
        id: "entry",
        body: [],
        terminator: {
          kind: "enter-scope",
          id: "guarded",
          cancellable: true,
          body: "fail",
          catch: { block: "catch", result: "failure" },
          cleanup: "cleanup",
          next: "done",
        },
      },
      {
        id: "fail",
        body: [],
        terminator: {
          kind: "fail",
          value: {
            kind: "record",
            fields: [{ name: "code", value: { kind: "literal", value: "boom" } }],
          },
        },
      },
      {
        id: "catch",
        body: [
          {
            kind: "state",
            path: ["caught"],
            operator: "=",
            value: {
              kind: "property",
              value: {
                kind: "property",
                value: { kind: "local", name: "failure" },
                name: "value",
              },
              name: "code",
            },
          },
        ],
        terminator: { kind: "leave-scope" },
      },
      {
        id: "cleanup",
        body: [
          {
            kind: "state",
            path: ["cleanups"],
            operator: "+=",
            value: { kind: "literal", value: 1 },
          },
        ],
        terminator: { kind: "complete-cleanup" },
      },
      {
        id: "done",
        body: [],
        terminator: {
          kind: "return",
          value: {
            kind: "record",
            fields: [
              { name: "caught", value: { kind: "state", path: ["caught"] } },
              {
                name: "cleanups",
                value: { kind: "state", path: ["cleanups"] },
              },
            ],
          },
        },
      },
    ],
  };
}

function nestedCleanupWorkflowIR(): WorkflowDefinitionIR {
  return {
    ...baseDefinition("nested-cleanup"),
    entry: "entry",
    blocks: [
      {
        id: "entry",
        body: [],
        terminator: {
          kind: "enter-scope",
          id: "outer",
          cancellable: true,
          body: "outer-body",
          cleanup: "outer-cleanup",
          next: "done",
        },
      },
      {
        id: "outer-body",
        body: [],
        terminator: {
          kind: "enter-scope",
          id: "inner",
          cancellable: true,
          body: "inner-body",
          cleanup: "inner-cleanup",
          next: "outer-complete",
        },
      },
      {
        id: "inner-body",
        body: [],
        terminator: {
          kind: "fail",
          value: {
            kind: "record",
            fields: [{ name: "code", value: { kind: "literal", value: "boom" } }],
          },
        },
      },
      {
        id: "inner-cleanup",
        body: [
          {
            kind: "state",
            path: ["order"],
            operator: "+=",
            value: { kind: "literal", value: "inner" },
          },
        ],
        terminator: { kind: "complete-cleanup" },
      },
      {
        id: "outer-complete",
        body: [],
        terminator: { kind: "leave-scope" },
      },
      {
        id: "outer-cleanup",
        body: [
          {
            kind: "state",
            path: ["order"],
            operator: "+=",
            value: { kind: "literal", value: ",outer" },
          },
        ],
        terminator: { kind: "complete-cleanup" },
      },
      {
        id: "done",
        body: [],
        terminator: {
          kind: "return",
          value: { kind: "state", path: ["order"] },
        },
      },
    ],
  };
}

function continuationWorkflowIR(): WorkflowDefinitionIR {
  return {
    ...baseDefinition("continuation"),
    entry: "entry",
    blocks: [
      {
        id: "entry",
        body: [],
        terminator: {
          kind: "enter-scope",
          id: "continuation-scope",
          cancellable: true,
          body: "continue",
          cleanup: "cleanup",
        },
      },
      {
        id: "continue",
        body: [],
        terminator: {
          kind: "continue-as-new",
          input: {
            kind: "record",
            fields: [
              {
                name: "cursor",
                value: { kind: "state", path: ["cursor"] },
              },
              {
                name: "events",
                value: { kind: "history", path: ["events"] },
              },
              {
                name: "suggested",
                value: { kind: "history", path: ["continueSuggested"] },
              },
            ],
          },
        },
      },
      {
        id: "cleanup",
        body: [
          {
            kind: "state",
            path: ["cleanups"],
            operator: "+=",
            value: { kind: "literal", value: 1 },
          },
        ],
        terminator: { kind: "complete-cleanup" },
      },
    ],
  };
}

function baseDefinition(name: string): Omit<WorkflowDefinitionIR, "entry" | "blocks"> {
  return {
    version: WORKFLOW_IR_VERSION,
    language: WORKFLOW_LANGUAGE_VERSION,
    compiler: "test",
    contract: {
      name,
      revision: 1,
      input: schema,
      state: schema,
      result: schema,
      failures: schema,
      actions: {},
      dependencies: {},
      children: [],
      visibility: [],
    },
    initialization: emptyInitialization(),
    actionHandlers: {},
  };
}

function selectWorkflowProcedure(
  definition: WorkflowDefinitionIR,
  procedure: WorkflowDefinitionIR["initialization"],
): WorkflowDefinitionIR {
  return {
    ...definition,
    entry: procedure.entry,
    blocks: procedure.blocks,
  };
}

function emptyInitialization(): WorkflowDefinitionIR["initialization"] {
  return {
    entry: "initialize",
    blocks: [
      {
        id: "initialize",
        body: [],
        terminator: { kind: "return", value: { kind: "literal", value: {} } },
      },
    ],
  };
}

function restart(execution: WorkflowIRExecution): WorkflowIRExecution {
  return JSON.parse(JSON.stringify(execution)) as WorkflowIRExecution;
}
