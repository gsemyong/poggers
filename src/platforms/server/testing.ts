import { expect } from "vitest";

import type { Clock, Identifiers, Timer } from "@/platforms/server";
import { defineDependencyConformance, type DependencyConformance } from "@/testing/dependency";

/** Semantic contract shared by every server Clock provider. */
export const clockConformance: DependencyConformance<Clock> = defineDependencyConformance<Clock>({
  name: "Clock",
  scenarios: [
    {
      name: "returns finite, nondecreasing epoch milliseconds",
      verify({ api }) {
        const before = Date.now() - 1_000;
        const first = api.now({});
        const second = api.now({});
        expect(Number.isFinite(first)).toBe(true);
        expect(second).toBeGreaterThanOrEqual(first);
        expect(first).toBeGreaterThanOrEqual(before);
        expect(second).toBeLessThanOrEqual(Date.now() + 1_000);
      },
    },
  ],
});

/** Semantic contract shared by every server Identifiers provider. */
export const identifiersConformance: DependencyConformance<Identifiers> =
  defineDependencyConformance<Identifiers>({
    name: "Identifiers",
    scenarios: [
      {
        name: "creates unique nonempty identities",
        verify({ api }) {
          const identities = Array.from({ length: 128 }, () => api.create({}));
          expect(identities.every((identity) => identity.length > 0)).toBe(true);
          expect(new Set(identities).size).toBe(identities.length);
        },
      },
    ],
  });

/** Semantic contract shared by every server Timer provider. */
export const timerConformance: DependencyConformance<Timer> = defineDependencyConformance<Timer>({
  name: "Timer",
  scenarios: [
    {
      name: "resolves past deadlines and waits for future deadlines",
      async verify({ api }) {
        await expect(api.sleep({ until: Date.now() - 1 })).resolves.toBeUndefined();
        const started = Date.now();
        await api.sleep({ until: started + 20 });
        expect(Date.now() - started).toBeGreaterThanOrEqual(8);
      },
    },
  ],
});
