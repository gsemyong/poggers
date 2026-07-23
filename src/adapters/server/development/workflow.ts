import {
  createWorkflowService,
  type WorkflowImplementation,
  type WorkflowModelDefinition,
  type WorkflowRuntime,
} from "@/features/workflow";

type WorkflowRuntimeInput<Model extends WorkflowModelDefinition> = Readonly<{
  implementation: WorkflowImplementation<Model>;
  dependencies: Parameters<typeof createWorkflowService<Model>>[1];
}>;

/** Server-development realization of the private workflow runtime. */
export function createDevelopmentWorkflowRuntime(): WorkflowRuntime {
  return Object.freeze({
    async create(input) {
      const { implementation, dependencies } =
        input as WorkflowRuntimeInput<WorkflowModelDefinition>;
      return createWorkflowService(implementation, dependencies);
    },
  });
}
