import { endBatch, signal, startBatch } from "alien-signals";

import type { Submission, SubmissionOutcome, SubmissionPhase } from "#kernel/app";

export type SubmissionController<E = never> = {
  readonly submission: Submission<E>;
  setId(id: string): void;
  setPhase(phase: Exclude<SubmissionPhase, "committed" | "rejected">): void;
  settle(outcome: SubmissionOutcome<E>): void;
};

export function createSubmission<E = never>(): SubmissionController<E> {
  const id = signal<string | undefined>(undefined);
  const phase = signal<SubmissionPhase>("preparing");
  const outcome = signal<SubmissionOutcome<E> | undefined>(undefined);
  let resolve!: (outcome: SubmissionOutcome<E>) => void;
  const completion = new Promise<SubmissionOutcome<E>>((next) => {
    resolve = next;
  });
  const listeners = new Set<(submission: Submission<E>) => void>();

  const submission: Submission<E> = {
    get id() {
      return id();
    },
    get phase() {
      return phase();
    },
    get pending() {
      return phase() !== "committed" && phase() !== "rejected";
    },
    get settled() {
      return phase() === "committed" || phase() === "rejected";
    },
    get outcome() {
      return outcome();
    },
    // oxlint-disable-next-line unicorn/no-thenable -- Submission is intentionally awaitable.
    then(onfulfilled, onrejected) {
      return completion.then(onfulfilled, onrejected);
    },
    subscribe(listener) {
      listener(submission);
      if (outcome()) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const notify = () => {
    for (const listener of listeners) listener(submission);
  };

  return {
    submission,
    setId(nextId) {
      if (id() === nextId || outcome()) return;
      id(nextId);
      notify();
    },
    setPhase(nextPhase) {
      if (phase() === nextPhase || outcome()) return;
      phase(nextPhase);
      notify();
    },
    settle(nextOutcome) {
      if (outcome()) return;
      startBatch();
      try {
        outcome(nextOutcome);
        phase(nextOutcome.ok ? "committed" : "rejected");
      } finally {
        endBatch();
      }
      notify();
      listeners.clear();
      resolve(nextOutcome);
    },
  };
}

export function submissionFrom<E = never>(
  result: SubmissionOutcome<E> | PromiseLike<SubmissionOutcome<E>>,
): Submission<E> {
  const controller = createSubmission<E>();
  void Promise.resolve(result).then(
    (outcome) => controller.settle(outcome),
    () => controller.settle({ ok: false, error: "internal" } as SubmissionOutcome<E>),
  );
  return controller.submission;
}
