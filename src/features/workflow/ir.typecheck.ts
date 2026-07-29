import type { Dependency } from "@/core/dependency";
import { createSystem } from "@/core/system";
import { createWorkflow, type Workflow } from "@/features/workflow";
import { research } from "@/features/workflow/feature.typecheck";

type ControlFlow = Workflow<{
  Name: "control-flow";
  Id: string;
  Input: Readonly<{ limit: number; skip: number }>;
  State: { sum: number };
  Result: Readonly<{ sum: number }>;
  Actions: {};
}>;

const controlFlow = createWorkflow<ControlFlow>({
  state: () => ({ sum: 0 }),
  actions: {},
  run({ input, state }) {
    let index = 0;
    while (index < input.skip) index += 1;
    for (let value = 0; value < input.limit; value += 1) {
      if (value >= index) state.sum += value;
    }
    for (const offset of [1, 2]) state.sum += offset;
    return { sum: state.sum };
  },
});

type Calculation = Dependency<{
  Operations: {
    value(input: Readonly<{ value: number }>): Promise<Readonly<{ value: number }>>;
  };
}>;

type Concurrent = Workflow<{
  Name: "concurrent";
  Id: string;
  Input: Readonly<{ left: number; right: number }>;
  State: { total: number };
  Result: Readonly<{ total: number }>;
  Dependencies: { calculation: Calculation };
  Actions: {};
}>;

const concurrent = createWorkflow<Concurrent>({
  state: () => ({ total: 0 }),
  actions: {},
  async run({ input, state, dependencies }) {
    const values = await Promise.all([
      dependencies.calculation.value({ value: input.left }),
      dependencies.calculation.value({ value: input.right }),
    ]);
    state.total = values[0].value + values[1].value;
    return { total: state.total };
  },
});

type ConcurrentSettled = Workflow<{
  Name: "concurrent-settled";
  Id: string;
  Input: Readonly<{ left: number; right: number }>;
  State: { completed: number };
  Result: Readonly<{ completed: number }>;
  Dependencies: { calculation: Calculation };
  Actions: {};
}>;

const concurrentSettled = createWorkflow<ConcurrentSettled>({
  state: () => ({ completed: 0 }),
  actions: {},
  async run({ input, state, dependencies }) {
    const values = await Promise.allSettled([
      dependencies.calculation.value({ value: input.left }),
      dependencies.calculation.value({ value: input.right }),
    ]);
    state.completed = values.length;
    return { completed: state.completed };
  },
});

type ConcurrentRace = Workflow<{
  Name: "concurrent-race";
  Id: string;
  Input: Readonly<{ left: number; right: number }>;
  State: { winner: number };
  Result: Readonly<{ winner: number }>;
  Dependencies: { calculation: Calculation };
  Actions: {};
}>;

const concurrentRace = createWorkflow<ConcurrentRace>({
  state: () => ({ winner: 0 }),
  actions: {},
  async run({ input, state, dependencies }) {
    const value = await Promise.race([
      dependencies.calculation.value({ value: input.left }),
      dependencies.calculation.value({ value: input.right }),
    ]);
    state.winner = value.value;
    return { winner: state.winner };
  },
});

export default createSystem({
  features: {
    research,
    controlFlow,
    concurrent,
    concurrentSettled,
    concurrentRace,
  },
});
