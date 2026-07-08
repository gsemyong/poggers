import fc from "fast-check";

export function jsonValue(): fc.Arbitrary<unknown> {
  return fc.letrec((tie) => ({
    leaf: fc.oneof(
      fc.string({ maxLength: 10 }),
      fc.integer({ min: -100, max: 100 }),
      fc.boolean(),
      fc.constant(null),
    ),
    node: fc.oneof(
      fc.array(tie("any"), { minLength: 0, maxLength: 5 }),
      fc.dictionary(
        fc.string({ maxLength: 5 }).filter((k) => k.length > 0),
        tie("any"),
        { minKeys: 0, maxKeys: 5 },
      ),
    ),
    any: fc.oneof(tie("leaf"), tie("node")),
  })).any as fc.Arbitrary<unknown>;
}

export function jsonObjectKey(): fc.Arbitrary<unknown> {
  return fc.oneof(
    fc.string({ maxLength: 10 }),
    fc.integer({ min: -100, max: 100 }),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.string({ maxLength: 5 }), { minLength: 0, maxLength: 3 }),
    fc.dictionary(
      fc.string({ maxLength: 3 }).filter((k) => k.length > 0),
      fc.string({ maxLength: 5 }),
      { minKeys: 0, maxKeys: 3 },
    ),
  );
}
