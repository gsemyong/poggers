import { describe, expect, test } from "vitest";

import { type DependencyContractIR, type ProgramManifest, type TypeIR } from "@/compiler/ir";
import { invokeDependency, type DependencyInvocationAuthority } from "@/core/dependency";
import {
  admitProcessInvocation,
  createMemoryProcessDirectory,
  processContracts,
  processPartition,
  ProcessPlacementError,
  startProcessDistribution,
  StaleProcessAuthorityError,
} from "@/execution/distribution";
import { assembleProgram, conformExternalDependencies } from "@/execution/process";
import {
  createDependencyRequestHandler,
  createMemoryDependencyTransport,
  createRemoteDependency,
} from "@/execution/transport";
import { serverProgramLanguageRuntime } from "@/platforms/server/adapter/typescript/runtime";

const string: TypeIR = { kind: "primitive", name: "string" };
const number: TypeIR = { kind: "primitive", name: "number" };
const contract: DependencyContractIR = {
  name: "counter",
  reference: {
    name: "get",
    argument: "input",
    bindings: ["key"],
    inputs: ["write"],
  },
  operations: [
    {
      name: "read",
      mode: "asynchronous",
      input: {
        kind: "record",
        fields: [{ name: "key", optional: false, type: string }],
      },
      output: {
        kind: "record",
        fields: [
          { name: "owner", optional: false, type: string },
          { name: "value", optional: false, type: number },
        ],
      },
    },
    {
      name: "write",
      mode: "asynchronous",
      input: {
        kind: "record",
        fields: [
          { name: "key", optional: false, type: string },
          {
            name: "input",
            optional: false,
            type: {
              kind: "record",
              fields: [{ name: "value", optional: false, type: number }],
            },
          },
        ],
      },
      output: {
        kind: "record",
        fields: [
          { name: "owner", optional: false, type: string },
          { name: "value", optional: false, type: number },
        ],
      },
    },
  ],
};

type Counter = Readonly<{
  get(input: Readonly<{ key: string }>): Readonly<{
    read(): Promise<Readonly<{ owner: string; value: number }>>;
    write(input: Readonly<{ value: number }>): Promise<Readonly<{ owner: string; value: number }>>;
  }>;
}>;

describe("generic Process distribution", () => {
  test("retains binding identity and maps it to stable virtual partitions", () => {
    expect(processPartition("server", contract, { key: "one" }, 64)).toEqual(
      processPartition("server", contract, { key: "one", ignored: true }, 64),
    );
    expect(processPartition("server", contract, { key: "two" }, 64).scope).not.toBe(
      processPartition("server", contract, { key: "one" }, 64).scope,
    );
    expect(() => processPartition("server", contract, {}, 64)).toThrow(
      'routing input is missing binding "key"',
    );
  });

  test("uses deterministic rendezvous placement with minimal scale-out movement", async () => {
    const directory = createMemoryProcessDirectory();
    const contracts = processContracts([contract]);
    await directory.join({
      id: "a",
      target: "memory://a",
      program: "server",
      version: "v1",
      contracts,
      now: 0,
      leaseDuration: 1_000,
    });
    await directory.join({
      id: "b",
      target: "memory://b",
      program: "server",
      version: "v1",
      contracts,
      now: 0,
      leaseDuration: 1_000,
    });
    const partitions = Array.from({ length: 128 }, (_, partition) => ({
      scope: JSON.stringify(["partition", partition]),
      program: "server",
      dependency: "counter",
      partition,
    }));
    const before = new Map<string, string>();
    for (const partition of partitions) {
      const owner = await directory.locate({
        partition,
        contracts,
        now: 1,
        leaseDuration: 100,
      });
      before.set(partition.scope, owner.owner);
    }

    await directory.join({
      id: "c",
      target: "memory://c",
      program: "server",
      version: "v2",
      contracts,
      now: 2,
      leaseDuration: 1_000,
    });
    let moved = 0;
    for (const partition of partitions) {
      const owner = await directory.locate({
        partition,
        contracts,
        now: 3,
        leaseDuration: 100,
      });
      const previous = before.get(partition.scope);
      if (owner.owner === previous) continue;
      moved += 1;
      expect(owner.owner).toBe("c");
    }
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(partitions.length);
  });

  test("increments failure and ownership epochs after expiry and restart", async () => {
    const directory = createMemoryProcessDirectory();
    const contracts = processContracts([contract]);
    const first = await directory.join({
      id: "worker",
      target: "memory://old",
      program: "server",
      version: "v1",
      contracts,
      now: 0,
      leaseDuration: 10,
    });
    const partition = processPartition("server", contract, { key: "one" }, 16);
    const old = await directory.locate({
      partition,
      contracts,
      now: 1,
      leaseDuration: 10,
    });
    const oldAuthority = authority(old);

    const restarted = await directory.join({
      id: "worker",
      target: "memory://new",
      program: "server",
      version: "v1",
      contracts,
      now: 11,
      leaseDuration: 10,
    });
    const current = await directory.locate({
      partition,
      contracts,
      now: 12,
      leaseDuration: 10,
    });

    expect(restarted.failureEpoch).toBe(first.failureEpoch + 1);
    expect(current.epoch).toBe(old.epoch + 1);
    expect(current.target).toBe("memory://new");
    await expect(
      directory.assertAuthority({ authority: oldAuthority, now: 12 }),
    ).rejects.toBeInstanceOf(StaleProcessAuthorityError);
  });

  test("routes the same semantic API over local and remote providers", async () => {
    let now = 0;
    const directory = createMemoryProcessDirectory();
    const transport = createMemoryDependencyTransport();
    const states = new Map<string, Map<string, number>>();
    const facades: Counter[] = [];
    const running: Awaited<ReturnType<typeof startProcessDistribution>>[] = [];

    for (const id of ["a", "b", "c"]) {
      const state = new Map<string, number>();
      states.set(id, state);
      const implementation = {
        async read({ input }: { input: Readonly<{ key: string }> }) {
          return { owner: id, value: state.get(input.key) ?? 0 };
        },
        async write({
          input,
        }: {
          input: Readonly<{ key: string; input: Readonly<{ value: number }> }>;
        }) {
          state.set(input.key, input.input.value);
          return { owner: id, value: input.input.value };
        },
      };
      const local = conformExternalDependencies([contract], { counter: implementation })
        .counter as object;
      const process = await startProcessDistribution(
        "server",
        [contract],
        { counter: implementation },
        {
          id,
          target: `memory://${id}`,
          version: "v1",
          directory,
          network: transport,
          partitionCount: 32,
          membershipLease: 1_000,
          ownershipLease: 100,
          now: () => now,
        },
      );
      running.push(process);
      facades.push(process.dependency(contract, local) as Counter);
    }

    try {
      const keys = Array.from({ length: 24 }, (_, index) => `key-${index}`);
      const owners = new Set<string>();
      for (const [index, key] of keys.entries()) {
        const result = await facades[index % facades.length]!.get({ key }).write({ value: index });
        owners.add(result.owner);
        await expect(facades[(index + 1) % facades.length]!.get({ key }).read()).resolves.toEqual(
          result,
        );
      }
      expect(owners.size).toBeGreaterThan(1);
    } finally {
      for (const process of running.reverse()) await process.drain();
    }
  });

  test("renews membership liveness without changing the failure epoch", async () => {
    let now = 0;
    const directory = createMemoryProcessDirectory();
    const transport = createMemoryDependencyTransport();
    const implementation = {
      async read() {
        return { owner: "worker", value: 0 };
      },
      async write() {
        return { owner: "worker", value: 0 };
      },
    };
    const process = await startProcessDistribution(
      "server",
      [contract],
      { counter: implementation },
      {
        id: "worker",
        target: "memory://renewed",
        version: "v1",
        directory,
        network: transport,
        partitionCount: 32,
        membershipLease: 10,
        ownershipLease: 10,
        now: () => now,
      },
    );

    try {
      const failureEpoch = process.member.failureEpoch;
      now = 9;
      await process.renew();
      expect(process.member).toMatchObject({
        id: "worker",
        failureEpoch,
        expiresAt: 19,
      });
      expect((await directory.membership({ program: "server", now: 18 })).members).toHaveLength(1);
      expect((await directory.membership({ program: "server", now: 19 })).members).toHaveLength(0);
    } finally {
      now = 20;
      await process.drain();
    }
  });

  test("namespaces runtime-generated invocation identities by Process failure epoch", async () => {
    let now = 0;
    const directory = createMemoryProcessDirectory();
    const transport = createMemoryDependencyTransport();
    const start = async () => {
      const implementation = {
        async read({ invocation }: { invocation: Readonly<{ id: string }> }) {
          return { owner: invocation.id, value: 0 };
        },
        async write({ invocation }: { invocation: Readonly<{ id: string }> }) {
          return { owner: invocation.id, value: 0 };
        },
      };
      const local = conformExternalDependencies([contract], { counter: implementation })
        .counter as object;
      const process = await startProcessDistribution(
        "server",
        [contract],
        { counter: implementation },
        {
          id: "worker",
          target: `memory://worker-${String(now)}`,
          version: "v1",
          directory,
          network: transport,
          partitionCount: 32,
          membershipLease: 100,
          ownershipLease: 10,
          now: () => now,
        },
      );
      return {
        process,
        counter: process.dependency(contract, local) as Counter,
      };
    };

    const first = await start();
    const firstInvocation = (await first.counter.get({ key: "same" }).read()).owner;
    await first.process.drain();
    now = 1;
    const second = await start();
    try {
      const secondInvocation = (await second.counter.get({ key: "same" }).read()).owner;
      expect(firstInvocation).toMatch(/^process:worker:1:direct:counter:read:1$/);
      expect(secondInvocation).toMatch(/^process:worker:2:direct:counter:read:1$/);
      expect(secondInvocation).not.toBe(firstInvocation);
    } finally {
      await second.process.drain();
    }
  });

  test("stops new admission and waits for in-flight work during graceful drain", async () => {
    const directory = createMemoryProcessDirectory();
    const transport = createMemoryDependencyTransport();
    let releaseWrite = () => {};
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const implementation = {
      async read() {
        return { owner: "worker", value: 0 };
      },
      async write({ input }: { input: Readonly<{ input: Readonly<{ value: number }> }> }) {
        markStarted();
        await blocked;
        return { owner: "worker", value: input.input.value };
      },
    };
    const local = conformExternalDependencies([contract], { counter: implementation })
      .counter as object;
    const process = await startProcessDistribution(
      "server",
      [contract],
      { counter: implementation },
      {
        id: "worker",
        target: "memory://draining",
        version: "v1",
        directory,
        network: transport,
        partitionCount: 32,
        membershipLease: 1_000,
        ownershipLease: 100,
        now: () => 0,
      },
    );
    const counter = process.dependency(contract, local) as Counter;
    const inFlight = counter.get({ key: "in-flight" }).write({ value: 7 });
    await started;
    let drained = false;
    const draining = process.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    await expect(counter.get({ key: "new" }).read()).rejects.toThrow("draining");
    releaseWrite();
    await expect(inFlight).resolves.toEqual({ owner: "worker", value: 7 });
    await draining;
    expect((await directory.membership({ program: "server", now: 0 })).members).toEqual([]);
  });

  test("bounds admission and exposes health, ownership, metrics, and rebalance controls", async () => {
    let now = 0;
    const directory = createMemoryProcessDirectory();
    const transport = createMemoryDependencyTransport();
    let releaseWrite = () => {};
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const implementation = {
      async read() {
        return { owner: "worker", value: 0 };
      },
      async write() {
        markStarted();
        await blocked;
        return { owner: "worker", value: 1 };
      },
    };
    const local = conformExternalDependencies([contract], { counter: implementation })
      .counter as object;
    const process = await startProcessDistribution(
      "server",
      [contract],
      { counter: implementation },
      {
        id: "worker",
        target: "memory://operations",
        version: "v1",
        directory,
        network: transport,
        partitionCount: 32,
        membershipLease: 10,
        ownershipLease: 10,
        maxInflight: 1,
        now: () => now,
      },
    );
    const counter = process.dependency(contract, local) as Counter;

    try {
      const inFlight = counter.get({ key: "one" }).write({ value: 1 });
      await started;
      expect(process.status()).toMatchObject({
        healthy: true,
        ready: true,
        active: 1,
        capacity: 1,
      });
      await expect(counter.get({ key: "two" }).read()).rejects.toThrow("invocation limit");
      releaseWrite();
      await expect(inFlight).resolves.toEqual({ owner: "worker", value: 1 });

      const before = process.status();
      expect(before.ownership).toHaveLength(1);
      expect(before.metrics).toMatchObject({
        routedCalls: 2,
        admittedCalls: 1,
        localCalls: 1,
        rejections: 1,
        ownershipMoves: 1,
      });
      await process.rebalance();
      expect(process.status().ownership).toEqual([]);

      now = 11;
      await expect(process.renew()).rejects.toBeInstanceOf(ProcessPlacementError);
      expect(process.status()).toMatchObject({ healthy: false, ready: false });
    } finally {
      await process.drain();
    }
  });

  test("turns ordinary assembled Feature providers into routed Dependencies", async () => {
    const directory = createMemoryProcessDirectory();
    const transport = createMemoryDependencyTransport();
    const manifest: ProgramManifest = {
      name: "server",
      bindings: [contract],
      contributions: [
        { feature: "counter", requires: [], provides: ["counter"] },
        { feature: "consumer", requires: ["counter"], provides: [] },
      ],
    };
    const running: Awaited<ReturnType<typeof assembleProgram>>[] = [];

    for (const id of ["a", "b", "c"]) {
      const values = new Map<string, number>();
      const system = {
        features: {
          counter: {
            programs: {
              server: {
                async start() {
                  return {
                    counter: {
                      async read({ input }: { input: Readonly<{ key: string }> }) {
                        return { owner: id, value: values.get(input.key) ?? 0 };
                      },
                      async write({
                        input,
                      }: {
                        input: Readonly<{
                          key: string;
                          input: Readonly<{ value: number }>;
                        }>;
                      }) {
                        values.set(input.key, input.input.value);
                        return { owner: id, value: input.input.value };
                      },
                    },
                  };
                },
              },
            },
          },
          consumer: { programs: { server: { async start() {} } } },
        },
      };
      running.push(
        await assembleProgram({
          system,
          name: "server",
          language: serverProgramLanguageRuntime,
          dependencies: {},
          manifest,
          distribute: ({ program, contracts, providers }) =>
            startProcessDistribution(program, contracts, providers, {
              id,
              target: `memory://assembly-${id}`,
              version: "v1",
              directory,
              network: transport,
              partitionCount: 32,
              membershipLease: 1_000,
              ownershipLease: 100,
              now: () => 0,
            }),
        }),
      );
    }

    try {
      const APIs = running.map(({ dependencies }) => dependencies.counter as Counter);
      const written = await APIs[0]!.get({ key: "assembled" }).write({ value: 7 });
      expect(["a", "b", "c"]).toContain(written.owner);
      await expect(APIs[2]!.get({ key: "assembled" }).read()).resolves.toEqual(written);
    } finally {
      await Promise.all(running.reverse().map((process) => process.dispose()));
    }
  });

  test("rejects stale routed authority before provider code starts", async () => {
    let now = 0;
    const directory = createMemoryProcessDirectory();
    const transport = createMemoryDependencyTransport();
    const contracts = processContracts([contract]);
    const oldMember = await directory.join({
      id: "old",
      target: "memory://old",
      program: "server",
      version: "v1",
      contracts,
      now,
      leaseDuration: 1_000,
    });
    let calls = 0;
    const release = transport.bind(
      oldMember.target,
      createDependencyRequestHandler(
        [contract],
        {
          counter: {
            async read() {
              calls += 1;
              return { owner: "old", value: 0 };
            },
            async write() {
              calls += 1;
              return { owner: "old", value: 0 };
            },
          },
        },
        admitProcessInvocation(directory, () => now),
      ),
    );
    const partition = processPartition("server", contract, { key: "stale" }, 32);
    const current = await directory.locate({
      partition,
      contracts,
      now,
      leaseDuration: 100,
    });
    const stale = authority(current);
    await directory.join({
      id: "next",
      target: "memory://next",
      program: "server",
      version: "v1",
      contracts,
      now,
      leaseDuration: 1_000,
    });
    await directory.drain({ id: oldMember.id, failureEpoch: oldMember.failureEpoch, now });
    await directory.locate({
      partition,
      contracts,
      now,
      leaseDuration: 100,
    });
    const remote = createRemoteDependency(contract, oldMember.target, transport) as object;

    try {
      await expect(
        invokeDependency(
          remote,
          "read",
          { key: "stale" },
          {
            id: "stale-call",
            attempt: 1,
            scheduledAt: now,
            startedAt: now,
            authority: stale,
          },
        ),
      ).rejects.toThrow("stale");
      expect(calls).toBe(0);
    } finally {
      release();
    }
  });

  test("places work only on members with the exact whole-Program contract", async () => {
    const directory = createMemoryProcessDirectory();
    const contracts = processContracts([contract]);
    const changed = {
      counter: {
        ...contracts.counter,
        read: "changed",
      },
    };
    await directory.join({
      id: "current",
      target: "memory://current",
      program: "server",
      version: "v1",
      contracts,
      now: 0,
      leaseDuration: 100,
    });
    await directory.join({
      id: "changed",
      target: "memory://changed",
      program: "server",
      version: "v2",
      contracts: changed,
      now: 0,
      leaseDuration: 100,
    });
    const owner = await directory.locate({
      partition: processPartition("server", contract, { key: "one" }, 32),
      contracts,
      now: 1,
      leaseDuration: 10,
    });
    expect(owner.owner).toBe("current");

    await directory.drain({ id: "current", failureEpoch: 1, now: 2 });
    await expect(
      directory.locate({
        partition: processPartition("server", contract, { key: "one" }, 32),
        contracts,
        now: 2,
        leaseDuration: 10,
      }),
    ).rejects.toBeInstanceOf(ProcessPlacementError);
  });
});

function authority(ownership: {
  readonly partition: { readonly scope: string };
  readonly owner: string;
  readonly failureEpoch: number;
  readonly epoch: number;
  readonly expiresAt: number;
}): DependencyInvocationAuthority {
  return {
    scope: ownership.partition.scope,
    owner: ownership.owner,
    failureEpoch: ownership.failureEpoch,
    epoch: ownership.epoch,
    expiresAt: ownership.expiresAt,
  };
}
