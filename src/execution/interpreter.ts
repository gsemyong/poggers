import {
  assertSystemIRVersion,
  projectDependencyContracts,
  type ExpressionIR,
  type FunctionIR,
  type SystemIR,
  type LinkedProgramIR,
  type PortableProgramExecutionIR,
  type ProgramContributionIR,
  type StatementIR,
} from "@/compiler/ir";
import { dataKind } from "@/core/data";
import {
  dependencyInvocation,
  dependencyInvocationControl,
  dependencyReferenceInstance,
  forwardDependencyCancellation,
  invokeDependency,
  type DependencyCancellation,
  type DependencyInvocationControl,
  type DependencyInvocation,
} from "@/core/dependency";
import {
  activateProgramDistribution,
  conformExternalDependencies,
  createDeferredDependencyBinding,
  type DeferredDependencyBinding,
  type ProgramDistribution,
  type ProgramDistributionFactory,
} from "@/execution/process";

export type DependencyImplementations = Readonly<
  Record<string, Readonly<Record<string, (...arguments_: never[]) => unknown>>>
>;

export type LinkedProgramExecution = AsyncDisposable &
  Readonly<{
    dependencies: Readonly<Record<string, unknown>>;
  }>;

export type ExecutionTrace = Readonly<{
  calls: readonly DependencyCallTrace[];
  result: unknown;
}>;

export type PortableFunctionExecution = Readonly<{
  entry: FunctionIR;
  functions?: readonly FunctionIR[];
  arguments?: readonly unknown[];
  dependencies?: DependencyImplementations;
}>;

/** Procedural meaning selected by a Program-language extension for portable execution. */
export type PortableProgramProjection = (
  contribution: ProgramContributionIR,
  program: LinkedProgramIR["program"],
) => PortableProgramExecutionIR;

export type DependencyCallTrace = Readonly<{
  dependency: string;
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

const stablePortableClosures = new WeakMap<
  ReadonlyMap<string, FunctionIR>,
  Map<string, (...arguments_: readonly unknown[]) => Promise<unknown>>
>();
const directInvocationScopes = new WeakMap<DependencyCallTrace[], string>();

/** Executes the portable process body represented by the typed IR. */
export async function executeProgramIR(
  ir: SystemIR,
  programId: string,
  dependencies: DependencyImplementations,
  project: PortableProgramProjection,
): Promise<ExecutionTrace> {
  assertSystemIRVersion(ir);
  const owner = ir.programs.find(({ contributions }) =>
    contributions.some(({ id }) => id === programId),
  );
  const contribution = owner?.contributions.find(({ id }) => id === programId);
  if (!owner || !contribution) throw new Error(`Unknown Program ${JSON.stringify(programId)}.`);
  return executeProgramContributionIR(contribution, project(contribution, owner), dependencies);
}

export async function executeProgramContributionIR(
  program: ProgramContributionIR,
  execution: PortableProgramExecutionIR,
  dependencies: DependencyImplementations,
): Promise<ExecutionTrace> {
  const contracts = projectDependencyContracts(program.requires);
  const mounted = conformExternalDependencies(contracts, dependencies) as DependencyImplementations;
  if (execution.kind !== "portable") {
    throw new Error(`Program ${JSON.stringify(program.id)} is ${execution.kind}, not portable IR.`);
  }

  const calls: DependencyCallTrace[] = [];
  const locals: PortableLocals = new Map([["dependencies", { value: mounted }]]);
  const functions = new Map(execution.functions.map((function_) => [function_.id, function_]));
  try {
    const completion = await executeStatements(
      execution.entry.body,
      locals,
      mounted,
      calls,
      functions,
    );
    return {
      calls,
      result: materializeDependencyValue(completion.value, mounted, calls, functions),
    };
  } catch (error) {
    if (error && typeof error === "object") {
      Object.defineProperty(error, portableCalls, { value: [...calls] });
    }
    throw error;
  }
}

/** Executes one lowered portable function through the canonical TypeScript reference backend. */
export async function executePortableFunctionIR(
  input: PortableFunctionExecution,
): Promise<ExecutionTrace> {
  const dependencies = input.dependencies ?? {};
  const calls: DependencyCallTrace[] = [];
  const functions = new Map<string, FunctionIR>();
  for (const function_ of [input.entry, ...(input.functions ?? [])]) {
    if (functions.has(function_.id)) {
      throw new Error(`Duplicate portable function ${JSON.stringify(function_.id)}.`);
    }
    functions.set(function_.id, function_);
  }
  try {
    const result = await executePortableFunction(
      input.entry,
      [],
      input.arguments ?? [],
      dependencies,
      calls,
      functions,
    );
    return {
      calls,
      result: materializeDependencyValue(result, dependencies, calls, functions),
    };
  } catch (error) {
    if (error && typeof error === "object") {
      Object.defineProperty(error, portableCalls, { value: [...calls] });
    }
    throw error;
  }
}

/** Executes every portable contribution through the canonical linked Dependency graph. */
export async function executeLinkedProgramIR(
  linked: LinkedProgramIR,
  external: DependencyImplementations,
  project: PortableProgramProjection,
  options: Readonly<{ distribute?: ProgramDistributionFactory }> = {},
): Promise<LinkedProgramExecution> {
  const expected = linked.external.map(({ name }) => name).sort();
  const supplied = Object.keys(external).sort();
  if (expected.join("\n") !== supplied.join("\n")) {
    const missing = expected.filter((name) => !supplied.includes(name));
    const excess = supplied.filter((name) => !expected.includes(name));
    throw new Error(
      `Program ${JSON.stringify(linked.program.name)} external Dependencies are invalid` +
        `${missing.length ? `; missing: ${missing.join(", ")}` : ""}` +
        `${excess.length ? `; unexpected: ${excess.join(", ")}` : ""}.`,
    );
  }

  const dependencies: Record<string, unknown> = Object.assign(Object.create(null), external);
  const deferred = new Map<string, DeferredDependencyBinding>();
  for (const dependency of linked.dependencies) {
    if (dependency.provider === undefined) continue;
    const binding = createDeferredDependencyBinding(dependency.name);
    deferred.set(dependency.name, binding);
    dependencies[dependency.name] = binding.dependency;
  }
  const resources: unknown[] = [];
  const providers: Record<string, unknown> = Object.create(null);
  let distribution: ProgramDistribution | undefined;
  try {
    for (const { contribution } of linked.contributions) {
      const implementation = project(contribution, linked.program);
      if (implementation.kind === "none") continue;
      if (implementation.kind !== "portable") {
        throw new Error(
          `${contribution.span.file}:${contribution.span.line}:${contribution.span.column}: ` +
            `Program contribution ${JSON.stringify(contribution.id)} is source, not portable IR.`,
        );
      }
      const required = Object.fromEntries(
        contribution.requires.map(({ name }) => [name, dependencies[name]]),
      ) as DependencyImplementations;
      const execution = await executeProgramContributionIR(contribution, implementation, required);
      if (!contribution.provides.length) {
        if (execution.result !== undefined) resources.push(execution.result);
        continue;
      }
      if (!isRecord(execution.result)) {
        throw new Error(
          `Program contribution ${JSON.stringify(contribution.id)} must return its declared ` +
            "Dependency object.",
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
      const providerContracts = projectDependencyContracts(contribution.provides);
      const mounted = conformExternalDependencies(providerContracts, execution.result);
      for (const name of declared) {
        const dependency = mounted[name];
        deferred.get(name)?.bind(dependency as object);
        providers[name] = dependency;
        resources.push(dependency);
      }
    }
    if (options.distribute) {
      const contracts = projectDependencyContracts(
        linked.dependencies.filter(
          ({ provider, reference }) => provider !== undefined && reference !== undefined,
        ),
      );
      distribution = await activateProgramDistribution(
        options.distribute,
        linked.program.name,
        contracts,
        Object.freeze({ ...providers }),
        (name, dependency) => deferred.get(name)?.replace(dependency),
      );
    }
  } catch (error) {
    await distribution?.drain().catch(() => undefined);
    await disposePortableResources(resources).catch(() => undefined);
    throw error;
  }

  let disposed = false;
  return {
    dependencies: Object.freeze({ ...dependencies }),
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      try {
        await distribution?.drain();
      } catch (error) {
        errors.push(error);
      }
      try {
        await disposePortableResources(resources);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(
          errors,
          `Portable Program ${JSON.stringify(linked.program.name)} disposal failed.`,
        );
      }
    },
  };
}

/** Runs one deterministic fixture through the reference backend using generated Dependency doubles. */
export async function executeProgramFixtureIR(
  ir: SystemIR,
  programId: string,
  scenario: ExecutionScenario,
  project: PortableProgramProjection,
): Promise<Readonly<{ calls: readonly DependencyCallTrace[]; result: unknown }>> {
  const program = ir.programs
    .flatMap(({ contributions }) => contributions)
    .find(({ id }) => id === programId);
  if (!program) throw new Error(`Unknown Program ${JSON.stringify(programId)}.`);
  const pending = new Map(
    Object.entries(scenario.responses).map(([key, values]) => [key, [...values]]),
  );
  const dependencies: Record<
    string,
    Record<string, (...arguments_: readonly unknown[]) => unknown>
  > = Object.create(null) as Record<
    string,
    Record<string, (...arguments_: readonly unknown[]) => unknown>
  >;
  for (const dependency of program.requires) {
    if (dependency.type.kind !== "record") continue;
    const implementation: Record<string, (...arguments_: readonly unknown[]) => unknown> =
      Object.create(null) as Record<string, (...arguments_: readonly unknown[]) => unknown>;
    for (const operation of dependency.type.fields) {
      if (operation.type.kind !== "function") continue;
      const key = `${dependency.name}.${operation.name}`;
      const output =
        operation.type.result.kind === "promise"
          ? operation.type.result.value
          : operation.type.result.kind === "stream"
            ? operation.type.result.element
            : operation.type.result;
      const respond = () => {
        const response = pending.get(key)?.shift();
        if (!response) throw new Error(`missing fixture response for ${key}`);
        if ("error" in response) {
          throw new FixtureDependencyError(response.error.message, response.error.data);
        }
        return output.kind === "primitive" && output.name === "void" && response.ok === null
          ? undefined
          : response.ok;
      };
      implementation[operation.name] =
        operation.type.result.kind === "promise" ? async () => respond() : () => respond();
    }
    dependencies[dependency.name] = implementation;
  }
  try {
    const trace = await executeProgramIR(ir, programId, dependencies, project);
    return {
      calls: canonicalPortableValue(trace.calls) as readonly DependencyCallTrace[],
      result: { ok: canonicalPortableValue(trace.result ?? null) },
    };
  } catch (error) {
    return {
      calls: canonicalPortableValue(
        error && typeof error === "object" && portableCalls in error
          ? ((error as { [portableCalls]: readonly DependencyCallTrace[] })[portableCalls] ?? [])
          : [],
      ) as readonly DependencyCallTrace[],
      result: {
        error: {
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof FixtureDependencyError && error.data !== undefined
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

const portableCalls = Symbol("kit.portable.calls");
const portableDependencyReference = Symbol("kit.portable.dependency-reference");

type PortableDependencyReference = Readonly<{
  [portableDependencyReference]: true;
  dependency: string;
  binding: Readonly<Record<string, unknown>>;
}>;

class FixtureDependencyError extends Error {
  readonly data: unknown;

  constructor(message: string, data: unknown) {
    super(message);
    this.name = "FixtureDependencyError";
    this.data = data;
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
  dependencies: DependencyImplementations,
  calls: DependencyCallTrace[],
  functions: ReadonlyMap<string, FunctionIR>,
): Promise<Completion> {
  for (const statement of statements) {
    switch (statement.kind) {
      case "let":
        locals.set(statement.name, {
          value: await evaluate(statement.value, locals, dependencies, calls, functions),
        });
        break;
      case "assign": {
        const current = locals.get(statement.name);
        if (!current) throw new Error(`Unknown portable binding ${statement.name}.`);
        const value = await evaluate(statement.value, locals, dependencies, calls, functions);
        current.value = assign(statement.operator, current.value, value);
        break;
      }
      case "property-assign": {
        const target = await evaluate(statement.target, locals, dependencies, calls, functions);
        if (!target || (typeof target !== "object" && typeof target !== "function")) {
          throw new TypeError(`Cannot assign property ${JSON.stringify(statement.property)}.`);
        }
        const value = await evaluate(statement.value, locals, dependencies, calls, functions);
        const current = Reflect.get(target, statement.property);
        if (!Reflect.set(target, statement.property, assign(statement.operator, current, value))) {
          throw new TypeError(`Cannot assign property ${JSON.stringify(statement.property)}.`);
        }
        break;
      }
      case "index-assign": {
        const target = await evaluate(statement.target, locals, dependencies, calls, functions);
        if (!target || (typeof target !== "object" && typeof target !== "function")) {
          throw new TypeError("Cannot assign computed property.");
        }
        const index = await evaluate(statement.index, locals, dependencies, calls, functions);
        if (typeof index !== "string" && typeof index !== "number") {
          throw new TypeError("Computed property must be a string or number.");
        }
        const value = await evaluate(statement.value, locals, dependencies, calls, functions);
        const current = Reflect.get(target, index);
        if (!Reflect.set(target, index, assign(statement.operator, current, value))) {
          throw new TypeError(`Cannot assign property ${JSON.stringify(index)}.`);
        }
        break;
      }
      case "expression":
        await evaluate(statement.expression, locals, dependencies, calls, functions);
        break;
      case "array-push": {
        const array = locals.get(statement.array)?.value;
        if (!Array.isArray(array)) throw new Error(`${statement.array} is not an array.`);
        array.push(await evaluate(statement.value, locals, dependencies, calls, functions));
        break;
      }
      case "throw":
        throw await evaluate(statement.value, locals, dependencies, calls, functions);
      case "if": {
        const branch = boolean(
          await evaluate(statement.condition, locals, dependencies, calls, functions),
        )
          ? statement.consequent
          : statement.alternate;
        const completion = await executeStatements(branch, locals, dependencies, calls, functions);
        if (completion.returned) return completion;
        break;
      }
      case "for-of": {
        const values = await evaluate(statement.values, locals, dependencies, calls, functions);
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
              dependencies,
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
            dependencies,
            calls,
            functions,
          );
          if (completion.returned) return completion;
        }
        break;
      }
      case "for-range": {
        const from = number(await evaluate(statement.from, locals, dependencies, calls, functions));
        const to = number(await evaluate(statement.to, locals, dependencies, calls, functions));
        for (let value = from; value < to; value += 1) {
          locals.set(statement.item, { value });
          const completion = await executeStatements(
            statement.body,
            locals,
            dependencies,
            calls,
            functions,
          );
          if (completion.returned) return completion;
        }
        break;
      }
      case "while": {
        while (
          boolean(await evaluate(statement.condition, locals, dependencies, calls, functions))
        ) {
          const completion = await executeStatements(
            statement.body,
            locals,
            dependencies,
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
            dependencies,
            calls,
            functions,
          );
        } catch (error) {
          if (!statement.catch) throw error;
          if (statement.catch.error) locals.set(statement.catch.error, { value: error });
          completion = await executeStatements(
            statement.catch.body,
            locals,
            dependencies,
            calls,
            functions,
          );
        } finally {
          const finalized = await executeStatements(
            statement.finally,
            locals,
            dependencies,
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
                value: await evaluate(statement.value, locals, dependencies, calls, functions),
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
  dependencies: DependencyImplementations,
  calls: DependencyCallTrace[],
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
            evaluate(argument, locals, dependencies, calls, functions),
          ),
        ),
        fields: Object.fromEntries(
          await Promise.all(
            expression.fields.map(async ({ name, value }) => [
              name,
              await evaluate(value, locals, dependencies, calls, functions),
            ]),
          ),
        ),
      });
    case "error-match": {
      const value = await evaluate(expression.value, locals, dependencies, calls, functions);
      return (
        value instanceof Error && (expression.name === "Error" || value.name === expression.name)
      );
    }
    case "local":
      if (!locals.has(expression.name))
        throw new Error(`Unknown portable binding ${expression.name}.`);
      return locals.get(expression.name)!.value;
    case "array":
      return Promise.all(
        expression.values.map((value) => evaluate(value, locals, dependencies, calls, functions)),
      );
    case "record":
      return normalizePortableRecord(
        Object.fromEntries(
          await Promise.all(
            expression.fields.map(async ({ name, value }) => [
              wellKnownProperty(name),
              await evaluate(value, locals, dependencies, calls, functions),
            ]),
          ),
        ),
      );
    case "record-merge": {
      const result: Record<string, unknown> = {};
      for (const entry of expression.entries) {
        const value = await evaluate(entry.value, locals, dependencies, calls, functions);
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
      const value = await evaluate(expression.value, locals, dependencies, calls, functions);
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
    case "index": {
      const value = await evaluate(expression.value, locals, dependencies, calls, functions);
      const index = await evaluate(expression.index, locals, dependencies, calls, functions);
      if (
        !value ||
        (typeof value !== "object" && typeof value !== "string") ||
        (typeof index !== "string" && typeof index !== "number")
      ) {
        throw new Error("Portable indexing requires a record, array, or string and a key.");
      }
      return (value as Readonly<Record<PropertyKey, unknown>>)[index];
    }
    case "unary": {
      const value = await evaluate(expression.value, locals, dependencies, calls, functions);
      if (expression.operator === "present") return value !== undefined && value !== null;
      return expression.operator === "!" ? !boolean(value) : -number(value);
    }
    case "binary": {
      const left = await evaluate(expression.left, locals, dependencies, calls, functions);
      if (expression.operator === "&&" && !boolean(left)) return false;
      if (expression.operator === "||" && boolean(left)) return true;
      return binary(
        expression.operator,
        left,
        await evaluate(expression.right, locals, dependencies, calls, functions),
      );
    }
    case "conditional":
      return boolean(await evaluate(expression.condition, locals, dependencies, calls, functions))
        ? evaluate(expression.consequent, locals, dependencies, calls, functions)
        : evaluate(expression.alternate, locals, dependencies, calls, functions);
    case "concurrent": {
      const operations = expression.values.map((value) =>
        evaluate(value, locals, dependencies, calls, functions),
      );
      if (expression.operation === "all") return Promise.all(operations);
      if (expression.operation === "race") return Promise.race(operations);
      return Promise.allSettled(operations);
    }
    case "closure": {
      const function_ = functions.get(expression.function);
      if (!function_) throw new Error(`Unknown portable function ${expression.function}.`);
      const stable = expression.stable
        ? (stablePortableClosures.get(functions) ?? new Map())
        : undefined;
      if (expression.stable && !stablePortableClosures.has(functions)) {
        stablePortableClosures.set(functions, stable!);
      }
      const existing = stable?.get(expression.function);
      if (existing) return existing;
      const captures = await Promise.all(
        expression.captures.map(async (capture): Promise<PortableCell> => {
          if (capture.kind === "local") {
            const cell = locals.get(capture.name);
            if (!cell) throw new Error(`Unknown portable binding ${capture.name}.`);
            return cell;
          }
          return { value: await evaluate(capture, locals, dependencies, calls, functions) };
        }),
      );
      const closure = (...arguments_: readonly unknown[]) =>
        executePortableFunction(function_, captures, arguments_, dependencies, calls, functions);
      stable?.set(expression.function, closure);
      return closure;
    }
    case "call": {
      const function_ = functions.get(expression.function);
      if (!function_) throw new Error(`Unknown portable function ${expression.function}.`);
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, dependencies, calls, functions),
        ),
      );
      return executePortableFunction(function_, [], arguments_, dependencies, calls, functions);
    }
    case "invoke": {
      const closure = await evaluate(expression.callee, locals, dependencies, calls, functions);
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, dependencies, calls, functions),
        ),
      );
      if (typeof closure === "function") return Reflect.apply(closure, undefined, arguments_);
      if (!isPortableClosure(closure))
        throw new Error(
          `Portable invocation target is not a function: ${JSON.stringify(closure)}.`,
        );
      const function_ = functions.get(closure.function);
      if (!function_) throw new Error(`Unknown portable function ${closure.function}.`);
      return executePortableFunction(
        function_,
        closure.captures,
        arguments_,
        dependencies,
        calls,
        functions,
      );
    }
    case "method-call": {
      const receiver = await evaluate(expression.receiver, locals, dependencies, calls, functions);
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, dependencies, calls, functions),
        ),
      );
      const invokeCallback = async (
        callback: unknown,
        values: readonly unknown[],
      ): Promise<unknown> => {
        if (typeof callback === "function") {
          return await Reflect.apply(callback, undefined, values);
        }
        if (!isPortableClosure(callback)) {
          throw new Error(`Array.${expression.method} requires a portable closure.`);
        }
        const function_ = functions.get(callback.function);
        if (!function_) throw new Error(`Unknown portable function ${callback.function}.`);
        return await executePortableFunction(
          function_,
          callback.captures,
          values,
          dependencies,
          calls,
          functions,
        );
      };
      if (expression.method === "filter" && Array.isArray(receiver)) {
        const filtered: unknown[] = [];
        for (const value of receiver) {
          if (boolean(await invokeCallback(arguments_[0], [value]))) filtered.push(value);
        }
        return filtered;
      }
      if (expression.method === "findIndex" && Array.isArray(receiver)) {
        for (let index = 0; index < receiver.length; index += 1) {
          if (boolean(await invokeCallback(arguments_[0], [receiver[index]]))) return index;
        }
        return -1;
      }
      if (expression.method === "some" && Array.isArray(receiver)) {
        for (const value of receiver) {
          if (boolean(await invokeCallback(arguments_[0], [value]))) return true;
        }
        return false;
      }
      if (expression.method === "sort" && Array.isArray(receiver)) {
        const compare = arguments_[0];
        if (compare === undefined) return receiver.sort();
        for (let end = receiver.length - 1; end > 0; end -= 1) {
          for (let index = 0; index < end; index += 1) {
            const order = Number(
              await invokeCallback(compare, [receiver[index], receiver[index + 1]]),
            );
            if (order > 0) {
              const value = receiver[index];
              receiver[index] = receiver[index + 1];
              receiver[index + 1] = value;
            }
          }
        }
        return receiver;
      }
      if (expression.method === "find" && Array.isArray(receiver)) {
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
                dependencies,
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
      if (expression.method === "map" && Array.isArray(receiver)) {
        const transform = arguments_[0];
        if (typeof transform === "function") {
          return Promise.all(receiver.map((value) => Reflect.apply(transform, undefined, [value])));
        }
        if (!isPortableClosure(transform))
          throw new Error("Array.map requires a portable closure.");
        const function_ = functions.get(transform.function);
        if (!function_) throw new Error(`Unknown portable function ${transform.function}.`);
        return Promise.all(
          receiver.map((value) =>
            executePortableFunction(
              function_,
              transform.captures,
              [value],
              dependencies,
              calls,
              functions,
            ),
          ),
        );
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
            dependencies,
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
      const value = await evaluate(expression.value, locals, dependencies, calls, functions);
      if (typeof value !== "string") throw new Error("JSON.parse requires a string.");
      return JSON.parse(value);
    }
    case "json-stringify": {
      const value = await evaluate(expression.value, locals, dependencies, calls, functions);
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new Error("JSON.stringify produced no value.");
      return serialized;
    }
    case "object-keys": {
      const value = await evaluate(expression.value, locals, dependencies, calls, functions);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Object.keys requires a record.");
      }
      return Object.keys(value);
    }
    case "data-kind":
      return dataKind(await evaluate(expression.value, locals, dependencies, calls, functions));
    case "to-string":
      return String(await evaluate(expression.value, locals, dependencies, calls, functions));
    case "stream-map": {
      const source = await evaluate(expression.source, locals, dependencies, calls, functions);
      const transform = await evaluate(
        expression.transform,
        locals,
        dependencies,
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
          dependencies,
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
    case "stream-filter": {
      const source = await evaluate(expression.source, locals, dependencies, calls, functions);
      const predicate = await evaluate(
        expression.predicate,
        locals,
        dependencies,
        calls,
        functions,
      );
      if (!isAsyncIterable(source)) {
        throw new Error("filterStream requires an asynchronous stream.");
      }
      const run = async (value: unknown) => {
        if (typeof predicate === "function") return Reflect.apply(predicate, undefined, [value]);
        if (!isPortableClosure(predicate)) {
          throw new Error("filterStream requires a portable predicate.");
        }
        const function_ = functions.get(predicate.function);
        if (!function_) throw new Error(`Unknown portable function ${predicate.function}.`);
        return executePortableFunction(
          function_,
          predicate.captures,
          [value],
          dependencies,
          calls,
          functions,
        );
      };
      return {
        async *[Symbol.asyncIterator]() {
          for await (const value of source) {
            if (await run(value)) yield value;
          }
        },
      };
    }
    case "stream-distinct": {
      const source = await evaluate(expression.source, locals, dependencies, calls, functions);
      const select = await evaluate(expression.select, locals, dependencies, calls, functions);
      if (!isAsyncIterable(source))
        throw new Error("distinctStream requires an asynchronous stream.");
      const run = async (value: unknown) => {
        if (typeof select === "function") return Reflect.apply(select, undefined, [value]);
        if (!isPortableClosure(select)) {
          throw new Error("distinctStream requires a portable selector.");
        }
        const function_ = functions.get(select.function);
        if (!function_) throw new Error(`Unknown portable function ${select.function}.`);
        return executePortableFunction(
          function_,
          select.captures,
          [value],
          dependencies,
          calls,
          functions,
        );
      };
      return {
        async *[Symbol.asyncIterator]() {
          let previous: string | undefined;
          for await (const value of source) {
            const selected = JSON.stringify(await run(value));
            if (selected === previous) continue;
            previous = selected;
            yield value;
          }
        },
      };
    }
    case "dependency-call": {
      const dependency = dependencies[expression.dependency];
      if (!dependency) {
        throw new Error(
          `Missing Dependency operation ${expression.dependency}.${expression.operation}.`,
        );
      }
      const arguments_ = await Promise.all(
        expression.arguments.map((argument) =>
          evaluate(argument, locals, dependencies, calls, functions),
        ),
      );
      const options = expression.options
        ? await evaluate(expression.options, locals, dependencies, calls, functions)
        : undefined;
      const idempotencyKey = dependencyIdempotencyKey(
        options,
        `${expression.dependency}.${expression.operation}`,
      );
      calls.push({
        dependency: expression.dependency,
        operation: expression.operation,
        input: arguments_[0] ?? null,
      });
      const now = Date.now();
      const result = invokeDependency(
        dependency,
        expression.operation,
        materializeDependencyValue(arguments_[0], dependencies, calls, functions),
        {
          id:
            idempotencyKey === undefined
              ? directInvocationId(calls, expression.dependency, expression.operation)
              : `idempotency:${idempotencyKey}`,
          attempt: 1,
          scheduledAt: now,
          startedAt: now,
        },
      );
      if (expression.awaited) return await result;
      return result;
    }
    case "dependency-dispatch": {
      const dependency = await evaluate(
        expression.dependency,
        locals,
        dependencies,
        calls,
        functions,
      );
      const operation = await evaluate(
        expression.operation,
        locals,
        dependencies,
        calls,
        functions,
      );
      const input = await evaluate(expression.input, locals, dependencies, calls, functions);
      const options = expression.options
        ? await evaluate(expression.options, locals, dependencies, calls, functions)
        : undefined;
      if (
        dependency === null ||
        (typeof dependency !== "object" && typeof dependency !== "function") ||
        typeof operation !== "string"
      ) {
        throw new TypeError("Dynamic Dependency dispatch requires a Dependency and operation.");
      }
      calls.push({ dependency: "<dynamic>", operation, input });
      const result = invokeDependency(
        dependency,
        operation,
        materializeDependencyValue(input, dependencies, calls, functions),
        dependencyDispatchInvocation(options, operation, calls),
      );
      if (expression.awaited) return await result;
      return result;
    }
    case "dependency-intercept": {
      const dependency = await evaluate(
        expression.dependency,
        locals,
        dependencies,
        calls,
        functions,
      );
      const intercept = await evaluate(
        expression.intercept,
        locals,
        dependencies,
        calls,
        functions,
      );
      if (
        dependency === null ||
        (typeof dependency !== "object" && typeof dependency !== "function")
      ) {
        throw new TypeError("Dependency interception requires a Dependency.");
      }
      const invoke = (operation: string, input: unknown, options: unknown) => {
        if (typeof intercept === "function") {
          return Reflect.apply(intercept, undefined, [operation, input, options]);
        }
        if (!isPortableClosure(intercept)) {
          throw new TypeError("Dependency interception requires a portable interceptor.");
        }
        const function_ = functions.get(intercept.function);
        if (!function_) throw new Error(`Unknown portable function ${intercept.function}.`);
        return executePortableFunction(
          function_,
          intercept.captures,
          [operation, input, options],
          dependencies,
          calls,
          functions,
        );
      };
      const operationCache = new Map<string, (input: unknown, options?: unknown) => unknown>();
      return new Proxy(dependency, {
        get(target, property, receiver) {
          if (property === "then") return undefined;
          if (typeof property !== "string") return Reflect.get(target, property, receiver);
          const existing = operationCache.get(property);
          if (existing) return existing;
          const operation = (input: unknown, options?: unknown) => invoke(property, input, options);
          operationCache.set(property, operation);
          return operation;
        },
      });
    }
    case "dependency-reference": {
      const binding = await evaluate(expression.binding, locals, dependencies, calls, functions);
      if (!isRecord(binding)) {
        throw new TypeError("Dependency reference binding must be an object.");
      }
      return Object.freeze({
        [portableDependencyReference]: true as const,
        dependency: expression.dependency,
        binding: Object.freeze({ ...binding }),
      }) satisfies PortableDependencyReference;
    }
    case "dependency-reference-call": {
      const reference = await evaluate(
        expression.reference,
        locals,
        dependencies,
        calls,
        functions,
      );
      const input = expression.input
        ? await evaluate(expression.input, locals, dependencies, calls, functions)
        : undefined;
      const options = expression.options
        ? await evaluate(expression.options, locals, dependencies, calls, functions)
        : undefined;
      const operation =
        typeof expression.operation === "string"
          ? expression.operation
          : await evaluate(expression.operation, locals, dependencies, calls, functions);
      if (typeof operation !== "string") {
        throw new TypeError("Referenced Dependency operation must be a string.");
      }
      if (input !== undefined && !isRecord(input)) {
        throw new TypeError("Referenced Dependency product input must be an object.");
      }
      if (options !== undefined && !isRecord(options)) {
        throw new TypeError("Referenced Dependency call options must be an object.");
      }
      if (isRuntimeDependencyReference(reference)) {
        const method = Reflect.get(reference, operation);
        if (typeof method !== "function") {
          throw new TypeError(`Runtime Dependency reference has no method ${operation}.`);
        }
        const arguments_ =
          input === undefined
            ? options === undefined
              ? []
              : [materializeDependencyValue(options, dependencies, calls, functions)]
            : [
                materializeDependencyValue(input, dependencies, calls, functions),
                ...(options === undefined
                  ? []
                  : [materializeDependencyValue(options, dependencies, calls, functions)]),
              ];
        const result = Reflect.apply(method, reference, arguments_);
        if (expression.awaited) return await result;
        return result;
      }
      if (!isPortableDependencyReference(reference)) {
        const received =
          reference !== null && typeof reference === "object"
            ? Reflect.ownKeys(reference).map(String).join(", ")
            : typeof reference;
        throw new TypeError(
          `Referenced Dependency method ${operation} requires a Dependency reference; ` +
            `received ${received || "an empty object"}.`,
        );
      }
      const request = {
        ...options,
        ...reference.binding,
        ...(input !== undefined && { [expression.argument]: input }),
      };
      const dependency = dependencies[reference.dependency];
      if (!dependency) {
        throw new Error(`Missing Dependency operation ${reference.dependency}.${operation}.`);
      }
      calls.push({
        dependency: reference.dependency,
        operation,
        input: request,
      });
      const now = Date.now();
      const result = invokeDependency(
        dependency,
        operation,
        materializeDependencyValue(request, dependencies, calls, functions),
        {
          id: directInvocationId(calls, reference.dependency, operation),
          attempt: 1,
          scheduledAt: now,
          startedAt: now,
        },
      );
      if (expression.awaited) return await result;
      return result;
    }
  }
}

function dependencyIdempotencyKey(value: unknown, operation: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TypeError(`Dependency ${operation} call options must be an object.`);
  }
  const unknown = Reflect.ownKeys(value).find((name) => name !== "idempotencyKey");
  if (unknown !== undefined) {
    throw new TypeError(
      `Dependency ${operation} has unknown call option ${JSON.stringify(String(unknown))}.`,
    );
  }
  const key = value.idempotencyKey;
  if (key !== undefined && (typeof key !== "string" || !key)) {
    throw new TypeError(`Dependency ${operation} idempotencyKey must be a non-empty string.`);
  }
  return key;
}

function dependencyDispatchInvocation(
  value: unknown,
  operation: string,
  calls: DependencyCallTrace[],
): DependencyInvocation {
  if (value !== undefined && !isRecord(value)) {
    throw new TypeError(`Dependency ${operation} dispatch options must be an object.`);
  }
  const options = value as Readonly<Record<string, unknown>> | undefined;
  const allowed = new Set([
    "attempt",
    "cancellation",
    "deadline",
    "heartbeat",
    "idempotencyKey",
    "previousHeartbeat",
    "scheduledAt",
    "startedAt",
  ]);
  const unknown = Reflect.ownKeys(options ?? {}).find(
    (name) => typeof name !== "string" || !allowed.has(name),
  );
  if (unknown !== undefined) {
    throw new TypeError(
      `Dependency ${operation} has unknown dispatch option ${JSON.stringify(String(unknown))}.`,
    );
  }
  const idempotencyKey = options?.idempotencyKey;
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !idempotencyKey)) {
    throw new TypeError(`Dependency ${operation} idempotencyKey must be a non-empty string.`);
  }
  const now = Date.now();
  const attempt = options?.attempt ?? 1;
  const scheduledAt = options?.scheduledAt ?? now;
  const startedAt = options?.startedAt ?? now;
  const deadline = options?.deadline;
  const heartbeat = options?.heartbeat;
  const cancellation = options?.cancellation;
  if (heartbeat !== undefined && typeof heartbeat !== "function") {
    throw new TypeError(`Dependency ${operation} heartbeat must be a function.`);
  }
  if (
    cancellation !== undefined &&
    (!isRecord(cancellation) ||
      typeof cancellation.requested !== "function" ||
      typeof cancellation.wait !== "function")
  ) {
    throw new TypeError(`Dependency ${operation} cancellation must be a cancellation signal.`);
  }
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new TypeError(`Dependency ${operation} attempt must be a positive safe integer.`);
  }
  if (
    typeof scheduledAt !== "number" ||
    !Number.isFinite(scheduledAt) ||
    typeof startedAt !== "number" ||
    !Number.isFinite(startedAt) ||
    (deadline !== undefined && (typeof deadline !== "number" || !Number.isFinite(deadline)))
  ) {
    throw new TypeError(`Dependency ${operation} dispatch time metadata must be finite.`);
  }
  const control: DependencyInvocationControl | undefined =
    options?.previousHeartbeat === undefined &&
    heartbeat === undefined &&
    cancellation === undefined
      ? undefined
      : {
          ...(options?.previousHeartbeat === undefined
            ? {}
            : { previousHeartbeat: options.previousHeartbeat }),
          async heartbeat(details) {
            if (typeof heartbeat === "function") {
              await Reflect.apply(heartbeat, undefined, [details]);
            }
          },
          cancellation: forwardDependencyCancellation(
            cancellation as DependencyCancellation | undefined,
          ),
        };
  return {
    id:
      idempotencyKey === undefined
        ? directInvocationId(calls, "<dynamic>", operation)
        : `idempotency:${idempotencyKey}`,
    attempt,
    scheduledAt,
    startedAt,
    ...(deadline === undefined ? {} : { deadline }),
    ...(control === undefined ? {} : { [dependencyInvocationControl]: control }),
  };
}

function directInvocationId(
  calls: DependencyCallTrace[],
  dependency: string,
  operation: string,
): string {
  let scope = directInvocationScopes.get(calls);
  if (scope === undefined) {
    scope = crypto.randomUUID();
    directInvocationScopes.set(calls, scope);
  }
  const sequence = calls.filter(({ dependency: name }) => name === dependency).length;
  return `direct:${scope}:${dependency}:${operation}:${sequence}`;
}

function isPortableDependencyReference(value: unknown): value is PortableDependencyReference {
  return Boolean(
    value &&
    typeof value === "object" &&
    portableDependencyReference in value &&
    typeof (value as Partial<PortableDependencyReference>).dependency === "string" &&
    isRecord((value as Partial<PortableDependencyReference>).binding),
  );
}

function isRuntimeDependencyReference(
  value: unknown,
): value is Readonly<Record<PropertyKey, unknown>> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    Reflect.get(value, dependencyReferenceInstance) === true
  );
}

function materializeDependencyValue(
  value: unknown,
  dependencies: DependencyImplementations,
  calls: DependencyCallTrace[],
  functions: ReadonlyMap<string, FunctionIR>,
): unknown {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    dependencyInvocation in value
  ) {
    return value;
  }
  if (isPortableClosure(value)) {
    const function_ = functions.get(value.function);
    if (!function_) throw new Error(`Unknown portable function ${value.function}.`);
    return (...arguments_: readonly unknown[]) =>
      executePortableFunction(
        function_,
        value.captures,
        arguments_,
        dependencies,
        calls,
        functions,
      );
  }
  if (Array.isArray(value)) {
    return value.map((item) => materializeDependencyValue(item, dependencies, calls, functions));
  }
  if (isRecord(value) && !isAsyncIterable(value)) {
    return Object.fromEntries(
      Reflect.ownKeys(value).map((name) => [
        typeof name === "string" ? wellKnownProperty(name) : name,
        materializeDependencyValue(Reflect.get(value, name), dependencies, calls, functions),
      ]),
    );
  }
  return value;
}

function wellKnownProperty(name: string): PropertyKey {
  if (name === "@dependencyInvocation") return dependencyInvocation;
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
  dependencies: DependencyImplementations,
  calls: DependencyCallTrace[],
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
  const completion = await executeStatements(
    function_.body,
    locals,
    dependencies,
    calls,
    functions,
  );
  return completion.value;
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
  if (typeof left === "function" || typeof right === "function") return left === right;
  if (
    (typeof left === "number" && typeof right === "number") ||
    (typeof left === "string" && typeof right === "string") ||
    (typeof left === "boolean" && typeof right === "boolean") ||
    left === undefined ||
    right === undefined ||
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
