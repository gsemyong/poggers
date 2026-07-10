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
        readonly styleValues: readonly {
          readonly name: string;
          readonly kind: string;
        }[];
      }
    >
  >;
};

export type MaterializedVisualPreset = {
  readonly name: string;
  readonly tokens: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly themes: Readonly<Record<string, unknown>>;
  readonly containers: Readonly<Record<string, unknown>>;
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
    { parts: Record<string, string>; styleValues: Array<{ name: string; kind: string }> }
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
    const styleValuesType = optionalPropertyTypeLiteral(component, "StyleValues", aliases);
    const styleValues: Array<{ name: string; kind: string }> = [];
    for (const value of styleValuesType?.members ?? []) {
      if (!ts.isPropertySignature(value) || !value.type) continue;
      const name = propertyName(value.name);
      const kinds = stringLiteralUnion(value.type, aliases);
      if (name && kinds.length === 1) styleValues.push({ name, kind: kinds[0]! });
    }
    components[componentName] = { parts, styleValues };
  }

  const stylesType = propertyTypeLiteral(appType, "Styles", aliases, `${path}: App.Styles`);
  const presetsNode = propertyTypeNode(stylesType, "Presets", `${path}: App.Styles.Presets`);
  const presetsType = typeLiteral(presetsNode, aliases, `${path}: App.Styles.Presets`);
  const presets: VisualContractPreset[] = [];
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
        targetSource = readSourceFile(modulePath);
        const declaration = findVariableDeclaration(targetSource, imported!.imported);
        if (declaration) targetNode = declaration;
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
): MaterializedVisualPreset {
  const preset = recordAt(source, `preset ${JSON.stringify(name)}`);
  const tokens = recordAt(preset.tokens, `${name}.tokens`);
  const tokenRefs = tokenReferences(tokens);
  const componentFactory = preset.components;
  if (typeof componentFactory !== "function") {
    throw new Error(`${name}.components must be a compile-time function.`);
  }

  const componentSource = recordAt(componentFactory({ tokens: tokenRefs }), `${name}.components()`);
  const components: Record<string, Record<string, Record<string, unknown>>> = {};

  for (const [componentName, componentSurface] of Object.entries(surface.components)) {
    const componentFactory = componentSource[componentName];
    if (typeof componentFactory !== "function") {
      throw new Error(
        `${name}.components() is missing component ${JSON.stringify(componentName)}.`,
      );
    }
    const values = valueReferences(componentName, componentSurface.styleValues);
    const parts = recordAt(componentFactory({ values }), `${name}.components.${componentName}()`);
    for (const part of Object.keys(parts)) {
      if (!(part in componentSurface.parts)) {
        throw new Error(`${name}.${componentName} contains unknown part ${JSON.stringify(part)}.`);
      }
    }
    const completeParts = Object.fromEntries(
      Object.keys(componentSurface.parts).map((part) => [part, parts[part] ?? {}]),
    );
    components[componentName] = cloneSerializable(
      completeParts,
      `${name}.components.${componentName}`,
    ) as Record<string, Record<string, unknown>>;
  }

  for (const componentName of Object.keys(componentSource)) {
    if (!(componentName in surface.components)) {
      throw new Error(
        `${name}.components() contains unknown component ${JSON.stringify(componentName)}.`,
      );
    }
  }

  return {
    name,
    tokens: cloneSerializable(tokens, `${name}.tokens`) as Record<string, Record<string, unknown>>,
    themes: cloneSerializable(recordOrEmpty(preset.themes), `${name}.themes`) as Record<
      string,
      unknown
    >,
    containers: cloneSerializable(recordOrEmpty(preset.containers), `${name}.containers`) as Record<
      string,
      unknown
    >,
    components: sortRecord(components),
  };
}

export function stableVisualJson(value: unknown): string {
  return `${JSON.stringify(cloneSerializable(value, "visual preset"), null, 2)}\n`;
}

function tokenReferences(
  tokens: Record<string, unknown>,
): Record<string, Record<string, VisualReference>> {
  const refs: Record<string, Record<string, VisualReference>> = {};
  for (const [group, groupValue] of Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b))) {
    const definitions = recordAt(groupValue, `tokens.${group}`);
    refs[group] = {};
    for (const name of Object.keys(definitions).sort()) {
      refs[group]![name] = { $visual: "token", group, name };
    }
  }
  return refs;
}

function valueReferences(
  component: string,
  values: VisualCompilerSurface["components"][string]["styleValues"],
): Record<string, VisualReference> {
  const refs: Record<string, VisualReference> = {};
  for (const value of [...values].sort((a, b) => a.name.localeCompare(b.name))) {
    refs[value.name] = {
      $visual: "value",
      component,
      kind: value.kind,
      name: value.name,
    };
  }
  return refs;
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

function nodeLocation(source: ts.SourceFile, node: ts.Node): VisualSourceLocation {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: source.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}
