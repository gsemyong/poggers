import { describe, expect, expectTypeOf, it } from "vitest";

import type { Animation } from "@/core/ui/presentation";
import {
  createAudioAsset,
  createContainer,
  createImageAsset,
  type WebContainer,
} from "@/platforms/web/presentation";
import { decay, follow, spring, track, tween } from "@/platforms/web/presentation/dynamics";

describe("web Presentation language", () => {
  it("constructs immutable typed Animation descriptions without resources", () => {
    const animations: readonly Animation<number, number, number>[] = [
      spring({ stiffness: 420, damping: 38 }),
      follow(240),
      decay({ timeConstant: 300 }),
      tween({ duration: 180 }),
      track({
        samples: [
          { time: 0, value: 0 },
          { time: 180, value: 1 },
        ],
      }),
    ];
    expect(animations.every(Object.isFrozen)).toBe(true);
  });

  it("creates immutable image and audio asset meaning", () => {
    expect(createImageAsset("/icon.png")).toEqual({ source: "/icon.png" });
    expect(createAudioAsset("/press.mp3", { gain: 0.4, playbackRate: 1.2 })).toEqual({
      source: "/press.mp3",
      gain: 0.4,
      playbackRate: 1.2,
    });
  });

  it("creates validated reusable container identities", () => {
    const workspace = createContainer("workspace");

    expect(workspace).toBe("workspace");
    expectTypeOf(workspace).toMatchTypeOf<WebContainer<"workspace">>();
    expectTypeOf<string>().not.toMatchTypeOf<WebContainer>();
    expect(() => createContainer("not a container")).toThrow("Invalid web container identity");
  });
});
