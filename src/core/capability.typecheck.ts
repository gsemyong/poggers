import type { BrowserMainThread } from "@/adapters/web/platform";
import type { Program } from "@/core/application";
import type {
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

const unexpectedExternal: ProgramExternalCapabilities<App, "browser"> = {
  clock: { now: () => 0 },
  // @ts-expect-error externally supplied Capabilities exclude Feature-provided reader.
  reader: { read: () => "value" },
};
void unexpectedExternal;

// @ts-expect-error clock is required by the complete Application contract.
const missingExternal: ProgramExternalCapabilities<App, "browser"> = {};
void missingExternal;
