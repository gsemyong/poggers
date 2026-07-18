import { describe, expect, it } from "vitest";

import { createReferencePresentationAdapter } from "./presentation.reference";

describe("reference presentation adapter", () => {
  it("commits a whole component atomically across repeated Part targets", () => {
    const adapter = createReferencePresentationAdapter({
      allocatedInlineSize: 480,
      reducedMotion: false,
    });
    const boundary = { id: "badge" };
    const firstLabel = { id: "label-1" };
    const secondLabel = { id: "label-2" };
    const session = adapter.create({
      boundary,
      parts: { Root: () => [boundary], Label: () => [firstLabel, secondLabel] },
    });

    expect(session.platform).toEqual({ allocatedInlineSize: 480, reducedMotion: false });
    session.commit({ Root: { tone: "accent" }, Label: { visible: true } });

    expect(adapter.sessions).toEqual([
      {
        boundary,
        disposed: false,
        commits: [
          {
            sequence: 0,
            declarations: [
              { part: "Root", target: boundary, declaration: { tone: "accent" } },
              { part: "Label", target: firstLabel, declaration: { visible: true } },
              { part: "Label", target: secondLabel, declaration: { visible: true } },
            ],
          },
        ],
      },
    ]);
  });

  it("isolates targets and rejects updates after idempotent disposal", () => {
    const adapter = createReferencePresentationAdapter({
      allocatedInlineSize: 240,
      reducedMotion: true,
    });
    const first = adapter.create({
      boundary: { id: "first" },
      parts: { Root: () => [{ id: "first-root" }] },
    });
    const second = adapter.create({
      boundary: { id: "second" },
      parts: { Root: () => [{ id: "second-root" }] },
    });

    first.commit({ Root: { visible: true } });
    second.commit({ Root: { visible: false } });
    first.dispose();
    first.dispose();

    expect(adapter.sessions[0]?.disposed).toBe(true);
    expect(adapter.sessions[1]?.disposed).toBe(false);
    expect(adapter.sessions[0]?.commits[0]?.declarations[0]?.target.id).toBe("first-root");
    expect(adapter.sessions[1]?.commits[0]?.declarations[0]?.target.id).toBe("second-root");
    expect(() => first.commit({ Root: { visible: false } })).toThrow(
      "Cannot commit a disposed presentation session.",
    );
  });
});
