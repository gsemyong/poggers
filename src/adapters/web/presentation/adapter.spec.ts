import { describe, expect, it } from "vitest";

import { createWebPresentationAdapter, type WebStyleHost } from "./adapter";

type FakeElement = Element & {
  readonly classes: Set<string>;
};

function createElement(ownerDocument: object, initial: readonly string[] = []): FakeElement {
  const classes = new Set(initial);
  return {
    ownerDocument,
    classes,
    classList: {
      add: (...values: string[]) => values.forEach((value) => classes.add(value)),
      remove: (...values: string[]) => values.forEach((value) => classes.delete(value)),
    },
  } as unknown as FakeElement;
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

describe("web Presentation adapter", () => {
  it("shares deterministic CSS classes without touching unrelated classes", () => {
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

    const itemClass = [...first.classes][0];
    expect(itemClass).toBeDefined();
    expect(second.classes).toEqual(new Set([itemClass!]));
    expect(root.classes).toContain("authored");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^@layer poggers\.presentation\{/);
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

  it("deduplicates rules across sessions in the same Document", () => {
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
});
