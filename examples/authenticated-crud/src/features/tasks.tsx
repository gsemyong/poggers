import { createFeature, type FeatureContractOf } from "kit";
import { createAggregate, type Aggregate } from "kit/features/aggregate";
import { createProjection, type Projection } from "kit/features/projection";
import { createReplica, type Replica } from "kit/features/replica";
import { createWorkflow, type Workflow } from "kit/features/workflow";
import {
  For,
  type BrowserMainThread,
  type Identifiers,
  type Navigation,
  type UUID,
  type WebDestination,
} from "kit/web";

import type { Identity, User } from "@/features/identity";

export type Task = Readonly<{
  id: string;
  ownerId: string;
  title: string;
  completed: boolean;
}>;

type TaskAggregate = Aggregate<{
  Name: "tasks";
  Key: string;
  State: Readonly<
    Task & {
      exists: boolean;
      deleted: boolean;
    }
  >;
  Principal: User;
  Commands: {
    create: Aggregate.Command<
      Readonly<{ title: string }>,
      Readonly<{ id: string }>,
      { exists: Record<never, never> }
    >;
    update: Aggregate.Command<
      Readonly<{ title: string }>,
      Record<never, never>,
      { missing: Record<never, never> }
    >;
    toggle: Aggregate.Command<
      undefined,
      Readonly<{ completed: boolean }>,
      { missing: Record<never, never> }
    >;
    remove: Aggregate.Command<undefined, Record<never, never>, { missing: Record<never, never> }>;
  };
  Events: {
    created: Aggregate.Event<1, Readonly<{ ownerId: string; title: string }>>;
    updated: Aggregate.Event<1, Readonly<{ title?: string; completed?: boolean }>>;
    removed: Aggregate.Event<1, Record<never, never>>;
  };
}>;

export const taskAggregateDefinition = {
  state: ({ key }) => ({
    id: key,
    ownerId: "",
    title: "",
    completed: false,
    exists: false,
    deleted: false,
  }),
  commands: {
    create({ key, state, principal, input, fail }) {
      if (state.exists && !state.deleted) fail({ type: "exists", data: {} });
      return {
        events: [
          {
            created: {
              ownerId: principal.id,
              title: input.title,
            },
          },
        ],
        result: { id: key },
      };
    },
    update({ state, input, fail }) {
      if (!state.exists || state.deleted) fail({ type: "missing", data: {} });
      return {
        events: [{ updated: input }],
        result: {},
      };
    },
    toggle({ state, fail }) {
      if (!state.exists || state.deleted) fail({ type: "missing", data: {} });
      const completed = !state.completed;
      return {
        events: [{ updated: { completed } }],
        result: { completed },
      };
    },
    remove({ state, fail }) {
      if (!state.exists || state.deleted) fail({ type: "missing", data: {} });
      return {
        events: [{ removed: {} }],
        result: {},
      };
    },
  },
  events: {
    created: {
      apply({ state, event }) {
        return {
          id: state.id,
          ownerId: event.ownerId,
          title: event.title,
          completed: false,
          exists: true,
          deleted: false,
        };
      },
    },
    updated: {
      apply({ state, event }) {
        return {
          id: state.id,
          ownerId: state.ownerId,
          title: event.title ?? state.title,
          completed: event.completed ?? state.completed,
          exists: state.exists,
          deleted: state.deleted,
        };
      },
    },
    removed: {
      apply({ state }) {
        return {
          id: state.id,
          ownerId: state.ownerId,
          title: state.title,
          completed: state.completed,
          exists: state.exists,
          deleted: true,
        };
      },
    },
  },
  authorize: {
    read({ state, principal }) {
      return state.exists && !state.deleted && state.ownerId === principal.id;
    },
    create({ state }) {
      return !state.exists || state.deleted;
    },
    update({ state, principal }) {
      return state.exists && !state.deleted && state.ownerId === principal.id;
    },
    toggle({ state, principal }) {
      return state.exists && !state.deleted && state.ownerId === principal.id;
    },
    remove({ state, principal }) {
      return state.exists && !state.deleted && state.ownerId === principal.id;
    },
  },
} satisfies Aggregate.Definition<TaskAggregate>;

export const taskAggregate = createAggregate<TaskAggregate>(taskAggregateDefinition);

type TaskProjection = Projection<{
  Name: "taskList";
  Version: 1;
  Principal: User;
  Sources: {
    tasks: Aggregate.Events<typeof taskAggregate>;
  };
  Rows: {
    tasks: Task;
  };
  Queries: {
    Text: { tasks: "title" };
    Analytics: { tasks: true };
  };
}>;

export const taskProjectionDefinition = {
  reduce({ event, rows }) {
    if (event.type === "created") {
      return [
        {
          upsert: {
            tasks: {
              id: event.key,
              ownerId: event.data.ownerId,
              title: event.data.title,
              completed: false,
            },
          },
        },
      ];
    }
    if (event.type === "removed") {
      return [{ remove: { tasks: { id: event.key } } }];
    }
    const current = rows.tasks.find(({ id }) => id === event.key);
    if (!current) return [];
    return [
      {
        upsert: {
          tasks: {
            id: current.id,
            ownerId: current.ownerId,
            title: event.data.title ?? current.title,
            completed: event.data.completed ?? current.completed,
          },
        },
      },
    ];
  },
  authorize: {
    tasks({ principal, row }) {
      return principal.id === row.ownerId;
    },
  },
} satisfies Projection.Definition<TaskProjection>;

export const taskProjection = createProjection<TaskProjection>(taskProjectionDefinition);

type TaskCompletion = Workflow<{
  Name: "taskCompletion";
  Id: string;
  Input: Readonly<{ taskId: string; principal: User }>;
  State: {
    phase: "verifying" | "completed";
    revision: number;
  };
  Result: Readonly<{ revision: number }>;
  Failures: {
    notCompleted: Readonly<{ taskId: string }>;
  };
  Dependencies: {
    tasks: Aggregate.Reference<typeof taskAggregate>;
  };
  Actions: {};
}>;

export const taskCompletionDefinition = {
  state: () => ({ phase: "verifying", revision: 0 }),
  actions: {},
  async run({ input, state, dependencies, fail }) {
    const snapshot = await dependencies.tasks
      .get({ key: input.taskId, principal: input.principal })
      .state();
    if (!snapshot.state.completed) {
      fail({ type: "notCompleted", data: { taskId: input.taskId } });
    }
    state.revision = snapshot.revision;
    state.phase = "completed";
    return { revision: snapshot.revision };
  },
} satisfies Workflow.Definition<TaskCompletion>;

export const taskCompletion = createWorkflow<TaskCompletion>(taskCompletionDefinition);

type TaskReplica = Replica<{
  Name: "taskReplica";
  Version: 1;
  Identity: Identity;
  Projection: typeof taskProjection;
  Rows: "tasks";
  Dependencies: {
    tasks: Aggregate.Reference<typeof taskAggregate>;
    taskCompletion: Workflow.Reference<typeof taskCompletion>;
  };
  Commands: {
    create: Replica.Command<Readonly<{ id: string; title: string }>>;
    update: Replica.Command<Readonly<{ id: string; title: string }>>;
    toggle: Replica.Command<Readonly<{ id: string }>>;
    remove: Replica.Command<Readonly<{ id: string }>>;
  };
}>;

export const taskReplicaDefinition = {
  state: () => ({ tasks: [] }),
  commands: {
    create: {
      async commit({ principal, dependencies, input, idempotencyKey }) {
        const outcome = await dependencies.tasks
          .get({ key: input.id, principal })
          .create({ title: input.title }, { idempotencyKey });
        if (outcome.status === "failed") throw new Error(outcome.failure.type);
        return {};
      },
    },
    update: {
      async commit({ principal, dependencies, input, idempotencyKey }) {
        const outcome = await dependencies.tasks
          .get({ key: input.id, principal })
          .update({ title: input.title }, { idempotencyKey });
        if (outcome.status === "failed") throw new Error(outcome.failure.type);
        return {};
      },
    },
    toggle: {
      async commit({ principal, dependencies, input, idempotencyKey }) {
        const outcome = await dependencies.tasks
          .get({ key: input.id, principal })
          .toggle({ idempotencyKey });
        if (outcome.status === "failed") throw new Error(outcome.failure.type);
        if (outcome.value.completed) {
          const execution = dependencies.taskCompletion.get({
            id: `${input.id}:${idempotencyKey}`,
          });
          await execution.start({
            input: { taskId: input.id, principal },
          });
          const completion = await execution.join();
          if (completion.status !== "succeeded") {
            throw new Error("Task completion Workflow did not succeed.");
          }
        }
        return {};
      },
    },
    remove: {
      async commit({ principal, dependencies, input, idempotencyKey }) {
        const outcome = await dependencies.tasks
          .get({ key: input.id, principal })
          .remove({ idempotencyKey });
        if (outcome.status === "failed") throw new Error(outcome.failure.type);
        return {};
      },
    },
  },
  optimistic: {
    create({ state, input }) {
      const next = [];
      for (const task of state.tasks) next.push(task);
      next.push({
        id: input.id,
        ownerId: "",
        title: input.title,
        completed: false,
      });
      return {
        tasks: next,
      };
    },
    update({ state, input }) {
      const next = [];
      for (const task of state.tasks) {
        next.push(
          task.id === input.id
            ? {
                id: task.id,
                ownerId: task.ownerId,
                title: input.title,
                completed: task.completed,
              }
            : task,
        );
      }
      return {
        tasks: next,
      };
    },
    toggle({ state, input }) {
      const next = [];
      for (const task of state.tasks) {
        next.push(
          task.id === input.id
            ? {
                id: task.id,
                ownerId: task.ownerId,
                title: task.title,
                completed: !task.completed,
              }
            : task,
        );
      }
      return {
        tasks: next,
      };
    },
    remove({ state, input }) {
      const next = [];
      for (const task of state.tasks) {
        if (task.id !== input.id) next.push(task);
      }
      return {
        tasks: next,
      };
    },
  },
  migrate: {},
} satisfies Replica.Definition<TaskReplica>;

export const taskReplica = createReplica<TaskReplica>(taskReplicaDefinition);

type TaskRoutes = {
  root: {
    Path: "";
  };
  list: {
    Parent: "root";
    Path: "";
    Metadata: {
      Title: "Tasks";
      Description: "Manage workspace tasks";
      Robots: "noindex";
    };
  };
  create: {
    Parent: "root";
    Path: "new";
    Metadata: { Title: "New task"; Robots: "noindex" };
  };
  edit: {
    Parent: "root";
    Path: ":id";
    Metadata: { Title: "Edit task"; Robots: "noindex" };
    Params: { id: UUID };
  };
};

export type TaskDestination = WebDestination<TaskRoutes>;

type TasksBrowser = {
  Environment: BrowserMainThread;
  Requires: {
    navigation: Navigation<TaskRoutes>;
    identifiers: Identifiers;
    taskReplica: Replica.Client<typeof taskReplica>;
  };
  State: {
    error: string | undefined;
    replica: Replica.State<typeof taskReplica>;
  };
  Actions: {
    receive(input: { replica: Replica.State<typeof taskReplica> }): void;
    create(): void;
    edit(input: { id: string }): void;
    back(): void;
    save(input: { destination: TaskDestination; title: string }): void;
    toggle(input: { id: string }): void;
    remove(input: { id: string }): void;
  };
  Components: {
    Admin: {
      Props: { destination: TaskDestination };
      State: { title: string | undefined };
      Actions: { changeTitle(input: { title: string }): void };
      Elements: {
        Root: "section";
        Header: "header";
        Heading: "div";
        Eyebrow: "p";
        Title: "h2";
        Copy: "p";
        New: "button";
        Status: "p";
        Empty: "div";
        EmptyTitle: "h3";
        EmptyCopy: "p";
        List: "div";
        Row: "article";
        TaskBody: "div";
        TaskTitle: "h3";
        TaskState: "p";
        Actions: "div";
        Edit: "button";
        Toggle: "button";
        Remove: "button";
        Form: "form";
        FormHeader: "div";
        FormTitle: "h3";
        Label: "label";
        Input: "input";
        FormActions: "div";
        Save: "button";
        Back: "button";
      };
    };
  };
  Routes: TaskRoutes;
};

type TasksFeatureDefinition = Readonly<{
  Features: {
    aggregate: FeatureContractOf<typeof taskAggregate>;
    completion: FeatureContractOf<typeof taskCompletion>;
    projection: FeatureContractOf<typeof taskProjection>;
    replica: FeatureContractOf<typeof taskReplica>;
  };
  Programs: { browser: TasksBrowser };
}>;

export type TasksFeature = TasksFeatureDefinition;

export const tasks = createFeature<TasksFeatureDefinition>({
  features: {
    aggregate: taskAggregate,
    completion: taskCompletion,
    projection: taskProjection,
    replica: taskReplica,
  },
  programs: {
    browser: {
      state: {
        error: undefined,
        replica: {
          status: "signed-out",
          pending: [],
          rejected: [],
        },
      },
      actions: {
        receive({ state }, { replica }) {
          state.replica = replica;
        },
        create({ dependencies }) {
          dependencies.navigation.navigate({ route: "create" });
        },
        edit({ dependencies }, { id }) {
          dependencies.navigation.navigate({ route: "edit", params: { id } });
        },
        back({ dependencies }) {
          dependencies.navigation.navigate({ route: "list" });
        },
        save({ dependencies, state }, { destination, title: inputTitle }) {
          const title = inputTitle.trim();
          if (!title) return;
          state.error = undefined;
          try {
            const command =
              destination.route === "edit"
                ? dependencies.taskReplica.update({
                    id: destination.params.id,
                    title,
                  })
                : dependencies.taskReplica.create({
                    id: dependencies.identifiers.create({}),
                    title,
                  });
            dependencies.navigation.navigate({ route: "list" });
            void command.catch((error: unknown) => {
              state.error = message(error);
            });
          } catch (error) {
            state.error = message(error);
          }
        },
        toggle({ dependencies, state }, { id }) {
          try {
            void dependencies.taskReplica.toggle({ id }).catch((error: unknown) => {
              state.error = message(error);
            });
          } catch (error) {
            state.error = message(error);
          }
        },
        remove({ dependencies, state }, { id }) {
          try {
            void dependencies.taskReplica.remove({ id }).catch((error: unknown) => {
              state.error = message(error);
            });
          } catch (error) {
            state.error = message(error);
          }
        },
      },
      start({ dependencies, actions }) {
        return dependencies.taskReplica.subscribe((replica) => actions.receive({ replica }));
      },
      components: {
        Admin: {
          state: { title: undefined },
          actions: {
            changeTitle({ state }, { title }) {
              state.title = title;
            },
          },
          view({ feature, elements, props, state, actions }) {
            const {
              Root,
              Header,
              Heading,
              Eyebrow,
              Title,
              Copy,
              New,
              Status,
              Empty,
              EmptyTitle,
              EmptyCopy,
              List,
              Row,
              TaskBody,
              TaskTitle,
              TaskState,
              Actions,
              Edit,
              Toggle,
              Remove,
              Form,
              FormHeader,
              FormTitle,
              Label,
              Input,
              FormActions,
              Save,
              Back,
            } = elements;
            const tasks = () => feature.replica.data?.tasks ?? [];
            const title = () => {
              const destination = props.destination;
              return (
                state.title ?? (destination.route === "edit" ? (editingTask()?.title ?? "") : "")
              );
            };
            const editingTask = () => {
              const destination = props.destination;
              return destination.route === "edit"
                ? tasks().find((task) => task.id === destination.params.id)
                : undefined;
            };
            return (
              <Root aria-label="Task administration">
                <Header>
                  <Heading>
                    <Eyebrow>Workspace</Eyebrow>
                    <Title>Tasks</Title>
                    <Copy>Plan the work, keep it moving, and close the loop.</Copy>
                  </Heading>
                  {() =>
                    props.destination.route === "list" ? (
                      <New type="button" onClick={() => feature.create()}>
                        New task
                      </New>
                    ) : null
                  }
                </Header>
                <Status role="status">
                  {() =>
                    feature.error ??
                    feature.replica.rejected[0]?.message ??
                    feature.replica.error ??
                    (feature.replica.status === "loading"
                      ? "Restoring tasks"
                      : feature.replica.status === "offline"
                        ? `Offline · ${feature.replica.pending.length} queued`
                        : feature.replica.status === "synchronizing"
                          ? "Synchronizing changes"
                          : feature.replica.status === "upgrade-required"
                            ? "Update required"
                            : `${tasks().length} ${tasks().length === 1 ? "task" : "tasks"}`)
                  }
                </Status>
                {props.destination.route === "list" ? (
                  <List>
                    <For
                      each={() => tasks()}
                      by="id"
                      fallback={
                        <Empty>
                          <EmptyTitle>No tasks yet</EmptyTitle>
                          <EmptyCopy>Create the first task to start this workspace.</EmptyCopy>
                        </Empty>
                      }
                    >
                      {(task) => (
                        <Row>
                          <TaskBody>
                            <TaskTitle>{() => task.title}</TaskTitle>
                            <TaskState>
                              {() => (task.completed ? "Completed" : "In progress")}
                            </TaskState>
                          </TaskBody>
                          <Actions>
                            <Edit type="button" onClick={() => feature.edit({ id: task.id })}>
                              Edit
                            </Edit>
                            <Toggle type="button" onClick={() => feature.toggle({ id: task.id })}>
                              {() => (task.completed ? "Reopen" : "Complete")}
                            </Toggle>
                            <Remove type="button" onClick={() => feature.remove({ id: task.id })}>
                              Delete
                            </Remove>
                          </Actions>
                        </Row>
                      )}
                    </For>
                  </List>
                ) : (
                  () =>
                    props.destination.route === "edit" &&
                    feature.replica.status === "synchronized" &&
                    !editingTask() ? (
                      <Empty>
                        <EmptyTitle>Task not found</EmptyTitle>
                        <EmptyCopy>This task no longer exists.</EmptyCopy>
                        <Back type="button" onClick={() => feature.back()}>
                          Back to tasks
                        </Back>
                      </Empty>
                    ) : (
                      <Form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void feature.save({
                            destination: props.destination,
                            title: title(),
                          });
                        }}
                      >
                        <FormHeader>
                          <Eyebrow>{props.destination.route === "edit" ? "Edit" : "New"}</Eyebrow>
                          <FormTitle>
                            {props.destination.route === "edit" ? "Update task" : "Create task"}
                          </FormTitle>
                        </FormHeader>
                        <Label for="task-title">Task title</Label>
                        <Input
                          id="task-title"
                          name="title"
                          autofocus
                          value={() => title()}
                          onInput={(event) =>
                            actions.changeTitle({ title: event.currentTarget.value })
                          }
                        />
                        <FormActions>
                          <Save type="submit">Save task</Save>
                          <Back type="button" onClick={() => feature.back()}>
                            Cancel
                          </Back>
                        </FormActions>
                      </Form>
                    )
                )}
              </Root>
            );
          },
        },
      },
      routes: {
        root: {
          view({ children }) {
            return children;
          },
        },
        list: {
          view({ components: { Admin } }) {
            return <Admin destination={{ route: "list" }} />;
          },
        },
        create: {
          view({ components: { Admin } }) {
            return <Admin destination={{ route: "create" }} />;
          },
        },
        edit: {
          view({ components: { Admin }, params }) {
            return <Admin destination={{ route: "edit", params: { id: params.id } }} />;
          },
        },
      },
    },
  },
});

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
