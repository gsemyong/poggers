import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebFontBackend, webFontFamily } from "./font";
import type { FontAsset } from "./language";

const font: FontAsset = {
  family: "Fixture Sans",
  fallback: ["system-ui"],
  display: "swap",
  sources: [
    {
      file: "/fixture.woff2",
      format: "woff2",
      style: "normal",
      weight: [400, 700],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("web font backend", () => {
  it("shares one native face and releases it after the final idempotent lease", async () => {
    const loads: FakeFontFace[] = [];
    class FakeFontFace {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {
        loads.push(this);
      }

      load = vi.fn(() => Promise.resolve(this));
    }
    vi.stubGlobal("FontFace", FakeFontFace);
    const add = vi.fn();
    const remove = vi.fn();
    const document = { fonts: { add, delete: remove } } as unknown as Document;
    const backend = createWebFontBackend();

    const first = backend.acquire(document, font);
    const second = backend.acquire(document, font);
    await Promise.resolve();

    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({
      family: "Fixture Sans",
      descriptors: { display: "swap", style: "normal", weight: "400 700" },
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(loads[0]?.load).toHaveBeenCalledTimes(1);

    first.release();
    first.release();
    expect(remove).not.toHaveBeenCalled();
    second.release();
    second.release();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(loads[0]);
  });

  it("contains load failure and derives a deterministic family when none is authored", async () => {
    class FailingFontFace {
      load = vi.fn(() => Promise.reject(new Error("font unavailable")));
    }
    vi.stubGlobal("FontFace", FailingFontFace);
    const add = vi.fn();
    const remove = vi.fn();
    const document = { fonts: { add, delete: remove } } as unknown as Document;
    const generated = { ...font, family: undefined };
    const backend = createWebFontBackend();

    const lease = backend.acquire(document, generated);
    await Promise.resolve();
    await Promise.resolve();

    expect(webFontFamily(generated)).toMatch(/^poggers-[a-z0-9]+$/);
    expect(add).toHaveBeenCalledTimes(1);
    lease.release();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
