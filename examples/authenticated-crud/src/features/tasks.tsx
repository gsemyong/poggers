import {
  createEntity,
  type EntityFeature,
  type EntityModel,
  type Feature,
  placePrograms,
  type PlacedFeature,
  type Program,
} from "@poggers/kit";
import { For, type BrowserMainThread, type Navigation } from "@poggers/kit/web";

import type { App } from "../app";
import type { User } from "./identity";

export type Task = Readonly<{
  id: string;
  ownerId: string;
  title: string;
  completed: boolean;
}>;

export type Tasks = EntityModel<{
  Name: "tasks";
  Principal: User;
  Value: Task;
  Create: Readonly<{ title: string }>;
  Update: Readonly<{ title?: string; completed?: boolean }>;
  Filter: Readonly<{ completed?: boolean }>;
}>;

export type TaskDestination =
  | Readonly<{ name: "list" }>
  | Readonly<{ name: "create" }>
  | Readonly<{ name: "edit"; id: string }>;

type TasksBrowser = Program<
  BrowserMainThread,
  {
    Requires: { navigation: Navigation };
    State: {
      destination: TaskDestination;
      title: string;
      error: string | undefined;
    };
    Actions: {
      navigate(input: { destination: TaskDestination }): void;
      create(): void;
      edit(input: { id: string }): void;
      back(): void;
      changeTitle(input: { title: string }): void;
      save(): void;
      toggle(input: { id: string; completed: boolean }): void;
      remove(input: { id: string }): void;
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

type LogicalTasksFeature = Readonly<{
  Features: {
    tasks: PlacedFeature<EntityFeature<Tasks>, { server: "api"; browser: "browser" }>;
  };
  Programs: { browser: TasksBrowser };
}>;

export type TasksFeature = LogicalTasksFeature;

export const taskEntity = createEntity<Tasks>({
  name: "tasks",
  create: (value) => ({
    id: value.id,
    ownerId: value.principal.id,
    title: value.input.title,
    completed: false,
  }),
  update: (value) => ({
    id: value.previous.id,
    ownerId: value.previous.ownerId,
    title: value.input.title ?? value.previous.title,
    completed: value.input.completed ?? value.previous.completed,
  }),
  authorize: (value) => value.principal.id === value.entity.ownerId,
});

const placedTaskEntity = placePrograms(taskEntity, { server: "api", browser: "browser" });

const logicalTasks: Feature<LogicalTasksFeature, App> = {
  features: { tasks: placedTaskEntity },
  programs: {
    browser: {
      state: {
        destination: { name: "list" },
        title: "",
        error: undefined,
      },
      actions: {
        navigate({ features, state }, { destination }) {
          state.destination = destination;
          state.title =
            destination.name === "edit"
              ? (features.tasks.entities.find((task) => task.id === destination.id)?.title ?? "")
              : "";
        },
        create({ capabilities }) {
          capabilities.navigation.navigate({ path: destinationUrl({ name: "create" }) });
        },
        edit({ capabilities }, { id }) {
          capabilities.navigation.navigate({ path: destinationUrl({ name: "edit", id }) });
        },
        back({ capabilities }) {
          capabilities.navigation.navigate({ path: destinationUrl({ name: "list" }) });
        },
        changeTitle({ state }, { title }) {
          state.title = title;
        },
        save({ capabilities, features, state }) {
          const title = state.title.trim();
          if (!title) return;
          state.error = undefined;
          try {
            if (state.destination.name === "edit") {
              features.tasks.update({ id: state.destination.id, changes: { title } });
            } else {
              features.tasks.create({ title });
            }
            capabilities.navigation.navigate({ path: destinationUrl({ name: "list" }) });
          } catch (error) {
            state.error = message(error);
          }
        },
        toggle({ features, state }, { id, completed }) {
          try {
            features.tasks.update({ id, changes: { completed } });
          } catch (error) {
            state.error = message(error);
          }
        },
        remove({ features, state }, { id }) {
          try {
            features.tasks.remove({ id });
          } catch (error) {
            state.error = message(error);
          }
        },
      },
      components: {
        Admin: {
          mount({ capabilities, feature }) {
            feature.navigate({
              destination: parseDestination(capabilities.navigation.current().pathname),
            });
            return capabilities.navigation.subscribe((location) =>
              feature.navigate({ destination: parseDestination(location.pathname) }),
            );
          },
          view({ feature, features: { tasks }, elements }) {
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
                    feature.error ??
                    tasks.mutations.find(({ status }) => status === "rejected")?.error ??
                    (tasks.synchronization === "loading"
                      ? "Restoring tasks"
                      : tasks.synchronization === "offline"
                        ? `Offline · ${tasks.mutations.filter(({ status }) => status === "pending").length} queued`
                        : tasks.synchronization === "synchronizing"
                          ? "Synchronizing changes"
                          : `${tasks.entities.length} ${tasks.entities.length === 1 ? "task" : "tasks"}`)
                  }
                </Status>
                {() =>
                  feature.destination.name === "list" ? (
                    tasks.entities.length ? (
                      <List>
                        <For each={() => tasks.entities} by="id">
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
                        <Save type="submit">Save task</Save>
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
};

export const tasks = logicalTasks;

const taskPath = "/tasks";

function parseDestination(pathname: string): TaskDestination {
  const normalized = pathname.replace(/\/$/, "") || "/";
  if (normalized === `${taskPath}/new`) return { name: "create" };
  if (normalized.startsWith(`${taskPath}/`)) {
    const id = decodeURIComponent(normalized.slice(taskPath.length + 1));
    if (id) return { name: "edit", id };
  }
  return { name: "list" };
}

function destinationUrl(destination: TaskDestination): string {
  if (destination.name === "create") return `${taskPath}/new`;
  if (destination.name === "edit") return `${taskPath}/${encodeURIComponent(destination.id)}`;
  return taskPath;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
