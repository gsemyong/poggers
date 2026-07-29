import type { TypeIR } from "@/compiler/ir";
import type { TypeSchema } from "@/core/intrinsic";

export const WORKFLOW_IR_VERSION = 5 as const;
export const WORKFLOW_LANGUAGE_VERSION = 1 as const;
export const WORKFLOW_EXECUTABLE_VERSION = 1 as const;

export type WorkflowIRData =
  | null
  | boolean
  | number
  | string
  | readonly WorkflowIRData[]
  | Readonly<{ [name: string]: WorkflowIRData }>;

export type WorkflowIRSourceSpan = Readonly<{
  file: string;
  line: number;
  column: number;
}>;

export type WorkflowIRExpression =
  | Readonly<{ kind: "literal"; value: WorkflowIRData }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "input"; path: readonly string[] }>
  | Readonly<{ kind: "state"; path: readonly string[] }>
  | Readonly<{ kind: "history"; path: readonly string[] }>
  | Readonly<{ kind: "identity"; path: readonly string[] }>
  | Readonly<{ kind: "invocation"; path: readonly string[] }>
  | Readonly<{ kind: "local"; name: string }>
  | Readonly<{ kind: "time" }>
  | Readonly<{ kind: "array"; values: readonly WorkflowIRExpression[] }>
  | Readonly<{
      kind: "record";
      fields: readonly Readonly<{ name: string; value: WorkflowIRExpression }>[];
    }>
  | Readonly<{
      kind: "record-merge";
      entries: readonly (
        | Readonly<{ kind: "field"; name: string; value: WorkflowIRExpression }>
        | Readonly<{ kind: "spread"; value: WorkflowIRExpression }>
      )[];
    }>
  | Readonly<{ kind: "property"; value: WorkflowIRExpression; name: string }>
  | Readonly<{
      kind: "index";
      value: WorkflowIRExpression;
      index: WorkflowIRExpression;
    }>
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
      left: WorkflowIRExpression;
      right: WorkflowIRExpression;
    }>
  | Readonly<{
      kind: "unary";
      operator: "!" | "-" | "present";
      value: WorkflowIRExpression;
    }>
  | Readonly<{
      kind: "conditional";
      condition: WorkflowIRExpression;
      consequent: WorkflowIRExpression;
      alternate: WorkflowIRExpression;
    }>;

export type WorkflowIRInstruction =
  | Readonly<{
      kind: "let";
      name: string;
      value: WorkflowIRExpression;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{
      kind: "assign";
      name: string;
      operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=";
      value: WorkflowIRExpression;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{
      kind: "state";
      path: readonly string[];
      operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=";
      value: WorkflowIRExpression;
      span?: WorkflowIRSourceSpan;
    }>;

export type WorkflowIRConcurrentEffect = Readonly<{
  kind: "effect";
  dependency: string;
  operation: string;
  input: WorkflowIRExpression;
  options?: WorkflowIRExpression;
}>;

export type WorkflowIRTerminator =
  | Readonly<{ kind: "jump"; next: string; span?: WorkflowIRSourceSpan }>
  | Readonly<{
      kind: "branch";
      condition: WorkflowIRExpression;
      consequent: string;
      alternate: string;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{
      kind: "effect";
      dependency: string;
      operation: string;
      input: WorkflowIRExpression;
      options?: WorkflowIRExpression;
      result: string;
      next: string;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{
      kind: "child";
      dependency: string;
      operation: string;
      input: WorkflowIRExpression;
      options?: WorkflowIRExpression;
      result: string;
      next: string;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{
      kind: "sleep";
      timing:
        | Readonly<{ kind: "for"; value: WorkflowIRExpression }>
        | Readonly<{ kind: "until"; value: WorkflowIRExpression }>;
      next: string;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{
      kind: "wait";
      condition: WorkflowIRExpression;
      timeout?:
        | Readonly<{ kind: "for"; value: WorkflowIRExpression }>
        | Readonly<{ kind: "until"; value: WorkflowIRExpression }>;
      result: string;
      next: string;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{
      kind: "concurrent";
      operation: "all" | "all-settled" | "race";
      effects: readonly WorkflowIRConcurrentEffect[];
      result: string;
      next: string;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{
      kind: "enter-scope";
      id: string;
      cancellable: boolean;
      body: string;
      catch?: Readonly<{ block: string; result: string }>;
      cleanup?: string;
      next?: string;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{ kind: "leave-scope"; span?: WorkflowIRSourceSpan }>
  | Readonly<{ kind: "complete-cleanup"; span?: WorkflowIRSourceSpan }>
  | Readonly<{
      kind: "continue-as-new";
      input: WorkflowIRExpression;
      span?: WorkflowIRSourceSpan;
    }>
  | Readonly<{ kind: "return"; value: WorkflowIRExpression; span?: WorkflowIRSourceSpan }>
  | Readonly<{ kind: "fail"; value: WorkflowIRExpression; span?: WorkflowIRSourceSpan }>;

export type WorkflowIRBlock = Readonly<{
  id: string;
  body: readonly WorkflowIRInstruction[];
  terminator: WorkflowIRTerminator;
  span?: WorkflowIRSourceSpan;
}>;

export type WorkflowIRProcedure = Readonly<{
  entry: string;
  blocks: readonly WorkflowIRBlock[];
}>;

export type WorkflowDefinitionIR = Readonly<{
  version: typeof WORKFLOW_IR_VERSION;
  language: typeof WORKFLOW_LANGUAGE_VERSION;
  compiler: string;
  contract: Readonly<{
    name: string;
    revision: number;
    input: TypeSchema;
    state: TypeSchema;
    result: TypeSchema;
    failures: TypeSchema;
    actions: Readonly<
      Record<
        string,
        Readonly<{
          input: TypeSchema;
          result: TypeSchema;
          failures: TypeSchema;
        }>
      >
    >;
    dependencies: Readonly<Record<string, TypeSchema>>;
    children: readonly string[];
    visibility: readonly string[];
  }>;
  initialization: WorkflowIRProcedure;
  actionHandlers: Readonly<Record<string, WorkflowIRProcedure>>;
  entry: string;
  blocks: readonly WorkflowIRBlock[];
}>;

export type WorkflowExecutableData = object | string | number | boolean | null;

export type WorkflowExecutableExpressionOperation =
  | Readonly<{ kind: "literal"; value: WorkflowExecutableData }>
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "read";
      source: "identity" | "invocation" | "input" | "state" | "history";
      path: readonly string[];
    }>
  | Readonly<{ kind: "local"; name: string }>
  | Readonly<{ kind: "time" }>
  | Readonly<{ kind: "array"; count: number }>
  | Readonly<{ kind: "record"; fields: readonly string[] }>
  | Readonly<{
      kind: "record-merge";
      entries: readonly (
        | Readonly<{ kind: "field"; name: string }>
        | Readonly<{ kind: "spread" }>
      )[];
    }>
  | Readonly<{ kind: "property"; name: string }>
  | Readonly<{ kind: "index" }>
  | Readonly<{ kind: "unary"; operator: "!" | "-" | "present" }>
  | Readonly<{
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "%" | "===" | "!==" | "<" | "<=" | ">" | ">=";
    }>
  | Readonly<{
      kind: "branch";
      condition: "falsy" | "truthy" | "present";
      target: number;
      keep: boolean;
    }>
  | Readonly<{ kind: "drop" }>
  | Readonly<{ kind: "jump"; target: number }>;

export type WorkflowExecutableExpression = readonly WorkflowExecutableExpressionOperation[];

export type WorkflowExecutableInstruction =
  | Readonly<{
      kind: "let";
      name: string;
      value: WorkflowExecutableExpression;
    }>
  | Readonly<{
      kind: "assign";
      name: string;
      operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=";
      value: WorkflowExecutableExpression;
    }>
  | Readonly<{
      kind: "state";
      path: readonly string[];
      operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=";
      value: WorkflowExecutableExpression;
    }>;

export type WorkflowExecutableEffect = Readonly<{
  dependency: string;
  operation: string;
  input: WorkflowExecutableExpression;
  options?: WorkflowExecutableExpression;
}>;

export type WorkflowExecutableTiming =
  | Readonly<{ kind: "for"; value: WorkflowExecutableExpression }>
  | Readonly<{ kind: "until"; value: WorkflowExecutableExpression }>;

export type WorkflowExecutableTerminator =
  | Readonly<{ kind: "jump"; next: string }>
  | Readonly<{
      kind: "branch";
      condition: WorkflowExecutableExpression;
      consequent: string;
      alternate: string;
    }>
  | Readonly<{
      kind: "effect" | "child";
      dependency: string;
      operation: string;
      input: WorkflowExecutableExpression;
      options?: WorkflowExecutableExpression;
      result: string;
      next: string;
    }>
  | Readonly<{ kind: "sleep"; timing: WorkflowExecutableTiming; next: string }>
  | Readonly<{
      kind: "wait";
      condition: WorkflowExecutableExpression;
      conditionIR: object;
      timeout?: WorkflowExecutableTiming;
      result: string;
      next: string;
    }>
  | Readonly<{
      kind: "concurrent";
      operation: "all" | "all-settled" | "race";
      effects: readonly WorkflowExecutableEffect[];
      result: string;
      next: string;
    }>
  | Readonly<{
      kind: "enter-scope";
      id: string;
      cancellable: boolean;
      body: string;
      catch?: Readonly<{ block: string; result: string }>;
      cleanup?: string;
      next?: string;
    }>
  | Readonly<{ kind: "leave-scope" }>
  | Readonly<{ kind: "complete-cleanup" }>
  | Readonly<{ kind: "continue-as-new"; input: WorkflowExecutableExpression }>
  | Readonly<{ kind: "return" | "fail"; value: WorkflowExecutableExpression }>;

export type WorkflowExecutableBlock = Readonly<{
  id: string;
  body: readonly WorkflowExecutableInstruction[];
  terminator: WorkflowExecutableTerminator;
}>;

export type WorkflowExecutableProcedure = Readonly<{
  entry: string;
  blocks: readonly WorkflowExecutableBlock[];
}>;

export type WorkflowExecutableDefinition = Readonly<{
  version: typeof WORKFLOW_EXECUTABLE_VERSION;
  revision: number;
  initialization: WorkflowExecutableProcedure;
  actionHandlers: Readonly<Record<string, WorkflowExecutableProcedure>>;
  run: WorkflowExecutableProcedure;
}>;

export type WorkflowArtifact = Readonly<{
  id: string;
  definition: WorkflowDefinitionIR;
  executable: WorkflowExecutableDefinition;
}>;

export type WorkflowIRPending =
  | Readonly<{
      kind: "effect";
      sequence: number;
      cancellable: boolean;
      dependency: string;
      operation: string;
      input: WorkflowIRData | undefined;
      options?: WorkflowIRData;
      result: string;
      next: string;
    }>
  | Readonly<{
      kind: "child";
      sequence: number;
      cancellable: boolean;
      dependency: string;
      operation: string;
      input: WorkflowIRData | undefined;
      options?: WorkflowIRData;
      result: string;
      next: string;
    }>
  | Readonly<{
      kind: "sleep";
      sequence: number;
      cancellable: boolean;
      at: number;
      next: string;
    }>
  | Readonly<{
      kind: "wait";
      sequence: number;
      cancellable: boolean;
      condition: WorkflowIRExpression;
      until?: number;
      result: string;
      next: string;
    }>
  | Readonly<{
      kind: "concurrent";
      cancellable: boolean;
      operation: "all" | "all-settled" | "race";
      effects: readonly Readonly<{
        sequence: number;
        dependency: string;
        operation: string;
        input: WorkflowIRData | undefined;
        options?: WorkflowIRData;
        status: "pending" | "succeeded" | "failed";
        value?: WorkflowIRData;
        failure?: WorkflowIRFailure;
      }>[];
      result: string;
      next: string;
    }>;

export type WorkflowIRFailure =
  | Readonly<{ type: "declared"; value: WorkflowIRData | undefined }>
  | Readonly<{
      type: "effect";
      dependency: string;
      operation: string;
      failure: WorkflowIRData;
    }>
  | Readonly<{ type: "resource"; limit: number }>;

export type WorkflowIRCancellation = Readonly<{
  at: number;
  reason?: WorkflowIRData;
}>;

export type WorkflowIRTransfer =
  | Readonly<{ kind: "continue"; next: string }>
  | Readonly<{ kind: "continue-as-new"; input?: WorkflowIRData }>
  | Readonly<{ kind: "return"; value?: WorkflowIRData }>
  | Readonly<{ kind: "fail"; failure: WorkflowIRFailure }>
  | Readonly<{ kind: "cancel"; cancellation: WorkflowIRCancellation }>;

export type WorkflowIRScopeFrame = Readonly<{
  id: string;
  cancellable: boolean;
  shielded: boolean;
  phase: "body" | "catch" | "cleanup";
  catch?: Readonly<{ block: string; result: string }>;
  cleanup?: string;
  next?: string;
  completion?: WorkflowIRTransfer;
  parent?: WorkflowIRScopeFrame;
}>;

export type WorkflowIRExecution = Readonly<{
  definition: number;
  status: "running" | "suspended" | "continued" | "succeeded" | "failed" | "cancelled";
  identity?: WorkflowIRData;
  invocation?: WorkflowIRData;
  input?: WorkflowIRData;
  history: Readonly<{ events: number; continueSuggested: boolean }>;
  state: Readonly<Record<string, WorkflowIRData>>;
  block: string;
  locals: Readonly<Record<string, WorkflowIRData>>;
  sequence: number;
  time: number;
  scope?: WorkflowIRScopeFrame;
  cancellation?: WorkflowIRCancellation;
  pending?: WorkflowIRPending;
  continuedInput?: WorkflowIRData;
  result?: WorkflowIRData;
  failure?: WorkflowIRFailure;
}>;

export type WorkflowIRCompletion =
  | Readonly<{
      kind: "effect";
      sequence: number;
      at: number;
      outcome:
        | Readonly<{ status: "succeeded"; value?: WorkflowIRData }>
        | Readonly<{ status: "failed"; failure: WorkflowIRData }>;
    }>
  | Readonly<{ kind: "sleep"; sequence: number; at: number }>
  | Readonly<{ kind: "wait"; sequence: number; at: number; timedOut: true }>
  | Readonly<{
      kind: "concurrent";
      sequence: number;
      at: number;
      outcome:
        | Readonly<{ status: "succeeded"; value?: WorkflowIRData }>
        | Readonly<{ status: "failed"; failure: WorkflowIRData }>;
    }>;

export type WorkflowIRReplayStep = Readonly<{
  command: WorkflowIRPending;
  resolution:
    | Readonly<{ kind: "completion"; completion: WorkflowIRCompletion }>
    | Readonly<{
        kind: "state";
        state: Readonly<Record<string, WorkflowIRData>>;
      }>;
}>;

export type WorkflowIRReplayTrace = Readonly<{
  input?: WorkflowIRData;
  state: Readonly<Record<string, WorkflowIRData>>;
  time: number;
  steps: readonly WorkflowIRReplayStep[];
  outcome: Readonly<{
    status: "succeeded" | "failed" | "cancelled" | "continued";
    state: Readonly<Record<string, WorkflowIRData>>;
    result?: WorkflowIRData;
    failure?: WorkflowIRFailure;
    continuedInput?: WorkflowIRData;
  }>;
}>;

/** Validates one immutable canonical Workflow artifact before execution or storage. */
export function validateWorkflowDefinitionIR(ir: WorkflowDefinitionIR): WorkflowDefinitionIR {
  if (ir.version !== WORKFLOW_IR_VERSION) {
    throw new TypeError(`Unsupported Workflow IR version ${JSON.stringify(ir.version)}.`);
  }
  if (ir.language !== WORKFLOW_LANGUAGE_VERSION) {
    throw new TypeError(`Unsupported Workflow language version ${JSON.stringify(ir.language)}.`);
  }
  nonEmpty(ir.compiler, "Workflow compiler");
  nonEmpty(ir.contract.name, "Workflow name");
  const children = new Set<string>();
  for (const child of ir.contract.children) {
    nonEmpty(child, "Workflow child Dependency");
    if (children.has(child)) {
      throw new TypeError(`Workflow child Dependency ${JSON.stringify(child)} is duplicated.`);
    }
    if (!(child in ir.contract.dependencies)) {
      throw new TypeError(`Workflow child Dependency ${JSON.stringify(child)} is not declared.`);
    }
    children.add(child);
  }
  const state = ir.contract.state as unknown as TypeIR;
  if (ir.contract.visibility.length > 0 && state.kind !== "record") {
    throw new TypeError("Workflow State contract must be a record.");
  }
  const visible = new Set<string>();
  for (const name of ir.contract.visibility) {
    nonEmpty(name, "Workflow visibility field");
    if (visible.has(name)) {
      throw new TypeError(`Workflow visibility field ${JSON.stringify(name)} is duplicated.`);
    }
    const field =
      state.kind === "record"
        ? state.fields.find((candidate) => candidate.name === name)
        : undefined;
    if (field === undefined) {
      throw new TypeError(`Workflow visibility field ${JSON.stringify(name)} is not in State.`);
    }
    if (!workflowVisibilityType(field.type)) {
      throw new TypeError(
        `Workflow visibility field ${JSON.stringify(name)} must be a scalar State value.`,
      );
    }
    visible.add(name);
  }
  if (!Number.isSafeInteger(ir.contract.revision) || ir.contract.revision < 1) {
    throw new TypeError("Workflow revision must be a positive safe integer.");
  }
  validateWorkflowProcedureIR(ir.initialization, "initialization", "initialization");
  const actionNames = Object.keys(ir.contract.actions).sort();
  const handlerNames = Object.keys(ir.actionHandlers).sort();
  if (
    actionNames.length !== handlerNames.length ||
    actionNames.some((name, index) => handlerNames[index] !== name)
  ) {
    throw new TypeError("Workflow Action handlers must exactly match the Action contract.");
  }
  for (const name of actionNames) {
    validateWorkflowProcedureIR(
      ir.actionHandlers[name]!,
      `Action ${JSON.stringify(name)}`,
      "action",
    );
  }
  validateWorkflowProcedureIR({ entry: ir.entry, blocks: ir.blocks }, "run", "run");
  return ir;
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

function validateWorkflowProcedureIR(
  procedure: WorkflowIRProcedure,
  name: string,
  kind: "initialization" | "action" | "run",
): void {
  nonEmpty(procedure.entry, `Workflow ${name} entry block`);
  const blocks = new Map<string, WorkflowIRBlock>();
  for (const block of procedure.blocks) {
    nonEmpty(block.id, `Workflow ${name} block`);
    if (blocks.has(block.id)) {
      throw new TypeError(`Workflow ${name} block ${JSON.stringify(block.id)} is duplicated.`);
    }
    blocks.set(block.id, block);
    for (const instruction of block.body) validateInstruction(instruction);
    validateTerminator(block.terminator);
    if (
      kind === "initialization" &&
      block.terminator.kind !== "jump" &&
      block.terminator.kind !== "branch" &&
      block.terminator.kind !== "return" &&
      block.terminator.kind !== "fail"
    ) {
      throw new TypeError("Workflow initialization cannot suspend or manage lifecycle.");
    }
    if (
      kind === "action" &&
      block.terminator.kind !== "jump" &&
      block.terminator.kind !== "branch" &&
      block.terminator.kind !== "return" &&
      block.terminator.kind !== "fail"
    ) {
      throw new TypeError("Workflow Actions cannot suspend or manage execution lifecycle.");
    }
  }
  if (!blocks.has(procedure.entry)) {
    throw new TypeError(
      `Workflow ${name} entry block ${JSON.stringify(procedure.entry)} does not exist.`,
    );
  }
  for (const block of blocks.values()) {
    for (const target of blockTargets(block.terminator)) {
      if (!blocks.has(target)) {
        throw new TypeError(
          `Workflow ${name} block ${JSON.stringify(block.id)} targets missing block ` +
            `${JSON.stringify(target)}.`,
        );
      }
    }
  }
  const reachable = new Set<string>();
  const pending = [procedure.entry];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const block = blocks.get(id)!;
    pending.push(...blockTargets(block.terminator));
  }
  const unreachable = [...blocks.keys()].filter((id) => !reachable.has(id));
  if (unreachable.length) {
    throw new TypeError(
      `Workflow ${name} contains unreachable blocks: ${unreachable
        .map((id) => JSON.stringify(id))
        .join(", ")}.`,
    );
  }
}

/** Creates a serializable execution frame at the canonical entry block. */
export function createWorkflowIRExecution(
  definition: WorkflowDefinitionIR,
  input: WorkflowIRData | undefined,
  state: Readonly<Record<string, WorkflowIRData>>,
  time: number,
  context: Readonly<{ identity?: WorkflowIRData; invocation?: WorkflowIRData }> = {},
): WorkflowIRExecution {
  validateWorkflowDefinitionIR(definition);
  finiteNumber(time, "Workflow initial time");
  assertData(input, "Workflow input");
  assertData(state, "Workflow state");
  assertData(context.identity, "Workflow identity");
  assertData(context.invocation, "Workflow invocation");
  return {
    definition: definition.contract.revision,
    status: "running",
    ...(context.identity === undefined ? {} : { identity: clone(context.identity) }),
    ...(context.invocation === undefined ? {} : { invocation: clone(context.invocation) }),
    ...(input === undefined ? {} : { input: clone(input) }),
    history: { events: 0, continueSuggested: false },
    state: clone(state),
    block: definition.entry,
    locals: {},
    sequence: 0,
    time,
  };
}

/**
 * Runs deterministic blocks until completion or one explicit durable command.
 *
 * The returned frame is JSON-serializable. No JavaScript continuation remains
 * live between calls.
 */
export function advanceWorkflowIRExecution(
  definition: WorkflowDefinitionIR,
  execution: WorkflowIRExecution,
  maximumBlocks = 10_000,
): WorkflowIRExecution {
  validateExecution(definition, execution);
  if (
    execution.status === "succeeded" ||
    execution.status === "failed" ||
    execution.status === "cancelled" ||
    execution.status === "continued"
  ) {
    return execution;
  }
  if (!Number.isSafeInteger(maximumBlocks) || maximumBlocks < 1) {
    throw new TypeError("Workflow block budget must be a positive safe integer.");
  }
  const next = mutableExecution(execution);
  const blocks = new Map(definition.blocks.map((block) => [block.id, block]));
  if (next.cancellation && next.pending?.cancellable === true && !cancellationShielded(next)) {
    next.pending = undefined;
    next.status = "running";
    transferExecution(next, {
      kind: "cancel",
      cancellation: next.cancellation,
    });
  }
  if (next.pending) {
    if (next.pending.kind === "concurrent") {
      if (!settleConcurrent(next)) return freezeExecution(next);
    } else if (
      next.pending.kind !== "wait" ||
      !truthy(evaluate(next.pending.condition, next)) ||
      (next.pending.until !== undefined && next.time >= next.pending.until)
    ) {
      return freezeExecution(next);
    } else {
      next.locals[next.pending.result] = true;
      next.block = next.pending.next;
      next.pending = undefined;
      next.status = "running";
    }
  }
  let visited = 0;
  while (next.status === "running" && next.pending === undefined) {
    if (visited++ >= maximumBlocks) {
      next.status = "failed";
      next.failure = { type: "resource", limit: maximumBlocks };
      break;
    }
    const block = blocks.get(next.block);
    if (!block) throw new TypeError(`Workflow block ${JSON.stringify(next.block)} does not exist.`);
    for (const instruction of block.body) executeInstruction(instruction, next);
    executeTerminator(block.terminator, next);
  }
  return freezeExecution(next);
}

/** Durably admits cancellation and advances the same serializable control frame. */
export function requestWorkflowIRCancellation(
  definition: WorkflowDefinitionIR,
  execution: WorkflowIRExecution,
  request: WorkflowIRCancellation,
  maximumBlocks = 10_000,
): WorkflowIRExecution {
  validateExecution(definition, execution);
  finiteNumber(request.at, "Workflow cancellation time");
  assertData(request.reason, "Workflow cancellation reason");
  if (request.at < execution.time) {
    throw new TypeError("Workflow cancellation time cannot move logical time backwards.");
  }
  if (
    execution.status === "succeeded" ||
    execution.status === "failed" ||
    execution.status === "cancelled"
  ) {
    return execution;
  }

  const next = mutableExecution(execution);
  const admitted = next.cancellation;
  if (!admitted) {
    next.cancellation = clone(request);
    next.time = request.at;
  }
  const cancellation = next.cancellation!;
  if (cancellationShielded(next) || next.pending?.cancellable === false) {
    return freezeExecution(next);
  }
  if (admitted && next.status === "running" && !next.pending) {
    return advanceWorkflowIRExecution(definition, freezeExecution(next), maximumBlocks);
  }
  next.pending = undefined;
  next.status = "running";
  transferExecution(next, { kind: "cancel", cancellation });
  return advanceWorkflowIRExecution(definition, freezeExecution(next), maximumBlocks);
}

/** Applies one fenced command completion and advances to the next durable boundary. */
export function resumeWorkflowIRExecution(
  definition: WorkflowDefinitionIR,
  execution: WorkflowIRExecution,
  completion: WorkflowIRCompletion,
  maximumBlocks = 10_000,
): WorkflowIRExecution {
  validateExecution(definition, execution);
  const pending = execution.pending;
  if (execution.status !== "suspended" || !pending) {
    throw new TypeError("Workflow execution has no suspended command to resume.");
  }
  if (pending.kind === "concurrent") {
    if (completion.kind !== "concurrent") {
      throw new TypeError(
        `Workflow completion ${completion.kind}:${completion.sequence} does not match a concurrent command.`,
      );
    }
    return resumeConcurrent(definition, execution, completion, maximumBlocks);
  }
  const matchingKind =
    pending.kind === completion.kind || (pending.kind === "child" && completion.kind === "effect");
  if (pending.sequence !== completion.sequence || !matchingKind) {
    throw new TypeError(
      `Workflow completion ${completion.kind}:${completion.sequence} does not match ` +
        `${pending.kind}:${pending.sequence}.`,
    );
  }
  finiteNumber(completion.at, "Workflow completion time");
  if (completion.at < execution.time) {
    throw new TypeError("Workflow completion time cannot move logical time backwards.");
  }
  const next = mutableExecution(execution);
  next.time = completion.at;
  next.pending = undefined;
  next.status = "running";
  if ((pending.kind === "effect" || pending.kind === "child") && completion.kind === "effect") {
    if (completion.outcome.status === "failed") {
      assertData(completion.outcome.failure, "Workflow effect failure");
      transferExecution(next, {
        kind: "fail",
        failure: {
          type: "effect",
          dependency: pending.dependency,
          operation: pending.operation,
          failure: clone(completion.outcome.failure),
        },
      });
    } else {
      assertData(completion.outcome.value, "Workflow effect result");
      if (completion.outcome.value !== undefined) {
        next.locals[pending.result] = clone(completion.outcome.value);
      }
      next.block = pending.next;
    }
  } else if (pending.kind === "sleep" && completion.kind === "sleep") {
    if (completion.at < pending.at) {
      throw new TypeError("Workflow sleep completed before its logical deadline.");
    }
    next.block = pending.next;
  } else if (pending.kind === "wait" && completion.kind === "wait") {
    if (pending.until === undefined || completion.at < pending.until) {
      throw new TypeError("Workflow wait timed out before its logical deadline.");
    }
    next.locals[pending.result] = false;
    next.block = pending.next;
  }
  return advanceWorkflowIRExecution(definition, freezeExecution(next), maximumBlocks);
}

function resumeConcurrent(
  definition: WorkflowDefinitionIR,
  execution: WorkflowIRExecution,
  completion: Extract<WorkflowIRCompletion, { kind: "concurrent" }>,
  maximumBlocks: number,
): WorkflowIRExecution {
  const pending = execution.pending;
  if (pending?.kind !== "concurrent") {
    throw new TypeError("Workflow execution has no concurrent command to resume.");
  }
  const effect = pending.effects.find(({ sequence }) => sequence === completion.sequence);
  if (!effect || effect.status !== "pending") {
    throw new TypeError(
      `Workflow concurrent completion ${completion.sequence} is stale or unknown.`,
    );
  }
  finiteNumber(completion.at, "Workflow completion time");
  if (completion.at < execution.time) {
    throw new TypeError("Workflow completion time cannot move logical time backwards.");
  }
  const next = mutableExecution(execution);
  next.time = completion.at;
  next.pending = {
    ...pending,
    effects: pending.effects.map((candidate) => {
      if (candidate.sequence !== completion.sequence) return candidate;
      if (completion.outcome.status === "succeeded") {
        assertData(completion.outcome.value, "Workflow concurrent effect result");
        return {
          ...candidate,
          status: "succeeded" as const,
          ...(completion.outcome.value === undefined
            ? {}
            : { value: clone(completion.outcome.value) }),
        };
      }
      assertData(completion.outcome.failure, "Workflow concurrent effect failure");
      return {
        ...candidate,
        status: "failed" as const,
        failure: {
          type: "effect" as const,
          dependency: candidate.dependency,
          operation: candidate.operation,
          failure: clone(completion.outcome.failure),
        },
      };
    }),
  };
  if (!settleConcurrent(next)) return freezeExecution(next);
  return advanceWorkflowIRExecution(definition, freezeExecution(next), maximumBlocks);
}

/** Replaces Action-owned State before reevaluating a suspended condition. */
export function updateWorkflowIRState(
  execution: WorkflowIRExecution,
  state: Readonly<Record<string, WorkflowIRData>>,
): WorkflowIRExecution {
  assertData(state, "Workflow state");
  return { ...execution, state: clone(state) };
}

/**
 * Replays one recorded canonical command trace against a definition revision.
 *
 * This verifier performs no effects. It rejects the first changed command or
 * terminal outcome and is therefore safe to run during build and migration
 * admission.
 */
export function verifyWorkflowIRReplay(
  definition: WorkflowDefinitionIR,
  trace: WorkflowIRReplayTrace,
): WorkflowIRExecution {
  let execution = advanceWorkflowIRExecution(
    definition,
    createWorkflowIRExecution(definition, trace.input, trace.state, trace.time),
  );
  for (const [index, step] of trace.steps.entries()) {
    if (
      execution.status !== "suspended" ||
      execution.pending === undefined ||
      !workflowIRDataEqual(execution.pending, step.command)
    ) {
      throw new TypeError(`Workflow replay diverged at command ${index}.`);
    }
    execution =
      step.resolution.kind === "completion"
        ? resumeWorkflowIRExecution(definition, execution, step.resolution.completion)
        : advanceWorkflowIRExecution(
            definition,
            updateWorkflowIRState(execution, step.resolution.state),
          );
  }
  if (
    execution.status !== trace.outcome.status ||
    !workflowIRDataEqual(execution.state, trace.outcome.state) ||
    !workflowIRDataEqual(execution.result, trace.outcome.result) ||
    !workflowIRDataEqual(execution.failure, trace.outcome.failure) ||
    !workflowIRDataEqual(execution.continuedInput, trace.outcome.continuedInput)
  ) {
    throw new TypeError("Workflow replay diverged at its terminal outcome.");
  }
  return execution;
}

type MutableExecution = {
  -readonly [Name in keyof WorkflowIRExecution]: WorkflowIRExecution[Name];
} & {
  state: Record<string, WorkflowIRData>;
  locals: Record<string, WorkflowIRData>;
  scope?: MutableScopeFrame;
};

type MutableScopeFrame = {
  id: string;
  cancellable: boolean;
  shielded: boolean;
  phase: "body" | "catch" | "cleanup";
  catch?: Readonly<{ block: string; result: string }>;
  cleanup?: string;
  next?: string;
  completion?: WorkflowIRTransfer;
  parent?: MutableScopeFrame;
};

function mutableExecution(execution: WorkflowIRExecution): MutableExecution {
  return clone(execution) as MutableExecution;
}

function freezeExecution(execution: MutableExecution): WorkflowIRExecution {
  return clone(execution);
}

function executeInstruction(instruction: WorkflowIRInstruction, execution: MutableExecution): void {
  const value = evaluate(instruction.value, execution);
  if (instruction.kind === "let") {
    if (value === undefined) delete execution.locals[instruction.name];
    else execution.locals[instruction.name] = clone(value);
    return;
  }
  if (instruction.kind === "assign") {
    const current = execution.locals[instruction.name];
    const assigned = assignment(instruction.operator, current, value);
    if (assigned === undefined) delete execution.locals[instruction.name];
    else execution.locals[instruction.name] = clone(assigned);
    return;
  }
  const current = getPath(execution.state, instruction.path);
  const assigned = assignment(instruction.operator, current, value);
  if (assigned === undefined) {
    throw new TypeError("Workflow State cannot persist undefined values.");
  }
  setPath(execution.state, instruction.path, clone(assigned));
}

function executeTerminator(terminator: WorkflowIRTerminator, execution: MutableExecution): void {
  if (terminator.kind === "jump") {
    execution.block = terminator.next;
    return;
  }
  if (terminator.kind === "branch") {
    execution.block = truthy(evaluate(terminator.condition, execution))
      ? terminator.consequent
      : terminator.alternate;
    return;
  }
  if (terminator.kind === "effect" || terminator.kind === "child") {
    const input = evaluate(terminator.input, execution);
    const options = terminator.options ? evaluate(terminator.options, execution) : undefined;
    assertData(
      input,
      terminator.kind === "child" ? "Workflow child input" : "Workflow effect input",
    );
    assertData(
      options,
      terminator.kind === "child" ? "Workflow child options" : "Workflow effect options",
    );
    if (interruptForCancellation(execution)) return;
    execution.pending = {
      kind: terminator.kind,
      sequence: execution.sequence++,
      cancellable: !cancellationShielded(execution),
      dependency: terminator.dependency,
      operation: terminator.operation,
      input: clone(input),
      ...(options === undefined ? {} : { options: clone(options) }),
      result: terminator.result,
      next: terminator.next,
    };
    execution.status = "suspended";
    return;
  }
  if (terminator.kind === "sleep") {
    const at = deadline(terminator.timing, execution);
    if (at <= execution.time) {
      execution.block = terminator.next;
      return;
    }
    if (interruptForCancellation(execution)) return;
    execution.pending = {
      kind: "sleep",
      sequence: execution.sequence++,
      cancellable: !cancellationShielded(execution),
      at,
      next: terminator.next,
    };
    execution.status = "suspended";
    return;
  }
  if (terminator.kind === "wait") {
    if (truthy(evaluate(terminator.condition, execution))) {
      execution.locals[terminator.result] = true;
      execution.block = terminator.next;
      return;
    }
    const until = terminator.timeout ? deadline(terminator.timeout, execution) : undefined;
    if (interruptForCancellation(execution)) return;
    execution.pending = {
      kind: "wait",
      sequence: execution.sequence++,
      cancellable: !cancellationShielded(execution),
      condition: terminator.condition,
      ...(until === undefined ? {} : { until }),
      result: terminator.result,
      next: terminator.next,
    };
    execution.status = "suspended";
    return;
  }
  if (terminator.kind === "concurrent") {
    if (terminator.effects.length && interruptForCancellation(execution)) return;
    execution.pending = {
      kind: "concurrent",
      cancellable: !cancellationShielded(execution),
      operation: terminator.operation,
      effects: terminator.effects.map((effect) => {
        const input = evaluate(effect.input, execution);
        const options = effect.options ? evaluate(effect.options, execution) : undefined;
        assertData(input, "Workflow concurrent effect input");
        assertData(options, "Workflow concurrent effect options");
        return {
          sequence: execution.sequence++,
          dependency: effect.dependency,
          operation: effect.operation,
          input: clone(input),
          ...(options === undefined ? {} : { options: clone(options) }),
          status: "pending" as const,
        };
      }),
      result: terminator.result,
      next: terminator.next,
    };
    execution.status = "suspended";
    settleConcurrent(execution);
    return;
  }
  if (terminator.kind === "enter-scope") {
    execution.scope = {
      id: terminator.id,
      cancellable: terminator.cancellable,
      shielded: !terminator.cancellable || execution.scope?.shielded === true,
      phase: "body",
      ...(terminator.catch ? { catch: terminator.catch } : {}),
      ...(terminator.cleanup ? { cleanup: terminator.cleanup } : {}),
      ...(terminator.next ? { next: terminator.next } : {}),
      ...(execution.scope ? { parent: execution.scope } : {}),
    };
    execution.block = terminator.body;
    return;
  }
  if (terminator.kind === "leave-scope") {
    const scope = execution.scope;
    if (!scope || scope.phase === "cleanup" || !scope.next) {
      throw new TypeError("Workflow leave-scope requires an active body or catch scope.");
    }
    transferExecution(execution, { kind: "continue", next: scope.next });
    return;
  }
  if (terminator.kind === "complete-cleanup") {
    const scope = execution.scope;
    if (!scope || scope.phase !== "cleanup" || !scope.completion) {
      throw new TypeError("Workflow complete-cleanup requires an active cleanup continuation.");
    }
    const completion = scope.completion;
    execution.scope = scope.parent;
    transferExecution(execution, cancellationAfterShield(execution, scope, completion));
    return;
  }
  if (terminator.kind === "continue-as-new") {
    const input = evaluate(terminator.input, execution);
    assertData(input, "Workflow continuation input");
    transferExecution(execution, {
      kind: "continue-as-new",
      ...(input === undefined ? {} : { input: clone(input) }),
    });
    return;
  }
  if (terminator.kind === "return") {
    const value = evaluate(terminator.value, execution);
    assertData(value, "Workflow result");
    transferExecution(execution, {
      kind: "return",
      ...(value === undefined ? {} : { value: clone(value) }),
    });
    return;
  }
  const value = evaluate(terminator.value, execution);
  assertData(value, "Workflow failure");
  transferExecution(execution, {
    kind: "fail",
    failure: { type: "declared", value: clone(value) },
  });
}

function interruptForCancellation(execution: MutableExecution): boolean {
  if (!execution.cancellation || cancellationShielded(execution)) return false;
  transferExecution(execution, {
    kind: "cancel",
    cancellation: execution.cancellation,
  });
  return true;
}

function cancellationShielded(
  execution: Pick<WorkflowIRExecution, "scope"> | Pick<MutableExecution, "scope">,
): boolean {
  return execution.scope?.shielded === true;
}

function cancellationAfterShield(
  execution: MutableExecution,
  exited: MutableScopeFrame,
  transfer: WorkflowIRTransfer,
): WorkflowIRTransfer {
  if (
    exited.cancellable ||
    !execution.cancellation ||
    cancellationShielded(execution) ||
    transfer.kind === "fail" ||
    transfer.kind === "cancel"
  ) {
    return transfer;
  }
  return {
    kind: "cancel",
    cancellation: execution.cancellation,
  };
}

function transferExecution(execution: MutableExecution, initial: WorkflowIRTransfer): void {
  let transfer = clone(initial);
  execution.pending = undefined;
  execution.status = "running";

  while (true) {
    const scope = execution.scope;
    if (!scope) {
      finishTransfer(execution, transfer);
      return;
    }

    if (scope.phase === "cleanup") {
      execution.scope = scope.parent;
      transfer = cancellationAfterShield(execution, scope, transfer);
      continue;
    }

    if (transfer.kind === "fail" && scope.phase === "body" && scope.catch) {
      scope.phase = "catch";
      execution.locals[scope.catch.result] = workflowFailureData(transfer.failure);
      execution.block = scope.catch.block;
      return;
    }

    if (scope.cleanup) {
      scope.phase = "cleanup";
      scope.completion = clone(transfer);
      execution.block = scope.cleanup;
      return;
    }

    execution.scope = scope.parent;
    transfer = cancellationAfterShield(execution, scope, transfer);
    if (transfer.kind === "continue") {
      finishTransfer(execution, transfer);
      return;
    }
  }
}

function finishTransfer(execution: MutableExecution, transfer: WorkflowIRTransfer): void {
  if (transfer.kind === "continue") {
    execution.block = transfer.next;
    execution.status = "running";
    return;
  }
  execution.scope = undefined;
  if (transfer.kind === "continue-as-new") {
    if (transfer.input === undefined) delete execution.continuedInput;
    else execution.continuedInput = clone(transfer.input);
    delete execution.cancellation;
    delete execution.failure;
    delete execution.result;
    execution.status = "continued";
    return;
  }
  if (transfer.kind === "return") {
    if (transfer.value === undefined) delete execution.result;
    else execution.result = clone(transfer.value);
    delete execution.failure;
    execution.status = "succeeded";
    return;
  }
  if (transfer.kind === "fail") {
    execution.failure = clone(transfer.failure);
    delete execution.result;
    execution.status = "failed";
    return;
  }
  execution.cancellation = clone(transfer.cancellation);
  delete execution.failure;
  delete execution.result;
  execution.status = "cancelled";
}

function settleConcurrent(execution: MutableExecution): boolean {
  const pending = execution.pending;
  if (pending?.kind !== "concurrent") return false;
  const settled = pending.effects.filter(({ status }) => status !== "pending");
  if (pending.operation === "race") {
    const winner = settled[0];
    if (!winner) return false;
    execution.pending = undefined;
    if (winner.status === "failed") {
      execution.status = "running";
      transferExecution(execution, { kind: "fail", failure: winner.failure! });
      return true;
    }
    if (winner.value === undefined) delete execution.locals[pending.result];
    else execution.locals[pending.result] = clone(winner.value);
    execution.block = pending.next;
    execution.status = "running";
    return true;
  }
  const failure = pending.effects.find(({ status }) => status === "failed");
  if (failure && pending.operation === "all") {
    execution.pending = undefined;
    execution.status = "running";
    transferExecution(execution, { kind: "fail", failure: failure.failure! });
    return true;
  }
  if (settled.length !== pending.effects.length) return false;
  const values: WorkflowIRData[] =
    pending.operation === "all"
      ? pending.effects.map(({ value }) => {
          if (value === undefined) {
            throw new TypeError(
              "Workflow concurrent Dependency results must be serializable values.",
            );
          }
          return clone(value);
        })
      : pending.effects.map((effect): WorkflowIRData => {
          const result: Record<string, WorkflowIRData> = {
            status: effect.status === "succeeded" ? "fulfilled" : "rejected",
          };
          if (effect.status === "succeeded") {
            if (effect.value !== undefined) result.value = clone(effect.value);
          } else {
            result.reason = workflowFailureData(effect.failure!);
          }
          return result;
        });
  execution.locals[pending.result] = values;
  execution.pending = undefined;
  execution.block = pending.next;
  execution.status = "running";
  return true;
}

function workflowFailureData(failure: WorkflowIRFailure): WorkflowIRData {
  const value = clone(failure);
  assertData(value, "Workflow failure");
  return value as WorkflowIRData;
}

function evaluate(
  expression: WorkflowIRExpression,
  execution: Pick<
    WorkflowIRExecution,
    "identity" | "invocation" | "input" | "state" | "history" | "locals" | "time"
  >,
): WorkflowIRData | undefined {
  if (expression.kind === "literal") return clone(expression.value);
  if (expression.kind === "none") return undefined;
  if (expression.kind === "identity") {
    return clone(getPath(execution.identity, expression.path));
  }
  if (expression.kind === "invocation") {
    return clone(getPath(execution.invocation, expression.path));
  }
  if (expression.kind === "input") return clone(getPath(execution.input, expression.path));
  if (expression.kind === "state") return clone(getPath(execution.state, expression.path));
  if (expression.kind === "history") return clone(getPath(execution.history, expression.path));
  if (expression.kind === "local") return clone(execution.locals[expression.name]);
  if (expression.kind === "time") return execution.time;
  if (expression.kind === "array") {
    return expression.values.map((value) => {
      const evaluated = evaluate(value, execution);
      if (evaluated === undefined) {
        throw new TypeError("Workflow arrays cannot contain undefined values.");
      }
      return evaluated;
    });
  }
  if (expression.kind === "record") {
    const value: Record<string, WorkflowIRData> = {};
    for (const field of expression.fields) {
      const evaluated = evaluate(field.value, execution);
      if (evaluated !== undefined) value[field.name] = evaluated;
    }
    return value;
  }
  if (expression.kind === "record-merge") {
    const value: Record<string, WorkflowIRData> = {};
    for (const entry of expression.entries) {
      const evaluated = evaluate(entry.value, execution);
      if (entry.kind === "field") {
        if (evaluated !== undefined) value[entry.name] = evaluated;
        continue;
      }
      if (
        evaluated === undefined ||
        evaluated === null ||
        typeof evaluated !== "object" ||
        Array.isArray(evaluated)
      ) {
        throw new TypeError("Workflow record spread requires a record.");
      }
      Object.assign(value, evaluated);
    }
    return value;
  }
  if (expression.kind === "property") {
    return clone(getPath(evaluate(expression.value, execution), [expression.name]));
  }
  if (expression.kind === "index") {
    const index = evaluate(expression.index, execution);
    if (typeof index !== "number" && typeof index !== "string") {
      throw new TypeError("Workflow index must be a string or number.");
    }
    return clone(getPath(evaluate(expression.value, execution), [String(index)]));
  }
  if (expression.kind === "unary") {
    const value = evaluate(expression.value, execution);
    if (expression.operator === "!") return !truthy(value);
    if (expression.operator === "present") return value !== undefined && value !== null;
    if (typeof value !== "number") throw new TypeError("Workflow unary minus requires a number.");
    return -value;
  }
  if (expression.kind === "conditional") {
    return evaluate(
      truthy(evaluate(expression.condition, execution))
        ? expression.consequent
        : expression.alternate,
      execution,
    );
  }
  const left = evaluate(expression.left, execution);
  if (expression.operator === "&&") {
    return truthy(left) ? evaluate(expression.right, execution) : left;
  }
  if (expression.operator === "||") {
    return truthy(left) ? left : evaluate(expression.right, execution);
  }
  if (expression.operator === "??") {
    return left === undefined || left === null ? evaluate(expression.right, execution) : left;
  }
  const right = evaluate(expression.right, execution);
  switch (expression.operator) {
    case "+":
      if (typeof left === "number" && typeof right === "number") return left + right;
      if (typeof left === "string" && typeof right === "string") return left + right;
      throw new TypeError("Workflow addition requires two numbers or two strings.");
    case "-":
      return numeric(left, right, (a, b) => a - b);
    case "*":
      return numeric(left, right, (a, b) => a * b);
    case "/":
      return numeric(left, right, (a, b) => a / b);
    case "%":
      return numeric(left, right, (a, b) => a % b);
    case "===":
      return primitive(left) === primitive(right);
    case "!==":
      return primitive(left) !== primitive(right);
    case "<":
      return ordered(left, right, (a, b) => a < b);
    case "<=":
      return ordered(left, right, (a, b) => a <= b);
    case ">":
      return ordered(left, right, (a, b) => a > b);
    case ">=":
      return ordered(left, right, (a, b) => a >= b);
  }
}

function assignment(
  operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=",
  current: WorkflowIRData | undefined,
  value: WorkflowIRData | undefined,
): WorkflowIRData | undefined {
  if (operator === "=") return value;
  if (operator === "??=") return current === undefined || current === null ? value : current;
  if (operator === "+=") {
    if (typeof current === "number" && typeof value === "number") return current + value;
    if (typeof current === "string" && typeof value === "string") return current + value;
    throw new TypeError("Workflow += requires two numbers or two strings.");
  }
  if (typeof current !== "number" || typeof value !== "number") {
    throw new TypeError(`Workflow ${operator} requires two numbers.`);
  }
  if (operator === "-=") return current - value;
  if (operator === "*=") return current * value;
  return current / value;
}

function deadline(
  timing:
    | Readonly<{ kind: "for"; value: WorkflowIRExpression }>
    | Readonly<{ kind: "until"; value: WorkflowIRExpression }>,
  execution: Pick<
    WorkflowIRExecution,
    "identity" | "invocation" | "input" | "state" | "history" | "locals" | "time"
  >,
): number {
  const value = evaluate(timing.value, execution);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Workflow timing must be a non-negative safe integer.");
  }
  return timing.kind === "for" ? execution.time + value : value;
}

function validateExecution(definition: WorkflowDefinitionIR, execution: WorkflowIRExecution): void {
  validateWorkflowDefinitionIR(definition);
  if (execution.definition !== definition.contract.revision) {
    throw new TypeError(
      `Workflow execution revision ${execution.definition} does not match definition ` +
        `${definition.contract.revision}.`,
    );
  }
  finiteNumber(execution.time, "Workflow logical time");
  assertData(execution.identity, "Workflow identity");
  assertData(execution.invocation, "Workflow invocation");
  if (
    !Number.isSafeInteger(execution.history.events) ||
    execution.history.events < 0 ||
    typeof execution.history.continueSuggested !== "boolean"
  ) {
    throw new TypeError("Workflow history metadata is invalid.");
  }
  assertData(execution.continuedInput, "Workflow continuation input");
  if (!Number.isSafeInteger(execution.sequence) || execution.sequence < 0) {
    throw new TypeError("Workflow command sequence must be a non-negative safe integer.");
  }
  if (execution.status === "suspended" && !execution.pending) {
    throw new TypeError("Suspended Workflow execution must contain a pending command.");
  }
  if (execution.pending && execution.status !== "suspended") {
    throw new TypeError("Workflow pending command requires suspended execution.");
  }
  if (execution.cancellation) {
    finiteNumber(execution.cancellation.at, "Workflow cancellation time");
    if (execution.cancellation.at > execution.time) {
      throw new TypeError("Workflow cancellation cannot be newer than logical time.");
    }
  }
  let scope = execution.scope;
  while (scope) {
    nonEmpty(scope.id, "Workflow execution scope");
    if (scope.shielded !== (!scope.cancellable || scope.parent?.shielded === true)) {
      throw new TypeError("Workflow execution scope has inconsistent cancellation shielding.");
    }
    if (scope.phase === "cleanup" && !scope.completion) {
      throw new TypeError("Workflow cleanup scope must retain its continuation.");
    }
    if (scope.phase !== "cleanup" && scope.completion) {
      throw new TypeError("Workflow scope continuation is valid only during cleanup.");
    }
    scope = scope.parent;
  }
  assertData(execution, "Workflow execution");
}

function validateInstruction(instruction: WorkflowIRInstruction): void {
  if (instruction.kind === "state") {
    if (!instruction.path.length) throw new TypeError("Workflow State path cannot be empty.");
    instruction.path.forEach((segment) => nonEmpty(segment, "Workflow State path segment"));
  } else {
    nonEmpty(instruction.name, "Workflow local");
  }
  validateExpression(instruction.value);
}

function validateTerminator(terminator: WorkflowIRTerminator): void {
  if (terminator.kind === "jump") {
    nonEmpty(terminator.next, "Workflow jump target");
    return;
  }
  if (terminator.kind === "branch") {
    validateExpression(terminator.condition);
    nonEmpty(terminator.consequent, "Workflow branch target");
    nonEmpty(terminator.alternate, "Workflow branch target");
    return;
  }
  if (terminator.kind === "effect" || terminator.kind === "child") {
    const label = terminator.kind === "child" ? "Workflow child" : "Workflow effect";
    nonEmpty(terminator.dependency, `${label} Dependency`);
    nonEmpty(terminator.operation, `${label} operation`);
    nonEmpty(terminator.result, `${label} result`);
    nonEmpty(terminator.next, `${label} continuation`);
    validateExpression(terminator.input);
    if (terminator.options) validateExpression(terminator.options);
    return;
  }
  if (terminator.kind === "sleep") {
    validateExpression(terminator.timing.value);
    nonEmpty(terminator.next, "Workflow sleep continuation");
    return;
  }
  if (terminator.kind === "wait") {
    validateExpression(terminator.condition);
    if (terminator.timeout) validateExpression(terminator.timeout.value);
    nonEmpty(terminator.result, "Workflow wait result");
    nonEmpty(terminator.next, "Workflow wait continuation");
    return;
  }
  if (terminator.kind === "concurrent") {
    if (terminator.operation === "race" && terminator.effects.length === 0) {
      throw new TypeError("Workflow race requires at least one effect.");
    }
    for (const effect of terminator.effects) {
      nonEmpty(effect.dependency, "Workflow concurrent effect Dependency");
      nonEmpty(effect.operation, "Workflow concurrent effect operation");
      validateExpression(effect.input);
      if (effect.options) validateExpression(effect.options);
    }
    nonEmpty(terminator.result, "Workflow concurrent result");
    nonEmpty(terminator.next, "Workflow concurrent continuation");
    return;
  }
  if (terminator.kind === "enter-scope") {
    nonEmpty(terminator.id, "Workflow scope");
    nonEmpty(terminator.body, "Workflow scope body");
    if (terminator.catch) {
      nonEmpty(terminator.catch.block, "Workflow catch block");
      nonEmpty(terminator.catch.result, "Workflow catch result");
    }
    if (terminator.cleanup) nonEmpty(terminator.cleanup, "Workflow cleanup block");
    if (terminator.next) nonEmpty(terminator.next, "Workflow scope continuation");
    return;
  }
  if (terminator.kind === "leave-scope" || terminator.kind === "complete-cleanup") {
    return;
  }
  if (terminator.kind === "continue-as-new") {
    validateExpression(terminator.input);
    return;
  }
  validateExpression(terminator.value);
}

function validateExpression(expression: WorkflowIRExpression, depth = 0): void {
  if (depth > 128) throw new TypeError("Workflow expression nesting exceeds 128 levels.");
  if (expression.kind === "literal") {
    assertData(expression.value, "Workflow literal");
  } else if (
    expression.kind === "identity" ||
    expression.kind === "invocation" ||
    expression.kind === "input" ||
    expression.kind === "state" ||
    expression.kind === "history"
  ) {
    expression.path.forEach((segment) => nonEmpty(segment, "Workflow expression path segment"));
  } else if (expression.kind === "local") {
    nonEmpty(expression.name, "Workflow local");
  } else if (expression.kind === "array") {
    expression.values.forEach((value) => validateExpression(value, depth + 1));
  } else if (expression.kind === "record") {
    const names = new Set<string>();
    for (const field of expression.fields) {
      nonEmpty(field.name, "Workflow record field");
      if (names.has(field.name)) {
        throw new TypeError(`Workflow record field ${JSON.stringify(field.name)} is duplicated.`);
      }
      names.add(field.name);
      validateExpression(field.value, depth + 1);
    }
  } else if (expression.kind === "record-merge") {
    for (const entry of expression.entries) {
      if (entry.kind === "field") nonEmpty(entry.name, "Workflow record field");
      validateExpression(entry.value, depth + 1);
    }
  } else if (expression.kind === "property") {
    nonEmpty(expression.name, "Workflow property");
    validateExpression(expression.value, depth + 1);
  } else if (expression.kind === "index") {
    validateExpression(expression.value, depth + 1);
    validateExpression(expression.index, depth + 1);
  } else if (expression.kind === "binary") {
    validateExpression(expression.left, depth + 1);
    validateExpression(expression.right, depth + 1);
  } else if (expression.kind === "unary") {
    validateExpression(expression.value, depth + 1);
  } else if (expression.kind === "conditional") {
    validateExpression(expression.condition, depth + 1);
    validateExpression(expression.consequent, depth + 1);
    validateExpression(expression.alternate, depth + 1);
  }
}

function blockTargets(terminator: WorkflowIRTerminator): readonly string[] {
  if (terminator.kind === "jump") return [terminator.next];
  if (terminator.kind === "branch") return [terminator.consequent, terminator.alternate];
  if (terminator.kind === "enter-scope") {
    return [
      terminator.body,
      ...(terminator.catch ? [terminator.catch.block] : []),
      ...(terminator.cleanup ? [terminator.cleanup] : []),
      ...(terminator.next ? [terminator.next] : []),
    ];
  }
  if (
    terminator.kind === "effect" ||
    terminator.kind === "child" ||
    terminator.kind === "sleep" ||
    terminator.kind === "wait" ||
    terminator.kind === "concurrent"
  ) {
    return [terminator.next];
  }
  return [];
}

function getPath(value: unknown, path: readonly string[]): WorkflowIRData | undefined {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current as WorkflowIRData | undefined;
}

function setPath(
  value: Record<string, WorkflowIRData>,
  path: readonly string[],
  next: WorkflowIRData,
): void {
  let current = value;
  for (const segment of path.slice(0, -1)) {
    const child = current[segment];
    if (child === undefined) {
      const created: Record<string, WorkflowIRData> = {};
      current[segment] = created;
      current = created;
    } else if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      current = child as Record<string, WorkflowIRData>;
    } else {
      throw new TypeError(
        `Workflow State path ${JSON.stringify(path)} crosses a non-record value.`,
      );
    }
  }
  current[path.at(-1)!] = next;
}

function numeric(
  left: WorkflowIRData | undefined,
  right: WorkflowIRData | undefined,
  operation: (left: number, right: number) => number,
): number {
  if (typeof left !== "number" || typeof right !== "number") {
    throw new TypeError("Workflow arithmetic requires two numbers.");
  }
  const value = operation(left, right);
  finiteNumber(value, "Workflow arithmetic result");
  return value;
}

function ordered(
  left: WorkflowIRData | undefined,
  right: WorkflowIRData | undefined,
  operation: (left: number | string, right: number | string) => boolean,
): boolean {
  if ((typeof left !== "number" && typeof left !== "string") || typeof right !== typeof left) {
    throw new TypeError("Workflow comparison requires two numbers or two strings.");
  }
  return operation(left, right as number & string);
}

function primitive(
  value: WorkflowIRData | undefined,
): null | boolean | number | string | undefined {
  if (value === null || value === undefined || typeof value !== "object") return value;
  throw new TypeError("Workflow identity comparison is limited to primitive values.");
}

function truthy(value: WorkflowIRData | undefined): boolean {
  return Boolean(value);
}

function workflowIRDataEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => workflowIRDataEqual(value, right[index]))
    );
  }
  const leftEntries = Object.entries(left).sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName),
  );
  const rightEntries = Object.entries(right).sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName),
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([name, value], index) =>
        rightEntries[index]?.[0] === name && workflowIRDataEqual(value, rightEntries[index]?.[1]),
    )
  );
}

function clone<Value>(value: Value): Value {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as Value;
}

function assertData(value: unknown, name: string, active = new Set<object>()): void {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    finiteNumber(value, name);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${name} must be serializable data.`);
  if (active.has(value)) throw new TypeError(`${name} cannot contain cycles.`);
  active.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === undefined) throw new TypeError(`${name} arrays cannot contain undefined.`);
      assertData(item, name, active);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${name} must contain only records and arrays.`);
    }
    for (const [field, item] of Object.entries(value)) {
      if (item === undefined) throw new TypeError(`${name}.${field} cannot be undefined.`);
      assertData(item, `${name}.${field}`, active);
    }
  }
  active.delete(value);
}

function finiteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
}

function nonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
}
