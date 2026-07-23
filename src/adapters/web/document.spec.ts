import fc from "fast-check";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  applyWebDocumentHead,
  parseWebRouteData,
  prepareCompiledWebDocument,
  prepareCompiledWebDocumentStream,
  prepareClientWebDocument,
  prepareWebDocument,
  renderWebDeferredFrame,
  renderWebDocument,
  renderWebMarkdown,
  validateWebDeferredFrame,
  validateWebDocument,
  type WebDocumentComponentContract,
} from "@/adapters/web/document";
import type { CompiledWebComponentIR, WebRenderNodeIR } from "@/adapters/web/routing";
import type { ProgramManifest } from "@/compiler/ir";

const manifest: ProgramManifest = {
  name: "browser",
  contributions: [
    { feature: "shell", requires: [], provides: [] },
    { feature: "shell.items", requires: [], provides: [] },
  ],
};

const contracts: Record<string, WebDocumentComponentContract> = {
  "@feature/shell.items/component/Item": {
    elements: { Root: "li", Label: "span" },
    state: [],
    propCallbacks: [],
  },
  "@feature/shell/component/Application": {
    elements: { Root: "main", Title: "h1", List: "ul", Empty: "p", Input: "input" },
    state: [],
    propCallbacks: [],
  },
};

const emptyPresentation = {
  parameters: {},
  create() {
    return {};
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("web document IR", () => {
  test("streams a deterministic shell and a JSON-safe deferred completion", async () => {
    const activity = controlledPromise<string>();
    const prepared = prepareCompiledWebDocumentStream({
      document: prepareClientWebDocument({ title: "Fallback" }),
      route: { feature: "tasks", name: "activity" },
      location: "/activity",
      view: awaitNode("activity"),
      components: [],
      params: {},
      search: {},
      loader: { data: { title: "Activity", activity: () => activity.promise } },
      deferred: ["activity"],
      metadata: { title: "Activity" },
    });

    expect(prepared.document.root).toEqual([
      {
        kind: "boundary",
        boundary: "d0",
        field: "activity",
        children: [{ kind: "text", hydration: "d0:t0", value: "Loading" }],
      },
    ]);
    expect(prepared.document.hydration).toMatchObject({
      loader: {
        data: {
          title: "Activity",
          activity: {
            version: 1,
            kind: "deferred",
            boundary: "d0",
            field: "activity",
            state: { status: "pending" },
          },
        },
      },
    });
    expect(renderWebDocument(prepared.document)).toContain(
      '<template data-kit-boundary-start="d0" data-kit-deferred-field="activity"></template>',
    );

    const iterator = prepared.frames[Symbol.asyncIterator]();
    activity.resolve("Ready <now>");
    const result = await iterator.next();
    expect(result.done).toBe(false);
    const frame = result.value!;
    expect(frame).toEqual({
      version: 1,
      boundary: "d0",
      field: "activity",
      state: { status: "resolved", value: "Ready <now>" },
      root: [{ kind: "text", hydration: "d0:t0", value: "Ready <now>" }],
    });
    expect(renderWebDeferredFrame(frame)).toContain("Ready &lt;now&gt;");
    expect((await iterator.next()).done).toBe(true);
  });

  test("stops an unfinished deferred scheduler when its request is canceled", async () => {
    const activity = controlledPromise<string>();
    const controller = new AbortController();
    const prepared = prepareCompiledWebDocumentStream({
      document: prepareClientWebDocument({ title: "Canceled" }),
      route: { feature: "tasks", name: "canceled" },
      location: "/canceled",
      view: awaitNode("activity"),
      components: [],
      params: {},
      search: {},
      loader: { data: { activity: () => activity.promise } },
      deferred: ["activity"],
      metadata: {},
      signal: controller.signal,
    });
    const iterator = prepared.frames[Symbol.asyncIterator]();
    const next = iterator.next();
    await Promise.resolve();
    controller.abort();
    await expect(next).resolves.toEqual({ done: true, value: undefined });
    activity.resolve("Too late");
  });

  test("emits sibling deferred boundaries in completion order", async () => {
    const first = controlledPromise<string>();
    const second = controlledPromise<string>();
    const prepared = prepareCompiledWebDocumentStream({
      document: prepareClientWebDocument({ title: "Deferred" }),
      route: { feature: "tasks", name: "deferred" },
      location: "/deferred",
      view: {
        kind: "fragment",
        children: [awaitNode("first"), awaitNode("second")],
      },
      components: [],
      params: {},
      search: {},
      loader: { data: { first: () => first.promise, second: () => second.promise } },
      deferred: ["first", "second"],
      metadata: {},
    });
    const iterator = prepared.frames[Symbol.asyncIterator]();

    second.resolve("Second");
    expect((await iterator.next()).value?.field).toBe("second");
    first.resolve("First");
    expect((await iterator.next()).value?.field).toBe("first");
    expect((await iterator.next()).done).toBe(true);
  });

  test("retains nested boundary identity when the child settles before its parent", async () => {
    const parent = controlledPromise<string>();
    const child = controlledPromise<string>();
    const nested: WebRenderNodeIR = {
      ...awaitNode("parent"),
      resolved: {
        kind: "fragment",
        children: [
          { kind: "text", value: { kind: "local", name: "parent", path: [] } },
          awaitNode("child"),
        ],
      },
    };
    const prepared = prepareCompiledWebDocumentStream({
      document: prepareClientWebDocument({ title: "Nested" }),
      route: { feature: "tasks", name: "nested" },
      location: "/nested",
      view: nested,
      components: [],
      params: {},
      search: {},
      loader: { data: { parent: () => parent.promise, child: () => child.promise } },
      deferred: ["parent", "child"],
      metadata: {},
    });
    const iterator = prepared.frames[Symbol.asyncIterator]();

    child.resolve("Child");
    parent.resolve("Parent");
    const parentFrame = (await iterator.next()).value!;
    const childFrame = (await iterator.next()).value!;
    expect(parentFrame.field).toBe("parent");
    expect(parentFrame.root).toContainEqual(
      expect.objectContaining({ kind: "boundary", boundary: "d1", field: "child" }),
    );
    expect(childFrame).toMatchObject({
      boundary: "d1",
      field: "child",
      root: [{ hydration: "d1:t0", value: "Child" }],
    });
  });

  test("sanitizes deferred failures and rejects invalid completion values", async () => {
    const failed = prepareCompiledWebDocumentStream({
      document: prepareClientWebDocument({ title: "Failed" }),
      route: { feature: "tasks", name: "failed" },
      location: "/failed",
      view: awaitNode("activity"),
      components: [],
      params: {},
      search: {},
      loader: {
        data: { activity: () => Promise.reject(new Error("private database detail")) },
      },
      deferred: ["activity"],
      metadata: {},
    });
    const failure = (await failed.frames[Symbol.asyncIterator]().next()).value!;
    expect(failure.state).toEqual({
      status: "rejected",
      error: { message: "Deferred data failed." },
    });
    expect(failure.root).toEqual([{ kind: "text", hydration: "d0:t0", value: "Unavailable" }]);

    expect(() =>
      validateWebDeferredFrame({
        version: 1,
        boundary: "d0",
        field: "activity",
        state: { status: "resolved", value: { invalid: undefined } },
        root: [],
      }),
    ).toThrow("finite JSON values");
  });

  test("rejects more than one reveal boundary for one deferred field", () => {
    expect(() =>
      prepareCompiledWebDocumentStream({
        document: prepareClientWebDocument({ title: "Duplicate" }),
        route: { feature: "tasks", name: "duplicate" },
        location: "/duplicate",
        view: { kind: "fragment", children: [awaitNode("activity"), awaitNode("activity")] },
        components: [],
        params: {},
        search: {},
        loader: { data: { activity: () => "Ready" } },
        deferred: ["activity"],
        metadata: {},
      }),
    ).toThrow("must have one Await boundary");
  });

  test("renders compiled request data, Component composition, slots, and a safe hydration seed", () => {
    const span = { file: "feature.tsx", line: 1, column: 1, length: 1 };
    const components: readonly CompiledWebComponentIR[] = [
      {
        feature: "tasks",
        name: "Card",
        elements: { Root: "article", Title: "h2", Detail: "p" },
        state: { expanded: true },
        view: {
          kind: "element",
          element: "Root",
          tag: "article",
          attributes: [
            { name: "data-kind", value: { kind: "path", root: "props", path: ["kind"] } },
          ],
          children: [
            {
              kind: "element",
              element: "Title",
              tag: "h2",
              attributes: [],
              children: [{ kind: "text", value: { kind: "path", root: "props", path: ["title"] } }],
            },
            {
              kind: "conditional",
              condition: { kind: "path", root: "state", path: ["expanded"] },
              consequent: {
                kind: "element",
                element: "Detail",
                tag: "p",
                attributes: [],
                children: [
                  {
                    kind: "text",
                    value: { kind: "path", root: "props", path: ["children"] },
                  },
                ],
              },
              alternate: { kind: "none" },
            },
          ],
        },
        span,
      },
    ];
    const view: WebRenderNodeIR = {
      kind: "component",
      target: "tasks.Card",
      props: [
        {
          name: "title",
          value: { kind: "path", root: "data", path: ["title"] },
          node: false,
        },
        { name: "kind", value: { kind: "literal", value: "request" }, node: false },
        {
          name: "children",
          value: {
            kind: "text",
            value: { kind: "path", root: "params", path: ["id"] },
          },
          node: true,
        },
      ],
    };
    const document = prepareCompiledWebDocument({
      document: prepareClientWebDocument({ title: "Fallback" }),
      route: { feature: "tasks", name: "detail" },
      location: "/tasks/42?tab=details",
      view,
      components,
      params: { id: "42" },
      search: { tab: "details" },
      loader: { data: { title: "</script><script>bad()</script>" } },
      metadata: { title: "Task 42", description: "Task detail" },
    });

    expect(document.root).toEqual([
      expect.objectContaining({
        kind: "element",
        tag: "article",
        hydration: "e0",
        attributes: expect.arrayContaining([
          {
            name: "data-kit-element",
            value: "@feature/tasks/component/Card/Root",
          },
        ]),
        children: [
          expect.objectContaining({
            kind: "element",
            tag: "h2",
            children: [expect.objectContaining({ kind: "text", hydration: "t0" })],
          }),
          expect.objectContaining({
            kind: "element",
            tag: "p",
            children: [expect.objectContaining({ value: "42", hydration: "t1" })],
          }),
        ],
      }),
    ]);
    const html = renderWebDocument(document);
    expect(html).toContain("&lt;/script&gt;&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).toContain('<script id="kit-hydration" type="application/json">');
    expect(html).not.toContain("</script><script>bad()");
    expect(html).toContain('"title":"\\u003c/script>\\u003cscript>bad()\\u003c/script>"');
  });

  test("renders an explicit client document without pretending to hydrate markup", () => {
    const document = prepareClientWebDocument({
      title: "Private workspace",
      metadata: { description: "Escaped <private> workspace" },
    });
    const html = renderWebDocument(document);
    expect(html).toContain('<div id="app" data-kit-rendering="client"></div>');
    expect(html).toContain('<meta name="description" content="Escaped &lt;private&gt; workspace"');
    expect(() =>
      validateWebDocument({
        ...document,
        root: [
          {
            kind: "text" as const,
            hydration: "t0",
            value: "not client-owned",
          },
        ],
      }),
    ).toThrow("empty root");
  });

  test("derives Markdown and frontmatter from the canonical document tree", () => {
    const base = prepareClientWebDocument({
      title: "Public guide",
      language: "sk",
      metadata: {
        canonical: "https://example.test/guide",
        description: "A concise guide",
      },
    });
    const document = {
      ...base,
      rendering: "hydrate" as const,
      root: [
        {
          kind: "element" as const,
          hydration: "e0",
          tag: "main",
          attributes: [{ name: "data-kit-h", value: "e0" }],
          children: [
            {
              kind: "element" as const,
              hydration: "e1",
              tag: "h1",
              attributes: [{ name: "data-kit-h", value: "e1" }],
              children: [{ kind: "text" as const, hydration: "t0", value: "Build *well*" }],
            },
            {
              kind: "element" as const,
              hydration: "e2",
              tag: "p",
              attributes: [{ name: "data-kit-h", value: "e2" }],
              children: [
                { kind: "text" as const, hydration: "t1", value: "Read " },
                {
                  kind: "element" as const,
                  hydration: "e3",
                  tag: "a",
                  attributes: [
                    { name: "data-kit-h", value: "e3" },
                    { name: "href", value: "/reference" },
                  ],
                  children: [{ kind: "text" as const, hydration: "t2", value: "the reference" }],
                },
                { kind: "text" as const, hydration: "t3", value: "." },
              ],
            },
          ],
        },
      ],
    };

    expect(renderWebMarkdown(document)).toBe(`---
title: "Public guide"
language: "sk"
description: "A concise guide"
canonical: "https://example.test/guide"
---

# Build \\*well\\*

Read [the reference](/reference).
`);
  });

  test("accepts only the versioned Route-data protocol", () => {
    expect(parseWebRouteData({ version: 1, redirect: "/tasks?mode=open" })).toEqual({
      version: 1,
      redirect: "/tasks?mode=open",
    });
    expect(() => parseWebRouteData({ version: 2, redirect: "/tasks" })).toThrow(
      "Invalid web Route redirect",
    );
    expect(() => parseWebRouteData({ version: 1, redirect: "/tasks", unexpected: true })).toThrow(
      "web Route redirect has unsupported fields",
    );
    expect(() => parseWebRouteData({ version: 1, redirect: "https://example.test" })).toThrow(
      "Invalid web Route redirect",
    );
  });

  test("prepares nested initial UI without running effects and renders escaped HTML", async () => {
    const start = vi.fn();
    const mount = vi.fn();
    const click = vi.fn();
    const application = {
      metadata: { name: "A <safe> title" },
      features: {
        shell: {
          features: {
            items: {
              programs: {
                browser: {
                  state: { values: ["First", "<script>bad()</script>"] },
                  start,
                  components: {
                    Item: {
                      view({ elements: { Root, Label }, props }: ViewContext) {
                        return Root!({ children: Label!({ children: () => props.label }) });
                      },
                    },
                  },
                },
              },
            },
          },
          programs: {
            browser: {
              state: { heading: "Prepared & ready" },
              actions: { click },
              start,
              components: {
                Application: {
                  mount,
                  view({ components: { Items }, elements, feature, features }: ViewContext) {
                    const { Root, Title, List, Empty, Input } = elements;
                    const values = features.items!.values as readonly string[];
                    const Item = (Items as Record<string, Element>)?.Item;
                    if (!Item) throw new Error("Missing Items.Item.");
                    return Root!({
                      "aria-busy": false,
                      children: [
                        Title!({ children: () => feature.heading }),
                        values.length
                          ? List!({
                              children: values.map((label) => Item({ label })),
                            })
                          : Empty!({ children: "No values" }),
                        Input!({ disabled: true, value: 'quoted "value"' }),
                      ],
                    });
                  },
                },
              },
              root: "Application",
            },
          },
        },
      },
    };

    const first = await prepareWebDocument({
      system: application,
      interface: "shell",
      program: "browser",
      presentation: emptyPresentation,
      manifest,
      components: contracts,
    });
    const second = await prepareWebDocument({
      system: application,
      interface: "shell",
      program: "browser",
      presentation: emptyPresentation,
      manifest,
      components: contracts,
    });
    const html = renderWebDocument(first);

    expect(first).toEqual(second);
    expect(start).not.toHaveBeenCalled();
    expect(mount).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(html).toContain("<h1");
    expect(html).toContain("Prepared &amp; ready");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>bad()");
    expect(html).toContain('value="quoted &quot;value&quot;"');
    expect(html).toContain('data-kit-rendering="hydrate"');
    expect(html).toContain('<link rel="modulepreload" href="/app.js">');
    expect(first.root[0]).toMatchObject({ kind: "element", hydration: "e0" });
  });

  test("uses route metadata while preparing route documents", async () => {
    const application = {
      metadata: { name: "Fallback" },
      features: {
        shell: {
          programs: {
            browser: {
              state: {},
              components: {
                Application: {
                  view({ elements: { Root } }: ViewContext) {
                    return Root!({ children: "Hello" });
                  },
                },
              },
              routes: {
                index: {
                  view() {
                    return "Hello";
                  },
                },
              },
            },
          },
        },
      },
    };
    const document = await prepareWebDocument({
      system: application,
      interface: "shell",
      program: "browser",
      presentation: emptyPresentation,
      manifest: {
        name: "browser",
        contributions: [{ feature: "shell", requires: [], provides: [] }],
      },
      components: {
        "@feature/shell/component/Application": {
          elements: { Root: "main" },
          state: [],
          propCallbacks: [],
        },
      },
      route: {
        feature: "shell",
        name: "index",
        params: {},
        search: {},
        metadata: {
          title: "Route title",
          description: "Route description",
          canonical: "https://example.test/",
          robots: "index,follow",
          alternates: [{ language: "sk", href: "https://example.test/sk" }],
          social: {
            type: "article",
            card: "summary_large_image",
            images: [
              {
                url: "https://example.test/cover.jpg",
                alt: "Route cover",
                width: 1200,
                height: 630,
              },
            ],
          },
          icons: [{ url: "/icon.svg", type: "image/svg+xml" }],
          manifest: "/manifest.webmanifest",
          structuredData: [
            { "@context": "https://schema.org", "@type": "Article", name: "Route <title>" },
          ],
          priorityImage: {
            url: "/cover.jpg",
            sourceSet: "/cover.jpg 1x, /cover@2x.jpg 2x",
            sizes: "100vw",
          },
        },
      },
    });
    const html = renderWebDocument(document);
    expect(html).toContain("<title>Route title</title>");
    expect(html).toContain('<meta name="description" content="Route description"');
    expect(html).toContain('<link rel="canonical" href="https://example.test/"');
    expect(html).toContain('<meta name="robots" content="index,follow"');
    expect(html).toContain('<link rel="alternate" hreflang="sk" href="https://example.test/sk"');
    expect(html).toContain('<meta property="og:title" content="Route title"');
    expect(html).toContain('<meta property="og:image" content="https://example.test/cover.jpg"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml"');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain("Route \\u003ctitle>");
    expect(html).toContain('<link rel="preload" as="image" fetchpriority="high" href="/cover.jpg"');
  });

  test("applies and removes route metadata in a live document", () => {
    const live = fakeDocument();
    vi.stubGlobal("document", live.document);

    applyWebDocumentHead({
      title: "Task editor",
      language: "sk",
      metadata: {
        description: "Edit a task",
        canonical: "https://example.test/tasks/one",
        robots: "noindex",
      },
    });

    expect(live.document.title).toBe("Task editor");
    expect(live.document.documentElement.lang).toBe("sk");
    expect(live.attributes("meta[name=description]")).toEqual({
      name: "description",
      content: "Edit a task",
    });
    expect(live.attributes("link[rel=canonical]")).toEqual({
      rel: "canonical",
      href: "https://example.test/tasks/one",
    });

    applyWebDocumentHead({ title: "Tasks", language: "en", metadata: {} });
    expect(live.attributes("meta[name=description]")).toBeUndefined();
    expect(live.attributes("meta[name=robots]")).toBeUndefined();
    expect(live.attributes("link[rel=canonical]")).toBeUndefined();
  });

  test("rejects Dependency access and malformed canonical artifacts", async () => {
    const application = {
      features: {
        shell: {
          programs: {
            browser: {
              state: {},
              components: {
                Application: {
                  view({ elements: { Root } }: ViewContext) {
                    return Root!({ children: "Hello" });
                  },
                },
              },
              root: "Application",
            },
          },
        },
      },
    };
    const shellManifest: ProgramManifest = {
      name: "browser",
      contributions: [{ feature: "shell", requires: ["repository"], provides: [] }],
    };
    const document = await prepareWebDocument({
      system: application,
      interface: "shell",
      program: "browser",
      presentation: emptyPresentation,
      manifest: shellManifest,
      components: {
        "@feature/shell/component/Application": {
          elements: { Root: "main" },
          state: [],
          propCallbacks: [],
        },
      },
    });

    expect(() =>
      validateWebDocument({
        ...document,
        root: [document.root[0]!, { ...document.root[0]! }],
      }),
    ).toThrow("Duplicate or invalid hydration identity");
  });

  test("round-trips and escapes arbitrary data deterministically", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (title, text, attribute) => {
        const document = {
          version: 4 as const,
          rendering: "hydrate" as const,
          language: "en",
          title,
          metadata: {},
          entry: "/app.js",
          preloads: ["/shared.js"],
          styles: [".root{color:red}"],
          hydration: false as const,
          root: [
            {
              kind: "element" as const,
              hydration: "e0",
              tag: "main",
              attributes: [
                { name: "data-label", value: attribute },
                { name: "data-kit-h", value: "e0" },
              ],
              children: [{ kind: "text" as const, hydration: "t0", value: text }],
            },
          ],
        };
        const roundTrip = JSON.parse(JSON.stringify(document)) as typeof document;
        expect(roundTrip).toEqual(document);
        expect(renderWebDocument(roundTrip)).toBe(renderWebDocument(document));
      }),
      { numRuns: 200 },
    );
  });

  test("rejects ambiguous or executable document data", () => {
    const document = {
      version: 4 as const,
      rendering: "hydrate" as const,
      language: "en",
      title: "Safe",
      metadata: {},
      entry: "/app.js",
      preloads: [] as const,
      styles: [".root{}"],
      hydration: false as const,
      root: [
        {
          kind: "element" as const,
          hydration: "e0",
          tag: "main",
          attributes: [{ name: "data-kit-h", value: "e0" }],
          children: [] as const,
        },
      ],
    };
    expect(() => validateWebDocument({ ...document, styles: ["</style><script>"] })).toThrow(
      "cannot close",
    );
    expect(() =>
      validateWebDocument({
        ...document,
        root: [
          {
            ...document.root[0]!,
            attributes: [
              { name: "data-kit-h", value: "e0" },
              { name: "data-kit-h", value: "e0" },
            ],
          },
        ],
      }),
    ).toThrow("Duplicate web attribute");
    expect(() =>
      validateWebDocument({
        ...document,
        root: [{ ...document.root[0]!, attributes: [{ name: "data-kit-h", value: "e1" }] }],
      }),
    ).toThrow("mismatched hydration");
  });
});

type ViewContext = Readonly<{
  props: Readonly<Record<string, unknown>>;
  feature: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  elements: Readonly<Record<string, (props?: Readonly<Record<string, unknown>>) => unknown>>;
  components: Readonly<Record<string, unknown>>;
}>;

type Element = (props?: Readonly<Record<string, unknown>>) => unknown;

function awaitNode(field: string): Extract<WebRenderNodeIR, { kind: "await" }> {
  return {
    kind: "await",
    value: { kind: "path", root: "data", path: [field] },
    item: field,
    pending: { kind: "text", value: { kind: "literal", value: "Loading" } },
    resolved: {
      kind: "text",
      value: { kind: "local", name: field, path: [] },
    },
    error: {
      item: "error",
      body: { kind: "text", value: { kind: "literal", value: "Unavailable" } },
    },
  };
}

function controlledPromise<Value>(): Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
}> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeDocument(): Readonly<{
  document: Document;
  attributes(selector: string): Readonly<Record<string, string>> | undefined;
}> {
  type Node = Readonly<{
    tag: string;
    attributes: Record<string, string>;
    remove(): void;
    setAttribute(name: string, value: string): void;
  }>;
  const nodes: Node[] = [];
  const select = (selector: string): Node | undefined => {
    if (selector === "meta[name=description]") {
      return nodes.find(
        ({ tag, attributes }) => tag === "meta" && attributes.name === "description",
      );
    }
    if (selector === "meta[name=robots]") {
      return nodes.find(({ tag, attributes }) => tag === "meta" && attributes.name === "robots");
    }
    if (selector === "link[rel=canonical]") {
      return nodes.find(({ tag, attributes }) => tag === "link" && attributes.rel === "canonical");
    }
    return undefined;
  };
  const document = {
    title: "",
    documentElement: { lang: "" },
    head: {
      append(node: Node) {
        nodes.push(node);
      },
      querySelector: select,
      querySelectorAll(selector: string) {
        return selector === "[data-kit-route-head]"
          ? nodes.filter(({ attributes }) => "data-kit-route-head" in attributes)
          : [];
      },
    },
    createElement(tag: string): Node {
      const attributes: Record<string, string> = {};
      const node: Node = {
        tag,
        attributes,
        remove() {
          const index = nodes.indexOf(node);
          if (index >= 0) nodes.splice(index, 1);
        },
        setAttribute(name, value) {
          attributes[name] = value;
        },
      };
      return node;
    },
  } as unknown as Document;
  return {
    document,
    attributes(selector) {
      const attributes = select(selector)?.attributes;
      if (!attributes) return undefined;
      const { "data-kit-route-head": _marker, ...semantic } = attributes;
      return semantic;
    },
  };
}
