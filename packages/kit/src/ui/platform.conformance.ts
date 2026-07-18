import { describe, expect, test } from "vitest";

export type PlatformConformanceUpdate = Readonly<{
  revision: number;
  semantic: string | undefined;
  visual: number | undefined;
  interactive: boolean;
}>;

export type PlatformConformanceSnapshot = PlatformConformanceUpdate &
  Readonly<{ disposed: boolean }>;

export type PlatformConformanceHarness<Target> = Readonly<{
  target(id: string): Target;
  arrange(targets: readonly Target[]): void;
  arrangement(): readonly Target[];
  commit(target: Target, update: PlatformConformanceUpdate): void;
  input(target: Target, occurrence: string): void;
  inspect(target: Target): PlatformConformanceSnapshot;
  history(target: Target): readonly PlatformConformanceSnapshot[];
  actions(target: Target): readonly string[];
  dispose(target: Target): void;
  releases(target: Target): number;
}>;

/**
 * Runs observable laws for a paired platform implementation. This protocol is
 * test-only; it is intentionally not a universal structural runtime API.
 */
export function platformConformance<Target>(
  name: string,
  create: () => PlatformConformanceHarness<Target>,
): void {
  describe(`${name} paired platform conformance`, () => {
    test("commits semantics, output, and hit testing atomically", () => {
      const harness = create();
      const target = harness.target("root");
      harness.commit(target, {
        revision: 1,
        semantic: "Open sheet",
        visual: 1,
        interactive: true,
      });

      expect(harness.history(target)).toEqual([
        {
          revision: 1,
          semantic: "Open sheet",
          visual: 1,
          interactive: true,
          disposed: false,
        },
      ]);
    });

    test("isolates target identity", () => {
      const harness = create();
      const first = harness.target("first");
      const second = harness.target("second");
      harness.commit(first, {
        revision: 1,
        semantic: "First",
        visual: 10,
        interactive: true,
      });
      harness.commit(second, {
        revision: 1,
        semantic: "Second",
        visual: 20,
        interactive: false,
      });

      expect(harness.inspect(first).visual).toBe(10);
      expect(harness.inspect(second).visual).toBe(20);
    });

    test("preserves identity across mount, reorder, and unmount", () => {
      const harness = create();
      const first = harness.target("first");
      const second = harness.target("second");
      const third = harness.target("third");
      harness.arrange([first, second, third]);
      harness.commit(second, {
        revision: 1,
        semantic: "Second",
        visual: 20,
        interactive: true,
      });

      harness.arrange([third, second, first]);
      expect(harness.arrangement()).toEqual([third, second, first]);
      expect(harness.inspect(second).visual).toBe(20);

      harness.dispose(second);
      harness.arrange([third, first]);
      expect(harness.arrangement()).toEqual([third, first]);
      expect(harness.inspect(second).disposed).toBe(true);
      expect(harness.releases(second)).toBe(1);
    });

    test("releases interaction before retained visual exit", () => {
      const harness = create();
      const target = harness.target("sheet");
      harness.commit(target, {
        revision: 1,
        semantic: "Sheet",
        visual: 1,
        interactive: true,
      });
      harness.commit(target, {
        revision: 2,
        semantic: undefined,
        visual: 0.4,
        interactive: false,
      });
      harness.input(target, "late-pointer");

      expect(harness.inspect(target)).toMatchObject({
        semantic: undefined,
        visual: 0.4,
        interactive: false,
      });
      expect(harness.actions(target)).toEqual([]);
    });

    test("delivers each native input occurrence at most once", () => {
      const harness = create();
      const target = harness.target("button");
      harness.commit(target, {
        revision: 1,
        semantic: "Button",
        visual: 1,
        interactive: true,
      });
      harness.input(target, "pointer-1");
      harness.input(target, "pointer-1");
      harness.input(target, "pointer-2");

      expect(harness.actions(target)).toEqual(["pointer-1", "pointer-2"]);
    });

    test("converges under deterministic generated update and input traces", () => {
      const harness = create();
      const targets = [harness.target("a"), harness.target("b"), harness.target("c")];
      const expected = new Map<Target, PlatformConformanceUpdate>();
      const inputs = new Map<Target, Set<string>>();
      let random = 0x51a7_e123;
      const next = () => {
        random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
        return random / 0x1_0000_0000;
      };

      for (let revision = 1; revision <= 128; revision++) {
        const target = targets[Math.floor(next() * targets.length)]!;
        const interactive = next() > 0.35;
        const update = {
          revision,
          semantic: next() > 0.2 ? `semantic-${revision}` : undefined,
          visual: next() > 0.15 ? Math.floor(next() * 1_000) : undefined,
          interactive,
        };
        harness.commit(target, update);
        expected.set(target, update);

        const occurrence = `input-${Math.floor(next() * 24)}`;
        harness.input(target, occurrence);
        harness.input(target, occurrence);
        if (interactive) {
          const delivered = inputs.get(target) ?? new Set<string>();
          delivered.add(occurrence);
          inputs.set(target, delivered);
        }

        for (const [candidate, value] of expected) {
          expect(harness.inspect(candidate), `revision ${revision}`).toMatchObject(value);
        }
      }

      for (const target of targets) {
        expect(harness.actions(target)).toEqual([...(inputs.get(target) ?? [])]);
      }
    });

    test("disposes and releases ownership exactly once", () => {
      const harness = create();
      const target = harness.target("root");
      harness.commit(target, {
        revision: 1,
        semantic: "Root",
        visual: 1,
        interactive: true,
      });
      harness.dispose(target);
      harness.dispose(target);

      expect(harness.releases(target)).toBe(1);
      expect(harness.inspect(target).disposed).toBe(true);
      expect(() =>
        harness.commit(target, {
          revision: 2,
          semantic: "Again",
          visual: 2,
          interactive: true,
        }),
      ).toThrow(/disposed/i);
    });
  });
}
