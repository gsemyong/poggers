import { expect, it } from "vitest";

import type { Program } from "../../../core/application";
import type { BrowserMainThread } from "../platform";
import {
  createAudioAsset,
  createImageAsset,
  type WebAudioAsset,
  type WebImageAsset,
  type WebPresentation,
  type WebPresentationLanguage,
  type WebStyle,
} from "./language";
import { createSpring, type WebSpringOptions } from "./motion";

type Fixture = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Components: {
          Drawer: {
            State: { open: boolean; selected: boolean };
            Elements: { Root: "main"; Panel: "dialog"; Close: "button"; Icon: "img" };
          };
        };
      }
    >;
  };
};

const parameters = {
  color: {
    panel: { oklch: [0.99, 0.002, 250] },
    content: { oklch: [0.2, 0.01, 250] },
  },
  space: { panel: 24, control: 12 },
  radius: { panel: 28 },
  motion: { panel: createSpring({ duration: 420, bounce: 0.12 }) },
} as const;

const presentation = ((values) => {
  const control = (selected: boolean): WebStyle => ({
    layout: { padding: { block: values.space.control, inline: values.space.panel } },
    paint: { opacity: selected ? 0.7 : 1 },
  });

  return {
    Drawer: ({ state }) => ({
      Root: {
        layout: { model: { kind: state.open ? "overlay" : "hidden" } },
      },
      Panel: {
        layout: {
          model: { kind: "flow", direction: "block", gap: values.space.control },
          inlineSize: { percent: 100 },
          maxInlineSize: 420,
          padding: values.space.panel,
          container: { name: "drawer", axis: "inline" },
        },
        paint: { fill: values.color.panel, radius: values.radius.panel },
        text: { color: values.color.content, family: "system" },
        motion: {
          opacity: { value: state.open ? 1 : 0, transition: values.motion.panel },
          transform: {
            value: { translate: { y: state.open ? 0 : 24 }, scale: state.open ? 1 : 0.98 },
            transition: values.motion.panel,
          },
        },
        rules: [
          {
            when: { container: { name: "drawer", maxInlineSize: 360 } },
            use: { layout: { padding: values.space.control } },
          },
        ],
      },
      Close: control(state.selected),
    }),
  };
}) satisfies WebPresentation<Fixture, typeof parameters>;

type FeedbackParameters = Readonly<{ audio: { control: WebAudioAsset | undefined } }>;
const withFeedback = ((values) => ({
  Drawer: () => ({
    Close: values.audio.control ? { feedback: { activate: { audio: values.audio.control } } } : {},
  }),
})) satisfies WebPresentation<Fixture, FeedbackParameters>;
const audible = withFeedback({ audio: { control: createAudioAsset("control.wav") } });
const silent = withFeedback({ audio: { control: undefined } });

type ImageParameters = Readonly<{ image: { icon: WebImageAsset } }>;
const withImage = ((values) => ({
  Drawer: () => ({ Icon: { image: values.image.icon } }),
})) satisfies WebPresentation<Fixture, ImageParameters>;
const illustrated = withImage({ image: { icon: createImageAsset("accent.svg") } });
type ButtonPresentation = WebPresentationLanguage["Declarations"]["button"];
// @ts-expect-error Image source substitution is valid only for semantic img Elements.
const invalidButtonImage: ButtonPresentation = { image: createImageAsset("accent.svg") };
// @ts-expect-error Perceived and physical spring forms are intentionally disjoint.
const invalidSpring: WebSpringOptions = { duration: 300, stiffness: 200 };

it("creates immutable, validated parameter assets", () => {
  expect(createAudioAsset(new URL("https://example.test/control.wav"), { gain: 0.4 })).toEqual({
    source: "https://example.test/control.wav",
    gain: 0.4,
  });
  expect(() => createAudioAsset("", {})).toThrow("source is required");
  expect(() => createAudioAsset("control.wav", { gain: -1 })).toThrow("gain");
  expect(() => createAudioAsset("control.wav", { playbackRate: 0 })).toThrow("playbackRate");
  expect(createImageAsset(new URL("https://example.test/accent.svg"))).toEqual({
    source: "https://example.test/accent.svg",
  });
  expect(() => createImageAsset("")).toThrow("source is required");
  expect(Object.isFrozen(createImageAsset("accent.svg"))).toBe(true);
});

it("types arbitrary parameters, Component state, Elements, and native conditions", () => {
  expect(invalidButtonImage).toHaveProperty("image");
  expect(invalidSpring).toHaveProperty("duration");
  expect(presentation).toBeTypeOf("function");
  expect(audible.Drawer().Close).toHaveProperty("feedback");
  expect(silent.Drawer().Close).toEqual({});
  expect(illustrated.Drawer().Icon.image.source).toBe("accent.svg");
});
