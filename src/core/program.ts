import type { ComponentContract } from "@/core/ui/component";
import type { UIContract, UIDefinition, UIElementName } from "@/core/ui/language";

type Empty = Record<never, never>;
export type ActionRecord = Record<string, (...args: never[]) => unknown>;
type UIKey = "State" | "Actions" | "Components";

/** Adapter-owned projection from one Program contract to its authoring fields. */
export interface ProgramDefinitionKind {
  readonly Owner: unknown;
  readonly ProgramName: PropertyKey;
  readonly Root: unknown;
  readonly Contract: unknown;
  readonly Definition: object;
}

/** Adapter-owned projection from an Application contract to one interface definition. */
export interface ApplicationInterfaceKind {
  readonly Owner: unknown;
  readonly Definition: object;
}

/** One technical realization family. Every Platform supports Processes; UI is optional. */
export type PlatformContract = Readonly<{
  Name: string;
  UI?: UIContract;
  Program?: ProgramDefinitionKind;
  Application?: ApplicationInterfaceKind;
}>;

/**
 * One authored execution context realized by exactly one Platform.
 */
export type EnvironmentContract = Readonly<{
  Name: string;
  Platform: PlatformContract;
}>;

export type ProgramContract = {
  Environment: EnvironmentContract;
  Requires?: object;
  Provides?: object;
  State?: object;
  Actions?: ActionRecord;
  Components?: Record<string, ComponentContract>;
};

export type ProgramState<Contract> = Contract extends { State: infer Value extends object }
  ? Value
  : Empty;
export type ProgramActions<Contract> = Contract extends {
  Actions: infer Value extends ActionRecord;
}
  ? Value
  : Empty;
export type ProgramComponents<Contract> = Contract extends {
  Components: infer Value extends Record<string, ComponentContract>;
}
  ? Value
  : Empty;
export type ProgramRequires<Contract> = Contract extends { Requires: infer Value extends object }
  ? Readonly<Value>
  : Empty;
export type ProgramProvides<Contract> = Contract extends { Provides: infer Value extends object }
  ? Readonly<Value>
  : Empty;
export type HasProgramUI<Contract> = [Extract<keyof Contract, UIKey>] extends [never]
  ? false
  : true;

type ComponentPrimitiveNames<Contract> = [keyof ProgramComponents<Contract>] extends [never]
  ? never
  : ProgramComponents<Contract>[keyof ProgramComponents<Contract>] extends {
        Elements: infer Elements extends Record<string, string>;
      }
    ? Elements[keyof Elements]
    : never;

type SupportsComponents<
  Environment extends EnvironmentContract,
  Contract,
> = Environment["Platform"] extends {
  UI: infer UI extends UIContract;
}
  ? UI extends UIDefinition<UI>
    ? [ComponentPrimitiveNames<Contract>] extends [never]
      ? true
      : Exclude<ComponentPrimitiveNames<Contract>, UIElementName<UI>> extends never
        ? true
        : false
    : false
  : false;

/** @internal Validates that one Program uses only primitives owned by its Platform. */
export type ValidProgramContract<Contract extends ProgramContract> =
  HasProgramUI<Contract> extends true
    ? Contract["Environment"]["Platform"] extends { UI: UIContract }
      ? SupportsComponents<Contract["Environment"], Contract> extends true
        ? true
        : false
      : false
    : true;
