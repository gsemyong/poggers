import { describe, test } from "vitest";

import {
  createUncheckedDependencyClient,
  type DependencyContract,
  type DependencyImplementation,
} from "@/core/dependency";

export type DependencyConformanceInstance<Api extends DependencyContract> = Readonly<{
  api: Api;
  dispose(): void | PromiseLike<void>;
}>;

export type DependencyConformanceTarget<Api extends DependencyContract> = Readonly<{
  name: string;
  tags?: readonly string[];
  timeout?: number;
  create(): DependencyConformanceInstance<Api> | PromiseLike<DependencyConformanceInstance<Api>>;
}>;

export type DependencyConformanceScenario<Api extends DependencyContract> = Readonly<{
  name: string;
  verify(instance: DependencyConformanceInstance<Api>): void | PromiseLike<void>;
}>;

export type DependencyConformance<Api extends DependencyContract> = Readonly<{
  name: string;
  test(target: DependencyConformanceTarget<Api>): void;
}>;

/** Defines one TypeScript-authored semantic suite for every realization of a Dependency. */
export function defineDependencyConformance<Api extends DependencyContract>(definition: {
  name: string;
  scenarios: readonly DependencyConformanceScenario<Api>[];
}): DependencyConformance<Api> {
  return Object.freeze({
    name: definition.name,
    test(target) {
      describe(`${definition.name}: ${target.name}`, () => {
        for (const scenario of definition.scenarios) {
          test(
            scenario.name,
            {
              ...(target.tags ? { tags: [...target.tags] } : {}),
              ...(target.timeout === undefined ? {} : { timeout: target.timeout }),
            },
            async () => {
              const instance = await target.create();
              try {
                await scenario.verify(instance);
              } finally {
                await instance.dispose();
              }
            },
          );
        }
      });
    },
  });
}

/** Adapts an ordinary TypeScript provider to a Dependency conformance target. */
export function dependencyImplementationTarget<Api extends DependencyContract>(
  name: string,
  create: () =>
    | (DependencyImplementation<Api> & Partial<Disposable & AsyncDisposable>)
    | PromiseLike<DependencyImplementation<Api> & Partial<Disposable & AsyncDisposable>>,
): DependencyConformanceTarget<Api> {
  return {
    name,
    async create() {
      const implementation = await create();
      return {
        api: createUncheckedDependencyClient(implementation),
        async dispose() {
          const asyncDispose = implementation[Symbol.asyncDispose];
          if (asyncDispose) {
            await asyncDispose.call(implementation);
          } else {
            implementation[Symbol.dispose]?.call(implementation);
          }
        },
      };
    },
  };
}
