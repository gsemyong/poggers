import {
  assertApplicationIRVersion,
  type ComponentIR,
  type ExpressionIR,
  type FunctionIR,
  type ApplicationIR,
  type ProgramContributionIR,
  type ProgramIR,
  type StatementIR,
  type TypeIR,
} from "@/core/compiler/ir";

export type CapabilityImplementations = Readonly<
  Record<string, Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>>
>;

export type ExecutionTrace = Readonly<{
  calls: readonly CapabilityCallTrace[];
  result: unknown;
}>;

export type CapabilityCallTrace = Readonly<{
  capability: string;
  operation: string;
  input: unknown;
}>;

export type ExecutionScenario = Readonly<{
  responses: Readonly<
    Record<
      string,
      readonly (
        | Readonly<{ ok: unknown }>
        | Readonly<{ error: Readonly<{ message: string; data?: unknown }> }>
      )[]
    >
  >;
}>;

/** Executes the portable process body represented by the typed IR. */
export async function executeProgramIR(
  ir: ApplicationIR,
  programId: string,
  capabilities: CapabilityImplementations,
): Promise<ExecutionTrace> {
  assertApplicationIRVersion(ir);
  const program = ir.programs
    .flatMap(({ contributions }) => contributions)
    .find(({ id }) => id === programId);
  if (!program) throw new Error(`Unknown Program ${JSON.stringify(programId)}.`);
  return executeProgramContributionIR(program, capabilities);
}

export async function executeProgramContributionIR(
  program: ProgramContributionIR,
  capabilities: CapabilityImplementations,
): Promise<ExecutionTrace> {
  validateCapabilities(program, capabilities);
  if (program.implementation.kind !== "portable") {
    throw new Error(
      `Program ${JSON.stringify(program.id)} is ${program.implementation.kind}, not portable IR.`,
    );
  }

  const calls: CapabilityCallTrace[] = [];
  const locals = new Map<string, unknown>();
  const functions = new Map(
    program.implementation.functions.map((function_) => [function_.id, function_]),
  );
  try {
    const completion = await executeStatements(
      program.implementation.start.body,
      locals,
      capabilities,
      calls,
      functions,
    );
    return { calls, result: completion.value };
  } catch (error) {
    if (error && typeof error === "object") {
      Object.defineProperty(error, portableCalls, { value: [...calls] });
    }
    throw error;
  }
}

/** Runs one deterministic fixture through the reference backend using generated Capability doubles. */
export async function executeProgramFixtureIR(
  ir: ApplicationIR,
  programId: string,
  scenario: ExecutionScenario,
): Promise<Readonly<{ calls: readonly CapabilityCallTrace[]; result: unknown }>> {
  const program = ir.programs
    .flatMap(({ contributions }) => contributions)
    .find(({ id }) => id === programId);
  if (!program) throw new Error(`Unknown Program ${JSON.stringify(programId)}.`);
  const pending = new Map(
    Object.entries(scenario.responses).map(([key, values]) => [key, [...values]]),
  );
  const capabilities: Record<
    string,
    Record<string, (...arguments_: readonly unknown[]) => unknown>
  > = Object.create(null) as Record<
    string,
    Record<string, (...arguments_: readonly unknown[]) => unknown>
  >;
  for (const capability of program.requires) {
    if (capability.type.kind !== "record") continue;
    const implementation: Record<string, (...arguments_: readonly unknown[]) => unknown> =
      Object.create(null) as Record<string, (...arguments_: readonly unknown[]) => unknown>;
    for (const operation of capability.type.fields) {
      if (operation.type.kind !== "function") continue;
      const key = `${capability.name}.${operation.name}`;
      const respond = () => {
        const response = pending.get(key)?.shift();
        if (!response) throw new Error(`missing fixture response for ${key}`);
        if ("error" in response) {
          throw new FixtureCapabilityError(response.error.message, response.error.data);
        }
        return response.ok;
      };
      implementation[operation.name] =
        operation.type.result.kind === "promise" ? async () => respond() : () => respond();
    }
    capabilities[capability.name] = implementation;
  }
  try {
    const trace = await executeProgramIR(ir, programId, capabilities);
    return {
      calls: canonicalPortableValue(trace.calls) as readonly CapabilityCallTrace[],
      result: { ok: canonicalPortableValue(trace.result ?? null) },
    };
  } catch (error) {
    return {
      calls: canonicalPortableValue(
        error && typeof error === "object" && portableCalls in error
          ? ((error as { [portableCalls]: readonly CapabilityCallTrace[] })[portableCalls] ?? [])
          : [],
      ) as readonly CapabilityCallTrace[],
      result: {
        error: {
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof FixtureCapabilityError && error.data !== undefined
            ? { data: canonicalPortableValue(error.data) }
            : {}),
        },
      },
    };
  }
}

function canonicalPortableValue(value: unknown): unknown {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $number: "nan" };
    if (value === Infinity) return { $number: "positive-infinity" };
    if (value === -Infinity) return { $number: "negative-infinity" };
    if (Object.is(value, -0)) return { $number: "negative-zero" };
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalPortableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, canonicalPortableValue(item)]),
    );
  }
  return value;
}

const portableCalls = Symbol("poggers.portable.calls");

class FixtureCapabilityError extends Error {
  readonly data: unknown;

  constructor(message: string, data: unknown) {
    super(message);
    this.name = "FixtureCapabilityError";
    this.data = data;
  }
}

function validateCapabilities(
  program: ProgramContributionIR,
  capabilities: CapabilityImplementations,
): void {
  for (const contract of program.requires) {
    const implementation = capabilities[contract.name];
    if (!implementation) {
      throw new Error(
        `Program ${JSON.stringify(program.id)} is missing Capability ${JSON.stringify(contract.name)}.`,
      );
    }
    if (contract.type.kind !== "record") continue;
    for (const operation of contract.type.fields) {
      if (
        operation.type.kind === "function" &&
        typeof implementation[operation.name] !== "function"
      ) {
        throw new Error(
          `Capability ${JSON.stringify(contract.name)} is missing operation ${JSON.stringify(operation.name)}.`,
        );
      }
    }
  }
}

type Completion = Readonly<{ returned: boolean; value?: unknown }>;

async function executeStatements(
  statements: readonly StatementIR[],
  locals: Map<string, unknown>,
  capabilities: CapabilityImplementations,
  calls: CapabilityCallTrace[],
  functions: ReadonlyMap<string, FunctionIR>,
): Promise<Completion> {
  for (const statement of statements) {
    switch (statement.kind) {
      case "let":
        locals.set(
          statement.name,
          await evaluate(statement.value, locals, capabilities, calls, functions),
        );
        break;
      case "assign": {
        const current = locals.get(statement.name);
        const value = await evaluate(statement.value, locals, capabilities, calls, functions);
        locals.set(statement.name, assign(statement.operator, current, value));
        break;
      }
      case "expression":
        await evaluate(statement.expression, locals, capabilities, calls, functions);
        break;
      case "if": {
        const branch = boolean(
          await evaluate(statement.condition, locals, capabilities, calls, functions),
        )
          ? statement.consequent
          : statement.alternate;
        const completion = await executeStatements(branch, locals, capabilities, calls, functions);
        if (completion.returned) return completion;
        break;
      }
      case "for-of": {
        const values = await evaluate(statement.values, locals, capabilities, calls, functions);
        if (!values || typeof values !== "object" || !(Symbol.iterator in values)) {
          throw new Error(
            `${statement.span.file}:${statement.span.line}: for-of value is not iterable.`,
          );
        }
        for (const value of values as Iterable<unknown>) {
          locals.set(statement.item, value);
          const completion = await executeStatements(
            statement.body,
            locals,
            capabilities,
            calls,
            functions,
          );
          if (completion.returned) return completion;
        }
        break;
      }
      case "return":
        return {
          returned: true,
          ...(statement.value
            ? {
                value: await evaluate(statement.value, locals, capabilities, calls, functions),
              }
            : {}),
        };
    }
  }
  return { returned: false };
}

async function evaluate(
  expression: ExpressionIR,
  locals: ReadonlyMap<string, unknown>,
  capabilities: CapabilityImplementations,
  calls: CapabilityCallTrace[],
  functions: ReadonlyMap<string, FunctionIR>,
): Promise<unknown> {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "local":
      if (!locals.has(expression.name))
        throw new Error(`Unknown portable binding ${expression.name}.`);
      return locals.get(expression.name);
    case "array":
      return Promise.all(
        expression.values.map((value) => evaluate(value, locals, capabilities, calls, functions)),
      );
    case "record":
      return Object.fromEntries(
        await Promise.all(
          expression.fields.map(async ({ name, value }) => [
            name,
            await evaluate(value, locals, capabilities, calls, functions),
          ]),
        ),
      );
    case "property": {
      const value = await evaluate(expression.value, locals, capabilities, calls, functions);
      if (!value || typeof value !== "object") throw new Error(`Cannot read ${expression.name}.`);
      return (value as Readonly<Record<string, unknown>>)[expression.name];
    }
    case "unary": {
      const value = await evaluate(expression.value, locals, capabilities, calls, functions);
      return expression.operator === "!" ? !boolean(value) : -number(value);
    }
    case "binary":
      return binary(
        expression.operator,
        await evaluate(expression.left, locals, capabilities, calls, functions),
        await evaluate(expression.right, locals, capabilities, calls, functions),
      );
    case "call": {
      const function_ = functions.get(expression.function);
      if (!function_) throw new Error(`Unknown portable function ${expression.function}.`);
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, capabilities, calls, functions),
        ),
      );
      const functionLocals = new Map<string, unknown>();
      for (const [index, parameter] of function_.parameters.entries()) {
        functionLocals.set(parameter.name, arguments_[index]);
      }
      const completion = await executeStatements(
        function_.body,
        functionLocals,
        capabilities,
        calls,
        functions,
      );
      return completion.value;
    }
    case "capability-call": {
      const capability = capabilities[expression.capability];
      const operation = capability?.[expression.operation];
      if (!operation) {
        throw new Error(
          `Missing Capability operation ${expression.capability}.${expression.operation}.`,
        );
      }
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, capabilities, calls, functions),
        ),
      );
      calls.push({
        capability: expression.capability,
        operation: expression.operation,
        input: arguments_[0] ?? null,
      });
      const result = Reflect.apply(operation, capability, arguments_);
      if (expression.awaited) return await result;
      if (isPromiseLike(result)) {
        throw new Error(
          `Synchronous Capability ${expression.capability}.${expression.operation} returned a Promise.`,
        );
      }
      return result;
    }
  }
}

function assign(operator: "=" | "+=" | "-=" | "*=" | "/=", left: unknown, right: unknown) {
  switch (operator) {
    case "=":
      return right;
    case "+=":
      return binary("+", left, right);
    case "-=":
      return binary("-", left, right);
    case "*=":
      return binary("*", left, right);
    case "/=":
      return binary("/", left, right);
  }
}

function binary(
  operator: Extract<ExpressionIR, { kind: "binary" }>["operator"],
  left: unknown,
  right: unknown,
): unknown {
  switch (operator) {
    case "+":
      if (typeof left === "string" && typeof right === "string") return left + right;
      return number(left) + number(right);
    case "-":
      return number(left) - number(right);
    case "*":
      return number(left) * number(right);
    case "/":
      return number(left) / number(right);
    case "%":
      return number(left) % number(right);
    case "===":
      return equal(left, right);
    case "!==":
      return !equal(left, right);
    case "<":
      return number(left) < number(right);
    case "<=":
      return number(left) <= number(right);
    case ">":
      return number(left) > number(right);
    case ">=":
      return number(left) >= number(right);
    case "&&":
      return boolean(left) && boolean(right);
    case "||":
      return boolean(left) || boolean(right);
    case "??":
      return left ?? right;
  }
}

function number(value: unknown): number {
  if (typeof value !== "number") throw new Error(`Expected number, received ${typeof value}.`);
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(`Expected boolean, received ${typeof value}.`);
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  if (
    (typeof left === "number" && typeof right === "number") ||
    (typeof left === "string" && typeof right === "string") ||
    (typeof left === "boolean" && typeof right === "boolean") ||
    left === null ||
    right === null
  ) {
    return left === right;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
    );
  }
  return false;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

export type HotReplacementManifest = Readonly<{
  revision: string;
  programs: readonly Readonly<{
    id: string;
    environment: ProgramIR["environment"];
    state?: TypeIR;
    components: readonly ComponentIR[];
  }>[];
}>;

export type HotActivation<Value, Snapshot> = Readonly<{
  value: Value;
  snapshot: Snapshot;
  dispose(): void | Promise<void>;
}>;

export type HotCandidate<Value, Snapshot> = Readonly<{
  manifest: HotReplacementManifest;
  prepare(previous: Snapshot | undefined): Promise<
    Readonly<{
      activate(): Promise<HotActivation<Value, Snapshot>>;
      rollback?(): void | Promise<void>;
    }>
  >;
}>;

export type HotUpdateResult<Value> =
  | Readonly<{ status: "activated"; value: Value }>
  | Readonly<{ status: "rejected"; reason: string; cause?: unknown }>;

export function createHotReplacementManifest(ir: ApplicationIR): HotReplacementManifest {
  const programs = ir.programs.flatMap((program) =>
    program.contributions.map((contribution) => ({
      id: contribution.id,
      environment: program.environment,
      ...(contribution.ui ? { state: contribution.ui.state } : {}),
      components: contribution.ui?.components ?? [],
    })),
  );
  return { revision: stableHash(JSON.stringify(programs)), programs };
}

export function isHotReplacementCompatible(
  previous: HotReplacementManifest,
  next: HotReplacementManifest,
): boolean {
  const previousPrograms = new Map(previous.programs.map((program) => [program.id, program]));
  for (const program of next.programs) {
    const before = previousPrograms.get(program.id);
    if (!before) continue;
    if (JSON.stringify(before.environment) !== JSON.stringify(program.environment)) return false;
    if (before.state && program.state && !compatibleType(before.state, program.state)) return false;
    if (Boolean(before.state) !== Boolean(program.state)) return false;
    const beforeComponents = new Map(
      before.components.map((component) => [component.name, component]),
    );
    for (const component of program.components) {
      const previousComponent = beforeComponents.get(component.name);
      if (previousComponent && !compatibleComponent(previousComponent, component)) return false;
    }
  }
  return true;
}

function compatibleComponent(previous: ComponentIR, next: ComponentIR): boolean {
  if (JSON.stringify(previous.propCallbacks) !== JSON.stringify(next.propCallbacks)) return false;
  if (!compatibleType(previous.state, next.state)) return false;
  if (JSON.stringify(previous.elements) !== JSON.stringify(next.elements)) return false;
  return true;
}

/** Serializes candidate activation and preserves the last live revision on failure. */
export class HotUpdateCoordinator<Value, Snapshot> {
  #active: HotActivation<Value, Snapshot> | undefined;
  #manifest: HotReplacementManifest | undefined;
  #transaction = Promise.resolve();

  get value(): Value | undefined {
    return this.#active?.value;
  }

  replace(candidate: HotCandidate<Value, Snapshot>): Promise<HotUpdateResult<Value>> {
    const transaction = this.#transaction.then(() => this.#replace(candidate));
    this.#transaction = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }

  async dispose(): Promise<void> {
    await this.#transaction;
    const active = this.#active;
    this.#active = undefined;
    this.#manifest = undefined;
    await active?.dispose();
  }

  async #replace(candidate: HotCandidate<Value, Snapshot>): Promise<HotUpdateResult<Value>> {
    if (this.#manifest && !isHotReplacementCompatible(this.#manifest, candidate.manifest)) {
      return { status: "rejected", reason: "incompatible-manifest" };
    }

    let prepared: Awaited<ReturnType<typeof candidate.prepare>>;
    try {
      prepared = await candidate.prepare(this.#active?.snapshot);
    } catch (cause) {
      return { status: "rejected", reason: "prepare-failed", cause };
    }

    let activated: HotActivation<Value, Snapshot>;
    try {
      activated = await prepared.activate();
    } catch (cause) {
      await prepared.rollback?.();
      return { status: "rejected", reason: "activation-failed", cause };
    }

    const previous = this.#active;
    this.#active = activated;
    this.#manifest = candidate.manifest;
    await previous?.dispose();
    return { status: "activated", value: activated.value };
  }
}

function compatibleType(previous: TypeIR, next: TypeIR): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "record" && next.kind === "record") {
    const fields = new Map(next.fields.map((field) => [field.name, field]));
    return previous.fields.every((field) => {
      const candidate = fields.get(field.name);
      return candidate
        ? field.optional === candidate.optional && compatibleType(field.type, candidate.type)
        : true;
    });
  }
  if (previous.kind === "array" && next.kind === "array") {
    return compatibleType(previous.element, next.element);
  }
  if (previous.kind === "option" && next.kind === "option") {
    return compatibleType(previous.value, next.value);
  }
  if (previous.kind === "promise" && next.kind === "promise") {
    return compatibleType(previous.value, next.value);
  }
  if (previous.kind === "stream" && next.kind === "stream") {
    return compatibleType(previous.element, next.element);
  }
  return JSON.stringify(previous) === JSON.stringify(next);
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
