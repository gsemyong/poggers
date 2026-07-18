import type { Feature, Program, WebMain } from "@poggers/kit";

export type ShellFeature = {
  Programs: {
    browser: Program<
      WebMain,
      {
        Components: {
          Application: { Elements: { Root: "main"; Title: "h1" } };
        };
      }
    >;
  };
};

export const shell = {
  programs: {
    browser: {
      components: {
        Application: {
          view({ elements: { Root, Title } }) {
            return (
              <Root>
                <Title>{"{{name}}"}</Title>
              </Root>
            );
          },
        },
      },
      root: "Application",
    },
  },
} satisfies Feature<ShellFeature>;
