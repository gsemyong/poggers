import type { CapabilityIR, TypeIR } from "@/core/compiler/ir";

export type NativeOperationMode = "asynchronous" | "stream" | "synchronous";
export type NativeTypeContract =
  | Readonly<{ kind: "any" }>
  | Extract<TypeIR, { kind: "literal" | "opaque" | "primitive" }>
  | Readonly<{ kind: "array"; element: NativeTypeContract }>
  | Readonly<{ kind: "tuple"; elements: readonly NativeTypeContract[] }>
  | Readonly<{ kind: "option"; value: NativeTypeContract }>
  | Readonly<{ kind: "union"; variants: readonly NativeTypeContract[] }>
  | Readonly<{
      kind: "record";
      fields: readonly Readonly<{
        name: string;
        optional: boolean;
        type: NativeTypeContract;
      }>[];
      /** Accept fields not named by this semantic contract. */
      open?: true;
    }>
  | Readonly<{ kind: "promise"; value: NativeTypeContract }>
  | Readonly<{ kind: "stream"; element: NativeTypeContract }>
  | Readonly<{
      kind: "function";
      parameters: readonly Readonly<{ optional: boolean; type: NativeTypeContract }>[];
      result: NativeTypeContract;
    }>;

export type NativeOperationContract = Readonly<{
  name: string;
  mode: NativeOperationMode;
  input: NativeTypeContract;
  output: NativeTypeContract;
}>;

export type NativeCapabilityContract = Readonly<{
  name: string;
  operations: readonly NativeOperationContract[];
}>;

export type NativeConfigurationField = Readonly<{
  name: string;
  environment: string;
  required?: true;
  default?: string;
}>;

/** Checked-in production realization of one semantic Capability contract. */
export type NativeCapabilityAdapter = Readonly<{
  name: string;
  platform: string;
  contract: NativeCapabilityContract;
  requires?: readonly string[];
  configuration: readonly NativeConfigurationField[];
  crate: Readonly<{ package: string; directory: string }>;
  rust: Readonly<{ type: string; constructor: string }>;
}>;

export type ResolvedNativeCapability = Readonly<{
  capability: CapabilityIR;
  adapter: NativeCapabilityAdapter;
}>;

/** Validates one adapter descriptor without executing adapter or application code. */
export function defineNativeCapabilityAdapter(
  adapter: NativeCapabilityAdapter,
): NativeCapabilityAdapter {
  identifier(adapter.name, "native adapter name");
  identifier(adapter.crate.package, "Cargo package name", true);
  rustPath(adapter.rust.type, "Rust capability type");
  rustPath(adapter.rust.constructor, "Rust constructor");
  if (!adapter.contract.operations.length) {
    throw new Error(`Native adapter ${JSON.stringify(adapter.name)} declares no operations.`);
  }
  const operations = adapter.contract.operations.map(({ name }) => name);
  duplicate(operations, `Native adapter ${JSON.stringify(adapter.name)} operation`);
  for (const operation of adapter.contract.operations) {
    validateTypeContract(operation.input, `${adapter.name}.${operation.name} input`);
    validateTypeContract(operation.output, `${adapter.name}.${operation.name} output`);
  }
  const configuration = adapter.configuration.map(({ name }) => name);
  duplicate(configuration, `Native adapter ${JSON.stringify(adapter.name)} configuration field`);
  for (const field of adapter.configuration) {
    identifier(field.name, "native configuration field");
    if (!/^[A-Z][A-Z0-9_]*$/.test(field.environment)) {
      throw new Error(
        `Native configuration environment ${JSON.stringify(field.environment)} is invalid.`,
      );
    }
    if (field.required && field.default !== undefined) {
      throw new Error(
        `Native configuration ${JSON.stringify(field.name)} cannot be required and defaulted.`,
      );
    }
  }
  return Object.freeze(adapter);
}

/** Selects and orders native adapters for a linked Program before workspace generation. */
export function resolveNativeCapabilityAdapters(input: {
  platform: string;
  capabilities: readonly CapabilityIR[];
  adapters: readonly NativeCapabilityAdapter[];
}): readonly ResolvedNativeCapability[] {
  duplicate(
    input.adapters.map(({ name }) => name),
    "Native adapter",
  );
  const selected = new Map<string, ResolvedNativeCapability>();
  for (const capability of input.capabilities) {
    const named = input.adapters.filter(
      (adapter) => adapter.platform === input.platform && adapter.contract.name === capability.name,
    );
    const compatible = named.filter((adapter) =>
      sameOperations(adapter.contract.operations, capability),
    );
    if (!compatible.length) {
      if (named.length) {
        throw new Error(
          `Native ${input.platform} adapters cannot bind incompatible Capability ` +
            `${JSON.stringify(capability.name)}.`,
        );
      }
      throw new Error(
        `Native ${input.platform} adapter is missing Capability ${JSON.stringify(capability.name)}.`,
      );
    }
    if (compatible.length > 1) {
      throw new Error(
        `Native ${input.platform} Capability ${JSON.stringify(capability.name)} has multiple ` +
          `compatible adapters: ${compatible
            .map(({ name }) => name)
            .sort()
            .join(", ")}.`,
      );
    }
    selected.set(capability.name, { capability, adapter: compatible[0]! });
  }

  const pending = new Map(
    [...selected].map(([name, value]) => [
      name,
      new Set((value.adapter.requires ?? []).filter((dependency) => selected.has(dependency))),
    ]),
  );
  for (const [name, value] of selected) {
    for (const dependency of value.adapter.requires ?? []) {
      if (!selected.has(dependency)) {
        throw new Error(
          `Native adapter ${JSON.stringify(value.adapter.name)} for ${JSON.stringify(name)} ` +
            `requires missing Capability ${JSON.stringify(dependency)}.`,
        );
      }
    }
  }
  const ready = [...pending]
    .filter(([, dependencies]) => !dependencies.size)
    .map(([name]) => name)
    .sort();
  const ordered: ResolvedNativeCapability[] = [];
  while (ready.length) {
    const name = ready.shift()!;
    ordered.push(selected.get(name)!);
    for (const [candidate, dependencies] of pending) {
      if (!dependencies.delete(name) || dependencies.size) continue;
      if (!ordered.some(({ capability }) => capability.name === candidate)) {
        insertSorted(ready, candidate);
      }
    }
  }
  if (ordered.length !== selected.size) {
    const cycle = [...selected.keys()].filter(
      (name) => !ordered.some(({ capability }) => capability.name === name),
    );
    throw new Error(`Native Capability adapter cycle: ${cycle.sort().join(", ")}.`);
  }
  return ordered;
}

export function nativeCapabilityContract(capability: CapabilityIR): NativeCapabilityContract {
  if (capability.type.kind !== "record") {
    return { name: capability.name, operations: [] };
  }
  return {
    name: capability.name,
    operations: capability.type.fields
      .flatMap((field): readonly NativeOperationContract[] => {
        if (field.type.kind !== "function") return [];
        const input = field.type.parameters[0]?.type;
        const result = field.type.result;
        const mode =
          result.kind === "promise"
            ? "asynchronous"
            : result.kind === "stream"
              ? "stream"
              : "synchronous";
        return [
          {
            name: field.name,
            mode,
            input: input ?? { kind: "primitive", name: "void" },
            output:
              result.kind === "promise"
                ? result.value
                : result.kind === "stream"
                  ? result.element
                  : result,
          },
        ];
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function sameOperations(
  expected: readonly NativeOperationContract[],
  capability: CapabilityIR,
): boolean {
  const actual = nativeCapabilityContract(capability).operations;
  const patterns = [...expected].sort(byOperation);
  return (
    patterns.length === actual.length &&
    patterns.every((pattern, index) => {
      const value = actual[index]!;
      return (
        pattern.name === value.name &&
        pattern.mode === value.mode &&
        matchesType(pattern.input, value.input) &&
        matchesType(pattern.output, value.output)
      );
    })
  );
}

function matchesType(expected: NativeTypeContract, actual: NativeTypeContract): boolean {
  if (expected.kind === "any") return true;
  if (actual.kind === "any" || expected.kind !== actual.kind) return false;
  switch (expected.kind) {
    case "primitive":
    case "opaque":
      return expected.name === (actual as typeof expected).name;
    case "literal":
      return expected.value === (actual as typeof expected).value;
    case "array":
    case "stream":
      return matchesType(expected.element, (actual as typeof expected).element);
    case "tuple": {
      const values = (actual as typeof expected).elements;
      return (
        expected.elements.length === values.length &&
        expected.elements.every((value, index) => matchesType(value, values[index]!))
      );
    }
    case "option":
    case "promise":
      return matchesType(expected.value, (actual as typeof expected).value);
    case "union": {
      const values = [...(actual as typeof expected).variants];
      return (
        expected.variants.length === values.length &&
        expected.variants.every((variant) => {
          const index = values.findIndex((value) => matchesType(variant, value));
          if (index < 0) return false;
          values.splice(index, 1);
          return true;
        })
      );
    }
    case "record": {
      const value = actual as Extract<NativeTypeContract, { kind: "record" }>;
      const fields = new Map(value.fields.map((field) => [field.name, field]));
      if (!expected.open && expected.fields.length !== value.fields.length) return false;
      return expected.fields.every((field) => {
        const candidate = fields.get(field.name);
        return (
          candidate !== undefined &&
          field.optional === candidate.optional &&
          matchesType(field.type, candidate.type)
        );
      });
    }
    case "function": {
      const value = actual as Extract<NativeTypeContract, { kind: "function" }>;
      return (
        expected.parameters.length === value.parameters.length &&
        expected.parameters.every(
          (parameter, index) =>
            parameter.optional === value.parameters[index]!.optional &&
            matchesType(parameter.type, value.parameters[index]!.type),
        ) &&
        matchesType(expected.result, value.result)
      );
    }
  }
}

function validateTypeContract(contract: NativeTypeContract, subject: string): void {
  if (contract.kind === "any" || contract.kind === "literal") return;
  if (contract.kind === "primitive" || contract.kind === "opaque") {
    if (!contract.name) throw new Error(`${subject} has no type name.`);
    return;
  }
  if (contract.kind === "array" || contract.kind === "stream") {
    validateTypeContract(contract.element, `${subject} element`);
    return;
  }
  if (contract.kind === "option" || contract.kind === "promise") {
    validateTypeContract(contract.value, `${subject} value`);
    return;
  }
  if (contract.kind === "tuple") {
    contract.elements.forEach((value, index) =>
      validateTypeContract(value, `${subject}[${index}]`),
    );
    return;
  }
  if (contract.kind === "union") {
    if (!contract.variants.length) throw new Error(`${subject} has an empty union.`);
    contract.variants.forEach((value, index) =>
      validateTypeContract(value, `${subject} variant ${index}`),
    );
    return;
  }
  if (contract.kind === "record") {
    duplicate(
      contract.fields.map(({ name }) => name),
      `${subject} field`,
    );
    contract.fields.forEach((field) =>
      validateTypeContract(field.type, `${subject}.${field.name}`),
    );
    return;
  }
  contract.parameters.forEach((parameter, index) =>
    validateTypeContract(parameter.type, `${subject} parameter ${index}`),
  );
  validateTypeContract(contract.result, `${subject} result`);
}

function byOperation(left: NativeOperationContract, right: NativeOperationContract): number {
  return left.name.localeCompare(right.name);
}

function identifier(value: string, label: string, kebab = false): void {
  const pattern = kebab ? /^[a-z][a-z0-9_-]*$/ : /^[A-Za-z][A-Za-z0-9_-]*$/;
  if (!pattern.test(value)) throw new Error(`${label} ${JSON.stringify(value)} is invalid.`);
}

function rustPath(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) {
    throw new Error(`${label} ${JSON.stringify(value)} is invalid.`);
  }
}

function duplicate(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} ${JSON.stringify(value)} is duplicated.`);
    seen.add(value);
  }
}

function insertSorted(values: string[], value: string): void {
  if (values.includes(value)) return;
  const index = values.findIndex((candidate) => candidate.localeCompare(value) > 0);
  if (index < 0) values.push(value);
  else values.splice(index, 0, value);
}
