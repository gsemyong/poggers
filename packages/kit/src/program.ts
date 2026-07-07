import type { App, AppSpec, EnvironmentDeps, EnvironmentName } from "./infra/app";
import {
  startProgramRuntime,
  type AppProgram,
  type StartProgramRuntimeOpts,
  type WorkerRuntime,
} from "./infra/worker";

export type RunProgramOpts<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
> = StartProgramRuntimeOpts<Spec, Env>;

export function run<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  app: App<Spec>,
  opts: RunProgramOpts<Spec, Env>,
): WorkerRuntime<Spec> {
  const program = app.def.programs?.[opts.env] as AppProgram<Spec, Env> | undefined;
  if (!program) {
    throw new Error(`App has no program for environment "${String(opts.env)}".`);
  }
  return startProgramRuntime(app, program, opts);
}

export {
  startProgramRuntime,
  type AppProgram,
  type EnvironmentDeps,
  type EnvironmentName,
  type StartProgramRuntimeOpts,
  type WorkerRuntime,
};
