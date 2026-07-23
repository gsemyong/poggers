import { resolve } from "node:path";

import * as ts from "@typescript/typescript6";

const factory = ts.factory;
type ComponentMethodKind = "view";

export function transformComponentSource(
  source: string,
  fileName: string,
  options: { stripPresentations?: boolean } = {},
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
        ...(options.stripPresentations ? [stripPresentationsTransformer] : []),
      ],
    },
  });
  const diagnostic = result.diagnostics?.find(
    (item) => item.category === ts.DiagnosticCategory.Error,
  );
  if (diagnostic) throw new Error(formatDiagnostic(diagnostic));
  return result.outputText;
}

const stripPresentationsTransformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
  return (source) => {
    const exported = source.statements.find(ts.isExportAssignment);
    const app = exported ? unwrapObject(exported.expression) : undefined;
    if (!app) return source;
    const visit: ts.Visitor = (node) => {
      if (node === app) {
        return factory.updateObjectLiteralExpression(
          app,
          app.properties.filter((property) => memberName(property) !== "presentations"),
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
  let renderPartBindings = new Set<string>();
  let activeMethod: ts.MethodDeclaration | undefined;
  let activeContextName = "__kitView";
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

    if (renderDepth === 0) return ts.visitEachChild(node, visit, context);

    if (ts.isJsxElement(node)) return visitJsxElement(node);
    if (ts.isJsxSelfClosingElement(node)) return visitSelfClosingElement(node);
    if (ts.isJsxExpression(node)) return visitJsxExpression(node);
    if (ts.isCallExpression(node) && partFactoryCall(node)) {
      return visitPartFactoryCall(node);
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
      activeMethod = node;
      componentMethodDepth++;
      if (kind === "view") renderDepth++;
      const transformed = ts.visitEachChild(node, visit, context);
      if (kind === "view") renderDepth--;
      componentMethodDepth--;
      activeMethod = previousMethod;
      return transformed;
    }

    const previousBindings = renderBindings;
    const previousPartBindings = renderPartBindings;
    const previousMethod = activeMethod;
    const previousContextName = activeContextName;
    const nextBindings = new Map<string, string>();
    const nextPartBindings = new Set<string>();
    const retained: ts.BindingElement[] = [];
    for (const element of first.name.elements) {
      const sourceName = element.propertyName
        ? propertyName(element.propertyName)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
      if (sourceName === "elements" && ts.isObjectBindingPattern(element.name)) {
        for (const part of element.name.elements) {
          if (ts.isIdentifier(part.name)) nextPartBindings.add(part.name.text);
        }
      }
      if (!element.dotDotDotToken && ts.isIdentifier(element.name) && !element.initializer) {
        if (sourceName) {
          nextBindings.set(element.name.text, sourceName);
          continue;
        }
      }
      retained.push(element);
    }

    const contextNameText = "__kitView";
    const contextName = factory.createIdentifier(contextNameText);
    renderBindings = nextBindings;
    renderPartBindings = nextPartBindings;
    activeMethod = node;
    const snapshots = reactiveViewSnapshots(node.body, nextBindings);
    if (snapshots.length) {
      throw new Error(
        `Component view snapshots reactive ${snapshots.join(", ")}. Bind the expression directly or read it from a zero-argument function.`,
      );
    }
    activeContextName = contextNameText;
    componentMethodDepth++;
    if (kind === "view") renderDepth++;
    const body = ts.visitEachChild(node.body, visit, context);
    if (kind === "view") renderDepth--;
    componentMethodDepth--;
    renderBindings = previousBindings;
    renderPartBindings = previousPartBindings;
    activeMethod = previousMethod;
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
    const reactiveIndex = factory.createUniqueName("__kitForIndex");
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

  const visitPartFactoryCall = (node: ts.CallExpression): ts.VisitResult<ts.Node> => {
    const expression = ts.visitNode(node.expression, visit, ts.isExpression)!;
    const argumentsArray = node.arguments.map((argument, index) => {
      const visited = ts.visitNode(argument, visit, ts.isExpression)!;
      return index === 0 && ts.isObjectLiteralExpression(visited)
        ? reactivePartObject(visited)
        : visited;
    });
    return factory.updateCallExpression(
      node,
      expression,
      node.typeArguments,
      factory.createNodeArray(argumentsArray),
    );
  };

  const reactivePartObject = (node: ts.ObjectLiteralExpression): ts.ObjectLiteralExpression => {
    const properties = node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) return property;
      const name = propertyName(property.name);
      const expression = property.initializer;
      if (
        isFunction(expression) ||
        isStaticExpression(expression) ||
        name === "ref" ||
        name?.startsWith("on") ||
        (name === "children" && ts.isArrayLiteralExpression(expression))
      ) {
        return property;
      }
      return factory.updatePropertyAssignment(property, property.name, lazy(expression));
    });
    return factory.updateObjectLiteralExpression(node, properties);
  };

  const partFactoryCall = (node: ts.CallExpression): boolean => {
    if (
      ts.isIdentifier(node.expression) &&
      renderPartBindings.has(node.expression.text) &&
      !isBindingShadowed(node.expression, node.expression.text, activeMethod)
    ) {
      return true;
    }
    if (!ts.isPropertyAccessExpression(node.expression)) return false;
    const owner = node.expression.expression;
    if (!ts.isIdentifier(owner) || isBindingShadowed(owner, owner.text, activeMethod)) return false;
    return (renderBindings.get(owner.text) ?? owner.text) === "elements";
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
  const visit = (node: ts.Node): void => {
    if (!ts.isObjectLiteralExpression(node)) {
      node.forEachChild(visit);
      return;
    }
    const owner = node;
    const components = objectMemberObject(owner, "components");
    for (const property of components?.properties ?? []) {
      if (!ts.isPropertyAssignment(property)) continue;
      const definition = unwrapObject(property.initializer);
      if (!definition) continue;
      for (const member of definition.properties) {
        const name = ts.isMethodDeclaration(member) && propertyName(member.name);
        if (name === "view") {
          methods.set(member as ts.MethodDeclaration, name);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
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

function reactiveViewSnapshots(body: ts.Block, bindings: ReadonlyMap<string, string>): string[] {
  const reactive = new Set(bindings.keys());
  const snapshots: string[] = [];
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (isFunction(declaration.initializer)) continue;
      if (!referencesReactiveBinding(declaration.initializer, reactive)) continue;
      reactive.add(declaration.name.text);
      snapshots.push(declaration.name.text);
    }
  }
  return snapshots;
}

function referencesReactiveBinding(node: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (current !== node && ts.isFunctionLike(current)) return;
    if (ts.isIdentifier(current) && names.has(current.text) && isReferenceIdentifier(current)) {
      found = true;
      return;
    }
    current.forEachChild(visit);
  };
  visit(node);
  return found;
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

function memberName(member: ts.ObjectLiteralElementLike): string | undefined {
  return member.name ? propertyName(member.name) : undefined;
}

function objectMemberObject(
  node: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const member = node.properties.find((property) => memberName(property) === name);
  return member && ts.isPropertyAssignment(member) ? unwrapObject(member.initializer) : undefined;
}

function unwrapObject(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isObjectLiteralExpression(current) ? current : undefined;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
