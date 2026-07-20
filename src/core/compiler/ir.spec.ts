import fc from "fast-check";
import { expect, test } from "vitest";

import { POGGERS_IR_VERSION, serializeApplicationIR, type ApplicationIR } from "./ir";

test("serializes arbitrary valid Application IR deterministically", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 40 }),
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 24 }), { maxLength: 20 }),
      (name, paths) => {
        const features = paths
          .map((path) => ({ id: `feature/${path}`, path, children: [], programs: [] }))
          .sort(({ id: left }, { id: right }) => left.localeCompare(right));
        const ir: ApplicationIR = {
          version: POGGERS_IR_VERSION,
          application: { id: `application/${name}`, name, presentations: [] },
          platforms: [],
          features,
          programs: [],
          presentations: [],
        };

        const first = serializeApplicationIR(ir);
        const restored = JSON.parse(first) as ApplicationIR;
        expect(serializeApplicationIR(restored)).toBe(first);
        expect(first.endsWith("\n")).toBe(true);
      },
    ),
    { numRuns: 100 },
  );
});
