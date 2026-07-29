import { dataKind } from "@/core/data";
import {
  type WorkflowExecutableBlock,
  type WorkflowExecutableDefinition,
  type WorkflowExecutableExpression,
  type WorkflowExecutableInstruction,
  type WorkflowExecutableProcedure,
  type WorkflowExecutableTerminator,
  type WorkflowExecutableTiming,
} from "@/features/workflow/ir";

type RuntimeValue = object | string | number | boolean | null | undefined;
type RuntimeRecord = Record<string, RuntimeValue>;

type RuntimeExecution = {
  definition: number;
  status: "running" | "suspended" | "continued" | "succeeded" | "failed" | "cancelled";
  identity?: RuntimeValue;
  invocation?: RuntimeValue;
  input?: RuntimeValue;
  history: Readonly<{ events: number; continueSuggested: boolean }>;
  state: RuntimeRecord;
  block: string;
  locals: RuntimeRecord;
  sequence: number;
  time: number;
  scope?: object;
  cancellation?: object;
  pending?: object;
  continuedInput?: RuntimeValue;
  result?: RuntimeValue;
  failure?: object;
};

type RuntimeScope = {
  id: string;
  cancellable: boolean;
  shielded: boolean;
  phase: "body" | "catch" | "cleanup";
  catch?: Readonly<{ block: string; result: string }>;
  cleanup?: string;
  next?: string;
  completion?: object;
  parent?: object;
};

type RuntimeTransfer =
  | Readonly<{ kind: "continue"; next: string }>
  | Readonly<{ kind: "continue-as-new"; input?: RuntimeValue }>
  | Readonly<{ kind: "return"; value?: RuntimeValue }>
  | Readonly<{ kind: "fail"; failure: object }>
  | Readonly<{ kind: "cancel"; cancellation: object }>;

type RuntimePending = {
  kind: "effect" | "child" | "sleep" | "wait" | "concurrent";
  sequence?: number;
  cancellable: boolean;
  dependency?: string;
  operation?: string;
  input?: RuntimeValue;
  options?: RuntimeValue;
  result?: string;
  next?: string;
  at?: number;
  until?: number;
  condition?: object;
  effects?: object[];
};

type RuntimeConcurrentEffect = {
  sequence: number;
  dependency: string;
  operation: string;
  input?: RuntimeValue;
  options?: RuntimeValue;
  status: "pending" | "succeeded" | "failed";
  value?: RuntimeValue;
  failure?: object;
};

type ProcedureContext = Readonly<{
  definition: number;
  identity?: RuntimeValue;
  invocation?: RuntimeValue;
  input?: RuntimeValue;
  state: object;
  time: number;
}>;

type RuntimeReplayTrace = Readonly<{
  identity?: RuntimeValue;
  input?: RuntimeValue;
  time: number;
  initialState: object;
  steps: readonly object[];
  expected: object;
}>;

type RuntimeReplayStep =
  | Readonly<{
      kind: "advance";
      history: Readonly<{ events: number; continueSuggested: boolean }>;
    }>
  | Readonly<{
      kind: "action";
      action: string;
      input?: RuntimeValue;
      invocation: object;
      time: number;
      state: object;
      result: RuntimeValue;
    }>
  | Readonly<{
      kind: "effect";
      command: object;
      sequence: number;
      at: number;
      outcome:
        | Readonly<{ status: "succeeded"; value?: RuntimeValue }>
        | Readonly<{ status: "failed"; failure: object }>;
    }>
  | Readonly<{ kind: "sleep"; command: object; sequence: number; at: number }>
  | Readonly<{ kind: "wait"; command: object; sequence: number; at: number }>
  | Readonly<{ kind: "cancel-request"; cancellation: object }>
  | Readonly<{ kind: "transfer"; pending?: object; transfer: object }>;

/** Executes retained or runtime-created Workflow bytecode without source closures. */
export function advanceWorkflowExecutable(
  executableData: object,
  executionData: object,
  maximumBlocks = 10_000,
): object {
  const executable = executableData as WorkflowExecutableDefinition;
  const execution = cloneRuntime(executionData) as RuntimeExecution;
  assertExecutable(executable, execution, maximumBlocks);
  return advanceProcedure(executable.run, execution, maximumBlocks);
}

/** Applies one external transfer through retained Workflow cleanup semantics. */
export function transferWorkflowExecutable(
  executableData: object,
  executionData: object,
  transferData: object,
  maximumBlocks = 10_000,
): object {
  const executable = executableData as WorkflowExecutableDefinition;
  const execution = cloneRuntime(executionData) as RuntimeExecution;
  assertExecutable(executable, execution, maximumBlocks);
  transferExecution(execution, transferData as RuntimeTransfer);
  return advanceProcedure(executable.run, execution, maximumBlocks);
}

/** Executes one non-suspending State initializer or Action procedure. */
export function executeWorkflowExecutableProcedure(
  procedureData: object,
  contextData: object,
  maximumBlocks = 10_000,
): object {
  const procedure = procedureData as WorkflowExecutableProcedure;
  const context = contextData as ProcedureContext;
  const execution: RuntimeExecution = {
    definition: context.definition,
    status: "running",
    ...(context.identity === undefined ? {} : { identity: cloneRuntime(context.identity) }),
    ...(context.invocation === undefined ? {} : { invocation: cloneRuntime(context.invocation) }),
    ...(context.input === undefined ? {} : { input: cloneRuntime(context.input) }),
    history: { events: 0, continueSuggested: false },
    state: cloneRuntime(context.state) as RuntimeRecord,
    block: procedure.entry,
    locals: {},
    sequence: 0,
    time: context.time,
  };
  const result = advanceProcedure(procedure, execution, maximumBlocks);
  if (result.status === "suspended") {
    throw new Error("Workflow State initialization and Actions cannot suspend yet.");
  }
  return result;
}

/**
 * Replays committed external transitions against one candidate artifact.
 *
 * The candidate is returned only when initialization, Actions, every durable
 * command boundary, and the current execution frame retain identical meaning.
 */
export function replayWorkflowExecutable(
  executableData: object,
  traceData: object,
  maximumBlocks = 10_000,
): object {
  const executable = executableData as WorkflowExecutableDefinition;
  const trace = traceData as RuntimeReplayTrace;
  const initialized = executeWorkflowExecutableProcedure(
    executable.initialization,
    {
      definition: executable.revision,
      ...(trace.identity === undefined ? {} : { identity: cloneRuntime(trace.identity) }),
      ...(trace.input === undefined ? {} : { input: cloneRuntime(trace.input) }),
      state: {},
      time: trace.time,
    },
    maximumBlocks,
  ) as RuntimeExecution;
  if (
    initialized.status !== "succeeded" ||
    dataKind(initialized.result) !== "record" ||
    !runtimeDataEqual(initialized.result, trace.initialState)
  ) {
    throw new Error("Workflow replay diverged at State initialization.");
  }
  let execution: RuntimeExecution = {
    definition: executable.revision,
    status: "running",
    ...(trace.identity === undefined ? {} : { identity: cloneRuntime(trace.identity) }),
    ...(trace.input === undefined ? {} : { input: cloneRuntime(trace.input) }),
    history: { events: 0, continueSuggested: false },
    state: cloneRuntime(initialized.result) as RuntimeRecord,
    block: executable.run.entry,
    locals: {},
    sequence: 0,
    time: trace.time,
  };
  for (let index = 0; index < trace.steps.length; index += 1) {
    const stepData = trace.steps[index];
    if (stepData === undefined) throw new Error("Workflow replay step is missing.");
    execution = applyReplayStep(
      executable,
      execution,
      stepData as RuntimeReplayStep,
      maximumBlocks,
      index,
    );
  }
  const expected = cloneRuntime(trace.expected) as RuntimeExecution;
  expected.definition = executable.revision;
  if (!runtimeDataEqual(execution, expected)) {
    throw new Error("Workflow replay diverged at its current execution frame.");
  }
  return freezeRuntime(execution);
}

function applyReplayStep(
  executable: WorkflowExecutableDefinition,
  executionData: RuntimeExecution,
  step: RuntimeReplayStep,
  maximumBlocks: number,
  index: number,
): RuntimeExecution {
  const execution = cloneRuntime(executionData);
  if (step.kind === "advance") {
    execution.history = cloneRuntime(step.history);
    return advanceProcedure(executable.run, execution, maximumBlocks);
  }
  if (step.kind === "action") {
    const procedure = executable.actionHandlers[step.action];
    if (procedure === undefined) {
      throw new Error(`Workflow replay diverged at Action ${index}.`);
    }
    const action = executeWorkflowExecutableProcedure(
      procedure,
      {
        definition: executable.revision,
        ...(execution.identity === undefined ? {} : { identity: cloneRuntime(execution.identity) }),
        invocation: cloneRuntime(step.invocation),
        ...(step.input === undefined ? {} : { input: cloneRuntime(step.input) }),
        state: cloneRuntime(execution.state),
        time: step.time,
      },
      maximumBlocks,
    ) as RuntimeExecution;
    if (
      action.status !== "succeeded" ||
      !runtimeDataEqual(action.state, step.state) ||
      !runtimeDataEqual(action.result, step.result)
    ) {
      throw new Error(`Workflow replay diverged at Action ${index}.`);
    }
    execution.state = cloneRuntime(action.state);
    return freezeRuntime(execution);
  }
  if (step.kind === "cancel-request") {
    execution.cancellation = cloneRuntime(step.cancellation);
    execution.time = (step.cancellation as Readonly<{ at: number }>).at;
    return freezeRuntime(execution);
  }
  if (step.kind === "transfer") {
    if (step.pending !== undefined && !runtimeDataEqual(execution.pending, step.pending)) {
      throw new Error(`Workflow replay diverged at transfer ${index}.`);
    }
    transferExecution(execution, step.transfer as RuntimeTransfer);
    return advanceProcedure(executable.run, execution, maximumBlocks);
  }
  if (!runtimeDataEqual(execution.pending, step.command)) {
    throw new Error(`Workflow replay diverged at command ${index}.`);
  }
  const pending = execution.pending;
  if (pending === undefined) {
    throw new Error(`Workflow replay command ${index} has no pending operation.`);
  }
  const command = runtimePending(pending);
  if (step.kind === "sleep") {
    if (command.kind !== "sleep" || command.sequence !== step.sequence || command.at !== step.at) {
      throw new Error(`Workflow replay diverged at timer ${index}.`);
    }
    execution.pending = undefined;
    execution.time = step.at;
    execution.status = "running";
    if (command.next === undefined) throw new Error("Workflow replay timer is malformed.");
    execution.block = command.next;
    return freezeRuntime(execution);
  }
  if (step.kind === "wait") {
    if (
      command.kind !== "wait" ||
      command.sequence !== step.sequence ||
      command.until !== step.at
    ) {
      throw new Error(`Workflow replay diverged at wait ${index}.`);
    }
    if (command.next === undefined || command.result === undefined) {
      throw new Error("Workflow replay wait is malformed.");
    }
    execution.pending = undefined;
    execution.time = step.at;
    execution.status = "running";
    execution.block = command.next;
    execution.locals[command.result] = false;
    return freezeRuntime(execution);
  }
  return replayEffect(executable, execution, command, step, maximumBlocks, index);
}

function replayEffect(
  executable: WorkflowExecutableDefinition,
  execution: RuntimeExecution,
  pending: RuntimePending,
  step: Extract<RuntimeReplayStep, { kind: "effect" }>,
  maximumBlocks: number,
  index: number,
): RuntimeExecution {
  execution.time = step.at;
  if (
    (pending.kind === "effect" || pending.kind === "child") &&
    pending.sequence === step.sequence
  ) {
    if (step.outcome.status === "succeeded") {
      execution.pending = undefined;
      if (pending.next === undefined || pending.result === undefined) {
        throw new Error("Workflow replay effect is malformed.");
      }
      execution.status = "running";
      execution.block = pending.next;
      execution.locals[pending.result] = cloneRuntime(step.outcome.value);
      return freezeRuntime(execution);
    }
    // Provider failure and Workflow control transfer are separate durable
    // events. Keep the command so the following transfer can verify it.
    return freezeRuntime(execution);
  }
  if (pending.kind !== "concurrent" || pending.effects === undefined) {
    throw new Error(`Workflow replay diverged at effect ${index}.`);
  }
  const effects = pending.effects as RuntimeConcurrentEffect[];
  let effect: RuntimeConcurrentEffect | undefined;
  for (const candidate of effects) {
    if (candidate.sequence === step.sequence) effect = candidate;
  }
  if (effect === undefined || effect.status !== "pending") {
    throw new Error(`Workflow replay diverged at concurrent effect ${index}.`);
  }
  if (step.outcome.status === "succeeded") {
    effect.status = "succeeded";
    effect.value = cloneRuntime(step.outcome.value);
  } else {
    effect.status = "failed";
    effect.failure = cloneRuntime(step.outcome.failure);
  }
  settleConcurrent(execution);
  if (execution.status !== "failed") return freezeRuntime(execution);
  if (execution.failure === undefined) {
    throw new Error("Workflow replay concurrent failure is malformed.");
  }
  execution.status = "running";
  execution.failure = undefined;
  return freezeRuntime(execution);
}

function assertExecutable(
  executable: WorkflowExecutableDefinition,
  execution: RuntimeExecution,
  maximumBlocks: number,
): void {
  if (executable.version !== 1) {
    throw new Error("Unsupported Workflow executable version.");
  }
  if (execution.definition !== executable.revision) {
    throw new Error("Workflow execution revision does not match its executable.");
  }
  if (maximumBlocks < 1 || maximumBlocks % 1 !== 0 || maximumBlocks > 9_007_199_254_740_991) {
    throw new Error("Workflow block budget must be a positive safe integer.");
  }
}

function advanceProcedure(
  procedure: WorkflowExecutableProcedure,
  execution: RuntimeExecution,
  maximumBlocks: number,
): RuntimeExecution {
  if (
    execution.status === "succeeded" ||
    execution.status === "failed" ||
    execution.status === "cancelled" ||
    execution.status === "continued"
  ) {
    return freezeRuntime(execution);
  }
  if (
    execution.cancellation !== undefined &&
    execution.pending !== undefined &&
    runtimePending(execution.pending).cancellable &&
    !cancellationShielded(execution)
  ) {
    execution.pending = undefined;
    execution.status = "running";
    transferExecution(execution, {
      kind: "cancel",
      cancellation: execution.cancellation,
    });
  }
  if (execution.pending !== undefined) {
    const pending = runtimePending(execution.pending);
    if (pending.kind === "concurrent") {
      if (!settleConcurrent(execution)) return freezeRuntime(execution);
    } else if (pending.kind === "wait") {
      const waitingBlock = findBlock(procedure, execution.block);
      const terminator = waitingBlock.terminator;
      if (
        terminator.kind !== "wait" ||
        !runtimeTruthy(evaluateExpression(terminator.condition, execution)) ||
        (pending.until !== undefined && execution.time >= pending.until)
      ) {
        return freezeRuntime(execution);
      }
      if (pending.result === undefined || pending.next === undefined) {
        throw new Error("Workflow wait frame is malformed.");
      }
      execution.locals[pending.result] = true;
      execution.block = pending.next;
      execution.pending = undefined;
      execution.status = "running";
    } else {
      return freezeRuntime(execution);
    }
  }
  let visited = 0;
  while (execution.status === "running" && execution.pending === undefined) {
    if (visited >= maximumBlocks) {
      execution.status = "failed";
      execution.failure = { type: "resource", limit: maximumBlocks };
    } else {
      visited += 1;
      const block = findBlock(procedure, execution.block);
      for (const instruction of block.body) executeInstruction(instruction, execution);
      executeTerminator(block.terminator, execution);
    }
  }
  return freezeRuntime(execution);
}

function findBlock(procedure: WorkflowExecutableProcedure, id: string): WorkflowExecutableBlock {
  for (const block of procedure.blocks) {
    if (block.id === id) return block;
  }
  throw new Error("Workflow executable block does not exist.");
}

function executeInstruction(
  instruction: WorkflowExecutableInstruction,
  execution: RuntimeExecution,
): void {
  const value = evaluateExpression(instruction.value, execution);
  if (instruction.kind === "let") {
    execution.locals[instruction.name] = cloneRuntime(value);
    return;
  }
  if (instruction.kind === "assign") {
    execution.locals[instruction.name] = assignment(
      instruction.operator,
      execution.locals[instruction.name],
      value,
    );
    return;
  }
  const current = getRuntimePath(execution.state, instruction.path);
  const assigned = assignment(instruction.operator, current, value);
  if (assigned === undefined) {
    throw new Error("Workflow State cannot persist undefined values.");
  }
  setRuntimePath(execution.state, instruction.path, cloneRuntime(assigned));
}

function executeTerminator(
  terminator: WorkflowExecutableTerminator,
  execution: RuntimeExecution,
): void {
  if (terminator.kind === "jump") {
    execution.block = terminator.next;
    return;
  }
  if (terminator.kind === "branch") {
    execution.block = runtimeTruthy(evaluateExpression(terminator.condition, execution))
      ? terminator.consequent
      : terminator.alternate;
    return;
  }
  if (terminator.kind === "effect" || terminator.kind === "child") {
    const effectInput = evaluateExpression(terminator.input, execution);
    const effectOptions =
      terminator.options === undefined
        ? undefined
        : evaluateExpression(terminator.options, execution);
    if (interruptForCancellation(execution)) return;
    execution.pending = {
      kind: terminator.kind,
      sequence: execution.sequence,
      cancellable: !cancellationShielded(execution),
      dependency: terminator.dependency,
      operation: terminator.operation,
      input: cloneRuntime(effectInput),
      ...(effectOptions === undefined ? {} : { options: cloneRuntime(effectOptions) }),
      result: terminator.result,
      next: terminator.next,
    };
    execution.sequence += 1;
    execution.status = "suspended";
    return;
  }
  if (terminator.kind === "sleep") {
    const sleepAt = executableDeadline(terminator.timing, execution);
    if (sleepAt <= execution.time) {
      execution.block = terminator.next;
      return;
    }
    if (interruptForCancellation(execution)) return;
    execution.pending = {
      kind: "sleep",
      sequence: execution.sequence,
      cancellable: !cancellationShielded(execution),
      at: sleepAt,
      next: terminator.next,
    };
    execution.sequence += 1;
    execution.status = "suspended";
    return;
  }
  if (terminator.kind === "wait") {
    if (runtimeTruthy(evaluateExpression(terminator.condition, execution))) {
      execution.locals[terminator.result] = true;
      execution.block = terminator.next;
      return;
    }
    const waitUntil =
      terminator.timeout === undefined
        ? undefined
        : executableDeadline(terminator.timeout, execution);
    if (interruptForCancellation(execution)) return;
    execution.pending = {
      kind: "wait",
      sequence: execution.sequence,
      cancellable: !cancellationShielded(execution),
      condition: cloneRuntime(terminator.conditionIR) as object,
      ...(waitUntil === undefined ? {} : { until: waitUntil }),
      result: terminator.result,
      next: terminator.next,
    };
    execution.sequence += 1;
    execution.status = "suspended";
    return;
  }
  if (terminator.kind === "concurrent") {
    if (terminator.effects.length > 0 && interruptForCancellation(execution)) return;
    const concurrentEffects: object[] = [];
    for (const concurrentEffect of terminator.effects) {
      const concurrentInput = evaluateExpression(concurrentEffect.input, execution);
      const concurrentOptions =
        concurrentEffect.options === undefined
          ? undefined
          : evaluateExpression(concurrentEffect.options, execution);
      concurrentEffects.push({
        sequence: execution.sequence,
        dependency: concurrentEffect.dependency,
        operation: concurrentEffect.operation,
        input: cloneRuntime(concurrentInput),
        ...(concurrentOptions === undefined ? {} : { options: cloneRuntime(concurrentOptions) }),
        status: "pending",
      });
      execution.sequence += 1;
    }
    execution.pending = {
      kind: "concurrent",
      cancellable: !cancellationShielded(execution),
      operation: terminator.operation,
      effects: concurrentEffects,
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
      shielded:
        !terminator.cancellable ||
        (execution.scope !== undefined && runtimeScope(execution.scope).shielded),
      phase: "body",
      ...(terminator.catch === undefined ? {} : { catch: terminator.catch }),
      ...(terminator.cleanup === undefined ? {} : { cleanup: terminator.cleanup }),
      ...(terminator.next === undefined ? {} : { next: terminator.next }),
      ...(execution.scope === undefined ? {} : { parent: execution.scope }),
    };
    execution.block = terminator.body;
    return;
  }
  if (terminator.kind === "leave-scope") {
    const leavingScope = execution.scope === undefined ? undefined : runtimeScope(execution.scope);
    if (
      leavingScope === undefined ||
      leavingScope.phase === "cleanup" ||
      leavingScope.next === undefined
    ) {
      throw new Error("Workflow leave-scope requires an active body or catch scope.");
    }
    transferExecution(execution, { kind: "continue", next: leavingScope.next });
    return;
  }
  if (terminator.kind === "complete-cleanup") {
    const cleanupScope = execution.scope === undefined ? undefined : runtimeScope(execution.scope);
    if (
      cleanupScope === undefined ||
      cleanupScope.phase !== "cleanup" ||
      cleanupScope.completion === undefined
    ) {
      throw new Error("Workflow complete-cleanup requires an active cleanup continuation.");
    }
    const cleanupCompletion = cleanupScope.completion as RuntimeTransfer;
    execution.scope = cleanupScope.parent;
    transferExecution(
      execution,
      cancellationAfterShield(execution, cleanupScope, cleanupCompletion),
    );
    return;
  }
  if (terminator.kind === "continue-as-new") {
    const continuationInput = evaluateExpression(terminator.input, execution);
    transferExecution(execution, {
      kind: "continue-as-new",
      ...(continuationInput === undefined ? {} : { input: cloneRuntime(continuationInput) }),
    });
    return;
  }
  if (terminator.kind === "return") {
    const returnValue = evaluateExpression(terminator.value, execution);
    transferExecution(execution, {
      kind: "return",
      ...(returnValue === undefined ? {} : { value: cloneRuntime(returnValue) }),
    });
    return;
  }
  if (terminator.kind === "fail") {
    const failureValue = evaluateExpression(terminator.value, execution);
    transferExecution(execution, {
      kind: "fail",
      failure: {
        type: "declared",
        ...(failureValue === undefined ? {} : { value: cloneRuntime(failureValue) }),
      },
    });
    return;
  }
  throw new Error("Unsupported Workflow executable terminator.");
}

function evaluateExpression(
  expression: WorkflowExecutableExpression,
  execution: RuntimeExecution,
): RuntimeValue {
  const stack: RuntimeValue[] = [];
  let size = 0;
  let position = 0;
  while (position < expression.length) {
    const operation = expression[position];
    if (operation === undefined) {
      throw new Error("Workflow executable expression operation is missing.");
    }
    if (operation.kind === "literal") {
      stack[size] = cloneRuntime(operation.value);
      size += 1;
      position += 1;
    } else if (operation.kind === "none") {
      stack[size] = undefined;
      size += 1;
      position += 1;
    } else if (operation.kind === "read") {
      const source =
        operation.source === "identity"
          ? execution.identity
          : operation.source === "invocation"
            ? execution.invocation
            : operation.source === "input"
              ? execution.input
              : operation.source === "state"
                ? execution.state
                : execution.history;
      stack[size] = cloneRuntime(getRuntimePath(source, operation.path));
      size += 1;
      position += 1;
    } else if (operation.kind === "local") {
      stack[size] = cloneRuntime(execution.locals[operation.name]);
      size += 1;
      position += 1;
    } else if (operation.kind === "time") {
      stack[size] = execution.time;
      size += 1;
      position += 1;
    } else if (operation.kind === "array") {
      const arrayValues: RuntimeValue[] = [];
      const arrayFrom = size - operation.count;
      for (let arrayIndex = arrayFrom; arrayIndex < size; arrayIndex += 1) {
        const arrayItem = stack[arrayIndex];
        if (arrayItem === undefined) {
          throw new Error("Workflow arrays cannot contain undefined values.");
        }
        arrayValues.push(cloneRuntime(arrayItem));
      }
      size = arrayFrom;
      stack[size] = arrayValues;
      size += 1;
      position += 1;
    } else if (operation.kind === "record") {
      const recordValue: RuntimeRecord = {};
      const recordFrom = size - operation.fields.length;
      for (let recordIndex = 0; recordIndex < operation.fields.length; recordIndex += 1) {
        const recordField = stack[recordFrom + recordIndex];
        if (recordField !== undefined) {
          const recordName = operation.fields[recordIndex];
          if (recordName === undefined) {
            throw new Error("Workflow executable record field is missing.");
          }
          recordValue[recordName] = cloneRuntime(recordField);
        }
      }
      size = recordFrom;
      stack[size] = recordValue;
      size += 1;
      position += 1;
    } else if (operation.kind === "record-merge") {
      const mergedValue: RuntimeRecord = {};
      const mergedFrom = size - operation.entries.length;
      for (let mergedIndex = 0; mergedIndex < operation.entries.length; mergedIndex += 1) {
        const mergedEntry = operation.entries[mergedIndex];
        if (mergedEntry === undefined) {
          throw new Error("Workflow executable record entry is missing.");
        }
        const mergedItem = stack[mergedFrom + mergedIndex];
        if (mergedEntry.kind === "field") {
          if (mergedItem !== undefined) {
            mergedValue[mergedEntry.name] = cloneRuntime(mergedItem);
          }
        } else {
          if (dataKind(mergedItem) !== "record") {
            throw new Error("Workflow record spread requires a record.");
          }
          const mergedRecord = mergedItem as RuntimeRecord;
          for (const mergedName of Object.keys(mergedRecord)) {
            mergedValue[mergedName] = cloneRuntime(mergedRecord[mergedName]);
          }
        }
      }
      size = mergedFrom;
      stack[size] = mergedValue;
      size += 1;
      position += 1;
    } else if (operation.kind === "property") {
      stack[size - 1] = cloneRuntime(getRuntimePath(stack[size - 1], [operation.name]));
      position += 1;
    } else if (operation.kind === "index") {
      const indexKey = stack[size - 1];
      const indexedValue = stack[size - 2];
      const indexKind = dataKind(indexKey);
      if (indexKind !== "number" && indexKind !== "string") {
        throw new Error("Workflow index must be a string or number.");
      }
      const indexName =
        indexKind === "string" ? (indexKey as string) : (JSON.stringify(indexKey) as string);
      size -= 1;
      stack[size - 1] = cloneRuntime(getRuntimePath(indexedValue, [indexName]));
      position += 1;
    } else if (operation.kind === "unary") {
      const unaryValue = stack[size - 1];
      if (operation.operator === "!") stack[size - 1] = !runtimeTruthy(unaryValue);
      else if (operation.operator === "present") {
        stack[size - 1] = unaryValue !== undefined && unaryValue !== null;
      } else {
        if (dataKind(unaryValue) !== "number") {
          throw new Error("Workflow unary minus requires a number.");
        }
        stack[size - 1] = -(unaryValue as number);
      }
      position += 1;
    } else if (operation.kind === "binary") {
      const left = stack[size - 2];
      const right = stack[size - 1];
      size -= 1;
      stack[size - 1] = binary(operation.operator, left, right);
      position += 1;
    } else if (operation.kind === "branch") {
      const branchValue = stack[size - 1];
      const branchSelected =
        operation.condition === "falsy"
          ? !runtimeTruthy(branchValue)
          : operation.condition === "truthy"
            ? runtimeTruthy(branchValue)
            : branchValue !== undefined && branchValue !== null;
      if (branchSelected) {
        if (!operation.keep) size -= 1;
        position = operation.target;
      } else {
        size -= 1;
        position += 1;
      }
    } else if (operation.kind === "drop") {
      size -= 1;
      position += 1;
    } else {
      position = operation.target;
    }
  }
  if (size !== 1) throw new Error("Workflow executable expression has an invalid stack result.");
  return cloneRuntime(stack[0]);
}

function binary(
  operator: "+" | "-" | "*" | "/" | "%" | "===" | "!==" | "<" | "<=" | ">" | ">=",
  left: RuntimeValue,
  right: RuntimeValue,
): RuntimeValue {
  const leftKind = dataKind(left);
  const rightKind = dataKind(right);
  if (operator === "+") {
    if (leftKind === "number" && rightKind === "number") {
      return (left as number) + (right as number);
    }
    if (leftKind === "string" && rightKind === "string") {
      return (left as string) + (right as string);
    }
    throw new Error("Workflow addition requires two numbers or two strings.");
  }
  if (operator === "===") return runtimePrimitive(left) === runtimePrimitive(right);
  if (operator === "!==") return runtimePrimitive(left) !== runtimePrimitive(right);
  if (operator === "-" || operator === "*" || operator === "/" || operator === "%") {
    if (leftKind !== "number" || rightKind !== "number") {
      throw new Error("Workflow arithmetic requires two numbers.");
    }
    const arithmeticLeft = left as number;
    const arithmeticRight = right as number;
    if (operator === "-") return arithmeticLeft - arithmeticRight;
    if (operator === "*") return arithmeticLeft * arithmeticRight;
    if (operator === "/") return arithmeticLeft / arithmeticRight;
    return arithmeticLeft % arithmeticRight;
  }
  if (leftKind !== "number" || rightKind !== "number") {
    throw new Error("Workflow comparison requires two numbers.");
  }
  const comparisonLeft = left as number;
  const comparisonRight = right as number;
  if (operator === "<") return comparisonLeft < comparisonRight;
  if (operator === "<=") return comparisonLeft <= comparisonRight;
  if (operator === ">") return comparisonLeft > comparisonRight;
  return comparisonLeft >= comparisonRight;
}

function assignment(
  operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=",
  current: RuntimeValue,
  value: RuntimeValue,
): RuntimeValue {
  if (operator === "=") return value;
  if (operator === "??=") return current === undefined || current === null ? value : current;
  if (operator === "+=") return binary("+", current, value);
  if (operator === "-=") return binary("-", current, value);
  if (operator === "*=") return binary("*", current, value);
  return binary("/", current, value);
}

function executableDeadline(timing: WorkflowExecutableTiming, execution: RuntimeExecution): number {
  const value = evaluateExpression(timing.value, execution);
  if (
    dataKind(value) !== "number" ||
    (value as number) < 0 ||
    (value as number) % 1 !== 0 ||
    (value as number) > 9_007_199_254_740_991
  ) {
    throw new Error("Workflow timing must be a non-negative safe integer.");
  }
  const timingValue = value as number;
  return timing.kind === "for" ? execution.time + timingValue : timingValue;
}

function interruptForCancellation(execution: RuntimeExecution): boolean {
  if (execution.cancellation === undefined || cancellationShielded(execution)) return false;
  transferExecution(execution, {
    kind: "cancel",
    cancellation: execution.cancellation,
  });
  return true;
}

function cancellationShielded(execution: RuntimeExecution): boolean {
  return execution.scope !== undefined && runtimeScope(execution.scope).shielded;
}

function cancellationAfterShield(
  execution: RuntimeExecution,
  exited: RuntimeScope,
  transfer: RuntimeTransfer,
): RuntimeTransfer {
  if (
    exited.cancellable ||
    execution.cancellation === undefined ||
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

function transferExecution(execution: RuntimeExecution, initial: RuntimeTransfer): void {
  let transfer = cloneRuntime(initial) as RuntimeTransfer;
  execution.pending = undefined;
  execution.status = "running";
  while (true) {
    const scope = execution.scope === undefined ? undefined : runtimeScope(execution.scope);
    if (scope === undefined) {
      finishTransfer(execution, transfer);
      return;
    }
    if (scope.phase === "cleanup") {
      execution.scope = scope.parent;
      transfer = cancellationAfterShield(execution, scope, transfer);
    } else if (transfer.kind === "fail" && scope.phase === "body" && scope.catch !== undefined) {
      scope.phase = "catch";
      execution.locals[scope.catch.result] = cloneRuntime(transfer.failure);
      execution.scope = scope;
      execution.block = scope.catch.block;
      return;
    } else if (scope.cleanup !== undefined) {
      scope.phase = "cleanup";
      scope.completion = cloneRuntime(transfer) as object;
      execution.scope = scope;
      execution.block = scope.cleanup;
      return;
    } else {
      execution.scope = scope.parent;
      transfer = cancellationAfterShield(execution, scope, transfer);
      if (transfer.kind === "continue") {
        finishTransfer(execution, transfer);
        return;
      }
    }
  }
}

function finishTransfer(execution: RuntimeExecution, transfer: RuntimeTransfer): void {
  if (transfer.kind === "continue") {
    execution.block = transfer.next;
    execution.status = "running";
    return;
  }
  execution.scope = undefined;
  if (transfer.kind === "continue-as-new") {
    execution.continuedInput = cloneRuntime(transfer.input);
    execution.cancellation = undefined;
    execution.failure = undefined;
    execution.result = undefined;
    execution.status = "continued";
    return;
  }
  if (transfer.kind === "return") {
    execution.result = cloneRuntime(transfer.value);
    execution.failure = undefined;
    execution.status = "succeeded";
    return;
  }
  if (transfer.kind === "fail") {
    execution.failure = cloneRuntime(transfer.failure);
    execution.result = undefined;
    execution.status = "failed";
    return;
  }
  execution.cancellation = cloneRuntime(transfer.cancellation) as object;
  execution.failure = undefined;
  execution.result = undefined;
  execution.status = "cancelled";
}

function settleConcurrent(execution: RuntimeExecution): boolean {
  if (execution.pending === undefined) return false;
  const pending = runtimePending(execution.pending);
  if (pending.kind !== "concurrent" || pending.effects === undefined) return false;
  const effects: RuntimeConcurrentEffect[] = [];
  for (const pendingEffect of pending.effects) {
    effects.push(pendingEffect as RuntimeConcurrentEffect);
  }
  if (pending.operation === "race") {
    let winner: RuntimeConcurrentEffect | undefined;
    for (const raceEffect of effects) {
      if (winner === undefined && raceEffect.status !== "pending") {
        winner = raceEffect;
      }
    }
    if (winner === undefined) return false;
    execution.pending = undefined;
    if (winner.status === "failed") {
      transferExecution(execution, {
        kind: "fail",
        failure: winner.failure ?? { type: "execution" },
      });
      return true;
    }
    if (pending.result === undefined || pending.next === undefined) {
      throw new Error("Workflow concurrent frame is malformed.");
    }
    execution.locals[pending.result] = cloneRuntime(winner.value);
    execution.block = pending.next;
    execution.status = "running";
    return true;
  }
  if (pending.operation === "all") {
    for (const failedEffect of effects) {
      if (failedEffect.status === "failed") {
        execution.pending = undefined;
        transferExecution(execution, {
          kind: "fail",
          failure: failedEffect.failure ?? { type: "execution" },
        });
        return true;
      }
    }
  }
  for (const unsettledEffect of effects) {
    if (unsettledEffect.status === "pending") return false;
  }
  if (pending.result === undefined || pending.next === undefined) {
    throw new Error("Workflow concurrent frame is malformed.");
  }
  const values: RuntimeValue[] = [];
  for (const resultEffect of effects) {
    if (pending.operation === "all") {
      if (resultEffect.value === undefined) {
        throw new Error("Workflow concurrent results must be serializable values.");
      }
      values.push(cloneRuntime(resultEffect.value));
    } else if (resultEffect.status === "succeeded") {
      values.push({
        status: "fulfilled",
        ...(resultEffect.value === undefined ? {} : { value: cloneRuntime(resultEffect.value) }),
      });
    } else {
      values.push({
        status: "rejected",
        reason: cloneRuntime(resultEffect.failure),
      });
    }
  }
  execution.locals[pending.result] = values;
  execution.pending = undefined;
  execution.block = pending.next;
  execution.status = "running";
  return true;
}

function runtimePending(value: object): RuntimePending {
  return value as RuntimePending;
}

function runtimeScope(value: object): RuntimeScope {
  return value as RuntimeScope;
}

function getRuntimePath(value: RuntimeValue, path: readonly string[]): RuntimeValue {
  let current = value;
  for (const name of path) {
    const currentKind = dataKind(current);
    if (currentKind !== "record" && currentKind !== "array") {
      return undefined;
    }
    current = (current as RuntimeRecord)[name];
  }
  return current;
}

function setRuntimePath(target: RuntimeRecord, path: readonly string[], value: RuntimeValue): void {
  if (path.length === 0) throw new Error("Workflow State assignment requires a property path.");
  let current = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const name = path[index];
    if (name === undefined) {
      throw new Error("Workflow State assignment path is malformed.");
    }
    const child = current[name];
    const childKind = dataKind(child);
    if (childKind !== "record" && childKind !== "array") {
      const created: RuntimeRecord = {};
      current[name] = created;
      current = created;
    } else {
      current = child as RuntimeRecord;
    }
  }
  const finalName = path[path.length - 1];
  if (finalName === undefined) {
    throw new Error("Workflow State assignment path is malformed.");
  }
  current[finalName] = value;
}

function runtimeTruthy(value: RuntimeValue): boolean {
  return value !== undefined && value !== null && value !== false && value !== 0 && value !== "";
}

function runtimePrimitive(value: RuntimeValue): RuntimeValue {
  return value;
}

function runtimeDataEqual(left: RuntimeValue, right: RuntimeValue): boolean {
  const pending: Array<Readonly<{ left: RuntimeValue; right: RuntimeValue }>> = [{ left, right }];
  let position = 0;
  while (position < pending.length) {
    const pair = pending[position];
    if (pair === undefined) return false;
    position += 1;
    const leftKind = dataKind(pair.left);
    if (leftKind !== dataKind(pair.right)) return false;
    if (leftKind === "undefined" || leftKind === "null") {
      // These kinds have one canonical value.
    } else if (leftKind === "boolean" || leftKind === "number" || leftKind === "string") {
      if (pair.left !== pair.right) return false;
    } else if (leftKind === "array") {
      const leftArray = pair.left as RuntimeValue[];
      const rightArray = pair.right as RuntimeValue[];
      if (leftArray.length !== rightArray.length) return false;
      for (let arrayIndex = 0; arrayIndex < leftArray.length; arrayIndex += 1) {
        pending.push({ left: leftArray[arrayIndex], right: rightArray[arrayIndex] });
      }
    } else {
      const leftRecord = pair.left as RuntimeRecord;
      const rightRecord = pair.right as RuntimeRecord;
      const leftNames = Object.keys(leftRecord).sort();
      const rightNames = Object.keys(rightRecord).sort();
      if (leftNames.length !== rightNames.length) return false;
      for (let recordIndex = 0; recordIndex < leftNames.length; recordIndex += 1) {
        const leftName = leftNames[recordIndex];
        const rightName = rightNames[recordIndex];
        if (leftName === undefined || rightName === undefined || leftName !== rightName) {
          return false;
        }
        pending.push({ left: leftRecord[leftName], right: rightRecord[rightName] });
      }
    }
  }
  return true;
}

function cloneRuntime<Value>(value: Value): Value {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as Value;
}

function freezeRuntime(execution: RuntimeExecution): RuntimeExecution {
  return cloneRuntime(execution);
}
