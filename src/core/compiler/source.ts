import { statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import * as ts from "@typescript/typescript6";

import {
  POGGERS_IR_VERSION,
  type CapabilityIR,
  type ComponentIR,
  type ExpressionIR,
  type FeatureIR,
  type FieldIR,
  type FunctionIR,
  type ApplicationIR,
  type ProgramIR,
  type SourceSpan,
  type StatementIR,
  type TypeIR,
} from "@/core/compiler/ir";
import { compilePresentationSource } from "@/core/compiler/presentation";

export class ApplicationDiagnostic extends Error {
  readonly span: SourceSpan;

  constructor(message: string, span: SourceSpan) {
    super(`${span.file}:${span.line}:${span.column}: ${message}`);
    this.name = "ApplicationDiagnostic";
    this.span = span;
  }
}

export type ApplicationPaths = Readonly<{
  directory: string;
  source: string;
  application: string;
}>;

export type ApplicationCompilation = Readonly<{
  ir: ApplicationIR;
  presentationSources: ReadonlySet<string>;
}>;

export type ApplicationCompiler = Readonly<{
  compile(changedFile?: string): ApplicationCompilation;
}>;

/** Resolves the one conventional Application entry without executing it. */
export function resolveApplication(directory: string): ApplicationPaths {
  const root = resolve(directory);
  const source = resolve(root, "src");
  for (const name of ["app.tsx", "app.ts"]) {
    const application = resolve(source, name);
    try {
      if (statSync(application).size > 0) return { directory: root, source, application };
    } catch {
      continue;
    }
  }
  throw new Error(`${source} must contain app.tsx or app.ts.`);
}

export function compileApplication(entry: string): ApplicationIR {
  return compileApplicationProgram(entry).compilation.ir;
}

/** Retains TypeScript's semantic graph across development compilations. */
export function createApplicationCompiler(entry: string): ApplicationCompiler {
  let previous: ts.Program | undefined;
  return {
    compile(changedFile) {
      const result = compileApplicationProgram(entry, previous, changedFile);
      previous = result.program;
      return result.compilation;
    },
  };
}

function compileApplicationProgram(
  entry: string,
  previous?: ts.Program,
  changedFile?: string,
): Readonly<{ compilation: ApplicationCompilation; program: ts.Program }> {
  const file = resolve(entry);
  const configuration = ts.findConfigFile(dirname(file), ts.sys.fileExists, "tsconfig.json");
  const configured = configuration ? readCompilerOptions(configuration) : undefined;
  const program = ts.createProgram({
    rootNames: [file],
    options: {
      ...configured,
      allowImportingTsExtensions: true,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    },
    oldProgram: previous,
  });
  const changedSource = changedFile ? program.getSourceFile(resolve(changedFile)) : undefined;
  const diagnostics = changedSource
    ? [
        ...program.getSyntacticDiagnostics(changedSource),
        ...program.getSemanticDiagnostics(changedSource),
      ]
    : ts.getPreEmitDiagnostics(program);
  const first = diagnostics.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (first) throw new Error(formatTypeScriptDiagnostic(first));

  const source = program.getSourceFile(file);
  if (!source) throw new Error(`Cannot read ${file}.`);
  const checker = program.getTypeChecker();
  const assignment = source.statements.find(ts.isExportAssignment);
  if (!assignment) throw diagnostic(source, "The application must have one default export.");
  const exported = unwrapExpression(assignment.expression);
  const applicationObject = objectExpression(checker, exported);
  if (!applicationObject)
    throw diagnostic(exported, "The default export must be an application object.");
  const contractNode = applicationContractNode(assignment.expression);
  const contract = contractNode
    ? checker.getTypeFromTypeNode(contractNode)
    : checker.getTypeAtLocation(exported);
  const featuresContract = propertyType(checker, contract, "Features", contractNode ?? exported);
  const featuresValue = objectMember(checker, applicationObject, "features");
  if (!featuresContract || !featuresValue) {
    throw diagnostic(
      applicationObject,
      "The application contract and value must declare Features.",
    );
  }

  const metadata = objectExpression(checker, objectMember(checker, applicationObject, "metadata"));
  const applicationName =
    stringMember(checker, metadata, "name") ?? source.fileName.split("/").at(-2) ?? "app";
  const features: FeatureIR[] = [];
  const programs: ProgramIR[] = [];
  extractFeatures(
    checker,
    featuresContract,
    requireObject(checker, featuresValue, "Application features must be an object."),
    "",
    features,
    programs,
  );
  validateProgramEnvironments(programs);

  const platforms = [...new Set(programs.map(({ environment }) => environment.platform))].sort();

  const root = dirname(file);
  const implementationSources = presentationImplementationSources(
    program,
    checker,
    applicationObject,
    root,
  );
  const presentationIR = [...implementationSources]
    .map((path) => {
      const implementation = program.getSourceFile(path);
      if (!implementation) throw new Error(`Cannot read Presentation source ${path}.`);
      return compilePresentationSource(implementation.text, relative(root, path)).ir;
    })
    .filter(({ animations, declarations }) => animations.length || declarations.length)
    .sort(({ file: left }, { file: right }) => left.localeCompare(right));
  const ir = normalizeSourceFiles(
    {
      version: POGGERS_IR_VERSION,
      application: {
        id: `application/${applicationName}`,
        name: applicationName,
        presentations: presentationNames(checker, contract, contractNode ?? exported),
      },
      platforms,
      features: features.sort(byId),
      programs: programs.sort(byId),
      presentations: presentationIR,
    },
    configuration ? dirname(configuration) : root,
  );
  return {
    compilation: {
      ir,
      presentationSources: implementationSources,
    },
    program,
  };
}

function validateProgramEnvironments(programs: readonly ProgramIR[]): void {
  const environments = new Map<string, ProgramIR["environment"]>();
  for (const program of programs) {
    const previous = environments.get(program.name);
    if (!previous) {
      environments.set(program.name, program.environment);
      continue;
    }
    if (JSON.stringify(previous) === JSON.stringify(program.environment)) continue;
    throw new ApplicationDiagnostic(
      `Program ${JSON.stringify(program.name)} has incompatible execution contexts ` +
        `${JSON.stringify(previous.name)} and ${JSON.stringify(program.environment.name)}.`,
      program.span,
    );
  }
}

function presentationImplementationSources(
  program: ts.Program,
  checker: ts.TypeChecker,
  application: ts.ObjectLiteralExpression,
  root: string,
): ReadonlySet<string> {
  const presentations = objectExpression(
    checker,
    objectMember(checker, application, "presentations"),
  );
  if (!presentations) return new Set();
  const sources = new Set<string>();
  const pending: ts.SourceFile[] = [];

  for (const property of presentations.properties) {
    const expression = propertyExpression(property);
    if (!expression) continue;
    for (const declaration of expressionDeclarations(checker, expression)) {
      const source = declaration.getSourceFile();
      if (source.isDeclarationFile || !inside(root, source.fileName)) continue;
      pending.push(source);
    }
  }

  while (pending.length) {
    const source = pending.pop()!;
    const file = resolve(source.fileName);
    if (sources.has(file)) continue;
    sources.add(file);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      if (
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) {
        continue;
      }
      const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
      for (const declaration of symbol?.declarations ?? []) {
        const imported = declaration.getSourceFile();
        if (!imported.isDeclarationFile && inside(root, imported.fileName)) pending.push(imported);
      }
    }
  }

  // Keep only files TypeScript actually included in this Program.
  const included = new Set(program.getSourceFiles().map((source) => resolve(source.fileName)));
  return new Set([...sources].filter((source) => included.has(source)));
}

function propertyExpression(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return undefined;
}

function expressionDeclarations(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): readonly ts.Node[] {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) {
    return [unwrapped];
  }
  let symbol =
    ts.isIdentifier(unwrapped) && ts.isShorthandPropertyAssignment(unwrapped.parent)
      ? checker.getShorthandAssignmentValueSymbol(unwrapped.parent)
      : checker.getSymbolAtLocation(
          ts.isPropertyAccessExpression(unwrapped) ? unwrapped.name : unwrapped,
        );
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations ?? [unwrapped];
}

function inside(root: string, file: string): boolean {
  const path = relative(root, resolve(file));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function extractFeatures(
  checker: ts.TypeChecker,
  contracts: ts.Type,
  values: ts.ObjectLiteralExpression | undefined,
  parent: string,
  features: FeatureIR[],
  programs: ProgramIR[],
  at: ts.Node = values!,
): void {
  for (const symbol of sortedSymbols(contracts.getProperties())) {
    const name = symbol.getName();
    const path = parent ? `${parent}.${name}` : name;
    const location = symbol.valueDeclaration ?? at;
    const contract = checker.getTypeOfSymbolAtLocation(symbol, location);
    const value = values ? resolveObjectMember(checker, values, name) : undefined;
    if (values && !value)
      throw diagnostic(values, `Feature ${JSON.stringify(path)} has no implementation.`);
    const featureValue = value ? objectExpression(checker, value) : undefined;
    const featureLocation = value ?? location;
    const programContracts = propertyType(checker, contract, "Programs", location);
    const programValues = objectExpression(
      checker,
      objectMember(checker, featureValue, "programs"),
    );
    const childContracts = propertyType(checker, contract, "Features", location);
    const childValues = objectExpression(checker, objectMember(checker, featureValue, "features"));
    const programIds: string[] = [];
    const childIds: string[] = [];

    if (programContracts) {
      if (featureValue && !programValues)
        throw diagnostic(featureValue, `Feature ${JSON.stringify(path)} needs programs.`);
      for (const programSymbol of sortedSymbols(programContracts.getProperties())) {
        const programName = programSymbol.getName();
        const id = `feature/${path}/program/${programName}`;
        const programContract = checker.getTypeOfSymbolAtLocation(
          programSymbol,
          programSymbol.valueDeclaration ?? featureLocation,
        );
        const implementation = programValues
          ? resolveObjectMember(checker, programValues, programName)
          : undefined;
        if (programValues && !implementation) {
          throw diagnostic(programValues, `Program ${JSON.stringify(id)} has no implementation.`);
        }
        const programValue = implementation ? objectExpression(checker, implementation) : undefined;
        programs.push(
          extractProgram(
            checker,
            programContract,
            programValue,
            path,
            programName,
            featureLocation,
            Boolean((value && !featureValue) || (implementation && !programValue)),
          ),
        );
        programIds.push(id);
      }
    }

    if (childContracts) {
      if (featureValue && !childValues)
        throw diagnostic(featureValue, `Feature ${JSON.stringify(path)} needs features.`);
      for (const child of sortedSymbols(childContracts.getProperties())) {
        childIds.push(`feature/${path}.${child.getName()}`);
      }
      extractFeatures(
        checker,
        childContracts,
        childValues,
        path,
        features,
        programs,
        featureLocation,
      );
    }

    features.push({
      id: `feature/${path}`,
      path,
      children: childIds.sort(),
      programs: programIds.sort(),
    });
  }
}

function extractProgram(
  checker: ts.TypeChecker,
  contract: ts.Type,
  value: ts.ObjectLiteralExpression | undefined,
  feature: string,
  name: string,
  at: ts.Node = value!,
  factory = false,
): ProgramIR {
  const location = value ?? at;
  const environment = propertyType(checker, contract, "Environment", location);
  if (!environment)
    throw diagnostic(location, `Program ${JSON.stringify(name)} has no Environment.`);
  const environmentName = literalProperty(checker, environment, "Name", location);
  const platformContract = propertyType(checker, environment, "Platform", location);
  if (!platformContract) {
    throw diagnostic(location, `Environment ${JSON.stringify(environmentName)} has no Platform.`);
  }
  const platform = literalProperty(checker, platformContract, "Name", location);
  const uiContract = propertyType(checker, environment, "UI", location);
  const ui = uiContract ? literalProperty(checker, uiContract, "Name", location) : undefined;
  const state = propertyType(checker, contract, "State", location);
  const actions = propertyType(checker, contract, "Actions", location);
  const components = propertyType(checker, contract, "Components", location);
  if (!value && (state || actions || components)) {
    throw diagnostic(
      location,
      `UI Program ${JSON.stringify(name)} must expose compiler-readable Feature metadata.`,
    );
  }
  const componentValues = objectExpression(checker, objectMember(checker, value, "components"));
  const start = value ? objectMemberDeclaration(value, "start") : undefined;
  const root = stringMember(checker, value, "root");
  const implementation = programImplementation(
    start,
    Boolean(state || actions || components),
    factory,
    location,
  );

  return {
    id: `feature/${feature}/program/${name}`,
    feature,
    name,
    environment: { name: environmentName, platform, ...(ui ? { ui } : {}) },
    requires: capabilityList(
      checker,
      propertyType(checker, contract, "Requires", location),
      location,
    ),
    provides: capabilityList(
      checker,
      propertyType(checker, contract, "Provides", location),
      location,
    ),
    ...(state || actions || components
      ? {
          ui: {
            state: state ? lowerType(checker, state, location) : emptyRecord(),
            actions: sortedSymbols(actions?.getProperties() ?? []).map((item) => item.getName()),
            components: componentList(checker, components, componentValues, location),
            ...(root ? { root } : {}),
          },
        }
      : {}),
    implementation,
    span: spanOf(location),
  };
}

function programImplementation(
  start: ts.ObjectLiteralElementLike | undefined,
  ui: boolean,
  factory: boolean,
  at: ts.Node,
): ProgramIR["implementation"] {
  if (ui || factory) return { kind: "source", span: spanOf(at) };
  if (!start) return { kind: "none" };
  try {
    return { kind: "portable", start: lowerFunction(start) };
  } catch (error) {
    if (
      error instanceof ApplicationDiagnostic &&
      /Unsupported portable (expression|statement)/.test(error.message)
    ) {
      return { kind: "source", span: spanOf(start) };
    }
    throw error;
  }
}

function capabilityList(
  checker: ts.TypeChecker,
  type: ts.Type | undefined,
  at: ts.Node,
): CapabilityIR[] {
  return sortedSymbols(type?.getProperties() ?? []).map((symbol) => ({
    name: symbol.getName(),
    type: lowerType(
      checker,
      checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at),
      at,
    ),
  }));
}

function componentList(
  checker: ts.TypeChecker,
  type: ts.Type | undefined,
  values: ts.ObjectLiteralExpression | undefined,
  at: ts.Node,
): ComponentIR[] {
  return sortedSymbols(type?.getProperties() ?? []).map((symbol) => {
    const location = symbol.valueDeclaration ?? at;
    const component = checker.getTypeOfSymbolAtLocation(symbol, location);
    const props = propertyType(checker, component, "Props", location);
    const state = propertyType(checker, component, "State", location);
    const actions = propertyType(checker, component, "Actions", location);
    const elements = propertyType(checker, component, "Elements", location);
    const implementation = values
      ? objectExpression(checker, resolveObjectMember(checker, values, symbol.getName()))
      : undefined;
    return {
      name: symbol.getName(),
      propCallbacks: sortedSymbols(props?.getProperties() ?? [])
        .filter(
          (field) =>
            checker
              .getNonNullableType(
                checker.getTypeOfSymbolAtLocation(field, field.valueDeclaration ?? location),
              )
              .getCallSignatures().length,
        )
        .map((field) => field.getName()),
      state: state ? lowerType(checker, state, location) : emptyRecord(),
      actions: sortedSymbols(actions?.getProperties() ?? []).map((action) => action.getName()),
      elements: sortedSymbols(elements?.getProperties() ?? []).map((element) => ({
        name: element.getName(),
        element: literalType(
          checker.getTypeOfSymbolAtLocation(element, element.valueDeclaration ?? location),
          element.valueDeclaration ?? location,
          `Component Element ${JSON.stringify(element.getName())}`,
        ),
      })),
      implementation: {
        state: Boolean(implementation && objectMemberDeclaration(implementation, "state")),
        actions: Boolean(implementation && objectMemberDeclaration(implementation, "actions")),
        mount: Boolean(implementation && objectMemberDeclaration(implementation, "mount")),
        view: Boolean(implementation && objectMemberDeclaration(implementation, "view")),
      },
    };
  });
}

function literalType(type: ts.Type, at: ts.Node, label: string): string {
  if (type.flags & ts.TypeFlags.StringLiteral) return (type as ts.StringLiteralType).value;
  throw diagnostic(at, `${label} must be a string literal.`);
}

function lowerType(
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
  active: Set<ts.Type> = new Set(),
): TypeIR {
  if (type.flags & ts.TypeFlags.Any) throw diagnostic(at, "Portable contracts cannot contain any.");
  if (type.flags & ts.TypeFlags.Unknown) {
    throw diagnostic(at, "Portable contracts cannot contain unresolved unknown.");
  }
  if (type.flags & ts.TypeFlags.StringLiteral) {
    return { kind: "literal", value: (type as ts.StringLiteralType).value };
  }
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    return { kind: "literal", value: (type as ts.NumberLiteralType).value };
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { kind: "literal", value: checker.typeToString(type) === "true" };
  }
  if (type.flags & ts.TypeFlags.StringLike) return primitive("string");
  if (type.flags & ts.TypeFlags.NumberLike) return primitive("number");
  if (type.flags & ts.TypeFlags.BooleanLike) return primitive("boolean");
  if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) {
    return primitive("void");
  }
  const native = nativeTypeName(type);
  if (native) return { kind: "opaque", name: native };
  if (type.isUnion()) {
    const defined = type.types.filter((item) => !(item.flags & ts.TypeFlags.Undefined));
    if (defined.length === 1 && defined.length !== type.types.length) {
      return { kind: "option", value: lowerType(checker, defined[0]!, at, active) };
    }
    return {
      kind: "union",
      variants: type.types.map((item) => lowerType(checker, item, at, active)),
    };
  }
  if (active.has(type))
    throw diagnostic(at, "Recursive portable contract types are not supported yet.");
  active.add(type);
  try {
    if (checker.isTupleType(type)) {
      const reference = type as ts.TypeReference;
      return {
        kind: "tuple",
        elements: checker
          .getTypeArguments(reference)
          .map((item) => lowerType(checker, item, at, active)),
      };
    }
    if (checker.isArrayType(type)) {
      const reference = type as ts.TypeReference;
      return {
        kind: "array",
        element: lowerType(checker, checker.getTypeArguments(reference)[0]!, at, active),
      };
    }
    if (type.symbol?.getName() === "Promise" && type.aliasTypeArguments?.[0]) {
      return { kind: "promise", value: lowerType(checker, type.aliasTypeArguments[0], at, active) };
    }
    if (type.symbol?.getName() === "Promise") {
      const argument = checker.getTypeArguments(type as ts.TypeReference)[0];
      if (argument) return { kind: "promise", value: lowerType(checker, argument, at, active) };
    }
    if (type.symbol?.getName() === "AsyncIterable") {
      const argument = checker.getTypeArguments(type as ts.TypeReference)[0];
      if (argument) return { kind: "stream", element: lowerType(checker, argument, at, active) };
    }
    const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
    if (signatures.length === 1 && type.getProperties().length === 0) {
      const signature = signatures[0]!;
      return {
        kind: "function",
        parameters: signature.parameters.map((parameter) => ({
          name: parameter.getName(),
          optional: Boolean(parameter.flags & ts.SymbolFlags.Optional),
          type: lowerType(
            checker,
            checker.getTypeOfSymbolAtLocation(parameter, parameter.valueDeclaration ?? at),
            at,
            active,
          ),
        })),
        result: lowerType(checker, signature.getReturnType(), at, active),
      };
    }
    const fields: FieldIR[] = sortedSymbols(type.getProperties()).map((symbol) => ({
      name: symbol.getName(),
      optional: Boolean(symbol.flags & ts.SymbolFlags.Optional),
      type: lowerType(
        checker,
        checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at),
        at,
        active,
      ),
    }));
    return { kind: "record", fields };
  } finally {
    active.delete(type);
  }
}

function nativeTypeName(type: ts.Type): string | undefined {
  const symbol = type.aliasSymbol ?? type.symbol;
  if (!symbol?.declarations?.length) return undefined;
  const name = symbol.getName();
  if (["Array", "ReadonlyArray", "Promise", "AsyncIterable"].includes(name)) return undefined;
  if (
    !symbol.declarations.every((declaration) => {
      const source = declaration.getSourceFile();
      return source.hasNoDefaultLib || /(^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(source.fileName);
    })
  ) {
    return undefined;
  }
  return name.startsWith("__") ? undefined : name;
}

function lowerFunction(node: ts.ObjectLiteralElementLike): FunctionIR {
  const functionLike = functionFromMember(node);
  if (!functionLike?.body)
    throw diagnostic(node, "Program start must have a statically known body.");
  if (!ts.isBlock(functionLike.body)) {
    throw diagnostic(functionLike.body, "Program start must use a block body.");
  }
  const capabilitiesName = capabilityBinding(functionLike.parameters[0]) ?? "@capabilities";
  return {
    asynchronous: Boolean(
      functionLike.modifiers?.some((item) => item.kind === ts.SyntaxKind.AsyncKeyword),
    ),
    body: lowerStatements(functionLike.body.statements, capabilitiesName),
    span: spanOf(functionLike),
  };
}

function lowerStatements(
  statements: ts.NodeArray<ts.Statement> | readonly ts.Statement[],
  capabilitiesName: string,
): StatementIR[] {
  return statements.flatMap((statement): StatementIR | readonly StatementIR[] => {
    const span = spanOf(statement);
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.map((declaration): StatementIR => {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          throw diagnostic(declaration, "Portable bindings require a name and initializer.");
        }
        return {
          kind: "let",
          name: declaration.name.text,
          mutable: (statement.declarationList.flags & ts.NodeFlags.Const) === 0,
          value: lowerExpression(declaration.initializer, capabilitiesName),
          span: spanOf(declaration),
        };
      });
    }
    if (ts.isExpressionStatement(statement)) {
      if (
        ts.isBinaryExpression(statement.expression) &&
        assignmentOperator(statement.expression.operatorToken)
      ) {
        if (!ts.isIdentifier(statement.expression.left)) {
          throw diagnostic(
            statement.expression.left,
            "Portable assignment targets must be local bindings.",
          );
        }
        return {
          kind: "assign",
          name: statement.expression.left.text,
          operator: assignmentOperator(statement.expression.operatorToken)!,
          value: lowerExpression(statement.expression.right, capabilitiesName),
          span,
        };
      }
      return {
        kind: "expression",
        expression: lowerExpression(statement.expression, capabilitiesName),
        span,
      };
    }
    if (ts.isIfStatement(statement)) {
      return {
        kind: "if",
        condition: lowerExpression(statement.expression, capabilitiesName),
        consequent: lowerStatementBody(statement.thenStatement, capabilitiesName),
        alternate: statement.elseStatement
          ? lowerStatementBody(statement.elseStatement, capabilitiesName)
          : [],
        span,
      };
    }
    if (ts.isForOfStatement(statement)) {
      const declaration = ts.isVariableDeclarationList(statement.initializer)
        ? statement.initializer.declarations[0]
        : undefined;
      if (!declaration || !ts.isIdentifier(declaration.name)) {
        throw diagnostic(statement.initializer, "Portable for-of loops require one named item.");
      }
      return {
        kind: "for-of",
        item: declaration.name.text,
        values: lowerExpression(statement.expression, capabilitiesName),
        body: lowerStatementBody(statement.statement, capabilitiesName),
        span,
      };
    }
    if (ts.isReturnStatement(statement)) {
      return {
        kind: "return",
        ...(statement.expression
          ? { value: lowerExpression(statement.expression, capabilitiesName) }
          : {}),
        span,
      };
    }
    if (ts.isBlock(statement)) return lowerStatements(statement.statements, capabilitiesName);
    throw diagnostic(statement, `Unsupported portable statement ${ts.SyntaxKind[statement.kind]}.`);
  });
}

function lowerStatementBody(statement: ts.Statement, capabilitiesName: string): StatementIR[] {
  return ts.isBlock(statement)
    ? lowerStatements(statement.statements, capabilitiesName)
    : lowerStatements([statement], capabilitiesName);
}

function lowerExpression(node: ts.Expression, capabilitiesName: string): ExpressionIR {
  const expression = unwrapExpression(node);
  if (ts.isAwaitExpression(expression)) {
    const call = lowerCapabilityCall(expression.expression, capabilitiesName);
    if (!call) throw diagnostic(expression, "Only Capability calls may be awaited.");
    return { ...call, awaited: true };
  }
  const capabilityCall = lowerCapabilityCall(expression, capabilitiesName);
  if (capabilityCall) return capabilityCall;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return { kind: "literal", value: expression.text };
  }
  if (ts.isNumericLiteral(expression)) return { kind: "literal", value: Number(expression.text) };
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: null };
  if (ts.isIdentifier(expression)) return { kind: "local", name: expression.text };
  if (ts.isArrayLiteralExpression(expression)) {
    return {
      kind: "array",
      values: expression.elements.map((item) => lowerExpression(item, capabilitiesName)),
    };
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return {
      kind: "record",
      fields: expression.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) {
          throw diagnostic(property, "Portable records require explicit properties.");
        }
        return {
          name: memberName(property)!,
          value: lowerExpression(property.initializer, capabilitiesName),
        };
      }),
    };
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return {
      kind: "property",
      value: lowerExpression(expression.expression, capabilitiesName),
      name: expression.name.text,
    };
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = binaryOperator(expression.operatorToken);
    if (!operator) throw diagnostic(expression.operatorToken, "Unsupported portable operator.");
    return {
      kind: "binary",
      operator,
      left: lowerExpression(expression.left, capabilitiesName),
      right: lowerExpression(expression.right, capabilitiesName),
    };
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    if (
      expression.operator !== ts.SyntaxKind.ExclamationToken &&
      expression.operator !== ts.SyntaxKind.MinusToken
    ) {
      throw diagnostic(expression, "Unsupported portable unary operator.");
    }
    return {
      kind: "unary",
      operator: expression.operator === ts.SyntaxKind.ExclamationToken ? "!" : "-",
      value: lowerExpression(expression.operand, capabilitiesName),
    };
  }
  if (ts.isCallExpression(expression)) {
    throw diagnostic(expression, "Portable code may call only declared Capabilities.");
  }
  throw diagnostic(
    expression,
    `Unsupported portable expression ${ts.SyntaxKind[expression.kind]}.`,
  );
}

function lowerCapabilityCall(
  node: ts.Expression,
  capabilitiesName: string,
): Extract<ExpressionIR, { kind: "capability-call" }> | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined;
  const operation = node.expression.name.text;
  const owner = node.expression.expression;
  if (!ts.isPropertyAccessExpression(owner) || !ts.isIdentifier(owner.expression)) return undefined;
  if (owner.expression.text !== capabilitiesName) return undefined;
  return {
    kind: "capability-call",
    capability: owner.name.text,
    operation,
    arguments: node.arguments.map((argument) => lowerExpression(argument, capabilitiesName)),
    awaited: false,
  };
}

function capabilityBinding(parameter: ts.ParameterDeclaration | undefined): string | undefined {
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  for (const binding of parameter.name.elements) {
    const source = binding.propertyName ? memberName(binding) : memberName(binding);
    if (source === "capabilities" && ts.isIdentifier(binding.name)) return binding.name.text;
  }
  return undefined;
}

function applicationContractNode(expression: ts.Expression): ts.TypeNode | undefined {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  if (!ts.isSatisfiesExpression(current)) return undefined;
  if (!ts.isTypeReferenceNode(current.type) || current.type.typeArguments?.length !== 1)
    return current.type;
  return current.type.typeArguments[0];
}

function presentationNames(checker: ts.TypeChecker, contract: ts.Type, at: ts.Node): string[] {
  const presentations = propertyType(checker, contract, "Presentations", at);
  if (!presentations) return [];
  if (presentations.flags & ts.TypeFlags.StringLiteral) {
    return [(presentations as ts.StringLiteralType).value];
  }
  if (presentations.isUnion()) {
    return presentations.types
      .filter((type): type is ts.StringLiteralType =>
        Boolean(type.flags & ts.TypeFlags.StringLiteral),
      )
      .map((type) => type.value)
      .sort();
  }
  return sortedSymbols(presentations.getProperties()).map((symbol) => symbol.getName());
}

function propertyType(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  at: ts.Node,
): ts.Type | undefined {
  const symbol = owner.getProperty(name);
  return symbol
    ? checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at)
    : undefined;
}

function literalProperty(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  at: ts.Node,
): string {
  const type = propertyType(checker, owner, name, at);
  if (type && type.flags & ts.TypeFlags.StringLiteral) {
    return (type as ts.StringLiteralType).value;
  }
  throw diagnostic(at, `${name} must be a string literal.`);
}

function primitive(name: "boolean" | "number" | "string" | "void"): TypeIR {
  return { kind: "primitive", name };
}

function emptyRecord(): TypeIR {
  return { kind: "record", fields: [] };
}

function sortedSymbols(symbols: readonly ts.Symbol[]): ts.Symbol[] {
  return [...symbols].sort((left, right) => left.getName().localeCompare(right.getName()));
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function assignmentOperator(
  token: ts.BinaryOperatorToken,
): "=" | "+=" | "-=" | "*=" | "/=" | undefined {
  switch (token.kind) {
    case ts.SyntaxKind.EqualsToken:
      return "=";
    case ts.SyntaxKind.PlusEqualsToken:
      return "+=";
    case ts.SyntaxKind.MinusEqualsToken:
      return "-=";
    case ts.SyntaxKind.AsteriskEqualsToken:
      return "*=";
    case ts.SyntaxKind.SlashEqualsToken:
      return "/=";
    default:
      return undefined;
  }
}

function binaryOperator(
  token: ts.BinaryOperatorToken,
): Extract<ExpressionIR, { kind: "binary" }>["operator"] | undefined {
  switch (token.kind) {
    case ts.SyntaxKind.PlusToken:
      return "+";
    case ts.SyntaxKind.MinusToken:
      return "-";
    case ts.SyntaxKind.AsteriskToken:
      return "*";
    case ts.SyntaxKind.SlashToken:
      return "/";
    case ts.SyntaxKind.PercentToken:
      return "%";
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "===";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "!==";
    case ts.SyntaxKind.LessThanToken:
      return "<";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "<=";
    case ts.SyntaxKind.GreaterThanToken:
      return ">";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return ">=";
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return "&&";
    case ts.SyntaxKind.BarBarToken:
      return "||";
    default:
      return undefined;
  }
}

function objectMember(
  checker: ts.TypeChecker,
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Expression | undefined {
  const member = object?.properties.find((property) => memberName(property) === name);
  if (!member) return undefined;
  if (ts.isPropertyAssignment(member)) return unwrapExpression(member.initializer);
  if (ts.isShorthandPropertyAssignment(member)) {
    return resolveSymbol(checker, checker.getShorthandAssignmentValueSymbol(member), member.name);
  }
  return undefined;
}

function resolveObjectMember(
  checker: ts.TypeChecker,
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  return objectMember(checker, object, name);
}

function objectMemberDeclaration(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => memberName(property) === name);
}

function stringMember(
  checker: ts.TypeChecker,
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): string | undefined {
  const value = objectMember(checker, object, name);
  return value && ts.isStringLiteral(value) ? value.text : undefined;
}

function resolveIdentifier(checker: ts.TypeChecker, identifier: ts.Identifier): ts.Expression {
  return resolveSymbol(checker, checker.getSymbolAtLocation(identifier), identifier);
}

function resolveSymbol(
  checker: ts.TypeChecker,
  sourceSymbol: ts.Symbol | undefined,
  identifier: ts.Identifier,
): ts.Expression {
  const symbol =
    sourceSymbol && sourceSymbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(sourceSymbol)
      : sourceSymbol;
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
  if (!declaration?.initializer) throw diagnostic(identifier, `Cannot resolve ${identifier.text}.`);
  return unwrapExpression(declaration.initializer);
}

function objectExpression(
  checker: ts.TypeChecker,
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined;
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return objectExpression(checker, resolveIdentifier(checker, unwrapped));
  }
  return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
}

function requireObject(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  message: string,
): ts.ObjectLiteralExpression {
  const object = objectExpression(checker, expression);
  if (!object) throw diagnostic(expression, message);
  return object;
}

function functionFromMember(
  member: ts.ObjectLiteralElementLike,
): ts.FunctionLikeDeclaration | undefined {
  if (ts.isMethodDeclaration(member)) return member;
  if (ts.isPropertyAssignment(member)) {
    const value = unwrapExpression(member.initializer);
    return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function memberName(member: ts.NamedDeclaration): string | undefined {
  const name = member.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
}

function spanOf(node: ts.Node): SourceSpan {
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: position.line + 1, column: position.character + 1 };
}

function diagnostic(node: ts.Node, message: string): ApplicationDiagnostic {
  return new ApplicationDiagnostic(message, spanOf(node));
}

function formatTypeScriptDiagnostic(item: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(item.messageText, "\n");
  if (!item.file || item.start === undefined) return message;
  const position = item.file.getLineAndCharacterOfPosition(item.start);
  return `${item.file.fileName}:${position.line + 1}:${position.character + 1}: ${message}`;
}

function readCompilerOptions(configuration: string): ts.CompilerOptions {
  const loaded = ts.readConfigFile(configuration, ts.sys.readFile);
  if (loaded.error) throw new Error(formatTypeScriptDiagnostic(loaded.error));
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    dirname(configuration),
    undefined,
    configuration,
  );
  const error = parsed.errors.find((item) => item.category === ts.DiagnosticCategory.Error);
  if (error) throw new Error(formatTypeScriptDiagnostic(error));
  return parsed.options;
}

function normalizeSourceFiles(ir: ApplicationIR, root: string): ApplicationIR {
  const normalizeSpan = (span: SourceSpan): SourceSpan => ({
    ...span,
    file: relative(root, span.file).replaceAll("\\", "/"),
  });
  const normalizeStatements = (statements: readonly StatementIR[]): StatementIR[] =>
    statements.map((statement): StatementIR => {
      if (statement.kind === "if") {
        return {
          ...statement,
          consequent: normalizeStatements(statement.consequent),
          alternate: normalizeStatements(statement.alternate),
          span: normalizeSpan(statement.span),
        };
      }
      if (statement.kind === "for-of") {
        return {
          ...statement,
          body: normalizeStatements(statement.body),
          span: normalizeSpan(statement.span),
        };
      }
      return { ...statement, span: normalizeSpan(statement.span) };
    });
  return {
    ...ir,
    programs: ir.programs.map((program) => ({
      ...program,
      span: normalizeSpan(program.span),
      implementation:
        program.implementation.kind === "portable"
          ? {
              kind: "portable",
              start: {
                ...program.implementation.start,
                span: normalizeSpan(program.implementation.start.span),
                body: normalizeStatements(program.implementation.start.body),
              },
            }
          : program.implementation.kind === "source"
            ? { kind: "source", span: normalizeSpan(program.implementation.span) }
            : program.implementation,
    })),
  };
}
