import { describe, expect, test } from "vitest";

import { HotUpdateCoordinator, type HotCandidate } from "@/execution/interpreter";

describe("hot update coordination", () => {
  test("keeps the live revision when prepare or activation fails", async () => {
    const events: string[] = [];
    const coordinator = new HotUpdateCoordinator<string, number, string>();
    await coordinator.replace(candidate("first", 1, events));
    expect(coordinator.value).toBe("first");

    const prepareFailed: HotCandidate<string, number, string> = {
      manifest: "compatible",
      async prepare() {
        throw new Error("invalid source");
      },
    };
    expect(await coordinator.replace(prepareFailed)).toMatchObject({
      status: "rejected",
      reason: "prepare-failed",
      cause: expect.objectContaining({ message: "invalid source" }),
    });
    expect(coordinator.value).toBe("first");

    const activationFailed: HotCandidate<string, number, string> = {
      manifest: "compatible",
      async prepare() {
        return {
          async activate() {
            throw new Error("mount failed");
          },
          rollback() {
            events.push("rollback");
          },
        };
      },
    };
    expect(await coordinator.replace(activationFailed)).toMatchObject({
      status: "rejected",
      reason: "activation-failed",
      cause: expect.objectContaining({ message: "mount failed" }),
    });
    expect(coordinator.value).toBe("first");
    expect(events).toEqual(["activate:first:0", "rollback"]);
    await coordinator.dispose();
  });

  test("serializes revisions and resumes only after disposing the previous value", async () => {
    const events: string[] = [];
    const coordinator = new HotUpdateCoordinator<string, number, string>();
    await coordinator.replace(candidate("first", 1, events));
    await coordinator.replace(candidate("second", 2, events, true));

    expect(events.slice(-3)).toEqual(["activate:second:1", "dispose:first", "resume:second"]);
    await coordinator.dispose();
    expect(events.at(-1)).toBe("dispose:second");
  });

  test("delegates compatibility to the owning dialect", async () => {
    const coordinator = new HotUpdateCoordinator<string, number, string>(
      (previous, next) => previous === next,
    );
    await coordinator.replace(candidate("first", 1, [], false, "contract"));

    expect(await coordinator.replace(candidate("next", 2, [], false, "changed"))).toEqual({
      status: "rejected",
      reason: "incompatible-manifest",
    });
    expect(coordinator.value).toBe("first");
    await coordinator.dispose();
  });
});

function candidate(
  value: string,
  snapshot: number,
  events: string[],
  resume = false,
  manifest = "compatible",
): HotCandidate<string, number, string> {
  return {
    manifest,
    async prepare(previous) {
      return {
        async activate() {
          events.push(`activate:${value}:${previous ?? 0}`);
          return {
            value,
            snapshot,
            ...(resume
              ? {
                  resume() {
                    events.push(`resume:${value}`);
                  },
                }
              : {}),
            dispose() {
              events.push(`dispose:${value}`);
            },
          };
        },
      };
    },
  };
}
