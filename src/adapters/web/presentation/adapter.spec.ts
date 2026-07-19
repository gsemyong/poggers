import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  createNativeFeedbackHost,
  createNativeAudioOutput,
  createWebPresentationAdapter,
  type WebFeedbackHost,
  type WebStyleHost,
} from "./adapter";
import { createAudioAsset, createImageAsset } from "./language";
import { createSpring, type WebMotionHost } from "./motion";

type FakeElement = Element & {
  readonly classes: Set<string>;
  readonly attributeWrites: string[];
};

function createElement(
  ownerDocument: object,
  initial: readonly string[] = [],
  localName = "div",
): FakeElement {
  const classes = new Set(initial);
  const attributes = new Map<string, string>();
  const attributeWrites: string[] = [];
  return {
    ownerDocument,
    localName,
    classes,
    attributeWrites,
    disabled: false,
    parentElement: null,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
      attributeWrites.push(`${name}=${value}`);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
      attributeWrites.push(`${name}-`);
    },
    classList: {
      add: (...values: string[]) => values.forEach((value) => classes.add(value)),
      remove: (...values: string[]) =>
        values.forEach((value) => {
          if (!value) throw new SyntaxError("A class token cannot be empty.");
          classes.delete(value);
        }),
      replace: (previous: string, next: string) => {
        if (!classes.delete(previous)) return false;
        classes.add(next);
        return true;
      },
    },
  } as unknown as FakeElement;
}

function createFeedbackHost(log: unknown[]): WebFeedbackHost {
  return {
    set(target, feedback) {
      log.push([target, feedback]);
    },
    dispose() {
      log.push("dispose");
    },
  };
}

function createHost(log: string[]): WebStyleHost {
  return {
    replace(css) {
      log.push(css);
    },
    dispose() {
      log.push("dispose");
    },
  };
}

function createMotionHost(log: unknown[]): WebMotionHost {
  return {
    begin(updates) {
      log.push(["begin", updates]);
    },
    set(target, motion) {
      log.push([target, motion]);
    },
    complete() {
      log.push("complete");
    },
    dispose() {
      log.push("dispose");
    },
  };
}

describe("web Presentation adapter", () => {
  it("shares deterministic CSS classes without touching unrelated classes", async () => {
    const ownerDocument = {};
    const log: string[] = [];
    const root = createElement(ownerDocument, ["authored"]);
    const first = createElement(ownerDocument);
    const second = createElement(ownerDocument);
    const session = createWebPresentationAdapter({ createStyleHost: () => createHost(log) }).create(
      {
        boundary: root,
        targets: { Root: () => [root], Item: () => [first, second] },
      },
    );

    session.commit({
      Root: { layout: { model: { kind: "flow", direction: "block" } } },
      Item: { paint: { opacity: 0.7 } },
    });
    await Promise.resolve();

    const itemClass = [...first.classes][0];
    expect(itemClass).toBeDefined();
    expect(second.classes).toEqual(new Set([itemClass!]));
    expect(root.classes).toContain("authored");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^@layer poggers\.reset,poggers\.presentation;/);
    expect(log[0]).toContain("box-sizing:border-box");
    expect(log[0]).toContain("opacity:0.7");

    session.commit({ Root: { paint: { opacity: 0.5 } } });
    expect(first.classes.size).toBe(0);
    expect(second.classes.size).toBe(0);
    expect(root.classes).toContain("authored");
    expect(root.classes.size).toBe(2);

    session.dispose();
    expect(root.classes).toEqual(new Set(["authored"]));
    expect(log.at(-1)).toBe("dispose");
    expect(() => session.commit({})).toThrow("disposed web Presentation session");
  });

  it("deduplicates rules across sessions in the same Document", async () => {
    const ownerDocument = {};
    const log: string[] = [];
    let hosts = 0;
    const adapter = createWebPresentationAdapter({
      createStyleHost: () => {
        hosts += 1;
        return createHost(log);
      },
    });
    const first = createElement(ownerDocument);
    const second = createElement(ownerDocument);
    const a = adapter.create({ boundary: first, targets: { Root: () => [first] } });
    const b = adapter.create({ boundary: second, targets: { Root: () => [second] } });
    const declaration = { Root: { paint: { opacity: 0.6 } } } as const;

    a.commit(declaration);
    b.commit(declaration);
    await Promise.resolve();
    expect(hosts).toBe(1);
    expect(first.classes).toEqual(second.classes);
    expect(log.at(-1)?.match(/opacity:0\.6/g)).toHaveLength(1);

    a.dispose();
    expect(log.at(-1)).not.toBe("dispose");
    b.dispose();
    expect(log.at(-1)).toBe("dispose");
  });

  it("rejects a native Element resolved by conflicting targets before mutation", () => {
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    const session = createWebPresentationAdapter({ createStyleHost: () => createHost([]) }).create({
      boundary: target,
      targets: { Root: () => [target], Label: () => [target] },
    });

    expect(() =>
      session.commit({
        Root: { paint: { opacity: 1 } },
        Label: { paint: { opacity: 0.5 } },
      }),
    ).toThrow("already styled by another target");
    expect(target.classes.size).toBe(0);
    session.dispose();
  });

  it("coalesces sessions and keeps previously emitted rules warm", async () => {
    const ownerDocument = {};
    const log: string[] = [];
    const adapter = createWebPresentationAdapter({ createStyleHost: () => createHost(log) });
    const first = createElement(ownerDocument);
    const second = createElement(ownerDocument);
    const a = adapter.create({ boundary: first, targets: { Root: () => [first] } });
    const b = adapter.create({ boundary: second, targets: { Root: () => [second] } });
    const compact = { Root: { paint: { opacity: 0.7 } } } as const;
    const comfortable = { Root: { paint: { opacity: 1 } } } as const;

    a.commit(compact);
    b.commit(compact);
    await Promise.resolve();
    expect(log).toHaveLength(1);

    a.commit(comfortable);
    b.commit(comfortable);
    await Promise.resolve();
    expect(log).toHaveLength(2);

    a.commit(compact);
    b.commit(compact);
    await Promise.resolve();
    expect(log).toHaveLength(2);

    a.dispose();
    b.dispose();
    expect(log.at(-1)).toBe("dispose");
  });

  it("binds feedback-only meaning without generating a CSS class", () => {
    const ownerDocument = {};
    const feedbackLog: unknown[] = [];
    const styleLog: string[] = [];
    const target = createElement(ownerDocument);
    const audio = createAudioAsset("control.wav");
    const session = createWebPresentationAdapter({
      createStyleHost: () => createHost(styleLog),
      createFeedbackHost: () => createFeedbackHost(feedbackLog),
    }).create({ boundary: target, targets: { Control: () => [target] } });

    session.commit({ Control: { feedback: { activate: { audio } } } });
    expect(target.classes.size).toBe(0);
    expect(feedbackLog).toEqual([[target, { activate: { audio } }]]);
    expect(styleLog).toEqual([]);

    session.commit({ Control: { feedback: { activate: { audio } } } });
    expect(feedbackLog).toHaveLength(1);

    session.commit({});
    expect(feedbackLog.at(-1)).toEqual([target, undefined]);
    session.dispose();
    expect(feedbackLog.at(-1)).toBe("dispose");
  });

  it("commits motion independently, suppresses equivalent work, and owns cleanup", () => {
    const ownerDocument = {};
    const motionLog: unknown[] = [];
    const styleLog: string[] = [];
    const target = createElement(ownerDocument);
    const spring = createSpring({ duration: 360, bounce: 0.1 });
    const session = createWebPresentationAdapter({
      createStyleHost: () => createHost(styleLog),
      createMotionHost: () => createMotionHost(motionLog),
    }).create({ boundary: target, targets: { Panel: () => [target] } });

    session.commit({ Panel: { motion: { opacity: { value: 0, transition: spring } } } });
    expect(motionLog.map((entry) => (Array.isArray(entry) ? entry[0] : entry))).toEqual([
      "begin",
      target,
      "complete",
    ]);
    expect(styleLog).toEqual([]);
    expect(target.classes.size).toBe(0);

    session.commit({
      Panel: {
        motion: {
          opacity: { value: 0, transition: createSpring({ duration: 360, bounce: 0.1 }) },
        },
      },
    });
    expect(motionLog.filter((entry) => Array.isArray(entry) && entry[0] === target)).toHaveLength(
      1,
    );

    session.commit({ Panel: { motion: { opacity: { value: 1, transition: spring } } } });
    expect(motionLog.filter((entry) => Array.isArray(entry) && entry[0] === target)).toHaveLength(
      2,
    );
    session.commit({});
    expect(motionLog.at(-2)).toEqual([target, undefined]);
    expect(motionLog.at(-1)).toBe("complete");
    session.dispose();
    expect(motionLog.at(-1)).toBe("dispose");
  });

  it("closes the layout transaction when native realization throws", () => {
    const ownerDocument = {};
    const motionLog: unknown[] = [];
    const target = createElement(ownerDocument);
    target.classList.add = () => {
      throw new Error("native mutation failed");
    };
    const session = createWebPresentationAdapter({
      createMotionHost: () => createMotionHost(motionLog),
    }).create({ boundary: target, targets: { Panel: () => [target] } });

    expect(() =>
      session.commit({
        Panel: {
          layout: { padding: 12 },
          motion: { layout: { transition: createSpring({ duration: 240, bounce: 0.1 }) } },
        },
      }),
    ).toThrow("native mutation failed");
    expect(motionLog.map((entry) => (Array.isArray(entry) ? entry[0] : entry))).toEqual([
      "begin",
      "complete",
    ]);
  });

  it("realizes cold layout styles before the post-mutation motion read", () => {
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    const events: string[] = [];
    const session = createWebPresentationAdapter({
      createStyleHost: () => ({
        replace: () => events.push("style"),
        dispose() {},
      }),
      createMotionHost: () => ({
        begin: () => events.push("begin"),
        set: () => events.push("set"),
        complete: () => events.push("complete"),
        dispose() {},
      }),
    }).create({ boundary: target, targets: { Panel: () => [target] } });

    session.commit({
      Panel: {
        layout: { minBlockSize: 320 },
        motion: { layout: { transition: createSpring({ duration: 300, bounce: 0.1 }) } },
      },
    });
    expect(events).toEqual(["begin", "set", "style", "complete"]);
    session.dispose();
  });

  it("rejects overlapping static and frame-rate property ownership", () => {
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    const session = createWebPresentationAdapter({ createStyleHost: () => createHost([]) }).create({
      boundary: target,
      targets: { Panel: () => [target] },
    });

    expect(() =>
      session.commit({
        Panel: { paint: { opacity: 1 }, motion: { opacity: { value: 0 } } },
      }),
    ).toThrow("both style and motion");
    expect(() =>
      session.commit({
        Panel: {
          rules: [{ when: { pseudo: "hover" }, use: { transform: { scale: 1.1 } } }],
          motion: { transform: { value: { scale: 1 } } },
        },
      }),
    ).toThrow("both style and motion");
    session.dispose();
  });

  it("substitutes image assets in place and restores authored Structure", () => {
    const ownerDocument = {};
    const styleLog: string[] = [];
    const boundary = createElement(ownerDocument);
    const icon = createElement(ownerDocument, [], "img");
    icon.setAttribute("src", "authored.svg");
    icon.attributeWrites.length = 0;
    const warm = createImageAsset("warm.svg");
    const cool = createImageAsset("cool.svg");
    const session = createWebPresentationAdapter({
      createStyleHost: () => createHost(styleLog),
    }).create({ boundary, targets: { Icon: () => [icon] } });

    session.commit({ Icon: { image: warm } });
    expect(icon.getAttribute("src")).toBe("warm.svg");
    expect(icon.attributeWrites).toEqual(["src=warm.svg"]);
    expect(icon.classes.size).toBe(0);
    expect(styleLog).toEqual([]);

    session.commit({ Icon: { image: createImageAsset("warm.svg") } });
    expect(icon.attributeWrites).toEqual(["src=warm.svg"]);
    session.commit({ Icon: { image: cool } });
    expect(icon.getAttribute("src")).toBe("cool.svg");
    expect(icon.attributeWrites.at(-1)).toBe("src=cool.svg");

    session.dispose();
    expect(icon.getAttribute("src")).toBe("authored.svg");
    expect(icon.attributeWrites.at(-1)).toBe("src=authored.svg");
  });

  it("rejects image meaning on a non-image Structure target", () => {
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    const session = createWebPresentationAdapter().create({
      boundary: target,
      targets: { Icon: () => [target] },
    });

    expect(() => session.commit({ Icon: { image: createImageAsset("icon.svg") } })).toThrow(
      "only target an img Element",
    );
    session.dispose();
  });

  it("normalizes passive mouse, touch, keyboard, disabled, and disposal semantics", () => {
    const listeners = new Map<string, EventListener>();
    const ownerDocument = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.set(type, listener as EventListener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    };
    const target = createElement(ownerDocument);
    const audio = createAudioAsset("control.wav");
    const calls: string[] = [];
    const host = createNativeFeedbackHost(target, {
      prepare: () => calls.push("prepare"),
      play: () => calls.push("play"),
      dispose: () => calls.push("dispose"),
    });
    host.set(target, { activate: { audio } });

    const emit = (type: string, event: object) =>
      listeners.get(type)?.({ composedPath: () => [target], ...event } as unknown as Event);
    emit("pointerdown", { button: 0, pointerType: "mouse" });
    emit("click", { detail: 1 });
    expect(calls).toEqual(["prepare", "play"]);

    emit("pointerdown", { button: 0, pointerType: "touch" });
    emit("click", { detail: 1 });
    emit("click", { detail: 0 });
    expect(calls).toEqual(["prepare", "play", "play", "play"]);

    (target as unknown as { disabled: boolean }).disabled = true;
    emit("pointerdown", { button: 0, pointerType: "mouse" });
    emit("click", { detail: 0 });
    expect(calls).toEqual(["prepare", "play", "play", "play"]);

    host.dispose();
    expect(calls.at(-1)).toBe("dispose");
    expect(listeners.size).toBe(0);
    host.dispose();
    expect(calls.filter((call) => call === "dispose")).toHaveLength(1);
  });

  it("shares one AudioContext and decoded buffer across warm playback", async () => {
    let contexts = 0;
    let decodes = 0;
    let fetches = 0;
    let sources = 0;
    let closes = 0;
    let disconnects = 0;
    class FakeAudioContext {
      state = "suspended";
      destination = {};
      constructor() {
        contexts += 1;
      }
      async decodeAudioData() {
        decodes += 1;
        return {};
      }
      async resume() {
        this.state = "running";
      }
      createBufferSource() {
        sources += 1;
        return {
          buffer: undefined,
          playbackRate: { value: 1 },
          connect() {
            return this;
          },
          disconnect() {
            disconnects += 1;
          },
          addEventListener() {},
          start() {},
          stop() {},
        };
      }
      createGain() {
        return {
          gain: { value: 1 },
          connect() {
            return this;
          },
          disconnect() {
            disconnects += 1;
          },
        };
      }
      async close() {
        closes += 1;
        this.state = "closed";
      }
    }
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    });
    const output = createNativeAudioOutput({
      defaultView: { AudioContext: FakeAudioContext },
    } as unknown as Document);
    const asset = createAudioAsset("control.wav", { gain: 0.4 });

    output.prepare(asset);
    output.prepare(asset);
    output.play(asset);
    output.play(asset);
    for (let index = 0; index < 8; index++) await Promise.resolve();

    expect({ contexts, fetches, decodes, sources }).toEqual({
      contexts: 1,
      fetches: 1,
      decodes: 1,
      sources: 2,
    });
    output.dispose();
    await Promise.resolve();
    expect(closes).toBe(1);
    expect(disconnects).toBe(4);
    vi.unstubAllGlobals();
  });

  it("emits each declaration meaning once for random commit traces", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 40 }),
        async (opacities) => {
          const ownerDocument = {};
          const log: string[] = [];
          const target = createElement(ownerDocument);
          const session = createWebPresentationAdapter({
            createStyleHost: () => createHost(log),
          }).create({ boundary: target, targets: { Root: () => [target] } });

          for (const opacity of opacities) {
            session.commit({ Root: { paint: { opacity: opacity / 5 } } });
            await Promise.resolve();
          }

          expect(log).toHaveLength(new Set(opacities).size);
          expect(target.classes.size).toBe(1);
          session.dispose();
        },
      ),
      { numRuns: 50 },
    );
  });
});
