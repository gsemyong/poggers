import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, parse, resolve, sep } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import {
  selectPlatformAdapters,
  type DevelopmentSession,
  type DevelopmentReporter,
  type PlatformAdapterImplementation,
  type ProductionReporter,
  type ProductionArtifacts,
  type SystemCompilationRevision,
  type SystemRevisionSource,
} from "@/adapter";
import {
  selectSystemOutputs,
  type PlatformInterfaceIR,
  type ProgramIR,
  type SystemIR,
} from "@/compiler/ir";
import {
  createSystemCompiler,
  resolveSystem,
  systemCompilerIdentity,
  type SystemCompilation,
} from "@/compiler/source";
import { createRelease, type Release } from "@/deployment";

export type SystemRealization<Adapter extends PlatformAdapterImplementation> = Readonly<{
  directory: string;
  system: string;
  ir: SystemIR;
  app?: string;
  programs: readonly ProgramIR[];
  interfaces: readonly PlatformInterfaceIR[];
  revisions: SystemRevisionSource;
  adapters: readonly Adapter[];
}>;

export type SystemRealizationOptions = Readonly<{ app?: string }>;
export type SystemDevelopmentOptions = SystemRealizationOptions &
  Readonly<{ report?: DevelopmentReporter }>;
export type SystemBuildOptions = SystemRealizationOptions &
  Readonly<{ report?: ProductionReporter }>;

export type RunningSystem = AsyncDisposable &
  Readonly<{
    ir: SystemIR;
    locations: Readonly<Record<string, readonly string[]>>;
  }>;

export type BuiltSystem = Readonly<{
  ir: SystemIR;
  directory: string;
  artifacts: Readonly<Record<string, ProductionArtifacts>>;
  release: Release;
}>;

/** Resolves one authored System into the Platform implementations it requires. */
export function resolveSystemRealization<Adapter extends PlatformAdapterImplementation>(
  directory: string,
  adapters: Readonly<Record<string, Adapter>>,
  options: SystemRealizationOptions = {},
  compilationCache = false,
): SystemRealization<Adapter> {
  const paths = resolveSystem(directory);
  const extensions = Object.values(adapters).flatMap(({ compiler = [] }) => compiler);
  const revisions = createSystemRevisionSource(paths.system, extensions, compilationCache);
  const outputs = selectSystemOutputs(revisions.current.ir, options.app);
  return {
    directory: paths.directory,
    system: paths.system,
    ir: revisions.current.ir,
    ...(outputs.app ? { app: outputs.app } : {}),
    programs: outputs.programs,
    interfaces: outputs.interfaces,
    revisions,
    adapters: selectPlatformAdapters(outputs.platforms, adapters),
  };
}

/** Starts every required Platform through the canonical development path. */
export async function developSystem<Adapter extends PlatformAdapterImplementation>(
  directory: string,
  adapters: Readonly<Record<string, Adapter>>,
  options: SystemDevelopmentOptions = {},
): Promise<RunningSystem> {
  const compilationStarted = performance.now();
  options.report?.({ kind: "phase", phase: "compile", status: "started" });
  const realization = resolveSystemRealization(directory, adapters, options, true);
  options.report?.({
    kind: "phase",
    phase: "compile",
    status: "completed",
    durationMs: performance.now() - compilationStarted,
    cache: realization.revisions.current.cache,
    work: realization.revisions.current.work,
  });
  const started = await Promise.allSettled(
    realization.adapters.map(async (adapter) => {
      const platformStarted = performance.now();
      options.report?.({
        kind: "phase",
        phase: "start",
        status: "started",
        platform: adapter.name,
      });
      const session = await adapter.develop({
        directory: realization.directory,
        system: realization.system,
        ir: realization.ir,
        ...(realization.app ? { app: realization.app } : {}),
        revisions: realization.revisions,
        ...(options.report ? { report: options.report } : {}),
        platform: adapter.name,
        programs: realization.programs.filter(
          ({ environment }) => environment.platform === adapter.name,
        ),
        interfaces: realization.interfaces.filter(({ platform }) => platform === adapter.name),
      });
      options.report?.({
        kind: "phase",
        phase: "start",
        status: "completed",
        platform: adapter.name,
        durationMs: performance.now() - platformStarted,
      });
      return { adapter, session };
    }),
  );
  const sessions = started.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failures = started.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length) {
    const disposal = await disposeDevelopmentSessions(sessions.map(({ session }) => session));
    failures.push(...disposal);
    throwFailures(failures, "System development startup failed.");
  }

  let disposed = false;
  return {
    ir: realization.ir,
    get locations() {
      return collectDevelopmentLocations(sessions);
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      const failures = await disposeDevelopmentSessions(sessions.map(({ session }) => session));
      throwFailures(failures, "System disposal failed.");
    },
  };
}

/** @internal Retains one compiler and identifies the exact outputs affected by each edit. */
export function createSystemRevisionSource(
  system: string,
  extensions: Parameters<typeof createSystemCompiler>[1],
  cache: boolean | string = false,
): SystemRevisionSource {
  const compiler = createSystemCompiler(system, extensions);
  const compilerIdentity = systemCompilerIdentity(extensions);
  const cachePath =
    typeof cache === "string"
      ? resolve(cache)
      : cache
        ? systemCompilationCachePath(system)
        : undefined;
  const cached = cachePath ? readSystemCompilationCache(cachePath, compilerIdentity) : undefined;
  let revision = 0;
  let current: RetainedSystemCompilationRevision;
  let cacheInputs: Readonly<Record<string, string>>;
  if (cached?.exact) {
    compiler.restore(cached.compilation);
    cacheInputs = cached.inputs;
    current = {
      ...cached.compilation,
      revision,
      inputIdentity: systemCompilationInputIdentity(compilerIdentity, cacheInputs),
      cache: "hit",
    };
  } else {
    if (cached) compiler.restore(cached.compilation);
    const compilation = compiler.compile();
    cacheInputs = systemCompilationSignatures(system, compilation.sourceFiles);
    if (cachePath) {
      writeSystemCompilationCache(cachePath, compilerIdentity, compilation, cacheInputs);
    }
    current = {
      ...compilation,
      revision,
      inputIdentity: systemCompilationInputIdentity(compilerIdentity, cacheInputs),
      cache: "miss",
    };
  }
  const signatures = new Map<string, string>();
  retainOutputSignatures(signatures, current);
  return {
    get current() {
      return current;
    },
    compile(changedFile) {
      const source = canonicalSourceFile(changedFile);
      const signature = sourceSignature(source);
      if (signatures.get(source) === signature) return current;
      const previous = current;
      const compiled = compiler.compile(changedFile);
      cacheInputs = updateSystemCompilationSignatures(
        system,
        previous,
        compiled,
        cacheInputs,
        source,
      );
      current = {
        ...compiled,
        revision: ++revision,
        inputIdentity: systemCompilationInputIdentity(compilerIdentity, cacheInputs),
        cache: "miss",
        change: {
          source,
          outputs: affectedOutputs(previous, compiled, changedFile),
        },
      };
      signatures.set(source, signature);
      retainOutputSignatures(signatures, current);
      if (cachePath) {
        writeSystemCompilationCache(cachePath, compilerIdentity, compiled, cacheInputs);
      }
      return current;
    },
  };
}

type RetainedSystemCompilationRevision = SystemCompilationRevision &
  Pick<SystemCompilation, "semanticGraph">;

const SYSTEM_COMPILATION_CACHE_VERSION = 6;
const SYSTEM_COMPILATION_CACHE_RETAINED_OBJECTS = 64;
const SYSTEM_COMPILATION_CACHE_HARD_LIMIT = 96;
const SYSTEM_COMPILATION_CACHE_RETAINED_BYTES = 32 * 1024 * 1024;
const SYSTEM_COMPILATION_CACHE_HARD_BYTES = 48 * 1024 * 1024;

type CachedSystemCompilation = Readonly<{
  version: number;
  compiler: string;
  inputs: Readonly<Record<string, string>>;
  compilation: Readonly<{
    ir: string;
    outputSources: SystemCompilation["outputSources"];
    sourceFiles: readonly string[];
    features: readonly Readonly<{ id: string; object: string }>[];
  }>;
}>;

type LoadedSystemCompilationCache = Readonly<{
  compilation: SystemCompilation;
  inputs: Readonly<Record<string, string>>;
  exact: boolean;
}>;

function readSystemCompilationCache(
  path: string,
  compiler: string,
): LoadedSystemCompilationCache | undefined {
  try {
    const cached = JSON.parse(readFileSync(path, "utf8")) as CachedSystemCompilation;
    if (cached.version !== SYSTEM_COMPILATION_CACHE_VERSION || cached.compiler !== compiler) {
      return undefined;
    }
    const root = systemCompilationObjectDirectory(path);
    const ir = readSystemCompilationObject<SystemCompilation["ir"]>(root, cached.compilation.ir);
    const features = cached.compilation.features.map(({ id, object }) => {
      const feature = readSystemCompilationObject<
        SystemCompilation["semanticGraph"]["features"][number]
      >(root, object);
      if (feature.id !== id) throw new TypeError("Cached Feature identity does not match.");
      return feature;
    });
    const invalid = new Set(
      Object.entries(cached.inputs)
        .filter(([source, signature]) => sourceSignature(source) !== signature)
        .map(([source]) => source),
    );
    const semanticSources = new Set(features.flatMap(({ sourceFiles }) => sourceFiles));
    const globallyInvalid = [...invalid].some((source) => !semanticSources.has(source));
    const semanticGraph = globallyInvalid
      ? { version: 1 as const, features: [] }
      : {
          version: 1 as const,
          features: features.filter((unit) =>
            unit.sourceFiles.every((source) => !invalid.has(source)),
          ),
        };
    return {
      inputs: cached.inputs,
      exact: invalid.size === 0,
      compilation: {
        ir,
        outputSources: cached.compilation.outputSources,
        sourceFiles: Object.freeze([...cached.compilation.sourceFiles]),
        semanticGraph,
        work: {
          features: {
            compiled: 0,
            reused: semanticGraph.features.length,
          },
          files: {
            diagnosed: 0,
            total: cached.compilation.sourceFiles.length,
          },
        },
      },
    };
  } catch {
    return undefined;
  }
}

function writeSystemCompilationCache(
  path: string,
  compiler: string,
  compilation: SystemCompilation,
  inputs: Readonly<Record<string, string>>,
): void {
  const root = systemCompilationObjectDirectory(path);
  const ir = writeSystemCompilationObject(root, compilation.ir);
  const features = compilation.semanticGraph.features.map((feature) => ({
    id: feature.id,
    object: writeSystemCompilationObject(root, feature),
  }));
  const cached: CachedSystemCompilation = {
    version: SYSTEM_COMPILATION_CACHE_VERSION,
    compiler,
    inputs,
    compilation: {
      ir,
      outputSources: compilation.outputSources,
      sourceFiles: compilation.sourceFiles,
      features,
    },
  };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(cached));
  renameSync(temporary, path);
  retainSystemCompilationObjects(root, new Set([ir, ...features.map(({ object }) => object)]));
}

function systemCompilationObjectDirectory(manifest: string): string {
  return resolve(dirname(manifest), "objects");
}

function writeSystemCompilationObject(directory: string, value: unknown): string {
  const source = JSON.stringify(value);
  const identity = createHash("sha256").update(source).digest("hex");
  const path = resolve(directory, `${identity}.json.br`);
  try {
    if (brotliDecompressSync(readFileSync(path)).toString() === source) return identity;
  } catch {}
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    brotliCompressSync(source, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
      },
    }),
  );
  renameSync(temporary, path);
  return identity;
}

function readSystemCompilationObject<Value>(directory: string, identity: string): Value {
  if (!/^[a-f0-9]{64}$/.test(identity)) {
    throw new TypeError("Invalid cached compilation object identity.");
  }
  const source = brotliDecompressSync(
    readFileSync(resolve(directory, `${identity}.json.br`)),
  ).toString();
  if (createHash("sha256").update(source).digest("hex") !== identity) {
    throw new TypeError("Cached compilation object does not match its identity.");
  }
  return JSON.parse(source) as Value;
}

function retainSystemCompilationObjects(directory: string, retained: ReadonlySet<string>): void {
  let entries: readonly Readonly<{
    identity: string;
    modified: number;
    bytes: number;
  }>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isFile()) return false;
        if (/^[a-f0-9]{64}\.json$/.test(entry.name)) {
          rmSync(resolve(directory, entry.name), { force: true });
          return false;
        }
        return /^[a-f0-9]{64}\.json\.br$/.test(entry.name);
      })
      .map((entry) => {
        const statistics = statSync(resolve(directory, entry.name));
        return {
          identity: entry.name.slice(0, -8),
          modified: statistics.mtimeMs,
          bytes: statistics.size,
        };
      });
  } catch {
    return;
  }
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  if (
    entries.length <= SYSTEM_COMPILATION_CACHE_HARD_LIMIT &&
    bytes <= SYSTEM_COMPILATION_CACHE_HARD_BYTES
  ) {
    return;
  }
  const removable = entries
    .filter(({ identity }) => !retained.has(identity))
    .sort((left, right) => left.modified - right.modified);
  let count = entries.length;
  for (const { identity, bytes: objectBytes } of removable) {
    if (
      count <= SYSTEM_COMPILATION_CACHE_RETAINED_OBJECTS &&
      bytes <= SYSTEM_COMPILATION_CACHE_RETAINED_BYTES
    ) {
      break;
    }
    rmSync(resolve(directory, `${identity}.json.br`), { force: true });
    count -= 1;
    bytes -= objectBytes;
  }
}

function systemCompilationSignatures(
  system: string,
  sources: readonly string[],
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      systemCompilationInputs(system, sources).map((source) => [source, sourceSignature(source)]),
    ),
  );
}

function systemCompilationInputIdentity(
  compiler: string,
  inputs: Readonly<Record<string, string>>,
): string {
  return createHash("sha256").update(JSON.stringify({ compiler, inputs })).digest("hex");
}

function updateSystemCompilationSignatures(
  system: string,
  previous: Pick<SystemCompilationRevision, "sourceFiles">,
  current: Pick<SystemCompilation, "sourceFiles">,
  inputs: Readonly<Record<string, string>>,
  changedFile: string,
): Readonly<Record<string, string>> {
  if (
    previous.sourceFiles.length !== current.sourceFiles.length ||
    previous.sourceFiles.some((source, index) => source !== current.sourceFiles[index])
  ) {
    return systemCompilationSignatures(system, current.sourceFiles);
  }
  const source = canonicalSourceFile(changedFile);
  if (!(source in inputs)) return systemCompilationSignatures(system, current.sourceFiles);
  return Object.freeze({ ...inputs, [source]: sourceSignature(source) });
}

function systemCompilationInputs(system: string, sources: readonly string[]): readonly string[] {
  const inputs = new Set(
    sources
      .map(canonicalSourceFile)
      .filter((source) => !source.includes(`${sep}node_modules${sep}`)),
  );
  for (const name of ["tsconfig.json", "package.json", "nub.lock"]) {
    const path = nearestFile(dirname(system), name);
    if (path) inputs.add(path);
  }
  for (const source of sources) {
    const manifest = nearestFile(dirname(source), "package.json");
    if (manifest) inputs.add(manifest);
  }
  return Object.freeze([...inputs].sort());
}

function nearestFile(directory: string, name: string): string | undefined {
  let current = resolve(directory);
  while (true) {
    const candidate = resolve(current, name);
    try {
      if (readFileSync(candidate).length >= 0) return canonicalSourceFile(candidate);
    } catch {}
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return undefined;
    current = parent;
  }
}

function systemCompilationCachePath(system: string): string {
  return resolve(dirname(system), "../.kit/cache/compiler/system.json");
}

function retainOutputSignatures(
  signatures: Map<string, string>,
  revision: SystemCompilationRevision,
): void {
  for (const source of new Set(Object.values(revision.outputSources).flat())) {
    if (!signatures.has(source)) signatures.set(source, sourceSignature(source));
  }
}

function sourceSignature(source: string): string {
  try {
    return createHash("sha256").update(readFileSync(source)).digest("hex");
  } catch {
    return "<missing>";
  }
}

function affectedOutputs(
  previous: Pick<RetainedSystemCompilationRevision, "ir" | "outputSources" | "semanticGraph">,
  current: Pick<RetainedSystemCompilationRevision, "ir" | "outputSources" | "semanticGraph">,
  changedFile: string,
): readonly string[] {
  const source = canonicalSourceFile(changedFile);
  const identities = new Set([
    ...Object.keys(previous.outputSources),
    ...Object.keys(current.outputSources),
  ]);
  const affected = new Set<string>();
  for (const identity of identities) {
    if (
      outputConsumesSource(previous, identity, source) ||
      outputConsumesSource(current, identity, source) ||
      outputMeaning(previous.ir, identity) !== outputMeaning(current.ir, identity)
    ) {
      affected.add(identity);
    }
  }
  if (JSON.stringify(previous.ir.system) !== JSON.stringify(current.ir.system)) {
    identities.forEach((identity) => affected.add(identity));
  }
  const programs = new Set([...affected].filter((identity) => identity.startsWith("program/")));
  for (const ir of [previous.ir, current.ir]) {
    for (const program of ir.programs) {
      if (!programs.has(program.id) || !program.interface) continue;
      const interface_ = ir.interfaces.find(({ path }) => path === program.interface);
      if (interface_) affected.add(interface_.id);
    }
  }
  return Object.freeze([...affected].sort());
}

function outputConsumesSource(
  compilation: Pick<SystemCompilation, "ir" | "outputSources" | "semanticGraph">,
  identity: string,
  source: string,
): boolean {
  const { ir } = compilation;
  const direct = new Set<string>();
  const retainProgram = (program: ProgramIR): void => {
    const contributions = new Set(program.contributions.map(({ id }) => id));
    for (const unit of compilation.semanticGraph.features) {
      for (const contribution of unit.programs) {
        if (!contributions.has(contribution.id)) continue;
        contribution.extensionSources?.forEach((path) => direct.add(canonicalSourceFile(path)));
      }
    }
  };
  if (identity.startsWith("program/")) {
    const program = ir.programs.find(({ id }) => id === identity);
    if (program) retainProgram(program);
  } else {
    const interface_ = ir.interfaces.find(({ id }) => id === identity);
    for (const unit of compilation.semanticGraph.features) {
      for (const candidate of unit.interfaces) {
        if (candidate.path !== interface_?.path) continue;
        candidate.extensionSources?.forEach((path) => direct.add(canonicalSourceFile(path)));
      }
    }
    for (const program of ir.programs) {
      if (program.interface === interface_?.path) retainProgram(program);
    }
  }
  return (
    direct.size > 0 &&
    (direct.has(source) || compilation.outputSources[identity]?.includes(source) === true)
  );
}

function outputMeaning(ir: SystemIR, identity: string): string {
  if (identity.startsWith("program/")) {
    return JSON.stringify(ir.programs.find(({ id }) => id === identity));
  }
  const interface_ = ir.interfaces.find(({ id }) => id === identity);
  if (!interface_) return "undefined";
  return JSON.stringify(interface_);
}

function canonicalSourceFile(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** Builds every required Platform through the canonical production path. */
export async function buildSystem(
  directory: string,
  output: string,
  adapters: Readonly<Record<string, PlatformAdapterImplementation>>,
  options: SystemBuildOptions = {},
): Promise<BuiltSystem> {
  const compilationStarted = performance.now();
  options.report?.({ kind: "phase", phase: "compile", status: "started" });
  const realization = resolveSystemRealization(directory, adapters, options, true);
  options.report?.({
    kind: "phase",
    phase: "compile",
    status: "completed",
    durationMs: performance.now() - compilationStarted,
    cache: realization.revisions.current.cache,
    work: realization.revisions.current.work,
  });
  const results = await Promise.all(
    realization.adapters.map(async (adapter) => {
      const platformStarted = performance.now();
      options.report?.({
        kind: "phase",
        phase: "build",
        status: "started",
        platform: adapter.name,
      });
      const platformOutput =
        realization.adapters.length === 1 ? output : resolve(output, adapter.name);
      const artifacts = await adapter.build({
        directory: realization.directory,
        system: realization.system,
        ir: realization.ir,
        ...(realization.app ? { app: realization.app } : {}),
        platform: adapter.name,
        programs: realization.programs.filter(
          ({ environment }) => environment.platform === adapter.name,
        ),
        interfaces: realization.interfaces.filter(({ platform }) => platform === adapter.name),
        compilation: {
          inputIdentity: realization.revisions.current.inputIdentity,
          outputSources: realization.revisions.current.outputSources,
          sourceFiles: realization.revisions.current.sourceFiles,
        },
        output: platformOutput,
        ...(options.report ? { report: options.report } : {}),
      });
      options.report?.({
        kind: "phase",
        phase: "build",
        status: "completed",
        platform: adapter.name,
        durationMs: performance.now() - platformStarted,
      });
      return [adapter.name, artifacts] as const;
    }),
  );
  const artifacts = Object.freeze(Object.fromEntries(results));
  const releaseStarted = performance.now();
  options.report?.({ kind: "phase", phase: "release", status: "started" });
  const release = await createRelease({
    directory: output,
    system: realization.ir.system.name,
    ...(realization.app ? { app: realization.app } : {}),
    artifacts,
  });
  options.report?.({
    kind: "phase",
    phase: "release",
    status: "completed",
    durationMs: performance.now() - releaseStarted,
  });
  return {
    ir: realization.ir,
    directory: output,
    artifacts,
    release,
  };
}

function collectDevelopmentLocations(
  sessions: readonly Readonly<{
    adapter: PlatformAdapterImplementation;
    session: DevelopmentSession;
  }>[],
): Readonly<Record<string, readonly string[]>> {
  const locations = new Map<string, readonly string[]>();
  for (const { adapter, session } of sessions) {
    for (const [identity, values] of Object.entries(session.locations)) {
      if (locations.has(identity)) {
        throw new Error(
          `Platform Adapter ${JSON.stringify(adapter.name)} returned duplicate output identity ${JSON.stringify(identity)}.`,
        );
      }
      locations.set(identity, values);
    }
  }
  return Object.freeze(
    Object.fromEntries([...locations].sort(([left], [right]) => left.localeCompare(right))),
  );
}

async function disposeDevelopmentSessions(
  sessions: readonly DevelopmentSession[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const session of [...sessions].reverse()) {
    try {
      await session[Symbol.asyncDispose]();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}
