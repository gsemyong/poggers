import type { Feature, Program } from "@poggers/kit";
import type { BrowserMainThread } from "@poggers/kit/web";

export type ShellFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        State: { count: number };
        Actions: { increment(): void };
        Components: {
          Application: { Elements: { Root: "main"; Title: "h1"; Increment: "button" } };
        };
      }
    >;
  };
};

export const shell = {
  programs: {
    browser: {
      state: { count: 0 },
      actions: {
        increment({ state }) {
          state.count += 1;
        },
      },
      components: {
        Application: {
          view({ feature, elements: { Root, Title, Increment } }) {
            return (
              <Root>
                <Title>{"{{name}}"}</Title>
                <Increment type="button" onPointerDown={() => feature.increment()}>
                  {() => `Count ${feature.count}`}
                </Increment>
              </Root>
            );
          },
        },
      },
      root: "Application",
    },
  },
} satisfies Feature<ShellFeature>;
