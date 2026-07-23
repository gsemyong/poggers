import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";

type PackResult = readonly [
  Readonly<{
    files: readonly Readonly<{ path: string }>[];
  }>,
];

const root = resolve(import.meta.dirname, "..");
const releaseArguments = process.argv.slice(2);
const version = releaseArguments.find((argument) => !argument.startsWith("--"));
const dryRun = releaseArguments.includes("--dry-run");

if (
  !version ||
  !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)
) {
  throw new TypeError("Usage: nub run release -- <version> [--dry-run]");
}
if ((await capture("git", ["status", "--porcelain"], root)).trim()) {
  throw new Error("Release requires a clean worktree.");
}

await run("nub", ["run", "check"], root);

const temporary = await mkdtemp(resolve(tmpdir(), "kit-release-"));
try {
  const staging = resolve(temporary, "package");
  const artifacts = resolve(temporary, "artifacts");
  const workspace = resolve(temporary, "workspace");
  await stagePackage(staging, version);
  await mkdir(artifacts);
  await run("nub", ["pack", "--ignore-scripts", "--pack-destination", artifacts], staging);

  const artifact = resolve(artifacts, `kit-${version}.tgz`);
  await access(artifact);
  const packageLocation = `file:${artifact}`;
  await run(
    "nubx",
    ["-y", "-p", packageLocation, "kit", "create", workspace, "--package", packageLocation],
    root,
  );
  await run("nub", ["run", "check"], workspace);
  await run("nub", ["run", "build"], workspace);

  const repository = (
    await capture("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], root)
  ).trim();
  const tag = `v${version}`;
  const releasePackage = `https://github.com/${repository}/releases/download/${tag}/kit-${version}.tgz`;

  if (dryRun) {
    console.log(`verified ${artifact}`);
    console.log(`would create https://github.com/${repository}/releases/tag/${tag}`);
  } else {
    await requirePublishable(tag);
    const commit = (await capture("git", ["rev-parse", "HEAD"], root)).trim();
    const arguments_ = [
      "release",
      "create",
      tag,
      artifact,
      "--generate-notes",
      "--target",
      commit,
      "--title",
      tag,
    ];
    if (version.includes("-")) arguments_.push("--prerelease");
    await run("gh", arguments_, root);
  }

  console.log(`package="${releasePackage}"`);
  console.log('nubx -y -p "$package" kit create my-system --package "$package"');
} finally {
  await rm(temporary, { force: true, recursive: true });
}

async function stagePackage(directory: string, releaseVersion: string): Promise<void> {
  const [packed] = JSON.parse(
    await capture("nub", ["pack", "--dry-run", "--ignore-scripts", "--json"], root),
  ) as PackResult;
  for (const file of packed.files) {
    const target = resolve(directory, file.path);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(root, file.path), target, { recursive: true });
  }
  const manifestPath = resolve(directory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
  manifest.version = releaseVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`);
}

async function requirePublishable(tag: string): Promise<void> {
  await run("gh", ["auth", "status"], root);
  if (!(await capture("git", ["branch", "-r", "--contains", "HEAD"], root)).trim()) {
    throw new Error("Release requires HEAD to be pushed to a remote branch.");
  }
  if ((await capture("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], root)).trim()) {
    throw new Error(`Tag ${tag} already exists.`);
  }
}

async function run(command: string, arguments_: readonly string[], cwd: string): Promise<void> {
  await execute(command, arguments_, cwd, "inherit");
}

async function capture(
  command: string,
  arguments_: readonly string[],
  cwd: string,
): Promise<string> {
  return execute(command, arguments_, cwd, "capture");
}

async function execute(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  output: "capture" | "inherit",
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio: output === "inherit" ? "inherit" : ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    if (output === "capture") child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveOutput(stdout);
      else reject(new Error(`${command} ${arguments_.join(" ")} failed with exit code ${code}.`));
    });
  });
}
