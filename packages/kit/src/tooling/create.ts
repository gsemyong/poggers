import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export async function createProject(arguments_: readonly string[]): Promise<void> {
  const target = resolve(arguments_.find((value) => !value.startsWith("--")) ?? "my-app");
  const force = arguments_.includes("--force");
  const install = !arguments_.includes("--no-install");
  const version = flag(arguments_, "kit-version") ?? "latest";
  const name = normalizeName(flag(arguments_, "name") ?? basename(target));

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

  const source = await findTemplate(import.meta.dirname);
  for (const path of await listFiles(source)) {
    const destination = path === "gitignore" ? ".gitignore" : path;
    const file = resolve(target, destination);
    const contents = render(await readFile(resolve(source, path), "utf8"), { name, version });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  if (install) {
    const code = await run("nub", ["install"], target);
    if (code !== 0) throw new Error("nub install failed.");
  }
  console.log(`created ${name} in ${target}`);
}

async function findTemplate(start: string): Promise<string> {
  for (let directory = start; ; directory = dirname(directory)) {
    const candidate = resolve(directory, "template");
    try {
      await readdir(candidate);
      return candidate;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot locate the Poggers application template.");
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const files = await Promise.all(
    (await readdir(resolve(directory, prefix), { withFileTypes: true })).map(async (entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? listFiles(directory, path) : [path];
    }),
  );
  return files.flat().sort();
}

function render(contents: string, values: { readonly name: string; readonly version: string }) {
  return contents.replaceAll("{{name}}", values.name).replaceAll("{{kitVersion}}", values.version);
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

function flag(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(`--${name}`);
  return index < 0 ? undefined : arguments_[index + 1];
}

function run(command: string, arguments_: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
