import type {
  PresentationAdapter,
  PresentationAdapterSession,
  PresentationTargets,
} from "./presentation";

export type ReferencePresentationContext = {
  readonly allocatedInlineSize: number;
  readonly reducedMotion: boolean;
};

export type ReferencePresentationDeclaration = {
  readonly visible?: boolean;
  readonly tone?: "neutral" | "accent";
  readonly offset?: number;
};

export type ReferencePresentationLanguage = {
  readonly Context: ReferencePresentationContext;
  readonly Declaration: ReferencePresentationDeclaration;
};

export type ReferencePresentationTarget = Readonly<{ id: string }>;

export type ReferencePresentationCommit = Readonly<{
  sequence: number;
  declarations: readonly Readonly<{
    part: string;
    target: ReferencePresentationTarget;
    declaration: ReferencePresentationDeclaration;
  }>[];
}>;

export type ReferencePresentationSession = Readonly<{
  boundary: ReferencePresentationTarget;
  commits: readonly ReferencePresentationCommit[];
  disposed: boolean;
}>;

export type ReferencePresentationAdapter = PresentationAdapter<
  ReferencePresentationLanguage,
  ReferencePresentationTarget
> &
  Readonly<{
    sessions: readonly ReferencePresentationSession[];
  }>;

type MutableReferenceSession = {
  readonly boundary: ReferencePresentationTarget;
  readonly commits: ReferencePresentationCommit[];
  disposed: boolean;
};

/** Creates a deterministic, dependency-free adapter for contract and compiler tests. */
export function createReferencePresentationAdapter(
  platform: ReferencePresentationContext,
): ReferencePresentationAdapter {
  const sessions: MutableReferenceSession[] = [];

  return {
    sessions,
    create<const Part extends string>(input: {
      readonly boundary: ReferencePresentationTarget;
      readonly parts: PresentationTargets<Part, ReferencePresentationTarget>;
    }): PresentationAdapterSession<ReferencePresentationLanguage, Part> {
      const record: MutableReferenceSession = {
        boundary: input.boundary,
        commits: [],
        disposed: false,
      };
      sessions.push(record);

      return {
        platform,
        commit(declarations) {
          if (record.disposed) throw new Error("Cannot commit a disposed presentation session.");

          const entries: Array<ReferencePresentationCommit["declarations"][number]> = [];
          for (const part of Object.keys(declarations) as Part[]) {
            const declaration = declarations[part];
            if (!declaration) continue;
            for (const target of input.parts[part]()) {
              entries.push({ part, target, declaration });
            }
          }
          record.commits.push({ sequence: record.commits.length, declarations: entries });
        },
        dispose() {
          if (record.disposed) return;
          record.disposed = true;
        },
      };
    },
  };
}
