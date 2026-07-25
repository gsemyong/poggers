/** Adapter-owned runtime configuration required by one production artifact. */
export type ProductionConfiguration = Readonly<{
  dependency: string;
  implementation: string;
  name: string;
  binding: Readonly<{ kind: "environment"; name: string }>;
  required: boolean;
  default?: string;
  sensitive?: true;
  allocation?:
    | Readonly<{ kind: "port" }>
    | Readonly<{
        kind: "storage";
        name: string;
        scope: "deployment" | "process";
        type: "directory" | "file";
      }>;
  source?:
    | Readonly<{ kind: "process-location" }>
    | Readonly<{
        kind: "assets";
        platform?: string;
        format: "single" | "interfaces";
      }>;
}>;

export type ProductionLifecycle = Readonly<{
  shutdown?: Readonly<{ kind: "signal"; signal: "SIGINT" | "SIGTERM" }>;
  status?: Readonly<{ kind: "file"; environment: string }>;
}>;

export type ProductionTarget = Readonly<{
  operatingSystem: string;
  architecture: string;
}>;
