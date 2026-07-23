import type { ConfiguredWebPresentation, WebPresentation, WebStyle } from "kit/web";

import type { WorkspaceWeb } from "../apps/web";

const parameters = {
  color: {
    canvas: { oklch: [0.975, 0.006, 230] },
    surface: { oklch: [1, 0, 0] },
    ink: { oklch: [0.2, 0.02, 250] },
    muted: { oklch: [0.51, 0.025, 245] },
    line: { oklch: [0.89, 0.012, 235] },
    accent: { oklch: [0.58, 0.16, 152] },
    accentSoft: { oklch: [0.94, 0.04, 152] },
    danger: { oklch: [0.57, 0.2, 25] },
    dark: { oklch: [0.17, 0.025, 245] },
  },
  radius: { control: 6, surface: 8 },
} as const;

const createClean = (({ parameters: values }) => {
  const button = (kind: "default" | "primary" | "danger" = "default"): WebStyle => {
    const color = kind === "danger" ? values.color.danger : values.color.accent;
    return {
      layout: { padding: { block: 9, inline: 13 } },
      paint: {
        fill: kind === "default" ? values.color.surface : color,
        stroke: { width: 1, color: kind === "default" ? values.color.line : color },
        radius: values.radius.control,
      },
      text: {
        color: kind === "default" ? values.color.ink : values.color.surface,
        size: 13,
        weight: "semibold",
        wrap: "nowrap",
      },
      affordance: { cursor: "pointer", selection: "none" },
      rules: [
        { when: { pseudo: "hover", pointer: { hover: true } }, use: { paint: { opacity: 0.78 } } },
        {
          when: { pseudo: "focus-visible" },
          use: { paint: { outline: { width: 2, offset: 2, color } } },
        },
      ],
    };
  };
  const muted: WebStyle = { text: { color: values.color.muted, size: 13, lineHeight: 1.5 } };
  const input: WebStyle = {
    layout: { inlineSize: "fill", padding: { block: 11, inline: 12 } },
    paint: {
      fill: values.color.surface,
      stroke: { width: 1, color: values.color.line },
      radius: values.radius.control,
    },
    text: { size: 15, color: values.color.ink },
    rules: [
      {
        when: { pseudo: "focus-visible" },
        use: { paint: { outline: { width: 2, offset: 1, color: values.color.accent } } },
      },
    ],
  };

  return {
    Shell: () => ({
      Layout: () => ({
        Root: {
          layout: {
            model: { kind: "flow", direction: "block" },
            minBlockSize: { viewport: { axis: "block", percent: 100, mode: "dynamic" } },
            container: { name: "interface", axis: "inline" },
          },
          paint: { fill: values.color.canvas },
          text: { family: ["system", "sans"], color: values.color.ink },
        },
        Topbar: {
          layout: {
            model: { kind: "flow", direction: "inline", align: "center", distribute: "between" },
            padding: { block: 14, inline: 24 },
          },
          paint: { fill: values.color.surface, stroke: { width: 1, color: values.color.line } },
          rules: [
            {
              when: { container: { name: "interface", maxInlineSize: 560 } },
              use: {
                layout: {
                  model: { kind: "flow", direction: "block", gap: 12, align: "stretch" },
                  padding: { block: 12, inline: 16 },
                },
              },
            },
          ],
        },
        BrandGroup: {
          layout: { model: { kind: "flow", direction: "inline", gap: 10, align: "center" } },
        },
        Mark: {
          layout: { padding: { block: 7, inline: 10 } },
          paint: { fill: values.color.dark, radius: values.radius.control },
          text: { color: values.color.surface, size: 13, weight: 720 },
        },
        Brand: { text: { size: 16, weight: 700 } },
        Account: {
          layout: { model: { kind: "flow", direction: "inline", gap: 14, align: "center" } },
          rules: [
            {
              when: { container: { name: "interface", maxInlineSize: 560 } },
              use: {
                layout: {
                  model: {
                    kind: "flow",
                    direction: "inline",
                    gap: 12,
                    align: "center",
                    distribute: "between",
                  },
                  inlineSize: "fill",
                },
              },
            },
          ],
        },
        User: {
          ...muted,
          layout: { minInlineSize: 0, overflow: { inline: "clip" } },
          text: { ...muted.text, wrap: "nowrap", overflow: "ellipsis" },
        },
        SignOut: button(),
        Content: {
          layout: { inlineSize: "fill", padding: 24 },
          rules: [
            {
              when: { container: { name: "interface", maxInlineSize: 560 } },
              use: { layout: { padding: 12 } },
            },
          ],
        },
        AuthLayout: {
          layout: {
            model: {
              kind: "grid",
              columns: [{ fraction: 1 }, { fraction: 1 }],
              gap: 64,
              align: "center",
            },
            inlineSize: "fill",
            maxInlineSize: 980,
            minBlockSize: { viewport: { axis: "block", percent: 100, mode: "dynamic" } },
            margin: { inline: "auto" },
            padding: 32,
          },
          rules: [
            {
              when: { container: { maxInlineSize: 720 } },
              use: {
                layout: { model: { kind: "flow", direction: "block", gap: 32 }, padding: 22 },
              },
            },
          ],
        },
        AuthIntro: { layout: { model: { kind: "flow", direction: "block", gap: 12 } } },
        AuthEyebrow: {
          text: { color: values.color.accent, size: 12, weight: 700, transform: "uppercase" },
        },
        AuthTitle: { text: { size: 46, weight: 720, lineHeight: 1.06 } },
        AuthCopy: { text: { color: values.color.muted, size: 17, lineHeight: 1.6 } },
        AuthPanel: {
          layout: { model: { kind: "flow", direction: "block", gap: 16 }, padding: 28 },
          paint: {
            fill: values.color.surface,
            stroke: { width: 1, color: values.color.line },
            radius: values.radius.surface,
            shadow: { y: 18, blur: 48, color: { oklch: [0.2, 0.02, 245, 0.1] } },
          },
        },
        Form: { layout: { model: { kind: "flow", direction: "block", gap: 9 } } },
        Label: { text: { size: 13, weight: "semibold" } },
        Input: input,
        Submit: button("primary"),
        Switch: {
          text: { color: values.color.accent, size: 13, weight: "semibold" },
          affordance: { cursor: "pointer" },
        },
        Error: { text: { color: values.color.danger, size: 13, lineHeight: 1.5 } },
      }),
    }),
    Tasks: () => ({
      Admin: () => ({
        Root: {
          layout: {
            model: { kind: "flow", direction: "block", gap: 18 },
            inlineSize: "fill",
            maxInlineSize: 980,
            margin: { inline: "auto" },
            padding: 26,
            container: { name: "tasks", axis: "inline" },
          },
          paint: {
            fill: values.color.surface,
            stroke: { width: 1, color: values.color.line },
            radius: values.radius.surface,
          },
          rules: [
            {
              when: { container: { name: "interface", maxInlineSize: 560 } },
              use: {
                layout: { model: { kind: "flow", direction: "block", gap: 14 }, padding: 16 },
              },
            },
          ],
        },
        Header: {
          layout: {
            model: {
              kind: "flow",
              direction: "inline",
              align: "center",
              distribute: "between",
              gap: 20,
            },
          },
          rules: [
            {
              when: { container: { name: "tasks", maxInlineSize: 620 } },
              use: {
                layout: {
                  model: { kind: "flow", direction: "block", gap: 12, align: "stretch" },
                },
              },
            },
          ],
        },
        Heading: { layout: { model: { kind: "flow", direction: "block", gap: 4 } } },
        Eyebrow: {
          text: { color: values.color.accent, size: 11, weight: 700, transform: "uppercase" },
        },
        Title: { text: { size: 30, weight: 720, lineHeight: 1.1 } },
        Copy: muted,
        New: button("primary"),
        Status: muted,
        Empty: {
          layout: {
            model: { kind: "flow", direction: "block", gap: 6 },
            padding: { block: 42, inline: 20 },
          },
          paint: { fill: values.color.accentSoft, radius: values.radius.surface },
        },
        EmptyTitle: { text: { size: 17, weight: 680 } },
        EmptyCopy: muted,
        List: { layout: { model: { kind: "flow", direction: "block", gap: 8 } } },
        Row: {
          layout: {
            model: {
              kind: "flow",
              direction: "inline",
              align: "center",
              distribute: "between",
              gap: 18,
            },
            padding: 14,
          },
          paint: {
            fill: values.color.surface,
            stroke: { width: 1, color: values.color.line },
            radius: values.radius.control,
          },
          rules: [
            {
              when: { container: { name: "tasks", maxInlineSize: 620 } },
              use: {
                layout: {
                  model: {
                    kind: "flow",
                    direction: "block",
                    gap: 12,
                    align: "stretch",
                    distribute: "start",
                  },
                },
              },
            },
          ],
        },
        TaskBody: { layout: { model: { kind: "flow", direction: "block", gap: 3 } } },
        TaskTitle: { text: { size: 15, weight: 650 } },
        TaskState: muted,
        Actions: {
          layout: { model: { kind: "flow", direction: "inline", gap: 7, align: "center" } },
          rules: [
            {
              when: { container: { name: "tasks", maxInlineSize: 360 } },
              use: {
                layout: {
                  model: { kind: "flow", direction: "block", gap: 7, align: "stretch" },
                },
              },
            },
          ],
        },
        Edit: button(),
        Toggle: button(),
        Remove: button("danger"),
        Form: {
          layout: {
            model: { kind: "flow", direction: "block", gap: 12 },
            maxInlineSize: 560,
            padding: { block: 12, inline: 0 },
          },
        },
        FormHeader: { layout: { model: { kind: "flow", direction: "block", gap: 4 } } },
        FormTitle: { text: { size: 22, weight: 700 } },
        Label: { text: { size: 13, weight: "semibold" } },
        Input: input,
        FormActions: { layout: { model: { kind: "flow", direction: "inline", gap: 8 } } },
        Save: button("primary"),
        Back: button(),
      }),
    }),
  };
}) satisfies WebPresentation<WorkspaceWeb, typeof parameters>;

export const clean = { parameters, create: createClean } satisfies ConfiguredWebPresentation<
  WorkspaceWeb,
  typeof parameters
>;
