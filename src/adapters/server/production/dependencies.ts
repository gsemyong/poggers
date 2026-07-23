import { resolve } from "node:path";

import type { DependencyIR, DependencyOperationIR } from "@/compiler/ir";
import { collectDependencyOperations } from "@/compiler/linker";

export type ServerProductionConfiguration = Readonly<{
  name: string;
  environment: string;
  required?: true;
  default?: string;
}>;

/**
 * Production implementation metadata for one semantic server Dependency.
 *
 * The API contract is intentionally absent: DependencyIR is its only source of
 * truth. This descriptor contains realization details only.
 */
export type ServerProductionDependency = Readonly<{
  name: string;
  dependency: string;
  requires?: readonly string[];
  configuration: readonly ServerProductionConfiguration[];
  crate: Readonly<{ package: string; directory: string }>;
  rust: Readonly<{ type: string; constructor: string }>;
}>;

export type ResolvedServerProductionDependency = Readonly<{
  dependency: DependencyIR;
  operations: readonly DependencyOperationIR[];
  implementation: ServerProductionDependency;
}>;

const dependencyDirectory = (name: string): string =>
  resolve(import.meta.dirname, "dependencies", name);

export const clockDependency = defineServerProductionDependency({
  name: "clock",
  dependency: "clock",
  configuration: [],
  crate: { package: "poggers-server-clock", directory: dependencyDirectory("clock") },
  rust: { type: "poggers_server_clock::Clock", constructor: "poggers_server_clock::create" },
});

export const identifiersDependency = defineServerProductionDependency({
  name: "identifiers",
  dependency: "identifiers",
  configuration: [],
  crate: {
    package: "poggers-server-identifiers",
    directory: dependencyDirectory("identifiers"),
  },
  rust: {
    type: "poggers_server_identifiers::Identifiers",
    constructor: "poggers_server_identifiers::create",
  },
});

export const eventsDependency = defineServerProductionDependency({
  name: "events-sqlite",
  dependency: "events",
  configuration: [
    {
      name: "database",
      environment: "POGGERS_DATABASE",
      default: ".data/system.sqlite",
    },
  ],
  crate: {
    package: "poggers-server-events",
    directory: dependencyDirectory("events/sqlite"),
  },
  rust: { type: "poggers_server_events::Events", constructor: "poggers_server_events::create" },
});

export const jetStreamEventsDependency = defineServerProductionDependency({
  ...eventsDependency,
  name: "events-jetstream",
  configuration: [
    { name: "servers", environment: "NATS_URL", default: "nats://127.0.0.1:4222" },
    { name: "stream", environment: "POGGERS_EVENT_STREAM", default: "POGGERS_EVENTS" },
  ],
  crate: {
    package: "poggers-server-events-jetstream",
    directory: dependencyDirectory("events/jetstream"),
  },
  rust: {
    type: "poggers_server_events_jetstream::Events",
    constructor: "poggers_server_events_jetstream::create",
  },
});

export const authenticationDependency = defineServerProductionDependency({
  name: "authentication",
  dependency: "authentication",
  configuration: [
    {
      name: "database",
      environment: "POGGERS_DATABASE",
      default: ".data/system.sqlite",
    },
  ],
  crate: {
    package: "poggers-server-authentication",
    directory: dependencyDirectory("authentication"),
  },
  rust: {
    type: "poggers_server_authentication::Authentication",
    constructor: "poggers_server_authentication::create",
  },
});

export const httpDependency = defineServerProductionDependency({
  name: "http",
  dependency: "http",
  configuration: [
    { name: "host", environment: "HOST", default: "127.0.0.1" },
    { name: "port", environment: "PORT", default: "3010" },
    {
      name: "bodyLimit",
      environment: "POGGERS_HTTP_BODY_LIMIT",
      default: "1048576",
    },
    {
      name: "requestTimeout",
      environment: "POGGERS_HTTP_TIMEOUT_MS",
      default: "30000",
    },
    {
      name: "shutdownTimeout",
      environment: "POGGERS_HTTP_SHUTDOWN_TIMEOUT_MS",
      default: "10000",
    },
    {
      name: "webCacheCapacity",
      environment: "POGGERS_WEB_CACHE_CAPACITY",
      default: "256",
    },
    {
      name: "webCacheBytes",
      environment: "POGGERS_WEB_CACHE_BYTES",
      default: "16777216",
    },
    {
      name: "webCacheRefreshes",
      environment: "POGGERS_WEB_CACHE_REFRESHES",
      default: "8",
    },
    {
      name: "webOrigin",
      environment: "POGGERS_WEB_ORIGIN",
      default: "http://localhost:3000",
    },
    { name: "webRoot", environment: "POGGERS_WEB_ROOT" },
    { name: "webInterfaces", environment: "POGGERS_WEB_INTERFACES" },
  ],
  crate: { package: "poggers-server-http", directory: dependencyDirectory("http") },
  rust: { type: "poggers_server_http::Http", constructor: "poggers_server_http::create" },
});

export const serverProductionDependencies: readonly ServerProductionDependency[] = Object.freeze([
  authenticationDependency,
  clockDependency,
  eventsDependency,
  httpDependency,
  identifiersDependency,
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
