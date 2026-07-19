export const POGGERS_IR_VERSION = 3 as const;

export type SourceSpan = Readonly<{
  file: string;
  line: number;
  column: number;
}>;

export type TypeIR =
  | Readonly<{ kind: "primitive"; name: "boolean" | "number" | "string" | "void" }>
  | Readonly<{ kind: "literal"; value: boolean | number | string }>
  | Readonly<{ kind: "array"; element: TypeIR }>
  | Readonly<{ kind: "tuple"; elements: readonly TypeIR[] }>
  | Readonly<{ kind: "option"; value: TypeIR }>
  | Readonly<{ kind: "union"; variants: readonly TypeIR[] }>
  | Readonly<{ kind: "record"; fields: readonly FieldIR[] }>
  | Readonly<{ kind: "promise"; value: TypeIR }>
  | Readonly<{ kind: "function"; parameters: readonly FieldIR[]; result: TypeIR }>;

export type FieldIR = Readonly<{
  name: string;
  optional: boolean;
  type: TypeIR;
}>;

export type LiteralIR = null | boolean | number | string;

export type ExpressionIR =
  | Readonly<{ kind: "literal"; value: LiteralIR }>
  | Readonly<{ kind: "local"; name: string }>
  | Readonly<{ kind: "array"; values: readonly ExpressionIR[] }>
  | Readonly<{ kind: "record"; fields: readonly Readonly<{ name: string; value: ExpressionIR }>[] }>
  | Readonly<{ kind: "property"; value: ExpressionIR; name: string }>
  | Readonly<{
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "%" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "&&" | "||";
      left: ExpressionIR;
      right: ExpressionIR;
    }>
  | Readonly<{ kind: "unary"; operator: "!" | "-"; value: ExpressionIR }>
  | Readonly<{
      kind: "capability-call";
      capability: string;
      operation: string;
      arguments: readonly ExpressionIR[];
      awaited: boolean;
    }>;

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
      operator: "=" | "+=" | "-=" | "*=" | "/=";
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{ kind: "expression"; expression: ExpressionIR; span: SourceSpan }>
  | Readonly<{
      kind: "if";
      condition: ExpressionIR;
      consequent: readonly StatementIR[];
      alternate: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "for-of";
      item: string;
      values: ExpressionIR;
      body: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{ kind: "return"; value?: ExpressionIR; span: SourceSpan }>;

export type FunctionIR = Readonly<{
  asynchronous: boolean;
  body: readonly StatementIR[];
  span: SourceSpan;
}>;

export type CapabilityIR = Readonly<{
  name: string;
  type: TypeIR;
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

export type ProgramIR = Readonly<{
  id: string;
  feature: string;
  name: string;
  environment: Readonly<{ name: string; uiPlatform?: string }>;
  requires: readonly CapabilityIR[];
  provides: readonly CapabilityIR[];
  ui?: Readonly<{
    state: TypeIR;
    actions: readonly string[];
    components: readonly ComponentIR[];
    root?: string;
  }>;
  start?: FunctionIR;
  span: SourceSpan;
}>;

export type FeatureIR = Readonly<{
  id: string;
  path: string;
  children: readonly string[];
  programs: readonly string[];
}>;

export type ApplicationIR = Readonly<{
  version: typeof POGGERS_IR_VERSION;
  application: Readonly<{
    id: string;
    name: string;
    presentations: readonly string[];
  }>;
  features: readonly FeatureIR[];
  programs: readonly ProgramIR[];
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
