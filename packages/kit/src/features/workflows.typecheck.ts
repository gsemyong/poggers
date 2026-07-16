import {
  createFunctions,
  referenceFunction,
  testFunctions,
  type AppDef,
  type FunctionsFeature,
} from "@poggers/kit";

type Orders = {
  Events: {
    "order/placed": { orderId: string; total: number };
    "order/approved": { orderId: string; reviewerId: string };
    "order/notified": { orderId: string };
  };
  Functions: {
    fulfill: {
      Input: { orderId: string; total: number };
      Output: { shipmentId: string; reviewerId?: string };
      Error: { code: "payment_declined" | "approval_timeout" };
    };
    shipment: {
      Input: { orderId: string };
      Output: { shipmentId: string };
    };
    notify: {
      Input: { orderId: string };
      Output: void;
    };
  };
  Dependencies: {
    payments: {
      authorize(orderId: string): Promise<{ authorizationId: string }>;
    };
  };
};

type WorkflowApp = {
  Actor: { id: string };
  Resources: {};
  Features: { workflows: FunctionsFeature<Orders> };
};

const shipmentReference = referenceFunction<{ orderId: string }, { shipmentId: string }>({
  functionId: "shipment",
});
const remoteShipmentReference = referenceFunction<{ orderId: string }, { shipmentId: string }>({
  functionId: "shipment",
  appId: "logistics",
});

const routing = {
  async invoke(request: { readonly data: unknown }) {
    const input = request.data as { readonly orderId: string };
    return { shipmentId: `remote:${input.orderId}` };
  },
};

const workflows = createFunctions<WorkflowApp, Orders>(
  {
    dependencies: {
      payments: {
        async authorize(orderId) {
          return { authorizationId: orderId };
        },
      },
      routing,
    },
  },
  ({ createFunction, dependencies }) => {
    const shipment = createFunction({ id: "shipment" }, async ({ event, step }) => {
      const result = await step.run(
        { id: "ship", name: "Create shipment" },
        async (orderId) => ({ shipmentId: `shipment:${orderId}` }),
        event.data.orderId,
      );
      return result;
    });

    createFunction({ id: "notify", triggers: { event: "order/notified" } }, async ({ step }) => {
      await step.run("deliver-notification", () => undefined);
    });

    createFunction(
      {
        id: "fulfill",
        triggers: { event: "order/placed" },
        concurrency: [{ limit: 10 }, { limit: 1, key: "event.data.orderId", scope: "fn" }],
        batchEvents: {
          maxSize: 25,
          timeout: "2h45m",
          key: "event.data.orderId",
          if: "event.data.total > 0",
        },
        idempotency: "event.data.orderId",
        rateLimit: { limit: 100, period: "1 minute", key: "event.data.orderId" },
        throttle: {
          limit: 10,
          period: "1 second",
          burst: 2,
          key: "event.data.orderId",
        },
        debounce: { period: "1 second", timeout: "10 seconds", key: "event.data.orderId" },
        priority: { run: "event.data.total > 1000 ? 100 : 0" },
        singleton: { key: "event.data.orderId", mode: "cancel" },
        timeouts: { start: "10 seconds", finish: "5 minutes" },
        cancelOn: [
          {
            event: "order/approved",
            if: "async.data.orderId == event.data.orderId",
          },
        ],
        retries: 2,
        onFailure: async ({ error, event, maxAttempts, step }) => {
          const orderId: string = event.data.event.data.orderId;
          const message: string = error.message;
          const attempts: number | undefined = maxAttempts;
          void attempts;
          await step.run("record-failure", async () => ({ orderId, message }));
        },
      },
      async ({ event, group, maxAttempts, step }) => {
        const attempts: number | undefined = maxAttempts;
        const eventVersion: string | undefined = event.v;
        const session: string | undefined = event.meta?.sessions?.account;
        void attempts;
        void eventVersion;
        void session;
        const experiment = await group.experiment("checkout", {
          select: Object.assign(() => "control", {
            __experimentConfig: { strategy: "fixed" },
          }),
          variants: {
            control: () => step.run("control-checkout", () => ({ id: "control" })),
            replacement: () => step.run("replacement-checkout", () => ({ id: "replacement" })),
          },
        });
        const selected: "control" | "replacement" = experiment.variant;
        const experimentId: string = experiment.result.id;
        void selected;
        void experimentId;
        const raced = await group.parallel(() =>
          Promise.race([
            step.run("quick", async () => 1),
            step.sleep("slow", "1 second").then(() => 2),
          ]),
        );
        const result: number = raced;
        void result;
        const payment = await step.run("authorize-payment", () =>
          dependencies.payments.authorize(event.data.orderId),
        );
        const approval = await step.waitForEvent("approval", {
          event: "order/approved",
          timeout: "1 minute",
          match: "data.orderId",
        });
        const signal = await step.waitForSignal<{ reviewerId: string }>("signal-approval", {
          signal: `order:${event.data.orderId}`,
          timeout: "1 minute",
          onConflict: "fail",
        });
        const signalReviewer: string | undefined = signal?.data.reviewerId;
        const signalled = await step.sendSignal("signal-next", {
          signal: `next:${event.data.orderId}`,
          data: { authorizationId: payment.authorizationId },
        });
        const signalledRun: string | undefined = signalled.runId;
        void signalReviewer;
        void signalledRun;
        // @ts-expect-error A wait condition has one correlation mechanism.
        await step.waitForEvent("ambiguous-approval", {
          event: "order/approved",
          timeout: "1 minute",
          match: "data.orderId",
          if: "event.data.orderId == async.data.orderId",
        });
        const shipped = await step.invoke("shipment", {
          function: shipmentReference,
          data: { orderId: payment.authorizationId },
        });
        const remoteShipment = await step.invoke("remote-shipment", {
          function: remoteShipmentReference,
          data: { orderId: payment.authorizationId },
        });
        const remoteShipmentId: string = remoteShipment.shipmentId;
        void remoteShipmentId;
        return {
          shipmentId: shipped.shipmentId,
          reviewerId: approval?.data.reviewerId,
        };
      },
    );

    createFunction(
      {
        id: "fulfill",
        // @ts-expect-error Environment-wide concurrency requires an explicit queue key.
        concurrency: { limit: 1, scope: "env" },
      },
      async () => ({ shipmentId: "unreachable" }),
    );

    createFunction(
      {
        id: "fulfill",
        // @ts-expect-error Trigger payloads must match the function input.
        triggers: { event: "order/approved" },
      },
      async () => ({ shipmentId: "unreachable" }),
    );

    createFunction({ id: "shipment" }, async ({ step }) => {
      await step.invoke("invalid-shipment", {
        function: shipment,
        // @ts-expect-error Invoked function input comes from its reference.
        data: { id: "wrong" },
      });
      return { shipmentId: "unreachable" };
    });

    createFunction(
      { id: "shipment" },
      // @ts-expect-error Function output is checked against the generic contract.
      async () => ({ shipmentId: 123 }),
    );

    createFunction(
      // @ts-expect-error Function ids are closed over the generic contract.
      { id: "missing" },
      async () => ({ shipmentId: "unreachable" }),
    );

    createFunction(
      {
        id: "fulfill",
        // @ts-expect-error Trigger names are closed over the generic contract.
        triggers: { event: "order/missing" },
      },
      async () => ({ shipmentId: "unreachable" }),
    );
  },
);

const app = {
  version: 1,
  resources: {},
  features: { workflows },
} satisfies AppDef<WorkflowApp>;

type UpstreamExampleEvents = {
  "demo/hello.world": Record<string, never>;
  "demo/sequential.reduce": Record<string, never>;
  "demo/parallel.reduce": Record<string, never>;
  "demo/parallel.work": Record<string, never>;
  "demo/promise.all": Record<string, never>;
  "demo/promise.race": Record<string, never>;
  "demo/send.event": Record<string, never>;
  "demo/handling.step.errors": Record<string, never>;
  "demo/unhandled.step.errors": Record<string, never>;
  "demo/multiple-triggers.1": Record<string, never>;
  "demo/multiple-triggers.2": Record<string, never>;
  "demo/step.invoke": Record<string, never>;
  "demo/step.invoke.not-found": Record<string, never>;
  "demo/polling": Record<string, never>;
  "demo/undefined.data": Record<string, never>;
  "run-payload-schema": { nested: { msg: string } };
  "wait-payload-schema": Record<string, never>;
  "wait-payload-schema/resolve": { nested: { msg: string } };
  "app/my.event.happened": { foo: string };
  "app/my.event.happened.multiple.1": { foo: string };
  "app/my.event.happened.multiple.2": { foo: string };
} & {
  [Name in `run-payload-wildcard-schema/${string}`]: { nested: { msg: string } };
};

type UpstreamExamples = {
  Events: UpstreamExampleEvents;
  Functions: {
    "hello-world": { Input: Record<string, never>; Output: string };
    "sequential-reduce": { Input: Record<string, never>; Output: number };
    "parallel-reduce": { Input: Record<string, never>; Output: number };
    "parallel-work": { Input: Record<string, never>; Output: [number, string] };
    "promise-all": { Input: Record<string, never>; Output: number };
    "promise-race": { Input: Record<string, never>; Output: void };
    "send-event": { Input: Record<string, never>; Output: void };
    "handling-step-errors": { Input: Record<string, never>; Output: void };
    "unhandled-step-errors": { Input: Record<string, never>; Output: void };
    "multiple-triggers": { Input: Record<string, never>; Output: string };
    "step-invoke": { Input: Record<string, never>; Output: { done: boolean } };
    "step-invoke-child": { Input: void; Output: { done: boolean } };
    "step-invoke-not-found": { Input: Record<string, never>; Output: void };
    polling: { Input: Record<string, never>; Output: void };
    "undefined-data": { Input: Record<string, never>; Output: void };
    "run-payload-schema": {
      Input: { nested: { msg: string } };
      Output: { nested: { msg: string } };
    };
    "run-payload-wildcard-schema": {
      Input: { nested: { msg: string } };
      Output: { nested: { msg: string } };
    };
    "wait-payload-schema": {
      Input: Record<string, never>;
      Output: { nested: { msg: string } } | void;
    };
  };
  Dependencies: {};
};

type UpstreamExamplesApp = {
  Actor: { id: string };
  Resources: {};
  Features: { examples: FunctionsFeature<UpstreamExamples> };
};

const scoresDb = { blue: 50, red: 25, green: 75 } as const;
const multipleTriggerEvents = ["demo/multiple-triggers.1", "demo/multiple-triggers.2"] as const;
const nestedMessageSchema = {
  "~standard": {
    validate(value: unknown) {
      return { value: value as { nested: { msg: string } } };
    },
  },
};

const upstreamExamples = createFunctions<UpstreamExamplesApp, UpstreamExamples>(
  { dependencies: {} },
  ({ createFunction }) => {
    const invokedWithoutData = createFunction({ id: "step-invoke-child" }, async ({ step }) => {
      await step.sleep("wait-a-moment", "1s");
      return { done: true };
    });
    createFunction({ id: "step-invoke", triggers: [{ event: "demo/step.invoke" }] }, ({ step }) =>
      step.invoke("child", { function: invokedWithoutData }),
    );
    createFunction(
      { id: "hello-world", triggers: [{ event: "demo/hello.world" }] },
      () => "Hello, Inngest!",
    );
    createFunction(
      { id: "sequential-reduce", triggers: [{ event: "demo/sequential.reduce" }] },
      async ({ step }) =>
        Object.keys(scoresDb).reduce(async (score, team) => {
          const currentScore = await score;
          const teamScore = await step.run(
            `Get ${team} team score`,
            () => scoresDb[team as keyof typeof scoresDb],
          );
          return currentScore + teamScore;
        }, Promise.resolve(0)),
    );
    createFunction(
      { id: "parallel-reduce", triggers: [{ event: "demo/parallel.reduce" }] },
      async ({ step }) =>
        Object.keys(scoresDb).reduce(async (score, team) => {
          const teamScore = await step.run(
            `Get ${team} team score`,
            () => scoresDb[team as keyof typeof scoresDb],
          );
          return (await score) + teamScore;
        }, Promise.resolve(0)),
    );
    createFunction(
      { id: "parallel-work", triggers: [{ event: "demo/parallel.work" }] },
      async ({ step }) => {
        const getScore = async () => {
          let score = await step.run("First score", () => 1);
          score += await step.run("Second score", () => 2);
          score += await step.run("Third score", () => 3);
          return score;
        };
        const getFruits = () =>
          Promise.all([
            step.run("Get apple", () => "Apple"),
            step.run("Get banana", () => "Banana"),
            step.run("Get orange", () => "Orange"),
          ]);
        return Promise.all([getScore(), getFruits().then((fruits) => fruits.join(", "))]);
      },
    );
    createFunction(
      { id: "promise-all", triggers: [{ event: "demo/promise.all" }] },
      async ({ step }) => {
        const [one, two] = await Promise.all([
          step.run("Step 1", () => 1),
          step.run("Step 2", () => 2),
        ]);
        return step.run("Step 3", () => one + two);
      },
    );
    createFunction(
      { id: "promise-race", triggers: [{ event: "demo/promise.race" }] },
      async ({ step }) => {
        const winner = await Promise.race([
          step.run("Step A", () => "A"),
          step.run("Step B", () => "B"),
        ]);
        await step.run("Step C", () => `${winner} is the winner!`);
      },
    );
    createFunction(
      { id: "send-event", triggers: [{ event: "demo/send.event" }] },
      async ({ step }) => {
        await Promise.all([
          step.sendEvent("single-event", {
            name: "app/my.event.happened",
            data: { foo: "bar" },
          }),
          step.sendEvent("multiple-events", [
            { name: "app/my.event.happened.multiple.1", data: { foo: "bar" } },
            { name: "app/my.event.happened.multiple.2", data: { foo: "bar" } },
          ]),
        ]);
      },
    );
    createFunction(
      {
        id: "handling-step-errors",
        retries: 1,
        triggers: [{ event: "demo/handling.step.errors" }],
      },
      async ({ step }) => {
        try {
          await step.run("a", () => {
            throw new Error("Oh no!");
          });
        } catch (error) {
          await step.run("b", () => `err was: ${(error as Error).message}`);
        }
      },
    );
    createFunction(
      {
        id: "unhandled-step-errors",
        retries: 1,
        triggers: [{ event: "demo/unhandled.step.errors" }],
      },
      async ({ step }) => {
        await step.run("a fails", () => {
          throw new Error("A failed!");
        });
        await step.run("b never runs", () => "b");
      },
    );
    createFunction(
      {
        id: "multiple-triggers",
        triggers: multipleTriggerEvents.map((event) => ({ event })),
      },
      ({ event }) => `Hello, ${event.name}!`,
    );
    createFunction({ id: "polling", triggers: [{ event: "demo/polling" }] }, async ({ step }) => {
      let interval = 0;
      const result = await step.run("Check if external job complete", () =>
        Math.random() > 0.5 ? { data: { foo: "bar" } } : null,
      );
      if (!result) await step.sleep(`interval-${interval++}`, "10s");
    });
    createFunction(
      {
        id: "run-payload-schema",
        triggers: [{ event: "run-payload-schema", schema: nestedMessageSchema }],
      },
      ({ event }) => event.data,
    );
    createFunction(
      {
        id: "run-payload-wildcard-schema",
        triggers: [{ event: "run-payload-wildcard-schema/*", schema: nestedMessageSchema }],
      },
      ({ event }) => event.data,
    );
    createFunction(
      {
        id: "step-invoke-not-found",
        triggers: [{ event: "demo/step.invoke.not-found" }],
      },
      async ({ step }) => {
        await step.invoke("invoke-non-existent-fn", {
          function: referenceFunction<void, void>({ functionId: "non-existant-fn" }),
        });
      },
    );
    createFunction(
      { id: "undefined-data", triggers: [{ event: "demo/undefined.data" }] },
      async ({ step }) => {
        await step.run("step1res", () => "step1res");
        await step.run("step1", () => undefined);
        await Promise.all([
          step.run("step2res", () => "step2res"),
          step.run("step2nores", () => undefined),
          step.run("step2res2", () => "step2res2"),
        ]);
        await step.run("step2", async () => undefined);
        await step.run("step3", async () => undefined);
      },
    );
    createFunction(
      { id: "wait-payload-schema", triggers: [{ event: "wait-payload-schema" }] },
      async ({ step }) => {
        const matched = await step.waitForEvent("wait", {
          event: "wait-payload-schema/resolve",
          timeout: "1m",
          schema: nestedMessageSchema,
        });
        return matched?.data;
      },
    );
  },
);

void upstreamExamples;

const direct = testFunctions(workflows, {
  dependencies: {
    payments: {
      async authorize(orderId) {
        return { authorizationId: orderId };
      },
    },
    routing,
  },
});
void direct.execute("fulfill", {
  events: [
    {
      id: "order-1",
      name: "order/placed",
      data: { orderId: "order-1", total: 100 },
      ts: 0,
      v: "v1",
      meta: { sessions: { account: "42" } },
    },
  ],
});
const directStep = direct.executeStep("fulfill", "authorize-payment", {
  events: [
    {
      id: "order-1",
      name: "order/placed",
      data: { orderId: "order-1", total: 100 },
      ts: 0,
    },
  ],
  steps: [
    { id: "quick", handler: () => 1 },
    { id: "slow", handler: () => undefined },
  ],
});
void directStep.then((output) => {
  const id: string = output.step.id;
  const kind:
    | "run"
    | "fetch"
    | "sleep"
    | "waitForEvent"
    | "waitForSignal"
    | "invoke"
    | "sendEvent"
    | "sendSignal" = output.step.kind;
  if ("result" in output) {
    const result: unknown = output.result;
    void result;
  } else {
    const error: unknown = output.error;
    void error;
  }
  void id;
  void kind;
});
const directRun = direct.start("fulfill", {
  events: [
    {
      id: "order-1",
      name: "order/placed",
      data: { orderId: "order-1", total: 100 },
      ts: 0,
    },
  ],
});
void directRun.waitFor("step-ran", { step: { id: "authorize-payment" } }).then((checkpoint) => {
  const type: "step-ran" = checkpoint.type;
  const id: string = checkpoint.step.id;
  void type;
  void id;
});
void directRun.waitFor("function-resolved").then((checkpoint) => {
  const type: "function-resolved" = checkpoint.type;
  const result: { shipmentId: string; reviewerId?: string } = checkpoint.data;
  void type;
  void result;
});
// @ts-expect-error Checkpoint names are closed over the test-run contract.
void directRun.waitFor("function-paused");
void directRun.waitFor("function-resolved", {
  // @ts-expect-error Resolved checkpoint subsets preserve the function output type.
  data: { shipmentId: 42 },
});
// @ts-expect-error Test runs use function names from the contract.
void direct.start("missing", { events: [] });
void direct.start("fulfill", {
  events: [
    // @ts-expect-error Test runs preserve exact event payloads.
    {
      id: "order-1",
      name: "order/placed",
      data: { orderId: "order-1" },
      ts: 0,
    },
  ],
});
// @ts-expect-error Direct step execution uses function names from the contract.
void direct.executeStep("missing", "work", { events: [] });
void direct.executeStep("fulfill", "authorize-payment", {
  events: [
    // @ts-expect-error Direct step execution keeps exact event payloads.
    {
      id: "order-1",
      name: "order/placed",
      data: { orderId: "order-1" },
      ts: 0,
    },
  ],
});
void direct.executeStep("fulfill", "authorize-payment", {
  events: [
    {
      id: "order-1",
      name: "order/placed",
      data: { orderId: "order-1", total: 100 },
      ts: 0,
    },
  ],
  steps: [
    {
      id: "quick",
      // @ts-expect-error Direct step mocks must return serializable values.
      handler: () => Symbol("not-json"),
    },
  ],
});
// @ts-expect-error Direct execution uses function names from the contract.
void direct.execute("missing", { events: [] });
void direct.execute("fulfill", {
  events: [
    // @ts-expect-error Direct execution keeps exact event payloads.
    {
      id: "order-1",
      name: "order/placed",
      data: { orderId: "order-1" },
      ts: 0,
    },
  ],
});

declare const api: WorkflowApp["Features"]["workflows"]["API"];
void api.send({
  id: "order-1",
  name: "order/placed",
  data: { orderId: "order-1", total: 100 },
});
void api.send({
  name: "order/approved",
  data: { orderId: "order-1", reviewerId: "reviewer-1" },
});

// @ts-expect-error Event names are closed over the contract.
void api.send({ name: "order/approval", data: {} });
// @ts-expect-error Event payloads are inferred independently.
void api.send({ name: "order/approved", data: { reason: "wrong payload" } });
// @ts-expect-error Function names are closed over the contract.
api.getFunction("missing", "order-1");

void app;
