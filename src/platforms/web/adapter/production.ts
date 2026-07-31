import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type { PlatformProductionInput, ProductionArtifact, ProductionArtifacts } from "@/adapter";
import { linkProgram } from "@/compiler/linker";
import type { WebPlatform } from "@/platforms/web";
import { buildWebInterface, type WebBuild } from "@/platforms/web/adapter/pipeline";

const WEB_PRODUCTION_ARTIFACT_VERSION = 7;
const WEB_PRODUCTION_CACHE_RETAINED_ARTIFACTS = 12;
const WEB_PRODUCTION_CACHE_HARD_LIMIT = 16;
const WEB_PRODUCTION_CACHE_MANIFEST = "manifest.json";
const WEB_PRODUCTION_CACHE_OUTPUT = "artifact";

type CachedWebArtifact = Readonly<{
  version: typeof WEB_PRODUCTION_ARTIFACT_VERSION;
  identity: string;
  files: Readonly<Record<string, string>>;
  entries: readonly (Omit<ProductionArtifact, "path" | "entrypoint"> &
    Readonly<{ path: string; entrypoint?: string }>)[];
}>;

/** Emits one isolated production tree for every selected web interface. */
export async function buildWebSystem(
  input: PlatformProductionInput<WebPlatform>,
): Promise<ProductionArtifacts> {
  const interfaces = input.interfaces;
  await rm(input.output, { recursive: true, force: true });
  await mkdir(input.output, { recursive: true });
  const builds = await Promise.all(
    interfaces.map((interface_) =>
      buildCachedWebInterface(
        input,
        interface_.id,
        resolve(input.output, "interfaces", encodeURIComponent(interface_.path)),
      ),
    ),
  );
  return {
    directory: input.output,
    entries: Object.freeze(
      builds.flatMap(({ entries }) =>
        entries.map((entry) => {
          if (entry.kind !== "program") return entry;
          const program = input.programs.find(({ id }) => id === entry.identity);
          if (!program) {
            throw new Error(
              `Web production emitted unknown Program ${JSON.stringify(entry.identity)}.`,
            );
          }
          return {
            ...entry,
            dependencies: Object.freeze(
              linkProgram(program)
                .external.map(({ name }) => name)
                .sort(),
            ),
          };
        }),
      ),
    ),
  };
}

async function buildCachedWebInterface(
  input: PlatformProductionInput<WebPlatform>,
  interfaceId: string,
  outdir: string,
): Promise<WebBuild> {
  const started = performance.now();
  const identity = webProductionIdentity(input, interfaceId);
  const root = resolve(input.directory, ".kit/cache/web/artifacts");
  const cached = resolve(root, identity);
  const retained = await readCachedWebArtifact(cached, identity);
  if (retained) {
    await copyCachedWebArtifact(cached, outdir);
    await utimes(cached, new Date(), new Date()).catch(() => undefined);
    input.report?.({
      kind: "artifact",
      platform: "web",
      identity: interfaceId,
      path: outdir,
      cache: "hit",
      durationMs: performance.now() - started,
    });
    return restoreCachedWebBuild(retained, outdir);
  }

  await rm(cached, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const temporary = resolve(root, `.${identity}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const output = resolve(temporary, WEB_PRODUCTION_CACHE_OUTPUT);
    const built = await buildWebInterface({
      directory: input.directory,
      outdir: output,
      interface: interfaceId,
      ir: input.ir,
      report: input.report,
    });
    const manifest = await cacheWebBuild(identity, built);
    await writeFile(
      resolve(temporary, WEB_PRODUCTION_CACHE_MANIFEST),
      `${JSON.stringify(manifest)}\n`,
    );
    try {
      await rename(temporary, cached);
    } catch {
      if (!(await readCachedWebArtifact(cached, identity))) throw new Error("cache race");
      await rm(temporary, { recursive: true, force: true });
    }
    const completed = (await readCachedWebArtifact(cached, identity)) ?? manifest;
    await copyCachedWebArtifact(cached, outdir);
    await retainWebProductionArtifacts(root, identity);
    input.report?.({
      kind: "artifact",
      platform: "web",
      identity: interfaceId,
      path: outdir,
      cache: "miss",
      durationMs: performance.now() - started,
    });
    return restoreCachedWebBuild(completed, outdir);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function webProductionIdentity(
  input: PlatformProductionInput<WebPlatform>,
  interfaceId: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: WEB_PRODUCTION_ARTIFACT_VERSION,
        compilation: input.compilation.inputIdentity,
        interface: interfaceId,
        application: input.app ?? null,
      }),
    )
    .digest("hex");
}

async function cacheWebBuild(identity: string, build: WebBuild): Promise<CachedWebArtifact> {
  const directory = resolve(build.directory);
  return Object.freeze({
    version: WEB_PRODUCTION_ARTIFACT_VERSION,
    identity,
    files: Object.freeze(await webArtifactFiles(directory)),
    entries: Object.freeze(
      build.entries.map(({ path, entrypoint, ...entry }) =>
        Object.freeze({
          ...entry,
          path: cachedWebPath(directory, path),
          ...(entrypoint ? { entrypoint: cachedWebPath(directory, entrypoint) } : {}),
        }),
      ),
    ),
  });
}

async function readCachedWebArtifact(
  directory: string,
  identity: string,
): Promise<CachedWebArtifact | undefined> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(directory, WEB_PRODUCTION_CACHE_MANIFEST), "utf8"),
    ) as CachedWebArtifact;
    if (
      manifest.version !== WEB_PRODUCTION_ARTIFACT_VERSION ||
      manifest.identity !== identity ||
      !manifest.files ||
      !Array.isArray(manifest.entries)
    ) {
      return undefined;
    }
    const output = resolve(directory, WEB_PRODUCTION_CACHE_OUTPUT);
    for (const [path, expected] of Object.entries(manifest.files)) {
      if (!safeCachedWebPath(path)) return undefined;
      const actual = createHash("sha256")
        .update(await readFile(resolve(output, path)))
        .digest("hex");
      if (actual !== expected) return undefined;
    }
    for (const entry of manifest.entries) {
      if (!safeCachedWebPath(entry.path)) return undefined;
      await stat(resolve(output, entry.path));
      if (entry.entrypoint) {
        if (!safeCachedWebPath(entry.entrypoint)) return undefined;
        await stat(resolve(output, entry.entrypoint));
      }
    }
    return Object.freeze(manifest);
  } catch {
    return undefined;
  }
}

async function copyCachedWebArtifact(cache: string, outdir: string): Promise<void> {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(dirname(outdir), { recursive: true });
  await cp(resolve(cache, WEB_PRODUCTION_CACHE_OUTPUT), outdir, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}

function restoreCachedWebBuild(manifest: CachedWebArtifact, outdir: string): WebBuild {
  return Object.freeze({
    directory: outdir,
    entries: Object.freeze(
      manifest.entries.map(({ path, entrypoint, ...entry }) =>
        Object.freeze({
          ...entry,
          path: resolve(outdir, path),
          ...(entrypoint ? { entrypoint: resolve(outdir, entrypoint) } : {}),
        }),
      ),
    ),
  });
}

async function webArtifactFiles(directory: string): Promise<Readonly<Record<string, string>>> {
  const files = await collectWebArtifactFiles(directory);
  return Object.fromEntries(
    await Promise.all(
      files.map(async (path) => [
        relative(directory, path),
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
}

async function collectWebArtifactFiles(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectWebArtifactFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function cachedWebPath(directory: string, path: string): string {
  const value = relative(directory, resolve(path)) || ".";
  if (!safeCachedWebPath(value)) throw new Error("Web artifact escapes its cache directory.");
  return value;
}

function safeCachedWebPath(path: string): boolean {
  return (
    path === "." ||
    (path.length > 0 &&
      path !== ".." &&
      !path.startsWith(`..${sep}`) &&
      !path.startsWith("/") &&
      !path.includes("\0"))
  );
}

async function retainWebProductionArtifacts(root: string, retained: string): Promise<void> {
  let entries: readonly Readonly<{ identity: string; modified: number }>[];
  try {
    entries = await Promise.all(
      (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
        .map(async (entry) => ({
          identity: entry.name,
          modified: (await stat(resolve(root, entry.name))).mtimeMs,
        })),
    );
  } catch {
    return;
  }
  if (entries.length <= WEB_PRODUCTION_CACHE_HARD_LIMIT) return;
  const remove = entries
    .filter(({ identity }) => identity !== retained)
    .sort((left, right) => left.modified - right.modified)
    .slice(0, Math.max(0, entries.length - WEB_PRODUCTION_CACHE_RETAINED_ARTIFACTS));
  await Promise.all(
    remove.map(({ identity }) => rm(resolve(root, identity), { recursive: true, force: true })),
  );
}
