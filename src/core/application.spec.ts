import { describe, expect, test } from "vitest";

import { placePrograms, type Feature, type Program } from "@/core/application";

type Server = Readonly<{ Name: "server"; Platform: { Name: "server" } }>;
type Logical = Readonly<{
  Programs: { server: Program<Server> };
  Features: { child: { Programs: { server: Program<Server> } } };
}>;

describe("Feature Program placement", () => {
  test("places one logical role recursively without mutating the reusable Feature", () => {
    const definition: Feature<Logical> = {
      programs: { server: { start: () => undefined } },
      features: { child: { programs: { server: {} } } },
    };
    const feature = Object.assign(definition, { semantic: "preserved" as const });

    const placed = placePrograms(feature, { server: "api" });

    expect(Object.keys(placed.programs)).toEqual(["api"]);
    expect(Object.keys(placed.features.child.programs)).toEqual(["api"]);
    expect(placed.semantic).toBe("preserved");
    expect(Object.keys(feature.programs)).toEqual(["server"]);
  });

  test("rejects two logical roles placed at the same Program name", () => {
    type Roles = Readonly<{
      Programs: { first: Program<Server>; second: Program<Server> };
    }>;
    const feature: Feature<Roles> = { programs: { first: {}, second: {} } };

    expect(() => placePrograms(feature, { first: "shared", second: "shared" })).toThrow(
      'maps multiple Programs to "shared"',
    );
  });
});
