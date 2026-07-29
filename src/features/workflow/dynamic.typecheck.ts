import type { Dependency } from "@/core/dependency";
import { createSystem } from "@/core/system";
import { createWorkflowRegistry, type Workflow, type WorkflowRegistry } from "@/features/workflow";

type Search = Dependency<{
  Operations: {
    search(input: Readonly<{ query: string }>): Promise<Readonly<{ evidence: string }>>;
  };
}>;

type Automations = WorkflowRegistry<{
  Name: "automations";
  Dependencies: { search: Search };
}>;

export const automations = createWorkflowRegistry<Automations>();

declare const workflows: Workflow.RegistryReference<typeof automations>;
type DynamicResearch = Workflow<{
  Name: "dynamic-research";
  Id: string;
  Input: Readonly<{ question: string }>;
  State: Readonly<{ phase: "working" | "completed" }>;
  Result: Readonly<{ report: string }>;
  Actions: {
    approve: Workflow.Action<undefined, Readonly<{ approved: true }>>;
    revise: Workflow.Action<Readonly<{ instruction: string }>, Readonly<{ revised: true }>>;
  };
}>;
declare const dynamicResearch: Workflow.DynamicDefinition<DynamicResearch>;

workflows.create({ source: "export default createWorkflow(...)" });
workflows.revise({
  name: "research",
  source: "export default createWorkflow(...)",
});
workflows.definition({ name: "research" });
workflows.definitions();

const execution = workflows.get({ id: "research-1" });
execution.start({
  definition: "research",
  input: { question: "What is durable execution?" },
});
execution.action({ name: "approve" });
execution.state();
execution.describe();
execution.result();
execution.join();
execution.observe({});
execution.pause();
execution.resume();
execution.cancel();
execution.terminate();

const typedExecution = workflows.get({
  id: "typed-research-1",
  definition: dynamicResearch,
});
typedExecution.start({ input: { question: "What is durable execution?" } });
typedExecution.action({ name: "approve" });
typedExecution.action({ name: "revise", input: { instruction: "Be precise." } });
typedExecution.state().then((state) => {
  if (state.status !== "idle") state.state.phase satisfies "working" | "completed";
});
typedExecution.result().then((result) => {
  if (result.status === "succeeded") result.value.report satisfies string;
});
typedExecution.join().then((result) => {
  if (result.status === "succeeded") result.value.report satisfies string;
});
typedExecution.migrate();

// @ts-expect-error Generated definition descriptors type their Workflow Input.
typedExecution.start({ input: { question: 42 } });
// @ts-expect-error Generated definition descriptors restrict Action names.
typedExecution.action({ name: "missing" });
// @ts-expect-error Generated definition descriptors type Action input.
typedExecution.action({ name: "revise", input: { instruction: 42 } });

// @ts-expect-error Dynamic Workflow execution identities are strings.
workflows.get({ id: 42 });
// @ts-expect-error Migration requires a definition-bound typed reference.
execution.migrate();
// @ts-expect-error Runtime-authored source remains a string.
workflows.create({ source: { text: "invalid" } });

export default createSystem({
  features: { automations },
});
