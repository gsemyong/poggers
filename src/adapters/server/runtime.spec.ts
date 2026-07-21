import { describe, expect, test } from "vitest";

import { startServerPrograms } from "@/adapters/server/runtime";
import type { Application, Feature, Program } from "@/core/application";
import type { ProgramCapabilityModule } from "@/core/capability";
import type { ProgramIR } from "@/core/compiler/ir";

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
  test("selects one profile module and owns the complete Process once", async () => {
    const calls: string[] = [];
    const application: Application<App> = {
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
              start({ capabilities }) {
                calls.push(
                  `consumer.start:${capabilities.reader.read()}:${capabilities.clock.now()}`,
                );
              },
            },
          },
        } satisfies Feature<Consumer>,
      },
    };
    const module: ProgramCapabilityModule = {
      development() {
        calls.push("capabilities.development");
        return {
          clock: {
            now: () => 42,
            locations: ["http://localhost:4242/"],
            [Symbol.dispose]: () => calls.push("clock.dispose"),
          },
        };
      },
      production() {
        calls.push("capabilities.production");
        return {};
      },
    };

    const running = await startServerPrograms(
      application,
      programs(),
      { server: module },
      "development",
    );

    expect(running.locations).toEqual(["http://localhost:4242/"]);
    expect(calls).toEqual([
      "capabilities.development",
      "provider.start",
      "consumer.start:shared:42",
    ]);
    await running[Symbol.asyncDispose]();
    await running[Symbol.asyncDispose]();
    expect(calls).toEqual([
      "capabilities.development",
      "provider.start",
      "consumer.start:shared:42",
      "reader.dispose",
      "clock.dispose",
    ]);
  });
});

function programs(): readonly ProgramIR[] {
  const span = { file: "src/app.ts", line: 1, column: 1 } as const;
  const capability = (name: string) => ({
    name,
    type: { kind: "record", fields: [] } as const,
  });
  return [
    {
      id: "feature/provider/program/server",
      feature: "provider",
      name: "server",
      environment: { name: "server", platform: "server" },
      requires: [],
      provides: [capability("reader")],
      implementation: { kind: "source", span },
      span,
    },
    {
      id: "feature/consumer/program/server",
      feature: "consumer",
      name: "server",
      environment: { name: "server", platform: "server" },
      requires: [capability("clock"), capability("reader")],
      provides: [],
      implementation: { kind: "source", span },
      span,
    },
  ];
}
