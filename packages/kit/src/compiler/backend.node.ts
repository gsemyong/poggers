import {
  assertProductIRVersion,
  type ExpressionIR,
  type ProductIR,
  type ProgramIR,
  type StatementIR,
} from "./ir";

export type NodeCapabilities = Readonly<
  Record<string, Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>>
>;

export type ExecutionTrace = Readonly<{
  calls: readonly string[];
  result: unknown;
}>;

/** Executes the portable process body represented by the typed IR. */
export async function executeProgramIR(
  ir: ProductIR,
  programId: string,
  capabilities: NodeCapabilities,
): Promise<ExecutionTrace> {
  assertProductIRVersion(ir);
  const program = ir.programs.find(({ id }) => id === programId);
  if (!program) throw new Error(`Unknown Program ${JSON.stringify(programId)}.`);
  validateCapabilities(program, capabilities);
  if (!program.start) return { calls: [], result: undefined };

  const calls: string[] = [];
  const locals = new Map<string, unknown>();
  const completion = await executeStatements(program.start.body, locals, capabilities, calls);
  return { calls, result: completion.value };
}

function validateCapabilities(program: ProgramIR, capabilities: NodeCapabilities): void {
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
  capabilities: NodeCapabilities,
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
  capabilities: NodeCapabilities,
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
