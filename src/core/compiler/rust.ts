import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

import type {
  CapabilityIR,
  ExpressionIR,
  FieldIR,
  FunctionIR,
  ProgramContributionIR,
  StatementIR,
  TypeIR,
} from "@/core/compiler/ir";

export type RustProgramSource = Readonly<{
  name: string;
  manifest: string;
  source: string;
}>;

/** Generates a standalone, statically typed Rust conformance host from one portable Program. */
export function generateRustProgram(program: ProgramContributionIR): RustProgramSource {
  if (program.implementation.kind !== "portable") {
    const detail =
      program.implementation.kind === "source" && program.implementation.diagnostic
        ? ` ${program.implementation.diagnostic.message}`
        : "";
    throw new Error(
      `Program ${JSON.stringify(program.id)} has no portable implementation.${detail}`,
    );
  }
  const generator = new RustGenerator(program);
  const source = generator.generate();
  const name = `poggers_${stableHash(source)}`;
  return {
    name,
    manifest: `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2024"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n`,
    source,
  };
}

/** Generates the production executable form. Capability-bearing Programs need an adapter first. */
export function generateRustProductionProgram(program: ProgramContributionIR): RustProgramSource {
  if (program.implementation.kind !== "portable") {
    throw new Error(`Program ${JSON.stringify(program.id)} has no portable implementation.`);
  }
  if (program.requires.length) {
    throw new Error(
      `Program ${JSON.stringify(program.id)} requires a native Capability adapter for ${program.requires
        .map(({ name }) => name)
        .join(", ")}.`,
    );
  }
  const generator = new RustGenerator(program);
  const source = generator.generateProduction();
  const name = `poggers_${stableHash(source)}`;
  return {
    name,
    manifest: `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2024"\n`,
    source,
  };
}

/** Compiles generated Rust in an OS temporary directory and copies out only the executable. */
export async function buildRustProgram(
  program: ProgramContributionIR,
  output: string,
): Promise<string> {
  const generated = generateRustProgram(program);
  return buildGeneratedRust(generated, output);
}

async function buildGeneratedRust(generated: RustProgramSource, output: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-rust-"));
  const target = resolve(tmpdir(), "poggers-rust-target-v1");
  try {
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(resolve(directory, "Cargo.toml"), generated.manifest);
    await writeFile(resolve(directory, "src/main.rs"), generated.source);
    const format = await command("cargo", ["fmt", "--all"], directory);
    if (format.code !== 0) throw new Error(`Generated Rust formatting failed:\n${format.stderr}`);
    const formatCheck = await command("cargo", ["fmt", "--all", "--", "--check"], directory);
    if (formatCheck.code !== 0) {
      throw new Error(`Generated Rust is not stable after formatting:\n${formatCheck.stderr}`);
    }
    const lint = await command(
      "cargo",
      ["clippy", "--release", "--quiet", "--", "-D", "warnings"],
      directory,
      undefined,
      { ...process.env, CARGO_TARGET_DIR: target },
    );
    if (lint.code !== 0) {
      throw new Error(`Generated Rust failed linting:\n${lint.stderr || lint.stdout}`);
    }
    const tests = await command("cargo", ["test", "--release", "--quiet"], directory, undefined, {
      ...process.env,
      CARGO_TARGET_DIR: target,
    });
    if (tests.code !== 0) {
      throw new Error(`Generated Rust tests failed:\n${tests.stderr || tests.stdout}`);
    }
    const result = await command("cargo", ["build", "--release", "--quiet"], directory, undefined, {
      ...process.env,
      CARGO_TARGET_DIR: target,
    });
    if (result.code !== 0) {
      throw new Error(`Generated Rust failed to build:\n${result.stderr || result.stdout}`);
    }
    await mkdir(dirname(output), { recursive: true });
    await copyFile(resolve(target, "release", generated.name), output);
    await chmod(output, 0o755);
    return output;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export async function runRustProgram(executable: string, scenario: unknown): Promise<unknown> {
  const result = await command(
    executable,
    [],
    dirname(executable),
    `${JSON.stringify(scenario)}\n`,
  );
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

/** Keeps the native conformance host alive across a property suite. */
export async function createRustProgramSession(
  executable: string,
): Promise<AsyncDisposable & Readonly<{ run(scenario: unknown): Promise<unknown> }>> {
  const child = spawn(executable, [], { cwd: dirname(executable), stdio: "pipe" });
  const lines = createInterface({ input: child.stdout });
  const pending: Array<{
    resolve(value: unknown): void;
    reject(error: unknown): void;
  }> = [];
  let stderr = "";
  let closed: unknown;
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  lines.on("line", (line) => {
    const request = pending.shift();
    if (!request) return;
    try {
      request.resolve(JSON.parse(line));
    } catch (error) {
      request.reject(error);
    }
  });
  child.once("error", (error) => {
    closed = error;
    for (const request of pending.splice(0)) request.reject(error);
  });
  child.once("exit", (code) => {
    if (code === 0) return;
    closed = new Error(stderr || `Native conformance host exited with ${code}.`);
    for (const request of pending.splice(0)) request.reject(closed);
  });
  return {
    run(scenario) {
      if (closed) return Promise.reject(closed);
      return new Promise((resolvePromise, reject) => {
        pending.push({ resolve: resolvePromise, reject });
        child.stdin.write(`${JSON.stringify(scenario)}\n`);
      });
    },
    async [Symbol.asyncDispose]() {
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) {
        await new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
      }
      lines.close();
    },
  };
}

class RustGenerator {
  readonly #program: ProgramContributionIR;
  readonly #types = new RustTypes();
  readonly #capabilities = new Map<string, CapabilityIR>();
  readonly #functions = new Map<string, FunctionIR>();

  constructor(program: ProgramContributionIR) {
    if (program.implementation.kind !== "portable") throw new Error("Expected portable Program.");
    this.#program = program;
    for (const capability of program.requires) this.#capabilities.set(capability.name, capability);
    for (const function_ of program.implementation.functions) {
      this.#functions.set(function_.id, function_);
    }
    this.#registerProgramTypes(program);
  }

  generate(): string {
    if (this.#program.implementation.kind !== "portable")
      throw new Error("Expected portable Program.");
    const operations = this.#capabilityOperations();
    const capabilityMethods = operations.map((operation) => this.#capabilityMethod(operation));
    const fixtureMethods = operations.map((operation) => this.#fixtureMethod(operation));
    const helpers = this.#program.implementation.functions.map((function_) =>
      this.#function(function_, false),
    );
    const start = this.#function(this.#program.implementation.start, true);
    const fixture = operations.length
      ? `#[derive(Deserialize)]
struct Scenario { #[serde(default)] responses: HashMap<String, VecDeque<Response>> }

#[derive(Deserialize)]
#[serde(untagged)]
enum Response {
    Ok { ok: Value },
    Error { error: FixtureFailure },
}

#[derive(Deserialize)]
struct FixtureFailure { message: String, #[serde(default)] data: Option<Value> }

struct FixtureCapabilities {
    responses: HashMap<String, VecDeque<Response>>,
    calls: Vec<Value>,
}

impl FixtureCapabilities {
    fn response<T: for<'de> Deserialize<'de>>(&mut self, key: &str) -> Result<T, CapabilityError> {
        let response = self.responses.get_mut(key).and_then(VecDeque::pop_front)
            .ok_or_else(|| CapabilityError { message: format!("missing fixture response for {key}"), data: None })?;
        match response {
            Response::Ok { ok } => serde_json::from_value(ok)
                .map_err(|error| CapabilityError { message: error.to_string(), data: None }),
            Response::Error { error } => Err(CapabilityError { message: error.message, data: error.data }),
        }
    }
}

impl Capabilities for FixtureCapabilities {
${fixtureMethods.join("\n")}
}`
      : `#[derive(Deserialize)]
struct Scenario {}

struct FixtureCapabilities { calls: Vec<Value> }

impl Capabilities for FixtureCapabilities {}`;
    const fixtureInitialization = operations.length
      ? `let scenario: Scenario = serde_json::from_str(&line).expect("parse scenario");
        let mut capabilities = FixtureCapabilities { responses: scenario.responses, calls: Vec::new() };`
      : `let _scenario: Scenario = serde_json::from_str(&line).expect("parse scenario");
        let mut capabilities = FixtureCapabilities { calls: Vec::new() };`;
    return `// Generated by Poggers IR v10. Do not edit.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
${operations.length ? "use std::collections::{HashMap, VecDeque};" : ""}
use std::io::{self, BufRead, Write};

${this.#types.declarations()}

${this.#types.canonicalRuntime()}

${numericRuntime(this.#program)}

#[derive(Debug, Clone, Serialize)]
struct CapabilityError { message: String, data: Option<Value> }

trait Capabilities {
${capabilityMethods.join("\n")}
}

${helpers.join("\n\n")}

${start}

${fixture}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line.expect("read scenario");
        if line.trim().is_empty() { continue; }
        ${fixtureInitialization}
        let outcome = start(&mut capabilities);
        let result = match outcome {
            Ok(value) => json!({ "ok": value.canonical() }),
            Err(error) => {
                let mut failure = json!({ "message": error.message });
                if let Some(data) = error.data { failure["data"] = data; }
                json!({ "error": failure })
            },
        };
        writeln!(stdout, "{}", json!({ "calls": capabilities.calls, "result": result })).expect("write result");
        stdout.flush().expect("flush result");
    }
}
`;
  }

  generateProduction(): string {
    if (this.#program.implementation.kind !== "portable")
      throw new Error("Expected portable Program.");
    const helpers = this.#program.implementation.functions.map((function_) =>
      this.#function(function_, false),
    );
    const start = this.#function(this.#program.implementation.start, true);
    const operations = this.#capabilityOperations();
    if (operations.length) {
      throw new Error("Production Capability implementations belong to a Platform Adapter.");
    }
    return `// Generated by Poggers IR v10. Do not edit.
${this.#types.declarations(false)}

${numericRuntime(this.#program)}

#[derive(Debug, Clone)]
struct CapabilityError { message: String }

trait Capabilities {
${operations.map((operation) => this.#capabilityMethod(operation)).join("\n")}
}

${helpers.join("\n\n")}

${start}

struct ProductionCapabilities;
impl Capabilities for ProductionCapabilities {}

fn main() {
    let mut capabilities = ProductionCapabilities;
    if let Err(error) = start(&mut capabilities) {
        eprintln!("{}", error.message);
        std::process::exit(1);
    }
}
`;
  }

  #registerProgramTypes(program: ProgramContributionIR): void {
    for (const operation of this.#capabilityOperations()) {
      for (const parameter of operation.function.parameters) this.#types.register(parameter.type);
      this.#types.register(unwrapPromise(operation.function.result));
    }
    if (program.implementation.kind !== "portable") return;
    this.#registerFunctionTypes(program.implementation.start);
    for (const function_ of program.implementation.functions)
      this.#registerFunctionTypes(function_);
  }

  #registerFunctionTypes(function_: FunctionIR): void {
    for (const parameter of function_.parameters) this.#types.register(parameter.type);
    this.#types.register(function_.result);
    const visitExpression = (expression: ExpressionIR): void => {
      switch (expression.kind) {
        case "array":
          expression.values.forEach(visitExpression);
          break;
        case "record":
          expression.fields.forEach(({ value }) => visitExpression(value));
          break;
        case "property":
        case "unary":
          visitExpression(expression.value);
          break;
        case "binary":
          visitExpression(expression.left);
          visitExpression(expression.right);
          break;
        case "call":
        case "capability-call":
          expression.arguments.forEach(visitExpression);
          break;
        case "literal":
        case "local":
          break;
      }
    };
    const visitStatements = (statements: readonly StatementIR[]): void => {
      for (const statement of statements) {
        if (statement.kind === "let") {
          this.#types.register(statement.value.type);
          visitExpression(statement.value);
        } else if (statement.kind === "assign") visitExpression(statement.value);
        else if (statement.kind === "expression") visitExpression(statement.expression);
        else if (statement.kind === "if") {
          visitExpression(statement.condition);
          visitStatements(statement.consequent);
          visitStatements(statement.alternate);
        } else if (statement.kind === "for-of") {
          visitExpression(statement.values);
          visitStatements(statement.body);
        } else if (statement.value) visitExpression(statement.value);
      }
    };
    visitStatements(function_.body);
  }

  #capabilityOperations(): CapabilityOperation[] {
    return [...this.#capabilities.values()].flatMap((capability) => {
      if (capability.type.kind !== "record") return [];
      return capability.type.fields.flatMap((field) =>
        field.type.kind === "function"
          ? [{ capability: capability.name, field, function: field.type }]
          : [],
      );
    });
  }

  #capabilityMethod(operation: CapabilityOperation): string {
    const parameter = operation.function.parameters[0];
    if (!parameter) throw new Error(`${operation.capability}.${operation.field.name} needs input.`);
    const result = unwrapPromise(operation.function.result);
    return `    fn ${rustName(`${operation.capability}_${operation.field.name}`)}(&mut self, input: ${this.#types.type(parameter.type)}) -> Result<${this.#types.type(result)}, CapabilityError>;`;
  }

  #fixtureMethod(operation: CapabilityOperation): string {
    const parameter = operation.function.parameters[0]!;
    const result = unwrapPromise(operation.function.result);
    const method = rustName(`${operation.capability}_${operation.field.name}`);
    const key = `${operation.capability}.${operation.field.name}`;
    return `    fn ${method}(&mut self, input: ${this.#types.type(parameter.type)}) -> Result<${this.#types.type(result)}, CapabilityError> {
        self.calls.push(json!({ "capability": ${rustString(operation.capability)}, "operation": ${rustString(operation.field.name)}, "input": input.canonical() }));
        self.response(${rustString(key)})
    }`;
  }

  #function(function_: FunctionIR, start: boolean): string {
    const name = start ? "start" : rustName(function_.id);
    const parameters = function_.parameters
      .map((parameter) => `${rustName(parameter.name)}: ${this.#types.type(parameter.type)}`)
      .join(", ");
    const prefix = start
      ? `_capabilities: &mut impl Capabilities${parameters ? `, ${parameters}` : ""}`
      : parameters;
    const result = this.#types.type(function_.result);
    const returnType = start ? `Result<${result}, CapabilityError>` : result;
    const body = this.#statements(function_.body, start, 1, true);
    const tail = start
      ? "    Ok(())\n"
      : function_.result.kind === "primitive" && function_.result.name === "void"
        ? "    ()\n"
        : "";
    return `// TypeScript: ${function_.span.file}:${function_.span.line}:${function_.span.column}\nfn ${name}(${prefix}) -> ${returnType} {\n${body}${tail}}`;
  }

  #statements(
    statements: readonly StatementIR[],
    start: boolean,
    depth: number,
    functionBody = false,
  ): string {
    const indent = "    ".repeat(depth);
    return statements
      .map((statement, index) => {
        switch (statement.kind) {
          case "let":
            return `${indent}let ${statement.mutable ? "mut " : ""}${rustName(statement.name)} = ${withoutOuterParentheses(this.#expression(statement.value))};\n`;
          case "assign":
            return `${indent}${rustName(statement.name)} ${statement.operator} ${this.#expression(statement.value)};\n`;
          case "expression":
            return `${indent}${this.#expression(statement.expression)};\n`;
          case "if":
            return `${indent}if ${withoutOuterParentheses(this.#expression(statement.condition))} {\n${this.#statements(statement.consequent, start, depth + 1)}${indent}}${statement.alternate.length ? ` else {\n${this.#statements(statement.alternate, start, depth + 1)}${indent}}` : ""}\n`;
          case "for-of":
            return `${indent}for ${rustName(statement.item)} in ${this.#expression(statement.values)}.iter().cloned() {\n${this.#statements(statement.body, start, depth + 1)}${indent}}\n`;
          case "return": {
            const value = statement.value ? this.#expression(statement.value) : "()";
            if (!start && functionBody && index === statements.length - 1) {
              return `${indent}${withoutOuterParentheses(value)}\n`;
            }
            return `${indent}return ${start ? `Ok(${value})` : value};\n`;
          }
        }
      })
      .join("");
  }

  #expression(expression: ExpressionIR, expected?: TypeIR): string {
    switch (expression.kind) {
      case "literal":
        return this.#literal(expression.value, expected ?? expression.type);
      case "local":
        return rustName(expression.name);
      case "array": {
        const type = expected ?? expression.type;
        if (type.kind === "tuple") {
          return `(${expression.values
            .map((value, index) => this.#expression(value, type.elements[index]))
            .join(", ")}${expression.values.length === 1 ? "," : ""})`;
        }
        const element = type.kind === "array" ? type.element : undefined;
        return `vec![${expression.values.map((value) => this.#expression(value, element)).join(", ")}]`;
      }
      case "record": {
        const type = expected ?? expression.type;
        if (type.kind !== "record") throw new Error("Record expression has no record type.");
        const fields = new Map(type.fields.map((field) => [field.name, field.type]));
        return `${this.#types.type(type)} { ${expression.fields
          .map(({ name, value }) => {
            const field = rustName(name);
            return value.kind === "local" && rustName(value.name) === field
              ? field
              : `${field}: ${this.#expression(value, fields.get(name))}`;
          })
          .join(", ")} }`;
      }
      case "property":
        if (expression.name === "length" && expression.value.type.kind === "array") {
          return `(${this.#expression(expression.value)}.len() as f64)`;
        }
        return `${this.#expression(expression.value)}.${rustName(expression.name)}`;
      case "unary":
        return `${expression.operator}${this.#expression(expression.value)}`;
      case "binary":
        if (expression.operator === "??") {
          return `${this.#expression(expression.left)}.unwrap_or(${this.#expression(expression.right, expression.type)})`;
        }
        if (
          expression.operator === "+" &&
          ((expression.type.kind === "primitive" && expression.type.name === "string") ||
            (expression.type.kind === "literal" && typeof expression.type.value === "string"))
        ) {
          return `format!("{}{}", ${this.#expression(expression.left)}, ${this.#expression(expression.right)})`;
        }
        if (
          (expression.operator === "===" || expression.operator === "!==") &&
          isNumberType(expression.left.type)
        ) {
          const equality = `number_equal(${this.#expression(expression.left)}, ${this.#expression(expression.right, expression.left.type)})`;
          return expression.operator === "===" ? equality : `!${equality}`;
        }
        if (expression.operator === "===" || expression.operator === "!==") {
          const operator = rustOperator(expression.operator);
          return `(${this.#expression(expression.left)} ${operator} ${this.#expression(expression.right, expression.left.type)})`;
        }
        if (expression.operator === "/") {
          return `number_divide(${this.#expression(expression.left)}, ${this.#expression(expression.right)})`;
        }
        return `(${this.#expression(expression.left)} ${rustOperator(expression.operator)} ${this.#expression(expression.right)})`;
      case "call": {
        const function_ = this.#functions.get(expression.function);
        return `${rustName(expression.function)}(${expression.arguments
          .map((argument, index) => this.#expression(argument, function_?.parameters[index]?.type))
          .join(", ")})`;
      }
      case "capability-call": {
        const operation = this.#operation(expression.capability, expression.operation);
        return `_capabilities.${rustName(`${expression.capability}_${expression.operation}`)}(${expression.arguments
          .map((argument, index) =>
            this.#expression(argument, operation?.function.parameters[index]?.type),
          )
          .join(", ")})?`;
      }
    }
  }

  #literal(value: null | boolean | number | string, expected: TypeIR): string {
    if (value === null) return "()";
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") {
      if (Number.isNaN(value)) return "f64::NAN";
      if (value === Infinity) return "f64::INFINITY";
      if (value === -Infinity) return "f64::NEG_INFINITY";
      if (Object.is(value, -0)) return "-0.0_f64";
      return Number.isInteger(value) ? `${value}.0_f64` : `${value}_f64`;
    }
    if (expected.kind === "union" && expected.variants.every(isStringLiteral)) {
      return `${this.#types.type(expected)}::${rustVariant(value)}`;
    }
    return `${rustString(value)}.to_string()`;
  }

  #operation(capability: string, operation: string): CapabilityOperation | undefined {
    return this.#capabilityOperations().find(
      (candidate) => candidate.capability === capability && candidate.field.name === operation,
    );
  }
}

function numericRuntime(program: ProgramContributionIR): string {
  if (program.implementation.kind !== "portable") return "";
  const operators = new Set<Extract<ExpressionIR, { kind: "binary" }>["operator"]>();
  let numericEquality = false;
  const visitExpression = (expression: ExpressionIR): void => {
    if (expression.kind === "array") expression.values.forEach(visitExpression);
    else if (expression.kind === "record") {
      expression.fields.forEach(({ value }) => visitExpression(value));
    } else if (expression.kind === "property" || expression.kind === "unary") {
      visitExpression(expression.value);
    } else if (expression.kind === "binary") {
      operators.add(expression.operator);
      if (
        (expression.operator === "===" || expression.operator === "!==") &&
        isNumberType(expression.left.type)
      ) {
        numericEquality = true;
      }
      visitExpression(expression.left);
      visitExpression(expression.right);
    } else if (expression.kind === "call" || expression.kind === "capability-call") {
      expression.arguments.forEach(visitExpression);
    }
  };
  const visitStatements = (statements: readonly StatementIR[]): void => {
    for (const statement of statements) {
      if (statement.kind === "let" || statement.kind === "assign") {
        visitExpression(statement.value);
      } else if (statement.kind === "expression") {
        visitExpression(statement.expression);
      } else if (statement.kind === "if") {
        visitExpression(statement.condition);
        visitStatements(statement.consequent);
        visitStatements(statement.alternate);
      } else if (statement.kind === "for-of") {
        visitExpression(statement.values);
        visitStatements(statement.body);
      } else if (statement.value) {
        visitExpression(statement.value);
      }
    }
  };
  visitStatements(program.implementation.start.body);
  for (const function_ of program.implementation.functions) visitStatements(function_.body);

  const declarations: string[] = [];
  if (numericEquality) {
    declarations.push(`#[inline(always)]
fn number_equal(left: f64, right: f64) -> bool { left == right }`);
  }
  if (operators.has("/")) {
    declarations.push(`#[inline(always)]
fn number_divide(left: f64, right: f64) -> f64 { left / right }`);
  }
  return declarations.join("\n\n");
}

function isNumberType(type: TypeIR): boolean {
  return (
    (type.kind === "primitive" && type.name === "number") ||
    (type.kind === "literal" && typeof type.value === "number")
  );
}

type CapabilityOperation = Readonly<{
  capability: string;
  field: FieldIR;
  function: Extract<TypeIR, { kind: "function" }>;
}>;

class RustTypes {
  readonly #names = new Map<string, string>();
  readonly #types = new Map<string, TypeIR>();
  readonly #tupleArities = new Set<number>();

  register(type: TypeIR): void {
    const key = typeKey(type);
    if (needsDeclaration(type) && !this.#names.has(key)) {
      const name = `Type${this.#names.size + 1}`;
      this.#names.set(key, name);
      this.#types.set(key, type);
    }
    if (type.kind === "array" || type.kind === "option" || type.kind === "promise") {
      this.register(type.kind === "array" ? type.element : type.value);
    } else if (type.kind === "tuple") {
      this.#tupleArities.add(type.elements.length);
      type.elements.forEach((item) => this.register(item));
    } else if (type.kind === "union") {
      type.variants.forEach((item) => this.register(item));
    } else if (type.kind === "record") {
      type.fields.forEach((field) => this.register(field.type));
    } else if (type.kind === "function") {
      type.parameters.forEach((field) => this.register(field.type));
      this.register(type.result);
    } else if (type.kind === "stream") {
      this.register(type.element);
    }
  }

  type(type: TypeIR): string {
    switch (type.kind) {
      case "primitive":
        return { boolean: "bool", null: "()", number: "f64", string: "String", void: "()" }[
          type.name
        ];
      case "literal":
        return typeof type.value === "boolean"
          ? "bool"
          : typeof type.value === "number"
            ? "f64"
            : "String";
      case "array":
        return `Vec<${this.type(type.element)}>`;
      case "tuple":
        return `(${type.elements.map((item) => this.type(item)).join(", ")}${type.elements.length === 1 ? "," : ""})`;
      case "option":
        return `Option<${this.type(type.value)}>`;
      case "promise":
        return this.type(type.value);
      case "record":
      case "union":
        return this.#names.get(typeKey(type))!;
      case "opaque":
      case "stream":
      case "function":
        throw new Error(`Type ${type.kind} cannot cross the native portable value boundary.`);
    }
  }

  declarations(serializable = true): string {
    return [...this.#types.entries()]
      .map(([key, type]) => {
        const name = this.#names.get(key)!;
        if (type.kind === "record") {
          const derive = serializable
            ? "#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]"
            : "#[derive(Debug, Clone, PartialEq)]";
          return `${derive}\nstruct ${name} {\n${type.fields
            .map((field) => {
              const name = rustName(field.name);
              const rename =
                serializable && name !== field.name
                  ? `    #[serde(rename = ${rustString(field.name)})]\n`
                  : "";
              return `${rename}    ${name}: ${field.optional ? `Option<${this.type(field.type)}>` : this.type(field.type)},`;
            })
            .join("\n")}\n}`;
        }
        if (type.kind === "union" && type.variants.every(isStringLiteral)) {
          const derive = serializable
            ? '#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]\n#[serde(rename_all = "camelCase")]'
            : "#[derive(Debug, Clone, PartialEq)]";
          return `${derive}\nenum ${name} {\n${type.variants
            .map(
              (variant) =>
                `${serializable ? `    #[serde(rename = ${rustString(variant.value)})]\n` : ""}    ${rustVariant(variant.value)},`,
            )
            .join("\n")}\n}`;
        }
        throw new Error("Native profile v0 requires unions to contain string literals.");
      })
      .join("\n\n");
  }

  canonicalRuntime(): string {
    const tuples = [...this.#tupleArities]
      .filter((arity) => arity > 0)
      .sort((left, right) => left - right)
      .map((arity) => {
        const parameters = Array.from({ length: arity }, (_, index) =>
          String.fromCharCode(65 + index),
        );
        return `impl<${parameters.map((name) => `${name}: CanonicalValue`).join(", ")}> CanonicalValue for (${parameters.join(", ")}${arity === 1 ? "," : ""}) {
    fn canonical(&self) -> Value {
        Value::Array(vec![${parameters.map((_name, index) => `self.${index}.canonical()`).join(", ")}])
    }
}`;
      });
    const declarations = [...this.#types.entries()].map(([key, type]) => {
      const name = this.#names.get(key)!;
      if (type.kind === "record") {
        return `impl CanonicalValue for ${name} {
    fn canonical(&self) -> Value {
        json!({ ${type.fields
          .map((field) => `${rustString(field.name)}: self.${rustName(field.name)}.canonical()`)
          .join(", ")} })
    }
}`;
      }
      if (type.kind === "union" && type.variants.every(isStringLiteral)) {
        return `impl CanonicalValue for ${name} {
    fn canonical(&self) -> Value {
        Value::String(match self {
${type.variants
  .map(
    (variant) => `            Self::${rustVariant(variant.value)} => ${rustString(variant.value)},`,
  )
  .join("\n")}
        }.to_string())
    }
}`;
      }
      throw new Error("Native profile v0 requires unions to contain string literals.");
    });
    return `trait CanonicalValue { fn canonical(&self) -> Value; }

impl CanonicalValue for () { fn canonical(&self) -> Value { Value::Null } }
impl CanonicalValue for bool { fn canonical(&self) -> Value { Value::Bool(*self) } }
impl CanonicalValue for String { fn canonical(&self) -> Value { Value::String(self.clone()) } }
impl CanonicalValue for f64 {
    fn canonical(&self) -> Value {
        if self.is_nan() { json!({ "$number": "nan" }) }
        else if *self == f64::INFINITY { json!({ "$number": "positive-infinity" }) }
        else if *self == f64::NEG_INFINITY { json!({ "$number": "negative-infinity" }) }
        else if *self == 0.0 && self.is_sign_negative() { json!({ "$number": "negative-zero" }) }
        else { json!(self) }
    }
}
impl<T: CanonicalValue> CanonicalValue for Vec<T> {
    fn canonical(&self) -> Value { Value::Array(self.iter().map(CanonicalValue::canonical).collect()) }
}
impl<T: CanonicalValue> CanonicalValue for Option<T> {
    fn canonical(&self) -> Value { self.as_ref().map_or(Value::Null, CanonicalValue::canonical) }
}
${[...tuples, ...declarations].join("\n\n")}`;
  }
}

function needsDeclaration(type: TypeIR): boolean {
  return type.kind === "record" || type.kind === "union";
}

function unwrapPromise(type: TypeIR): TypeIR {
  return type.kind === "promise" ? type.value : type;
}

function isStringLiteral(type: TypeIR): type is Extract<TypeIR, { kind: "literal" }> & {
  value: string;
} {
  return type.kind === "literal" && typeof type.value === "string";
}

function typeKey(type: TypeIR): string {
  return JSON.stringify(type);
}

function rustName(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const name = normalized || "value";
  return /^[0-9]/.test(name) ? `value_${name}` : name;
}

function rustVariant(value: string): string {
  const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const name = words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join("");
  return /^[0-9]/.test(name) ? `Value${name}` : name || "Value";
}

function rustOperator(operator: Extract<ExpressionIR, { kind: "binary" }>["operator"]): string {
  if (operator === "??") throw new Error("Nullish coalescing is lowered before Rust operators.");
  return operator === "===" ? "==" : operator === "!==" ? "!=" : operator;
}

function rustString(value: string): string {
  return JSON.stringify(value);
}

function withoutOuterParentheses(value: string): string {
  return value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
}

async function command(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  input?: string,
  environment?: NodeJS.ProcessEnv,
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, { cwd, env: environment, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
