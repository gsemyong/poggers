import { effect } from "alien-signals";
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { ProgramManifest } from "@/compiler/ir";
import type { Application, Feature } from "@/core/application";
import type { Program } from "@/core/program";
import type { BrowserMainThread } from "@/platforms/web/platform";
import {
  bindDependenciesToScope,
  conformExternalDependencies,
  createProgramContributionInstance,
  createUIContributionInstance,
  planProgram,
  ResourceScope,
  startProcess,
  validateDependencyBindings,
} from "@/runtime/process";

type ServerPlatform = { readonly Name: "server" };
type Server = { readonly Name: "server"; readonly Platform: ServerPlatform };

describe("Program runtime", () => {
  test("enforces one compiler-derived contract across synchronous, asynchronous, and stream calls", async () => {
    const contracts = [
      {
        name: "service",
        operations: [
          {
            name: "now",
            mode: "synchronous",
            input: { kind: "record", fields: [] },
            output: { kind: "primitive", name: "number" },
          },
          {
            name: "read",
            mode: "asynchronous",
            input: { kind: "record", fields: [] },
            output: { kind: "primitive", name: "string" },
          },
          {
            name: "changes",
            mode: "stream",
            input: { kind: "record", fields: [] },
            output: { kind: "primitive", name: "boolean" },
          },
        ],
      },
    ] as const;
    const dependencies = conformExternalDependencies(contracts, {
      service: {
        now: () => 42,
        read: async () => "ready",
        changes: () => ({
          async *[Symbol.asyncIterator]() {
            yield true;
            yield false;
          },
        }),
      },
    });
    const service = dependencies.service as {
      now(input: {}): number;
      read(input: {}): Promise<string>;
      changes(input: {}): AsyncIterable<boolean>;
    };

    expect(service.now({})).toBe(42);
    await expect(service.read({})).resolves.toBe("ready");
    const changes: boolean[] = [];
    for await (const value of service.changes({})) changes.push(value);
    expect(changes).toEqual([true, false]);

    const invalid = conformExternalDependencies(contracts, {
      service: {
        now: () => "not a number",
        read: () => "not a Promise",
        changes: () => [],
      },
    }).service as typeof service;
    expect(() => invalid.now({})).toThrow("semantic Dependency contract");
    expect(() => invalid.read({})).toThrow("must return a Promise");
    expect(() => invalid.changes({})).toThrow("must return an AsyncIterable");
  });

  test("disposes arbitrary owned resources once in reverse order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(fc.string(), { maxLength: 40 }), async (resources) => {
        const scope = new ResourceScope();
        const disposed: string[] = [];
        for (const resource of resources) scope.add(() => void disposed.push(resource));

        const first = scope.dispose();
        const second = scope.dispose();
        expect(second).toBe(first);
        await first;
        expect(disposed).toEqual([...resources].reverse());
      }),
      { numRuns: 100 },
    );
  });

  test("disconnects owned producers synchronously when disposal begins", async () => {
    const scope = new ResourceScope();
    let connected = true;
    scope.add(() => {
      connected = false;
    });

    const disposal = scope.dispose();
    expect(connected).toBe(false);
    await disposal;
  });

  test("creates an isolated reactive UI state and action surface", async () => {
    const first = createUIContributionInstance({
      state: { count: 0 },
      actions: {
        add({ state }, value) {
          state.count = Number(state.count) + Number(value);
          return state.count;
        },
      },
    });
    const second = createUIContributionInstance({ state: { count: 0 } });

    expect(first.actions.add?.(2)).toBe(2);
    expect(first.api.count).toBe(2);
    expect(first.snapshot()).toEqual({ count: 2 });
    expect(second.api.count).toBe(0);
    await first.dispose();
    await second.dispose();
    expect(() => first.actions.add?.(1)).toThrow("disposed");
  });

  test("restores only declared UI state from a hot snapshot", async () => {
    const ui = createUIContributionInstance(
      { state: { count: 0, label: "new" } },
      { initialState: { count: 7, removed: true } },
    );

    expect(ui.snapshot()).toEqual({ count: 7, label: "new" });
    await ui.dispose();
  });

  test("batches every synchronous action into one reactive notification", async () => {
    const ui = createUIContributionInstance({
      state: { first: 0, second: 0 },
      actions: {
        update({ state }) {
          state.first = 1;
          state.second = 2;
        },
      },
    });
    const snapshots: string[] = [];
    const stop = effect(() => {
      snapshots.push(`${String(ui.api.first)}:${String(ui.api.second)}`);
    });

    ui.actions.update?.();

    expect(snapshots).toEqual(["0:0", "1:2"]);
    stop();
    await ui.dispose();
  });

  test("owns resources returned by standalone UI actions", async () => {
    const events: string[] = [];
    const ui = createUIContributionInstance({
      actions: {
        open() {
          return {
            [Symbol.dispose]() {
              events.push("disposed");
            },
          };
        },
      },
    });

    ui.actions.open?.();
    await ui.dispose();
    await ui.dispose();

    expect(events).toEqual(["disposed"]);
  });

  test("publishes provided Dependencies and owns cleanup", async () => {
    const events: string[] = [];
    const instance = createProgramContributionInstance(
      {
        start({ dependencies }) {
          events.push(`start:${String(dependencies.name)}`);
          (dependencies.first as { open(): Disposable }).open();
          (dependencies.second as { open(): Disposable }).open();
          return {
            api: {
              read: () => 42,
              [Symbol.dispose]() {
                events.push("dispose:api");
              },
            },
          };
        },
      },
      {
        address: { program: "cloud", feature: "orders" },
        provides: ["api"],
        dependencies: {
          name: "store",
          first: {
            open: () => ({
              [Symbol.dispose]() {
                events.push("dispose:first");
              },
            }),
          },
          second: {
            open: () => ({
              [Symbol.dispose]() {
                events.push("dispose:second");
              },
            }),
          },
        },
      },
    );

    const started = instance.start();
    expect(instance.start()).toBe(started);
    expect(((await started).api as { read(): number }).read()).toBe(42);
    expect(await instance.start()).toBe(instance.provided);
    await instance.dispose();
    await instance.dispose();
    expect(events).toEqual(["start:store", "dispose:api", "dispose:second", "dispose:first"]);
  });

  test("binds immutable Dependency objects without violating Proxy invariants", async () => {
    const dependency = Object.freeze({
      value: 42,
      read() {
        return this.value;
      },
    });
    const scope = new ResourceScope();
    const bound = bindDependenciesToScope({ dependency }, scope) as {
      dependency: typeof dependency;
    };

    expect(bound.dependency.read()).toBe(42);
    expect(Object.keys(bound.dependency)).toEqual(["value", "read"]);

    await scope.dispose();
    expect(() => bound.dependency.read()).toThrow("disposed");
  });

  test("aggregates cleanup failures after running every cleanup", async () => {
    const events: string[] = [];
    const instance = createProgramContributionInstance(
      {
        start({ dependencies }) {
          (dependencies.first as { open(): Disposable }).open();
          (dependencies.second as { open(): Disposable }).open();
        },
      },
      {
        address: { program: "cloud", feature: "work" },
        provides: [],
        dependencies: {
          first: {
            open: () => ({
              [Symbol.dispose]() {
                events.push("first");
                throw new Error("first failed");
              },
            }),
          },
          second: {
            open: () => ({
              [Symbol.dispose]() {
                events.push("second");
                throw new Error("second failed");
              },
            }),
          },
        },
      },
    );

    await instance.start();
    const disposal = instance.dispose();
    await expect(disposal).rejects.toBeInstanceOf(AggregateError);
    expect(events).toEqual(["second", "first"]);
  });

  test("owns async resources and resources resolved during teardown", async () => {
    const events: string[] = [];
    let resolveResource!: (resource: AsyncDisposable) => void;
    const resource = new Promise<AsyncDisposable>((resolve) => (resolveResource = resolve));
    const instance = createProgramContributionInstance(
      {
        start({ dependencies }) {
          (dependencies.resources as { open(): Promise<AsyncDisposable> }).open();
        },
      },
      {
        address: { program: "cloud", feature: "late-resource" },
        provides: [],
        dependencies: { resources: { open: () => resource } },
      },
    );

    await instance.start();
    const disposal = instance.dispose();
    resolveResource({
      async [Symbol.asyncDispose]() {
        await Promise.resolve();
        events.push("disposed");
      },
    });
    await disposal;
    expect(events).toEqual(["disposed"]);
  });

  test("does not turn a handled Dependency rejection into a disposal failure", async () => {
    const scope = new ResourceScope();
    const dependencies = bindDependenciesToScope(
      { operation: { run: () => Promise.reject(new Error("expected")) } },
      scope,
    ) as { operation: { run(): Promise<void> } };

    await expect(dependencies.operation.run()).rejects.toThrow("expected");
    await expect(scope.dispose()).resolves.toBeUndefined();
  });

  test("routes long-lived external updates through actions while the contribution is live", async () => {
    const values: number[] = [];
    let receive: ((value: number) => void) | undefined;
    const instance = createProgramContributionInstance(
      {
        state: { count: 0 },
        actions: {
          receive({ state }, value) {
            state.count = Number(value);
            values.push(Number(state.count));
          },
        },
        start({ actions, dependencies }) {
          return (
            dependencies.values as {
              subscribe(next: (value: number) => void): Disposable;
            }
          ).subscribe((value) => actions?.receive?.(value));
        },
      },
      {
        address: { program: "browser", feature: "counter" },
        provides: [],
        dependencies: {
          values: {
            subscribe(next: (value: number) => void): Disposable {
              receive = next;
              return { [Symbol.dispose]: () => (receive = undefined) };
            },
          },
        },
      },
    );

    await instance.start();
    receive?.(1);
    expect(values).toEqual([1]);
    await instance.dispose();
    receive?.(2);
    expect(values).toEqual([1]);
  });

  test("prevents stale async actions from mutating disposed state", async () => {
    let resume!: () => void;
    const resumed = new Promise<void>((resolve) => (resume = resolve));
    const ui = createUIContributionInstance({
      state: { value: "current" },
      actions: {
        async replace({ state }) {
          await resumed;
          state.value = "stale";
        },
      },
    });

    const action = ui.actions.replace?.();
    const disposal = ui.dispose();
    resume();
    await action;
    await disposal;
    expect(ui.state.value).toBe("current");
  });

  test("drains and cancels an AsyncIterable returned directly from start", async () => {
    let finishRead!: (result: IteratorResult<number>) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => (started = resolve));
    const events: string[] = [];
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            events.push("next");
            started();
            return new Promise<IteratorResult<number>>((resolve) => (finishRead = resolve));
          },
          return() {
            events.push("return");
            finishRead({ done: true, value: undefined });
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
    const instance = createProgramContributionInstance(
      { start: () => source },
      { address: { program: "worker", feature: "stream" }, provides: [] },
    );

    await instance.start();
    await reading;
    await instance.dispose();

    expect(events).toEqual(["next", "return"]);
  });

  test("supports semantic early cancellation and still tears the resource down", async () => {
    const events: string[] = [];
    const instance = createProgramContributionInstance(
      {
        start({ dependencies }) {
          const operation = (
            dependencies.operations as {
              open(): Disposable & { cancel(): void };
            }
          ).open();
          operation.cancel();
        },
      },
      {
        address: { program: "cloud", feature: "operation" },
        provides: [],
        dependencies: {
          operations: {
            open: () => ({
              cancel: () => events.push("cancel"),
              [Symbol.dispose]: () => events.push("dispose"),
            }),
          },
        },
      },
    );

    await instance.start();
    await instance.dispose();
    expect(events).toEqual(["cancel", "dispose"]);
  });

  test("does not duplicate subscriptions across repeated activation", async () => {
    const listeners = new Set<() => void>();
    const dependencies = {
      changes: {
        subscribe(receive: () => void): Disposable {
          listeners.add(receive);
          return { [Symbol.dispose]: () => listeners.delete(receive) };
        },
      },
    };
    type Watcher = {
      Programs: {
        browser: Program<
          BrowserMainThread,
          { Requires: { changes: { subscribe(receive: () => void): Disposable } } }
        >;
      };
    };
    const application: Application<{ Features: { watcher: Watcher } }> = {
      features: {
        watcher: {
          programs: {
            browser: {
              start({ dependencies }) {
                dependencies.changes.subscribe(() => undefined);
              },
            },
          },
        },
      },
    };

    for (let revision = 0; revision < 100; revision++) {
      const process = await startProcess(
        application,
        "browser",
        dependencies,
        manifest("browser", { feature: "watcher", requires: ["changes"] }),
      );
      expect(listeners.size).toBe(1);
      await process.dispose();
      expect(listeners.size).toBe(0);
    }
  });

  test("assembles nested Feature contributions deterministically", async () => {
    type Child = {
      Programs: { cloud: Program<Server, { Provides: { child: { read(): string } } }> };
    };
    type Parent = {
      Features: { child: Child };
      Programs: {
        cloud: Program<Server, { Requires: { child: { read(): string } } }>;
      };
    };
    type App = { Features: { parent: Parent } };
    const starts: string[] = [];

    const child: Feature<Child> = {
      programs: {
        cloud: {
          start() {
            starts.push("parent.child");
            return { child: { read: () => "child" } };
          },
        },
      },
    };
    const parent: Feature<Parent> = {
      features: { child },
      programs: {
        cloud: {
          start({ dependencies }) {
            starts.push(`parent:${dependencies.child.read()}`);
          },
        },
      },
    };
    const application: Application<App> = { features: { parent } };
    const process = await startProcess(
      application,
      "cloud",
      {},
      manifest(
        "cloud",
        { feature: "parent", requires: ["child"] },
        { feature: "parent.child", provides: ["child"] },
      ),
    );

    expect(starts).toEqual(["parent.child", "parent:child"]);
    expect(process.contributions.map(({ address }) => address.feature)).toEqual([
      "parent.child",
      "parent",
    ]);
    await process.dispose();
  });

  test("validates every external Dependency before user work starts", async () => {
    type Leaf = { Programs: { cloud: Program<Server, { Requires: { value: string } }> } };
    type App = { Features: { first: Leaf; second: Leaf } };
    const events: string[] = [];
    const feature = (name: string): Feature<Leaf> => ({
      programs: {
        cloud: {
          start() {
            events.push(`start:${name}`);
          },
        },
      },
    });
    const application: Application<App> = {
      features: { first: feature("first"), second: feature("second") },
    };

    await expect(
      startProcess(
        application,
        "cloud",
        {},
        manifest(
          "cloud",
          { feature: "first", requires: ["value"] },
          { feature: "second", requires: ["value"] },
        ),
      ),
    ).rejects.toThrow("missing: value");
    expect(events).toEqual([]);
  });

  test("rolls back started contributions when later startup fails", async () => {
    type Leaf = {
      Programs: {
        cloud: Program<Server, { Requires: { resource: { open(): Disposable } } }>;
      };
    };
    type App = { Features: { first: Leaf; second: Leaf } };
    const events: string[] = [];
    const application: Application<App> = {
      features: {
        first: {
          programs: {
            cloud: {
              start({ dependencies }) {
                events.push("start:first");
                (dependencies.resource as { open(): Disposable }).open();
              },
            },
          },
        },
        second: {
          programs: {
            cloud: {
              start() {
                events.push("start:second");
                throw new Error("startup failed");
              },
            },
          },
        },
      },
    };

    await expect(
      startProcess(
        application,
        "cloud",
        {
          resource: {
            open: () => ({
              [Symbol.dispose]() {
                events.push("dispose:first");
              },
            }),
          },
        },
        manifest("cloud", { feature: "first", requires: ["resource"] }, { feature: "second" }),
      ),
    ).rejects.toThrow("startup failed");
    expect(events).toEqual(["start:first", "start:second", "dispose:first"]);
  });

  test("cancels scoped AsyncIterables before awaiting background completion", async () => {
    let returned = false;
    let reading!: () => void;
    const started = new Promise<void>((resolve) => (reading = resolve));
    const changes: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        let resolveNext: ((result: IteratorResult<number>) => void) | undefined;
        return {
          next() {
            reading();
            return new Promise<IteratorResult<number>>((resolve) => (resolveNext = resolve));
          },
          return() {
            returned = true;
            resolveNext?.({ done: true, value: undefined });
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
    const instance = createProgramContributionInstance(
      {
        async start({ dependencies }) {
          for await (const _value of dependencies.changes as AsyncIterable<number>) {
            // The Program lifecycle owns this source.
          }
        },
      },
      {
        address: { program: "worker", feature: "search" },
        provides: [],
        dependencies: { changes },
      },
    );

    await instance.start();
    await started;
    await instance.dispose();
    expect(returned).toBe(true);
  });

  test("does not consume an AsyncIterable before the Dependency caller", async () => {
    let returned = false;
    const source = {
      changes(): AsyncIterable<number> {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              yield 42;
              await new Promise(() => undefined);
            } finally {
              returned = true;
            }
          },
        };
      },
    };
    const scope = new ResourceScope();
    const bound = bindDependenciesToScope(source, scope) as typeof source;
    const iterator = bound.changes()[Symbol.asyncIterator]();

    expect(await iterator.next()).toEqual({ done: false, value: 42 });
    await scope.dispose();
    expect(returned).toBe(true);
  });

  test("can bind local, proxy, and fake implementations through one adapter", async () => {
    type Reader = { read(): string };
    type Consumer = {
      Programs: {
        browser: Program<
          BrowserMainThread,
          {
            Requires: { reader: Reader };
            State: { value: string };
            Actions: { refresh(): void };
            Components: { Root: { Elements: { Root: "main" } } };
          }
        >;
      };
    };
    type App = { Features: { consumer: Consumer } };
    const consumer: Feature<Consumer> = {
      programs: {
        browser: {
          state: { value: "" },
          actions: {
            refresh({ dependencies, state }) {
              state.value = dependencies.reader.read();
            },
          },
          components: { Root: { view: () => null } },
          root: "Root",
          start({ actions }) {
            actions.refresh();
          },
        },
      },
    };
    const application: Application<App> = { features: { consumer } };
    const implementations = [
      { reader: { read: () => "local" } },
      { reader: { read: () => "proxy" } },
      { reader: { read: () => "fake" } },
    ];

    for (const [index, dependencies] of implementations.entries()) {
      const process = await startProcess(
        application,
        "browser",
        dependencies,
        manifest("browser", { feature: "consumer", requires: ["reader"] }),
      );
      expect(process.ui.consumer?.value).toBe(["local", "proxy", "fake"][index]);
      await process.dispose();
    }
  });

  test("orders a provider graph independently of manifest and object insertion order", async () => {
    const contributions = [
      { feature: "worker", requires: ["cache", "clock"] },
      { feature: "cache", requires: ["store"], provides: ["cache"] },
      { feature: "store", provides: ["store"] },
      { feature: "audit", requires: ["clock"] },
    ] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray([...contributions], {
          minLength: contributions.length,
          maxLength: contributions.length,
        }),
        async (permutation) => {
          const application = {
            features: Object.fromEntries(
              [...permutation]
                .reverse()
                .map(({ feature }) => [feature, { programs: { server: {} } }]),
            ),
          };
          const plan = planProgram(application, "server", manifest("server", ...permutation));

          expect(plan.external).toEqual(["clock"]);
          expect(plan.contributions.map(({ feature }) => feature)).toEqual([
            "audit",
            "store",
            "cache",
            "worker",
          ]);
        },
      ),
      { numRuns: 100 },
    );
  });

  test("rejects invalid Dependency graphs before starting user code", () => {
    const application = {
      features: {
        first: { programs: { server: {} } },
        second: { programs: { server: {} } },
      },
    };

    expect(() =>
      planProgram(
        application,
        "server",
        manifest(
          "server",
          { feature: "first", provides: ["shared"] },
          { feature: "second", provides: ["shared"] },
        ),
      ),
    ).toThrow('multiple providers for Dependency "shared"');

    expect(() =>
      planProgram(
        application,
        "server",
        manifest(
          "server",
          { feature: "first", requires: ["second"], provides: ["first"] },
          { feature: "second", requires: ["first"], provides: ["second"] },
        ),
      ),
    ).toThrow("provider cycle between Features: first, second");
  });

  test("validates an exact external Dependency set", () => {
    const plan = planProgram(
      { features: { consumer: { programs: { server: {} } } } },
      "server",
      manifest("server", { feature: "consumer", requires: ["clock", "events"] }),
    );

    expect(() => validateDependencyBindings(plan, { clock: {}, extra: {} })).toThrow(
      "missing: events; unexpected: extra",
    );
    expect(() => validateDependencyBindings(plan, { clock: {}, events: {} })).not.toThrow();
  });

  test("owns external and Feature-provided Dependency resources exactly once", async () => {
    const disposals = { external: 0, provided: 0 };
    const application = {
      features: {
        provider: {
          programs: {
            server: {
              start() {
                return {
                  reader: {
                    read: () => "value",
                    [Symbol.dispose]: () => disposals.provided++,
                  },
                };
              },
            },
          },
        },
        consumer: {
          programs: {
            server: {
              start({ dependencies }: { dependencies: { reader: { read(): string } } }) {
                expect(dependencies.reader.read()).toBe("value");
              },
            },
          },
        },
      },
    };
    const process = await startProcess(
      application,
      "server",
      {
        clock: {
          now: () => 0,
          [Symbol.dispose]: () => disposals.external++,
        },
      },
      manifest(
        "server",
        { feature: "provider", provides: ["reader"] },
        { feature: "consumer", requires: ["clock", "reader"] },
      ),
    );

    await process.dispose();
    await process.dispose();
    expect(disposals).toEqual({ external: 1, provided: 1 });
  });

  test("awaits asynchronous providers before starting their consumers", async () => {
    const events: string[] = [];
    const application = {
      features: {
        consumer: {
          programs: {
            api: {
              start({ dependencies }: { dependencies: { reader: { read(): string } } }) {
                events.push(`consumer:${dependencies.reader.read()}`);
              },
            },
          },
        },
        provider: {
          programs: {
            api: {
              async start() {
                events.push("provider:start");
                await Promise.resolve();
                events.push("provider:ready");
                return {
                  reader: {
                    read: () => "ready",
                    [Symbol.dispose]: () => events.push("provider:dispose"),
                  },
                };
              },
            },
          },
        },
      },
    };

    const process = await startProcess(
      application,
      "api",
      {},
      manifest(
        "api",
        { feature: "consumer", requires: ["reader"] },
        { feature: "provider", provides: ["reader"] },
      ),
    );

    expect(events).toEqual(["provider:start", "provider:ready", "consumer:ready"]);
    await process.dispose();
    expect(events).toEqual([
      "provider:start",
      "provider:ready",
      "consumer:ready",
      "provider:dispose",
    ]);
  });

  test("shares one Feature binding locally and recreates it for another Process", async () => {
    let created = 0;
    const observed: number[] = [];
    const application = {
      features: {
        provider: {
          programs: {
            server: {
              start() {
                const id = ++created;
                return { reader: { read: () => id } };
              },
            },
          },
        },
        first: {
          programs: {
            server: {
              start({ dependencies }: { dependencies: { reader: { read(): number } } }) {
                observed.push(dependencies.reader.read());
              },
            },
          },
        },
        second: {
          programs: {
            server: {
              start({ dependencies }: { dependencies: { reader: { read(): number } } }) {
                observed.push(dependencies.reader.read());
              },
            },
          },
        },
      },
    };
    const graph = manifest(
      "server",
      { feature: "provider", provides: ["reader"] },
      { feature: "first", requires: ["reader"] },
      { feature: "second", requires: ["reader"] },
    );

    const first = await startProcess(application, "server", {}, graph);
    const second = await startProcess(application, "server", {}, graph);

    expect(observed).toEqual([1, 1, 2, 2]);
    await first.dispose();
    await second.dispose();
  });
});

function manifest(
  name: string,
  ...contributions: readonly Readonly<{
    feature: string;
    requires?: readonly string[];
    provides?: readonly string[];
  }>[]
): ProgramManifest {
  return {
    name,
    contributions: contributions.map((contribution) => ({
      feature: contribution.feature,
      requires: contribution.requires ?? [],
      provides: contribution.provides ?? [],
    })),
  };
}
