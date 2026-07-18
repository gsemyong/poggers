import { describe, expect, it } from "vitest";

import { presentationAdapterConformance } from "./presentation.conformance";
import {
  createReferencePresentationAdapter,
  createReferenceStatePresentationAdapter,
  type ReferencePresentationAdapter,
  type ReferencePresentationLanguage,
  type ReferencePresentationTarget,
  type ReferenceStatePresentationAdapter,
} from "./presentation.reference";

type InspectableReferenceAdapter = ReferencePresentationAdapter | ReferenceStatePresentationAdapter;

function referenceHarness(create: () => InspectableReferenceAdapter) {
  const adapter = create();
  const initial = new Map<ReferencePresentationTarget, number>();
  return {
    adapter,
    target: (id: string) => ({ id }),
    declaration: (offset: number) => ({ offset }),
    initialize(target: ReferencePresentationTarget, value: number) {
      initial.set(target, value);
    },
    inspect(target: ReferencePresentationTarget) {
      return adapter.inspect(target)?.offset ?? initial.get(target);
    },
    applications(target: ReferencePresentationTarget) {
      let count = 0;
      for (const session of adapter.sessions) {
        if ("commits" in session) {
          for (const commit of session.commits) {
            count += commit.declarations.filter((entry) => entry.target === target).length;
          }
        } else {
          count +=
            session.current?.declarations.filter((entry) => entry.target === target).length ?? 0;
        }
      }
      return count;
    },
    releases: (target: ReferencePresentationTarget) => adapter.releases(target),
  };
}

presentationAdapterConformance<ReferencePresentationLanguage, ReferencePresentationTarget>(
  "reference trace",
  () => referenceHarness(createReferencePresentationAdapter),
);
presentationAdapterConformance<ReferencePresentationLanguage, ReferencePresentationTarget>(
  "reference retained-state",
  () => referenceHarness(createReferenceStatePresentationAdapter),
);

describe("reference presentation adapter", () => {
  it("commits a whole Component atomically across repeated Element targets", () => {
    const adapter = createReferencePresentationAdapter();
    const boundary = { id: "badge" };
    const firstLabel = { id: "label-1" };
    const secondLabel = { id: "label-2" };
    const session = adapter.create({
      boundary,
      targets: { Root: () => [boundary], Label: () => [firstLabel, secondLabel] },
    });

    session.commit({ Root: { tone: "accent" }, Label: { visible: true } });

    expect(adapter.sessions).toEqual([
      {
        boundary,
        disposed: false,
        disposeCount: 0,
        commits: [
          {
            sequence: 0,
            declarations: [
              { element: "Root", target: boundary, declaration: { tone: "accent" } },
              { element: "Label", target: firstLabel, declaration: { visible: true } },
              { element: "Label", target: secondLabel, declaration: { visible: true } },
            ],
          },
        ],
      },
    ]);
  });

  it("gives trace and retained-state interpreters equivalent normalized meaning", () => {
    const trace = createReferencePresentationAdapter();
    const retained = createReferenceStatePresentationAdapter();
    const root = { id: "root" };
    let targets: readonly ReferencePresentationTarget[] = [{ id: "first" }, { id: "second" }];
    const traceSession = trace.create({ boundary: root, targets: { Item: () => targets } });
    const retainedSession = retained.create({ boundary: root, targets: { Item: () => targets } });

    traceSession.commit({ Item: { tone: "accent", offset: 12 } });
    retainedSession.commit({ Item: { tone: "accent", offset: 12 } });
    targets = [targets[1]!];
    traceSession.commit({ Item: { visible: false } });
    retainedSession.commit({ Item: { visible: false } });

    const normalize = (
      declarations: readonly Readonly<{
        element: string;
        target: ReferencePresentationTarget;
        declaration: object;
      }>[],
    ) =>
      declarations.map(({ element, target, declaration }) => ({
        element,
        target: target.id,
        declaration,
      }));
    expect(normalize(trace.sessions[0]!.commits.at(-1)!.declarations)).toEqual(
      normalize(retained.sessions[0]!.current!.declarations),
    );
  });

  it("isolates targets and rejects updates after idempotent disposal", () => {
    const adapter = createReferencePresentationAdapter();
    const first = adapter.create({
      boundary: { id: "first" },
      targets: { Root: () => [{ id: "first-root" }] },
    });
    const second = adapter.create({
      boundary: { id: "second" },
      targets: { Root: () => [{ id: "second-root" }] },
    });

    first.commit({ Root: { visible: true } });
    second.commit({ Root: { visible: false } });
    first.dispose();
    first.dispose();

    expect(adapter.sessions[0]?.disposed).toBe(true);
    expect(adapter.sessions[1]?.disposed).toBe(false);
    expect(adapter.sessions[0]?.commits[0]?.declarations[0]?.target.id).toBe("first-root");
    expect(adapter.sessions[1]?.commits[0]?.declarations[0]?.target.id).toBe("second-root");
    expect(() => first.commit({ Root: { visible: false } })).toThrow(
      "Cannot commit a disposed presentation session.",
    );
  });
});

type EnvelopeElement = "Root" | "Backdrop" | "Surface" | "Title";

type EnvelopeElementReference<Name extends EnvelopeElement = EnvelopeElement> = Readonly<{
  name: Name;
}>;

type EnvelopeCondition = Readonly<{
  maxInlineSize?: number;
  reducedMotion?: boolean;
}>;

type EnvelopeFragment = Readonly<{
  opacity?: number;
  translateBlock?: number;
  radius?: number;
  resource?: string;
}>;

type EnvelopeDeclaration = EnvelopeFragment &
  Readonly<{
    when?: readonly Readonly<{
      condition: EnvelopeCondition;
      use: EnvelopeFragment;
    }>[];
    layers?: readonly Readonly<{
      id: string;
      resource: string;
      placement: "background" | "overlay";
    }>[];
    motion?: Readonly<{
      group: string;
      after?: EnvelopeElementReference;
      spring: Readonly<{ stiffness: number; damping: number; mass: number }>;
      velocity?: number;
    }>;
    cue?: Readonly<{
      occurrence: number;
      resource: string;
    }>;
  }>;

type EnvelopeSnapshot = Readonly<Partial<Record<EnvelopeElement, EnvelopeDeclaration>>>;

type EnvelopeEnvironment = Readonly<{
  inlineSize: number;
  reducedMotion: boolean;
}>;

function createEnvelopeInterpreter(initialEnvironment: EnvelopeEnvironment) {
  let environment = initialEnvironment;
  let snapshot: EnvelopeSnapshot = {};
  const occurrences = new Map<string, number>();
  const cues: Array<Readonly<{ element: EnvelopeElement; resource: string; occurrence: number }>> =
    [];

  return {
    cues,
    apply(next: EnvelopeSnapshot) {
      validateEnvelope(next);
      snapshot = next;
      for (const element of envelopeElements) {
        const cue = next[element]?.cue;
        if (!cue) continue;
        const key = `${element}:${cue.resource}`;
        if (occurrences.get(key) === cue.occurrence) continue;
        occurrences.set(key, cue.occurrence);
        cues.push({ element, resource: cue.resource, occurrence: cue.occurrence });
      }
    },
    setEnvironment(next: EnvelopeEnvironment) {
      environment = next;
    },
    inspect(element: EnvelopeElement): EnvelopeFragment | undefined {
      const declaration = snapshot[element];
      if (!declaration) return;
      let result: EnvelopeFragment = envelopeFragment(declaration);
      for (const variant of declaration.when ?? []) {
        if (matchesEnvelopeCondition(variant.condition, environment)) {
          result = { ...result, ...variant.use };
        }
      }
      return result;
    },
  };
}

const envelopeElements = ["Root", "Backdrop", "Surface", "Title"] as const;

function envelopeFragment(declaration: EnvelopeDeclaration): EnvelopeFragment {
  const { opacity, translateBlock, radius, resource } = declaration;
  return { opacity, translateBlock, radius, resource };
}

function matchesEnvelopeCondition(
  condition: EnvelopeCondition,
  environment: EnvelopeEnvironment,
): boolean {
  return (
    (condition.maxInlineSize === undefined || environment.inlineSize <= condition.maxInlineSize) &&
    (condition.reducedMotion === undefined || environment.reducedMotion === condition.reducedMotion)
  );
}

function validateEnvelope(snapshot: EnvelopeSnapshot): void {
  const dependencies = new Map<EnvelopeElement, EnvelopeElement>();
  for (const element of envelopeElements) {
    const after = snapshot[element]?.motion?.after?.name;
    if (!after) continue;
    if (!snapshot[after]) {
      throw new Error(`Presentation Element ${element} depends on missing Element ${after}.`);
    }
    dependencies.set(element, after);
  }

  for (const element of dependencies.keys()) {
    const seen = new Set<EnvelopeElement>();
    let current: EnvelopeElement | undefined = element;
    while (current) {
      if (seen.has(current)) {
        throw new Error(`Presentation choreography contains a cycle at Element ${current}.`);
      }
      seen.add(current);
      current = dependencies.get(current);
    }
  }
}

describe("declarative presentation envelope", () => {
  it("keeps native conditions adapter-owned while coordinating resources, layers, motion, and cues", () => {
    const tokens = {
      radius: { dialog: 28, sheet: 20 },
      resources: { material: "shader:frost", close: "symbol:close", open: "audio:open" },
      spring: { stiffness: 520, damping: 42, mass: 1 },
    } as const;
    const elements = Object.fromEntries(
      envelopeElements.map((name) => [name, { name }]),
    ) as Readonly<{ [Name in EnvelopeElement]: EnvelopeElementReference<Name> }>;
    let evaluations = 0;
    const preset = (state: {
      open: boolean;
      dragOffset: number;
      releaseVelocity: number;
      openOccurrence: number;
    }): EnvelopeSnapshot => {
      evaluations += 1;
      return {
        Root: {
          layers: [
            { id: "material", resource: tokens.resources.material, placement: "background" },
          ],
          cue: {
            occurrence: state.openOccurrence,
            resource: tokens.resources.open,
          },
        },
        Backdrop: {
          opacity: state.open ? 0.32 : 0,
          motion: { group: "drawer", spring: tokens.spring },
        },
        Surface: {
          translateBlock: state.dragOffset,
          radius: tokens.radius.dialog,
          when: [
            {
              condition: { maxInlineSize: 560 },
              use: { radius: tokens.radius.sheet },
            },
          ],
          motion: {
            group: "drawer",
            after: elements.Backdrop,
            spring: tokens.spring,
            velocity: state.releaseVelocity,
          },
        },
        Title: {
          resource: tokens.resources.close,
          motion: { group: "drawer", after: elements.Surface, spring: tokens.spring },
        },
      };
    };

    const adapter = createEnvelopeInterpreter({ inlineSize: 720, reducedMotion: false });
    const initial = preset({
      open: true,
      dragOffset: 24,
      releaseVelocity: 860,
      openOccurrence: 1,
    });
    adapter.apply(initial);

    expect(adapter.inspect("Surface")).toMatchObject({ translateBlock: 24, radius: 28 });
    expect(adapter.inspect("Title")?.resource).toBe("symbol:close");
    expect(adapter.cues).toEqual([{ element: "Root", resource: "audio:open", occurrence: 1 }]);

    adapter.setEnvironment({ inlineSize: 390, reducedMotion: false });
    expect(adapter.inspect("Surface")?.radius).toBe(20);
    expect(evaluations).toBe(1);

    adapter.apply(initial);
    expect(adapter.cues).toHaveLength(1);

    adapter.apply(preset({ open: true, dragOffset: 0, releaseVelocity: -240, openOccurrence: 2 }));
    expect(adapter.cues).toEqual([
      { element: "Root", resource: "audio:open", occurrence: 1 },
      { element: "Root", resource: "audio:open", occurrence: 2 },
    ]);
  });

  it("rejects missing and cyclic choreography references deterministically", () => {
    const spring = { stiffness: 400, damping: 36, mass: 1 };
    expect(() =>
      validateEnvelope({
        Surface: {
          motion: { group: "drawer", after: { name: "Backdrop" }, spring },
        },
      }),
    ).toThrow("depends on missing Element Backdrop");

    expect(() =>
      validateEnvelope({
        Backdrop: {
          motion: { group: "drawer", after: { name: "Surface" }, spring },
        },
        Surface: {
          motion: { group: "drawer", after: { name: "Backdrop" }, spring },
        },
      }),
    ).toThrow("choreography contains a cycle");
  });
});
