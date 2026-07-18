import { readFile } from "node:fs/promises";
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
        readonly state: readonly {
          readonly name: string;
          readonly kind: string;
        }[];
        readonly process?: readonly { readonly name: string; readonly kind: string }[];
        readonly actions?: readonly string[];
        readonly parameters?: readonly string[];
        readonly inputCallbacks?: readonly string[];
      }
    >
  >;
};

export type MaterializedVisualPresentation = {
  readonly name: string;
  readonly assets: Readonly<{
    readonly fonts: Readonly<Record<string, unknown>>;
  }>;
  readonly tokens: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly themes: Readonly<Record<string, unknown>>;
  readonly containers: Readonly<Record<string, unknown>>;
  readonly parameters: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly interactions: Readonly<Record<string, readonly unknown[]>>;
  readonly completions: Readonly<Record<string, readonly unknown[]>>;
  readonly components: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >;
};

export type VisualContractPresentation = {
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
  readonly presentations: readonly VisualContractPresentation[];
  readonly programs: readonly ProgramManifest[];
  readonly uiProgram: string;
};

export type ProgramManifest = {
  readonly name: string;
  readonly runtime: string;
  readonly requires: readonly string[];
  readonly provides: readonly string[];
  readonly ui: boolean;
  readonly contributions: readonly ProgramContributionManifest[];
};

export type ProgramContributionManifest = {
  readonly feature: string;
  readonly requires: readonly string[];
  readonly provides: readonly string[];
  readonly ui: boolean;
};

export type VisualSourceLocation = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
};

export function analyzeVisualContract(path: string): VisualContractAnalysis {
  const absolutePath = resolve(path);
  const appDir = resolve(dirname(absolutePath), "..");
  const program = ts.createProgram({
    rootNames: [absolutePath],
    options: {
      allowImportingTsExtensions: true,
      baseUrl: appDir,
      customConditions: ["poggers-source"],
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      paths: { "src/*": ["src/*"] },
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    },
  });
  const source = program.getSourceFile(absolutePath);
  if (!source) throw new Error(`Cannot read visual app contract ${absolutePath}.`);
  const diagnostic = program.getSyntacticDiagnostics(source)[0];
  if (diagnostic) throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  const checker = program.getTypeChecker();
  const app = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === "App",
  );
  if (!app) throw new Error(`${path} must export a type named App.`);
  const appType = typeLiteral(app.type, checker, `${path}: App`);
  const components: Record<
    string,
    {
      parts: Record<string, string>;
      state: Array<{ name: string; kind: string }>;
      process: Array<{ name: string; kind: string }>;
      actions: string[];
      parameters: string[];
      inputCallbacks: string[];
    }
  > = {};
  const programs = collectProgramManifest(
    checker.getTypeFromTypeNode(app.type),
    checker,
    app,
    path,
  );
  const uiPrograms = programs.filter(({ runtime, ui }) => runtime === "web-main" && ui);
  if (uiPrograms.length !== 1) {
    throw new Error(
      `${path} must define exactly one WebMain UI Program; found ${uiPrograms.length}.`,
    );
  }
  const uiProgram = uiPrograms[0]!.name;
  collectVisualComponentsFromType(
    checker.getTypeFromTypeNode(app.type),
    "",
    uiProgram,
    checker,
    app,
    path,
    components,
  );

  const presentationsNode = propertyTypeNode(
    appType,
    "Presentations",
    `${path}: App.Presentations`,
  );
  const presentations: VisualContractPresentation[] = [];
  const presentationNames = stringLiteralUnion(presentationsNode, checker);
  if (presentationNames.length) {
    const location = source.getLineAndCharacterOfPosition(presentationsNode.getStart(source));
    for (const name of presentationNames) {
      presentations.push({
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
    return { surface: { components }, presentations, programs, uiProgram };
  }
  const presentationsType = typeLiteral(presentationsNode, checker, `${path}: App.Presentations`);
  for (const member of presentationsType.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const name = propertyName(member.name);
    if (!name) continue;
    const contract = typeLiteral(member.type, checker, `${path}: Presentations.${name}`);
    const tokensType = propertyTypeLiteral(
      contract,
      "Tokens",
      checker,
      `${path}: Presentations.${name}.Tokens`,
    );
    const tokens: Record<string, string[]> = {};
    for (const group of tokensType.members) {
      if (!ts.isPropertySignature(group) || !group.type) continue;
      const groupName = propertyName(group.name);
      if (groupName) tokens[groupName] = stringLiteralUnion(group.type, checker);
    }
    const location = source.getLineAndCharacterOfPosition(member.getStart(source));
    presentations.push({
      name,
      tokens,
      themes: propertyLiteralUnion(contract, "Themes", checker, ["default"]),
      containers: propertyLiteralUnion(contract, "Containers", checker, []),
      location: {
        file: path,
        line: location.line + 1,
        column: location.character + 1,
      },
    });
  }

  return { surface: { components }, presentations, programs, uiProgram };
}

export function analyzeVisualPresentationSources(
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
  const presentations = app && objectPropertyExpression(app, "presentations");
  const presentationObject = presentations && objectExpression(presentations);
  if (!presentationObject) return {};

  const locations: Record<string, VisualSourceLocation> = {};
  for (const property of presentationObject.properties) {
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

export function materializeVisualPresentation(
  name: string,
  source: unknown,
  surface: VisualCompilerSurface,
  contract?: VisualContractPresentation,
): MaterializedVisualPresentation {
  if (typeof source !== "function") {
    throw new Error(`${name} presentation must be a presentation factory.`);
  }
  if (!contract) throw new Error(`${name} presentation factory requires its visual contract.`);
  return materializeVisualPresentationFactory(
    name,
    source as (contract: Record<string, unknown>) => unknown,
    surface,
  );
}

export async function bundleVisualFontAssets(
  presentation: MaterializedVisualPresentation,
  sourceFile: string,
): Promise<MaterializedVisualPresentation> {
  const fonts: Record<string, unknown> = {};
  for (const [name, rawAsset] of Object.entries(presentation.assets.fonts)) {
    const assetPath = fontAssetSourcePath(presentation.name, name);
    const asset = recordAt(rawAsset, assetPath);
    const sources = Array.isArray(asset.sources)
      ? await Promise.all(
          asset.sources.map(async (rawSource, index) => {
            const path = `${assetPath}.sources[${index}]`;
            const source = recordAt(rawSource, path);
            if (typeof source.file !== "string" || !source.file) {
              throw new Error(`${path}.file must be a non-empty path.`);
            }
            if (/^(?:data:|https?:)/.test(source.file)) return source;
            const absolute = resolve(dirname(sourceFile), source.file);
            let contents: Uint8Array;
            try {
              contents = await readFile(absolute);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              throw new Error(`${path} cannot read ${absolute}: ${message}`);
            }
            const format = source.format;
            const mime =
              format === "woff2"
                ? "font/woff2"
                : format === "woff"
                  ? "font/woff"
                  : format === "opentype"
                    ? "font/otf"
                    : format === "truetype"
                      ? "font/ttf"
                      : "application/octet-stream";
            return {
              ...source,
              file: `data:${mime};base64,${Buffer.from(contents).toString("base64")}`,
            };
          }),
        )
      : undefined;
    fonts[name] = { ...asset, ...(sources ? { sources } : {}) };
  }
  return { ...presentation, assets: { fonts } };
}

type SymbolicRecord = Record<string, unknown>;

function materializeVisualPresentationFactory(
  name: string,
  factory: (contract: Record<string, unknown>) => unknown,
  surface: VisualCompilerSurface,
): MaterializedVisualPresentation {
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
          throw new Error(`${name}.createMotion must be declared inside a component presentation.`);
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
    `presentation factory ${JSON.stringify(name)}`,
  );
  const authoredTheme = cloneSerializable(
    recordAt(result.theme, `${name}.theme`),
    `${name}.theme`,
  ) as Record<string, unknown>;
  const authoredThemes = cloneSerializable(
    recordOrEmpty(result.themes),
    `${name}.themes`,
  ) as Record<string, unknown>;
  validateFactoryTokenReferences(tokens.references, authoredTheme, name);
  const fonts = materializePresentationFonts(name, authoredTheme, authoredThemes);
  const componentFactories = flattenPresentationComponentFactories(name, result, surface);
  const components: Record<string, Record<string, Record<string, unknown>>> = {};
  const parameters: Record<string, Record<string, unknown>> = {};
  const interactions: Record<string, readonly unknown[]> = {};
  const completions: Record<string, readonly unknown[]> = {};

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
    validatePresentationInteractions(name, componentName, interactionOutput, componentSurface);
    interactions[componentName] = cloneSerializable(
      interactionOutput,
      `${name}.components.${componentName}.interactions`,
    ) as readonly unknown[];
    const completionOutput = output.completions ?? [];
    if (!Array.isArray(completionOutput)) {
      throw new Error(`${name}.${componentName}.completions must be an array.`);
    }
    validatePresentationCompletions(name, componentName, completionOutput, componentSurface);
    completions[componentName] = cloneSerializable(
      completionOutput,
      `${name}.components.${componentName}.completions`,
    ) as readonly unknown[];
    const parts: Record<string, Record<string, unknown>> = {};
    for (const [part, visual] of Object.entries(output)) {
      if (part === "parameters" || part === "interactions" || part === "completions") continue;
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
    assets: { fonts: fonts.assets },
    tokens: cloneSerializable(fonts.theme, `${name}.theme`) as Record<
      string,
      Record<string, unknown>
    >,
    themes: cloneSerializable(fonts.themes, `${name}.themes`) as Record<string, unknown>,
    containers: {},
    parameters: sortRecord(parameters),
    interactions: sortRecord(interactions),
    completions: sortRecord(completions),
    components: sortRecord(components),
  };
}

function materializePresentationFonts(
  presentation: string,
  theme: Record<string, unknown>,
  themes: Record<string, unknown>,
): {
  readonly assets: Record<string, unknown>;
  readonly theme: Record<string, unknown>;
  readonly themes: Record<string, unknown>;
} {
  const assets: Record<string, unknown> = {};
  const authoredFonts = recordOrEmpty(theme.font);
  const normalizedFonts: Record<string, unknown> = {};

  const normalize = (rawValue: unknown, path: string, assetName: string): unknown => {
    const value = recordAt(rawValue, path);
    if (typeof value.token === "string") return { token: value.token };
    const { features, ...asset } = value;
    const fallback = asset.fallback;
    if (!Array.isArray(fallback) || fallback.length === 0) {
      throw new Error(`${path}.fallback requires at least one family.`);
    }
    assets[assetName] = asset;
    return { asset: assetName, ...(features === undefined ? {} : { features }) };
  };

  for (const [token, value] of Object.entries(authoredFonts)) {
    normalizedFonts[token] = normalize(value, `${presentation}.theme.font.${token}`, token);
  }

  const normalizedThemes: Record<string, unknown> = {};
  for (const [themeName, rawTheme] of Object.entries(themes)) {
    const authoredTheme = recordAt(rawTheme, `${presentation}.themes.${themeName}`);
    const authoredOverrides = recordOrEmpty(authoredTheme.font);
    const normalizedOverrides: Record<string, unknown> = {};
    for (const [token, rawOverride] of Object.entries(authoredOverrides)) {
      const path = `${presentation}.themes.${themeName}.font.${token}`;
      const override = recordAt(rawOverride, path);
      if (typeof override.token === "string") {
        normalizedOverrides[token] = { token: override.token };
        continue;
      }
      const base = recordAt(authoredFonts[token], `${presentation}.theme.font.${token}`);
      if (typeof base.token === "string") {
        throw new Error(`${path} must fully define a font because its base token is an alias.`);
      }
      normalizedOverrides[token] = normalize(
        { ...base, ...override },
        path,
        `${themeName}::${token}`,
      );
    }
    normalizedThemes[themeName] = {
      ...authoredTheme,
      ...(Object.keys(normalizedOverrides).length ? { font: normalizedOverrides } : {}),
    };
  }

  return {
    assets,
    theme: {
      ...theme,
      ...(Object.keys(normalizedFonts).length ? { font: normalizedFonts } : {}),
    },
    themes: normalizedThemes,
  };
}

function fontAssetSourcePath(presentation: string, name: string): string {
  const separator = name.indexOf("::");
  return separator < 0
    ? `${presentation}.theme.font.${name}`
    : `${presentation}.themes.${name.slice(0, separator)}.font.${name.slice(separator + 2)}`;
}

function flattenPresentationComponentFactories(
  presentation: string,
  result: Record<string, unknown>,
  surface: VisualCompilerSurface,
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  const expected = new Map<string, string>();
  for (const component of Object.keys(surface.components)) {
    expected.set(presentationComponentPath(component).join("."), component);
  }

  const visit = (value: unknown, path: readonly string[]) => {
    const node = recordAt(
      value,
      `${presentation}.components${path.length ? `.${path.join(".")}` : ""}`,
    );
    for (const [name, child] of Object.entries(node)) {
      const childPath = [...path, name];
      const authoredPath = childPath.join(".");
      if (typeof child === "function") {
        const internal = expected.get(authoredPath);
        if (!internal) {
          throw new Error(
            `${presentation}.components contains unknown component ${JSON.stringify(authoredPath)}.`,
          );
        }
        flattened[internal] = child;
        continue;
      }
      visit(child, childPath);
    }
  };

  visit(result.components, []);
  return flattened;
}

function presentationComponentPath(component: string): string[] {
  const prefix = "@feature/";
  const marker = "/component/";
  if (!component.startsWith(prefix)) return [component];
  const markerIndex = component.indexOf(marker, prefix.length);
  if (markerIndex < 0) return [component];
  const featurePath = component.slice(prefix.length, markerIndex);
  return [...featurePath.split(".").map(capitalize), component.slice(markerIndex + marker.length)];
}

function capitalize(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function featureComponentName(path: string, name: string): string {
  return `@feature/${path}/component/${name}`;
}

function collectVisualComponentsFromType(
  owner: ts.Type,
  featurePath: string,
  programName: string,
  checker: ts.TypeChecker,
  anchor: ts.Node,
  sourcePath: string,
  output: Record<
    string,
    {
      parts: Record<string, string>;
      state: Array<{ name: string; kind: string; writable?: boolean }>;
      process: Array<{ name: string; kind: string }>;
      actions: string[];
      parameters: string[];
      inputCallbacks: string[];
    }
  >,
): void {
  const programs = semanticPropertyType(owner, "Programs", checker, anchor);
  const selectedProgram = programs
    ? semanticPropertyType(programs, programName, checker, anchor)
    : undefined;
  const processType = selectedProgram
    ? semanticPropertyType(selectedProgram, "State", checker, anchor)
    : undefined;
  const process = (processType ? checker.getPropertiesOfType(processType) : []).map((value) => {
    const declared = semanticSymbolType(value, checker, anchor);
    const declaration = value.declarations?.find(ts.isPropertySignature);
    return {
      name: value.getName(),
      kind: declaration?.type
        ? (visualValueKind(declaration.type, checker) ??
          primitiveValueKind(declaration.type, checker) ??
          semanticPrimitiveKind(declared))
        : semanticPrimitiveKind(declared),
    };
  });
  const components = selectedProgram
    ? semanticPropertyType(selectedProgram, "Components", checker, anchor)
    : undefined;
  for (const member of components ? checker.getPropertiesOfType(components) : []) {
    const componentName = member.getName();
    const componentPath = featurePath
      ? `Features.${featurePath}.Programs.${programName}.Components.${componentName}`
      : `Programs.${programName}.Components.${componentName}`;
    const internalName = featurePath
      ? featureComponentName(featurePath, componentName)
      : componentName;
    if (Object.hasOwn(output, internalName)) {
      throw new Error(`${sourcePath}: duplicate visual component ${internalName}.`);
    }
    const component = semanticSymbolType(member, checker, anchor);
    const partType = semanticPropertyType(component, "Parts", checker, anchor);
    if (!partType) throw new Error(`${sourcePath}: ${componentPath}.Parts is missing.`);
    const parts = Object.fromEntries(
      checker.getPropertiesOfType(partType).flatMap((part) => {
        const values = semanticStringValues(semanticSymbolType(part, checker, anchor));
        return values.length === 1 ? [[part.getName(), values[0]!]] : [];
      }),
    );
    const stateType = semanticPropertyType(component, "State", checker, anchor);
    const state = (stateType ? checker.getPropertiesOfType(stateType) : []).map((value) => {
      const declared = semanticSymbolType(value, checker, anchor);
      const visualKind = semanticPropertyType(declared, "poggers.visualValue", checker, anchor);
      const declaration = value.declarations?.find(ts.isPropertySignature);
      const declaredKind = declaration?.type
        ? (visualValueKind(declaration.type, checker) ??
          primitiveValueKind(declaration.type, checker))
        : undefined;
      return {
        name: value.getName(),
        kind: visualKind
          ? (semanticStringValues(visualKind)[0] ?? declaredKind ?? "unknown")
          : (declaredKind ?? semanticPrimitiveKind(declared)),
      };
    });
    const actions = semanticPropertyType(component, "Actions", checker, anchor);
    const parameters = semanticPropertyType(component, "Parameters", checker, anchor);
    const input = semanticPropertyType(component, "Input", checker, anchor);
    output[internalName] = {
      parts,
      state,
      process,
      actions: actions
        ? checker.getPropertiesOfType(actions).map((action) => action.getName())
        : [],
      parameters: parameters
        ? checker.getPropertiesOfType(parameters).map((parameter) => parameter.getName())
        : [],
      inputCallbacks: input
        ? checker
            .getPropertiesOfType(input)
            .filter(
              (property) =>
                checker.getSignaturesOfType(
                  semanticSymbolType(property, checker, anchor),
                  ts.SignatureKind.Call,
                ).length > 0,
            )
            .map((property) => property.getName())
        : [],
    };
  }

  const features = semanticPropertyType(owner, "Features", checker, anchor);
  for (const feature of features ? checker.getPropertiesOfType(features) : []) {
    const name = feature.getName();
    const path = featurePath ? `${featurePath}.${name}` : name;
    collectVisualComponentsFromType(
      semanticSymbolType(feature, checker, anchor),
      path,
      programName,
      checker,
      anchor,
      sourcePath,
      output,
    );
  }
}

function collectProgramManifest(
  application: ts.Type,
  checker: ts.TypeChecker,
  anchor: ts.Node,
  sourcePath: string,
): ProgramManifest[] {
  const programs = new Map<
    string,
    {
      runtime: string;
      requires: Set<string>;
      provides: Set<string>;
      ui: boolean;
      contributions: ProgramContributionManifest[];
    }
  >();

  const visit = (owner: ts.Type, featurePath: string) => {
    const contracts = semanticPropertyType(owner, "Programs", checker, anchor);
    for (const entry of contracts ? checker.getPropertiesOfType(contracts) : []) {
      const name = entry.getName();
      const contract = semanticSymbolType(entry, checker, anchor);
      const runtime = semanticPropertyType(contract, "Runtime", checker, anchor);
      const runtimeName = runtime
        ? semanticStringValues(semanticPropertyType(runtime, "Name", checker, anchor) ?? runtime)[0]
        : undefined;
      if (!runtimeName) {
        throw new Error(`${sourcePath}: Program ${name} does not declare a literal Runtime.Name.`);
      }
      const current = programs.get(name);
      if (current && current.runtime !== runtimeName) {
        throw new Error(
          `${sourcePath}: Program ${name} mixes Runtime ${current.runtime} and ${runtimeName}.`,
        );
      }
      const target = current ?? {
        runtime: runtimeName,
        requires: new Set<string>(),
        provides: new Set<string>(),
        ui: false,
        contributions: [],
      };
      const requires = semanticPropertyType(contract, "Requires", checker, anchor);
      const provides = semanticPropertyType(contract, "Provides", checker, anchor);
      const requiredNames = (requires ? checker.getPropertiesOfType(requires) : [])
        .map((capability) => capability.getName())
        .sort();
      const providedNames = (provides ? checker.getPropertiesOfType(provides) : [])
        .map((capability) => capability.getName())
        .sort();
      for (const capability of requiredNames) target.requires.add(capability);
      for (const capability of providedNames) {
        if (target.provides.has(capability)) {
          throw new Error(
            `${sourcePath}: Program ${name} has multiple providers for Capability ${capability}.`,
          );
        }
        target.provides.add(capability);
      }
      const ui = ["State", "Actions", "Components"].some((property) =>
        Boolean(semanticPropertyType(contract, property, checker, anchor)),
      );
      target.ui ||= ui;
      target.contributions.push({
        feature: featurePath,
        requires: requiredNames,
        provides: providedNames,
        ui,
      });
      programs.set(name, target);
    }

    const features = semanticPropertyType(owner, "Features", checker, anchor);
    for (const feature of features ? checker.getPropertiesOfType(features) : []) {
      const name = feature.getName();
      visit(
        semanticSymbolType(feature, checker, anchor),
        featurePath ? `${featurePath}.${name}` : name,
      );
    }
  };

  visit(application, "");
  return [...programs]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      runtime: value.runtime,
      requires: [...value.requires].sort(),
      provides: [...value.provides].sort(),
      ui: value.ui,
      contributions: value.contributions.sort((left, right) =>
        left.feature.localeCompare(right.feature),
      ),
    }));
}

function semanticPropertyType(
  owner: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  anchor: ts.Node,
): ts.Type | undefined {
  const property = checker.getPropertyOfType(owner, name);
  return property ? semanticSymbolType(property, checker, anchor) : undefined;
}

function semanticSymbolType(symbol: ts.Symbol, checker: ts.TypeChecker, anchor: ts.Node): ts.Type {
  return checker.getNonNullableType(
    checker.getTypeOfSymbolAtLocation(
      symbol,
      symbol.valueDeclaration ?? symbol.declarations?.[0] ?? anchor,
    ),
  );
}

function semanticStringValues(type: ts.Type): string[] {
  const values = type.isUnion() ? type.types : [type];
  return values.flatMap((value) => (value.isStringLiteral() ? [value.value] : []));
}

function semanticPrimitiveKind(type: ts.Type): string {
  const values = type.isUnion() ? type.types : [type];
  if (values.length && values.every((value) => Boolean(value.flags & ts.TypeFlags.BooleanLike))) {
    return "boolean";
  }
  if (values.length && values.every((value) => Boolean(value.flags & ts.TypeFlags.NumberLike))) {
    return "number";
  }
  if (values.length && values.every((value) => Boolean(value.flags & ts.TypeFlags.StringLike))) {
    return "string";
  }
  return "unknown";
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
  presentation: string,
): void {
  for (const reference of references) {
    const [group, token] = reference.split(".");
    const definitions = group ? recordOrEmpty(theme[group]) : {};
    if (!token || !Object.hasOwn(definitions, token)) {
      throw new Error(
        `${presentation} references token ${reference}, but its theme does not define it.`,
      );
    }
  }
}

function visualComponentScope(
  component: string,
  surface: VisualCompilerSurface["components"][string],
): Record<string, unknown> {
  const state = Object.fromEntries(
    surface.state.map(({ name, kind }) => [
      name,
      kind === "boolean"
        ? condition({ source: "value", component, name })
        : kind === "number" || isVisualNumberKind(kind)
          ? numberExpression({ source: "value", component, name, kind })
          : expression({ source: "value", component, name, kind }),
    ]),
  );
  const process = Object.fromEntries(
    (surface.process ?? []).map(({ name, kind }) => [
      name,
      kind === "boolean"
        ? condition({ source: "process", component, name })
        : kind === "number" || isVisualNumberKind(kind)
          ? numberExpression({ source: "process", component, name, kind })
          : expression({ source: "process", component, name, kind }),
    ]),
  );
  const actions = Object.fromEntries(
    (surface.actions ?? []).map((name) => [name, { $visual: "event", component, name }]),
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
  return { process, state, actions, parts, interaction, geometry, environment };
}

function validatePresentationInteractions(
  presentation: string,
  component: string,
  interactions: readonly unknown[],
  surface: VisualCompilerSurface["components"][string],
): void {
  const actions = new Set(surface.actions ?? []);
  interactions.forEach((value, index) => {
    const path = `${presentation}.${component}.interactions[${index}]`;
    const interaction = recordAt(value, path);
    if (interaction.type !== "drag") throw new Error(`${path}.type must be "drag".`);
    const trigger = visualReference(interaction.trigger, "part", `${path}.trigger`);
    if (!Object.hasOwn(surface.parts, trigger)) {
      throw new Error(`${path}.trigger references unknown Part ${JSON.stringify(trigger)}.`);
    }
    for (const eventField of ["start", "change", "release", "cancel"] as const) {
      if (interaction[eventField] === undefined) {
        if (eventField === "change" || eventField === "release") {
          throw new Error(`${path}.${eventField} is required.`);
        }
        continue;
      }
      const event = visualReference(interaction[eventField], "event", `${path}.${eventField}`);
      if (!actions.has(event)) {
        throw new Error(
          `${path}.${eventField} references unknown Action ${JSON.stringify(event)}.`,
        );
      }
    }
  });
}

function validatePresentationCompletions(
  presentation: string,
  component: string,
  completions: readonly unknown[],
  surface: VisualCompilerSurface["components"][string],
): void {
  const actions = new Set(surface.actions ?? []);
  completions.forEach((value, index) => {
    const path = `${presentation}.${component}.completions[${index}]`;
    const completion = recordAt(value, path);
    if (completion.when === undefined) throw new Error(`${path}.when is required.`);
    const action = visualReference(completion.action, "event", `${path}.action`);
    if (!actions.has(action)) {
      throw new Error(`${path}.action references unknown Action ${JSON.stringify(action)}.`);
    }
  });
}

function visualReference(value: unknown, kind: "event" | "part", path: string): string {
  const reference = recordAt(value, path);
  if (reference.$visual !== kind || typeof reference.name !== "string") {
    throw new Error(`${path} must reference a component ${kind === "event" ? "Action" : "Part"}.`);
  }
  return reference.name;
}

function expression(value: SymbolicRecord): SymbolicRecord {
  const node = { $visual: "expression", ...value };
  Object.defineProperty(node, "is", {
    enumerable: false,
    value: (right: unknown) => condition({ operation: "equal", left: node, right }),
  });
  return node;
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
  presentation: string,
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
    throw new Error(`${presentation}.tokens contains unused tokens: ${dead.sort().join(", ")}.`);
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stableVisualJson(value: unknown): string {
  return `${JSON.stringify(cloneSerializable(value, "visual presentation"), null, 2)}\n`;
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
  return value == null ? {} : recordAt(value, "visual presentation field");
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function typeLiteral(node: ts.TypeNode, checker: ts.TypeChecker, path: string): ts.TypeLiteralNode {
  const resolved = resolveTypeNode(node, checker, new Set());
  if (ts.isTypeLiteralNode(resolved)) return resolved;
  const expanded = checker.typeToTypeNode(
    checker.getTypeFromTypeNode(resolved),
    undefined,
    ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.InTypeAlias,
  );
  if (expanded && ts.isTypeLiteralNode(expanded)) return expanded;
  const type = checker.getTypeFromTypeNode(resolved);
  if (type.flags & ts.TypeFlags.Object) {
    const members = checker.getPropertiesOfType(type).flatMap((property) => {
      const location = property.valueDeclaration ?? property.declarations?.[0] ?? resolved;
      const propertyType = checker.typeToTypeNode(
        checker.getTypeOfSymbolAtLocation(property, location),
        undefined,
        ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.InTypeAlias,
      );
      if (!propertyType) return [];
      return [
        ts.factory.createPropertySignature(
          undefined,
          ts.factory.createStringLiteral(property.getName()),
          property.flags & ts.SymbolFlags.Optional
            ? ts.factory.createToken(ts.SyntaxKind.QuestionToken)
            : undefined,
          propertyType,
        ),
      ];
    });
    return ts.factory.createTypeLiteralNode(members);
  }
  throw new Error(
    `${path} must be an object type; received ${checker.typeToString(type)} (${type.flags}).`,
  );
}

function resolveTypeNode(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  seen: Set<string>,
): ts.TypeNode {
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return node;
  let symbol = checker.getSymbolAtLocation(node.typeName);
  if (!symbol) return node;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
  if (!declaration || declaration.getSourceFile().isDeclarationFile) return node;
  const key = `${declaration.getSourceFile().fileName}:${declaration.name.text}`;
  if (seen.has(key)) {
    throw new Error(`Circular type alias ${declaration.name.text} in visual app contract.`);
  }
  seen.add(key);
  return resolveTypeNode(declaration.type, checker, seen);
}

function propertyTypeLiteral(
  owner: ts.TypeLiteralNode,
  name: string,
  checker: ts.TypeChecker,
  path: string,
): ts.TypeLiteralNode {
  return typeLiteral(propertyTypeNode(owner, name, path), checker, path);
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
  checker: ts.TypeChecker,
  fallback: readonly string[],
): string[] {
  const member = owner.members.find(
    (candidate): candidate is ts.PropertySignature =>
      ts.isPropertySignature(candidate) && propertyName(candidate.name) === name,
  );
  return member?.type ? stringLiteralUnion(member.type, checker) : [...fallback];
}

function stringLiteralUnion(node: ts.TypeNode, checker: ts.TypeChecker): string[] {
  const resolved = resolveTypeNode(node, checker, new Set());
  const nodes = ts.isUnionTypeNode(resolved) ? resolved.types : [resolved];
  return nodes.flatMap((candidate) => {
    if (!ts.isLiteralTypeNode(candidate) || !ts.isStringLiteral(candidate.literal)) return [];
    return [candidate.literal.text];
  });
}

function visualValueKind(node: ts.TypeNode, checker: ts.TypeChecker): string | undefined {
  const resolved = resolveTypeNode(node, checker, new Set());
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

function primitiveValueKind(node: ts.TypeNode, checker: ts.TypeChecker): string {
  const resolved = resolveTypeNode(node, checker, new Set());
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
