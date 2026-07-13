import * as ts from "@typescript/typescript6";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const factory = ts.factory;
type ComponentMethodKind = "derive" | "render";

export function transformComponentSource(
  source: string,
  fileName: string,
  options: { stripStyles?: boolean } = {},
): string {
  const result = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      inlineSourceMap: true,
      inlineSources: true,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.Preserve,
      sourceRoot: resolve(fileName, ".."),
      target: ts.ScriptTarget.ESNext,
    },
    reportDiagnostics: true,
    transformers: {
      before: [
        reactiveComponentTransformer,
        ...(options.stripStyles ? [stripAppStylesTransformer] : []),
      ],
    },
  });
  const diagnostic = result.diagnostics?.find(
    (item) => item.category === ts.DiagnosticCategory.Error,
  );
  if (diagnostic) throw new Error(formatDiagnostic(diagnostic));
  return result.outputText;
}

const stripAppStylesTransformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
  return (source) => {
    const exported = source.statements.find(ts.isExportAssignment);
    const app = exported ? unwrapObject(exported.expression) : undefined;
    if (!app) return source;
    const visit: ts.Visitor = (node) => {
      if (node === app) {
        return factory.updateObjectLiteralExpression(
          app,
          app.properties.filter((property) => memberName(property) !== "styles"),
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(source, visit) as ts.SourceFile;
  };
};

const reactiveComponentTransformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
  let componentMethodDepth = 0;
  let renderDepth = 0;
  let renderBindings = new Map<string, string>();
  let activeMethod: ts.MethodDeclaration | undefined;
  let activeMethodKind: ComponentMethodKind | undefined;
  let activeContextName = "__poggersView";
  let componentMethods = new Map<ts.MethodDeclaration, ComponentMethodKind>();

  const visit: ts.Visitor = (node) => {
    if (ts.isMethodDeclaration(node) && componentMethods.has(node)) {
      return visitComponentMethod(node, componentMethods.get(node)!);
    }

    if (componentMethodDepth === 0) return ts.visitEachChild(node, visit, context);

    if (ts.isShorthandPropertyAssignment(node) && renderBindings.has(node.name.text)) {
      return factory.createPropertyAssignment(node.name, contextBinding(node.name.text));
    }
    if (
      ts.isIdentifier(node) &&
      renderBindings.has(node.text) &&
      isReferenceIdentifier(node) &&
      !isBindingShadowed(node, node.text, activeMethod)
    ) {
      return contextBinding(node.text);
    }

    if (
      activeMethodKind === "derive" &&
      ts.isReturnStatement(node) &&
      node.parent === activeMethod?.body &&
      node.expression
    ) {
      const expression = ts.visitNode(node.expression, visit, ts.isExpression)!;
      return factory.updateReturnStatement(
        node,
        ts.isObjectLiteralExpression(expression) ? reactiveValueObject(expression) : expression,
      );
    }

    if (renderDepth === 0) return ts.visitEachChild(node, visit, context);

    if (ts.isJsxElement(node)) return visitJsxElement(node);
    if (ts.isJsxSelfClosingElement(node)) return visitSelfClosingElement(node);
    if (ts.isJsxExpression(node)) return visitJsxExpression(node);
    if (ts.isCallExpression(node) && resourceFactoryCall(node)) {
      return visitResourceFactoryCall(node);
    }

    return ts.visitEachChild(node, visit, context);
  };

  const visitComponentMethod = (
    node: ts.MethodDeclaration,
    kind: ComponentMethodKind,
  ): ts.MethodDeclaration => {
    const first = node.parameters[0];
    if (!first || !ts.isObjectBindingPattern(first.name) || !node.body) {
      const previousMethod = activeMethod;
      const previousMethodKind = activeMethodKind;
      activeMethod = node;
      activeMethodKind = kind;
      componentMethodDepth++;
      if (kind === "render") renderDepth++;
      const transformed = ts.visitEachChild(node, visit, context);
      if (kind === "render") renderDepth--;
      componentMethodDepth--;
      activeMethod = previousMethod;
      activeMethodKind = previousMethodKind;
      return transformed;
    }

    const previousBindings = renderBindings;
    const previousMethod = activeMethod;
    const previousMethodKind = activeMethodKind;
    const previousContextName = activeContextName;
    const nextBindings = new Map<string, string>();
    const retained: ts.BindingElement[] = [];
    for (const element of first.name.elements) {
      if (!element.dotDotDotToken && ts.isIdentifier(element.name) && !element.initializer) {
        const sourceName = element.propertyName
          ? propertyName(element.propertyName)
          : element.name.text;
        if (sourceName) {
          nextBindings.set(element.name.text, sourceName);
          continue;
        }
      }
      retained.push(element);
    }

    const contextNameText = kind === "render" ? "__poggersRender" : "__poggersDerive";
    const contextName = factory.createIdentifier(contextNameText);
    renderBindings = nextBindings;
    activeMethod = node;
    activeMethodKind = kind;
    activeContextName = contextNameText;
    componentMethodDepth++;
    if (kind === "render") renderDepth++;
    const body = ts.visitEachChild(node.body, visit, context);
    if (kind === "render") renderDepth--;
    componentMethodDepth--;
    renderBindings = previousBindings;
    activeMethod = previousMethod;
    activeMethodKind = previousMethodKind;
    activeContextName = previousContextName;

    const parameter = factory.updateParameterDeclaration(
      first,
      first.modifiers,
      first.dotDotDotToken,
      contextName,
      first.questionToken,
      first.type,
      first.initializer,
    );
    const statements = retained.length
      ? [
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  factory.updateObjectBindingPattern(first.name, retained),
                  undefined,
                  undefined,
                  contextName,
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
          ...body.statements,
        ]
      : body.statements;

    return factory.updateMethodDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.questionToken,
      node.typeParameters,
      factory.createNodeArray([parameter, ...node.parameters.slice(1)]),
      node.type,
      factory.updateBlock(body, statements),
    );
  };

  const contextBinding = (name: string): ts.PropertyAccessExpression => {
    return factory.createPropertyAccessExpression(
      factory.createIdentifier(activeContextName),
      renderBindings.get(name)!,
    );
  };

  const visitJsxElement = (node: ts.JsxElement): ts.VisitResult<ts.Node> => {
    const opening = visitOpeningElement(node.openingElement);
    const closing = ts.visitEachChild(node.closingElement, visit, context);
    let children = ts.visitNodes(
      node.children,
      isJsxTag(opening.tagName, "For") ? visitForChild : visit,
      ts.isJsxChild,
    );

    if (!isJsxTag(opening.tagName, "For")) {
      children = factory.createNodeArray(
        children.map((child) =>
          ts.isJsxElement(child) && isJsxTag(child.openingElement.tagName, "For")
            ? factory.createJsxExpression(undefined, lazy(child))
            : child,
        ),
      );
    }

    if (!isJsxTag(opening.tagName, "Show") || isLazyStructuralChild(children)) {
      return factory.updateJsxElement(node, opening, children, closing);
    }

    const lazyChildren = factory.createNodeArray([
      factory.createJsxExpression(undefined, lazy(fragment(children))),
    ]);
    return factory.updateJsxElement(node, opening, lazyChildren, closing);
  };

  const visitForChild = (node: ts.Node): ts.VisitResult<ts.Node> => {
    if (!ts.isJsxExpression(node) || !node.expression || !isFunction(node.expression)) {
      return visit(node)!;
    }
    const lowered = lowerForIndex(node.expression);
    return factory.updateJsxExpression(node, ts.visitNode(lowered, visit, ts.isExpression)!);
  };

  const lowerForIndex = (expression: ts.Expression): ts.Expression => {
    if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) return expression;
    const parameter = expression.parameters[1];
    if (!parameter || !ts.isIdentifier(parameter.name)) return expression;

    const authoredName = parameter.name.text;
    const reactiveIndex = factory.createUniqueName("__poggersForIndex");
    const replaceIndex: ts.Visitor = (node) => {
      if (
        ts.isShorthandPropertyAssignment(node) &&
        node.name.text === authoredName &&
        !isBindingShadowed(node.name, authoredName, expression)
      ) {
        return factory.createPropertyAssignment(
          node.name,
          factory.createCallExpression(reactiveIndex, undefined, []),
        );
      }
      if (
        ts.isIdentifier(node) &&
        node.text === authoredName &&
        isReferenceIdentifier(node) &&
        !isBindingShadowed(node, authoredName, expression)
      ) {
        return factory.createCallExpression(reactiveIndex, undefined, []);
      }
      return ts.visitEachChild(node, replaceIndex, context);
    };
    const body = ts.visitNode(expression.body, replaceIndex, ts.isConciseBody)!;
    const hiddenParameter = factory.createParameterDeclaration(undefined, undefined, reactiveIndex);
    const parameters = factory.createNodeArray([...expression.parameters, hiddenParameter]);

    return ts.isArrowFunction(expression)
      ? factory.updateArrowFunction(
          expression,
          expression.modifiers,
          expression.typeParameters,
          parameters,
          expression.type,
          expression.equalsGreaterThanToken,
          body,
        )
      : factory.updateFunctionExpression(
          expression,
          expression.modifiers,
          expression.asteriskToken,
          expression.name,
          expression.typeParameters,
          parameters,
          expression.type,
          body as ts.Block,
        );
  };

  const visitSelfClosingElement = (node: ts.JsxSelfClosingElement): ts.VisitResult<ts.Node> => {
    return factory.updateJsxSelfClosingElement(
      node,
      node.tagName,
      node.typeArguments,
      visitAttributes(node.tagName, node.attributes),
    );
  };

  const visitOpeningElement = (node: ts.JsxOpeningElement): ts.JsxOpeningElement => {
    return factory.updateJsxOpeningElement(
      node,
      node.tagName,
      node.typeArguments,
      visitAttributes(node.tagName, node.attributes),
    );
  };

  const visitAttributes = (
    tagName: ts.JsxTagNameExpression,
    attributes: ts.JsxAttributes,
  ): ts.JsxAttributes => {
    const properties = attributes.properties.map((property) => {
      if (!ts.isJsxAttribute(property) || !property.initializer) {
        return ts.visitEachChild(property, visit, context) as ts.JsxAttributeLike;
      }
      if (!ts.isJsxExpression(property.initializer) || !property.initializer.expression) {
        return property;
      }

      const expression = ts.visitNode(property.initializer.expression, visit, ts.isExpression)!;
      const name = ts.isIdentifier(property.name)
        ? property.name.text
        : `${property.name.namespace.text}:${property.name.name.text}`;
      if (isJsxTag(tagName, "Show") && name === "fallback" && !isFunction(expression)) {
        return factory.updateJsxAttribute(
          property,
          property.name,
          factory.updateJsxExpression(property.initializer, lazy(expression)),
        );
      }
      if (!shouldBindAttribute(tagName, name, expression)) {
        return factory.updateJsxAttribute(
          property,
          property.name,
          factory.updateJsxExpression(property.initializer, expression),
        );
      }

      return factory.updateJsxAttribute(
        property,
        property.name,
        factory.updateJsxExpression(property.initializer, lazy(expression)),
      );
    });
    return factory.updateJsxAttributes(attributes, properties);
  };

  const visitJsxExpression = (node: ts.JsxExpression): ts.VisitResult<ts.Node> => {
    if (!node.expression) return node;
    const expression = ts.visitNode(node.expression, visit, ts.isExpression)!;
    if (!shouldBindExpression(expression)) {
      return factory.updateJsxExpression(node, expression);
    }
    return factory.updateJsxExpression(node, lazy(expression));
  };

  const visitResourceFactoryCall = (node: ts.CallExpression): ts.VisitResult<ts.Node> => {
    const expression = ts.visitNode(node.expression, visit, ts.isExpression)!;
    const argumentsArray = node.arguments.map((argument, index) => {
      const visited = ts.visitNode(argument, visit, ts.isExpression)!;
      return index === 0 && ts.isObjectLiteralExpression(visited)
        ? reactiveObject(visited)
        : visited;
    });
    return factory.updateCallExpression(
      node,
      expression,
      node.typeArguments,
      factory.createNodeArray(argumentsArray),
    );
  };

  const reactiveObject = (node: ts.ObjectLiteralExpression): ts.ObjectLiteralExpression => {
    const properties = node.properties.map((property) => {
      if (ts.isPropertyAssignment(property) && shouldBindInput(property.initializer)) {
        return getter(property.name, property.initializer);
      }
      if (ts.isShorthandPropertyAssignment(property)) return getter(property.name, property.name);
      return property;
    });
    return factory.updateObjectLiteralExpression(node, properties);
  };

  const reactiveValueObject = (node: ts.ObjectLiteralExpression): ts.ObjectLiteralExpression => {
    const properties = node.properties.map((property) => {
      if (
        ts.isPropertyAssignment(property) &&
        !isStaticExpression(property.initializer) &&
        !isFunction(property.initializer)
      ) {
        return getter(property.name, property.initializer);
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return getter(property.name, property.name);
      }
      return property;
    });
    return factory.updateObjectLiteralExpression(node, properties);
  };

  const resourceFactoryCall = (node: ts.CallExpression): boolean => {
    if (!ts.isPropertyAccessExpression(node.expression)) return false;
    const owner = node.expression.expression;
    if (!ts.isIdentifier(owner) || isBindingShadowed(owner, owner.text, activeMethod)) return false;
    const sourceName = renderBindings.get(owner.text) ?? owner.text;
    return sourceName === "resources";
  };

  return (sourceFile) => {
    componentMethods = collectComponentMethods(sourceFile);
    return ts.visitNode(sourceFile, visit) as ts.SourceFile;
  };
};

function collectComponentMethods(
  source: ts.SourceFile,
): Map<ts.MethodDeclaration, ComponentMethodKind> {
  const methods = new Map<ts.MethodDeclaration, ComponentMethodKind>();
  const exported = source.statements.find(ts.isExportAssignment);
  const app = exported ? unwrapObject(exported.expression) : undefined;
  const components = app && objectMemberObject(app, "components");
  if (!components) return methods;

  for (const property of components.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const definition = unwrapObject(property.initializer);
    if (!definition) continue;
    for (const member of definition.properties) {
      const name = ts.isMethodDeclaration(member) && propertyName(member.name);
      if (name === "derive" || name === "render") {
        methods.set(member as ts.MethodDeclaration, name);
      }
    }
  }
  return methods;
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  return true;
}

function isBindingShadowed(
  node: ts.Identifier,
  name: string,
  activeMethod: ts.Node | undefined,
): boolean {
  for (
    let current: ts.Node | undefined = node.parent;
    current && current !== activeMethod;
    current = current.parent
  ) {
    if (
      ts.isFunctionLike(current) &&
      current.parameters.some((parameter) => bindingHasName(parameter.name, name))
    ) {
      return true;
    }
    if (
      ts.isCatchClause(current) &&
      current.variableDeclaration?.name &&
      bindingHasName(current.variableDeclaration.name, name)
    ) {
      return true;
    }
    if (
      (ts.isForStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isForOfStatement(current)) &&
      current.initializer &&
      ts.isVariableDeclarationList(current.initializer) &&
      current.initializer.declarations.some((declaration) => bindingHasName(declaration.name, name))
    ) {
      return true;
    }
    if (ts.isBlock(current) && blockDeclaresName(current, name)) return true;
  }
  return false;
}

function blockDeclaresName(block: ts.Block, name: string): boolean {
  return block.statements.some((statement) => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some((declaration) =>
        bindingHasName(declaration.name, name),
      );
    }
    return (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
    );
  });
}

function bindingHasName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingHasName(element.name, name),
  );
}

function shouldBindAttribute(
  tagName: ts.JsxTagNameExpression,
  name: string,
  expression: ts.Expression,
): boolean {
  if (isFunction(expression) || isStaticExpression(expression)) return false;
  if (
    name === "ref" ||
    name === "by" ||
    name === "press" ||
    name === "submit" ||
    name === "change" ||
    name === "highlight" ||
    name === "dismiss" ||
    name === "navigate" ||
    name.startsWith("on")
  ) {
    return false;
  }
  if (isJsxTag(tagName, "For") && name === "children") return false;
  return true;
}

function shouldBindExpression(expression: ts.Expression): boolean {
  if (isFunction(expression) || isStaticExpression(expression)) return false;
  if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)) return false;
  if (ts.isJsxFragment(expression)) return false;
  return true;
}

function shouldBindInput(expression: ts.Expression): boolean {
  if (isFunction(expression) || isStaticExpression(expression)) return false;
  return true;
}

function isFunction(expression: ts.Expression): boolean {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

function isStaticExpression(expression: ts.Expression): boolean {
  return (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  );
}

function lazy(expression: ts.Expression): ts.ArrowFunction {
  return factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    expression,
  );
}

function getter(name: ts.PropertyName, expression: ts.Expression): ts.GetAccessorDeclaration {
  return factory.createGetAccessorDeclaration(
    undefined,
    name,
    [],
    undefined,
    factory.createBlock([factory.createReturnStatement(expression)], true),
  );
}

function fragment(children: readonly ts.JsxChild[]): ts.JsxFragment {
  return factory.createJsxFragment(
    factory.createJsxOpeningFragment(),
    children,
    factory.createJsxJsxClosingFragment(),
  );
}

function isLazyStructuralChild(children: readonly ts.JsxChild[]): boolean {
  const meaningful = children.filter(
    (child) => !ts.isJsxText(child) || child.text.trim().length > 0,
  );
  return (
    meaningful.length === 1 &&
    ts.isJsxExpression(meaningful[0]!) &&
    Boolean(meaningful[0]!.expression && isFunction(meaningful[0]!.expression))
  );
}

function isJsxTag(tagName: ts.JsxTagNameExpression, expected: string): boolean {
  return ts.isIdentifier(tagName) && tagName.text === expected;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
}

export function persistentResourceSchemaSource(sourceText: string, fileName = "types.ts"): string {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>();
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      declarations.set(statement.name.text, statement);
    }
  }

  const app = declarations.get("App");
  const appMembers = app ? declarationMembers(app, declarations) : undefined;
  const resourcesNode = appMembers && memberType(appMembers, "Resources");
  const resources = resourcesNode && typeMembers(resourcesNode, declarations);
  if (!resources) return canonicalTypeText(source, app ?? source);

  const referenced = new Set<string>();
  const resourceSignatures = [...resources]
    .filter(ts.isPropertySignature)
    .flatMap((resource) => {
      const name = resource.name && propertyName(resource.name);
      const members = resource.type && typeMembers(resource.type, declarations);
      if (!name || !members) return [];
      const fields = ["Key", "State", "Events"].map((field) => {
        const type = memberType(members, field);
        if (type) collectReferencedDeclarations(type, declarations, referenced);
        return `${JSON.stringify(field)}:${type ? canonicalTypeText(source, type) : "never"}`;
      });
      return [`${JSON.stringify(name)}:{${fields.join(";")}}`];
    })
    .sort();

  const declarationSignatures = [...referenced].sort().flatMap((name) => {
    const declaration = declarations.get(name);
    return declaration ? [canonicalTypeText(source, declaration)] : [];
  });
  return `Resources:{${resourceSignatures.join(";")}}\n${declarationSignatures.join("\n")}`;
}

function declarationMembers(
  declaration: ts.TypeAliasDeclaration | ts.InterfaceDeclaration,
  declarations: Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>,
): readonly ts.TypeElement[] | undefined {
  return ts.isInterfaceDeclaration(declaration)
    ? declaration.members
    : typeMembers(declaration.type, declarations);
}

function typeMembers(
  node: ts.TypeNode,
  declarations: Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>,
  seen = new Set<string>(),
): readonly ts.TypeElement[] | undefined {
  if (ts.isTypeLiteralNode(node)) return node.members;
  if (ts.isParenthesizedTypeNode(node)) return typeMembers(node.type, declarations, seen);
  if (ts.isIntersectionTypeNode(node)) {
    const members = node.types.flatMap((type) => typeMembers(type, declarations, seen) ?? []);
    return members.length ? members : undefined;
  }
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return;
  const name = node.typeName.text;
  if (seen.has(name)) return;
  const declaration = declarations.get(name);
  if (!declaration) return;
  const nextSeen = new Set(seen).add(name);
  return ts.isInterfaceDeclaration(declaration)
    ? declaration.members
    : typeMembers(declaration.type, declarations, nextSeen);
}

function memberType(members: readonly ts.TypeElement[], name: string): ts.TypeNode | undefined {
  const member = members.find(
    (candidate): candidate is ts.PropertySignature =>
      ts.isPropertySignature(candidate) &&
      Boolean(candidate.name && propertyName(candidate.name) === name),
  );
  return member?.type;
}

function collectReferencedDeclarations(
  node: ts.Node,
  declarations: Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>,
  referenced: Set<string>,
) {
  const visit = (current: ts.Node) => {
    if (ts.isTypeReferenceNode(current) && ts.isIdentifier(current.typeName)) {
      const name = current.typeName.text;
      const declaration = declarations.get(name);
      if (declaration && !referenced.has(name)) {
        referenced.add(name);
        declaration.forEachChild(visit);
      }
    }
    current.forEachChild(visit);
  };
  visit(node);
}

function canonicalTypeText(source: ts.SourceFile, node: ts.Node): string {
  return ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Unspecified, node, source)
    .replace(/\s+/g, " ")
    .trim();
}

export type CompiledAppSurface = {
  resources: Array<{
    name: string;
    events: string[];
    views: string[];
    commands: Array<{ name: string; hasArgs: boolean; hasError: boolean; eventName?: string }>;
    doc?: string;
  }>;
  environments: Array<{ name: string; depsType: string }>;
  components: Record<
    string,
    {
      name: string;
      members: string[];
      parts: Record<string, string>;
      values: Array<{ name: string; kind?: string }>;
      hasInput: boolean;
      hasSlots: boolean;
      hasContext: boolean;
      hasStates: boolean;
      hasOutput: boolean;
      hasValues: boolean;
      hasEvents: boolean;
      input: string[];
      inputCallbacks: string[];
      context: string[];
      states: string[];
      slots: string[];
      valueNames: string[];
      parameters: string[];
      events: Array<{ name: string }>;
      tasks: string[];
      needsInput: boolean;
      doc?: string;
    }
  >;
  navigation: Array<{ name: string; hasParams: boolean; paramsType: string }>;
  presetType?: string;
  stylePresets: Array<{
    name: string;
    tokens: Array<{ group: string; name: string; kind: string }>;
    themes: string[];
    containers: Array<{ name: string; min?: string; max?: string }>;
    visual: boolean;
  }>;
};

export type AppCompilerIssue = {
  file: string;
  message: string;
  line?: number;
  column?: number;
};

const contractCache = new Map<
  string,
  {
    dependencies: Array<{ path: string; source: string }>;
    surface: CompiledAppSurface;
  }
>();

export function analyzeAppContract(path: string): CompiledAppSurface {
  const absolutePath = resolve(path);
  const sourceText = readFileSync(absolutePath, "utf8");
  const cached = contractCache.get(absolutePath);
  if (
    cached?.dependencies.every((dependency) => {
      try {
        return readFileSync(dependency.path, "utf8") === dependency.source;
      } catch {
        return false;
      }
    })
  ) {
    return cached.surface;
  }

  const program = ts.createProgram({
    rootNames: [absolutePath],
    options: {
      allowImportingTsExtensions: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    },
  });
  const source = program.getSourceFile(absolutePath);
  if (!source) throw new Error(`Cannot read app contract ${absolutePath}.`);
  const diagnostic = program.getSyntacticDiagnostics(source)[0];
  if (diagnostic) throw new Error(formatDiagnostic(diagnostic));

  const checker = program.getTypeChecker();
  const appAlias = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === "App",
  );
  if (!appAlias) throw new Error(`${absolutePath} must export a type named App.`);
  const app = checker.getTypeFromTypeNode(appAlias.type);
  const resourcesType = requiredPropertyType(checker, app, "Resources", appAlias);
  const componentsType = optionalPropertyType(checker, app, "Components", appAlias);
  const navigationType = optionalPropertyType(checker, app, "Navigation", appAlias);
  const environmentsType = optionalPropertyType(checker, app, "Environments", appAlias);
  const depsType = optionalPropertyType(checker, app, "Deps", appAlias);
  const stylesType = optionalPropertyType(checker, app, "Styles", appAlias);

  const resources = declaredProperties(checker, resourcesType).map((resource) => {
    const type = symbolType(checker, resource, appAlias);
    const events = optionalPropertyType(checker, type, "Events", appAlias);
    const views = optionalPropertyType(checker, type, "Views", appAlias);
    const commands = optionalPropertyType(checker, type, "Commands", appAlias);
    return {
      name: resource.getName(),
      events: propertyNames(checker, events),
      views: propertyNames(checker, views),
      commands: declaredProperties(checker, commands).map((command) => {
        const commandType = symbolType(checker, command, appAlias);
        return {
          name: command.getName(),
          hasArgs: Boolean(propertySymbol(checker, commandType, "args")),
          hasError: Boolean(propertySymbol(checker, commandType, "error")),
          eventName: stringValues(optionalPropertyType(checker, commandType, "event", appAlias))[0],
        };
      }),
      doc: symbolDocumentation(checker, resource),
    };
  });

  const components: CompiledAppSurface["components"] = {};
  for (const component of declaredProperties(checker, componentsType)) {
    const name = component.getName();
    const type = symbolType(checker, component, appAlias);
    const input = optionalPropertyType(checker, type, "Input", appAlias);
    const context = optionalPropertyType(checker, type, "Context", appAlias);
    const states = optionalPropertyType(checker, type, "States", appAlias);
    const output = optionalPropertyType(checker, type, "Output", appAlias);
    const values = optionalPropertyType(checker, type, "Values", appAlias);
    const events = optionalPropertyType(checker, type, "Events", appAlias);
    const parameters = optionalPropertyType(checker, type, "Parameters", appAlias);
    const tasks = optionalPropertyType(checker, type, "Tasks", appAlias);
    const slots = optionalPropertyType(checker, type, "Slots", appAlias);
    const parts = requiredPropertyType(checker, type, "Parts", appAlias);
    const partEntries = Object.fromEntries(
      declaredProperties(checker, parts).flatMap((part) => {
        const values = stringValues(symbolType(checker, part, appAlias));
        return values.length === 1 ? [[part.getName(), values[0]!]] : [];
      }),
    );
    const valueEntries = declaredProperties(checker, values).map((value) => {
      const valueType = symbolType(checker, value, appAlias);
      const rendered = checker.typeToString(valueType);
      return {
        name: value.getName(),
        kind: /VisualValue<"([^"]+)">/.exec(rendered)?.[1],
      };
    });
    const inputEntries = declaredProperties(checker, input);
    components[name] = {
      name,
      members: propertyNames(checker, type),
      parts: partEntries,
      values: valueEntries,
      hasInput: Boolean(input),
      hasSlots: Boolean(slots),
      hasContext: Boolean(context),
      hasStates: Boolean(states),
      hasOutput: Boolean(output),
      hasValues: Boolean(values),
      hasEvents: Boolean(events),
      input: inputEntries.map((entry) => entry.getName()),
      inputCallbacks: inputEntries
        .filter(
          (entry) =>
            checker.getSignaturesOfType(symbolType(checker, entry, appAlias), ts.SignatureKind.Call)
              .length > 0,
        )
        .map((entry) => entry.getName()),
      context: propertyNames(checker, context),
      states: stringValues(states),
      slots: propertyNames(checker, slots),
      valueNames: propertyNames(checker, values),
      parameters: propertyNames(checker, parameters),
      events: propertyNames(checker, events).map((eventName) => ({ name: eventName })),
      tasks: propertyNames(checker, tasks),
      needsInput: Boolean(input),
      doc: symbolDocumentation(checker, component),
    };
  }

  const navigation = navigationType
    ? declaredProperties(checker, navigationType).map((screen) => {
        const type = symbolType(checker, screen, appAlias);
        return {
          name: screen.getName(),
          hasParams: declaredProperties(checker, type).length > 0,
          paramsType: `AppSpec["Navigation"][${JSON.stringify(screen.getName())}]`,
        };
      })
    : [{ name: "home", hasParams: false, paramsType: "EmptyObject" }];

  const environments = environmentsType
    ? declaredProperties(checker, environmentsType).map((environment) => ({
        name: environment.getName(),
        depsType: `AppSpec["Environments"][${JSON.stringify(environment.getName())}] extends { Deps: infer Deps } ? Deps : EmptyObject`,
      }))
    : depsType
      ? [
          {
            name: "server",
            depsType: "AppSpec extends { Deps: infer Deps } ? Deps : EmptyObject",
          },
        ]
      : [];

  const presetsType = stylesType
    ? optionalPropertyType(checker, stylesType, "Presets", appAlias)
    : undefined;
  const presetLiterals = stringValues(presetsType);
  const presetSymbols = presetLiterals.length ? [] : declaredProperties(checker, presetsType);
  const stylePresets = presetSymbols.map((preset) => {
    const presetName = preset.getName();
    const type = symbolType(checker, preset, appAlias);
    const tokensType = optionalPropertyType(checker, type, "Tokens", appAlias);
    const tokens: Array<{ group: string; name: string; kind: string }> = [];
    for (const group of declaredProperties(checker, tokensType)) {
      const groupName = group.getName();
      const groupType = symbolType(checker, group, appAlias);
      const names = stringValues(groupType);
      if (names.length) {
        for (const tokenName of names)
          tokens.push({ group: groupName, name: tokenName, kind: groupName });
        continue;
      }
      for (const token of declaredProperties(checker, groupType)) {
        tokens.push({
          group: groupName,
          name: token.getName(),
          kind: stringValues(symbolType(checker, token, appAlias))[0] ?? groupName,
        });
      }
    }
    const themes = stringValues(optionalPropertyType(checker, type, "Themes", appAlias));
    const containersType = optionalPropertyType(checker, type, "Containers", appAlias);
    const containerNames = stringValues(containersType);
    const containers = containerNames.length
      ? containerNames.map((containerName) => ({ name: containerName }))
      : declaredProperties(checker, containersType).map((container) => {
          const containerType = symbolType(checker, container, appAlias);
          return {
            name: container.getName(),
            min: stringValues(optionalPropertyType(checker, containerType, "min", appAlias))[0],
            max: stringValues(optionalPropertyType(checker, containerType, "max", appAlias))[0],
          };
        });
    return { name: presetName, tokens, themes, containers, visual: tokens.length > 0 };
  });

  const presetNames = presetLiterals.length
    ? presetLiterals
    : presetSymbols.map((preset) => preset.getName());
  const surface: CompiledAppSurface = {
    resources,
    environments,
    components,
    navigation,
    presetType: presetNames.length
      ? presetNames.map((name) => JSON.stringify(name)).join(" | ")
      : undefined,
    stylePresets,
  };
  const dependencies = program
    .getSourceFiles()
    .filter(
      (dependency) =>
        !dependency.isDeclarationFile &&
        !dependency.fileName.includes("/node_modules/") &&
        !dependency.fileName.includes("\\node_modules\\"),
    )
    .map((dependency) => ({ path: dependency.fileName, source: dependency.text }));
  if (!dependencies.some((dependency) => resolve(dependency.path) === absolutePath)) {
    dependencies.push({ path: absolutePath, source: sourceText });
  }
  contractCache.set(absolutePath, { dependencies, surface });
  return surface;
}

export function analyzeAppContractConventions(
  path: string,
  surface: CompiledAppSurface,
): AppCompilerIssue[] {
  const issues: AppCompilerIssue[] = [];
  for (const component of Object.values(surface.components)) {
    const allowedMembers = new Set([
      "Input",
      "Context",
      "States",
      "Output",
      "Values",
      "Events",
      "Parameters",
      "Tasks",
      "Slots",
      "Parts",
    ]);
    for (const member of component.members) {
      if (!allowedMembers.has(member)) {
        issues.push({
          file: path,
          message: `component ${component.name} declares unsupported member ${member}.`,
        });
      }
    }
    for (const input of component.input) {
      if (input === "state" || input === "variants") {
        issues.push({
          file: path,
          message: `component ${component.name} input ${input} is reserved by component props.`,
        });
      }
    }
    const values = new Set(component.valueNames);
    const events = new Set(component.events.map((event) => event.name));
    const parameters = new Set(component.parameters);
    const slots = new Set(component.slots);
    const parts = new Set(Object.keys(component.parts));
    for (const slot of slots) {
      if (values.has(slot) || events.has(slot) || parameters.has(slot) || parts.has(slot)) {
        issues.push({
          file: path,
          message: `component ${component.name} slot ${slot} collides with another component member.`,
        });
      }
    }
    for (const value of values) {
      if (events.has(value) || parameters.has(value) || parts.has(value)) {
        issues.push({
          file: path,
          message: `component ${component.name} value ${value} collides with another component member.`,
        });
      }
    }
    for (const event of events) {
      if (!/^[a-z][A-Za-z0-9]*$/.test(event)) {
        issues.push({
          file: path,
          message: `component ${component.name} event ${event} must be a camelCase verb name.`,
        });
      }
      if (parts.has(event)) {
        issues.push({
          file: path,
          message: `component ${component.name} event ${event} collides with a component part.`,
        });
      }
    }
    for (const parameter of parameters) {
      if (values.has(parameter) || events.has(parameter) || parts.has(parameter)) {
        issues.push({
          file: path,
          message: `component ${component.name} parameter ${parameter} collides with another component member.`,
        });
      }
    }
    for (const part of parts) {
      if (!/^[A-Z]/.test(part)) {
        issues.push({
          file: path,
          message: `component ${component.name} part ${part} must be PascalCase.`,
        });
      }
    }
  }
  return issues;
}

export function analyzeAppDefinition(
  path: string,
  surface: CompiledAppSurface,
): AppCompilerIssue[] {
  const absolutePath = resolve(path);
  const sourceText = readFileSync(absolutePath, "utf8");
  const source = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics;
  const issues: AppCompilerIssue[] = (parseDiagnostics ?? []).map((diagnostic) =>
    issueFromDiagnostic(source, diagnostic),
  );
  if (!absolutePath.endsWith("app.tsx")) {
    issues.push({ file: absolutePath, message: "Poggers applications must use src/app.tsx." });
  }

  const exported = source.statements.find(ts.isExportAssignment);
  const app = exported ? unwrapObject(exported.expression) : undefined;
  if (!app) {
    issues.push({ file: absolutePath, message: "app.tsx must default-export one app object." });
    return issues;
  }

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (specifier === "@poggers/app") {
      issues.push(
        issueAt(
          source,
          statement,
          "@poggers/app is internal; import public types from @poggers/kit.",
        ),
      );
    }
    if (
      specifier === "@stylexjs/stylex" ||
      specifier === "@chenglou/pretext" ||
      specifier === "@tanstack/virtual-core" ||
      specifier.startsWith("@poggers/kit/internal/")
    ) {
      issues.push(
        issueAt(source, statement, `${specifier} is owned by presets and the Poggers runtime.`),
      );
    }
  }

  const components = objectMemberObject(app, "components");
  if (Object.keys(surface.components).length && !components) {
    issues.push({ file: absolutePath, message: "app.tsx must define all contracted components." });
  }

  for (const [componentName, component] of Object.entries(surface.components)) {
    const definition = components && objectMemberObject(components, componentName);
    if (!definition) {
      issues.push({
        file: absolutePath,
        message: `component ${componentName} is missing its render method.`,
      });
      continue;
    }
    for (const obsolete of [
      "ui",
      "bind",
      "view",
      "machine",
      "derived",
      "effects",
      "delays",
      "guards",
    ]) {
      const member = definition.properties.find((candidate) => memberName(candidate) === obsolete);
      if (member) {
        issues.push(
          issueAt(source, member, `component ${componentName} must not define ${obsolete}.`),
        );
      }
    }
    validateComponentStatechart(source, componentName, component, definition, issues);
    const renders = definition.properties.filter(
      (member) => memberName(member) === "render" && ts.isMethodDeclaration(member),
    ) as ts.MethodDeclaration[];
    if (renders.length !== 1) {
      issues.push(
        issueAt(
          source,
          definition,
          `component ${componentName} must define exactly one inline render method.`,
        ),
      );
      continue;
    }
    validateRenderParts(source, componentName, component.parts, renders[0]!, issues);
    validateRenderComposition(source, componentName, renders[0]!, issues);
  }

  const root = objectMemberExpression(app, "root");
  if (Object.keys(surface.components).length) {
    if (!root || !ts.isStringLiteral(root)) {
      issues.push({ file: absolutePath, message: "app.tsx root must name a component." });
    } else if (!surface.components[root.text]) {
      issues.push(issueAt(source, root, `root names unknown component ${root.text}.`));
    } else if (surface.components[root.text]!.needsInput) {
      issues.push(issueAt(source, root, `root component ${root.text} requires creation input.`));
    }
  }

  walk(source, (node) => {
    if (ts.isJsxAttribute(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
      if (name === "class" || name === "className" || name === "style") {
        issues.push(issueAt(source, node, `${name} is visual and belongs in presets.`));
      }
    }
  });

  return issues;
}

function validateComponentStatechart(
  source: ts.SourceFile,
  componentName: string,
  component: CompiledAppSurface["components"][string],
  definition: ts.ObjectLiteralExpression,
  issues: AppCompilerIssue[],
) {
  const states = objectMemberObject(definition, "states");
  if (!component.hasStates) {
    if (component.hasEvents && !objectMemberObject(definition, "on")) {
      issues.push(
        issueAt(source, definition, `component ${componentName} events need root on transitions.`),
      );
    }
    return;
  }
  if (!states) {
    issues.push(issueAt(source, definition, `component ${componentName} needs inline states.`));
    return;
  }

  const nodes = collectStatechartNodes(source, componentName, definition, issues);
  const declaredStates = new Set(component.states);
  for (const [path, node] of nodes) {
    if (!declaredStates.has(path)) {
      issues.push(
        issueAt(source, node, `component ${componentName} state ${path} is absent from States.`),
      );
    }
  }
  for (const state of declaredStates) {
    if (!nodes.has(state)) {
      issues.push(
        issueAt(
          source,
          definition,
          `component ${componentName} States member ${state} is absent from its statechart.`,
        ),
      );
    }
  }

  const events = new Set(component.events.map((event) => event.name));
  const acceptedEvents = new Set(events);
  const tasks = new Set(component.tasks);
  const seenEvents = new Set<string>();
  const seenTasks = new Set<string>();
  const transitionTargets = new Map<string, Set<string>>();
  const validateTransition = (expression: ts.Expression, label: string) =>
    validateStatechartTransition(source, componentName, expression, label, declaredStates, issues);

  for (const [path, node] of [["", definition] as const, ...nodes]) {
    const transition = (expression: ts.Expression, suffix: string) => {
      validateTransition(expression, `${path || "<root>"}.${suffix}`);
      const targets = transitionTargets.get(path) ?? new Set<string>();
      for (const target of statechartTransitionTargets(expression)) targets.add(target);
      transitionTargets.set(path, targets);
    };
    const on = objectMemberObject(node, "on");
    for (const member of on?.properties ?? []) {
      const event = memberName(member);
      const expression = propertyValue(member);
      if (!event || !expression) continue;
      seenEvents.add(event);
      if (!acceptedEvents.has(event)) {
        issues.push(
          issueAt(
            source,
            member,
            `component ${componentName} statechart handles undeclared event ${event}.`,
          ),
        );
      }
      transition(expression, `on.${event}`);
    }
    const always = objectMemberExpression(node, "always");
    if (always) transition(always, "always");
    const done = objectMemberExpression(node, "done");
    if (done) transition(done, "done");
    const after = objectMemberExpression(node, "after");
    if (after) {
      for (const delayed of arrayOrSingleExpressions(after)) {
        const delayedObject = unwrapObject(delayed);
        if (!delayedObject || !objectMemberExpression(delayedObject, "wait")) {
          issues.push(
            issueAt(source, delayed, `component ${componentName} after transition needs wait.`),
          );
        }
        transition(delayed, "after");
      }
    }
    const task = objectMemberExpression(node, "task");
    if (task) {
      for (const invocation of arrayOrSingleExpressions(task)) {
        const taskObject = unwrapObject(invocation);
        const run = taskObject && objectMemberExpression(taskObject, "run");
        if (!run || !ts.isStringLiteral(run)) {
          issues.push(
            issueAt(source, run ?? invocation, `component ${componentName} task needs run.`),
          );
          continue;
        }
        seenTasks.add(run.text);
        if (!tasks.has(run.text)) {
          issues.push(
            issueAt(source, run, `component ${componentName} runs undeclared task ${run.text}.`),
          );
        }
        const done = objectMemberExpression(taskObject!, "done");
        const fail = objectMemberExpression(taskObject!, "fail");
        if (done) transition(done, `task.${run.text}.done`);
        if (fail) transition(fail, `task.${run.text}.fail`);
      }
    }
    const settle = objectMemberExpression(node, "settle");
    if (settle) {
      const invocation = unwrapObject(settle);
      const phase = invocation && objectMemberExpression(invocation, "phase");
      if (
        !phase ||
        !ts.isStringLiteral(phase) ||
        (phase.text !== "enter" && phase.text !== "exit")
      ) {
        issues.push(
          issueAt(
            source,
            phase ?? settle,
            `component ${componentName} settlement needs enter or exit phase.`,
          ),
        );
      }
      const completed = invocation && objectMemberExpression(invocation, "done");
      const cancelled = invocation && objectMemberExpression(invocation, "cancelled");
      if (completed)
        transition(completed, `settle.${phase ? literalString(phase) : "unknown"}.done`);
      if (cancelled)
        transition(cancelled, `settle.${phase ? literalString(phase) : "unknown"}.cancelled`);
    }
  }

  validateStatechartReachability(
    source,
    componentName,
    definition,
    nodes,
    transitionTargets,
    issues,
  );

  for (const event of events) {
    if (!seenEvents.has(event)) {
      issues.push(
        issueAt(source, definition, `component ${componentName} event ${event} has no transition.`),
      );
    }
  }
  for (const task of tasks) {
    if (!seenTasks.has(task)) {
      issues.push(
        issueAt(source, definition, `component ${componentName} task ${task} is unused.`),
      );
    }
  }
}

function arrayOrSingleExpressions(expression: ts.Expression): ts.Expression[] {
  const value = unwrapExpression(expression);
  return ts.isArrayLiteralExpression(value)
    ? value.elements.filter((item): item is ts.Expression => !ts.isSpreadElement(item))
    : [value];
}

function validateStatechartReachability(
  source: ts.SourceFile,
  componentName: string,
  statechart: ts.ObjectLiteralExpression,
  nodes: ReadonlyMap<string, ts.ObjectLiteralExpression>,
  transitions: ReadonlyMap<string, ReadonlySet<string>>,
  issues: AppCompilerIssue[],
) {
  const all = new Map<string, ts.ObjectLiteralExpression>([["", statechart], ...nodes]);
  const reachable = new Set<string>([""]);
  const activate = (path: string) => {
    if (!all.has(path)) return;
    if (path) {
      const segments = path.split(".");
      for (let length = 1; length <= segments.length; length++) {
        reachable.add(segments.slice(0, length).join("."));
      }
    }
    const node = all.get(path)!;
    const children = directStatechartChildren(node, path, nodes);
    if (statechartNodeType(node) === "parallel") {
      for (const child of children) {
        activate(child);
      }
      return;
    }
    const initial = objectMemberExpression(node, "initial");
    const initialName = initial && literalString(initial);
    if (initialName)
      activate(
        initialName.includes(".") ? initialName : path ? `${path}.${initialName}` : initialName,
      );
  };

  activate("");
  let changed = true;
  while (changed) {
    const before = reachable.size;
    for (const [sourcePath, targets] of transitions) {
      if (!reachable.has(sourcePath)) continue;
      for (const target of targets) activate(target);
    }
    changed = reachable.size !== before;
  }

  for (const [path, node] of nodes) {
    if (reachable.has(path)) continue;
    issues.push(issueAt(source, node, `component ${componentName} state ${path} is unreachable.`));
  }
}

function directStatechartChildren(
  node: ts.ObjectLiteralExpression,
  parent: string,
  nodes: ReadonlyMap<string, ts.ObjectLiteralExpression>,
): string[] {
  const prefix = parent ? `${parent}.` : "";
  const depth = parent ? parent.split(".").length + 1 : 1;
  return [...nodes.keys()].filter(
    (path) => path.startsWith(prefix) && path.split(".").length === depth,
  );
}

function statechartNodeType(node: ts.ObjectLiteralExpression): string {
  const explicit = objectMemberExpression(node, "type");
  if (explicit) return literalString(explicit) ?? "invalid";
  return objectMemberObject(node, "states")?.properties.length ? "compound" : "atomic";
}

function statechartTransitionTargets(sourceExpression: ts.Expression): string[] {
  const expression = unwrapExpression(sourceExpression);
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((item) =>
      ts.isSpreadElement(item) ? [] : statechartTransitionTargets(item),
    );
  }
  if (ts.isStringLiteral(expression)) return [expression.text];
  const transition = unwrapObject(expression);
  const target = transition && objectMemberExpression(transition, "target");
  if (!target) return [];
  const value = unwrapExpression(target);
  if (ts.isStringLiteral(value)) return [value.text];
  return ts.isArrayLiteralExpression(value)
    ? value.elements.filter(ts.isStringLiteral).map((item) => item.text)
    : [];
}

function collectStatechartNodes(
  source: ts.SourceFile,
  componentName: string,
  statechart: ts.ObjectLiteralExpression,
  issues: AppCompilerIssue[],
): Map<string, ts.ObjectLiteralExpression> {
  const nodes = new Map<string, ts.ObjectLiteralExpression>();
  const visit = (node: ts.ObjectLiteralExpression, parent: string) => {
    const label = parent || "<root>";
    const typeExpression = objectMemberExpression(node, "type");
    const explicitType = typeExpression ? literalString(typeExpression) : undefined;
    if (typeExpression && !explicitType) {
      issues.push(
        issueAt(
          source,
          typeExpression,
          `component ${componentName} state ${label} type must be literal.`,
        ),
      );
    }
    const statesExpression = objectMemberExpression(node, "states");
    const states = objectMemberObject(node, "states");
    const initial = objectMemberExpression(node, "initial");
    const children = new Set<string>();
    if (statesExpression && !states) {
      issues.push(
        issueAt(
          source,
          statesExpression,
          `component ${componentName} state ${label} states must be inline.`,
        ),
      );
    }
    for (const member of states?.properties ?? []) {
      const name = memberName(member);
      const child =
        member && ts.isPropertyAssignment(member) ? unwrapObject(member.initializer) : undefined;
      if (!name || !child) {
        issues.push(
          issueAt(source, member, `component ${componentName} states must be inline objects.`),
        );
        continue;
      }
      if (children.has(name)) {
        issues.push(
          issueAt(
            source,
            member,
            `component ${componentName} state ${label} repeats child ${name}.`,
          ),
        );
        continue;
      }
      children.add(name);
      const path = parent ? `${parent}.${name}` : name;
      nodes.set(path, child);
      visit(child, path);
    }
    if (initial) {
      const initialPath = literalString(initial);
      const directPath = initialPath?.includes(".")
        ? initialPath
        : initialPath
          ? parent
            ? `${parent}.${initialPath}`
            : initialPath
          : undefined;
      if (!directPath || !nodes.has(directPath)) {
        issues.push(
          issueAt(
            source,
            initial,
            `component ${componentName} initial must name a direct child state path.`,
          ),
        );
      }
    }
    const inferredType = explicitType ?? (children.size ? "compound" : "atomic");
    if (inferredType === "parallel" && initial) {
      issues.push(
        issueAt(
          source,
          initial,
          `component ${componentName} parallel state ${label} must not define initial.`,
        ),
      );
    }
    if (inferredType === "compound" && children.size && !initial) {
      issues.push(
        issueAt(
          source,
          node,
          `component ${componentName} compound state ${label} needs an initial child.`,
        ),
      );
    }
    if ((inferredType === "parallel" || inferredType === "compound") && !children.size) {
      issues.push(
        issueAt(
          source,
          node,
          `component ${componentName} ${inferredType} state ${label} needs child states.`,
        ),
      );
    }
    if (["atomic", "final"].includes(inferredType) && children.size) {
      issues.push(
        issueAt(
          source,
          states!,
          `component ${componentName} ${inferredType} state ${label} cannot have child states.`,
        ),
      );
    }
    if (["atomic", "final"].includes(inferredType) && initial) {
      issues.push(
        issueAt(
          source,
          initial,
          `component ${componentName} ${inferredType} state ${label} cannot define initial.`,
        ),
      );
    }
    if (inferredType === "final") {
      for (const forbidden of ["on", "always", "after", "task", "done"] as const) {
        const expression = objectMemberExpression(node, forbidden);
        if (expression) {
          issues.push(
            issueAt(
              source,
              expression,
              `component ${componentName} ${inferredType} state ${label} cannot define ${forbidden}.`,
            ),
          );
        }
      }
    }
  };
  visit(statechart, "");
  if (!nodes.size) {
    issues.push(issueAt(source, statechart, `component ${componentName} needs states.`));
  }
  return nodes;
}

function literalString(expression: ts.Expression): string | undefined {
  const value = unwrapExpression(expression);
  return ts.isStringLiteral(value) ? value.text : undefined;
}

function validateStatechartTransition(
  source: ts.SourceFile,
  componentName: string,
  sourceExpression: ts.Expression,
  label: string,
  states: ReadonlySet<string>,
  issues: AppCompilerIssue[],
) {
  const expression = unwrapExpression(sourceExpression);
  if (ts.isArrayLiteralExpression(expression)) {
    for (const item of expression.elements) {
      if (!ts.isSpreadElement(item)) {
        validateStatechartTransition(source, componentName, item, label, states, issues);
      }
    }
    return;
  }
  if (ts.isStringLiteral(expression)) {
    validateStatechartTarget(source, componentName, expression, states, issues);
    return;
  }
  const transition = unwrapObject(expression);
  if (!transition) {
    issues.push(
      issueAt(
        source,
        expression,
        `component ${componentName} ${label} must be an inline transition.`,
      ),
    );
    return;
  }
  const target = objectMemberExpression(transition, "target");
  if (target) {
    const targetValue = unwrapExpression(target);
    const targets = ts.isArrayLiteralExpression(targetValue)
      ? targetValue.elements.filter(ts.isStringLiteral)
      : ts.isStringLiteral(targetValue)
        ? [targetValue]
        : [];
    if (!targets.length) {
      issues.push(
        issueAt(
          source,
          targetValue,
          `component ${componentName} transition target must be literal.`,
        ),
      );
    }
    for (const value of targets) {
      validateStatechartTarget(source, componentName, value, states, issues);
    }
  }
  const allow = objectMemberExpression(transition, "allow");
  if (allow) {
    const value = unwrapExpression(allow);
    if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) {
      issues.push(
        issueAt(source, allow, `component ${componentName} transition allow must be inline.`),
      );
    }
  }
  const perform = objectMemberExpression(transition, "perform");
  if (perform) {
    const value = unwrapExpression(perform);
    if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) {
      issues.push(
        issueAt(source, perform, `component ${componentName} transition perform must be inline.`),
      );
    } else if (value.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      issues.push(
        issueAt(
          source,
          perform,
          `component ${componentName} transition perform must be synchronous; use a task for async work.`,
        ),
      );
    }
  }
}

function validateStatechartTarget(
  source: ts.SourceFile,
  componentName: string,
  target: ts.StringLiteral,
  states: ReadonlySet<string>,
  issues: AppCompilerIssue[],
) {
  if (!states.has(target.text)) {
    issues.push(
      issueAt(
        source,
        target,
        `component ${componentName} transition targets unknown States member ${target.text}.`,
      ),
    );
  }
}

function propertyValue(member: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  return ts.isPropertyAssignment(member) ? member.initializer : undefined;
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

function validateRenderParts(
  source: ts.SourceFile,
  componentName: string,
  parts: Record<string, string>,
  render: ts.MethodDeclaration,
  issues: AppCompilerIssue[],
) {
  const parameter = render.parameters[0]?.name;
  const partBindings = new Map<string, string>();
  if (parameter && ts.isObjectBindingPattern(parameter)) {
    const partsBinding = parameter.elements.find(
      (element) =>
        (element.propertyName
          ? propertyName(element.propertyName)
          : ts.isIdentifier(element.name)
            ? element.name.text
            : undefined) === "parts",
    );
    if (partsBinding && ts.isObjectBindingPattern(partsBinding.name)) {
      for (const element of partsBinding.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const partName = element.propertyName
          ? propertyName(element.propertyName)
          : element.name.text;
        if (partName) partBindings.set(element.name.text, partName);
      }
    }
  }

  const used = new Set<string>();
  if (render.body) {
    walk(render.body, (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (ts.isIdentifier(node.tagName)) {
          const part = partBindings.get(node.tagName.text);
          if (part) used.add(part);
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        partBindings.has(node.expression.text)
      ) {
        used.add(partBindings.get(node.expression.text)!);
      }
    });
  }
  for (const part of Object.keys(parts)) {
    if (used.has(part)) continue;
    issues.push(
      issueAt(source, render, `component ${componentName} render does not use part ${part}.`),
    );
  }
}

function validateRenderComposition(
  source: ts.SourceFile,
  componentName: string,
  render: ts.MethodDeclaration,
  issues: AppCompilerIssue[],
) {
  if (!render.body) return;
  const ids = new Map<string, ts.JsxAttribute>();
  walk(render.body, (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      /^[a-z]/.test(node.tagName.text)
    ) {
      issues.push(
        issueAt(
          source,
          node,
          `component ${componentName} must declare semantic element ${node.tagName.text} as a typed part.`,
        ),
      );
    }
    if (!ts.isJsxAttribute(node) || !ts.isIdentifier(node.name) || node.name.text !== "id") return;
    const id = jsxLiteral(node.initializer);
    if (!id) return;
    const previous = ids.get(id);
    if (previous) {
      issues.push(
        issueAt(source, node, `component ${componentName} renders duplicate static id ${id}.`),
      );
    } else {
      ids.set(id, node);
    }
  });
}

function jsxLiteral(initializer: ts.JsxAttributeValue | undefined): string | undefined {
  if (!initializer) return;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    ts.isStringLiteral(initializer.expression)
  ) {
    return initializer.expression.text;
  }
}

function requiredPropertyType(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  location: ts.Node,
): ts.Type {
  const type = optionalPropertyType(checker, owner, name, location);
  if (!type) throw new Error(`${location.getSourceFile().fileName}: App.${name} is required.`);
  return type;
}

function optionalPropertyType(
  checker: ts.TypeChecker,
  owner: ts.Type | undefined,
  name: string,
  location: ts.Node,
): ts.Type | undefined {
  if (!owner) return;
  const symbol = propertySymbol(checker, owner, name);
  return symbol ? checker.getNonNullableType(symbolType(checker, symbol, location)) : undefined;
}

function propertySymbol(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
): ts.Symbol | undefined {
  return checker.getPropertyOfType(checker.getApparentType(owner), name);
}

function symbolType(checker: ts.TypeChecker, symbol: ts.Symbol, fallback: ts.Node): ts.Type {
  return checker.getTypeOfSymbolAtLocation(
    symbol,
    symbol.valueDeclaration ?? symbol.declarations?.[0] ?? fallback,
  );
}

function declaredProperties(checker: ts.TypeChecker, type: ts.Type | undefined): ts.Symbol[] {
  if (!type) return [];
  return checker
    .getPropertiesOfType(checker.getApparentType(type))
    .filter((symbol) =>
      symbol.declarations?.some(
        (declaration) =>
          ts.isPropertySignature(declaration) ||
          ts.isMethodSignature(declaration) ||
          ts.isPropertyDeclaration(declaration),
      ),
    );
}

function propertyNames(checker: ts.TypeChecker, type: ts.Type | undefined): string[] {
  return declaredProperties(checker, type).map((property) => property.getName());
}

function stringValues(type: ts.Type | undefined): string[] {
  if (!type) return [];
  if (type.isUnion()) return [...new Set(type.types.flatMap((item) => stringValues(item)))];
  if (type.flags & ts.TypeFlags.StringLiteral) return [(type as ts.StringLiteralType).value];
  return [];
}

function symbolDocumentation(checker: ts.TypeChecker, symbol: ts.Symbol): string | undefined {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  return text || undefined;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start == null) return message;
  const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${location.line + 1}:${location.character + 1}: ${message}`;
}

function issueFromDiagnostic(source: ts.SourceFile, diagnostic: ts.Diagnostic): AppCompilerIssue {
  const start = diagnostic.start ?? 0;
  const location = source.getLineAndCharacterOfPosition(start);
  return {
    file: source.fileName,
    line: location.line + 1,
    column: location.character + 1,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
}

function issueAt(source: ts.SourceFile, node: ts.Node, message: string): AppCompilerIssue {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: source.fileName,
    line: location.line + 1,
    column: location.character + 1,
    message,
  };
}

function unwrapObject(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isObjectLiteralExpression(current) ? current : undefined;
}

function objectMemberExpression(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const member = object.properties.find((property) => memberName(property) === name);
  return member && ts.isPropertyAssignment(member) ? member.initializer : undefined;
}

function objectMemberObject(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const expression = objectMemberExpression(object, name);
  return expression ? unwrapObject(expression) : undefined;
}

function memberName(member: ts.ObjectLiteralElementLike): string | undefined {
  return member.name ? propertyName(member.name) : undefined;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}
