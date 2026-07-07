import { describe, it, expect } from "bun:test";
import { createSingleNodeSequencer } from "infra/store/single-node";

describe("ServerSequencer contract", () => {
  it("starts at 1", () => {
    const seq = createSingleNodeSequencer();
    expect(seq.next("s")).toBe(1);
  });

  it("allocates sequentially", () => {
    const seq = createSingleNodeSequencer();
    expect(seq.next("s")).toBe(1);
    expect(seq.next("s")).toBe(2);
    expect(seq.next("s")).toBe(3);
    expect(seq.next("s")).toBe(4);
  });

  it("isolates scopes", () => {
    const seq = createSingleNodeSequencer();
    expect(seq.next("a")).toBe(1);
    expect(seq.next("b")).toBe(1);
    expect(seq.next("a")).toBe(2);
    expect(seq.next("b")).toBe(2);
    expect(seq.next("a")).toBe(3);
  });

  it("each new scope starts at 1", () => {
    const seq = createSingleNodeSequencer();
    expect(seq.next("unknown")).toBe(1);
    expect(seq.next("another")).toBe(1);
    expect(seq.next("unknown")).toBe(2);
  });
});
