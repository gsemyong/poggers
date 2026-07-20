import { describe, expect, it } from "vitest";

import type { Animation } from "../../../../core/presentation";
import { decay, follow, spring, track, tween } from "./dynamics";
import { createAudioAsset, createImageAsset } from "./language";

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
});
