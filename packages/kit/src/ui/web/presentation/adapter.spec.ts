import { describe, expect, it, vi } from "vitest";

import type { LayoutBackend, MotionBackend, MotionScheduler, MotionTarget } from "../motion";
import type { WebPresentationTheme } from "../visual";
import { createWebPresentationAdapter } from "./adapter";

type TestTheme = {
  motion: {
    sheet: { readonly spring: { readonly stiffness: 900; readonly damping: 60 } };
  };
} & WebPresentationTheme;

type FakeElement = Element & {
  hidden: boolean;
  readonly style: CSSStyleDeclaration & Record<string, string>;
  emit(type: string): void;
};

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
      parts: { Root: () => [root], Item: () => repeated, Icon: () => [icon] },
    });

    expect(session.platform.allocated).toEqual({ inlineSize: 375, blockSize: 700 });
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

  it("resolves target-local native conditions in deterministic precedence order", async () => {
    const target = createElement("control");
    const session = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    }).create({ boundary: target, parts: { Root: () => [target] } });
    const declarations = {
      Root: {
        paint: { opacity: 1 },
        conditions: {
          hovered: { paint: { opacity: 0.8 } },
          pressed: { paint: { opacity: 0.6 } },
          disabled: { paint: { opacity: 0.3 } },
        },
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

  it("validates shared identities before writes and releases ownership on update", () => {
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    });
    const first = createElement("first");
    const second = createElement("second");
    const firstSession = adapter.create({
      boundary: first,
      parts: { Root: () => [first], Peer: () => [second] },
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
    const secondSession = adapter.create({ boundary: other, parts: { Root: () => [other] } });
    expect(() =>
      secondSession.commit({ Root: { motion: { identity: "shared-panel" } } }),
    ).toThrow('Presentation identity "shared-panel" has multiple targets.');

    firstSession.commit({ Root: { paint: { opacity: 0.8 } } });
    expect(() =>
      secondSession.commit({ Root: { motion: { identity: "shared-panel" } } }),
    ).not.toThrow();
    firstSession.dispose();
    secondSession.dispose();
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
        ({ width: 320, height: 480, x: 0, y: 0, top: 0, right: 320, bottom: 480, left: 0 }) as DOMRect;
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
      parts: { Root: () => [target as unknown as Element] },
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

  it("retains an exit until settlement and then ends rendering and hit testing", async () => {
    const log: Array<Readonly<Record<string, unknown>>> = [];
    const scheduler = createScheduler();
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend(log),
      scheduler,
    });
    const panel = createElement("panel");
    const session = adapter.create({ boundary: panel, parts: { Root: () => [panel] } });
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

  it("installs entrance values atomically and does not restart an identical target", () => {
    const log: Array<Readonly<Record<string, unknown>>> = [];
    const scheduler = createScheduler();
    const adapter = createWebPresentationAdapter<TestTheme>({
      motionBackend: createMotionBackend(log),
      scheduler,
    });
    const panel = createElement("panel");
    const session = adapter.create({ boundary: panel, parts: { Root: () => [panel] } });
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
    }).create({ boundary: panel, parts: { Root: () => [panel] } });
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

  it("projects layout only while presence remains continuously visible", () => {
    class TestHTMLElement {
      readonly style = {} as CSSStyleDeclaration & Record<string, string>;
      readonly children = [] as unknown as HTMLCollection;
      readonly attributes = new Map<string, string>();
      hidden = false;
      isConnected = true;
      getBoundingClientRect = () =>
        ({ width: 320, height: 480, x: 0, y: 0, top: 0, right: 320, bottom: 480, left: 0 }) as DOMRect;
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
      parts: { Root: () => [surface] },
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
});
