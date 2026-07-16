import {
  SourceHistoryUnavailableError,
  type ProgramRegistration,
  type SourceCursor,
} from "#substrate/adapter";
import {
  createSingleNodeSubstrate,
  parseProgramAssignmentProgressId,
  programAssignmentProgressId,
  type MemorySubstrate,
  type MemorySubstrateOptions,
} from "#substrate/adapter.memory";
import { createSqliteJournal, type SqliteJournalOptions } from "#substrate/journal.sqlite";
import { createJournalProgramProgressStore } from "#substrate/program";

export type SqliteSubstrateOptions = SqliteJournalOptions & MemorySubstrateOptions;

export type SqliteSubstrate = MemorySubstrate &
  Readonly<{
    administration: Readonly<{
      retainThrough(cursor: SourceCursor): Promise<void>;
      programs(): Promise<readonly ProgramRegistration[]>;
      resetProgram(program: string, replay: "all" | "new"): Promise<void>;
      renameProgram(from: string, to: string): Promise<void>;
      removeProgram(program: string): Promise<void>;
      checkpoint(): void;
      backup(file: string): Readonly<{ bytes: number; sha256: string }>;
    }>;
  }>;

export function createSqliteSubstrate(options: SqliteSubstrateOptions): SqliteSubstrate {
  const { now, ...journalOptions } = options;
  const journal = createSqliteJournal(journalOptions);
  journal.verify();
  const substrate = createSingleNodeSubstrate(journal, { now });
  const progress = createJournalProgramProgressStore(journal, "substrate");
  return Object.assign(substrate, {
    administration: {
      async programs() {
        const registrations: ProgramRegistration[] = [];
        for (const program of await registeredPrograms(journal)) {
          const registration = await substrate.programs.registration(program);
          if (registration) registrations.push(registration);
        }
        return Object.freeze(registrations.sort((left, right) => left.id.localeCompare(right.id)));
      },
      async resetProgram(program: string, replay: "all" | "new") {
        for (const consumer of await assignmentConsumers(journal, program)) {
          await progress.removeConsumer(consumer);
        }
        substrate.testing.forgetProgramAssignments(program);
        if (replay === "all") {
          if (journal.retainedFloor() > 0) throw new SourceHistoryUnavailableError(program);
          await progress.resetConsumer({ consumerId: program, startAt: "origin" });
          return;
        }
        await progress.resetConsumer({
          consumerId: program,
          startAt: "now",
          sourcePosition: await journal.position(),
        });
      },
      async renameProgram(from: string, to: string) {
        const assignments = await assignmentConsumers(journal, from);
        for (const consumer of assignments) {
          const assignment = parseProgramAssignmentProgressId(consumer)!;
          const target = programAssignmentProgressId({ ...assignment, program: to });
          if (await progress.inspectConsumer(target)) {
            throw new Error(`Program assignment ${JSON.stringify(target)} is already registered.`);
          }
        }
        if (await progress.inspectConsumer(to)) {
          throw new Error(`Program ${JSON.stringify(to)} is already registered.`);
        }
        for (const consumer of assignments) {
          const assignment = parseProgramAssignmentProgressId(consumer)!;
          await progress.moveConsumer({
            from: consumer,
            to: programAssignmentProgressId({ ...assignment, program: to }),
          });
        }
        await progress.moveConsumer({ from, to });
        substrate.testing.forgetProgramAssignments(from);
        substrate.testing.forgetProgramAssignments(to);
      },
      async removeProgram(program: string) {
        for (const consumer of await assignmentConsumers(journal, program)) {
          await progress.removeConsumer(consumer);
        }
        await progress.removeConsumer(program);
        substrate.testing.forgetProgramAssignments(program);
      },
      async retainThrough(cursor: SourceCursor) {
        const [split] = (await substrate.events.topology()).splits.map(({ id }) => id);
        if (!split || cursor.split !== split) {
          throw new Error("A retention cursor belongs to another source split.");
        }
        const position = parsePosition(cursor);
        for (const consumer of await registeredPrograms(journal)) {
          const assignments = await assignmentConsumers(journal, consumer);
          const protectedProgress = assignments.length === 0 ? [consumer] : assignments;
          const currents = await Promise.all(
            protectedProgress.map((id) => progress.inspectConsumer(id)),
          );
          const blocking = currents.find((current) => current && current.sourcePosition < position);
          if (blocking) {
            throw new Error(
              `Program ${JSON.stringify(consumer)} protects source history through ${blocking.sourcePosition}.`,
            );
          }
        }
        journal.retainThrough(position);
        substrate.testing.retainAfter(cursor);
      },
      checkpoint: () => journal.checkpoint(),
      backup: (file: string) => journal.backup(file),
    },
  });
}

async function registeredPrograms(
  journal: ReturnType<typeof createSqliteJournal>,
): Promise<string[]> {
  return (await progressConsumers(journal)).filter(
    (consumer) => !parseProgramAssignmentProgressId(consumer),
  );
}

async function assignmentConsumers(
  journal: ReturnType<typeof createSqliteJournal>,
  program: string,
): Promise<string[]> {
  return (await progressConsumers(journal)).filter(
    (consumer) => parseProgramAssignmentProgressId(consumer)?.program === program,
  );
}

async function progressConsumers(
  journal: ReturnType<typeof createSqliteJournal>,
): Promise<string[]> {
  const consumers = new Set<string>();
  for await (const address of journal.addresses()) {
    const consumer = programConsumer(address);
    if (consumer) consumers.add(consumer);
  }
  return [...consumers].sort();
}

function parsePosition(cursor: SourceCursor): number {
  const position = Number(cursor.value);
  if (!Number.isSafeInteger(position) || position < 0 || String(position) !== cursor.value) {
    throw new Error("A single-node source cursor is malformed.");
  }
  return position;
}

function programConsumer(address: { resource: string; key: unknown }): string | null {
  if (
    address.resource !== "$poggers.program-source" ||
    !address.key ||
    typeof address.key !== "object" ||
    Array.isArray(address.key)
  ) {
    return null;
  }
  const key = address.key as { program?: unknown; consumer?: unknown };
  return key.program === "substrate" && typeof key.consumer === "string" ? key.consumer : null;
}
