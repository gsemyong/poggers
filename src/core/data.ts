const omitted = Symbol("kit.data.omitted");

export type DataKind = "undefined" | "null" | "boolean" | "number" | "string" | "array" | "record";

/** Returns the canonical portable-data kind shared by development and production. */
export function dataKind(value: unknown): DataKind {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "record";
  throw new TypeError(`Value contains unsupported ${typeof value} data.`);
}

/**
 * Clones one value into the canonical data shape accepted by durable
 * Dependencies. Records preserve insertion order, undefined record fields are
 * omitted, undefined array items become null, and unsupported JavaScript
 * objects fail before reaching a host implementation.
 */
export function cloneData<Value>(value: Value, label = "Value"): Value {
  return clone(value, label, new Set(), "root", "$") as Value;
}

/** Compares values after applying the same canonical durable-data semantics. */
export function equalData(left: unknown, right: unknown): boolean {
  return equal(cloneData(left), cloneData(right));
}

function clone(
  value: unknown,
  label: string,
  ancestors: Set<object>,
  position: "array" | "record" | "root",
  path: string,
): unknown {
  if (value === undefined)
    return position === "array" ? null : position === "record" ? omitted : value;
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} contains a non-finite number at ${path}.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} contains unsupported ${typeof value} data at ${path}.`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} contains a circular reference at ${path}.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) =>
        clone(value[index], label, ancestors, "array", `${path}[${index}]`),
      );
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      const name =
        typeof (prototype as { constructor?: { name?: unknown } }).constructor?.name === "string"
          ? (prototype as { constructor: { name: string } }).constructor.name
          : "unknown";
      throw new TypeError(`${label} contains a non-data ${name} object at ${path}.`);
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new TypeError(`${label} contains a symbol property at ${path}.`);
    }

    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const name of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError(`${label} contains an accessor property at ${path}.${name}.`);
      }
      const item = clone(descriptor.value, label, ancestors, "record", `${path}.${name}`);
      if (item !== omitted) result[name] = item;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (name) => Object.hasOwn(rightRecord, name) && equal(leftRecord[name], rightRecord[name]),
      )
    );
  }
  return false;
}
