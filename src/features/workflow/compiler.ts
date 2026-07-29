import { createHash } from "node:crypto";
import { resolve } from "node:path";

import * as ts from "@typescript/typescript6";

import type {
  FeatureSourceContext,
  PortableCallSourceContext,
  PortableConstantSourceContext,
  SourceCompilerAPI,
  SourceCompilerExtension,
} from "@/compiler/extension";
import type {
  ExtensionIR,
  ExpressionIR,
  FunctionIR,
  SourceSpan,
  StatementIR,
  TypeIR,
} from "@/compiler/ir";
import { compileSystemSources } from "@/compiler/source";
import type { TypeSchema } from "@/core/intrinsic";
import {
  validateWorkflowDefinitionIR,
  WORKFLOW_EXECUTABLE_VERSION,
  WORKFLOW_IR_VERSION,
  WORKFLOW_LANGUAGE_VERSION,
  type WorkflowArtifact,
  type WorkflowDefinitionIR,
  type WorkflowExecutableBlock,
  type WorkflowExecutableDefinition,
  type WorkflowExecutableExpression,
  type WorkflowExecutableExpressionOperation,
  type WorkflowExecutableInstruction,
  type WorkflowExecutableProcedure,
  type WorkflowExecutableTerminator,
  type WorkflowIRBlock,
  type WorkflowIRExpression,
  type WorkflowIRInstruction,
  type WorkflowIRProcedure,
  type WorkflowIRSourceSpan,
  type WorkflowIRTerminator,
} from "@/features/workflow/ir";

const WORKFLOW_COMPILER = "kit/workflow:1";

/**
 * Compiles one runtime-authored Workflow module without evaluating it.
 *
 * The caller supplies the Platform extensions required by the Workflow
 * Feature's ordinary Programs. The Workflow extension remains the sole owner
 * of Workflow meaning.
 */
export function compileWorkflowSource(
  source: string,
  extensions: readonly SourceCompilerExtension[],
): WorkflowArtifact {
  assertWorkflowSourceModule(source);
  const directory = resolve(import.meta.dirname, "../../../.kit-virtual/workflow");
  const definition = resolve(directory, "definition.ts");
  const system = resolve(directory, "system.ts");
  const ir = compileSystemSources(
    system,
    {
      [definition]:
        'import type { Dependency } from "@/core/dependency";\n' +
        'import { createWorkflow, type Workflow } from "@/features/workflow";\n' +
        source,
      [system]:
        'import { createSystem } from "@/core/system";\n' +
        'import workflow from "./definition";\n' +
        "export default createSystem({ features: { workflow } });\n",
    },
    [...extensions, workflowCompilerExtension],
  );
  const feature = ir.features.find(({ path }) => path === "workflow");
  if (feature === undefined) {
    throw new TypeError("Runtime-authored source must export one Workflow definition.");
  }
  return workflowArtifactIR(workflowCompilerIR(feature.extensions?.workflow));
}

function assertWorkflowSourceModule(source: string): void {
  const file = ts.createSourceFile("workflow.ts", source, ts.ScriptTarget.ESNext, true);
  let invalid: ts.Node | undefined;
  const inspect = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)
    ) {
      invalid ??= node;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(file);
  if (invalid !== undefined) {
    const position = file.getLineAndCharacterOfPosition(invalid.getStart(file));
    throw new TypeError(
      `Runtime-authored Workflow source cannot import modules (${position.line + 1}:${
        position.character + 1
      }).`,
    );
  }
}

/** Feature-owned source lowering. The generic compiler only retains its JSON result. */
export const workflowCompilerExtension: SourceCompilerExtension = Object.freeze({
  name: "workflow",
  cacheSources: [import.meta.filename],
  feature(context) {
    const model = workflowModel(context);
    if (!model) return undefined;
    const call = workflowCall(context);
    const definition =
      context.source.object(call.arguments[0]) ??
      context.source.fail(call, "Workflow implementation must be a statically known object.");
    return compileWorkflowDefinition(context, model, definition) as unknown as ExtensionIR;
  },
  constant(context) {
    if (workflowDependencyCatalogueCall(context)) {
      const call = context.call;
      const typeArgument =
        call.typeArguments?.[0] ??
        context.source.fail(call, "Workflow Dependency catalogue requires one type.");
      if (context.awaited || call.arguments.length !== 0) {
        context.source.fail(call, "Workflow Dependency catalogue requires one type and no values.");
      }
      const model = context.resolve(context.checker.getTypeFromTypeNode(typeArgument));
      const dependencyProperty =
        context.checker.getPropertyOfType(model, "Dependencies") ??
        context.source.fail(call, "Workflow registry model has no Dependencies.");
      const dependencies = context.source.dependencies(
        context.resolve(context.checker.getTypeOfSymbolAtLocation(dependencyProperty, call)),
        call,
      );
      return Object.fromEntries(
        dependencies.map(({ name, type }) => [name, canonicalWorkflowValue(type) as ExtensionIR]),
      );
    }
    if (!workflowRuntimeIRCall(context)) return undefined;
    const call = context.call;
    const typeArgument =
      call.typeArguments?.[0] ??
      context.source.fail(call, "Workflow runtime meaning requires one model type.");
    if (context.awaited || call.arguments.length !== 1) {
      context.source.fail(
        call,
        "Workflow runtime meaning requires one model type and one implementation value.",
      );
    }
    const model = context.resolve(context.checker.getTypeFromTypeNode(typeArgument));
    const definition =
      context.source.object(call.arguments[0]) ??
      context.source.fail(
        call.arguments[0]!,
        "Workflow implementation must remain statically known.",
      );
    return workflowArtifactIR(
      compileWorkflowDefinition(context, model, definition),
    ) as unknown as ExtensionIR;
  },
  call(context) {
    const advance = workflowRuntimeAdvanceCall(context);
    const transfer = workflowRuntimeTransferCall(context);
    if (!advance && !transfer) return undefined;
    const call = context.call;
    const typeArgument =
      call.typeArguments?.[0] ??
      context.source.fail(call, "Workflow runtime transition requires one model type.");
    const expectedArguments = transfer ? 3 : 2;
    if (context.awaited || call.arguments.length !== expectedArguments) {
      context.source.fail(
        call,
        transfer
          ? "Workflow runtime transfer requires one model type, one implementation, one execution frame, and one transfer."
          : "Workflow runtime advancement requires one model type, one implementation, and one execution frame.",
      );
    }
    const model = context.resolve(context.checker.getTypeFromTypeNode(typeArgument));
    const implementation =
      context.source.object(call.arguments[0]) ??
      context.source.fail(
        call.arguments[0]!,
        "Workflow implementation must remain statically known.",
      );
    const definition = compileWorkflowDefinition(context, model, implementation);
    const execution = context.lower(call.arguments[1]!);
    const transition = transfer ? context.lower(call.arguments[2]!) : undefined;
    const function_ = transfer
      ? lowerWorkflowTransferFunctionIR(
          definition,
          execution.type,
          transition!.type,
          context.type,
          context.span,
        )
      : lowerWorkflowAdvanceFunctionIR(definition, execution.type, context.type, context.span);
    return {
      expression: {
        kind: "call",
        function: function_.id,
        arguments: transfer ? [execution, transition!] : [execution],
        awaited: false,
        type: context.type,
        span: context.span,
      },
      functions: [function_],
    };
  },
  validate(ir) {
    for (const feature of ir.features) {
      const extension = feature.extensions?.workflow;
      if (extension !== undefined) workflowCompilerIR(extension);
    }
  },
});

type WorkflowDefinitionSourceContext = Readonly<{
  checker: ts.TypeChecker;
  source: SourceCompilerAPI;
}>;

function compileWorkflowDefinition(
  context: WorkflowDefinitionSourceContext,
  model: ts.Type,
  definition: ts.ObjectLiteralExpression,
): WorkflowDefinitionIR {
  const state =
    context.source.callable(definition, "state") ??
    context.source.fail(definition, "Workflow implementation requires state.");
  const run =
    context.source.callable(definition, "run") ??
    context.source.fail(definition, "Workflow implementation requires run.");
  const contract = workflowContractIR(context, model, definition);
  const statePortable = context.source.portable(state, {
    id: `workflow/${contract.name}/state`,
    name: "state",
  });
  const runPortable = context.source.portable(run, {
    id: `workflow/${contract.name}/run`,
    name: "run",
  });
  const actions = context.source.object(context.source.resolveMember(definition, "actions"));
  if (!actions) {
    context.source.fail(definition, "Workflow implementation requires static Actions.");
  }
  const actionHandlers: Record<string, WorkflowIRProcedure> = {};
  for (const name of Object.keys(contract.actions).sort()) {
    const action =
      context.source.callable(actions, name) ??
      context.source.fail(actions, `Workflow Action ${JSON.stringify(name)} is missing.`);
    const portable = context.source.portable(action, {
      id: `workflow/${contract.name}/action/${name}`,
      name,
    });
    actionHandlers[name] = lowerWorkflowProcedureIR(
      portable.entry,
      portable.functions,
      contract.children,
      "action",
    );
  }
  try {
    return lowerWorkflowRunIR(
      contract,
      runPortable.entry,
      runPortable.functions,
      lowerWorkflowProcedureIR(
        statePortable.entry,
        statePortable.functions,
        contract.children,
        "initialization",
      ),
      actionHandlers,
    );
  } catch (error) {
    context.source.fail(
      run,
      error instanceof Error ? error.message : "Workflow definition lowering failed.",
    );
  }
}

/** Recovers and validates Workflow-owned meaning from one generic Feature extension field. */
export function workflowCompilerIR(value: ExtensionIR | undefined): WorkflowDefinitionIR {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Missing Workflow compiler meaning.");
  }
  return validateWorkflowDefinitionIR(value as unknown as WorkflowDefinitionIR);
}

/** Creates the immutable content address persisted by one Workflow execution. */
export function workflowArtifactIR(definition: WorkflowDefinitionIR): WorkflowArtifact {
  const validated = validateWorkflowDefinitionIR(definition);
  const canonicalDependencies = Object.fromEntries(
    Object.entries(validated.contract.dependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, type]) => [name, canonicalWorkflowValue(type) as TypeIR]),
  );
  const canonicalDefinition: WorkflowDefinitionIR = {
    ...validated,
    contract: {
      ...validated.contract,
      dependencies: canonicalDependencies,
    },
  };
  const executable = workflowExecutableIR(canonicalDefinition);
  return {
    id: `sha256:${createHash("sha256")
      .update(
        canonicalWorkflowJSON({
          version: canonicalDefinition.version,
          language: canonicalDefinition.language,
          compiler: canonicalDefinition.compiler,
          contract: canonicalDefinition.contract,
          executable,
        }),
      )
      .digest("hex")}`,
    definition: canonicalDefinition,
    executable,
  };
}

/** Generates the typed, data-only virtual module used to control one dynamic definition. */
export function workflowControllerSource(artifact: WorkflowArtifact): string {
  const canonical = workflowArtifactIR(artifact.definition);
  if (canonical.id !== artifact.id) {
    throw new TypeError("Workflow controller artifact identity is invalid.");
  }
  const contract = canonical.definition.contract;
  const actions = Object.entries(contract.actions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, action]) =>
        `${JSON.stringify(name)}: Workflow.Action<` +
        `${workflowTypeSource(action.input)}, ${workflowTypeSource(action.result)}, ` +
        `${workflowTypeSource(action.failures)}>;`,
    )
    .join("\n    ");
  return (
    'import type { Workflow } from "kit/features/workflow";\n\n' +
    "type Definition = Workflow<{\n" +
    `  Name: ${JSON.stringify(contract.name)};\n` +
    "  Id: string;\n" +
    `  Input: ${workflowTypeSource(contract.input)};\n` +
    `  State: ${workflowTypeSource(contract.state)};\n` +
    `  Result: ${workflowTypeSource(contract.result)};\n` +
    `  Revision: ${contract.revision};\n` +
    "  Dependencies: Record<never, never>;\n" +
    `  Actions: {\n    ${actions}\n  };\n` +
    `  Failures: ${workflowTypeSource(contract.failures)};\n` +
    "  Visibility: Record<never, never>;\n" +
    "}>;\n\n" +
    "const definition = {\n" +
    `  name: ${JSON.stringify(contract.name)},\n` +
    `  artifact: ${JSON.stringify(canonical.id)},\n` +
    "} as Workflow.DynamicDefinition<Definition>;\n" +
    "export default definition;\n"
  );
}

function workflowTypeSource(schema: TypeSchema): string {
  return workflowTypeIRSource(schema as unknown as TypeIR);
}

function workflowTypeIRSource(type: TypeIR): string {
  switch (type.kind) {
    case "primitive":
      return type.name === "void" ? "undefined" : type.name;
    case "opaque":
      return "unknown";
    case "literal":
      return JSON.stringify(type.value);
    case "array":
      return `readonly (${workflowTypeIRSource(type.element)})[]`;
    case "tuple":
      return `readonly [${type.elements.map(workflowTypeIRSource).join(", ")}]`;
    case "option":
      return `${workflowTypeIRSource(type.value)} | undefined`;
    case "union":
      return type.variants.map(workflowTypeIRSource).join(" | ");
    case "record":
      return type.fields.length === 0
        ? "Record<never, never>"
        : `Readonly<{ ${type.fields
            .map(
              (field) =>
                `${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ` +
                `${workflowTypeIRSource(field.type)};`,
            )
            .join(" ")} }>`;
    case "promise":
      return `Promise<${workflowTypeIRSource(type.value)}>`;
    case "stream":
      return `AsyncIterable<${workflowTypeIRSource(type.element)}>`;
    case "function":
      return `(${type.parameters
        .map(
          (parameter, index) =>
            `${parameter.name || `argument${index}`}${parameter.optional ? "?" : ""}: ` +
            `${workflowTypeIRSource(parameter.type)}`,
        )
        .join(", ")}) => ${workflowTypeIRSource(type.result)}`;
  }
}

/** Derives the non-recursive execution bytecode carried by static and dynamic artifacts. */
export function workflowExecutableIR(
  definition: WorkflowDefinitionIR,
): WorkflowExecutableDefinition {
  const validated = validateWorkflowDefinitionIR(definition);
  return {
    version: WORKFLOW_EXECUTABLE_VERSION,
    revision: validated.contract.revision,
    initialization: executableWorkflowProcedure(validated.initialization),
    actionHandlers: Object.fromEntries(
      Object.entries(validated.actionHandlers).map(([name, procedure]) => [
        name,
        executableWorkflowProcedure(procedure),
      ]),
    ),
    run: executableWorkflowProcedure({
      entry: validated.entry,
      blocks: validated.blocks,
    }),
  };
}

function executableWorkflowProcedure(procedure: WorkflowIRProcedure): WorkflowExecutableProcedure {
  return {
    entry: procedure.entry,
    blocks: procedure.blocks.map(executableWorkflowBlock),
  };
}

function executableWorkflowBlock(block: WorkflowIRBlock): WorkflowExecutableBlock {
  return {
    id: block.id,
    body: block.body.map(executableWorkflowInstruction),
    terminator: executableWorkflowTerminator(block.terminator),
  };
}

function executableWorkflowInstruction(
  instruction: WorkflowIRInstruction,
): WorkflowExecutableInstruction {
  if (instruction.kind === "let") {
    return {
      kind: instruction.kind,
      name: instruction.name,
      value: executableWorkflowExpression(instruction.value),
    };
  }
  if (instruction.kind === "assign") {
    return {
      kind: instruction.kind,
      name: instruction.name,
      operator: instruction.operator,
      value: executableWorkflowExpression(instruction.value),
    };
  }
  return {
    kind: instruction.kind,
    path: instruction.path,
    operator: instruction.operator,
    value: executableWorkflowExpression(instruction.value),
  };
}

function executableWorkflowTerminator(
  terminator: WorkflowIRTerminator,
): WorkflowExecutableTerminator {
  if (terminator.kind === "jump") {
    return { kind: terminator.kind, next: terminator.next };
  }
  if (terminator.kind === "branch") {
    return {
      kind: terminator.kind,
      condition: executableWorkflowExpression(terminator.condition),
      consequent: terminator.consequent,
      alternate: terminator.alternate,
    };
  }
  if (terminator.kind === "effect" || terminator.kind === "child") {
    return {
      kind: terminator.kind,
      dependency: terminator.dependency,
      operation: terminator.operation,
      input: executableWorkflowExpression(terminator.input),
      ...(terminator.options === undefined
        ? {}
        : { options: executableWorkflowExpression(terminator.options) }),
      result: terminator.result,
      next: terminator.next,
    };
  }
  if (terminator.kind === "sleep") {
    return {
      kind: terminator.kind,
      timing: {
        kind: terminator.timing.kind,
        value: executableWorkflowExpression(terminator.timing.value),
      },
      next: terminator.next,
    };
  }
  if (terminator.kind === "wait") {
    return {
      kind: terminator.kind,
      condition: executableWorkflowExpression(terminator.condition),
      conditionIR: terminator.condition,
      ...(terminator.timeout === undefined
        ? {}
        : {
            timeout: {
              kind: terminator.timeout.kind,
              value: executableWorkflowExpression(terminator.timeout.value),
            },
          }),
      result: terminator.result,
      next: terminator.next,
    };
  }
  if (terminator.kind === "concurrent") {
    return {
      kind: terminator.kind,
      operation: terminator.operation,
      effects: terminator.effects.map((effect) => ({
        dependency: effect.dependency,
        operation: effect.operation,
        input: executableWorkflowExpression(effect.input),
        ...(effect.options === undefined
          ? {}
          : { options: executableWorkflowExpression(effect.options) }),
      })),
      result: terminator.result,
      next: terminator.next,
    };
  }
  if (terminator.kind === "enter-scope") {
    return {
      kind: terminator.kind,
      id: terminator.id,
      cancellable: terminator.cancellable,
      body: terminator.body,
      ...(terminator.catch === undefined ? {} : { catch: terminator.catch }),
      ...(terminator.cleanup === undefined ? {} : { cleanup: terminator.cleanup }),
      ...(terminator.next === undefined ? {} : { next: terminator.next }),
    };
  }
  if (terminator.kind === "leave-scope" || terminator.kind === "complete-cleanup") {
    return { kind: terminator.kind };
  }
  if (terminator.kind === "continue-as-new") {
    return {
      kind: terminator.kind,
      input: executableWorkflowExpression(terminator.input),
    };
  }
  return {
    kind: terminator.kind,
    value: executableWorkflowExpression(terminator.value),
  };
}

function executableWorkflowExpression(
  expression: WorkflowIRExpression,
): WorkflowExecutableExpression {
  const operations: WorkflowExecutableExpressionOperation[] = [];
  emitWorkflowExpression(expression, operations);
  return operations;
}

function emitWorkflowExpression(
  expression: WorkflowIRExpression,
  operations: WorkflowExecutableExpressionOperation[],
): void {
  if (expression.kind === "literal") {
    operations.push({ kind: expression.kind, value: expression.value });
    return;
  }
  if (expression.kind === "none" || expression.kind === "time") {
    operations.push({ kind: expression.kind });
    return;
  }
  if (
    expression.kind === "identity" ||
    expression.kind === "invocation" ||
    expression.kind === "input" ||
    expression.kind === "state" ||
    expression.kind === "history"
  ) {
    operations.push({
      kind: "read",
      source: expression.kind,
      path: expression.path,
    });
    return;
  }
  if (expression.kind === "local") {
    operations.push({ kind: expression.kind, name: expression.name });
    return;
  }
  if (expression.kind === "array") {
    for (const value of expression.values) emitWorkflowExpression(value, operations);
    operations.push({ kind: expression.kind, count: expression.values.length });
    return;
  }
  if (expression.kind === "record") {
    for (const field of expression.fields) emitWorkflowExpression(field.value, operations);
    operations.push({
      kind: expression.kind,
      fields: expression.fields.map(({ name }) => name),
    });
    return;
  }
  if (expression.kind === "record-merge") {
    for (const entry of expression.entries) emitWorkflowExpression(entry.value, operations);
    operations.push({
      kind: expression.kind,
      entries: expression.entries.map((entry) =>
        entry.kind === "field" ? { kind: entry.kind, name: entry.name } : { kind: entry.kind },
      ),
    });
    return;
  }
  if (expression.kind === "property") {
    emitWorkflowExpression(expression.value, operations);
    operations.push({ kind: expression.kind, name: expression.name });
    return;
  }
  if (expression.kind === "index") {
    emitWorkflowExpression(expression.value, operations);
    emitWorkflowExpression(expression.index, operations);
    operations.push({ kind: expression.kind });
    return;
  }
  if (expression.kind === "unary") {
    emitWorkflowExpression(expression.value, operations);
    operations.push({ kind: expression.kind, operator: expression.operator });
    return;
  }
  if (expression.kind === "conditional") {
    emitWorkflowExpression(expression.condition, operations);
    const alternate = operations.length;
    operations.push({
      kind: "branch",
      condition: "falsy",
      target: 0,
      keep: false,
    });
    emitWorkflowExpression(expression.consequent, operations);
    const completed = operations.length;
    operations.push({ kind: "jump", target: 0 });
    operations[alternate] = {
      kind: "branch",
      condition: "falsy",
      target: operations.length,
      keep: false,
    };
    emitWorkflowExpression(expression.alternate, operations);
    operations[completed] = { kind: "jump", target: operations.length };
    return;
  }
  emitWorkflowExpression(expression.left, operations);
  if (
    expression.operator === "&&" ||
    expression.operator === "||" ||
    expression.operator === "??"
  ) {
    const branch = operations.length;
    operations.push({
      kind: "branch",
      condition:
        expression.operator === "&&"
          ? "falsy"
          : expression.operator === "||"
            ? "truthy"
            : "present",
      target: 0,
      keep: true,
    });
    emitWorkflowExpression(expression.right, operations);
    operations[branch] = {
      kind: "branch",
      condition:
        expression.operator === "&&"
          ? "falsy"
          : expression.operator === "||"
            ? "truthy"
            : "present",
      target: operations.length,
      keep: true,
    };
    return;
  }
  emitWorkflowExpression(expression.right, operations);
  operations.push({ kind: "binary", operator: expression.operator });
}

function canonicalWorkflowJSON(value: unknown): string {
  return JSON.stringify(canonicalWorkflowValue(value));
}

function canonicalWorkflowValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalWorkflowValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, child]) => [name, canonicalWorkflowValue(child)]),
  );
}

/** Lowers neutral portable function meaning into resumable Workflow basic blocks. */
export function lowerWorkflowRunIR(
  contract: WorkflowDefinitionIR["contract"],
  run: FunctionIR,
  functions: readonly FunctionIR[],
  initialization: WorkflowIRProcedure,
  actionHandlers: Readonly<Record<string, WorkflowIRProcedure>>,
): WorkflowDefinitionIR {
  if (!run.asynchronous) {
    // Synchronous Workflows remain valid; the same state machine simply reaches
    // a terminal block without suspending.
  }
  if (run.captures.length) {
    throw workflowLoweringError(run.span, "Workflow run cannot capture ambient values.");
  }
  if (run.parameters.length !== 1) {
    throw workflowLoweringError(run.span, "Workflow run requires one semantic context parameter.");
  }
  const lowering = new WorkflowRunLowering(run, functions, contract.children, "run");
  const definition: WorkflowDefinitionIR = {
    version: WORKFLOW_IR_VERSION,
    language: WORKFLOW_LANGUAGE_VERSION,
    compiler: WORKFLOW_COMPILER,
    contract,
    initialization,
    actionHandlers,
    entry: lowering.entry,
    blocks: lowering.lower(),
  };
  return validateWorkflowDefinitionIR(definition);
}

function lowerWorkflowProcedureIR(
  procedure: FunctionIR,
  functions: readonly FunctionIR[],
  children: readonly string[],
  kind: "initialization" | "action",
): WorkflowIRProcedure {
  const lowering = new WorkflowRunLowering(procedure, functions, children, kind);
  return {
    entry: lowering.entry,
    blocks: lowering.lower(),
  };
}

type WorkflowBinding =
  | WorkflowIRExpression
  | Readonly<{
      kind:
        | "dependencies"
        | "time-service"
        | "wait-service"
        | "fail-service"
        | "shield-service"
        | "continue-service";
    }>
  | Readonly<{
      kind: "dependency-reference";
      dependency: string;
      binding: WorkflowIRExpression;
    }>;

type WorkflowSuspension =
  | Readonly<{
      kind: "effect";
      dependency: string;
      operation: string;
      input: WorkflowIRExpression;
      options?: WorkflowIRExpression;
    }>
  | Readonly<{
      kind: "child";
      dependency: string;
      operation: string;
      input: WorkflowIRExpression;
      options?: WorkflowIRExpression;
    }>
  | Readonly<{
      kind: "sleep";
      timing:
        | Readonly<{ kind: "for"; value: WorkflowIRExpression }>
        | Readonly<{ kind: "until"; value: WorkflowIRExpression }>;
    }>
  | Readonly<{
      kind: "wait";
      condition: WorkflowIRExpression;
      timeout?:
        | Readonly<{ kind: "for"; value: WorkflowIRExpression }>
        | Readonly<{ kind: "until"; value: WorkflowIRExpression }>;
    }>
  | Readonly<{
      kind: "concurrent";
      operation: "all" | "all-settled" | "race";
      effects: readonly Readonly<{
        kind: "effect";
        dependency: string;
        operation: string;
        input: WorkflowIRExpression;
        options?: WorkflowIRExpression;
      }>[];
    }>;

type ExtractedExpression = Readonly<{
  value: WorkflowIRExpression;
  suspension?: WorkflowSuspension;
}>;

class WorkflowRunLowering {
  readonly entry = "block/0";
  readonly #functions: ReadonlyMap<string, FunctionIR>;
  readonly #children: ReadonlySet<string>;
  readonly #bindings = new Map<string, WorkflowBinding>();
  readonly #blocks: WorkflowIRBlock[] = [];
  #body: WorkflowIRInstruction[] = [];
  #block = this.entry;
  #blockIndex = 1;
  #temporary = 0;
  #scopeIndex = 0;
  #closed = false;

  constructor(
    readonly run: FunctionIR,
    functions: readonly FunctionIR[],
    children: readonly string[],
    readonly kind: "initialization" | "action" | "run",
  ) {
    this.#functions = new Map(functions.map((function_) => [function_.id, function_]));
    this.#children = new Set(children);
    this.#bindings.set("id", { kind: "identity", path: [] });
    this.#bindings.set("input", { kind: "input", path: [] });
    if (kind !== "initialization") {
      this.#bindings.set("state", { kind: "state", path: [] });
      this.#bindings.set("fail", { kind: "fail-service" });
    }
    if (kind === "action") {
      this.#bindings.set("invocation", { kind: "invocation", path: [] });
    }
    if (kind === "run") {
      this.#bindings.set("dependencies", { kind: "dependencies" });
      this.#bindings.set("history", { kind: "history", path: [] });
      this.#bindings.set("time", { kind: "time-service" });
      this.#bindings.set("wait", { kind: "wait-service" });
      this.#bindings.set("shield", { kind: "shield-service" });
      this.#bindings.set("continueAsNew", { kind: "continue-service" });
    }
  }

  lower(): readonly WorkflowIRBlock[] {
    for (const statement of this.run.body) this.#statement(statement);
    if (!this.#closed) {
      throw workflowLoweringError(this.run.span, "Workflow run must return a Result or fail.");
    }
    return this.#blocks;
  }

  #statement(statement: StatementIR): void {
    if (this.#closed) {
      throw workflowLoweringError(statement.span, "Workflow run contains unreachable statements.");
    }
    if (statement.kind === "let") {
      if (this.#contextBinding(statement)) return;
      if (statement.value.kind === "dependency-reference") {
        this.#bindings.set(statement.name, {
          kind: "dependency-reference",
          dependency: statement.value.dependency,
          binding: this.#plainExpression(statement.value.binding),
        });
        return;
      }
      const temporary = this.#temporaryName(statement.name);
      const extracted = this.#expression(statement.value, temporary);
      if (extracted.suspension) {
        this.#suspend(extracted.suspension, temporary, statement.span);
      }
      if (
        !extracted.suspension ||
        extracted.value.kind !== "local" ||
        temporary !== statement.name
      ) {
        this.#body.push({
          kind: "let",
          name: statement.name,
          value: extracted.value,
          span: statement.span,
        });
      }
      return;
    }
    if (statement.kind === "assign") {
      const temporary = this.#temporaryName();
      const extracted = this.#expression(statement.value, temporary);
      if (extracted.suspension) this.#suspend(extracted.suspension, temporary, statement.span);
      this.#body.push({
        kind: "assign",
        name: statement.name,
        operator: statement.operator,
        value: extracted.value,
        span: statement.span,
      });
      return;
    }
    if (statement.kind === "property-assign") {
      const path = this.#statePath(statement.target, statement.property);
      if (!path) {
        throw workflowLoweringError(statement.span, "Workflow run may mutate only declared State.");
      }
      const temporary = this.#temporaryName();
      const extracted = this.#expression(statement.value, temporary);
      if (extracted.suspension) this.#suspend(extracted.suspension, temporary, statement.span);
      this.#body.push({
        kind: "state",
        path,
        operator: statement.operator,
        value: extracted.value,
        span: statement.span,
      });
      return;
    }
    if (statement.kind === "expression") {
      if (this.#fail(statement.expression, statement.span)) return;
      if (this.#shield(statement.expression, statement.span)) return;
      if (this.#continueAsNew(statement.expression, statement.span)) return;
      const temporary = this.#temporaryName();
      const extracted = this.#expression(statement.expression, temporary);
      if (extracted.suspension) {
        this.#suspend(extracted.suspension, temporary, statement.span);
      }
      return;
    }
    if (statement.kind === "return") {
      if (!statement.value) {
        throw workflowLoweringError(
          statement.span,
          "Workflow run must return its declared Result.",
        );
      }
      if (this.#fail(statement.value, statement.span)) return;
      if (this.#continueAsNew(statement.value, statement.span)) return;
      const temporary = this.#temporaryName();
      const extracted = this.#expression(statement.value, temporary);
      if (extracted.suspension) this.#suspend(extracted.suspension, temporary, statement.span);
      this.#close({
        kind: "return",
        value: extracted.value,
        span: statement.span,
      });
      return;
    }
    if (statement.kind === "throw") {
      this.#close({
        kind: "fail",
        value: this.#plainExpression(statement.value),
        span: statement.span,
      });
      return;
    }
    if (statement.kind === "if") {
      this.#if(statement);
      return;
    }
    if (statement.kind === "while") {
      this.#while(statement);
      return;
    }
    if (statement.kind === "for-range") {
      this.#forRange(statement);
      return;
    }
    if (statement.kind === "for-of") {
      this.#forOf(statement);
      return;
    }
    if (statement.kind === "try") {
      this.#try(statement);
      return;
    }
    throw workflowLoweringError(
      statement.span,
      `Workflow control flow ${JSON.stringify(statement.kind)} is not lowered yet.`,
    );
  }

  #if(statement: Extract<StatementIR, { kind: "if" }>): void {
    const consequent = this.#newBlock();
    const alternate = this.#newBlock();
    const continuation = this.#newBlock();
    this.#close({
      kind: "branch",
      condition: this.#plainExpression(statement.condition),
      consequent,
      alternate,
      span: statement.span,
    });

    this.#open(consequent);
    this.#statementsWithLocalBindings(statement.consequent);
    const consequentContinues = !this.#closed;
    if (consequentContinues) {
      this.#close({ kind: "jump", next: continuation, span: statement.span });
    }

    this.#open(alternate);
    this.#statementsWithLocalBindings(statement.alternate);
    const alternateContinues = !this.#closed;
    if (alternateContinues) {
      this.#close({ kind: "jump", next: continuation, span: statement.span });
    }

    if (consequentContinues || alternateContinues) this.#open(continuation);
  }

  #while(statement: Extract<StatementIR, { kind: "while" }>): void {
    const condition = this.#newBlock();
    const body = this.#newBlock();
    const continuation = this.#newBlock();
    this.#close({ kind: "jump", next: condition, span: statement.span });

    this.#open(condition);
    this.#close({
      kind: "branch",
      condition: this.#plainExpression(statement.condition),
      consequent: body,
      alternate: continuation,
      span: statement.span,
    });

    this.#open(body);
    this.#statementsWithLocalBindings(statement.body);
    if (!this.#closed) this.#close({ kind: "jump", next: condition, span: statement.span });
    this.#open(continuation);
  }

  #forRange(statement: Extract<StatementIR, { kind: "for-range" }>): void {
    const limit = this.#temporaryName();
    const condition = this.#newBlock();
    const body = this.#newBlock();
    const continuation = this.#newBlock();
    this.#body.push(
      {
        kind: "let",
        name: statement.item,
        value: this.#plainExpression(statement.from),
        span: statement.span,
      },
      {
        kind: "let",
        name: limit,
        value: this.#plainExpression(statement.to),
        span: statement.span,
      },
    );
    this.#close({ kind: "jump", next: condition, span: statement.span });

    this.#open(condition);
    this.#close({
      kind: "branch",
      condition: {
        kind: "binary",
        operator: "<",
        left: { kind: "local", name: statement.item },
        right: { kind: "local", name: limit },
      },
      consequent: body,
      alternate: continuation,
      span: statement.span,
    });

    this.#open(body);
    this.#statementsWithLocalBindings(statement.body);
    if (!this.#closed) {
      this.#body.push({
        kind: "assign",
        name: statement.item,
        operator: "+=",
        value: { kind: "literal", value: 1 },
        span: statement.span,
      });
      this.#close({ kind: "jump", next: condition, span: statement.span });
    }
    this.#open(continuation);
  }

  #forOf(statement: Extract<StatementIR, { kind: "for-of" }>): void {
    if (statement.asynchronous) {
      throw workflowLoweringError(
        statement.span,
        "Workflow iteration cannot consume an asynchronous stream directly; cross a declared Dependency instead.",
      );
    }
    const values = this.#temporaryName();
    const index = this.#temporaryName();
    const condition = this.#newBlock();
    const body = this.#newBlock();
    const continuation = this.#newBlock();
    this.#body.push(
      {
        kind: "let",
        name: values,
        value: this.#plainExpression(statement.values),
        span: statement.span,
      },
      {
        kind: "let",
        name: index,
        value: { kind: "literal", value: 0 },
        span: statement.span,
      },
    );
    this.#close({ kind: "jump", next: condition, span: statement.span });

    this.#open(condition);
    this.#close({
      kind: "branch",
      condition: {
        kind: "binary",
        operator: "<",
        left: { kind: "local", name: index },
        right: {
          kind: "property",
          value: { kind: "local", name: values },
          name: "length",
        },
      },
      consequent: body,
      alternate: continuation,
      span: statement.span,
    });

    this.#open(body);
    this.#body.push({
      kind: "let",
      name: statement.item,
      value: {
        kind: "index",
        value: { kind: "local", name: values },
        index: { kind: "local", name: index },
      },
      span: statement.span,
    });
    this.#statementsWithLocalBindings(statement.body);
    if (!this.#closed) {
      this.#body.push({
        kind: "assign",
        name: index,
        operator: "+=",
        value: { kind: "literal", value: 1 },
        span: statement.span,
      });
      this.#close({ kind: "jump", next: condition, span: statement.span });
    }
    this.#open(continuation);
  }

  #try(statement: Extract<StatementIR, { kind: "try" }>): void {
    const body = this.#newBlock();
    const caught = statement.catch ? this.#newBlock() : undefined;
    const cleanup = statement.finally.length ? this.#newBlock() : undefined;
    const continuation = this.#newBlock();
    const failure = statement.catch?.error ?? this.#temporaryName("$failure");
    const scope: {
      kind: "enter-scope";
      id: string;
      cancellable: boolean;
      body: string;
      catch?: Readonly<{ block: string; result: string }>;
      cleanup?: string;
      next?: string;
      span: WorkflowIRSourceSpan;
    } = {
      kind: "enter-scope",
      id: this.#newScope(),
      cancellable: true,
      body,
      ...(caught ? { catch: { block: caught, result: failure } } : {}),
      ...(cleanup ? { cleanup } : {}),
      span: statement.span,
    };
    this.#close(scope);

    this.#open(body);
    this.#statementsWithLocalBindings(statement.body);
    const bodyContinues = !this.#closed;
    if (bodyContinues) this.#close({ kind: "leave-scope", span: statement.span });

    let catchContinues = false;
    if (caught && statement.catch) {
      this.#open(caught);
      this.#statementsWithLocalBindings(statement.catch.body);
      catchContinues = !this.#closed;
      if (catchContinues) this.#close({ kind: "leave-scope", span: statement.span });
    }

    let cleanupContinues = true;
    if (cleanup) {
      this.#open(cleanup);
      this.#statementsWithLocalBindings(statement.finally);
      cleanupContinues = !this.#closed;
      if (cleanupContinues) {
        this.#close({ kind: "complete-cleanup", span: statement.span });
      }
    }

    if ((bodyContinues || catchContinues) && cleanupContinues) {
      scope.next = continuation;
      this.#open(continuation);
    }
  }

  #continueAsNew(expression: ExpressionIR, span: WorkflowIRSourceSpan): boolean {
    if (
      expression.kind !== "invoke" ||
      this.#bindingKind(expression.callee) !== "continue-service"
    ) {
      return false;
    }
    if (expression.awaited || expression.arguments.length !== 1) {
      throw workflowLoweringError(
        span,
        "Workflow continueAsNew requires one synchronous next Input value.",
      );
    }
    this.#close({
      kind: "continue-as-new",
      input: this.#plainExpression(expression.arguments[0]!),
      span,
    });
    return true;
  }

  #fail(expression: ExpressionIR, span: WorkflowIRSourceSpan): boolean {
    if (expression.kind !== "invoke" || this.#bindingKind(expression.callee) !== "fail-service") {
      return false;
    }
    if (expression.awaited || expression.arguments.length !== 1) {
      throw workflowLoweringError(
        span,
        "Workflow fail requires one synchronous declared failure value.",
      );
    }
    this.#close({
      kind: "fail",
      value: this.#plainExpression(expression.arguments[0]!),
      span,
    });
    return true;
  }

  #shield(expression: ExpressionIR, span: WorkflowIRSourceSpan): boolean {
    if (
      expression.kind !== "invoke" ||
      !expression.awaited ||
      this.#bindingKind(expression.callee) !== "shield-service"
    ) {
      return false;
    }
    if (expression.arguments.length !== 1 || expression.arguments[0]?.kind !== "closure") {
      throw workflowLoweringError(span, "Workflow shield requires one asynchronous closure.");
    }
    const closure = expression.arguments[0];
    const callback = this.#functions.get(closure.function);
    if (!callback || !callback.asynchronous || callback.parameters.length) {
      throw workflowLoweringError(
        span,
        "Workflow shield requires one parameterless asynchronous closure.",
      );
    }
    const statements = [...callback.body];
    const returned = statements.at(-1);
    if (returned?.kind === "return" && returned.value === undefined) statements.pop();
    if (statements.some((statement) => statement.kind === "return")) {
      throw workflowLoweringError(span, "Workflow shield cannot return a value.");
    }

    const body = this.#newBlock();
    const continuation = this.#newBlock();
    this.#close({
      kind: "enter-scope",
      id: this.#newScope(),
      cancellable: false,
      body,
      next: continuation,
      span,
    });
    this.#open(body);
    this.#statementsWithClosureBindings(closure, callback, statements);
    if (this.#closed) {
      throw workflowLoweringError(
        span,
        "Workflow shield must complete normally in the current subset.",
      );
    }
    this.#close({ kind: "leave-scope", span });
    this.#open(continuation);
    return true;
  }

  #statementsWithLocalBindings(statements: readonly StatementIR[]): void {
    const bindings = [...this.#bindings];
    try {
      for (const statement of statements) this.#statement(statement);
    } finally {
      this.#bindings.clear();
      for (const [name, binding] of bindings) this.#bindings.set(name, binding);
    }
  }

  #statementsWithClosureBindings(
    closure: Extract<ExpressionIR, { kind: "closure" }>,
    callback: FunctionIR,
    statements: readonly StatementIR[],
  ): void {
    const bindings = [...this.#bindings];
    try {
      for (const [index, capture] of callback.captures.entries()) {
        const value = closure.captures[index];
        if (!value) {
          throw workflowLoweringError(closure.span, "Workflow shield capture is missing.");
        }
        const binding = value.kind === "local" ? this.#bindings.get(value.name) : undefined;
        this.#bindings.set(capture.name, binding ?? this.#plainExpression(value));
      }
      for (const statement of statements) this.#statement(statement);
    } finally {
      this.#bindings.clear();
      for (const [name, binding] of bindings) this.#bindings.set(name, binding);
    }
  }

  #contextBinding(statement: Extract<StatementIR, { kind: "let" }>): boolean {
    const value = statement.value;
    if (
      value.kind !== "property" ||
      value.value.kind !== "local" ||
      value.value.name !== this.run.parameters[0]!.name
    ) {
      return false;
    }
    const binding = this.#bindings.get(value.name);
    if (!binding) {
      throw workflowLoweringError(
        statement.span,
        `Workflow context field ${JSON.stringify(value.name)} is unsupported.`,
      );
    }
    this.#bindings.set(statement.name, binding);
    return true;
  }

  #expression(expression: ExpressionIR, result: string): ExtractedExpression {
    const suspension = this.#directSuspension(expression);
    if (suspension) {
      return {
        value: suspension.kind === "sleep" ? { kind: "none" } : { kind: "local", name: result },
        suspension,
      };
    }
    if (expression.kind === "unary") {
      const nested = this.#expression(expression.value, result);
      return {
        value: {
          kind: "unary",
          operator: expression.operator,
          value: nested.value,
        },
        ...(nested.suspension ? { suspension: nested.suspension } : {}),
      };
    }
    return { value: this.#plainExpression(expression) };
  }

  #plainExpression(
    expression: ExpressionIR,
    bindings: ReadonlyMap<string, WorkflowBinding> = this.#bindings,
  ): WorkflowIRExpression {
    if (expression.kind === "literal") return { kind: "literal", value: expression.value };
    if (expression.kind === "none") return { kind: "none" };
    if (expression.kind === "local") {
      const binding = bindings.get(expression.name);
      if (!binding) return { kind: "local", name: expression.name };
      if (
        binding.kind === "dependencies" ||
        binding.kind === "time-service" ||
        binding.kind === "wait-service" ||
        binding.kind === "fail-service" ||
        binding.kind === "shield-service" ||
        binding.kind === "continue-service" ||
        binding.kind === "dependency-reference"
      ) {
        throw workflowLoweringError(
          expression.span,
          `Workflow service ${JSON.stringify(expression.name)} must be invoked semantically.`,
        );
      }
      return binding as WorkflowIRExpression;
    }
    if (expression.kind === "property") {
      const path = this.#rootPath(expression, bindings);
      if (path) return path;
      return {
        kind: "property",
        value: this.#plainExpression(expression.value, bindings),
        name: expression.name,
      };
    }
    if (expression.kind === "index") {
      return {
        kind: "index",
        value: this.#plainExpression(expression.value, bindings),
        index: this.#plainExpression(expression.index, bindings),
      };
    }
    if (expression.kind === "array") {
      return {
        kind: "array",
        values: expression.values.map((value) => this.#plainExpression(value, bindings)),
      };
    }
    if (expression.kind === "record") {
      return {
        kind: "record",
        fields: expression.fields.map(({ name, value }) => ({
          name,
          value: this.#plainExpression(value, bindings),
        })),
      };
    }
    if (expression.kind === "record-merge") {
      return {
        kind: "record-merge",
        entries: expression.entries.map((entry) =>
          entry.kind === "field"
            ? {
                kind: "field",
                name: entry.name,
                value: this.#plainExpression(entry.value, bindings),
              }
            : {
                kind: "spread",
                value: this.#plainExpression(entry.value, bindings),
              },
        ),
      };
    }
    if (expression.kind === "binary") {
      return {
        kind: "binary",
        operator: expression.operator,
        left: this.#plainExpression(expression.left, bindings),
        right: this.#plainExpression(expression.right, bindings),
      };
    }
    if (expression.kind === "unary") {
      return {
        kind: "unary",
        operator: expression.operator,
        value: this.#plainExpression(expression.value, bindings),
      };
    }
    if (expression.kind === "conditional") {
      return {
        kind: "conditional",
        condition: this.#plainExpression(expression.condition, bindings),
        consequent: this.#plainExpression(expression.consequent, bindings),
        alternate: this.#plainExpression(expression.alternate, bindings),
      };
    }
    if (
      expression.kind === "method-call" &&
      expression.method === "now" &&
      this.#bindingKind(expression.receiver, bindings) === "time-service" &&
      expression.arguments.length === 0
    ) {
      return { kind: "time" };
    }
    throw workflowLoweringError(
      expression.span,
      `Workflow expression ${JSON.stringify(expression.kind)} is unsupported in deterministic code.`,
    );
  }

  #directSuspension(expression: ExpressionIR): WorkflowSuspension | undefined {
    if (expression.kind === "concurrent") {
      return {
        kind: "concurrent",
        operation: expression.operation,
        effects: expression.values.map((value) => {
          const effect = this.#dependencySuspension(value, true);
          if (!effect) {
            throw workflowLoweringError(
              value.span,
              "Workflow concurrency currently accepts only direct declared Dependency calls.",
            );
          }
          return effect;
        }),
      };
    }
    const reference = this.#referenceSuspension(expression, false);
    if (reference) return reference;
    const dependency = this.#dependencySuspension(expression, false);
    if (dependency) return dependency;
    if (
      expression.kind === "method-call" &&
      expression.method === "sleep" &&
      this.#bindingKind(expression.receiver) === "time-service"
    ) {
      if (expression.arguments.length !== 1) {
        throw workflowLoweringError(expression.span, "Workflow sleep requires one timing value.");
      }
      return {
        kind: "sleep",
        timing: this.#timing(expression.arguments[0]!, expression.span),
      };
    }
    if (
      expression.kind === "invoke" &&
      expression.awaited &&
      this.#bindingKind(expression.callee) === "wait-service"
    ) {
      const condition = expression.arguments[0];
      if (condition?.kind !== "closure") {
        throw workflowLoweringError(expression.span, "Workflow wait requires a pure condition.");
      }
      const callback = this.#functions.get(condition.function);
      if (!callback || callback.body.length !== 1 || callback.body[0]?.kind !== "return") {
        throw workflowLoweringError(
          expression.span,
          "Workflow wait condition must be one deterministic expression.",
        );
      }
      const returned = callback.body[0].value;
      if (!returned) {
        throw workflowLoweringError(
          expression.span,
          "Workflow wait condition must return boolean.",
        );
      }
      const bindings = new Map(this.#bindings);
      for (const [index, capture] of callback.captures.entries()) {
        const value = condition.captures[index];
        if (!value) {
          throw workflowLoweringError(expression.span, "Workflow wait capture is missing.");
        }
        bindings.set(capture.name, this.#plainExpression(value));
      }
      const timeout = expression.arguments[1];
      return {
        kind: "wait",
        condition: this.#plainExpression(returned, bindings),
        ...(timeout && timeout.kind !== "none"
          ? { timeout: this.#timing(timeout, expression.span) }
          : {}),
      };
    }
    return undefined;
  }

  #referenceSuspension(
    expression: ExpressionIR,
    deferred: boolean,
  ):
    | Extract<WorkflowSuspension, { kind: "effect" }>
    | Extract<WorkflowSuspension, { kind: "child" }>
    | undefined {
    if (expression.kind !== "dependency-reference-call") return undefined;
    if (!expression.awaited && !deferred) {
      throw workflowLoweringError(
        expression.span,
        "Workflow referenced Dependency invocations must be awaited.",
      );
    }
    const reference = this.#dependencyReference(expression.reference);
    if (!reference) {
      throw workflowLoweringError(
        expression.span,
        "Workflow referenced Dependency calls require a statically bound reference.",
      );
    }
    const entries: Array<
      | Readonly<{ kind: "field"; name: string; value: WorkflowIRExpression }>
      | Readonly<{ kind: "spread"; value: WorkflowIRExpression }>
    > = [{ kind: "spread", value: reference.binding }];
    if (expression.input) {
      entries.push({
        kind: "field",
        name: expression.argument,
        value: this.#plainExpression(expression.input),
      });
    }
    const child = this.#children.has(reference.dependency);
    return {
      kind: child ? "child" : "effect",
      dependency: reference.dependency,
      operation: child && expression.operation === "join" ? "$join" : expression.operation,
      input: { kind: "record-merge", entries },
      ...(expression.options ? { options: this.#plainExpression(expression.options) } : {}),
    };
  }

  #dependencyReference(
    expression: ExpressionIR,
  ): Readonly<{ dependency: string; binding: WorkflowIRExpression }> | undefined {
    if (expression.kind === "dependency-reference") {
      return {
        dependency: expression.dependency,
        binding: this.#plainExpression(expression.binding),
      };
    }
    if (expression.kind !== "local") return undefined;
    const binding = this.#bindings.get(expression.name);
    return binding?.kind === "dependency-reference" ? binding : undefined;
  }

  #dependencySuspension(
    expression: ExpressionIR,
    deferred: boolean,
  ): Extract<WorkflowSuspension, { kind: "effect" }> | undefined {
    if (expression.kind !== "dependency-call") return undefined;
    if (!expression.awaited && !deferred) {
      throw workflowLoweringError(
        expression.span,
        "Workflow Dependency invocations must be awaited.",
      );
    }
    if (expression.arguments.length !== 1) {
      throw workflowLoweringError(
        expression.span,
        "Workflow Dependency operations require one input value.",
      );
    }
    return {
      kind: "effect",
      dependency: expression.dependency,
      operation: expression.operation,
      input: this.#plainExpression(expression.arguments[0]!),
      ...(expression.options ? { options: this.#plainExpression(expression.options) } : {}),
    };
  }

  #timing(
    expression: ExpressionIR,
    span: WorkflowIRSourceSpan,
  ):
    | Readonly<{ kind: "for"; value: WorkflowIRExpression }>
    | Readonly<{ kind: "until"; value: WorkflowIRExpression }> {
    if (expression.kind !== "record" || expression.fields.length !== 1) {
      throw workflowLoweringError(span, "Workflow timing requires exactly one of for or until.");
    }
    const field = expression.fields[0]!;
    if (field.name !== "for" && field.name !== "until") {
      throw workflowLoweringError(span, "Workflow timing requires exactly one of for or until.");
    }
    return { kind: field.name, value: this.#plainExpression(field.value) };
  }

  #bindingKind(
    expression: ExpressionIR,
    bindings: ReadonlyMap<string, WorkflowBinding> = this.#bindings,
  ): WorkflowBinding["kind"] | undefined {
    return expression.kind === "local" ? bindings.get(expression.name)?.kind : undefined;
  }

  #rootPath(
    expression: Extract<ExpressionIR, { kind: "property" }>,
    bindings: ReadonlyMap<string, WorkflowBinding>,
  ):
    | Extract<
        WorkflowIRExpression,
        { kind: "identity" | "invocation" | "input" | "state" | "history" }
      >
    | undefined {
    const fields: string[] = [expression.name];
    let owner = expression.value;
    while (owner.kind === "property") {
      fields.unshift(owner.name);
      owner = owner.value;
    }
    if (owner.kind !== "local") return undefined;
    const binding = bindings.get(owner.name);
    if (
      binding?.kind !== "identity" &&
      binding?.kind !== "invocation" &&
      binding?.kind !== "input" &&
      binding?.kind !== "state" &&
      binding?.kind !== "history"
    ) {
      return undefined;
    }
    return { kind: binding.kind, path: [...binding.path, ...fields] };
  }

  #statePath(target: ExpressionIR, property: string): readonly string[] | undefined {
    if (target.kind === "local") {
      const binding = this.#bindings.get(target.name);
      return binding?.kind === "state" ? [...binding.path, property] : undefined;
    }
    if (target.kind !== "property") return undefined;
    const path = this.#rootPath(target, this.#bindings);
    return path?.kind === "state" ? [...path.path, property] : undefined;
  }

  #temporaryName(preferred?: string): string {
    return preferred ?? `$result/${this.#temporary++}`;
  }

  #newBlock(): string {
    return `block/${this.#blockIndex++}`;
  }

  #newScope(): string {
    return `scope/${this.#scopeIndex++}`;
  }

  #open(block: string): void {
    this.#block = block;
    this.#body = [];
    this.#closed = false;
  }

  #suspend(suspension: WorkflowSuspension, result: string, span: WorkflowIRSourceSpan): void {
    const next = this.#newBlock();
    let terminator: WorkflowIRTerminator;
    if (suspension.kind === "effect" || suspension.kind === "child") {
      terminator = {
        ...suspension,
        result,
        next,
        span,
      };
    } else if (suspension.kind === "sleep") {
      terminator = {
        ...suspension,
        next,
        span,
      };
    } else {
      terminator = {
        ...suspension,
        result,
        next,
        span,
      };
    }
    this.#close(terminator);
    this.#open(next);
  }

  #close(terminator: WorkflowIRTerminator): void {
    this.#blocks.push({
      id: this.#block,
      body: this.#body,
      terminator,
      span: this.#body[0]?.span ?? terminator.span,
    });
    this.#closed = true;
  }
}

const workflowDataType: TypeIR = Object.freeze({
  kind: "opaque",
  name: "WorkflowData",
});
const workflowBooleanType: TypeIR = Object.freeze({
  kind: "primitive",
  name: "boolean",
});
const workflowNumberType: TypeIR = Object.freeze({
  kind: "primitive",
  name: "number",
});
const workflowVoidType: TypeIR = Object.freeze({
  kind: "primitive",
  name: "void",
});

/**
 * Lowers one static canonical Workflow definition into ordinary portable
 * function IR. This is extension-owned code generation: generic TypeScript
 * and Rust lowering consume the result without recognizing Workflow meaning.
 */
export function lowerWorkflowAdvanceFunctionIR(
  definition: WorkflowDefinitionIR,
  executionType: TypeIR,
  resultType: TypeIR,
  span: SourceSpan,
): FunctionIR {
  validateWorkflowDefinitionIR(definition);
  return new WorkflowAdvanceLowering(definition, executionType, resultType, span).lower();
}

/** Lowers one external return/failure/cancellation transfer into the same state machine. */
export function lowerWorkflowTransferFunctionIR(
  definition: WorkflowDefinitionIR,
  executionType: TypeIR,
  transferType: TypeIR,
  resultType: TypeIR,
  span: SourceSpan,
): FunctionIR {
  validateWorkflowDefinitionIR(definition);
  return new WorkflowAdvanceLowering(definition, executionType, resultType, span).lowerTransfer(
    transferType,
  );
}

class WorkflowAdvanceLowering {
  readonly #execution = "execution";
  readonly #budget = "$workflow/blocks";
  readonly #id: string;

  constructor(
    readonly definition: WorkflowDefinitionIR,
    readonly executionType: TypeIR,
    readonly resultType: TypeIR,
    readonly span: SourceSpan,
  ) {
    const hash = createHash("sha256")
      .update(canonicalWorkflowJSON(definition))
      .digest("hex")
      .slice(0, 16);
    this.#id = `workflow/${definition.contract.name}/${definition.contract.revision}/advance/${hash}`;
  }

  lower(): FunctionIR {
    return {
      id: this.#id,
      name: `${this.definition.contract.name}WorkflowAdvance`,
      asynchronous: false,
      captures: [],
      parameters: [{ name: this.#execution, optional: false, type: this.executionType }],
      result: this.resultType,
      body: [
        ...this.#resumeCancellation(),
        ...this.#resumeSatisfiedWait(),
        this.#initializeBudget(),
        this.#advanceLoop(),
        this.#returnExecution(),
      ],
      span: this.span,
    };
  }

  lowerTransfer(transferType: TypeIR): FunctionIR {
    const transfer = "$workflow/external-transfer";
    return {
      id: this.#id.replace("/advance/", "/transfer/"),
      name: `${this.definition.contract.name}WorkflowTransfer`,
      asynchronous: false,
      captures: [],
      parameters: [
        { name: this.#execution, optional: false, type: this.executionType },
        { name: transfer, optional: false, type: transferType },
      ],
      result: this.resultType,
      body: [
        ...this.#transfer(this.#local(transfer, transferType, this.span), this.span, "external"),
        this.#initializeBudget(),
        this.#advanceLoop(),
        this.#returnExecution(),
      ],
      span: this.span,
    };
  }

  #initializeBudget(): StatementIR {
    return {
      kind: "let",
      name: this.#budget,
      mutable: true,
      value: this.#data(0, this.span),
      span: this.span,
    };
  }

  #advanceLoop(): StatementIR {
    return {
      kind: "while",
      condition: this.#binary(
        "===",
        this.#executionProperty("status"),
        this.#data("running", this.span),
        this.span,
      ),
      body: [
        {
          kind: "if",
          condition: this.#binary(
            ">=",
            this.#local(this.#budget, workflowNumberType, this.span),
            this.#data(10_000, this.span),
            this.span,
          ),
          consequent: [
            this.#setExecution("status", this.#data("failed", this.span), this.span),
            this.#setExecution(
              "failure",
              this.#record(
                [
                  ["type", this.#data("resource", this.span)],
                  ["limit", this.#data(10_000, this.span)],
                ],
                this.span,
              ),
              this.span,
            ),
          ],
          alternate: [
            {
              kind: "assign",
              name: this.#budget,
              operator: "+=",
              value: this.#data(1, this.span),
              span: this.span,
            },
            this.#dispatch(0),
          ],
          span: this.span,
        },
      ],
      span: this.span,
    };
  }

  #returnExecution(): StatementIR {
    return {
      kind: "return",
      value: this.#local(this.#execution, this.executionType, this.span),
      span: this.span,
    };
  }

  #resumeCancellation(): readonly StatementIR[] {
    const pending = this.#executionProperty("pending", workflowDataType, this.span);
    const cancellation = this.#executionProperty("cancellation", workflowDataType, this.span);
    return [
      {
        kind: "if",
        condition: this.#binary(
          "&&",
          this.#binary(
            "&&",
            this.#binary(
              "===",
              this.#executionProperty("status", workflowDataType, this.span),
              this.#data("suspended", this.span),
              this.span,
            ),
            this.#present(pending, this.span),
            this.span,
          ),
          this.#binary(
            "&&",
            this.#present(cancellation, this.span),
            this.#binary(
              "===",
              this.#property(pending, "cancellable", this.span),
              this.#data(true, this.span),
              this.span,
            ),
            this.span,
          ),
          this.span,
        ),
        consequent: this.#transfer(
          this.#record(
            [
              ["kind", this.#data("cancel", this.span)],
              ["cancellation", cancellation],
            ],
            this.span,
          ),
          this.span,
          "resume",
        ),
        alternate: [],
        span: this.span,
      },
    ];
  }

  #resumeSatisfiedWait(): readonly StatementIR[] {
    const waits = this.definition.blocks.flatMap((block) =>
      block.terminator.kind === "wait" ? [block.terminator] : [],
    );
    if (!waits.length) return [];
    const pending = this.#executionProperty("pending", workflowDataType, this.span);
    return [
      {
        kind: "if",
        condition: this.#binary(
          "===",
          this.#executionProperty("status", workflowDataType, this.span),
          this.#data("suspended", this.span),
          this.span,
        ),
        consequent: [
          {
            kind: "if",
            condition: {
              kind: "unary",
              operator: "present",
              value: pending,
              type: workflowBooleanType,
              span: this.span,
            },
            consequent: [
              {
                kind: "if",
                condition: this.#binary(
                  "===",
                  this.#property(pending, "kind", this.span),
                  this.#data("wait", this.span),
                  this.span,
                ),
                consequent: [this.#waitResumeDispatch(waits, 0)],
                alternate: [],
                span: this.span,
              },
            ],
            alternate: [],
            span: this.span,
          },
        ],
        alternate: [],
        span: this.span,
      },
    ];
  }

  #waitResumeDispatch(
    waits: readonly Extract<WorkflowIRTerminator, { kind: "wait" }>[],
    index: number,
  ): StatementIR {
    const wait = waits[index]!;
    const span = wait.span ?? this.span;
    const pending = this.#executionProperty("pending", workflowDataType, span);
    const matches = this.#binary(
      "&&",
      this.#binary("===", this.#property(pending, "next", span), this.#data(wait.next, span), span),
      this.#binary(
        "===",
        this.#property(pending, "result", span),
        this.#data(wait.result, span),
        span,
      ),
      span,
    );
    return {
      kind: "if",
      condition: matches,
      consequent: [
        {
          kind: "if",
          condition: this.#expression(wait.condition, span),
          consequent: [
            this.#setLocal(wait.result, "=", this.#data(true, span), span),
            this.#setExecution("block", this.#data(wait.next, span), span),
            this.#setExecution("pending", { kind: "none", type: workflowVoidType, span }, span),
            this.#setExecution("status", this.#data("running", span), span),
          ],
          alternate: [],
          span,
        },
      ],
      alternate: index + 1 < waits.length ? [this.#waitResumeDispatch(waits, index + 1)] : [],
      span,
    };
  }

  #dispatch(index: number): StatementIR {
    const block = this.definition.blocks[index];
    if (!block) {
      return {
        kind: "throw",
        value: {
          kind: "error",
          name: "TypeError",
          arguments: [this.#data("Workflow execution references an unknown block.", this.span)],
          fields: [],
          type: workflowDataType,
          span: this.span,
        },
        span: this.span,
      };
    }
    const span = block.span ?? this.span;
    return {
      kind: "if",
      condition: this.#binary(
        "===",
        this.#executionProperty("block", workflowDataType, span),
        this.#data(block.id, span),
        span,
      ),
      consequent: [
        ...block.body.map((instruction) => this.#instruction(instruction)),
        ...this.#terminator(block.terminator, index),
      ],
      alternate: [this.#dispatch(index + 1)],
      span,
    };
  }

  #instruction(instruction: WorkflowIRInstruction): StatementIR {
    const span = instruction.span ?? this.span;
    if (instruction.kind === "state") {
      const property = instruction.path.at(-1)!;
      return {
        kind: "property-assign",
        target: this.#path(
          this.#executionProperty("state", workflowDataType, span),
          instruction.path.slice(0, -1),
          span,
        ),
        property,
        operator: instruction.operator,
        value: this.#expression(instruction.value, span),
        span,
      };
    }
    return {
      kind: "index-assign",
      target: this.#executionProperty("locals", workflowDataType, span),
      index: this.#data(instruction.name, span),
      operator: instruction.kind === "assign" ? instruction.operator : "=",
      value: this.#expression(instruction.value, span),
      span,
    };
  }

  #terminator(terminator: WorkflowIRTerminator, blockIndex: number): readonly StatementIR[] {
    const span = terminator.span ?? this.span;
    if (terminator.kind === "jump") {
      return [this.#setExecution("block", this.#data(terminator.next, span), span)];
    }
    if (terminator.kind === "branch") {
      return [
        {
          kind: "if",
          condition: this.#expression(terminator.condition, span),
          consequent: [this.#setExecution("block", this.#data(terminator.consequent, span), span)],
          alternate: [this.#setExecution("block", this.#data(terminator.alternate, span), span)],
          span,
        },
      ];
    }
    if (terminator.kind === "effect" || terminator.kind === "child") {
      const fields: Array<readonly [string, ExpressionIR]> = [
        ["kind", this.#data(terminator.kind, span)],
        ["sequence", this.#executionProperty("sequence", workflowNumberType, span)],
        ["cancellable", this.#scopeCancellable(span)],
        ["dependency", this.#data(terminator.dependency, span)],
        ["operation", this.#data(terminator.operation, span)],
        ["input", this.#expression(terminator.input, span)],
      ];
      if (terminator.options) {
        fields.push(["options", this.#expression(terminator.options, span)]);
      }
      fields.push(
        ["result", this.#data(terminator.result, span)],
        ["next", this.#data(terminator.next, span)],
      );
      return this.#suspend(this.#record(fields, span), span, blockIndex);
    }
    if (terminator.kind === "sleep") {
      const at = `$workflow/at/${blockIndex}`;
      const timing = this.#expression(terminator.timing.value, span);
      const deadline =
        terminator.timing.kind === "for"
          ? this.#binary(
              "+",
              this.#executionProperty("time", workflowNumberType, span),
              timing,
              span,
            )
          : timing;
      return [
        {
          kind: "let",
          name: at,
          mutable: false,
          value: deadline,
          span,
        },
        {
          kind: "if",
          condition: this.#binary(
            "<=",
            this.#local(at, workflowNumberType, span),
            this.#executionProperty("time", workflowNumberType, span),
            span,
          ),
          consequent: [this.#setExecution("block", this.#data(terminator.next, span), span)],
          alternate: this.#suspend(
            this.#record(
              [
                ["kind", this.#data("sleep", span)],
                ["sequence", this.#executionProperty("sequence", workflowNumberType, span)],
                ["cancellable", this.#scopeCancellable(span)],
                ["at", this.#local(at, workflowNumberType, span)],
                ["next", this.#data(terminator.next, span)],
              ],
              span,
            ),
            span,
            blockIndex,
          ),
          span,
        },
      ];
    }
    if (terminator.kind === "wait") {
      const pending: Array<readonly [string, ExpressionIR]> = [
        ["kind", this.#data("wait", span)],
        ["sequence", this.#executionProperty("sequence", workflowNumberType, span)],
        ["cancellable", this.#scopeCancellable(span)],
        ["condition", this.#data(terminator.condition as unknown as ExtensionIR, span)],
      ];
      if (terminator.timeout) {
        const timing = this.#expression(terminator.timeout.value, span);
        pending.push([
          "until",
          terminator.timeout.kind === "for"
            ? this.#binary(
                "+",
                this.#executionProperty("time", workflowNumberType, span),
                timing,
                span,
              )
            : timing,
        ]);
      }
      pending.push(
        ["result", this.#data(terminator.result, span)],
        ["next", this.#data(terminator.next, span)],
      );
      return [
        {
          kind: "if",
          condition: this.#expression(terminator.condition, span),
          consequent: [
            this.#setLocal(terminator.result, "=", this.#data(true, span), span),
            this.#setExecution("block", this.#data(terminator.next, span), span),
          ],
          alternate: this.#suspend(this.#record(pending, span), span, blockIndex),
          span,
        },
      ];
    }
    if (terminator.kind === "concurrent") {
      if (!terminator.effects.length) {
        return [
          this.#setLocal(terminator.result, "=", this.#array([], span), span),
          this.#setExecution("block", this.#data(terminator.next, span), span),
        ];
      }
      const effects = `$workflow/effects/${blockIndex}`;
      const statements: StatementIR[] = [
        {
          kind: "let",
          name: effects,
          mutable: true,
          value: this.#array([], span),
          span,
        },
      ];
      for (const effect of terminator.effects) {
        const fields: Array<readonly [string, ExpressionIR]> = [
          ["sequence", this.#executionProperty("sequence", workflowNumberType, span)],
          ["dependency", this.#data(effect.dependency, span)],
          ["operation", this.#data(effect.operation, span)],
          ["input", this.#expression(effect.input, span)],
        ];
        if (effect.options) fields.push(["options", this.#expression(effect.options, span)]);
        fields.push(["status", this.#data("pending", span)]);
        statements.push(
          {
            kind: "array-push",
            array: effects,
            value: this.#record(fields, span),
            span,
          },
          this.#setExecution("sequence", this.#data(1, span), span, "+="),
        );
      }
      statements.push(
        ...this.#rawSuspend(
          this.#record(
            [
              ["kind", this.#data("concurrent", span)],
              ["cancellable", this.#scopeCancellable(span)],
              ["operation", this.#data(terminator.operation, span)],
              ["effects", this.#local(effects, { kind: "array", element: workflowDataType }, span)],
              ["result", this.#data(terminator.result, span)],
              ["next", this.#data(terminator.next, span)],
            ],
            span,
          ),
          span,
          false,
        ),
      );
      return this.#interruptOr(statements, span, blockIndex);
    }
    if (terminator.kind === "enter-scope") {
      const parent = this.#executionProperty("scope", workflowDataType, span);
      const fields: Array<readonly [string, ExpressionIR]> = [
        ["id", this.#data(terminator.id, span)],
        ["cancellable", this.#data(terminator.cancellable, span)],
        [
          "shielded",
          terminator.cancellable
            ? this.#binary(
                "===",
                this.#optionalProperty(parent, "shielded", span),
                this.#data(true, span),
                span,
              )
            : this.#data(true, span),
        ],
        ["phase", this.#data("body", span)],
      ];
      if (terminator.catch) {
        fields.push([
          "catch",
          this.#record(
            [
              ["block", this.#data(terminator.catch.block, span)],
              ["result", this.#data(terminator.catch.result, span)],
            ],
            span,
          ),
        ]);
      }
      if (terminator.cleanup) {
        fields.push(["cleanup", this.#data(terminator.cleanup, span)]);
      }
      if (terminator.next) fields.push(["next", this.#data(terminator.next, span)]);
      const withoutParent = this.#record(fields, span);
      const withParent = this.#record([...fields, ["parent", parent]], span);
      return [
        {
          kind: "if",
          condition: this.#present(parent, span),
          consequent: [this.#setExecution("scope", withParent, span)],
          alternate: [this.#setExecution("scope", withoutParent, span)],
          span,
        },
        this.#setExecution("block", this.#data(terminator.body, span), span),
      ];
    }
    if (terminator.kind === "leave-scope") {
      const scope = this.#executionProperty("scope", workflowDataType, span);
      return this.#transfer(
        this.#record(
          [
            ["kind", this.#data("continue", span)],
            ["next", this.#property(scope, "next", span)],
          ],
          span,
        ),
        span,
        blockIndex,
      );
    }
    if (terminator.kind === "complete-cleanup") {
      const scope = `$workflow/completed-scope/${blockIndex}`;
      return [
        {
          kind: "let",
          name: scope,
          mutable: false,
          value: this.#executionProperty("scope", workflowDataType, span),
          span,
        },
        this.#setExecution(
          "scope",
          this.#optionalProperty(this.#local(scope, workflowDataType, span), "parent", span),
          span,
        ),
        ...this.#transfer(
          this.#cancellationAfterShield(
            this.#local(scope, workflowDataType, span),
            this.#property(this.#local(scope, workflowDataType, span), "completion", span),
            span,
          ),
          span,
          blockIndex,
        ),
      ];
    }
    if (terminator.kind === "continue-as-new") {
      return this.#transfer(
        this.#record(
          [
            ["kind", this.#data("continue-as-new", span)],
            ["input", this.#expression(terminator.input, span)],
          ],
          span,
        ),
        span,
        blockIndex,
      );
    }
    if (terminator.kind === "return") {
      return this.#transfer(
        this.#record(
          [
            ["kind", this.#data("return", span)],
            ["value", this.#expression(terminator.value, span)],
          ],
          span,
        ),
        span,
        blockIndex,
      );
    }
    return this.#transfer(
      this.#record(
        [
          ["kind", this.#data("fail", span)],
          [
            "failure",
            this.#record(
              [
                ["type", this.#data("declared", span)],
                ["value", this.#expression(terminator.value, span)],
              ],
              span,
            ),
          ],
        ],
        span,
      ),
      span,
      blockIndex,
    );
  }

  #suspend(pending: ExpressionIR, span: SourceSpan, suffix: number): readonly StatementIR[] {
    return this.#interruptOr(this.#rawSuspend(pending, span, true), span, suffix);
  }

  #rawSuspend(pending: ExpressionIR, span: SourceSpan, increment: boolean): readonly StatementIR[] {
    return [
      this.#setExecution("pending", pending, span),
      ...(increment ? [this.#setExecution("sequence", this.#data(1, span), span, "+=")] : []),
      this.#setExecution("status", this.#data("suspended", span), span),
    ];
  }

  #interruptOr(
    work: readonly StatementIR[],
    span: SourceSpan,
    suffix: number | string,
  ): readonly StatementIR[] {
    const cancellation = this.#executionProperty("cancellation", workflowDataType, span);
    return [
      {
        kind: "if",
        condition: this.#binary(
          "&&",
          this.#present(cancellation, span),
          this.#scopeCancellable(span),
          span,
        ),
        consequent: this.#transfer(
          this.#record(
            [
              ["kind", this.#data("cancel", span)],
              ["cancellation", cancellation],
            ],
            span,
          ),
          span,
          `${suffix}/interrupt`,
        ),
        alternate: work,
        span,
      },
    ];
  }

  #transfer(
    value: ExpressionIR,
    span: SourceSpan,
    suffix: number | string,
  ): readonly StatementIR[] {
    const transfer = `$workflow/transfer/${suffix}`;
    const active = `$workflow/transfer-active/${suffix}`;
    const scope = `$workflow/transfer-scope/${suffix}`;
    const transferValue = this.#local(transfer, workflowDataType, span);
    const scopeValue = this.#local(scope, workflowDataType, span);
    const kind = this.#property(transferValue, "kind", span);
    const phase = this.#property(scopeValue, "phase", span);
    const caught = this.#optionalProperty(scopeValue, "catch", span);
    const cleanup = this.#optionalProperty(scopeValue, "cleanup", span);

    const popAndContinue: StatementIR[] = [
      this.#setExecution("scope", this.#optionalProperty(scopeValue, "parent", span), span),
      {
        kind: "assign",
        name: transfer,
        operator: "=",
        value: this.#cancellationAfterShield(scopeValue, transferValue, span),
        span,
      },
      {
        kind: "if",
        condition: this.#binary(
          "===",
          this.#property(transferValue, "kind", span),
          this.#data("continue", span),
          span,
        ),
        consequent: this.#finishTransfer(transferValue, active, span),
        alternate: [],
        span,
      },
    ];

    return [
      this.#setExecution("pending", { kind: "none", type: workflowVoidType, span }, span),
      this.#setExecution("status", this.#data("running", span), span),
      {
        kind: "let",
        name: transfer,
        mutable: true,
        value,
        span,
      },
      {
        kind: "let",
        name: active,
        mutable: true,
        value: this.#data(true, span),
        span,
      },
      {
        kind: "while",
        condition: this.#local(active, workflowBooleanType, span),
        body: [
          {
            kind: "let",
            name: scope,
            mutable: false,
            value: this.#executionProperty("scope", workflowDataType, span),
            span,
          },
          {
            kind: "if",
            condition: {
              kind: "unary",
              operator: "!",
              value: this.#present(scopeValue, span),
              type: workflowBooleanType,
              span,
            },
            consequent: this.#finishTransfer(transferValue, active, span),
            alternate: [
              {
                kind: "if",
                condition: this.#binary("===", phase, this.#data("cleanup", span), span),
                consequent: popAndContinue,
                alternate: [
                  {
                    kind: "if",
                    condition: this.#binary(
                      "&&",
                      this.#binary(
                        "&&",
                        this.#binary("===", kind, this.#data("fail", span), span),
                        this.#binary("===", phase, this.#data("body", span), span),
                        span,
                      ),
                      this.#present(caught, span),
                      span,
                    ),
                    consequent: [
                      this.#setProperty(scopeValue, "phase", this.#data("catch", span), span),
                      this.#setDynamicLocal(
                        this.#property(caught, "result", span),
                        this.#property(transferValue, "failure", span),
                        span,
                      ),
                      this.#setExecution("block", this.#property(caught, "block", span), span),
                      {
                        kind: "assign",
                        name: active,
                        operator: "=",
                        value: this.#data(false, span),
                        span,
                      },
                    ],
                    alternate: [
                      {
                        kind: "if",
                        condition: this.#present(cleanup, span),
                        consequent: [
                          this.#setProperty(scopeValue, "phase", this.#data("cleanup", span), span),
                          this.#setProperty(scopeValue, "completion", transferValue, span),
                          this.#setExecution("block", cleanup, span),
                          {
                            kind: "assign",
                            name: active,
                            operator: "=",
                            value: this.#data(false, span),
                            span,
                          },
                        ],
                        alternate: popAndContinue,
                        span,
                      },
                    ],
                    span,
                  },
                ],
                span,
              },
            ],
            span,
          },
        ],
        span,
      },
    ];
  }

  #finishTransfer(
    transfer: ExpressionIR,
    active: string,
    span: SourceSpan,
  ): readonly StatementIR[] {
    const kind = this.#property(transfer, "kind", span);
    const stop: StatementIR = {
      kind: "assign",
      name: active,
      operator: "=",
      value: this.#data(false, span),
      span,
    };
    return [
      {
        kind: "if",
        condition: this.#binary("===", kind, this.#data("continue", span), span),
        consequent: [
          this.#setExecution("block", this.#property(transfer, "next", span), span),
          this.#setExecution("status", this.#data("running", span), span),
          stop,
        ],
        alternate: [
          this.#setExecution("scope", { kind: "none", type: workflowVoidType, span }, span),
          {
            kind: "if",
            condition: this.#binary("===", kind, this.#data("continue-as-new", span), span),
            consequent: [
              this.#setExecution(
                "continuedInput",
                this.#optionalProperty(transfer, "input", span),
                span,
              ),
              this.#setExecution(
                "cancellation",
                { kind: "none", type: workflowVoidType, span },
                span,
              ),
              this.#setExecution("failure", { kind: "none", type: workflowVoidType, span }, span),
              this.#setExecution("result", { kind: "none", type: workflowVoidType, span }, span),
              this.#setExecution("status", this.#data("continued", span), span),
            ],
            alternate: [
              {
                kind: "if",
                condition: this.#binary("===", kind, this.#data("return", span), span),
                consequent: [
                  this.#setExecution(
                    "result",
                    this.#optionalProperty(transfer, "value", span),
                    span,
                  ),
                  this.#setExecution("status", this.#data("succeeded", span), span),
                ],
                alternate: [
                  {
                    kind: "if",
                    condition: this.#binary("===", kind, this.#data("fail", span), span),
                    consequent: [
                      this.#setExecution(
                        "failure",
                        this.#property(transfer, "failure", span),
                        span,
                      ),
                      this.#setExecution("status", this.#data("failed", span), span),
                    ],
                    alternate: [
                      this.#setExecution(
                        "cancellation",
                        this.#property(transfer, "cancellation", span),
                        span,
                      ),
                      this.#setExecution("status", this.#data("cancelled", span), span),
                    ],
                    span,
                  },
                ],
                span,
              },
            ],
            span,
          },
          stop,
        ],
        span,
      },
    ];
  }

  #cancellationAfterShield(
    exited: ExpressionIR,
    transfer: ExpressionIR,
    span: SourceSpan,
  ): ExpressionIR {
    const cancellation = this.#executionProperty("cancellation", workflowDataType, span);
    const kind = this.#property(transfer, "kind", span);
    return {
      kind: "conditional",
      condition: this.#binary(
        "&&",
        this.#binary(
          "&&",
          this.#binary(
            "&&",
            this.#binary(
              "===",
              this.#property(exited, "cancellable", span),
              this.#data(false, span),
              span,
            ),
            this.#present(cancellation, span),
            span,
          ),
          this.#scopeCancellable(span),
          span,
        ),
        this.#binary(
          "&&",
          this.#binary("!==", kind, this.#data("fail", span), span),
          this.#binary("!==", kind, this.#data("cancel", span), span),
          span,
        ),
        span,
      ),
      consequent: this.#record(
        [
          ["kind", this.#data("cancel", span)],
          ["cancellation", cancellation],
        ],
        span,
      ),
      alternate: transfer,
      type: workflowDataType,
      span,
    };
  }

  #scopeCancellable(span: SourceSpan): ExpressionIR {
    return this.#binary(
      "!==",
      this.#optionalProperty(
        this.#executionProperty("scope", workflowDataType, span),
        "shielded",
        span,
      ),
      this.#data(true, span),
      span,
    );
  }

  #expression(expression: WorkflowIRExpression, span: SourceSpan): ExpressionIR {
    if (expression.kind === "literal") return this.#data(expression.value, span);
    if (expression.kind === "none") {
      return { kind: "none", type: workflowVoidType, span };
    }
    if (expression.kind === "identity") {
      return this.#path(
        this.#executionProperty("identity", workflowDataType, span),
        expression.path,
        span,
      );
    }
    if (expression.kind === "invocation") {
      return this.#path(
        this.#executionProperty("invocation", workflowDataType, span),
        expression.path,
        span,
      );
    }
    if (expression.kind === "input") {
      return this.#path(
        this.#executionProperty("input", workflowDataType, span),
        expression.path,
        span,
      );
    }
    if (expression.kind === "state") {
      return this.#path(
        this.#executionProperty("state", workflowDataType, span),
        expression.path,
        span,
      );
    }
    if (expression.kind === "history") {
      return this.#path(
        this.#executionProperty("history", workflowDataType, span),
        expression.path,
        span,
      );
    }
    if (expression.kind === "local") {
      return {
        kind: "index",
        value: this.#executionProperty("locals", workflowDataType, span),
        index: this.#data(expression.name, span),
        type: workflowDataType,
        span,
      };
    }
    if (expression.kind === "time") {
      return this.#executionProperty("time", workflowNumberType, span);
    }
    if (expression.kind === "array") {
      return this.#array(
        expression.values.map((value) => this.#expression(value, span)),
        span,
      );
    }
    if (expression.kind === "record") {
      return this.#record(
        expression.fields.map(({ name, value }) => [name, this.#expression(value, span)]),
        span,
      );
    }
    if (expression.kind === "record-merge") {
      return {
        kind: "record-merge",
        entries: expression.entries.map((entry) =>
          entry.kind === "field"
            ? { kind: "field", name: entry.name, value: this.#expression(entry.value, span) }
            : { kind: "spread", value: this.#expression(entry.value, span) },
        ),
        type: workflowDataType,
        span,
      };
    }
    if (expression.kind === "property") {
      return this.#property(this.#expression(expression.value, span), expression.name, span);
    }
    if (expression.kind === "index") {
      return {
        kind: "index",
        value: this.#expression(expression.value, span),
        index: this.#expression(expression.index, span),
        type: workflowDataType,
        span,
      };
    }
    if (expression.kind === "binary") {
      return this.#binary(
        expression.operator,
        this.#expression(expression.left, span),
        this.#expression(expression.right, span),
        span,
      );
    }
    if (expression.kind === "unary") {
      return {
        kind: "unary",
        operator: expression.operator,
        value: this.#expression(expression.value, span),
        type: expression.operator === "-" ? workflowNumberType : workflowBooleanType,
        span,
      };
    }
    return {
      kind: "conditional",
      condition: this.#expression(expression.condition, span),
      consequent: this.#expression(expression.consequent, span),
      alternate: this.#expression(expression.alternate, span),
      type: workflowDataType,
      span,
    };
  }

  #path(value: ExpressionIR, path: readonly string[], span: SourceSpan): ExpressionIR {
    return path.reduce((current, name) => this.#property(current, name, span), value);
  }

  #executionProperty(
    name: string,
    type: TypeIR = workflowDataType,
    span: SourceSpan = this.span,
  ): ExpressionIR {
    return {
      kind: "property",
      value: this.#local(this.#execution, this.executionType, span),
      name,
      type,
      span,
    };
  }

  #property(value: ExpressionIR, name: string, span: SourceSpan): ExpressionIR {
    return { kind: "property", value, name, type: workflowDataType, span };
  }

  #optionalProperty(value: ExpressionIR, name: string, span: SourceSpan): ExpressionIR {
    return {
      kind: "property",
      value,
      name,
      optional: true,
      type: workflowDataType,
      span,
    };
  }

  #present(value: ExpressionIR, span: SourceSpan): ExpressionIR {
    return {
      kind: "unary",
      operator: "present",
      value,
      type: workflowBooleanType,
      span,
    };
  }

  #setExecution(
    property: string,
    value: ExpressionIR,
    span: SourceSpan,
    operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=" = "=",
  ): StatementIR {
    return {
      kind: "property-assign",
      target: this.#local(this.#execution, this.executionType, span),
      property,
      operator,
      value,
      span,
    };
  }

  #setProperty(
    target: ExpressionIR,
    property: string,
    value: ExpressionIR,
    span: SourceSpan,
  ): StatementIR {
    return {
      kind: "property-assign",
      target,
      property,
      operator: "=",
      value,
      span,
    };
  }

  #setDynamicLocal(index: ExpressionIR, value: ExpressionIR, span: SourceSpan): StatementIR {
    return {
      kind: "index-assign",
      target: this.#executionProperty("locals", workflowDataType, span),
      index,
      operator: "=",
      value,
      span,
    };
  }

  #setLocal(
    name: string,
    operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=",
    value: ExpressionIR,
    span: SourceSpan,
  ): StatementIR {
    return {
      kind: "index-assign",
      target: this.#executionProperty("locals", workflowDataType, span),
      index: this.#data(name, span),
      operator,
      value,
      span,
    };
  }

  #record(fields: readonly (readonly [string, ExpressionIR])[], span: SourceSpan): ExpressionIR {
    return {
      kind: "record",
      fields: fields.map(([name, value]) => ({ name, value })),
      type: workflowDataType,
      span,
    };
  }

  #array(values: readonly ExpressionIR[], span: SourceSpan): ExpressionIR {
    return {
      kind: "array",
      values,
      type: { kind: "array", element: workflowDataType },
      span,
    };
  }

  #binary(
    operator: Extract<ExpressionIR, { kind: "binary" }>["operator"],
    left: ExpressionIR,
    right: ExpressionIR,
    span: SourceSpan,
  ): ExpressionIR {
    return {
      kind: "binary",
      operator,
      left,
      right,
      type: ["===", "!==", "<", "<=", ">", ">="].includes(operator)
        ? workflowBooleanType
        : workflowDataType,
      span,
    };
  }

  #local(name: string, type: TypeIR, span: SourceSpan): ExpressionIR {
    return { kind: "local", name, type, span };
  }

  #data(value: ExtensionIR, span: SourceSpan): ExpressionIR {
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      return {
        kind: "literal",
        value,
        type:
          value === null
            ? { kind: "primitive", name: "null" }
            : typeof value === "boolean"
              ? workflowBooleanType
              : typeof value === "number"
                ? workflowNumberType
                : { kind: "primitive", name: "string" },
        span,
      };
    }
    if (Array.isArray(value)) {
      return this.#array(
        value.map((item) => this.#data(item, span)),
        span,
      );
    }
    return this.#record(
      Object.entries(value).map(([name, item]) => [name, this.#data(item, span)]),
      span,
    );
  }
}

function workflowModel(context: FeatureSourceContext): ts.Type | undefined {
  const feature = context.checker.getTypeAtLocation(context.location);
  for (const symbol of feature.getProperties()) {
    const retained = symbol.declarations?.some(
      (declaration) =>
        ts.isPropertySignature(declaration) &&
        ts.isComputedPropertyName(declaration.name) &&
        ts.isIdentifier(declaration.name.expression) &&
        declaration.name.expression.text === "workflowDefinition",
    );
    if (!retained) continue;
    const marker = context.checker.getTypeOfSymbolAtLocation(symbol, context.location);
    return marker.isUnion()
      ? marker.types.find((type) => !(type.flags & ts.TypeFlags.Undefined))
      : marker;
  }
  return undefined;
}

function workflowCall(context: FeatureSourceContext): ts.CallExpression {
  const location = unwrap(context.location);
  if (!ts.isCallExpression(location)) {
    context.source.fail(
      context.location,
      "Workflow definition must remain a statically visible createWorkflow call.",
    );
  }
  let symbol = context.checker.getSymbolAtLocation(location.expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = context.checker.getAliasedSymbol(symbol);
  }
  if (symbol?.getName() !== "createWorkflow") {
    context.source.fail(
      location,
      "Workflow definition must remain a statically visible createWorkflow call.",
    );
  }
  return location;
}

function workflowRuntimeIRCall(context: PortableConstantSourceContext): boolean {
  return workflowInternalCall(context, "workflowRuntimeIR");
}

function workflowDependencyCatalogueCall(context: PortableConstantSourceContext): boolean {
  return workflowInternalCall(context, "workflowDependencyCatalogue");
}

function workflowRuntimeAdvanceCall(context: PortableCallSourceContext): boolean {
  return workflowInternalCall(context, "workflowRuntimeAdvance");
}

function workflowRuntimeTransferCall(context: PortableCallSourceContext): boolean {
  return workflowInternalCall(context, "workflowRuntimeTransfer");
}

function workflowInternalCall(
  context: PortableConstantSourceContext,
  name:
    | "workflowDependencyCatalogue"
    | "workflowRuntimeIR"
    | "workflowRuntimeAdvance"
    | "workflowRuntimeTransfer",
): boolean {
  let symbol = context.checker.getSymbolAtLocation(context.call.expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = context.checker.getAliasedSymbol(symbol);
  }
  if (symbol?.getName() !== name) return false;
  return Boolean(
    symbol.declarations?.some((declaration) =>
      declaration
        .getSourceFile()
        .fileName.replaceAll("\\", "/")
        .endsWith("/features/workflow/index.ts"),
    ),
  );
}

function workflowContractIR(
  context: WorkflowDefinitionSourceContext,
  model: ts.Type,
  at: ts.Node,
): WorkflowDefinitionIR["contract"] {
  const field = (name: string): ts.Type => {
    const value = context.source.property(model, name, at);
    if (!value) context.source.fail(at, `Workflow model requires ${name}.`);
    return value;
  };
  const actions: Record<
    string,
    Readonly<{ input: TypeSchema; result: TypeSchema; failures: TypeSchema }>
  > = {};
  const actionType = field("Actions");
  for (const action of context.source.properties(actionType)) {
    const type = context.checker.getTypeOfSymbolAtLocation(action, action.valueDeclaration ?? at);
    actions[action.getName()] = {
      input: schema(context, fieldOf(context, type, "Input", at), at),
      result: schema(context, fieldOf(context, type, "Result", at), at),
      failures: schema(context, fieldOf(context, type, "Failures", at), at),
    };
  }
  const dependencyType = field("Dependencies");
  const dependencyIR = context.source.dependencies(dependencyType, at);
  const dependencies = Object.fromEntries(
    dependencyIR.map((dependency) => [dependency.name, dependency.type as unknown as TypeSchema]),
  );
  const children = context.source
    .properties(dependencyType)
    .filter((dependency) => {
      const type = context.checker.getTypeOfSymbolAtLocation(
        dependency,
        dependency.valueDeclaration ?? at,
      );
      return workflowReferenceDependency(type);
    })
    .map((dependency) => dependency.getName())
    .sort();
  const stateType = field("State");
  const visibility = context.source
    .properties(field("Visibility"))
    .map((visible) => {
      const name = visible.getName();
      const stateField = stateType.getProperty(name);
      if (stateField === undefined) {
        context.source.fail(
          at,
          `Workflow visibility field ${JSON.stringify(name)} is not in State.`,
        );
      }
      const stateFieldType = context.checker.getTypeOfSymbolAtLocation(
        stateField,
        stateField.valueDeclaration ?? at,
      );
      const lowered = schema(context, stateFieldType, at) as unknown as TypeIR;
      if (!workflowVisibilityType(lowered)) {
        context.source.fail(
          stateField.valueDeclaration ?? at,
          `Workflow visibility field ${JSON.stringify(name)} must be a scalar State value.`,
        );
      }
      return name;
    })
    .sort();
  return {
    name: context.source.literal(model, "Name", at),
    revision: context.source.numberLiteral(model, "Revision", at),
    input: schema(context, field("Input"), at),
    state: schema(context, field("State"), at),
    result: schema(context, field("Result"), at),
    failures: schema(context, field("Failures"), at),
    actions: Object.freeze(actions),
    dependencies: Object.freeze(dependencies),
    children: Object.freeze(children),
    visibility: Object.freeze(visibility),
  };
}

function workflowVisibilityType(type: TypeIR): boolean {
  if (type.kind === "literal") return true;
  if (type.kind === "primitive") {
    return (
      type.name === "boolean" ||
      type.name === "null" ||
      type.name === "number" ||
      type.name === "string"
    );
  }
  if (type.kind === "option") return workflowVisibilityType(type.value);
  if (type.kind === "union") return type.variants.every(workflowVisibilityType);
  return false;
}

function workflowReferenceDependency(type: ts.Type): boolean {
  return type.getProperties().some((property) =>
    property.declarations?.some((declaration) => {
      if (
        !ts.isPropertySignature(declaration) ||
        !ts.isComputedPropertyName(declaration.name) ||
        !ts.isIdentifier(declaration.name.expression) ||
        declaration.name.expression.text !== "workflowReferenceDefinition"
      ) {
        return false;
      }
      return declaration
        .getSourceFile()
        .fileName.replaceAll("\\", "/")
        .endsWith("/features/workflow/index.ts");
    }),
  );
}

function fieldOf(
  context: WorkflowDefinitionSourceContext,
  type: ts.Type,
  name: string,
  at: ts.Node,
): ts.Type {
  const value = context.source.property(type, name, at);
  if (!value) context.source.fail(at, `Workflow declaration requires ${name}.`);
  return value;
}

function schema(context: WorkflowDefinitionSourceContext, type: ts.Type, at: ts.Node): TypeSchema {
  return context.source.lower(type, at) as unknown as TypeSchema;
}

function unwrap(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function workflowLoweringError(span: WorkflowIRSourceSpan, message: string): TypeError {
  return new TypeError(`${span.file}:${span.line}:${span.column}: ${message}`);
}
