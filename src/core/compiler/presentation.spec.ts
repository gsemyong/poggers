import { describe, expect, it } from "vitest";

import { compilePresentationSource, PresentationSourceDiagnostic } from "./presentation";

describe("Presentation source compiler", () => {
  it("extracts and lowers named Animation bindings and temporal queries", () => {
    const result = compilePresentationSource(candidate(), "src/presentation.ts");
    expect(result.ir.animations).toEqual([
      expect.objectContaining({
        id: "presentation/Sheet::openness",
        binding: "openness",
        source: "state.open ? 1 : 0",
        animation: "parameters.sheet",
        events: [],
      }),
    ]);
    expect(result.ir.declarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ animations: ["presentation/Sheet::openness"] }),
      ]),
    );
    expect(result.code).toContain(
      'animate(state.open ? 1 : 0, parameters.sheet, "presentation/Sheet::openness")',
    );
    expect(result.code).toContain('velocity(openness, "presentation/Sheet::openness")');
    expect(result.code).toContain('settled(openness, "presentation/Sheet::openness")');
    expect(result.code).toContain("animate.temporal(");
    expect(result.code).toContain('animate.value("presentation/Sheet::openness")');
  });

  it("preserves identity across declaration reorder, consumers, and Animation tuning", () => {
    const baseline = compilePresentationSource(candidate()).ir.animations[0]!.id;
    const reordered = compilePresentationSource(
      candidate().replace(
        "opacity: openness, blur: Math.abs(velocity(openness)), done: settled(openness)",
        "done: settled(openness), blur: Math.abs(velocity(openness)), opacity: openness",
      ),
    ).ir.animations[0]!.id;
    const tuned = compilePresentationSource(
      candidate().replace("parameters.sheet", "parameters.sheetFast"),
    ).ir.animations[0]!.id;
    expect(reordered).toBe(baseline);
    expect(tuned).toBe(baseline);
  });

  it("changes identity when the authored binding name changes", () => {
    const baseline = compilePresentationSource(candidate()).ir.animations[0]!.id;
    const renamed = compilePresentationSource(candidate().replaceAll("openness", "progress")).ir
      .animations[0]!.id;
    expect(renamed).not.toBe(baseline);
  });

  it("records exact ordered Event dependencies, including a local semantic alias", () => {
    const result = compilePresentationSource(`
const presentation = (({ parameters }) => ({
  Toolbar({ events }) {
    const completed = events.save.completed;
    const confirmation = animate(completed, parameters.confirmation);
    return { Icon: { scale: 1 + confirmation } };
  },
})) satisfies Presentation<App, Language, Parameters>;
`);
    expect(result.ir.animations[0]).toMatchObject({
      binding: "confirmation",
      events: ["events.save.completed"],
    });
  });

  it("tracks derived Animation values into their exact nested Component destinations", () => {
    const result = compilePresentationSource(`
const createPresentation = (({ parameters }) => ({
  Dashboard: () => ({
    Sheet() {
      const position = animate(1, parameters.sheet);
      const openness = 1 - position;
      return { Backdrop: { paint: { opacity: openness } } };
    },
  }),
})) satisfies Presentation<App, Language, Parameters>;
`);

    expect(result.ir.animations[0]?.id).toBe("createPresentation/Dashboard/Sheet::position");
    expect(result.ir.declarations).toEqual([
      expect.objectContaining({
        destination: "Dashboard/Sheet/Backdrop/paint/opacity",
        animations: ["createPresentation/Dashboard/Sheet::position"],
      }),
    ]);
    expect(result.code).toContain(
      'animate.temporal(openness, () => (1 - animate.value("createPresentation/Dashboard/Sheet::position"))',
    );
  });

  it("expands a temporal shorthand from its resolved local declaration", () => {
    const result = compilePresentationSource(`
const presentation = (({ parameters }) => ({
  Sheet({ state }) {
    const progress = animate(state.open ? 1 : 0, parameters.sheet);
    const opacity = 1 - progress;
    return { Root: { opacity } };
  },
})) satisfies Presentation<App, Language, Parameters>;
`);

    expect(result.code).toContain(
      'opacity: animate.temporal(opacity, () => (1 - animate.value("presentation/Sheet::progress"))',
    );
  });

  it.each([
    [
      "inline allocation",
      "return { Root: { opacity: animate(state.open ? 1 : 0, parameters.sheet) } };",
    ],
    ["mutable identity", "let openness = animate(state.open ? 1 : 0, parameters.sheet);"],
    ["ambient time", "const now = Date.now();"],
    ["randomness", "const random = Math.random();"],
    ["I/O", "const request = fetch('/theme');"],
    ["timer", "const timer = setTimeout(() => 0, 10);"],
    ["native handle", "const box = elements.Root.getBoundingClientRect();"],
    ["mutation", "state.open = false;"],
    ["promise", "const loaded = await parameters.load();"],
  ])("rejects %s with a source diagnostic", (_label, replacement) => {
    const source = invalid(replacement);
    expect(() => compilePresentationSource(source, "bad.ts")).toThrow(PresentationSourceDiagnostic);
  });

  it("rejects velocity and settlement queries on derived expressions", () => {
    expect(() =>
      compilePresentationSource(
        candidate().replace("velocity(openness)", "velocity(openness + 1)"),
      ),
    ).toThrow("directly named animate() binding");
  });
});

function candidate(): string {
  return `
const presentation = (({ parameters }) => ({
  Sheet({ state }) {
    const openness = animate(state.open ? 1 : 0, parameters.sheet);
    return {
      Root: {
        opacity: openness, blur: Math.abs(velocity(openness)), done: settled(openness)
      },
    };
  },
})) satisfies Presentation<App, Language, Parameters>;
`;
}

function invalid(statement: string): string {
  return `
const presentation = (({ parameters }) => ({
  Sheet({ state, elements }) {
    ${statement}
    const openness = animate(state.open ? 1 : 0, parameters.sheet);
    return { Root: { opacity: openness } };
  },
})) satisfies Presentation<App, Language, Parameters>;
`;
}
