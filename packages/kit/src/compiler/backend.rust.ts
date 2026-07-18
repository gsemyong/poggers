import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertProductIRVersion,
  type ExpressionIR,
  type ProductIR,
  type ProgramIR,
  type StatementIR,
  type TypeIR,
} from "./ir";

export type RustFixtureValue =
  | null
  | boolean
  | number
  | string
  | readonly RustFixtureValue[]
  | RustFixtureRecord;

export interface RustFixtureRecord {
  readonly [name: string]: RustFixtureValue;
}

export type RustCapabilityFixture = Readonly<{
  result?: RustFixtureValue;
  error?: string;
}>;

export type RustBackendOptions = Readonly<{
  ir: ProductIR;
  program: string;
  directory: string;
  fixtures: Readonly<Record<string, RustCapabilityFixture>>;
  adapterSource?: string;
}>;

/** Emits one self-contained native artifact project from a headless Program IR. */
export async function emitRustProgram(options: RustBackendOptions): Promise<string> {
  assertProductIRVersion(options.ir);
  const program = options.ir.programs.find(({ id }) => id === options.program);
  if (!program) throw new Error(`Unknown Program ${JSON.stringify(options.program)}.`);
  preflight(program, options.fixtures, !options.adapterSource);

  const directory = resolve(options.directory);
  await mkdir(resolve(directory, "src"), { recursive: true });
  await writeFile(
    resolve(directory, "Cargo.toml"),
    `[package]\nname = "poggers_program"\nversion = "0.0.0"\nedition = "2024"\npublish = false\n`,
  );
  if (options.adapterSource) {
    await writeFile(resolve(directory, "src", "generated.rs"), generatedRustSource(program));
    await writeFile(resolve(directory, "src", "adapter.rs"), options.adapterSource);
    await writeFile(resolve(directory, "src", "main.rs"), adapterMainSource());
  } else {
    await writeFile(
      resolve(directory, "src", "main.rs"),
      fixtureRustSource(program, options.fixtures),
    );
  }
  return directory;
}

function preflight(
  program: ProgramIR,
  fixtures: Readonly<Record<string, RustCapabilityFixture>>,
  requireFixtures: boolean,
): void {
  if (program.ui) fail(program, "The Rust backend accepts headless Programs only.");
  if (!program.start) fail(program, "The Rust backend requires a portable start body.");
  const methodNames = new Set<string>();
  for (const capability of program.requires) {
    validateType(capability.type, program);
    if (capability.type.kind !== "record") {
      fail(program, `Capability ${JSON.stringify(capability.name)} must be a record.`);
    }
    for (const operation of capability.type.fields) {
      if (operation.type.kind !== "function") continue;
      const key = `${capability.name}.${operation.name}`;
      if (requireFixtures && !Object.hasOwn(fixtures, key)) {
        fail(program, `Missing Rust Capability implementation for ${JSON.stringify(key)}.`);
      }
      const rustName = operationName(capability.name, operation.name);
      if (methodNames.has(rustName)) {
        fail(program, `Capability operations collide as Rust method ${JSON.stringify(rustName)}.`);
      }
      methodNames.add(rustName);
    }
  }
}

function validateType(type: TypeIR, program: ProgramIR): void {
  switch (type.kind) {
    case "primitive":
    case "literal":
      return;
    case "array":
      validateType(type.element, program);
      return;
    case "tuple":
      type.elements.forEach((item) => validateType(item, program));
      return;
    case "option":
    case "promise":
      validateType(type.value, program);
      return;
    case "union":
      if (
        !type.variants.every((item) => item.kind === "literal" && typeof item.value === "string")
      ) {
        fail(program, "The Rust backend currently supports only string-literal unions.");
      }
      return;
    case "record":
      type.fields.forEach((field) => validateType(field.type, program));
      return;
    case "function":
      type.parameters.forEach((parameter) => validateType(parameter.type, program));
      validateType(type.result, program);
  }
}

function fixtureRustSource(
  program: ProgramIR,
  fixtures: Readonly<Record<string, RustCapabilityFixture>>,
): string {
  const operations = capabilityOperations(program);
  const hasOperations = operations.length > 0;
  const traits = operations
    .map(({ capability, field }) => traitMethod(capability, field))
    .join("\n");
  const implementations = operations
    .map(({ capability, field }) =>
      fixtureMethod(capability, field, fixtures[`${capability}.${field.name}`]!),
    )
    .join("\n");
  const fixtureDefinition = hasOperations
    ? `struct FixtureCapabilities {
    calls: Mutex<Vec<&'static str>>,
}

impl FixtureCapabilities {
    fn record(&self, call: &'static str) {
        self.calls.lock().expect("trace lock").push(call);
    }
}`
    : "struct FixtureCapabilities;";
  const capabilityImplementation = implementations
    ? `impl Capabilities for FixtureCapabilities {\n${indent(implementations, 1)}\n}`
    : "impl Capabilities for FixtureCapabilities {}";
  const body = renderStatements(program.start!.body, program, new Map(), 1);
  return `use std::future::Future;
${hasOperations ? "use std::sync::Mutex;\n" : ""}use std::task::{Context, Poll, Waker};

${traits ? `trait Capabilities {\n${indent(traits, 1)}\n}` : "trait Capabilities {}"}

async fn run<C: Capabilities>(${hasOperations ? "capabilities" : "_capabilities"}: &C) -> Result<(), String> {
${body}${body ? "\n" : ""}    Ok(())
}

#[derive(Default)]
${fixtureDefinition}

${capabilityImplementation}

fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::noop();
    let mut context = Context::from_waker(waker);
    let mut future = Box::pin(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(output) => return output,
            Poll::Pending => std::thread::yield_now(),
        }
    }
}

fn main() {
    let capabilities = FixtureCapabilities${hasOperations ? "::default()" : ""};
    match block_on(run(&capabilities)) {
        Ok(()) => {
${
  hasOperations
    ? `            for call in capabilities.calls.lock().expect("trace lock").iter() {
                println!("call:{call}");
            }\n`
    : ""
}            println!("result:ok");
        }
        Err(error) => {
            eprintln!("error:{error}");
            std::process::exit(1);
        }
    }
}
`;
}

function generatedRustSource(program: ProgramIR): string {
  const traits = capabilityOperations(program)
    .map(({ capability, field }) => traitMethod(capability, field))
    .join("\n");
  const body = renderStatements(program.start!.body, program, new Map(), 1);
  return `use std::future::Future;
use std::task::{Context, Poll, Waker};

${traits ? `pub trait Capabilities {\n${indent(traits, 1)}\n}` : "pub trait Capabilities {}"}

pub async fn run<C: Capabilities>(${traits ? "capabilities" : "_capabilities"}: &C) -> Result<(), String> {
${body}${body ? "\n" : ""}    Ok(())
}

pub fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::noop();
    let mut context = Context::from_waker(waker);
    let mut future = Box::pin(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(output) => return output,
            Poll::Pending => std::thread::yield_now(),
        }
    }
}
`;
}

function adapterMainSource(): string {
  return `mod adapter;
mod generated;

fn main() {
    let capabilities = adapter::create();
    match generated::block_on(generated::run(&capabilities)) {
        Ok(()) => println!("result:ok"),
        Err(error) => {
            eprintln!("error:{error}");
            std::process::exit(1);
        }
    }
}
`;
}

type Operation = Readonly<{
  capability: string;
  field: Extract<TypeIR, { kind: "record" }>["fields"][number] & {
    type: Extract<TypeIR, { kind: "function" }>;
  };
}>;

function capabilityOperations(program: ProgramIR): Operation[] {
  return program.requires.flatMap((capability) =>
    capability.type.kind === "record"
      ? capability.type.fields.flatMap((field) =>
          field.type.kind === "function"
            ? [{ capability: capability.name, field: { ...field, type: field.type } }]
            : [],
        )
      : [],
  );
}

function traitMethod(capability: string, field: Operation["field"]): string {
  const parameters = field.type.parameters
    .map((parameter, index) => `_argument_${index}: ${rustType(parameter.type)}`)
    .join(", ");
  const separator = parameters ? ", " : "";
  const result = promisedType(field.type.result);
  return result.asynchronous
    ? `fn ${operationName(capability, field.name)}(&self${separator}${parameters}) -> impl Future<Output = Result<${rustType(result.type)}, String>>;`
    : `fn ${operationName(capability, field.name)}(&self${separator}${parameters}) -> Result<${rustType(result.type)}, String>;`;
}

function fixtureMethod(
  capability: string,
  field: Operation["field"],
  fixture: RustCapabilityFixture,
): string {
  const parameters = field.type.parameters
    .map((parameter, index) => `_argument_${index}: ${rustType(parameter.type)}`)
    .join(", ");
  const separator = parameters ? ", " : "";
  const result = promisedType(field.type.result);
  const outcome = fixture.error
    ? `Err(String::from(${rustString(fixture.error)}))`
    : `Ok(${rustValue(fixture.result ?? null, result.type)})`;
  const signature = result.asynchronous
    ? `fn ${operationName(capability, field.name)}(&self${separator}${parameters}) -> impl Future<Output = Result<${rustType(result.type)}, String>>`
    : `fn ${operationName(capability, field.name)}(&self${separator}${parameters}) -> Result<${rustType(result.type)}, String>`;
  return result.asynchronous
    ? `${signature} {
    self.record(${rustString(`${capability}.${field.name}`)});
    std::future::ready(${outcome})
}`
    : `${signature} {
    self.record(${rustString(`${capability}.${field.name}`)});
    ${outcome}
}`;
}

function renderStatements(
  statements: readonly StatementIR[],
  program: ProgramIR,
  locals: Map<string, TypeIR>,
  depth: number,
): string {
  const lines: string[] = [];
  for (const statement of statements) {
    switch (statement.kind) {
      case "let": {
        const type = expressionType(statement.value, program, locals);
        locals.set(statement.name, type);
        lines.push(
          `${statement.mutable ? "let mut" : "let"} ${rustIdentifier(statement.name)} = ${rustExpression(statement.value, program, locals, type)};`,
        );
        break;
      }
      case "assign":
        lines.push(
          `${rustIdentifier(statement.name)} ${statement.operator} ${rustExpression(statement.value, program, locals, locals.get(statement.name))};`,
        );
        break;
      case "expression":
        lines.push(`${rustExpression(statement.expression, program, locals)};`);
        break;
      case "if": {
        const thenLocals = new Map(locals);
        const otherwiseLocals = new Map(locals);
        lines.push(
          `if ${stripOuterParentheses(rustExpression(statement.condition, program, locals))} {`,
        );
        lines.push(renderStatements(statement.consequent, program, thenLocals, 1));
        if (statement.alternate.length) {
          lines.push("} else {");
          lines.push(renderStatements(statement.alternate, program, otherwiseLocals, 1));
        }
        lines.push("}");
        break;
      }
      case "for-of": {
        const values = expressionType(statement.values, program, locals);
        if (values.kind !== "array") fail(program, "Rust for-of values must be arrays.");
        const bodyLocals = new Map(locals);
        bodyLocals.set(statement.item, values.element);
        lines.push(
          `for ${rustIdentifier(statement.item)} in ${rustExpression(statement.values, program, locals, values)} {`,
        );
        lines.push(renderStatements(statement.body, program, bodyLocals, 1));
        lines.push("}");
        break;
      }
      case "return":
        if (statement.value) fail(program, "Rust Program start cannot return a portable value.");
        lines.push("return Ok(());");
        break;
    }
  }
  return lines
    .filter(Boolean)
    .map((line) => indent(line, depth))
    .join("\n");
}

function rustExpression(
  expression: ExpressionIR,
  program: ProgramIR,
  locals: ReadonlyMap<string, TypeIR>,
  expected?: TypeIR,
): string {
  switch (expression.kind) {
    case "literal":
      return rustValue(expression.value, expected ?? expressionType(expression, program, locals));
    case "local":
      return rustIdentifier(expression.name);
    case "array": {
      const element = expected?.kind === "array" ? expected.element : undefined;
      return `vec![${expression.values
        .map((value) => rustExpression(value, program, locals, element))
        .join(", ")}]`;
    }
    case "record": {
      if (expected?.kind !== "record")
        fail(program, "Rust record expressions need a contract type.");
      const fields = expected.fields.map((field) => {
        const value = expression.fields.find((item) => item.name === field.name);
        if (!value) fail(program, `Rust record is missing ${JSON.stringify(field.name)}.`);
        return rustExpression(value.value, program, locals, field.type);
      });
      return rustTuple(fields);
    }
    case "property": {
      const owner = expressionType(expression.value, program, locals);
      if (owner.kind !== "record") fail(program, "Rust property access requires a record.");
      const index = owner.fields.findIndex(({ name }) => name === expression.name);
      if (index < 0) fail(program, `Unknown Rust record field ${JSON.stringify(expression.name)}.`);
      return `${rustExpression(expression.value, program, locals, owner)}.${index}`;
    }
    case "unary":
      return `(${expression.operator}${rustExpression(expression.value, program, locals)})`;
    case "binary":
      return `(${rustExpression(expression.left, program, locals)} ${rustOperator(expression.operator)} ${rustExpression(expression.right, program, locals)})`;
    case "capability-call": {
      const operation = findOperation(program, expression.capability, expression.operation);
      const result = promisedType(operation.type.result);
      if (result.asynchronous && !expression.awaited) {
        fail(
          program,
          `Async Capability ${expression.capability}.${expression.operation} must be awaited.`,
        );
      }
      const arguments_ = expression.arguments.map((argument, index) =>
        rustExpression(argument, program, locals, operation.type.parameters[index]?.type),
      );
      const call = `capabilities.${operationName(expression.capability, expression.operation)}(${arguments_.join(", ")})`;
      return result.asynchronous ? `${call}.await?` : `${call}?`;
    }
  }
}

function expressionType(
  expression: ExpressionIR,
  program: ProgramIR,
  locals: ReadonlyMap<string, TypeIR>,
): TypeIR {
  switch (expression.kind) {
    case "literal":
      if (typeof expression.value === "string") return { kind: "primitive", name: "string" };
      if (typeof expression.value === "number") return { kind: "primitive", name: "number" };
      if (typeof expression.value === "boolean") return { kind: "primitive", name: "boolean" };
      return { kind: "primitive", name: "void" };
    case "local": {
      const type = locals.get(expression.name);
      if (!type) fail(program, `Unknown Rust binding ${JSON.stringify(expression.name)}.`);
      return type;
    }
    case "array":
      if (!expression.values.length)
        fail(program, "Rust cannot infer an empty array without a contract.");
      return { kind: "array", element: expressionType(expression.values[0]!, program, locals) };
    case "record":
      fail(program, "Rust record expressions require an expected contract type.");
    case "property": {
      const owner = expressionType(expression.value, program, locals);
      if (owner.kind !== "record") fail(program, "Rust property access requires a record.");
      const field = owner.fields.find(({ name }) => name === expression.name);
      if (!field) fail(program, `Unknown Rust field ${JSON.stringify(expression.name)}.`);
      return field.type;
    }
    case "unary":
      return expression.operator === "!"
        ? { kind: "primitive", name: "boolean" }
        : { kind: "primitive", name: "number" };
    case "binary":
      return ["===", "!==", "<", "<=", ">", ">=", "&&", "||"].includes(expression.operator)
        ? { kind: "primitive", name: "boolean" }
        : expressionType(expression.left, program, locals);
    case "capability-call":
      return promisedType(
        findOperation(program, expression.capability, expression.operation).type.result,
      ).type;
  }
}

function findOperation(
  program: ProgramIR,
  capability: string,
  operation: string,
): Operation["field"] {
  const owner = program.requires.find(({ name }) => name === capability);
  if (owner?.type.kind !== "record")
    fail(program, `Unknown Capability ${JSON.stringify(capability)}.`);
  const field = owner.type.fields.find(({ name }) => name === operation);
  if (!field || field.type.kind !== "function") {
    fail(program, `Unknown Capability operation ${JSON.stringify(`${capability}.${operation}`)}.`);
  }
  return { ...field, type: field.type };
}

function promisedType(type: TypeIR): Readonly<{ asynchronous: boolean; type: TypeIR }> {
  return type.kind === "promise"
    ? { asynchronous: true, type: type.value }
    : { asynchronous: false, type };
}

function rustType(type: TypeIR): string {
  switch (type.kind) {
    case "primitive":
      return { boolean: "bool", number: "f64", string: "String", void: "()" }[type.name];
    case "literal":
      return typeof type.value === "boolean"
        ? "bool"
        : typeof type.value === "number"
          ? "f64"
          : "String";
    case "array":
      return `Vec<${rustType(type.element)}>`;
    case "tuple":
      return rustTuple(type.elements.map(rustType));
    case "option":
      return `Option<${rustType(type.value)}>`;
    case "union":
      return "String";
    case "record":
      return rustTuple(type.fields.map((field) => rustType(field.type)));
    case "promise":
      return rustType(type.value);
    case "function":
      throw new Error("Functions cannot be nested Rust values.");
  }
}

function rustValue(value: RustFixtureValue, type: TypeIR): string {
  if (type.kind === "promise") return rustValue(value, type.value);
  if (type.kind === "option") {
    return value === null ? "None" : `Some(${rustValue(value, type.value)})`;
  }
  if (type.kind === "union") {
    if (typeof value !== "string") throw new Error("Rust string union fixture must be a string.");
    return `String::from(${rustString(value)})`;
  }
  if (type.kind === "literal") return rustValue(value, literalPrimitive(type.value));
  if (type.kind === "primitive") {
    switch (type.name) {
      case "void":
        return "()";
      case "boolean":
        if (typeof value !== "boolean") throw new Error("Rust boolean fixture expected.");
        return String(value);
      case "number":
        if (typeof value !== "number") throw new Error("Rust number fixture expected.");
        return Number.isInteger(value) ? `${value}.0` : String(value);
      case "string":
        if (typeof value !== "string") throw new Error("Rust string fixture expected.");
        return `String::from(${rustString(value)})`;
    }
  }
  if (type.kind === "array") {
    if (!Array.isArray(value)) throw new Error("Rust array fixture expected.");
    return `vec![${value.map((item) => rustValue(item, type.element)).join(", ")}]`;
  }
  if (type.kind === "tuple") {
    if (!Array.isArray(value)) throw new Error("Rust tuple fixture expected.");
    return rustTuple(type.elements.map((item, index) => rustValue(value[index]!, item)));
  }
  if (type.kind === "record") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Rust record fixture expected.");
    }
    const record = value as RustFixtureRecord;
    return rustTuple(type.fields.map((field) => rustValue(record[field.name]!, field.type)));
  }
  throw new Error(`Unsupported Rust fixture type ${type.kind}.`);
}

function literalPrimitive(value: boolean | number | string): TypeIR {
  return {
    kind: "primitive",
    name: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string",
  };
}

function rustTuple(values: readonly string[]): string {
  if (values.length === 0) return "()";
  if (values.length === 1) return `(${values[0]},)`;
  return `(${values.join(", ")})`;
}

function rustString(value: string): string {
  return JSON.stringify(value);
}

function rustOperator(operator: Extract<ExpressionIR, { kind: "binary" }>["operator"]): string {
  return operator === "===" ? "==" : operator === "!==" ? "!=" : operator;
}

function stripOuterParentheses(value: string): string {
  return value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
}

function operationName(capability: string, operation: string): string {
  return `${snakeCase(capability)}_${snakeCase(operation)}`;
}

function rustIdentifier(value: string): string {
  const name = snakeCase(value);
  return RUST_KEYWORDS.has(name) ? `${name}_` : name;
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function indent(value: string, depth: number): string {
  const prefix = "    ".repeat(depth);
  return value
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function fail(program: ProgramIR, message: string): never {
  throw new Error(`${program.span.file}:${program.span.line}:${program.span.column}: ${message}`);
}

const RUST_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);
