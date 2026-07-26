import type { ConfiguredWebPresentation, WebPresentation, WebStyle } from "kit/web";

import type { Web } from "@/apps/main/app";

const parameters = {
  color: {
    canvas: { oklch: [0.98, 0.004, 250] },
    content: { oklch: [0.2, 0.01, 250] },
  },
  space: { page: 24, controlBlock: 12, controlInline: 18 },
  radius: { control: 999 },
} as const;

const createClean = (({ parameters: values }) => {
  const control = {
    layout: {
      padding: { block: values.space.controlBlock, inline: values.space.controlInline },
    },
    paint: { radius: values.radius.control },
    text: { weight: "semibold" },
  } satisfies WebStyle;

  return {
    Shell: () => ({
      Root: () => ({
        Root: {
          layout: {
            model: { kind: "flow", direction: "block", align: "center", distribute: "center" },
            minBlockSize: { viewport: { axis: "block", percent: 100 } },
            padding: values.space.page,
          },
          paint: { fill: values.color.canvas },
          text: { family: "system", color: values.color.content },
        },
        Title: { text: { size: 32, weight: 650 } },
        Increment: {
          ...control,
          paint: { ...control.paint, fill: values.color.content },
          text: { ...control.text, color: values.color.canvas },
          rules: [
            {
              when: { pseudo: "hover", pointer: { hover: true } },
              use: { paint: { opacity: 0.85 } },
            },
          ],
        },
      }),
    }),
  };
}) satisfies WebPresentation<Web, typeof parameters>;

export const clean = {
  parameters,
  create: createClean,
} satisfies ConfiguredWebPresentation<Web, typeof parameters>;
