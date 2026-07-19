import { effect } from "alien-signals";
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { Application, Feature, Program } from "./application";
import {
  createProgramContributionInstance,
  createUIContributionInstance,
  ResourceScope,
  startProcess,
  type CapabilityResolver,
} from "./process";
import type { BrowserMainThread } from "./ui/web/platform";

type Server = { readonly Name: "server" };

describe("Program runtime", () => {
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

  test("publishes provided Capabilities and owns cleanup", async () => {
    const events: string[] = [];
    const instance = createProgramContributionInstance(
      {
        start({ capabilities }) {
          events.push(`start:${String(capabilities.name)}`);
          (capabilities.first as { open(): Disposable }).open();
          (capabilities.second as { open(): Disposable }).open();
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
        capabilities: {
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

    expect((instance.start().api as { read(): number }).read()).toBe(42);
    expect(instance.start()).toBe(instance.provided);
    await instance.dispose();
    await instance.dispose();
    expect(events).toEqual(["start:store", "dispose:api", "dispose:second", "dispose:first"]);
  });

  test("aggregates cleanup failures after running every cleanup", async () => {
    const events: string[] = [];
    const instance = createProgramContributionInstance(
      {
        start({ capabilities }) {
          (capabilities.first as { open(): Disposable }).open();
          (capabilities.second as { open(): Disposable }).open();
        },
      },
      {
        address: { program: "cloud", feature: "work" },
        capabilities: {
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

    instance.start();
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
        start({ capabilities }) {
          (capabilities.resources as { open(): Promise<AsyncDisposable> }).open();
        },
      },
      {
        address: { program: "cloud", feature: "late-resource" },
        capabilities: { resources: { open: () => resource } },
      },
    );

    instance.start();
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
        start({ actions, capabilities }) {
          return (
            capabilities.values as {
              subscribe(next: (value: number) => void): Disposable;
            }
          ).subscribe((value) => actions?.receive?.(value));
        },
      },
      {
        address: { program: "browser", feature: "counter" },
        capabilities: {
          values: {
            subscribe(next: (value: number) => void): Disposable {
              receive = next;
              return { [Symbol.dispose]: () => (receive = undefined) };
            },
          },
        },
      },
    );

    instance.start();
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
      { address: { program: "worker", feature: "stream" } },
    );

    instance.start();
    await reading;
    await instance.dispose();

    expect(events).toEqual(["next", "return"]);
  });

  test("supports semantic early cancellation and still tears the resource down", async () => {
    const events: string[] = [];
    const instance = createProgramContributionInstance(
      {
        start({ capabilities }) {
          const operation = (
            capabilities.operations as {
              open(): Disposable & { cancel(): void };
            }
          ).open();
          operation.cancel();
        },
      },
      {
        address: { program: "cloud", feature: "operation" },
        capabilities: {
          operations: {
            open: () => ({
              cancel: () => events.push("cancel"),
              [Symbol.dispose]: () => events.push("dispose"),
            }),
          },
        },
      },
    );

    instance.start();
    await instance.dispose();
    expect(events).toEqual(["cancel", "dispose"]);
  });

  test("does not duplicate subscriptions across repeated activation", async () => {
    const listeners = new Set<() => void>();
    const adapter: CapabilityResolver = {
      resolve: () => ({
        changes: {
          subscribe(receive: () => void): Disposable {
            listeners.add(receive);
            return { [Symbol.dispose]: () => listeners.delete(receive) };
          },
        },
      }),
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
              start({ capabilities }) {
                capabilities.changes.subscribe(() => undefined);
              },
            },
          },
        },
      },
    };

    for (let revision = 0; revision < 100; revision++) {
      const process = await startProcess(application, "browser", adapter);
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
          start({ capabilities }) {
            starts.push(`parent:${capabilities.child.read()}`);
          },
        },
      },
    };
    const application: Application<App> = { features: { parent } };
    const process = await startProcess(application, "cloud", { resolve: () => ({}) });

    expect(starts).toEqual(["parent.child", "parent:child"]);
    expect(process.contributions.map(({ address }) => address.feature)).toEqual([
      "parent.child",
      "parent",
    ]);
    await process.dispose();
  });

  test("resolves every binding before user work starts", async () => {
    type Leaf = { Programs: { cloud: Program<Server> } };
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
      startProcess(application, "cloud", {
        resolve({ feature: path }) {
          if (path === "second") throw new Error("binding failed");
          return {};
        },
      }),
    ).rejects.toThrow("binding failed");
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
              start({ capabilities }) {
                events.push("start:first");
                (capabilities.resource as { open(): Disposable }).open();
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
      startProcess(application, "cloud", {
        resolve: () => ({
          resource: {
            open: () => ({
              [Symbol.dispose]() {
                events.push("dispose:first");
              },
            }),
          },
        }),
      }),
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
        async start({ capabilities }) {
          for await (const _value of capabilities.changes as AsyncIterable<number>) {
            // The Program lifecycle owns this source.
          }
        },
      },
      {
        address: { program: "worker", feature: "search" },
        capabilities: { changes },
      },
    );

    instance.start();
    await started;
    await instance.dispose();
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
            refresh({ capabilities, state }) {
              state.value = capabilities.reader.read();
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
    const adapters: CapabilityResolver[] = [
      { resolve: () => ({ reader: { read: () => "local" } }) },
      { resolve: () => ({ reader: { read: () => "proxy" } }) },
      { resolve: () => ({ reader: { read: () => "fake" } }) },
    ];

    for (const [index, adapter] of adapters.entries()) {
      const process = await startProcess(application, "browser", adapter);
      expect(process.ui.consumer?.value).toBe(["local", "proxy", "fake"][index]);
      await process.dispose();
    }
  });
});
