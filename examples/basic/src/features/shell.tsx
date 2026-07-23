import { createFeature, type Program } from "kit";
import type { BrowserMainThread } from "kit/web";

export type ShellFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        State: { count: number };
        Actions: { increment(): void };
        Components: {
          Root: { Elements: { Root: "main"; Title: "h1"; Increment: "button" } };
        };
      }
    >;
  };
};

export const shell = createFeature<ShellFeature>({
  programs: {
    browser: {
      state: { count: 0 },
      actions: {
        increment({ state }) {
          state.count += 1;
        },
      },
      components: {
        Root: {
          view({ feature, elements: { Root, Title, Increment } }) {
            return (
              <Root>
                <Title>Basic</Title>
                <Increment type="button" onPointerDown={() => feature.increment()}>
                  {() => `Count ${feature.count}`}
                </Increment>
              </Root>
            );
          },
        },
      },
      root: "Root",
    },
  },
});
