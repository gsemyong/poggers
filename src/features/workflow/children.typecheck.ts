import { createSystem } from "@/core/system";
import { createWorkflow, type Workflow } from "@/features/workflow";

export type Child = Workflow<{
  Name: "child";
  Id: string;
  Input: Readonly<{ value: number }>;
  State: { approved: boolean };
  Result: Readonly<{ value: number }>;
  Actions: {
    approve: Workflow.Action<undefined, Readonly<{ approved: true }>>;
  };
}>;

export const child = createWorkflow<Child>({
  state: () => ({ approved: false }),
  actions: {
    approve({ state }) {
      state.approved = true;
      return { approved: true };
    },
  },
  async run({ input, state, wait }) {
    await wait(() => state.approved);
    return { value: input.value };
  },
});

export type Parent = Workflow<{
  Name: "parent";
  Id: string;
  Input: Readonly<{
    child: string;
    value: number;
    mode: "join" | "wait" | "complete";
    parentClose: "terminate" | "cancel" | "abandon";
    cancellation: "wait" | "request" | "abandon";
  }>;
  State: { child: string };
  Result: Readonly<{
    status: "succeeded" | "failed" | "cancelled" | "terminated";
  }>;
  Dependencies: {
    child: Workflow.Reference<Child>;
  };
  Actions: {};
}>;

export const parent = createWorkflow<Parent>({
  state: ({ input }) => ({ child: input.child }),
  actions: {},
  async run({ input, dependencies, wait }) {
    const execution = dependencies.child.get({ id: input.child });
    await execution.start(
      { input: { value: input.value } },
      {
        parentClose: input.parentClose,
        cancellation: input.cancellation,
      },
    );
    if (input.mode === "join") {
      await execution.approve();
      const result = await execution.join();
      return { status: result.status };
    }
    if (input.mode === "wait") {
      await wait(() => false);
    }
    return { status: "succeeded" };
  },
});

createWorkflow<Parent>({
  state: ({ input }) => ({ child: input.child }),
  actions: {},
  async run({ input, dependencies }) {
    const execution = dependencies.child.get({ id: input.child });
    await execution.start(
      { input: { value: input.value } },
      {
        // @ts-expect-error Parent-close policy is a closed semantic vocabulary.
        parentClose: "detach",
      },
    );
    return { status: "succeeded" };
  },
});

export default createSystem({
  features: {
    child,
    parent,
  },
});
