import { expect } from "vitest";

import type { Calendar, Clock, Identifiers, Timer } from "@/platforms/server";
import { defineDependencyConformance, type DependencyConformance } from "@/testing/dependency";

/** Semantic contract shared by every server civil-calendar provider. */
export const calendarConformance: DependencyConformance<Calendar> =
  defineDependencyConformance<Calendar>({
    name: "Calendar",
    scenarios: [
      {
        name: "resolves calendar fields, cron aliases, and IANA daylight-saving transitions",
        async verify({ api }) {
          await expect(
            api.next({
              after: Date.UTC(2026, 6, 25, 10),
              through: Date.UTC(2026, 6, 27),
              timeZone: "UTC",
              pattern: { cron: "0 9 * * 5-7" },
            }),
          ).resolves.toEqual({ at: Date.UTC(2026, 6, 26, 9) });
          await expect(
            api.next({
              after: Date.UTC(2026, 0, 1),
              through: Date.UTC(2026, 11, 31),
              timeZone: "UTC",
              pattern: {
                calendar: {
                  month: "FEB",
                  dayOfMonth: { start: 10, end: 14, step: 2 },
                  hour: 12,
                  minute: 30,
                },
              },
            }),
          ).resolves.toEqual({ at: Date.UTC(2026, 1, 10, 12, 30) });
          await expect(
            api.next({
              after: Date.UTC(2026, 6, 25, 10),
              through: Date.UTC(2026, 6, 27),
              timeZone: "UTC",
              pattern: {
                calendar: {
                  dayOfWeek: { start: 5, end: 7 },
                  hour: 9,
                },
              },
            }),
          ).resolves.toEqual({ at: Date.UTC(2026, 6, 26, 9) });

          const spring = await api.next({
            after: Date.UTC(2026, 2, 28, 23),
            through: Date.UTC(2026, 2, 30, 2),
            timeZone: "Europe/Bratislava",
            pattern: {
              calendar: {
                year: 2026,
                month: 3,
                dayOfMonth: [29, 30],
                hour: 2,
                minute: 30,
              },
            },
          });
          expect(spring).toEqual({ at: Date.UTC(2026, 2, 30, 0, 30) });

          const firstFold = await api.next({
            after: Date.UTC(2026, 9, 24, 23),
            through: Date.UTC(2026, 9, 25, 2),
            timeZone: "Europe/Bratislava",
            pattern: {
              calendar: {
                year: 2026,
                month: 10,
                dayOfMonth: 25,
                hour: 2,
                minute: 30,
              },
            },
          });
          expect(firstFold).toEqual({ at: Date.UTC(2026, 9, 25, 0, 30) });
          await expect(
            api.next({
              after: firstFold!.at,
              through: Date.UTC(2026, 9, 25, 2),
              timeZone: "Europe/Bratislava",
              pattern: {
                calendar: {
                  year: 2026,
                  month: 10,
                  dayOfMonth: 25,
                  hour: 2,
                  minute: 30,
                },
              },
            }),
          ).resolves.toEqual({ at: Date.UTC(2026, 9, 25, 1, 30) });
        },
      },
      {
        name: "uses exclusive lower and inclusive upper bounds and rejects invalid input",
        async verify({ api }) {
          const at = Date.UTC(2026, 0, 1, 12);
          await expect(
            api.next({
              after: at - 1,
              through: at,
              timeZone: "UTC",
              pattern: {
                calendar: { year: 2026, month: 1, dayOfMonth: 1, hour: 12 },
              },
            }),
          ).resolves.toEqual({ at });
          await expect(
            api.next({
              after: at,
              through: at,
              timeZone: "UTC",
              pattern: {
                calendar: { year: 2026, month: 1, dayOfMonth: 1, hour: 12 },
              },
            }),
          ).resolves.toBeUndefined();
          await expect(
            api.next({
              after: at,
              through: at - 1,
              timeZone: "UTC",
              pattern: { cron: "@every 1h" },
            }),
          ).rejects.toThrow();
          await expect(
            api.next({
              after: at,
              through: at + 1,
              timeZone: "Not/A_Zone",
              pattern: { cron: "@every 1h" },
            }),
          ).rejects.toThrow();
        },
      },
    ],
  });

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
