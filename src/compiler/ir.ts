import type { PresentationSourceIR } from "@/compiler/presentation";

export const POGGERS_IR_VERSION = 16 as const;

/** Serializable meaning owned and versioned by a compiler extension. */
export type ExtensionIR =
  | null
  | boolean
  | number
  | string
  | readonly ExtensionIR[]
  | Readonly<{ [name: string]: ExtensionIR }>;

export type CompilerExtensionsIR = Readonly<Record<string, ExtensionIR>>;

export type SourceSpan = Readonly<{
  file: string;
  line: number;
  column: number;
}>;

export type TypeIR =
  | Readonly<{ kind: "primitive"; name: "boolean" | "null" | "number" | "string" | "void" }>
  | Readonly<{ kind: "opaque"; name: string }>
  | Readonly<{ kind: "literal"; value: boolean | number | string }>
  | Readonly<{ kind: "array"; element: TypeIR }>
  | Readonly<{ kind: "tuple"; elements: readonly TypeIR[] }>
  | Readonly<{ kind: "option"; value: TypeIR }>
  | Readonly<{ kind: "union"; variants: readonly TypeIR[] }>
  | Readonly<{ kind: "record"; fields: readonly FieldIR[] }>
  | Readonly<{ kind: "promise"; value: TypeIR }>
  | Readonly<{ kind: "stream"; element: TypeIR }>
  | Readonly<{ kind: "function"; parameters: readonly FieldIR[]; result: TypeIR }>;

export type FieldIR = Readonly<{
  name: string;
  optional: boolean;
  type: TypeIR;
}>;

export type LiteralIR = null | boolean | number | string;

export type ExpressionValueIR =
  | Readonly<{ kind: "literal"; value: LiteralIR }>
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "error";
      name: string;
      arguments: readonly ExpressionIR[];
      fields: readonly Readonly<{ name: string; value: ExpressionIR }>[];
    }>
  | Readonly<{ kind: "error-match"; value: ExpressionIR; name: string }>
  | Readonly<{ kind: "local"; name: string }>
  | Readonly<{ kind: "array"; values: readonly ExpressionIR[] }>
  | Readonly<{ kind: "record"; fields: readonly Readonly<{ name: string; value: ExpressionIR }>[] }>
  | Readonly<{
      kind: "record-merge";
      entries: readonly (
        | Readonly<{ kind: "field"; name: string; value: ExpressionIR }>
        | Readonly<{ kind: "spread"; value: ExpressionIR }>
      )[];
    }>
  | Readonly<{ kind: "property"; value: ExpressionIR; name: string; optional?: true }>
  | Readonly<{
      kind: "binary";
      operator:
        | "+"
        | "-"
        | "*"
        | "/"
        | "%"
        | "==="
        | "!=="
        | "<"
        | "<="
        | ">"
        | ">="
        | "&&"
        | "||"
        | "??";
      left: ExpressionIR;
      right: ExpressionIR;
    }>
  | Readonly<{ kind: "unary"; operator: "!" | "-" | "present"; value: ExpressionIR }>
  | Readonly<{
      kind: "call";
      function: string;
      arguments: readonly ExpressionIR[];
      awaited: boolean;
    }>
  | Readonly<{
      kind: "invoke";
      callee: ExpressionIR;
      arguments: readonly ExpressionIR[];
      awaited: boolean;
    }>
  | Readonly<{
      kind: "method-call";
      receiver: ExpressionIR;
      method: string;
      arguments: readonly ExpressionIR[];
    }>
  | Readonly<{ kind: "json-parse"; value: ExpressionIR }>
  | Readonly<{ kind: "json-stringify"; value: ExpressionIR }>
  | Readonly<{ kind: "to-string"; value: ExpressionIR }>
  | Readonly<{
      kind: "stream-map";
      source: ExpressionIR;
      transform: ExpressionIR;
    }>
  | Readonly<{
      kind: "closure";
      function: string;
      captures: readonly ExpressionIR[];
    }>
  | Readonly<{
      kind: "conditional";
      condition: ExpressionIR;
      consequent: ExpressionIR;
      alternate: ExpressionIR;
    }>
  | Readonly<{
      kind: "dependency-call";
      dependency: string;
      operation: string;
      arguments: readonly ExpressionIR[];
      awaited: boolean;
    }>;

/** A typed executable value with an exact authoring location. */
export type ExpressionIR = Readonly<{
  type: TypeIR;
  span: SourceSpan;
}> &
  ExpressionValueIR;

export type StatementIR =
  | Readonly<{
      kind: "let";
      name: string;
      mutable: boolean;
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "assign";
      name: string;
      operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=";
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{ kind: "expression"; expression: ExpressionIR; span: SourceSpan }>
  | Readonly<{ kind: "array-push"; array: string; value: ExpressionIR; span: SourceSpan }>
  | Readonly<{
      kind: "throw";
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "if";
      condition: ExpressionIR;
      consequent: readonly StatementIR[];
      alternate: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "for-of";
      asynchronous?: true;
      item: string;
      values: ExpressionIR;
      body: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "for-range";
      item: string;
      from: ExpressionIR;
      to: ExpressionIR;
      body: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "try";
      body: readonly StatementIR[];
      error?: string;
      catch: readonly StatementIR[];
      finally: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{ kind: "return"; value?: ExpressionIR; span: SourceSpan }>;

export type FunctionIR = Readonly<{
  id: string;
  name: string;
  asynchronous: boolean;
  captures: readonly FieldIR[];
  parameters: readonly FieldIR[];
  result: TypeIR;
  body: readonly StatementIR[];
  span: SourceSpan;
}>;

export type ProgramImplementationIR =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "portable"; start: FunctionIR; functions: readonly FunctionIR[] }>
  | Readonly<{
      kind: "source";
      reason: "host-source" | "platform-ui";
      diagnostic?: Readonly<{ message: string; span: SourceSpan }>;
      span: SourceSpan;
    }>;

export type DependencyIR = Readonly<{
  name: string;
  type: TypeIR;
}>;

export type DependencyOperationIR = Readonly<{
  name: string;
  mode: "asynchronous" | "stream" | "synchronous";
  input: TypeIR;
  output: TypeIR;
}>;

/** Minimal compiler-derived contract required by a running host binding. */
export type DependencyContractIR = Readonly<{
  name: string;
  operations: readonly DependencyOperationIR[];
}>;

export type ComponentIR = Readonly<{
  name: string;
  propCallbacks: readonly string[];
  state: TypeIR;
  actions: readonly string[];
  elements: readonly Readonly<{ name: string; element: string }>[];
  implementation: Readonly<{
    state: boolean;
    actions: boolean;
    mount: boolean;
    view: boolean;
  }>;
}>;

export type ProgramContributionIR = Readonly<{
  id: string;
  feature: string;
  requires: readonly DependencyIR[];
  provides: readonly DependencyIR[];
  ui?: Readonly<{
    state: TypeIR;
    actions: readonly string[];
    components: readonly ComponentIR[];
    root?: string;
  }>;
  implementation: ProgramImplementationIR;
  extensions?: CompilerExtensionsIR;
  span: SourceSpan;
}>;

/** One independently realizable Program assembled from same-named Feature contributions. */
export type ProgramIR = Readonly<{
  id: string;
  name: string;
  environment: Readonly<{ name: string; platform: string; ui?: string }>;
  contributions: readonly ProgramContributionIR[];
  ui?: Readonly<{ root: Readonly<{ feature: string; component: string }> }>;
}>;

export type LinkedProgramContributionIR = Readonly<{
  contribution: ProgramContributionIR;
  dependencies: readonly string[];
}>;

export type LinkedDependencyIR = Readonly<{
  name: string;
  type: TypeIR;
  consumers: readonly string[];
  provider?: string;
}>;

/** Canonical, backend-independent result of linking every contribution to one Program. */
export type LinkedProgramIR = Readonly<{
  program: ProgramIR;
  contributions: readonly LinkedProgramContributionIR[];
  dependencies: readonly LinkedDependencyIR[];
  external: readonly DependencyIR[];
}>;

/** Compiler-derived dependency meaning for one Feature contribution. */
export type ProgramContributionManifest = Readonly<{
  feature: string;
  requires: readonly string[];
  provides: readonly string[];
}>;

/** Serializable dependency graph consumed by a Process runtime. */
export type ProgramManifest = Readonly<{
  name: string;
  contributions: readonly ProgramContributionManifest[];
}>;

export type FeatureIR = Readonly<{
  id: string;
  path: string;
  children: readonly string[];
  programs: readonly string[];
  extensions?: CompilerExtensionsIR;
}>;

export type ApplicationIR = Readonly<{
  version: typeof POGGERS_IR_VERSION;
  application: Readonly<{
    id: string;
    name: string;
    presentations: readonly string[];
    extensions?: CompilerExtensionsIR;
  }>;
  platforms: readonly string[];
  features: readonly FeatureIR[];
  programs: readonly ProgramIR[];
  presentations: readonly PresentationSourceIR[];
}>;

export function serializeApplicationIR(ir: ApplicationIR): string {
  assertApplicationIRVersion(ir);
  return `${JSON.stringify(ir, undefined, 2)}\n`;
}

export function assertApplicationIRVersion(
  ir: Pick<ApplicationIR, "version">,
): asserts ir is ApplicationIR {
  if (ir.version !== POGGERS_IR_VERSION) {
    throw new Error(`Unsupported Poggers IR version ${String(ir.version)}.`);
  }
}
