import type { Dependency } from "@/core/dependency";
import { createSystem } from "@/core/system";
import {
  createWorkflow,
  type Workflow,
  type WorkflowExecutionFailure,
  type WorkflowMigrationResult,
  type WorkflowStartResult,
  type WorkflowStatus,
} from "@/features/workflow";

type Search = Dependency<{
  Operations: {
    search(input: Readonly<{ query: string }>): Promise<Readonly<{ evidence: string }>>;
  };
  Heartbeats: {
    search: Readonly<{ completed: number }>;
  };
}>;

type CleanupWork = Dependency<{
  Operations: {
    perform(input: Readonly<{ id: string }>): Promise<Readonly<{ accepted: true }>>;
    release(input: Readonly<{ id: string }>): Promise<Readonly<{ released: true }>>;
  };
}>;

type Cleanup = Workflow<{
  Name: "cleanup";
  Id: string;
  Input: Readonly<{ id: string }>;
  State: { phase: "working" | "cleaning" | "completed" };
  Result: Readonly<{ completed: true }>;
  Dependencies: { work: CleanupWork };
  Actions: {};
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
    observedAt: number;
    timedOut: boolean;
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

export const research = createWorkflow<Research>({
  state({ id, input }) {
    id satisfies string;
    input.question satisfies string;
    return {
      phase: "planning",
      approved: false,
      passes: 0,
      observedAt: 0,
      timedOut: false,
    };
  },
  actions: {
    revise({ state, input }) {
      state.phase = "working";
      input.instruction satisfies string;
      return { revised: true };
    },
    approve({ state }) {
      state.approved = true;
      return { approved: true };
    },
  },
  async run({ input, state, dependencies, history, continueAsNew, time, wait }) {
    if ((input.continuations ?? 0) > 0) {
      continueAsNew({
        ...input,
        continuations: (input.continuations ?? 0) - 1,
      });
    }
    history.events satisfies number;
    history.continueSuggested satisfies boolean;
    state.passes += 1;
    state.phase = "review";
    state.timedOut = !(await wait(() => state.approved, { for: 500 }));
    await time.sleep({ for: 1_000 });
    state.observedAt = time.now();
    const evidence = await dependencies.search.search(
      { query: input.question },
      {
        retry: {
          maximumAttempts: 3,
          initialDelay: 100,
          ...(input.nonRetryable === undefined ? {} : { nonRetryable: [input.nonRetryable] }),
        },
        timeout: {
          total: input.total ?? 120_000,
          attempt: input.attempt ?? 60_000,
          ...(input.heartbeat === undefined ? {} : { heartbeat: input.heartbeat }),
        },
        cancellation: input.cancellation ?? "request",
      },
    );
    state.phase = "completed";
    return { report: evidence.evidence };
  },
});

export const cleanup = createWorkflow<Cleanup>({
  state: () => ({ phase: "working" }),
  actions: {},
  async run({ input, state, dependencies, shield }) {
    try {
      await dependencies.work.perform({ id: input.id });
      state.phase = "completed";
    } finally {
      await shield(async () => {
        state.phase = "cleaning";
        await dependencies.work.release({ id: input.id });
      });
    }
    return { completed: true };
  },
});

createWorkflow<Cleanup>({
  state: () => ({ phase: "working" }),
  actions: {},
  async run({ shield }) {
    // @ts-expect-error Shield requires an asynchronous closure.
    await shield(() => {});
    return { completed: true };
  },
});

declare const workflows: Workflow.Reference<typeof research>;
const execution = workflows.get({ id: "research-1" });
execution.start({
  input: { question: "What is durable execution?" },
}) satisfies Promise<WorkflowStartResult>;
execution.approve() satisfies Promise<Workflow.Outcome<Readonly<{ approved: true }>, never>>;
execution.approve({ wait: "accepted" }) satisfies Promise<Workflow.Invocation>;
execution.revise(
  { instruction: "Add evidence." },
  { wait: "completed", idempotencyKey: "revise-1" },
) satisfies Promise<Workflow.Outcome<Readonly<{ revised: true }>, never>>;
execution.migrate() satisfies Promise<WorkflowMigrationResult>;
execution.state() satisfies Promise<
  | Readonly<{ status: "idle"; revision: number }>
  | Readonly<{
      status: Exclude<WorkflowStatus, "idle">;
      revision: number;
      state: Readonly<Research["State"]>;
    }>
>;
execution.join() satisfies Promise<
  | Readonly<{ status: "succeeded"; value: Readonly<{ report: string }> }>
  | Readonly<{
      status: "failed";
      failure: WorkflowExecutionFailure;
    }>
  | Readonly<{ status: "cancelled" | "terminated" }>
>;
execution.observe({ after: 12 }) satisfies AsyncIterable<{
  cursor: number;
  status: string;
}>;
workflows.list({
  limit: 20,
  where: {
    status: ["running", "paused"],
    startedAt: { from: 1_000, through: 2_000 },
    state: {
      phase: { oneOf: ["planning", "review"] },
      approved: { equals: true },
      passes: { atLeast: 1, atMost: 3 },
    },
  },
}) satisfies Promise<{
  cursor: number;
  workflows: readonly {
    workflow: { id: string; status: WorkflowStatus };
    state: { phase: string; approved: boolean; passes: number };
  }[];
  done: boolean;
}>;
workflows.listSchedules({
  where: { status: ["active", "paused"] },
}) satisfies Promise<{ schedules: readonly { id: string }[] }>;
workflows.listScheduleRuns({
  id: "daily-research",
  where: { state: { phase: { equals: "completed" } } },
}) satisfies Promise<{ runs: readonly { occurrence: string }[] }>;
workflows.createSchedule({
  id: "daily-research",
  definition: {
    input: { question: "What changed?" },
    timing: { cron: "0 9 * * *", timeZone: "Europe/Bratislava" },
    overlap: "buffer-one",
    jitter: 1_000,
    catchUp: 60_000,
    pauseOnFailure: true,
  },
  paused: true,
  trigger: true,
  note: "Waiting for operator approval.",
  remaining: 10,
});
workflows.updateSchedule({
  id: "daily-research",
  definition: {
    input: { question: "What changed?" },
    timing: {
      any: [
        { every: 60_000, offset: 5_000 },
        { cron: "0 9 * * *", timeZone: "Europe/Bratislava" },
      ],
      except: [{ calendar: { dayOfWeek: [6, 7] }, timeZone: "Europe/Bratislava" }],
    },
    overlap: "cancel-current",
  },
});
workflows.describeSchedule({ id: "daily-research" }) satisfies Promise<{
  status: "active" | "paused" | "deleted";
}>;
workflows.pauseSchedule({ id: "daily-research", note: "Maintenance." });
workflows.resumeSchedule({ id: "daily-research", note: "Maintenance complete." });
workflows.triggerSchedule({ id: "daily-research", overlap: "concurrent" });
workflows.backfillSchedule({
  id: "daily-research",
  from: 1_000,
  through: 10_000,
  overlap: "buffer-all",
});
workflows.deleteSchedule({ id: "daily-research" });

workflows.list({
  where: {
    state: {
      // @ts-expect-error Visibility filters expose only selected State fields.
      timedOut: { equals: true },
    },
  },
});
workflows.list({
  where: {
    state: {
      // @ts-expect-error Visibility values retain the selected State field type.
      phase: { equals: "unknown" },
    },
  },
});
workflows.list({
  where: {
    state: {
      // @ts-expect-error Ordered bounds apply only to numeric visibility fields.
      approved: { atLeast: 1 },
    },
  },
});

// @ts-expect-error Workflow IDs retain their declared type.
workflows.get({ id: 1 });
// @ts-expect-error Action input comes from the semantic model.
execution.revise({ instruction: 1 });
// @ts-expect-error Undeclared Actions do not exist.
execution.reject();
workflows.createSchedule({
  id: "invalid-input",
  definition: {
    // @ts-expect-error Schedule input retains the Workflow Input schema.
    input: { question: 1 },
    timing: { every: 1_000 },
  },
});
workflows.createSchedule({
  id: "invalid-overlap",
  definition: {
    input: { question: "question" },
    timing: { every: 1_000 },
    // @ts-expect-error Overlap is a closed semantic policy.
    overlap: "queue",
  },
});
workflows.createSchedule({
  id: "invalid-exclusion",
  definition: {
    input: { question: "question" },
    timing: {
      any: [{ every: 1_000 }],
      // @ts-expect-error Exclusions are civil-calendar predicates, not another interval.
      except: [{ every: 10_000 }],
    },
  },
});

createWorkflow<Research>({
  state: () => ({
    phase: "planning",
    approved: false,
    passes: 0,
    observedAt: 0,
    timedOut: false,
  }),
  actions: {
    revise() {
      return { revised: true };
    },
    // @ts-expect-error Action results must match the semantic model.
    approve() {
      return { approved: false };
    },
  },
  async run() {
    return { report: "ok" };
  },
});

createWorkflow<Research>({
  // @ts-expect-error State initialization must satisfy the semantic model.
  state: () => ({ phase: "planning", approved: false }),
  actions: {
    revise() {
      return { revised: true };
    },
    approve() {
      return { approved: true };
    },
  },
  async run({ dependencies }) {
    // @ts-expect-error Dependency inputs retain their declared schema.
    await dependencies.search.search({ query: 1 });
    return { report: "unreachable" };
  },
});

createWorkflow<Research>({
  state: () => ({
    phase: "planning",
    approved: false,
    passes: 0,
    observedAt: 0,
    timedOut: false,
  }),
  actions: {
    // @ts-expect-error Actions are ordered State transitions and cannot suspend.
    async revise() {
      return { revised: true };
    },
    approve() {
      return { approved: true };
    },
  },
  async run() {
    return { report: "ok" };
  },
});

type Fallible = Workflow<{
  Name: "fallible";
  Id: string;
  Input: undefined;
  State: { ready: boolean };
  Result: { done: true };
  Failures: { rejected: { reason: string } };
}>;

type InvalidVisibility = Workflow<{
  Name: "invalid-visibility";
  Id: string;
  Input: undefined;
  State: { nested: { value: string } };
  Result: { done: true };
  Visibility: { nested: true };
}>;

createWorkflow<InvalidVisibility>({
  // @ts-expect-error Visibility indexes must select scalar State fields.
  state: () => ({ nested: { value: "value" } }),
  actions: {},
  // @ts-expect-error Invalid visibility makes the complete Workflow model unimplementable.
  run: () => ({ done: true }),
});

createWorkflow<Fallible>({
  state: () => ({ ready: false }),
  actions: {},
  run({ fail }) {
    // @ts-expect-error Declared Workflow failure data remains exact.
    fail({ type: "rejected", data: { reason: 1 } });
    return { done: true };
  },
});

export default createSystem({
  features: { cleanup, research },
});
