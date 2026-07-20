import {
  assertApplicationIRVersion,
  type ComponentIR,
  type ExpressionIR,
  type ApplicationIR,
  type ProgramIR,
  type StatementIR,
  type TypeIR,
} from "./compiler/ir";

export type CapabilityImplementations = Readonly<
  Record<string, Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>>
>;

export type ExecutionTrace = Readonly<{
  calls: readonly string[];
  result: unknown;
}>;

/** Executes the portable process body represented by the typed IR. */
export async function executeProgramIR(
  ir: ApplicationIR,
  programId: string,
  capabilities: CapabilityImplementations,
): Promise<ExecutionTrace> {
  assertApplicationIRVersion(ir);
  const program = ir.programs.find(({ id }) => id === programId);
  if (!program) throw new Error(`Unknown Program ${JSON.stringify(programId)}.`);
  validateCapabilities(program, capabilities);
  if (!program.start) return { calls: [], result: undefined };

  const calls: string[] = [];
  const locals = new Map<string, unknown>();
  const completion = await executeStatements(program.start.body, locals, capabilities, calls);
  return { calls, result: completion.value };
}

function validateCapabilities(program: ProgramIR, capabilities: CapabilityImplementations): void {
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
  calls: string[],
): Promise<Completion> {
  for (const statement of statements) {
    switch (statement.kind) {
      case "let":
        locals.set(statement.name, await evaluate(statement.value, locals, capabilities, calls));
        break;
      case "assign": {
        const current = locals.get(statement.name);
        const value = await evaluate(statement.value, locals, capabilities, calls);
        locals.set(statement.name, assign(statement.operator, current, value));
        break;
      }
      case "expression":
        await evaluate(statement.expression, locals, capabilities, calls);
        break;
      case "if": {
        const branch = truthy(await evaluate(statement.condition, locals, capabilities, calls))
          ? statement.consequent
          : statement.alternate;
        const completion = await executeStatements(branch, locals, capabilities, calls);
        if (completion.returned) return completion;
        break;
      }
      case "for-of": {
        const values = await evaluate(statement.values, locals, capabilities, calls);
        if (!values || typeof values !== "object" || !(Symbol.iterator in values)) {
          throw new Error(
            `${statement.span.file}:${statement.span.line}: for-of value is not iterable.`,
          );
        }
        for (const value of values as Iterable<unknown>) {
          locals.set(statement.item, value);
          const completion = await executeStatements(statement.body, locals, capabilities, calls);
          if (completion.returned) return completion;
        }
        break;
      }
      case "return":
        return {
          returned: true,
          ...(statement.value
            ? { value: await evaluate(statement.value, locals, capabilities, calls) }
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
  calls: string[],
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
        expression.values.map((value) => evaluate(value, locals, capabilities, calls)),
      );
    case "record":
      return Object.fromEntries(
        await Promise.all(
          expression.fields.map(async ({ name, value }) => [
            name,
            await evaluate(value, locals, capabilities, calls),
          ]),
        ),
      );
    case "property": {
      const value = await evaluate(expression.value, locals, capabilities, calls);
      if (!value || typeof value !== "object") throw new Error(`Cannot read ${expression.name}.`);
      return (value as Readonly<Record<string, unknown>>)[expression.name];
    }
    case "unary": {
      const value = await evaluate(expression.value, locals, capabilities, calls);
      return expression.operator === "!" ? !truthy(value) : -number(value);
    }
    case "binary":
      return binary(
        expression.operator,
        await evaluate(expression.left, locals, capabilities, calls),
        await evaluate(expression.right, locals, capabilities, calls),
      );
    case "capability-call": {
      const capability = capabilities[expression.capability];
      const operation = capability?.[expression.operation];
      if (!operation) {
        throw new Error(
          `Missing Capability operation ${expression.capability}.${expression.operation}.`,
        );
      }
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) => evaluate(argument, locals, capabilities, calls)),
      );
      calls.push(`${expression.capability}.${expression.operation}`);
      const result = Reflect.apply(operation, capability, arguments_);
      return expression.awaited ? await result : result;
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
      return typeof left === "string" || typeof right === "string"
        ? `${String(left)}${String(right)}`
        : number(left) + number(right);
    case "-":
      return number(left) - number(right);
    case "*":
      return number(left) * number(right);
    case "/":
      return number(left) / number(right);
    case "%":
      return number(left) % number(right);
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "<":
      return number(left) < number(right);
    case "<=":
      return number(left) <= number(right);
    case ">":
      return number(left) > number(right);
    case ">=":
      return number(left) >= number(right);
    case "&&":
      return truthy(left) ? right : left;
    case "||":
      return truthy(left) ? left : right;
  }
}

function number(value: unknown): number {
  if (typeof value !== "number") throw new Error(`Expected number, received ${typeof value}.`);
  return value;
}

function truthy(value: unknown): boolean {
  return Boolean(value);
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
  const programs = ir.programs.map((program) => ({
    id: program.id,
    environment: program.environment,
    ...(program.ui ? { state: program.ui.state } : {}),
    components: program.ui?.components ?? [],
  }));
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
