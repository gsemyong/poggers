import fc from "fast-check";
import { describe, expect, test, vi } from "vitest";

import {
  prepareWebDocument,
  renderWebDocument,
  validateWebDocument,
  type WebDocumentComponentContract,
} from "@/adapters/web/document";
import type { ProgramManifest } from "@/core/capability";

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

describe("web document IR", () => {
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
      application,
      program: "browser",
      manifest,
      components: contracts,
    });
    const second = await prepareWebDocument({
      application,
      program: "browser",
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
    expect(html).toContain('data-poggers-rendering="initial-state-ssr"');
  });

  test("rejects Capability access and malformed canonical artifacts", async () => {
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
      application,
      program: "browser",
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
          version: 1 as const,
          rendering: "initial-state-ssr" as const,
          language: "en",
          title,
          entry: "/app.js",
          styles: [".root{color:red}"],
          root: [
            {
              kind: "element" as const,
              hydration: "e0",
              tag: "main",
              attributes: [
                { name: "data-label", value: attribute },
                { name: "data-poggers-h", value: "e0" },
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
      version: 1 as const,
      rendering: "initial-state-ssr" as const,
      language: "en",
      title: "Safe",
      entry: "/app.js",
      styles: [".root{}"],
      root: [
        {
          kind: "element" as const,
          hydration: "e0",
          tag: "main",
          attributes: [{ name: "data-poggers-h", value: "e0" }],
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
              { name: "data-poggers-h", value: "e0" },
              { name: "data-poggers-h", value: "e0" },
            ],
          },
        ],
      }),
    ).toThrow("Duplicate web attribute");
    expect(() =>
      validateWebDocument({
        ...document,
        root: [{ ...document.root[0]!, attributes: [{ name: "data-poggers-h", value: "e1" }] }],
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
