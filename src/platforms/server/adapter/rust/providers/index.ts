import { resolve } from "node:path";

import {
  collectDependencyOperations,
  type DependencyIR,
  type DependencyOperationIR,
} from "@/compiler/ir";
import type { ServerProviderConfiguration, ServerProviderProduction } from "@/platforms/server";

export type ServerProductionConfiguration = ServerProviderConfiguration;

/**
 * Production implementation metadata for one semantic server Dependency.
 *
 * The API contract is intentionally absent: DependencyIR is its only source of
 * truth. This descriptor contains realization details only.
 */
export type ServerProductionDependency = ServerProviderProduction &
  Readonly<{
    name: string;
    dependency: string;
  }>;

export type ResolvedServerProductionDependency = Readonly<{
  dependency: DependencyIR;
  operations: readonly DependencyOperationIR[];
  implementation: ServerProductionDependency;
}>;

const dependencyDirectory = (name: string): string => resolve(import.meta.dirname, name);

export const alarmDependency = defineServerProductionDependency({
  name: "alarm",
  dependency: "alarm",
  configuration: [
    { name: "servers", environment: "KIT_NATS_URL" },
    { name: "stream", environment: "KIT_ALARM_STREAM", default: "KIT_ALARMS" },
    { name: "state", environment: "KIT_ALARM_STATE", default: "KIT_ALARM_STATE" },
    { name: "replicas", environment: "KIT_ALARM_REPLICAS", default: "1" },
  ],
  crate: { package: "kit-server-alarm", directory: dependencyDirectory("alarm") },
  rust: { type: "kit_server_alarm::Alarm", constructor: "kit_server_alarm::create" },
});

export const clockDependency = defineServerProductionDependency({
  name: "clock",
  dependency: "clock",
  configuration: [{ name: "offset", environment: "KIT_CLOCK_OFFSET_MS", default: "0" }],
  crate: { package: "kit-server-clock", directory: dependencyDirectory("clock") },
  rust: { type: "kit_server_clock::Clock", constructor: "kit_server_clock::create" },
});

export const executionContextDependency = defineServerProductionDependency({
  name: "execution-context",
  dependency: "executionContext",
  configuration: [],
  crate: {
    package: "kit-server-execution-context",
    directory: dependencyDirectory("execution-context"),
  },
  rust: {
    type: "kit_server_execution_context::ExecutionContext",
    constructor: "kit_server_execution_context::create",
  },
});

export const identifiersDependency = defineServerProductionDependency({
  name: "identifiers",
  dependency: "identifiers",
  configuration: [],
  crate: {
    package: "kit-server-identifiers",
    directory: dependencyDirectory("identifiers"),
  },
  rust: {
    type: "kit_server_identifiers::Identifiers",
    constructor: "kit_server_identifiers::create",
  },
});

export const synchronizationDependency = defineServerProductionDependency({
  name: "synchronization",
  dependency: "synchronization",
  configuration: [],
  crate: {
    package: "kit-server-synchronization",
    directory: dependencyDirectory("synchronization"),
  },
  rust: {
    type: "kit_server_synchronization::Synchronization",
    constructor: "kit_server_synchronization::create",
  },
});

export const telemetryDependency = defineServerProductionDependency({
  name: "telemetry",
  dependency: "telemetry",
  configuration: [
    {
      name: "file",
      environment: "KIT_TELEMETRY_FILE",
      allocation: {
        kind: "storage",
        name: "telemetry.jsonl",
        scope: "process",
        type: "file",
      },
    },
  ],
  crate: {
    package: "kit-server-telemetry",
    directory: dependencyDirectory("telemetry"),
  },
  rust: {
    type: "kit_server_telemetry::Telemetry",
    constructor: "kit_server_telemetry::create",
  },
});

export const timerDependency = defineServerProductionDependency({
  name: "timer",
  dependency: "timer",
  configuration: [],
  crate: { package: "kit-server-timer", directory: dependencyDirectory("timer") },
  rust: { type: "kit_server_timer::Timer", constructor: "kit_server_timer::create" },
});

export const eventsDependency = defineServerProductionDependency({
  name: "events-sqlite",
  dependency: "events",
  configuration: [
    {
      name: "database",
      environment: "KIT_DATABASE",
      default: ".kit/data/system.sqlite",
      allocation: {
        kind: "storage",
        name: "system.sqlite",
        scope: "deployment",
        type: "file",
      },
    },
  ],
  crate: {
    package: "kit-server-events",
    directory: dependencyDirectory("events/sqlite"),
  },
  rust: { type: "kit_server_events::Events", constructor: "kit_server_events::create" },
});

export const jetStreamEventsDependency = defineServerProductionDependency({
  ...eventsDependency,
  name: "events-jetstream",
  configuration: [
    { name: "servers", environment: "NATS_URL", default: "nats://127.0.0.1:4222" },
    { name: "stream", environment: "KIT_EVENT_STREAM", default: "KIT_EVENTS" },
  ],
  crate: {
    package: "kit-server-events-jetstream",
    directory: dependencyDirectory("events/jetstream"),
  },
  rust: {
    type: "kit_server_events_jetstream::Events",
    constructor: "kit_server_events_jetstream::create",
  },
});

export const httpDependency = defineServerProductionDependency({
  name: "http",
  dependency: "http",
  configuration: [
    { name: "host", environment: "HOST", default: "127.0.0.1" },
    {
      name: "port",
      environment: "PORT",
      default: "3010",
      allocation: { kind: "port" },
    },
    {
      name: "bodyLimit",
      environment: "KIT_HTTP_BODY_LIMIT",
      default: "1048576",
    },
    {
      name: "requestTimeout",
      environment: "KIT_HTTP_TIMEOUT_MS",
      default: "30000",
    },
    {
      name: "shutdownTimeout",
      environment: "KIT_HTTP_SHUTDOWN_TIMEOUT_MS",
      default: "10000",
    },
  ],
  crate: { package: "kit-server-http", directory: dependencyDirectory("http") },
  rust: { type: "kit_server_http::Http", constructor: "kit_server_http::create" },
});

export const serverProductionDependencies: readonly ServerProductionDependency[] = Object.freeze([
  alarmDependency,
  clockDependency,
  eventsDependency,
  executionContextDependency,
  httpDependency,
  identifiersDependency,
  synchronizationDependency,
  telemetryDependency,
  timerDependency,
]);

/** Validates production metadata without repeating the semantic Dependency API. */
export function defineServerProductionDependency(
  implementation: ServerProductionDependency,
): ServerProductionDependency {
  identifier(implementation.name, "server production Dependency name");
  identifier(implementation.dependency, "semantic Dependency name");
  identifier(implementation.crate.package, "Cargo package name", true);
  rustPath(implementation.rust.type, "Rust dependency type");
  rustPath(implementation.rust.constructor, "Rust constructor");
  duplicate(
    implementation.configuration.map(({ name }) => name),
    `Server production Dependency ${JSON.stringify(implementation.name)} configuration field`,
  );
  duplicate(
    implementation.bindings ?? [],
    `Server production Dependency ${JSON.stringify(implementation.name)} attachment binding`,
  );
  for (const binding of implementation.bindings ?? []) {
    if (!binding.trim()) {
      throw new Error(
        `Server production Dependency ${JSON.stringify(implementation.name)} attachment binding is empty.`,
      );
    }
  }
  for (const field of implementation.configuration) {
    identifier(field.name, "server production configuration field");
    if (!/^[A-Z][A-Z0-9_]*$/.test(field.environment)) {
      throw new Error(
        `Server production configuration environment ${JSON.stringify(field.environment)} is invalid.`,
      );
    }
    if (field.required && field.default !== undefined) {
      throw new Error(
        `Server production configuration ${JSON.stringify(field.name)} cannot be required and defaulted.`,
      );
    }
  }
  return Object.freeze(implementation);
}

/**
 * Selects one production implementation for every external Dependency and
 * orders implementations by their own Dependency requirements.
 */
export function resolveServerProductionDependencies(input: {
  dependencies: readonly DependencyIR[];
  implementations: readonly ServerProductionDependency[];
}): readonly ResolvedServerProductionDependency[] {
  duplicate(
    input.implementations.map(({ name }) => name),
    "Server production Dependency implementation",
  );
  const selected = new Map<string, ResolvedServerProductionDependency>();
  for (const dependency of input.dependencies) {
    const implementations = input.implementations.filter(
      (implementation) => implementation.dependency === dependency.name,
    );
    if (!implementations.length) {
      throw new Error(
        `Server production is missing Dependency ${JSON.stringify(dependency.name)}.`,
      );
    }
    if (implementations.length > 1) {
      throw new Error(
        `Server production Dependency ${JSON.stringify(dependency.name)} has multiple ` +
          `implementations: ${implementations
            .map(({ name }) => name)
            .sort()
            .join(", ")}.`,
      );
    }
    selected.set(dependency.name, {
      dependency,
      operations: collectDependencyOperations(dependency),
      implementation: implementations[0]!,
    });
  }

  const pending = new Map(
    [...selected].map(([name, value]) => [
      name,
      new Set(
        (value.implementation.requires ?? []).filter((dependency) => selected.has(dependency)),
      ),
    ]),
  );
  for (const [name, value] of selected) {
    for (const dependency of value.implementation.requires ?? []) {
      if (!selected.has(dependency)) {
        throw new Error(
          `Server production implementation ${JSON.stringify(value.implementation.name)} for ` +
            `${JSON.stringify(name)} requires missing Dependency ${JSON.stringify(dependency)}.`,
        );
      }
    }
  }

  const ready = [...pending]
    .filter(([, dependencies]) => !dependencies.size)
    .map(([name]) => name)
    .sort();
  const ordered: ResolvedServerProductionDependency[] = [];
  while (ready.length) {
    const name = ready.shift()!;
    ordered.push(selected.get(name)!);
    for (const [candidate, dependencies] of pending) {
      if (!dependencies.delete(name) || dependencies.size) continue;
      if (!ordered.some(({ dependency }) => dependency.name === candidate)) {
        insertSorted(ready, candidate);
      }
    }
  }
  if (ordered.length !== selected.size) {
    const cycle = [...selected.keys()].filter(
      (name) => !ordered.some(({ dependency }) => dependency.name === name),
    );
    throw new Error(`Server production Dependency cycle: ${cycle.sort().join(", ")}.`);
  }
  return ordered;
}

function identifier(value: string, label: string, kebab = false): void {
  const pattern = kebab ? /^[a-z][a-z0-9_-]*$/ : /^[A-Za-z][A-Za-z0-9_-]*$/;
  if (!pattern.test(value)) throw new Error(`${label} ${JSON.stringify(value)} is invalid.`);
}

function rustPath(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) {
    throw new Error(`${label} ${JSON.stringify(value)} is invalid.`);
  }
}

function duplicate(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} ${JSON.stringify(value)} is duplicated.`);
    seen.add(value);
  }
}

function insertSorted(values: string[], value: string): void {
  if (values.includes(value)) return;
  const index = values.findIndex((candidate) => candidate.localeCompare(value) > 0);
  if (index < 0) values.push(value);
  else values.splice(index, 0, value);
}
