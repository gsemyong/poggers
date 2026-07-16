import type { FeatureDef } from "@poggers/kit";
import { For, createPress } from "@poggers/kit/ui";
import type { App } from "src/app";

export type SearchHit = {
  readonly id: string;
  readonly title: string;
  readonly kind: "document" | "person" | "project";
  readonly detail: string;
};

export type SearchFailure = {
  readonly code: "search-unavailable";
  readonly retryable: boolean;
};

export type SearchDependencies = {
  readonly search: {
    find(input: {
      readonly query: string;
      readonly limit: number;
      readonly signal: AbortSignal;
    }): Promise<readonly SearchHit[]>;
  };
};

export type SearchFeature = {
  Resources: {};
  Dependencies: {
    browser: SearchDependencies;
  };
  Components: {
    SearchPanel: {
      Context: {
        query: string;
        completedQuery: string;
        results: readonly SearchHit[];
        error: SearchFailure | null;
      };
      Phases: "idle" | "debouncing" | "searching" | "ready" | "failed";
      Tasks: {
        search: {
          Input: { query: string; limit: number };
          Output: readonly SearchHit[];
          Error: SearchFailure;
        };
      };
      State: {
        query: string;
        completedQuery: string;
        results: readonly SearchHit[];
        busy: boolean;
        hasQuery: boolean;
        status: string;
      };
      Actions: {
        change(input: { query: string }): void;
        clear(): void;
        retry(): void;
      };
      Parts: {
        Root: "section";
        Header: "header";
        Eyebrow: "span";
        Title: "h2";
        Description: "p";
        Search: "div";
        Input: "input";
        Clear: "button";
        Status: "div";
        Results: "ul";
        Result: "li";
        ResultTitle: "strong";
        ResultMeta: "span";
        Empty: "li";
      };
    };
  };
};

const entries: readonly SearchHit[] = [
  { id: "doc-1", title: "Substrate design", kind: "document", detail: "Architecture note" },
  { id: "doc-2", title: "Resource lifecycle", kind: "document", detail: "Technical brief" },
  { id: "person-1", title: "Mira Chen", kind: "person", detail: "Systems engineer" },
  { id: "project-1", title: "Local-first workspace", kind: "project", detail: "Active project" },
  { id: "project-2", title: "Projection runtime", kind: "project", detail: "Prototype" },
  { id: "doc-3", title: "Capability contracts", kind: "document", detail: "API reference" },
];

export const searchFeature = {
  dependencies: {
    browser: {
      search: {
        async find({ query, limit, signal }) {
          const normalized = query.trim().toLocaleLowerCase();
          await wait(normalized.length === 1 ? 320 : 110, signal);
          signal.throwIfAborted();
          return entries
            .filter((entry) =>
              `${entry.title} ${entry.kind} ${entry.detail}`
                .toLocaleLowerCase()
                .includes(normalized),
            )
            .slice(0, limit);
        },
      },
    },
  },
  components: {
    SearchPanel: {
      state({ context, active }) {
        const busy = active.includes("debouncing") || active.includes("searching");
        return {
          query: context.query,
          completedQuery: context.completedQuery,
          results: context.results,
          busy,
          hasQuery: context.query.length > 0,
          status: busy
            ? "Searching capability"
            : active.includes("failed")
              ? "Capability unavailable"
              : context.completedQuery
                ? `${context.results.length} results from capability`
                : "Type to run a cancellable query",
        };
      },
      machine: {
        context: {
          query: "",
          completedQuery: "",
          results: [],
          error: null,
        },
        initial: "idle",
        on: {
          change: [
            {
              allow: (_scope, input) => input.query.trim().length > 0,
              target: "debouncing",
              reenter: true,
              update: (_scope, input) => ({ query: input.query, error: null }),
            },
            {
              target: "idle",
              update: () => ({ query: "", completedQuery: "", results: [], error: null }),
            },
          ],
          clear: {
            target: "idle",
            update: () => ({ query: "", completedQuery: "", results: [], error: null }),
          },
        },
        phases: {
          idle: {},
          debouncing: {
            after: { wait: 120, target: "searching" },
          },
          searching: {
            task: {
              run: "search",
              input: ({ context }) => ({ query: context.query, limit: 5 }),
              done: {
                target: "ready",
                update: ({ context }, results) => ({
                  completedQuery: context.query,
                  results,
                  error: null,
                }),
              },
              fail: {
                target: "failed",
                update: (_scope, error) => ({ error }),
              },
            },
          },
          ready: {},
          failed: {
            on: { retry: "searching" },
          },
        },
        tasks: {
          search({ dependencies, signal, value }) {
            return dependencies.search.find({ ...value, signal });
          },
        },
      },
      view({
        state,
        actions,
        parts: {
          Root,
          Header,
          Eyebrow,
          Title,
          Description,
          Search,
          Input,
          Clear,
          Status,
          Results,
          Result,
          ResultTitle,
          ResultMeta,
          Empty,
        },
      }) {
        return (
          <Root>
            <Header>
              <Eyebrow>Browser capability → component context</Eyebrow>
              <Title>Search anything</Title>
              <Description>
                Each keystroke cancels obsolete work. Only the latest result can enter reactive UI
                state.
              </Description>
            </Header>
            <Search>
              <Input
                type="search"
                value={state.query}
                placeholder="Try resource, project, or Mira"
                aria-label="Search"
                onInput={(event) => actions.change({ query: event.currentTarget.value })}
              />
              <Clear type="button" hidden={!state.hasQuery} {...createPress(actions.clear)}>
                Clear
              </Clear>
            </Search>
            <Status aria-live="polite">{state.status}</Status>
            <Results>
              <For
                each={state.results}
                by="id"
                fallback={
                  <Empty>
                    {state.completedQuery && !state.busy
                      ? `No matches for “${state.completedQuery}”`
                      : "Results appear here"}
                  </Empty>
                }
              >
                {(result) => (
                  <Result>
                    <ResultTitle>{result.title}</ResultTitle>
                    <ResultMeta>{`${result.kind} · ${result.detail}`}</ResultMeta>
                  </Result>
                )}
              </For>
            </Results>
          </Root>
        );
      },
    },
  },
} satisfies FeatureDef<App, SearchFeature>;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
