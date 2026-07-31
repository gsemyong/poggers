import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { SourceCompilerExtension } from "@/compiler/extension";
import type { SystemIR } from "@/compiler/ir";
import { createSystemRevisionSource } from "@/realization";

const COMPILER_FIXTURE_CACHE_VERSION = 1;

/**
 * Compiles a static semantic fixture through the production compiler cache.
 *
 * Compiler tests that exercise extraction or invalidation directly should use
 * `compileSystem` instead.
 */
export function compileSystemFixture(
  entry: string,
  extensions: readonly SourceCompilerExtension[] = [],
): SystemIR {
  const source = realpathSync(resolve(entry));
  const identity = createHash("sha256")
    .update(JSON.stringify([COMPILER_FIXTURE_CACHE_VERSION, source]))
    .digest("hex");
  const root = process.env.KIT_TEST_CACHE ?? resolve(homedir(), ".cache", "kit", "testing");
  const manifest = resolve(root, "compiler", identity, "system.json");
  return createSystemRevisionSource(source, extensions, manifest).current.ir;
}
