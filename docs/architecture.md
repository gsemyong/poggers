# Poggers Kit Architecture

Poggers Kit is a small Bun framework for local, event-sourced personal applications.

The default application surface is strict:

```text
src/types.ts       generic app spec and shared domain types
src/app.ts         current app object satisfying AppDefinition
src/deps.ts        dependency implementations and provider config
src/ui/            app-specific screens and JSX widgets
```

New apps should use the strict shape. Historical app shapes are captured as generated migration snapshots when persisted data changes; the public app authoring surface stays plain file exports checked with generated `@poggers/app` types.

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
import type { AppDefinition } from "@poggers/app";
import { render } from "@poggers/kit/ui";
```

## Core Concepts

| Primitive  | Meaning                                                 |
| ---------- | ------------------------------------------------------- |
| `app`      | Product API exported as a typed app object              |
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

  Deps: {
    logger: { write(message: string): Promise<void> };
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

`app.ts` owns resource handlers, PWA metadata, navigation, semantic component behavior, styles, programs, and the root UI function reference. Dependency implementations live in `src/deps.ts`. Actual JSX screens and widgets live in `src/ui`.

The default app TypeScript project excludes `src/deps.ts` from the editor-facing app program. `poggers typecheck` checks `src/deps.ts` in a separate program, so production adapters and test doubles stay typed without pulling heavy third-party SDK types into app/UI IntelliSense.

```ts
import type { AppDefinition } from "@poggers/app";
import { NoteScreen } from "ui/note-screen";

export default {
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

  root: NoteScreen,
} satisfies AppDefinition;
```

`src/deps.ts` uses the package dependency-config type and the app's own dependency contract from `./types`. Values can be provided directly; dependencies that need runtime selection can expose a production provider and named alternatives such as `mock`. Inline one-off implementations in this file. Add helper modules only when there is real reuse.

```ts
import type { DependencyConfig } from "@poggers/kit/deps";
import type { App } from "./types";

export default {
  logger: {
    production: {
      async write(message) {
        console.log(message);
      },
    },
    mock: {
      async write() {},
    },
  },
} satisfies DependencyConfig<App["Deps"]>;
```

For local apps, `Actor` and `identify` are optional. The default actor is `{ id: token || "local" }`.

## UI

Application UI imports generated functions directly from `@poggers/app`.

The native JSX runtime uses fine-grained signals internally. App code can pass signals directly to dynamic JSX children and attributes, or read them with calls like `note.title()`.

Resources generate `useX` functions. Components generate `createX` functions. Style-only components need no controller. DOM event details stay in the app object's `components` table only when a component needs behavior; app UI renders generated component parts:

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

There are no style-only UI selectors and no tautological part controllers. If something is renderable, it belongs under `App["Components"]` and is created with `createX`; app `components` only supplies extra DOM props for behavior.

## Programs

Programs are persistent async scripts inside the app object. They run in the chosen environment, receive typed semantic hooks, and receive dependencies from `deps`.

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

| Store                | Use                                         |
| -------------------- | ------------------------------------------- |
| `createFileStore`    | default local server store under `.poggers` |
| `createBrowserStore` | IndexedDB client snapshot store             |

## Migrations

The current contract stays in `src/types.ts`. When persisted shape changes, the CLI snapshots that contract into `src/migrations/snapshots/<hash>.ts` and creates a reviewed edge under `src/migrations/`.

```ts
import type { Migration } from "@poggers/app";
import type { App as From } from "./snapshots/a1b2c3d4e5f6.ts";
import type { App as To } from "./snapshots/f6e5d4c3b2a1.ts";

export default {
  from: "a1b2c3d4e5f6",
  to: "f6e5d4c3b2a1",
  migrate: {
    note: {
      state(old) {
        return { ...old, archived: false };
      },
      event(name, payload) {
        if (name === "renamed") return { name: "titleChanged", payload };
        return { name, payload };
      },
    },
  },
} satisfies Migration<From, To>;
```

Use `poggers migrations snapshot <app-dir>` to capture the initial current shape and `poggers migrations create <name> <app-dir>` after changing `types.ts`. Generated edges start as drafts, so `poggers typecheck` fails until the edge is reviewed.

The legacy numeric `previous` chain remains a compatibility path for existing code. New apps should use snapshot hashes and migration edge files.

## PWA And Assets

When `pwa` is present, the server emits:

- `/manifest.webmanifest`
- `/service-worker.js`
- a generated fallback icon at `/_poggers/icon.svg`
- app-shell HTML with manifest and service worker registration

Strict apps define styles inside `src/app.ts` under `styles`. The kit compiles component-part presets into generated CSS, serves it as `/client.css`, and exposes direct typed imports through `@poggers/app`, such as `useNote`, `createNoteEditor`, `usePreset`, `setPreset`, `useScreen`, and `nav`.

## Type Performance And Docs

Generated `@poggers/app` exports use named option/result aliases instead of public `Parameters<>` and `ReturnType<>` chains. This keeps hovers compact and avoids making the editor instantiate the full app hook surface for a single function. App-local generated declarations live under `.poggers/types`; they are generated artifacts, ignored by Git, and refreshed by `poggers sync`, `poggers typecheck`, `poggers dev`, and `poggers build`.

Write JSDoc in `types.ts` directly above the resource or component declaration. The generator copies those comments onto the generated `useX` and `createX` exports. See [type-performance-jsdoc.md](./type-performance-jsdoc.md).
