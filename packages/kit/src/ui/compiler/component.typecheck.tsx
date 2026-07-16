import type {
  AppDef,
  Submission,
  SubmissionFailure,
  SubmissionSuccess,
  VisualValue,
  Writable,
} from "#kernel/app";
import type { Preset } from "#ui/web/visual";

type App = {
  Resources: {};
  Components: {
    Screen: {
      Parts: { Root: "main" };
    };
    Editor: {
      Input: { documentId: string };
      Context: { draft: string; error: string | undefined };
      State: {
        title: string;
        draft: string;
        canSubmit: boolean;
        submitting: boolean;
        failed: boolean;
        dragOffset: Writable<VisualValue<"length">>;
      };
      Phases: "idle" | "submitting" | "failed";
      Actions: {
        change(input: { value: string }): void;
        submit(): void;
        retry(): void;
      };
      Tasks: {
        save: {
          Input: string;
          Output: SubmissionSuccess;
          Error: SubmissionFailure<"conflict">;
        };
      };
      Parts: {
        Root: "form";
        Title: "h1";
        Input: "input";
        Submit: "button";
      };
    };
  };
  API: {
    readonly documents: {
      get(input: { documentId: string }): {
        readonly title: string;
        save(input: { title: string }): Submission<"conflict">;
      };
    };
  };
  Styles: { Presets: "clean" };
};

const app = {
  version: 1,
  api: () => ({
    documents: {
      get: () => ({
        title: "Document",
        save: (): Submission<"conflict"> => {
          throw new Error("type contract only");
        },
      }),
    },
  }),
  components: {
    Screen: {
      view({ parts: { Root }, components: { Editor } }) {
        return (
          <Root>
            <Editor documentId="document" />
          </Root>
        );
      },
    },
    Editor: {
      machine: {
        context: { draft: "", error: undefined },
        initial: "idle",
        phases: {
          idle: {
            on: {
              change: {
                update: (_scope, input) => ({ draft: input.value }),
              },
              submit: "submitting",
            },
          },
          submitting: {
            task: {
              run: "save",
              input: ({ context }) => context.draft,
              done: "idle",
              fail: {
                target: "failed",
                update: (_scope, error) => ({ error: error.error }),
              },
            },
          },
          failed: { on: { retry: "submitting" } },
        },
        tasks: {
          save: ({ api, input, value }) =>
            api.documents.get({ documentId: input.documentId }).save({ title: value }),
        },
      },
      state: ({ api, input, context, phase }) => ({
        title: api.documents.get({ documentId: input.documentId }).title,
        draft: context.draft,
        canSubmit: context.draft.trim().length > 0 && phase !== "submitting",
        submitting: phase === "submitting",
        failed: phase === "failed",
        dragOffset: 0,
      }),
      view({ state, actions, parts: { Root, Title, Input, Submit } }) {
        // @ts-expect-error State is read-only in structure.
        state.dragOffset = 10;
        // @ts-expect-error Raw statechart matching is private.
        state.matches("idle");
        // @ts-expect-error Context is private to the machine and State projection.
        void context;
        // @ts-expect-error The removed event vocabulary is unavailable.
        void events;

        return (
          <Root aria-busy={state.submitting}>
            <Title>{state.title}</Title>
            <Input
              value={state.draft}
              onInput={(event) => actions.change({ value: event.currentTarget.value })}
            />
            <Submit type="button" disabled={!state.canSubmit} onPointerDown={actions.submit}>
              Save
            </Submit>
          </Root>
        );
      },
    },
  },
  root: "Screen",
} satisfies AppDef<App>;

const preset = (({ tokens }) => ({
  theme: {
    color: {
      canvas: { l: 0.98, c: 0.004, h: 250 },
      text: { l: 0.2, c: 0.01, h: 250 },
    },
  },
  components: {
    Screen: () => ({ Root: { paint: { fill: tokens.color.canvas } } }),
    Editor: ({ state }) => ({
      Root: { paint: { opacity: state.submitting.choose(0.7, 1) } },
      Title: { typography: { color: tokens.color.text } },
      Submit: { when: state.canSubmit, paint: { opacity: 1 } },
    }),
  },
})) satisfies Preset<
  App,
  "clean",
  {
    color: {
      canvas: { l: number; c: number; h: number };
      text: { l: number; c: number; h: number };
    };
  }
>;

void app;
void preset;
