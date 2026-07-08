# Poggers Kit Architecture

Poggers Kit is a small Bun framework for local, event-sourced personal applications.

The default application surface is strict:

```text
types.ts      generic app spec and shared domain types
app.tsx       default export from defineApp<Spec>({...})
components/   app-specific design system, screens, and widgets
helpers/      dependency factories, adapters, parsers, ids, clocks
```

New apps should use the strict shape. Versioned API folders can still be used for migrations when an app grows, but the public app authoring surface is the generic `App` type plus `defineApp<App>(...)`.

## Workspace

```text
packages/
  kit/              framework runtime, CLI, JSX UI runtime, program runtime, store adapters
  create-poggers/   initializer for bunx/create-style usage

apps/
  chat/             dogfood chat app
  site/             dogfood docs site
```

Apps import the same package paths external users import:

```ts
import { defineApp } from "@poggers/kit";
import { render } from "@poggers/kit/ui";
```

## Core Concepts

| Primitive  | Meaning                                                 |
| ---------- | ------------------------------------------------------- |
| `app`      | Product API defined with `defineApp()`                  |
| `resource` | Scoped owner of state, events, views, and commands      |
| `view`     | Typed live projection of resource state                 |
| `command`  | Typed mutation that emits events                        |
| `event`    | Immutable mutation scoped to one resource instance      |
| `scope`    | Stable id from `resource + key`                         |
| `snapshot` | `{ version, seq, data }` full-state checkpoint          |
| `tail`     | Events newer than the compacted snapshot/program cursor |
| `cursor`   | Per-scope sync position                                 |

## App Definition

`types.ts` owns the generic app spec:

```ts
export type App = {
  Resources: {
    note: {
      Key: { noteId: string };
      State: { title: string };
      Events: { renamed: { title: string } };
      Views: { title: string };
      Commands: {
        rename: {
          args: [title: string];
          event: "renamed";
          error: never;
        };
      };
    };
  };

  Environments: {
    server: {
      Deps: { logger: { write(message: string): Promise<void> } };
    };
  };

  Navigation: {
    home: {};
    note: { noteId: string };
  };

  Components: {
    NoteEditor: {
      State: {
        title: string;
      };
      Derived: {
        canSave: boolean;
      };
      Actions: {
        change(title: string): void;
        save(): void;
      };
      Parts: {
        Root: "form";
        Input: "input";
        Save: "button";
      };
    };
  };

  Styles: {
    Presets: "system" | "dense";
  };
};
```

`app.tsx` owns resource handlers, PWA metadata, navigation, programs, and root UI composition. Server-only dependencies live in root `deps.ts` so they do not enter the app `src` type graph:

```tsx
import { defineApp } from "@poggers/kit";
import { NoteScreen } from "./components/note-screen";
import type { App } from "./types";

export default defineApp<App>({
  version: 1,

  app: {
    name: "Notes",
  },

  pwa: {
    name: "Notes",
    shortName: "Notes",
    themeColor: "#0f172a",
    backgroundColor: "#ffffff",
    display: "standalone",
  },

  navigation: {
    home: "/",
    note: "/notes/:noteId",
  },

  resources: {
    note: {
      state: { title: "" },
      events: {
        renamed({ state, payload }) {
          state.title = payload.title;
        },
      },
      views: {
        title({ state }) {
          return state.title;
        },
      },
      commands: {
        rename(ctx, title) {
          ctx.event.renamed({ title });
        },
      },
    },
  },

  programs: {
    async server({ events }, deps) {
      for await (const { event } of events("note.renamed", { id: "note.log-renames" })) {
        await deps.logger.write(event.payload.title);
      }
    },
  },

  components: {
    NoteEditor({ state, derived, actions }) {
      return {
        Root: {
          onSubmit(event) {
            event.preventDefault();
            actions.save();
          },
        },
        Input: {
          value: state.title,
          onInput(event) {
            actions.change(event.currentTarget.value);
          },
        },
        Save: {
          type: "submit",
          disabled: !derived.canSave,
        },
      };
    },
  },

  ui() {
    return <NoteScreen />;
  },
});
```

For local apps, `Actor` and `identify` are optional. The default actor is `{ id: token || "local" }`.

## UI

Application UI imports generated functions directly from `@poggers/app`.

The native JSX runtime uses fine-grained signals internally. App code can pass signals directly to dynamic JSX children and attributes, or read them with calls like `note.title()`.

Resources generate `useX` functions. Components generate `createX` functions. Style-only components need no controller. DOM event details stay in `defineApp.components` only when a component needs behavior; app UI renders generated component parts:

```tsx
import { createNoteEditor, useNote, useScreen } from "@poggers/app";

export function NoteScreen() {
  const screen = useScreen();
  const noteId = screen.name === "note" ? screen.params.noteId : "main";
  const note = useNote({ noteId });
  const Editor = createNoteEditor({
    state: { title: note.title() },
    derived({ state }) {
      return {
        get canSave() {
          return state.title.trim().length > 0;
        },
      };
    },
    actions({ state }) {
      return {
        change(title) {
          state.title = title;
        },
        save() {
          const title = state.title.trim();
          if (!title) return;
          void note.rename(title);
        },
      };
    },
  });

  return (
    <Editor.Root>
      <Editor.Input />
      <Editor.Save>Save</Editor.Save>
    </Editor.Root>
  );
}
```

There are no style-only UI selectors and no tautological part controllers. If something is renderable, it belongs under `App["Components"]` and is created with `createX`; `defineApp.components` only supplies extra DOM props for behavior.

## Programs

Programs are persistent async scripts inside `defineApp`. They run in the chosen environment, receive typed semantic hooks, and receive dependencies from `deps`.

Programs are idempotent through durable handler-completion keys. They also record per-scope checkpoints. The server compacts an event tail only through the minimum of the snapshot sequence and configured program checkpoints, so a crashed or restarted program can replay retained events.

## Store

The server store is snapshot plus event tail:

```ts
interface Store {
  loadSnapshot(key: string): Snapshot | null;
  saveSnapshot(key: string, snapshot: Snapshot): void;
  appendEvents(key: string, events: unknown[], commandId?: string): void;
  getEvents(key: string): unknown[];
  compactEvents(key: string, throughSeq: number): void;
  saveCommandId(scopeId: string, commandId: string): void;
  getCommandIds(scopeId: string): Set<string>;
  clearCommandIds(scopeId: string): void;
}
```

`compactEvents(key, throughSeq)` removes only events with `seq <= throughSeq`. The snapshot remains the state checkpoint, and the tail remains the recovery/replay material for newer events or programs that have not caught up.

Command execution runs through a per-scope writer queue. Commands for the same resource key are serialized before they read state and append events. Different scopes have independent queues, so unrelated resources do not share one app-wide writer.

Built-in stores:

| Store                | Use                                     |
| -------------------- | --------------------------------------- |
| `createFileStore`    | default local server store under `.app` |
| `createBrowserStore` | IndexedDB client snapshot store         |

## Migrations

Versions stay in ordinary TypeScript files. A newer API points at the previous API and defines state/event migration only where it needs to.

```ts
export const api = defineApp<SpecV2, typeof v1>({
  version: 2,
  previous: v1,
  migrate: {
    state: {
      note(data) {
        return { ...data, archived: false };
      },
    },
    event: {
      note(name, payload) {
        if (name === "renamed") return { name: "titleChanged", payload };
        return { name, payload };
      },
    },
  },
  resources: { ... },
});
```

Snapshots migrate during restore. Events upcast during replay and before program handler matching.

## PWA And Assets

When `pwa` is present, the server emits:

- `/manifest.webmanifest`
- `/service-worker.js`
- a generated fallback icon at `/_poggers/icon.svg`
- app-shell HTML with manifest and service worker registration

Strict apps define `styles.ts` with `defineStyles<App>(...)`. The kit compiles component-part presets into generated CSS, serves it as `/client.css`, and exposes direct typed imports through `@poggers/app`, such as `useNote`, `createNoteEditor`, `usePreset`, `setPreset`, `useScreen`, and `nav`.

## Type Performance And Docs

Generated `@poggers/app` exports use named option/result aliases instead of public `Parameters<>` and `ReturnType<>` chains. This keeps hovers compact and avoids making the editor instantiate the full app hook surface for a single function.

Write JSDoc in `types.ts` directly above the resource or component declaration. The generator copies those comments onto the generated `useX` and `createX` exports. See [type-performance-jsdoc.md](./type-performance-jsdoc.md).
