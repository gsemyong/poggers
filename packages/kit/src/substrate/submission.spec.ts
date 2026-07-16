import { describe, expect, it } from "bun:test";

import { effect } from "alien-signals";

import { createSubmission, submissionFrom } from "#substrate/submission";

describe("Submission", () => {
  it("exposes one stable reactive lifecycle object", async () => {
    const controller = createSubmission<"conflict">();
    const submission = controller.submission;
    const phases: string[] = [];
    const identities = new Set<unknown>();
    const stop = submission.subscribe((current) => {
      phases.push(current.phase);
      identities.add(current);
    });

    expect(submission.id).toBeUndefined();
    expect(submission.pending).toBe(true);
    expect(submission.settled).toBe(false);

    controller.setId("command/1");
    controller.setPhase("queued");
    controller.setPhase("submitted");
    controller.setPhase("uncertain");
    controller.setPhase("submitted");
    controller.settle({ ok: true, cursor: 7 });

    expect(await submission).toEqual({ ok: true, cursor: 7 });
    expect(submission.id).toBe("command/1");
    expect(submission.phase).toBe("committed");
    expect(submission.pending).toBe(false);
    expect(submission.settled).toBe(true);
    expect(submission.outcome).toEqual({ ok: true, cursor: 7 });
    expect(phases).toEqual([
      "preparing",
      "preparing",
      "queued",
      "submitted",
      "uncertain",
      "submitted",
      "committed",
    ]);
    expect(identities.size).toBe(1);

    controller.setPhase("uncertain");
    controller.settle({ ok: false, error: "conflict" });
    stop();
    expect(submission.phase).toBe("committed");
    expect(phases.at(-1)).toBe("committed");
  });

  it("tracks lifecycle fields through the shared fine-grained reactive graph", () => {
    const controller = createSubmission<"conflict">();
    const phases: string[] = [];
    const stop = effect(() => {
      phases.push(controller.submission.phase);
    });

    controller.setPhase("queued");
    controller.setPhase("submitted");
    controller.settle({ ok: true, cursor: 1 });
    stop();

    expect(phases).toEqual(["preparing", "queued", "submitted", "committed"]);
  });

  it("reports a settled snapshot to late subscribers without retaining them", () => {
    const controller = createSubmission<"conflict">();
    controller.settle({ ok: false, error: "conflict" });
    let calls = 0;

    const stop = controller.submission.subscribe((submission) => {
      calls += 1;
      expect(submission.phase).toBe("rejected");
    });
    stop();
    controller.settle({ ok: true });

    expect(calls).toBe(1);
  });

  it("turns unexpected asynchronous failures into internal rejection", async () => {
    const submission = submissionFrom(Promise.reject(new Error("boom")));

    expect(await submission).toEqual({ ok: false, error: "internal" });
    expect(submission.phase).toBe("rejected");
  });
});
