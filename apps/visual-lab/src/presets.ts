import type { Preset } from "@poggers/kit/style";
import type { App } from "types";

export const precisionPreset = {
  tokens: {
    color: {
      canvas: { l: 0.965, c: 0.004, h: 255 },
      panel: { l: 0.995, c: 0.002, h: 255 },
      panelRaised: { l: 1, c: 0, h: 0 },
      text: { l: 0.19, c: 0.012, h: 255 },
      muted: { l: 0.49, c: 0.012, h: 255 },
      line: { l: 0.875, c: 0.008, h: 255 },
      active: { l: 0.22, c: 0.014, h: 255 },
      activeText: { l: 0.985, c: 0.002, h: 255 },
      focus: { l: 0.57, c: 0.17, h: 252 },
      backdrop: { l: 0.12, c: 0.008, h: 255, alpha: 0.34 },
    },
    space: { xs: 4, sm: 8, md: 12, lg: 18, xl: 28, stage: 64 },
    size: { panel: 620, result: 58 },
    radius: { control: 8, panel: 17 },
    shadow: {
      panel: [
        {
          y: 26,
          blur: 72,
          spread: -28,
          color: { l: 0.12, c: 0.012, h: 255, alpha: 0.28 },
        },
        {
          y: 2,
          blur: 7,
          spread: -3,
          color: { l: 0.12, c: 0.012, h: 255, alpha: 0.16 },
        },
      ],
    },
    font: { body: { families: ["Inter", "SF Pro Text", "Arial"] } },
    motion: {
      fast: { duration: 130, easing: "decelerate" },
      settle: { spring: { duration: 420, bounce: 0.1 } },
    },
    z: { popover: 20 },
  },
  themes: {
    default: {},
    dark: {
      color: {
        canvas: { l: 0.13, c: 0.009, h: 255 },
        panel: { l: 0.18, c: 0.01, h: 255 },
        panelRaised: { l: 0.215, c: 0.012, h: 255 },
        text: { l: 0.95, c: 0.006, h: 255 },
        muted: { l: 0.68, c: 0.012, h: 255 },
        line: { l: 0.31, c: 0.012, h: 255 },
      },
    },
  },
  containers: {
    compact: { inlineBelow: 600 },
    roomy: { inlineAbove: 960 },
  },
  components: ({ tokens }) => {
    const label = {
      text: { font: tokens.font.body, size: 14, line: 1.25 },
    } as const;
    const control = {
      shape: { radius: tokens.radius.control },
      interaction: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
    } as const;
    const presetControl = {
      frame: { block: 44 },
      padding: { inline: tokens.space.md, block: tokens.space.sm },
      surface: { fill: "transparent", text: tokens.color.muted },
      text: { size: 12, weight: 600 },
      when: [
        { native: "hover", apply: { surface: { fill: tokens.color.panelRaised } } },
        {
          native: "pressed",
          apply: { surface: { fill: tokens.color.active, text: tokens.color.activeText } },
        },
        {
          container: "compact",
          apply: { padding: { inline: tokens.space.xs, block: tokens.space.sm } },
        },
      ],
      motion: { change: { surface: tokens.motion.fast } },
    } as const;

    return {
      CommandMenu: ({ values }) => ({
        Root: {
          layout: { kind: "grid", align: "start", distribute: "center" },
          frame: { inline: "fill", block: { min: { viewport: { axis: "block", percent: 1 } } } },
          padding: { inline: tokens.space.xl, block: tokens.space.stage },
          surface: { fill: tokens.color.canvas, text: tokens.color.text },
          text: { font: tokens.font.body },
          when: [
            {
              container: "compact",
              apply: {
                layout: { kind: "grid", align: "center", distribute: "center" },
                padding: tokens.space.xl,
              },
            },
          ],
        },
        Stage: {
          layout: { kind: "stack", gap: tokens.space.xl },
          frame: { inline: { max: 760 } },
        },
        Heading: { layout: { kind: "stack", gap: tokens.space.sm } },
        Kicker: {
          text: { size: 12, weight: 650, transform: "uppercase", tracking: 0.6 },
          surface: { text: tokens.color.muted },
        },
        Title: { text: { size: 36, weight: 650, line: 1.05 } },
        Summary: {
          frame: { inline: { max: 560 } },
          text: { size: 15, line: 1.55, wrap: "pretty" },
          surface: { text: tokens.color.muted },
        },
        PresetNav: {
          layout: { kind: "row", gap: tokens.space.xs, align: "center", wrap: true },
          padding: tokens.space.xs,
          frame: { inline: "content" },
          surface: { fill: tokens.color.panel },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.control },
          when: [
            {
              container: "compact",
              apply: {
                layout: {
                  kind: "grid",
                  columns: [{ fraction: 1 }, { fraction: 1 }, { fraction: 1 }, { fraction: 1 }],
                  gap: 0,
                  align: "center",
                },
                frame: { inline: "fill" },
              },
            },
          ],
        },
        PrecisionPreset: { use: [control, presetControl] },
        TactilePreset: { use: [control, presetControl] },
        EditorialPreset: { use: [control, presetControl] },
        ThemeToggle: { use: [control, presetControl] },
        Trigger: {
          use: control,
          layout: { kind: "row", gap: tokens.space.md, align: "center" },
          frame: { inline: { max: 520 }, block: 52 },
          padding: { inline: tokens.space.md },
          surface: { fill: tokens.color.panelRaised, text: tokens.color.text },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          when: [
            { native: "hover", apply: { transform: { block: -1 } } },
            { native: "active", apply: { transform: { block: 0, scale: 0.99 } } },
          ],
          motion: { change: { transform: tokens.motion.fast } },
        },
        TriggerIcon: { surface: { text: tokens.color.muted }, text: { size: 17 } },
        TriggerLabel: { use: label, place: { flex: { grow: 1, shrink: 1, basis: "content" } } },
        TriggerKey: {
          padding: { inline: tokens.space.sm, block: tokens.space.xs },
          surface: { fill: tokens.color.canvas, text: tokens.color.muted },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: 6 },
          text: { size: 11, weight: 600 },
        },
        Panel: {
          layout: { kind: "stack", gap: tokens.space.sm },
          frame: {
            inline: tokens.size.panel,
            block: { max: { viewport: { axis: "block", percent: 0.54 } } },
            contain: "layout",
          },
          padding: tokens.space.sm,
          surface: { fill: tokens.color.panel, text: tokens.color.text },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.panel, clip: "content" },
          effect: { shadow: tokens.shadow.panel },
          position: {
            kind: "fixed",
            anchor: { part: "Trigger" },
            place: "block-end",
            layer: tokens.z.popover,
          },
          transform: { block: values.dragOffset },
          decor: {
            backdrop: { surface: { fill: tokens.color.backdrop } },
          },
          motion: {
            enter: {
              from: { effect: { opacity: 0 }, transform: { block: -8, scale: 0.985 } },
              using: tokens.motion.settle,
            },
            exit: {
              to: { effect: { opacity: 0 }, transform: { block: 18, scale: 0.99 } },
              using: tokens.motion.fast,
            },
            layout: { geometry: "frame", content: "preserve", using: tokens.motion.settle },
            gesture: {
              axis: "block",
              value: values.dragOffset,
              handle: "Handle",
              bounds: [0, 460],
              rubberBand: 0.16,
              dismiss: { distance: 118, velocity: 0.55 },
              settle: tokens.motion.settle,
            },
          },
          when: [
            {
              container: "compact",
              apply: {
                frame: {
                  inline: "auto",
                  block: { max: { viewport: { axis: "block", percent: 0.82 } } },
                },
                position: {
                  kind: "fixed",
                  anchor: "none",
                  place: "auto",
                  inset: { inline: 10, blockEnd: 10 },
                },
                shape: { radius: 18 },
              },
            },
          ],
        },
        Handle: {
          layout: { kind: "hidden" },
          when: [
            {
              container: "compact",
              apply: {
                layout: { kind: "row" },
                frame: { inline: 36, block: 4 },
                place: { align: "center" },
                margin: { blockStart: tokens.space.xs, blockEnd: tokens.space.xs },
                surface: { fill: tokens.color.line },
                shape: { radius: 2 },
                interaction: { touch: "none", cursor: "grab" },
              },
            },
          ],
        },
        Search: {
          layout: { kind: "row", gap: tokens.space.sm, align: "center" },
          frame: { block: 48 },
          padding: { inline: tokens.space.md },
          surface: { fill: tokens.color.panelRaised },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.control },
        },
        SearchIcon: { surface: { text: tokens.color.muted } },
        SearchInput: {
          place: { flex: { grow: 1, shrink: 1, basis: "content" } },
          frame: { inline: "fill" },
          surface: { text: tokens.color.text },
          text: { size: 15, line: 1.2 },
          interaction: {
            focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
            caret: tokens.color.focus,
          },
          decor: { placeholder: { surface: { text: tokens.color.muted } } },
        },
        Results: {
          layout: { kind: "stack", gap: tokens.space.xs },
          scroll: { block: "auto", overscroll: "contain", scrollbar: "thin" },
        },
        Status: {
          layout: { kind: "stack", gap: tokens.space.sm, align: "center", distribute: "center" },
          frame: { block: { min: 176 } },
          padding: tokens.space.xl,
          text: { align: "center" },
          surface: { text: tokens.color.muted },
          when: [{ state: { mode: "error" }, apply: { surface: { text: tokens.color.focus } } }],
          motion: {
            enter: {
              from: { effect: { opacity: 0 }, transform: { block: 8, scale: 0.98 } },
              using: tokens.motion.settle,
            },
            exit: {
              to: { effect: { opacity: 0 }, transform: { block: -5 } },
              using: tokens.motion.fast,
            },
          },
        },
        StatusTitle: { text: { size: 15, weight: 680 } },
        StatusDetail: { frame: { inline: { max: 360 } }, text: { size: 12, line: 1.45 } },
        Retry: {
          use: control,
          frame: { block: 44 },
          padding: { inline: tokens.space.md },
          surface: { fill: tokens.color.panelRaised, text: tokens.color.text },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          text: { size: 12, weight: 650 },
        },
        Result: {
          use: control,
          layout: {
            kind: "grid",
            columns: [{ fraction: 1 }, "content"],
            gap: tokens.space.md,
            align: "center",
          },
          frame: { block: { min: tokens.size.result } },
          position: { kind: "relative" },
          padding: { inline: tokens.space.md, block: tokens.space.sm },
          surface: { fill: "transparent", text: tokens.color.text },
          when: [
            { native: "hover", apply: { surface: { fill: tokens.color.canvas } } },
            {
              native: "selected",
              apply: { surface: { text: tokens.color.activeText } },
            },
          ],
        },
        Selection: {
          position: { kind: "absolute", inset: 0, layer: 0 },
          surface: { fill: tokens.color.active },
          shape: { radius: tokens.radius.control },
          interaction: { pointer: "none" },
          motion: { shared: { id: "active-result", using: tokens.motion.settle } },
        },
        ResultCopy: {
          layout: { kind: "stack", gap: 3 },
          position: { kind: "relative", layer: 1 },
          text: { align: "start" },
        },
        ResultLabel: { use: label, text: { weight: 600 } },
        ResultDetail: {
          text: { size: 12, line: 1.3, overflow: "ellipsis", wrap: "nowrap" },
          surface: { text: "current" },
          effect: { opacity: 0.64 },
        },
        ResultKey: {
          position: { kind: "relative", layer: 1 },
          padding: { inline: tokens.space.sm, block: tokens.space.xs },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: 6 },
          text: { size: 11, weight: 600 },
          surface: { text: tokens.color.muted },
        },
        Footer: {
          layout: { kind: "row", align: "center", distribute: "between" },
          padding: { inline: tokens.space.sm, blockStart: tokens.space.sm },
          stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.line } },
        },
        ResultCount: {
          frame: { contain: "layout" },
          text: { size: 12 },
          surface: { text: tokens.color.muted },
          motion: {
            layout: { geometry: "text", content: "preserve", using: tokens.motion.fast },
          },
        },
        Close: {
          use: control,
          frame: { block: 44 },
          padding: { inline: tokens.space.md, block: tokens.space.sm },
          surface: { fill: tokens.color.panelRaised, text: tokens.color.text },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          text: { size: 12, weight: 600 },
        },
      }),
    };
  },
} satisfies Preset<App, "precision">;

export const tactilePreset = {
  tokens: {
    color: {
      canvas: { l: 0.105, c: 0.012, h: 232 },
      panel: { l: 0.165, c: 0.014, h: 224 },
      panelRaised: { l: 0.225, c: 0.016, h: 220 },
      well: { l: 0.125, c: 0.014, h: 224 },
      text: { l: 0.94, c: 0.012, h: 182 },
      muted: { l: 0.68, c: 0.018, h: 202 },
      line: { l: 0.34, c: 0.022, h: 205 },
      accent: { l: 0.83, c: 0.17, h: 158 },
      accentInk: { l: 0.135, c: 0.032, h: 166 },
      focus: { l: 0.82, c: 0.17, h: 158 },
      backdrop: { l: 0.04, c: 0.01, h: 232, alpha: 0.72 },
      handle: { l: 0.63, c: 0.025, h: 195 },
    },
    space: { xs: 5, sm: 9, md: 14, lg: 22, xl: 34, stage: 24 },
    size: { panel: 650, result: 62 },
    radius: { control: 10, panel: 20, key: 7 },
    shadow: {
      panel: [
        {
          y: 34,
          blur: 90,
          spread: -28,
          color: { l: 0.02, c: 0.01, h: 230, alpha: 0.78 },
        },
        { y: 8, blur: 18, spread: -8, color: { l: 0.02, c: 0.01, h: 230, alpha: 0.8 } },
        { y: 1, blur: 0, color: { l: 0.62, c: 0.035, h: 190, alpha: 0.18 }, inset: true },
      ],
      control: [
        { y: 4, blur: 0, color: { l: 0.07, c: 0.008, h: 230, alpha: 0.95 } },
        { y: 8, blur: 16, spread: -7, color: { l: 0.02, c: 0.01, h: 230, alpha: 0.72 } },
        { y: 1, blur: 0, color: { l: 0.72, c: 0.035, h: 185, alpha: 0.13 }, inset: true },
      ],
      pressed: { y: 1, blur: 0, color: { l: 0.03, c: 0.008, h: 230, alpha: 0.9 } },
    },
    font: {
      body: { families: ["Inter", "SF Pro Text", "Arial"] },
      mono: { families: ["SFMono-Regular", "Menlo", "Consolas"] },
    },
    gradient: {
      canvas: {
        kind: "radial",
        shape: "ellipse",
        stops: [
          { at: 0, color: { l: 0.2, c: 0.035, h: 204 } },
          { at: 0.48, color: { l: 0.13, c: 0.018, h: 220 } },
          { at: 1, color: { l: 0.085, c: 0.01, h: 236 } },
        ],
      },
      panel: {
        kind: "linear",
        angle: 150,
        stops: [
          { at: 0, color: { l: 0.24, c: 0.022, h: 205 } },
          { at: 0.52, color: { l: 0.175, c: 0.014, h: 220 } },
          { at: 1, color: { l: 0.145, c: 0.012, h: 230 } },
        ],
      },
      selection: {
        kind: "linear",
        angle: 110,
        stops: [
          { at: 0, color: { l: 0.88, c: 0.15, h: 151 } },
          { at: 1, color: { l: 0.75, c: 0.16, h: 174 } },
        ],
      },
    },
    motion: {
      snap: { duration: 170, easing: "decelerate" },
      settle: { spring: { duration: 560, bounce: 0.24 } },
      press: { spring: { duration: 280, bounce: 0.12 } },
    },
    z: { popover: 30 },
  },
  containers: {
    compact: { inlineBelow: 600 },
    roomy: { inlineAbove: 960 },
  },
  components: ({ tokens }) => {
    const focusable = {
      shape: { radius: tokens.radius.control },
      interaction: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 3 },
      },
    } as const;
    const key = {
      padding: { inline: tokens.space.sm, block: tokens.space.xs },
      surface: { fill: tokens.color.well, text: tokens.color.muted },
      stroke: { width: 1, line: "solid", color: tokens.color.line },
      shape: { radius: tokens.radius.key },
      effect: { shadow: tokens.shadow.control },
      text: { font: tokens.font.mono, size: 11, weight: 650 },
    } as const;
    const presetControl = {
      frame: { block: 44 },
      padding: { inline: tokens.space.md, block: tokens.space.sm },
      surface: { fill: "transparent", text: tokens.color.muted },
      text: { font: tokens.font.mono, size: 11, weight: 650, transform: "uppercase" },
      when: [
        { native: "hover", apply: { surface: { fill: tokens.color.panelRaised } } },
        {
          native: "pressed",
          apply: {
            surface: { fill: tokens.color.accent, text: tokens.color.accentInk },
            effect: { shadow: tokens.shadow.pressed },
            transform: { block: 2 },
          },
        },
        {
          container: "compact",
          apply: { padding: { inline: tokens.space.xs, block: tokens.space.sm } },
        },
      ],
      motion: { change: { surface: tokens.motion.snap, transform: tokens.motion.press } },
    } as const;

    return {
      CommandMenu: ({ values }) => ({
        Root: {
          layout: { kind: "grid", align: "start", distribute: "center" },
          frame: { inline: "fill", block: { min: { viewport: { axis: "block", percent: 1 } } } },
          padding: { inline: tokens.space.xl, block: tokens.space.stage },
          surface: { fill: tokens.gradient.canvas, text: tokens.color.text },
          text: { font: tokens.font.body },
          when: [
            {
              container: "compact",
              apply: {
                layout: { kind: "grid", align: "center", distribute: "center" },
                padding: tokens.space.xl,
              },
            },
          ],
        },
        Stage: {
          layout: { kind: "stack", gap: tokens.space.xl },
          frame: { inline: { max: 790 } },
        },
        Heading: { layout: { kind: "stack", gap: tokens.space.sm } },
        Kicker: {
          surface: { text: tokens.color.accent },
          text: {
            font: tokens.font.mono,
            size: 11,
            weight: 700,
            transform: "uppercase",
            tracking: 1,
          },
        },
        Title: { text: { size: 42, weight: 720, line: 1 } },
        Summary: {
          frame: { inline: { max: 600 } },
          surface: { text: tokens.color.muted },
          text: { size: 15, line: 1.55, wrap: "pretty" },
        },
        PresetNav: {
          layout: { kind: "row", gap: tokens.space.xs, align: "center", wrap: true },
          frame: { inline: "content" },
          padding: tokens.space.xs,
          surface: { fill: tokens.color.well },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.control },
          effect: { shadow: tokens.shadow.control },
          when: [
            {
              container: "compact",
              apply: {
                layout: {
                  kind: "grid",
                  columns: [{ fraction: 1 }, { fraction: 1 }, { fraction: 1 }, { fraction: 1 }],
                  gap: 0,
                  align: "center",
                },
                frame: { inline: "fill" },
              },
            },
          ],
        },
        PrecisionPreset: { use: [focusable, presetControl] },
        TactilePreset: { use: [focusable, presetControl] },
        EditorialPreset: { use: [focusable, presetControl] },
        ThemeToggle: { use: [focusable, presetControl] },
        Trigger: {
          use: focusable,
          layout: { kind: "row", gap: tokens.space.md, align: "center" },
          frame: { inline: { max: 560 }, block: 56 },
          padding: { inline: tokens.space.md },
          surface: { fill: tokens.color.panelRaised, text: tokens.color.text },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          effect: { shadow: tokens.shadow.control },
          when: [
            { native: "hover", apply: { transform: { block: -2 } } },
            {
              native: "active",
              apply: {
                transform: { block: 2, scale: 0.99 },
                effect: { shadow: tokens.shadow.pressed },
              },
            },
          ],
          motion: { change: { transform: tokens.motion.press, effect: tokens.motion.snap } },
        },
        TriggerIcon: { surface: { text: tokens.color.accent }, text: { size: 18, weight: 700 } },
        TriggerLabel: {
          place: { flex: { grow: 1, shrink: 1, basis: "content" } },
          text: { size: 14, weight: 650 },
        },
        TriggerKey: { use: key },
        Panel: {
          layout: { kind: "stack", gap: tokens.space.sm },
          frame: {
            inline: tokens.size.panel,
            block: { max: { viewport: { axis: "block", percent: 0.52 } } },
            contain: "layout",
          },
          padding: tokens.space.sm,
          surface: { fill: tokens.gradient.panel, text: tokens.color.text },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.panel, clip: "content" },
          effect: { shadow: tokens.shadow.panel },
          position: {
            kind: "fixed",
            anchor: { part: "Trigger" },
            place: "block-end",
            layer: tokens.z.popover,
          },
          transform: { block: values.dragOffset },
          decor: { backdrop: { surface: { fill: tokens.color.backdrop } } },
          motion: {
            enter: {
              from: { effect: { opacity: 0 }, transform: { block: 16, scale: 0.96 } },
              using: tokens.motion.settle,
            },
            exit: {
              to: { effect: { opacity: 0 }, transform: { block: 34, scale: 0.97 } },
              using: tokens.motion.snap,
            },
            layout: { geometry: "frame", content: "preserve", using: tokens.motion.settle },
            gesture: {
              axis: "block",
              value: values.dragOffset,
              handle: "Handle",
              bounds: [0, 480],
              rubberBand: 0.2,
              dismiss: { distance: 112, velocity: 0.58 },
              settle: tokens.motion.settle,
            },
          },
          when: [
            {
              container: "compact",
              apply: {
                frame: {
                  inline: "auto",
                  block: { max: { viewport: { axis: "block", percent: 0.84 } } },
                },
                position: {
                  kind: "fixed",
                  anchor: "none",
                  place: "auto",
                  inset: { inline: 8, blockEnd: 8 },
                },
                shape: { radius: 22 },
              },
            },
          ],
        },
        Handle: {
          layout: { kind: "hidden" },
          when: [
            {
              container: "compact",
              apply: {
                layout: { kind: "row" },
                frame: { inline: 42, block: 5 },
                place: { align: "center" },
                margin: { blockStart: tokens.space.xs, blockEnd: tokens.space.xs },
                surface: { fill: tokens.color.handle },
                shape: { radius: 2 },
                interaction: { touch: "none", cursor: "grab" },
              },
            },
          ],
        },
        Search: {
          layout: { kind: "row", gap: tokens.space.md, align: "center" },
          frame: { block: 52 },
          padding: { inline: tokens.space.md },
          surface: { fill: tokens.color.well },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.control },
          effect: { shadow: tokens.shadow.pressed },
        },
        SearchIcon: { surface: { text: tokens.color.accent }, text: { size: 16 } },
        SearchInput: {
          place: { flex: { grow: 1, shrink: 1, basis: "content" } },
          frame: { inline: "fill" },
          surface: { text: tokens.color.text },
          text: { size: 15, line: 1.2 },
          interaction: {
            focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
            caret: tokens.color.accent,
          },
          decor: { placeholder: { surface: { text: tokens.color.muted } } },
        },
        Results: {
          layout: { kind: "stack", gap: tokens.space.xs },
          scroll: { block: "auto", overscroll: "contain", scrollbar: "thin" },
        },
        Status: {
          layout: { kind: "stack", gap: tokens.space.sm, align: "center", distribute: "center" },
          frame: { block: { min: 190 } },
          padding: tokens.space.xl,
          surface: { fill: tokens.color.well, text: tokens.color.muted },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.control },
          text: { align: "center" },
          when: [{ state: { mode: "error" }, apply: { surface: { text: tokens.color.accent } } }],
          motion: {
            enter: {
              from: { effect: { opacity: 0 }, transform: { block: 14, scale: 0.96 } },
              using: tokens.motion.settle,
            },
            exit: {
              to: { effect: { opacity: 0 }, transform: { block: 12, scale: 0.98 } },
              using: tokens.motion.snap,
            },
          },
        },
        StatusTitle: { text: { size: 15, weight: 720 } },
        StatusDetail: { frame: { inline: { max: 380 } }, text: { size: 12, line: 1.5 } },
        Retry: {
          use: focusable,
          frame: { block: 44 },
          padding: { inline: tokens.space.md },
          surface: { fill: tokens.color.accent, text: tokens.color.accentInk },
          shape: { radius: tokens.radius.control },
          effect: { shadow: tokens.shadow.control },
          text: { size: 12, weight: 720 },
        },
        Result: {
          use: focusable,
          layout: {
            kind: "grid",
            columns: [{ fraction: 1 }, "content"],
            gap: tokens.space.md,
            align: "center",
          },
          frame: { block: { min: tokens.size.result } },
          padding: { inline: tokens.space.md, block: tokens.space.sm },
          surface: { fill: "transparent", text: tokens.color.text },
          position: { kind: "relative" },
          when: [
            { native: "hover", apply: { surface: { fill: tokens.color.panelRaised } } },
            { native: "selected", apply: { surface: { text: tokens.color.accentInk } } },
          ],
          motion: { change: { surface: tokens.motion.snap } },
        },
        Selection: {
          position: { kind: "absolute", inset: 0, layer: 0 },
          surface: { fill: tokens.gradient.selection },
          shape: { radius: tokens.radius.control },
          effect: { shadow: tokens.shadow.control },
          interaction: { pointer: "none" },
          motion: { shared: { id: "active-result", using: tokens.motion.settle } },
        },
        ResultCopy: {
          layout: { kind: "stack", gap: tokens.space.xs },
          position: { kind: "relative", layer: 1 },
          text: { align: "start" },
        },
        ResultLabel: { text: { size: 14, weight: 680, line: 1.2 } },
        ResultDetail: {
          surface: { text: "current" },
          effect: { opacity: 0.68 },
          text: { size: 12, line: 1.3, overflow: "ellipsis", wrap: "nowrap" },
        },
        ResultKey: { use: key, position: { kind: "relative", layer: 1 } },
        Footer: {
          layout: { kind: "row", align: "center", distribute: "between" },
          padding: { inline: tokens.space.sm, blockStart: tokens.space.md },
          stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.line } },
        },
        ResultCount: {
          frame: { contain: "layout" },
          surface: { text: tokens.color.muted },
          text: { font: tokens.font.mono, size: 11 },
          motion: {
            layout: { geometry: "text", content: "preserve", using: tokens.motion.snap },
          },
        },
        Close: {
          use: focusable,
          frame: { block: 44 },
          padding: { inline: tokens.space.md, block: tokens.space.sm },
          surface: { fill: tokens.color.panelRaised, text: tokens.color.text },
          stroke: { width: 1, line: "solid", color: tokens.color.line },
          effect: { shadow: tokens.shadow.control },
          text: { size: 12, weight: 680 },
          when: [
            {
              native: "active",
              apply: { transform: { block: 2 }, effect: { shadow: tokens.shadow.pressed } },
            },
          ],
          motion: { change: { transform: tokens.motion.press, effect: tokens.motion.snap } },
        },
      }),
    };
  },
} satisfies Preset<App, "tactile">;

export const editorialPreset = {
  tokens: {
    color: {
      canvas: { l: 0.975, c: 0.006, h: 92 },
      paper: { l: 1, c: 0, h: 0 },
      text: { l: 0.12, c: 0.012, h: 38 },
      muted: { l: 0.45, c: 0.018, h: 42 },
      line: { l: 0.19, c: 0.014, h: 38 },
      accent: { l: 0.53, c: 0.225, h: 28 },
      accentSoft: { l: 0.92, c: 0.045, h: 238 },
      focus: { l: 0.55, c: 0.2, h: 28 },
      backdrop: { l: 0.16, c: 0.01, h: 35, alpha: 0.42 },
    },
    space: { xs: 4, sm: 8, md: 14, lg: 24, xl: 38, stage: 36 },
    size: { panel: 720, result: 72 },
    radius: { control: 2, panel: 0 },
    shadow: {
      panel: [
        { x: 12, y: 14, blur: 0, color: { l: 0.12, c: 0.012, h: 38, alpha: 0.96 } },
        { y: 30, blur: 70, spread: -24, color: { l: 0.12, c: 0.012, h: 38, alpha: 0.24 } },
      ],
    },
    font: {
      body: { families: ["Inter", "Helvetica Neue", "Arial"] },
      display: { families: ["Iowan Old Style", "Baskerville", "Times New Roman"] },
    },
    motion: {
      quick: { duration: 160, easing: "decelerate" },
      layout: { spring: { duration: 390, bounce: 0 } },
    },
    z: { popover: 25 },
  },
  containers: {
    compact: { inlineBelow: 600 },
    roomy: { inlineAbove: 960 },
  },
  components: ({ tokens }) => {
    const focusable = {
      interaction: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 3, offset: 3 },
      },
    } as const;
    const presetControl = {
      frame: { block: 44 },
      padding: { inline: tokens.space.sm, block: tokens.space.sm },
      surface: { fill: "transparent", text: tokens.color.muted },
      stroke: { blockEnd: { width: 2, line: "solid", color: "transparent" } },
      text: { size: 12, weight: 700, transform: "uppercase" },
      when: [
        { native: "hover", apply: { surface: { text: tokens.color.text } } },
        {
          native: "pressed",
          apply: {
            surface: { text: tokens.color.text },
            stroke: { blockEnd: { width: 2, line: "solid", color: tokens.color.accent } },
          },
        },
        {
          container: "compact",
          apply: { padding: { inline: tokens.space.xs, block: tokens.space.sm } },
        },
      ],
      motion: { change: { surface: tokens.motion.quick, stroke: tokens.motion.quick } },
    } as const;

    return {
      CommandMenu: ({ values }) => ({
        Root: {
          layout: { kind: "grid", align: "start", distribute: "center" },
          frame: { inline: "fill", block: { min: { viewport: { axis: "block", percent: 1 } } } },
          padding: { inline: tokens.space.xl, block: tokens.space.stage },
          surface: { fill: tokens.color.canvas, text: tokens.color.text },
          text: { font: tokens.font.body },
          when: [
            {
              container: "compact",
              apply: {
                layout: { kind: "grid", align: "center", distribute: "center" },
                padding: tokens.space.xl,
              },
            },
          ],
        },
        Stage: {
          layout: { kind: "stack", gap: tokens.space.lg },
          frame: { inline: { max: 920 } },
        },
        Heading: {
          layout: {
            kind: "grid",
            columns: [160, { fraction: 1 }],
            gap: tokens.space.lg,
            align: "end",
          },
          stroke: { blockEnd: { width: 2, line: "solid", color: tokens.color.line } },
          padding: { blockEnd: tokens.space.lg },
          when: [
            {
              container: "compact",
              apply: { layout: { kind: "stack", gap: tokens.space.sm, align: "start" } },
            },
          ],
        },
        Kicker: {
          surface: { text: tokens.color.accent },
          text: { size: 11, weight: 800, transform: "uppercase", tracking: 1.2 },
        },
        Title: {
          text: { font: tokens.font.display, size: 58, weight: 500, line: 0.92 },
          when: [{ container: "compact", apply: { text: { size: 42, line: 0.96 } } }],
        },
        Summary: {
          frame: { inline: { max: 620 } },
          place: { grid: { column: { from: 2, to: 3 } } },
          surface: { text: tokens.color.muted },
          text: { size: 15, line: 1.55, wrap: "pretty" },
          when: [{ container: "compact", apply: { place: { grid: { column: 1 } } } }],
        },
        PresetNav: {
          layout: { kind: "row", gap: tokens.space.md, align: "center", wrap: true },
          frame: { inline: "content" },
          stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.line } },
          when: [
            {
              container: "compact",
              apply: {
                layout: {
                  kind: "grid",
                  columns: [{ fraction: 1 }, { fraction: 1 }, { fraction: 1 }, { fraction: 1 }],
                  gap: 0,
                  align: "center",
                },
                frame: { inline: "fill" },
              },
            },
          ],
        },
        PrecisionPreset: { use: [focusable, presetControl] },
        TactilePreset: { use: [focusable, presetControl] },
        EditorialPreset: { use: [focusable, presetControl] },
        ThemeToggle: { use: [focusable, presetControl] },
        Trigger: {
          use: focusable,
          layout: {
            kind: "grid",
            columns: [32, { fraction: 1 }, "content"],
            gap: tokens.space.md,
            align: "center",
          },
          frame: { inline: { max: 640 }, block: 60 },
          padding: { inline: tokens.space.md },
          surface: { fill: tokens.color.paper, text: tokens.color.text },
          stroke: { width: 2, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.control },
          when: [
            { native: "hover", apply: { surface: { fill: tokens.color.accentSoft } } },
            { native: "active", apply: { transform: { inline: 3, block: 3 } } },
          ],
          motion: { change: { surface: tokens.motion.quick, transform: tokens.motion.quick } },
        },
        TriggerIcon: { surface: { text: tokens.color.accent }, text: { size: 20, weight: 800 } },
        TriggerLabel: { text: { size: 15, weight: 720 } },
        TriggerKey: {
          padding: { inline: tokens.space.sm, block: tokens.space.xs },
          surface: { fill: tokens.color.text, text: tokens.color.paper },
          shape: { radius: tokens.radius.control },
          text: { size: 11, weight: 750 },
        },
        Panel: {
          layout: { kind: "stack", gap: 0 },
          frame: {
            inline: tokens.size.panel,
            block: { max: { viewport: { axis: "block", percent: 0.54 } } },
            contain: "layout",
          },
          surface: { fill: tokens.color.paper, text: tokens.color.text },
          stroke: { width: 2, line: "solid", color: tokens.color.line },
          shape: { radius: tokens.radius.panel, clip: "content" },
          effect: { shadow: tokens.shadow.panel },
          position: {
            kind: "fixed",
            anchor: { part: "Trigger" },
            place: "block-end",
            layer: tokens.z.popover,
          },
          transform: { block: values.dragOffset },
          decor: { backdrop: { surface: { fill: tokens.color.backdrop } } },
          motion: {
            enter: {
              from: { effect: { opacity: 0 }, transform: { inline: 26 } },
              using: tokens.motion.layout,
            },
            exit: {
              to: { effect: { opacity: 0 }, transform: { inline: -18 } },
              using: tokens.motion.quick,
            },
            layout: { geometry: "frame", content: "preserve", using: tokens.motion.layout },
            gesture: {
              axis: "block",
              value: values.dragOffset,
              handle: "Handle",
              bounds: [0, 520],
              rubberBand: 0.12,
              dismiss: { distance: 126, velocity: 0.62 },
              settle: tokens.motion.layout,
            },
          },
          when: [
            {
              container: "compact",
              apply: {
                frame: {
                  inline: "auto",
                  block: { max: { viewport: { axis: "block", percent: 0.9 } } },
                },
                position: {
                  kind: "fixed",
                  anchor: "none",
                  place: "auto",
                  inset: { inline: 0, blockEnd: 0 },
                },
                effect: { shadow: "none" },
              },
            },
          ],
        },
        Handle: {
          layout: { kind: "hidden" },
          when: [
            {
              container: "compact",
              apply: {
                layout: { kind: "row" },
                frame: { inline: 44, block: 4 },
                place: { align: "center" },
                margin: { blockStart: tokens.space.sm, blockEnd: tokens.space.sm },
                surface: { fill: tokens.color.line },
                interaction: { touch: "none", cursor: "grab" },
              },
            },
          ],
        },
        Search: {
          layout: {
            kind: "grid",
            columns: [32, { fraction: 1 }],
            gap: tokens.space.md,
            align: "center",
          },
          frame: { block: 62 },
          padding: { inline: tokens.space.lg },
          stroke: { blockEnd: { width: 2, line: "solid", color: tokens.color.line } },
        },
        SearchIcon: { surface: { text: tokens.color.accent }, text: { size: 18, weight: 800 } },
        SearchInput: {
          frame: { inline: "fill" },
          surface: { text: tokens.color.text },
          text: { font: tokens.font.display, size: 20, line: 1.2 },
          interaction: {
            focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
            caret: tokens.color.accent,
          },
          decor: { placeholder: { surface: { text: tokens.color.muted } } },
        },
        Results: {
          layout: { kind: "stack", gap: 0 },
          scroll: { block: "auto", overscroll: "contain", scrollbar: "thin" },
        },
        Status: {
          layout: {
            kind: "grid",
            columns: [6, { fraction: 1 }],
            gap: tokens.space.lg,
            align: "center",
          },
          frame: { block: { min: 206 } },
          padding: tokens.space.lg,
          stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.line } },
          surface: { text: tokens.color.muted },
          decor: {
            before: {
              content: "",
              frame: { inline: 6, block: "fill" },
              surface: { fill: tokens.color.accent },
            },
          },
          when: [{ state: { mode: "error" }, apply: { surface: { text: tokens.color.accent } } }],
          motion: {
            enter: {
              from: { effect: { opacity: 0 }, transform: { inline: 20 } },
              using: tokens.motion.layout,
            },
            exit: {
              to: { effect: { opacity: 0 }, transform: { inline: -14 } },
              using: tokens.motion.quick,
            },
          },
        },
        StatusTitle: {
          place: { grid: { column: 2 } },
          text: { font: tokens.font.display, size: 20, weight: 650 },
        },
        StatusDetail: {
          place: { grid: { column: 2 } },
          frame: { inline: { max: 420 } },
          text: { size: 12, line: 1.5 },
        },
        Retry: {
          use: focusable,
          place: { grid: { column: 2 } },
          frame: { block: 44, inline: "content" },
          padding: { inline: tokens.space.lg },
          surface: { fill: tokens.color.accent, text: tokens.color.paper },
          text: { size: 12, weight: 800, transform: "uppercase" },
        },
        Result: {
          use: focusable,
          layout: {
            kind: "grid",
            columns: [44, { fraction: 1 }],
            gap: tokens.space.md,
            align: "center",
          },
          frame: { block: { min: tokens.size.result } },
          padding: { inline: tokens.space.lg, block: tokens.space.sm },
          surface: { fill: "transparent", text: tokens.color.text },
          stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.line } },
          position: { kind: "relative" },
          when: [
            { native: "hover", apply: { surface: { fill: tokens.color.canvas } } },
            { native: "selected", apply: { surface: { text: tokens.color.text } } },
          ],
          motion: { change: { surface: tokens.motion.quick } },
        },
        Selection: {
          position: { kind: "absolute", inset: 0, layer: 0 },
          surface: { fill: tokens.color.accentSoft },
          stroke: { inlineStart: { width: 6, line: "solid", color: tokens.color.accent } },
          interaction: { pointer: "none" },
          motion: { shared: { id: "active-result", using: tokens.motion.layout } },
        },
        ResultCopy: {
          layout: { kind: "stack", gap: tokens.space.xs },
          place: { grid: { column: 2 } },
          position: { kind: "relative", layer: 1 },
          text: { align: "start" },
        },
        ResultLabel: { text: { font: tokens.font.display, size: 17, weight: 650, line: 1.1 } },
        ResultDetail: {
          surface: { text: "current" },
          effect: { opacity: 0.62 },
          text: { size: 12, line: 1.35, overflow: "ellipsis", wrap: "nowrap" },
        },
        ResultKey: {
          place: { grid: { column: 1, row: 1 } },
          position: { kind: "relative", layer: 1 },
          frame: { inline: 32, block: 32 },
          layout: { kind: "grid", align: "center", distribute: "center" },
          surface: { fill: tokens.color.text, text: tokens.color.paper },
          text: { size: 11, weight: 800 },
        },
        Footer: {
          layout: { kind: "row", align: "center", distribute: "between" },
          padding: { inline: tokens.space.lg, block: tokens.space.md },
          stroke: { blockStart: { width: 2, line: "solid", color: tokens.color.line } },
        },
        ResultCount: {
          frame: { contain: "layout" },
          surface: { text: tokens.color.muted },
          text: { size: 11, weight: 700, transform: "uppercase" },
          motion: {
            layout: { geometry: "text", content: "preserve", using: tokens.motion.quick },
          },
        },
        Close: {
          use: focusable,
          frame: { block: 44 },
          padding: { inline: tokens.space.lg, block: tokens.space.sm },
          surface: { fill: tokens.color.accent, text: tokens.color.paper },
          shape: { radius: tokens.radius.control },
          text: { size: 12, weight: 800, transform: "uppercase" },
          when: [
            { native: "hover", apply: { transform: { inline: 2 } } },
            { native: "active", apply: { transform: { inline: 4 } } },
          ],
          motion: { change: { transform: tokens.motion.quick } },
        },
      }),
    };
  },
} satisfies Preset<App, "editorial">;
