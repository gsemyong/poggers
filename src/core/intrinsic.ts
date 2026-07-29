export type PortableLiteral = string | number | boolean | null;
/** Opaque compiler-owned data describing one resolved portable type. */
export type TypeSchema = Readonly<Record<never, never>>;

/**
 * Materializes one literal type through Kit's portable compiler.
 *
 * Calling this outside a compiled Program is always an error: TypeScript erases
 * the requested type before JavaScript executes.
 */
export function typeLiteral<Value extends PortableLiteral>(): Value {
  throw new Error("typeLiteral() must be lowered by the Kit compiler.");
}

/**
 * Materializes one resolved TypeScript type as canonical portable type data.
 *
 * Like `typeLiteral`, this is available only inside code lowered by Kit.
 */
// oxlint-disable-next-line no-unused-vars -- the compiler consumes the generic before erasure.
export function typeSchema<Value>(): TypeSchema {
  throw new Error("typeSchema() must be lowered by the Kit compiler.");
}

/**
 * Materializes the string keys of one resolved record type.
 *
 * This avoids repeating type-level names in runtime declarations while
 * preserving an ordinary serializable array in generated Programs.
 */
export function typeKeys<Value extends object>(): readonly Extract<keyof Value, string>[] {
  throw new Error("typeKeys() must be lowered by the Kit compiler.");
}
