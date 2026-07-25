import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { Release, ReleaseArtifact } from "@/contracts/deployment";

const OCI_LAYOUT_VERSION = "1.0.0";
const OCI_IMAGE_INDEX = "application/vnd.oci.image.index.v1+json";
const OCI_IMAGE_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const OCI_IMAGE_CONFIG = "application/vnd.oci.image.config.v1+json";
const OCI_IMAGE_LAYER = "application/vnd.oci.image.layer.v1.tar";

export type OciDescriptor = Readonly<{
  mediaType: string;
  digest: string;
  size: number;
  platform?: Readonly<{ architecture: string; os: string }>;
  annotations?: Readonly<Record<string, string>>;
}>;

export type OciImageLayout = Readonly<{
  directory: string;
  digest: string;
  manifests: readonly OciDescriptor[];
}>;

/** Packages process artifacts from one Release as a reproducible OCI image layout. */
export async function packageOciRelease(input: {
  release: Release;
  artifacts: string;
  output: string;
}): Promise<OciImageLayout> {
  const processes = input.release.artifacts.filter(
    ({ deployment, kind }) => deployment === "process" && kind === "program",
  );
  if (!processes.length) throw new Error("OCI packaging requires at least one Process artifact.");
  await verifyReleaseFiles(input.release, input.artifacts);
  await rm(input.output, { recursive: true, force: true });
  await mkdir(resolve(input.output, "blobs/sha256"), { recursive: true });
  await writeFile(
    resolve(input.output, "oci-layout"),
    `${JSON.stringify({ imageLayoutVersion: OCI_LAYOUT_VERSION })}\n`,
  );

  const manifests: OciDescriptor[] = [];
  for (const artifact of [...processes].sort((left, right) =>
    left.identity.localeCompare(right.identity),
  )) {
    const layer = await releaseLayer(input.release, artifact, input.artifacts);
    const descriptor = await writeBlob(input.output, OCI_IMAGE_LAYER, layer);
    manifests.push(await imageManifest(input.output, input.release, artifact, descriptor));
  }
  const index = {
    schemaVersion: 2,
    mediaType: OCI_IMAGE_INDEX,
    manifests,
  };
  const indexBytes = bytes(index);
  await writeFile(resolve(input.output, "index.json"), indexBytes);
  return Object.freeze({
    directory: input.output,
    digest: sha256(indexBytes),
    manifests: Object.freeze(manifests),
  });
}

async function imageManifest(
  output: string,
  release: Release,
  artifact: ReleaseArtifact,
  layer: OciDescriptor,
): Promise<OciDescriptor> {
  if (!artifact.entrypoint) {
    throw new Error(`OCI Process artifact ${JSON.stringify(artifact.identity)} has no entrypoint.`);
  }
  if (!artifact.target) {
    throw new Error(`OCI Process artifact ${JSON.stringify(artifact.identity)} has no target.`);
  }
  const config = {
    architecture: ociArchitecture(artifact.target.architecture),
    os: artifact.target.operatingSystem,
    config: {
      Entrypoint: [`/kit/${artifact.entrypoint}`],
      WorkingDir: "/kit",
      User: "65532:65532",
      Labels: {
        "dev.kit.release": release.digest,
        "dev.kit.artifact": artifact.identity,
      },
    },
    rootfs: { type: "layers", diff_ids: [layer.digest] },
    history: [{ created_by: "kit" }],
  };
  const configDescriptor = await writeBlob(output, OCI_IMAGE_CONFIG, bytes(config));
  const manifest = {
    schemaVersion: 2,
    mediaType: OCI_IMAGE_MANIFEST,
    config: configDescriptor,
    layers: [layer],
    annotations: {
      "org.opencontainers.image.ref.name": readableIdentity(artifact.identity),
      "dev.kit.release": release.digest,
      "dev.kit.artifact": artifact.identity,
    },
  };
  return writeBlob(output, OCI_IMAGE_MANIFEST, bytes(manifest), {
    platform: {
      architecture: ociArchitecture(artifact.target.architecture),
      os: artifact.target.operatingSystem,
    },
    annotations: {
      "org.opencontainers.image.ref.name": readableIdentity(artifact.identity),
      "dev.kit.artifact": artifact.identity,
    },
  });
}

async function verifyReleaseFiles(release: Release, artifacts: string): Promise<void> {
  for (const file of release.files) {
    const contents = await readFile(releaseFilePath(artifacts, file.path));
    if (contents.byteLength !== file.size || sha256(contents) !== file.digest) {
      throw new Error(`Release file ${JSON.stringify(file.path)} no longer matches its digest.`);
    }
  }
}

async function releaseLayer(
  release: Release,
  process: ReleaseArtifact,
  artifacts: string,
): Promise<Buffer> {
  const blocks: Buffer[] = [];
  const paths = new Set(process.files);
  for (const configuration of process.configuration) {
    if (configuration.source?.kind !== "assets") continue;
    for (const asset of release.artifacts) {
      if (
        asset.deployment === "asset" &&
        (!configuration.source.platform || configuration.source.platform === asset.platform)
      ) {
        asset.files.forEach((path) => paths.add(path));
      }
    }
  }
  const files = [...paths]
    .map((path) => {
      const file = release.files.find((candidate) => candidate.path === path);
      if (!file) {
        throw new Error(
          `OCI Process artifact ${JSON.stringify(process.identity)} references missing Release file ${JSON.stringify(path)}.`,
        );
      }
      return file;
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const file of files) {
    const contents = await readFile(releaseFilePath(artifacts, file.path));
    blocks.push(
      tarHeader(`kit/${file.path}`, contents.byteLength, file.executable ? 0o755 : 0o644),
    );
    blocks.push(contents);
    const padding = (512 - (contents.byteLength % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1_024));
  return Buffer.concat(blocks);
}

function releaseFilePath(root: string, path: string): string {
  const file = resolve(root, path);
  const value = relative(resolve(root), file);
  if (!value || isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`)) {
    throw new Error(`OCI Release file ${JSON.stringify(path)} escapes its artifact directory.`);
  }
  return file;
}

function tarHeader(path: string, size: number, mode: number): Buffer {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitTarPath(path);
  writeText(header, name, 0, 100);
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, "ustar", 257, 6);
  writeText(header, "00", 263, 2);
  writeText(header, prefix, 345, 155);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  const encoded = checksum.toString(8).padStart(6, "0");
  header.write(encoded, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitTarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`OCI layer path ${JSON.stringify(path)} exceeds the USTAR path limit.`);
}

function writeText(target: Buffer, value: string, offset: number, length: number): void {
  const source = Buffer.from(value);
  if (source.byteLength > length)
    throw new Error(`USTAR field ${JSON.stringify(value)} is too long.`);
  source.copy(target, offset);
}

function writeOctal(target: Buffer, value: number, offset: number, length: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) throw new Error(`USTAR numeric value ${value} is too large.`);
  target.write(encoded, offset, length - 1, "ascii");
}

async function writeBlob(
  output: string,
  mediaType: string,
  contents: Buffer,
  additions: Pick<OciDescriptor, "platform" | "annotations"> = {},
): Promise<OciDescriptor> {
  const digest = sha256(contents);
  await writeFile(resolve(output, `blobs/sha256/${digest.slice("sha256:".length)}`), contents);
  return Object.freeze({
    mediaType,
    digest,
    size: contents.byteLength,
    ...additions,
  });
}

function bytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function ociArchitecture(value: string): string {
  return value === "x64" ? "amd64" : value;
}

function readableIdentity(identity: string): string {
  return (
    identity
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "program"
  );
}
