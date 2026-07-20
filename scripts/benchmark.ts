import { computed, effect, endBatch, signal, startBatch } from "alien-signals";

import {
  createWebPresentationAdapter,
  type WebStyleHost,
} from "../src/adapters/web/ui/presentation/adapter";
import {
  compileWebDynamicStyle,
  compileWebStyle,
} from "../src/adapters/web/ui/presentation/compiler";
import {
  createDynamicsTrajectory,
  createSpringTrajectory,
  sampleSpringTrajectory,
  sampleTrack,
  spring,
} from "../src/adapters/web/ui/presentation/dynamics";
import { createWebAnimationHost } from "../src/adapters/web/ui/presentation/runtime/animation";
import { planWebExecution } from "../src/adapters/web/ui/presentation/runtime/execution";
import { evaluatePresentationFrame } from "../src/core/presentation";
import { createReactiveState } from "../src/core/state";

type Result = Readonly<{
  benchmark: string;
  iterations: number;
  p50: number;
  p95: number;
  work: string;
}>;

const samples = benchmarkSamples();
const results: Result[] = [];

function measure(
  benchmark: string,
  run: () => void,
  options: Readonly<{ iterations?: number; work?: string }> = {},
): void {
  const iterations = options.iterations ?? 100_000;
  for (let index = 0; index < Math.min(iterations, 10_000); index++) run();
  const timings: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const started = performance.now();
    for (let index = 0; index < iterations; index++) run();
    timings.push(((performance.now() - started) * 1_000_000) / iterations);
  }
  timings.sort((left, right) => left - right);
  results.push({
    benchmark,
    iterations,
    p50: percentile(timings, 0.5),
    p95: percentile(timings, 0.95),
    work: options.work ?? "one operation",
  });
}

const direct = signal(0);
let directValue = 0;
effect(() => {
  directValue = direct();
});
measure("alien signal write", () => direct(directValue + 1), {
  work: "one dependent effect",
});

const previousCell = signal(0);
const previousCells = new Map([["count", previousCell]]);
const previousDisposed = () => false;
const previousState = new Proxy(Object.create(null) as Record<string, number>, {
  get: (_target, name) => (typeof name === "string" ? previousCells.get(name)?.() : undefined),
  set: (_target, name, value) => {
    if (typeof name !== "string") return false;
    if (previousDisposed()) return true;
    previousCells.get(name)?.(value);
    return true;
  },
});
let previousValue = 0;
effect(() => {
  previousValue = previousState.count ?? 0;
});
measure(
  "previous runtime state write",
  () => {
    previousState.count = previousValue + 1;
  },
  { work: "Proxy -> Map -> signal -> one effect" },
);

const state = createReactiveState({ count: 0 }, (value) => signal(value));
let stateValue = 0;
effect(() => {
  stateValue = state.read.count as number;
});
measure(
  "poggers root state write",
  () => {
    state.mutable.count = stateValue + 1;
  },
  { work: "Proxy -> direct cell -> one effect" },
);

const nested = createReactiveState({ profile: { count: 0, unrelated: 0 } }, (value) =>
  signal(value),
);
const profile = nested.mutable.profile as { count: number; unrelated: number };
let nestedValue = 0;
effect(() => {
  nestedValue = (nested.read.profile as typeof profile).count;
});
measure(
  "poggers nested state write",
  () => {
    profile.count = nestedValue + 1;
  },
  { work: "lazy nested cell -> one effect" },
);

const wideInitial = Object.fromEntries(
  Array.from({ length: 10_000 }, (_, index) => [`field${index}`, 0]),
);
const wide = createReactiveState(wideInitial, (value) => signal(value));
let wideValue = 0;
effect(() => {
  wideValue = wide.read.field5000 as number;
});
measure(
  "one of 10,000 state fields",
  () => {
    wide.mutable.field5000 = wideValue + 1;
  },
  { work: "one dependent, 9,999 unaffected" },
);

const leafSignals = Array.from({ length: 10_000 }, () => signal(0));
const textLeaves = Array.from({ length: 10_000 }, () => ({ data: "0" }));
for (let index = 0; index < leafSignals.length; index++) {
  const source = leafSignals[index]!;
  const target = textLeaves[index]!;
  effect(() => {
    target.data = String(source());
  });
}
let leafValue = 0;
measure(
  "one of 10,000 text leaves",
  () => {
    leafSignals[5000]!(++leafValue);
  },
  { work: "one Text.data assignment, 9,999 unaffected" },
);

const fanout = Array.from({ length: 100 }, () => signal(0));
let fanoutValue = 0;
let fanoutRuns = 0;
for (const source of fanout) {
  effect(() => {
    source();
    fanoutRuns += 1;
  });
}
measure(
  "batched fan-out",
  () => {
    startBatch();
    for (const source of fanout) source(++fanoutValue);
    endBatch();
  },
  { iterations: 5_000, work: "100 writes and 100 effects in one transaction" },
);

const chainRoot = signal(0);
let chain: () => number = chainRoot;
for (let index = 0; index < 100; index++) {
  const previous = chain;
  chain = computed(() => previous() + 1);
}
let chainValue = 0;
effect(() => {
  chainValue = chain();
});
measure("deep dependency chain", () => chainRoot(chainValue + 1), {
  iterations: 20_000,
  work: "100 computed nodes and one effect",
});

let compilationValue = 0;
measure(
  "web Presentation cold compile",
  () => {
    compileWebStyle({
      layout: { padding: compilationValue++ % 17 },
      paint: { opacity: (compilationValue % 10) / 10 },
    });
  },
  { iterations: 20_000, work: "normalize, hash, and emit one declaration" },
);

const ownerDocument = {};
const classes = new Set<string>();
const target = {
  ownerDocument,
  isConnected: true,
  addEventListener() {},
  removeEventListener() {},
  getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
  classList: {
    add: (...values: string[]) => values.forEach((value) => classes.add(value)),
    remove: (...values: string[]) => values.forEach((value) => classes.delete(value)),
    replace: (previous: string, next: string) => {
      if (!classes.delete(previous)) return false;
      classes.add(next);
      return true;
    },
  },
} as unknown as Element;
const host: WebStyleHost = { replace() {}, dispose() {} };
const presentation = createWebPresentationAdapter({ createStyleHost: () => host }).mount({
  boundary: target,
});
const session = presentation.create({
  boundary: target,
  elements: { Root: () => [target] },
});
const warmDeclaration = { Root: { paint: { opacity: 0.7 } } } as const;
session.render(() => warmDeclaration);
measure("web Presentation warm commit", () => session.render(() => warmDeclaration), {
  work: "identity cache hit and zero native mutation",
});
session.dispose();
presentation.dispose();

const motionSpring = spring({ stiffness: 520, damping: 42 });
let motionTarget = 1;
measure(
  "spring trajectory creation",
  () => {
    createSpringTrajectory({
      from: 0,
      to: motionTarget++ % 2,
      velocity: 600,
      spring: motionSpring,
    });
  },
  { iterations: 2_000, work: "analytical solve and deterministic settling" },
);

const motionTrajectory = createSpringTrajectory({
  from: -320,
  to: 0,
  velocity: 1_200,
  spring: motionSpring,
});
const interruptedMotion = motionTrajectory.at(80);
let interruptionTarget = -320;
measure(
  "spring interruption planning",
  () => {
    createSpringTrajectory({
      from: interruptedMotion.value,
      to: interruptionTarget,
      velocity: interruptedMotion.velocity,
      spring: motionSpring,
    });
    interruptionTarget = interruptionTarget === 0 ? -320 : 0;
  },
  { iterations: 2_000, work: "retarget from displayed value and incoming velocity" },
);

let animationHostTime = 0;
const animationHost = createWebAnimationHost({
  now: () => animationHostTime,
  reducedMotion: () => false,
});
measure(
  "Presentation frame for 1,000 Animation bindings",
  () => {
    animationHostTime += 1_000 / 120;
    animationHost.begin(animationHostTime);
    evaluatePresentationFrame(animationHost, () => {
      for (let target = 0; target < 1_000; target += 1) {
        animationHost.sample(`binding:${target}`, 1, motionSpring);
      }
    });
    animationHost.end();
  },
  { iterations: 1_000, work: "lookup, sample, and settle 1,000 retained bindings" },
);
animationHost.dispose();

let motionTime = 0;
measure(
  "spring trajectory sample",
  () => {
    motionTrajectory.at(((motionTime++ % 1_000) / 1_000) * motionTrajectory.duration);
  },
  { work: "analytical position and velocity" },
);

for (const [targets, iterations] of [
  [1, 100_000],
  [100, 10_000],
  [500, 2_000],
  [1_000, 1_000],
] as const) {
  let frame = 0;
  measure(
    `spring frame for ${targets.toLocaleString()} targets`,
    () => {
      const time = ((frame++ % 1_000) / 1_000) * motionTrajectory.duration;
      for (let target = 0; target < targets; target++) motionTrajectory.at(time);
    },
    { iterations, work: `${targets.toLocaleString()} canonical trajectory samples` },
  );
}

measure(
  "spring adaptive keyframes",
  () => {
    sampleSpringTrajectory(motionTrajectory);
  },
  { iterations: 2_000, work: "native WAAPI keyframe approximation" },
);

const plannerSamples = Array.from(
  { length: Math.ceil(motionTrajectory.duration / (1_000 / 480)) + 1 },
  (_, index) => {
    const time = Math.min(motionTrajectory.duration, index * (1_000 / 480));
    const value = motionTrajectory.at(time).value;
    return {
      time,
      declarations: {
        Root: {
          paint: { opacity: Math.max(0, Math.min(1, 1 + value / 320)) },
          transform: { translate: { y: value } },
        },
      },
    } as const;
  },
);
measure(
  "web native execution planning",
  () => planWebExecution(plannerSamples, { Root: () => [target] }),
  { iterations: 500, work: `${plannerSamples.length} canonical declaration samples` },
);
const fallbackSamples = plannerSamples.map((sample) => ({
  ...sample,
  declarations: {
    Root: {
      ...sample.declarations.Root,
      paint: {
        ...sample.declarations.Root.paint,
        radius: 8 + 8 * Number(sample.declarations.Root.paint.opacity),
      },
    },
  },
}));
measure(
  "web canonical fallback planning",
  () => planWebExecution(fallbackSamples, { Root: () => [target] }),
  { iterations: 500, work: `${fallbackSamples.length} samples rejected for changing paint` },
);

const sampledDynamics = sampleTrack({
  duration: 1_200,
  count: 241,
  sample: (progress) => progress + Math.sin(progress * Math.PI * 8) * (1 - progress) * 0.08,
});
const sampledTrajectory = createDynamicsTrajectory({
  from: 0,
  target: 1,
  velocity: 0,
  dynamics: sampledDynamics,
});
let sampledTime = 0;
measure("sampled track lookup", () => sampledTrajectory.at((sampledTime++ % 144) * (1_000 / 120)), {
  work: `${sampledDynamics.samples.length} samples, binary search and cubic interpolation`,
});
measure(
  "sampled track creation",
  () =>
    sampleTrack({
      duration: 1_200,
      count: 241,
      sample: (progress) => progress + Math.sin(progress * Math.PI * 8) * (1 - progress) * 0.08,
    }),
  { iterations: 2_000, work: "authoring-time bake, validation, velocity estimation and freeze" },
);
let sampledFrame = 0;
measure(
  "sampled track frame for 1,000 targets",
  () => {
    const time = (sampledFrame++ % 144) * (1_000 / 120);
    for (let target = 0; target < 1_000; target += 1) sampledTrajectory.at(time);
  },
  { iterations: 1_000, work: "1,000 canonical 120 Hz trajectory samples" },
);

let presentationFrame = 0;
measure(
  "Presentation dynamic frame compilation",
  () => {
    const openness = (presentationFrame++ % 1_000) / 1_000;
    compileWebDynamicStyle({
      paint: { opacity: openness, radius: 36 - 8 * openness },
      transform: { translate: { y: 720 * (1 - openness) }, scale: 0.96 + 0.04 * openness },
    });
  },
  { iterations: 20_000, work: "stable CSS template and four sampled custom properties" },
);

console.log(`${process.version} ${process.platform}/${process.arch}; ${samples} samples per case`);
console.table(
  results.map((result) => ({
    benchmark: result.benchmark,
    iterations: result.iterations.toLocaleString(),
    "p50 ns/op": result.p50.toFixed(1),
    "p95 ns/op": result.p95.toFixed(1),
    work: result.work,
  })),
);

function percentile(values: readonly number[], quantile: number): number {
  return values[Math.min(values.length - 1, Math.floor(values.length * quantile))]!;
}

function benchmarkSamples(): number {
  const configured = Number(process.env.POGGERS_BENCHMARK_SAMPLES ?? 15);
  if (!Number.isInteger(configured) || configured <= 0) {
    throw new TypeError("POGGERS_BENCHMARK_SAMPLES must be a positive integer.");
  }
  return configured;
}
