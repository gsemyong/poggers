import { describe, expect, it } from "bun:test";
import {
  For,
  Show,
  effect,
  jsx,
  reactiveValue,
  render,
  signal,
  type Child,
  type HotRenderState,
  type Signal,
} from "../src/ui";

describe("ui runtime", () => {
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
    expect(hotState.signals).toBeUndefined();

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
              return jsx("li", { id: item.id, children: item.label });
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
      await flushMicrotasks();

      expect(panel.hasAttribute("hidden")).toBe(false);
      expect(panel.getAttribute("aria-hidden")).toBe(null);
      expect(panel.hasAttribute("inert")).toBe(false);
      expect(panel.getAttribute("data-motion-state")).toBe("entering");
    } finally {
      runtime.HTMLElement = previous.HTMLElement;
      runtime.Node = previous.Node;
      runtime.document = previous.document;
      runtime.window = previous.window;
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
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
