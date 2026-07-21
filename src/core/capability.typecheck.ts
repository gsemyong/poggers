import type { BrowserMainThread } from "@/adapters/web/platform";
import type { Program } from "@/core/application";
import type {
  ProgramCapabilities,
  ProgramExternalCapabilities,
  ProgramProvidedCapabilities,
  ProgramRequiredCapabilities,
} from "@/core/capability";

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

const required: ProgramRequiredCapabilities<App, "browser"> = {
  reader: { read: () => "value" },
  clock: { now: () => 0 },
};
const provided: ProgramProvidedCapabilities<App, "browser"> = {
  reader: { read: () => "value" },
};
const external: ProgramExternalCapabilities<App, "browser"> = {
  clock: { now: () => 0 },
};
void required;
void provided;
void external;

const complete = {
  development: () => ({ clock: { now: () => 0 } }),
  production: () => ({ clock: { now: () => Date.now() } }),
} satisfies ProgramCapabilities<App, "browser">;
void complete;

const missing = {
  // @ts-expect-error clock is required by the complete Application contract.
  development: () => ({}),
  production: () => ({ clock: { now: () => 0 } }),
} satisfies ProgramCapabilities<App, "browser">;
void missing;

const incompatible = {
  // @ts-expect-error a Capability implementation must preserve the semantic contract.
  development: () => ({ clock: { now: () => "later" } }),
  production: () => ({ clock: { now: () => 0 } }),
} satisfies ProgramCapabilities<App, "browser">;
void incompatible;

// @ts-expect-error unknown Programs cannot receive a Capability module.
const unknown: ProgramCapabilities<App, "worker"> = {};
void unknown;
