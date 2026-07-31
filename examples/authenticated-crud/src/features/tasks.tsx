import {
  createFeature,
  type Dependency,
  type DependencyImplementation,
  type FeatureContractOf,
} from "kit";
import { createData, type Data } from "kit/features/data";
import type { Identity as IdentityFeature } from "kit/features/identity";
import { createWorkflow, type Workflow } from "kit/features/workflow";
import { getHttpValue, type HttpResponse, type HttpServer, type ServerProcess } from "kit/server";
import {
  For,
  type BrowserMainThread,
  type Identifiers,
  type Navigation,
  type UUID,
  type WebDependencyProvider,
  type WebDestination,
} from "kit/web";

import type { Identity, User } from "@/features/identity";

export type Task = Readonly<{
  id: string;
  ownerId: string;
  title: string;
  completed: boolean;
  embedding: readonly number[];
}>;

type TaskRecord = Readonly<
  Task & {
    exists: boolean;
    deleted: boolean;
  }
>;

type TaskData = Data<{
  Name: "tasks";
  Version: 1;
  Identity: Identity;
  Record: TaskRecord;
  Commands: {
    create: Data.Command<
      Readonly<{ id: string; title: string }>,
      Readonly<{ id: string }>,
      { exists: Record<never, never> }
    >;
    update: Data.Command<
      Readonly<{ id: string; title: string }>,
      Record<never, never>,
      { missing: Record<never, never> }
    >;
    toggle: Data.Command<
      Readonly<{ id: string }>,
      Readonly<{ completed: boolean }>,
      { missing: Record<never, never> }
    >;
    remove: Data.Command<
      Readonly<{ id: string }>,
      Record<never, never>,
      { missing: Record<never, never> }
    >;
  };
  Events: {
    created: Data.Event<
      1,
      Readonly<{ ownerId: string; title: string; embedding: readonly number[] }>
    >;
    updated: Data.Event<
      1,
      Readonly<{ title?: string; completed?: boolean; embedding?: readonly number[] }>
    >;
    removed: Data.Event<1, Record<never, never>>;
  };
  Queries: {
    Text: "title";
    Vector: { Field: "embedding"; Dimensions: 4 };
    Analytics: true;
  };
}>;

export function taskEmbedding(value: string): readonly number[] {
  const normalized = value.trim().toLowerCase();
  let first = 1;
  let second = 1;
  let third = 1;
  let fourth = 1;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const bucket = code % 4;
    if (bucket === 0) first += code;
    else if (bucket === 1) second += code;
    else if (bucket === 2) third += code;
    else fourth += code;
  }
  return [first, second, third, fourth];
}

export const taskDataDefinition = {
  retention: "retain",
  state: ({ key }) => ({
    id: key,
    ownerId: "",
    title: "",
    completed: false,
    embedding: [1, 1, 1, 1],
    exists: false,
    deleted: false,
  }),
  commands: {
    create({ state, principal, input, fail }) {
      if (state.exists && !state.deleted) fail({ type: "exists", data: {} });
      return {
        events: [
          {
            created: {
              ownerId: principal.id,
              title: input.title,
              embedding: taskEmbedding(input.title),
            },
          },
        ],
        result: { id: input.id },
      };
    },
    update({ state, input, fail }) {
      if (!state.exists || state.deleted) fail({ type: "missing", data: {} });
      return {
        events: [{ updated: { title: input.title, embedding: taskEmbedding(input.title) } }],
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
          embedding: event.embedding,
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
          embedding: event.embedding ?? state.embedding,
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
          embedding: state.embedding,
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
    query({ principal }) {
      return {
        where: {
          ownerId: { equal: principal.id },
          deleted: { equal: false },
        },
      };
    },
  },
} satisfies Data.Definition<TaskData>;

export const taskData = createData<TaskData>(taskDataDefinition);

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
    tasksAuthority: Data.Authority<typeof taskData>;
  };
  Actions: {};
}>;

export const taskCompletionDefinition = {
  state: () => ({ phase: "verifying", revision: 0 }),
  actions: {},
  async run({ input, state, dependencies, fail }) {
    const snapshot = await dependencies.tasksAuthority
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

type TaskCompletionVerification = Dependency<{
  Operations: {
    verify(input: Readonly<{ taskId: string }>): Promise<Readonly<{ revision: number }>>;
  };
}>;

const completionVerificationProvider: WebDependencyProvider<TaskCompletionVerification> = {
  requirements: {},
  development({ request }) {
    return {
      async verify({ input, invocation }) {
        const response = await request({
          path: "/api/tasks/completion",
          method: "POST",
          headers: { "x-kit-command": invocation.id },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => undefined)) as
            | Readonly<{ message?: string }>
            | undefined;
          throw new Error(failure?.message ?? `Task verification failed (${response.status}).`);
        }
        return (await response.json()) as Readonly<{ revision: number }>;
      },
    } satisfies DependencyImplementation<TaskCompletionVerification>;
  },
};

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
    tasks: Data.Client<typeof taskData>;
    completionVerification: TaskCompletionVerification;
  };
  State: {
    error: string | undefined;
    replica: Data.State<typeof taskData>;
    query: string;
    queryVersion: number;
    searchMode: "text" | "related";
    matches: readonly string[] | undefined;
    open: number;
    completed: number;
    verification:
      | Readonly<{
          taskId: string;
          status: "verifying" | "verified" | "failed";
          revision?: number;
          message?: string;
        }>
      | undefined;
  };
  Actions: {
    receive(input: { replica: Data.State<typeof taskData> }): Promise<void>;
    search(input: { query: string; mode: "text" | "related" }): Promise<void>;
    create(): void;
    edit(input: { id: string }): void;
    back(): void;
    save(input: { destination: TaskDestination; title: string }): void;
    toggle(input: { id: string }): void;
    remove(input: { id: string }): void;
    verify(input: { id: string }): Promise<void>;
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
        Search: "div";
        SearchLabel: "label";
        SearchInput: "input";
        SearchModes: "div";
        TextMode: "button";
        RelatedMode: "button";
        Summary: "dl";
        SummaryItem: "div";
        SummaryValue: "dd";
        SummaryLabel: "dt";
        Results: "p";
        Empty: "div";
        EmptyTitle: "h3";
        EmptyCopy: "p";
        List: "div";
        Row: "article";
        TaskBody: "div";
        TaskTitle: "h3";
        TaskState: "p";
        Verification: "p";
        Actions: "div";
        Edit: "button";
        Toggle: "button";
        Verify: "button";
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

type TasksServer = {
  Environment: ServerProcess;
  Requires: {
    http: HttpServer;
    identity: IdentityFeature.Service<Identity>;
    taskCompletion: Workflow.Reference<typeof taskCompletion>;
  };
};

type TasksFeatureDefinition = Readonly<{
  Features: {
    data: FeatureContractOf<typeof taskData>;
    completion: FeatureContractOf<typeof taskCompletion>;
  };
  Programs: { browser: TasksBrowser; server: TasksServer };
  Providers: { web: { completionVerification: WebDependencyProvider<TaskCompletionVerification> } };
}>;

export type TasksFeature = TasksFeatureDefinition;

export const tasks = createFeature<TasksFeatureDefinition>({
  features: {
    data: taskData,
    completion: taskCompletion,
  },
  providers: {
    web: { completionVerification: completionVerificationProvider },
  },
  programs: {
    server: {
      start({ dependencies }) {
        const respond = (status: number, value: object): HttpResponse => ({
          status,
          headers: [{ name: "content-type", value: "application/json" }],
          body: JSON.stringify(value),
          stream: undefined,
        });
        return dependencies.http.route({
          path: "/api/tasks/completion",
          async handle(request) {
            if (request.method !== "POST") {
              return respond(405, { message: "Method not allowed." });
            }
            const principal = await dependencies.identity.authenticate({
              cookie: getHttpValue(request.headers, { name: "cookie" }),
            });
            if (!principal) {
              return respond(401, { message: "Authentication required." });
            }
            let taskId: string | undefined;
            try {
              const input = JSON.parse(request.body) as Readonly<{ taskId?: string }>;
              if (input.taskId !== undefined && input.taskId.length > 0) {
                taskId = input.taskId;
              }
            } catch {}
            if (!taskId) {
              return respond(400, { message: "A task id is required." });
            }
            const invocation =
              getHttpValue(request.headers, { name: "x-kit-command" }) ?? "task-verification";
            const execution = dependencies.taskCompletion.get({
              id: `${taskId}:${invocation}`,
            });
            await execution.start(
              {
                input: { taskId, principal },
                conflict: "use",
                reuse: "failed",
              },
              { idempotencyKey: invocation },
            );
            const result = await execution.join();
            return result.status === "succeeded"
              ? respond(200, result.value)
              : respond(409, {
                  message:
                    result.status === "failed"
                      ? "The durable completion check failed."
                      : `The durable completion check ${result.status}.`,
                });
          },
        });
      },
    },
    browser: {
      state: {
        error: undefined,
        query: "",
        queryVersion: 0,
        searchMode: "text",
        matches: undefined,
        open: 0,
        completed: 0,
        verification: undefined,
        replica: {
          status: "signed-out",
          pending: [],
          rejected: [],
        },
      },
      actions: {
        async receive({ dependencies, state }, { replica }) {
          state.replica = replica;
          const query = state.query;
          const mode = state.searchMode;
          const version = ++state.queryVersion;
          try {
            const [summary, matches] = await Promise.all([
              taskSummary(dependencies.tasks),
              query ? taskMatches(dependencies.tasks, query, mode) : undefined,
            ]);
            if (state.queryVersion !== version) return;
            state.error = undefined;
            state.open = summary.open;
            state.completed = summary.completed;
            state.matches = matches;
          } catch (error) {
            if (state.queryVersion === version) state.error = message(error);
          }
        },
        async search({ dependencies, state }, { query, mode }) {
          state.query = query;
          state.searchMode = mode;
          const version = ++state.queryVersion;
          try {
            const matches = query.trim()
              ? await taskMatches(dependencies.tasks, query, mode)
              : undefined;
            if (state.queryVersion !== version) return;
            state.error = undefined;
            state.matches = matches;
          } catch (error) {
            if (state.queryVersion === version) state.error = message(error);
          }
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
            if (destination.route === "edit") {
              dependencies.tasks.update({
                id: destination.params.id,
                title,
              });
            } else {
              dependencies.tasks.create({
                id: dependencies.identifiers.create({}),
                title,
              });
            }
            dependencies.navigation.navigate({ route: "list" });
          } catch (error) {
            state.error = message(error);
          }
        },
        toggle({ dependencies, state }, { id }) {
          try {
            dependencies.tasks.toggle({ id });
          } catch (error) {
            state.error = message(error);
          }
        },
        remove({ dependencies, state }, { id }) {
          try {
            dependencies.tasks.remove({ id });
          } catch (error) {
            state.error = message(error);
          }
        },
        async verify({ dependencies, state }, { id }) {
          state.verification = { taskId: id, status: "verifying" };
          try {
            const result = await dependencies.completionVerification.verify({ taskId: id });
            state.verification = {
              taskId: id,
              status: "verified",
              revision: result.revision,
            };
          } catch (error) {
            state.verification = {
              taskId: id,
              status: "failed",
              message: message(error),
            };
          }
        },
      },
      start({ dependencies, actions }) {
        return dependencies.tasks.subscribe((replica) => actions.receive({ replica }));
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
              Search,
              SearchLabel,
              SearchInput,
              SearchModes,
              TextMode,
              RelatedMode,
              Summary,
              SummaryItem,
              SummaryValue,
              SummaryLabel,
              Results,
              Empty,
              EmptyTitle,
              EmptyCopy,
              List,
              Row,
              TaskBody,
              TaskTitle,
              TaskState,
              Verification,
              Actions,
              Edit,
              Toggle,
              Verify,
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
            const visibleTasks = () => {
              if (feature.matches === undefined) return tasks();
              const byId = new Map(tasks().map((task) => [task.id, task]));
              return feature.matches.flatMap((id) => {
                const task = byId.get(id);
                return task === undefined ? [] : [task];
              });
            };
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
                  <>
                    <Search>
                      <SearchLabel for="task-search">Find tasks</SearchLabel>
                      <SearchInput
                        id="task-search"
                        type="search"
                        value={() => feature.query}
                        placeholder={
                          feature.searchMode === "text"
                            ? "Search exact words"
                            : "Find conceptually related tasks"
                        }
                        onInput={(event) =>
                          feature.search({
                            query: event.currentTarget.value,
                            mode: feature.searchMode,
                          })
                        }
                      />
                      <SearchModes aria-label="Search mode">
                        <TextMode
                          type="button"
                          aria-pressed={() => feature.searchMode === "text"}
                          onClick={() => feature.search({ query: feature.query, mode: "text" })}
                        >
                          Words
                        </TextMode>
                        <RelatedMode
                          type="button"
                          aria-pressed={() => feature.searchMode === "related"}
                          onClick={() => feature.search({ query: feature.query, mode: "related" })}
                        >
                          Related
                        </RelatedMode>
                      </SearchModes>
                    </Search>
                    <Summary>
                      <SummaryItem>
                        <SummaryValue>{() => `${tasks().length}`}</SummaryValue>
                        <SummaryLabel>Total</SummaryLabel>
                      </SummaryItem>
                      <SummaryItem>
                        <SummaryValue>{() => `${feature.open}`}</SummaryValue>
                        <SummaryLabel>Open</SummaryLabel>
                      </SummaryItem>
                      <SummaryItem>
                        <SummaryValue>{() => `${feature.completed}`}</SummaryValue>
                        <SummaryLabel>Completed</SummaryLabel>
                      </SummaryItem>
                    </Summary>
                    <Results aria-live="polite">
                      {() =>
                        feature.query
                          ? `${visibleTasks().length} ${feature.searchMode === "text" ? "text" : "similarity"} results`
                          : "All locally available tasks"
                      }
                    </Results>
                    <List>
                      <For
                        each={() => visibleTasks()}
                        by="id"
                        fallback={
                          <Empty>
                            <EmptyTitle>
                              {feature.query ? "No matching tasks" : "No tasks yet"}
                            </EmptyTitle>
                            <EmptyCopy>
                              {feature.query
                                ? "Try another phrase or search mode."
                                : "Create the first task to start this workspace."}
                            </EmptyCopy>
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
                              {() =>
                                feature.verification?.taskId === task.id ? (
                                  <Verification role="status">
                                    {feature.verification.status === "verifying"
                                      ? "Verifying durable state"
                                      : feature.verification.status === "verified"
                                        ? `Workflow verified revision ${feature.verification.revision}`
                                        : feature.verification.message}
                                  </Verification>
                                ) : null
                              }
                            </TaskBody>
                            <Actions>
                              <Edit type="button" onClick={() => feature.edit({ id: task.id })}>
                                Edit
                              </Edit>
                              <Toggle type="button" onClick={() => feature.toggle({ id: task.id })}>
                                {() => (task.completed ? "Reopen" : "Complete")}
                              </Toggle>
                              {() =>
                                task.completed ? (
                                  <Verify
                                    type="button"
                                    onClick={() => void feature.verify({ id: task.id })}
                                  >
                                    Verify workflow
                                  </Verify>
                                ) : null
                              }
                              <Remove type="button" onClick={() => feature.remove({ id: task.id })}>
                                Delete
                              </Remove>
                            </Actions>
                          </Row>
                        )}
                      </For>
                    </List>
                  </>
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

async function taskMatches(
  tasks: Data.Client<typeof taskData>,
  query: string,
  mode: "text" | "related",
): Promise<readonly string[]> {
  const result = await (
    mode === "text"
      ? tasks.tasks({ text: { value: query, fields: ["title"] } })
      : tasks.tasks({
          vector: { field: "embedding", value: taskEmbedding(query), limit: 20 },
        })
  );
  return result.kind === "rows" ? result.matches.map(({ row }) => row.id) : [];
}

async function taskSummary(tasks: Data.Client<typeof taskData>): Promise<
  Readonly<{
  open: number;
  completed: number;
  }>
> {
  const result = await tasks.tasks({
    analytics: {
      groupBy: ["completed"],
      measures: { count: { count: true } },
    },
  });
  let open = 0;
  let completed = 0;
  if (result.kind === "analytics") {
    for (const group of result.groups) {
      if (group.key.completed === true) completed = group.measures.count ?? 0;
      else if (group.key.completed === false) open = group.measures.count ?? 0;
    }
  }
  return { open, completed };
}
