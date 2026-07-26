import type {
  Dependency,
  DependencyImplementation,
  DependencyImplementations,
  ProgramExternalDependencies,
  ProgramProvidedDependencies,
  ProgramRequiredDependencies,
} from "@/core/dependency";
import type { Feature } from "@/core/feature";
import type { Program } from "@/core/program";
import type { BrowserMainThread } from "@/platforms/web";

type Reader = Readonly<{ read(): string }>;
type Clock = Readonly<{ now(): number }>;

type Provider = Readonly<{
  Programs: { browser: Program<BrowserMainThread, { Provides: { reader: Reader } }> };
}>;

type Consumer = Readonly<{
  Programs: {
    browser: Program<BrowserMainThread, { Requires: { reader: Reader; clock: Clock } }>;
  };
}>;

type App = Readonly<{ Features: { provider: Provider; consumer: Consumer } }>;

const required: ProgramRequiredDependencies<App, "browser"> = {
  reader: { read: () => "value" },
  clock: { now: () => 0 },
};
const provided: ProgramProvidedDependencies<App, "browser"> = {
  reader: { read: () => "value" },
};
const external: ProgramExternalDependencies<App, "browser"> = {
  clock: { now: () => 0 },
};
void required;
void provided;
void external;

const unexpectedExternal: ProgramExternalDependencies<App, "browser"> = {
  clock: { now: () => 0 },
  // @ts-expect-error externally supplied Dependencies exclude Feature-provided reader.
  reader: { read: () => "value" },
};
void unexpectedExternal;

// @ts-expect-error clock is required by the complete System contract.
const missingExternal: ProgramExternalDependencies<App, "browser"> = {};
void missingExternal;

type MailDefinition = Readonly<{
  Operations: {
    send(input: { to: string; body: string }): Promise<{ messageId: string }>;
  };
  Failures: {
    unavailable: { retryAt: number };
  };
  Heartbeats: {
    send: { accepted: boolean };
  };
}>;
type Mail = Dependency<MailDefinition>;

const mail: DependencyImplementation<Mail> = {
  async send({ input, invocation }) {
    const accepted = invocation.previousHeartbeat?.accepted ?? false;
    invocation.heartbeat({ details: { accepted: true } });
    void invocation.cancellation.requested();
    if (!input.to) {
      invocation.fail({
        type: "unavailable",
        data: { retryAt: invocation.startedAt + 1_000 },
        retry: { delay: 500 },
      });
    }
    const suffix = `${invocation.id}:${invocation.attempt}`;
    return { messageId: `${input.to}:${suffix}:${accepted}` };
  },
};
void mail;

const invalidFailure: DependencyImplementation<Mail> = {
  async send({ invocation }) {
    return invocation.fail({
      type: "unavailable",
      // @ts-expect-error Failure data comes from the semantic Dependency definition.
      data: { retryAfter: 1_000 },
    });
  },
};
void invalidFailure;

const invalidRetry: DependencyImplementation<Mail> = {
  async send({ invocation }) {
    return invocation.fail({
      type: "unavailable",
      data: { retryAt: 1_000 },
      retry: {
        // @ts-expect-error Retry delay is a portable millisecond duration.
        delay: "soon",
      },
    });
  },
};
void invalidRetry;

const invalidHeartbeat: DependencyImplementation<Mail> = {
  async send({ invocation }) {
    invocation.heartbeat({
      // @ts-expect-error Heartbeat details come from the operation's semantic definition.
      details: { delivered: true },
    });
    return { messageId: invocation.id };
  },
};
void invalidHeartbeat;

const implementations: DependencyImplementations<{ mail: Mail; clock: Clock }> = {
  mail,
  clock: { now: () => 0 },
};
void implementations;

const invalidMail: DependencyImplementation<Mail> = {
  // @ts-expect-error Dependency operation input comes from the semantic consumer API.
  async send({ input }: { input: { recipient: string } }) {
    return { messageId: input.recipient };
  },
};
void invalidMail;

type MailFeature = {
  Programs: {
    browser: Program<BrowserMainThread, { Provides: { mail: Mail } }>;
  };
};

const mailFeature = {
  programs: {
    browser: {
      start() {
        return {
          mail: {
            async send({ input, invocation }) {
              return { messageId: `${input.to}:${invocation.id}` };
            },
          },
        };
      },
    },
  },
} satisfies Feature<MailFeature>;
void mailFeature;

const invalidMailFeature = {
  programs: {
    browser: {
      // @ts-expect-error Feature providers implement the envelope, not the consumer call.
      start() {
        return {
          mail: {
            async send(input: { to: string; body: string }) {
              return { messageId: input.to };
            },
          },
        };
      },
    },
  },
} satisfies Feature<MailFeature>;
void invalidMailFeature;
