import { afterEach, describe, expect, it } from "bun:test";

import fc from "fast-check";

import {
  createWorkflowProgram,
  createWorkflowRuntime,
  type WorkflowFeature,
} from "#features/workflows";
import { defineApp, type Submission, type FeatureDef, type ActorResolver } from "#kernel/app";
import { featureResourceName } from "#kernel/feature";
import { authorizeResource } from "#substrate/resource";
import { testFeature } from "#testing/application";

type TemporalWorkflows = {
  Workflows: {
    order: {
      Input: { title: string; generation: number };
      Output: { title: string; approvedBy: string; prepared: string };
      Signals: {
        rename: { title: string };
        approve: { reviewer: string };
      };
      Queries: {
        summary: {
          Input: null;
          Output: {
            status: string;
            generation: number;
            title: string;
            transitions: number;
          };
        };
      };
    };
    prepare: {
      Input: { title: string };
      Output: { value: string };
    };
  };
  Dependencies: {
    activities: {
      prepare(title: string): Promise<string>;
    };
  };
};

type TemporalFeature = {
  Resources: {
    updates: {
      Key: { ownerId: string; executionId: string; updateId: string };
      State: {
        status: "idle" | "accepted" | "completed" | "failed";
        title: string;
        result: string | null;
        error: string | null;
      };
      Events: {
        accepted: { title: string };
        completed: { result: string };
        failed: { error: string };
      };
      Views: {
        update: {
          status: "idle" | "accepted" | "completed" | "failed";
          title: string;
          result: string | null;
          error: string | null;
        };
      };
      Commands: {
        accept: { Input: { title: string }; Event: "accepted"; Error: "invalid" | "duplicate" };
        complete: { Input: { result: string }; Event: "completed"; Error: "not_accepted" };
        fail: { Input: { error: string }; Event: "failed"; Error: "not_accepted" };
      };
    };
  };
  Components: {};
  Features: { engine: WorkflowFeature<TemporalWorkflows> };
  Programs: { server: { update: { Events: readonly ["updates.accepted"] } } };
  API: {
    execution(id: string): {
      readonly summary: {
        status: string;
        generation: number;
        title: string;
        transitions: number;
        prepared?: string;
        approvedBy?: string;
      };
      start(input: { title: string; generation: number }): Submission<"already_started">;
      rename(title: string): Submission<"not_running">;
      approve(reviewer: string): Submission<"not_running">;
      cancel(reason?: string): Submission<"not_running">;
      startUpdate(
        updateId: string,
        title: string,
      ): Promise<{ readonly id: string; result(): Promise<string> }>;
      getUpdateHandle(updateId: string): { readonly id: string; result(): Promise<string> };
      executeUpdate(updateId: string, title: string): Promise<string>;
    };
  };
};

type ActorMessage =
  | { readonly type: "add"; readonly value: number }
  | { readonly type: "ask"; readonly replyId: string; readonly value: number }
  | { readonly type: "after"; readonly delayMs: number; readonly message: ActorMessage }
  | { readonly type: "fail" }
  | { readonly type: "stop" };

type ActorState = {
  status: "idle" | "running" | "stopped";
  total: number;
  failures: number;
  replies: Record<string, number>;
  mailbox: Array<{ readonly id: string; readonly message: ActorMessage }>;
};

type ActorFeature = {
  Resources: {
    actors: {
      Key: string;
      State: ActorState;
      Events: {
        spawned: null;
        queued: { id: string; message: ActorMessage };
        handled: {
          id: string;
          status: ActorState["status"];
          total: number;
          reply: { id: string; value: number } | null;
        };
        failed: { id: string };
      };
      Views: { snapshot: ActorState };
      Commands: {
        spawn: { Input: {}; Event: "spawned"; Error: "already_spawned" };
        tell: { Input: { message: ActorMessage }; Event: "queued"; Error: "stopped" };
        handle: {
          Input: {
            id: string;
            status: ActorState["status"];
            total: number;
            reply: { id: string; value: number } | null;
          };
          Event: "handled";
          Error: "missing";
        };
        fail: { Input: { id: string }; Event: "failed"; Error: "missing" };
      };
    };
  };
  Components: {};
  Dependencies: {
    server: {
      clock: { sleep(delayMs: number, signal: AbortSignal): Promise<void> };
      behavior: {
        reduce(
          total: number,
          message: ActorMessage,
        ): {
          readonly status: ActorState["status"];
          readonly total: number;
          readonly reply?: { readonly id: string; readonly value: number };
        };
      };
    };
  };
  Programs: {
    server: {
      handleMailbox: {
        Events: readonly ["actors.queued"];
        Key: string;
        KeyVersion: 1;
      };
    };
  };
  API: {
    actor(id: string): {
      readonly snapshot: ActorState;
      spawn(input: {}): Submission<"already_spawned">;
      tell(input: { message: ActorMessage }): Submission<"stopped">;
      ask(input: { replyId: string; value: number }): Promise<number>;
      after(input: { delayMs: number; message: ActorMessage }): Submission<"stopped">;
      stop(input: {}): Submission<"stopped">;
    };
  };
};

type CancellationScope = {
  readonly parent: string | null;
  readonly cancellable: boolean;
  readonly status: "active" | "cancelled" | "completed";
};

type CancellationFeature = {
  Resources: {
    scopes: {
      Key: string;
      State: {
        phase: "idle" | "running" | "cancelling" | "cleaning" | "cancelled";
        scopes: Record<string, CancellationScope>;
        trace: string[];
      };
      Events: {
        started: null;
        cancellationRequested: { scope: string };
        propagated: { scope: string; cancelled: string[] };
        cleaned: null;
      };
      Views: {
        snapshot: {
          phase: "idle" | "running" | "cancelling" | "cleaning" | "cancelled";
          scopes: Readonly<Record<string, CancellationScope>>;
          trace: readonly string[];
        };
      };
      Commands: {
        start: { Input: {}; Event: "started"; Error: "already_started" };
        request: {
          Input: { scope: string };
          Event: "cancellationRequested";
          Error: "not_running" | "unknown_scope";
        };
        propagate: {
          Input: { scope: string };
          Event: "propagated";
          Error: "not_cancelling" | "unknown_scope";
        };
        completeCleanup: { Input: {}; Event: "cleaned"; Error: "not_cleaning" };
      };
    };
  };
  Components: {};
  Dependencies: { server: { cleanup: { run(executionId: string): Promise<void> } } };
  Programs: {
    server: {
      propagateCancellation: { Events: readonly ["scopes.cancellationRequested"] };
      cleanupCancellation: { Events: readonly ["scopes.propagated"] };
    };
  };
  API: {
    execution(id: string): {
      readonly snapshot: {
        phase: "idle" | "running" | "cancelling" | "cleaning" | "cancelled";
        scopes: Readonly<Record<string, CancellationScope>>;
        trace: readonly string[];
      };
      start(input: {}): Submission<"already_started">;
      cancel(input: { scope?: string }): Submission<"not_running" | "unknown_scope">;
    };
  };
};

type ProjectionRecord = {
  text: string;
  terms: readonly string[];
  vector: readonly number[];
};

type ProjectionFeature = {
  Resources: {
    entries: {
      Key: string;
      State: { text: string };
      Events: { written: { text: string } };
      Views: { text: string };
      Commands: { write: { Input: { text: string }; Event: "written" } };
    };
    catalog: {
      Key: "all";
      State: { records: Record<string, string> };
      Events: { captured: { id: string; text: string } };
      Views: { records: Record<string, string> };
      Commands: { capture: { Input: { id: string; text: string }; Event: "captured" } };
    };
    index: {
      Key: "all";
      State: {
        version: number;
        records: Record<string, ProjectionRecord>;
      };
      Events: {
        indexed: ProjectionRecord & { id: string };
        rebuildRequested: { version: number };
        rebuilt: {
          version: number;
          records: Record<string, ProjectionRecord>;
        };
      };
      Views: {
        version: number;
        records: Record<string, ProjectionRecord>;
      };
      Commands: {
        record: {
          Input: { id: string; text: string; terms: readonly string[]; vector: readonly number[] };
          Event: "indexed";
        };
        rebuild: { Input: { version: number }; Event: "rebuildRequested" };
        replace: {
          Input: { version: number; records: Record<string, ProjectionRecord> };
          Event: "rebuilt";
        };
      };
    };
  };
  Components: {};
  Dependencies: {
    server: {
      text: { terms(value: string): readonly string[] };
      vector: { embed(value: string): readonly number[] };
    };
  };
  Programs: {
    server: {
      captureCatalog: { Events: readonly ["entries.written"] };
      indexEntry: { Events: readonly ["entries.written"] };
      rebuildIndex: { Events: readonly ["index.rebuildRequested"] };
    };
  };
  API: {
    write(id: string, text: string): Submission;
    rebuild(version: number): Submission;
    readonly version: number;
    search(term: string): readonly string[];
    nearest(vector: readonly number[]): string | undefined;
  };
};

type AuthFeature = {
  Authentication: ActorResolver<{ id: string }>;
  Resources: {
    sessions: {
      Key: { ownerId: string; id: string };
      State: { active: boolean };
      Events: { established: null; revoked: null };
      Views: { active: boolean };
      Commands: {
        establish: { Input: {}; Event: "established" };
        revoke: { Input: {}; Event: "revoked"; Error: "inactive" };
      };
    };
    audit: {
      Key: string;
      State: {
        entries: Array<{ id: string; sessionId: string; action: "established" | "revoked" }>;
      };
      Events: {
        recorded: { id: string; sessionId: string; action: "established" | "revoked" };
      };
      Views: {
        entries: readonly {
          id: string;
          sessionId: string;
          action: "established" | "revoked";
        }[];
      };
      Commands: {
        record: {
          Input: { id: string; sessionId: string; action: "established" | "revoked" };
          Event: "recorded";
        };
      };
    };
  };
  Components: {};
  Programs: {
    server: {
      auditEstablished: { Events: readonly ["sessions.established"] };
      auditRevoked: { Events: readonly ["sessions.revoked"] };
    };
  };
  API: {
    session(id: string): {
      readonly active: boolean;
      establish(input: {}): Submission;
      revoke(input: {}): Submission<"inactive">;
    };
    readonly audit: readonly {
      id: string;
      sessionId: string;
      action: "established" | "revoked";
    }[];
  };
};

type SecurityFeature = {
  Resources: {};
  Components: {};
  Features: { auth: AuthFeature };
  API: AuthFeature["API"];
};

type Register = { readonly clock: number; readonly peer: string; readonly value: string };

type Presence = {
  publish(document: string, peer: string, cursor: number): void;
  current(document: string): readonly { readonly peer: string; readonly cursor: number }[];
  subscribe(
    document: string,
    observer: (peers: readonly { readonly peer: string; readonly cursor: number }[]) => void,
  ): () => void;
};

type DocumentsFeature = {
  Resources: {
    documents: {
      Policy: "device";
      Key: string;
      State: { fields: Record<string, Register> };
      Events: { merged: { changes: Readonly<Record<string, Register>> } };
      Views: { fields: Readonly<Record<string, Register>> };
      Commands: {
        merge: { Input: { changes: Readonly<Record<string, Register>> }; Event: "merged" };
      };
    };
  };
  Components: {};
  Dependencies: { browser: { presence: Presence } };
  API: {
    document(id: string): {
      readonly fields: Readonly<Record<string, Register>>;
      merge(input: { changes: Readonly<Record<string, Register>> }): Submission;
    };
  };
};

type WorkerPrograms = {
  submit: { Events: readonly ["tasks.submitted"] };
  assign: { Events: readonly ["tasks.assigned"] };
};

type WorkersFeature = {
  Resources: {
    tasks: {
      Key: string;
      State: {
        submitted: boolean;
        target: "server" | "browser" | "serviceWorker" | null;
        completedBy: string[];
      };
      Events: {
        submitted: { target: "server" | "browser" | "serviceWorker" };
        assigned: { target: "server" | "browser" | "serviceWorker" };
        completed: { worker: string };
      };
      Views: {
        state: {
          submitted: boolean;
          target: "server" | "browser" | "serviceWorker" | null;
          completedBy: readonly string[];
        };
      };
      Commands: {
        submit: {
          Input: { target: "server" | "browser" | "serviceWorker" };
          Event: "submitted";
          Error: "already_submitted";
        };
        assign: {
          Input: { target: "server" | "browser" | "serviceWorker" };
          Event: "assigned";
          Error: "not_running";
        };
        complete: {
          Input: { target: "server" | "browser" | "serviceWorker"; worker: string };
          Event: "completed";
          Error: "reassigned" | "completed";
        };
      };
    };
  };
  Components: {};
  Dependencies: {
    server: { worker: { execute(id: string): Promise<string> } };
    browser: { worker: { execute(id: string): Promise<string> } };
    serviceWorker: { worker: { execute(id: string): Promise<string> } };
  };
  Programs: {
    server: WorkerPrograms;
    browser: WorkerPrograms;
    serviceWorker: WorkerPrograms;
  };
  API: {
    task(id: string): {
      readonly state: {
        submitted: boolean;
        target: "server" | "browser" | "serviceWorker" | null;
        completedBy: readonly string[];
      };
      submit(input: {
        target: "server" | "browser" | "serviceWorker";
      }): Submission<"already_submitted">;
      handoff(input: { target: "server" | "browser" | "serviceWorker" }): Submission<"not_running">;
    };
  };
};

type FactorySuiteSummary = {
  readonly phase: "idle" | "coordinating" | "coordinated";
  readonly workflow: string;
  readonly actorTotal: number;
  readonly projection: readonly string[];
  readonly document: string | undefined;
  readonly worker: readonly string[];
  readonly cancellation: string;
};

type FactorySuiteFeature = {
  Resources: {
    scenarios: {
      Key: string;
      State: { phase: FactorySuiteSummary["phase"] };
      Events: { requested: null; coordinated: null };
      Views: { phase: FactorySuiteSummary["phase"] };
      Commands: {
        start: { Input: {}; Event: "requested"; Error: "already_started" };
        complete: { Input: {}; Event: "coordinated"; Error: "not_running" };
      };
    };
  };
  Components: {};
  Features: {
    temporal: TemporalFeature;
    cancellation: CancellationFeature;
    actors: ActorFeature;
    projection: ProjectionFeature;
    documents: DocumentsFeature;
    workers: WorkersFeature;
  };
  Programs: { server: { coordinate: { Events: readonly ["scenarios.requested"] } } };
  API: {
    scenario(id: string): {
      readonly summary: FactorySuiteSummary;
      start(input: {}): Submission<"already_started">;
    };
    coordinate(id: string): Promise<void>;
  };
};

type StressApp = {
  Actor: { id: string };
  Resources: {};
  Features: {
    temporal: TemporalFeature;
    temporalReplacement: TemporalFeature;
    cancellationScopes: CancellationFeature;
    primaryActors: ActorFeature;
    secondaryActors: ActorFeature;
    projection: ProjectionFeature;
    security: SecurityFeature;
    documents: DocumentsFeature;
    workers: WorkersFeature;
    suite: FactorySuiteFeature;
  };
};

type ResourceObservation<Result> =
  | { readonly done: false }
  | { readonly done: true; readonly result: Result };

function waitForResource<View, Result>(
  resource: {
    readonly view: View;
    subscribe(observer: (view: View) => void): () => void;
  },
  observe: (view: View) => ResourceObservation<Result>,
): Promise<Result> {
  const current = observe(resource.view);
  if (current.done) return Promise.resolve(current.result);
  return new Promise<Result>((resolve, reject) => {
    let close: (() => void) | undefined;
    let closeWhenReady = false;
    const finish = (): void => {
      if (close) close();
      else closeWhenReady = true;
    };
    try {
      close = resource.subscribe((view) => {
        const next = observe(view);
        if (!next.done) return;
        finish();
        resolve(next.result);
      });
      if (closeWhenReady) close();
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

const createActorFeature = (_prefix: string): FeatureDef<StressApp, ActorFeature> => ({
  resources: {
    actors: {
      state: { status: "idle", total: 0, failures: 0, replies: {}, mailbox: [] },
      events: {
        spawned({ state }) {
          state.status = "running";
        },
        queued({ state, payload }) {
          state.mailbox.push(payload);
        },
        handled({ state, payload }) {
          state.mailbox = state.mailbox.filter(({ id }) => id !== payload.id);
          state.status = payload.status;
          state.total = payload.total;
          if (payload.reply) state.replies[payload.reply.id] = payload.reply.value;
        },
        failed({ state, payload }) {
          state.mailbox = state.mailbox.filter(({ id }) => id !== payload.id);
          state.failures += 1;
          state.status = "running";
        },
      },
      views: {
        snapshot: ({ state }) => ({
          ...state,
          replies: { ...state.replies },
          mailbox: [...state.mailbox],
        }),
      },
      commands: {
        spawn(context) {
          if (context.state.status !== "idle") return context.error("already_spawned");
          context.event.spawned(null);
        },
        tell(context, { message }) {
          if (context.state.status === "stopped") return context.error("stopped");
          context.event.queued({ id: context.id(), message });
        },
        handle(context, { id, status, total, reply }) {
          if (!context.state.mailbox.some((message) => message.id === id)) {
            return context.error("missing");
          }
          context.event.handled({ id, status, total, reply });
        },
        fail(context, { id }) {
          if (!context.state.mailbox.some((message) => message.id === id)) {
            return context.error("missing");
          }
          context.event.failed({ id });
        },
      },
    },
  },
  features: {},
  dependencies: {
    server: {
      clock: {
        sleep(delayMs, signal) {
          return new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delayMs);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        },
      },
      behavior: {
        reduce(total, message) {
          if (message.type === "fail") throw new Error("actor failure");
          if (message.type === "add") return { status: "running", total: total + message.value };
          if (message.type === "ask") {
            return {
              status: "running",
              total,
              reply: { id: message.replyId, value: total + message.value },
            };
          }
          return { status: "stopped", total };
        },
      },
    },
  },
  programs: {
    server: {
      handleMailbox: {
        source: {
          events: ["actors.queued"],
          replay: "all",
          version: 1,
          keyBy: ({ event }) => event.key,
          keyVersion: 1,
        },
        async handle({ actors, event, signal }, { behavior, clock }) {
          try {
            if (event.payload.message.type === "after") {
              await clock.sleep(event.payload.message.delayMs, signal);
              if (signal.aborted) return;
              await actors.tell.identified(`timer:${event.payload.id}`, {
                message: event.payload.message.message,
              });
              await actors.handle.identified(event.payload.id, {
                id: event.payload.id,
                status: actors.snapshot.status,
                total: actors.snapshot.total,
                reply: null,
              });
              return;
            }
            const next = behavior.reduce(actors.snapshot.total, event.payload.message);
            await actors.handle.identified(event.payload.id, {
              id: event.payload.id,
              status: next.status,
              total: next.total,
              reply: next.reply ?? null,
            });
          } catch {
            await actors.fail.identified(`failed:${event.payload.id}`, { id: event.payload.id });
          }
        },
      },
    },
  },
  api: ({ resources }) => ({
    actor(id) {
      const actor = resources.actors(id);
      return {
        get snapshot() {
          return actor.snapshot;
        },
        spawn: actor.spawn,
        tell: actor.tell,
        async ask({ replyId, value }) {
          const receipt = await actor.tell({ message: { type: "ask", replyId, value } });
          if (!receipt.ok) throw new Error(`Actor ask failed: ${receipt.error}.`);
          return waitForResource(
            actor,
            ({ snapshot }): ResourceObservation<number> =>
              replyId in snapshot.replies
                ? { done: true, result: snapshot.replies[replyId]! }
                : { done: false },
          );
        },
        after: ({ delayMs, message }) =>
          actor.tell({ message: { type: "after", delayMs, message } }),
        stop: () => actor.tell({ message: { type: "stop" } }),
      };
    },
  }),
  components: {},
});

const createCancellationFeature = (): FeatureDef<StressApp, CancellationFeature> => ({
  resources: {
    scopes: {
      state: { phase: "idle", scopes: {}, trace: [] },
      events: {
        started({ state }) {
          state.phase = "running";
          state.scopes = {
            root: { parent: null, cancellable: true, status: "active" },
            work: { parent: "root", cancellable: true, status: "active" },
            "work.nested": { parent: "work", cancellable: true, status: "active" },
            cleanup: { parent: "root", cancellable: false, status: "active" },
            "cleanup.release": { parent: "cleanup", cancellable: true, status: "active" },
          };
          state.trace.push("started");
        },
        cancellationRequested({ state, payload }) {
          state.phase = "cancelling";
          state.trace.push(`requested:${payload.scope}`);
        },
        propagated({ state, payload }) {
          for (const id of payload.cancelled) {
            const scope = state.scopes[id];
            if (scope) state.scopes[id] = { ...scope, status: "cancelled" };
          }
          state.phase = "cleaning";
          state.trace.push(`propagated:${payload.cancelled.join(",")}`);
        },
        cleaned({ state }) {
          for (const id of ["cleanup.release", "cleanup"]) {
            const scope = state.scopes[id];
            if (scope) state.scopes[id] = { ...scope, status: "completed" };
          }
          state.phase = "cancelled";
          state.trace.push("cleaned");
        },
      },
      views: {
        snapshot: ({ state }) => ({
          phase: state.phase,
          scopes: Object.fromEntries(
            Object.entries(state.scopes).map(([id, scope]) => [id, { ...scope }]),
          ),
          trace: [...state.trace],
        }),
      },
      commands: {
        start(context) {
          if (context.state.phase !== "idle") return context.error("already_started");
          context.event.started(null);
        },
        request(context, { scope }) {
          if (context.state.phase !== "running") return context.error("not_running");
          if (!context.state.scopes[scope]) return context.error("unknown_scope");
          context.event.cancellationRequested({ scope });
        },
        propagate(context, { scope: requested }) {
          if (context.state.phase !== "cancelling") return context.error("not_cancelling");
          if (!context.state.scopes[requested]) return context.error("unknown_scope");
          const cancelled: string[] = [];
          const visit = (id: string, blocked: boolean): void => {
            const scope = context.state.scopes[id];
            if (!scope) return;
            const nextBlocked = blocked || !scope.cancellable;
            if (!nextBlocked && scope.status === "active") cancelled.push(id);
            for (const [child, candidate] of Object.entries(context.state.scopes)) {
              if (candidate.parent === id) visit(child, nextBlocked);
            }
          };
          visit(requested, false);
          context.event.propagated({ scope: requested, cancelled });
        },
        completeCleanup(context) {
          if (context.state.phase !== "cleaning") return context.error("not_cleaning");
          context.event.cleaned(null);
        },
      },
    },
  },
  features: {},
  dependencies: { server: { cleanup: { run: async () => undefined } } },
  programs: {
    server: {
      propagateCancellation: {
        source: {
          events: ["scopes.cancellationRequested"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ event, scopes }) {
          await scopes.propagate.identified(event.id, { scope: event.payload.scope });
        },
      },
      cleanupCancellation: {
        source: {
          events: ["scopes.propagated"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ event, scopes }, { cleanup }) {
          await cleanup.run(event.key);
          await scopes.completeCleanup.identified(`cleanup:${event.id}`, {});
        },
      },
    },
  },
  api: ({ resources }) => ({
    execution(id) {
      const scopes = resources.scopes(id);
      return {
        get snapshot() {
          return scopes.snapshot;
        },
        start: scopes.start,
        cancel: ({ scope = "root" }) => scopes.request({ scope }),
      };
    },
  }),
  components: {},
});

const createProjectionFeature = (): FeatureDef<StressApp, ProjectionFeature> => ({
  resources: {
    entries: {
      state: { text: "" },
      events: { written: ({ state, payload }) => void (state.text = payload.text) },
      views: { text: ({ state }) => state.text },
      commands: { write: (context, { text }) => context.event.written({ text }) },
    },
    catalog: {
      state: { records: {} },
      events: {
        captured({ state, payload }) {
          state.records[payload.id] = payload.text;
        },
      },
      views: { records: ({ state }) => ({ ...state.records }) },
      commands: {
        capture: (context, { id, text }) => context.event.captured({ id, text }),
      },
    },
    index: {
      state: { version: 1, records: {} },
      events: {
        indexed({ state, payload }) {
          state.records[payload.id] = {
            text: payload.text,
            terms: payload.terms,
            vector: payload.vector,
          };
        },
        rebuildRequested({ state }) {
          state.records = {};
        },
        rebuilt({ state, payload }) {
          state.version = payload.version;
          state.records = payload.records;
        },
      },
      views: {
        version: ({ state }) => state.version,
        records: ({ state }) => ({ ...state.records }),
      },
      commands: {
        record: (context, { id, text, terms, vector }) =>
          context.event.indexed({ id, text, terms, vector }),
        rebuild: (context, { version }) => context.event.rebuildRequested({ version }),
        replace: (context, { version, records }) => context.event.rebuilt({ version, records }),
      },
    },
  },
  features: {},
  dependencies: {
    server: {
      text: {
        terms: (value) => value.toLowerCase().split(/\s+/).filter(Boolean),
      },
      vector: {
        embed: (value) => [value.length],
      },
    },
  },
  programs: {
    server: {
      captureCatalog: {
        source: {
          events: ["entries.written"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ event, resources }) {
          await resources.catalog("all").capture.identified(`entry:${event.id}`, {
            id: event.key,
            text: event.payload.text,
          });
        },
      },
      indexEntry: {
        source: {
          events: ["entries.written"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ event, resources }, { text, vector }) {
          await resources.index("all").record.identified(`entry:${event.id}`, {
            id: event.key,
            text: event.payload.text,
            terms: text.terms(event.payload.text),
            vector: vector.embed(event.payload.text),
          });
        },
      },
      rebuildIndex: {
        source: {
          events: ["index.rebuildRequested"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ event, index, resources }, { text, vector }) {
          const records = Object.fromEntries(
            Object.entries(resources.catalog("all").records).map(([id, value]) => [
              id,
              { text: value, terms: text.terms(value), vector: vector.embed(value) },
            ]),
          );
          await index.replace.identified(`rebuild:${event.id}`, {
            version: event.payload.version,
            records: records,
          });
        },
      },
    },
  },
  api: ({ resources }) => ({
    write: (id, text) => resources.entries(id).write({ text: text }),
    rebuild: (version) => resources.index("all").rebuild({ version: version }),
    get version() {
      return resources.index("all").version;
    },
    search(term) {
      const records = resources.index("all").records;
      return Object.keys(records).filter((id) => records[id]?.terms.includes(term));
    },
    nearest(vector) {
      const records = resources.index("all").records;
      return Object.keys(records).reduce<string | undefined>((nearest, id) => {
        if (!nearest) return id;
        return squaredDistance(records[id]!.vector, vector) <
          squaredDistance(records[nearest]!.vector, vector)
          ? id
          : nearest;
      }, undefined);
    },
  }),
  components: {},
});

function squaredDistance(left: readonly number[], right: readonly number[]): number {
  let distance = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    distance += delta * delta;
  }
  return distance;
}

const createAuthFeature = (): FeatureDef<StressApp, AuthFeature> => ({
  authentication: {
    async resolve({ headers }) {
      const authorization = headers.get("authorization");
      const id = authorization?.match(/^Bearer user:(.+)$/)?.[1];
      return id ? { actor: { id } } : null;
    },
  },
  resources: {
    sessions: {
      state: { active: false },
      authorize: ({ actor, key, operation }) =>
        operation.origin === "program" || actor.id === key.ownerId,
      events: {
        established: ({ state }) => void (state.active = true),
        revoked: ({ state }) => void (state.active = false),
      },
      views: { active: ({ state }) => state.active },
      commands: {
        establish: (context) => context.event.established(null),
        revoke(context) {
          if (!context.state.active) return context.error("inactive");
          context.event.revoked(null);
        },
      },
    },
    audit: {
      state: { entries: [] },
      authorize: ({ actor, key, operation }) => operation.origin === "program" || actor.id === key,
      events: {
        recorded({ state, payload }) {
          state.entries.push(payload);
        },
      },
      views: { entries: ({ state }) => [...state.entries] },
      commands: {
        record: (context, { id, sessionId, action }) =>
          context.event.recorded({ id, sessionId, action }),
      },
    },
  },
  features: {},
  programs: {
    server: {
      auditEstablished: {
        source: {
          events: ["sessions.established"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ event, resources }) {
          await resources.audit(event.key.ownerId).record.identified(`audit:${event.id}`, {
            id: event.id,
            sessionId: event.key.id,
            action: "established",
          });
        },
      },
      auditRevoked: {
        source: {
          events: ["sessions.revoked"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ event, resources }) {
          await resources.audit(event.key.ownerId).record.identified(`audit:${event.id}`, {
            id: event.id,
            sessionId: event.key.id,
            action: "revoked",
          });
        },
      },
    },
  },
  api: ({ actor, resources }) => {
    const audit = resources.audit(actor.id);
    return {
      session(id) {
        const session = resources.sessions({ ownerId: actor.id, id });
        return {
          get active() {
            return session.active;
          },
          establish: session.establish,
          revoke: session.revoke,
        };
      },
      get audit() {
        return audit.entries;
      },
    };
  },
  components: {},
});

const createSecurityFeature = (): FeatureDef<StressApp, SecurityFeature> => ({
  resources: {},
  features: { auth: createAuthFeature() },
  api: ({ features }) => ({
    session: features.auth.session,
    get audit() {
      return features.auth.audit;
    },
  }),
  components: {},
});

function registerWins(left: Register | undefined, right: Register): boolean {
  if (!left) return true;
  if (right.clock !== left.clock) return right.clock > left.clock;
  if (right.peer !== left.peer) return right.peer > left.peer;
  return right.value > left.value;
}

function createPresence(): Presence {
  const documents = new Map<string, Map<string, number>>();
  const observers = new Map<
    string,
    Set<(peers: readonly { readonly peer: string; readonly cursor: number }[]) => void>
  >();
  const current = (document: string) =>
    [...(documents.get(document) ?? [])]
      .map(([peer, cursor]) => ({ peer, cursor }))
      .sort((left, right) => left.peer.localeCompare(right.peer));
  return {
    publish(document, peer, cursor) {
      const peers = documents.get(document) ?? new Map();
      peers.set(peer, cursor);
      documents.set(document, peers);
      const value = current(document);
      for (const observer of observers.get(document) ?? []) observer(value);
    },
    current,
    subscribe(document, observer) {
      const subscriptions = observers.get(document) ?? new Set();
      subscriptions.add(observer);
      observers.set(document, subscriptions);
      observer(current(document));
      return () => {
        subscriptions.delete(observer);
        if (subscriptions.size === 0) observers.delete(document);
      };
    },
  };
}

const createDocumentsFeature = (): FeatureDef<StressApp, DocumentsFeature> => ({
  resources: {
    documents: {
      policy: "device",
      state: { fields: {} },
      events: {
        merged({ state, payload }) {
          for (const [name, register] of Object.entries(payload.changes)) {
            if (registerWins(state.fields[name], register)) state.fields[name] = register;
          }
        },
      },
      views: { fields: ({ state }) => ({ ...state.fields }) },
      commands: { merge: (context, { changes }) => context.event.merged({ changes }) },
    },
  },
  features: {},
  dependencies: { browser: { presence: createPresence() } },
  api: ({ resources }) => ({
    document(id) {
      const document = resources.documents(id);
      return {
        get fields() {
          return document.fields;
        },
        merge: document.merge,
      };
    },
  }),
  components: {},
});

function createWorkerProgram(
  environment: "server" | "browser" | "serviceWorker",
): NonNullable<FeatureDef<StressApp, WorkersFeature>["programs"]>["server"] {
  const execute = async (
    event: { readonly id: string; readonly key: string },
    tasks: {
      readonly state: {
        readonly target: "server" | "browser" | "serviceWorker" | null;
        readonly completedBy: readonly string[];
      };
      readonly complete: {
        identified(
          id: string,
          input: { target: "server" | "browser" | "serviceWorker"; worker: string },
        ): Submission<"reassigned" | "completed">;
      };
    },
    dependencies: { readonly worker: { execute(id: string): Promise<string> } },
  ) => {
    if (tasks.state.target !== environment || tasks.state.completedBy.length > 0) return;
    const worker = await dependencies.worker.execute(event.key);
    await tasks.complete.identified(`${environment}:${event.id}`, {
      target: environment,
      worker,
    });
  };
  return {
    submit: {
      source: {
        events: ["tasks.submitted"],
        replay: "all",
        version: 1,
        keyBy: "resource",
      },
      handle: ({ event, tasks }, dependencies) =>
        event.payload.target === environment ? execute(event, tasks, dependencies) : undefined,
    },
    assign: {
      source: {
        events: ["tasks.assigned"],
        replay: "all",
        version: 1,
        keyBy: "resource",
      },
      handle: ({ event, tasks }, dependencies) =>
        event.payload.target === environment ? execute(event, tasks, dependencies) : undefined,
    },
  };
}

const createWorkersFeature = (): FeatureDef<StressApp, WorkersFeature> => {
  return {
    resources: {
      tasks: {
        state: { submitted: false, target: null, completedBy: [] },
        events: {
          submitted({ state, payload }) {
            state.submitted = true;
            state.target = payload.target;
          },
          assigned({ state, payload }) {
            state.target = payload.target;
          },
          completed: ({ state, payload }) => void state.completedBy.push(payload.worker),
        },
        views: {
          state: ({ state }) => ({ ...state, completedBy: [...state.completedBy] }),
        },
        commands: {
          submit(context, { target }) {
            if (context.state.submitted) return context.error("already_submitted");
            context.event.submitted({ target });
          },
          assign(context, { target }) {
            if (!context.state.submitted || context.state.completedBy.length > 0) {
              return context.error("not_running");
            }
            context.event.assigned({ target });
          },
          complete(context, { target, worker }) {
            if (context.state.completedBy.length > 0) return context.error("completed");
            if (context.state.target !== target) return context.error("reassigned");
            context.event.completed({ worker });
          },
        },
      },
    },
    features: {},
    dependencies: {
      server: { worker: { execute: async () => "server" } },
      browser: { worker: { execute: async () => "browser" } },
      serviceWorker: { worker: { execute: async () => "service-worker" } },
    },
    programs: {
      server: createWorkerProgram("server"),
      browser: createWorkerProgram("browser"),
      serviceWorker: createWorkerProgram("serviceWorker"),
    },
    api: ({ resources }) => ({
      task(id) {
        const task = resources.tasks(id);
        return {
          get state() {
            return task.state;
          },
          submit: task.submit,
          handoff: task.assign,
        };
      },
    }),
    components: {},
  };
};

function createTemporalFeature(
  activities: TemporalWorkflows["Dependencies"]["activities"],
): FeatureDef<StressApp, TemporalFeature> {
  const runtime = createWorkflowRuntime<StressApp, TemporalWorkflows>({
    queries: {
      order: {
        summary(run) {
          const latestTitle = run.messages.reduce(
            (title, message) =>
              message.name === "rename"
                ? (message.payload as { readonly title: string }).title
                : title,
            run.input.title,
          );
          return {
            status: run.status,
            generation: run.generation,
            title: run.output?.title ?? latestTitle,
            transitions: run.transitionCount,
            ...(run.output
              ? { prepared: run.output.prepared, approvedBy: run.output.approvedBy }
              : {}),
          };
        },
      },
    },
  });
  const engine: FeatureDef<StressApp, WorkflowFeature<TemporalWorkflows>> = {
    resources: runtime.resources,
    features: {},
    dependencies: { server: { activities } },
    programs: {
      server: createWorkflowProgram<StressApp, TemporalWorkflows>({
        workflows: {
          order: {
            async run(context, input) {
              if (input.generation === 0) {
                return context.continueAsNew({ ...input, generation: 1 });
              }
              const prepared = await context.invoke(
                "prepare-child",
                "prepare",
                { title: input.title },
                { runId: `${context.runId}:prepare` },
              );
              const renamed = await context.waitFor("rename", "rename");
              const approval = await context.waitFor("approve", "approve");
              return {
                title: renamed.title,
                approvedBy: approval.reviewer,
                prepared: prepared.value,
              };
            },
          },
          prepare: {
            async run(context, input, dependencies) {
              const value = await context.perform("prepare", () =>
                dependencies.activities.prepare(input.title),
              );
              return { value };
            },
          },
        },
      }),
    },
    api: runtime.api,
    components: {},
  };

  return {
    resources: {
      updates: {
        state: { status: "idle", title: "", result: null, error: null },
        authorize: ({ actor, key }) => actor.id === key.ownerId,
        events: {
          accepted({ state, payload }) {
            state.status = "accepted";
            state.title = payload.title;
          },
          completed({ state, payload }) {
            state.status = "completed";
            state.result = payload.result;
          },
          failed({ state, payload }) {
            state.status = "failed";
            state.error = payload.error;
          },
        },
        views: {
          update: ({ state }) => ({ ...state }),
        },
        commands: {
          accept(context, { title }) {
            if (!title.trim()) return context.error("invalid");
            if (context.state.status !== "idle") return context.error("duplicate");
            context.event.accepted({ title });
          },
          complete(context, { result }) {
            if (context.state.status !== "accepted") return context.error("not_accepted");
            context.event.completed({ result });
          },
          fail(context, { error }) {
            if (context.state.status !== "accepted") return context.error("not_accepted");
            context.event.failed({ error });
          },
        },
      },
    },
    features: { engine },
    programs: {
      server: {
        update: {
          source: {
            events: ["updates.accepted"],
            replay: "all",
            version: 1,
            keyBy: "resource",
          },
          async handle({ api, event, updates }) {
            const signalled = await api.temporal
              .execution(event.key.executionId)
              .rename(event.payload.title);
            if (signalled.ok) {
              await updates.complete.identified(`update:${event.key.updateId}:complete`, {
                result: event.payload.title,
              });
            } else {
              await updates.fail.identified(`update:${event.key.updateId}:fail`, {
                error: `Workflow update failed: ${signalled.error}.`,
              });
            }
          },
        },
      },
    },
    api: ({ actor, features, resources }) => ({
      execution(id) {
        const execution = features.engine.getWorkflow("order", id);
        const update = (updateId: string) =>
          resources.updates({ ownerId: actor.id, executionId: id, updateId });
        const result = (updateId: string): Promise<string> =>
          waitForResource(update(updateId), ({ update: current }): ResourceObservation<string> => {
            if (current.status === "completed") {
              if (typeof current.result !== "string") {
                throw new Error("Completed Workflow update has no result.");
              }
              return { done: true, result: current.result };
            }
            if (current.status === "failed") {
              throw new Error(current.error ?? "Workflow update failed.");
            }
            return { done: false };
          });
        const startUpdate = async (updateId: string, title: string) => {
          const accepted = await update(updateId).accept({ title: title });
          if (!accepted.ok) throw new Error(`Workflow update was rejected: ${accepted.error}.`);
          return getUpdateHandle(updateId);
        };
        const getUpdateHandle = (updateId: string) => ({
          id: updateId,
          result: () => result(updateId),
        });
        return {
          get summary() {
            return execution.query("summary", null);
          },
          start: execution.start,
          rename: (title) => execution.signal("rename", { title }),
          approve: (reviewer) => execution.signal("approve", { reviewer }),
          cancel: execution.cancel,
          startUpdate,
          getUpdateHandle,
          async executeUpdate(updateId, title) {
            return (await startUpdate(updateId, title)).result();
          },
        };
      },
    }),
    components: {},
  };
}

async function requireCommand(receipt: Submission<string>, operation: string): Promise<void> {
  const result = await receipt;
  if (!result.ok) throw new Error(`${operation} failed: ${result.error}.`);
}

function createFactorySuiteFeature(): FeatureDef<StressApp, FactorySuiteFeature> {
  return {
    resources: {
      scenarios: {
        state: { phase: "idle" },
        events: {
          requested: ({ state }) => void (state.phase = "coordinating"),
          coordinated: ({ state }) => void (state.phase = "coordinated"),
        },
        views: { phase: ({ state }) => state.phase },
        commands: {
          start(context) {
            if (context.state.phase !== "idle") return context.error("already_started");
            context.event.requested(null);
          },
          complete(context) {
            if (context.state.phase !== "coordinating") return context.error("not_running");
            context.event.coordinated(null);
          },
        },
      },
    },
    features: {
      temporal: createTemporalFeature({
        async prepare(title) {
          return `nested:${title}`;
        },
      }),
      cancellation: createCancellationFeature(),
      actors: createActorFeature("nested"),
      projection: createProjectionFeature(),
      documents: createDocumentsFeature(),
      workers: createWorkersFeature(),
    },
    programs: {
      server: {
        coordinate: {
          source: {
            events: ["scenarios.requested"],
            replay: "all",
            version: 1,
            keyBy: "resource",
          },
          async handle({ api, event, scenarios }) {
            await api.suite.coordinate(event.key);
            await scenarios.complete.identified(`coordinated:${event.id}`, {});
          },
        },
      },
    },
    api: ({ features, resources }) => {
      const coordinate = async (id: string): Promise<void> => {
        const workflow = features.temporal.execution(id);
        const actor = features.actors.actor(id);
        const cancellation = features.cancellation.execution(id);
        await requireCommand(
          workflow.start({ title: "Nested", generation: 1 }),
          "start nested workflow",
        );
        await requireCommand(workflow.rename("Coordinated"), "rename nested workflow");
        await requireCommand(workflow.approve("suite"), "approve nested workflow");
        await requireCommand(actor.spawn({}), "spawn nested actor");
        await requireCommand(
          actor.tell({ message: { type: "add", value: 7 } }),
          "tell nested actor",
        );
        await requireCommand(
          features.projection.write(id, "nested composition"),
          "write nested projection",
        );
        await requireCommand(
          features.documents.document(id).merge({
            changes: { title: { clock: 1, peer: "suite", value: "composed" } },
          }),
          "merge nested document",
        );
        await requireCommand(
          features.workers.task(id).submit({ target: "server" }),
          "submit nested task",
        );
        await requireCommand(cancellation.start({}), "start nested cancellation scope");
        await requireCommand(cancellation.cancel({ scope: "work" }), "cancel nested work scope");
      };
      return {
        scenario(id) {
          const scenario = resources.scenarios(id);
          return {
            get summary() {
              return {
                phase: scenario.phase,
                workflow: features.temporal.execution(id).summary.status,
                actorTotal: features.actors.actor(id).snapshot.total,
                projection: features.projection.search("nested"),
                document: features.documents.document(id).fields.title?.value,
                worker: features.workers.task(id).state.completedBy,
                cancellation: features.cancellation.execution(id).snapshot.phase,
              };
            },
            start: scenario.start,
          };
        },
        coordinate,
      };
    },
    components: {},
  };
}

const app = defineApp<StressApp>({
  version: 1,
  resources: {},
  features: {
    temporal: createTemporalFeature({
      async prepare(title) {
        return `prepared:${title}`;
      },
    }),
    temporalReplacement: createTemporalFeature({
      async prepare(title) {
        return `replacement:${title}`;
      },
    }),
    cancellationScopes: createCancellationFeature(),
    primaryActors: createActorFeature("primary"),
    secondaryActors: createActorFeature("secondary"),
    projection: createProjectionFeature(),
    security: createSecurityFeature(),
    documents: createDocumentsFeature(),
    workers: createWorkersFeature(),
    suite: createFactorySuiteFeature(),
  },
});

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

describe("core primitive adversarial factories", () => {
  it("composes a Temporal-style API over a hidden durable Feature", async () => {
    const primary = await testFeature(app, "temporal", { actor: { id: "owner" } });
    const replacement = await testFeature(app, "temporalReplacement", {
      actor: { id: "owner" },
    });
    fixtures.push(primary, replacement);

    const execution = primary.api.execution("order-1");
    expect(await execution.start({ title: "Draft", generation: 0 })).toMatchObject({ ok: true });
    await primary.drain();
    expect(execution.summary).toMatchObject({
      status: "running",
      generation: 1,
      title: "Draft",
    });
    await expect(execution.executeUpdate("invalid", "")).rejects.toThrow("invalid");
    const update = await execution.startUpdate("rename-1", "Final");
    expect(update.id).toBe("rename-1");
    expect(await update.result()).toBe("Final");
    await expect(execution.startUpdate("rename-1", "Other")).rejects.toThrow("duplicate");
    expect(await execution.approve("Ada")).toMatchObject({ ok: true });
    await primary.drain();
    expect(execution.summary).toMatchObject({
      status: "completed",
      generation: 1,
      title: "Final",
      prepared: "prepared:Draft",
      approvedBy: "Ada",
    });
    const transitions = execution.summary.transitions;
    await primary.restart();
    await primary.drain();
    expect(execution.summary.transitions).toBe(transitions);
    expect(await execution.getUpdateHandle("rename-1").result()).toBe("Final");

    const alternative = replacement.api.execution("order-2");
    await alternative.start({ title: "Second", generation: 1 });
    await replacement.drain();
    await alternative.rename("Renamed");
    await alternative.approve("Grace");
    await replacement.drain();
    expect(alternative.summary.prepared).toBe("replacement:Second");

    const cancelled = primary.api.execution("order-3");
    await cancelled.start({ title: "Cancelled", generation: 1 });
    await primary.drain();
    expect(await cancelled.cancel("user_request")).toMatchObject({ ok: true });
    await primary.drain();
    expect(cancelled.summary.status).toBe("cancelled");
  });

  it("expresses cooperative cancellation scopes with a non-cancellable cleanup barrier", async () => {
    const cleanup = Promise.withResolvers<void>();
    const cleanupIds: string[] = [];
    const fixture = await testFeature(app, "cancellationScopes", {
      actor: { id: "owner" },
      dependencies: {
        server: {
          cleanup: {
            async run(id) {
              cleanupIds.push(id);
              await cleanup.promise;
            },
          },
        },
      },
    });
    fixtures.push(fixture);
    const execution = fixture.api.execution("order-1");
    expect(await execution.start({})).toMatchObject({ ok: true });
    expect(await execution.cancel({})).toMatchObject({ ok: true });
    const draining = fixture.drain();
    while (execution.snapshot.phase !== "cleaning" || cleanupIds.length !== 1) {
      await Promise.resolve();
    }
    expect(execution.snapshot.scopes).toMatchObject({
      root: { status: "cancelled" },
      work: { status: "cancelled" },
      "work.nested": { status: "cancelled" },
      cleanup: { status: "active" },
      "cleanup.release": { status: "active" },
    });
    expect(cleanupIds).toEqual(["order-1"]);
    cleanup.resolve();
    await draining;
    expect(execution.snapshot).toMatchObject({
      phase: "cancelled",
      scopes: {
        cleanup: { status: "completed" },
        "cleanup.release": { status: "completed" },
      },
      trace: ["started", "requested:root", "propagated:root,work,work.nested", "cleaned"],
    });
  });

  it("retries failed scoped cleanup after Program restart without repeating transitions", async () => {
    let attempts = 0;
    const completed = new Set<string>();
    const fixture = await testFeature(app, "cancellationScopes", {
      actor: { id: "owner" },
      dependencies: {
        server: {
          cleanup: {
            async run(id) {
              attempts += 1;
              if (attempts === 1) throw new Error("cleanup unavailable");
              completed.add(id);
            },
          },
        },
      },
    });
    fixtures.push(fixture);
    const execution = fixture.api.execution("order-2");
    await execution.start({});
    await execution.cancel({ scope: "work" });
    await expect(fixture.drain()).rejects.toThrow("cleanup unavailable");
    expect(execution.snapshot).toMatchObject({
      phase: "cleaning",
      scopes: {
        root: { status: "active" },
        work: { status: "cancelled" },
        "work.nested": { status: "cancelled" },
        cleanup: { status: "active" },
      },
    });
    await fixture.restart();
    await fixture.drain();
    expect(attempts).toBe(2);
    expect(completed).toEqual(new Set(["order-2"]));
    expect(execution.snapshot.phase).toBe("cancelled");
    expect(execution.snapshot.trace).toEqual([
      "started",
      "requested:work",
      "propagated:work,work.nested",
      "cleaned",
    ]);
    await fixture.restart();
    await fixture.drain();
    expect(attempts).toBe(2);
  });

  it("runs isolated actor mailboxes through a replaceable semantic behavior", async () => {
    const timers: Array<() => void> = [];
    const primary = await testFeature(app, "primaryActors", {
      actor: { id: "owner" },
      dependencies: {
        server: {
          clock: {
            sleep() {
              const gate = Promise.withResolvers<void>();
              timers.push(gate.resolve);
              return gate.promise;
            },
          },
        },
      },
    });
    const secondary = await testFeature(app, "secondaryActors", {
      actor: { id: "owner" },
      dependencies: {
        server: {
          behavior: {
            reduce(total, message) {
              return message.type === "add"
                ? { status: "running", total: total + message.value * 10 }
                : { status: "stopped", total };
            },
          },
        },
      },
    });
    fixtures.push(primary, secondary);
    const first = primary.api.actor("counter");
    const second = secondary.api.actor("counter");
    await first.spawn({});
    await second.spawn({});
    await Promise.all(
      Array.from({ length: 100 }, () => first.tell({ message: { type: "add", value: 1 } })),
    );
    await Promise.all(
      Array.from({ length: 25 }, () => second.tell({ message: { type: "add", value: 1 } })),
    );
    await Promise.all([primary.drain(), secondary.drain()]);
    expect(first.snapshot.total).toBe(100);
    expect(second.snapshot.total).toBe(250);
    expect(first.snapshot.mailbox).toEqual([]);
    expect(await first.ask({ replyId: "sum", value: 23 })).toBe(123);
    await first.tell({ message: { type: "fail" } });
    await primary.drain();
    expect(first.snapshot.replies.sum).toBe(123);
    expect(first.snapshot.failures).toBe(1);
    expect(first.snapshot.status).toBe("running");
    await first.after({ delayMs: 1_000, message: { type: "add", value: 7 } });
    while (timers.length === 0) await Promise.resolve();
    timers.shift()!();
    await primary.drain();
    expect(first.snapshot.total).toBe(107);
    await primary.restart();
    await primary.drain();
    expect(first.snapshot.failures).toBe(1);
    await first.stop({});
    await primary.drain();
    expect(await first.tell({ message: { type: "add", value: 1 } })).toEqual({
      ok: false,
      error: "stopped",
      data: undefined,
    });
  });

  it("builds an idempotent projection behind a replaceable text contract", async () => {
    const fixture = await testFeature(app, "projection", {
      actor: { id: "owner" },
      dependencies: {
        server: {
          text: { terms: (value) => [...new Set(value.toLowerCase())] },
          vector: { embed: (value) => [value.length, value.charCodeAt(0)] },
        },
      },
    });
    fixtures.push(fixture);
    await fixture.api.write("first", "Abba");
    await fixture.api.write("second", "Cab");
    await fixture.drain();
    expect(fixture.api.search("a")).toEqual(["first", "second"]);
    await fixture.api.write("first", "Zoo");
    await fixture.drain();
    expect(fixture.api.search("b")).toEqual(["second"]);
    expect(fixture.api.nearest([3, 70])).toBe("second");
    expect(await fixture.api.rebuild(2)).toMatchObject({ ok: true });
    await fixture.drain();
    expect(fixture.api.version).toBe(2);
    expect(fixture.api.nearest([3, 88])).toBe("first");
    await fixture.restart();
    await fixture.drain();
    expect(fixture.api.search("o")).toEqual(["first"]);
    expect(fixture.api.search("b")).toEqual(["second"]);
  });

  it("keeps authorization semantic and colocated with session state", async () => {
    const fixture = await testFeature(app, "security", { actor: { id: "ada" } });
    const resolver = await testFeature(app, "security.auth", { actor: { id: "ada" } });
    fixtures.push(fixture, resolver);
    const authentication = resolver.dependencies.server.authentication;
    expect(
      await authentication.resolve({
        headers: new Headers({ authorization: "Bearer user:ada" }),
      }),
    ).toEqual({ actor: { id: "ada" } });
    expect(await authentication.resolve({ headers: new Headers() })).toBeNull();

    const replacement = await testFeature(app, "security.auth", {
      actor: { id: "ada" },
      dependencies: {
        server: {
          authentication: {
            async resolve({ headers }) {
              const id = headers.get("x-test-user");
              return id ? { actor: { id } } : null;
            },
          },
        },
      },
    });
    fixtures.push(replacement);
    expect(
      await replacement.dependencies.server.authentication.resolve({
        headers: new Headers({ "x-test-user": "grace" }),
      }),
    ).toEqual({ actor: { id: "grace" } });

    const session = fixture.api.session("phone");
    expect(session.active).toBe(false);
    expect(await session.establish({})).toMatchObject({ ok: true });
    expect(session.active).toBe(true);
    expect(await session.revoke({})).toMatchObject({ ok: true });
    expect(await session.revoke({})).toEqual({ ok: false, error: "inactive", data: undefined });
    await fixture.drain();
    expect(fixture.api.audit.map(({ sessionId, action }) => ({ sessionId, action }))).toEqual([
      { sessionId: "phone", action: "established" },
      { sessionId: "phone", action: "revoked" },
    ]);
    await fixture.restart();
    await fixture.drain();
    expect(fixture.api.audit).toHaveLength(2);
    const resource = featureResourceName("security.auth", "sessions");
    expect(
      authorizeResource(
        app,
        resource,
        app.createState(resource),
        { id: "grace" },
        { ownerId: "ada", id: "phone" },
        { type: "read" },
      ),
    ).toBe(false);
  });

  it("converges offline document changes regardless of delivery order", async () => {
    const presence = createPresence();
    const left = await testFeature(app, "documents", {
      actor: { id: "owner" },
      dependencies: { browser: { presence } },
    });
    const right = await testFeature(app, "documents", {
      actor: { id: "owner" },
      dependencies: { browser: { presence } },
    });
    fixtures.push(left, right);
    const observed: string[] = [];
    const stop = left.observe(
      (api) => api.document("doc").fields.title?.value ?? "",
      (value) => observed.push(value),
    );
    const changes = [
      { title: { clock: 1, peer: "a", value: "draft" } },
      { title: { clock: 2, peer: "a", value: "final" } },
      { title: { clock: 2, peer: "b", value: "reviewed" } },
    ] as const;
    for (const change of changes) await left.api.document("doc").merge({ changes: change });
    for (const change of [...changes].reverse()) {
      await right.api.document("doc").merge({ changes: change });
    }
    expect(left.api.document("doc").fields).toEqual(right.api.document("doc").fields);
    expect(left.api.document("doc").fields.title?.value).toBe("reviewed");
    expect(observed.at(-1)).toBe("reviewed");
    stop();
    const presenceSnapshots: Array<readonly { readonly peer: string; readonly cursor: number }[]> =
      [];
    const stopPresence = right.dependencies.browser.presence.subscribe("doc", (peers) =>
      presenceSnapshots.push(peers),
    );
    left.dependencies.browser.presence.publish("doc", "left", 4);
    right.dependencies.browser.presence.publish("doc", "right", 9);
    expect(presenceSnapshots.at(-1)).toEqual([
      { peer: "left", cursor: 4 },
      { peer: "right", cursor: 9 },
    ]);
    expect(left.events().some(({ resource }) => resource.includes("presence"))).toBe(false);
    stopPresence();
    await left.restart();
    expect(left.api.document("doc").fields.title?.value).toBe("reviewed");
    expect(left.dependencies.browser.presence.current("doc")).toEqual([
      { peer: "left", cursor: 4 },
      { peer: "right", cursor: 9 },
    ]);
    expect(createPresence().current("doc")).toEqual([]);

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            clock: fc.integer({ min: 0, max: 20 }),
            peer: fc.constantFrom("a", "b", "c"),
            value: fc.string({ maxLength: 12 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (registers) => {
          const forward = await testFeature(app, "documents", { actor: { id: "owner" } });
          const reverse = await testFeature(app, "documents", { actor: { id: "owner" } });
          const duplicate = await testFeature(app, "documents", { actor: { id: "owner" } });
          try {
            for (const register of registers) {
              await forward.api.document("generated").merge({ changes: { value: register } });
            }
            for (const register of [...registers].reverse()) {
              await reverse.api.document("generated").merge({ changes: { value: register } });
            }
            for (const register of [...registers, ...registers]) {
              await duplicate.api.document("generated").merge({ changes: { value: register } });
            }
            expect(forward.api.document("generated").fields).toEqual(
              reverse.api.document("generated").fields,
            );
            expect(forward.api.document("generated").fields).toEqual(
              duplicate.api.document("generated").fields,
            );
          } finally {
            await Promise.all([forward.dispose(), reverse.dispose(), duplicate.dispose()]);
          }
        },
      ),
      { numRuns: 100 },
    );

    for (let clock = 0; clock < 1_000; clock += 1) {
      await left.api.document("bounded").merge({
        changes: { title: { clock, peer: "stream", value: String(clock) } },
      });
    }
    expect(Object.keys(left.api.document("bounded").fields)).toEqual(["title"]);
    expect(left.api.document("bounded").fields.title?.value).toBe("999");
  });

  it("recovers one semantic task program across independently injected environments", async () => {
    let deviceAttempts = 0;
    const fixture = await testFeature(app, "workers", {
      actor: { id: "owner" },
      dependencies: {
        server: { worker: { execute: async () => "cloud" } },
        browser: {
          worker: {
            async execute() {
              deviceAttempts += 1;
              if (deviceAttempts === 1) throw new Error("device unavailable");
              return "device";
            },
          },
        },
        serviceWorker: { worker: { execute: async () => "edge" } },
      },
    });
    fixtures.push(fixture);
    const task = fixture.api.task("compile");
    await task.submit({ target: "browser" });
    await expect(fixture.drain()).rejects.toThrow("device unavailable");
    expect(task.state).toMatchObject({ submitted: true, target: "browser", completedBy: [] });
    expect(await task.handoff({ target: "server" })).toMatchObject({ ok: true });
    await fixture.restart();
    await fixture.drain();
    expect(task.state).toMatchObject({ target: "server", completedBy: ["cloud"] });
    expect(deviceAttempts).toBe(1);
    await fixture.restart();
    await fixture.drain();
    expect(task.state.completedBy).toEqual(["cloud"]);

    const edge = fixture.api.task("edge-task");
    await edge.submit({ target: "serviceWorker" });
    await fixture.drain();
    expect(edge.state).toMatchObject({ target: "serviceWorker", completedBy: ["edge"] });
  });

  it("coordinates deeply nested factory instances only through their semantic APIs", async () => {
    const fixture = await testFeature(app, "suite", { actor: { id: "owner" } });
    fixtures.push(fixture);
    const scenario = fixture.api.scenario("nested-1");
    expect(await scenario.start({})).toMatchObject({ ok: true });
    await fixture.drain();
    expect(scenario.summary).toEqual({
      phase: "coordinated",
      workflow: "completed",
      actorTotal: 7,
      projection: ["nested-1"],
      document: "composed",
      worker: ["server"],
      cancellation: "cancelled",
    });
    expect(
      new Set(
        fixture
          .events()
          .map(({ resource }) => resource)
          .filter((resource) => resource.startsWith("@feature/suite")),
      ),
    ).toEqual(
      new Set([
        "@feature/suite/resource/scenarios",
        "@feature/suite.actors/resource/actors",
        "@feature/suite.cancellation/resource/scopes",
        "@feature/suite.documents/resource/documents",
        "@feature/suite.projection/resource/catalog",
        "@feature/suite.projection/resource/entries",
        "@feature/suite.projection/resource/index",
        "@feature/suite.temporal.engine/resource/runs",
        "@feature/suite.workers/resource/tasks",
      ]),
    );
    await fixture.restart();
    await fixture.drain();
    expect(scenario.summary).toMatchObject({
      phase: "coordinated",
      workflow: "completed",
      actorTotal: 7,
      worker: ["server"],
    });

    const replacement = await testFeature(app, "suite.projection", {
      actor: { id: "owner" },
      dependencies: {
        server: {
          text: { terms: (value) => [value.toUpperCase()] },
          vector: { embed: (value) => [value.length * 2] },
        },
      },
    });
    fixtures.push(replacement);
    await replacement.api.write("nested-2", "semantic");
    await replacement.drain();
    expect(replacement.api.search("SEMANTIC")).toEqual(["nested-2"]);
    expect(replacement.api.nearest([16])).toBe("nested-2");
  });
});
