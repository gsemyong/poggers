import { describe, expect, test } from "vitest";

import { startServerPrograms } from "@/adapters/server/development/runtime";
import type { ProgramIR } from "@/compiler/ir";
import type { Feature } from "@/core/feature";
import type { Program } from "@/core/program";
import type { System } from "@/core/system";

type Server = Readonly<{ Name: "server"; Platform: { Name: "server" } }>;
type Reader = Readonly<{ read(): string }>;
type Clock = Readonly<{ now(): number }>;
type Provider = Readonly<{
  Programs: { server: Program<Server, { Provides: { reader: Reader } }> };
}>;
type Consumer = Readonly<{
  Programs: { server: Program<Server, { Requires: { reader: Reader; clock: Clock } }> };
}>;
type App = Readonly<{ Features: { provider: Provider; consumer: Consumer } }>;

describe("server Platform runtime", () => {
  test("executes a fully portable Program from IR and owns its host scope", async () => {
    const calls: string[] = [];
    const running = await startServerPrograms(
      { features: {} } as unknown as System<App>,
      [portableProgram()],
      () => ({
        clock: {
          async tick(input: { value: number }) {
            calls.push(`tick:${input.value}`);
            return input.value + 1;
          },
          [Symbol.dispose]() {
            calls.push("dispose");
          },
        },
      }),
      "development",
    );

    expect(calls).toEqual(["tick:41"]);
    await running[Symbol.asyncDispose]();
    expect(calls).toEqual(["tick:41", "dispose"]);
  });

  test("creates and owns one host scope for each Process instance", async () => {
    const calls: string[] = [];
    const system: System<App> = {
      features: {
        provider: {
          programs: {
            server: {
              start() {
                calls.push("provider.start");
                return {
                  reader: {
                    read: () => "shared",
                    [Symbol.dispose]: () => calls.push("reader.dispose"),
                  },
                };
              },
            },
          },
        } satisfies Feature<Provider>,
        consumer: {
          programs: {
            server: {
              start({ dependencies }) {
                calls.push(
                  `consumer.start:${dependencies.reader.read()}:${dependencies.clock.now()}`,
                );
              },
            },
          },
        } satisfies Feature<Consumer>,
      },
    };
    const createHost = ({ profile }: { profile: "development" | "production" }) => {
      calls.push(`host.${profile}`);
      return {
        clock: {
          now: () => 42,
          locations: ["http://localhost:4242/"],
          [Symbol.dispose]: () => calls.push("clock.dispose"),
        },
      };
    };

    const running = await startServerPrograms(system, programs(), createHost, "development");

    expect(running.locations).toEqual(["http://localhost:4242/"]);
    expect(calls).toEqual(["host.development", "provider.start", "consumer.start:shared:42"]);
    await running[Symbol.asyncDispose]();
    await running[Symbol.asyncDispose]();
    expect(calls).toEqual([
      "host.development",
      "provider.start",
      "consumer.start:shared:42",
      "reader.dispose",
      "clock.dispose",
    ]);
  });

  test("isolates host bindings between Program instances", async () => {
    let host = 0;
    const observed: number[] = [];
    const disposed: number[] = [];
    const system: System<App> = {
      features: {
        provider: {
          programs: {
            server: {
              start() {
                return { reader: { read: () => "shared" } };
              },
            },
          },
        } satisfies Feature<Provider>,
        consumer: {
          programs: {
            server: {
              start({ dependencies }) {
                observed.push(dependencies.clock.now());
              },
            },
          },
        } satisfies Feature<Consumer>,
      },
    };
    const createHost = () => {
      const id = ++host;
      return {
        clock: {
          now: () => id,
          [Symbol.dispose]: () => disposed.push(id),
        },
      };
    };

    const first = await startServerPrograms(system, programs(), createHost, "development");
    const second = await startServerPrograms(system, programs(), createHost, "development");

    expect(observed).toEqual([1, 2]);
    await second[Symbol.asyncDispose]();
    await first[Symbol.asyncDispose]();
    expect(disposed).toEqual([2, 1]);
  });
});

function programs(): readonly ProgramIR[] {
  const span = { file: "src/system.ts", line: 1, column: 1 } as const;
  const dependency = (name: string) => ({
    name,
    type: { kind: "record", fields: [] } as const,
  });
  return [
    {
      id: "program/server",
      name: "server",
      logicalName: "server",
      environment: { name: "server", platform: "server" },
      contributions: [
        {
          id: "feature/provider/program/server",
          feature: "provider",
          requires: [],
          provides: [dependency("reader")],
          implementation: { kind: "source", reason: "host-source", span },
          span,
        },
        {
          id: "feature/consumer/program/server",
          feature: "consumer",
          requires: [dependency("clock"), dependency("reader")],
          provides: [],
          implementation: { kind: "source", reason: "host-source", span },
          span,
        },
      ],
    },
  ];
}

function portableProgram(): ProgramIR {
  const span = { file: "src/system.ts", line: 1, column: 1 } as const;
  const number = { kind: "primitive", name: "number" } as const;
  const input = {
    kind: "record",
    fields: [{ name: "value", optional: false, type: number }],
  } as const;
  return {
    id: "program/portable",
    name: "portable",
    logicalName: "portable",
    environment: { name: "server", platform: "server" },
    contributions: [
      {
        id: "feature/portable/program/portable",
        feature: "portable",
        requires: [
          {
            name: "clock",
            type: {
              kind: "record",
              fields: [
                {
                  name: "tick",
                  optional: false,
                  type: {
                    kind: "function",
                    parameters: [{ name: "input", optional: false, type: input }],
                    result: { kind: "promise", value: number },
                  },
                },
              ],
            },
          },
        ],
        provides: [],
        implementation: {
          kind: "portable",
          functions: [],
          start: {
            id: "start",
            name: "start",
            asynchronous: true,
            captures: [],
            parameters: [],
            result: { kind: "primitive", name: "void" },
            body: [
              {
                kind: "expression",
                expression: {
                  kind: "dependency-call",
                  dependency: "clock",
                  operation: "tick",
                  arguments: [
                    {
                      kind: "record",
                      fields: [
                        {
                          name: "value",
                          value: { kind: "literal", value: 41, type: number, span },
                        },
                      ],
                      type: input,
                      span,
                    },
                  ],
                  awaited: true,
                  type: number,
                  span,
                },
                span,
              },
            ],
            span,
          },
        },
        span,
      },
    ],
  };
}
