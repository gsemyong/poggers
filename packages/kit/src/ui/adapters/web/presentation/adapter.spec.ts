import { afterEach, describe, expect, it, vi } from "vitest";

import type { LayoutBackend, MotionBackend, MotionScheduler, MotionTarget } from "../motion";
import { inspectVirtualCollectionHost } from "../runtime";
import { createWebPresentationAdapter } from "./adapter";
import type { WebFontBackend } from "./font";
import type { WebPresentationTokens } from "./language";

type TestTheme = {
  motion: {
    sheet: { readonly spring: { readonly stiffness: 900; readonly damping: 60 } };
  };
} & WebPresentationTokens;

type FakeElement = Element & {
  hidden: boolean;
  readonly style: CSSStyleDeclaration & Record<string, string>;
  emit(type: string): void;
};

afterEach(() => vi.unstubAllGlobals());

function createElement(id: string, width = 320, height = 480): FakeElement {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, Set<EventListener>>();
  const style = {} as CSSStyleDeclaration & Record<string, string>;
  return {
    id,
    style,
    hidden: false,
    isConnected: true,
    children: [] as unknown as HTMLCollection,
    getBoundingClientRect: () =>
      ({ width, height, x: 0, y: 0, top: 0, right: width, bottom: height, left: 0 }) as DOMRect,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    matches: (selector: string) =>
      selector === ":focus-visible" && attributes.get("data-focus-visible") === "true",
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (typeof listener !== "function") return;
      const current = listeners.get(type) ?? new Set<EventListener>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (typeof listener === "function") listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) listener(new Event(type));
    },
  } as unknown as FakeElement;
}

function createScheduler(): MotionScheduler & { flush(): void } {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  return {
    now: () => 0,
    requestFrame(callback) {
      const handle = next++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      frames.delete(handle as number);
    },
    flush() {
      const current = [...frames.values()];
      frames.clear();
      current.forEach((callback) => callback(0));
    },
  };
}

function createMotionBackend(log: Array<Readonly<Record<string, unknown>>>): MotionBackend {
  return {
    create(key, initial) {
      let value = initial;
      let velocity = 0;
      log.push({ kind: "create", key, initial });
      return {
        read: () => value,
        velocity: () => velocity,
        write(next) {
          value = next;
          velocity = 0;
          log.push({ kind: "direct", key, value: next });
        },
        retarget(target: MotionTarget) {
          value = target.value;
          velocity = target.velocity;
          log.push({
            kind: "target",
            key,
            value: target.value,
            velocity: target.velocity,
            transition: target.transition,
          });
          target.settled();
        },
        stop() {
          log.push({ kind: "stop", key });
        },
        dispose() {
          log.push({ kind: "dispose", key });
        },
      };
    },
  };
}

describe("web presentation adapter", () => {
  it("translates styles and distinguishes direct writes from velocity-bearing targets", () => {
    const log: Array<Readonly<Record<string, unknown>>> = [];
    const scheduler = createScheduler();
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend(log),
      scheduler,
    });
    const root = createElement("root", 375, 700);
    const repeated = [createElement("first"), createElement("second")];
    const icon = createElement("icon");
    const session = adapter.create({
      boundary: root,
      targets: { Root: () => [root], Item: () => repeated, Icon: () => [icon] },
    });

    session.commit({
      Root: {
        paint: { fill: { l: 0.98, c: 0.01, h: 250 } },
        motion: { translation: { block: 24 } },
      },
      Item: { paint: { opacity: 0.6 } },
      Icon: { resource: { kind: "symbol", source: "/close.svg" } },
    });
    scheduler.flush();

    expect(root.style.backgroundColor).toBe("oklch(0.98 0.01 250)");
    expect(repeated.map(({ style }) => style.opacity)).toEqual(["0.6", "0.6"]);
    expect(icon.getAttribute("src")).toBe("/close.svg");
    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "direct",
        key: expect.stringContaining("translateY"),
        value: 24,
      }),
    );

    session.commit({
      Root: {
        motion: {
          translation: {
            block: {
              target: 0,
              transition: { spring: { stiffness: 900, damping: 60 } },
              velocity: 1.75,
            },
          },
        },
      },
    });
    scheduler.flush();

    expect(log).toContainEqual(
      expect.objectContaining({ kind: "target", value: 0, velocity: 1.75 }),
    );

    session.dispose();
    expect(root.style.backgroundColor ?? "").toBe("");
    expect(icon.getAttribute("src")).toBeNull();
    expect(() => session.commit({})).toThrow("Cannot commit a disposed web presentation session.");
  });

  it("binds Presentation-owned virtual collection geometry reactively", () => {
    class TestHTMLElement {}
    vi.stubGlobal("HTMLElement", TestHTMLElement);
    const target = createElement("collection");
    Object.setPrototypeOf(target, TestHTMLElement.prototype);
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    }).create({ boundary: target, targets: { Root: () => [target] } });

    session.commit({
      Root: {
        layout: {
          collection: {
            axis: "block",
            estimate: { kind: "size", value: 44 },
            gap: 8,
            lanes: 2,
          },
        },
      },
    });
    expect(inspectVirtualCollectionHost(target as unknown as HTMLElement)).toEqual({
      axis: "block",
      estimate: 44,
      gap: 8,
      lanes: 2,
    });

    session.commit({ Root: {} });
    expect(inspectVirtualCollectionHost(target as unknown as HTMLElement)).toBeUndefined();
    session.dispose();
  });

  it("resolves target-local native conditions in deterministic precedence order", async () => {
    const target = createElement("control");
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    }).create({ boundary: target, targets: { Root: () => [target] } });
    const declarations = {
      Root: {
        paint: { opacity: 1 },
        conditions: [
          { when: { target: { hovered: true } }, use: { paint: { opacity: 0.8 } } },
          { when: { target: { pressed: true } }, use: { paint: { opacity: 0.6 } } },
          { when: { target: { disabled: true } }, use: { paint: { opacity: 0.3 } } },
        ],
      },
    } as const;
    session.commit(declarations);
    expect(target.style.opacity).toBe("1");

    target.emit("pointerenter");
    await Promise.resolve();
    expect(target.style.opacity).toBe("0.8");

    target.emit("pointerdown");
    await Promise.resolve();
    expect(target.style.opacity).toBe("0.6");

    target.setAttribute("aria-disabled", "true");
    session.commit(declarations);
    expect(target.style.opacity).toBe("0.3");
    session.dispose();
  });

  it("observes component allocation only when a container condition uses it", async () => {
    const scheduler = createScheduler();
    let width = 700;
    let resize: (() => void) | undefined;
    let observations = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly callback: ResizeObserverCallback;

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          resize = () => callback([], this as unknown as ResizeObserver);
        }

        observe() {
          observations += 1;
        }

        disconnect() {}
      },
    );
    const target = createElement("responsive");
    target.getBoundingClientRect = () =>
      ({ width, height: 480, x: 0, y: 0, top: 0, right: width, bottom: 480, left: 0 }) as DOMRect;
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler,
    }).create({ boundary: target, targets: { Root: () => [target] } });

    session.commit({ Root: { paint: { opacity: 1 } } });
    expect(observations).toBe(0);

    const responsive = {
      Root: {
        paint: { opacity: 1 },
        conditions: [
          {
            when: { container: { inline: { max: 560 } } },
            use: { paint: { opacity: 0.4 } },
          },
        ],
      },
    } as const;
    session.commit(responsive);
    expect(observations).toBe(1);
    expect(target.style.opacity).toBe("1");

    width = 520;
    resize?.();
    scheduler.flush();
    await Promise.resolve();
    expect(target.style.opacity).toBe("0.4");
    session.dispose();
  });

  it("allocates only the preference and pointer media used by declarations", async () => {
    const records = new Map<
      string,
      { matches: boolean; listeners: Set<(event: MediaQueryListEvent) => void> }
    >();
    vi.stubGlobal("matchMedia", (query: string) => {
      const record = records.get(query) ?? { matches: false, listeners: new Set() };
      records.set(query, record);
      return {
        get matches() {
          return record.matches;
        },
        media: query,
        addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) {
          record.listeners.add(listener);
        },
        removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) {
          record.listeners.delete(listener);
        },
      } as MediaQueryList;
    });
    const setMatch = (query: string, matches: boolean) => {
      const record = records.get(query);
      if (!record) throw new Error(`Media query ${query} is not observed.`);
      record.matches = matches;
      for (const listener of record.listeners)
        listener({ matches, media: query } as MediaQueryListEvent);
    };
    const target = createElement("media-aware");
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    }).create({ boundary: target, targets: { Root: () => [target] } });
    session.commit({
      Root: {
        paint: { opacity: 1 },
        conditions: [
          {
            when: { preferences: { dark: true }, pointer: { fine: true } },
            use: { paint: { opacity: 0.5 } },
          },
        ],
      },
    });

    expect([...records.keys()].sort()).toEqual(["(pointer: fine)", "(prefers-color-scheme: dark)"]);
    setMatch("(prefers-color-scheme: dark)", true);
    setMatch("(pointer: fine)", true);
    await Promise.resolve();
    expect(target.style.opacity).toBe("0.5");
    session.dispose();
    expect([...records.values()].every(({ listeners }) => listeners.size === 0)).toBe(true);
  });

  it("rejects empty and inverted conditions before applying styles", () => {
    const target = createElement("invalid-condition");
    target.style.opacity = "0.25";
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    }).create({ boundary: target, targets: { Root: () => [target] } });

    expect(() =>
      session.commit({
        Root: { conditions: [{ when: {}, use: { paint: { opacity: 0.5 } } }] },
      }),
    ).toThrow("condition 0 is empty");
    expect(() =>
      session.commit({
        Root: {
          conditions: [
            {
              when: { container: { inline: { min: 600, max: 400 } } },
              use: { paint: { opacity: 0.5 } },
            },
          ],
        },
      }),
    ).toThrow("inverted inline range");
    expect(target.style.opacity).toBe("0.25");
    session.dispose();
  });

  it("snapshots dynamic targets once and releases recycled target ownership", async () => {
    const first = createElement("first");
    const second = createElement("second");
    first.style.opacity = "0.25";
    second.style.opacity = "0.5";
    first.setAttribute("src", "/first.svg");
    second.setAttribute("src", "/second.svg");
    let current: readonly Element[] = [first];
    let resolutions = 0;
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    }).create({
      boundary: first,
      targets: {
        Root: () => {
          resolutions += 1;
          return current;
        },
      },
    });
    const declaration = {
      Root: {
        paint: { opacity: 0.8 },
        resource: { kind: "symbol", source: "/active.svg" },
        conditions: [{ when: { target: { hovered: true } }, use: { paint: { opacity: 0.6 } } }],
      },
    } as const;

    session.commit(declaration);
    expect(resolutions).toBe(1);
    expect(first.style.opacity).toBe("0.8");
    expect(first.getAttribute("src")).toBe("/active.svg");

    current = [second];
    session.commit(declaration);
    expect(resolutions).toBe(2);
    expect(first.style.opacity).toBe("0.25");
    expect(first.getAttribute("src")).toBe("/first.svg");
    expect(second.style.opacity).toBe("0.8");
    expect(second.getAttribute("src")).toBe("/active.svg");

    first.emit("pointerenter");
    await Promise.resolve();
    expect(resolutions).toBe(2);
    expect(second.style.opacity).toBe("0.8");

    session.dispose();
    expect(second.style.opacity).toBe("0.5");
    expect(second.getAttribute("src")).toBe("/second.svg");
  });

  it("validates shared identities before writes and releases ownership on update", () => {
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    });
    const first = createElement("first");
    const second = createElement("second");
    const firstSession = adapter.create({
      boundary: first,
      targets: { Root: () => [first], Peer: () => [second] },
    });
    firstSession.commit({
      Root: { paint: { opacity: 0.8 }, motion: { identity: "shared-panel" } },
    });
    expect(() =>
      firstSession.commit({
        Root: { paint: { opacity: 0.4 }, motion: { identity: "shared-panel" } },
        Peer: { motion: { identity: "shared-panel" } },
      }),
    ).toThrow('Presentation identity "shared-panel" has multiple targets.');
    expect(first.style.opacity).toBe("0.8");

    const other = createElement("other");
    const secondSession = adapter.create({ boundary: other, targets: { Root: () => [other] } });
    expect(() => secondSession.commit({ Root: { motion: { identity: "shared-panel" } } })).toThrow(
      'Presentation identity "shared-panel" has multiple targets.',
    );

    firstSession.commit({ Root: { paint: { opacity: 0.8 } } });
    expect(() =>
      secondSession.commit({ Root: { motion: { identity: "shared-panel" } } }),
    ).not.toThrow();
    firstSession.dispose();
    secondSession.dispose();
  });

  it("hands an entering identity between component sessions without stale ownership", () => {
    const log: Array<Readonly<Record<string, unknown>>> = [];
    const scheduler = createScheduler();
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend(log),
      scheduler,
    });
    const source = createElement("source", 100, 80);
    const destination = createElement("destination", 200, 160);
    const peer = createElement("peer");
    source.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 20,
        left: 10,
        top: 20,
        right: 110,
        bottom: 100,
        width: 100,
        height: 80,
      }) as DOMRect;
    destination.getBoundingClientRect = () =>
      ({
        x: 200,
        y: 300,
        left: 200,
        top: 300,
        right: 400,
        bottom: 460,
        width: 200,
        height: 160,
      }) as DOMRect;
    const sourceSession = adapter.create({
      boundary: source,
      targets: { Root: () => [source] },
    });
    const destinationSession = adapter.create({
      boundary: destination,
      targets: { Root: () => [destination] },
    });
    const peerSession = adapter.create({ boundary: peer, targets: { Root: () => [peer] } });
    const declaration = {
      Root: {
        motion: {
          identity: "record",
          layout: { spring: { stiffness: 900, damping: 60 } },
        },
      },
    } as const;

    sourceSession.commit(declaration);
    destination.setAttribute("data-motion-state", "entering");
    expect(() => destinationSession.commit(declaration)).not.toThrow();
    sourceSession.dispose();
    scheduler.flush();

    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "direct",
        key: expect.stringContaining("layoutTranslateX"),
        value: -190,
      }),
    );
    expect(() => peerSession.commit(declaration)).toThrow(
      'Presentation identity "record" has multiple targets.',
    );

    destinationSession.dispose();
    peerSession.dispose();
  });

  it("rejects invalid declarations and ambiguous Element ownership before writes", () => {
    const first = createElement("first");
    const second = createElement("second");
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    });
    const session = adapter.create({
      boundary: first,
      targets: { Root: () => [first], Peer: () => [second] },
    });
    session.commit({ Root: { paint: { opacity: 0.8 } } });

    expect(() => session.commit({ Root: { paint: { opacity: Number.NaN } } })).toThrow(
      "contains a non-finite number",
    );
    expect(first.style.opacity).toBe("0.8");
    expect(() =>
      session.commit({
        Root: {
          layers: [
            { id: "material", placement: "background" },
            { id: "material", placement: "overlay" },
          ],
        },
      }),
    ).toThrow('repeats render-layer id "material"');
    expect(first.style.opacity).toBe("0.8");
    session.dispose();

    const ambiguous = adapter.create({
      boundary: first,
      targets: { Root: () => [first], Peer: () => [first] },
    });
    expect(() => ambiguous.commit({ Root: {}, Peer: {} })).toThrow(
      'claimed by two Elements: "Root" and "Peer"',
    );
    ambiguous.dispose();
  });

  it("projects a shared identity from retained source geometry to its replacement", () => {
    const log: Array<Readonly<Record<string, unknown>>> = [];
    const scheduler = createScheduler();
    const source = createElement("source", 100, 80);
    const destination = createElement("destination", 200, 160);
    source.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 20,
        left: 10,
        top: 20,
        right: 110,
        bottom: 100,
        width: 100,
        height: 80,
      }) as DOMRect;
    destination.getBoundingClientRect = () =>
      ({
        x: 200,
        y: 300,
        left: 200,
        top: 300,
        right: 400,
        bottom: 460,
        width: 200,
        height: 160,
      }) as DOMRect;
    let target: readonly Element[] = [source];
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend(log),
      scheduler,
    }).create({ boundary: source, targets: { Hero: () => target } });
    const declaration = {
      Hero: {
        motion: {
          identity: "hero",
          layout: { spring: { stiffness: 900, damping: 60 } },
        },
      },
    } as const;

    session.commit(declaration);
    target = [destination];
    session.commit(declaration);
    scheduler.flush();

    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "direct",
        key: expect.stringContaining("layoutTranslateX"),
        value: -190,
      }),
    );
    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "direct",
        key: expect.stringContaining("layoutTranslateY"),
        value: -280,
      }),
    );
    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "direct",
        key: expect.stringContaining("layoutScaleX"),
        value: 0.5,
      }),
    );
    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "target",
        key: expect.stringContaining("layoutTranslateX"),
        value: 0,
      }),
    );
    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "target",
        key: expect.stringContaining("layoutScaleX"),
        value: 1,
      }),
    );
    session.dispose();
  });

  it("hands a shared identity across an intermediate commit to its entering target", () => {
    const log: Array<Readonly<Record<string, unknown>>> = [];
    const scheduler = createScheduler();
    const source = createElement("source", 48, 48);
    const destination = createElement("destination", 24, 24);
    source.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 30,
        left: 20,
        top: 30,
        right: 68,
        bottom: 78,
        width: 48,
        height: 48,
      }) as DOMRect;
    destination.getBoundingClientRect = () =>
      ({
        x: 180,
        y: 260,
        left: 180,
        top: 260,
        right: 204,
        bottom: 284,
        width: 24,
        height: 24,
      }) as DOMRect;
    let targets: readonly Element[] = [source];
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend(log),
      scheduler,
    }).create({ boundary: source, targets: { Hero: () => targets } });
    const declaration = {
      Hero: {
        motion: {
          identity: "hero",
          layout: { spring: { stiffness: 900, damping: 60 } },
        },
      },
    } as const;

    session.commit(declaration);
    session.commit({ Hero: {} });
    source.setAttribute("data-motion-state", "exiting");
    destination.setAttribute("data-motion-state", "entering");
    targets = [source, destination];
    expect(() => session.commit(declaration)).not.toThrow();
    session.commit(declaration);
    expect(log).not.toContainEqual(
      expect.objectContaining({ kind: "dispose", key: expect.stringContaining("layout") }),
    );
    scheduler.flush();

    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "direct",
        key: expect.stringContaining("layoutTranslateX"),
        value: -160,
      }),
    );
    expect(log).toContainEqual(
      expect.objectContaining({
        kind: "direct",
        key: expect.stringContaining("layoutScaleX"),
        value: 2,
      }),
    );
    session.dispose();
  });

  it("substitutes resources and owns inaccessible render-only layers", () => {
    class TreeElement {
      readonly attributes = new Map<string, string>();
      readonly children: TreeElement[] = [];
      readonly style = Object.assign(Object.create(null) as Record<string, string>, {
        setProperty(name: string, value: string) {
          (this as unknown as Record<string, string>)[name] = value;
        },
      }) as unknown as CSSStyleDeclaration & Record<string, string>;
      hidden = false;
      inert = false;
      isConnected = true;
      parent?: TreeElement;
      constructor(
        readonly tagName: string,
        readonly ownerDocument: { createElement(name: string): TreeElement },
      ) {}
      getBoundingClientRect = () =>
        ({
          width: 320,
          height: 480,
          x: 0,
          y: 0,
          top: 0,
          right: 320,
          bottom: 480,
          left: 0,
        }) as DOMRect;
      getAttribute = (name: string) => this.attributes.get(name) ?? null;
      setAttribute = (name: string, value: string) => void this.attributes.set(name, value);
      removeAttribute = (name: string) => void this.attributes.delete(name);
      append(child: TreeElement) {
        child.parent = this;
        this.children.push(child);
      }
      prepend(child: TreeElement) {
        child.parent = this;
        this.children.unshift(child);
      }
      remove() {
        if (!this.parent) return;
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
        this.parent = undefined;
      }
    }
    const document = {
      createElement(name: string) {
        return new TreeElement(name, document);
      },
    };
    const target = new TreeElement("img", document);
    target.setAttribute("src", "/semantic.png");
    const image = { kind: "image", source: "/themed.png" } as const;
    const shader = { kind: "shader", source: "soft-glass" } as const;
    type ResourceTheme = TestTheme & {
      readonly resources: { readonly image: typeof image; readonly shader: typeof shader };
    };
    const session = createWebPresentationAdapter<ResourceTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    }).create({
      boundary: target as unknown as Element,
      targets: { Root: () => [target as unknown as Element] },
    });

    session.commit({
      Root: {
        resource: image,
        layers: [
          {
            id: "material",
            placement: "overlay",
            resource: shader,
            uniforms: { intensity: 0.75 },
          },
        ],
      },
    });
    expect(target.getAttribute("src")).toBe("/themed.png");
    expect(target.children).toHaveLength(1);
    const layer = target.children[0]!;
    expect(layer.tagName).toBe("canvas");
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.getAttribute("data-shader")).toBe("soft-glass");
    expect(layer.inert).toBe(true);
    expect(layer.style.pointerEvents).toBe("none");
    expect(layer.style["--uniform-intensity"]).toBe("0.75");

    session.commit({ Root: {} });
    expect(target.getAttribute("src")).toBe("/semantic.png");
    expect(target.children).toHaveLength(0);
    session.dispose();
  });

  it("acquires referenced fonts once and releases replacement and disposal exactly once", () => {
    const document = {} as Document;
    const target = createElement("root");
    Object.defineProperty(target, "ownerDocument", { value: document });
    const acquired: string[] = [];
    const released: string[] = [];
    const fontBackend: WebFontBackend = {
      acquire(owner, font) {
        expect(owner).toBe(document);
        const key = font.family ?? "generated";
        acquired.push(key);
        let active = true;
        return {
          key,
          release() {
            if (!active) return;
            active = false;
            released.push(key);
          },
        };
      },
    };
    const session = createWebPresentationAdapter<TestTheme>({
      fontBackend,
      motionBackend: createMotionBackend([]),
    }).create({ boundary: target, targets: { Root: () => [target] } });
    const font = {
      family: "Fixture Sans",
      fallback: ["system-ui"],
      sources: [{ file: "/fixture.woff2", format: "woff2", weight: [400, 700] }],
    } as const;

    session.commit({ Root: { typography: { font } } });
    session.commit({ Root: { typography: { font } } });
    expect(acquired).toEqual(["Fixture Sans"]);
    expect(target.style.fontFamily).toBe('"Fixture Sans", system-ui');

    session.commit({ Root: {} });
    expect(released).toEqual(["Fixture Sans"]);
    session.commit({ Root: { typography: { font } } });
    session.dispose();
    session.dispose();
    expect(acquired).toEqual(["Fixture Sans", "Fixture Sans"]);
    expect(released).toEqual(["Fixture Sans", "Fixture Sans"]);
  });

  it("retains an exit until settlement and then ends rendering and hit testing", async () => {
    const log: Array<Readonly<Record<string, unknown>>> = [];
    const scheduler = createScheduler();
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend(log),
      scheduler,
    });
    const panel = createElement("panel");
    const session = adapter.create({ boundary: panel, targets: { Root: () => [panel] } });
    const transition = { spring: { stiffness: 900, damping: 60 } } as const;

    session.commit({
      Root: {
        motion: {
          translation: { block: 0 },
          presence: { visible: true, enter: { from: { block: 200 } }, transition },
        },
      },
    });
    scheduler.flush();
    expect(panel.hidden).toBe(false);

    session.commit({
      Root: {
        motion: {
          presence: { visible: false, exit: { to: { block: 200 } }, transition },
        },
      },
    });
    expect(panel.hidden).toBe(false);
    expect(panel.style.pointerEvents).toBe("none");
    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.hidden).toBe(true);
    session.dispose();
    expect(panel.hidden).toBe(false);
    expect(panel.style.pointerEvents ?? "").toBe("");
  });

  it("never claims native dialog lifecycle from Component structure", async () => {
    class TestDialog {
      showCalls = 0;
      closeCalls = 0;
      showModal() {
        this.showCalls += 1;
      }
      close() {
        this.closeCalls += 1;
      }
    }
    vi.stubGlobal("HTMLDialogElement", TestDialog);
    const scheduler = createScheduler();
    const dialog = createElement("dialog") as FakeElement & TestDialog;
    Object.setPrototypeOf(dialog, TestDialog.prototype);
    dialog.showCalls = 0;
    dialog.closeCalls = 0;
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler,
    }).create({ boundary: dialog, targets: { Root: () => [dialog] } });
    const transition = { spring: { stiffness: 900, damping: 60 } } as const;

    session.commit({ Root: { motion: { presence: { visible: true } } } });
    session.commit({
      Root: {
        motion: { presence: { visible: false, exit: { to: { opacity: 0 } }, transition } },
      },
    });
    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(dialog.showCalls).toBe(0);
    expect(dialog.closeCalls).toBe(0);
    session.dispose();
  });

  it("installs entrance values atomically and does not restart an identical target", () => {
    const log: Array<Readonly<Record<string, unknown>>> = [];
    const scheduler = createScheduler();
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend(log),
      scheduler,
    });
    const panel = createElement("panel");
    const session = adapter.create({ boundary: panel, targets: { Root: () => [panel] } });
    const declaration = {
      Root: {
        motion: {
          opacity: { target: 1, transition: { spring: { stiffness: 900, damping: 60 } } },
          presence: {
            visible: true,
            enter: { from: { opacity: 0 } },
            transition: { spring: { stiffness: 900, damping: 60 } },
          },
        },
      },
    } as const;

    session.commit(declaration);
    scheduler.flush();
    session.commit(declaration);
    scheduler.flush();

    expect(log.filter(({ kind }) => kind === "direct")).toHaveLength(1);
    expect(log).toContainEqual(expect.objectContaining({ kind: "direct", value: 0 }));
    expect(log.filter(({ kind }) => kind === "target")).toHaveLength(1);
    expect(log).toContainEqual(expect.objectContaining({ kind: "target", value: 1 }));
    session.dispose();
  });

  it("keeps one exit completion authoritative across duplicate commits", async () => {
    const scheduler = createScheduler();
    const targets: MotionTarget[] = [];
    const backend: MotionBackend = {
      create(_key, initial) {
        let value = initial;
        return {
          read: () => value,
          velocity: () => 0,
          write(next) {
            value = next;
          },
          retarget(target) {
            value = target.value;
            targets.push(target);
          },
          stop() {},
          dispose() {},
        };
      },
    };
    const panel = createElement("panel");
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: backend,
      scheduler,
    }).create({ boundary: panel, targets: { Root: () => [panel] } });
    const transition = { spring: { stiffness: 900, damping: 60 } } as const;
    session.commit({ Root: { motion: { presence: { visible: true } } } });
    expect(panel.hidden).toBe(false);
    session.commit({
      Root: { motion: { presence: { visible: false, exit: { to: { opacity: 0 } }, transition } } },
    });
    scheduler.flush();
    expect(panel.hidden).toBe(false);
    session.commit({
      Root: { motion: { presence: { visible: false, exit: { to: { opacity: 0 } }, transition } } },
    });
    scheduler.flush();

    expect(targets).toHaveLength(1);
    expect(panel.hidden).toBe(false);
    expect(panel.style.pointerEvents).toBe("none");
    targets[0]?.settled();
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.hidden).toBe(true);
    session.dispose();
  });

  it("keeps exiting content rendered when its destination moves", async () => {
    const scheduler = createScheduler();
    const targets: MotionTarget[] = [];
    const backend: MotionBackend = {
      create(_key, initial) {
        let value = initial;
        return {
          read: () => value,
          velocity: () => 0,
          write(next) {
            value = next;
          },
          retarget(target) {
            value = target.value;
            targets.push(target);
          },
          stop() {},
          dispose() {},
        };
      },
    };
    const panel = createElement("panel");
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: backend,
      scheduler,
    }).create({ boundary: panel, targets: { Root: () => [panel] } });
    const transition = { spring: { stiffness: 900, damping: 60 } } as const;
    session.commit({ Root: { motion: { presence: { visible: true } } } });
    session.commit({
      Root: {
        motion: { presence: { visible: false, exit: { to: { block: 100 } }, transition } },
      },
    });
    scheduler.flush();
    expect(targets).toHaveLength(1);

    session.commit({
      Root: {
        motion: { presence: { visible: false, exit: { to: { block: 200 } }, transition } },
      },
    });
    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(targets).toHaveLength(2);
    expect(panel.hidden).toBe(false);
    targets[1]?.settled();
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.hidden).toBe(true);
    session.dispose();
  });

  it("projects layout only while presence remains continuously visible", () => {
    class TestHTMLElement {
      readonly style = {} as CSSStyleDeclaration & Record<string, string>;
      readonly children = [] as unknown as HTMLCollection;
      readonly attributes = new Map<string, string>();
      hidden = false;
      isConnected = true;
      getBoundingClientRect = () =>
        ({
          width: 320,
          height: 480,
          x: 0,
          y: 0,
          top: 0,
          right: 320,
          bottom: 480,
          left: 0,
        }) as DOMRect;
      getAttribute = (name: string) => this.attributes.get(name) ?? null;
      setAttribute = (name: string, value: string) => void this.attributes.set(name, value);
      removeAttribute = (name: string) => void this.attributes.delete(name);
    }
    vi.stubGlobal("HTMLElement", TestHTMLElement);
    const scheduler = createScheduler();
    const calls: string[] = [];
    const layoutBackend: LayoutBackend = {
      create() {
        calls.push("create");
        return {
          capture() {},
          project(_children, _transition, settled) {
            calls.push("project");
            settled();
          },
          stop() {},
          dispose() {
            calls.push("dispose");
          },
        };
      },
    };
    const surface = new TestHTMLElement() as unknown as HTMLElement;
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      layoutBackend,
      scheduler,
    });
    const session = adapter.create({
      boundary: surface,
      targets: { Root: () => [surface] },
    });
    const transition = { spring: { stiffness: 900, damping: 60 } } as const;
    const commit = (visible: boolean) => {
      session.commit({
        Root: {
          motion: {
            layout: transition,
            presence: { visible, exit: { to: { opacity: 0 } }, transition },
          },
        },
      });
      scheduler.flush();
    };

    commit(false);
    commit(true);
    expect(calls).toEqual([]);

    commit(true);
    expect(calls).toEqual(["create"]);

    commit(true);
    expect(calls).toEqual(["create", "project"]);

    commit(false);
    expect(calls).toEqual(["create", "project", "dispose"]);
    session.dispose();
    vi.unstubAllGlobals();
  });

  it("converges under seeded reversal, recycling, and resource lifecycle traces", async () => {
    const transition = { spring: { stiffness: 900, damping: 60 } } as const;
    for (let seed = 1; seed <= 12; seed++) {
      let random = seed;
      const next = () => {
        random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
        return random / 0x1_0000_0000;
      };
      const log: Array<Readonly<Record<string, unknown>>> = [];
      const scheduler = createScheduler();
      let active = createElement(`seed-${seed}-0`);
      active.style.opacity = "0.42";
      active.setAttribute("src", "/native.svg");
      let targets: readonly Element[] = [active];
      const retired: FakeElement[] = [];
      const session = createWebPresentationAdapter<TestTheme>({
        motionBackend: createMotionBackend(log),
        scheduler,
      }).create({ boundary: active, targets: { Root: () => targets } });
      let open = false;

      for (let step = 0; step < 48; step++) {
        const operation = Math.floor(next() * 4);
        if (operation === 0) open = true;
        else if (operation === 1) open = false;
        else if (operation === 2) open = !open;
        else {
          retired.push(active);
          active = createElement(`seed-${seed}-${step + 1}`);
          active.style.opacity = "0.42";
          active.setAttribute("src", "/native.svg");
          targets = [active];
        }
        const declarations = {
          Root: {
            resource: { kind: "symbol", source: open ? "/open.svg" : "/closed.svg" },
            motion: {
              opacity: { target: open ? 1 : 0, transition },
              presence: {
                visible: open,
                enter: { from: { opacity: 0 } },
                exit: { to: { opacity: 0 } },
                transition,
              },
            },
          },
        } as const;
        session.commit(declarations);
        if (next() > 0.35) session.commit(declarations);
        scheduler.flush();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(active.hidden, `seed ${seed}, step ${step}, open ${open}`).toBe(!open);
        expect(active.getAttribute("src")).toBe(open ? "/open.svg" : "/closed.svg");
        for (const target of retired) {
          expect(target.hidden).toBe(false);
          expect(target.style.opacity).toBe("0.42");
          expect(target.getAttribute("src")).toBe("/native.svg");
        }
      }

      session.dispose();
      session.dispose();
      expect(active.hidden).toBe(false);
      expect(active.style.opacity).toBe("0.42");
      expect(active.getAttribute("src")).toBe("/native.svg");
      expect(log.filter(({ kind }) => kind === "dispose")).toHaveLength(
        log.filter(({ kind }) => kind === "create").length,
      );
    }
  });
});
