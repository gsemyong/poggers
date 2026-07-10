import { describe, it, expect } from "bun:test";
import fc from "fast-check";
import { createTestApp } from "./helpers/test-app";
import { defineApp } from "../src/app";

const app = createTestApp("test-token");

const handlerApp = defineApp<{
  Actor: { id: string; name: string };
  Resources: {
    record: {
      Key: { id: string };
      State: { lastActor: string; lastSeq: number; lastAt: number };
      Events: { recorded: { actorId: string; seq: number; at: number } };
      Views: Record<string, never>;
      Commands: {
        doRecord: { args: []; event: "recorded"; error: never };
        addIfPositive: { args: [amount: number]; event: "recorded"; error: never };
      };
    };
  };
}>({
  version: 1,
  identify({ token }) {
    if (token === "t") return { id: "user", name: "User" };
    return null;
  },
  resources: {
    record: {
      state: { lastActor: "", lastSeq: 0, lastAt: 0 },
      events: {
        recorded({ state, payload: _payload, actor, seq, at }) {
          state.lastActor = actor.id;
          state.lastSeq = seq;
          state.lastAt = at;
        },
      },
      views: {},
      commands: {
        doRecord(ctx) {
          return ctx.event.recorded({ actorId: "", seq: 0, at: 0 });
        },
        addIfPositive(ctx, _amount) {
          if (ctx.state.lastSeq > 0) {
            return ctx.event.recorded({ actorId: "positive", seq: 99, at: 1 });
          } else {
            return ctx.event.recorded({ actorId: "zero", seq: 0, at: 0 });
          }
        },
      },
    },
  },
});

describe("app", () => {
  describe("createState", () => {
    it("creates initial counter state", () => {
      const state = app.createState("counter");
      expect(state).toEqual({ count: 0 });
    });

    it("creates initial doc state", () => {
      const state = app.createState("doc");
      expect(state).toEqual({ title: "", body: "" });
    });

    it("returns deep clone, not reference", () => {
      const s1 = app.createState("counter");
      const s2 = app.createState("counter");
      expect(s1).not.toBe(s2);
      s1.count = 5;
      expect(s2.count).toBe(0);
    });

    it("returns independent copies, mutations do not cross", () => {
      const s1 = app.createState("doc");
      const s2 = app.createState("doc");
      s1.title = "changed";
      s1.body = "also changed";
      expect(s2.title).toBe("");
      expect(s2.body).toBe("");
    });
  });

  describe("applyEvent", () => {
    it("applies known event", () => {
      const state = app.createState("counter");
      app.applyEvent("counter", state, {
        id: "ev1",
        seq: 1,
        at: 1000,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 5 },
      });
      expect(state.count).toBe(5);
    });

    it("ignores unknown event name", () => {
      const state = app.createState("counter");
      app.applyEvent("counter", state, {
        id: "ev1",
        seq: 1,
        at: 1000,
        actor: { id: "u", name: "U" },
        name: "nonexistent",
        payload: {},
      });
      expect(state.count).toBe(0);
    });

    it("ignores unknown resource", () => {
      const state = { count: 0 };
      app.applyEvent("nonexistent", state, {
        id: "ev1",
        seq: 1,
        at: 1000,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 5 },
      });
      expect(state.count).toBe(0);
    });

    it("passes actor, at, seq to event handler", () => {
      const state = handlerApp.createState("record");
      handlerApp.applyEvent("record", state, {
        id: "ev42",
        seq: 99,
        at: 5000,
        actor: { id: "actor-1", name: "Alice" },
        name: "recorded",
        payload: { actorId: "", seq: 0, at: 0 },
      });
      expect(state.lastActor).toBe("actor-1");
      expect(state.lastSeq).toBe(99);
      expect(state.lastAt).toBe(5000);
    });

    it("chains multiple events", () => {
      const state = app.createState("counter");
      app.applyEvent("counter", state, {
        id: "e1",
        seq: 1,
        at: 1000,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 3 },
      });
      app.applyEvent("counter", state, {
        id: "e2",
        seq: 2,
        at: 1001,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 7 },
      });
      app.applyEvent("counter", state, {
        id: "e3",
        seq: 3,
        at: 1002,
        actor: { id: "u", name: "U" },
        name: "decremented",
        payload: { amount: 2 },
      });
      expect(state.count).toBe(8);
    });

    it("reset event clears count", () => {
      const state = app.createState("counter");
      state.count = 42;
      app.applyEvent("counter", state, {
        id: "e1",
        seq: 1,
        at: 1000,
        actor: { id: "u", name: "U" },
        name: "reset",
        payload: {},
      });
      expect(state.count).toBe(0);
    });

    it("applyEvent is independent of snapshot version", () => {
      const state = app.createState("counter");
      app.applyEvent("counter", state, {
        id: "e1",
        seq: 1,
        at: 1000,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 10 },
      });
      expect(state.count).toBe(10);
    });
  });

  describe("snapshot", () => {
    it("produces snapshot with version and seq", () => {
      const state = app.createState("counter");
      state.count = 7;
      const snap = app.snapshot(state, 12);
      expect(snap.version).toBe(app.def.version);
      expect(snap.seq).toBe(12);
      expect(snap.data).toEqual({ count: 7 });
    });

    it("returns deep clone, not reference", () => {
      const state = app.createState("counter");
      state.count = 7;
      const snap = app.snapshot(state, 5);
      state.count = 999;
      expect((snap.data as any).count).toBe(7);
    });

    it("snapshots empty doc state", () => {
      const state = app.createState("doc");
      const snap = app.snapshot(state, 0);
      expect(snap.data).toEqual({ title: "", body: "" });
      expect(snap.seq).toBe(0);
    });
  });

  describe("restore", () => {
    it("restores from matching version snapshot", () => {
      const restored = app.restore("counter", {
        version: app.def.version,
        data: { count: 99 },
      });
      expect(restored).toEqual({ count: 99 });
    });

    it("returns deep clone from snapshot", () => {
      const snapData = { count: 42 };
      const restored = app.restore("counter", {
        version: app.def.version,
        data: snapData,
      });
      snapData.count = 0;
      expect(restored).toEqual({ count: 42 });
    });

    it("returns fresh state for mismatched version", () => {
      const restored = app.restore("counter", {
        version: 999,
        data: { count: 99 },
      });
      expect(restored).toEqual({ count: 0 });
    });

    it("returns fresh state for undefined/null snapshot", () => {
      const restored = app.restore("counter", null as any);
      expect(restored).toEqual({ count: 0 });
    });

    it("handles empty snapshot object", () => {
      const restored = app.restore("counter", {} as any);
      expect(restored).toEqual({ count: 0 });
    });

    it("accepts same-version snapshots and events with legacy hashes", () => {
      const hashed = defineApp<any>({
        version: 1,
        migrationHash: "current-resource-hash",
        resources: {
          counter: {
            state: { count: 0 },
            events: {
              incremented({ state, payload }) {
                state.count += payload.amount;
              },
            },
            views: {},
            commands: {},
          },
        },
      });

      expect(
        hashed.restore("counter", {
          version: 1,
          hash: "legacy-full-source-hash",
          data: { count: 41 },
        }),
      ).toEqual({ count: 41 });

      const state = hashed.createState("counter");
      hashed.applyEvent(
        "counter",
        state,
        {
          id: "event-1",
          seq: 1,
          at: 1,
          actor: { id: "actor-1" },
          name: "incremented",
          payload: { amount: 1 },
          hash: "legacy-full-source-hash",
        },
        1,
        "legacy-full-source-hash",
      );
      expect(state).toEqual({ count: 1 });
    });
  });

  describe("runCommand", () => {
    it("emits single event from command", () => {
      const events: any[] = [];
      const presence: any[] = [];
      const state = app.createState("counter");

      app.runCommand(
        "counter",
        state,
        { id: "u", name: "U" },
        { counterId: "c1" },
        "increment",
        [5],
        (ev) => events.push(ev),
        (p) => presence.push(p),
        () => {},
      );

      expect(events.length).toBe(1);
      expect(events[0].name).toBe("incremented");
      expect(events[0].payload).toEqual({ amount: 5 });
      expect(events[0].actor).toEqual({ id: "u", name: "U" });
    });

    it("emits multiple events from one command", () => {
      const events: any[] = [];
      const state = app.createState("counter");

      app.runCommand(
        "counter",
        state,
        { id: "u", name: "U" },
        { counterId: "c1" },
        "emitTwoEvents",
        [],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events.length).toBe(2);
      expect(events[0].name).toBe("incremented");
      expect(events[0].payload).toEqual({ amount: 1 });
      expect(events[1].name).toBe("incremented");
      expect(events[1].payload).toEqual({ amount: 2 });
    });

    it("event has unique IDs", () => {
      const events: any[] = [];
      const state = app.createState("counter");

      app.runCommand(
        "counter",
        state,
        { id: "u", name: "U" },
        { counterId: "c1" },
        "emitTwoEvents",
        [],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events[0].id).not.toBe(events[1].id);
      expect(typeof events[0].id).toBe("string");
      expect(events[0].id.length).toBeGreaterThan(0);
    });

    it("uses sequential local sequence numbers", () => {
      const events: any[] = [];
      const state = app.createState("counter");

      app.runCommand(
        "counter",
        state,
        { id: "u", name: "U" },
        { counterId: "c1" },
        "emitTwoEvents",
        [],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events[0].seq).toBe(0);
      expect(events[1].seq).toBe(1);
    });

    it("ignores unknown command", () => {
      const events: any[] = [];
      const state = app.createState("counter");

      app.runCommand(
        "counter",
        state,
        { id: "u", name: "U" },
        { counterId: "c1" },
        "nonexistent",
        [],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events.length).toBe(0);
    });

    it("ignores unknown resource", () => {
      const events: any[] = [];
      const state = { x: 1 };

      app.runCommand(
        "nonexistent",
        state,
        { id: "u", name: "U" },
        { id: "k" },
        "something",
        [],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events.length).toBe(0);
    });

    it("passes actor to command context", () => {
      const events: any[] = [];
      const state = app.createState("counter");

      const actor = { id: "alice", name: "Alice" };
      app.runCommand(
        "counter",
        state,
        actor,
        { counterId: "c1" },
        "increment",
        [3],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events[0].actor).toEqual(actor);
    });

    it("includes timestamp on events", () => {
      const events: any[] = [];
      const state = app.createState("counter");

      app.runCommand(
        "counter",
        state,
        { id: "u", name: "U" },
        { counterId: "c1" },
        "increment",
        [1],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(typeof events[0].at).toBe("number");
      expect(events[0].at).toBeGreaterThan(0);
    });

    it("passes current state to command handler", () => {
      const events: any[] = [];
      const state = handlerApp.createState("record");
      state.lastSeq = 5;

      handlerApp.runCommand(
        "record",
        state,
        { id: "u", name: "U" },
        { id: "k" },
        "addIfPositive",
        [0],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events.length).toBe(1);
      expect(events[0].payload.actorId).toBe("positive");
    });

    it("command handler receives zero-state correctly", () => {
      const events: any[] = [];
      const state = handlerApp.createState("record");

      handlerApp.runCommand(
        "record",
        state,
        { id: "u", name: "U" },
        { id: "k" },
        "addIfPositive",
        [0],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events.length).toBe(1);
      expect(events[0].payload.actorId).toBe("zero");
    });

    it("passes key to command context", () => {
      const events: any[] = [];
      const state = app.createState("doc");
      const key = { docId: "roadmap" };

      app.runCommand(
        "doc",
        state,
        { id: "u", name: "U" },
        key,
        "changeTitle",
        ["New Title"],
        (ev) => events.push(ev),
        () => {},
        () => {},
      );

      expect(events.length).toBe(1);
      expect(events[0].name).toBe("titleChanged");
      expect(events[0].payload).toEqual({ title: "New Title" });
    });
  });

  describe("command safety", () => {
    it("command cannot mutate real state by modifying ctx.state directly", () => {
      const realState = app.createState("counter");
      realState.count = 100;

      const testApp = defineApp<{
        Actor: { id: string; name: string };
        Resources: {
          test: {
            Key: string;
            State: { count: number };
            Events: { mutated: { newCount: number } };
            Views: Record<string, never>;
            Commands: { badMutate: { args: []; event: "mutated"; error: never } };
          };
        };
      }>({
        version: 1,
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          test: {
            state: { count: 0 },
            events: {
              mutated({ state, payload }) {
                state.count = payload.newCount;
              },
            },
            views: {},
            commands: {
              badMutate(ctx) {
                ctx.state.count = 9999;
                return ctx.event.mutated({ newCount: 9999 });
              },
            },
          },
        },
      });

      testApp.runCommand(
        "test",
        realState,
        { id: "u", name: "U" },
        "k",
        "badMutate",
        [],
        () => {},
        () => {},
        () => {},
      );

      expect(realState.count).toBe(100);
    });

    it("createState ignores non-existent resource", () => {
      const state = app.createState("nonexistent" as any);
      expect(state).toBeUndefined();
    });

    it("restore ignores non-existent resource", () => {
      const state = app.restore("nonexistent" as any, {} as any);
      expect(state).toBeUndefined();
    });
  });

  describe("defineApp properties", () => {
    it("version is exposed on def", () => {
      expect(app.def.version).toBe(1);
    });

    it("resources are defined", () => {
      expect(Object.keys(app.def.resources)).toContain("counter");
      expect(Object.keys(app.def.resources)).toContain("doc");
    });

    it("identify returns actor for valid token", () => {
      const actor = app.def.identify({ token: "test-token" });
      expect(actor).toEqual({ id: "test-user", name: "Test User" });
    });

    it("identify returns null for invalid token", () => {
      const actor = app.def.identify({ token: "bad-token" });
      expect(actor).toBeNull();
    });
  });

  describe("migrations", () => {
    it("migrates state with per-resource callback via previous chain", () => {
      const v1 = defineApp<{
        Actor: { id: string; name: string };
        Resources: {
          counter: {
            Key: { counterId: string };
            State: { count: number };
            Events: { inc: { amount: number } };
            Views: Record<string, never>;
            Commands: Record<string, never>;
          };
        };
      }>({
        version: 1,
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { count: 0 },
            events: {
              inc({ state, payload }) {
                state.count += payload.amount;
              },
            },
            views: {},
            commands: {},
          },
        },
      });

      const v2 = defineApp<
        {
          Actor: { id: string; name: string };
          Resources: {
            counter: {
              Key: { counterId: string };
              State: { total: number; max: number };
              Events: { incremented: { amount: number } };
              Views: Record<string, never>;
              Commands: Record<string, never>;
            };
          };
        },
        typeof v1
      >({
        version: 2,
        previous: v1,
        migrate: {
          state: {
            counter(data) {
              return { total: data.count, max: 100 };
            },
          },
        },
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { total: 0, max: 100 },
            events: {
              incremented({ state, payload }) {
                state.total += payload.amount;
              },
            },
            views: {},
            commands: {},
          },
        },
      });

      const state = v2.restore("counter", { version: 1, data: { count: 42 } });
      expect(state).toEqual({ total: 42, max: 100 });
    });

    it("upcasts events with per-resource callback via previous chain", () => {
      const v1 = defineApp<{
        Actor: { id: string; name: string };
        Resources: {
          counter: {
            Key: { counterId: string };
            State: { count: number };
            Events: { inc: { amt: number } };
            Views: Record<string, never>;
            Commands: Record<string, never>;
          };
        };
      }>({
        version: 1,
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { count: 0 },
            events: {
              inc({ state, payload }) {
                state.count += payload.amt;
              },
            },
            views: {},
            commands: {},
          },
        },
      });

      const v2 = defineApp<
        {
          Actor: { id: string; name: string };
          Resources: {
            counter: {
              Key: { counterId: string };
              State: { total: number };
              Events: { incremented: { amount: number } };
              Views: Record<string, never>;
              Commands: Record<string, never>;
            };
          };
        },
        typeof v1
      >({
        version: 2,
        previous: v1,
        migrate: {
          event: {
            counter(name, payload) {
              if (name === "inc") return { name: "incremented", payload: { amount: payload.amt } };
              return { name, payload };
            },
          },
        },
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { total: 0 },
            events: {
              incremented({ state, payload }) {
                state.total += payload.amount;
              },
            },
            views: {},
            commands: {},
          },
        },
      });

      const state = v2.createState("counter");
      v2.applyEvent(
        "counter",
        state,
        {
          id: "e1",
          seq: 1,
          at: 1000,
          actor: { id: "u", name: "U" },
          name: "inc",
          payload: { amt: 5 },
        },
        1,
      );

      expect(state.total).toBe(5);
    });

    it("walks chain through three versions (v1→v2→v3)", () => {
      const v1 = defineApp<{
        Actor: { id: string; name: string };
        Resources: {
          counter: {
            Key: { counterId: string };
            State: { count: number };
            Events: { inc: { amt: number } };
            Views: Record<string, never>;
            Commands: Record<string, never>;
          };
        };
      }>({
        version: 1,
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { count: 0 },
            events: {
              inc({ state, payload }) {
                state.count += payload.amt;
              },
            },
            views: {},
            commands: {},
          },
        },
      });

      const v2 = defineApp<
        {
          Actor: { id: string; name: string };
          Resources: {
            counter: {
              Key: { counterId: string };
              State: { total: number; max: number };
              Events: { incremented: { amount: number } };
              Views: Record<string, never>;
              Commands: Record<string, never>;
            };
          };
        },
        typeof v1
      >({
        version: 2,
        previous: v1,
        migrate: {
          state: {
            counter(data) {
              return { total: data.count, max: 100 };
            },
          },
          event: {
            counter(name, payload) {
              if (name === "inc") return { name: "incremented", payload: { amount: payload.amt } };
              return { name, payload };
            },
          },
        },
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { total: 0, max: 100 },
            events: {
              incremented({ state, payload }) {
                state.total += payload.amount;
              },
            },
            views: {},
            commands: {},
          },
        },
      });

      const v3 = defineApp<
        {
          Actor: { id: string; name: string };
          Resources: {
            counter: {
              Key: { counterId: string };
              State: { total: number; max: number; label: string };
              Events: { incremented: { amount: number; label?: string } };
              Views: Record<string, never>;
              Commands: Record<string, never>;
            };
          };
        },
        typeof v2
      >({
        version: 3,
        previous: v2,
        migrate: {
          state: {
            counter(data) {
              return { total: data.total, max: data.max, label: "" };
            },
          },
        },
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { total: 0, max: 100, label: "" },
            events: {
              incremented({ state, payload }) {
                state.total += payload.amount;
                if (payload.label) state.label = payload.label;
              },
            },
            views: {},
            commands: {},
          },
        },
      });

      // v1 snapshot restored by v3 — runs through v2→v3 migration
      const state = v3.restore("counter", { version: 1, data: { count: 7 } });
      expect(state).toEqual({ total: 7, max: 100, label: "" });

      // v1 event applied by v3 — runs through v1→v2 and v2→v3 event upcast
      const state2 = v3.createState("counter");
      v3.applyEvent(
        "counter",
        state2,
        {
          id: "e1",
          seq: 1,
          at: 1000,
          actor: { id: "u", name: "U" },
          name: "inc",
          payload: { amt: 3 },
        },
        1,
      );
      expect(state2.total).toBe(3);
    });

    it("passes through unchanged resources when omitted from migrate", () => {
      const v1 = defineApp<{
        Actor: { id: string; name: string };
        Resources: {
          counter: {
            Key: { counterId: string };
            State: { count: number };
            Events: { inc: { amount: number } };
            Views: Record<string, never>;
            Commands: Record<string, never>;
          };
          doc: {
            Key: { docId: string };
            State: { title: string };
            Events: Record<string, never>;
            Views: Record<string, never>;
            Commands: Record<string, never>;
          };
        };
      }>({
        version: 1,
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { count: 0 },
            events: {
              inc({ state, payload }) {
                state.count += payload.amount;
              },
            },
            views: {},
            commands: {},
          },
          doc: {
            state: { title: "" },
            events: {},
            views: {},
            commands: {},
          },
        },
      });

      const v2 = defineApp<
        {
          Actor: { id: string; name: string };
          Resources: {
            counter: {
              Key: { counterId: string };
              State: { total: number; max: number };
              Events: { incremented: { amount: number } };
              Views: Record<string, never>;
              Commands: Record<string, never>;
            };
            doc: {
              Key: { docId: string };
              State: { title: string };
              Events: Record<string, never>;
              Views: Record<string, never>;
              Commands: Record<string, never>;
            };
          };
        },
        typeof v1
      >({
        version: 2,
        previous: v1,
        migrate: {
          state: {
            // doc omitted — should pass through unchanged
            counter(data) {
              return { total: data.count, max: 200 };
            },
          },
        },
        identify: () => ({ id: "u", name: "U" }),
        resources: {
          counter: {
            state: { total: 0, max: 200 },
            events: {
              incremented({ state, payload }) {
                state.total += payload.amount;
              },
            },
            views: {},
            commands: {},
          },
          doc: {
            state: { title: "" },
            events: {},
            views: {},
            commands: {},
          },
        },
      });

      const counterState = v2.restore("counter", { version: 1, data: { count: 10 } });
      expect(counterState).toEqual({ total: 10, max: 200 });

      const docState = v2.restore("doc", { version: 1, data: { title: "hello" } });
      expect(docState).toEqual({ title: "hello" });
    });
  });

  describe("property tests", () => {
    it("snapshot/restore round trip preserves state", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (count) => {
          const state = app.createState("counter");
          state.count = count;
          const snap = app.snapshot(state, 1);
          const restored = app.restore("counter", snap);
          return restored.count === count;
        }),
        { numRuns: 200 },
      );
    });

    it("snapshot at seq N + replay events after N equals apply all", () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 3, maxLength: 15 }),
          (amounts) => {
            const splitAt = Math.max(1, Math.floor(amounts.length / 2));

            const stateFull = app.createState("counter");
            const events = amounts.map((amount, i) => ({
              id: `e-${i}`,
              seq: i + 1,
              at: 1000 + i,
              actor: { id: "u", name: "U" },
              name: "incremented",
              payload: { amount },
            }));

            for (const ev of events) {
              app.applyEvent("counter", stateFull, ev);
            }

            const statePartial = app.createState("counter");
            for (let i = 0; i < splitAt; i++) {
              app.applyEvent("counter", statePartial, events[i]!);
            }

            const snap = app.snapshot(statePartial, splitAt);
            const restored = app.restore("counter", snap);

            for (let i = splitAt; i < events.length; i++) {
              app.applyEvent("counter", restored, events[i]!);
            }

            return stateFull.count === restored.count;
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
