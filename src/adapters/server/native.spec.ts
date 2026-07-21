import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, test } from "vitest";

import { buildNativeServerProgram } from "@/adapters/server/native";
import type { ProgramIR, SourceSpan } from "@/core/compiler/ir";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("caches native artifacts by semantic output rather than source spans", async () => {
  const directory = await temporaryDirectory();
  const cache = resolve(directory, "cache");
  const first = await buildNativeServerProgram({
    application: "cache-fixture",
    cache,
    directory,
    output: resolve(directory, "first"),
    program: emptyProgram({ file: "first.ts", line: 1, column: 1 }),
  });
  const second = await buildNativeServerProgram({
    application: "cache-fixture",
    cache,
    directory,
    output: resolve(directory, "second"),
    program: emptyProgram({ file: "renamed.ts", line: 200, column: 40 }),
  });

  expect(first.cache).toBe("miss");
  expect(second.cache).toBe("hit");
  expect(second.semanticHash).toBe(first.semanticHash);
  expect(second.workspace).toBe(first.workspace);
  await expect(access(second.executable)).resolves.toBeUndefined();
});

test("rejects unknown external Capabilities and host source before Cargo", async () => {
  const directory = await temporaryDirectory();
  const program = emptyProgram({ file: "program.ts", line: 1, column: 1 });
  await expect(
    buildNativeServerProgram({
      application: "invalid",
      cache: resolve(directory, "cache"),
      directory,
      output: resolve(directory, "unknown"),
      program: {
        ...program,
        contributions: [
          {
            ...program.contributions[0]!,
            requires: [{ name: "unknown", type: { kind: "record", fields: [] } }],
          },
        ],
      },
    }),
  ).rejects.toThrow("does not implement external Capabilities: unknown");

  await expect(
    buildNativeServerProgram({
      application: "invalid",
      cache: resolve(directory, "cache"),
      directory,
      output: resolve(directory, "incompatible"),
      program: {
        ...program,
        contributions: [
          {
            ...program.contributions[0]!,
            requires: [{ name: "clock", type: { kind: "primitive", name: "number" } }],
          },
        ],
      },
    }),
  ).rejects.toThrow('cannot bind Capability "clock"');

  await expect(
    buildNativeServerProgram({
      application: "invalid",
      cache: resolve(directory, "cache"),
      directory,
      output: resolve(directory, "source"),
      program: {
        ...program,
        contributions: [
          {
            ...program.contributions[0]!,
            implementation: {
              kind: "source",
              reason: "host-source",
              span: { file: "program.ts", line: 4, column: 3 },
            },
          },
        ],
      },
    }),
  ).rejects.toThrow("is source, not native-realizable Feature meaning");
});

function emptyProgram(span: SourceSpan): ProgramIR {
  return {
    id: "program/worker",
    name: "worker",
    environment: { name: "server", platform: "server" },
    contributions: [
      {
        id: "feature/worker/program/worker",
        feature: "worker",
        requires: [],
        provides: [],
        implementation: { kind: "none" },
        span,
      },
    ],
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-native-adapter-"));
  directories.push(directory);
  return directory;
}
