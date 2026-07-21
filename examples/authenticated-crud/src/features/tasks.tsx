import {
  defineEntityFeature,
  EntityFailure,
  type EntityClient,
  type EntityFeature,
  type EntityService,
  type EntitySnapshot,
  type Feature,
  type Program,
} from "@poggers/kit";
import { For, type BrowserMainThread } from "@poggers/kit/web";

import type { App } from "../app";
import type { CookieCredentials, User } from "./identity";

export type Task = Readonly<{
  id: string;
  ownerId: string;
  title: string;
  completed: boolean;
}>;

export type Tasks = Readonly<{
  Name: "tasks";
  Credentials: CookieCredentials;
  Principal: User;
  Entity: Task;
  Create: Readonly<{ title: string }>;
  Update: Readonly<{ title?: string; completed?: boolean }>;
  Query: Readonly<{ completed?: boolean }>;
}>;

export type TaskDestination =
  | Readonly<{ name: "list" }>
  | Readonly<{ name: "create" }>
  | Readonly<{ name: "edit"; id: string }>;

export type TaskNavigation = Readonly<{
  current(): TaskDestination;
  navigate(input: { destination: TaskDestination; replace?: boolean }): void;
  subscribe(receive: (destination: TaskDestination) => void): Disposable;
}>;

type TasksBrowser = Program<
  BrowserMainThread,
  {
    Requires: { tasks: EntityClient<Tasks>; navigation: TaskNavigation };
    State: {
      tasks: readonly Task[];
      revision: number;
      destination: TaskDestination;
      title: string;
      status: "loading" | "ready" | "saving" | "failed";
      error: string | undefined;
    };
    Actions: {
      receive(input: { snapshot: EntitySnapshot<Task> }): void;
      fail(input: { error: unknown }): void;
      navigate(input: { destination: TaskDestination }): void;
      create(): void;
      edit(input: { id: string }): void;
      back(): void;
      changeTitle(input: { title: string }): void;
      save(): Promise<void>;
      toggle(input: { id: string; completed: boolean }): Promise<void>;
      remove(input: { id: string }): Promise<void>;
    };
    Components: {
      Admin: {
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
  }
>;

export type TasksFeature = Readonly<{
  Programs: EntityFeature<Tasks>["Programs"] & { browser: TasksBrowser };
}>;

export const createTasks = defineEntityFeature<Tasks>({
  name: "tasks",
  create: ({ id, principal, value }) => ({
    id,
    ownerId: principal.id,
    title: value.title,
    completed: false,
  }),
  update: ({ previous, value }) => ({ ...previous, ...value }),
  authorize: ({ principal, entity }) => principal.id === entity.ownerId,
  matches: ({ entity, query }) =>
    query.completed === undefined || entity.completed === query.completed,
});

const server = createTasks();

export const tasks = {
  programs: {
    server: server.programs.server,
    browser: {
      state: {
        tasks: [],
        revision: 0,
        destination: { name: "list" },
        title: "",
        status: "loading",
        error: undefined,
      },
      actions: {
        receive({ state }, { snapshot }) {
          state.tasks = snapshot.entities;
          state.revision = snapshot.revision;
          state.status = "ready";
          state.error = undefined;
          const destination = state.destination;
          if (destination.name === "edit") {
            state.title = snapshot.entities.find((task) => task.id === destination.id)?.title ?? "";
          }
        },
        fail({ state }, { error }) {
          state.status = "failed";
          state.error = message(error);
        },
        navigate({ state }, { destination }) {
          state.destination = destination;
          state.title =
            destination.name === "edit"
              ? (state.tasks.find((task) => task.id === destination.id)?.title ?? "")
              : "";
        },
        create({ capabilities }) {
          capabilities.navigation.navigate({ destination: { name: "create" } });
        },
        edit({ capabilities }, { id }) {
          capabilities.navigation.navigate({ destination: { name: "edit", id } });
        },
        back({ capabilities }) {
          capabilities.navigation.navigate({ destination: { name: "list" } });
        },
        changeTitle({ state }, { title }) {
          state.title = title;
        },
        async save({ capabilities, state }) {
          const title = state.title.trim();
          if (!title) return;
          state.status = "saving";
          state.error = undefined;
          try {
            if (state.destination.name === "edit") {
              await capabilities.tasks.update({
                id: state.destination.id,
                value: { title },
              });
            } else {
              await capabilities.tasks.create({ value: { title } });
            }
            capabilities.navigation.navigate({ destination: { name: "list" } });
          } catch (error) {
            state.status = "failed";
            state.error = message(error);
          }
        },
        async toggle({ capabilities, state }, { id, completed }) {
          state.status = "saving";
          try {
            await capabilities.tasks.update({ id, value: { completed } });
          } catch (error) {
            state.status = "failed";
            state.error = message(error);
          }
        },
        async remove({ capabilities, state }, { id }) {
          state.status = "saving";
          try {
            await capabilities.tasks.remove({ id });
          } catch (error) {
            state.status = "failed";
            state.error = message(error);
          }
        },
      },
      components: {
        Admin: {
          mount({ capabilities, feature }) {
            return mountAdmin(capabilities, feature.receive, feature.navigate, feature.fail);
          },
          view({ feature, elements }) {
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
            return (
              <Root aria-label="Task administration">
                <Header>
                  <Heading>
                    <Eyebrow>Workspace</Eyebrow>
                    <Title>Tasks</Title>
                    <Copy>Plan the work, keep it moving, and close the loop.</Copy>
                  </Heading>
                  {() =>
                    feature.destination.name === "list" ? (
                      <New type="button" onClick={() => feature.create()}>
                        New task
                      </New>
                    ) : null
                  }
                </Header>
                <Status role="status">
                  {() =>
                    feature.status === "failed"
                      ? (feature.error ?? "Something went wrong")
                      : feature.status === "loading"
                        ? "Loading tasks"
                        : feature.status === "saving"
                          ? "Saving changes"
                          : `${feature.tasks.length} ${feature.tasks.length === 1 ? "task" : "tasks"}`
                  }
                </Status>
                {() =>
                  feature.destination.name === "list" ? (
                    feature.tasks.length ? (
                      <List>
                        <For each={() => feature.tasks} by="id">
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
                                <Toggle
                                  type="button"
                                  onClick={() =>
                                    feature.toggle({ id: task.id, completed: !task.completed })
                                  }
                                >
                                  {() => (task.completed ? "Reopen" : "Complete")}
                                </Toggle>
                                <Remove
                                  type="button"
                                  onClick={() => feature.remove({ id: task.id })}
                                >
                                  Delete
                                </Remove>
                              </Actions>
                            </Row>
                          )}
                        </For>
                      </List>
                    ) : (
                      <Empty>
                        <EmptyTitle>No tasks yet</EmptyTitle>
                        <EmptyCopy>Create the first task to start this workspace.</EmptyCopy>
                      </Empty>
                    )
                  ) : (
                    <Form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void feature.save();
                      }}
                    >
                      <FormHeader>
                        <Eyebrow>
                          {() => (feature.destination.name === "edit" ? "Edit" : "New")}
                        </Eyebrow>
                        <FormTitle>
                          {() =>
                            feature.destination.name === "edit" ? "Update task" : "Create task"
                          }
                        </FormTitle>
                      </FormHeader>
                      <Label for="task-title">Task title</Label>
                      <Input
                        id="task-title"
                        name="title"
                        autofocus
                        value={() => feature.title}
                        onInput={(event) =>
                          feature.changeTitle({ title: event.currentTarget.value })
                        }
                      />
                      <FormActions>
                        <Save type="submit" disabled={() => feature.status === "saving"}>
                          Save task
                        </Save>
                        <Back type="button" onClick={() => feature.back()}>
                          Cancel
                        </Back>
                      </FormActions>
                    </Form>
                  )
                }
              </Root>
            );
          },
        },
      },
    },
  },
} satisfies Feature<TasksFeature, App>;

async function mountAdmin(
  capabilities: { tasks: EntityClient<Tasks>; navigation: TaskNavigation },
  receive: (input: { snapshot: EntitySnapshot<Task> }) => void,
  navigate: (input: { destination: TaskDestination }) => void,
  fail: (input: { error: unknown }) => void,
): Promise<AsyncDisposable> {
  navigate({ destination: capabilities.navigation.current() });
  const navigation = capabilities.navigation.subscribe((destination) => navigate({ destination }));
  const iterator = capabilities.tasks.changes()[Symbol.asyncIterator]();
  let active = true;
  const running = (async () => {
    try {
      while (active) {
        const next = await iterator.next();
        if (next.done || !active) break;
        receive({ snapshot: next.value });
      }
    } catch (error) {
      if (active) fail({ error });
    }
  })();
  return {
    async [Symbol.asyncDispose]() {
      active = false;
      navigation[Symbol.dispose]();
      await iterator.return?.();
      await running;
    },
  };
}

export function handleTasks(
  service: EntityService<Tasks>,
  credentials: (request: Request) => CookieCredentials,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      const path = "/api/tasks";
      const query = parseQuery(url.searchParams.get("query"));
      const requestCredentials = credentials(request);
      if (url.pathname === `${path}/changes` && request.method === "GET") {
        return stream(service.changes({ credentials: requestCredentials, query }));
      }
      if (url.pathname === path && request.method === "GET") {
        return Response.json(await service.list({ credentials: requestCredentials, query }));
      }
      if (url.pathname === path && request.method === "POST") {
        const body = (await request.json()) as { value: Tasks["Create"] };
        return Response.json(
          await service.create({ credentials: requestCredentials, value: body.value }),
          {
            status: 201,
          },
        );
      }
      const prefix = `${path}/`;
      if (!url.pathname.startsWith(prefix))
        return Response.json({ message: "Not found." }, { status: 404 });
      const id = decodeURIComponent(url.pathname.slice(prefix.length));
      if (request.method === "GET")
        return Response.json(await service.get({ credentials: requestCredentials, id }));
      if (request.method === "PATCH") {
        const body = (await request.json()) as { value: Tasks["Update"] };
        return Response.json(
          await service.update({ credentials: requestCredentials, id, value: body.value }),
        );
      }
      if (request.method === "DELETE")
        return Response.json(await service.remove({ credentials: requestCredentials, id }));
      return Response.json({ message: "Method not allowed." }, { status: 405 });
    } catch (error) {
      return failure(error);
    }
  };
}

export function createTasksClient(origin: string): EntityClient<Tasks> {
  const endpoint = new URL("/api/tasks", origin).href;
  return Object.freeze({
    list: (input = {}) => request(`${endpoint}${query(input.query)}`),
    get: ({ id }) => request(`${endpoint}/${encodeURIComponent(id)}`),
    create: ({ value }) => request(endpoint, { method: "POST", body: JSON.stringify({ value }) }),
    update: ({ id, value }) =>
      request(`${endpoint}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      }),
    remove: ({ id }) => request(`${endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" }),
    changes: (input = {}) => readStream(`${endpoint}/changes${query(input.query)}`),
  });
}

function stream(source: AsyncIterable<EntitySnapshot<Task>>): Response {
  const iterator = source[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    }),
    {
      headers: {
        "cache-control": "no-cache, no-transform",
        "content-type": "application/x-ndjson",
      },
    },
  );
}

function readStream(url: string): AsyncIterable<EntitySnapshot<Task>> {
  return {
    async *[Symbol.asyncIterator]() {
      const controller = new AbortController();
      const response = await fetch(url, { credentials: "include", signal: controller.signal });
      await assertResponse(response);
      if (!response.body) throw new Error("The task stream returned no body.");
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = "";
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          buffered += next.value;
          let newline = buffered.indexOf("\n");
          while (newline >= 0) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            if (line) yield JSON.parse(line) as EntitySnapshot<Task>;
            newline = buffered.indexOf("\n");
          }
        }
      } finally {
        controller.abort();
        await reader.cancel().catch(() => undefined);
      }
    },
  };
}

async function request<Value>(url: string, init: RequestInit = {}): Promise<Value> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
  });
  await assertResponse(response);
  return (await response.json()) as Value;
}

async function assertResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as {
    code?: EntityFailure["code"];
    message?: string;
    details?: Readonly<Record<string, unknown>>;
  };
  if (body.code) throw new EntityFailure(body.code, body.message ?? body.code, body.details);
  throw new Error(body.message ?? `Request failed with status ${response.status}.`);
}

function failure(error: unknown): Response {
  if (error instanceof EntityFailure) {
    const status =
      error.code === "unauthenticated"
        ? 401
        : error.code === "forbidden"
          ? 403
          : error.code === "not-found"
            ? 404
            : 409;
    return Response.json(
      { code: error.code, message: error.message, details: error.details },
      { status },
    );
  }
  return Response.json({ message: message(error) }, { status: 500 });
}

function query(value: unknown): string {
  return value === undefined ? "" : `?query=${encodeURIComponent(JSON.stringify(value))}`;
}

function parseQuery(value: string | null): Tasks["Query"] | undefined {
  return value === null ? undefined : (JSON.parse(value) as Tasks["Query"]);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
