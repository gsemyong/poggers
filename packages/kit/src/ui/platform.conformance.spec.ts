import { platformConformance, type PlatformConformanceHarness } from "./platform.conformance";

type Target = Readonly<{ id: string }>;

platformConformance("transactional reference", createHarness);

function createHarness(): PlatformConformanceHarness<Target> {
  let arrangement: readonly Target[] = [];
  const records = new Map<
    Target,
    {
      revision: number;
      semantic: string | undefined;
      visual: number | undefined;
      interactive: boolean;
      disposed: boolean;
      history: ReturnType<PlatformConformanceHarness<Target>["history"]>[number][];
      actions: string[];
      occurrences: Set<string>;
      releases: number;
    }
  >();

  const record = (target: Target) => {
    const value = records.get(target);
    if (!value) throw new Error(`Unknown target ${target.id}.`);
    return value;
  };

  return {
    target(id) {
      const target = { id };
      records.set(target, {
        revision: 0,
        semantic: undefined,
        visual: undefined,
        interactive: false,
        disposed: false,
        history: [],
        actions: [],
        occurrences: new Set(),
        releases: 0,
      });
      return target;
    },
    arrange(targets) {
      const unique = new Set(targets);
      if (unique.size !== targets.length) throw new Error("An arrangement cannot repeat a target.");
      for (const target of targets) {
        if (record(target).disposed) throw new Error("A disposed target cannot be arranged.");
      }
      arrangement = [...targets];
    },
    arrangement() {
      return arrangement;
    },
    commit(target, update) {
      const current = record(target);
      if (current.disposed) throw new Error("Cannot commit a disposed target.");
      Object.assign(current, update);
      current.history.push({ ...update, disposed: false });
    },
    input(target, occurrence) {
      const current = record(target);
      if (current.disposed || !current.interactive || current.occurrences.has(occurrence)) return;
      current.occurrences.add(occurrence);
      current.actions.push(occurrence);
    },
    inspect(target) {
      const { revision, semantic, visual, interactive, disposed } = record(target);
      return { revision, semantic, visual, interactive, disposed };
    },
    history(target) {
      return record(target).history;
    },
    actions(target) {
      return record(target).actions;
    },
    dispose(target) {
      const current = record(target);
      if (current.disposed) return;
      current.disposed = true;
      current.interactive = false;
      current.releases += 1;
    },
    releases(target) {
      return record(target).releases;
    },
  };
}
