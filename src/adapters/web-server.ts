import { resolve } from "node:path";

import { webProgramCompilerIR, type WebPortableFunctionIR } from "@/adapters/web/routing";
import {
  type SystemIR,
  type FunctionIR,
  type ProgramContributionIR,
  type ProgramIR,
  type SourceSpan,
} from "@/compiler/ir";
import { executePortableFunctionIR, type DependencyImplementations } from "@/runtime/interpreter";

export type WebRouteLoaderInput = Readonly<{
  route: string;
  request?: Readonly<{
    url: string;
    headers: Readonly<Record<string, string | undefined>>;
  }>;
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
}>;

export type PlannedWebRouteLoader = Readonly<{
  route: string;
  contribution: string;
  export: string;
  dependencies: readonly string[];
  implementation: WebPortableFunctionIR;
}>;

export type WebRouteLoaderPlan = Readonly<{
  contributions: readonly ProgramContributionIR[];
  loaders: readonly PlannedWebRouteLoader[];
}>;

/**
 * Projects web Route loaders onto the server Program that owns HTTP delivery.
 * The resulting contributions are ordinary portable Dependency consumers.
 */
export function planWebRouteLoaders(
  program: ProgramIR,
  system: SystemIR | undefined,
): WebRouteLoaderPlan {
  const ownsHttp = program.contributions.some((contribution) =>
    [...contribution.requires, ...contribution.provides].some(({ name }) => name === "http"),
  );
  if (!system || !ownsHttp) return { contributions: [], loaders: [] };

  const contributions: ProgramContributionIR[] = [];
  const loaders: PlannedWebRouteLoader[] = [];
  let index = 0;
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
        const requirements = route.dependencies;
        for (const name of calls) {
          const dependency = requirements.find((candidate) => candidate.name === name);
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
          implementation: {
            kind: "portable",
            start: emptyFunction(route.span),
            functions: [implementation.entry, ...implementation.functions],
          },
          span: route.span,
        });
        loaders.push({
          route: routeId,
          contribution: contributionId,
          export: `web_route_loader_${index++}`,
          dependencies,
          implementation,
        });
      }
    }
  }
  return { contributions, loaders };
}

export type DevelopmentWebLoaderRegistry = Readonly<{
  register(input: {
    system: string;
    owner: string;
    plan: WebRouteLoaderPlan;
    dependencies: Readonly<Record<string, unknown>>;
  }): Disposable;
  load(system: string, input: WebRouteLoaderInput): Promise<unknown>;
}>;

/** Creates the private in-process bridge between development server and web adapters. */
export function createDevelopmentWebLoaderRegistry(): DevelopmentWebLoaderRegistry {
  type Registration = Readonly<{
    owner: string;
    load(input: WebRouteLoaderInput): Promise<unknown>;
  }>;
  const systems = new Map<string, Map<string, Registration[]>>();

  return {
    register({ system, owner, plan, dependencies }) {
      system = resolve(system);
      const routes = systems.get(system) ?? new Map<string, Registration[]>();
      systems.set(system, routes);
      const registered: Array<Readonly<{ route: string; registration: Registration }>> = [];
      try {
        for (const loader of plan.loaders) {
          const current = routes.get(loader.route) ?? [];
          const previousOwner = current[0]?.owner;
          if (previousOwner !== undefined && previousOwner !== owner) {
            throw new Error(
              `Web Route ${JSON.stringify(loader.route)} has loader owners ` +
                `${JSON.stringify(previousOwner)} and ${JSON.stringify(owner)}.`,
            );
          }
          const implementations = Object.fromEntries(
            loader.dependencies.map((name) => {
              if (!Object.hasOwn(dependencies, name)) {
                throw new Error(
                  `Server Program ${JSON.stringify(owner)} cannot bind web Route ` +
                    `${JSON.stringify(loader.route)} Dependency ${JSON.stringify(name)}.`,
                );
              }
              return [name, dependencies[name]];
            }),
          ) as DependencyImplementations;
          const registration: Registration = {
            owner,
            async load(input) {
              return (
                await executePortableFunctionIR({
                  entry: loader.implementation.entry,
                  functions: loader.implementation.functions,
                  arguments: [input],
                  dependencies: implementations,
                })
              ).result;
            },
          };
          current.push(registration);
          routes.set(loader.route, current);
          registered.push({ route: loader.route, registration });
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
    async load(system, input) {
      system = resolve(system);
      const registration = systems.get(system)?.get(input.route)?.at(-1);
      if (!registration) {
        throw new Error(
          `No server Program provides the loader for web Route ${JSON.stringify(input.route)}.`,
        );
      }
      return registration.load(input);
    },
  };
}

function removeRegistrations(
  systems: Map<
    string,
    Map<
      string,
      Array<Readonly<{ owner: string; load(input: WebRouteLoaderInput): Promise<unknown> }>>
    >
  >,
  system: string,
  registered: readonly Readonly<{
    route: string;
    registration: Readonly<{
      owner: string;
      load(input: WebRouteLoaderInput): Promise<unknown>;
    }>;
  }>[],
): void {
  const routes = systems.get(system);
  if (!routes) return;
  for (const { route, registration } of registered) {
    const values = routes.get(route);
    if (!values) continue;
    const index = values.indexOf(registration);
    if (index >= 0) values.splice(index, 1);
    if (!values.length) routes.delete(route);
  }
  if (!routes.size) systems.delete(system);
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
