# Component API

This document is the normative component boundary for Poggers. The generic
component contract is the source of type correctness. Runtime functions exist
only when they perform runtime work; they are not type-safety wrappers.

## Principles

1. A view receives semantic state and callable actions, never statechart
   snapshots, selectors, subscriptions, operation registries, or vendor APIs.
2. Values are values. Actions are functions named with verbs.
3. A component has one reactive state projection. It composes Feature data,
   private machine Context, the active finite phase, operation lifecycle, and
   continuous behavioral signals into the exact state consumed by its view and
   Presets.
4. The machine owns discrete behavior and private Context. State-bound tasks
   are its effect boundary and call semantic Feature APIs.
5. JSX owns hierarchy, accessibility, native platform attributes, listeners,
   composition, and the binding of native input to Actions.
6. A Preset owns every visual decision: tokens, style, responsive conditions,
   motion, gestures, transitions, and visual parameters. It may route a visual
   interaction to a declared Action, but it cannot define or mutate behavior.
7. XState, Alien Signals, Anime.js, StyleX, and browser lifecycle mechanics are
   implementation details behind this contract.

## Public contract

```ts
type App = {
  Components: {
    DocumentEditor: {
      Input: { documentId: string };
      Context: { draftTitle: string; errorMessage: string | undefined };
      Phases: "idle" | "submitting" | "failed";
      State: {
        title: string;
        draftTitle: string;
        collaborators: number;
        connected: boolean;
        canSubmit: boolean;
        submitting: boolean;
        failed: boolean;
        errorMessage: string | undefined;
      };
      Actions: {
        changeTitle(input: { title: string }): void;
        submit(): void;
        retry(): void;
        cancel(): void;
      };
      Tasks: {
        renameDocument: {
          Input: { title: string };
          Output: SubmissionSuccess;
          Error: SubmissionFailure<"conflict">;
        };
      };
      Parts: {
        Root: "section";
        Title: "h1";
        Input: "input";
        Error: "p";
        Save: "button";
      };
    };
  };
  API: {
    readonly documents: {
      get(input: { documentId: string }): {
        readonly title: string;
        readonly collaborators: readonly string[];
        readonly connected: boolean;
        rename(input: { title: string }): Submission<"conflict">;
      };
    };
  };
};
```

`Context` is private machine memory. `Phases` declares the finite lifecycle
vocabulary, `machine.phases` defines it, and `phase` is the current value read
by the state projection. `State` is the public, read-only, reactive model.
`Actions` is the public synchronous input surface. `Parts` is the typed
presentation contract between structure and Presets.

## Definition

```tsx
const components = {
  DocumentEditor: {
    machine: {
      context: { draftTitle: "", errorMessage: undefined },
      initial: "idle",
      phases: {
        idle: {
          on: {
            changeTitle: {
              update: (_scope, { title }) => ({ draftTitle: title }),
            },
            submit: "submitting",
          },
        },
        submitting: {
          task: {
            run: "renameDocument",
            input: ({ context }) => ({ title: context.draftTitle }),
            done: "idle",
            fail: {
              target: "failed",
              update: (_scope, failure) => ({ errorMessage: failure.error }),
            },
          },
        },
        failed: { on: { retry: "submitting", cancel: "idle" } },
      },
      tasks: {
        renameDocument: ({ api, input, value }) =>
          api.documents.get({ documentId: input.documentId }).rename(value),
      },
    },

    state: ({ api, input, context, phase }) => {
      const document = api.documents.get({ documentId: input.documentId });
      const submitting = phase === "submitting";

      return {
        title: document.title,
        draftTitle: context.draftTitle,
        collaborators: document.collaborators.length,
        connected: document.connected,
        canSubmit: context.draftTitle.trim().length > 0 && !submitting,
        submitting,
        failed: phase === "failed",
        errorMessage: context.errorMessage,
      };
    },

    view: ({ state, actions, parts: { Root, Title, Input, Error, Save } }) => (
      <Root aria-busy={state.submitting}>
        <Title>{state.title}</Title>
        <Input
          value={state.draftTitle}
          aria-invalid={state.failed}
          onInput={(event) => actions.changeTitle({ title: event.currentTarget.value })}
        />
        <Error hidden={!state.failed}>{state.errorMessage}</Error>
        <Save disabled={!state.canSubmit} onPointerDown={actions.submit}>
          {state.submitting ? "Saving" : "Save"}
        </Save>
      </Root>
    ),
  },
} satisfies NonNullable<AppDef<App>["components"]>;
```

The state projection is pure and tracked by signals. Its returned object has a
stable identity with reactive property getters. A dependency change updates
only consumers that read the changed property and schedules one internal
machine microstep so eventless transitions observe current state.

## Runtime semantics

- Action functions are generated from the typed machine input contract. Calling
  one synchronously sends an input to the component actor.
- A task may return a normal value, Promise, or reactive `Submission`. A
  Submission remains active while preparing, queued, submitted, or uncertain;
  it completes only when committed and fails only when rejected.
- A timeout is uncertain, never rejection. State stays reconcilable until the
  authority confirms the outcome.
- Continuous behavioral values such as drag position and velocity use signals,
  not statechart transitions per frame. They can be projected into semantic
  State when structure or presentation needs them.
- Actions and State are stable for the component lifetime. Every subscription,
  task, native listener, and continuous value is disposed with that instance.

## Preset boundary

Preset component factories receive the same semantic State shape as typed,
reactive visual expressions. Boolean State becomes a condition, numeric State
becomes an interpolatable expression, and other values remain typed symbolic
expressions. Presets also receive symbolic Action and Part references plus
interaction, geometry, and environment conditions. They do not receive Context,
raw statechart snapshots, Feature APIs, or callable Actions.

```ts
DocumentEditor: ({ state, interaction }) => ({
  Root: [normalSurface, { when: state.failed, paint: { stroke: tokens.stroke.invalid } }],
  Input: { paint: { opacity: state.submitting.choose(0.7, 1) } },
  Save: createControl({
    hovered: interaction.hovered,
    pressed: interaction.pressed,
    disabled: state.canSubmit.not(),
  }),
});
```

Preset factories can create reusable recipes and retained motion once in their
closure. A component factory can return visual parameters consumed by its
machine, and can declare gesture coordination using symbolic Parts, writable
State channels, and Actions. This keeps thresholds, springs, responsive motion,
and feel entirely Preset-owned while behavior remains declared by the component.

## Resource lifecycle

Durable commands return a stable, reactive `Submission`. It moves through
`preparing`, `queued`, `submitted`, `uncertain`, `committed`, or `rejected`.
`await submission` settles only for committed or rejected outcomes; a timeout
or transport loss is uncertain, not rejection. Components project the semantic
parts of that lifecycle into State when the UI needs them.

Presence is not a durable command. A Resource that declares JSON `Presence`
gets `setPresence(value)`, a synchronous full replacement scoped to one
Resource key and connection session. Views can derive semantic reads from the
scope's sessions. The client updates its own session immediately, coalesces
rapid replacements, republishes the latest desired value after reconnect, and
removes it on disconnect or authorization loss. Feature APIs should wrap this
primitive with product verbs such as `inspect`, `beginStreaming`, or
`setCursor`.

## Composition

Views may render local Components, Feature Components, slots, and Parts. Those
composition handles remain explicit because they describe hierarchy, but they
do not expose behavior internals. The complete view scope is:

```ts
view({ state, actions, slots, parts: { Root }, components: { Child }, features: { notes } }) {}
```

`parts`, `components`, and `features` are lowercase namespaces and must be
destructured at the view parameter. Their renderable members are uppercase.
`state`, `actions`, and `slots` are values and may be read directly.

Local composition passes typed input and slots like ordinary JSX:

```tsx
view({ state, components: { NoteRow }, parts: { Root } }) {
  return (
    <Root>
      <NoteRow noteId={state.selectedId} icon={<SearchIcon />} />
    </Root>
  );
}
```

Feature composition is namespaced, so independently reusable Features cannot
collide:

```tsx
view({ features: { notes, auth }, parts: { Root } }) {
  return <Root><auth.Account /><notes.NoteList /></Root>;
}
```

## Feature, dependency, and Program boundary

A Feature is one vertical slice. Its generic contract declares Resources,
dependencies by environment, Programs, Components, child Features, and the
curated semantic API. The definition implements that contract directly.

```tsx
type NotesFeature = {
  Resources: {
    notes: {
      Key: { ownerId: string };
      State: { notes: Array<{ id: string; title: string }> };
      Events: { added: { id: string; title: string } };
      Views: { notes: readonly { id: string; title: string }[] };
      Commands: {
        add: { Input: { title: string }; Event: "added"; Error: "empty" };
      };
    };
  };
  Dependencies: {
    server: { notifications: { send(input: { title: string }): Promise<void> } };
  };
  Programs: "server";
  Components: {
    NoteRow: {
      Input: { id: string; title: string };
      Slots: { icon?: Child };
      State: { id: string; title: string };
      Parts: { Root: "li"; Title: "span" };
    };
    NoteList: {
      State: { notes: readonly { id: string; title: string }[] };
      Parts: { Root: "ul" };
    };
  };
  API: {
    readonly notes: readonly { id: string; title: string }[];
    add(input: { title: string }): Submission<"empty">;
  };
};

const notesFeature = {
  resources: {
    notes: {
      state: { notes: [] },
      events: {
        added({ state, payload }) {
          state.notes.push(payload);
        },
      },
      views: { notes: ({ state }) => state.notes },
      commands: {
        add(context, { title }) {
          const value = title.trim();
          if (!value) return context.error("empty");
          context.event.added({ id: context.id(), title: value });
        },
      },
    },
  },
  dependencies: {
    server: { notifications: productionNotifications },
  },
  api: ({ actor, resources }) => {
    const notes = resources.notes({ ownerId: actor.id });
    return {
      get notes() {
        return notes.notes;
      },
      add: notes.add,
    };
  },
  programs: {
    server({ consume, signal }, { notifications }) {
      consume("notes.added", { id: "notes.notify", signal }, async ({ event }) => {
        await notifications.send({ title: event.payload.title });
      });
    },
  },
  components: {
    NoteRow: {
      state: ({ input }) => ({ id: input.id, title: input.title }),
      view({ state, slots, parts: { Root, Title } }) {
        return (
          <Root data-note-id={state.id}>
            {slots.icon}
            <Title>{state.title}</Title>
          </Root>
        );
      },
    },
    NoteList: {
      state: ({ api }) => ({ notes: api.notes }),
      view({ state, components: { NoteRow }, parts: { Root } }) {
        return (
          <Root>
            <For each={state.notes} by="id">
              {(note) => <NoteRow {...note} />}
            </For>
          </Root>
        );
      },
    },
  },
} satisfies FeatureDef<App, NotesFeature>;
```

The Program receives two arguments. The first is its typed runtime context:
the Feature's semantic `api`, semantic Resource hooks such as `useNotes`,
durable `consume`, the current `actor`, and its lifecycle `signal`. The second
contains only the dependencies declared for that environment. Components do
not receive those dependencies; they consume the Feature API. Tests replace
dependencies at Feature startup without changing product code.

## Deliberately absent

The public Component surface has no `select`, `data`, `events`, `values`,
`computeValues`, `state.matches`, `state.can`, `subscribe`, or raw machine
snapshot. There is one semantic state projection and one action surface.
