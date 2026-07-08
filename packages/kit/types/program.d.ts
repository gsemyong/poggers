import type { App, AppSpec, EnvironmentDeps, EnvironmentName } from "./app";
import {
  startProgramRuntime,
  type AppProgram,
  type StartProgramRuntimeOpts,
  type WorkerRuntime,
} from "./worker";
export type RunProgramOpts<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
> = StartProgramRuntimeOpts<Spec, Env>;
export declare function run<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  app: App<Spec>,
  opts: RunProgramOpts<Spec, Env>,
): WorkerRuntime<Spec>;
export {
  startProgramRuntime,
  type AppProgram,
  type EnvironmentDeps,
  type EnvironmentName,
  type StartProgramRuntimeOpts,
  type WorkerRuntime,
};
