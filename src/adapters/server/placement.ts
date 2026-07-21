import { createHash } from "node:crypto";

/** Deterministically places one shard on distinct deployment nodes using rendezvous hashing. */
export function placeShard(input: {
  key: string;
  nodes: readonly string[];
  replicas?: number;
}): readonly string[] {
  const nodes = [...new Set(input.nodes)];
  if (nodes.length !== input.nodes.length) throw new TypeError("Shard nodes must be unique.");
  const replicas = input.replicas ?? 1;
  if (!Number.isSafeInteger(replicas) || replicas < 1 || replicas > nodes.length) {
    throw new RangeError("Shard replicas must be between one and the number of nodes.");
  }
  return nodes
    .map((node) => ({ node, score: score(input.key, node) }))
    .sort((left, right) =>
      left.score === right.score
        ? left.node.localeCompare(right.node)
        : left.score > right.score
          ? -1
          : 1,
    )
    .slice(0, replicas)
    .map(({ node }) => node);
}

function score(key: string, node: string): bigint {
  const digest = createHash("sha256").update(key).update("\0").update(node).digest();
  return digest.readBigUInt64BE(0);
}
