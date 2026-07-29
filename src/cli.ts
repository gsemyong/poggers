#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import type { DevelopmentEvent, PlatformAdapterImplementation, ProductionEvent } from "@/adapter";
import type { System, SystemContract } from "@/core/system";
import type { Deployment, DeploymentAdapter, DeploymentPlan, DeploymentState } from "@/deployment";

const valueFlags = new Set([
  "deployment",
  "dir",
  "example",
  "name",
  "outdir",
  "outfile",
  "package",
]);
const ignoredTemplateEntries = new Set([".kit", "dist", "node_modules", "nub.lock"]);
const ignoredExampleEntries = new Set([
  ...ignoredTemplateEntries,
  "tsconfig.json",
  "tsconfig.tsbuildinfo",
]);
const workspaceDirectories = ["src/apps", "src/features", "src/presentations"] as const;
const tools = {
  format: () => packageExecutable("oxfmt", "bin/oxfmt"),
  lint: () => packageExecutable("oxlint", "bin/oxlint"),
  test: () => packageExecutable("vitest", "vitest.mjs"),
  typecheck: () => packageExecutable("typescript", "bin/tsc"),
} as const;

export async function runCli(
  arguments_ = process.argv.slice(2),
  adapters?: Readonly<Record<string, PlatformAdapterImplementation>>,
): Promise<void> {
  const [command = "dev", ...commandArguments] = arguments_;
  const directory = resolve(readFlag(commandArguments, "dir") ?? process.cwd());
  const app = positionalArguments(commandArguments)[0];
  const output = new CommandOutput(commandArguments.includes("--json"));

  if (command === "create") {
    await createProject(commandArguments);
  } else if (command === "dev") {
    const started = performance.now();
    output.phase("runtime", "Load development runtime", "started");
    const [{ developSystem }, selectedAdapters] = await Promise.all([
      import("@/realization"),
      resolvePlatformAdapters(adapters),
    ]);
    output.phase("runtime", "Load development runtime", "completed", performance.now() - started);
    const system = await developSystem(directory, selectedAdapters, {
      ...(app ? { app } : {}),
      report: (event) => output.development(event),
    });
    for (const [identity, locations] of Object.entries(system.locations)) {
      for (const location of locations) output.location(identity, location);
    }
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      output.phase("stop", "Stop development", "started");
      await system[Symbol.asyncDispose]();
      output.phase("stop", "Stop development", "completed");
      process.exit();
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
  } else if (command === "build") {
    const started = performance.now();
    output.phase("runtime", "Load production runtime", "started");
    const [{ buildSystem }, selectedAdapters] = await Promise.all([
      import("@/realization"),
      resolvePlatformAdapters(adapters),
    ]);
    output.phase("runtime", "Load production runtime", "completed", performance.now() - started);
    const root = resolve(
      directory,
      readFlag(commandArguments, "outdir") ?? readFlag(commandArguments, "outfile") ?? "dist",
    );
    const system = await buildSystem(directory, root, selectedAdapters, {
      ...(app ? { app } : {}),
      report: (event) => output.production(event),
    });
    for (const [platform, artifacts] of Object.entries(system.artifacts)) {
      output.built(platform, artifacts.directory);
    }
  } else if (command === "deploy") {
    const started = performance.now();
    output.phase("runtime", "Load deployment runtime", "started");
    const selectedAdapters = await resolvePlatformAdapters(adapters);
    output.phase("runtime", "Load deployment runtime", "completed", performance.now() - started);
    await runDeploymentCli(directory, commandArguments, selectedAdapters, app, output);
  } else if (command === "typecheck") {
    const code = await run([process.execPath, tools.typecheck(), "-p", "tsconfig.json"], directory);
    process.exitCode = code;
    if (code === 0) {
      const [{ resolveSystemRealization }, selectedAdapters] = await Promise.all([
        import("@/realization"),
        resolvePlatformAdapters(adapters),
      ]);
      resolveSystemRealization(directory, selectedAdapters, app ? { app } : {});
    }
  } else if (command === "test") {
    const framework = await findPackageDirectory(import.meta.dirname);
    process.exitCode = await run(
      [
        process.execPath,
        tools.test(),
        "run",
        "--root",
        directory,
        "--config",
        resolve(framework, "config/vitest.ts"),
      ],
      directory,
    );
  } else if (command === "format") {
    const framework = await findPackageDirectory(import.meta.dirname);
    process.exitCode = await run(
      [process.execPath, tools.format(), "--config", resolve(framework, "config/format.json"), "."],
      directory,
    );
  } else if (command === "check") {
    const framework = await findPackageDirectory(import.meta.dirname);
    const commands = [
      [process.execPath, tools.typecheck(), "-p", "tsconfig.json"],
      [
        process.execPath,
        tools.lint(),
        "--config",
        resolve(framework, "config/lint.json"),
        "--disable-nested-config",
        "src",
      ],
      [
        process.execPath,
        tools.format(),
        "--config",
        resolve(framework, "config/format.json"),
        "--check",
        ".",
      ],
      [
        process.execPath,
        tools.test(),
        "run",
        "--root",
        directory,
        "--config",
        resolve(framework, "config/vitest.ts"),
      ],
    ];
    for (const current of commands) {
      const code = await run(current, directory);
      if (code !== 0) {
        process.exitCode = code;
        return;
      }
    }
    const [{ resolveSystemRealization }, selectedAdapters] = await Promise.all([
      import("@/realization"),
      resolvePlatformAdapters(adapters),
    ]);
    resolveSystemRealization(directory, selectedAdapters, app ? { app } : {});
  } else {
    output.error(
      "Usage: kit <dev [app]|build [app]|deploy [app] [--plan|--status|--remove]> [--json] | kit <typecheck|test|format|check|create>",
    );
    process.exitCode = 1;
  }
}

async function resolvePlatformAdapters(
  adapters?: Readonly<Record<string, PlatformAdapterImplementation>>,
): Promise<Readonly<Record<string, PlatformAdapterImplementation>>> {
  return adapters ?? (await import("@/platforms")).platformAdapters;
}

type DevelopmentPhaseEvent = Extract<DevelopmentEvent, Readonly<{ kind: "phase" }>>;

type CommandRecord =
  | Readonly<{
      kind: "phase";
      id: string;
      label: string;
      status: "started" | "completed";
      durationMs?: number;
      detail?: string;
      platform?: string;
      cache?: "hit" | "miss";
      work?: DevelopmentPhaseEvent["work"];
    }>
  | Readonly<{
      kind: "diagnostic";
      severity: "error" | "warning";
      message: string;
      platform?: string;
    }>
  | Readonly<{
      kind: "update";
      platform: string;
      scope: string;
      outputs: readonly string[];
      durationMs: number;
    }>
  | Readonly<{ kind: "location"; identity: string; location: string }>
  | Readonly<{ kind: "built"; platform: string; directory: string }>
  | Readonly<{
      kind: "artifact";
      platform: string;
      identity: string;
      path: string;
      cache?: "hit" | "miss";
      durationMs?: number;
    }>
  | Readonly<{
      kind: "deployment";
      action: "status" | "plan" | "apply" | "remove";
      adapter: string;
      value: DeploymentPlan | DeploymentState | undefined;
    }>;

/**
 * Renders one structured command stream. Interactive terminals receive one
 * transient status row; redirected output and agents receive stable records.
 */
class CommandOutput {
  readonly #json: boolean;
  readonly #interactive: boolean;
  readonly #color: boolean;
  readonly #active = new Map<string, string>();
  #transient = false;

  constructor(json: boolean) {
    this.#json = json;
    this.#interactive = !json && Boolean(process.stdout.isTTY);
    this.#color = this.#interactive && !("NO_COLOR" in process.env);
  }

  phase(
    id: string,
    label: string,
    status: "started" | "completed",
    durationMs?: number,
    detail?: string,
    facts: Readonly<{
      platform?: string;
      cache?: "hit" | "miss";
      work?: DevelopmentPhaseEvent["work"];
    }> = {},
  ): void {
    const event: CommandRecord = {
      kind: "phase",
      id,
      label,
      status,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(detail ? { detail } : {}),
      ...(facts.platform ? { platform: facts.platform } : {}),
      ...(facts.cache ? { cache: facts.cache } : {}),
      ...(facts.work ? { work: facts.work } : {}),
    };
    if (this.#json) {
      this.#record(event);
      return;
    }
    if (status === "started") {
      this.#active.set(id, label);
      if (this.#interactive) this.#renderActive();
      else this.#writeLine(`[....] ${label}`);
      return;
    }
    this.#active.delete(id);
    const suffix = [durationMs === undefined ? "" : formatDuration(durationMs), detail ?? ""]
      .filter(Boolean)
      .join(" | ");
    this.#writeLine(
      `${this.#paint(32, "[done]")} ${label}${suffix ? ` ${this.#paint(2, suffix)}` : ""}`,
    );
  }

  development(event: DevelopmentEvent): void {
    if (event.kind === "phase") {
      const id =
        event.phase === "compile"
          ? "development:compile"
          : `development:start:${event.platform ?? "platform"}`;
      const label =
        event.phase === "compile"
          ? "Compile system"
          : `Start ${event.platform ?? "platform"} development`;
      this.phase(
        id,
        label,
        event.status,
        event.durationMs,
        event.status === "completed" && event.phase === "compile"
          ? compilationDetail(event)
          : undefined,
        {
          ...(event.platform ? { platform: event.platform } : {}),
          ...(event.cache ? { cache: event.cache } : {}),
          ...(event.work ? { work: event.work } : {}),
        },
      );
      return;
    }
    if (event.kind === "diagnostic") {
      this.#diagnostic(event);
      return;
    }
    const record: CommandRecord = { ...event };
    if (this.#json) {
      this.#record(record);
      return;
    }
    const outputs = event.outputs.length ? ` ${event.outputs.join(", ")}` : "";
    const mode = event.mode ? `:${event.mode}` : "";
    this.#writeLine(
      `${this.#paint(36, "[hmr ]")} ${event.platform} ${event.scope}${mode}${outputs} ${this.#paint(
        2,
        formatDuration(event.durationMs),
      )}`,
    );
  }

  production(event: ProductionEvent): void {
    if (event.kind === "phase") {
      const id = `production:${event.phase}:${event.platform ?? "system"}`;
      const label =
        event.phase === "compile"
          ? "Compile system"
          : event.phase === "release"
            ? "Create release"
            : `Build ${event.platform ?? "platform"}`;
      this.phase(
        id,
        label,
        event.status,
        event.durationMs,
        undefined,
        event.platform ? { platform: event.platform } : {},
      );
      return;
    }
    if (event.kind === "diagnostic") {
      this.#diagnostic(event);
      return;
    }
    const record: CommandRecord = event;
    if (this.#json) {
      this.#record(record);
      return;
    }
    const cache = event.cache ? `cache ${event.cache}` : "";
    const duration = event.durationMs === undefined ? "" : formatDuration(event.durationMs);
    const detail = [cache, duration].filter(Boolean).join(" | ");
    this.#writeLine(
      `${this.#paint(36, "[file]")} ${event.platform} ${event.identity} -> ${event.path}${
        detail ? ` ${this.#paint(2, detail)}` : ""
      }`,
    );
  }

  location(identity: string, location: string): void {
    const event: CommandRecord = { kind: "location", identity, location };
    if (this.#json) this.#record(event);
    else
      this.#writeLine(
        `${this.#paint(36, "[open]")} ${identity} ${this.#paint(2, "->")} ${this.#paint(
          36,
          location,
        )}`,
      );
  }

  built(platform: string, directory: string): void {
    const event: CommandRecord = { kind: "built", platform, directory };
    if (this.#json) this.#record(event);
    else
      this.#writeLine(
        `${this.#paint(36, "[out ]")} ${platform} ${this.#paint(2, "->")} ${directory}`,
      );
  }

  deployment(
    action: "status" | "plan" | "apply" | "remove",
    adapter: string,
    value: DeploymentPlan | DeploymentState | undefined,
  ): void {
    const event: CommandRecord = { kind: "deployment", action, adapter, value };
    if (this.#json) {
      this.#record(event);
      return;
    }
    if (action === "plan") {
      this.#deploymentPlan(adapter, value as DeploymentPlan);
      return;
    }
    this.#deploymentState(action, adapter, value as DeploymentState | undefined);
  }

  error(message: string): void {
    this.#diagnostic({ kind: "diagnostic", severity: "error", message });
  }

  #deploymentPlan(adapter: string, plan: DeploymentPlan): void {
    const count = plan.operations.length;
    this.#writeLine(
      `${this.#paint(36, "[plan]")} ${adapter} ${count} change${count === 1 ? "" : "s"}`,
    );
    if (!count) {
      this.#writeLine(`       ${this.#paint(2, "Deployment already matches the release.")}`);
      return;
    }
    for (const operation of plan.operations) {
      const identity = operation.artifact.identity;
      const detail =
        operation.type === "scale"
          ? `${operation.from} -> ${operation.to}`
          : "replicas" in operation && operation.replicas !== undefined
            ? `${operation.replicas} replica${operation.replicas === 1 ? "" : "s"}`
            : "";
      this.#writeLine(
        `       ${operation.type.padEnd(7)} ${identity}${detail ? ` ${this.#paint(2, detail)}` : ""}`,
      );
    }
  }

  #deploymentState(
    action: "status" | "apply" | "remove",
    adapter: string,
    state: DeploymentState | undefined,
  ): void {
    if (!state) {
      this.#writeLine(`${this.#paint(36, "[info]")} ${adapter} is not deployed`);
      return;
    }
    const status =
      action === "remove"
        ? "removed"
        : state.converged
          ? "converged"
          : state.failures.length
            ? "failed"
            : "converging";
    const marker = state.converged ? this.#paint(32, "[done]") : this.#paint(33, "[wait]");
    this.#writeLine(
      `${marker} ${adapter} ${status} ${this.#paint(2, `revision ${state.revision}`)}`,
    );
    for (const artifact of state.artifacts) {
      const processes = artifact.processes ?? [];
      const ready = processes.filter((process) => process.ready && process.healthy).length;
      const replicas = processes.length || artifact.replicas;
      const detail = replicas === undefined ? artifact.kind : `${ready}/${replicas} ready`;
      this.#writeLine(`       ${artifact.identity} ${this.#paint(2, detail)}`);
      for (const location of artifact.locations ?? []) {
        this.#writeLine(`         ${this.#paint(36, location)}`);
      }
      for (const location of processes.flatMap(({ locations = [] }) => locations)) {
        this.#writeLine(`         ${this.#paint(36, location)}`);
      }
    }
    for (const failure of state.failures) {
      this.#writeError(
        `${this.#paint(31, "[fail]")} ${failure.operation ? `${failure.operation}: ` : ""}${
          failure.message
        }`,
      );
    }
  }

  #diagnostic(
    event: Readonly<{
      kind: "diagnostic";
      severity: "error" | "warning";
      message: string;
      platform?: string;
    }>,
  ): void {
    const record: CommandRecord = event;
    if (this.#json) {
      this.#record(record, true);
      return;
    }
    const marker =
      event.severity === "error" ? this.#paint(31, "[fail]") : this.#paint(33, "[warn]");
    const platform = event.platform ? `${event.platform}: ` : "";
    this.#writeError(`${marker} ${platform}${event.message}`);
  }

  #record(event: CommandRecord, error = false): void {
    const stream = error ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(event)}\n`);
  }

  #writeLine(line: string): void {
    this.#clearTransient();
    process.stdout.write(`${line}\n`);
    this.#renderActive();
  }

  #writeError(line: string): void {
    this.#clearTransient();
    process.stderr.write(`${line}\n`);
    this.#renderActive();
  }

  #renderActive(): void {
    if (!this.#interactive || !this.#active.size) return;
    this.#clearTransient();
    const labels = [...this.#active.values()];
    const latest = labels.at(-1)!;
    const more = labels.length > 1 ? ` (+${labels.length - 1})` : "";
    process.stdout.write(`${this.#paint(36, "[....]")} ${latest}${this.#paint(2, more)}`);
    this.#transient = true;
  }

  #clearTransient(): void {
    if (!this.#transient) return;
    process.stdout.write("\r\u001B[2K");
    this.#transient = false;
  }

  #paint(code: number, value: string): string {
    return this.#color ? `\u001B[${code}m${value}\u001B[0m` : value;
  }
}

function compilationDetail(event: DevelopmentPhaseEvent): string | undefined {
  const work = event.work;
  const units = work
    ? [
        work.features.compiled ? `${work.features.compiled} compiled` : "",
        work.features.reused ? `${work.features.reused} reused` : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  return (
    [event.cache ? `cache ${event.cache}` : "", units].filter(Boolean).join(" | ") || undefined
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1) return "<1ms";
  if (durationMs < 100) return `${Math.round(durationMs * 10) / 10}ms`;
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  return `${Math.round(durationMs / 100) / 10}s`;
}

async function runDeploymentCli(
  directory: string,
  arguments_: readonly string[],
  adapters: Readonly<Record<string, PlatformAdapterImplementation>>,
  app: string | undefined,
  output: CommandOutput,
): Promise<void> {
  const [
    { applyDeployment, inspectDeployment, planDeployment, removeDeployment },
    { buildSystem },
  ] = await Promise.all([import("@/deployment"), import("@/realization")]);
  const actions = (["plan", "status", "remove"] as const).filter((name) =>
    arguments_.includes(`--${name}`),
  );
  if (actions.length > 1) {
    throw new TypeError("Select at most one of --plan, --status, or --remove.");
  }
  const deploymentStarted = performance.now();
  output.phase("deployment", "Load deployment", "started");
  const deployment = await loadDeployment(
    directory,
    readFlag(arguments_, "deployment") ?? "src/deployment.ts",
  );
  output.phase("deployment", "Load deployment", "completed", performance.now() - deploymentStarted);
  const action = actions[0] ?? "apply";
  if (action === "status") {
    const started = performance.now();
    output.phase("inspect", "Inspect deployment", "started");
    const state = await inspectDeployment(deployment);
    output.phase("inspect", "Inspect deployment", "completed", performance.now() - started);
    output.deployment("status", deployment.adapter.name, state);
    return;
  }
  if (action === "remove") {
    const started = performance.now();
    output.phase("remove", "Remove deployment", "started");
    const state = await removeDeployment(deployment);
    output.phase("remove", "Remove deployment", "completed", performance.now() - started);
    output.deployment("remove", deployment.adapter.name, state);
    return;
  }
  const buildOutput = resolve(
    directory,
    readFlag(arguments_, "outdir") ?? readFlag(arguments_, "outfile") ?? "dist",
  );
  const built = await buildSystem(directory, buildOutput, adapters, {
    ...(app ? { app } : {}),
    report: (event) => output.production(event),
  });
  if (action === "plan") {
    const started = performance.now();
    output.phase("plan", "Plan deployment", "started");
    const observed = await inspectDeployment(deployment);
    const plan = planDeployment(deployment, built.release, observed);
    output.phase("plan", "Plan deployment", "completed", performance.now() - started);
    output.deployment("plan", deployment.adapter.name, plan);
    return;
  }
  const started = performance.now();
  output.phase("apply", "Apply deployment", "started");
  const result = await applyDeployment(deployment, built.release);
  output.phase("apply", "Apply deployment", "completed", performance.now() - started);
  output.deployment("apply", deployment.adapter.name, result.state);
  if (!result.state.converged) process.exitCode = 1;
}

async function loadDeployment(
  directory: string,
  path: string,
): Promise<Deployment<System<SystemContract>, DeploymentAdapter>> {
  const [{ createServer, defaultServerConditions }, { packageSourceAliases }] = await Promise.all([
    import("vite"),
    import("@/package"),
  ]);
  const source = resolve(directory, "src");
  const framework = import.meta.dirname;
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    plugins: [sourceAliasPlugin(source, framework)],
    root: directory,
    resolve: {
      alias: packageSourceAliases(),
      conditions: ["source", ...defaultServerConditions],
    },
    server: { middlewareMode: true, ws: false },
  });
  const workingDirectory = process.cwd();
  try {
    process.chdir(directory);
    const module = (await vite.ssrLoadModule(resolve(directory, path))) as Readonly<
      Record<string, unknown>
    >;
    const deployment = (module.default ?? module) as Partial<
      Deployment<System<SystemContract>, DeploymentAdapter>
    >;
    if (
      !deployment ||
      typeof deployment !== "object" ||
      !deployment.system ||
      !deployment.adapter ||
      typeof deployment.adapter.inspect !== "function" ||
      typeof deployment.adapter.apply !== "function" ||
      typeof deployment.adapter.remove !== "function"
    ) {
      throw new TypeError(`${path} must default-export one Deployment.`);
    }
    return deployment as Deployment<System<SystemContract>, DeploymentAdapter>;
  } finally {
    process.chdir(workingDirectory);
    await vite.close();
  }
}

function sourceAliasPlugin(project: string, framework: string): Plugin {
  return {
    name: "kit-deployment-source-alias",
    enforce: "pre",
    resolveId(id, importer) {
      if (!id.startsWith("@/")) return;
      const owner = importer?.split("?", 1)[0] ?? "";
      const root = inside(framework, owner) ? framework : project;
      return this.resolve(resolve(root, id.slice(2)), importer, { skipSelf: true });
    },
  };
}

function inside(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

if (import.meta.main) {
  try {
    await runCli();
  } catch (error) {
    if (process.stdout.isTTY) process.stdout.write("\r\u001B[2K");
    new CommandOutput(process.argv.includes("--json")).error(formatCliError(error));
    process.exitCode = 1;
  }
}

export async function createProject(arguments_: readonly string[]): Promise<void> {
  const target = resolve(positionalArguments(arguments_)[0] ?? "workspace");
  const force = arguments_.includes("--force");
  const install = !arguments_.includes("--no-install");
  const packageLocation = readFlag(arguments_, "package") ?? "latest";
  const name = normalizeName(readFlag(arguments_, "name") ?? basename(target));
  const exampleName = readFlag(arguments_, "example") ?? "basic";

  if (!name) throw new TypeError("Project name must contain a letter or number.");

  if (force) {
    await rm(target, { force: true, recursive: true });
  } else {
    try {
      if ((await readdir(target)).length) throw new Error(`${target} is not empty.`);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }

  const framework = await findPackageDirectory(import.meta.dirname);
  const examples = resolve(framework, "examples");
  const available = (await readdir(examples, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
  if (!available.includes(exampleName)) {
    throw new TypeError(
      `Unknown example ${JSON.stringify(exampleName)}. Available examples: ${available.join(", ")}.`,
    );
  }
  const example = resolve(examples, exampleName);

  for (const [source, ignored] of [
    [resolve(framework, "template"), ignoredTemplateEntries],
    [example, ignoredExampleEntries],
  ] as const) {
    for (const path of await listFiles(source, "", ignored)) {
      const file = resolve(target, path);
      const contents = renderTemplate(path, await readFile(resolve(source, path), "utf8"), {
        name,
        packageLocation,
      });
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    }
  }
  await Promise.all(
    workspaceDirectories.map((directory) => mkdir(resolve(target, directory), { recursive: true })),
  );

  if (install) {
    const code = await run(["nub", "install"], target);
    if (code !== 0) throw new Error("nub install failed.");
  }
  console.log(`created ${name} in ${target}`);
}

async function findPackageDirectory(start: string): Promise<string> {
  for (let directory = start; ; directory = dirname(directory)) {
    try {
      await Promise.all([
        readdir(resolve(directory, "config")),
        readdir(resolve(directory, "template")),
        readdir(resolve(directory, "examples")),
      ]);
      return directory;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot locate Kit package resources.");
  }
}

function packageExecutable(name: string, path: string): string {
  const manifest = fileURLToPath(import.meta.resolve(`${name}/package.json`));
  return resolve(dirname(manifest), path);
}

async function listFiles(
  directory: string,
  prefix = "",
  ignored = ignoredTemplateEntries,
): Promise<string[]> {
  const files = await Promise.all(
    (await readdir(resolve(directory, prefix), { withFileTypes: true }))
      .filter((entry) => !ignored.has(entry.name))
      .map(async (entry) => {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listFiles(directory, path, ignored) : [path];
      }),
  );
  return files.flat().sort();
}

function renderTemplate(
  path: string,
  contents: string,
  values: { readonly name: string; readonly packageLocation: string },
): string {
  if (path === "package.json") {
    const manifest = JSON.parse(contents) as {
      name: string;
      dependencies: Record<string, string>;
    };
    manifest.name = values.name;
    manifest.dependencies["kit"] = values.packageLocation;
    return `${JSON.stringify(manifest, undefined, 2)}\n`;
  }
  if (path === "src/system.ts") {
    return contents.replace(
      /metadata:\s*{\s*name:\s*"[^"]*"\s*}/,
      `metadata: { name: "${values.name}" }`,
    );
  }
  return contents;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hasCode(error: unknown, code: string): error is { readonly code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** @internal Preserves nested startup and disposal causes in CLI diagnostics. */
export function formatCliError(error: unknown): string {
  return formatErrorLines(error, 0, new Set()).join("\n");
}

function formatErrorLines(error: unknown, depth: number, seen: Set<unknown>): string[] {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    if (seen.has(error)) return [];
    seen.add(error);
  }
  const message = errorMessage(error);
  const lines = [`${depth === 0 ? "" : `${"  ".repeat(depth)}- `}${message}`];
  if (error instanceof AggregateError) {
    for (const nested of error.errors as unknown[]) {
      lines.push(...formatErrorLines(nested, depth + 1, seen));
    }
  } else if (error instanceof Error && error.cause !== undefined) {
    lines.push(...formatErrorLines(error.cause, depth + 1, seen));
  }
  return lines;
}

function readFlag(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(`--${name}`);
  return index < 0 ? undefined : arguments_[index + 1];
}

function positionalArguments(arguments_: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index]!;
    if (!value.startsWith("--")) {
      values.push(value);
      continue;
    }
    if (valueFlags.has(value.slice(2))) index += 1;
  }
  return values;
}

async function run(command: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const [executable, ...arguments_] = command;
    if (!executable) return resolve(1);
    const child = spawn(executable, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
