export type RuntimeSchemaNode =
  | Readonly<{
      kind: "unknown" | "never" | "null" | "undefined" | "string" | "number" | "boolean";
    }>
  | Readonly<{ kind: "literal"; value: string | number | boolean | null }>
  | Readonly<{ kind: "array"; item: number }>
  | Readonly<{
      kind: "tuple";
      elements: readonly Readonly<{ schema: number; optional?: boolean; rest?: boolean }>[];
    }>
  | Readonly<{
      kind: "object";
      properties: readonly Readonly<{ name: string; schema: number; optional?: boolean }>[];
      index?: number;
    }>
  | Readonly<{ kind: "union" | "intersection"; members: readonly number[] }>;

export type RuntimeResourceContract = Readonly<{
  key: number;
  state: number;
  events: Readonly<Record<string, number>>;
  commands: Readonly<Record<string, number>>;
}>;

export type RuntimeAppContract = Readonly<{
  hash: string;
  nodes: readonly RuntimeSchemaNode[];
  resources: Readonly<Record<string, RuntimeResourceContract>>;
}>;

export type ManifestCommand = Readonly<{
  name: string;
  event?: string;
  hasInput: boolean;
  hasError: boolean;
}>;

export type ManifestResource = Readonly<{
  name: string;
  events: readonly string[];
  views: readonly string[];
  commands: readonly ManifestCommand[];
}>;

export type ManifestComponent = Readonly<{
  name: string;
  input: readonly string[];
  context: readonly string[];
  phases: readonly string[];
  output: boolean;
  state: readonly Readonly<{ name: string; kind?: string; writable?: boolean }>[];
  actions: readonly string[];
  parameters: readonly string[];
  tasks: readonly string[];
  slots: readonly string[];
  parts: Readonly<Record<string, string>>;
}>;

export type ManifestDependency = Readonly<{
  environment: string;
  members: readonly string[];
}>;

export type ManifestNavigation = Readonly<{
  name: string;
  parameters: readonly string[];
}>;

export type ManifestEndpoint = Readonly<{
  name: string;
  methods: readonly string[];
}>;

export type ManifestProgram = Readonly<{
  environment: string;
  name: string;
  kind: "events" | "service";
  events: readonly string[];
  replay: "all" | "new";
  version: number;
  key: "resource" | Readonly<{ version: number }>;
}>;

export type ManifestScope = Readonly<{
  /** Empty for the application; dotted for a nested Feature mount. */
  path: string;
  resources: readonly ManifestResource[];
  components: readonly ManifestComponent[];
  features: readonly string[];
  programs: readonly ManifestProgram[];
  dependencies: readonly ManifestDependency[];
  navigation: readonly ManifestNavigation[];
  endpoints: readonly ManifestEndpoint[];
  api: readonly string[];
}>;

export type ManifestPreset = Readonly<{
  name: string;
  tokens: readonly Readonly<{ group: string; name: string; kind: string }>[];
  themes: readonly string[];
  conditions: readonly Readonly<{ name: string; min?: string; max?: string }>[];
}>;

/** Canonical dependency-free meaning extracted from an application's generic contract. */
export type ApplicationManifest = Readonly<{
  format: 1;
  contract: RuntimeAppContract;
  scopes: readonly ManifestScope[];
  presets: readonly ManifestPreset[];
}>;

export function programIdentity(path: string, environment: string, name: string): string {
  const owner = path.length === 0 ? "application" : `feature/${path}`;
  return `${owner}/program/${environment}/${name}`;
}
