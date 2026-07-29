import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DeliverPolicy,
  DiscardPolicy,
  JetStreamApiCodes,
  JetStreamApiError,
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
  type JetStreamClient,
  type JetStreamManager,
  type StoredMsg,
} from "@nats-io/jetstream";
import { connect } from "@nats-io/transport-node";

import type { DependencyContractIR } from "@/compiler/ir";
import { cloneData } from "@/core/data";
import {
  createDependencyCancellation,
  type DependencyCancellation,
  type DependencyContract,
  type DependencyImplementation,
  type DependencyProviderInvocation,
} from "@/core/dependency";
import {
  conformExternalDependencies,
  createDeferredDependencyBinding,
  type DeferredDependencyBinding,
} from "@/execution/process";
import type {
  Alarm,
  Calendar,
  CalendarField,
  CalendarPattern,
  CalendarRange,
  Clock,
  EventStore,
  ExecutionContext,
  HttpField,
  HttpRequest,
  HttpResponse,
  HttpServer,
  Identifiers,
  PositionedStoredEvent,
  ScheduledDependencyTarget,
  ServerDependencyProvider,
  StoredEvent,
  Synchronization,
  Telemetry,
  Timer,
} from "@/platforms/server";

export type NodeHostOptions = Readonly<{
  directory?: string;
  database?: string;
  configuration?: Readonly<Record<string, string>>;
  host?: string;
  port?: number;
  shutdownTimeout?: number;
  allowedOrigins?: readonly string[];
  appName?: string;
  eventStore?: NodeEventStoreOptions;
}>;

export type NodeEventStoreOptions =
  | Readonly<{ kind: "sqlite" }>
  | Readonly<{ kind: "jetstream"; servers: string | readonly string[]; stream?: string }>;

type HostedEventStore<Event> =
  | (DependencyImplementation<EventStore<Event>> & Disposable)
  | (DependencyImplementation<EventStore<Event>> & AsyncDisposable);
type SqliteEventStore<Event> = DependencyImplementation<EventStore<Event>> & Disposable;
type JetStreamEventStore<Event> = DependencyImplementation<EventStore<Event>> & AsyncDisposable;
type ReloadableHttpServer = DependencyImplementation<HttpServer> &
  AsyncDisposable &
  Readonly<{
    locations: readonly string[];
    [beginRouteReplacement](): Disposable;
  }>;

type AlarmDelivery = Readonly<{
  id: string;
  at: number;
  attempt: number;
  target: ScheduledDependencyTarget;
  cancellation: DependencyCancellation;
}>;

type NodeAlarmImplementation = DependencyImplementation<Alarm> &
  Disposable &
  Readonly<{
    bind(dispatch: (delivery: AlarmDelivery) => Promise<void>): Disposable;
  }>;

export type NodeHost<Event> = Readonly<{
  alarm: Alarm &
    Disposable &
    Readonly<{
      bind(dispatch: (delivery: AlarmDelivery) => Promise<void>): Disposable;
    }>;
  events: HostedEventStore<Event>;
  executionContext: ExecutionContext;
  identifiers: Identifiers;
  synchronization: Synchronization;
  calendar: Calendar;
  clock: Clock;
  timer: Timer;
  telemetry: Telemetry;
  http: HttpServer & AsyncDisposable & Readonly<{ locations: readonly string[] }>;
}>;

type NodeHostImplementations<Event> = Readonly<{
  alarm: NodeAlarmImplementation;
  events: HostedEventStore<Event>;
  executionContext: DependencyImplementation<ExecutionContext>;
  identifiers: DependencyImplementation<Identifiers>;
  synchronization: DependencyImplementation<Synchronization>;
  calendar: DependencyImplementation<Calendar>;
  clock: DependencyImplementation<Clock>;
  timer: DependencyImplementation<Timer>;
  telemetry: DependencyImplementation<Telemetry>;
  http: ReloadableHttpServer;
}>;
type MutablePartial<Value> = { -readonly [Name in keyof Value]?: Value[Name] };
export type NodeHostDependency = keyof NodeHost<unknown>;
export type NodeFeatureDependencyProviders = Readonly<
  Record<string, ServerDependencyProvider<DependencyContract>>
>;

type NodeFeatureProviderBinding = Readonly<{
  binding: DeferredDependencyBinding;
  contract: DependencyContractIR;
  implementation: object & AsyncDisposable;
}>;

type NodeFeatureProviderScope = Readonly<{
  bindings: Map<string, NodeFeatureProviderBinding>;
  context: NodeFeatureProviderContext;
}>;

type NodeFeatureProviderContext = Readonly<{
  appName: string;
  configuration: NodeHostOptions["configuration"];
  directory: string;
  origin: string;
  allowedOrigins: readonly string[];
}>;

export type NodeFeatureProviderReplacement = AsyncDisposable &
  Readonly<{ commit(): Promise<void> }>;

const beginRouteReplacement = Symbol("kit.server.begin-route-replacement");
const featureProviderScopes = new WeakMap<object, NodeFeatureProviderScope>();

/** Opens the adapter-owned overlap window used by transactional development replacement. */
export function beginNodeHostReplacement(
  dependencies: Readonly<Record<string, unknown>>,
): Disposable {
  const http = dependencies.http as
    | Readonly<{ [beginRouteReplacement]?(): Disposable }>
    | undefined;
  return http?.[beginRouteReplacement]?.() ?? { [Symbol.dispose]() {} };
}

/**
 * Stages a new owner-selected provider scope behind stable Dependency facades.
 *
 * Disposing before commit rolls the scope back. Committing retains the new
 * implementations and disposes the old scope after the replacement Program is
 * ready.
 */
export async function beginNodeFeatureProviderReplacement(
  dependencies: Readonly<Record<string, unknown>>,
  providers: NodeFeatureDependencyProviders,
): Promise<NodeFeatureProviderReplacement> {
  const scope = featureProviderScopes.get(dependencies);
  if (!scope) {
    if (Object.keys(providers).length) {
      throw new Error("The active server host has no replaceable Feature provider scope.");
    }
    return {
      async commit() {},
      async [Symbol.asyncDispose]() {},
    };
  }
  const expected = [...scope.bindings.keys()].sort();
  const supplied = Object.keys(providers).sort();
  if (expected.join("\n") !== supplied.join("\n")) {
    throw new Error(
      "Feature provider ownership changed. Restart development to apply this structural change.",
    );
  }

  const staged = new Map<string, NodeFeatureProviderBinding>();
  try {
    for (const dependency of expected) {
      const current = scope.bindings.get(dependency)!;
      const implementation = await realizeNodeFeatureProvider(
        providers[dependency]!,
        scope.context,
      );
      conformExternalDependencies([current.contract], { [dependency]: implementation });
      staged.set(dependency, {
        binding: current.binding,
        contract: current.contract,
        implementation,
      });
    }
  } catch (error) {
    await disposeResources([...staged.values()].map(({ implementation }) => implementation));
    throw error;
  }

  for (const [dependency, replacement] of staged) {
    scope.bindings.get(dependency)!.binding.replace(replacement.implementation);
  }
  let finished = false;
  return {
    async commit() {
      if (finished) return;
      finished = true;
      const previous = [...scope.bindings.values()].map(({ implementation }) => implementation);
      for (const [dependency, replacement] of staged) {
        scope.bindings.set(dependency, replacement);
      }
      await disposeResources(previous);
    },
    async [Symbol.asyncDispose]() {
      if (finished) return;
      finished = true;
      for (const previous of scope.bindings.values()) {
        previous.binding.replace(previous.implementation);
      }
      await disposeResources([...staged.values()].map(({ implementation }) => implementation));
    },
  };
}

/** Connects an adapter-owned Alarm to one running Program's routed Dependencies. */
export function bindNodeAlarmDispatcher(
  dependencies: Readonly<Record<string, unknown>>,
  dispatch: (delivery: AlarmDelivery) => Promise<void>,
): Disposable {
  const alarm = dependencies.alarm as Partial<NodeHost<unknown>["alarm"]> | undefined;
  return typeof alarm?.bind === "function"
    ? alarm.bind(dispatch)
    : {
        [Symbol.dispose]() {},
      };
}

/** Implements the reusable host boundary; Features own all domain routing and APIs. */
export function createNodeHost<
  Event = unknown,
  const Dependencies extends readonly DependencyContractIR[] = readonly DependencyContractIR[],
>(
  input: NodeHostOptions &
    Readonly<{ dependencies: Dependencies; providers?: NodeFeatureDependencyProviders }>,
): Promise<
  Pick<NodeHost<Event>, Extract<Dependencies[number]["name"], NodeHostDependency>> &
    Readonly<Record<string, unknown>>
>;
export async function createNodeHost<Event = unknown>(
  input: NodeHostOptions &
    Readonly<{
      dependencies: readonly DependencyContractIR[];
      providers?: NodeFeatureDependencyProviders;
    }>,
): Promise<Readonly<Record<string, unknown>>> {
  const available: readonly NodeHostDependency[] = [
    "alarm",
    "calendar",
    "clock",
    "events",
    "executionContext",
    "http",
    "identifiers",
    "synchronization",
    "telemetry",
    "timer",
  ];
  const requested = new Set(input.dependencies.map(({ name }) => name));
  for (const dependency of requested) {
    if (
      !available.includes(dependency as NodeHostDependency) &&
      !Object.hasOwn(input.providers ?? {}, dependency)
    ) {
      throw new Error(
        `Server Platform does not implement host Dependency ${JSON.stringify(dependency)}.`,
      );
    }
  }
  const host = input.host ?? "localhost";
  const port = input.port ?? numberEnvironment("PORT") ?? 3010;
  const origin = `http://${host}:${port}`;
  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins ?? []);
  const directory = input.directory ?? process.cwd();
  const providerContext: NodeFeatureProviderContext = {
    appName: input.appName ?? "Kit",
    configuration: input.configuration,
    directory,
    origin,
    allowedOrigins,
  };
  let database: DatabaseSync | undefined;
  let databaseClosed = false;
  const closeDatabase = () => {
    if (!database || databaseClosed) return;
    databaseClosed = true;
    database.close();
  };
  const eventStore = resolveEventStore(input);
  if (requested.has("events") && eventStore.kind === "sqlite") {
    const path =
      input.database ?? process.env.KIT_DATABASE ?? resolve(directory, ".kit/data/system.sqlite");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    database = new DatabaseSync(path);
  }
  const result: MutablePartial<NodeHostImplementations<Event>> & Record<string, unknown> = {};
  const providerBindings = new Map<string, NodeFeatureProviderBinding>();
  try {
    for (const [dependency, provider] of Object.entries(input.providers ?? {}).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      if (!requested.has(dependency)) continue;
      const implementation = await realizeNodeFeatureProvider(provider, providerContext);
      const binding = createDeferredDependencyBinding(dependency, { dispatcher: false });
      binding.bind(implementation);
      const contract = input.dependencies.find(({ name }) => name === dependency)!;
      result[dependency] = binding.dependency;
      providerBindings.set(dependency, { binding, contract, implementation });
    }
    if (requested.has("alarm")) result.alarm = createNodeAlarm();
    if (requested.has("events")) {
      result.events =
        eventStore.kind === "jetstream"
          ? await createJetStreamEventStoreImplementation<Event>(eventStore)
          : createSqliteEventStoreImplementation<Event>(database!, closeDatabase);
    }
    if (requested.has("executionContext")) {
      result.executionContext = createNodeExecutionContext();
    }
    if (requested.has("identifiers")) result.identifiers = { create: () => randomUUID() };
    if (requested.has("synchronization")) {
      result.synchronization = createNodeSynchronization();
    }
    if (requested.has("calendar")) result.calendar = createNodeCalendar();
    if (requested.has("clock")) result.clock = { now: () => Date.now() };
    if (requested.has("timer")) {
      result.timer = {
        async sleep({ input: { until } }) {
          const delay = Math.max(0, until - Date.now());
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        },
      };
    }
    if (requested.has("telemetry")) {
      result.telemetry = {
        record() {},
      };
    }
    if (requested.has("http")) {
      result.http = await createNodeHttpServer({
        host,
        port,
        origin,
        shutdownTimeout:
          input.shutdownTimeout ?? durationEnvironment("KIT_HTTP_SHUTDOWN_TIMEOUT_MS") ?? 10_000,
        allowedOrigins,
      });
    }
    const dependencies = conformExternalDependencies(input.dependencies, result);
    if (providerBindings.size) {
      featureProviderScopes.set(dependencies, {
        bindings: providerBindings,
        context: providerContext,
      });
    }
    return dependencies;
  } catch (error) {
    result.alarm?.[Symbol.dispose]();
    await result.http?.[Symbol.asyncDispose]();
    await disposeHostedEventStore(result.events);
    await disposeResources(
      Object.entries(result)
        .filter(([name]) => !available.includes(name as NodeHostDependency))
        .map(([, value]) => value),
    );
    closeDatabase();
    throw error;
  }
}

async function realizeNodeFeatureProvider(
  provider: ServerDependencyProvider<DependencyContract>,
  context: NodeFeatureProviderContext,
): Promise<object & AsyncDisposable> {
  const resources: Array<Disposable | AsyncDisposable> = [];
  try {
    const implementation = await provider.development({
      appName: context.appName,
      configuration: resolveProviderConfiguration(
        provider,
        { configuration: context.configuration },
        context.directory,
      ),
      origin: context.origin,
      allowedOrigins: context.allowedOrigins,
      sqlite(path) {
        const resolved =
          path === ":memory:" || isAbsolute(path) ? path : resolve(context.directory, path);
        if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true });
        const resource = new DatabaseSync(resolved);
        resources.push(resource);
        return resource;
      },
    });
    return ownProviderResources(implementation, resources);
  } catch (error) {
    await disposeResources(resources);
    throw error;
  }
}

function resolveProviderConfiguration(
  provider: ServerDependencyProvider<DependencyContract>,
  input: NodeHostOptions,
  directory: string,
): Readonly<Record<string, string>> {
  const configuration: Record<string, string> = {};
  for (const field of provider.production.configuration) {
    let value =
      input.configuration?.[field.name] ?? process.env[field.environment] ?? field.default;
    if (value === undefined) {
      if (field.required) {
        throw new Error(
          `Server provider configuration ${JSON.stringify(field.name)} requires ` +
            `${field.environment}.`,
        );
      }
      continue;
    }
    if (field.allocation?.kind === "storage" && value !== ":memory:" && !isAbsolute(value)) {
      value = resolve(directory, value);
    }
    configuration[field.name] = value;
  }
  return Object.freeze(configuration);
}

function ownProviderResources(
  implementation: object,
  resources: readonly (Disposable | AsyncDisposable)[],
): object & AsyncDisposable {
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await disposeResources([implementation, ...resources]);
  };
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      return property === Symbol.asyncDispose
        ? dispose
        : Reflect.get(implementation, property, implementation);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === Symbol.asyncDispose) {
        return { configurable: true, enumerable: false, value: dispose, writable: false };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(implementation, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(implementation),
    has: (_target, property) =>
      property === Symbol.asyncDispose || Reflect.has(implementation, property),
    ownKeys: () => [
      ...new Set<string | symbol>([...Reflect.ownKeys(implementation), Symbol.asyncDispose]),
    ],
  }) as object & AsyncDisposable;
}

async function disposeResources(values: readonly unknown[]): Promise<void> {
  const failures: unknown[] = [];
  for (const value of [...new Set(values)].reverse()) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) continue;
    const resource = value as Partial<Disposable & AsyncDisposable>;
    try {
      const disposeAsync = resource[Symbol.asyncDispose];
      const dispose = resource[Symbol.dispose];
      if (typeof disposeAsync === "function") {
        await disposeAsync.call(resource);
      } else if (typeof dispose === "function") {
        dispose.call(resource);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Server provider disposal failed.");
}

function createNodeExecutionContext(): DependencyImplementation<ExecutionContext> {
  const storage = new AsyncLocalStorage<readonly object[]>();
  return Object.freeze({
    current() {
      return storage.getStore() ?? [];
    },
    async run({ input: { scope, task } }) {
      const current = storage.getStore() ?? [];
      return await storage.run([...current, scope], task);
    },
  });
}

function createNodeSynchronization(): DependencyImplementation<Synchronization> {
  const tails = new Map<string, Promise<void>>();
  return Object.freeze({
    async exclusive({ input: { key, task } }) {
      const previous = tails.get(key) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      tails.set(key, tail);
      await previous;
      try {
        return await task();
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  });
}

type NormalizedCalendar = Readonly<{
  second: readonly number[];
  minute: readonly number[];
  hour: readonly number[];
  dayOfMonth: readonly number[];
  month: readonly number[];
  year: readonly number[];
  dayOfWeek: readonly number[];
}>;

type CivilDateTime = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

const calendarMonths: Readonly<Record<string, number>> = Object.freeze({
  JAN: 1,
  JANUARY: 1,
  FEB: 2,
  FEBRUARY: 2,
  MAR: 3,
  MARCH: 3,
  APR: 4,
  APRIL: 4,
  MAY: 5,
  JUN: 6,
  JUNE: 6,
  JUL: 7,
  JULY: 7,
  AUG: 8,
  AUGUST: 8,
  SEP: 9,
  SEPTEMBER: 9,
  OCT: 10,
  OCTOBER: 10,
  NOV: 11,
  NOVEMBER: 11,
  DEC: 12,
  DECEMBER: 12,
});
const calendarWeekdays: Readonly<Record<string, number>> = Object.freeze({
  SUN: 0,
  SUNDAY: 0,
  MON: 1,
  MONDAY: 1,
  TUE: 2,
  TUESDAY: 2,
  WED: 3,
  WEDNESDAY: 3,
  THU: 4,
  THURSDAY: 4,
  FRI: 5,
  FRIDAY: 5,
  SAT: 6,
  SATURDAY: 6,
});
const civilFormatters = new Map<string, Intl.DateTimeFormat>();

function createNodeCalendar(): DependencyImplementation<Calendar> {
  return Object.freeze({
    async next({ input: { after, through, timeZone, pattern } }) {
      if (!Number.isSafeInteger(after) || !Number.isSafeInteger(through) || through < after) {
        throw new TypeError("Calendar bounds must be ordered integer milliseconds.");
      }
      if (!timeZone) throw new TypeError("Calendar timeZone must be non-empty.");
      const hasCron = Object.hasOwn(pattern, "cron");
      const hasCalendar = Object.hasOwn(pattern, "calendar");
      if (hasCron === hasCalendar) {
        throw new TypeError("Calendar pattern must contain exactly one of calendar or cron.");
      }
      if (hasCron) {
        const cron = parseCalendarCron((pattern as Readonly<{ cron: string }>).cron);
        const zone = cron.timeZone ?? timeZone;
        const at = nextCalendarMatch(cron.calendar, zone, after, through);
        return at === undefined ? undefined : { at };
      }
      const at = nextCalendarMatch(
        normalizeCalendar((pattern as Readonly<{ calendar: CalendarPattern }>).calendar),
        timeZone,
        after,
        through,
      );
      return at === undefined ? undefined : { at };
    },
  });
}

function nextCalendarMatch(
  calendar: NormalizedCalendar,
  timeZone: string,
  after: number,
  through: number,
): number | undefined {
  const formatter = civilFormatter(timeZone);
  const start = civilDateTime(formatter, after);
  const finish = civilDateTime(formatter, through);
  let date = Date.UTC(start.year, start.month - 1, start.day);
  const finalDate = Date.UTC(finish.year, finish.month - 1, finish.day) + 86_400_000;
  let searched = 0;
  while (date <= finalDate && searched++ < 146_400) {
    const candidateDate = new Date(date);
    const year = candidateDate.getUTCFullYear();
    const month = candidateDate.getUTCMonth() + 1;
    const day = candidateDate.getUTCDate();
    const weekday = candidateDate.getUTCDay();
    if (
      calendar.year.includes(year) &&
      calendar.month.includes(month) &&
      calendar.dayOfMonth.includes(day) &&
      calendar.dayOfWeek.includes(weekday)
    ) {
      const sameDate = year === start.year && month === start.month && day === start.day;
      let best: number | undefined;
      for (const hour of calendar.hour) {
        if (sameDate && hour < start.hour) continue;
        for (const minute of calendar.minute) {
          if (sameDate && hour === start.hour && minute < start.minute) continue;
          for (const second of calendar.second) {
            if (
              sameDate &&
              hour === start.hour &&
              minute === start.minute &&
              second < start.second
            ) {
              continue;
            }
            for (const instant of resolveCivilDateTime(formatter, timeZone, {
              year,
              month,
              day,
              hour,
              minute,
              second,
            })) {
              if (instant > after && instant <= through && (best === undefined || instant < best)) {
                best = instant;
              }
            }
            if (best !== undefined) break;
          }
          if (best !== undefined) break;
        }
        if (best !== undefined) break;
      }
      if (best !== undefined) return best;
    }
    date += 86_400_000;
  }
  if (date <= finalDate) {
    throw new RangeError("Calendar search exceeds four hundred years.");
  }
  return undefined;
}

function civilFormatter(timeZone: string): Intl.DateTimeFormat {
  const retained = civilFormatters.get(timeZone);
  if (retained !== undefined) return retained;
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatter.format(0);
  civilFormatters.set(timeZone, formatter);
  return formatter;
}

function civilDateTime(formatter: Intl.DateTimeFormat, instant: number): CivilDateTime {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values[part.type] = Number(part.value);
    }
  }
  if (
    values.year === undefined ||
    values.month === undefined ||
    values.day === undefined ||
    values.hour === undefined ||
    values.minute === undefined ||
    values.second === undefined
  ) {
    throw new TypeError("Calendar provider could not resolve civil time.");
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function resolveCivilDateTime(
  formatter: Intl.DateTimeFormat,
  timeZone: string,
  value: CivilDateTime,
): readonly number[] {
  const naive = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
  );
  if (!Number.isFinite(naive)) return [];
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return [naive];
  const offsets = new Set<number>();
  for (const distance of [-172_800_000, -86_400_000, 0, 86_400_000, 172_800_000]) {
    const sampled = naive + distance;
    const local = civilDateTime(formatter, sampled);
    offsets.add(
      Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
        sampled,
    );
  }
  const matches = new Set<number>();
  for (const offset of offsets) {
    const instant = naive - offset;
    if (sameCivilDateTime(civilDateTime(formatter, instant), value)) matches.add(instant);
  }
  return [...matches].sort((left, right) => left - right);
}

function sameCivilDateTime(left: CivilDateTime, right: CivilDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function normalizeCalendar(pattern: CalendarPattern): NormalizedCalendar {
  return {
    second: calendarField(pattern.second, 0, 59, undefined, [0]),
    minute: calendarField(pattern.minute, 0, 59, undefined, [0]),
    hour: calendarField(pattern.hour, 0, 23, undefined, [0]),
    dayOfMonth: calendarField(pattern.dayOfMonth, 1, 31),
    month: calendarField(pattern.month, 1, 12, calendarMonths),
    year: calendarField(pattern.year, 1, 9_999),
    dayOfWeek: calendarField(pattern.dayOfWeek, 0, 6, calendarWeekdays, undefined, true),
  };
}

function calendarField(
  field: CalendarField | undefined,
  minimum: number,
  maximum: number,
  aliases?: Readonly<Record<string, number>>,
  defaults?: readonly number[],
  sundayAlias = false,
): readonly number[] {
  if (field === undefined && defaults !== undefined) return defaults;
  if (field === undefined || field === "*") return integerRange(minimum, maximum, 1);
  const values = Array.isArray(field) ? field : [field];
  const selected = new Set<number>();
  for (const candidate of values) {
    const range =
      candidate && typeof candidate === "object"
        ? (candidate as CalendarRange)
        : { start: candidate as number | string };
    let start = calendarUnit(range.start, aliases);
    let end = range.end === undefined ? start : calendarUnit(range.end, aliases);
    const step = range.step ?? 1;
    if (!Number.isSafeInteger(step) || step < 1) {
      throw new TypeError("Calendar field step must be a positive integer.");
    }
    const allowedMaximum = sundayAlias ? maximum + 1 : maximum;
    if (start < minimum || end > allowedMaximum || end < start) {
      throw new RangeError(`Calendar field must be between ${minimum} and ${maximum}.`);
    }
    for (; start <= end; start += step) {
      selected.add(sundayAlias && start === 7 ? 0 : start);
    }
  }
  if (selected.size === 0) throw new TypeError("Calendar field cannot be empty.");
  return [...selected].sort((left, right) => left - right);
}

function calendarUnit(
  value: number | string,
  aliases: Readonly<Record<string, number>> | undefined,
): number {
  const named = typeof value === "string" ? aliases?.[value.toUpperCase()] : undefined;
  const parsed = named ?? (typeof value === "string" ? Number(value) : value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`Invalid calendar field value ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function integerRange(start: number, end: number, step: number): readonly number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

function parseCalendarCron(expression: string): Readonly<{
  timeZone?: string;
  calendar: NormalizedCalendar;
}> {
  let source = expression.split("#", 1)[0]?.trim() ?? "";
  if (!source) throw new TypeError("Cron expression must be non-empty.");
  let timeZone: string | undefined;
  const zone = /^(?:CRON_TZ|TZ)=([^\s]+)\s+/.exec(source);
  if (zone !== null) {
    timeZone = zone[1];
    source = source.slice(zone[0].length).trim();
  }
  const shorthand: Readonly<Record<string, string>> = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
  };
  source = shorthand[source.toLowerCase()] ?? source;
  const fields = source.split(/\s+/);
  const expanded =
    fields.length === 5 ? ["0", ...fields, "*"] : fields.length === 6 ? ["0", ...fields] : fields;
  if (expanded.length !== 7) {
    throw new TypeError("Cron must contain five, six, or seven fields.");
  }
  return {
    ...(timeZone === undefined ? {} : { timeZone }),
    calendar: {
      second: parseCronField(expanded[0]!, 0, 59),
      minute: parseCronField(expanded[1]!, 0, 59),
      hour: parseCronField(expanded[2]!, 0, 23),
      dayOfMonth: parseCronField(expanded[3]!, 1, 31),
      month: parseCronField(expanded[4]!, 1, 12, calendarMonths),
      dayOfWeek: parseCronField(expanded[5]!, 0, 6, calendarWeekdays, true),
      year: parseCronField(expanded[6]!, 1, 9_999),
    },
  };
}

function parseCronField(
  source: string,
  minimum: number,
  maximum: number,
  aliases?: Readonly<Record<string, number>>,
  sundayAlias = false,
): readonly number[] {
  const values = new Set<number>();
  for (const segment of source.split(",")) {
    const [base, stepSource, extra] = segment.split("/");
    if (!base || extra !== undefined) throw new TypeError(`Invalid cron field ${source}.`);
    const step = stepSource === undefined ? 1 : Number(stepSource);
    if (!Number.isSafeInteger(step) || step < 1) {
      throw new TypeError("Cron field step must be a positive integer.");
    }
    let start: number;
    let end: number;
    if (base === "*") {
      start = minimum;
      end = maximum;
    } else {
      const range = base.split("-");
      if (range.length > 2 || !range[0]) throw new TypeError(`Invalid cron field ${source}.`);
      start = calendarUnit(range[0], aliases);
      end = range[1] === undefined ? start : calendarUnit(range[1], aliases);
    }
    const allowedMaximum = sundayAlias ? maximum + 1 : maximum;
    if (start < minimum || end > allowedMaximum || end < start) {
      throw new RangeError(`Cron field must be between ${minimum} and ${maximum}.`);
    }
    for (let value = start; value <= end; value += step) {
      values.add(sundayAlias && value === 7 ? 0 : value);
    }
  }
  if (values.size === 0) throw new TypeError("Cron field cannot be empty.");
  return [...values].sort((left, right) => left - right);
}

function createNodeAlarm(): NodeAlarmImplementation {
  type Scheduled = {
    id: string;
    at: number;
    readyAt: number;
    attempt: number;
    generation: number;
    target: ScheduledDependencyTarget;
    cancellation: ReturnType<typeof createDependencyCancellation>;
  };
  const scheduled = new Map<string, Scheduled>();
  const active = new Map<
    string,
    Readonly<{
      generation: number;
      cancellation: ReturnType<typeof createDependencyCancellation>;
    }>
  >();
  const dispatchers = new Set<(delivery: AlarmDelivery) => Promise<void>>();
  const generations = new Map<string, number>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let disposed = false;
  const arm = (): void => {
    if (disposed || running) return;
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    let next: number | undefined;
    for (const entry of scheduled.values()) {
      if (active.has(entry.id)) continue;
      if (next === undefined || entry.readyAt < next) next = entry.readyAt;
    }
    if (next === undefined) return;
    timeout = setTimeout(
      () => {
        timeout = undefined;
        dispatchDue();
      },
      Math.min(2_147_483_647, Math.max(0, next - Date.now())),
    );
  };
  const deliver = async (entry: Scheduled): Promise<void> => {
    let delivered = false;
    try {
      for (const dispatch of dispatchers) {
        try {
          await dispatch({
            id: entry.id,
            at: entry.at,
            attempt: entry.attempt,
            target: entry.target,
            cancellation: entry.cancellation,
          });
          delivered = true;
          break;
        } catch {
          // Another bound Process may own the target; retain it for retry.
        }
      }
    } finally {
      const delivery = active.get(entry.id);
      if (delivery?.generation === entry.generation) active.delete(entry.id);
    }
    const retained = scheduled.get(entry.id);
    if (retained?.generation === entry.generation) {
      if (delivered) scheduled.delete(entry.id);
      else entry.readyAt = Date.now() + 25;
    }
    arm();
  };
  const dispatchDue = (): void => {
    if (disposed || running) return;
    running = true;
    try {
      const now = Date.now();
      const due = [...scheduled.values()]
        .filter(({ id, readyAt }) => readyAt <= now && !active.has(id))
        .sort((left, right) => left.readyAt - right.readyAt || left.id.localeCompare(right.id))
        .slice(0, 256);
      for (const entry of due) {
        const current = scheduled.get(entry.id);
        if (current?.generation !== entry.generation) continue;
        entry.attempt += 1;
        active.set(entry.id, {
          generation: entry.generation,
          cancellation: entry.cancellation,
        });
        void deliver(entry);
      }
    } finally {
      running = false;
      arm();
    }
  };
  return {
    bind(dispatch) {
      if (disposed) throw new Error("The Alarm Dependency is disposed.");
      dispatchers.add(dispatch);
      arm();
      return {
        [Symbol.dispose]() {
          dispatchers.delete(dispatch);
        },
      };
    },
    async schedule({ input: { id, at, target } }) {
      if (disposed) throw new Error("The Alarm Dependency is disposed.");
      if (!id || !Number.isFinite(at) || !target.dependency || !target.operation) {
        throw new TypeError("Alarm id, time, Dependency, and operation are required.");
      }
      const generation = (generations.get(id) ?? 0) + 1;
      generations.set(id, generation);
      scheduled.set(id, {
        id,
        at,
        readyAt: at,
        attempt: 0,
        generation,
        target: cloneData(target, `Alarm ${id} target`),
        cancellation: createDependencyCancellation(),
      });
      arm();
    },
    async cancel({ input: { id } }) {
      active.get(id)?.cancellation.request();
      scheduled.get(id)?.cancellation.request();
      scheduled.delete(id);
      generations.set(id, (generations.get(id) ?? 0) + 1);
      arm();
    },
    async requestCancellation({ input: { id } }) {
      active.get(id)?.cancellation.request();
      scheduled.get(id)?.cancellation.request();
    },
    [Symbol.dispose]() {
      if (disposed) return;
      disposed = true;
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
      for (const delivery of active.values()) delivery.cancellation.request();
      for (const entry of scheduled.values()) entry.cancellation.request();
      active.clear();
      scheduled.clear();
      dispatchers.clear();
    },
  };
}

function numberEnvironment(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new TypeError(`${name} must be an integer between 0 and 65535.`);
  }
  return parsed;
}

function durationEnvironment(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function resolveEventStore(input: NodeHostOptions): NodeEventStoreOptions {
  if (input.eventStore) return input.eventStore;
  const servers = process.env.NATS_URL;
  return process.env.KIT_EVENT_STORE === "jetstream" && servers
    ? { kind: "jetstream", servers, stream: process.env.KIT_EVENT_STREAM }
    : { kind: "sqlite" };
}

async function disposeHostedEventStore<Event>(
  store: HostedEventStore<Event> | undefined,
): Promise<void> {
  if (!store) return;
  if (Symbol.asyncDispose in store) await store[Symbol.asyncDispose]();
  else store[Symbol.dispose]();
}

/** Creates a direct development client over the SQLite EventStore provider. */
export function createSqliteEventStore<Event>(
  database: DatabaseSync,
  close: () => void = () => undefined,
): EventStore<Event> & Disposable {
  const implementation = createSqliteEventStoreImplementation<Event>(database, close);
  return {
    ...eventStoreClient(implementation),
    [Symbol.dispose]: () => implementation[Symbol.dispose](),
  };
}

/** Creates a direct development client over the JetStream EventStore provider. */
export async function createJetStreamEventStore<Event>(
  options: Extract<NodeEventStoreOptions, { kind: "jetstream" }>,
): Promise<EventStore<Event> & AsyncDisposable> {
  const implementation = await createJetStreamEventStoreImplementation<Event>(options);
  return {
    ...eventStoreClient(implementation),
    [Symbol.asyncDispose]: async () => await implementation[Symbol.asyncDispose](),
  };
}

function eventStoreClient<Event>(
  implementation: DependencyImplementation<EventStore<Event>>,
): EventStore<Event> {
  return Object.freeze({
    read: async (input) =>
      await implementation.read({ input, invocation: directProviderInvocation() }),
    scan: async (input) =>
      await implementation.scan({ input, invocation: directProviderInvocation() }),
    append: async (input) =>
      await implementation.append({ input, invocation: directProviderInvocation() }),
    subscribe: (input) =>
      implementation.subscribe({ input, invocation: directProviderInvocation() }),
    loadSnapshot: async (input) =>
      await implementation.loadSnapshot({ input, invocation: directProviderInvocation() }),
    saveSnapshot: async (input) =>
      await implementation.saveSnapshot({ input, invocation: directProviderInvocation() }),
    compact: async (input) =>
      await implementation.compact({ input, invocation: directProviderInvocation() }),
  });
}

let directProviderInvocationId = 0;

function directProviderInvocation(): DependencyProviderInvocation {
  const now = Date.now();
  return {
    id: `development:event-store:${++directProviderInvocationId}`,
    attempt: 1,
    scheduledAt: now,
    startedAt: now,
    async heartbeat() {},
    cancellation: {
      requested: () => false,
      wait: () => new Promise<void>(() => undefined),
    },
    fail(failure): never {
      throw new Error(`EventStore provider failed: ${String(failure)}`);
    },
  };
}

function createSqliteEventStoreImplementation<Event>(
  database: DatabaseSync,
  close: () => void = () => undefined,
): SqliteEventStore<Event> {
  migrateSqliteEventStore(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS kit_events (
      position INTEGER PRIMARY KEY AUTOINCREMENT,
      stream TEXT NOT NULL,
      revision INTEGER NOT NULL,
      event TEXT NOT NULL,
      UNIQUE (stream, revision)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS kit_event_streams (
      stream TEXT PRIMARY KEY,
      revision INTEGER NOT NULL
    ) STRICT;
    INSERT OR IGNORE INTO kit_event_streams (stream, revision)
      SELECT stream, MAX(revision) FROM kit_events GROUP BY stream;
    CREATE TABLE IF NOT EXISTS kit_event_snapshots (
      stream TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    ) STRICT
  `);
  const read = database.prepare(
    "SELECT revision, event FROM kit_events WHERE stream = ? AND revision > ? ORDER BY revision LIMIT ?",
  );
  const scan = database.prepare(
    "SELECT position, stream, revision, event FROM kit_events WHERE position > ? ORDER BY position LIMIT ?",
  );
  const revision = database.prepare(
    "SELECT COALESCE((SELECT revision FROM kit_event_streams WHERE stream = ?), 0) AS revision",
  );
  const insert = database.prepare(
    "INSERT INTO kit_events (stream, revision, event) VALUES (?, ?, ?)",
  );
  const advance = database.prepare(
    `INSERT INTO kit_event_streams (stream, revision) VALUES (?, ?)
     ON CONFLICT(stream) DO UPDATE SET revision = excluded.revision`,
  );
  const snapshot = database.prepare(
    "SELECT revision, snapshot FROM kit_event_snapshots WHERE stream = ?",
  );
  const saveSnapshot = database.prepare(
    `INSERT INTO kit_event_snapshots (stream, revision, snapshot) VALUES (?, ?, ?)
     ON CONFLICT(stream) DO UPDATE SET
       revision = excluded.revision,
       snapshot = excluded.snapshot`,
  );
  const compact = database.prepare("DELETE FROM kit_events WHERE stream = ? AND revision <= ?");
  const subscribers = new Map<string, Set<(event: StoredEvent<Event>) => void>>();
  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new Error("The event store is disposed.");
  };
  const readEvents = (
    stream: string,
    after: number,
    limit: number,
  ): readonly StoredEvent<Event>[] => {
    assertLive();
    return (read.all(stream, after, limit) as Array<{ revision: number; event: string }>).map(
      (row) => ({
        stream,
        revision: row.revision,
        event: JSON.parse(row.event) as Event,
      }),
    );
  };

  return {
    read: async ({ input: { stream, after = 0, limit = Number.MAX_SAFE_INTEGER } }) =>
      readEvents(stream, after, limit),
    async scan({ input: { after, limit = Number.MAX_SAFE_INTEGER } }) {
      assertLive();
      const position = sqliteEventCursor(after);
      return (
        scan.all(position, limit) as Array<{
          position: number;
          stream: string;
          revision: number;
          event: string;
        }>
      ).map((row) => ({
        cursor: String(row.position),
        stream: row.stream,
        revision: row.revision,
        event: JSON.parse(row.event) as Event,
      }));
    },
    async append({ input: { stream, expectedRevision, events } }) {
      assertLive();
      database.exec("BEGIN IMMEDIATE");
      try {
        const row = revision.get(stream) as { revision: number };
        if (row.revision !== expectedRevision) {
          database.exec("ROLLBACK");
          return undefined;
        }
        const appended = events.map((event, index) => {
          const stored = {
            stream,
            revision: expectedRevision + index + 1,
            event: cloneData(event, "EventStore event"),
          };
          insert.run(stream, stored.revision, JSON.stringify(stored.event));
          return stored;
        });
        advance.run(stream, expectedRevision + appended.length);
        database.exec("COMMIT");
        for (const event of appended) {
          for (const publish of subscribers.get(stream) ?? []) publish(event);
        }
        return appended;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    subscribe({ input: { stream, after = 0 } }) {
      return eventStream(readEvents(stream, after, Number.MAX_SAFE_INTEGER), subscribers, stream);
    },
    async loadSnapshot({ input: { stream } }) {
      assertLive();
      const row = snapshot.get(stream) as { revision: number; snapshot: string } | undefined;
      return row
        ? {
            stream,
            revision: row.revision,
            snapshot: JSON.parse(row.snapshot) as object,
          }
        : undefined;
    },
    async saveSnapshot({
      input: { stream, expectedRevision, revision: snapshotRevision, snapshot: value },
    }) {
      assertLive();
      database.exec("BEGIN IMMEDIATE");
      try {
        const head = revision.get(stream) as { revision: number };
        const current = snapshot.get(stream) as { revision: number } | undefined;
        if ((current?.revision ?? 0) !== expectedRevision || snapshotRevision > head.revision) {
          database.exec("ROLLBACK");
          return false;
        }
        saveSnapshot.run(
          stream,
          snapshotRevision,
          JSON.stringify(cloneData(value, "EventStore snapshot")),
        );
        database.exec("COMMIT");
        return true;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    async compact({ input: { stream, through } }) {
      assertLive();
      if (through === 0) return;
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = snapshot.get(stream) as { revision: number } | undefined;
        if ((current?.revision ?? 0) < through) {
          throw new Error(`EventStore stream ${JSON.stringify(stream)} has no safe snapshot.`);
        }
        compact.run(stream, through);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    [Symbol.dispose]() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      close();
    },
  };
}

function migrateSqliteEventStore(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(kit_events)")
    .all() as unknown as readonly Readonly<{ name: string }>[];
  if (columns.length === 0 || columns.some(({ name }) => name === "position")) return;
  database.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE kit_events RENAME TO kit_events_without_position;
    CREATE TABLE kit_events (
      position INTEGER PRIMARY KEY AUTOINCREMENT,
      stream TEXT NOT NULL,
      revision INTEGER NOT NULL,
      event TEXT NOT NULL,
      UNIQUE (stream, revision)
    ) STRICT;
    INSERT INTO kit_events (stream, revision, event)
      SELECT stream, revision, event
      FROM kit_events_without_position
      ORDER BY rowid;
    DROP TABLE kit_events_without_position;
    COMMIT
  `);
}

function sqliteEventCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const position = Number(cursor);
  if (!Number.isSafeInteger(position) || position < 0 || String(position) !== cursor) {
    throw new TypeError("SQLite EventStore cursor is invalid.");
  }
  return position;
}

type JetStreamBatch<Event> = Readonly<{
  stream: string;
  expectedRevision: number;
  events: readonly Event[];
}>;

type JetStreamSnapshot<Snapshot> = Readonly<{
  stream: string;
  revision: number;
  snapshot: Snapshot;
}>;

/** Network authority for the semantic EventStore contract; Features remain transport-agnostic. */
async function createJetStreamEventStoreImplementation<Event>(
  options: Extract<NodeEventStoreOptions, { kind: "jetstream" }>,
): Promise<JetStreamEventStore<Event>> {
  const connection = await connect({
    servers: typeof options.servers === "string" ? options.servers : [...options.servers],
  });
  const streamName = options.stream ?? "KIT_EVENTS";
  const prefix = "kit.events";
  let manager: JetStreamManager;
  try {
    manager = await jetstreamManager(connection);
    await ensureEventStream(manager, streamName, prefix);
  } catch (error) {
    await connection.close();
    throw error;
  }
  const client = jetstream(connection);
  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new Error("The event store is disposed.");
  };

  return {
    async read({ input: { stream, after = 0, limit = Number.MAX_SAFE_INTEGER } }) {
      assertLive();
      return readJetStreamEvents<Event>(
        client,
        streamName,
        eventSubject(prefix, stream),
        stream,
        after,
        limit,
      );
    },
    async scan({ input: { after, limit = Number.MAX_SAFE_INTEGER } }) {
      assertLive();
      return scanJetStreamEvents<Event>(client, streamName, `${prefix}.*`, after, limit);
    },
    async append({ input: { stream, expectedRevision, events } }) {
      assertLive();
      const subject = eventSubject(prefix, stream);
      const current = await lastJetStreamBatch<Event>(manager, streamName, subject);
      const snapshot = await lastJetStreamSnapshot<object>(
        manager,
        streamName,
        snapshotSubject(prefix, stream),
      );
      if (
        Math.max(batchRevision(current?.batch), snapshot?.snapshot.revision ?? 0) !==
        expectedRevision
      ) {
        return undefined;
      }
      if (events.length === 0) return [];
      const storedEvents = events.map((event) => cloneData(event, "EventStore event"));
      try {
        await client.publish(
          subject,
          new TextEncoder().encode(
            JSON.stringify({ stream, expectedRevision, events: storedEvents }),
          ),
          { expect: { lastSubjectSequence: current?.sequence ?? 0 } },
        );
      } catch (error) {
        if (
          error instanceof JetStreamApiError &&
          (error.code === JetStreamApiCodes.StreamWrongLastSequence ||
            error.code === JetStreamApiCodes.StreamWrongLastSequenceUnknown)
        ) {
          return undefined;
        }
        throw error;
      }
      return storedBatch(stream, expectedRevision, storedEvents);
    },
    subscribe({ input: { stream, after = 0 } }) {
      assertLive();
      return subscribeJetStreamEvents<Event>(
        client,
        streamName,
        eventSubject(prefix, stream),
        stream,
        after,
      );
    },
    async loadSnapshot({ input: { stream } }) {
      assertLive();
      const stored = await lastJetStreamSnapshot<object>(
        manager,
        streamName,
        snapshotSubject(prefix, stream),
      );
      return stored?.snapshot;
    },
    async saveSnapshot({ input: { stream, expectedRevision, revision, snapshot } }) {
      assertLive();
      const event = eventSubject(prefix, stream);
      const snapshotName = snapshotSubject(prefix, stream);
      const currentSnapshot = await lastJetStreamSnapshot<object>(
        manager,
        streamName,
        snapshotName,
      );
      if ((currentSnapshot?.snapshot.revision ?? 0) !== expectedRevision) return false;
      const currentBatch = await lastJetStreamBatch<Event>(manager, streamName, event);
      const head = Math.max(
        batchRevision(currentBatch?.batch),
        currentSnapshot?.snapshot.revision ?? 0,
      );
      if (revision > head) return false;
      const value: JetStreamSnapshot<object> = {
        stream,
        revision,
        snapshot: cloneData(snapshot, "EventStore snapshot"),
      };
      try {
        await client.publish(snapshotName, new TextEncoder().encode(JSON.stringify(value)), {
          expect: { lastSubjectSequence: currentSnapshot?.sequence ?? 0 },
        });
      } catch (error) {
        if (
          error instanceof JetStreamApiError &&
          (error.code === JetStreamApiCodes.StreamWrongLastSequence ||
            error.code === JetStreamApiCodes.StreamWrongLastSequenceUnknown)
        ) {
          return false;
        }
        throw error;
      }
      await manager.streams.purge(streamName, { filter: snapshotName, keep: 1 });
      return true;
    },
    async compact({ input: { stream, through } }) {
      assertLive();
      if (through === 0) return;
      const snapshotName = snapshotSubject(prefix, stream);
      const stored = await lastJetStreamSnapshot<object>(manager, streamName, snapshotName);
      if ((stored?.snapshot.revision ?? 0) < through) {
        throw new Error(`EventStore stream ${JSON.stringify(stream)} has no safe snapshot.`);
      }
      const subject = eventSubject(prefix, stream);
      const sequence = await jetStreamSequenceThrough(client, streamName, subject, stream, through);
      if (sequence !== undefined) {
        await manager.streams.purge(streamName, { filter: subject, seq: sequence + 1 });
      }
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await connection.drain();
    },
  };
}

async function lastJetStreamSnapshot<Snapshot>(
  manager: JetStreamManager,
  stream: string,
  subject: string,
): Promise<Readonly<{ sequence: number; snapshot: JetStreamSnapshot<Snapshot> }> | undefined> {
  let message: StoredMsg | null;
  try {
    message = await manager.streams.getMessage(stream, { last_by_subj: subject });
  } catch (error) {
    if (error instanceof JetStreamApiError && error.code === JetStreamApiCodes.NoMessageFound) {
      return;
    }
    throw error;
  }
  return message
    ? { sequence: message.seq, snapshot: decodeSnapshot<Snapshot>(message.data) }
    : undefined;
}

async function jetStreamSequenceThrough(
  client: JetStreamClient,
  streamName: string,
  subject: string,
  stream: string,
  through: number,
): Promise<number | undefined> {
  const consumer = await client.consumers.get(streamName, {
    filter_subjects: subject,
    deliver_policy: DeliverPolicy.All,
  });
  let sequence: number | undefined;
  try {
    let pending = (await consumer.info()).num_pending;
    while (pending > 0) {
      const messages = await consumer.fetch({
        max_messages: Math.min(pending, 1_000),
        expires: 1_000,
      });
      let received = 0;
      for await (const message of messages) {
        received += 1;
        const batch = decodeBatch<unknown>(message.data);
        if (batch.stream !== stream) {
          throw new TypeError("JetStream EventStore stream identity mismatch.");
        }
        if (batchRevision(batch) <= through) sequence = message.info.streamSequence;
      }
      if (!received) throw new Error(`JetStream EventStore timed out while compacting ${stream}.`);
      pending -= received;
    }
    return sequence;
  } finally {
    await consumer.delete();
  }
}

async function ensureEventStream(
  manager: JetStreamManager,
  stream: string,
  prefix: string,
): Promise<void> {
  const subject = `${prefix}.>`;
  try {
    const current = await manager.streams.info(stream);
    validateEventStream(current.config, stream, subject);
    return;
  } catch (error) {
    if (!(error instanceof JetStreamApiError) || error.code !== JetStreamApiCodes.StreamNotFound) {
      throw error;
    }
  }
  try {
    await manager.streams.add({
      name: stream,
      subjects: [subject],
      retention: RetentionPolicy.Limits,
      discard: DiscardPolicy.Old,
      storage: StorageType.File,
      allow_direct: true,
    });
  } catch (error) {
    const current = await manager.streams.info(stream).catch(() => undefined);
    if (!current) throw error;
    validateEventStream(current.config, stream, subject);
  }
}

function validateEventStream(
  config: Readonly<{
    subjects: readonly string[];
    retention: RetentionPolicy;
    discard: DiscardPolicy;
    storage: StorageType;
  }>,
  stream: string,
  subject: string,
): void {
  if (
    !config.subjects.includes(subject) ||
    config.retention !== RetentionPolicy.Limits ||
    config.discard !== DiscardPolicy.Old ||
    config.storage !== StorageType.File
  ) {
    throw new TypeError(
      `JetStream ${JSON.stringify(stream)} does not match the EventStore contract.`,
    );
  }
}

async function lastJetStreamBatch<Event>(
  manager: JetStreamManager,
  stream: string,
  subject: string,
): Promise<Readonly<{ sequence: number; batch: JetStreamBatch<Event> }> | undefined> {
  let message: StoredMsg | null;
  try {
    message = await manager.streams.getMessage(stream, { last_by_subj: subject });
  } catch (error) {
    if (error instanceof JetStreamApiError && error.code === JetStreamApiCodes.NoMessageFound) {
      return;
    }
    throw error;
  }
  return message ? { sequence: message.seq, batch: decodeBatch<Event>(message.data) } : undefined;
}

async function readJetStreamEvents<Event>(
  client: JetStreamClient,
  streamName: string,
  subject: string,
  stream: string,
  after: number,
  limit: number,
): Promise<readonly StoredEvent<Event>[]> {
  const consumer = await client.consumers.get(streamName, {
    filter_subjects: subject,
    deliver_policy: DeliverPolicy.All,
  });
  const result: StoredEvent<Event>[] = [];
  try {
    let pending = (await consumer.info()).num_pending;
    while (pending > 0) {
      const messages = await consumer.fetch({
        max_messages: Math.min(pending, 1_000),
        expires: 1_000,
      });
      let received = 0;
      for await (const message of messages) {
        received += 1;
        appendBatch(result, decodeBatch<Event>(message.data), stream, after);
        if (result.length >= limit) break;
      }
      if (!received) throw new Error(`JetStream EventStore timed out while reading ${stream}.`);
      pending -= received;
      if (result.length >= limit) break;
    }
    return result.slice(0, limit);
  } finally {
    await consumer.delete();
  }
}

async function scanJetStreamEvents<Event>(
  client: JetStreamClient,
  streamName: string,
  subject: string,
  after: string | undefined,
  limit: number,
): Promise<readonly PositionedStoredEvent<Event>[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("JetStream EventStore scan limit must be a positive safe integer.");
  }
  const cursor = jetStreamEventCursor(after);
  const consumer = await client.consumers.get(streamName, {
    filter_subjects: subject,
    deliver_policy: DeliverPolicy.All,
  });
  const result: PositionedStoredEvent<Event>[] = [];
  try {
    let pending = (await consumer.info()).num_pending;
    while (pending > 0) {
      const messages = await consumer.fetch({
        max_messages: Math.min(pending, 1_000),
        expires: 1_000,
      });
      let received = 0;
      for await (const message of messages) {
        received += 1;
        const sequence = message.info.streamSequence;
        const batch = decodeBatch<Event>(message.data);
        const stored = storedBatch(batch.stream, batch.expectedRevision, batch.events);
        for (let index = 0; index < stored.length; index += 1) {
          if (
            sequence < cursor.sequence ||
            (sequence === cursor.sequence && index <= cursor.index)
          ) {
            continue;
          }
          result.push({
            ...stored[index]!,
            cursor: `${sequence}:${index}`,
          });
          if (result.length >= limit) return result;
        }
      }
      if (!received) throw new Error("JetStream EventStore timed out while scanning events.");
      pending -= received;
    }
    return result;
  } finally {
    await consumer.delete();
  }
}

function jetStreamEventCursor(
  cursor: string | undefined,
): Readonly<{ sequence: number; index: number }> {
  if (cursor === undefined) return { sequence: 0, index: -1 };
  const match = /^([1-9]\d*):(\d+)$/.exec(cursor);
  const sequence = Number(match?.[1]);
  const index = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(sequence) || !Number.isSafeInteger(index)) {
    throw new TypeError("JetStream EventStore cursor is invalid.");
  }
  return { sequence, index };
}

function subscribeJetStreamEvents<Event>(
  client: JetStreamClient,
  streamName: string,
  subject: string,
  stream: string,
  after: number,
): AsyncIterable<StoredEvent<Event>> {
  return {
    async *[Symbol.asyncIterator]() {
      const consumer = await client.consumers.get(streamName, {
        filter_subjects: subject,
        deliver_policy: DeliverPolicy.All,
      });
      const messages = await consumer.consume();
      let revision = after;
      try {
        for await (const message of messages) {
          const stored: StoredEvent<Event>[] = [];
          appendBatch(stored, decodeBatch<Event>(message.data), stream, revision);
          for (const event of stored) {
            if (event.revision !== revision + 1) {
              throw new Error(`JetStream EventStore observed a gap at ${stream}:${revision + 1}.`);
            }
            revision = event.revision;
            yield event;
          }
        }
      } finally {
        await messages.close();
        await consumer.delete();
      }
    },
  };
}

function decodeBatch<Event>(data: Uint8Array): JetStreamBatch<Event> {
  const value = JSON.parse(new TextDecoder().decode(data)) as Partial<JetStreamBatch<Event>>;
  if (
    typeof value.stream !== "string" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    !Array.isArray(value.events)
  ) {
    throw new TypeError("JetStream EventStore received an invalid append batch.");
  }
  return value as JetStreamBatch<Event>;
}

function decodeSnapshot<Snapshot>(data: Uint8Array): JetStreamSnapshot<Snapshot> {
  const value = JSON.parse(new TextDecoder().decode(data)) as Partial<JetStreamSnapshot<Snapshot>>;
  if (
    typeof value.stream !== "string" ||
    !Number.isSafeInteger(value.revision) ||
    value.snapshot === undefined
  ) {
    throw new TypeError("JetStream EventStore received an invalid snapshot.");
  }
  return value as JetStreamSnapshot<Snapshot>;
}

function appendBatch<Event>(
  target: StoredEvent<Event>[],
  batch: JetStreamBatch<Event>,
  stream: string,
  after: number,
): void {
  if (batch.stream !== stream)
    throw new TypeError("JetStream EventStore stream identity mismatch.");
  for (const event of storedBatch(stream, batch.expectedRevision, batch.events)) {
    if (event.revision > after) target.push(event);
  }
}

function storedBatch<Event>(
  stream: string,
  expectedRevision: number,
  events: readonly Event[],
): readonly StoredEvent<Event>[] {
  return events.map((event, index) => ({
    stream,
    revision: expectedRevision + index + 1,
    event,
  }));
}

function batchRevision(batch: JetStreamBatch<unknown> | undefined): number {
  return batch ? batch.expectedRevision + batch.events.length : 0;
}

function eventSubject(prefix: string, stream: string): string {
  return `${prefix}.${Buffer.from(stream).toString("base64url")}`;
}

function snapshotSubject(prefix: string, stream: string): string {
  return `${prefix}.snapshot.${Buffer.from(stream).toString("base64url")}`;
}

async function createNodeHttpServer(input: {
  host: string;
  port: number;
  origin: string;
  shutdownTimeout: number;
  allowedOrigins: readonly string[];
}): Promise<ReloadableHttpServer> {
  if (!Number.isSafeInteger(input.shutdownTimeout) || input.shutdownTimeout < 1) {
    throw new TypeError("HTTP shutdownTimeout must be a positive integer.");
  }
  type Route = Readonly<{ handle(request: HttpRequest): Promise<HttpResponse> }>;
  const routes = new Map<string, Route[]>();
  const allowedOrigins = new Set(input.allowedOrigins);
  const streams = new Set<ServerResponse>();
  const shutdown = new AbortController();
  let replacementScopes = 0;
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.method === "OPTIONS") {
        writeCors(incoming, outgoing, allowedOrigins);
        outgoing.writeHead(204).end();
        return;
      }
      const request = await semanticRequest(incoming, input.origin);
      const pathname = request.path;
      const route = [...routes]
        .filter(
          ([path, registrations]) =>
            registrations.length > 0 && (pathname === path || pathname.startsWith(`${path}/`)),
        )
        .sort(([left], [right]) => right.length - left.length)[0];
      const response = route
        ? await route[1].at(-1)!.handle(request)
        : jsonHttpResponse({ message: "Not found." }, 404);
      await writeResponse(incoming, outgoing, response, allowedOrigins, shutdown.signal, streams);
    } catch (error) {
      if (outgoing.headersSent) {
        outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      await writeResponse(
        incoming,
        outgoing,
        jsonHttpResponse({ message: error instanceof Error ? error.message : String(error) }, 500),
        allowedOrigins,
        shutdown.signal,
        streams,
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, resolve);
  });
  let disposed = false;
  return {
    locations: [input.origin],
    route({ input: { path, handle } }) {
      if (typeof handle !== "function") {
        throw new TypeError(`HTTP route ${JSON.stringify(path)} requires a handler function.`);
      }
      const registrations = routes.get(path) ?? [];
      if (registrations.length && replacementScopes === 0) {
        throw new Error(`HTTP route ${JSON.stringify(path)} is already mounted.`);
      }
      const registration = { handle };
      registrations.push(registration);
      routes.set(path, registrations);
      return {
        [Symbol.dispose]() {
          const current = routes.get(path);
          if (!current) return;
          const index = current.indexOf(registration);
          if (index >= 0) current.splice(index, 1);
          if (current.length === 0) routes.delete(path);
        },
      };
    },
    [beginRouteReplacement]() {
      replacementScopes++;
      let complete = false;
      return {
        [Symbol.dispose]() {
          if (complete) return;
          complete = true;
          replacementScopes--;
        },
      };
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      shutdown.abort();
      for (const stream of streams) stream.destroy();
      routes.clear();
      const closing = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      const timeout = setTimeout(() => server.closeAllConnections(), input.shutdownTimeout);
      try {
        await closing;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function eventStream<Event>(
  initial: readonly StoredEvent<Event>[],
  subscribers: Map<string, Set<(event: StoredEvent<Event>) => void>>,
  stream: string,
): AsyncIterable<StoredEvent<Event>> {
  return {
    [Symbol.asyncIterator]() {
      const queued = [...initial];
      let waiting: ((event: IteratorResult<StoredEvent<Event>>) => void) | undefined;
      let active = true;
      const publish = (event: StoredEvent<Event>) => {
        if (!active) return;
        if (waiting) {
          const resolve = waiting;
          waiting = undefined;
          resolve({ done: false, value: event });
        } else queued.push(event);
      };
      const listeners = subscribers.get(stream) ?? new Set();
      listeners.add(publish);
      subscribers.set(stream, listeners);
      return {
        next() {
          const event = queued.shift();
          if (event) return Promise.resolve({ done: false as const, value: event });
          if (!active) return Promise.resolve({ done: true as const, value: undefined });
          return new Promise<IteratorResult<StoredEvent<Event>>>((resolve) => (waiting = resolve));
        },
        return() {
          active = false;
          listeners.delete(publish);
          waiting?.({ done: true, value: undefined });
          waiting = undefined;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
}

async function semanticRequest(request: IncomingMessage, origin: string): Promise<HttpRequest> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const url = new URL(request.url ?? "/", origin);
  const headers: HttpField[] = [];
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.push({ name, value: item });
    } else if (value !== undefined) {
      headers.push({ name, value });
    }
  }
  return {
    method: request.method ?? "GET",
    path: url.pathname,
    query: [...url.searchParams].map(([name, value]) => ({ name, value })),
    headers,
    body: chunks.length ? Buffer.concat(chunks).toString("utf8") : "",
  };
}

async function writeResponse(
  request: IncomingMessage,
  response: ServerResponse,
  value: HttpResponse,
  allowedOrigins: ReadonlySet<string>,
  shutdown: AbortSignal,
  streams: Set<ServerResponse>,
): Promise<void> {
  if (!Number.isInteger(value.status) || !Array.isArray(value.headers)) {
    throw new TypeError(`HTTP handler returned an invalid response: ${JSON.stringify(value)}.`);
  }
  writeCors(request, response, allowedOrigins);
  for (const { name, value: header } of value.headers) response.appendHeader(name, header);
  response.writeHead(value.status);
  if (value.body !== undefined) {
    response.end(value.body);
    return;
  }
  if (!value.stream) {
    response.end();
    return;
  }
  const reader = value.stream[Symbol.asyncIterator]();
  const cancel = () => void reader.return?.().catch(() => undefined);
  const stop = () => {
    if (!response.closed && !response.destroyed && !response.writableEnded) response.end();
  };
  streams.add(response);
  response.once("close", cancel);
  shutdown.addEventListener("abort", stop, { once: true });
  try {
    if (shutdown.aborted) stop();
    while (!response.closed && !response.destroyed && !response.writableEnded) {
      const next = await reader.next();
      if (next.done) break;
      if (!response.write(next.value)) {
        await new Promise((resolve) => response.once("drain", resolve));
      }
    }
    if (!response.closed && !response.destroyed) response.end();
  } finally {
    streams.delete(response);
    response.off("close", cancel);
    shutdown.removeEventListener("abort", stop);
    await reader.return?.().catch(() => undefined);
  }
}

function jsonHttpResponse(value: object, status: number): HttpResponse {
  return {
    status,
    headers: [{ name: "content-type", value: "application/json" }],
    body: JSON.stringify(value),
    stream: undefined,
  };
}

function writeCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: ReadonlySet<string>,
): void {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader("access-control-allow-headers", "content-type, x-kit-command, x-kit-entity");
  response.setHeader("access-control-allow-methods", "DELETE, GET, OPTIONS, PATCH, POST");
}

function normalizeAllowedOrigins(origins: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(origins.map((origin) => new URL(origin).origin))].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
}
