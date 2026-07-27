import { endBatch, signal as createSignal, startBatch } from "alien-signals";

import {
  ResourceScope,
  type ProgramContributionRuntime,
  type ProgramLanguageRuntime,
} from "@/execution/process";
import { createReactiveState } from "@/execution/state";
import type { ActionEvent } from "@/platforms/web/presentation/language";
import { createActionEventLedger } from "@/platforms/web/presentation/runtime";

export type WebActionContext = Readonly<{
  dependencies: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  state: Record<string, unknown>;
}>;

export type WebStartContext = Readonly<{
  dependencies: Readonly<Record<string, unknown>>;
  provides?: readonly string[];
  actions: Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}>;

export type WebProgramDefinition = Readonly<{
  state?: Readonly<Record<string, unknown>>;
  actions?: Readonly<
    Record<string, (context: WebActionContext, ...arguments_: readonly unknown[]) => unknown>
  >;
  start?: (context: WebStartContext) => unknown;
}>;

export type WebProgramContributionRuntime = ProgramContributionRuntime &
  Readonly<{
    actions: Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>;
    events: Readonly<Record<string, ActionEvent<(...arguments_: never[]) => unknown>>>;
    state: Readonly<Record<string, unknown>>;
    snapshot(): Record<string, unknown>;
  }>;

/** Creates the live interpreter for the web Platform's Program language. */
export function createWebProgramLanguageRuntime(
  options: Readonly<{ onActionEvent?: () => void }> = {},
): ProgramLanguageRuntime {
  return Object.freeze({
    instantiate(input): WebProgramContributionRuntime {
      const definition = input.definition as WebProgramDefinition;
      const name = `${input.address.program}:${input.address.feature}`;
      let disposed = false;
      const initialState = Object.fromEntries(
        Object.entries(definition.state ?? {}).map(([key, value]) => [
          key,
          Object.hasOwn(input.initialState ?? {}, key) ? input.initialState![key] : value,
        ]),
      );
      const state = createReactiveState(initialState, createSignal, () => !disposed);
      const actions: Record<string, (...arguments_: readonly unknown[]) => unknown> =
        Object.create(null);
      const eventLedger = createActionEventLedger(
        Object.keys(definition.actions ?? {}),
        options.onActionEvent,
      );

      for (const [actionName, implementation] of Object.entries(definition.actions ?? {})) {
        actions[actionName] = (...arguments_: readonly unknown[]) => {
          if (disposed) throw new Error(`Web contribution ${JSON.stringify(name)} is disposed.`);
          startBatch();
          try {
            return input.scope.action(() =>
              eventLedger.invoke(actionName, arguments_, () =>
                implementation(
                  {
                    dependencies: input.dependencies,
                    features: input.exposedFeatures,
                    state: state.mutable,
                  },
                  ...arguments_,
                ),
              ),
            );
          } finally {
            endBatch();
          }
        };
      }

      const exposed = Object.create(null) as Record<string, unknown>;
      for (const stateName of Object.keys(definition.state ?? {})) {
        if (stateName in actions) {
          throw new Error(
            `Web contribution ${JSON.stringify(name)} declares state and action ${JSON.stringify(stateName)}.`,
          );
        }
        Object.defineProperty(exposed, stateName, {
          enumerable: true,
          get: state.cells[stateName],
        });
      }
      Object.assign(exposed, actions);

      return {
        exposed,
        state: state.read,
        actions,
        events: eventLedger.events,
        snapshot: () => state.snapshot(),
        run: () =>
          definition.start?.({
            dependencies: input.dependencies,
            ...(input.provides.length ? { provides: input.provides } : {}),
            actions,
            features: input.exposedFeatures,
          }),
        async dispose() {
          disposed = true;
        },
      };
    },
  });
}

export const webProgramLanguageRuntime = createWebProgramLanguageRuntime();

export function webContributionRuntime(
  runtime: ProgramContributionRuntime,
): WebProgramContributionRuntime {
  return runtime as WebProgramContributionRuntime;
}

export type WebUIContributionInstance = Readonly<{
  api: Readonly<Record<string, unknown>>;
  state: Readonly<Record<string, unknown>>;
  actions: Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>;
  events: Readonly<Record<string, ActionEvent<(...arguments_: never[]) => unknown>>>;
  snapshot(): Record<string, unknown>;
  dispose(): Promise<void>;
}>;

/** Creates a standalone web UI contribution for SSR and focused Platform tests. */
export function createWebUIContributionInstance(
  definition: WebProgramDefinition,
  options: Readonly<{
    dependencies?: Readonly<Record<string, unknown>>;
    features?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    name?: string;
    initialState?: Readonly<Record<string, unknown>>;
    scope?: ResourceScope;
    onActionEvent?: () => void;
  }> = {},
): WebUIContributionInstance {
  const ownsScope = !options.scope;
  const scope = options.scope ?? new ResourceScope();
  const language = options.onActionEvent
    ? createWebProgramLanguageRuntime({ onActionEvent: options.onActionEvent })
    : webProgramLanguageRuntime;
  const runtime = webContributionRuntime(
    language.instantiate({
      address: { program: options.name ?? "web", feature: options.name ?? "ui" },
      definition,
      dependencies: options.dependencies ?? {},
      exposedFeatures: options.features ?? {},
      ...(options.initialState ? { initialState: options.initialState } : {}),
      provides: [],
      scope,
    }),
  );
  let disposed = false;
  return {
    api: runtime.exposed,
    state: runtime.state,
    actions: runtime.actions,
    events: runtime.events,
    snapshot: runtime.snapshot,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await runtime.dispose();
      if (ownsScope) await scope.dispose();
    },
  };
}
