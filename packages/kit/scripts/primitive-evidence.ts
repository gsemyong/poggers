import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineApp, type JsonValue, type ProgramEventItem } from "../src/kernel/app.ts";
import {
  startDependencies,
  startDependencyGroups,
  type DependencyImplementation,
} from "../src/kernel/dependency.ts";
import { composeFeatures, instantiateFeatureAPIs } from "../src/kernel/feature.ts";
import { createJournalAuthority } from "../src/substrate/adapter.memory.ts";
import { createSqliteJournal } from "../src/substrate/journal.sqlite.ts";
import {
  createMemoryJournal,
  emptyJournalHead,
  type Journal,
  type JournalHead,
} from "../src/substrate/journal.ts";
import {
  createMemoryProgramProgressStore,
  startProgram,
  type AppProgram,
  type ProgramEventRecord,
} from "../src/substrate/program.ts";
import {
  authorizeResource,
  createResourceIntent,
  executeResourceCommandFromState,
  loadResourceAuthority,
  type ResourceAuthorityState,
  type ResourceCommandResult,
} from "../src/substrate/resource.ts";
import { testApp } from "../src/testing/application.ts";

type Scenario =
  | "application-framework"
  | "application-apis-framework"
  | "application-apis-reference"
  | "application-nested-framework"
  | "application-nested-reference"
  | "application-reference"
  | "application-two-instances-framework"
  | "application-two-instances-reference"
  | "resource-framework"
  | "resource-authorized-read-framework"
  | "resource-authorized-read-reference"
  | "resource-batch-framework"
  | "resource-batch-reference"
  | "resource-conflict-framework"
  | "resource-conflict-reference"
  | "resource-denied-command-framework"
  | "resource-denied-command-reference"
  | "resource-denied-read-framework"
  | "resource-denied-read-reference"
  | "resource-duplicate-framework"
  | "resource-duplicate-reference"
  | "resource-independent-framework"
  | "resource-independent-reference"
  | "resource-observer-framework"
  | "resource-observer-reference"
  | "resource-payload-framework"
  | "resource-payload-reference"
  | "resource-reference"
  | "resource-sqlite-reopen-framework"
  | "resource-sqlite-strict-framework"
  | "resource-structured-framework"
  | "resource-structured-reference"
  | "resource-zero-framework"
  | "resource-zero-reference"
  | "program-framework"
  | "program-command-framework"
  | "program-command-reference"
  | "program-filtered-framework"
  | "program-filtered-reference"
  | "program-hot-framework"
  | "program-hot-reference"
  | "program-independent-framework"
  | "program-independent-reference"
  | "program-matching-consumers-framework"
  | "program-matching-consumers-reference"
  | "program-payload-framework"
  | "program-payload-reference"
  | "program-replay-framework"
  | "program-replay-reference"
  | "program-reference"
  | "program-unrelated-consumers-framework"
  | "program-unrelated-consumers-reference"
  | "dependency-framework"
  | "dependency-calls-framework"
  | "dependency-calls-reference"
  | "dependency-groups-framework"
  | "dependency-groups-reference"
  | "dependency-reference"
  | "testing-framework"
  | "testing-reference";

type ChildResult = {
  readonly scenario: Scenario;
  readonly temperature: "cold" | "warm";
  readonly operations: number;
  readonly elapsedMs: number;
  readonly cpuMs: number;
  readonly rssDeltaBytes: number;
  readonly work: Readonly<Record<string, number>>;
};

type PrimitiveApp = {
  Actor: { id: string };
  Resources: {
    counter: {
      Key: string | { id: number; tenant: string };
      State: { value: number; text: string };
      Events: { added: { delta: number }; ignored: {}; wrote: { text: string } };
      Views: { value: number };
      Commands: {
        add: { Input: { delta: number }; Event: "added" };
        addBatch: { Input: { count: number }; Event: "added" };
        noop: { Input: {} };
        write: { Input: { text: string }; Event: "wrote" };
      };
    };
  };
  Dependencies: { server: {} };
  Programs: {
    server: {
      observeCounter: {
        Events: readonly ["counter.added"];
        Replay: "all";
        Version: 1;
      };
    };
  };
};

type PrimitiveAuthority = Omit<ResourceAuthorityState, "state"> & {
  readonly state: { value: number; text: string };
};

const scenario = process.argv[2] as Scenario | "child" | undefined;
const quick = process.argv.includes("--quick");
const warm = process.argv.includes("--warm");
const sizesArgument = process.argv.find((argument) => argument.startsWith("--sizes="));
const samplesArgument = process.argv.find((argument) => argument.startsWith("--samples="));
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const programMatrix = process.argv.includes("--program-matrix");
const resourceMatrix = process.argv.includes("--resource-matrix");
const compositionMatrix = process.argv.includes("--composition-matrix");
const persistentMatrix = process.argv.includes("--persistent-matrix");
const verifyEvidenceArgument = process.argv.find((argument) =>
  argument.startsWith("--verify-evidence="),
);

type EvidenceItem = {
  readonly kind: "primitive";
  readonly scenario: Scenario;
  readonly operations: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly medianRssDeltaBytes: number;
};

type EquivalentBudget = {
  readonly reference: Scenario;
  readonly framework: Scenario;
  readonly maxTimeRatio: number;
  readonly maxRssRatio: number;
};

const equivalentBudgets: readonly EquivalentBudget[] = [
  {
    reference: "application-reference",
    framework: "application-framework",
    maxTimeRatio: 1.5,
    maxRssRatio: 2,
  },
  {
    reference: "resource-reference",
    framework: "resource-framework",
    maxTimeRatio: 2.5,
    maxRssRatio: 2,
  },
  {
    reference: "program-reference",
    framework: "program-framework",
    maxTimeRatio: 5,
    maxRssRatio: 3,
  },
  {
    reference: "dependency-reference",
    framework: "dependency-framework",
    maxTimeRatio: 1.75,
    maxRssRatio: 2,
  },
  {
    reference: "testing-reference",
    framework: "testing-framework",
    maxTimeRatio: 2,
    maxRssRatio: 2,
  },
  {
    reference: "application-nested-reference",
    framework: "application-nested-framework",
    maxTimeRatio: 2,
    maxRssRatio: 2,
  },
  {
    reference: "application-apis-reference",
    framework: "application-apis-framework",
    maxTimeRatio: 2,
    maxRssRatio: 2,
  },
  {
    reference: "application-two-instances-reference",
    framework: "application-two-instances-framework",
    maxTimeRatio: 2,
    maxRssRatio: 2,
  },
  {
    reference: "dependency-calls-reference",
    framework: "dependency-calls-framework",
    maxTimeRatio: 5,
    maxRssRatio: 3,
  },
  {
    reference: "dependency-groups-reference",
    framework: "dependency-groups-framework",
    maxTimeRatio: 3,
    maxRssRatio: 3,
  },
  ...(
    [
      ["resource-zero-reference", "resource-zero-framework", 2.5, 2],
      ["resource-authorized-read-reference", "resource-authorized-read-framework", 4, 3],
      ["resource-denied-read-reference", "resource-denied-read-framework", 5, 5],
      ["resource-denied-command-reference", "resource-denied-command-framework", 2.75, 2],
      ["resource-batch-reference", "resource-batch-framework", 2.75, 2],
      ["resource-duplicate-reference", "resource-duplicate-framework", 5, 6],
      ["resource-conflict-reference", "resource-conflict-framework", 2.75, 2],
      ["resource-independent-reference", "resource-independent-framework", 2.75, 2],
      ["resource-structured-reference", "resource-structured-framework", 2.75, 2],
      ["resource-observer-reference", "resource-observer-framework", 2.75, 2],
      ["resource-payload-reference", "resource-payload-framework", 4, 2],
      ["program-unrelated-consumers-reference", "program-unrelated-consumers-framework", 4, 3],
      ["program-matching-consumers-reference", "program-matching-consumers-framework", 4.5, 4.5],
      ["program-filtered-reference", "program-filtered-framework", 4, 3],
      ["program-command-reference", "program-command-framework", 4, 3],
      ["program-hot-reference", "program-hot-framework", 6, 3],
      ["program-independent-reference", "program-independent-framework", 4, 3],
      ["program-replay-reference", "program-replay-framework", 4.5, 3],
      ["program-payload-reference", "program-payload-framework", 5, 5],
    ] as const
  ).map(([reference, framework, maxTimeRatio, maxRssRatio]) => ({
    reference,
    framework,
    maxTimeRatio,
    maxRssRatio,
  })),
];

const scalingBudgets: readonly {
  readonly scenario: Scenario;
  readonly low: number;
  readonly high: number;
  readonly maxTimeGrowth: number;
}[] = [
  ...(
    [
      "application-framework",
      "resource-framework",
      "resource-zero-framework",
      "resource-authorized-read-framework",
      "resource-denied-read-framework",
      "resource-denied-command-framework",
      "resource-batch-framework",
      "resource-duplicate-framework",
      "resource-conflict-framework",
      "resource-independent-framework",
      "resource-structured-framework",
      "resource-observer-framework",
      "program-framework",
      "program-filtered-framework",
      "program-command-framework",
      "program-hot-framework",
      "program-independent-framework",
      "dependency-framework",
      "testing-framework",
    ] as const
  ).map((scenario) => ({ scenario, low: 1_000, high: 10_000, maxTimeGrowth: 15 })),
  {
    scenario: "program-matching-consumers-framework",
    low: 64,
    high: 256,
    maxTimeGrowth: 6,
  },
  {
    scenario: "program-unrelated-consumers-framework",
    low: 1,
    high: 256,
    maxTimeGrowth: 3,
  },
  {
    scenario: "program-replay-framework",
    low: 10_000,
    high: 100_000,
    maxTimeGrowth: 15,
  },
  {
    scenario: "resource-payload-framework",
    low: 1,
    high: 10_000,
    maxTimeGrowth: 4,
  },
  {
    scenario: "program-payload-framework",
    low: 1,
    high: 10_000,
    maxTimeGrowth: 4,
  },
];

async function runParent(): Promise<void> {
  const sizes = sizesArgument
    ? sizesArgument
        .slice("--sizes=".length)
        .split(",")
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    : quick
      ? [1, 100, 1_000]
      : [1, 10, 100, 1_000, 10_000];
  const requestedSamples = Number(samplesArgument?.slice("--samples=".length));
  const samples =
    Number.isSafeInteger(requestedSamples) && requestedSamples > 0
      ? requestedSamples
      : quick
        ? 2
        : 5;
  const scenarios: readonly Scenario[] = programMatrix
    ? [
        "program-unrelated-consumers-reference",
        "program-unrelated-consumers-framework",
        "program-matching-consumers-reference",
        "program-matching-consumers-framework",
        "program-filtered-reference",
        "program-filtered-framework",
        "program-command-reference",
        "program-command-framework",
        "program-hot-reference",
        "program-hot-framework",
        "program-independent-reference",
        "program-independent-framework",
        "program-replay-reference",
        "program-replay-framework",
        "program-payload-reference",
        "program-payload-framework",
      ]
    : resourceMatrix
      ? [
          "resource-zero-reference",
          "resource-zero-framework",
          "resource-authorized-read-reference",
          "resource-authorized-read-framework",
          "resource-denied-read-reference",
          "resource-denied-read-framework",
          "resource-denied-command-reference",
          "resource-denied-command-framework",
          "resource-batch-reference",
          "resource-batch-framework",
          "resource-duplicate-reference",
          "resource-duplicate-framework",
          "resource-conflict-reference",
          "resource-conflict-framework",
          "resource-independent-reference",
          "resource-independent-framework",
          "resource-structured-reference",
          "resource-structured-framework",
          "resource-observer-reference",
          "resource-observer-framework",
          "resource-payload-reference",
          "resource-payload-framework",
        ]
      : compositionMatrix
        ? [
            "application-reference",
            "application-framework",
            "application-nested-reference",
            "application-nested-framework",
            "application-apis-reference",
            "application-apis-framework",
            "application-two-instances-reference",
            "application-two-instances-framework",
            "dependency-reference",
            "dependency-framework",
            "dependency-calls-reference",
            "dependency-calls-framework",
            "dependency-groups-reference",
            "dependency-groups-framework",
          ]
        : persistentMatrix
          ? ["resource-sqlite-strict-framework", "resource-sqlite-reopen-framework"]
          : [
              "application-reference",
              "application-framework",
              "resource-reference",
              "resource-framework",
              "program-reference",
              "program-framework",
              "dependency-reference",
              "dependency-framework",
              "testing-reference",
              "testing-framework",
            ];
  const scenarioSizes = (current: Scenario): readonly number[] => {
    if (
      current === "program-unrelated-consumers-framework" ||
      current === "program-unrelated-consumers-reference" ||
      current === "program-matching-consumers-framework" ||
      current === "program-matching-consumers-reference"
    ) {
      return sizesArgument ? sizes : [1, 8, 64, 256];
    }
    if (current === "program-replay-framework" || current === "program-replay-reference") {
      return sizesArgument ? sizes : [1, 100, 1_000, 10_000, 100_000];
    }
    if (current === "application-nested-framework" || current === "application-nested-reference") {
      return sizesArgument ? sizes : [1, 8, 64, 256, 1_000];
    }
    if (
      current === "resource-sqlite-strict-framework" ||
      current === "resource-sqlite-reopen-framework"
    ) {
      return sizesArgument ? sizes : [1, 10, 100, 1_000];
    }
    return sizes;
  };
  const evidence: unknown[] = [
    {
      kind: "primitive-environment",
      at: new Date().toISOString(),
      bun: Bun.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpus: navigator.hardwareConcurrency,
      temperature: warm ? "warm" : "cold",
    },
  ];
  console.log(JSON.stringify(evidence[0]));

  for (const current of scenarios) {
    for (const operations of scenarioSizes(current)) {
      await spawnChild(current, operations);
      const results: ChildResult[] = [];
      for (let sample = 0; sample < samples; sample += 1) {
        results.push(await spawnChild(current, operations));
      }
      const elapsed = results.map(({ elapsedMs }) => elapsedMs).sort(numberOrder);
      const cpu = results.map(({ cpuMs }) => cpuMs).sort(numberOrder);
      const rss = results.map(({ rssDeltaBytes }) => rssDeltaBytes).sort(numberOrder);
      const item = {
        kind: "primitive",
        scenario: current,
        temperature: warm ? "warm" : "cold",
        operations,
        samples,
        medianMs: percentile(elapsed, 0.5),
        p95Ms: percentile(elapsed, 0.95),
        p99Ms: percentile(elapsed, 0.99),
        medianCpuMs: percentile(cpu, 0.5),
        medianRssDeltaBytes: percentile(rss, 0.5),
        rawMs: elapsed,
        work: results[0]!.work,
      };
      evidence.push(item);
      console.log(JSON.stringify(item));
    }
  }

  const output = outputArgument?.slice("--output=".length);
  if (output) await Bun.write(output, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function spawnChild(current: Scenario, operations: number): Promise<ChildResult> {
  const child = Bun.spawn(
    [
      process.execPath,
      import.meta.path,
      "child",
      current,
      String(operations),
      ...(warm ? ["--warm"] : []),
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${current} ${operations}\n${stdout}\n${stderr}`);
  const line = stdout.trim().split("\n").at(-1);
  if (!line) throw new Error(`${current} ${operations} produced no evidence.`);
  return JSON.parse(line) as ChildResult;
}

async function runChild(current: Scenario, operations: number): Promise<ChildResult> {
  if (!Number.isSafeInteger(operations) || operations <= 0) {
    throw new TypeError("Primitive evidence operations must be a positive integer.");
  }
  if (warm) {
    if (current === "resource-sqlite-reopen-framework") {
      const warmup = await prepareResourceSqliteReopen(operations);
      await warmup();
    } else {
      await scenarios[current](operations);
    }
  }
  const execute =
    current === "resource-sqlite-reopen-framework"
      ? await prepareResourceSqliteReopen(operations)
      : () => scenarios[current](operations);
  const beforeCpu = process.cpuUsage();
  const beforeRss = process.memoryUsage.rss();
  const started = performance.now();
  const work = await execute();
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(beforeCpu);
  return {
    scenario: current,
    temperature: warm ? "warm" : "cold",
    operations,
    elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    rssDeltaBytes: Math.max(0, process.memoryUsage.rss() - beforeRss),
    work,
  };
}

const scenarios: Record<
  Scenario,
  (operations: number) => Promise<Readonly<Record<string, number>>>
> = {
  "application-framework": runApplicationFramework,
  "application-apis-framework": runApplicationAPIsFramework,
  "application-apis-reference": runApplicationAPIsReference,
  "application-nested-framework": runApplicationNestedFramework,
  "application-nested-reference": runApplicationNestedReference,
  "application-reference": runApplicationReference,
  "application-two-instances-framework": runApplicationTwoInstancesFramework,
  "application-two-instances-reference": runApplicationTwoInstancesReference,
  "resource-framework": runResourceFramework,
  "resource-authorized-read-framework": (operations) => runResourceReadFramework(operations, true),
  "resource-authorized-read-reference": (operations) => runResourceReadReference(operations, true),
  "resource-batch-framework": runResourceBatchFramework,
  "resource-batch-reference": runResourceBatchReference,
  "resource-conflict-framework": runResourceConflictFramework,
  "resource-conflict-reference": runResourceConflictReference,
  "resource-denied-command-framework": runResourceDeniedCommandFramework,
  "resource-denied-command-reference": runResourceDeniedCommandReference,
  "resource-denied-read-framework": (operations) => runResourceReadFramework(operations, false),
  "resource-denied-read-reference": (operations) => runResourceReadReference(operations, false),
  "resource-duplicate-framework": runResourceDuplicateFramework,
  "resource-duplicate-reference": runResourceDuplicateReference,
  "resource-independent-framework": (operations) =>
    runResourceIndependentFramework(operations, false),
  "resource-independent-reference": (operations) =>
    runResourceIndependentReference(operations, false),
  "resource-observer-framework": runResourceObserverFramework,
  "resource-observer-reference": runResourceObserverReference,
  "resource-payload-framework": runResourcePayloadFramework,
  "resource-payload-reference": runResourcePayloadReference,
  "resource-reference": runResourceReference,
  "resource-sqlite-reopen-framework": runResourceSqliteReopenFramework,
  "resource-sqlite-strict-framework": runResourceSqliteStrictFramework,
  "resource-structured-framework": (operations) =>
    runResourceIndependentFramework(operations, true),
  "resource-structured-reference": (operations) =>
    runResourceIndependentReference(operations, true),
  "resource-zero-framework": runResourceZeroFramework,
  "resource-zero-reference": runResourceZeroReference,
  "program-framework": runProgramFramework,
  "program-command-framework": runProgramCommandFramework,
  "program-command-reference": runProgramCommandReference,
  "program-filtered-framework": runProgramFilteredFramework,
  "program-filtered-reference": runProgramFilteredReference,
  "program-hot-framework": (operations) => runProgramPartitionsFramework(operations, false),
  "program-hot-reference": (operations) => runProgramPartitionsReference(operations, false),
  "program-independent-framework": (operations) => runProgramPartitionsFramework(operations, true),
  "program-independent-reference": (operations) => runProgramPartitionsReference(operations, true),
  "program-matching-consumers-framework": (consumers) =>
    runProgramConsumersFramework(consumers, true),
  "program-matching-consumers-reference": (consumers) =>
    runProgramConsumersReference(consumers, true),
  "program-payload-framework": runProgramPayloadFramework,
  "program-payload-reference": runProgramPayloadReference,
  "program-replay-framework": runProgramReplayFramework,
  "program-replay-reference": runProgramReplayReference,
  "program-reference": runProgramReference,
  "program-unrelated-consumers-framework": (consumers) =>
    runProgramConsumersFramework(consumers, false),
  "program-unrelated-consumers-reference": (consumers) =>
    runProgramConsumersReference(consumers, false),
  "dependency-framework": runDependencyFramework,
  "dependency-calls-framework": runDependencyCallsFramework,
  "dependency-calls-reference": runDependencyCallsReference,
  "dependency-groups-framework": runDependencyGroupsFramework,
  "dependency-groups-reference": runDependencyGroupsReference,
  "dependency-reference": runDependencyReference,
  "testing-framework": runTestingFramework,
  "testing-reference": runTestingReference,
};

function createGeneratedFeatures(
  operations: number,
): NonNullable<Parameters<typeof composeFeatures>[0]> {
  const features: NonNullable<Parameters<typeof composeFeatures>[0]> = {};
  for (let index = 0; index < operations; index += 1) {
    features[`feature${index}`] = {
      resources: {
        counter: {
          state: { value: 0 },
          events: { added() {} },
          views: { value: () => 0 },
          commands: { add() {} },
        },
      },
      features: {},
      components: {},
      api: () => ({}),
    };
  }
  return features;
}

async function runApplicationFramework(operations: number) {
  const composed = composeFeatures(createGeneratedFeatures(operations), new Set(), new Set());
  const resources = Object.keys(composed.resources).length;
  const manifest = composed.manifest.entries.length;
  if (resources !== operations || manifest !== operations) {
    throw new Error(`Feature composition produced ${resources} Resources and ${manifest} entries.`);
  }
  return { features: operations, resources, manifest };
}

async function runApplicationReference(operations: number) {
  const composed = composeFeaturesReference(createGeneratedFeatures(operations));
  if (
    Object.keys(composed.resources).length !== operations ||
    composed.entries.length !== operations
  ) {
    throw new Error("Direct Feature composition produced an incomplete manifest.");
  }
  return {
    features: operations,
    resources: Object.keys(composed.resources).length,
    manifest: composed.entries.length,
  };
}

async function runApplicationNestedFramework(operations: number) {
  const composed = composeFeatures(createNestedFeatures(operations), new Set(), new Set());
  if (composed.manifest.entries.length !== operations) {
    throw new Error(`Nested composition produced ${composed.manifest.entries.length} entries.`);
  }
  return {
    features: operations,
    resources: Object.keys(composed.resources).length,
    manifest: composed.manifest.entries.length,
    depth: operations,
  };
}

async function runApplicationNestedReference(operations: number) {
  const composed = composeFeaturesReference(createNestedFeatures(operations));
  if (composed.entries.length !== operations) {
    throw new Error(`Direct nested composition produced ${composed.entries.length} entries.`);
  }
  return {
    features: operations,
    resources: Object.keys(composed.resources).length,
    manifest: composed.entries.length,
    depth: operations,
  };
}

async function runApplicationAPIsFramework(operations: number) {
  const features = createGeneratedFeatures(operations);
  let resolvedResources = 0;
  const apis = instantiateFeatureAPIs({
    features,
    actor: { id: "owner" },
    resolveResource() {
      resolvedResources += 1;
      return Object.freeze({});
    },
  });
  if (Object.keys(apis.features).length !== operations || resolvedResources !== operations) {
    throw new Error(
      `API construction produced ${Object.keys(apis.features).length} APIs and ${resolvedResources} Resources.`,
    );
  }
  return { features: operations, apis: operations, resolvedResources };
}

async function runApplicationAPIsReference(operations: number) {
  const features = createGeneratedFeatures(operations);
  let resolvedResources = 0;
  const instantiated = instantiateFeatureAPIsReference(features, "", () => {
    resolvedResources += 1;
    return Object.freeze({});
  });
  if (Object.keys(instantiated).length !== operations || resolvedResources !== operations) {
    throw new Error(
      `Direct API construction produced ${Object.keys(instantiated).length} APIs and ${resolvedResources} Resources.`,
    );
  }
  return { features: operations, apis: operations, resolvedResources };
}

async function runApplicationTwoInstancesFramework(operations: number) {
  const features = createGeneratedFeatures(operations);
  const first = composeFeatures(features, new Set(), new Set());
  const second = composeFeatures(features, new Set(), new Set());
  if (
    first.manifest.entries.length !== operations ||
    second.manifest.entries.length !== operations ||
    first.resources === second.resources
  ) {
    throw new Error("Independent application compositions were not isolated.");
  }
  return { instances: 2, features: operations * 2, resources: operations * 2 };
}

async function runApplicationTwoInstancesReference(operations: number) {
  const features = createGeneratedFeatures(operations);
  const first = composeFeaturesReference(features);
  const second = composeFeaturesReference(features);
  if (
    first.entries.length !== operations ||
    second.entries.length !== operations ||
    first.resources === second.resources
  ) {
    throw new Error("Direct application compositions were not isolated.");
  }
  return { instances: 2, features: operations * 2, resources: operations * 2 };
}

type EvidenceFeatures = NonNullable<Parameters<typeof composeFeatures>[0]>;
function composeFeaturesReference(features: EvidenceFeatures): {
  readonly resources: Record<string, unknown>;
  readonly entries: Array<{
    readonly path: string;
    readonly resources: readonly string[];
    readonly components: readonly string[];
    readonly programs: readonly string[];
    readonly endpoints: readonly string[];
    readonly migrations: readonly string[];
    readonly navigation: readonly string[];
  }>;
} {
  const resources: Record<string, unknown> = {};
  const entries: Array<{
    readonly path: string;
    readonly resources: readonly string[];
    readonly components: readonly string[];
    readonly programs: readonly string[];
    readonly endpoints: readonly string[];
    readonly migrations: readonly string[];
    readonly navigation: readonly string[];
  }> = [];
  const names = (value: Record<string, unknown> | undefined): string[] =>
    value ? Object.keys(value).sort() : [];
  const validate = (segment: string): void => {
    if (segment.length === 0 || segment.includes(".") || segment.includes("/")) {
      throw new Error(`Invalid direct Feature segment ${JSON.stringify(segment)}.`);
    }
  };
  const visit = (children: EvidenceFeatures, parent: string): void => {
    for (const name of names(children)) {
      validate(name);
      const definition = children[name];
      if (!definition) continue;
      const path = parent ? `${parent}.${name}` : name;
      const resourceNames = names(definition.resources);
      const componentNames = names(definition.components);
      const programNames = names(definition.programs);
      const endpointNames = names(definition.endpoints);
      const migrationNames = names(definition.migrations);
      const navigationNames = names(definition.navigation);
      for (const resource of resourceNames) {
        validate(resource);
        const key = `@feature/${path}/resource/${resource}`;
        if (key in resources) throw new Error(`Duplicate direct Feature Resource ${key}.`);
        resources[key] = definition.resources?.[resource];
      }
      entries.push({
        path,
        resources: resourceNames,
        components: componentNames,
        programs: programNames,
        endpoints: endpointNames,
        migrations: migrationNames,
        navigation: navigationNames,
      });
      if (definition.features) visit(definition.features, path);
    }
  };
  visit(features, "");
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { resources, entries };
}

function instantiateFeatureAPIsReference(
  features: EvidenceFeatures,
  parent: string,
  resolveResource: (path: string, name: string) => unknown,
): Record<string, Readonly<Record<string, unknown>>> {
  const result: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const name of Object.keys(features).sort()) {
    const definition = features[name];
    if (!definition) continue;
    const path = parent ? `${parent}.${name}` : name;
    const children = instantiateFeatureAPIsReference(
      definition.features ?? {},
      path,
      resolveResource,
    );
    const resources = Object.fromEntries(
      Object.keys(definition.resources ?? {})
        .sort()
        .map((resource) => [resource, resolveResource(path, resource)]),
    );
    result[name] = Object.freeze(
      definition.api?.({ resources, features: children, actor: { id: "owner" } }) ?? {},
    );
  }
  return result;
}

function createNestedFeatures(
  operations: number,
): NonNullable<Parameters<typeof composeFeatures>[0]> {
  let current: NonNullable<Parameters<typeof composeFeatures>[0]>[string] | undefined;
  for (let index = operations - 1; index >= 0; index -= 1) {
    current = {
      resources: {
        counter: {
          state: { value: 0 },
          events: { added() {} },
          views: { value: () => 0 },
          commands: { add() {} },
        },
      },
      features: current ? { [`feature${index + 1}`]: current } : {},
      components: {},
      api: () => ({}),
    };
  }
  return current ? { feature0: current } : {};
}

function createPrimitiveApp(
  observe?: (event: ProgramEventItem<PrimitiveApp, "counter.added">) => void,
) {
  return defineApp<PrimitiveApp>({
    version: 1,
    resources: {
      counter: {
        state: { value: 0, text: "" },
        authorize: ({ actor }) => actor.id === "owner",
        events: {
          added: ({ state, payload }) => void (state.value += payload.delta),
          ignored() {},
          wrote: ({ state, payload }) => void (state.text = payload.text),
        },
        views: { value: ({ state }) => state.value },
        commands: {
          add: (context, { delta }) => context.event.added({ delta }),
          addBatch(context, { count }) {
            for (let index = 0; index < count; index += 1) context.event.added({ delta: 1 });
          },
          noop() {},
          write: (context, { text }) => context.event.wrote({ text }),
        },
      },
    },
    dependencies: { server: {} },
    programs: {
      server: {
        observeCounter: {
          source: {
            events: ["counter.added"],
            keyBy: "resource",
            replay: "all",
            version: 1,
          },
          handle(event) {
            observe?.(event);
          },
        },
      },
    },
  });
}

async function runResourceFramework(operations: number) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  const state = app.createState("counter");
  let eventCursor = 0;
  let head: JournalHead = emptyJournalHead;
  try {
    for (let index = 0; index < operations; index += 1) {
      const result = await executeResourceCommandFromState(
        app,
        createJournalAuthority(journal),
        createResourceIntent(`command-${index}`, {
          resource: "counter",
          key: "one",
          name: "add",
          args: [1],
          actor: { id: "owner" },
          at: index,
        }),
        {
          state,
          eventCursor,
          head,
          snapshotHead: emptyJournalHead,
          events: [],
        },
      );
      if (result.status !== "committed" || !result.record.decision.ok) {
        throw new Error(`Resource command ${index} was not committed.`);
      }
      for (const event of result.record.decision.events) {
        app.applyEvent("counter", state, {
          id: event.id,
          seq: event.seq,
          at: event.at,
          actor: { id: "owner" },
          name: event.name,
          payload: event.payload,
        });
        eventCursor = event.seq;
      }
      head = { revision: result.record.revision, position: result.record.position };
    }
    if (state.value !== operations) throw new Error(`Resource value is ${state.value}.`);
    return { commands: operations, events: eventCursor, journalAppends: head.revision };
  } finally {
    await journal.close();
  }
}

type DirectResourceKey = PrimitiveApp["Resources"]["counter"]["Key"];

type DirectResourceEvent = {
  readonly id: string;
  readonly seq: number;
  readonly name: "added" | "wrote";
  readonly payload: { readonly delta: number } | { readonly text: string };
};

type DirectResourceReceipt = {
  readonly fingerprint: string;
  readonly cursor: number;
  readonly events: readonly DirectResourceEvent[];
};

type DirectResourceScope = {
  readonly state: { value: number; text: string };
  readonly receipts: Map<string, DirectResourceReceipt>;
  revision: number;
  cursor: number;
};

type DirectResourceCommand = {
  readonly id: string;
  readonly key: DirectResourceKey;
  readonly name: "add" | "addBatch" | "noop" | "write";
  readonly args: readonly unknown[];
  readonly actorId: string;
  readonly at: number;
};

type PreparedDirectResourceCommand = DirectResourceCommand & {
  readonly fingerprint: string;
  readonly scopeId: string;
};

function canonicalEvidenceValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Evidence values must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalEvidenceValue).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, child]) => `${JSON.stringify(name)}:${canonicalEvidenceValue(child)}`)
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported evidence value ${String(value)}.`);
}

function hashEvidence(previous: string, value: unknown): string {
  return createHash("sha256").update(previous).update(canonicalEvidenceValue(value)).digest("hex");
}

function assertEvidenceJson(value: unknown, seen = new Set<unknown>()): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Evidence values must be finite.");
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new TypeError("Evidence records must be finite acyclic JSON values.");
  }
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertEvidenceJson(child, seen);
  }
  seen.delete(value);
}

class DirectResourceModel {
  readonly scopes = new Map<string, DirectResourceScope>();
  readonly observers = new Set<() => void>();
  appends = 0;
  authorizations = 0;
  canonicalizations = 0;
  hashes = 0;
  validations = 0;

  observe(observer: () => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  prepare(command: DirectResourceCommand): PreparedDirectResourceCommand {
    const scopeId = this.canonical(command.key);
    const fingerprint = hashEvidence("", {
      actor: { id: command.actorId },
      args: command.args,
      name: command.name,
    });
    this.hashes += 1;
    return { ...command, fingerprint, scopeId };
  }

  command(command: DirectResourceCommand): "committed" | "duplicate" {
    return this.execute(this.prepare(command));
  }

  execute(command: PreparedDirectResourceCommand): "committed" | "duplicate" {
    const scope = this.scopes.get(command.scopeId) ?? this.createScope(command.scopeId);
    const { fingerprint } = command;
    const prior = scope.receipts.get(command.id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new Error(`Command identity ${command.id} has conflicting input.`);
      }
      return "duplicate";
    }

    this.authorizations += 1;
    const authorized = command.actorId === "owner";
    const events = authorized ? this.decide(scope, command) : [];
    scope.revision += 1;
    this.appends += 1;
    assertEvidenceJson({
      command: { ...command, actor: { id: command.actorId } },
      decision: authorized ? { ok: true } : { ok: false, error: "forbidden" },
      events,
      position: this.appends,
      revision: scope.revision,
    });
    this.validations += 1;
    for (const event of events) this.apply(scope, event);
    scope.receipts.set(command.id, {
      fingerprint,
      cursor: scope.cursor,
      events,
    });
    for (const observer of this.observers) observer();
    return "committed";
  }

  scope(key: DirectResourceKey): DirectResourceScope {
    const scopeId = this.canonical(key);
    return this.scopes.get(scopeId) ?? this.createScope(scopeId);
  }

  read(key: DirectResourceKey, actorId: string): number | null {
    return this.readScope(this.scope(key), actorId);
  }

  readScope(scope: DirectResourceScope, actorId: string): number | null {
    this.authorizations += 1;
    if (actorId !== "owner") return null;
    return scope.state.value;
  }

  private canonical(key: DirectResourceKey): string {
    this.canonicalizations += 1;
    return canonicalEvidenceValue(key);
  }

  private createScope(id: string): DirectResourceScope {
    const scope: DirectResourceScope = {
      state: { value: 0, text: "" },
      receipts: new Map(),
      revision: 0,
      cursor: 0,
    };
    this.scopes.set(id, scope);
    return scope;
  }

  private decide(
    scope: DirectResourceScope,
    command: DirectResourceCommand,
  ): DirectResourceEvent[] {
    const emit = (
      name: DirectResourceEvent["name"],
      payload: DirectResourceEvent["payload"],
      index: number,
    ): DirectResourceEvent => ({
      id: `${command.id}:${index}`,
      seq: scope.cursor + index + 1,
      name,
      payload,
    });
    switch (command.name) {
      case "add":
        return [emit("added", { delta: Number(command.args[0]) }, 0)];
      case "addBatch":
        return Array.from({ length: Number(command.args[0]) }, (_, index) =>
          emit("added", { delta: 1 }, index),
        );
      case "noop":
        return [];
      case "write":
        return [emit("wrote", { text: String(command.args[0]) }, 0)];
    }
  }

  private apply(scope: DirectResourceScope, event: DirectResourceEvent): void {
    if (event.name === "added" && "delta" in event.payload) {
      scope.state.value += event.payload.delta;
    } else if (event.name === "wrote" && "text" in event.payload) {
      scope.state.text = event.payload.text;
    }
    scope.cursor = event.seq;
  }
}

function directResourceCommand(
  id: string,
  key: DirectResourceKey,
  name: DirectResourceCommand["name"],
  args: readonly unknown[],
  at: number,
  actorId = "owner",
): DirectResourceCommand {
  return { id, key, name, args, actorId, at };
}

function directResourceWork(model: DirectResourceModel, commands: number, events: number) {
  return {
    commands,
    events,
    journalAppends: model.appends,
    authorizations: model.authorizations,
    canonicalizations: model.canonicalizations,
    hashes: model.hashes,
    validations: model.validations,
  };
}

async function runResourceReference(operations: number) {
  const model = new DirectResourceModel();
  for (let index = 0; index < operations; index += 1) {
    await model.command(directResourceCommand(`command-${index}`, "one", "add", [1], index));
  }
  if (model.scope("one").state.value !== operations) {
    throw new Error(`Reference value is ${model.scope("one").state.value}.`);
  }
  return directResourceWork(model, operations, operations);
}

async function runResourceZeroReference(operations: number) {
  const model = new DirectResourceModel();
  for (let index = 0; index < operations; index += 1) {
    await model.command(directResourceCommand(`noop-${index}`, "one", "noop", [], index));
  }
  return directResourceWork(model, operations, 0);
}

async function runResourceReadReference(operations: number, authorized: boolean) {
  const model = new DirectResourceModel();
  const scope = model.scope("one");
  const actorId = authorized ? "owner" : "intruder";
  let reads = 0;
  for (let index = 0; index < operations; index += 1) {
    const value = model.readScope(scope, actorId);
    if (authorized ? value !== 0 : value !== null) {
      throw new Error(`Reference Resource read ${index} returned ${String(value)}.`);
    }
    reads += 1;
  }
  return {
    reads,
    authorizedReads: authorized ? reads : 0,
    rejectedReads: authorized ? 0 : reads,
    authorizations: model.authorizations,
    canonicalizations: model.canonicalizations,
  };
}

async function runResourceDeniedCommandReference(operations: number) {
  const model = new DirectResourceModel();
  for (let index = 0; index < operations; index += 1) {
    await model.command(
      directResourceCommand(`denied-${index}`, "one", "add", [1], index, "intruder"),
    );
  }
  if (model.scope("one").state.value !== 0) {
    throw new Error("A denied reference command changed Resource state.");
  }
  return {
    ...directResourceWork(model, operations, 0),
    rejectedCommands: operations,
  };
}

async function runResourceBatchReference(operations: number) {
  const model = new DirectResourceModel();
  for (let index = 0; index < operations; index += 1) {
    await model.command(directResourceCommand(`batch-${index}`, "one", "addBatch", [4], index));
  }
  if (model.scope("one").state.value !== operations * 4) {
    throw new Error(`Reference batch value is ${model.scope("one").state.value}.`);
  }
  return directResourceWork(model, operations, operations * 4);
}

async function runResourceDuplicateReference(operations: number) {
  const model = new DirectResourceModel();
  const command = model.prepare(directResourceCommand("duplicate", "one", "add", [1], 0));
  await model.execute(command);
  for (let index = 0; index < operations; index += 1) {
    if ((await model.execute(command)) !== "duplicate") {
      throw new Error(`Reference duplicate ${index} was not stable.`);
    }
  }
  return {
    ...directResourceWork(model, 1, 1),
    duplicateChecks: operations,
  };
}

async function runResourceConflictReference(operations: number) {
  const model = new DirectResourceModel();
  await model.command(directResourceCommand("conflict", "one", "add", [1], 0));
  let conflicts = 0;
  for (let index = 0; index < operations; index += 1) {
    try {
      await model.command(directResourceCommand("conflict", "one", "add", [index + 2], 0));
    } catch {
      conflicts += 1;
    }
  }
  if (conflicts !== operations || model.scope("one").state.value !== 1) {
    throw new Error(`Reference detected ${conflicts} conflicting identities.`);
  }
  return {
    ...directResourceWork(model, 1, 1),
    conflictChecks: operations,
    conflicts,
  };
}

async function runResourceIndependentReference(operations: number, structured: boolean) {
  const model = new DirectResourceModel();
  for (let index = 0; index < operations; index += 1) {
    const key = structured ? { id: index, tenant: `tenant-${index % 16}` } : `scope-${index}`;
    await model.command(directResourceCommand(`independent-${index}`, key, "add", [1], index));
  }
  if (model.scopes.size !== operations) {
    throw new Error(`Reference created ${model.scopes.size} independent scopes.`);
  }
  return {
    ...directResourceWork(model, operations, operations),
    structuredKeys: structured ? operations : 0,
  };
}

async function runResourceObserverReference(operations: number) {
  const model = new DirectResourceModel();
  let notifications = 0;
  const stop = model.observe(() => {
    notifications += 1;
  });
  for (let index = 0; index < operations; index += 1) {
    await model.command(directResourceCommand(`observed-${index}`, "one", "add", [1], index));
  }
  stop();
  if (notifications !== operations) {
    throw new Error(`Reference observer received ${notifications} notifications.`);
  }
  return { ...directResourceWork(model, operations, operations), notifications };
}

async function runResourcePayloadReference(operations: number) {
  const model = new DirectResourceModel();
  const text = "x".repeat(operations);
  await model.command(directResourceCommand("payload", "one", "write", [text], 0));
  if (model.scope("one").state.text !== text) {
    throw new Error("Reference Resource did not retain the payload.");
  }
  return { ...directResourceWork(model, 1, 1), payloadBytes: operations };
}

async function runResourceZeroFramework(operations: number) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  let authority = emptyPrimitiveAuthority(app);
  try {
    for (let index = 0; index < operations; index += 1) {
      const result = await executeResourceCommandFromState(
        app,
        createJournalAuthority(journal),
        createPrimitiveIntent(`noop-${index}`, "one", "noop", [], index),
        authority,
      );
      authority = authorityAfter(result, authority);
    }
    return { commands: operations, events: 0, journalAppends: authority.head.revision };
  } finally {
    await journal.close();
  }
}

async function runResourceReadFramework(operations: number, authorized: boolean) {
  const app = createPrimitiveApp();
  const state = app.createState("counter");
  const actor = { id: authorized ? "owner" : "intruder" };
  const definition = app.def.resources.counter;
  const readValue = definition?.views?.value;
  if (!readValue) throw new Error("Primitive Resource value view is unavailable.");
  let reads = 0;
  for (let index = 0; index < operations; index += 1) {
    const allowed = authorizeResource(app, "counter", state, actor, "one", { type: "read" });
    const value = allowed ? readValue({ state, actor, sessions: [], key: "one" }) : null;
    if (authorized ? value !== 0 : value !== null) {
      throw new Error(`Framework Resource read ${index} returned ${String(value)}.`);
    }
    reads += 1;
  }
  return {
    reads,
    authorizedReads: authorized ? reads : 0,
    rejectedReads: authorized ? 0 : reads,
    authorizations: reads,
    canonicalizations: 0,
  };
}

async function runResourceDeniedCommandFramework(operations: number) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  let authority = emptyPrimitiveAuthority(app);
  try {
    for (let index = 0; index < operations; index += 1) {
      const result = await executeResourceCommandFromState(
        app,
        createJournalAuthority(journal),
        createPrimitiveIntent(`denied-${index}`, "one", "add", [1], index, "intruder"),
        authority,
      );
      if (result.record.decision.ok || result.record.decision.error !== "forbidden") {
        throw new Error(`Denied command ${index} was accepted.`);
      }
      authority = authorityAfter(result, authority);
    }
    if (authority.state.value !== 0) throw new Error("A denied command changed Resource state.");
    return {
      commands: operations,
      rejectedCommands: operations,
      events: 0,
      journalAppends: authority.head.revision,
    };
  } finally {
    await journal.close();
  }
}

async function runResourceBatchFramework(operations: number) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  let authority = emptyPrimitiveAuthority(app);
  try {
    for (let index = 0; index < operations; index += 1) {
      const result = await executeResourceCommandFromState(
        app,
        createJournalAuthority(journal),
        createPrimitiveIntent(`batch-${index}`, "one", "addBatch", [4], index),
        authority,
      );
      authority = applyPrimitiveResult(app, result, authority);
    }
    if (authority.state.value !== operations * 4) {
      throw new Error(`Resource batch value is ${authority.state.value}.`);
    }
    return {
      commands: operations,
      events: authority.eventCursor,
      journalAppends: authority.head.revision,
    };
  } finally {
    await journal.close();
  }
}

async function runResourceDuplicateFramework(operations: number) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  const authority = emptyPrimitiveAuthority(app);
  const intent = createPrimitiveIntent("duplicate", "one", "add", [1], 0);
  try {
    const first = await executeResourceCommandFromState(
      app,
      createJournalAuthority(journal),
      intent,
      authority,
    );
    if (first.status !== "committed") throw new Error("Initial duplicate command did not commit.");
    for (let index = 0; index < operations; index += 1) {
      const duplicate = await executeResourceCommandFromState(
        app,
        createJournalAuthority(journal),
        intent,
        authority,
      );
      if (duplicate.status !== "duplicate") throw new Error(`Duplicate ${index} was not stable.`);
    }
    return { duplicateChecks: operations, events: 1, journalAppends: 1 };
  } finally {
    await journal.close();
  }
}

async function runResourceConflictFramework(operations: number) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  let authority = emptyPrimitiveAuthority(app);
  try {
    const first = await executeResourceCommandFromState(
      app,
      createJournalAuthority(journal),
      createPrimitiveIntent("conflict", "one", "add", [1], 0),
      authority,
    );
    authority = applyPrimitiveResult(app, first, authority);
    let conflicts = 0;
    for (let index = 0; index < operations; index += 1) {
      try {
        await executeResourceCommandFromState(
          app,
          createJournalAuthority(journal),
          createPrimitiveIntent("conflict", "one", "add", [index + 2], 0),
          authority,
        );
      } catch {
        conflicts += 1;
      }
    }
    if (conflicts !== operations || authority.state.value !== 1) {
      throw new Error(`Framework detected ${conflicts} conflicting identities.`);
    }
    return { conflictChecks: operations, conflicts, events: 1, journalAppends: 1 };
  } finally {
    await journal.close();
  }
}

async function runResourceIndependentFramework(operations: number, structured: boolean) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  try {
    for (let index = 0; index < operations; index += 1) {
      const key = structured ? { id: index, tenant: `tenant-${index % 16}` } : `scope-${index}`;
      const result = await executeResourceCommandFromState(
        app,
        createJournalAuthority(journal),
        createPrimitiveIntent(`independent-${index}`, key, "add", [1], index),
        emptyPrimitiveAuthority(app),
      );
      if (result.status !== "committed") throw new Error(`Independent command ${index} failed.`);
    }
    return {
      commands: operations,
      events: operations,
      journalAppends: operations,
      structuredKeys: structured ? operations : 0,
    };
  } finally {
    await journal.close();
  }
}

async function runResourceObserverFramework(operations: number) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  let authority = emptyPrimitiveAuthority(app);
  let notifications = 0;
  const received = Promise.withResolvers<void>();
  const subscription = await journal.subscribe(0, () => {
    notifications += 1;
    if (notifications === operations) received.resolve();
  });
  try {
    for (let index = 0; index < operations; index += 1) {
      const result = await executeResourceCommandFromState(
        app,
        createJournalAuthority(journal),
        createPrimitiveIntent(`observed-${index}`, "one", "add", [1], index),
        authority,
      );
      authority = applyPrimitiveResult(app, result, authority);
    }
    await received.promise;
    if (notifications !== operations) throw new Error(`Observer received ${notifications}.`);
    return {
      commands: operations,
      events: authority.eventCursor,
      journalAppends: authority.head.revision,
      notifications,
    };
  } finally {
    await subscription.stop();
    await journal.close();
  }
}

async function runResourcePayloadFramework(operations: number) {
  const app = createPrimitiveApp();
  const journal = createMemoryJournal();
  const text = "x".repeat(operations);
  try {
    const result = await executeResourceCommandFromState(
      app,
      createJournalAuthority(journal),
      createPrimitiveIntent("payload", "one", "write", [text], 0),
      emptyPrimitiveAuthority(app),
    );
    const authority = applyPrimitiveResult(app, result, emptyPrimitiveAuthority(app));
    if (authority.state.text !== text) throw new Error("Resource did not retain the payload.");
    return { commands: 1, events: 1, journalAppends: 1, payloadBytes: operations };
  } finally {
    await journal.close();
  }
}

async function runResourceSqliteStrictFramework(operations: number) {
  const directory = mkdtempSync(join(tmpdir(), "poggers-resource-evidence-"));
  const file = join(directory, "journal.sqlite");
  const app = createPrimitiveApp();
  const journal = createSqliteJournal({
    file,
    durability: "strict",
    commit: "immediate",
  });
  try {
    const authority = await executePrimitiveCommands(app, journal, operations);
    await journal.close();
    const persistedBytes = statSync(file).size;
    return {
      commands: operations,
      events: authority.eventCursor,
      journalAppends: authority.head.revision,
      persistedBytes,
    };
  } finally {
    await journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function prepareResourceSqliteReopen(operations: number) {
  const directory = mkdtempSync(join(tmpdir(), "poggers-resource-reopen-evidence-"));
  const file = join(directory, "journal.sqlite");
  const app = createPrimitiveApp();
  const journal = createSqliteJournal({
    file,
    durability: "strict",
    commit: "immediate",
  });
  const authority = await executePrimitiveCommands(app, journal, operations);
  await journal.close();
  const persistedBytes = statSync(file).size;

  return async () => {
    const reopened = createSqliteJournal({
      file,
      durability: "strict",
      commit: "immediate",
    });
    try {
      const restored = await loadResourceAuthority(app, createJournalAuthority(reopened), {
        resource: "counter",
        key: "one",
      });
      if (!isPrimitiveState(restored.state)) {
        throw new Error("SQLite reopen restored an invalid primitive state.");
      }
      const state = restored.state;
      if (
        state.value !== operations ||
        restored.eventCursor !== authority.eventCursor ||
        restored.head.revision !== authority.head.revision
      ) {
        throw new Error("SQLite reopen did not reconstruct the exact Resource authority.");
      }
      return {
        records: operations,
        events: restored.eventCursor,
        journalRevision: restored.head.revision,
        persistedBytes,
      };
    } finally {
      await reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

function isPrimitiveState(value: unknown): value is PrimitiveAuthority["state"] {
  if (!value || typeof value !== "object") return false;
  return (
    "value" in value &&
    typeof value.value === "number" &&
    "text" in value &&
    typeof value.text === "string"
  );
}

async function runResourceSqliteReopenFramework(operations: number) {
  const reopen = await prepareResourceSqliteReopen(operations);
  return reopen();
}

async function executePrimitiveCommands(
  app: ReturnType<typeof createPrimitiveApp>,
  journal: Journal,
  operations: number,
): Promise<PrimitiveAuthority> {
  let authority = emptyPrimitiveAuthority(app);
  for (let index = 0; index < operations; index += 1) {
    const result = await executeResourceCommandFromState(
      app,
      createJournalAuthority(journal),
      createPrimitiveIntent(`sqlite-${index}`, "one", "add", [1], index),
      authority,
    );
    authority = applyPrimitiveResult(app, result, authority);
  }
  return authority;
}

function createPrimitiveIntent(
  id: string,
  key: PrimitiveApp["Resources"]["counter"]["Key"],
  name: keyof PrimitiveApp["Resources"]["counter"]["Commands"],
  args: readonly unknown[],
  at: number,
  actorId = "owner",
) {
  return createResourceIntent(id, {
    resource: "counter",
    key,
    name,
    args,
    actor: { id: actorId },
    at,
  });
}

function emptyPrimitiveAuthority(app: ReturnType<typeof createPrimitiveApp>): PrimitiveAuthority {
  return {
    state: app.createState("counter"),
    eventCursor: 0,
    head: emptyJournalHead,
    snapshotHead: emptyJournalHead,
    events: [],
  };
}

function authorityAfter(
  result: ResourceCommandResult<PrimitiveApp["Actor"]>,
  authority: PrimitiveAuthority,
): PrimitiveAuthority {
  return {
    ...authority,
    head: { revision: result.record.revision, position: result.record.position },
  };
}

function applyPrimitiveResult(
  app: ReturnType<typeof createPrimitiveApp>,
  result: ResourceCommandResult<PrimitiveApp["Actor"]>,
  authority: PrimitiveAuthority,
): PrimitiveAuthority {
  let eventCursor = authority.eventCursor;
  for (const event of result.record.decision.events) {
    app.applyEvent(
      "counter",
      authority.state,
      {
        id: event.id,
        seq: event.seq,
        at: event.at,
        actor: { id: "owner" },
        name: event.name,
        payload: event.payload,
        ...(event.hash ? { hash: event.hash } : {}),
      },
      event.version,
      event.hash,
    );
    eventCursor = event.seq;
  }
  return {
    ...authority,
    eventCursor,
    head: { revision: result.record.revision, position: result.record.position },
  };
}

async function runProgramFramework(operations: number) {
  let handled = 0;
  const app = createPrimitiveApp(() => {
    handled += 1;
  });
  const program = app.def.programs?.server;
  if (!program) throw new Error("Primitive Program is unavailable.");
  const runtime = startProgram(app, program, {
    env: "server",
    deps: {},
    actor: { id: "owner" },
    programId: "primitive-evidence",
    readViews: () => ({ value: 0 }) as never,
    command: async () => ({ ok: true }),
  });
  try {
    const events = Array.from({ length: operations }, (_, index) =>
      primitiveProgramEvent(index + 1),
    );
    await runtime.enqueue(events);
    await runtime.advanceSource(operations);
    await runtime.drain();
    if (handled !== operations) throw new Error(`Program handled ${handled} events.`);
    const source = await runtime.sourcePosition();
    if (source !== operations) throw new Error(`Program source is ${source}.`);
    return {
      sourceEvents: operations,
      matchedInvocations: handled,
      sourceCheckpoints: Math.ceil(operations / 128),
    };
  } finally {
    await runtime.stop();
  }
}

type DirectProgramConsumer = {
  readonly id: string;
  readonly event: string;
  readonly concurrency?: number;
  readonly filter?: (event: DirectProgramItem["event"]) => boolean;
  readonly run: (event: DirectProgramItem) => void | Promise<void>;
};

type DirectProgramItem = {
  readonly event: ProgramEventItem<PrimitiveApp, "counter.added" | "counter.wrote">["event"];
  readonly resource: "counter";
  readonly key: DirectResourceKey;
  readonly view: { readonly value: number };
  readonly delivery: { readonly attempt: number; readonly uncertainAttempts: readonly number[] };
  readonly createIdempotencyKey: (label: string) => string;
  readonly counter: {
    readonly add: ((delta: number) => Promise<{ readonly ok: true }>) & {
      identified(label: string, delta: number): Promise<{ readonly ok: true }>;
    };
  };
};

class DirectProgramModel {
  readonly consumers: DirectProgramConsumer[] = [];
  readonly consumersByEvent = new Map<string, DirectProgramConsumer[]>();
  readonly completed = new Set<string>();
  readonly sourcePositions = new Map<string, number>();
  claims = 0;
  completions = 0;
  sourceCheckpoints = 0;
  commandCalls = 0;

  consume(consumer: DirectProgramConsumer): void {
    if (this.consumers.some(({ id }) => id === consumer.id)) {
      throw new Error(`Duplicate direct Program consumer ${consumer.id}.`);
    }
    this.consumers.push(consumer);
    const consumers = this.consumersByEvent.get(consumer.event) ?? [];
    consumers.push(consumer);
    this.consumersByEvent.set(consumer.event, consumers);
    this.sourcePositions.set(consumer.id, 0);
  }

  async run(events: readonly ProgramEventRecord<PrimitiveApp>[]): Promise<void> {
    const queues = new Map<
      DirectProgramConsumer,
      Map<string, ProgramEventRecord<PrimitiveApp>[]>
    >();
    for (const event of events) {
      const eventName = `${event.resource}.${event.event.name}`;
      for (const consumer of this.consumersByEvent.get(eventName) ?? []) {
        if (event.event.position <= (this.sourcePositions.get(consumer.id) ?? 0)) continue;
        const publicEvent = {
          ...event.event,
          resource: event.resource,
          key: event.key,
        } as DirectProgramItem["event"];
        if (consumer.filter && !consumer.filter(publicEvent)) continue;
        const scope = `${event.resource}\u0000${canonicalEvidenceValue(event.key)}`;
        const byScope = queues.get(consumer) ?? new Map();
        const queue = byScope.get(scope) ?? [];
        queue.push(event);
        byScope.set(scope, queue);
        queues.set(consumer, byScope);
      }
    }

    await Promise.all(
      [...queues].map(async ([consumer, byScope]) => {
        const scopes = [...byScope];
        let nextScope = 0;
        const processScope = async (): Promise<void> => {
          for (;;) {
            const entry = scopes[nextScope++];
            if (!entry) return;
            const [scope, queue] = entry;
            for (const event of queue) {
              const invocation = `${consumer.id}\u0000${scope}\u0000${event.event.id}`;
              if (this.completed.has(invocation)) continue;
              this.claims += 1;
              await consumer.run(this.createItem(event, invocation));
              this.completed.add(invocation);
              this.completions += 1;
            }
          }
        };
        const concurrency = Math.min(consumer.concurrency ?? 256, scopes.length);
        await Promise.all(Array.from({ length: concurrency }, processScope));
      }),
    );
    const position = events.at(-1)?.event.position;
    if (position !== undefined) {
      for (const consumer of this.consumers) this.sourcePositions.set(consumer.id, position);
      this.sourceCheckpoints += Math.ceil(events.length / 128);
    }
  }

  private createItem(
    stored: ProgramEventRecord<PrimitiveApp>,
    invocation: string,
  ): DirectProgramItem {
    const key = directProgramKey(stored.key);
    const command = async (): Promise<{ readonly ok: true }> => {
      this.commandCalls += 1;
      return { ok: true };
    };
    const add = Object.assign(command, {
      identified: async (_label: string, _delta: number) => command(),
    });
    return {
      event: {
        ...stored.event,
        resource: stored.resource,
        key,
      } as DirectProgramItem["event"],
      resource: "counter",
      key,
      view: { value: 0 },
      delivery: { attempt: 1, uncertainAttempts: [] },
      createIdempotencyKey(label) {
        if (label.length === 0) throw new TypeError("An idempotency label cannot be empty.");
        return `${invocation}:effect:${JSON.stringify(label)}`;
      },
      counter: { add },
    };
  }
}

function directProgramKey(value: JsonValue): DirectResourceKey {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "number" &&
    typeof value.tenant === "string"
  ) {
    return { id: value.id, tenant: value.tenant };
  }
  throw new TypeError("Direct Program evidence received an invalid counter key.");
}

async function runProgramReference(operations: number) {
  let handled = 0;
  const model = new DirectProgramModel();
  model.consume({
    id: "primitive.counter",
    event: "counter.added",
    run() {
      handled += 1;
    },
  });
  await model.run(
    Array.from({ length: operations }, (_, index) => primitiveProgramEvent(index + 1)),
  );
  if (handled !== operations || model.sourcePositions.get("primitive.counter") !== operations) {
    throw new Error(`Direct Program handled ${handled} events at the wrong source position.`);
  }
  return {
    sourceEvents: operations,
    matchedInvocations: handled,
    sourceCheckpoints: model.sourceCheckpoints,
    claims: model.claims,
    completions: model.completions,
  };
}

async function runProgramFilteredReference(operations: number) {
  let filterCalls = 0;
  let handled = 0;
  const model = new DirectProgramModel();
  model.consume({
    id: "filtered",
    event: "counter.added",
    filter() {
      filterCalls += 1;
      return false;
    },
    run() {
      handled += 1;
    },
  });
  await model.run(
    Array.from({ length: operations }, (_, index) => primitiveProgramEvent(index + 1)),
  );
  if (
    filterCalls !== operations ||
    handled !== 0 ||
    model.sourcePositions.get("filtered") !== operations
  ) {
    throw new Error("Direct filtered Program did not advance without invoking its handler.");
  }
  return {
    sourceEvents: operations,
    filterCalls,
    matchedInvocations: 0,
    claims: model.claims,
    completions: model.completions,
  };
}

async function runProgramCommandReference(operations: number) {
  const model = new DirectProgramModel();
  model.consume({
    id: "commands",
    event: "counter.added",
    async run({ counter }) {
      await counter.add.identified("projection", 1);
    },
  });
  await model.run(
    Array.from({ length: operations }, (_, index) => primitiveProgramEvent(index + 1)),
  );
  if (model.commandCalls !== operations) {
    throw new Error(`Direct Program emitted ${model.commandCalls} commands.`);
  }
  return {
    sourceEvents: operations,
    matchedInvocations: operations,
    commandCalls: model.commandCalls,
    claims: model.claims,
    completions: model.completions,
  };
}

async function runProgramPayloadReference(operations: number) {
  let payloadBytes = 0;
  const model = new DirectProgramModel();
  model.consume({
    id: "payload",
    event: "counter.wrote",
    run({ event }) {
      payloadBytes = (event.payload as { readonly text: string }).text.length;
    },
  });
  await model.run([primitiveProgramTextEvent(operations)]);
  if (payloadBytes !== operations) throw new Error(`Direct Program read ${payloadBytes} bytes.`);
  return {
    sourceEvents: 1,
    matchedInvocations: 1,
    payloadBytes,
    claims: model.claims,
    completions: model.completions,
  };
}

async function runProgramConsumersReference(consumers: number, matching: boolean) {
  const sourceEvents = matching ? 1_000 : 10_000;
  let handled = 0;
  const model = new DirectProgramModel();
  for (let index = 0; index < consumers; index += 1) {
    model.consume({
      id: `consumer-${index}`,
      event: matching || index === 0 ? "counter.added" : "counter.ignored",
      run() {
        handled += 1;
      },
    });
  }
  await model.run(
    Array.from({ length: sourceEvents }, (_, index) => primitiveProgramEvent(index + 1)),
  );
  const expected = matching ? sourceEvents * consumers : sourceEvents;
  if (handled !== expected) {
    throw new Error(`Direct Program handled ${handled}, expected ${expected}.`);
  }
  return {
    consumers,
    sourceEvents,
    matchedInvocations: handled,
    unrelatedConsumers: matching ? 0 : Math.max(0, consumers - 1),
    claims: model.claims,
    completions: model.completions,
  };
}

async function runProgramPartitionsReference(operations: number, independent: boolean) {
  let handled = 0;
  const model = new DirectProgramModel();
  model.consume({
    id: "partitions",
    event: "counter.added",
    run() {
      handled += 1;
    },
  });
  await model.run(
    Array.from({ length: operations }, (_, index) =>
      primitiveProgramEvent(index + 1, independent ? `scope-${index}` : "one"),
    ),
  );
  if (handled !== operations) throw new Error(`Direct Program handled ${handled} events.`);
  return {
    sourceEvents: operations,
    matchedInvocations: handled,
    partitions: independent ? operations : 1,
    claims: model.claims,
    completions: model.completions,
  };
}

async function runProgramReplayReference(operations: number) {
  let handled = 0;
  const model = new DirectProgramModel();
  model.consume({
    id: "replay",
    event: "counter.added",
    run() {
      handled += 1;
    },
  });
  const events = Array.from({ length: operations }, (_, index) => primitiveProgramEvent(index + 1));
  await model.run(events);
  const claims = model.claims;
  const source = model.sourcePositions.get("replay") ?? 0;
  const replayed = events.slice(source);
  await model.run(replayed);
  if (handled !== operations || model.claims !== claims) {
    throw new Error(`Direct replay duplicated ${handled - operations} events.`);
  }
  return {
    sourceEvents: operations,
    replayedSourceEvents: replayed.length,
    initialInvocations: operations,
    replayedInvocations: 0,
    claims,
    completions: model.completions,
  };
}

async function runProgramFilteredFramework(operations: number) {
  let filterCalls = 0;
  let handled = 0;
  const app = createPrimitiveApp();
  const program: AppProgram<PrimitiveApp, "server"> = async ({ consume }) => {
    await consume({
      id: "filtered",
      events: ["counter.added"],
      startAt: "origin",
      run() {
        filterCalls += 1;
        return;
      },
    });
  };
  const runtime = startPrimitiveProgram(app, program);
  try {
    await runtime.enqueue(
      Array.from({ length: operations }, (_, index) => primitiveProgramEvent(index + 1)),
    );
    await runtime.advanceSource(operations);
    await runtime.drain();
    if (
      filterCalls !== operations ||
      handled !== 0 ||
      (await runtime.sourcePosition()) !== operations
    ) {
      throw new Error("Filtered Program did not advance without invoking its handler.");
    }
    return { sourceEvents: operations, filterCalls, matchedInvocations: 0 };
  } finally {
    await runtime.stop();
  }
}

async function runProgramCommandFramework(operations: number) {
  let commandCalls = 0;
  const app = createPrimitiveApp();
  const program: AppProgram<PrimitiveApp, "server"> = async ({ consume }) => {
    await consume({
      id: "commands",
      events: ["counter.added"],
      startAt: "origin",
      async run({ counter }) {
        await counter.add.identified("projection", { delta: 1 });
      },
    });
  };
  const runtime = startProgram(app, program, {
    env: "server",
    deps: {},
    actor: { id: "owner" },
    programId: "primitive-evidence",
    progress: createMemoryProgramProgressStore(),
    maxPendingEvents: 100_000,
    readViews: () => ({ value: 0 }) as never,
    command: async () => {
      commandCalls += 1;
      return { ok: true };
    },
  });
  try {
    await runtime.enqueue(
      Array.from({ length: operations }, (_, index) => primitiveProgramEvent(index + 1)),
    );
    await runtime.advanceSource(operations);
    await runtime.drain();
    if (commandCalls !== operations) throw new Error(`Program emitted ${commandCalls} commands.`);
    return { sourceEvents: operations, matchedInvocations: operations, commandCalls };
  } finally {
    await runtime.stop();
  }
}

async function runProgramPayloadFramework(operations: number) {
  let payloadBytes = 0;
  const app = createPrimitiveApp();
  const program: AppProgram<PrimitiveApp, "server"> = async ({ consume }) => {
    await consume({
      id: "payload",
      events: ["counter.wrote"],
      startAt: "origin",
      run({ event }) {
        payloadBytes = event.payload.text.length;
      },
    });
  };
  const runtime = startPrimitiveProgram(app, program);
  try {
    await runtime.enqueue(primitiveProgramTextEvent(operations));
    await runtime.advanceSource(1);
    await runtime.drain();
    if (payloadBytes !== operations) throw new Error(`Program read ${payloadBytes} bytes.`);
    return { sourceEvents: 1, matchedInvocations: 1, payloadBytes };
  } finally {
    await runtime.stop();
  }
}

async function runProgramConsumersFramework(consumers: number, matching: boolean) {
  const sourceEvents = matching ? 1_000 : 10_000;
  let handled = 0;
  const app = createPrimitiveApp();
  const program: AppProgram<PrimitiveApp, "server"> = async ({ consume }) => {
    await Promise.all(
      Array.from({ length: consumers }, (_, index) =>
        consume({
          id: `consumer-${index}`,
          events: [matching || index === 0 ? "counter.added" : "counter.ignored"],
          startAt: "origin",
          concurrency: 256,
          run() {
            handled += 1;
          },
        }),
      ),
    );
  };
  const runtime = startPrimitiveProgram(app, program);
  try {
    await runtime.enqueue(
      Array.from({ length: sourceEvents }, (_, index) => primitiveProgramEvent(index + 1)),
    );
    await runtime.advanceSource(sourceEvents);
    await runtime.drain();
    const expected = matching ? sourceEvents * consumers : sourceEvents;
    if (handled !== expected) throw new Error(`Program handled ${handled}, expected ${expected}.`);
    return {
      consumers,
      sourceEvents,
      matchedInvocations: handled,
      unrelatedConsumers: matching ? 0 : Math.max(0, consumers - 1),
    };
  } finally {
    await runtime.stop();
  }
}

async function runProgramPartitionsFramework(operations: number, independent: boolean) {
  let handled = 0;
  const app = createPrimitiveApp();
  const program: AppProgram<PrimitiveApp, "server"> = async ({ consume }) => {
    await consume({
      id: "partitions",
      events: ["counter.added"],
      startAt: "origin",
      concurrency: 256,
      run() {
        handled += 1;
      },
    });
  };
  const runtime = startPrimitiveProgram(app, program);
  try {
    await runtime.enqueue(
      Array.from({ length: operations }, (_, index) =>
        primitiveProgramEvent(index + 1, independent ? `scope-${index}` : "one"),
      ),
    );
    await runtime.advanceSource(operations);
    await runtime.drain();
    if (handled !== operations) throw new Error(`Program handled ${handled} events.`);
    return {
      sourceEvents: operations,
      matchedInvocations: handled,
      partitions: independent ? operations : 1,
    };
  } finally {
    await runtime.stop();
  }
}

async function runProgramReplayFramework(operations: number) {
  let handled = 0;
  const app = createPrimitiveApp();
  const progress = createMemoryProgramProgressStore();
  const program: AppProgram<PrimitiveApp, "server"> = async ({ consume }) => {
    await consume({
      id: "replay",
      events: ["counter.added"],
      startAt: "origin",
      concurrency: 256,
      run() {
        handled += 1;
      },
    });
  };
  const events = Array.from({ length: operations }, (_, index) => primitiveProgramEvent(index + 1));
  const first = startPrimitiveProgram(app, program, progress);
  await first.enqueue(events);
  await first.advanceSource(operations);
  await first.drain();
  await first.stop();
  if (handled !== operations) throw new Error(`Initial Program handled ${handled} events.`);

  const replay = startPrimitiveProgram(app, program, progress);
  try {
    const source = await replay.sourcePosition();
    const replayed = events.slice(source);
    if (replayed.length > 0) {
      await replay.enqueue(replayed);
      await replay.advanceSource(replayed.at(-1)!.event.position);
    }
    await replay.drain();
    if (handled !== operations)
      throw new Error(`Replay duplicated ${handled - operations} events.`);
    return {
      sourceEvents: operations,
      replayedSourceEvents: replayed.length,
      initialInvocations: operations,
      replayedInvocations: 0,
    };
  } finally {
    await replay.stop();
  }
}

function startPrimitiveProgram(
  app: ReturnType<typeof createPrimitiveApp>,
  program: AppProgram<PrimitiveApp, "server">,
  progress = createMemoryProgramProgressStore(),
) {
  return startProgram(app, program, {
    env: "server",
    deps: {},
    actor: { id: "owner" },
    programId: "primitive-evidence",
    progress,
    maxPendingEvents: 100_000,
    readViews: () => ({ value: 0 }) as never,
    command: async () => ({ ok: true }),
  });
}

function primitiveProgramEvent(position: number, key = "one"): ProgramEventRecord<PrimitiveApp> {
  return {
    resource: "counter",
    key,
    event: {
      id: `event-${position}`,
      seq: position,
      position,
      index: 0,
      at: position,
      version: 1,
      actor: { id: "owner" },
      name: "added",
      payload: { delta: 1 },
    },
  };
}

function primitiveProgramTextEvent(payloadBytes: number): ProgramEventRecord<PrimitiveApp> {
  return {
    resource: "counter",
    key: "one",
    event: {
      id: "payload",
      seq: 1,
      position: 1,
      index: 0,
      at: 1,
      version: 1,
      actor: { id: "owner" },
      name: "wrote",
      payload: { text: "x".repeat(payloadBytes) },
    },
  };
}

function createDependencyImplementations(operations: number, lifecycle: string[]) {
  const implementations: Record<string, DependencyImplementation<number>> = {};
  for (let index = 0; index < operations; index += 1) {
    implementations[`dependency${index}`] = {
      kind: "dependency",
      start() {
        lifecycle.push(`start:${index}`);
        return index;
      },
      stop() {
        lifecycle.push(`stop:${index}`);
      },
    };
  }
  return implementations;
}

async function runDependencyFramework(operations: number) {
  const lifecycle: string[] = [];
  const runtime = await startDependencies(createDependencyImplementations(operations, lifecycle));
  await runtime.stop();
  assertDependencyLifecycle(lifecycle, operations);
  return { starts: operations, lookups: operations, stops: operations };
}

async function runDependencyCallsFramework(operations: number) {
  let calls = 0;
  const runtime = await startDependencies({
    calculate(value: number) {
      calls += 1;
      return value + 1;
    },
  });
  let result = 0;
  for (let index = 0; index < operations; index += 1) {
    result = runtime.dependencies.calculate(result);
  }
  await runtime.stop();
  if (calls !== operations || result !== operations) {
    throw new Error(`Dependency handled ${calls} calls with result ${result}.`);
  }
  return { starts: 0, calls, stops: 0 };
}

async function runDependencyCallsReference(operations: number) {
  let calls = 0;
  const calculate = (value: number): number => {
    calls += 1;
    return value + 1;
  };
  const dependencies = Object.freeze({ calculate });
  let result = 0;
  for (let index = 0; index < operations; index += 1) {
    result = dependencies.calculate(result);
  }
  if (calls !== operations || result !== operations) {
    throw new Error(`Direct dependency handled ${calls} calls with result ${result}.`);
  }
  return { starts: 0, calls, stops: 0 };
}

async function runDependencyReference(operations: number) {
  const lifecycle: string[] = [];
  const implementations = createDependencyImplementations(operations, lifecycle);
  const values = new Map<string, number>();
  const stops: Array<() => void | Promise<void>> = [];
  for (const [name, implementation] of Object.entries(implementations)) {
    if (typeof implementation === "number") {
      values.set(name, implementation);
      continue;
    }
    const value = await implementation.start({
      signal: new AbortController().signal,
      data: { namespace: "poggers", name: "application" },
    });
    values.set(name, value);
    if (implementation.stop) stops.push(() => implementation.stop?.(value));
  }
  for (const stop of stops.reverse()) await stop();
  if (values.size !== operations) throw new Error(`Reference started ${values.size} dependencies.`);
  assertDependencyLifecycle(lifecycle, operations);
  return { starts: operations, lookups: operations, stops: operations };
}

async function runDependencyGroupsFramework(operations: number) {
  const lifecycle: string[] = [];
  const groups: Record<string, Record<string, DependencyImplementation<number>>> = {};
  for (let index = 0; index < operations; index += 1) {
    groups[`feature${index}`] = createDependencyImplementations(1, lifecycle);
  }
  const runtime = await startDependencyGroups(groups);
  await runtime.stop();
  if (Object.keys(runtime.groups).length !== operations) {
    throw new Error(`Dependency groups produced ${Object.keys(runtime.groups).length} owners.`);
  }
  if (lifecycle.length !== operations * 2) {
    throw new Error(`Dependency groups contain ${lifecycle.length} lifecycle entries.`);
  }
  return { owners: operations, starts: operations, lookups: operations, stops: operations };
}

async function runDependencyGroupsReference(operations: number) {
  const lifecycle: string[] = [];
  const groups: Record<string, Readonly<Record<string, number>>> = {};
  const stops: Array<() => void | Promise<void>> = [];
  for (let index = 0; index < operations; index += 1) {
    const implementations = createDependencyImplementations(1, lifecycle);
    const dependencies: Record<string, number> = {};
    for (const [name, implementation] of Object.entries(implementations)) {
      if (typeof implementation === "number") {
        dependencies[name] = implementation;
        continue;
      }
      const value = await implementation.start({
        signal: new AbortController().signal,
        data: { namespace: "poggers", name: `feature${index}` },
      });
      dependencies[name] = value;
      if (implementation.stop) stops.push(() => implementation.stop?.(value));
    }
    groups[`feature${index}`] = Object.freeze(dependencies);
  }
  for (const stop of stops.reverse()) await stop();
  if (Object.keys(groups).length !== operations || lifecycle.length !== operations * 2) {
    throw new Error("Direct dependency groups produced an incomplete lifecycle.");
  }
  return { owners: operations, starts: operations, lookups: operations, stops: operations };
}

function assertDependencyLifecycle(lifecycle: readonly string[], operations: number): void {
  if (lifecycle.length !== operations * 2) {
    throw new Error(`Dependency lifecycle contains ${lifecycle.length} entries.`);
  }
  if (lifecycle[0] !== "start:0" || lifecycle.at(-1) !== "stop:0") {
    throw new Error("Dependencies did not stop in reverse order.");
  }
}

async function runTestingFramework(operations: number) {
  const app = createPrimitiveApp();
  const fixture = testApp(app, { actor: { id: "owner" } });
  const counter = fixture.resource("counter", "one");
  for (let index = 0; index < operations; index += 1) {
    const receipt = await counter.add({ delta: 1 });
    if (!receipt.ok) throw new Error(`Test command ${index} failed.`);
  }
  if (counter.value !== operations) throw new Error(`Test host value is ${counter.value}.`);
  return { commands: operations, events: counter.events().length, notifications: 0 };
}

async function runTestingReference(operations: number) {
  const app = createPrimitiveApp();
  const actor = { id: "owner" };
  const state = app.createState("counter");
  const events: Array<{
    readonly id: string;
    readonly seq: number;
    readonly at: number;
    readonly actor: { readonly id: string };
    readonly name: string;
    readonly payload: unknown;
  }> = [];
  let cursor = 0;
  for (let index = 0; index < operations; index += 1) {
    if (
      !authorizeResource(app, "counter", state, actor, "one", {
        type: "command",
        name: "add",
      })
    ) {
      throw new Error(`Reference test command ${index} was forbidden.`);
    }
    const emitted: Array<{
      id: string;
      seq: number;
      at: number;
      actor: { id: string };
      name: string;
      payload: unknown;
    }> = [];
    app.runCommand(
      "counter",
      state,
      actor,
      "one",
      "add",
      [1],
      (event) => emitted.push(event),
      (error) => {
        throw new Error(`Reference test command ${index} failed: ${error}.`);
      },
      { id: `test:counter\u0000"one":add:${cursor + 1}`, at: cursor + 1 },
    );
    for (const event of emitted) {
      cursor += 1;
      const stored = { ...event, seq: cursor };
      app.applyEvent("counter", state, stored);
      events.push(stored);
    }
  }
  const value = app.def.resources.counter?.views?.value?.({
    state,
    actor,
    sessions: [],
    key: "one",
  });
  if (value !== operations || events.length !== operations) {
    throw new Error(`Reference test value is ${String(value)} with ${events.length} events.`);
  }
  return { commands: operations, events: events.length, notifications: 0 };
}

async function verifyEvidence(argument: string): Promise<void> {
  const paths = argument.slice("--verify-evidence=".length).split(",").filter(Boolean);
  if (paths.length === 0) throw new TypeError("Evidence verification requires at least one file.");

  const rows = new Map<string, EvidenceItem>();
  for (const path of paths) {
    const value: unknown = await Bun.file(path).json();
    if (!Array.isArray(value)) throw new TypeError(`${path} does not contain an evidence array.`);
    for (const item of value) {
      if (!isEvidenceItem(item)) continue;
      rows.set(`${item.scenario}:${item.operations}`, item);
    }
  }

  const failures: string[] = [];
  const verdicts: unknown[] = [];
  for (const budget of equivalentBudgets) {
    const operationCounts = [...rows.values()]
      .filter((item) => item.scenario === budget.reference)
      .map((item) => item.operations)
      .filter((operations) => rows.has(`${budget.framework}:${operations}`));
    const operations = Math.max(...operationCounts);
    if (!Number.isFinite(operations)) {
      failures.push(`${budget.framework}: missing equivalent reference rows`);
      continue;
    }
    const reference = rows.get(`${budget.reference}:${operations}`)!;
    const framework = rows.get(`${budget.framework}:${operations}`)!;
    const timeRatio = framework.medianMs / reference.medianMs;
    const rssRatio = framework.medianRssDeltaBytes / reference.medianRssDeltaBytes;
    const tailRatio = framework.p95Ms / framework.medianMs;
    const passed =
      timeRatio <= budget.maxTimeRatio && rssRatio <= budget.maxRssRatio && tailRatio <= 1.6;
    verdicts.push({
      kind: "equivalent-budget",
      scenario: budget.framework,
      operations,
      timeRatio,
      maxTimeRatio: budget.maxTimeRatio,
      rssRatio,
      maxRssRatio: budget.maxRssRatio,
      tailRatio,
      maxTailRatio: 1.6,
      passed,
    });
    if (!passed) {
      failures.push(
        `${budget.framework}@${operations}: time ${timeRatio.toFixed(2)}/${budget.maxTimeRatio}, ` +
          `rss ${rssRatio.toFixed(2)}/${budget.maxRssRatio}, tail ${tailRatio.toFixed(2)}/1.6`,
      );
    }
  }

  for (const budget of scalingBudgets) {
    const low = rows.get(`${budget.scenario}:${budget.low}`);
    const high = rows.get(`${budget.scenario}:${budget.high}`);
    if (!low && !high) continue;
    if (!low || !high) {
      failures.push(`${budget.scenario}: missing ${budget.low} or ${budget.high} scaling row`);
      continue;
    }
    const timeGrowth = high.medianMs / low.medianMs;
    const passed = timeGrowth <= budget.maxTimeGrowth;
    verdicts.push({
      kind: "scaling-budget",
      scenario: budget.scenario,
      low: budget.low,
      high: budget.high,
      timeGrowth,
      maxTimeGrowth: budget.maxTimeGrowth,
      passed,
    });
    if (!passed) {
      failures.push(
        `${budget.scenario} ${budget.low}->${budget.high}: ` +
          `growth ${timeGrowth.toFixed(2)}/${budget.maxTimeGrowth}`,
      );
    }
  }

  for (const verdict of verdicts) console.log(JSON.stringify(verdict));
  if (failures.length > 0) {
    throw new Error(`Primitive evidence failed locked budgets:\n${failures.join("\n")}`);
  }
  console.log(
    JSON.stringify({
      kind: "primitive-evidence-verdict",
      passed: true,
      budgets: verdicts.length,
      files: paths,
    }),
  );
}

function isEvidenceItem(value: unknown): value is EvidenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.kind === "primitive" &&
    typeof item.scenario === "string" &&
    typeof item.operations === "number" &&
    typeof item.medianMs === "number" &&
    typeof item.p95Ms === "number" &&
    typeof item.medianRssDeltaBytes === "number"
  );
}

function numberOrder(left: number, right: number): number {
  return left - right;
}

function percentile(sorted: readonly number[], value: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? 0;
}

if (verifyEvidenceArgument) {
  await verifyEvidence(verifyEvidenceArgument);
} else if (scenario === "child") {
  const childScenario = process.argv[3] as Scenario;
  const operations = Number(process.argv[4]);
  console.log(JSON.stringify(await runChild(childScenario, operations)));
} else {
  await runParent();
}
