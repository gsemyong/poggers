import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sourceRoot = import.meta.dirname;

describe("architectural ownership", () => {
  test("keeps the neutral substrate independent from Platform and UI meaning", async () => {
    const files = [
      "core/program.ts",
      "core/feature.ts",
      "core/system.ts",
      "adapter.ts",
      "compiler/extension.ts",
      "compiler/ir.ts",
      "compiler/source.ts",
      "compiler/rust/lowering.ts",
      "execution/process.ts",
      "jsx/runtime.ts",
    ];

    for (const file of files) {
      const source = await readFile(resolve(sourceRoot, file), "utf8");
      expect(source, file).not.toMatch(
        /from\s+["']@\/(?:authoring\/ui|deployment|features|platforms)(?:\/|["'])/,
      );
    }

    const program = await readFile(resolve(sourceRoot, "core/program.ts"), "utf8");
    expect(program).not.toMatch(/\b(?:Actions|Components|Presentation|Routes|State)\b/);
    const adapter = await readFile(resolve(sourceRoot, "adapter.ts"), "utf8");
    expect(adapter).not.toMatch(/\b(?:ComponentAdapter|PresentationAdapter|UIAdapter)\b/);

    for (const file of [
      "compiler/extension.ts",
      "compiler/ir.ts",
      "compiler/source.ts",
      "compiler/rust/lowering.ts",
    ]) {
      const source = await readFile(resolve(sourceRoot, file), "utf8");
      expect(source, file).not.toMatch(
        /\b(?:Actions|Components|Presentation|Routes|State|WebRoute|browser-main)\b/,
      );
    }
  });

  test("keeps portable TypeScript-to-Rust lowering unaware of product dialects", async () => {
    const lowering = await readFile(resolve(sourceRoot, "compiler/rust/lowering.ts"), "utf8");

    expect(lowering).not.toMatch(/\b(?:actor|browser|component|feature|presentation|route|web)\b/i);
  });

  test("keeps the neutral package root and Feature declarations free of eager implementations", async () => {
    const root = await readFile(resolve(sourceRoot, "index.ts"), "utf8");
    expect(root).not.toMatch(/from\s+["']@\/(?:features|platforms)(?:\/|["'])/);

    for (const feature of ["actor", "data", "entity", "identity"]) {
      const source = await readFile(resolve(sourceRoot, `features/${feature}/index.ts`), "utf8");
      expect(source, feature).not.toMatch(
        /from\s+["']@\/platforms\/(?:server|web)\/adapter(?:\/|["'])/,
      );
    }
  });

  test("keeps web details out of server and Deployment implementations", async () => {
    const serverFiles = await files(resolve(sourceRoot, "platforms/server"));
    for (const file of serverFiles.filter(implementationSource)) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["']@\/platforms\/web(?:\/|["'])/);
    }

    const deploymentFiles = await files(resolve(sourceRoot, "deployment"));
    for (const file of deploymentFiles.filter(implementationSource)) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["']@\/platforms\/(?:server|web)(?:\/|["'])/);
      expect(source, file).not.toMatch(/\b(?:Component|Presentation|WebRoute)\b|routes\.ir\.json/);
    }

    const serverHttp = await readFile(
      resolve(sourceRoot, "platforms/server/adapter/rust/providers/http/src/lib.rs"),
      "utf8",
    );
    expect(serverHttp).not.toMatch(/\bweb\b|document\.ir\.json|routes\.ir\.json/i);

    const systemTesting = await readFile(resolve(sourceRoot, "testing/index.ts"), "utf8");
    expect(systemTesting).not.toMatch(/KIT_WEB_|routes\.ir\.json|WebAssetManifest/);
  });
});

function implementationSource(path: string): boolean {
  return (
    /\.(?:rs|ts)$/.test(path) &&
    !path.endsWith(".spec.ts") &&
    !path.endsWith(".typecheck.ts") &&
    !path.split("/").includes("fixtures")
  );
}

async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
