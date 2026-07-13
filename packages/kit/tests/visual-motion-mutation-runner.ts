import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const mutations = [
  {
    name: "fresh target drops its initial sample",
    search: "...(options?.from === undefined ? {} : { from: options.from }),",
    replacement: "...(options?.from === undefined ? {} : {}),",
  },
  {
    name: "fresh target never writes its initial sample",
    search: "if (operation.from !== undefined) record.adapter.write(operation.from);",
    replacement: "if (false && operation.from !== undefined) record.adapter.write(operation.from);",
  },
  {
    name: "fresh target derives artificial velocity from installing its initial sample",
    search:
      "velocity:\n        operation.velocity ?? (operation.from === undefined ? record.adapter.velocity() : 0),",
    replacement: "velocity:\n        operation.velocity ?? record.adapter.velocity(),",
  },
  {
    name: "layout animation restores preset-owned opacity",
    search: "controller.recordedProperties?.delete(property);",
    replacement: "void controller.recordedProperties;",
  },
] as const;

const oracle = `
import { expect, test } from "bun:test";
import {
  RetainedMotionGraph,
  restrictAnimeLayoutOwnership,
  type MotionBackend,
  type MotionChannelAdapter,
  type MotionScheduler,
  type MotionTarget,
} from "./visual-motion.ts";

class Scheduler implements MotionScheduler {
  callbacks: (() => void)[] = [];
  now() { return 0; }
  requestFrame(callback: () => void) { this.callbacks.push(callback); return callback; }
  cancelFrame(handle: unknown) { this.callbacks = this.callbacks.filter((entry) => entry !== handle); }
  flush() { const callbacks = this.callbacks.splice(0); for (const callback of callbacks) callback(); }
}

test("fresh retained targets install one initial sample before retargeting", () => {
  const scheduler = new Scheduler();
  const writes: number[] = [];
  const targets: MotionTarget[] = [];
  const order: string[] = [];
  let velocity = 0;
  const backend: MotionBackend = {
    create(_key, initial): MotionChannelAdapter {
      writes.push(initial);
      return {
        read: () => writes.at(-1)!,
        velocity: () => velocity,
        write(value) { writes.push(value); velocity = 9; order.push("write"); },
        retarget(target) { targets.push(target); order.push("retarget"); },
        stop() {},
        dispose() {},
      };
    },
  };
  const channel = new RetainedMotionGraph(backend, scheduler).channel("sheet:y", "sheet", 0);
  channel.target(0, { spring: { stiffness: 500 } }, { from: 420 });
  scheduler.flush();
  expect(writes).toEqual([0, 420]);
  expect(order).toEqual(["write", "retarget"]);
  expect(targets[0]).toMatchObject({ value: 0, velocity: 0 });

  channel.target(0, { spring: { stiffness: 500 } }, { from: 240, velocity: -1.25 });
  scheduler.flush();
  expect(writes.at(-1)).toBe(240);
  expect(targets[1]).toMatchObject({ value: 0, velocity: -1.25 });
});

test("layout projection cannot restore preset-owned visual channels", () => {
  const properties = new Set(["opacity", "color", "width"]);
  const recordedProperties = new Set(["opacity", "backgroundColor", "display", "height"]);
  restrictAnimeLayoutOwnership({
    children: [],
    properties,
    recordedProperties,
    record() {},
    animate() { return { pause() {} }; },
    revert() {},
  });
  expect([...properties]).toEqual(["width"]);
  expect([...recordedProperties]).toEqual(["display", "height"]);
});
`;

const sourcePath = new URL("../src/visual-motion.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const directory = await mkdtemp(join(import.meta.dir, ".visual-motion-mutations-"));
const implementationPath = join(directory, "visual-motion.ts");
const oraclePath = join(directory, "oracle.spec.ts");
const bun = Bun.which("bun") ?? process.execPath;

try {
  await writeFile(oraclePath, oracle);
  await writeFile(implementationPath, source);
  const baseline = runOracle(bun, directory, oraclePath);
  if (baseline.exitCode !== 0) {
    throw new Error(`Production motion mutation baseline failed:\n${baseline.output}`);
  }

  const survivors: string[] = [];
  for (const mutation of mutations) {
    if (!source.includes(mutation.search)) {
      throw new Error(`Production motion mutation anchor is missing: ${mutation.name}`);
    }
    await writeFile(implementationPath, source.replace(mutation.search, mutation.replacement));
    const result = runOracle(bun, directory, oraclePath);
    if (result.exitCode === 0) survivors.push(mutation.name);
  }
  if (survivors.length) {
    throw new Error(`Production motion mutation survivors:\n- ${survivors.join("\n- ")}`);
  }
  console.log(`Killed ${mutations.length}/${mutations.length} production motion mutations.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

function runOracle(
  executable: string,
  directory: string,
  specPath: string,
): { readonly exitCode: number; readonly output: string } {
  const result = Bun.spawnSync([executable, "test", specPath], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}
