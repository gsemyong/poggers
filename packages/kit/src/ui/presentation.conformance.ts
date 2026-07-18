import { describe, expect, it } from "vitest";

import type { PresentationAdapter, PresentationLanguage } from "./presentation";

export type PresentationAdapterConformanceHarness<
  Language extends PresentationLanguage,
  Target,
> = Readonly<{
  adapter: PresentationAdapter<Language, Target>;
  target(id: string): Target;
  boundary?(target: Target): Target;
  declaration(value: number): Readonly<Language["Declaration"]>;
  initialize(target: Target, value: number): void;
  inspect(target: Target): number | undefined;
  applications(target: Target): number;
  releases(target: Target): number;
  settle?(): void;
}>;

/** Runs the universal session laws shared by every Presentation language. */
export function presentationAdapterConformance<Language extends PresentationLanguage, Target>(
  name: string,
  create: () => PresentationAdapterConformanceHarness<Language, Target>,
): void {
  describe(`${name} adapter conformance`, () => {
    it("isolates Component and Element targets", () => {
      const harness = create();
      const first = harness.target("first");
      const second = harness.target("second");
      harness.initialize(first, -1);
      harness.initialize(second, -2);
      const firstSession = harness.adapter.create({
        boundary: harness.boundary?.(first) ?? first,
        targets: { Root: () => [first] },
      });
      const secondSession = harness.adapter.create({
        boundary: harness.boundary?.(second) ?? second,
        targets: { Root: () => [second] },
      });

      firstSession.commit({ Root: harness.declaration(1) });
      secondSession.commit({ Root: harness.declaration(2) });
      harness.settle?.();

      expect(harness.inspect(first)).toBe(1);
      expect(harness.inspect(second)).toBe(2);
      firstSession.dispose();
      secondSession.dispose();
    });

    it("validates a complete target snapshot before exposing writes", () => {
      const harness = create();
      const target = harness.target("target");
      harness.initialize(target, -1);
      const session = harness.adapter.create({
        boundary: harness.boundary?.(target) ?? target,
        targets: {
          Root: () => [target],
          Broken: (): readonly Target[] => {
            throw new Error("target resolution failed");
          },
        },
      });

      expect(() =>
        session.commit({ Root: harness.declaration(1), Broken: harness.declaration(2) }),
      ).toThrow("target resolution failed");
      harness.settle?.();
      expect(harness.inspect(target)).toBe(-1);
      session.dispose();
    });

    it("deduplicates repeated native targets within one Element", () => {
      const harness = create();
      const target = harness.target("target");
      harness.initialize(target, -1);
      const session = harness.adapter.create({
        boundary: harness.boundary?.(target) ?? target,
        targets: { Root: () => [target, target] },
      });

      session.commit({ Root: harness.declaration(1) });
      harness.settle?.();
      expect(harness.inspect(target)).toBe(1);
      expect(harness.applications(target)).toBe(1);
      session.dispose();
    });

    it("rejects a native target claimed by two Elements before exposing writes", () => {
      const harness = create();
      const target = harness.target("target");
      harness.initialize(target, -1);
      const session = harness.adapter.create({
        boundary: harness.boundary?.(target) ?? target,
        targets: { Root: () => [target], Label: () => [target] },
      });

      expect(() =>
        session.commit({ Root: harness.declaration(1), Label: harness.declaration(2) }),
      ).toThrow(/two Elements/i);
      harness.settle?.();
      expect(harness.inspect(target)).toBe(-1);
      session.dispose();
    });

    it("rejects commits after disposal", () => {
      const harness = create();
      const target = harness.target("target");
      const session = harness.adapter.create({
        boundary: harness.boundary?.(target) ?? target,
        targets: { Root: () => [target] },
      });
      session.dispose();

      expect(() => session.commit({ Root: harness.declaration(1) })).toThrow(/disposed/i);
    });

    it("releases native ownership exactly once", () => {
      const harness = create();
      const target = harness.target("target");
      harness.initialize(target, -1);
      const session = harness.adapter.create({
        boundary: harness.boundary?.(target) ?? target,
        targets: { Root: () => [target] },
      });
      session.commit({ Root: harness.declaration(1) });
      harness.settle?.();

      session.dispose();
      session.dispose();
      expect(harness.releases(target)).toBe(1);
    });

    it("preserves session identity while replacing dynamic targets", () => {
      const harness = create();
      const first = harness.target("first");
      const second = harness.target("second");
      harness.initialize(first, -1);
      harness.initialize(second, -2);
      let targets: readonly Target[] = [first];
      const session = harness.adapter.create({
        boundary: harness.boundary?.(first) ?? first,
        targets: { Root: () => targets },
      });
      session.commit({ Root: harness.declaration(1) });
      harness.settle?.();

      targets = [second];
      session.commit({ Root: harness.declaration(2) });
      harness.settle?.();

      expect(harness.inspect(first)).toBe(-1);
      expect(harness.inspect(second)).toBe(2);
      session.dispose();
    });

    it("inspection converges to the latest complete declaration", () => {
      const harness = create();
      const target = harness.target("target");
      harness.initialize(target, -1);
      const session = harness.adapter.create({
        boundary: harness.boundary?.(target) ?? target,
        targets: { Root: () => [target] },
      });
      session.commit({ Root: harness.declaration(1) });
      session.commit({ Root: harness.declaration(3) });
      harness.settle?.();

      expect(harness.inspect(target)).toBe(3);
      session.dispose();
    });

    it("converges under a seeded commit, duplicate, and target-recycling trace", () => {
      const harness = create();
      const targets = [harness.target("first"), harness.target("second"), harness.target("third")];
      const initial = [-11, -22, -33] as const;
      targets.forEach((target, index) => harness.initialize(target, initial[index]!));
      let active = 0;
      let currentTargets: readonly Target[] = [targets[active]!];
      let random = 0x5eed_1234;
      const next = () => {
        random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
        return random / 0x1_0000_0000;
      };
      const session = harness.adapter.create({
        boundary: harness.boundary?.(targets[0]!) ?? targets[0]!,
        targets: { Root: () => currentTargets },
      });

      for (let step = 0; step < 64; step++) {
        if (next() > 0.58) {
          active = Math.floor(next() * targets.length);
          currentTargets = [targets[active]!];
        }
        const value = step * 7 + Math.floor(next() * 7);
        const declaration = { Root: harness.declaration(value) };
        session.commit(declaration);
        if (next() > 0.45) session.commit(declaration);
        harness.settle?.();

        targets.forEach((target, index) => {
          expect(harness.inspect(target), `step ${step}, target ${index}`).toBe(
            index === active ? value : initial[index],
          );
        });
      }

      session.dispose();
      session.dispose();
      targets.forEach((target, index) => {
        expect(harness.inspect(target), `disposed target ${index}`).toBe(initial[index]);
      });
    });
  });
}
