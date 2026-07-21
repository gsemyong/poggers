import type {
  EntityFeatureImplementationIR,
  ExpressionIR,
  FunctionIR,
  IdentityFeatureImplementationIR,
  StatementIR,
} from "@/core/compiler/ir";

export function generateIdentityDomain(feature: IdentityFeatureImplementationIR): string {
  const generator = new ValueFunctionGenerator([...feature.functions, feature.project]);
  const domain = generator.generate();
  return `${valueRuntime(domain)}
${domain}

pub fn project(input: Value) -> Value {
    ${generator.name(feature.project.id)}(input)
}
`;
}

export function generateEntityDomain(feature: EntityFeatureImplementationIR): string {
  const functions = [
    ...feature.functions,
    feature.create,
    feature.update,
    feature.authorize,
    ...(feature.matches ? [feature.matches] : []),
  ];
  const generator = new ValueFunctionGenerator(functions);
  const domain = generator.generate();
  const matches = feature.matches
    ? `
pub fn matches(input: Value) -> Value {
    ${generator.name(feature.matches.id)}(input)
}
`
    : "";
  return `${valueRuntime(domain)}
${domain}

pub fn create(input: Value) -> Value {
    ${generator.name(feature.create.id)}(input)
}

pub fn update(input: Value) -> Value {
    ${generator.name(feature.update.id)}(input)
}

pub fn authorize(input: Value) -> Value {
    ${generator.name(feature.authorize.id)}(input)
}
${matches}`;
}

class ValueFunctionGenerator {
  readonly #functions: ReadonlyMap<string, FunctionIR>;
  readonly #names: ReadonlyMap<string, string>;

  constructor(functions: readonly FunctionIR[]) {
    this.#functions = new Map(functions.map((function_) => [function_.id, function_]));
    this.#names = new Map(
      [...this.#functions.keys()]
        .sort()
        .map((id, index) => [id, `domain_${index}_${rustName(id)}`]),
    );
  }

  name(id: string): string {
    const name = this.#names.get(id);
    if (!name) throw new Error(`Unknown portable domain function ${id}.`);
    return name;
  }

  generate(): string {
    return [...this.#functions.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((function_) => this.#function(function_))
      .join("\n\n");
  }

  #function(function_: FunctionIR): string {
    if (function_.asynchronous) {
      throw new Error(`Domain function ${function_.id} must be synchronous.`);
    }
    const parameters = function_.parameters
      .map(({ name }) => `${rustName(name)}: Value`)
      .join(", ");
    const last = function_.body.at(-1);
    const body = last?.kind === "return" ? function_.body.slice(0, -1) : function_.body;
    const tail =
      last?.kind === "return"
        ? `    ${last.value ? this.#expression(last.value) : "Value::Null"}\n`
        : "    Value::Null\n";
    return `fn ${this.name(function_.id)}(${parameters}) -> Value {\n${this.#statements(body, 1)}${tail}}`;
  }

  #statements(statements: readonly StatementIR[], depth: number): string {
    const indent = "    ".repeat(depth);
    return statements
      .map((statement) => {
        switch (statement.kind) {
          case "let":
            return `${indent}let ${statement.mutable ? "mut " : ""}${rustName(statement.name)} = ${this.#expression(statement.value)};\n`;
          case "assign": {
            const name = rustName(statement.name);
            if (statement.operator === "=") {
              return `${indent}${name} = ${this.#expression(statement.value)};\n`;
            }
            const operator = statement.operator.slice(0, -1);
            return `${indent}${name} = ${numeric(operator, name, this.#expression(statement.value))};\n`;
          }
          case "expression":
            return `${indent}let _ = ${this.#expression(statement.expression)};\n`;
          case "if":
            return `${indent}if truth(&${this.#expression(statement.condition)}) {\n${this.#statements(statement.consequent, depth + 1)}${indent}}${statement.alternate.length ? ` else {\n${this.#statements(statement.alternate, depth + 1)}${indent}}` : ""}\n`;
          case "for-of":
            return `${indent}for ${rustName(statement.item)} in ${this.#expression(statement.values)}.as_array().cloned().unwrap_or_default() {\n${this.#statements(statement.body, depth + 1)}${indent}}\n`;
          case "return":
            return `${indent}return ${statement.value ? this.#expression(statement.value) : "Value::Null"};\n`;
        }
      })
      .join("");
  }

  #expression(expression: ExpressionIR): string {
    switch (expression.kind) {
      case "literal":
        return `json!(${JSON.stringify(expression.value)})`;
      case "local":
        return `${rustName(expression.name)}.clone()`;
      case "array":
        return `Value::Array(vec![${expression.values.map((value) => this.#expression(value)).join(", ")}])`;
      case "record":
        return `Value::Object(Map::from_iter([${expression.fields
          .map(
            ({ name, value }) => `(${JSON.stringify(name)}.to_owned(), ${this.#expression(value)})`,
          )
          .join(", ")}]))`;
      case "property":
        return `property(&${this.#expression(expression.value)}, ${JSON.stringify(expression.name)})`;
      case "unary":
        return expression.operator === "!"
          ? `json!(!truth(&${this.#expression(expression.value)}))`
          : `json!(-number(&${this.#expression(expression.value)}))`;
      case "binary": {
        const left = this.#expression(expression.left);
        const right = this.#expression(expression.right);
        if (expression.operator === "??") return `coalesce(${left}, ${right})`;
        if (expression.operator === "===") return `json!(${left} == ${right})`;
        if (expression.operator === "!==") return `json!(${left} != ${right})`;
        if (expression.operator === "&&") return `json!(truth(&${left}) && truth(&${right}))`;
        if (expression.operator === "||") return `json!(truth(&${left}) || truth(&${right}))`;
        if (["<", "<=", ">", ">="].includes(expression.operator)) {
          return `json!(number(&${left}) ${expression.operator} number(&${right}))`;
        }
        return `numeric(${JSON.stringify(expression.operator)}, ${left}, ${right})`;
      }
      case "call":
        return `${this.name(expression.function)}(${expression.arguments.map((value) => this.#expression(value)).join(", ")})`;
      case "capability-call":
        throw new Error("Domain callbacks cannot call host Capabilities directly.");
    }
  }
}

function valueRuntime(domain: string): string {
  const imports = ["Value"];
  if (domain.includes("json!(")) imports.unshift("json");
  if (domain.includes("Map::")) imports.unshift("Map");
  const helpers = [
    domain.includes("property(")
      ? `fn property(value: &Value, name: &str) -> Value {
    value.get(name).cloned().unwrap_or(Value::Null)
}`
      : "",
    domain.includes("coalesce(")
      ? `fn coalesce(left: Value, right: Value) -> Value {
    if left.is_null() { right } else { left }
}`
      : "",
    domain.includes("truth(")
      ? `fn truth(value: &Value) -> bool {
    value.as_bool().unwrap_or(false)
}`
      : "",
    domain.includes("number(")
      ? `fn number(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0)
}`
      : "",
  ].filter(Boolean);
  return `use serde_json::{${imports.join(", ")}};\n${helpers.length ? `\n${helpers.join("\n\n")}\n` : ""}`;
}

function numeric(operator: string, left: string, right: string): string {
  return `json!(match ${JSON.stringify(operator)} { "+" => number(&${left}) + number(&${right}), "-" => number(&${left}) - number(&${right}), "*" => number(&${left}) * number(&${right}), "/" => number(&${left}) / number(&${right}), "%" => number(&${left}) % number(&${right}), _ => 0.0 })`;
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
