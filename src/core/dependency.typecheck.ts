import type {
  ProgramExternalDependencies,
  ProgramProvidedDependencies,
  ProgramRequiredDependencies,
} from "@/core/dependency";
import type { Program } from "@/core/program";
import type { BrowserMainThread } from "@/platforms/web/platform";

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
