import { resolve } from "node:path";

import {
  PROGRAM_ATTACHMENT_IR_VERSION,
  type DevelopmentProgramAttachments,
  type ProgramAttachmentIR,
  type ProgramAttachmentSource,
} from "@/adapter";
import {
  type SystemIR,
  type FunctionIR,
  type ProgramContributionIR,
  type ProgramIR,
  type SourceSpan,
} from "@/compiler/ir";
import { executePortableFunctionIR, type DependencyImplementations } from "@/execution/interpreter";
import type { ServerProductionDependency } from "@/platforms/server/adapter";
import { webProgramCompilerIR, type WebPortableFunctionIR } from "@/platforms/web/adapter/lowering";

type PlannedWebRouteLoader = Readonly<{
  route: string;
  contribution: string;
  dependencies: readonly string[];
  implementation: WebPortableFunctionIR;
}>;

/**
 * Projects web Route loaders onto the server Program that owns HTTP delivery.
 * The resulting attachment is portable meaning; the target adapter never
 * inspects web Route or Presentation IR.
 */
export function planWebRouteLoaders(
  program: ProgramIR,
  system: SystemIR | undefined,
): ProgramAttachmentIR {
  const ownsHttp = program.contributions.some((contribution) =>
    [...contribution.requires, ...contribution.provides].some(({ name }) => name === "http"),
  );
  if (!system || !ownsHttp) return emptyWebRouteLoaderPlan();

  const contributions: ProgramContributionIR[] = [];
  const loaders: PlannedWebRouteLoader[] = [];
  for (const webProgram of system.programs) {
    if (webProgram.environment.platform !== "web") continue;
    for (const contribution of webProgram.contributions) {
      if (!contribution.extensions?.web) continue;
      for (const route of webProgramCompilerIR(contribution.extensions.web).routes) {
        const implementation = route.implementation.load;
        if (implementation === false) continue;
        const routeId = `${route.feature}.${route.name}`;
        const contributionId = `adapter/web/route/${routeId}`;
        const calls = dependencyCalls([implementation.entry, ...implementation.functions]);
        const requirements = route.dependencies.filter(({ name }) => calls.includes(name));
        for (const name of calls) {
          const dependency = route.dependencies.find((candidate) => candidate.name === name);
          if (!dependency) {
            throw new Error(
              `${route.span.file}:${route.span.line}:${route.span.column}: Web Route ` +
                `${JSON.stringify(routeId)} calls undeclared Dependency ${JSON.stringify(name)}.`,
            );
          }
        }
        const dependencies = requirements.map(({ name }) => name);
        contributions.push({
          id: contributionId,
          feature: contributionId,
          requires: requirements,
          provides: [],
          span: route.span,
        });
        loaders.push({
          route: routeId,
          contribution: contributionId,
          dependencies,
          implementation,
        });
      }
    }
  }
  return {
    version: PROGRAM_ATTACHMENT_IR_VERSION,
    owner: "web-route-loaders",
    contributions: contributions.map((contribution) => {
      const loader = loaders.find(({ contribution: id }) => id === contribution.id)!;
      return {
        contribution,
        execution: {
          kind: "portable",
          entry: emptyFunction(contribution.span),
          functions: [loader.implementation.entry, ...loader.implementation.functions],
        },
      };
    }),
    exports: loaders.map((loader) => ({
      name: loader.route,
      contribution: loader.contribution,
      function: loader.implementation.entry.id,
      dependencies: loader.dependencies,
    })),
    bindings: loaders.length
      ? [{ dependency: "http", operation: "@web-loader", field: "handle", selector: "route" }]
      : [],
  };
}

/** Portable server attachments contributed by the web Platform. */
export const webRouteLoaderAttachments: ProgramAttachmentSource = Object.freeze({
  name: "web-route-loaders",
  project: planWebRouteLoaders,
});

/**
 * Web-owned production host for HTTP APIs and web interface artifacts.
 *
 * It implements the server Platform's semantic HTTP Dependency contract, but
 * all document, route, asset, and cache meaning remains owned by web.
 */
export const webHttpProductionDependency = Object.freeze({
  name: "web-http",
  dependency: "http",
  bindings: ["@web-loader"],
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
    {
      name: "webCacheCapacity",
      environment: "KIT_WEB_CACHE_CAPACITY",
      default: "256",
    },
    {
      name: "webCacheBytes",
      environment: "KIT_WEB_CACHE_BYTES",
      default: "16777216",
    },
    {
      name: "webCacheRefreshes",
      environment: "KIT_WEB_CACHE_REFRESHES",
      default: "8",
    },
    {
      name: "webOrigin",
      environment: "KIT_WEB_ORIGIN",
      default: "http://localhost:3000",
      source: { kind: "process-location" },
    },
    {
      name: "webRoot",
      environment: "KIT_WEB_ROOT",
      source: { kind: "assets", artifact: "interface", platform: "web", format: "single" },
    },
    {
      name: "webInterfaces",
      environment: "KIT_WEB_INTERFACES",
      source: { kind: "assets", artifact: "interface", platform: "web", format: "interfaces" },
    },
  ],
  crate: {
    package: "kit-web-http",
    directory: resolve(import.meta.dirname, "rust/http"),
  },
  rust: { type: "kit_web_http::Http", constructor: "kit_web_http::create" },
} satisfies ServerProductionDependency);

/** Creates the private in-process bridge between development server and web adapters. */
export function createDevelopmentWebLoaderRegistry(): DevelopmentProgramAttachments {
  type Registration = Readonly<{
    owner: string;
    invoke(input: unknown): Promise<unknown>;
  }>;
  const systems = new Map<string, Map<string, Registration[]>>();

  return {
    register({ system, program: owner, plan, dependencies }) {
      system = resolve(system);
      const exports = systems.get(system) ?? new Map<string, Registration[]>();
      systems.set(system, exports);
      const registered: Array<Readonly<{ export: string; registration: Registration }>> = [];
      try {
        for (const exported of plan.exports) {
          const current = exports.get(exported.name) ?? [];
          const previousOwner = current[0]?.owner;
          if (previousOwner !== undefined && previousOwner !== owner) {
            throw new Error(
              `Program export ${JSON.stringify(exported.name)} has owners ` +
                `${JSON.stringify(previousOwner)} and ${JSON.stringify(owner)}.`,
            );
          }
          const attachment = plan.contributions.find(
            ({ contribution }) => contribution.id === exported.contribution,
          );
          if (!attachment || attachment.execution.kind !== "portable") {
            throw new Error(
              `Program export ${JSON.stringify(exported.name)} references a non-portable contribution.`,
            );
          }
          const execution = attachment.execution;
          const entry = [execution.entry, ...execution.functions].find(
            ({ id }) => id === exported.function,
          );
          if (!entry) {
            throw new Error(
              `Program export ${JSON.stringify(exported.name)} references missing function ` +
                `${JSON.stringify(exported.function)}.`,
            );
          }
          const implementations = Object.fromEntries(
            exported.dependencies.map((name) => {
              if (!Object.hasOwn(dependencies, name)) {
                throw new Error(
                  `Program ${JSON.stringify(owner)} cannot bind export ` +
                    `${JSON.stringify(exported.name)} Dependency ${JSON.stringify(name)}.`,
                );
              }
              return [name, dependencies[name]];
            }),
          ) as DependencyImplementations;
          const registration: Registration = {
            owner,
            async invoke(input) {
              return (
                await executePortableFunctionIR({
                  entry,
                  functions: execution.functions.filter(({ id }) => id !== entry.id),
                  arguments: [input],
                  dependencies: implementations,
                })
              ).result;
            },
          };
          current.push(registration);
          exports.set(exported.name, current);
          registered.push({ export: exported.name, registration });
        }
      } catch (error) {
        removeRegistrations(systems, system, registered);
        throw error;
      }

      let disposed = false;
      return {
        [Symbol.dispose]() {
          if (disposed) return;
          disposed = true;
          removeRegistrations(systems, system, registered);
        },
      };
    },
    async invoke(system, input) {
      system = resolve(system);
      const registration = systems.get(system)?.get(input.export)?.at(-1);
      if (!registration) {
        throw new Error(`No Program provides export ${JSON.stringify(input.export)}.`);
      }
      return registration.invoke(input.value);
    },
  };
}

function removeRegistrations(
  systems: Map<
    string,
    Map<string, Array<Readonly<{ owner: string; invoke(input: unknown): Promise<unknown> }>>>
  >,
  system: string,
  registered: readonly Readonly<{
    export: string;
    registration: Readonly<{
      owner: string;
      invoke(input: unknown): Promise<unknown>;
    }>;
  }>[],
): void {
  const exports = systems.get(system);
  if (!exports) return;
  for (const { export: name, registration } of registered) {
    const values = exports.get(name);
    if (!values) continue;
    const index = values.indexOf(registration);
    if (index >= 0) values.splice(index, 1);
    if (!values.length) exports.delete(name);
  }
  if (!exports.size) systems.delete(system);
}

function emptyWebRouteLoaderPlan(): ProgramAttachmentIR {
  return {
    version: PROGRAM_ATTACHMENT_IR_VERSION,
    owner: "web-route-loaders",
    contributions: [],
    exports: [],
    bindings: [],
  };
}

function emptyFunction(span: SourceSpan): FunctionIR {
  return {
    id: "start",
    name: "start",
    asynchronous: false,
    captures: [],
    parameters: [],
    result: { kind: "primitive", name: "void" },
    body: [],
    span,
  };
}

function dependencyCalls(functions: readonly FunctionIR[]): readonly string[] {
  const result = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Readonly<Record<string, unknown>>;
    if (record.kind === "dependency-call" && typeof record.dependency === "string") {
      result.add(record.dependency);
    }
    Object.values(record).forEach(visit);
  };
  functions.forEach(visit);
  return [...result].sort();
}
