import { dirname, resolve } from "node:path";
import * as ts from "@typescript/typescript6";

type VisualReference =
  | {
      readonly $visual: "token";
      readonly group: string;
      readonly name: string;
    }
  | {
      readonly $visual: "value";
      readonly component: string;
      readonly kind: string;
      readonly name: string;
    };

export type VisualCompilerSurface = {
  readonly components: Readonly<
    Record<
      string,
      {
        readonly parts: Readonly<Record<string, string>>;
        readonly values: readonly {
          readonly name: string;
          readonly kind: string;
          readonly writable?: boolean;
        }[];
        readonly events?: readonly string[];
        readonly parameters?: readonly string[];
      }
    >
  >;
};

export type MaterializedVisualPreset = {
  readonly name: string;
  readonly tokens: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly themes: Readonly<Record<string, unknown>>;
  readonly containers: Readonly<Record<string, unknown>>;
  readonly parameters: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly interactions: Readonly<Record<string, readonly unknown[]>>;
  readonly components: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >;
};

export type VisualContractPreset = {
  readonly name: string;
  readonly tokens: Readonly<Record<string, readonly string[]>>;
  readonly themes: readonly string[];
  readonly containers: readonly string[];
  readonly location: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
};

export type VisualContractAnalysis = {
  readonly surface: VisualCompilerSurface;
  readonly presets: readonly VisualContractPreset[];
};

export type VisualSourceLocation = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
};

export function analyzeVisualContract(path: string): VisualContractAnalysis {
  const sourceText = ts.sys.readFile(path);
  if (sourceText == null) throw new Error(`Cannot read visual app contract ${path}.`);
  const source = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const aliases = new Map<string, ts.TypeNode>();
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement.type);
  }
  const app = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === "App",
  );
  if (!app) throw new Error(`${path} must export a type named App.`);
  const appType = typeLiteral(app.type, aliases, `${path}: App`);
  const componentsType = propertyTypeLiteral(
    appType,
    "Components",
    aliases,
    `${path}: App.Components`,
  );
  const components: Record<
    string,
    {
      parts: Record<string, string>;
      values: Array<{ name: string; kind: string; writable?: boolean }>;
      events: string[];
      parameters: string[];
    }
  > = {};

  for (const member of componentsType.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const componentName = propertyName(member.name);
    if (!componentName) continue;
    const component = typeLiteral(member.type, aliases, `${path}: Components.${componentName}`);
    const partsType = propertyTypeLiteral(
      component,
      "Parts",
      aliases,
      `${path}: Components.${componentName}.Parts`,
    );
    const parts: Record<string, string> = {};
    for (const part of partsType.members) {
      if (!ts.isPropertySignature(part) || !part.type) continue;
      const name = propertyName(part.name);
      const values = stringLiteralUnion(part.type, aliases);
      if (name && values.length === 1) parts[name] = values[0]!;
    }
    const valuesType = optionalPropertyTypeLiteral(component, "Values", aliases);
    const values: Array<{ name: string; kind: string; writable?: boolean }> = [];
    for (const value of valuesType?.members ?? []) {
      if (!ts.isPropertySignature(value) || !value.type) continue;
      const name = propertyName(value.name);
      const kind = visualValueKind(value.type, aliases) ?? primitiveValueKind(value.type, aliases);
      if (name) values.push({ name, kind, writable: writableValue(value.type, aliases) });
    }
    const events = propertyNames(optionalPropertyTypeLiteral(component, "Events", aliases));
    const parameters = propertyNames(optionalPropertyTypeLiteral(component, "Parameters", aliases));
    components[componentName] = {
      parts,
      values,
      events,
      parameters,
    };
  }

  const stylesType = propertyTypeLiteral(appType, "Styles", aliases, `${path}: App.Styles`);
  const presetsNode = propertyTypeNode(stylesType, "Presets", `${path}: App.Styles.Presets`);
  const presets: VisualContractPreset[] = [];
  const presetNames = stringLiteralUnion(presetsNode, aliases);
  if (presetNames.length) {
    const location = source.getLineAndCharacterOfPosition(presetsNode.getStart(source));
    for (const name of presetNames) {
      presets.push({
        name,
        tokens: {},
        themes: [],
        containers: [],
        location: {
          file: path,
          line: location.line + 1,
          column: location.character + 1,
        },
      });
    }
    return { surface: { components }, presets };
  }
  const presetsType = typeLiteral(presetsNode, aliases, `${path}: App.Styles.Presets`);
  for (const member of presetsType.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const name = propertyName(member.name);
    if (!name) continue;
    const contract = typeLiteral(member.type, aliases, `${path}: Styles.Presets.${name}`);
    const tokensType = propertyTypeLiteral(
      contract,
      "Tokens",
      aliases,
      `${path}: Styles.Presets.${name}.Tokens`,
    );
    const tokens: Record<string, string[]> = {};
    for (const group of tokensType.members) {
      if (!ts.isPropertySignature(group) || !group.type) continue;
      const groupName = propertyName(group.name);
      if (groupName) tokens[groupName] = stringLiteralUnion(group.type, aliases);
    }
    const location = source.getLineAndCharacterOfPosition(member.getStart(source));
    presets.push({
      name,
      tokens,
      themes: propertyLiteralUnion(contract, "Themes", aliases, ["default"]),
      containers: propertyLiteralUnion(contract, "Containers", aliases, []),
      location: {
        file: path,
        line: location.line + 1,
        column: location.character + 1,
      },
    });
  }

  return { surface: { components }, presets };
}

export function analyzeVisualPresetSources(
  appPath: string,
  sourceDir: string,
): Readonly<Record<string, VisualSourceLocation>> {
  const source = readSourceFile(appPath);
  const imports = new Map<string, { imported: string; specifier: string }>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      imports.set(element.name.text, {
        imported: element.propertyName?.text ?? element.name.text,
        specifier: statement.moduleSpecifier.text,
      });
    }
  }
  const exported = source.statements.find(ts.isExportAssignment);
  if (!exported) return {};
  const app = objectExpression(exported.expression);
  const styles = app && objectPropertyExpression(app, "styles");
  const presets = styles && objectPropertyExpression(objectExpression(styles), "presets");
  const presetObject = presets && objectExpression(presets);
  if (!presetObject) return {};

  const locations: Record<string, VisualSourceLocation> = {};
  for (const property of presetObject.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name) continue;
    let targetSource = source;
    let targetNode: ts.Node = property.initializer;
    if (ts.isIdentifier(property.initializer)) {
      const imported = imports.get(property.initializer.text);
      const modulePath = imported
        ? resolveVisualModule(appPath, sourceDir, imported.specifier)
        : undefined;
      if (modulePath) {
        const declaration = resolveVisualDeclaration(modulePath, sourceDir, imported!.imported);
        if (declaration) {
          targetSource = declaration.source;
          targetNode = declaration.node;
        }
      }
    }
    locations[name] = nodeLocation(targetSource, targetNode);
  }
  return locations;
}

export function materializeVisualPreset(
  name: string,
  source: unknown,
  surface: VisualCompilerSurface,
  contract?: VisualContractPreset,
): MaterializedVisualPreset {
  if (typeof source !== "function") {
    throw new Error(`${name} preset must be a preset factory.`);
  }
  if (!contract) throw new Error(`${name} preset factory requires its visual contract.`);
  return materializeVisualPresetFactory(
    name,
    source as (contract: Record<string, unknown>) => unknown,
    surface,
  );
}

type SymbolicRecord = Record<string, unknown>;

function materializeVisualPresetFactory(
  name: string,
  factory: (contract: Record<string, unknown>) => unknown,
  surface: VisualCompilerSurface,
): MaterializedVisualPreset {
  let recipeIndex = 0;
  let motionIndex = 0;
  let activeComponent: string | undefined;
  const tokens = symbolicTokenContract();
  const createRecipe = (definition: unknown) => {
    const recipe = cloneSerializable(definition, `${name}.createRecipe`) as SymbolicRecord;
    const variants = recordAt(recipe.variants, `${name}.createRecipe.variants`);
    const defaults = recordOrEmpty(recipe.defaults);
    const id = `recipe-${recipeIndex++}`;
    return (rawValues: unknown = {}) => {
      const values = recordAt(rawValues, `${name}.${id}`);
      for (const key of Object.keys(values)) {
        if (!(key in variants)) throw new Error(`${name}.${id} received unknown variant ${key}.`);
      }
      for (const [variant, branches] of Object.entries(variants)) {
        if (!(variant in values) && !(variant in defaults)) {
          throw new Error(`${name}.${id} requires variant ${variant}.`);
        }
        const selected = values[variant] ?? defaults[variant];
        if (!isSymbolic(selected) && !recipeBranchExists(recordAt(branches, variant), selected)) {
          throw new Error(`${name}.${id}.${variant} has unknown value ${String(selected)}.`);
        }
      }
      return {
        $visual: "recipe",
        id,
        definition: recipe,
        values: cloneSerializable(values, `${name}.${id}.values`),
      };
    };
  };
  const result = recordAt(
    factory({
      tokens,
      createRecipe,
      createMotion: (rawDefinition: unknown) => {
        if (!activeComponent) {
          throw new Error(`${name}.createMotion must be declared inside a component preset.`);
        }
        const definition = recordAt(rawDefinition, `${name}.createMotion`);
        for (const field of Object.keys(definition)) {
          if (
            field !== "target" &&
            field !== "velocity" &&
            field !== "transition" &&
            field !== "range"
          ) {
            throw new Error(`${name}.createMotion received unknown field ${field}.`);
          }
        }
        if (definition.target == null) {
          throw new Error(`${name}.createMotion.target is required.`);
        }
        if (definition.transition == null) {
          throw new Error(`${name}.createMotion.transition is required.`);
        }
        const range = definition.range;
        if (
          !Array.isArray(range) ||
          range.length !== 2 ||
          range.some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
          range[0] === range[1]
        ) {
          throw new Error(`${name}.createMotion.range must contain two distinct finite numbers.`);
        }
        const target = definition.target;
        const kind = recordOrUndefined(target)?.kind ?? "number";
        const node = numberExpression({
          source: "motion",
          name: `motion-${motionIndex++}`,
          operation: "motion",
          target,
          ...(definition.velocity === undefined ? {} : { velocity: definition.velocity }),
          transition: definition.transition,
          range,
          kind,
        });
        Object.defineProperty(node, "progress", {
          enumerable: false,
          value: numberExpression({
            operation: "motion-progress",
            motion: node,
            range,
            kind: "progress",
          }),
        });
        return node;
      },
      interpolate: (value: unknown, input: unknown, output: unknown) =>
        numberExpression({
          $visual: "expression",
          operation: "interpolate",
          value,
          input,
          output,
          kind: "number",
        }),
    }),
    `preset factory ${JSON.stringify(name)}`,
  );
  const theme = recordAt(result.theme, `${name}.theme`);
  validateFactoryTokenReferences(tokens.references, theme, name);
  const componentFactories = recordAt(result.components, `${name}.components`);
  const components: Record<string, Record<string, Record<string, unknown>>> = {};
  const parameters: Record<string, Record<string, unknown>> = {};
  const interactions: Record<string, readonly unknown[]> = {};

  for (const [componentName, componentSurface] of Object.entries(surface.components)) {
    const componentFactory = componentFactories[componentName];
    if (typeof componentFactory !== "function") {
      throw new Error(`${name}.components is missing component ${JSON.stringify(componentName)}.`);
    }
    activeComponent = componentName;
    motionIndex = 0;
    let rawOutput: unknown;
    try {
      rawOutput = componentFactory(visualComponentScope(componentName, componentSurface));
    } finally {
      activeComponent = undefined;
    }
    const output = recordAt(rawOutput, `${name}.components.${componentName}`);
    const parameterOutput = recordOrEmpty(output.parameters);
    for (const parameter of componentSurface.parameters ?? []) {
      if (!Object.hasOwn(parameterOutput, parameter)) {
        throw new Error(
          `${name}.${componentName}.parameters is missing ${JSON.stringify(parameter)}.`,
        );
      }
    }
    for (const parameter of Object.keys(parameterOutput)) {
      if (!componentSurface.parameters?.includes(parameter)) {
        throw new Error(
          `${name}.${componentName}.parameters contains unknown parameter ${JSON.stringify(parameter)}.`,
        );
      }
    }
    parameters[componentName] = cloneSerializable(
      parameterOutput,
      `${name}.components.${componentName}.parameters`,
    ) as Record<string, unknown>;
    const interactionOutput = output.interactions ?? [];
    if (!Array.isArray(interactionOutput)) {
      throw new Error(`${name}.${componentName}.interactions must be an array.`);
    }
    validatePresetInteractions(name, componentName, interactionOutput, componentSurface);
    interactions[componentName] = cloneSerializable(
      interactionOutput,
      `${name}.components.${componentName}.interactions`,
    ) as readonly unknown[];
    const parts: Record<string, Record<string, unknown>> = {};
    for (const [part, visual] of Object.entries(output)) {
      if (part === "parameters" || part === "interactions") continue;
      if (!(part in componentSurface.parts)) {
        throw new Error(`${name}.${componentName} contains unknown part ${JSON.stringify(part)}.`);
      }
      const normalized = Array.isArray(visual)
        ? { use: visual }
        : isRecipeResult(visual)
          ? { use: visual }
          : recordAt(visual, `${name}.components.${componentName}.${part}`);
      parts[part] = cloneSerializable(
        normalized,
        `${name}.components.${componentName}.${part}`,
      ) as Record<string, unknown>;
    }
    components[componentName] = sortRecord(parts);
  }

  for (const componentName of Object.keys(componentFactories)) {
    if (!(componentName in surface.components)) {
      throw new Error(
        `${name}.components contains unknown component ${JSON.stringify(componentName)}.`,
      );
    }
  }

  return {
    name,
    tokens: cloneSerializable(theme, `${name}.theme`) as Record<string, Record<string, unknown>>,
    themes: cloneSerializable(recordOrEmpty(result.themes), `${name}.themes`) as Record<
      string,
      unknown
    >,
    containers: {},
    parameters: sortRecord(parameters),
    interactions: sortRecord(interactions),
    components: sortRecord(components),
  };
}

function symbolicTokenContract(): SymbolicRecord & {
  readonly references: ReadonlySet<string>;
} {
  const references = new Set<string>();
  const groups = new Map<string, SymbolicRecord>();
  const target = {} as SymbolicRecord & { readonly references: ReadonlySet<string> };
  Object.defineProperty(target, "references", { value: references, enumerable: false });
  return new Proxy(target, {
    get(source, group) {
      if (group === "references") return source.references;
      if (typeof group !== "string") return Reflect.get(source, group);
      let values = groups.get(group);
      if (!values) {
        values = new Proxy({} as SymbolicRecord, {
          get(_tokens, token) {
            if (typeof token !== "string") return;
            references.add(`${group}.${token}`);
            return { $visual: "token", group, name: token } satisfies VisualReference;
          },
        });
        groups.set(group, values);
      }
      return values;
    },
  });
}

function validateFactoryTokenReferences(
  references: ReadonlySet<string>,
  theme: SymbolicRecord,
  preset: string,
): void {
  for (const reference of references) {
    const [group, token] = reference.split(".");
    const definitions = group ? recordOrEmpty(theme[group]) : {};
    if (!token || !Object.hasOwn(definitions, token)) {
      throw new Error(`${preset} references token ${reference}, but its theme does not define it.`);
    }
  }
}

function visualComponentScope(
  component: string,
  surface: VisualCompilerSurface["components"][string],
): Record<string, unknown> {
  const values = Object.fromEntries(
    surface.values.map(({ name, kind }) => [
      name,
      kind === "boolean"
        ? condition({ source: "value", component, name })
        : kind === "number" || isVisualNumberKind(kind)
          ? numberExpression({ source: "value", component, name, kind })
          : expression({ source: "value", component, name, kind }),
    ]),
  );
  const writableValues = Object.fromEntries(
    surface.values
      .filter(({ writable }) => writable)
      .map(({ name, kind }) => [
        name,
        kind === "boolean"
          ? condition({ source: "value", component, name })
          : kind === "number" || isVisualNumberKind(kind)
            ? numberExpression({ source: "value", component, name, kind })
            : expression({ source: "value", component, name, kind }),
      ]),
  );
  const events = Object.fromEntries(
    (surface.events ?? []).map((name) => [name, { $visual: "event", component, name }]),
  );
  const parts = Object.fromEntries(
    Object.keys(surface.parts).map((name) => [name, { $visual: "part", component, name }]),
  );
  const interaction = Object.fromEntries(
    ["hovered", "pressed", "focusVisible", "focusWithin", "selected", "disabled", "expanded"].map(
      (name) => [name, condition({ source: "interaction", component, name })],
    ),
  );
  const geometry = {
    inlineSize: numberExpression({
      source: "geometry",
      component,
      name: "inlineSize",
      kind: "size",
    }),
    blockSize: numberExpression({ source: "geometry", component, name: "blockSize", kind: "size" }),
  };
  const environment = Object.fromEntries(
    [
      "reducedMotion",
      "moreContrast",
      "forcedColors",
      "dark",
      "hover",
      "finePointer",
      "coarsePointer",
    ].map((name) => [name, condition({ source: "environment", component, name })]),
  );
  return { values, writableValues, events, parts, interaction, geometry, environment };
}

function validatePresetInteractions(
  preset: string,
  component: string,
  interactions: readonly unknown[],
  surface: VisualCompilerSurface["components"][string],
): void {
  const writable = new Set(
    surface.values.filter((value) => value.writable).map((value) => value.name),
  );
  const events = new Set(surface.events ?? []);
  interactions.forEach((value, index) => {
    const path = `${preset}.${component}.interactions[${index}]`;
    const interaction = recordAt(value, path);
    if (interaction.type !== "drag") throw new Error(`${path}.type must be "drag".`);
    const trigger = visualReference(interaction.trigger, "part", `${path}.trigger`);
    if (!Object.hasOwn(surface.parts, trigger)) {
      throw new Error(`${path}.trigger references unknown Part ${JSON.stringify(trigger)}.`);
    }
    for (const eventField of ["start", "release", "cancel"] as const) {
      if (interaction[eventField] === undefined) {
        if (eventField === "release") throw new Error(`${path}.release is required.`);
        continue;
      }
      const event = visualReference(interaction[eventField], "event", `${path}.${eventField}`);
      if (!events.has(event)) {
        throw new Error(`${path}.${eventField} references unknown Event ${JSON.stringify(event)}.`);
      }
    }
    for (const [field, reference] of Object.entries(
      recordAt(interaction.output, `${path}.output`),
    )) {
      const name = visualValueReference(reference, `${path}.output.${field}`);
      if (!writable.has(name)) {
        throw new Error(`${path}.output.${field} requires writable Value ${JSON.stringify(name)}.`);
      }
    }
  });
}

function visualReference(value: unknown, kind: "event" | "part", path: string): string {
  const reference = recordAt(value, path);
  if (reference.$visual !== kind || typeof reference.name !== "string") {
    throw new Error(`${path} must reference a component ${kind === "event" ? "Event" : "Part"}.`);
  }
  return reference.name;
}

function visualValueReference(value: unknown, path: string): string {
  const reference = recordAt(value, path);
  if (
    reference.$visual !== "expression" ||
    reference.source !== "value" ||
    typeof reference.name !== "string"
  ) {
    throw new Error(`${path} must reference a writable component Value.`);
  }
  return reference.name;
}

function expression(value: SymbolicRecord): SymbolicRecord {
  return { $visual: "expression", ...value };
}

function numberExpression(value: SymbolicRecord): SymbolicRecord {
  const node = expression(value);
  for (const [name, operation] of [
    ["isAbove", "above"],
    ["isAtLeast", "at-least"],
    ["isBelow", "below"],
    ["isAtMost", "at-most"],
    ["isEqual", "equal"],
  ] as const) {
    Object.defineProperty(node, name, {
      enumerable: false,
      value: (right: unknown) => condition({ operation, left: node, right }),
    });
  }
  return node;
}

function condition(value: SymbolicRecord): SymbolicRecord {
  const node = expression({ kind: "boolean", ...value });
  Object.defineProperties(node, {
    and: {
      enumerable: false,
      value: (...conditions: unknown[]) =>
        condition({ operation: "and", values: [node, ...conditions] }),
    },
    or: {
      enumerable: false,
      value: (...conditions: unknown[]) =>
        condition({ operation: "or", values: [node, ...conditions] }),
    },
    not: {
      enumerable: false,
      value: () => condition({ operation: "not", value: node }),
    },
    choose: {
      enumerable: false,
      value: (truthy: unknown, falsy: unknown) =>
        numberExpression({ operation: "choose", condition: node, truthy, falsy, kind: "number" }),
    },
  });
  return node;
}

function isSymbolic(value: unknown): boolean {
  return Boolean(recordOrUndefined(value)?.$visual);
}

function isRecipeResult(value: unknown): boolean {
  return recordOrUndefined(value)?.$visual === "recipe";
}

function recipeBranchExists(branches: Record<string, unknown>, value: unknown): boolean {
  return Object.hasOwn(branches, String(value));
}

function isVisualNumberKind(kind: string): boolean {
  return [
    "progress",
    "opacity",
    "ratio",
    "length",
    "angle",
    "time",
    "zIndex",
    "space",
    "size",
    "radius",
  ].includes(kind);
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function validateVisualTokenUsage(
  preset: string,
  tokens: Record<string, unknown>,
  themes: Record<string, unknown>,
  components: unknown,
): void {
  const used = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      record.$visual === "token" &&
      typeof record.group === "string" &&
      typeof record.name === "string"
    ) {
      used.add(`${record.group}.${record.name}`);
      return;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(components);

  let changed = true;
  while (changed) {
    changed = false;
    for (const key of Array.from(used)) {
      const separator = key.indexOf(".");
      const group = key.slice(0, separator);
      const name = key.slice(separator + 1);
      const candidates = [
        objectRecord(tokens[group])[name],
        ...Object.values(themes).map((theme) => objectRecord(objectRecord(theme)[group])[name]),
      ];
      for (const candidate of candidates) {
        const alias = objectRecord(candidate).token;
        if (typeof alias !== "string") continue;
        const target = `${group}.${alias}`;
        if (!used.has(target)) {
          used.add(target);
          changed = true;
        }
      }
    }
  }

  const dead = Object.entries(tokens).flatMap(([group, definitions]) =>
    Object.keys(objectRecord(definitions))
      .filter((name) => !used.has(`${group}.${name}`))
      .map((name) => `${group}.${name}`),
  );
  if (dead.length) {
    throw new Error(`${preset}.tokens contains unused tokens: ${dead.sort().join(", ")}.`);
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stableVisualJson(value: unknown): string {
  return `${JSON.stringify(cloneSerializable(value, "visual preset"), null, 2)}\n`;
}

function cloneSerializable(value: unknown, path: string, parents = new Set<object>()): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "number") throw new Error(`${path} contains a non-finite number.`);
  if (typeof value === "undefined") throw new Error(`${path} contains undefined.`);
  if (typeof value === "function") throw new Error(`${path} contains a runtime function.`);
  if (typeof value !== "object") {
    throw new Error(`${path} contains unsupported ${typeof value} data.`);
  }
  if (parents.has(value)) throw new Error(`${path} contains a circular reference.`);

  parents.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => cloneSerializable(item, `${path}[${index}]`, parents));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain plain objects and arrays.`);
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      result[key] = cloneSerializable(child, `${path}.${key}`, parents);
    }
    return result;
  } finally {
    parents.delete(value);
  }
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value == null ? {} : recordAt(value, "visual preset field");
}

function recordAt(value: unknown, path: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, any>;
}

function typeLiteral(
  node: ts.TypeNode,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  path: string,
): ts.TypeLiteralNode {
  const resolved = resolveTypeNode(node, aliases, new Set());
  if (!ts.isTypeLiteralNode(resolved)) throw new Error(`${path} must be an object type.`);
  return resolved;
}

function resolveTypeNode(
  node: ts.TypeNode,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  seen: Set<string>,
): ts.TypeNode {
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return node;
  const name = node.typeName.text;
  if (seen.has(name)) throw new Error(`Circular type alias ${name} in visual app contract.`);
  const target = aliases.get(name);
  if (!target) return node;
  seen.add(name);
  return resolveTypeNode(target, aliases, seen);
}

function propertyTypeLiteral(
  owner: ts.TypeLiteralNode,
  name: string,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  path: string,
): ts.TypeLiteralNode {
  return typeLiteral(propertyTypeNode(owner, name, path), aliases, path);
}

function optionalPropertyTypeLiteral(
  owner: ts.TypeLiteralNode,
  name: string,
  aliases: ReadonlyMap<string, ts.TypeNode>,
): ts.TypeLiteralNode | undefined {
  const member = owner.members.find(
    (candidate): candidate is ts.PropertySignature =>
      ts.isPropertySignature(candidate) && propertyName(candidate.name) === name,
  );
  return member?.type ? typeLiteral(member.type, aliases, name) : undefined;
}

function propertyTypeNode(owner: ts.TypeLiteralNode, name: string, path: string): ts.TypeNode {
  const member = owner.members.find(
    (candidate): candidate is ts.PropertySignature =>
      ts.isPropertySignature(candidate) && propertyName(candidate.name) === name,
  );
  if (!member?.type) throw new Error(`${path} is missing.`);
  return member.type;
}

function propertyLiteralUnion(
  owner: ts.TypeLiteralNode,
  name: string,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  fallback: readonly string[],
): string[] {
  const member = owner.members.find(
    (candidate): candidate is ts.PropertySignature =>
      ts.isPropertySignature(candidate) && propertyName(candidate.name) === name,
  );
  return member?.type ? stringLiteralUnion(member.type, aliases) : [...fallback];
}

function stringLiteralUnion(
  node: ts.TypeNode,
  aliases: ReadonlyMap<string, ts.TypeNode>,
): string[] {
  const resolved = resolveTypeNode(node, aliases, new Set());
  const nodes = ts.isUnionTypeNode(resolved) ? resolved.types : [resolved];
  return nodes.flatMap((candidate) => {
    if (!ts.isLiteralTypeNode(candidate) || !ts.isStringLiteral(candidate.literal)) return [];
    return [candidate.literal.text];
  });
}

function visualValueKind(
  node: ts.TypeNode,
  aliases: ReadonlyMap<string, ts.TypeNode>,
): string | undefined {
  const resolved = unwrapWritable(resolveTypeNode(node, aliases, new Set()));
  if (
    !ts.isTypeReferenceNode(resolved) ||
    !ts.isIdentifier(resolved.typeName) ||
    resolved.typeName.text !== "VisualValue"
  ) {
    return undefined;
  }
  const kind = resolved.typeArguments?.[0];
  return kind && ts.isLiteralTypeNode(kind) && ts.isStringLiteral(kind.literal)
    ? kind.literal.text
    : undefined;
}

function primitiveValueKind(node: ts.TypeNode, aliases: ReadonlyMap<string, ts.TypeNode>): string {
  const resolved = unwrapWritable(resolveTypeNode(node, aliases, new Set()));
  if (resolved.kind === ts.SyntaxKind.NumberKeyword) return "number";
  if (resolved.kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
  if (resolved.kind === ts.SyntaxKind.StringKeyword) return "string";
  if (ts.isUnionTypeNode(resolved)) {
    const literals = resolved.types.filter(ts.isLiteralTypeNode).map(({ literal }) => literal);
    if (literals.length === resolved.types.length) {
      if (literals.every(ts.isStringLiteral)) return "string";
      if (
        literals.every(
          (literal) =>
            literal.kind === ts.SyntaxKind.TrueKeyword ||
            literal.kind === ts.SyntaxKind.FalseKeyword,
        )
      ) {
        return "boolean";
      }
      if (literals.every(ts.isNumericLiteral)) return "number";
    }
  }
  return "data";
}

function writableValue(node: ts.TypeNode, aliases: ReadonlyMap<string, ts.TypeNode>): boolean {
  const resolved = resolveTypeNode(node, aliases, new Set());
  return (
    ts.isTypeReferenceNode(resolved) &&
    ts.isIdentifier(resolved.typeName) &&
    resolved.typeName.text === "Writable"
  );
}

function unwrapWritable(node: ts.TypeNode): ts.TypeNode {
  return ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Writable" &&
    node.typeArguments?.[0]
    ? node.typeArguments[0]
    : node;
}

function propertyNames(node: ts.TypeLiteralNode | undefined): string[] {
  return (node?.members ?? []).flatMap((member) => {
    if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) return [];
    const name = propertyName(member.name);
    return name ? [name] : [];
  });
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function readSourceFile(path: string): ts.SourceFile {
  const source = ts.sys.readFile(path);
  if (source == null) throw new Error(`Cannot read visual source ${path}.`);
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function objectExpression(
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return;
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (
    ts.isSatisfiesExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return objectExpression(expression.expression);
  }
}

function objectPropertyExpression(
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Expression | undefined {
  const property = object?.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
  );
  return property?.initializer;
}

function resolveVisualModule(
  appPath: string,
  sourceDir: string,
  specifier: string,
): string | undefined {
  const base = specifier.startsWith("src/")
    ? resolve(sourceDir, specifier.slice("src/".length))
    : specifier.startsWith(".")
      ? resolve(dirname(appPath), specifier)
      : undefined;
  if (!base) return;
  return [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find(ts.sys.fileExists);
}

function findVariableDeclaration(
  source: ts.SourceFile,
  name: string,
): ts.VariableDeclaration | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
    }
  }
}

function resolveVisualDeclaration(
  modulePath: string,
  sourceDir: string,
  name: string,
  seen = new Set<string>(),
): { source: ts.SourceFile; node: ts.Node } | undefined {
  const key = `${modulePath}:${name}`;
  if (seen.has(key)) return;
  seen.add(key);
  const source = readSourceFile(modulePath);
  const declaration = findVariableDeclaration(source, name);
  if (declaration) return { source, node: declaration };

  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.name.text !== name) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
        const local = findVariableDeclaration(source, imported);
        return local ? { source, node: local } : undefined;
      }
      const target = resolveVisualModule(modulePath, sourceDir, statement.moduleSpecifier.text);
      return target ? resolveVisualDeclaration(target, sourceDir, imported, seen) : undefined;
    }
  }
}

function nodeLocation(source: ts.SourceFile, node: ts.Node): VisualSourceLocation {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: source.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}
