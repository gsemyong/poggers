import {
  isPresentationTemporalValue,
  type ActionEvent,
  type Event,
  type InvocationId,
} from "@/core/ui/presentation";

type AnyFunction = (...arguments_: never[]) => unknown;

export type PresentationData =
  | null
  | boolean
  | number
  | string
  | readonly PresentationData[]
  | Readonly<{ [key: string]: PresentationData }>;

/** One immutable, serializable logical Presentation frame. */
export type PresentationFrame = Readonly<{
  time: number;
  input: PresentationData;
  temporal: PresentationData;
  declarations: PresentationData;
}>;

/** Creates the deterministic adapter boundary used by inspection and tests. */
export function createPresentationFrame(frame: {
  readonly time: number;
  readonly input: unknown;
  readonly temporal: unknown;
  readonly declarations: unknown;
}): PresentationFrame {
  if (!Number.isFinite(frame.time)) throw new TypeError("Presentation frame time must be finite.");
  return Object.freeze({
    time: frame.time,
    input: normalizePresentationData(frame.input, "input"),
    temporal: normalizePresentationData(frame.temporal, "temporal"),
    declarations: normalizePresentationData(frame.declarations, "declarations"),
  });
}

type RuntimeEventEntry = Readonly<{ sequence: number; payload: unknown }>;
type RuntimeEventChannel = {
  readonly entries: RuntimeEventEntry[];
  sequence: number;
};

const runtimeEvents = new WeakMap<object, RuntimeEventChannel>();

export type ActionEventLedger = Readonly<{
  events: Readonly<Record<string, ActionEvent<AnyFunction>>>;
  invoke<Value>(action: string, arguments_: readonly unknown[], run: () => Value): Value;
}>;

/** Creates the Behavior-owned occurrence ledger observed by Presentation. */
export function createActionEventLedger(
  actions: readonly string[],
  onOccurrence: () => void = () => undefined,
): ActionEventLedger {
  const events: Record<string, ActionEvent<AnyFunction>> = Object.create(null);
  const channels = new Map<
    string,
    Readonly<{
      started: Event<unknown>;
      completed: Event<unknown>;
      failed: Event<unknown>;
    }>
  >();
  let invocation = 0;

  for (const action of actions) {
    const started = createRuntimeEvent();
    const completed = createRuntimeEvent();
    const failed = createRuntimeEvent();
    const event = Object.freeze(
      Object.assign(started, { completed, failed }),
    ) as ActionEvent<AnyFunction>;
    channels.set(action, { started: event, completed, failed });
    events[action] = event;
  }

  const publish = (event: Event<unknown>, payload: unknown) => {
    const channel = runtimeEvents.get(event as object)!;
    channel.entries.push(Object.freeze({ sequence: ++channel.sequence, payload }));
    onOccurrence();
  };

  return Object.freeze({
    events: Object.freeze(events),
    invoke<Value>(action: string, arguments_: readonly unknown[], run: () => Value): Value {
      const channel = channels.get(action);
      if (!channel) return run();
      const id = `${action}:${++invocation}` as InvocationId;
      const input = actionInput(arguments_);
      publish(channel.started, Object.freeze({ invocation: id, input }));
      try {
        const result = run();
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            (output) => {
              publish(channel.completed, Object.freeze({ invocation: id, input, output }));
              return output;
            },
            (error: unknown) => {
              publish(channel.failed, Object.freeze({ invocation: id, input, error }));
              throw error;
            },
          ) as Value;
        }
        publish(channel.completed, Object.freeze({ invocation: id, input, output: result }));
        return result;
      } catch (error) {
        publish(channel.failed, Object.freeze({ invocation: id, input, error }));
        throw error;
      }
    },
  });
}

/** Returns ordered occurrences after a retained consumer cursor. */
export function readEventOccurrences(
  event: Event<unknown>,
  after = 0,
): Readonly<{ cursor: number; occurrences: readonly RuntimeEventEntry[] }> {
  const channel = runtimeEvents.get(event as object);
  if (!channel) throw new TypeError("The value is not a Poggers Event.");
  return Object.freeze({
    cursor: channel.sequence,
    occurrences: Object.freeze(channel.entries.filter(({ sequence }) => sequence > after)),
  });
}

/** Reads the current cursor without exposing Event history to authors. */
export function eventCursor(event: Event<unknown>): number {
  const channel = runtimeEvents.get(event as object);
  if (!channel) throw new TypeError("The value is not a Poggers Event.");
  return channel.sequence;
}

function createRuntimeEvent(): Event<unknown> {
  const event = Object.create(null) as Event<unknown>;
  runtimeEvents.set(event as object, { entries: [], sequence: 0 });
  return event;
}

function actionInput(arguments_: readonly unknown[]): unknown {
  if (arguments_.length === 0) return undefined;
  if (arguments_.length === 1) return arguments_[0];
  return Object.freeze([...arguments_]);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value && (typeof value === "object" || typeof value === "function") && "then" in value,
  );
}

function normalizePresentationData(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
): PresentationData {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Presentation frame ${path} must be finite.`);
    return value;
  }
  if (isPresentationTemporalValue(value)) {
    return normalizePresentationData(value.current, path, ancestors);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`Presentation frame ${path} cannot be cyclic.`);
    const nextAncestors = new Set(ancestors).add(value);
    return Object.freeze(
      value.map((item, index) =>
        normalizePresentationData(item, `${path}[${index}]`, nextAncestors),
      ),
    );
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`Presentation frame ${path} contains unsupported ${typeof value}.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Presentation frame ${path} must contain plain data.`);
  }
  if (ancestors.has(value)) throw new TypeError(`Presentation frame ${path} cannot be cyclic.`);
  const nextAncestors = new Set(ancestors).add(value);
  const result: Record<string, PresentationData> = {};
  for (const key of Object.keys(value).sort()) {
    const item = Reflect.get(value, key);
    if (item === undefined) continue;
    result[key] = normalizePresentationData(item, `${path}.${key}`, nextAncestors);
  }
  return Object.freeze(result);
}
