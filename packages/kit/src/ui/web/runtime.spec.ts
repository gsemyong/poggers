import { describe, expect, it } from "bun:test";

import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "@tanstack/virtual-core";

import { defineApp, type Client, type FeatureDef } from "#kernel/app";
import { createHooks } from "#ui/web/component";
import {
  For,
  Show,
  captureSignalOnHotRefresh,
  createNativeAppRuntime,
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
} from "#ui/web/runtime";
import { PresenceScene } from "#ui/web/scene";

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
          view({ parts: { Root } }) {
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

  it("guards the TanStack Virtual lifecycle contract used by the runtime", () => {
    const virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
      count: 0,
      estimateSize: () => 1,
      getScrollElement: () => null,
      observeElementOffset,
      observeElementRect,
      scrollToFn: elementScroll,
    });
    expect(typeof virtualizer._willUpdate).toBe("function");
    expect(typeof virtualizer._didMount).toBe("function");
  });

  it("virtualizes ten thousand keyed items without rendering the full collection", async () => {
    const runtime = globalThis as unknown as {
      Node?: unknown;
      HTMLElement?: unknown;
      document?: unknown;
    };
    const previous = {
      Node: runtime.Node,
      HTMLElement: runtime.HTMLElement,
      document: runtime.document,
    };
    const items = Array.from({ length: 10_000 }, (_, id) => ({ id, label: `Item ${id}` }));
    let itemRenders = 0;
    type VirtualListApp = {
      Resources: {};
      Components: { VirtualList: { Parts: { Root: "div" } } };
    };
    const app = defineApp<VirtualListApp>({
      version: 1,
      resources: {},
      components: {
        VirtualList: {
          view({ parts: { Root } }) {
            return Root({
              children: () =>
                For({
                  each: items,
                  by: "id",
                  virtual: true,
                  children(item) {
                    itemRenders++;
                    return jsx("div", { children: item.label });
                  },
                }),
            });
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: { VirtualList: { parts: { Root: "div" } } },
      compiledVisuals: {
        default: {
          themes: { default: null },
          motion: {},
          themeMotion: {},
          components: {
            VirtualList: {
              Root: {
                always: [],
                conditions: [],
                motion: {},
                collection: { axis: "block", estimate: 32, gap: 0, lanes: 1 },
              },
            },
          },
          parameters: {},
          interactions: {},
        },
      },
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.HTMLElement = FakeDomElement;
      runtime.document = fakeDocument();
      const root = new FakeRenderRoot();
      const cleanup = render(
        () => jsx(hooks.components.VirtualList, {}),
        root as unknown as Element,
      );
      await flushMicrotasks();

      expect(itemRenders).toBeGreaterThan(0);
      expect(itemRenders).toBeLessThan(100);
      expect(root.textContent).toContain("Item 0");
      expect(root.textContent).not.toContain("Item 9999");
      cleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.HTMLElement = previous.HTMLElement;
      runtime.document = previous.document;
    }
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
          view({ parts: { Root } }) {
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

  it("composes Feature components through namespaces with local runtime authority", () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    const observed: string[] = [];
    type Preferences = {
      Resources: {};
      Components: { Toggle: { State: { kind: "preferences" }; Parts: { Root: "button" } } };
      API: { readonly kind: "preferences" };
    };
    type Notifications = {
      Resources: {
        inbox: {
          Policy: "memory";
          Key: string;
          State: {};
          Events: {};
          Views: {};
          Commands: {};
        };
      };
      Components: {
        Panel: { State: { kind: "notifications" }; Parts: { Root: "section" } };
        Item: { Parts: { Root: "span" } };
      };
      Features: { preferences: Preferences };
      API: { readonly kind: "notifications" };
    };
    type FeatureUIApp = {
      Resources: {};
      Components: { Shell: { Parts: { Root: "main" } } };
      Features: { notifications: Notifications };
    };
    const preferences = {
      resources: {},
      features: {},
      api: () => ({ kind: "preferences" as const }),
      components: {
        Toggle: {
          state: ({ api }) => ({ kind: api.kind }),
          view({ state, parts: { Root } }) {
            observed.push(state.kind);
            return Root({ children: "toggle" });
          },
        },
      },
    } satisfies FeatureDef<FeatureUIApp, Preferences>;
    const notifications = {
      resources: {
        inbox: { policy: "memory" as const, state: {}, events: {}, views: {}, commands: {} },
      },
      features: { preferences },
      api: () => ({ kind: "notifications" as const }),
      components: {
        Item: { view: ({ parts: { Root } }) => Root({ children: "item" }) },
        Panel: {
          state: ({ api }) => ({ kind: api.kind }),
          view({ state, components: { Item }, features: { preferences }, parts: { Root } }) {
            observed.push(state.kind);
            observed.push("Item,Panel");
            observed.push("preferences");
            return Root({ children: [Item(), preferences.Toggle()] });
          },
        },
      },
    } satisfies FeatureDef<FeatureUIApp, Notifications>;
    const app = defineApp<FeatureUIApp>({
      version: 1,
      resources: {},
      features: { notifications },
      components: {
        Shell: {
          view({ features: { notifications }, parts: { Root } }) {
            observed.push("notifications");
            return Root({ children: notifications.Panel() });
          },
        },
      },
      root: "Shell",
    });
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: {
        Shell: { parts: { Root: "main" } },
        "@feature/notifications/component/Panel": { parts: { Root: "section" } },
        "@feature/notifications/component/Item": { parts: { Root: "span" } },
        "@feature/notifications.preferences/component/Toggle": { parts: { Root: "button" } },
      } as never,
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const cleanup = render(() => hooks.renderRoot(), new FakeRenderRoot() as unknown as Element);
      expect(observed).toEqual([
        "notifications",
        "notifications",
        "Item,Panel",
        "preferences",
        "preferences",
      ]);
      cleanup();
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
          Phases: "active";
          State: { count: number };
          Actions: { changeCount(count: number): void };
          Parts: { Root: "section" };
        };
        Child: {
          Input: { value: number; changeValue(value: number): void };
          State: { value: number; changeValue(value: number): void };
          Parts: { Root: "button" };
        };
      };
    };
    const app = defineApp<ControlledApp>({
      version: 1,
      resources: {},
      components: {
        Parent: {
          machine: {
            context: { count: 0 },
            initial: "active",
            phases: {
              active: {
                on: {
                  changeCount: { update: (_scope, count) => ({ count }) },
                },
              },
            },
          },
          state({ context }) {
            return { count: context.count };
          },
          view({ state, actions, components: { Child }, parts: { Root } }) {
            parentRenders++;
            return Root({
              children: Child({
                get value() {
                  return state.count;
                },
                changeValue: actions.changeCount,
              }),
            });
          },
        },
        Child: {
          state: ({ input }) => ({ value: input.value, changeValue: input.changeValue }),
          view({ state, parts: { Root } }) {
            childRenders++;
            return Root({
              onClick: () => state.changeValue(state.value + 1),
              children: () => state.value,
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

  it("does not remount a nested component when its internal bindings update", async () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    const count = signal(0);
    let renders = 0;

    function Counter() {
      renders++;
      count();
      return jsx("button", { children: () => count() });
    }

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const root = new FakeRenderRoot();
      const cleanup = render(
        () => jsx("section", { children: () => jsx(Counter, {}) }),
        root as unknown as Element,
      );
      const button = descendantElements(root, "button")[0]!;

      expect(button.textContent).toBe("0");
      expect(renders).toBe(1);
      count(1);
      await flushMicrotasks();
      expect(button.textContent).toBe("1");
      expect(descendantElements(root, "button")[0]).toBe(button);
      expect(renders).toBe(1);
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
          Phases: "active";
          State: { count: number };
          Actions: { increment(): void };
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
          machine: {
            context: { count: 0 },
            initial: "active",
            phases: {
              active: {
                on: {
                  increment: { update: ({ context }) => ({ count: context.count + 1 }) },
                },
              },
            },
          },
          state: ({ context }) => ({ count: context.count }),
          view({ state, actions, parts: { Root } }) {
            renderRuns++;
            return Root({ onClick: actions.increment, children: () => state.count });
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

  it("batches semantic State snapshots and drops inactive getter dependencies", () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };
    type BranchApp = {
      Resources: {};
      Components: {
        Branch: {
          Context: { useLeft: boolean; left: number; right: number };
          Phases: "active";
          State: { left: number; right: number; selected: number };
          Actions: {
            updateLeft(value: number): void;
            updateRight(value: number): void;
            swap(): void;
          };
          Parts: { Root: "output" };
        };
      };
    };
    let selectedStateRuns = 0;
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
          machine: {
            context: { useLeft: true, left: 1, right: 2 },
            initial: "active",
            phases: {
              active: {
                on: {
                  updateLeft: { update: (_scope, left) => ({ left }) },
                  updateRight: { update: (_scope, right) => ({ right }) },
                  swap: { update: () => ({ useLeft: false, left: 3, right: 4 }) },
                },
              },
            },
          },
          state({ context }) {
            return {
              get left() {
                return context.left;
              },
              get right() {
                return context.right;
              },
              get selected() {
                selectedStateRuns++;
                return context.useLeft ? context.left : context.right;
              },
            };
          },
          view({ state, actions: componentActions, parts: { Root } }) {
            actions = componentActions;
            effect(() => {
              snapshots.push(`${state.left}:${state.right}:${state.selected}`);
            });
            return Root({ children: () => state.selected });
          },
        },
      },
    });
    const hooks = createHooks({
      app,
      styles: { presets: { default: {} } },
      components: {
        Branch: {
          parts: { Root: "output" },
          state: [{ name: "left" }, { name: "right" }, { name: "selected" }],
        },
      },
    });

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const root = new FakeRenderRoot();
      const cleanup = render(() => jsx(hooks.components.Branch, {}), root as unknown as Element);
      const initialSelectedStateRuns = selectedStateRuns;
      snapshots.length = 0;

      actions!.updateRight(9);
      expect(selectedStateRuns).toBe(initialSelectedStateRuns);
      expect(snapshots).toEqual(["1:9:1"]);

      snapshots.length = 0;
      actions!.swap();
      expect(snapshots).toEqual(["3:4:4"]);
      const swappedSelectedStateRuns = selectedStateRuns;

      snapshots.length = 0;
      actions!.updateLeft(8);
      expect(selectedStateRuns).toBe(swappedSelectedStateRuns);
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
          Phases: "closed" | "open";
          State: { open: boolean; active: string };
          Actions: { toggle(): void };
          Parts: { Root: "button" };
        };
      };
    };
    const app = defineApp<ToggleApp>({
      version: 1,
      resources: {},
      components: {
        Toggle: {
          machine: {
            initial: "closed",
            phases: {
              closed: { on: { toggle: "open" } },
              open: { on: { toggle: "closed" } },
            },
          },
          state: ({ phase }) => ({ open: phase === "open", active: String(phase) }),
          view({ state, actions, parts: { Root } }) {
            return Root({
              onClick: actions.toggle,
              children: () => `${state.open}:${state.active}`,
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
          Phases: "active";
          State: { highlights: number };
          Actions: { highlight(): void };
          Parts: { Root: "button" };
        };
      };
    };
    const app = defineApp<HoverApp>({
      version: 1,
      resources: {},
      components: {
        HoverRow: {
          machine: {
            context: { highlights: 0 },
            initial: "active",
            phases: {
              active: {
                on: {
                  highlight: {
                    update: ({ context }) => ({ highlights: context.highlights + 1 }),
                  },
                },
              },
            },
          },
          state: ({ context }) => ({ highlights: context.highlights }),
          view({ state, actions, parts: { Root } }) {
            return Root({ onPointerMove: actions.highlight, children: () => state.highlights });
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

  it("mounts and updates a For delayed as a structural child", async () => {
    const runtime = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtime.Node, document: runtime.document };

    try {
      runtime.Node = FakeDomNode;
      runtime.document = fakeDocument();
      const visible = signal(false);
      const items = signal<Array<{ id: string; label: string }>>([]);
      const root = new FakeRenderRoot();
      const cleanup = render(
        () =>
          Show({
            when: () => visible(),
            children: () =>
              jsx("main", {
                children: () =>
                  For({
                    each: () => items(),
                    by: "id",
                    fallback: () => jsx("p", { children: "Empty" }),
                    children: (item) => jsx("p", { children: () => item.label }),
                  }),
              }),
          }),
        root as unknown as Element,
      );

      await flushMicrotasks();
      expect(root.textContent).toBe("");

      visible(true);
      await flushMicrotasks();
      expect(root.textContent).toBe("Empty");

      items([{ id: "one", label: "First" }]);
      await flushMicrotasks();
      expect(root.textContent).toBe("First");

      cleanup();
    } finally {
      runtime.Node = previous.Node;
      runtime.document = previous.document;
    }
  });

  it("keeps native Resource synchronization independent from conditional render ownership", async () => {
    const runtimeGlobals = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtimeGlobals.Node, document: runtimeGlobals.document };
    type ProjectionApp = {
      Actor: { id: string };
      Resources: {
        counter: {
          Key: { id: string };
          State: { count: number };
          Events: {};
          Views: { count: number };
          Commands: {};
        };
      };
      Components: {};
    };
    const app = defineApp<ProjectionApp>({
      version: 1,
      resources: {
        counter: {
          state: { count: 0 },
          events: {},
          views: { count: ({ state }) => state.count },
          commands: {},
        },
      },
      components: {},
    });
    let count = 0;
    const listeners = new Set<(scope: Record<string, unknown>) => void>();
    const remote = {
      get count() {
        return count;
      },
      sync: { cursor: 0, syncing: false, stale: false, error: null },
      subscribe(listener: (scope: Record<string, unknown>) => void) {
        listeners.add(listener);
        listener(remote);
        return () => listeners.delete(listener);
      },
    };
    const client = {
      connected: true,
      counter: () => remote,
      dispose() {
        disposed += 1;
      },
    } as unknown as Client<ProjectionApp>;
    let disposed = 0;

    try {
      runtimeGlobals.Node = FakeDomNode;
      runtimeGlobals.document = fakeDocument();
      const native = createNativeAppRuntime(app);
      native.start(async () => client);
      await flushMicrotasks();

      const visible = signal(false);
      const root = new FakeRenderRoot();
      const cleanup = render(
        () =>
          Show({
            when: () => visible(),
            children: () => {
              const counter = native.api.useCounter({ id: "proof" });
              return jsx("p", { children: () => counter.count });
            },
          }),
        root as unknown as Element,
      );

      visible(true);
      await flushMicrotasks();
      expect(root.textContent).toBe("0");
      expect(listeners.size).toBe(1);

      visible(false);
      await flushMicrotasks();
      count = 1;
      for (const listener of listeners) listener(remote);
      visible(true);
      await flushMicrotasks();
      expect(root.textContent).toBe("1");
      expect(listeners.size).toBe(1);

      cleanup();
      native.dispose();
      native.dispose();
      expect(listeners.size).toBe(0);
      expect(disposed).toBe(1);
    } finally {
      runtimeGlobals.Node = previous.Node;
      runtimeGlobals.document = previous.document;
    }
  });

  it("hydrates Feature-owned CRDT state before its first fine-grained render", async () => {
    const runtimeGlobals = globalThis as unknown as { Node?: unknown; document?: unknown };
    const previous = { Node: runtimeGlobals.Node, document: runtimeGlobals.document };
    type Register = { readonly clock: number; readonly peer: string; readonly value: string };
    type Documents = {
      Resources: {
        documents: {
          Policy: "device";
          Key: string;
          State: { fields: Record<string, Register> };
          Events: { merged: { changes: Readonly<Record<string, Register>> } };
          Views: { fields: Readonly<Record<string, Register>> };
          Commands: {
            merge: { Input: { changes: Readonly<Record<string, Register>> }; Event: "merged" };
          };
        };
      };
      Components: {
        Editor: { Input: { id: string }; State: { title: string }; Parts: { Root: "output" } };
      };
      API: {
        document(id: string): { readonly fields: Readonly<Record<string, Register>> };
      };
    };
    type DocumentUIApp = {
      Resources: {};
      Components: { Shell: { Parts: { Root: "main" } } };
      Features: { documents: Documents };
    };
    let editorRenders = 0;
    let shellRenders = 0;
    const documents = {
      resources: {
        documents: {
          policy: "device" as const,
          state: { fields: {} },
          events: {
            merged({ state, payload }) {
              for (const [field, candidate] of Object.entries(payload.changes)) {
                const current = state.fields[field];
                if (
                  !current ||
                  candidate.clock > current.clock ||
                  (candidate.clock === current.clock && candidate.peer > current.peer)
                ) {
                  state.fields[field] = candidate;
                }
              }
            },
          },
          views: { fields: ({ state }) => ({ ...state.fields }) },
          commands: {
            merge(context, { changes }) {
              context.event.merged({ changes });
            },
          },
        },
      },
      features: {},
      api: ({ resources }) => ({ document: resources.documents }),
      components: {
        Editor: {
          state: ({ input, api }) => ({
            title: api.document(input.id).fields.title?.value ?? "Untitled",
          }),
          view({ state, parts: { Root } }) {
            editorRenders++;
            return Root({ children: () => state.title });
          },
        },
      },
    } satisfies FeatureDef<DocumentUIApp, Documents>;
    const app = defineApp<DocumentUIApp>({
      version: 1,
      resources: {},
      features: { documents },
      components: {
        Shell: {
          view({ features: { documents }, parts: { Root } }) {
            shellRenders++;
            return Root({ children: documents.Editor({ id: "doc" }) });
          },
        },
      },
      root: "Shell",
    });
    let fields: Readonly<Record<string, Register>> = {
      title: { clock: 1, peer: "a", value: "Draft" },
    };
    const listeners = new Set<() => void>();
    const remote = {
      get fields() {
        return fields;
      },
      sync: { cursor: 1, syncing: false, stale: false, error: null },
      subscribe(listener: () => void) {
        listeners.add(listener);
        listener();
        return () => listeners.delete(listener);
      },
      async merge() {
        return { ok: true as const };
      },
    };
    let disposed = 0;
    const client = {
      connected: true,
      "@feature/documents/resource/documents": () => remote,
      dispose: () => void (disposed += 1),
    } as unknown as Client<DocumentUIApp>;
    const hooks = createHooks({
      app,
      styles: { defaultPreset: "default", presets: { default: {} } },
      components: {
        Shell: { parts: { Root: "main" } },
        "@feature/documents/component/Editor": { parts: { Root: "output" } },
      } as never,
    });

    try {
      runtimeGlobals.Node = FakeDomNode;
      runtimeGlobals.document = fakeDocument();
      await hooks.start(async () => client);
      const root = new FakeRenderRoot();
      const cleanup = render(() => hooks.renderRoot(), root as unknown as Element);

      expect(root.textContent).toBe("Draft");
      expect([shellRenders, editorRenders, listeners.size]).toEqual([1, 1, 1]);

      fields = { title: { clock: 2, peer: "b", value: "Final" } };
      for (const listener of listeners) listener();
      await flushMicrotasks();

      expect(root.textContent).toBe("Final");
      expect([shellRenders, editorRenders, listeners.size]).toEqual([1, 1, 1]);

      cleanup();
      hooks.dispose();
      hooks.dispose();
      expect(listeners.size).toBe(0);
      expect(disposed).toBe(1);
    } finally {
      runtimeGlobals.Node = previous.Node;
      runtimeGlobals.document = previous.document;
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
  static readonly TEXT_NODE = 3;
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
  clientWidth = 600;
  clientHeight = 600;
  scrollWidth = 600;
  scrollHeight = 600;
  scrollLeft = 0;
  scrollTop = 0;

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

  scrollTo(options: ScrollToOptions) {
    if (typeof options.left === "number") this.scrollLeft = options.left;
    if (typeof options.top === "number") this.scrollTop = options.top;
    this.dispatchEvent(new Event("scroll"));
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

  getClientRects() {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
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
  readonly nodeType = 11;

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
