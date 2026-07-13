import { describe, expect, it } from "bun:test";
import { defineApp } from "../src/app";
import { createHooks } from "../src/component-runtime";
import { PresenceScene } from "../src/scene";
import {
  For,
  Show,
  captureSignalOnHotRefresh,
  effect,
  jsx,
  mountDialog,
  onMount,
  reactiveValue,
  render,
  signal,
  virtualItemPosition,
  type Child,
  type HotRenderState,
  type Signal,
} from "../src/ui";

describe("presence scene", () => {
  it("retains hierarchy and reparents children deterministically", () => {
    const scene = new PresenceScene<string>();
    const root = scene.register({ owner: "test", part: "Root", backend: "root" });
    const surface = scene.register({
      owner: "test",
      part: "Surface",
      backend: "surface",
      parent: root,
    });
    const label = scene.register({
      part: "Label",
      owner: "test",
      key: "first",
      backend: "label",
      parent: surface,
    });

    expect(scene.roots).toEqual([root]);
    expect(root.children).toEqual([surface]);
    expect(surface.children).toEqual([label]);
    scene.reparent(label, root, 0);
    expect(root.children).toEqual([label, surface]);
    expect(surface.children).toEqual([]);
  });

  it("reuses keyed identity and disposes a subtree deterministically", () => {
    const scene = new PresenceScene<object>();
    const firstBackend = {};
    const root = scene.register({ owner: "test", part: "Root", backend: {} });
    const first = scene.register({
      owner: "test",
      part: "Result",
      key: "a",
      backend: firstBackend,
      parent: root,
    });
    const replacementBackend = {};
    const replacement = scene.register({
      part: "Result",
      owner: "test",
      key: "a",
      backend: replacementBackend,
      parent: root,
    });

    expect(replacement).toBe(first);
    expect(replacement.backend).toBe(replacementBackend);
    expect(scene.size).toBe(2);

    scene.setPresence(replacement, "exiting");
    expect(replacement.presence).toBe("exiting");
    scene.detach(root);

    expect(scene.size).toBe(0);
    expect(scene.roots).toEqual([]);
    expect(root.presence).toBe("detached");
    expect(replacement.presence).toBe("detached");
  });
});

describe("ui runtime", () => {
  it("runs intrinsic callback-ref cleanup exactly once with its owner", () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    const trace: string[] = [];

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const root = new FakeRenderRoot();
      const cleanup = render(
        () =>
          jsx("button", {
            ref(element: FakeDomElement) {
              trace.push(`attach:${element.tagName}`);
              return () => trace.push(`cleanup:${element.tagName}`);
            },
          }),
        root as unknown as Element,
      );

      expect(trace).toEqual(["attach:button"]);
      cleanup();
      cleanup();
      expect(trace).toEqual(["attach:button", "cleanup:button"]);
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("composes an author callback ref with a named Part ref", () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    const trace: string[] = [];
    type RefApp = {
      Resources: {};
      Components: {
        RefProbe: {
          Parts: { Root: "button" };
        };
      };
    };
    const app = defineApp<RefApp>({
      version: 1,
      resources: {},
      components: {
        RefProbe: {
          render({ parts: { Root } }) {
            return Root({
              ref(element) {
                trace.push(`attach:${element.tagName.toLowerCase()}`);
                return () => trace.push(`cleanup:${element.tagName.toLowerCase()}`);
              },
            });
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: { RefProbe: { parts: { Root: "button" } } },
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const root = new FakeRenderRoot();
      const cleanup = render(() => jsx(hooks.components.RefProbe, {}), root as unknown as Element);

      expect(trace).toEqual(["attach:button"]);
      cleanup();
      expect(trace).toEqual(["attach:button", "cleanup:button"]);
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("disposes conditional refs once and preserves keyed refs through reorder", async () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    const trace: string[] = [];

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const visible = signal(true);
      const items = signal([{ id: "a" }, { id: "b" }]);
      const root = new FakeRenderRoot();
      const cleanup = render(
        () => [
          Show({
            when: () => visible(),
            children: () =>
              jsx("button", {
                ref(element: FakeDomElement) {
                  trace.push(`attach:show:${element.tagName}`);
                  return () => trace.push(`cleanup:show:${element.tagName}`);
                },
              }),
          }),
          For({
            each: () => items(),
            by: (item) => item.id,
            children(item) {
              return jsx("div", {
                ref() {
                  trace.push(`attach:${item.id}`);
                  return () => trace.push(`cleanup:${item.id}`);
                },
              });
            },
          }),
        ],
        root as unknown as Element,
      );
      await flushMicrotasks();
      expect(trace).toEqual(["attach:show:button", "attach:a", "attach:b"]);

      items([{ id: "b" }, { id: "a" }]);
      await flushMicrotasks();
      expect(trace).toEqual(["attach:show:button", "attach:a", "attach:b"]);

      visible(false);
      items([{ id: "b" }]);
      await flushMicrotasks();
      expect(trace).toEqual([
        "attach:show:button",
        "attach:a",
        "attach:b",
        "cleanup:show:button",
        "cleanup:a",
      ]);

      cleanup();
      cleanup();
      expect(trace).toEqual([
        "attach:show:button",
        "attach:a",
        "attach:b",
        "cleanup:show:button",
        "cleanup:a",
        "cleanup:b",
      ]);
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("positions vertical, horizontal, and multi-lane virtual ranges logically", () => {
    expect(virtualItemPosition(240, 0, { axis: "block", estimate: 48, gap: 8, lanes: 1 })).toEqual({
      insetBlockStart: "240px",
      blockSize: "",
      insetInlineStart: "0px",
      inlineSize: "100%",
    });
    expect(virtualItemPosition(320, 1, { axis: "inline", estimate: 80, gap: 8, lanes: 2 })).toEqual(
      {
        insetInlineStart: "320px",
        inlineSize: "",
        insetBlockStart: "calc(50% + 4px)",
        blockSize: "calc(50% - 4px)",
      },
    );
    expect(virtualItemPosition(480, 2, { axis: "block", estimate: 64, gap: 12, lanes: 3 })).toEqual(
      {
        insetBlockStart: "480px",
        blockSize: "",
        insetInlineStart: `calc(${(2 * 100) / 3}% + 8px)`,
        inlineSize: `calc(${100 / 3}% - 8px)`,
      },
    );
  });

  it("preserves render-owned signal state across hot rerenders", () => {
    const root = new FakeRoot() as unknown as Element;
    const hotState: HotRenderState = {};
    let count: Signal<number> | undefined;

    function Root(): Child {
      count = signal(0);
      return null;
    }

    let cleanup = render(Root, root, hotState);
    expect(count?.()).toBe(0);

    const firstSignal = count;
    count?.(7);
    cleanup();
    cleanup = render(Root, root, hotState);

    expect(count?.()).toBe(7);
    expect(count).not.toBe(firstSignal);
    expect(hotState.values).toEqual([7]);

    cleanup();
  });

  it("restores named hot state when signal shape changes", () => {
    const root = new FakeRoot() as unknown as Element;
    const hotState: HotRenderState = {};
    let expanded = false;
    let query: Signal<string> | undefined;
    let selected: Signal<string> | undefined;
    let mode: Signal<string> | undefined;

    function Root(): Child {
      query = signal("", "command-menu.query");
      if (expanded) mode = signal("ready", "command-menu.mode");
      selected = signal("compose", "command-menu.selected");
      return null;
    }

    let cleanup = render(Root, root, hotState);
    query?.("review");
    selected?.("settings");
    cleanup();

    expanded = true;
    cleanup = render(Root, root, hotState);
    expect(query?.()).toBe("review");
    expect(selected?.()).toBe("settings");
    expect(mode?.()).toBe("ready");
    expect(hotState.keyed).toEqual({
      "command-menu.query#0": "review",
      "command-menu.selected#0": "settings",
    });

    cleanup();
  });

  it("captures expensive state only when a hot refresh actually disposes the tree", () => {
    const root = new FakeRoot() as unknown as Element;
    const hotState: HotRenderState = {};
    let count: Signal<number> | undefined;
    let captures = 0;

    function Root(): Child {
      count = signal(0, "counter");
      captureSignalOnHotRefresh(count, () => {
        captures++;
        return count?.() ?? 0;
      });
      return null;
    }

    const cleanup = render(Root, root, hotState);
    for (let value = 1; value <= 1_000; value++) count?.(value);

    expect(captures).toBe(0);
    cleanup();
    expect(captures).toBe(1);
    expect(hotState.values).toEqual([1_000]);
    expect(hotState.keyed).toEqual({ "counter#0": 1_000 });
  });

  it("re-subscribes render effects after restoring hot state", () => {
    const root = new FakeRoot() as unknown as Element;
    const hotState: HotRenderState = {};
    let count: Signal<number> | undefined;
    let observed = -1;

    function Root(): Child {
      count = signal(0);
      effect(() => {
        observed = count?.() ?? -1;
      });
      return null;
    }

    let cleanup = render(Root, root, hotState);
    count?.(3);
    expect(observed).toBe(3);

    cleanup();
    cleanup = render(Root, root, hotState);
    count?.(9);
    expect(observed).toBe(9);

    cleanup();
  });

  it("creates one component instance for every direct JSX occurrence", () => {
    const runtime = globalThis as unknown as {
      Node?: unknown;
      document?: unknown;
    };
    const previous = {
      Node: runtime.Node,
      document: runtime.document,
    };

    type LifecycleApp = {
      Resources: {};
      Components: {
        Panel: {
          Parts: { Root: "section" };
        };
      };
    };

    const app = defineApp<LifecycleApp>({
      version: 1,
      resources: {},
      components: {
        Panel: {
          render({ parts: { Root } }) {
            return Root();
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: { Panel: { parts: { Root: "section" } } },
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();

      const Panel = hooks.components.Panel;
      const firstRoot = new FakeRenderRoot();
      const firstCleanup = render(() => jsx(Panel, {}), firstRoot as unknown as Element);
      firstCleanup();

      const secondRoot = new FakeRenderRoot();
      const secondCleanup = render(() => jsx(Panel, {}), secondRoot as unknown as Element);
      secondCleanup();

      const duplicateCleanup = render(
        () => [jsx(Panel, {}), jsx(Panel, {})],
        new FakeRenderRoot() as unknown as Element,
      );
      duplicateCleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("keeps controlled child inputs reactive without rerendering parent or child", () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    let parentRenders = 0;
    let childRenders = 0;
    type ControlledApp = {
      Resources: {};
      Components: {
        Parent: {
          Context: { count: number };
          States: "active";
          Values: { count: number };
          Events: { changeCount(count: number): void };
          Parts: { Root: "section" };
        };
        Child: {
          Input: { value: number; changeValue(value: number): void };
          Parts: { Root: "button" };
        };
      };
    };
    const app = defineApp<ControlledApp>({
      version: 1,
      resources: {},
      components: {
        Parent: {
          context: { count: 0 },
          initial: "active",
          states: {
            active: {
              on: {
                changeCount: { update: (_scope, count) => ({ count }) },
              },
            },
          },
          derive({ context }) {
            return { count: context.count };
          },
          render({ values, events, components: { Child }, parts: { Root } }) {
            parentRenders++;
            return Root({
              children: Child({
                get value() {
                  return values.count;
                },
                changeValue: events.changeCount,
              }),
            });
          },
        },
        Child: {
          render({ input, parts: { Root } }) {
            childRenders++;
            return Root({
              onClick: () => input.changeValue(input.value + 1),
              children: () => input.value,
            });
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: {
        Parent: { parts: { Root: "section" } },
        Child: { parts: { Root: "button" }, inputCallbacks: ["changeValue"] },
      },
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const root = new FakeRenderRoot();
      const cleanup = render(() => jsx(hooks.components.Parent, {}), root as unknown as Element);
      const button = descendantElements(root, "button")[0]!;

      expect(button.textContent).toBe("0");
      expect(parentRenders).toBe(1);
      expect(childRenders).toBe(1);
      button.dispatchEvent(new Event("click"));
      button.dispatchEvent(new Event("click"));
      expect(button.textContent).toBe("2");
      expect(descendantElements(root, "button")[0]).toBe(button);
      expect(parentRenders).toBe(1);
      expect(childRenders).toBe(1);

      cleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("runs component render once while context updates fine-grained bindings", async () => {
    const runtime = globalThis as unknown as {
      Node?: unknown;
      document?: unknown;
    };
    const previous = {
      Node: runtime.Node,
      document: runtime.document,
    };
    type CounterApp = {
      Resources: {};
      Components: {
        Counter: {
          Context: { count: number };
          States: "active";
          Values: { count: number };
          Events: { increment(): void };
          Parts: { Root: "output" };
        };
      };
    };
    let renderRuns = 0;
    const app = defineApp<CounterApp>({
      version: 1,
      resources: {},
      components: {
        Counter: {
          context: { count: 0 },
          derive({ context }) {
            return {
              get count() {
                return context.count;
              },
            };
          },
          initial: "active",
          states: {
            active: {
              on: {
                increment: { update: ({ context }) => ({ count: context.count + 1 }) },
              },
            },
          },
          render({ values, events, parts: { Root } }) {
            renderRuns++;
            return Root({ onClick: events.increment, children: () => values.count });
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: {
        Counter: { parts: { Root: "output" } },
      },
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const Counter = hooks.components.Counter;
      const root = new FakeRenderRoot();
      const cleanup = render(() => jsx(Counter, {}), root as unknown as Element);

      expect(renderRuns).toBe(1);
      expect(root.textContent).toBe("0");
      const output = root.children.find(
        (child): child is FakeDomElement => child instanceof FakeDomElement,
      );
      expect(output).toBeDefined();
      for (let index = 0; index < 10_000; index++) {
        output!.dispatchEvent(new Event("click"));
      }
      await Bun.sleep(0);
      expect(root.textContent).toBe("10000");
      expect(renderRuns).toBe(1);

      cleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("batches transition snapshots and drops inactive derive dependencies", () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    type BranchApp = {
      Resources: {};
      Components: {
        Branch: {
          Context: { useLeft: boolean; left: number; right: number };
          States: "active";
          Values: { selected: number };
          Events: {
            updateLeft(value: number): void;
            updateRight(value: number): void;
            swap(): void;
          };
          Parts: { Root: "output" };
        };
      };
    };
    let deriveRuns = 0;
    let actions:
      | {
          updateLeft(value: number): void;
          updateRight(value: number): void;
          swap(): void;
        }
      | undefined;
    const snapshots: string[] = [];
    const app = defineApp<BranchApp>({
      version: 1,
      resources: {},
      components: {
        Branch: {
          context: { useLeft: true, left: 1, right: 2 },
          initial: "active",
          states: {
            active: {
              on: {
                updateLeft: { update: (_scope, left) => ({ left }) },
                updateRight: { update: (_scope, right) => ({ right }) },
                swap: { update: () => ({ useLeft: false, left: 3, right: 4 }) },
              },
            },
          },
          derive({ context }) {
            deriveRuns++;
            return { selected: context.useLeft ? context.left : context.right };
          },
          render({ context, values, events, parts: { Root } }) {
            actions = events;
            effect(() => {
              snapshots.push(`${context.left}:${context.right}:${values.selected}`);
            });
            return Root({ children: () => values.selected });
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { presets: { default: {} } },
      components: { Branch: { parts: { Root: "output" }, values: ["selected"] } },
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const root = new FakeRenderRoot();
      const cleanup = render(() => jsx(hooks.components.Branch, {}), root as unknown as Element);
      const initialDeriveRuns = deriveRuns;
      snapshots.length = 0;

      actions!.updateRight(9);
      expect(deriveRuns).toBe(initialDeriveRuns);
      expect(snapshots).toEqual(["1:9:1"]);

      snapshots.length = 0;
      actions!.swap();
      expect(snapshots).toEqual(["3:4:4"]);
      const swappedDeriveRuns = deriveRuns;

      snapshots.length = 0;
      actions!.updateLeft(8);
      expect(deriveRuns).toBe(swappedDeriveRuns);
      expect(snapshots).toEqual(["8:4:4"]);

      cleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("keeps a component actor interactive across repeated close and reopen transitions", async () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    type ToggleApp = {
      Resources: {};
      Components: {
        Toggle: {
          States: "closed" | "open";
          Events: { toggle(): void };
          Parts: { Root: "button" };
        };
      };
    };
    const app = defineApp<ToggleApp>({
      version: 1,
      resources: {},
      components: {
        Toggle: {
          initial: "closed",
          states: {
            closed: { on: { toggle: "open" } },
            open: { on: { toggle: "closed" } },
          },
          render({ state, events, parts: { Root } }) {
            return Root({
              onClick: events.toggle,
              children: () => `${state.matches("open")}:${state.active.join(",")}`,
            });
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: { Toggle: { parts: { Root: "button" } } },
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const root = new FakeRenderRoot();
      const cleanup = render(() => jsx(hooks.components.Toggle, {}), root as unknown as Element);
      const button = root.children.find(
        (child): child is FakeDomElement => child instanceof FakeDomElement,
      )!;
      const mousePress = () => {
        const down = new Event("pointerdown");
        Object.defineProperties(down, {
          button: { value: 0 },
          pointerType: { value: "mouse" },
        });
        button.dispatchEvent(down);
        const click = new Event("click", { cancelable: true });
        Object.defineProperty(click, "detail", { value: 1 });
        button.dispatchEvent(click);
      };

      expect(root.textContent).toBe("false:closed");
      mousePress();
      expect(root.textContent).toBe("true:open");
      mousePress();
      expect(root.textContent).toBe("false:closed");
      mousePress();
      expect(root.textContent).toBe("true:open");
      cleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("keeps a native listener connected while its state updates fine-grained content", () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    type HoverApp = {
      Resources: {};
      Components: {
        HoverRow: {
          Context: { highlights: number };
          States: "active";
          Events: { highlight(): void };
          Parts: { Root: "button" };
        };
      };
    };
    const app = defineApp<HoverApp>({
      version: 1,
      resources: {},
      components: {
        HoverRow: {
          context: { highlights: 0 },
          initial: "active",
          states: {
            active: {
              on: {
                highlight: {
                  update: ({ context }) => ({ highlights: context.highlights + 1 }),
                },
              },
            },
          },
          render({ context, events, parts: { Root } }) {
            return Root({ onPointerMove: events.highlight, children: () => context.highlights });
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: { HoverRow: { parts: { Root: "button" } } },
    });

    try {
      const document = fakeDocument();
      runtime.Node = FakeDomNode;
      runtime.document = document;
      const root = new FakeRenderRoot();
      const cleanup = render(() => jsx(hooks.components.HoverRow, {}), root as unknown as Element);
      const row = descendantElements(root, "button")[0]!;
      Object.defineProperty(row, "ownerDocument", { value: document });
      const pointer = (type: string) =>
        row.dispatchEvent({
          type,
          currentTarget: row,
          pointerType: "mouse",
          buttons: 0,
        } as unknown as Event);

      pointer("pointermove");
      pointer("pointermove");
      pointer("pointermove");
      expect(row.textContent).toBe("3");
      pointer("pointerleave");
      pointer("pointermove");
      expect(row.textContent).toBe("4");
      cleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("serializes boolean aria attributes as true and false strings", () => {
    const runtime = globalThis as unknown as {
      Node?: unknown;
      document?: unknown;
    };
    const previous = {
      Node: runtime.Node,
      document: runtime.document,
    };

    try {
      runtime.Node = FakeDomNode;
      runtime.document = {
        createElement(tagName: string) {
          return new FakeDomElement(tagName);
        },
        createTextNode(text: string) {
          return new FakeDomText(text);
        },
      };

      const root = new FakeRenderRoot();
      render(jsx("button", { "aria-expanded": false }), root as unknown as Element);

      const closedButton = root.children[0] as FakeDomElement;
      expect(closedButton.attributes.get("aria-expanded")).toBe("false");

      render(jsx("button", { "aria-expanded": true }), root as unknown as Element);

      const openButton = root.children[0] as FakeDomElement;
      expect(openButton.attributes.get("aria-expanded")).toBe("true");
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("renders the initial value of a dynamic child", async () => {
    const runtime = globalThis as unknown as {
      Node?: unknown;
      document?: unknown;
    };
    const previous = {
      Node: runtime.Node,
      document: runtime.document,
    };

    try {
      runtime.Node = FakeDomNode;
      runtime.document = {
        createElement(tagName: string) {
          return new FakeDomElement(tagName);
        },
        createComment(text: string) {
          return new FakeDomComment(text);
        },
        createDocumentFragment() {
          return new FakeDomFragment();
        },
        createTextNode(text: string) {
          return new FakeDomText(text);
        },
      };

      const label = signal("Initial");
      const items = reactiveValue(() => ["label"] as const);
      const root = new FakeRenderRoot();
      render(
        () =>
          jsx("div", {
            children: For({
              each: items,
              by: (item) => item,
              children: () => jsx("span", { children: () => label() }),
            }),
          }),
        root as unknown as Element,
      );

      const container = root.children[0] as FakeDomElement;
      const span = elementChildren(container, "span")[0]!;
      expect(span.textContent).toBe("Initial");

      label("Updated");
      await flushMicrotasks();
      expect(span.textContent).toBe("Updated");
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("updates keyed For content when items reorder", async () => {
    const runtime = globalThis as unknown as {
      Node?: unknown;
      document?: unknown;
    };
    const previous = {
      Node: runtime.Node,
      document: runtime.document,
    };

    try {
      runtime.Node = FakeDomNode;
      runtime.document = {
        createElement(tagName: string) {
          return new FakeDomElement(tagName);
        },
        createComment(text: string) {
          return new FakeDomComment(text);
        },
        createDocumentFragment() {
          return new FakeDomFragment();
        },
        createTextNode(text: string) {
          return new FakeDomText(text);
        },
      };

      type Item = { id: string; label: string };
      const items = signal<Item[]>([
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ]);
      const keyedItems = reactiveValue(() => items());

      function List(): Child {
        return jsx("ul", {
          children: For({
            each: keyedItems,
            by: (item: Item) => item.id,
            children(item: Item) {
              return jsx("li", { id: item.id, children: () => item.label });
            },
          }),
        });
      }

      const root = new FakeRenderRoot();
      render(List, root as unknown as Element);
      await flushMicrotasks();

      const list = root.children[0] as FakeDomElement;
      const initialItems = elementChildren(list, "li");
      expect(initialItems.map((item) => item.attributes.get("id"))).toEqual(["a", "b", "c"]);
      expect(initialItems.map((item) => item.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);

      items([
        { id: "c", label: "Gamma updated" },
        { id: "a", label: "Alpha updated" },
        { id: "b", label: "Beta updated" },
      ]);
      await flushMicrotasks();

      const reorderedItems = elementChildren(list, "li");
      expect(reorderedItems.map((item) => item.attributes.get("id"))).toEqual(["c", "a", "b"]);
      expect(reorderedItems).toEqual([initialItems[2]!, initialItems[0]!, initialItems[1]!]);
      expect(reorderedItems.map((item) => item.textContent)).toEqual([
        "Gamma updated",
        "Alpha updated",
        "Beta updated",
      ]);
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("updates a compiled keyed For index without remounting the item", async () => {
    const runtime = globalThis as unknown as {
      Node?: unknown;
      document?: unknown;
    };
    const previous = {
      Node: runtime.Node,
      document: runtime.document,
    };

    try {
      runtime.Node = FakeDomNode;
      runtime.document = {
        createElement(tagName: string) {
          return new FakeDomElement(tagName);
        },
        createComment(text: string) {
          return new FakeDomComment(text);
        },
        createDocumentFragment() {
          return new FakeDomFragment();
        },
        createTextNode(text: string) {
          return new FakeDomText(text);
        },
      };

      type Item = { id: string };
      type CompiledChild = (item: Item, index: number, reactiveIndex: Signal<number>) => Child;
      const items = signal<Item[]>([{ id: "a" }, { id: "b" }, { id: "c" }]);
      const keyedItems = reactiveValue(() => items());
      const child: CompiledChild = (item, _index, reactiveIndex) =>
        jsx("li", { id: item.id, children: () => reactiveIndex() });

      const root = new FakeRenderRoot();
      render(
        () =>
          jsx("ul", {
            children: For({
              each: keyedItems,
              by: "id",
              children: child as (item: Item, index: number) => Child,
            }),
          }),
        root as unknown as Element,
      );
      await flushMicrotasks();

      const list = root.children[0] as FakeDomElement;
      const initial = elementChildren(list, "li");
      expect(initial.map((item) => item.textContent)).toEqual(["0", "1", "2"]);

      items([{ id: "c" }, { id: "a" }, { id: "b" }]);
      await flushMicrotasks();

      const reordered = elementChildren(list, "li");
      expect(reordered).toEqual([initial[2]!, initial[0]!, initial[1]!]);
      expect(reordered.map((item) => item.textContent)).toEqual(["0", "1", "2"]);
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("keeps a retained keyed item's bindings reactive after filtering", async () => {
    const runtime = globalThis as unknown as {
      Node?: unknown;
      document?: unknown;
    };
    const previous = {
      Node: runtime.Node,
      document: runtime.document,
    };

    try {
      runtime.Node = FakeDomNode;
      runtime.document = {
        createElement(tagName: string) {
          return new FakeDomElement(tagName);
        },
        createComment(text: string) {
          return new FakeDomComment(text);
        },
        createDocumentFragment() {
          return new FakeDomFragment();
        },
        createTextNode(text: string) {
          return new FakeDomText(text);
        },
      };

      type Item = { id: string; label: string };
      const alpha: Item = { id: "a", label: "Alpha" };
      const beta: Item = { id: "b", label: "Beta" };
      const items = signal<Item[]>([alpha, beta]);
      const selected = signal("a");
      const tone = signal("light");
      const keyedItems = reactiveValue(() => items());

      function List(): Child {
        return jsx("ul", {
          children: For({
            each: keyedItems,
            by: (item: Item) => item.id,
            children(item: Item) {
              return jsx("li", {
                id: item.id,
                class: () => tone(),
                "aria-selected": () => selected() === item.id,
                children: item.label,
              });
            },
          }),
        });
      }

      const root = new FakeRenderRoot();
      const cleanup = render(List, root as unknown as Element);
      await flushMicrotasks();

      const list = root.children[0] as FakeDomElement;
      const retained = elementChildren(list, "li")[1]!;
      items([beta]);
      selected("b");
      tone("dark");
      await flushMicrotasks();

      expect(elementChildren(list, "li")[0]).toBe(retained);
      expect(retained.getAttribute("aria-selected")).toBe("true");
      expect(retained.getAttribute("class")).toBe("dark");

      items([]);
      selected("a");
      tone("light");
      await flushMicrotasks();

      expect(elementChildren(list, "li")).toHaveLength(0);
      expect(retained.getAttribute("aria-selected")).toBe("true");
      expect(retained.getAttribute("class")).toBe("dark");
      cleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("retains, restores, and disposes keyed items as one presence scope", async () => {
    const runtime = globalThis as unknown as {
      HTMLElement?: unknown;
      matchMedia?: unknown;
      Node?: unknown;
      document?: unknown;
      window?: unknown;
    };
    const previous = {
      HTMLElement: runtime.HTMLElement,
      matchMedia: runtime.matchMedia,
      Node: runtime.Node,
      document: runtime.document,
      window: runtime.window,
    };

    try {
      runtime.HTMLElement = FakeDomElement;
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      runtime.matchMedia = () => ({ matches: false });
      runtime.window = {
        matchMedia() {
          return { matches: false };
        },
      };

      type Item = { id: string; label: string };
      const items = signal<Item[]>([
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ]);
      const keyedItems = reactiveValue(() => items());
      const disposed: string[] = [];

      function Root(): Child {
        return jsx("ul", {
          children: For({
            each: keyedItems,
            by: (item: Item) => item.id,
            children(item: Item) {
              onMount(() => () => disposed.push(item.id));
              return jsx("li", {
                id: item.id,
                "data-motion-lifecycle": "enter exit exit-finished",
                children: () => item.label,
              });
            },
          }),
        });
      }

      const root = new FakeRenderRoot();
      const cleanup = render(Root, root as unknown as Element);
      await flushMicrotasks();
      const list = root.children[0] as FakeDomElement;
      const beta = elementChildren(list, "li")[1]!;

      items([{ id: "a", label: "Alpha" }]);
      await flushMicrotasks();
      expect(elementChildren(list, "li")).toContain(beta);
      expect(beta.getAttribute("data-motion-state")).toBe("exiting");
      expect(beta.hasAttribute("inert")).toBe(true);
      expect(disposed).toEqual([]);

      items([
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta restored" },
      ]);
      await flushMicrotasks();
      expect(elementChildren(list, "li")[1]).toBe(beta);
      expect(beta.textContent).toBe("Beta restored");
      expect(beta.hasAttribute("inert")).toBe(false);
      expect(disposed).toEqual([]);

      items([{ id: "a", label: "Alpha" }]);
      await flushMicrotasks();
      beta.dispatchEvent({ type: "transitionend" } as Event);
      expect(elementChildren(list, "li")).not.toContain(beta);
      expect(disposed).toEqual(["b"]);

      cleanup();
    } finally {
      runtime.HTMLElement = previous.HTMLElement;
      runtime.matchMedia = previous.matchMedia;
      runtime.Node = previous.Node;
      runtime.document = previous.document;
      runtime.window = previous.window;
    }
  });

  it("removes keyed exits immediately when reduced motion is requested", async () => {
    const runtime = globalThis as unknown as {
      HTMLElement?: unknown;
      matchMedia?: unknown;
      Node?: unknown;
      document?: unknown;
      window?: unknown;
    };
    const previous = {
      HTMLElement: runtime.HTMLElement,
      matchMedia: runtime.matchMedia,
      Node: runtime.Node,
      document: runtime.document,
      window: runtime.window,
    };

    try {
      runtime.HTMLElement = FakeDomElement;
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      runtime.matchMedia = (query: string) => ({ matches: query.includes("reduce") });
      runtime.window = {
        matchMedia(query: string) {
          return { matches: query.includes("reduce") };
        },
      };

      const items = signal([{ id: "a" }]);
      const keyedItems = reactiveValue(() => items());
      let disposed = 0;
      const root = new FakeRenderRoot();
      render(
        () =>
          For({
            each: keyedItems,
            by: (item) => item.id,
            children(item) {
              onMount(() => () => disposed++);
              return jsx("div", {
                "data-motion-lifecycle": "enter exit exit-finished",
                children: () => item.id,
              });
            },
          }),
        root as unknown as Element,
      );
      await flushMicrotasks();

      items([]);
      await flushMicrotasks();
      expect(descendantElements(root, "div")).toHaveLength(0);
      expect(disposed).toBe(1);
    } finally {
      runtime.HTMLElement = previous.HTMLElement;
      runtime.matchMedia = previous.matchMedia;
      runtime.Node = previous.Node;
      runtime.document = previous.document;
      runtime.window = previous.window;
    }
  });

  it("keeps lifecycle-marked Show branches alive until exit finishes", async () => {
    const runtime = globalThis as unknown as {
      HTMLElement?: unknown;
      Node?: unknown;
      document?: unknown;
      window?: unknown;
    };
    const previous = {
      HTMLElement: runtime.HTMLElement,
      Node: runtime.Node,
      document: runtime.document,
      window: runtime.window,
    };

    try {
      runtime.HTMLElement = FakeDomElement;
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      runtime.window = {
        matchMedia(query: string) {
          return { matches: query.includes("reduce") && false };
        },
      };

      const visible = signal(true);

      function Root(): Child {
        return Show({
          when: () => visible(),
          children: jsx("section", {
            id: "shown",
            "data-motion-lifecycle": "enter exit exit-finished",
            children: "Shown",
          }),
          fallback: jsx("p", { id: "fallback", children: "Fallback" }),
        });
      }

      const root = new FakeRenderRoot();
      render(Root, root as unknown as Element);
      await flushMicrotasks();

      expect(descendantElements(root, "section")).toHaveLength(1);
      expect(descendantElements(root, "p")).toHaveLength(0);

      visible(false);
      await flushMicrotasks();

      const exiting = descendantElements(root, "section")[0]!;
      expect(exiting.getAttribute("data-motion-state")).toBe("exiting");
      expect(exiting.getAttribute("aria-hidden")).toBe("true");
      expect(exiting.hasAttribute("inert")).toBe(true);
      expect(descendantElements(root, "p").map((item) => item.textContent)).toEqual(["Fallback"]);

      exiting.dispatchEvent({ type: "transitionend" } as Event);

      expect(descendantElements(root, "section")).toHaveLength(0);
      expect(descendantElements(root, "p").map((item) => item.textContent)).toEqual(["Fallback"]);
    } finally {
      runtime.HTMLElement = previous.HTMLElement;
      runtime.Node = previous.Node;
      runtime.document = previous.document;
      runtime.window = previous.window;
    }
  });

  it("reverses Show presence with the same branch scope", async () => {
    const runtime = globalThis as unknown as {
      HTMLElement?: unknown;
      Node?: unknown;
      document?: unknown;
      window?: unknown;
    };
    const previous = {
      HTMLElement: runtime.HTMLElement,
      Node: runtime.Node,
      document: runtime.document,
      window: runtime.window,
    };

    try {
      runtime.HTMLElement = FakeDomElement;
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      runtime.window = {
        matchMedia() {
          return { matches: false };
        },
      };

      const visible = signal(true);
      const disposed: string[] = [];
      const branch = (name: string, tagName: string) => () => {
        onMount(() => () => disposed.push(name));
        return jsx(tagName, {
          id: name,
          "data-motion-lifecycle": "enter exit exit-finished",
          children: name,
        });
      };

      const root = new FakeRenderRoot();
      render(
        () =>
          Show({
            when: () => visible(),
            children: branch("shown", "section"),
            fallback: branch("fallback", "p"),
          }),
        root as unknown as Element,
      );
      await flushMicrotasks();
      const shown = descendantElements(root, "section")[0]!;

      visible(false);
      await flushMicrotasks();
      const fallback = descendantElements(root, "p")[0]!;
      visible(true);
      await flushMicrotasks();

      expect(descendantElements(root, "section")[0]).toBe(shown);
      expect(shown.hasAttribute("inert")).toBe(false);
      expect(disposed).toEqual([]);

      fallback.dispatchEvent({ type: "transitionend" } as Event);
      expect(descendantElements(root, "p")).toHaveLength(0);
      expect(disposed).toEqual(["fallback"]);

      visible(false);
      await flushMicrotasks();
      shown.dispatchEvent({ type: "transitionend" } as Event);
      expect(descendantElements(root, "section")).toHaveLength(0);
      expect(disposed).toEqual(["fallback", "shown"]);
    } finally {
      runtime.HTMLElement = previous.HTMLElement;
      runtime.Node = previous.Node;
      runtime.document = previous.document;
      runtime.window = previous.window;
    }
  });

  it("delays lifecycle-marked hidden updates until exit finishes", async () => {
    const runtime = globalThis as unknown as {
      HTMLElement?: unknown;
      Node?: unknown;
      document?: unknown;
      window?: unknown;
    };
    const previous = {
      HTMLElement: runtime.HTMLElement,
      Node: runtime.Node,
      document: runtime.document,
      window: runtime.window,
    };

    try {
      runtime.HTMLElement = FakeDomElement;
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      runtime.window = {
        matchMedia(query: string) {
          return { matches: query.includes("reduce") && false };
        },
      };

      const hidden = signal(false);

      function Root(): Child {
        return jsx("section", {
          id: "panel",
          "data-motion-lifecycle": "enter exit exit-finished",
          hidden: () => hidden(),
          children: "Panel",
        });
      }

      const root = new FakeRenderRoot();
      render(Root, root as unknown as Element);
      await flushMicrotasks();

      const panel = descendantElements(root, "section")[0]!;
      expect(panel.hasAttribute("hidden")).toBe(false);

      hidden(true);
      await flushMicrotasks();

      expect(panel.hasAttribute("hidden")).toBe(false);
      expect(panel.getAttribute("data-motion-state")).toBe("exiting");
      expect(panel.getAttribute("aria-hidden")).toBe("true");
      expect(panel.hasAttribute("inert")).toBe(true);

      panel.dispatchEvent({ type: "transitionend" } as Event);

      expect(panel.hasAttribute("hidden")).toBe(true);

      hidden(false);
      expect(panel.getAttribute("data-motion-state")).toBe("entering");
      await flushMicrotasks();

      expect(panel.hasAttribute("hidden")).toBe(false);
      expect(panel.getAttribute("aria-hidden")).toBe(null);
      expect(panel.hasAttribute("inert")).toBe(false);
      expect(panel.getAttribute("data-motion-state")).toBe("entered");
    } finally {
      runtime.HTMLElement = previous.HTMLElement;
      runtime.Node = previous.Node;
      runtime.document = previous.document;
      runtime.window = previous.window;
    }
  });

  it("demotes an exiting dialog without releasing scroll lock and restores modal state", async () => {
    const runtime = globalThis as unknown as {
      HTMLElement?: unknown;
      HTMLDialogElement?: unknown;
      Node?: unknown;
      document?: unknown;
      requestAnimationFrame?: unknown;
    };
    const previous = {
      HTMLElement: runtime.HTMLElement,
      HTMLDialogElement: runtime.HTMLDialogElement,
      Node: runtime.Node,
      document: runtime.document,
      requestAnimationFrame: runtime.requestAnimationFrame,
    };
    const frames: FrameRequestCallback[] = [];

    try {
      const body = new FakeDomElement("body");
      const documentElement = Object.assign(new FakeDomElement("html"), { clientWidth: 985 });
      const fakeRuntimeDocument = {
        ...fakeDocument(),
        activeElement: null,
        body,
        documentElement,
        defaultView: {
          innerWidth: 1000,
          getComputedStyle() {
            return { paddingInlineEnd: "4px" };
          },
        },
      };
      runtime.HTMLElement = FakeDomElement;
      runtime.HTMLDialogElement = FakeDialogElement;
      runtime.Node = FakeDomNode;
      runtime.document = fakeRuntimeDocument;
      runtime.requestAnimationFrame = (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      };

      const mode = signal<false | "modal" | "nonmodal">(false);

      function Root(): Child {
        return jsx("dialog", {
          ref(element: FakeDialogElement) {
            mountDialog(element as unknown as HTMLDialogElement, () => mode());
          },
          children: "Drawer",
        });
      }

      const root = new FakeRenderRoot();
      render(Root, root as unknown as Element);
      await flushMicrotasks();

      const dialog = descendantElements(root, "dialog")[0] as FakeDialogElement;
      expect(dialog.hidden).toBe(true);

      mode("modal");
      await flushMicrotasks();
      expect(dialog.open).toBe(false);
      while (frames.length) frames.shift()!(0);
      await flushMicrotasks();
      expect(dialog.open).toBe(true);
      expect(dialog.mode).toBe("modal");
      expect(dialog.hidden).toBe(false);
      expect(fakeRuntimeDocument.documentElement.style.getPropertyValue("overflow")).toBe("hidden");
      expect(fakeRuntimeDocument.body.style.getPropertyValue("overscroll-behavior")).toBe("none");
      expect(fakeRuntimeDocument.documentElement.style.getPropertyValue("scrollbar-gutter")).toBe(
        "",
      );
      expect(fakeRuntimeDocument.body.style.getPropertyValue("scrollbar-gutter")).toBe("");
      expect(fakeRuntimeDocument.body.style.getPropertyValue("padding-inline-end")).toBe(
        "calc(4px + 15px)",
      );

      mode("nonmodal");
      await flushMicrotasks();
      expect(frames).toHaveLength(0);
      expect(dialog.open).toBe(true);
      expect(dialog.mode).toBe("nonmodal");
      expect(dialog.hidden).toBe(false);
      expect(dialog.hasAttribute("inert")).toBe(true);
      expect(fakeRuntimeDocument.documentElement.style.getPropertyValue("overflow")).toBe("hidden");

      mode("modal");
      await flushMicrotasks();
      expect(dialog.open).toBe(true);
      expect(dialog.mode).toBe("modal");
      expect(dialog.hasAttribute("inert")).toBe(false);

      for (let index = 0; index < 20; index++) {
        const next = index % 2 === 0 ? "nonmodal" : "modal";
        mode(next);
        await flushMicrotasks();
        while (frames.length) frames.shift()!(0);
        await flushMicrotasks();
        expect(dialog.open).toBe(true);
        expect(dialog.mode).toBe(next);
        expect(dialog.hidden).toBe(false);
        expect(dialog.hasAttribute("inert")).toBe(next === "nonmodal");
        expect(dialog.getAttribute("aria-hidden")).toBe(next === "nonmodal" ? "true" : null);
      }

      mode(false);
      await flushMicrotasks();
      expect(dialog.open).toBe(false);
      expect(dialog.mode).toBe(false);
      expect(dialog.hidden).toBe(true);
      expect(dialog.calls.slice(0, 5)).toEqual([
        "showModal",
        "close",
        "show",
        "close",
        "showModal",
      ]);
      expect(dialog.calls).toHaveLength(46);
      expect(dialog.calls.at(-1)).toBe("close");
      expect(fakeRuntimeDocument.documentElement.style.getPropertyValue("overflow")).toBe("");
      expect(fakeRuntimeDocument.body.style.getPropertyValue("overscroll-behavior")).toBe("");
      expect(fakeRuntimeDocument.body.style.getPropertyValue("padding-inline-end")).toBe("");
    } finally {
      runtime.HTMLElement = previous.HTMLElement;
      runtime.HTMLDialogElement = previous.HTMLDialogElement;
      runtime.Node = previous.Node;
      runtime.document = previous.document;
      runtime.requestAnimationFrame = previous.requestAnimationFrame;
    }
  });
});

class FakeRoot {
  replaceChildren() {}
}

class FakeDomNode {
  parentNode: FakeDomElement | null = null;

  get textContent(): string {
    return "";
  }

  get nextSibling(): FakeDomNode | null {
    const parent = this.parentNode;
    if (!parent) return null;
    const index = parent.children.indexOf(this);
    return index >= 0 ? (parent.children[index + 1] ?? null) : null;
  }

  get childNodes(): FakeDomNode[] {
    return [];
  }
}

class FakeDomComment extends FakeDomNode {
  constructor(readonly text: string) {
    super();
  }
}

class FakeDomText extends FakeDomNode {
  constructor(readonly text: string) {
    super();
  }

  override get textContent(): string {
    return this.text;
  }
}

class FakeDomElement extends FakeDomNode {
  readonly attributes = new Map<string, string>();
  readonly children: FakeDomNode[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style = new FakeStyle();
  readonly classList = {
    item: () => null,
  };
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  hidden = false;

  constructor(readonly tagName: string) {
    super();
  }

  override get textContent(): string {
    return this.children.map((child) => child.textContent).join("");
  }

  override get childNodes(): FakeDomNode[] {
    return this.children;
  }

  get isConnected(): boolean {
    return this.parentNode != null || this.tagName === "#root";
  }

  append(...children: FakeDomNode[]) {
    for (const child of children) this.insertBefore(child, null);
  }

  addEventListener(name: string, listener: EventListener) {
    const listeners = this.listeners.get(name) ?? new Set<(event: Event) => void>();
    listeners.add(listener as (event: Event) => void);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: EventListener) {
    this.listeners.get(name)?.delete(listener as (event: Event) => void);
  }

  dispatchEvent(event: Event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  matches(selector: string) {
    if (selector.startsWith(".")) return false;
    return false;
  }

  querySelectorAll(selector: string) {
    const result: FakeDomElement[] = [];
    for (const child of this.children) {
      if (!(child instanceof FakeDomElement)) continue;
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  contains(node: FakeDomNode | null): boolean {
    if (node === this) return true;
    return this.children.some(
      (child) => child === node || (child instanceof FakeDomElement && child.contains(node)),
    );
  }

  getBoundingClientRect() {
    const scale = /^scale\(([^,\s]+),?\s*([^)]+)?\)$/.exec(this.style.transform);
    const scaleX = scale ? Number(scale[1]) || 1 : 1;
    const scaleY = scale ? Number(scale[2] ?? scale[1]) || 1 : 1;
    const width = Number(this.attributes.get("data-width") ?? 0) * scaleX;
    const height = Number(this.attributes.get("data-height") ?? 20) * scaleY;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON() {
        return {};
      },
    } as DOMRect;
  }

  insertBefore(child: FakeDomNode, reference: FakeDomNode | null) {
    if (child instanceof FakeDomFragment) {
      while (child.children.length) this.insertBefore(child.children[0]!, reference);
      return child;
    }

    child.parentNode?.removeChild(child);
    const index = reference ? this.children.indexOf(reference) : -1;
    const nextIndex = index >= 0 ? index : this.children.length;
    this.children.splice(nextIndex, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child: FakeDomNode) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  replaceChildren(...children: FakeDomNode[]) {
    while (this.children.length) this.removeChild(this.children[0]!);
    this.append(...children);
  }
}

class FakeDialogElement extends FakeDomElement {
  readonly calls: string[] = [];
  open = false;
  mode: false | "modal" | "nonmodal" = false;

  constructor() {
    super("dialog");
  }

  showModal() {
    this.calls.push("showModal");
    this.open = true;
    this.mode = "modal";
    this.setAttribute("open", "");
  }

  show() {
    this.calls.push("show");
    this.open = true;
    this.mode = "nonmodal";
    this.setAttribute("open", "");
  }

  close() {
    this.calls.push("close");
    this.open = false;
    this.mode = false;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  }
}

class FakeStyle {
  transform = "";
  transition = "";
  willChange = "";
  transformOrigin = "";
  private readonly properties = new Map<string, string>();

  setProperty(name: string, value: string) {
    this.properties.set(name, value);
  }

  removeProperty(name: string) {
    this.properties.delete(name);
  }

  getPropertyValue(name: string) {
    return this.properties.get(name) ?? "";
  }
}

class FakeDomFragment extends FakeDomElement {
  constructor() {
    super("#fragment");
  }
}

class FakeRenderRoot extends FakeDomElement {
  constructor() {
    super("#root");
  }
}

function elementChildren(parent: FakeDomElement, tagName: string): FakeDomElement[] {
  return parent.children.filter(
    (child): child is FakeDomElement =>
      child instanceof FakeDomElement && child.tagName === tagName,
  );
}

function descendantElements(parent: FakeDomElement, tagName: string): FakeDomElement[] {
  const result: FakeDomElement[] = [];
  for (const child of parent.children) {
    if (child instanceof FakeDomElement) {
      if (child.tagName === tagName) result.push(child);
      result.push(...descendantElements(child, tagName));
    }
  }
  return result;
}

function fakeDocument() {
  return {
    createElement(tagName: string) {
      return tagName === "dialog" ? new FakeDialogElement() : new FakeDomElement(tagName);
    },
    createComment(text: string) {
      return new FakeDomComment(text);
    },
    createDocumentFragment() {
      return new FakeDomFragment();
    },
    createTextNode(text: string) {
      return new FakeDomText(text);
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
