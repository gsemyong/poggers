import { Mesh, Scene, type Object3D } from "three";
import { describe, expect, test } from "vitest";

import type { PlatformAdapter, PlatformPresentationLanguage, PlatformPrimitive } from "./platform";
import type {
  PresentationAdapter,
  PresentationLanguage,
  PresentationTargetSources,
} from "./presentation";
import { activateThree, dispatchThreeHit, jsx as three, threeSemantics } from "./three/jsx-runtime";
import type { ThreePlatform } from "./three/platform";
import { createThreePresentationAdapter } from "./three/presentation/adapter";

describe("paired platform pressure implementations", () => {
  test("coordinates native sheet physics with structural dismissal", () => {
    const adapter = createSheetPlatformAdapter();
    let dismissals = 0;
    const sheet = adapter.structure.mount({
      label: "Account",
      onDismiss: () => dismissals++,
    });
    const presentation = adapter.presentation.create({
      boundary: sheet,
      targets: { Root: () => [sheet] },
    });
    presentation.commit({
      Root: {
        kind: "sheet",
        detents: [0.42, 0.92],
        dismissProjection: 0.24,
        spring: { stiffness: 420, damping: 38 },
      },
    });

    adapter.structure.open(sheet);
    adapter.structure.release(sheet, { translation: 0.08, velocity: 0.2 });
    expect(dismissals).toBe(0);
    expect(sheet.open).toBe(true);

    adapter.structure.release(sheet, { translation: 0.12, velocity: 1.4 });
    expect(dismissals).toBe(1);
    expect(sheet).toMatchObject({ open: false, interactive: false });
    expect(sheet.trajectory).toEqual({ target: 1, velocity: 1.4, spring: [420, 38] });

    presentation.dispose();
    adapter.structure.dispose(sheet);
    expect(sheet.releases).toBe(2);
  });

  test("keeps constraint-dependent semantic composition structural and atomic", () => {
    const adapter = createConstraintPlatformAdapter();
    const panel = adapter.structure.mount({
      compact: ["summary"],
      regular: ["navigation", "detail"],
    });
    const presentation = adapter.presentation.create({
      boundary: panel,
      targets: { Root: () => [panel] },
    });
    presentation.commit({ Root: { kind: "adaptive", gap: 16, columns: 2 } });

    adapter.structure.layout(panel, 420);
    expect(panel.frames.at(-1)).toEqual({
      width: 420,
      semantics: ["summary"],
      geometry: { columns: 1, gap: 16 },
    });

    adapter.structure.layout(panel, 840);
    expect(panel.frames.at(-1)).toEqual({
      width: 840,
      semantics: ["navigation", "detail"],
      geometry: { columns: 2, gap: 16 },
    });
    expect(panel.frames).toHaveLength(2);
  });

  test("delivers repeated equal temporal values once per occurrence identity", () => {
    const adapter = createTemporalPlatformAdapter();
    const cue = adapter.structure.mount({ channel: "primary" });
    const presentation = adapter.presentation.create({
      boundary: cue,
      targets: { Cue: () => [cue] },
    });

    presentation.commit({ Cue: { kind: "cue", occurrence: { id: "1", value: "tap" } } });
    presentation.commit({ Cue: { kind: "cue", occurrence: { id: "1", value: "tap" } } });
    presentation.commit({ Cue: { kind: "cue", occurrence: { id: "2", value: "tap" } } });
    expect(cue.outputs).toEqual(["tap", "tap"]);

    presentation.commit({ Cue: { kind: "cue", loop: { id: "ambient", value: "hum" } } });
    expect(cue.loop).toEqual({ id: "ambient", value: "hum" });
    presentation.dispose();
    expect(cue.loop).toBeUndefined();
    expect(cue.releases).toBe(1);
  });

  test("pairs a retained Three hierarchy and declaration interpreter", () => {
    const presentation = createThreePresentationAdapter();
    let activations = 0;
    const adapter = {
      name: "three",
      structure: {
        create: three,
        activate: activateThree,
        dispatchHit: dispatchThreeHit,
        semantics: threeSemantics,
      },
      presentation,
    } satisfies PlatformAdapter<
      ThreePlatform,
      {
        create: typeof three;
        activate: typeof activateThree;
        dispatchHit: typeof dispatchThreeHit;
        semantics: typeof threeSemantics;
      },
      Object3D
    >;
    const mesh = adapter.structure.create("mesh", {
      name: "card",
      semantics: { label: "Open card", role: "button" },
      onActivate: () => activations++,
    });
    const scene = adapter.structure.create("scene", { name: "world", children: mesh });
    expect(scene).toBeInstanceOf(Scene);
    expect(mesh).toBeInstanceOf(Mesh);
    expect(scene.children).toEqual([mesh]);
    expect(adapter.structure.semantics(mesh)).toEqual({
      label: "Open card",
      role: "button",
    });
    adapter.structure.dispatchHit([{ object: mesh }]);
    expect(activations).toBe(1);
    adapter.structure.activate(mesh);
    expect(activations).toBe(2);

    const session = adapter.presentation.create({
      boundary: scene,
      targets: { Root: () => [scene], Card: () => [mesh] },
    });
    session.commit({
      Root: { kind: "scene", background: "#101820" },
      Card: {
        kind: "mesh",
        geometry: { kind: "box", width: 2, height: 1, depth: 0.2 },
        material: { kind: "standard", color: "#ffffff", roughness: 0.45 },
      },
    });
    expect((scene as Scene).background).toBeTruthy();
    expect((mesh as Mesh).geometry.type).toBe("BoxGeometry");
    session.dispose();
  });
});

type SheetDeclaration = Readonly<{
  kind: "sheet";
  detents: readonly number[];
  dismissProjection: number;
  spring: Readonly<{ stiffness: number; damping: number }>;
}>;

type SheetTarget = {
  label: string;
  onDismiss(): void;
  declaration?: SheetDeclaration;
  open: boolean;
  interactive: boolean;
  trajectory?: Readonly<{ target: number; velocity: number; spring: readonly [number, number] }>;
  releases: number;
};

type SheetPlatform = Readonly<{
  Name: "native-sheet";
  Child: SheetTarget;
  Primitives: {
    sheet: PlatformPrimitive<
      Readonly<{ label: string; onDismiss(): void }>,
      SheetTarget,
      SheetDeclaration
    >;
  };
}>;

function createSheetPlatformAdapter() {
  const presentation = createAtomicAdapter<
    PlatformPresentationLanguage<SheetPlatform>,
    SheetTarget
  >(
    (target, declaration) => {
      target.declaration = declaration;
    },
    (target) => target.releases++,
  );
  const structure = {
    mount(props: Readonly<{ label: string; onDismiss(): void }>): SheetTarget {
      return { ...props, open: false, interactive: false, releases: 0 };
    },
    open(target: SheetTarget) {
      target.open = true;
      target.interactive = true;
      target.trajectory = undefined;
    },
    release(target: SheetTarget, sample: Readonly<{ translation: number; velocity: number }>) {
      if (!target.interactive || !target.declaration) return;
      const projected = sample.translation + sample.velocity * target.declaration.dismissProjection;
      const threshold = target.declaration.detents[0] ?? 0.5;
      if (projected < threshold) return;
      target.interactive = false;
      target.open = false;
      target.trajectory = {
        target: 1,
        velocity: sample.velocity,
        spring: [target.declaration.spring.stiffness, target.declaration.spring.damping],
      };
      target.onDismiss();
    },
    dispose(target: SheetTarget) {
      target.interactive = false;
      target.releases += 1;
    },
  };
  return {
    name: "native-sheet",
    structure,
    presentation,
  } satisfies PlatformAdapter<SheetPlatform, typeof structure, SheetTarget>;
}

type AdaptiveDeclaration = Readonly<{ kind: "adaptive"; gap: number; columns: number }>;
type AdaptiveTarget = {
  compact: readonly string[];
  regular: readonly string[];
  declaration?: AdaptiveDeclaration;
  frames: Array<
    Readonly<{
      width: number;
      semantics: readonly string[];
      geometry: Readonly<{ columns: number; gap: number }>;
    }>
  >;
};
type ConstraintPlatform = Readonly<{
  Name: "constraint";
  Child: AdaptiveTarget;
  Primitives: {
    adaptive: PlatformPrimitive<
      Readonly<{ compact: readonly string[]; regular: readonly string[] }>,
      AdaptiveTarget,
      AdaptiveDeclaration
    >;
  };
}>;

function createConstraintPlatformAdapter() {
  const presentation = createAtomicAdapter<
    PlatformPresentationLanguage<ConstraintPlatform>,
    AdaptiveTarget
  >((target, declaration) => (target.declaration = declaration));
  const structure = {
    mount(props: Readonly<{ compact: readonly string[]; regular: readonly string[] }>) {
      return { ...props, frames: [] } satisfies AdaptiveTarget;
    },
    layout(target: AdaptiveTarget, width: number) {
      const declaration = target.declaration;
      if (!declaration) throw new Error("Adaptive target has no Presentation declaration.");
      const compact = width < 600;
      target.frames.push({
        width,
        semantics: compact ? target.compact : target.regular,
        geometry: { columns: compact ? 1 : declaration.columns, gap: declaration.gap },
      });
    },
  };
  return {
    name: "constraint",
    structure,
    presentation,
  } satisfies PlatformAdapter<ConstraintPlatform, typeof structure, AdaptiveTarget>;
}

type TemporalDeclaration = Readonly<{
  kind: "cue";
  occurrence?: Readonly<{ id: string; value: string }>;
  loop?: Readonly<{ id: string; value: string }>;
}>;
type TemporalTarget = {
  channel: string;
  outputs: string[];
  consumed: Set<string>;
  loop?: Readonly<{ id: string; value: string }>;
  releases: number;
};
type TemporalPlatform = Readonly<{
  Name: "temporal";
  Child: TemporalTarget;
  Primitives: {
    cue: PlatformPrimitive<Readonly<{ channel: string }>, TemporalTarget, TemporalDeclaration>;
  };
}>;

function createTemporalPlatformAdapter() {
  const presentation = createAtomicAdapter<
    PlatformPresentationLanguage<TemporalPlatform>,
    TemporalTarget
  >(
    (target, declaration) => {
      if (declaration.occurrence && !target.consumed.has(declaration.occurrence.id)) {
        target.consumed.add(declaration.occurrence.id);
        target.outputs.push(declaration.occurrence.value);
      }
      target.loop = declaration.loop;
    },
    (target) => {
      target.loop = undefined;
      target.releases += 1;
    },
  );
  const structure = {
    mount(props: Readonly<{ channel: string }>): TemporalTarget {
      return { ...props, outputs: [], consumed: new Set(), releases: 0 };
    },
  };
  return {
    name: "temporal",
    structure,
    presentation,
  } satisfies PlatformAdapter<TemporalPlatform, typeof structure, TemporalTarget>;
}

function createAtomicAdapter<Language extends PresentationLanguage, Target>(
  apply: (target: Target, declaration: Readonly<Language["Declaration"]>) => void,
  release: (target: Target) => void = () => undefined,
): PresentationAdapter<Language, Target> {
  return {
    create<ElementName extends string>(options: {
      readonly boundary: Target;
      readonly targets: PresentationTargetSources<ElementName, Target>;
    }) {
      let disposed = false;
      let owned = new Set<Target>();
      return {
        commit(declarations) {
          if (disposed) throw new Error("Cannot commit a disposed Presentation session.");
          const prepared: Array<readonly [Target, Readonly<Language["Declaration"]>]> = [];
          const owners = new Map<Target, string>();
          for (const [name, declaration] of Object.entries(declarations) as Array<
            readonly [string, Readonly<Language["Declaration"]> | undefined]
          >) {
            if (!declaration) continue;
            const source = (options.targets as Readonly<Record<string, () => readonly Target[]>>)[
              name
            ];
            for (const target of new Set(source?.() ?? [])) {
              const owner = owners.get(target);
              if (owner && owner !== name) throw new Error("Target is claimed by two Elements.");
              owners.set(target, name);
              prepared.push([target, declaration]);
            }
          }
          const next = new Set<Target>();
          for (const [target, declaration] of prepared) {
            next.add(target);
            apply(target, declaration);
          }
          owned = next;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const target of owned) release(target);
          owned.clear();
        },
      };
    },
  };
}
