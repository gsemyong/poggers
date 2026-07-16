import { programIdentity, type ApplicationManifest, type ManifestProgram } from "#kernel/manifest";

const internalPrefix = "@feature/";

export type FeatureManifestEntry = {
  readonly path: string;
  readonly resources: readonly string[];
  readonly components: readonly string[];
  readonly programs: readonly string[];
  readonly endpoints: readonly string[];
  readonly migrations: readonly string[];
  readonly navigation: readonly string[];
};

export type FeatureManifest = {
  readonly entries: readonly FeatureManifestEntry[];
};

type RuntimeFeatureDefinition = {
  readonly resources?: Record<string, unknown>;
  readonly components?: Record<string, unknown>;
  readonly programs?: Record<string, unknown>;
  readonly dependencies?: Record<string, Record<string, unknown>>;
  readonly endpoints?: Record<string, unknown>;
  readonly migrations?: Record<string, unknown>;
  readonly navigation?: Record<string, string>;
  readonly features?: Record<string, RuntimeFeatureDefinition>;
  readonly api?: (context: {
    readonly resources: Readonly<Record<string, unknown>>;
    readonly features: Readonly<Record<string, Record<string, unknown>>>;
    readonly actor: unknown;
  }) => Record<string, unknown>;
  readonly authentication?: unknown;
};

export type FeatureProgramContribution = {
  readonly owner: string;
  readonly environment: string;
  readonly name: string;
  readonly resources: readonly string[];
  readonly definition: unknown;
};

export type RuntimeProgramManifestEntry = ManifestProgram &
  Readonly<{
    id: string;
    path: string;
  }>;

type FeatureProgramCleanup = () => void | Promise<void>;

export type FeatureContribution = {
  readonly owner: string;
  readonly name: string;
  readonly value: unknown;
};

export type EndpointTableEntry = {
  readonly owner: string;
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly handle: (request: Request, context: unknown) => Response | Promise<Response>;
};

export type FeatureResourceResolver = (path: string, name: string) => unknown;

export type InstantiatedFeatureAPIs = {
  readonly api: Readonly<Record<string, unknown>>;
  readonly features: Readonly<Record<string, InstantiatedFeatureAPIs>>;
};

export type ComposedFeatures = {
  readonly resources: Record<string, unknown>;
  readonly components: Record<string, unknown>;
  readonly programs: readonly FeatureProgramContribution[];
  readonly endpoints: readonly FeatureContribution[];
  readonly migrations: readonly FeatureContribution[];
  readonly dependencies: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >;
  readonly authentication?: FeatureContribution;
  readonly manifest: FeatureManifest;
};

function sortedKeys(value: Record<string, unknown> | undefined): string[] {
  return value ? Object.keys(value).sort() : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertProgramDefinition(value: unknown, owner: string): void {
  if (typeof value === "function") return;
  if (!value || typeof value !== "object") {
    throw new Error(`Program ${owner} must be a service function or durable event definition.`);
  }
  const definition = value as {
    readonly source?: {
      readonly events?: unknown;
      readonly replay?: unknown;
      readonly version?: unknown;
      readonly keyBy?: unknown;
      readonly keyVersion?: unknown;
    };
    readonly handle?: unknown;
  };
  if (
    !definition.source ||
    !Array.isArray(definition.source.events) ||
    definition.source.events.length === 0 ||
    (definition.source.replay !== "all" && definition.source.replay !== "new") ||
    !Number.isSafeInteger(definition.source.version) ||
    Number(definition.source.version) <= 0 ||
    (typeof definition.source.keyBy === "function" &&
      (!Number.isSafeInteger(definition.source.keyVersion) ||
        Number(definition.source.keyVersion) <= 0)) ||
    typeof definition.handle !== "function"
  ) {
    throw new Error(`Program ${owner} has an invalid durable event definition.`);
  }
}

function validateSegment(segment: string, owner: string): void {
  if (segment.length === 0 || segment.includes(".") || segment.includes("/")) {
    throw new Error(
      `Invalid Feature name ${JSON.stringify(segment)} at ${owner}. Names cannot be empty or contain '.' or '/'.`,
    );
  }
}

function internalName(path: string, kind: "resource" | "component", name: string): string {
  return `${internalPrefix}${path}/${kind}/${name}`;
}

export function composeFeatures(
  features: Record<string, RuntimeFeatureDefinition> | undefined,
  occupiedResources: ReadonlySet<string> = new Set(),
  occupiedComponents: ReadonlySet<string> = new Set(),
): ComposedFeatures {
  const resources: Record<string, unknown> = {};
  const components: Record<string, unknown> = {};
  const programs: FeatureProgramContribution[] = [];
  const endpoints: FeatureContribution[] = [];
  const migrations: FeatureContribution[] = [];
  const dependencies: Record<string, Record<string, Readonly<Record<string, unknown>>>> = {};
  let authentication: FeatureContribution | undefined;
  const entries: FeatureManifestEntry[] = [];

  const visit = (children: Record<string, RuntimeFeatureDefinition>, parent: string): void => {
    for (const name of sortedKeys(children)) {
      validateSegment(name, parent || "application root");
      const definition = children[name];
      if (!definition) continue;
      const path = parent ? `${parent}.${name}` : name;
      const resourceNames = sortedKeys(definition.resources);
      const componentNames = sortedKeys(definition.components);
      const programEnvironments = sortedKeys(definition.programs);
      const programNames = programEnvironments.flatMap((environment) => {
        const group = definition.programs?.[environment];
        return sortedKeys(isRecord(group) ? group : undefined).map(
          (name) => `${environment}.${name}`,
        );
      });
      const endpointNames = sortedKeys(definition.endpoints);
      const migrationNames = sortedKeys(definition.migrations);
      const navigationNames = sortedKeys(definition.navigation);

      if (definition.authentication !== undefined) {
        if (authentication) {
          throw new Error(
            `Authentication conflict between Feature ${authentication.owner} and Feature ${path}.`,
          );
        }
        authentication = {
          owner: path,
          name: "authentication",
          value: definition.authentication,
        };
      }

      for (const environment of sortedKeys(definition.dependencies)) {
        const implementations = definition.dependencies?.[environment];
        if (!implementations || typeof implementations !== "object") {
          throw new Error(
            `Feature dependencies ${path}.dependencies.${environment} must be an object.`,
          );
        }
        (dependencies[environment] ??= {})[path] = Object.freeze({ ...implementations });
      }

      for (const environment of programEnvironments) {
        const group = definition.programs?.[environment];
        if (!isRecord(group)) {
          throw new Error(`Feature programs ${path}.programs.${environment} must be an object.`);
        }
        for (const name of sortedKeys(group)) {
          const program = group[name];
          assertProgramDefinition(program, `${path}.programs.${environment}.${name}`);
          programs.push({
            owner: path,
            environment,
            name,
            resources: resourceNames,
            definition: program,
          });
        }
      }

      for (const endpoint of endpointNames) {
        endpoints.push({
          owner: path,
          name: endpoint,
          value: definition.endpoints?.[endpoint],
        });
      }

      for (const migration of migrationNames) {
        migrations.push({
          owner: path,
          name: migration,
          value: definition.migrations?.[migration],
        });
      }

      for (const resource of resourceNames) {
        validateSegment(resource, `${path}.resources`);
        const key = internalName(path, "resource", resource);
        if (occupiedResources.has(key) || key in resources) {
          throw new Error(`Duplicate Feature resource ${key}.`);
        }
        resources[key] = definition.resources?.[resource];
      }

      for (const component of componentNames) {
        validateSegment(component, `${path}.components`);
        const key = internalName(path, "component", component);
        if (occupiedComponents.has(key) || key in components) {
          throw new Error(`Duplicate Feature component ${key}.`);
        }
        components[key] = definition.components?.[component];
      }

      entries.push({
        path,
        resources: resourceNames,
        components: componentNames,
        programs: programNames,
        endpoints: endpointNames,
        migrations: migrationNames,
        navigation: navigationNames,
      });

      if (definition.features) visit(definition.features, path);
    }
  };

  if (features) visit(features, "");
  entries.sort((left, right) => left.path.localeCompare(right.path));
  programs.sort((left, right) =>
    `${left.environment}:${left.owner}:${left.name}`.localeCompare(
      `${right.environment}:${right.owner}:${right.name}`,
    ),
  );
  endpoints.sort((left, right) =>
    `${left.owner}:${left.name}`.localeCompare(`${right.owner}:${right.name}`),
  );
  migrations.sort((left, right) =>
    `${left.owner}:${left.name}`.localeCompare(`${right.owner}:${right.name}`),
  );
  return {
    resources,
    components,
    programs,
    endpoints,
    migrations,
    dependencies: Object.freeze(
      Object.fromEntries(
        Object.entries(dependencies).map(([environment, groups]) => [
          environment,
          Object.freeze(groups),
        ]),
      ),
    ),
    authentication,
    manifest: { entries },
  };
}

export function featureResourceName(path: string, name: string): string {
  return internalName(path, "resource", name);
}

export function featureComponentName(path: string, name: string): string {
  return internalName(path, "component", name);
}

export function compileEndpointTable(
  root: Readonly<Record<string, unknown>> | undefined,
  contributions: readonly FeatureContribution[],
): Readonly<Record<string, EndpointTableEntry>> {
  const all: FeatureContribution[] = [
    ...Object.entries(root ?? {}).map(([name, value]) => ({ owner: "application", name, value })),
    ...contributions,
  ];
  const table: Record<string, EndpointTableEntry> = {};
  for (const contribution of all) {
    const definition = contribution.value;
    if (!definition || typeof definition !== "object") {
      throw new Error(`Endpoint ${contribution.owner}.${contribution.name} must be an object.`);
    }
    const { method, path, handle } = definition as Record<string, unknown>;
    if (typeof method !== "string" || typeof path !== "string" || typeof handle !== "function") {
      throw new Error(
        `Endpoint ${contribution.owner}.${contribution.name} requires method, path, and handle.`,
      );
    }
    if (!path.startsWith("/")) {
      throw new Error(
        `Endpoint ${contribution.owner}.${contribution.name} path must start with '/'.`,
      );
    }
    const key = `${method.toUpperCase()} ${path}`;
    const previous = table[key];
    if (previous) {
      throw new Error(
        `Endpoint conflict for ${key}: ${previous.owner}.${previous.name} and ${contribution.owner}.${contribution.name}.`,
      );
    }
    table[key] = {
      owner: contribution.owner,
      name: contribution.name,
      method: method.toUpperCase(),
      path,
      handle: handle as EndpointTableEntry["handle"],
    };
  }
  return Object.freeze(table);
}

function localProgramContext(
  contribution: FeatureProgramContribution,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const local: Record<string, unknown> = {
    actor: context.actor,
    signal: context.signal,
    api: context.api,
  };
  const availableResources = context.resources as Readonly<Record<string, unknown>> | undefined;
  const resources: Record<string, unknown> = {};
  for (const resource of contribution.resources) {
    const internalName = featureResourceName(contribution.owner, resource);
    const factory = availableResources?.[internalName];
    if (typeof factory !== "function") {
      throw new Error(
        `Missing Program Resource ${internalName} for Feature ${contribution.owner}.`,
      );
    }
    resources[resource] = factory;
  }
  local.resources = Object.freeze(resources);
  const consume = context.consume;
  if (typeof consume === "function") {
    local.consume = (options: {
      readonly id: string;
      readonly events: readonly string[];
      readonly startAt: "origin" | "now";
      readonly signal?: AbortSignal;
      readonly concurrency?: number;
      readonly partitionBy?: (input: { readonly event: Record<string, unknown> }) => unknown;
      readonly partitionRevision?: number;
      readonly run: (item: Record<string, unknown>) => void | Promise<void>;
    }) => {
      const events = options.events.map((eventName) => {
        const dot = eventName.indexOf(".");
        if (dot <= 0) throw new Error(`Invalid Feature event ${JSON.stringify(eventName)}.`);
        const resource = eventName.slice(0, dot);
        const event = eventName.slice(dot + 1);
        if (!contribution.resources.includes(resource)) {
          throw new Error(
            `Feature ${contribution.owner} cannot subscribe to undeclared resource ${resource}.`,
          );
        }
        return `${featureResourceName(contribution.owner, resource)}.${event}`;
      });
      return consume({
        ...options,
        id: options.id,
        events,
        partitionBy: options.partitionBy
          ? ({ event }: { event: Record<string, unknown> }) => {
              const resource = localFeatureResource(contribution, String(event.resource));
              return options.partitionBy?.({ event: { ...event, resource } });
            }
          : undefined,
        run: (item: Record<string, unknown>) => {
          const internalResource = String(item.resource);
          const resource = localFeatureResource(contribution, internalResource);
          const event = item.event as Record<string, unknown>;
          return options.run({
            ...item,
            event: { ...event, resource },
            resource,
            [resource]: item[internalResource],
          });
        },
      });
    };
  }
  return local;
}

function localFeatureResource(
  contribution: FeatureProgramContribution,
  internalResource: string,
): string {
  const resource = contribution.resources.find(
    (name) => featureResourceName(contribution.owner, name) === internalResource,
  );
  if (!resource) {
    throw new Error(
      `Feature ${contribution.owner} received undeclared resource ${internalResource}.`,
    );
  }
  return resource;
}

export function composeFeaturePrograms(
  root: Readonly<Record<string, unknown>> | undefined,
  contributions: readonly FeatureProgramContribution[],
): Readonly<
  Record<
    string,
    (
      context: Record<string, unknown>,
      dependencies: unknown,
    ) => Promise<void | FeatureProgramCleanup>
  >
> {
  const environments = new Set<string>([
    ...Object.keys(root ?? {}),
    ...contributions.map((contribution) => contribution.environment),
  ]);
  const programs: Record<
    string,
    (
      context: Record<string, unknown>,
      dependencies: unknown,
    ) => Promise<void | FeatureProgramCleanup>
  > = {};
  for (const environment of [...environments].sort()) {
    const rootGroup = root?.[environment];
    const featurePrograms = contributions.filter(
      (contribution) => contribution.environment === environment,
    );
    programs[environment] = async (context, dependencies) => {
      const controller = new AbortController();
      const parentSignal = context.signal;
      const signal =
        parentSignal instanceof AbortSignal
          ? AbortSignal.any([parentSignal, controller.signal])
          : controller.signal;
      const programContext = { ...context, signal };
      const tasks: Promise<void | FeatureProgramCleanup>[] = [];
      const groups =
        dependencies && typeof dependencies === "object"
          ? (dependencies as Readonly<Record<string, unknown>>)
          : {};
      const rootPrograms = isRecord(rootGroup) ? rootGroup : {};
      for (const name of sortedKeys(rootPrograms)) {
        const definition = rootPrograms[name];
        assertProgramDefinition(definition, `application.programs.${environment}.${name}`);
        tasks.push(
          runProgramDefinition(
            definition,
            programIdentity("", environment, name),
            programContext,
            "application" in groups ? groups.application : dependencies,
          ),
        );
      }
      for (const contribution of featurePrograms) {
        tasks.push(
          runProgramDefinition(
            contribution.definition,
            programIdentity(contribution.owner, environment, contribution.name),
            localProgramContext(contribution, programContext),
            groups[contribution.owner] ?? Object.freeze({}),
          ),
        );
      }
      let results: readonly (void | FeatureProgramCleanup)[];
      try {
        results = await Promise.all(tasks);
      } catch (error) {
        controller.abort(error);
        const settled = await Promise.allSettled(tasks);
        const errors = [error];
        const cleanups: FeatureProgramCleanup[] = [];
        for (const result of settled) {
          if (result.status === "fulfilled") {
            if (typeof result.value === "function") cleanups.push(result.value);
          } else if (!errors.includes(result.reason)) {
            errors.push(result.reason);
          }
        }
        errors.push(...(await collectProgramCleanupErrors(cleanups)));
        if (errors.length === 1) throw error;
        throw new AggregateError(errors, "Program initialization and cleanup failed.");
      }
      const cleanups = results.filter(
        (result): result is FeatureProgramCleanup => typeof result === "function",
      );
      if (cleanups.length === 0) return;
      return async () => {
        const errors = await collectProgramCleanupErrors(cleanups);
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "Program cleanup failed.");
      };
    };
  }
  return programs;
}

export function collectRuntimeProgramManifest(
  root: Readonly<Record<string, unknown>> | undefined,
  contributions: readonly FeatureProgramContribution[],
): readonly RuntimeProgramManifestEntry[] {
  const entries: RuntimeProgramManifestEntry[] = [];
  for (const environment of sortedKeys(root)) {
    const group = root?.[environment];
    if (!isRecord(group)) {
      throw new Error(`Application programs ${environment} must be an object.`);
    }
    for (const name of sortedKeys(group)) {
      entries.push(runtimeProgramEntry("", environment, name, group[name]));
    }
  }
  for (const contribution of contributions) {
    entries.push(
      runtimeProgramEntry(
        contribution.owner,
        contribution.environment,
        contribution.name,
        contribution.definition,
      ),
    );
  }
  return Object.freeze(entries.sort((left, right) => left.id.localeCompare(right.id)));
}

export function assertRuntimeProgramManifest(
  runtime: readonly RuntimeProgramManifestEntry[],
  extracted: ApplicationManifest,
): void {
  const actual = runtime.map(canonicalProgramManifestEntry);
  const expected = extracted.scopes
    .flatMap((scope) =>
      scope.programs.map((program) =>
        canonicalProgramManifestEntry({
          ...program,
          id: programIdentity(scope.path, program.environment, program.name),
          path: scope.path,
        }),
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "The runtime Program definitions disagree with the extracted application manifest.",
    );
  }
}

function canonicalProgramManifestEntry(
  entry: RuntimeProgramManifestEntry,
): RuntimeProgramManifestEntry {
  return {
    id: entry.id,
    path: entry.path,
    environment: entry.environment,
    name: entry.name,
    kind: entry.kind,
    events: [...entry.events],
    replay: entry.replay,
    version: entry.version,
    key: entry.key === "resource" ? "resource" : { version: entry.key.version },
  };
}

function runtimeProgramEntry(
  path: string,
  environment: string,
  name: string,
  value: unknown,
): RuntimeProgramManifestEntry {
  assertProgramDefinition(value, `${path || "application"}.programs.${environment}.${name}`);
  if (typeof value === "function") {
    return {
      id: programIdentity(path, environment, name),
      path,
      environment,
      name,
      kind: "service",
      events: [],
      replay: "all",
      version: 1,
      key: "resource",
    };
  }
  const definition = value as RuntimeEventProgramDefinition;
  const custom = typeof definition.source.keyBy === "function";
  return {
    id: programIdentity(path, environment, name),
    path,
    environment,
    name,
    kind: "events",
    events: Object.freeze([...definition.source.events]),
    replay: definition.source.replay,
    version: definition.source.version,
    key: custom ? { version: definition.source.keyVersion! } : "resource",
  };
}

type RuntimeEventProgramDefinition = Readonly<{
  source: Readonly<{
    events: readonly string[];
    replay: "all" | "new";
    version: number;
    keyBy?: "resource" | ((input: { readonly event: Record<string, unknown> }) => unknown);
    keyVersion?: number;
  }>;
  handle: (context: Record<string, unknown>, dependencies: unknown) => void | Promise<void>;
}>;

type RuntimeConsume = (options: {
  readonly id: string;
  readonly events: readonly string[];
  readonly startAt: "origin" | "now";
  readonly version: number;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly partitionBy?: (input: { readonly event: Record<string, unknown> }) => unknown;
  readonly partitionRevision?: number;
  readonly run: (item: Record<string, unknown>) => void | Promise<void>;
}) => Promise<{ close(): void }>;

function runProgramDefinition(
  definition: unknown,
  id: string,
  context: Record<string, unknown>,
  dependencies: unknown,
): Promise<void | FeatureProgramCleanup> {
  const publicContext = withoutConsume(context);
  if (typeof definition === "function") {
    return Promise.resolve().then(() => definition(publicContext, dependencies));
  }
  const eventProgram = definition as RuntimeEventProgramDefinition;
  const consume = context.consume as RuntimeConsume | undefined;
  if (!consume) throw new Error(`Durable Program ${JSON.stringify(id)} has no event source.`);
  const customKey =
    typeof eventProgram.source.keyBy === "function" ? eventProgram.source.keyBy : undefined;
  return consume({
    id,
    events: eventProgram.source.events,
    startAt: eventProgram.source.replay === "all" ? "origin" : "now",
    version: eventProgram.source.version,
    signal: context.signal instanceof AbortSignal ? context.signal : undefined,
    concurrency: 256,
    partitionBy: customKey,
    partitionRevision: customKey ? eventProgram.source.keyVersion : undefined,
    run: (item) => eventProgram.handle(Object.freeze({ ...publicContext, ...item }), dependencies),
  }).then((subscription) => () => subscription.close());
}

function withoutConsume(context: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const copy = { ...context };
  delete copy.consume;
  return Object.freeze(copy);
}

async function collectProgramCleanupErrors(
  cleanups: readonly FeatureProgramCleanup[],
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    try {
      await cleanups[index]!();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

export function instantiateFeatureAPIs(options: {
  readonly features?: Record<string, RuntimeFeatureDefinition>;
  readonly api?: RuntimeFeatureDefinition["api"];
  readonly resources?: Record<string, unknown>;
  readonly actor: unknown;
  readonly resolveResource: FeatureResourceResolver;
}): InstantiatedFeatureAPIs {
  const instantiate = (
    definition: RuntimeFeatureDefinition,
    path: string,
  ): InstantiatedFeatureAPIs => {
    const features: Record<string, InstantiatedFeatureAPIs> = {};
    for (const name of sortedKeys(definition.features)) {
      const child = definition.features?.[name];
      if (child) features[name] = instantiate(child, path ? `${path}.${name}` : name);
    }

    const resources: Record<string, unknown> = {};
    for (const name of sortedKeys(definition.resources)) {
      resources[name] = options.resolveResource(path, name);
    }
    const childAPIs = Object.fromEntries(
      Object.entries(features).map(([name, child]) => [name, child.api]),
    );
    const localAPI =
      definition.api?.({
        resources,
        features: childAPIs,
        actor: options.actor,
      }) ?? {};
    for (const name of Object.keys(childAPIs)) {
      if (name in localAPI) {
        throw new Error(
          `Semantic API member ${JSON.stringify(name)} collides with Feature mount ${path ? `${path}.${name}` : name}.`,
        );
      }
    }
    const api = Object.defineProperties({}, Object.getOwnPropertyDescriptors(localAPI));
    for (const [name, childAPI] of Object.entries(childAPIs)) {
      Object.defineProperty(api, name, {
        value: childAPI,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return {
      api: Object.freeze(api),
      features: Object.freeze(features),
    };
  };

  return instantiate(
    {
      resources: options.resources,
      features: options.features,
      api: options.api,
    },
    "",
  );
}
