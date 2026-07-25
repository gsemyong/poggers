import {
  createWorkflowService,
  type WorkflowDefinition,
  type WorkflowImplementation,
  type WorkflowModelDefinition,
  type WorkflowRuntime,
} from "@/features/workflow";

type WorkflowRuntimeInput<Model extends WorkflowModelDefinition> = Readonly<{
  definition: WorkflowDefinition<Model>;
  implementation: WorkflowImplementation<Model>;
  dependencies: Parameters<typeof createWorkflowService<Model>>[2];
}>;

/** Server-development realization of the private workflow runtime. */
export function createDevelopmentWorkflowRuntime(): WorkflowRuntime {
  return Object.freeze({
    async create(input) {
      const { definition, implementation, dependencies } =
        input as WorkflowRuntimeInput<WorkflowModelDefinition>;
      return createWorkflowService(definition, implementation, dependencies);
    },
  });
}
