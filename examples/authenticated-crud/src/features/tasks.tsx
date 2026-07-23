import {
  createEntity,
  type EntityModel,
  type FeatureContractOf,
  placePrograms,
  type Program,
} from "@duction/kit";
import {
  For,
  type BrowserMainThread,
  type MountedWebFeature,
  type Navigation,
  type Validate,
  type WebDestination,
  type WebFeature,
  type WebRoute,
  mountFeature,
} from "@duction/kit/web";

import type { WorkspaceWeb } from "../apps/web";
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

type TaskRoutes = {
  list: WebRoute<{
    Path: "";
    Metadata: {
      Title: "Tasks";
      Description: "Manage workspace tasks";
      Robots: "noindex";
    };
  }>;
  create: WebRoute<{
    Path: "new";
    Metadata: { Title: "New task"; Robots: "noindex" };
  }>;
  edit: WebRoute<{
    Path: ":id";
    Metadata: { Title: "Edit task"; Robots: "noindex" };
    Params: { id: Validate<string, { Format: "uuid" }> };
  }>;
};

export type TaskDestination = WebDestination<TaskRoutes>;

type TasksBrowser = Program<
  BrowserMainThread,
  {
    Requires: { navigation: Navigation<TaskRoutes, WorkspaceWeb> };
    State: {
      error: string | undefined;
    };
    Actions: {
      create(): void;
      edit(input: { id: string }): void;
      back(): void;
      save(input: { destination: TaskDestination; title: string }): void;
      toggle(input: { id: string; completed: boolean }): void;
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
  }
>;

type TasksFeatureDefinition = Readonly<{
  Features: { tasks: FeatureContractOf<typeof taskBrowser> };
  Programs: { browser: TasksBrowser };
}>;

export type TasksFeature = MountedWebFeature<TasksFeatureDefinition, "tasks">;

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

export const taskServer = placePrograms(taskEntity.server, { server: "api" });
const taskBrowser = placePrograms(taskEntity.browser, { browser: "browser" });

const taskFeature: WebFeature<TasksFeatureDefinition, WorkspaceWeb> = {
  features: { tasks: taskBrowser },
  programs: {
    browser: {
      state: { error: undefined },
      actions: {
        create({ dependencies }) {
          dependencies.navigation.navigate({ to: "create" });
        },
        edit({ dependencies }, { id }) {
          dependencies.navigation.navigate({ to: "edit", params: { id } });
        },
        back({ dependencies }) {
          dependencies.navigation.navigate({ to: "list" });
        },
        save({ dependencies, features, state }, { destination, title: inputTitle }) {
          const title = inputTitle.trim();
          if (!title) return;
          state.error = undefined;
          try {
            if (destination.to === "edit") {
              features.tasks.update({ id: destination.params.id, changes: { title } });
            } else {
              features.tasks.create({ title });
            }
            dependencies.navigation.navigate({ to: "list" });
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
          state: { title: undefined },
          actions: {
            changeTitle({ state }, { title }) {
              state.title = title;
            },
          },
          view({ feature, features: { tasks }, elements, props, state, actions }) {
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
            const title = () => {
              const destination = props.destination;
              return (
                state.title ??
                (destination.to === "edit"
                  ? (tasks.entities.find((task) => task.id === destination.params.id)?.title ?? "")
                  : "")
              );
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
                    props.destination.to === "list" ? (
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
                  props.destination.to === "list" ? (
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
                        void feature.save({
                          destination: props.destination,
                          title: title(),
                        });
                      }}
                    >
                      <FormHeader>
                        <Eyebrow>{props.destination.to === "edit" ? "Edit" : "New"}</Eyebrow>
                        <FormTitle>
                          {props.destination.to === "edit" ? "Update task" : "Create task"}
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
                }
              </Root>
            );
          },
        },
      },
      routes: {
        list: {
          view({ components: { Shell, Tasks } }) {
            return <Shell.Layout Content={<Tasks.Admin destination={{ to: "list" }} />} />;
          },
        },
        create: {
          view({ components: { Shell, Tasks } }) {
            return <Shell.Layout Content={<Tasks.Admin destination={{ to: "create" }} />} />;
          },
        },
        edit: {
          view({ components: { Shell, Tasks }, params }) {
            return (
              <Shell.Layout
                Content={<Tasks.Admin destination={{ to: "edit", params: { id: params.id } }} />}
              />
            );
          },
        },
      },
    },
  },
};

export const tasks = mountFeature(taskFeature, { path: "tasks" });

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
