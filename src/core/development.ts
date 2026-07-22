import {
  assertApplicationIRVersion,
  linkProgram,
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

export type LinkedProgramExecution = AsyncDisposable &
  Readonly<{
    capabilities: Readonly<Record<string, unknown>>;
  }>;

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
  const locals: PortableLocals = new Map([["capabilities", { value: capabilities }]]);
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
    return {
      calls,
      result: materializeCapabilityValue(completion.value, capabilities, calls, functions),
    };
  } catch (error) {
    if (error && typeof error === "object") {
      Object.defineProperty(error, portableCalls, { value: [...calls] });
    }
    throw error;
  }
}

/** Executes every portable contribution through the canonical linked Capability graph. */
export async function executeLinkedProgramIR(
  program: ProgramIR,
  external: CapabilityImplementations,
): Promise<LinkedProgramExecution> {
  const linked = linkProgram(program);
  const expected = linked.external.map(({ name }) => name).sort();
  const supplied = Object.keys(external).sort();
  if (expected.join("\n") !== supplied.join("\n")) {
    const missing = expected.filter((name) => !supplied.includes(name));
    const excess = supplied.filter((name) => !expected.includes(name));
    throw new Error(
      `Program ${JSON.stringify(program.name)} external Capabilities are invalid` +
        `${missing.length ? `; missing: ${missing.join(", ")}` : ""}` +
        `${excess.length ? `; unexpected: ${excess.join(", ")}` : ""}.`,
    );
  }

  const capabilities: Record<string, unknown> = Object.assign(Object.create(null), external);
  const resources: unknown[] = [];
  try {
    for (const { contribution } of linked.contributions) {
      if (contribution.implementation.kind === "none") continue;
      if (contribution.implementation.kind !== "portable") {
        throw new Error(
          `${contribution.span.file}:${contribution.span.line}:${contribution.span.column}: ` +
            `Program contribution ${JSON.stringify(contribution.id)} is source, not portable IR.`,
        );
      }
      const required = Object.fromEntries(
        contribution.requires.map(({ name }) => [name, capabilities[name]]),
      ) as CapabilityImplementations;
      const execution = await executeProgramContributionIR(contribution, required);
      if (!contribution.provides.length) {
        if (execution.result !== undefined) resources.push(execution.result);
        continue;
      }
      if (!isRecord(execution.result)) {
        throw new Error(
          `Program contribution ${JSON.stringify(contribution.id)} must return its declared ` +
            "Capability object.",
        );
      }
      const declared = contribution.provides.map(({ name }) => name).sort();
      const actual = Reflect.ownKeys(execution.result)
        .filter((name): name is string => typeof name === "string")
        .sort();
      if (declared.join("\n") !== actual.join("\n")) {
        throw new Error(
          `Program contribution ${JSON.stringify(contribution.id)} provided ` +
            `[${actual.join(", ")}] but its contract declares [${declared.join(", ")}].`,
        );
      }
      for (const name of declared) {
        const capability = execution.result[name];
        capabilities[name] = capability;
        resources.push(capability);
      }
    }
  } catch (error) {
    await disposePortableResources(resources).catch(() => undefined);
    throw error;
  }

  let disposed = false;
  return {
    capabilities: Object.freeze({ ...capabilities }),
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await disposePortableResources(resources);
    },
  };
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
type PortableCell = { value: unknown };
type PortableLocals = Map<string, PortableCell>;
type PortableClosure = Readonly<{
  function: string;
  captures: readonly unknown[];
}>;

async function executeStatements(
  statements: readonly StatementIR[],
  locals: PortableLocals,
  capabilities: CapabilityImplementations,
  calls: CapabilityCallTrace[],
  functions: ReadonlyMap<string, FunctionIR>,
): Promise<Completion> {
  for (const statement of statements) {
    switch (statement.kind) {
      case "let":
        locals.set(statement.name, {
          value: await evaluate(statement.value, locals, capabilities, calls, functions),
        });
        break;
      case "assign": {
        const current = locals.get(statement.name);
        if (!current) throw new Error(`Unknown portable binding ${statement.name}.`);
        const value = await evaluate(statement.value, locals, capabilities, calls, functions);
        current.value = assign(statement.operator, current.value, value);
        break;
      }
      case "expression":
        await evaluate(statement.expression, locals, capabilities, calls, functions);
        break;
      case "array-push": {
        const array = locals.get(statement.array)?.value;
        if (!Array.isArray(array)) throw new Error(`${statement.array} is not an array.`);
        array.push(await evaluate(statement.value, locals, capabilities, calls, functions));
        break;
      }
      case "throw":
        throw await evaluate(statement.value, locals, capabilities, calls, functions);
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
        if (statement.asynchronous) {
          if (!values || typeof values !== "object" || !(Symbol.asyncIterator in values)) {
            throw new Error(
              `${statement.span.file}:${statement.span.line}: for-await-of value is not an asynchronous stream.`,
            );
          }
          for await (const value of values as AsyncIterable<unknown>) {
            locals.set(statement.item, { value });
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
        if (!values || typeof values !== "object" || !(Symbol.iterator in values)) {
          throw new Error(
            `${statement.span.file}:${statement.span.line}: for-of value is not iterable.`,
          );
        }
        for (const value of values as Iterable<unknown>) {
          locals.set(statement.item, { value });
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
      case "for-range": {
        const from = number(await evaluate(statement.from, locals, capabilities, calls, functions));
        const to = number(await evaluate(statement.to, locals, capabilities, calls, functions));
        for (let value = from; value < to; value += 1) {
          locals.set(statement.item, { value });
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
      case "try": {
        let completion: Completion = { returned: false };
        try {
          completion = await executeStatements(
            statement.body,
            locals,
            capabilities,
            calls,
            functions,
          );
        } catch (error) {
          if (!statement.catch.length) throw error;
          if (statement.error) locals.set(statement.error, { value: error });
          completion = await executeStatements(
            statement.catch,
            locals,
            capabilities,
            calls,
            functions,
          );
        } finally {
          const finalized = await executeStatements(
            statement.finally,
            locals,
            capabilities,
            calls,
            functions,
          );
          if (finalized.returned) completion = finalized;
        }
        if (completion.returned) return completion;
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

function portableFailure(
  name: string,
  value: Readonly<{
    arguments: readonly unknown[];
    fields: Readonly<Record<string, unknown>>;
  }>,
): Error {
  const message = String(
    value.fields.message ??
      value.arguments[name === "Error" || name === "TypeError" ? 0 : 1] ??
      value.arguments[0] ??
      name,
  );
  const error = new Error(message);
  error.name = name;
  Object.assign(error, value.fields, { arguments: value.arguments });
  return error;
}

async function evaluate(
  expression: ExpressionIR,
  locals: PortableLocals,
  capabilities: CapabilityImplementations,
  calls: CapabilityCallTrace[],
  functions: ReadonlyMap<string, FunctionIR>,
): Promise<unknown> {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "none":
      return undefined;
    case "error":
      return portableFailure(expression.name, {
        arguments: await Promise.all(
          expression.arguments.map((argument) =>
            evaluate(argument, locals, capabilities, calls, functions),
          ),
        ),
        fields: Object.fromEntries(
          await Promise.all(
            expression.fields.map(async ({ name, value }) => [
              name,
              await evaluate(value, locals, capabilities, calls, functions),
            ]),
          ),
        ),
      });
    case "error-match": {
      const value = await evaluate(expression.value, locals, capabilities, calls, functions);
      return value instanceof Error && value.name === expression.name;
    }
    case "local":
      if (!locals.has(expression.name))
        throw new Error(`Unknown portable binding ${expression.name}.`);
      return locals.get(expression.name)!.value;
    case "array":
      return Promise.all(
        expression.values.map((value) => evaluate(value, locals, capabilities, calls, functions)),
      );
    case "record":
      return normalizePortableRecord(
        Object.fromEntries(
          await Promise.all(
            expression.fields.map(async ({ name, value }) => [
              wellKnownProperty(name),
              await evaluate(value, locals, capabilities, calls, functions),
            ]),
          ),
        ),
      );
    case "record-merge": {
      const result: Record<string, unknown> = {};
      for (const entry of expression.entries) {
        const value = await evaluate(entry.value, locals, capabilities, calls, functions);
        if (entry.kind === "field") {
          Reflect.set(result, wellKnownProperty(entry.name), value);
        } else {
          if (!isRecord(value)) throw new Error("Portable record spread requires a record.");
          Object.assign(result, value);
        }
      }
      return normalizePortableRecord(result);
    }
    case "property": {
      const value = await evaluate(expression.value, locals, capabilities, calls, functions);
      if ((value === undefined || value === null) && expression.optional) return undefined;
      if (expression.name === "length" && (typeof value === "string" || Array.isArray(value))) {
        return value.length;
      }
      if (!value || typeof value !== "object") {
        throw new Error(
          `${expression.span.file}:${expression.span.line}:${expression.span.column}: ` +
            `Cannot read ${expression.name} from ${String(value)}.`,
        );
      }
      return (value as Readonly<Record<PropertyKey, unknown>>)[wellKnownProperty(expression.name)];
    }
    case "unary": {
      const value = await evaluate(expression.value, locals, capabilities, calls, functions);
      if (expression.operator === "present") return value !== undefined && value !== null;
      return expression.operator === "!" ? !boolean(value) : -number(value);
    }
    case "binary": {
      const left = await evaluate(expression.left, locals, capabilities, calls, functions);
      if (expression.operator === "&&" && !boolean(left)) return false;
      if (expression.operator === "||" && boolean(left)) return true;
      return binary(
        expression.operator,
        left,
        await evaluate(expression.right, locals, capabilities, calls, functions),
      );
    }
    case "conditional":
      return boolean(await evaluate(expression.condition, locals, capabilities, calls, functions))
        ? evaluate(expression.consequent, locals, capabilities, calls, functions)
        : evaluate(expression.alternate, locals, capabilities, calls, functions);
    case "closure": {
      const function_ = functions.get(expression.function);
      if (!function_) throw new Error(`Unknown portable function ${expression.function}.`);
      const captures = await Promise.all(
        expression.captures.map(async (capture): Promise<PortableCell> => {
          if (capture.kind === "local") {
            const cell = locals.get(capture.name);
            if (!cell) throw new Error(`Unknown portable binding ${capture.name}.`);
            return cell;
          }
          return { value: await evaluate(capture, locals, capabilities, calls, functions) };
        }),
      );
      return (...arguments_: readonly unknown[]) =>
        executePortableFunction(function_, captures, arguments_, capabilities, calls, functions);
    }
    case "call": {
      const function_ = functions.get(expression.function);
      if (!function_) throw new Error(`Unknown portable function ${expression.function}.`);
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, capabilities, calls, functions),
        ),
      );
      return executePortableFunction(function_, [], arguments_, capabilities, calls, functions);
    }
    case "invoke": {
      const closure = await evaluate(expression.callee, locals, capabilities, calls, functions);
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, capabilities, calls, functions),
        ),
      );
      if (typeof closure === "function") return Reflect.apply(closure, undefined, arguments_);
      if (!isPortableClosure(closure))
        throw new Error("Portable invocation target is not a function.");
      const function_ = functions.get(closure.function);
      if (!function_) throw new Error(`Unknown portable function ${closure.function}.`);
      return executePortableFunction(
        function_,
        closure.captures,
        arguments_,
        capabilities,
        calls,
        functions,
      );
    }
    case "method-call": {
      const receiver = await evaluate(expression.receiver, locals, capabilities, calls, functions);
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, capabilities, calls, functions),
        ),
      );
      if (expression.method === "find") {
        if (!Array.isArray(receiver)) throw new Error("find requires an array.");
        const predicate = arguments_[0];
        if (typeof predicate === "function") {
          for (const value of receiver) {
            if (boolean(await Reflect.apply(predicate, undefined, [value]))) return value;
          }
          return undefined;
        }
        if (!isPortableClosure(predicate))
          throw new Error("Array.find requires a portable closure.");
        const function_ = functions.get(predicate.function);
        if (!function_) throw new Error(`Unknown portable function ${predicate.function}.`);
        for (const value of receiver) {
          if (
            boolean(
              await executePortableFunction(
                function_,
                predicate.captures,
                [value],
                capabilities,
                calls,
                functions,
              ),
            )
          ) {
            return value;
          }
        }
        return undefined;
      }
      if (isRecord(receiver)) {
        const member = receiver[expression.method];
        if (typeof member === "function") return Reflect.apply(member, receiver, arguments_);
        if (isPortableClosure(member)) {
          const function_ = functions.get(member.function);
          if (!function_) throw new Error(`Unknown portable function ${member.function}.`);
          return executePortableFunction(
            function_,
            member.captures,
            arguments_,
            capabilities,
            calls,
            functions,
          );
        }
      }
      const name = expression.method === "iterator" ? Symbol.asyncIterator : expression.method;
      const method = (receiver as unknown as Record<PropertyKey, unknown>)[name];
      if (typeof method !== "function") {
        throw new Error(`Portable value has no ${expression.method} method.`);
      }
      return await Reflect.apply(method, receiver, arguments_);
    }
    case "json-parse": {
      const value = await evaluate(expression.value, locals, capabilities, calls, functions);
      if (typeof value !== "string") throw new Error("JSON.parse requires a string.");
      return JSON.parse(value);
    }
    case "json-stringify": {
      const value = await evaluate(expression.value, locals, capabilities, calls, functions);
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new Error("JSON.stringify produced no value.");
      return serialized;
    }
    case "to-string":
      return String(await evaluate(expression.value, locals, capabilities, calls, functions));
    case "stream-map": {
      const source = await evaluate(expression.source, locals, capabilities, calls, functions);
      const transform = await evaluate(
        expression.transform,
        locals,
        capabilities,
        calls,
        functions,
      );
      if (!isAsyncIterable(source)) throw new Error("mapStream requires an asynchronous stream.");
      const run = async (value: unknown) => {
        if (typeof transform === "function") return Reflect.apply(transform, undefined, [value]);
        if (!isPortableClosure(transform)) {
          throw new Error("mapStream requires a portable transform.");
        }
        const function_ = functions.get(transform.function);
        if (!function_) throw new Error(`Unknown portable function ${transform.function}.`);
        return executePortableFunction(
          function_,
          transform.captures,
          [value],
          capabilities,
          calls,
          functions,
        );
      };
      return {
        [Symbol.asyncIterator]() {
          const iterator = source[Symbol.asyncIterator]();
          return {
            async next() {
              const next = await iterator.next();
              if (next.done) return { done: true as const, value: undefined };
              return {
                done: false as const,
                value: await run(next.value),
              };
            },
            async return() {
              await iterator.return?.();
              return { done: true as const, value: undefined };
            },
          };
        },
      };
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
      const result = Reflect.apply(
        operation,
        capability,
        arguments_.map((argument) =>
          materializeCapabilityValue(argument, capabilities, calls, functions),
        ),
      );
      if (expression.awaited) return await result;
      return result;
    }
  }
}

function materializeCapabilityValue(
  value: unknown,
  capabilities: CapabilityImplementations,
  calls: CapabilityCallTrace[],
  functions: ReadonlyMap<string, FunctionIR>,
): unknown {
  if (isPortableClosure(value)) {
    const function_ = functions.get(value.function);
    if (!function_) throw new Error(`Unknown portable function ${value.function}.`);
    return (...arguments_: readonly unknown[]) =>
      executePortableFunction(
        function_,
        value.captures,
        arguments_,
        capabilities,
        calls,
        functions,
      );
  }
  if (Array.isArray(value)) {
    return value.map((item) => materializeCapabilityValue(item, capabilities, calls, functions));
  }
  if (isRecord(value) && !isAsyncIterable(value)) {
    return Object.fromEntries(
      Reflect.ownKeys(value).map((name) => [
        typeof name === "string" ? wellKnownProperty(name) : name,
        materializeCapabilityValue(Reflect.get(value, name), capabilities, calls, functions),
      ]),
    );
  }
  return value;
}

function wellKnownProperty(name: string): PropertyKey {
  if (name === "@dispose") return Symbol.dispose;
  if (name === "@asyncDispose") return Symbol.asyncDispose;
  if (name === "@asyncIterator") return Symbol.asyncIterator;
  return name;
}

function normalizePortableRecord<Value extends Record<PropertyKey, unknown>>(value: Value): Value {
  const create = value[Symbol.asyncIterator];
  if (typeof create === "function") {
    Reflect.set(value, Symbol.asyncIterator, () => {
      const pending = Promise.resolve(Reflect.apply(create, value, []));
      return {
        async next() {
          const iterator = await pending;
          return iterator.next();
        },
        async return() {
          const iterator = await pending;
          return iterator.return?.() ?? { done: true as const, value: undefined };
        },
      };
    });
  }
  return value;
}

async function disposePortableResources(resources: readonly unknown[]): Promise<void> {
  const errors: unknown[] = [];
  for (const value of [...resources].reverse()) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) continue;
    const resource = value as Partial<Disposable & AsyncDisposable>;
    try {
      const disposeAsync = resource[Symbol.asyncDispose];
      const dispose = resource[Symbol.dispose];
      if (typeof disposeAsync === "function") {
        await disposeAsync.call(resource);
      } else if (typeof dispose === "function") {
        await Promise.resolve(dispose.call(resource));
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Portable Program disposal failed.");
  }
}

async function executePortableFunction(
  function_: FunctionIR,
  captures: readonly (PortableCell | unknown)[],
  arguments_: readonly unknown[],
  capabilities: CapabilityImplementations,
  calls: CapabilityCallTrace[],
  functions: ReadonlyMap<string, FunctionIR>,
): Promise<unknown> {
  const locals: PortableLocals = new Map();
  for (const [index, capture] of function_.captures.entries()) {
    const value = captures[index];
    locals.set(capture.name, isPortableCell(value) ? value : { value });
  }
  for (const [index, parameter] of function_.parameters.entries()) {
    locals.set(parameter.name, { value: arguments_[index] });
  }
  try {
    const completion = await executeStatements(
      function_.body,
      locals,
      capabilities,
      calls,
      functions,
    );
    return completion.value;
  } catch (error) {
    if (error instanceof Error) {
      error.message =
        `${function_.span.file}:${function_.span.line}:${function_.span.column} ` +
        `(${function_.name}): ${error.message}`;
    }
    throw error;
  }
}

function isPortableCell(value: unknown): value is PortableCell {
  return Boolean(value && typeof value === "object" && Object.hasOwn(value, "value"));
}

function isPortableClosure(value: unknown): value is PortableClosure {
  return isRecord(value) && typeof value.function === "string" && Array.isArray(value.captures);
}

function assign(operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=", left: unknown, right: unknown) {
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
    case "??=":
      return left ?? right;
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

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
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
