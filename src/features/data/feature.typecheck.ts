import { createSystem } from "@/core/system";
import { type Data, createData } from "@/features/data";
import { createIdentity, type IdentityModel } from "@/features/identity";

type Principal = Readonly<{
  id: string;
  organization: string;
  roles: readonly ("operator" | "viewer")[];
}>;

type Users = IdentityModel<{
  Name: "identity";
  Version: 1;
  Principal: Principal;
}>;

type TaskV1 = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  completed: boolean;
  embedding: readonly number[];
}>;

export const identity = createIdentity<Users>({
  principal(user) {
    return {
      id: user.id,
      organization: "company-1",
      roles: ["operator"],
    };
  },
});

export type Tasks = Data<{
  Name: "tasks";
  Version: 2;
  Identity: Users;
  Record: Readonly<{
    id: string;
    ownerId: string;
    title: string;
    completed: boolean;
    embedding: readonly number[];
  }>;
  Commands: {
    create: Data.Command<
      Readonly<{ id: string; title: string }>,
      Readonly<{ created: true }>,
      { alreadyExists: Record<never, never> }
    >;
    toggle: Data.Command<Readonly<{ id: string }>>;
  };
  Events: {
    created: Data.Event<
      2,
      Readonly<{ ownerId: string; title: string; embedding: readonly number[] }>,
      {
        1: Readonly<{ ownerId: string; name: string; embedding: readonly number[] }>;
      }
    >;
    toggled: Data.Event<1, Record<never, never>>;
  };
  Queries: {
    Text: "title";
    Vector: { Field: "embedding"; Dimensions: 3 };
    Analytics: true;
  };
  History: {
    1: Data.History<
      TaskV1,
      {
        create: Readonly<{ id: string; name: string }>;
      }
    >;
  };
}>;

export const tasksDefinition = {
  state({ key }) {
    return {
      id: key,
      ownerId: "",
      title: "",
      completed: false,
      embedding: [0, 0, 0],
    };
  },
  commands: {
    create({ state, input, principal, fail }) {
      if (state.ownerId !== "") fail({ type: "alreadyExists", data: {} });
      return {
        events: [
          {
            created: {
              ownerId: principal.id,
              title: input.title,
              embedding: [1, 0, 0],
            },
          },
        ],
        result: { created: true },
      };
    },
    toggle() {
      return {
        events: [{ toggled: {} }],
        result: {},
      };
    },
  },
  events: {
    created: {
      migrate: {
        1(event) {
          return {
            ownerId: event.ownerId,
            title: event.name,
            embedding: event.embedding,
          };
        },
      },
      apply({ state, event }) {
        return { ...state, ...event };
      },
    },
    toggled: {
      apply({ state }) {
        return { ...state, completed: !state.completed };
      },
    },
  },
  authorize: {
    read({ state, principal }) {
      return state.ownerId === "" || state.ownerId === principal.id;
    },
    create() {
      return true;
    },
    toggle({ state, principal }) {
      return state.ownerId === principal.id;
    },
    query({ principal }) {
      return { where: { ownerId: { equal: principal.id } } };
    },
  },
  migrate: {
    1: {
      record(record) {
        return {
          id: record.id,
          ownerId: record.ownerId,
          title: record.name,
          completed: record.completed,
          embedding: record.embedding,
        };
      },
      commands: {
        create(input) {
          return {
            command: "create",
            input: {
              id: input.id,
              title: input.name,
            },
          };
        },
      },
    },
  },
} satisfies Data.Definition<Tasks>;

export const tasks = createData<Tasks>(tasksDefinition);

function checkClient(client: Data.Client<typeof tasks>): void {
  client.tasks({ text: { value: "important", fields: ["title"] } });
  client.create({ id: "task-1", title: "Important" });
  client.toggle({ id: "task-1" });
  // @ts-expect-error Commands retain their semantic input.
  client.create({ id: "task-2", title: 42 });
  // @ts-expect-error Query capabilities expose only declared fields.
  client.tasks({ text: { value: "owner", fields: ["ownerId"] } });
}

function checkAuthority(authority: Data.Authority<typeof tasks>, principal: Principal): void {
  authority.get({ key: "task-1", principal }).toggle({ id: "task-1" });
}

void checkClient;
void checkAuthority;

export default createSystem({
  features: { identity, tasks },
});
