import type { PlatformPrimitive } from "./platform";
import type {
  PresentationAdapter,
  PresentationAdapterSession,
  PresentationTarget,
  PresentationTargetSources,
} from "./presentation";

export type ReferencePresentationDeclaration = {
  readonly visible?: boolean;
  readonly tone?: "neutral" | "accent";
  readonly offset?: number;
  readonly anchor?: PresentationTarget;
};

export type ReferencePresentationLanguage = {
  readonly Declaration: ReferencePresentationDeclaration;
};

export type ReferencePresentationTarget = Readonly<{ id: string }>;

export type ReferencePlatform = Readonly<{
  Name: "reference";
  Child: unknown;
  Primitives: {
    surface: PlatformPrimitive<
      object,
      ReferencePresentationTarget,
      ReferencePresentationDeclaration
    >;
    copy: PlatformPrimitive<object, ReferencePresentationTarget, ReferencePresentationDeclaration>;
    mark: PlatformPrimitive<object, ReferencePresentationTarget, ReferencePresentationDeclaration>;
    dialog: PlatformPrimitive<
      object,
      ReferencePresentationTarget,
      ReferencePresentationDeclaration
    >;
  };
}>;

export type ReferencePresentationCommit = Readonly<{
  sequence: number;
  declarations: readonly Readonly<{
    element: string;
    target: ReferencePresentationTarget;
    declaration: ReferencePresentationDeclaration;
  }>[];
}>;

export type ReferencePresentationSession = Readonly<{
  boundary: ReferencePresentationTarget;
  commits: readonly ReferencePresentationCommit[];
  disposed: boolean;
  disposeCount: number;
}>;

export type ReferencePresentationAdapter = PresentationAdapter<
  ReferencePresentationLanguage,
  ReferencePresentationTarget
> &
  Readonly<{
    sessions: readonly ReferencePresentationSession[];
    inspect(target: ReferencePresentationTarget): ReferencePresentationDeclaration | undefined;
    releases(target: ReferencePresentationTarget): number;
  }>;

type MutableReferenceSession = {
  readonly boundary: ReferencePresentationTarget;
  readonly commits: ReferencePresentationCommit[];
  disposed: boolean;
  disposeCount: number;
};

export type ReferenceStatePresentationSession = Readonly<{
  boundary: ReferencePresentationTarget;
  current: ReferencePresentationCommit | undefined;
  disposed: boolean;
  disposeCount: number;
}>;

export type ReferenceStatePresentationAdapter = PresentationAdapter<
  ReferencePresentationLanguage,
  ReferencePresentationTarget
> &
  Readonly<{
    sessions: readonly ReferenceStatePresentationSession[];
    inspect(target: ReferencePresentationTarget): ReferencePresentationDeclaration | undefined;
    releases(target: ReferencePresentationTarget): number;
  }>;

/** Creates a deterministic, dependency-free adapter for contract and compiler tests. */
export function createReferencePresentationAdapter(): ReferencePresentationAdapter {
  const sessions: MutableReferenceSession[] = [];
  const releases = new Map<ReferencePresentationTarget, number>();

  return {
    sessions,
    inspect(target) {
      return inspectTrace(sessions, target);
    },
    releases(target) {
      return releases.get(target) ?? 0;
    },
    create<const ElementName extends string>(options: {
      readonly boundary: ReferencePresentationTarget;
      readonly targets: PresentationTargetSources<ElementName, ReferencePresentationTarget>;
    }): PresentationAdapterSession<ReferencePresentationLanguage, ElementName> {
      const record: MutableReferenceSession = {
        boundary: options.boundary,
        commits: [],
        disposed: false,
        disposeCount: 0,
      };
      sessions.push(record);

      return {
        commit(declarations) {
          if (record.disposed) throw new Error("Cannot commit a disposed presentation session.");

          const entries = resolveReferenceDeclarations(options.targets, declarations);
          record.commits.push({ sequence: record.commits.length, declarations: entries });
        },
        dispose() {
          if (record.disposed) return;
          record.disposed = true;
          record.disposeCount += 1;
          for (const { target } of record.commits.at(-1)?.declarations ?? []) {
            releases.set(target, (releases.get(target) ?? 0) + 1);
          }
        },
      };
    },
  };
}

/** A second interpreter for the same language that retains only the latest snapshot. */
export function createReferenceStatePresentationAdapter(): ReferenceStatePresentationAdapter {
  const sessions: Array<{
    boundary: ReferencePresentationTarget;
    current: ReferencePresentationCommit | undefined;
    disposed: boolean;
    disposeCount: number;
  }> = [];
  const releases = new Map<ReferencePresentationTarget, number>();

  return {
    sessions,
    inspect(target) {
      for (let index = sessions.length - 1; index >= 0; index--) {
        const session = sessions[index]!;
        if (session.disposed) continue;
        const match = session.current?.declarations.find((entry) => entry.target === target);
        if (match) return match.declaration;
      }
      return undefined;
    },
    releases(target) {
      return releases.get(target) ?? 0;
    },
    create<const ElementName extends string>(options: {
      readonly boundary: ReferencePresentationTarget;
      readonly targets: PresentationTargetSources<ElementName, ReferencePresentationTarget>;
    }): PresentationAdapterSession<ReferencePresentationLanguage, ElementName> {
      const record = {
        boundary: options.boundary,
        current: undefined as ReferencePresentationCommit | undefined,
        disposed: false,
        disposeCount: 0,
      };
      sessions.push(record);
      let sequence = 0;

      return {
        commit(declarations) {
          if (record.disposed) throw new Error("Cannot commit a disposed presentation session.");
          const entries = resolveReferenceDeclarations(options.targets, declarations);
          record.current = { sequence, declarations: entries };
          sequence += 1;
        },
        dispose() {
          if (record.disposed) return;
          record.disposed = true;
          record.disposeCount += 1;
          for (const { target } of record.current?.declarations ?? []) {
            releases.set(target, (releases.get(target) ?? 0) + 1);
          }
        },
      };
    },
  };
}

function resolveReferenceDeclarations<ElementName extends string>(
  sources: PresentationTargetSources<ElementName, ReferencePresentationTarget>,
  declarations: Readonly<Partial<Record<ElementName, Readonly<ReferencePresentationDeclaration>>>>,
): ReferencePresentationCommit["declarations"] {
  const entries: Array<ReferencePresentationCommit["declarations"][number]> = [];
  const owners = new Map<ReferencePresentationTarget, string>();
  for (const element of Object.keys(sources) as ElementName[]) {
    const targets = [...new Set(sources[element]?.() ?? [])];
    const declaration = declarations[element];
    if (!declaration) continue;
    for (const target of targets) {
      const owner = owners.get(target);
      if (owner && owner !== element) {
        throw new Error(`Presentation target is claimed by two Elements: ${owner} and ${element}.`);
      }
      owners.set(target, element);
      entries.push({ element, target, declaration });
    }
  }
  return entries;
}

function inspectTrace(
  sessions: readonly MutableReferenceSession[],
  target: ReferencePresentationTarget,
): ReferencePresentationDeclaration | undefined {
  for (let index = sessions.length - 1; index >= 0; index--) {
    const session = sessions[index]!;
    if (session.disposed) continue;
    const match = session.commits.at(-1)?.declarations.find((entry) => entry.target === target);
    if (match) return match.declaration;
  }
  return undefined;
}
