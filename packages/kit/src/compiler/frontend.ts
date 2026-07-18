import { dirname, relative, resolve } from "node:path";

import * as ts from "@typescript/typescript6";

import {
  POGGERS_IR_VERSION,
  type CapabilityIR,
  type ComponentIR,
  type ExpressionIR,
  type FeatureIR,
  type FieldIR,
  type FunctionIR,
  type ProductIR,
  type ProgramIR,
  type SourceSpan,
  type StatementIR,
  type TypeIR,
} from "./ir";

export class ProductDiagnostic extends Error {
  readonly span: SourceSpan;

  constructor(message: string, span: SourceSpan) {
    super(`${span.file}:${span.line}:${span.column}: ${message}`);
    this.name = "ProductDiagnostic";
    this.span = span;
  }
}

export function compileProduct(entry: string): ProductIR {
  const file = resolve(entry);
  const configuration = ts.findConfigFile(dirname(file), ts.sys.fileExists, "tsconfig.json");
  const configured = configuration ? readCompilerOptions(configuration) : undefined;
  const program = ts.createProgram([file], {
    ...configured,
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
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

  return normalizeSourceFiles(
    {
      version: POGGERS_IR_VERSION,
      application: {
        id: `application/${applicationName}`,
        name: applicationName,
        presentations: presentationNames(checker, contract, contractNode ?? exported),
      },
      features: features.sort(byId),
      programs: programs.sort(byId),
    },
    configuration ? dirname(configuration) : dirname(file),
  );
}

function extractFeatures(
  checker: ts.TypeChecker,
  contracts: ts.Type,
  values: ts.ObjectLiteralExpression,
  parent: string,
  features: FeatureIR[],
  programs: ProgramIR[],
): void {
  for (const symbol of sortedSymbols(contracts.getProperties())) {
    const name = symbol.getName();
    const path = parent ? `${parent}.${name}` : name;
    const contract = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? values);
    const value = resolveObjectMember(checker, values, name);
    if (!value) throw diagnostic(values, `Feature ${JSON.stringify(path)} has no implementation.`);
    const featureValue = requireObject(
      checker,
      value,
      `Feature ${JSON.stringify(path)} must be an object.`,
    );
    const programContracts = propertyType(
      checker,
      contract,
      "Programs",
      symbol.valueDeclaration ?? values,
    );
    const programValues = objectExpression(
      checker,
      objectMember(checker, featureValue, "programs"),
    );
    const childContracts = propertyType(
      checker,
      contract,
      "Features",
      symbol.valueDeclaration ?? values,
    );
    const childValues = objectExpression(checker, objectMember(checker, featureValue, "features"));
    const programIds: string[] = [];
    const childIds: string[] = [];

    if (programContracts) {
      if (!programValues)
        throw diagnostic(featureValue, `Feature ${JSON.stringify(path)} needs programs.`);
      for (const programSymbol of sortedSymbols(programContracts.getProperties())) {
        const programName = programSymbol.getName();
        const id = `feature/${path}/program/${programName}`;
        const programContract = checker.getTypeOfSymbolAtLocation(
          programSymbol,
          programSymbol.valueDeclaration ?? programValues,
        );
        const implementation = resolveObjectMember(checker, programValues, programName);
        if (!implementation) {
          throw diagnostic(programValues, `Program ${JSON.stringify(id)} has no implementation.`);
        }
        programs.push(
          extractProgram(
            checker,
            programContract,
            requireObject(
              checker,
              implementation,
              `Program ${JSON.stringify(id)} must be an object.`,
            ),
            path,
            programName,
          ),
        );
        programIds.push(id);
      }
    }

    if (childContracts) {
      if (!childValues)
        throw diagnostic(featureValue, `Feature ${JSON.stringify(path)} needs features.`);
      for (const child of sortedSymbols(childContracts.getProperties())) {
        childIds.push(`feature/${path}.${child.getName()}`);
      }
      extractFeatures(checker, childContracts, childValues, path, features, programs);
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
  value: ts.ObjectLiteralExpression,
  feature: string,
  name: string,
): ProgramIR {
  const runtime = propertyType(checker, contract, "Runtime", value);
  if (!runtime) throw diagnostic(value, `Program ${JSON.stringify(name)} has no Runtime.`);
  const runtimeName = literalProperty(checker, runtime, "Name", value);
  const platform = optionalLiteralProperty(checker, runtime, "Platform", value);
  const state = propertyType(checker, contract, "State", value);
  const actions = propertyType(checker, contract, "Actions", value);
  const components = propertyType(checker, contract, "Components", value);
  const componentValues = objectExpression(checker, objectMember(checker, value, "components"));
  const start = objectMemberDeclaration(value, "start");
  const root = stringMember(checker, value, "root");

  return {
    id: `feature/${feature}/program/${name}`,
    feature,
    name,
    runtime: { name: runtimeName, ...(platform ? { platform } : {}) },
    requires: capabilityList(checker, propertyType(checker, contract, "Requires", value), value),
    provides: capabilityList(checker, propertyType(checker, contract, "Provides", value), value),
    ...(state || actions || components
      ? {
          ui: {
            state: state ? lowerType(checker, state, value) : emptyRecord(),
            actions: sortedSymbols(actions?.getProperties() ?? []).map((item) => item.getName()),
            components: componentList(checker, components, componentValues, value),
            ...(root ? { root } : {}),
          },
        }
      : {}),
    ...(start && !state && !actions && !components ? { start: lowerFunction(start) } : {}),
    span: spanOf(value),
  };
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
    const state = propertyType(checker, component, "State", location);
    const actions = propertyType(checker, component, "Actions", location);
    const parameters = propertyType(checker, component, "Parameters", location);
    const parts = propertyType(checker, component, "Parts", location);
    const implementation = values
      ? objectExpression(checker, resolveObjectMember(checker, values, symbol.getName()))
      : undefined;
    const stateMetadata = componentState(checker, state, location);
    return {
      name: symbol.getName(),
      state: stateMetadata.type,
      actions: sortedSymbols(actions?.getProperties() ?? []).map((action) => action.getName()),
      parameters: parameters ? lowerType(checker, parameters, location) : emptyRecord(),
      visualValues: stateMetadata.visualValues,
      parts: sortedSymbols(parts?.getProperties() ?? []).map((part) => ({
        name: part.getName(),
        element: literalType(
          checker.getTypeOfSymbolAtLocation(part, part.valueDeclaration ?? location),
          part.valueDeclaration ?? location,
          `Component part ${JSON.stringify(part.getName())}`,
        ),
      })),
      implementation: {
        state: Boolean(implementation && objectMemberDeclaration(implementation, "state")),
        actions: Boolean(implementation && objectMemberDeclaration(implementation, "actions")),
        start: Boolean(implementation && objectMemberDeclaration(implementation, "start")),
        view: Boolean(implementation && objectMemberDeclaration(implementation, "view")),
      },
    };
  });
}

function componentState(
  checker: ts.TypeChecker,
  state: ts.Type | undefined,
  at: ts.Node,
): Readonly<{
  type: TypeIR;
  visualValues: readonly Readonly<{ name: string; kind: string }>[];
}> {
  if (!state) return { type: emptyRecord(), visualValues: [] };
  const visualValues: Array<{ name: string; kind: string }> = [];
  const fields = sortedSymbols(state.getProperties()).map((field): FieldIR => {
    const location = field.valueDeclaration ?? at;
    const fieldType = checker.getTypeOfSymbolAtLocation(field, location);
    const visualKind = propertyType(checker, fieldType, "poggers.visualValue", location);
    if (visualKind && visualKind.flags & ts.TypeFlags.StringLiteral) {
      visualValues.push({
        name: field.getName(),
        kind: (visualKind as ts.StringLiteralType).value,
      });
    }
    return {
      name: field.getName(),
      optional: Boolean(field.flags & ts.SymbolFlags.Optional),
      type: visualKind ? primitive("number") : lowerType(checker, fieldType, location),
    };
  });
  return { type: { kind: "record", fields }, visualValues };
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

function optionalLiteralProperty(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  at: ts.Node,
): string | undefined {
  const type = propertyType(checker, owner, name, at);
  if (!type) return undefined;
  if (type.flags & ts.TypeFlags.StringLiteral) return (type as ts.StringLiteralType).value;
  if (type.isUnion()) {
    return type.types.find((item): item is ts.StringLiteralType =>
      Boolean(item.flags & ts.TypeFlags.StringLiteral),
    )?.value;
  }
  return undefined;
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

function diagnostic(node: ts.Node, message: string): ProductDiagnostic {
  return new ProductDiagnostic(message, spanOf(node));
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

function normalizeSourceFiles(ir: ProductIR, root: string): ProductIR {
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
      ...(program.start
        ? {
            start: {
              ...program.start,
              span: normalizeSpan(program.start.span),
              body: normalizeStatements(program.start.body),
            },
          }
        : {}),
    })),
  };
}
