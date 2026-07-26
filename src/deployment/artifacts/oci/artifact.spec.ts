import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import type { ProductionArtifacts } from "@/adapter";
import { createRelease } from "@/deployment";
import { packageOciRelease, type OciDescriptor } from "@/deployment/artifacts/oci";

const directories: string[] = [];
const execute = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("OCI Release packaging", () => {
  test("writes a reproducible, content-addressed, non-root image layout", async () => {
    const fixture = await ociFixture();
    const first = resolve(fixture.directory, "oci-first");
    const second = resolve(fixture.directory, "oci-second");
    const left = await packageOciRelease({
      release: fixture.release,
      artifacts: fixture.releaseDirectory,
      output: first,
    });
    const right = await packageOciRelease({
      release: fixture.release,
      artifacts: fixture.releaseDirectory,
      output: second,
    });

    expect(right.digest).toBe(left.digest);
    expect(await directoryContents(second)).toEqual(await directoryContents(first));
    expect(JSON.parse(await readFile(resolve(first, "oci-layout"), "utf8"))).toEqual({
      imageLayoutVersion: "1.0.0",
    });
    const index = JSON.parse(await readFile(resolve(first, "index.json"), "utf8")) as {
      manifests: readonly OciDescriptor[];
    };
    expect(index.manifests).toHaveLength(2);
    await Promise.all(index.manifests.map((descriptor) => verifyDescriptor(first, descriptor)));
    const apiDescriptor = index.manifests.find(
      ({ annotations }) => annotations?.["dev.kit.artifact"] === "program/api",
    )!;
    const workerDescriptor = index.manifests.find(
      ({ annotations }) => annotations?.["dev.kit.artifact"] === "program/worker",
    )!;
    expect(apiDescriptor).toBeDefined();
    expect(workerDescriptor).toBeDefined();
    const manifest = await readDescriptorJson<{
      config: OciDescriptor;
      layers: readonly OciDescriptor[];
      annotations: Readonly<Record<string, string>>;
    }>(first, apiDescriptor);
    await verifyDescriptor(first, manifest.config);
    await Promise.all(manifest.layers.map((descriptor) => verifyDescriptor(first, descriptor)));
    const config = await readDescriptorJson<{
      architecture: string;
      os: string;
      config: { Entrypoint: readonly string[]; User: string; Env?: readonly string[] };
    }>(first, manifest.config);
    expect(config).toMatchObject({
      architecture: process.arch === "x64" ? "amd64" : process.arch,
      os: process.platform,
      config: {
        Entrypoint: ["/kit/server/api"],
        User: "65532:65532",
      },
    });
    expect(config.config.Env).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain("secret");
    const apiLayer = await readDescriptor(first, manifest.layers[0]!);
    expect(apiLayer.toString()).toContain("kit/server/api");
    expect(apiLayer.toString()).toContain("kit/web/index.html");
    expect(apiLayer.toString()).not.toContain("kit/server/worker");

    const workerManifest = await readDescriptorJson<{
      layers: readonly OciDescriptor[];
    }>(first, workerDescriptor);
    const workerLayer = await readDescriptor(first, workerManifest.layers[0]!);
    expect(workerLayer.toString()).toContain("kit/server/worker");
    expect(workerLayer.toString()).not.toContain("kit/server/api");
    expect(workerLayer.toString()).not.toContain("kit/web/index.html");
  });

  test("rejects source drift and incomplete Process metadata", async () => {
    const fixture = await ociFixture();
    await writeFile(resolve(fixture.releaseDirectory, "web/index.html"), "changed");
    await expect(
      packageOciRelease({
        release: fixture.release,
        artifacts: fixture.releaseDirectory,
        output: resolve(fixture.directory, "drift"),
      }),
    ).rejects.toThrow("no longer matches its digest");

    const missingTarget = {
      ...fixture.release,
      artifacts: fixture.release.artifacts.map((artifact) =>
        artifact.deployment === "process" ? { ...artifact, target: undefined } : artifact,
      ),
    };
    await writeFile(resolve(fixture.releaseDirectory, "web/index.html"), "<main>web</main>");
    await expect(
      packageOciRelease({
        release: missingTarget,
        artifacts: fixture.releaseDirectory,
        output: resolve(fixture.directory, "missing-target"),
      }),
    ).rejects.toThrow("has no target");
  });

  test.skipIf(!process.env.KIT_OCI_RUNTIME)(
    "loads and runs a compatible Linux Release in an OCI runtime",
    { tags: ["production"], timeout: 120_000 },
    async () => {
      const fixture = await linuxOciFixture();
      const layout = resolve(fixture.directory, "oci");
      const archive = resolve(fixture.directory, "oci.tar");
      await packageOciRelease({
        release: fixture.release,
        artifacts: fixture.releaseDirectory,
        output: layout,
      });
      await execute("/usr/bin/tar", ["-cf", archive, "-C", layout, "."]);

      const runtime = process.env.KIT_OCI_RUNTIME!;
      await execute(runtime, ["image", "load", "--input", archive], { timeout: 30_000 });
      try {
        const execution = await execute(runtime, ["run", "--rm", "program-smoke"], {
          timeout: 30_000,
        });
        expect(execution.stdout.trim()).toBe("kit-oci-runtime-smoke");
      } finally {
        await execute(runtime, ["image", "rm", "program-smoke"], { timeout: 10_000 }).catch(
          () => undefined,
        );
      }
    },
  );
});

async function ociFixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-oci-"));
  directories.push(directory);
  const releaseDirectory = resolve(directory, "release");
  const serverDirectory = resolve(releaseDirectory, "server");
  const webDirectory = resolve(releaseDirectory, "web");
  await mkdir(serverDirectory, { recursive: true });
  await mkdir(webDirectory, { recursive: true });
  const executable = resolve(serverDirectory, "api");
  const worker = resolve(serverDirectory, "worker");
  await writeFile(executable, "native-program");
  await writeFile(worker, "native-worker");
  await chmod(executable, 0o755);
  await chmod(worker, 0o755);
  await writeFile(resolve(webDirectory, "index.html"), "<main>web</main>");
  const server: ProductionArtifacts = {
    directory: serverDirectory,
    entries: [
      {
        identity: "program/api",
        kind: "program",
        deployment: "process",
        environment: "server",
        path: executable,
        entrypoint: executable,
        dependencies: ["http"],
        configuration: [
          {
            dependency: "http",
            implementation: "http",
            name: "webRoot",
            binding: { kind: "environment", name: "KIT_WEB_ROOT" },
            required: false,
            source: { kind: "assets", platform: "web", format: "single" },
          },
        ],
        target: { operatingSystem: process.platform, architecture: process.arch },
      },
      {
        identity: "program/worker",
        kind: "program",
        deployment: "process",
        environment: "server",
        path: worker,
        entrypoint: worker,
        target: { operatingSystem: process.platform, architecture: process.arch },
      },
    ],
  };
  const web: ProductionArtifacts = {
    directory: webDirectory,
    entries: [
      {
        identity: "interface/web",
        kind: "interface",
        deployment: "asset",
        environment: "browser-main",
        path: webDirectory,
        entrypoint: resolve(webDirectory, "index.html"),
      },
    ],
  };
  const release = await createRelease({
    directory: releaseDirectory,
    system: "oci-fixture",
    artifacts: { server, web },
  });
  return { directory, releaseDirectory, release };
}

async function linuxOciFixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-oci-runtime-"));
  if (!process.env.KIT_KEEP_OCI_FIXTURE) directories.push(directory);
  const releaseDirectory = resolve(directory, "release");
  const serverDirectory = resolve(releaseDirectory, "server");
  await mkdir(serverDirectory, { recursive: true });
  const source = resolve(directory, "smoke.rs");
  const executable = resolve(serverDirectory, "smoke");
  const architecture = process.arch === "x64" ? "x64" : "arm64";
  const target =
    architecture === "x64" ? "x86_64-unknown-linux-musl" : "aarch64-unknown-linux-musl";
  await writeFile(source, 'fn main() { println!("kit-oci-runtime-smoke"); }\n');
  await execute("rustc", [
    source,
    "--target",
    target,
    "-C",
    "linker=rust-lld",
    "-C",
    "strip=symbols",
    "-o",
    executable,
  ]);
  const server: ProductionArtifacts = {
    directory: serverDirectory,
    entries: [
      {
        identity: "program/smoke",
        kind: "program",
        deployment: "process",
        environment: "server",
        path: executable,
        entrypoint: executable,
        target: { operatingSystem: "linux", architecture },
      },
    ],
  };
  const release = await createRelease({
    directory: releaseDirectory,
    system: "oci-runtime-fixture",
    artifacts: { server },
  });
  return { directory, releaseDirectory, release };
}

async function verifyDescriptor(directory: string, descriptor: OciDescriptor): Promise<void> {
  const contents = await readFile(
    resolve(directory, `blobs/sha256/${descriptor.digest.slice("sha256:".length)}`),
  );
  expect(contents.byteLength).toBe(descriptor.size);
  expect(`sha256:${createHash("sha256").update(contents).digest("hex")}`).toBe(descriptor.digest);
}

async function readDescriptorJson<Value>(
  directory: string,
  descriptor: OciDescriptor,
): Promise<Value> {
  return JSON.parse(
    await readFile(
      resolve(directory, `blobs/sha256/${descriptor.digest.slice("sha256:".length)}`),
      "utf8",
    ),
  ) as Value;
}

async function readDescriptor(directory: string, descriptor: OciDescriptor): Promise<Buffer> {
  return readFile(resolve(directory, `blobs/sha256/${descriptor.digest.slice("sha256:".length)}`));
}

async function directoryContents(directory: string, prefix = ""): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(contents, await directoryContents(directory, path));
    } else {
      contents[path] = (await readFile(resolve(directory, path))).toString("base64");
    }
  }
  return contents;
}
