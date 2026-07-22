import type { ExpressionIR, FunctionIR, LinkedProgramIR, StatementIR } from "@/core/compiler/ir";

/** Lowers linked portable Program meaning into direct Rust control flow. */
export function generateNativeProgram(linked: LinkedProgramIR): string {
  return new NativeProgramGenerator(linked).generate();
}

type ReturnTarget = "completion" | "function";

class NativeProgramGenerator {
  readonly #linked: LinkedProgramIR;
  readonly #functions = new Map<FunctionIR, string>();
  readonly #functionIds = new Map<string, string>();
  #temporary = 0;

  constructor(linked: LinkedProgramIR) {
    this.#linked = linked;
    let index = 0;
    for (const { contribution } of linked.contributions) {
      if (contribution.implementation.kind !== "portable") continue;
      for (const function_ of [
        contribution.implementation.start,
        ...contribution.implementation.functions,
      ]) {
        const name = `function_${index++}_${rustName(function_.name || function_.id)}`;
        this.#functions.set(function_, name);
        this.#functionIds.set(`${contribution.id}\0${function_.id}`, name);
      }
    }
  }

  generate(): string {
    const functions = this.#linked.contributions.flatMap(({ contribution }) => {
      if (contribution.implementation.kind !== "portable") return [];
      return [
        this.#function(contribution.id, contribution.implementation.start, true),
        ...contribution.implementation.functions.map((function_) =>
          this.#function(contribution.id, function_, false),
        ),
      ];
    });
    const starts = this.#linked.contributions.flatMap(({ contribution }) => {
      if (contribution.implementation.kind === "none") return [];
      if (contribution.implementation.kind !== "portable") {
        throw new Error(
          `${contribution.span.file}:${contribution.span.line}:${contribution.span.column}: ` +
            `Program contribution ${JSON.stringify(contribution.id)} is not portable.`,
        );
      }
      const functionName = this.#functions.get(contribution.implementation.start)!;
      const requirements = contribution.requires
        .map(
          ({ name }) =>
            `(${rustString(name)}.to_owned(), engine.capability_value(${rustString(name)})?),`,
        )
        .join("\n        ");
      const provides = contribution.provides.map(({ name }) => name).sort();
      const retain = provides.length
        ? `engine.provide(&[${provides.map(rustString).join(", ")}], result)?;`
        : "engine.retain(result);";
      return [
        `    let capabilities = Value::record(BTreeMap::from([
        ${requirements}
    ]));
    let result = ${functionName}(engine.clone(), Vec::new(), Vec::new(), Some(capabilities)).await?;
    ${retain}`,
      ];
    });
    const generatedFunctions = functions.join("\n\n");
    const runtimeImports = ["Engine", "NativeError", "NativeFuture", "NativeResult", "Value"];
    if (generatedFunctions.includes("assign(")) runtimeImports.push("assign");
    if (generatedFunctions.includes("binary(")) runtimeImports.push("binary");
    if (generatedFunctions.includes("NativeFunction")) runtimeImports.push("NativeFunction");
    const helpers = [
      `fn cell(value: Value) -> Cell {
    Arc::new(Mutex::new(value))
}`,
      `fn read_cell(value: &Cell) -> Value {
    value.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
}`,
    ];
    if (generatedFunctions.includes("write_cell(")) {
      helpers.push(`fn write_cell(value: &Cell, next: Value) {
    *value.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = next;
}`);
    }
    if (generatedFunctions.includes("argument(")) {
      helpers.push(`fn argument(values: &[Value], index: usize) -> Value {
    values.get(index).cloned().unwrap_or(Value::Undefined)
}`);
    }
    if (generatedFunctions.includes("capture(")) {
      helpers.push(`fn capture(values: &[Cell], index: usize, name: &str) -> NativeResult<Cell> {
    values.get(index).cloned().ok_or_else(|| {
        NativeError::new("InvalidClosure", format!("Missing capture {name}."))
    })
}`);
    }
    return `// Generated from canonical Poggers Program IR. Do not edit.
#![allow(clippy::collapsible_if, clippy::needless_return)]

use std::{collections::BTreeMap, sync::{Arc, Mutex}};

use poggers_native_runtime::{${runtimeImports.sort().join(", ")}};

type Cell = Arc<Mutex<Value>>;

#[derive(Debug)]
enum Completion {
    Continue,
    Return(Value),
}

${helpers.join("\n\n")}

${generatedFunctions}

pub async fn start(engine: Engine) -> NativeResult<()> {
${starts.join("\n\n")}
    Ok(())
}
`;
  }

  #function(contribution: string, function_: FunctionIR, start: boolean): string {
    const name = this.#functions.get(function_)!;
    const setup: string[] = [];
    function_.captures.forEach((capture, index) => {
      setup.push(
        `let ${binding(capture.name)} = capture(&captures, ${index}, ${rustString(capture.name)})?;`,
      );
    });
    function_.parameters.forEach((parameter, index) => {
      setup.push(`let ${binding(parameter.name)} = cell(argument(&arguments, ${index}));`);
    });
    if (start) {
      setup.push(
        `let ${binding("capabilities")} = cell(capabilities.ok_or_else(|| ` +
          `NativeError::new("MissingCapabilityScope", "Program start has no Capability scope."))?);`,
      );
    }
    const source = `${function_.span.file}:${function_.span.line}:${function_.span.column}`;
    return `// TypeScript: ${source}
fn ${name}(
    engine: Engine,
    captures: Vec<Cell>,
    arguments: Vec<Value>,
    capabilities: Option<Value>,
) -> NativeFuture<Value> {
    Box::pin(async move {
        let _ = (&engine, &captures, &arguments, &capabilities);
        ${setup.join("\n        ")}
        let completion: NativeResult<Completion> = async {
${this.#statements(contribution, function_.body, "completion", 3)}${canFallThrough(function_.body) ? "            Ok(Completion::Continue)\n" : ""}
        }.await;
        match completion? {
            Completion::Continue => Ok(Value::Undefined),
            Completion::Return(value) => Ok(value),
        }
    })
}`;
  }

  #statements(
    contribution: string,
    statements: readonly StatementIR[],
    target: ReturnTarget,
    depth: number,
  ): string {
    const indent = "    ".repeat(depth);
    const output: string[] = [];
    for (const statement of statements) {
      output.push(
        (() => {
          switch (statement.kind) {
            case "let":
              return `${indent}let ${binding(statement.name)} = cell(${this.#expression(contribution, statement.value)});\n`;
            case "assign": {
              const right = this.#temporaryName("right");
              const left = this.#temporaryName("left");
              return `${indent}let ${right} = ${this.#expression(contribution, statement.value)};
${indent}let ${left} = read_cell(&${binding(statement.name)});
${indent}write_cell(&${binding(statement.name)}, assign(${rustString(statement.operator)}, ${left}, ${right})?);\n`;
            }
            case "expression":
              return `${indent}${this.#expression(contribution, statement.expression)};\n`;
            case "array-push": {
              const value = this.#temporaryName("value");
              const array = this.#temporaryName("array");
              return `${indent}let ${value} = ${this.#expression(contribution, statement.value)};
${indent}let ${array} = read_cell(&${binding(statement.array)}).as_array()?;
${indent}${array}.lock().unwrap_or_else(std::sync::PoisonError::into_inner).push(${value});\n`;
            }
            case "throw":
              return `${indent}return Err(${this.#expression(contribution, statement.value)}.into_error());\n`;
            case "if":
              return `${indent}if ${this.#expression(contribution, statement.condition)}.truthy() {
${this.#statements(contribution, statement.consequent, target, depth + 1)}${indent}}${
                statement.alternate.length
                  ? ` else {\n${this.#statements(contribution, statement.alternate, target, depth + 1)}${indent}}`
                  : ""
              }\n`;
            case "for-of": {
              const values = this.#temporaryName("values");
              if (statement.asynchronous) {
                const loop = canFallThrough(statement.body) ? "while" : "if";
                return `${indent}let ${values} = ${this.#expression(contribution, statement.values)};
${indent}${loop} let Some(item) = engine.next(${values}.clone()).await? {
${indent}    let ${binding(statement.item)} = cell(item);
${this.#statements(contribution, statement.body, target, depth + 1)}${indent}}\n`;
              }
              return `${indent}let ${values} = ${this.#expression(contribution, statement.values)}.as_array()?;
${indent}let ${values} = { ${values}.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone() };
${indent}${canFallThrough(statement.body) ? `for item in ${values}` : `if let Some(item) = ${values}.into_iter().next()`} {
${indent}    let ${binding(statement.item)} = cell(item);
${this.#statements(contribution, statement.body, target, depth + 1)}${indent}}\n`;
            }
            case "for-range": {
              const from = this.#temporaryName("from");
              const to = this.#temporaryName("to");
              return `${indent}let ${from} = ${this.#expression(contribution, statement.from)}.number()? as i64;
${indent}let ${to} = ${this.#expression(contribution, statement.to)}.number()? as i64;
${indent}for item in ${from}..${to} {
${indent}    let ${binding(statement.item)} = cell(Value::Number(item as f64));
${this.#statements(contribution, statement.body, target, depth + 1)}${indent}}\n`;
            }
            case "try":
              return this.#tryStatement(contribution, statement, target, depth);
            case "return": {
              const value = statement.value
                ? this.#expression(contribution, statement.value)
                : "Value::Undefined";
              return target === "function"
                ? `${indent}return Ok(${value});\n`
                : `${indent}return Ok(Completion::Return(${value}));\n`;
            }
          }
        })(),
      );
      if (!statementCanFallThrough(statement)) break;
    }
    return output.join("");
  }

  #tryStatement(
    contribution: string,
    statement: Extract<StatementIR, { kind: "try" }>,
    target: ReturnTarget,
    depth: number,
  ): string {
    const indent = "    ".repeat(depth);
    const result = this.#temporaryName("result");
    const finalization = this.#temporaryName("finalization");
    const caught = statement.catch.length
      ? `Err(error) => {
${statement.error ? `${indent}        let ${binding(statement.error)} = cell(Value::Error(Arc::new(error)));\n` : ""}${indent}        async {
${this.#statements(contribution, statement.catch, "completion", depth + 3)}${canFallThrough(statement.catch) ? `${indent}            Ok(Completion::Continue)\n` : ""}
${indent}        }.await
${indent}    },`
      : `Err(error) => Err(error),`;
    return `${indent}let ${result}: NativeResult<Completion> = async {
${this.#statements(contribution, statement.body, "completion", depth + 1)}${canFallThrough(statement.body) ? `${indent}    Ok(Completion::Continue)\n` : ""}
${indent}}.await;
${indent}let ${result} = match ${result} {
${indent}    ${caught}
${indent}    value => value,
${indent}};
${indent}let ${finalization}: NativeResult<Completion> = async {
${this.#statements(contribution, statement.finally, "completion", depth + 1)}${canFallThrough(statement.finally) ? `${indent}    Ok(Completion::Continue)\n` : ""}
${indent}}.await;
${indent}match ${finalization} {
${indent}    Err(error) => return Err(error),
${indent}    Ok(Completion::Return(value)) => ${returnCompletion(target, "value")}
${indent}    Ok(Completion::Continue) => {}
${indent}}
${indent}match ${result} {
${indent}    Err(error) => return Err(error),
${indent}    Ok(Completion::Return(value)) => ${returnCompletion(target, "value")}
${indent}    Ok(Completion::Continue) => {}
${indent}}\n`;
  }

  #expression(contribution: string, expression: ExpressionIR): string {
    switch (expression.kind) {
      case "literal":
        return literal(expression.value);
      case "none":
        return "Value::Undefined";
      case "local":
        return `read_cell(&${binding(expression.name)})`;
      case "array":
        return `Value::array(vec![${expression.values
          .map((value) => this.#expression(contribution, value))
          .join(", ")}])`;
      case "record":
        return `Value::record(BTreeMap::from([${expression.fields
          .map(
            ({ name, value }) =>
              `(${rustString(name)}.to_owned(), ${this.#expression(contribution, value)})`,
          )
          .join(", ")}]))`;
      case "record-merge": {
        const record = this.#temporaryName("record");
        return `{
            let mut ${record} = BTreeMap::new();
${expression.entries
  .map((entry) =>
    entry.kind === "field"
      ? `            ${record}.insert(${rustString(entry.name)}.to_owned(), ${this.#expression(contribution, entry.value)});`
      : `            ${record}.extend(${this.#expression(contribution, entry.value)}.as_record()?.iter().map(|(name, value)| (name.clone(), value.clone())));`,
  )
  .join("\n")}
            Value::record(${record})
        }`;
      }
      case "property":
        return `${this.#expression(contribution, expression.value)}.property(${rustString(expression.name)}, ${String(Boolean(expression.optional))})?`;
      case "binary": {
        const left = this.#temporaryName("left");
        if (["&&", "||", "??"].includes(expression.operator)) {
          const condition =
            expression.operator === "&&"
              ? `${left}.truthy()`
              : expression.operator === "||"
                ? `!${left}.truthy()`
                : `matches!(${left}, Value::Undefined | Value::Null)`;
          return `{
            let ${left} = ${this.#expression(contribution, expression.left)};
            if ${condition} { ${this.#expression(contribution, expression.right)} } else { ${left} }
        }`;
        }
        return `binary(${rustString(expression.operator)}, ${this.#expression(contribution, expression.left)}, ${this.#expression(contribution, expression.right)})?`;
      }
      case "unary": {
        const value = this.#expression(contribution, expression.value);
        if (expression.operator === "!") return `Value::Boolean(!${value}.truthy())`;
        if (expression.operator === "present") {
          return `Value::Boolean(!matches!(${value}, Value::Undefined | Value::Null))`;
        }
        return `Value::Number(-${value}.number()?)`;
      }
      case "call":
        return `${this.#functionName(contribution, expression.function)}(engine.clone(), Vec::new(), vec![${expression.arguments.map((argument) => this.#expression(contribution, argument)).join(", ")}], None).await?`;
      case "invoke":
        return `engine.invoke(${this.#expression(contribution, expression.callee)}, vec![${expression.arguments.map((argument) => this.#expression(contribution, argument)).join(", ")}]).await?`;
      case "method-call":
        return `engine.method(${this.#expression(contribution, expression.receiver)}, ${rustString(expression.method)}, vec![${expression.arguments.map((argument) => this.#expression(contribution, argument)).join(", ")}]).await?`;
      case "capability-call":
        return `engine.call_capability(${rustString(expression.capability)}, ${rustString(expression.operation)}, ${expression.arguments[0] ? this.#expression(contribution, expression.arguments[0]) : "Value::Undefined"}).await?`;
      case "conditional":
        return `if ${this.#expression(contribution, expression.condition)}.truthy() { ${this.#expression(contribution, expression.consequent)} } else { ${this.#expression(contribution, expression.alternate)} }`;
      case "json-parse":
        return `Value::from_json(&serde_json::from_str::<serde_json::Value>(&${this.#expression(contribution, expression.value)}.string()?).map_err(|error| NativeError::new("SyntaxError", error.to_string()))?)`;
      case "json-stringify":
        return `Value::String(${this.#expression(contribution, expression.value)}.to_json()?.to_string())`;
      case "to-string":
        return `Value::String(${this.#expression(contribution, expression.value)}.to_text())`;
      case "stream-map":
        return `engine.map_stream(${this.#expression(contribution, expression.source)}, ${this.#expression(contribution, expression.transform)}).await?`;
      case "closure": {
        const captures = expression.captures.map((capture, index) => {
          const name = this.#temporaryName(`capture_${index}`);
          const value =
            capture.kind === "local"
              ? binding(capture.name)
              : `cell(${this.#expression(contribution, capture)})`;
          return { name, value };
        });
        return `{
            ${captures.map(({ name, value }) => `let ${name} = ${value}.clone();`).join("\n            ")}
            Value::Function(NativeFunction::new(move |engine, arguments| {
                let captures = vec![${captures.map(({ name }) => `${name}.clone()`).join(", ")}];
                ${this.#functionName(contribution, expression.function)}(engine, captures, arguments, None)
            }))
        }`;
      }
      case "error": {
        const arguments_ = this.#temporaryName("arguments");
        const fields = this.#temporaryName("fields");
        const error = this.#temporaryName("error");
        const messageIndex = expression.name === "Error" || expression.name === "TypeError" ? 0 : 1;
        return `{
            let ${arguments_} = vec![${expression.arguments.map((argument) => this.#expression(contribution, argument)).join(", ")}];
            let mut ${fields} = BTreeMap::from([${expression.fields
              .map(
                ({ name, value }) =>
                  `(${rustString(name)}.to_owned(), ${this.#expression(contribution, value)})`,
              )
              .join(", ")}]);
            let message = ${fields}.get("message").cloned()
                .or_else(|| ${messageIndex === 0 ? `${arguments_}.first().cloned()` : `${arguments_}.get(${messageIndex}).cloned()`})
                .unwrap_or_else(|| Value::String(${rustString(expression.name)}.to_owned()))
                .string()?;
            ${fields}.insert("arguments".to_owned(), Value::array(${arguments_}));
            let ${error} = NativeError { name: ${rustString(expression.name)}.to_owned(), message, fields: ${fields} };
            Value::Error(Arc::new(${error}))
        }`;
      }
      case "error-match":
        return `Value::Boolean(matches!(${this.#expression(contribution, expression.value)}, Value::Error(error) if error.name == ${rustString(expression.name)}))`;
    }
  }

  #functionName(contribution: string, id: string): string {
    const name = this.#functionIds.get(`${contribution}\0${id}`);
    if (!name) throw new Error(`Portable Function ${JSON.stringify(id)} is not linked.`);
    return name;
  }

  #temporaryName(label: string): string {
    return `temporary_${this.#temporary++}_${rustName(label)}`;
  }
}

function returnCompletion(target: ReturnTarget, value: string): string {
  return target === "function"
    ? `return Ok(${value}),`
    : `return Ok(Completion::Return(${value})),`;
}

function binding(name: string): string {
  return `_binding_${rustName(name)}`;
}

function rustName(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const name = normalized || "value";
  const safe = /^[0-9]/.test(name) ? `value_${name}` : name;
  return rustKeywords.has(safe) ? `${safe}_value` : safe;
}

function rustString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("\\u2028", "\\u{2028}")
    .replaceAll("\\u2029", "\\u{2029}");
}

function literal(value: null | boolean | number | string): string {
  if (value === null) return "Value::Null";
  if (typeof value === "boolean") return `Value::Boolean(${String(value)})`;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "Value::Number(f64::NAN)";
    if (value === Infinity) return "Value::Number(f64::INFINITY)";
    if (value === -Infinity) return "Value::Number(f64::NEG_INFINITY)";
    if (Object.is(value, -0)) return "Value::Number(-0.0)";
    return `Value::Number(${Number.isInteger(value) ? `${value}.0` : value})`;
  }
  return `Value::String(${rustString(value)}.to_owned())`;
}

const rustKeywords = new Set([
  "as",
  "break",
  "const",
  "continue",
  "crate",
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

function canFallThrough(statements: readonly StatementIR[]): boolean {
  return statements.every(statementCanFallThrough);
}

function statementCanFallThrough(statement: StatementIR): boolean {
  if (statement.kind === "return" || statement.kind === "throw") return false;
  if (statement.kind === "if" && statement.alternate.length) {
    return canFallThrough(statement.consequent) || canFallThrough(statement.alternate);
  }
  if (statement.kind === "try" && !canFallThrough(statement.finally)) return false;
  return true;
}
