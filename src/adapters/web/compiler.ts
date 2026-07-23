import { relative } from "node:path";

import * as ts from "@typescript/typescript6";

import {
  WEB_COMPILER_IR_VERSION,
  webApplicationCompilerIR,
  type CompiledWebComponentIR,
  type CompiledWebRouteIR,
  type WebFeatureCompilerIR,
  type WebApplicationCompilerIR,
  type WebProgramCompilerIR,
  type WebRenderNodeIR,
  type WebRenderValueIR,
  type WebRouteIR,
  planWebRouteDocument,
} from "@/adapters/web/routing";
import type {
  ProgramSourceContext,
  SourceCompilerAPI,
  SourceCompilerExtension,
} from "@/compiler/extension";
import type { DependencyIR, ExtensionIR, SourceSpan } from "@/compiler/ir";
import { ApplicationDiagnostic } from "@/compiler/source";

/** Extracts web-only address and rendering meaning without teaching generic core about Routes. */
export const webCompilerExtension: SourceCompilerExtension = Object.freeze({
  name: "web",
  application(context) {
    const web = context.source.member(context.implementation, "web");
    if (!web) return undefined;
    const definition = context.source.object(web);
    if (!definition)
      return context.source.fail(web, "The web application definition must be an object.");
    const installationValue = context.source.member(definition, "installation");
    const result: WebApplicationCompilerIR = {
      version: WEB_COMPILER_IR_VERSION,
      ...(installationValue
        ? { installation: compileWebInstallation(context, installationValue) }
        : {}),
    };
    webApplicationCompilerIR(result);
    return result;
  },
  feature({ contract, location, source }) {
    const routePath = source.optionalLiteral(contract, "RoutePath", location);
    return routePath === undefined
      ? undefined
      : ({ version: WEB_COMPILER_IR_VERSION, routePath } satisfies WebFeatureCompilerIR);
  },
  program(context) {
    if (platformName(context) !== "web") return undefined;
    const routes = context.source.property(context.contract, "Routes", context.location);
    if (!routes) return undefined;
    const values = context.source.object(context.source.member(context.implementation, "routes"));
    return {
      version: WEB_COMPILER_IR_VERSION,
      components: componentList(context),
      routes: routeList(context, routes, values),
    } satisfies WebProgramCompilerIR;
  },
});

function compileWebInstallation(
  context: Parameters<NonNullable<SourceCompilerExtension["application"]>>[0],
  expression: ts.Expression,
): NonNullable<WebApplicationCompilerIR["installation"]> {
  const value = staticExtensionValue(context.checker, expression, new Set());
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return context.source.fail(expression, "The web installation must be compiler-readable data.");
  }
  const installation = value as Readonly<Record<string, unknown>>;
  for (const name of Object.keys(installation)) {
    if (!["display", "icons", "offline", "shortName", "shortcuts", "start"].includes(name)) {
      return context.source.fail(
        expression,
        `Unsupported web installation field ${JSON.stringify(name)}.`,
      );
    }
  }
  return {
    ...(installation.shortName !== undefined
      ? { shortName: installation.shortName as string }
      : {}),
    start: installation.start as NonNullable<WebApplicationCompilerIR["installation"]>["start"],
    display: (installation.display ?? "standalone") as NonNullable<
      WebApplicationCompilerIR["installation"]
    >["display"],
    icons: (installation.icons ?? []) as NonNullable<
      WebApplicationCompilerIR["installation"]
    >["icons"],
    shortcuts: Array.isArray(installation.shortcuts)
      ? installation.shortcuts.map((value) => {
          const shortcut = value as Readonly<Record<string, unknown>>;
          return {
            name: shortcut.name as string,
            destination: shortcut.destination as NonNullable<
              WebApplicationCompilerIR["installation"]
            >["start"],
            icons: (shortcut.icons ?? []) as NonNullable<
              WebApplicationCompilerIR["installation"]
            >["icons"],
          };
        })
      : installation.shortcuts === undefined
        ? []
        : (installation.shortcuts as NonNullable<
            WebApplicationCompilerIR["installation"]
          >["shortcuts"]),
    offline: installation.offline as NonNullable<
      WebApplicationCompilerIR["installation"]
    >["offline"],
  };
}

function staticExtensionValue(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  active: Set<ts.Node>,
): ExtensionIR | undefined {
  const value = unwrapStaticExpression(checker, expression);
  if (active.has(value)) return undefined;
  active.add(value);
  try {
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    if (ts.isNumericLiteral(value)) return Number(value.text);
    if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (value.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken) {
      const operand = staticExtensionValue(checker, value.operand, active);
      return typeof operand === "number" ? -operand : undefined;
    }
    if (ts.isArrayLiteralExpression(value)) {
      const result: ExtensionIR[] = [];
      for (const item of value.elements) {
        if (ts.isSpreadElement(item)) return undefined;
        const child = staticExtensionValue(checker, item, active);
        if (child === undefined) return undefined;
        result.push(child);
      }
      return result;
    }
    if (!ts.isObjectLiteralExpression(value)) return undefined;
    const result: Record<string, ExtensionIR> = Object.create(null);
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = staticExtensionValue(checker, property.expression, active);
        if (!spread || typeof spread !== "object" || Array.isArray(spread)) return undefined;
        Object.assign(result, spread);
        continue;
      }
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return undefined;
      }
      const name = ts.isComputedPropertyName(property.name)
        ? undefined
        : ts.isIdentifier(property.name) ||
            ts.isStringLiteral(property.name) ||
            ts.isNumericLiteral(property.name)
          ? property.name.text
          : undefined;
      if (!name) return undefined;
      const child = staticExtensionValue(
        checker,
        ts.isPropertyAssignment(property) ? property.initializer : property.name,
        active,
      );
      if (child === undefined) return undefined;
      result[name] = child;
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function unwrapStaticExpression(checker: ts.TypeChecker, expression: ts.Expression): ts.Expression {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value)
  ) {
    value = value.expression;
  }
  if (!ts.isIdentifier(value)) return value;
  let symbol = ts.isShorthandPropertyAssignment(value.parent)
    ? checker.getShorthandAssignmentValueSymbol(value.parent)
    : checker.getSymbolAtLocation(value);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
    symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
  return declaration?.initializer
    ? unwrapStaticExpression(checker, declaration.initializer)
    : value;
}

function platformName(context: ProgramSourceContext): string | undefined {
  const environment = context.source.property(context.contract, "Environment", context.location);
  const platform = environment
    ? context.source.property(environment, "Platform", context.location)
    : undefined;
  return platform ? context.source.literal(platform, "Name", context.location) : undefined;
}

function routeList(
  context: ProgramSourceContext,
  type: ts.Type,
  values: ts.ObjectLiteralExpression | undefined,
): CompiledWebRouteIR[] {
  const { checker, location: at, source } = context;
  if (!values && type.getProperties().length) {
    source.fail(at, "A web Program with Routes must expose compiler-readable implementations.");
  }
  return source.properties(type).map((symbol) => {
    const name = symbol.getName();
    const location = symbol.valueDeclaration ?? at;
    const route = checker.getTypeOfSymbolAtLocation(symbol, location);
    const value = values ? source.resolveMember(values, name) : undefined;
    const implementation = source.object(value);
    if (!implementation) {
      return source.fail(values ?? at, `Route ${JSON.stringify(name)} has no implementation.`);
    }
    const path = source.literal(route, "Path", location);
    if (path.startsWith("/")) {
      source.fail(location, `Route ${JSON.stringify(name)} path must be relative.`);
    }
    const view = source.memberDeclaration(implementation, "view");
    if (!view) {
      return source.fail(implementation, `Route ${JSON.stringify(name)} must implement view.`);
    }
    const renderView = view;
    const load = source.memberDeclaration(implementation, "load");
    const data = source.property(route, "Data", location);
    const params = routeParameterList(
      context,
      source.property(route, "ParamSchema", location),
      location,
    );
    const search = routeParameterList(
      context,
      source.property(route, "SearchSchema", location),
      location,
    );
    const cache = routeCache(source, source.property(route, "Cache", location), location);
    const metadata = routeMetadata(context, source.property(route, "Metadata", location), location);
    const deferred = source
      .properties(source.property(route, "Deferred", location))
      .map((field) => field.getName())
      .sort();
    return {
      feature: context.feature,
      name,
      path,
      document: planWebRouteDocument({ metadata, cache, load: Boolean(load) }),
      cache,
      metadata,
      params,
      search,
      deferred,
      data: data ? source.lower(data, location) : source.emptyRecord(),
      dependencies: routeDependencies(context, route, location),
      implementation: {
        load: load
          ? source.portable(load, {
              id: `web-route/${context.feature}/${context.name}/${name}/load`,
              name: `${name}.load`,
            })
          : false,
        view: compileRenderFunction(context, renderView, { feature: "", elements: {} }),
      },
      implementationSpan: relativeSpan(context.root, source.span(implementation)),
      span: relativeSpan(context.root, source.span(location)),
    };
  });
}

function routeDependencies(
  context: ProgramSourceContext,
  route: ts.Type,
  at: ts.Node,
): DependencyIR[] {
  const dependencies = context.source.property(route, "Dependencies", at);
  if (!dependencies) return [];
  return context.source.properties(dependencies).map((symbol) => {
    const location = symbol.valueDeclaration ?? at;
    return {
      name: symbol.getName(),
      type: context.source.lower(
        context.checker.getTypeOfSymbolAtLocation(symbol, location),
        location,
      ),
    };
  });
}

type RenderBinding =
  | Readonly<{ kind: "value"; value: WebRenderValueIR }>
  | Readonly<{ kind: "elements" }>
  | Readonly<{ kind: "element"; name: string; tag: string }>
  | Readonly<{ kind: "components"; feature: string; global: boolean }>
  | Readonly<{ kind: "component-member"; feature: string; global: boolean; name: string }>;

type RenderScope = Readonly<{
  feature: string;
  elements: Readonly<Record<string, string>>;
  bindings: Map<string, RenderBinding>;
}>;

function componentList(context: ProgramSourceContext): CompiledWebComponentIR[] {
  const { checker, location: at, source } = context;
  const type = source.property(context.contract, "Components", at);
  const values = source.object(source.member(context.implementation, "components"));
  return source.properties(type).map((symbol) => {
    const name = symbol.getName();
    const location = symbol.valueDeclaration ?? at;
    const contract = checker.getTypeOfSymbolAtLocation(symbol, location);
    const implementation = values ? source.object(source.resolveMember(values, name)) : undefined;
    const elements = componentElementTags(context, contract, location);
    const span = relativeSpan(context.root, source.span(location));
    const view = implementation ? source.memberDeclaration(implementation, "view") : undefined;
    if (!implementation || !view) {
      return {
        feature: context.feature,
        name,
        elements,
        state: {},
        view: false,
        diagnostic: { message: `Component ${name} has no compiler-readable view.`, span },
        span,
      };
    }
    const componentImplementation = implementation;
    try {
      return {
        feature: context.feature,
        name,
        elements,
        state: staticComponentState(context, componentImplementation),
        view: compileRenderFunction(context, view, {
          feature: context.feature,
          elements,
        }),
        span,
      };
    } catch (error) {
      if (!(error instanceof ApplicationDiagnostic)) throw error;
      return {
        feature: context.feature,
        name,
        elements,
        state: {},
        view: false,
        diagnostic: {
          message: error.message.replace(/^.*?:\d+:\d+: /, ""),
          span: relativeSpan(context.root, error.span),
        },
        span,
      };
    }
  });
}

function componentElementTags(
  context: ProgramSourceContext,
  contract: ts.Type,
  at: ts.Node,
): Readonly<Record<string, string>> {
  const elements = context.source.property(contract, "Elements", at);
  return Object.fromEntries(
    context.source.properties(elements).map((element) => {
      const location = element.valueDeclaration ?? at;
      const type = context.checker.getTypeOfSymbolAtLocation(element, location);
      if (!type.isStringLiteral()) {
        return context.source.fail(
          location,
          `Component Element ${element.getName()} must name one platform primitive exactly.`,
        );
      }
      return [element.getName(), type.value];
    }),
  );
}

function staticComponentState(
  context: ProgramSourceContext,
  implementation: ts.ObjectLiteralExpression,
): Readonly<Record<string, null | boolean | number | string>> {
  const expression = context.source.member(implementation, "state");
  if (!expression) return {};
  const state = context.source.object(expression);
  if (!state) return unsupported(context, expression, "Component state must be a static object.");
  const result: Record<string, null | boolean | number | string> = {};
  for (const property of state.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) {
      return unsupported(context, property, "Component state fields must be explicit values.");
    }
    const name = propertyName(property.name);
    const value = literalValue(property.initializer);
    if (!name || value === undefined) {
      return unsupported(context, property, "Component state supports only scalar initial values.");
    }
    result[name] = value;
  }
  return result;
}

function compileRenderFunction(
  context: ProgramSourceContext,
  declaration: ts.ObjectLiteralElementLike,
  input: Readonly<{ feature: string; elements: Readonly<Record<string, string>> }>,
): WebRenderNodeIR {
  const functionLike = renderFunction(declaration);
  if (!functionLike?.body) {
    return unsupported(context, declaration, "The view body must be statically known.");
  }
  const scope: RenderScope = {
    feature: input.feature,
    elements: input.elements,
    bindings: new Map(),
  };
  bindRenderContext(context, functionLike.parameters[0], scope);
  if (!ts.isBlock(functionLike.body)) {
    return compileRenderNode(context, functionLike.body, scope);
  }
  let returned: ts.Expression | undefined;
  for (const statement of functionLike.body.statements) {
    if (ts.isReturnStatement(statement)) {
      if (returned || !statement.expression) {
        return unsupported(context, statement, "A view must have one value-returning path.");
      }
      returned = statement.expression;
      continue;
    }
    if (!ts.isVariableStatement(statement)) {
      return unsupported(context, statement, "Views support only local bindings before return.");
    }
    for (const declaration of statement.declarationList.declarations) {
      bindRenderLocal(context, declaration, scope);
    }
  }
  if (!returned) return unsupported(context, functionLike.body, "A view must return its UI.");
  return compileRenderNode(context, returned, scope);
}

function renderFunction(
  declaration: ts.ObjectLiteralElementLike,
): ts.FunctionLikeDeclaration | undefined {
  if (ts.isMethodDeclaration(declaration)) return declaration;
  if (
    ts.isPropertyAssignment(declaration) &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer;
  }
  return undefined;
}

function bindRenderContext(
  context: ProgramSourceContext,
  parameter: ts.ParameterDeclaration | undefined,
  scope: RenderScope,
): void {
  if (!parameter) return;
  if (!ts.isObjectBindingPattern(parameter.name)) {
    return unsupported(context, parameter, "A view context must use object destructuring.");
  }
  for (const element of parameter.name.elements) {
    const sourceName = element.propertyName
      ? propertyName(element.propertyName)
      : bindingName(element.name);
    if (!sourceName) return unsupported(context, element, "View context names must be static.");
    bindRenderPattern(context, sourceName, element.name, scope);
  }
}

function bindRenderPattern(
  context: ProgramSourceContext,
  sourceName: string,
  binding: ts.BindingName,
  scope: RenderScope,
): void {
  if (ts.isObjectBindingPattern(binding)) {
    for (const element of binding.elements) {
      const name = element.propertyName
        ? propertyName(element.propertyName)
        : bindingName(element.name);
      if (!name || !ts.isIdentifier(element.name)) {
        return unsupported(context, element, "Nested view bindings must be named fields.");
      }
      if (["data", "params", "props", "search", "state"].includes(sourceName)) {
        scope.bindings.set(element.name.text, {
          kind: "value",
          value: {
            kind: "path",
            root: sourceName as "data" | "params" | "props" | "search" | "state",
            path: [name],
          },
        });
      } else if (sourceName === "components") {
        scope.bindings.set(element.name.text, {
          kind: "component-member",
          feature: scope.feature,
          global: scope.feature === "",
          name,
        });
      } else if (sourceName === "elements") {
        bindElement(context, element.name.text, name, scope, element);
      } else {
        return unsupported(context, element, `Nested ${sourceName} bindings are not renderable.`);
      }
    }
    return;
  }
  if (!ts.isIdentifier(binding)) {
    return unsupported(context, binding, "View context bindings must be identifiers.");
  }
  if (["data", "params", "props", "search", "state"].includes(sourceName)) {
    scope.bindings.set(binding.text, {
      kind: "value",
      value: {
        kind: "path",
        root: sourceName as "data" | "params" | "props" | "search" | "state",
        path: [],
      },
    });
  } else if (sourceName === "elements") {
    scope.bindings.set(binding.text, { kind: "elements" });
  } else if (sourceName === "components") {
    scope.bindings.set(binding.text, {
      kind: "components",
      feature: scope.feature,
      global: scope.feature === "",
    });
  }
}

function bindRenderLocal(
  context: ProgramSourceContext,
  declaration: ts.VariableDeclaration,
  scope: RenderScope,
): void {
  if (!declaration.initializer) {
    return unsupported(context, declaration, "View bindings require an initial value.");
  }
  if (ts.isObjectBindingPattern(declaration.name)) {
    if (!ts.isIdentifier(declaration.initializer)) {
      return unsupported(context, declaration, "View destructuring must reference its context.");
    }
    const owner = scope.bindings.get(declaration.initializer.text);
    for (const element of declaration.name.elements) {
      const name = element.propertyName
        ? propertyName(element.propertyName)
        : bindingName(element.name);
      if (!name || !ts.isIdentifier(element.name)) {
        return unsupported(context, element, "View destructuring requires named fields.");
      }
      if (owner?.kind === "elements") {
        bindElement(context, element.name.text, name, scope, element);
      } else if (owner?.kind === "components") {
        scope.bindings.set(element.name.text, {
          kind: "component-member",
          feature: owner.feature,
          global: owner.global,
          name,
        });
      } else if (owner?.kind === "value") {
        scope.bindings.set(element.name.text, {
          kind: "value",
          value: appendRenderPath(context, owner.value, name, element),
        });
      } else {
        return unsupported(context, declaration, "This view binding cannot be destructured.");
      }
    }
    return;
  }
  if (!ts.isIdentifier(declaration.name)) {
    return unsupported(context, declaration.name, "View bindings require identifiers.");
  }
  scope.bindings.set(declaration.name.text, {
    kind: "value",
    value: compileRenderValue(context, declaration.initializer, scope),
  });
}

function bindElement(
  context: ProgramSourceContext,
  local: string,
  name: string,
  scope: RenderScope,
  at: ts.Node,
): void {
  const tag = scope.elements[name];
  if (!tag) return unsupported(context, at, `Unknown Component Element ${name}.`);
  scope.bindings.set(local, { kind: "element", name, tag });
}

function compileRenderNode(
  context: ProgramSourceContext,
  source: ts.Expression,
  scope: RenderScope,
): WebRenderNodeIR {
  const expression = unwrap(source);
  if (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(expression) && expression.text === "undefined")
  ) {
    return { kind: "none" };
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    if (expression.parameters.length) {
      return unsupported(context, expression, "Reactive view closures cannot take parameters.");
    }
    const body = expression.body;
    if (ts.isBlock(body)) {
      const returned = body.statements.find(ts.isReturnStatement)?.expression;
      if (!returned) return unsupported(context, body, "A reactive view closure must return UI.");
      return compileRenderNode(context, returned, scope);
    }
    return compileRenderNode(context, body, scope);
  }
  if (ts.isJsxElement(expression)) return compileJsxElement(context, expression, scope);
  if (ts.isJsxSelfClosingElement(expression)) {
    return compileJsxOpening(context, expression.tagName, expression.attributes, [], scope);
  }
  if (ts.isJsxFragment(expression)) {
    return {
      kind: "fragment",
      children: compileJsxChildren(context, expression.children, scope),
    };
  }
  if (ts.isConditionalExpression(expression)) {
    return {
      kind: "conditional",
      condition: compileRenderValue(context, expression.condition, scope),
      consequent: compileRenderNode(context, expression.whenTrue, scope),
      alternate: compileRenderNode(context, expression.whenFalse, scope),
    };
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return {
      kind: "conditional",
      condition: compileRenderValue(context, expression.left, scope),
      consequent: compileRenderNode(context, expression.right, scope),
      alternate: { kind: "none" },
    };
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return {
      kind: "fragment",
      children: expression.elements.map((item) => compileRenderNode(context, item, scope)),
    };
  }
  return { kind: "text", value: compileRenderValue(context, expression, scope) };
}

function compileJsxElement(
  context: ProgramSourceContext,
  element: ts.JsxElement,
  scope: RenderScope,
): WebRenderNodeIR {
  return compileJsxOpening(
    context,
    element.openingElement.tagName,
    element.openingElement.attributes,
    element.children,
    scope,
  );
}

function compileJsxOpening(
  context: ProgramSourceContext,
  tag: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[],
  scope: RenderScope,
): WebRenderNodeIR {
  const parts = jsxTagParts(tag);
  if (parts.length === 1 && parts[0] === "For") {
    return compileFor(context, attributes, children, scope);
  }
  if (parts.length === 1 && parts[0] === "Await") {
    return compileAwait(context, attributes, children, scope);
  }
  const binding = parts[0] ? scope.bindings.get(parts[0]) : undefined;
  if (binding?.kind === "element" && parts.length === 1) {
    return {
      kind: "element",
      element: binding.name,
      tag: binding.tag,
      attributes: compileElementAttributes(context, attributes, scope),
      children: compileJsxChildren(context, children, scope),
    };
  }
  const target = componentTarget(context, binding, parts, tag);
  const props = attributes.properties.flatMap((attribute) => {
    if (!ts.isJsxAttribute(attribute)) {
      return unsupported(context, attribute, "Component prop spreads are not server-renderable.");
    }
    const name = jsxAttributeName(context, attribute.name);
    const initializer = attribute.initializer;
    if (!initializer) return [{ name, value: literal(true), node: false }];
    if (ts.isStringLiteral(initializer)) {
      return [{ name, value: literal(initializer.text), node: false }];
    }
    const value = jsxAttributeExpression(initializer);
    if (!value) return [];
    const unwrapped = unwrap(value);
    const node =
      ts.isJsxElement(unwrapped) ||
      ts.isJsxSelfClosingElement(unwrapped) ||
      ts.isJsxFragment(unwrapped);
    return [
      {
        name,
        value: node
          ? compileRenderNode(context, unwrapped, scope)
          : compileRenderValue(context, unwrapped, scope),
        node,
      },
    ];
  });
  const renderedChildren = compileJsxChildren(context, children, scope);
  if (renderedChildren.length) {
    props.push({
      name: "children",
      value: { kind: "fragment", children: renderedChildren },
      node: true,
    });
  }
  return { kind: "component", target, props };
}

function compileElementAttributes(
  context: ProgramSourceContext,
  attributes: ts.JsxAttributes,
  scope: RenderScope,
): readonly Readonly<{ name: string; value: WebRenderValueIR }>[] {
  return attributes.properties.flatMap((attribute) => {
    if (!ts.isJsxAttribute(attribute)) {
      return unsupported(context, attribute, "Element prop spreads are not server-renderable.");
    }
    const name = jsxAttributeName(context, attribute.name);
    if (name === "ref" || /^on[A-Z]/.test(name)) return [];
    const output = name === "className" ? "class" : name === "htmlFor" ? "for" : name;
    if (!attribute.initializer) return [{ name: output, value: literal(true) }];
    if (ts.isStringLiteral(attribute.initializer)) {
      return [{ name: output, value: literal(attribute.initializer.text) }];
    }
    const expression = jsxAttributeExpression(attribute.initializer);
    if (!expression) return [];
    return [
      {
        name: output,
        value: compileRenderValue(context, expression, scope),
      },
    ];
  });
}

function jsxAttributeName(context: ProgramSourceContext, name: ts.JsxAttributeName): string {
  return ts.isIdentifier(name)
    ? name.text
    : unsupported(context, name, "Namespaced JSX attributes are not server-renderable.");
}

function jsxAttributeExpression(initializer: ts.JsxAttributeValue): ts.Expression | undefined {
  return ts.isJsxExpression(initializer) ? initializer.expression : initializer;
}

function compileJsxChildren(
  context: ProgramSourceContext,
  children: readonly ts.JsxChild[],
  scope: RenderScope,
): WebRenderNodeIR[] {
  return children.flatMap((child): WebRenderNodeIR[] => {
    if (ts.isJsxText(child)) {
      const value = jsxText(child.text);
      return value ? [{ kind: "text", value: literal(value) }] : [];
    }
    if (ts.isJsxExpression(child)) {
      return child.expression ? [compileRenderNode(context, child.expression, scope)] : [];
    }
    if (ts.isJsxElement(child)) return [compileJsxElement(context, child, scope)];
    if (ts.isJsxSelfClosingElement(child)) {
      return [compileJsxOpening(context, child.tagName, child.attributes, [], scope)];
    }
    return unsupported(context, child, "This JSX child is not server-renderable.");
  });
}

function compileFor(
  context: ProgramSourceContext,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[],
  scope: RenderScope,
): WebRenderNodeIR {
  const each = attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === "each",
  );
  const child = children.find(
    (value): value is ts.JsxExpression => ts.isJsxExpression(value) && Boolean(value.expression),
  )?.expression;
  if (
    !each ||
    !each.initializer ||
    !ts.isJsxExpression(each.initializer) ||
    !each.initializer.expression ||
    !child ||
    (!ts.isArrowFunction(child) && !ts.isFunctionExpression(child)) ||
    child.parameters.length !== 1 ||
    !ts.isIdentifier(child.parameters[0]!.name)
  ) {
    return unsupported(context, attributes, "For requires one collection and one item renderer.");
  }
  const item = child.parameters[0]!.name.text;
  const bindings = new Map(scope.bindings);
  bindings.set(item, { kind: "value", value: { kind: "local", name: item, path: [] } });
  const childScope = { ...scope, bindings };
  const body = ts.isBlock(child.body)
    ? child.body.statements.find(ts.isReturnStatement)?.expression
    : child.body;
  if (!body) return unsupported(context, child.body, "For item renderers must return UI.");
  return {
    kind: "each",
    values: compileRenderValue(context, each.initializer.expression, scope),
    item,
    body: compileRenderNode(context, body, childScope),
  };
}

function compileAwait(
  context: ProgramSourceContext,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[],
  scope: RenderScope,
): WebRenderNodeIR {
  const value = jsxExpressionAttribute(attributes, "value");
  const pending = jsxExpressionAttribute(attributes, "fallback");
  const rejected = jsxExpressionAttribute(attributes, "error");
  const child = children.find(
    (candidate): candidate is ts.JsxExpression =>
      ts.isJsxExpression(candidate) && Boolean(candidate.expression),
  )?.expression;
  if (
    !value ||
    !child ||
    (!ts.isArrowFunction(child) && !ts.isFunctionExpression(child)) ||
    child.parameters.length !== 1 ||
    !ts.isIdentifier(child.parameters[0]!.name)
  ) {
    return unsupported(
      context,
      attributes,
      "Await requires one deferred value and one resolved-value renderer.",
    );
  }
  const item = child.parameters[0]!.name.text;
  const bindings = new Map(scope.bindings);
  bindings.set(item, { kind: "value", value: { kind: "local", name: item, path: [] } });
  const resolved = functionRenderBody(context, child, { ...scope, bindings }, "Await");
  if (
    !rejected ||
    (!ts.isArrowFunction(rejected) && !ts.isFunctionExpression(rejected)) ||
    rejected.parameters.length !== 1 ||
    !ts.isIdentifier(rejected.parameters[0]!.name)
  ) {
    return unsupported(context, rejected ?? attributes, "Await requires one Error renderer.");
  }
  const errorItem = rejected.parameters[0]!.name.text;
  const errorBindings = new Map(scope.bindings);
  errorBindings.set(errorItem, {
    kind: "value",
    value: { kind: "local", name: errorItem, path: [] },
  });
  const error = {
    item: errorItem,
    body: functionRenderBody(context, rejected, { ...scope, bindings: errorBindings }, "Await"),
  };
  return {
    kind: "await",
    value: compileRenderValue(context, value, scope),
    item,
    pending: pending ? compileRenderNode(context, pending, scope) : { kind: "none" },
    resolved,
    error,
  };
}

function jsxExpressionAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): ts.Expression | undefined {
  const attribute = attributes.properties.find(
    (candidate): candidate is ts.JsxAttribute =>
      ts.isJsxAttribute(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === name,
  );
  return attribute?.initializer ? jsxAttributeExpression(attribute.initializer) : undefined;
}

function functionRenderBody(
  context: ProgramSourceContext,
  function_: ts.ArrowFunction | ts.FunctionExpression,
  scope: RenderScope,
  owner: string,
): WebRenderNodeIR {
  const body = ts.isBlock(function_.body)
    ? function_.body.statements.find(ts.isReturnStatement)?.expression
    : function_.body;
  if (!body) return unsupported(context, function_.body, `${owner} renderers must return UI.`);
  return compileRenderNode(context, body, scope);
}

function compileRenderValue(
  context: ProgramSourceContext,
  source: ts.Expression,
  scope: RenderScope,
): WebRenderValueIR {
  const expression = unwrap(source);
  const value = literalValue(expression);
  if (value !== undefined) return literal(value);
  if (ts.isIdentifier(expression)) {
    if (expression.text === "undefined") return literal(null);
    const binding = scope.bindings.get(expression.text);
    if (binding?.kind === "value") return binding.value;
    return unsupported(context, expression, `Unknown render value ${expression.text}.`);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = compileRenderValue(context, expression.expression, scope);
    return appendRenderPath(context, owner, expression.name.text, expression);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return {
      kind: "array",
      values: expression.elements.map((item) => compileRenderValue(context, item, scope)),
    };
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return {
      kind: "record",
      fields: expression.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) {
          return unsupported(context, property, "Render records require explicit fields.");
        }
        const name = propertyName(property.name);
        if (!name) return unsupported(context, property.name, "Render record keys must be static.");
        return { name, value: compileRenderValue(context, property.initializer, scope) };
      }),
    };
  }
  if (ts.isConditionalExpression(expression)) {
    return {
      kind: "conditional",
      condition: compileRenderValue(context, expression.condition, scope),
      consequent: compileRenderValue(context, expression.whenTrue, scope),
      alternate: compileRenderValue(context, expression.whenFalse, scope),
    };
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = renderBinaryOperator(expression.operatorToken.kind);
    if (!operator)
      return unsupported(context, expression.operatorToken, "This render operator is unsupported.");
    return {
      kind: "binary",
      operator,
      left: compileRenderValue(context, expression.left, scope),
      right: compileRenderValue(context, expression.right, scope),
    };
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    const operator =
      expression.operator === ts.SyntaxKind.ExclamationToken
        ? "!"
        : expression.operator === ts.SyntaxKind.MinusToken
          ? "-"
          : undefined;
    if (!operator)
      return unsupported(context, expression, "This render unary operator is unsupported.");
    return {
      kind: "unary",
      operator,
      value: compileRenderValue(context, expression.operand, scope),
    };
  }
  if (ts.isTemplateExpression(expression)) {
    let result = literal(expression.head.text);
    for (const span of expression.templateSpans) {
      result = {
        kind: "binary",
        operator: "+",
        left: {
          kind: "binary",
          operator: "+",
          left: result,
          right: compileRenderValue(context, span.expression, scope),
        },
        right: literal(span.literal.text),
      };
    }
    return result;
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    if (expression.parameters.length || ts.isBlock(expression.body)) {
      return unsupported(context, expression, "Render value closures must be expression-only.");
    }
    return compileRenderValue(context, expression.body, scope);
  }
  return unsupported(
    context,
    expression,
    `Expression ${ts.SyntaxKind[expression.kind]} is not server-renderable.`,
  );
}

function appendRenderPath(
  context: ProgramSourceContext,
  value: WebRenderValueIR,
  name: string,
  at: ts.Node,
): WebRenderValueIR {
  if (value.kind === "path" || value.kind === "local") {
    return { ...value, path: [...value.path, name] };
  }
  return unsupported(context, at, "Property access requires a named render input or local.");
}

function componentTarget(
  context: ProgramSourceContext,
  binding: RenderBinding | undefined,
  parts: readonly string[],
  at: ts.Node,
): string {
  if (binding?.kind === "component-member") {
    if (parts.length === 1) {
      if (binding.global) {
        return unsupported(context, at, "A root Component namespace must name a Component.");
      }
      return `${binding.feature}.${binding.name}`;
    }
    const feature = [
      ...binding.feature.split(".").filter(Boolean),
      decapitalize(binding.name),
      ...parts.slice(1, -1).map(decapitalize),
    ].join(".");
    return `${feature}.${parts.at(-1)!}`;
  }
  if (binding?.kind === "components") {
    if (parts.length < 2) return unsupported(context, at, "A Component namespace is not UI.");
    const feature = [
      ...binding.feature.split(".").filter(Boolean),
      ...parts.slice(1, -1).map(decapitalize),
    ].join(".");
    return `${feature}.${parts.at(-1)!}`;
  }
  return unsupported(context, at, `Unknown Component ${parts.join(".")}.`);
}

function jsxTagParts(tag: ts.JsxTagNameExpression): string[] {
  if (ts.isIdentifier(tag)) return [tag.text];
  if (ts.isPropertyAccessExpression(tag)) {
    return [...jsxTagParts(tag.expression as ts.JsxTagNameExpression), tag.name.text];
  }
  return [tag.getText()];
}

function renderBinaryOperator(
  kind: ts.SyntaxKind,
): Extract<WebRenderValueIR, { kind: "binary" }>["operator"] | undefined {
  return new Map<ts.SyntaxKind, Extract<WebRenderValueIR, { kind: "binary" }>["operator"]>([
    [ts.SyntaxKind.PlusToken, "+"],
    [ts.SyntaxKind.EqualsEqualsEqualsToken, "==="],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
    [ts.SyntaxKind.LessThanToken, "<"],
    [ts.SyntaxKind.LessThanEqualsToken, "<="],
    [ts.SyntaxKind.GreaterThanToken, ">"],
    [ts.SyntaxKind.GreaterThanEqualsToken, ">="],
    [ts.SyntaxKind.AmpersandAmpersandToken, "&&"],
    [ts.SyntaxKind.BarBarToken, "||"],
    [ts.SyntaxKind.QuestionQuestionToken, "??"],
  ]).get(kind);
}

function literal(value: null | boolean | number | string): WebRenderValueIR {
  return { kind: "literal", value };
}

function literalValue(expression: ts.Expression): null | boolean | number | string | undefined {
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
    return ts.isNumericLiteral(expression) ? Number(expression.text) : expression.text;
  }
  return undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function bindingName(name: ts.BindingName): string | undefined {
  return ts.isIdentifier(name) ? name.text : undefined;
}

function jsxText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function decapitalize(value: string): string {
  return value ? `${value[0]!.toLowerCase()}${value.slice(1)}` : value;
}

function unsupported(context: ProgramSourceContext, at: ts.Node, message: string): never {
  return context.source.fail(at, `Unsupported request-time server rendering: ${message}`);
}

function routeCache(
  source: SourceCompilerAPI,
  type: ts.Type | undefined,
  at: ts.Node,
): WebRouteIR["cache"] {
  if (!type || type.flags & ts.TypeFlags.BooleanLiteral) return false;
  const scope = source.optionalLiteral(type, "Scope", at);
  if (!scope) return false;
  return {
    scope: scope === "private" ? "private" : "public",
    ...optionalStringField(source, type, "MaxAge", "maxAge", at),
    ...optionalStringField(source, type, "StaleWhileRevalidate", "staleWhileRevalidate", at),
  };
}

function routeMetadata(
  context: ProgramSourceContext,
  type: ts.Type | undefined,
  at: ts.Node,
): WebRouteIR["metadata"] {
  if (!type) return {};
  const value = staticTypeValue(context, type, at, "Route Metadata");
  if (!isRecord(value)) return context.source.fail(at, "Route Metadata must be an object.");
  return {
    ...metadataString(value, "Title", "title", context, at),
    ...metadataString(value, "Description", "description", context, at),
    ...metadataString(value, "Language", "language", context, at),
    ...metadataString(value, "Canonical", "canonical", context, at),
    ...metadataString(value, "Robots", "robots", context, at),
    ...(value.Alternates === undefined
      ? {}
      : {
          alternates: Object.entries(metadataRecord(value.Alternates, "Alternates", context, at))
            .map(([language, href]) => {
              if (typeof href !== "string") {
                return context.source.fail(at, "Route Metadata Alternates must contain strings.");
              }
              return { language, href };
            })
            .sort((left, right) => left.language.localeCompare(right.language)),
        }),
    ...(value.Social === undefined
      ? {}
      : { social: compileSocialMetadata(value.Social, context, at) }),
    ...(value.Icons === undefined
      ? {}
      : {
          icons: metadataArray(value.Icons, "Icons", context, at).map((icon) =>
            compileIconMetadata(icon, context, at),
          ),
        }),
    ...(value.StructuredData === undefined
      ? {}
      : {
          structuredData: metadataArray(value.StructuredData, "StructuredData", context, at).map(
            (item) => metadataRecord(item, "StructuredData item", context, at),
          ) as NonNullable<WebRouteIR["metadata"]["structuredData"]>,
        }),
    ...(value.PriorityImage === undefined
      ? {}
      : { priorityImage: compilePriorityImage(value.PriorityImage, context, at) }),
  };
}

function staticTypeValue(
  context: ProgramSourceContext,
  input: ts.Type,
  at: ts.Node,
  subject: string,
  depth = 0,
): unknown {
  if (depth > 20) return context.source.fail(at, `${subject} is nested too deeply.`);
  const { checker } = context;
  let type = checker.getNonNullableType(input);
  if (type.isUnion()) {
    const values = type.types.filter(
      (item) => !(item.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never)),
    );
    if (values.length !== 1) return context.source.fail(at, `${subject} must be a literal value.`);
    type = checker.getNonNullableType(values[0]!);
  }
  if (type.flags & ts.TypeFlags.StringLiteral) return (type as ts.StringLiteralType).value;
  if (type.flags & ts.TypeFlags.NumberLiteral) return (type as ts.NumberLiteralType).value;
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return checker.typeToString(type) === "true";
  }
  if (type.flags & ts.TypeFlags.Null) return null;
  if (checker.isTupleType(type)) {
    return checker
      .getTypeArguments(type as ts.TypeReference)
      .map((item, index) => staticTypeValue(context, item, at, `${subject}[${index}]`, depth + 1));
  }
  if (!(type.flags & ts.TypeFlags.Object)) {
    return context.source.fail(at, `${subject} must be statically known.`);
  }
  const result: Record<string, unknown> = {};
  for (const symbol of context.source.properties(type)) {
    if (symbol.flags & ts.SymbolFlags.Optional) continue;
    const location = symbol.valueDeclaration ?? at;
    result[symbol.getName()] = staticTypeValue(
      context,
      checker.getTypeOfSymbolAtLocation(symbol, location),
      location,
      `${subject}.${symbol.getName()}`,
      depth + 1,
    );
  }
  return result;
}

function metadataString<Key extends string>(
  value: Readonly<Record<string, unknown>>,
  source: string,
  target: Key,
  context: ProgramSourceContext,
  at: ts.Node,
): Partial<Record<Key, string>> {
  const item = value[source];
  if (item === undefined) return {};
  if (typeof item !== "string")
    return context.source.fail(at, `Route Metadata ${source} must be a string.`);
  return { [target]: item } as Partial<Record<Key, string>>;
}

function metadataRecord(
  value: unknown,
  subject: string,
  context: ProgramSourceContext,
  at: ts.Node,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value))
    return context.source.fail(at, `Route Metadata ${subject} must be an object.`);
  return value;
}

function metadataArray(
  value: unknown,
  subject: string,
  context: ProgramSourceContext,
  at: ts.Node,
): readonly unknown[] {
  if (!Array.isArray(value))
    return context.source.fail(at, `Route Metadata ${subject} must be a tuple.`);
  return value;
}

function compileSocialMetadata(
  input: unknown,
  context: ProgramSourceContext,
  at: ts.Node,
): NonNullable<WebRouteIR["metadata"]["social"]> {
  const value = metadataRecord(input, "Social", context, at);
  return {
    ...metadataString(value, "Title", "title", context, at),
    ...metadataString(value, "Description", "description", context, at),
    ...metadataString(value, "Type", "type", context, at),
    ...metadataString(value, "SiteName", "siteName", context, at),
    ...(value.Card === undefined
      ? {}
      : {
          card: metadataChoice(
            value.Card,
            "Social.Card",
            ["summary", "summary_large_image"] as const,
            context,
            at,
          ),
        }),
    ...(value.Images === undefined
      ? {}
      : {
          images: metadataArray(value.Images, "Social.Images", context, at).map((image) => {
            const item = metadataRecord(image, "Social image", context, at);
            return {
              url: requiredMetadataString(item, "URL", context, at),
              ...metadataString(item, "Alt", "alt", context, at),
              ...metadataString(item, "Type", "type", context, at),
              ...metadataNumber(item, "Width", "width", context, at),
              ...metadataNumber(item, "Height", "height", context, at),
            };
          }),
        }),
  };
}

function metadataNumber<Key extends string>(
  value: Readonly<Record<string, unknown>>,
  source: string,
  target: Key,
  context: ProgramSourceContext,
  at: ts.Node,
): Partial<Record<Key, number>> {
  const item = value[source];
  if (item === undefined) return {};
  if (typeof item !== "number")
    return context.source.fail(at, `Route Metadata ${source} must be a number.`);
  return { [target]: item } as Partial<Record<Key, number>>;
}

function compileIconMetadata(
  input: unknown,
  context: ProgramSourceContext,
  at: ts.Node,
): NonNullable<WebRouteIR["metadata"]["icons"]>[number] {
  const value = metadataRecord(input, "Icon", context, at);
  return {
    url: requiredMetadataString(value, "URL", context, at),
    ...(value.Rel === undefined
      ? {}
      : {
          rel: metadataChoice(
            value.Rel,
            "Icon.Rel",
            ["icon", "apple-touch-icon", "mask-icon"] as const,
            context,
            at,
          ),
        }),
    ...metadataString(value, "Type", "type", context, at),
    ...metadataString(value, "Sizes", "sizes", context, at),
    ...metadataString(value, "Media", "media", context, at),
    ...metadataString(value, "Color", "color", context, at),
  };
}

function compilePriorityImage(
  input: unknown,
  context: ProgramSourceContext,
  at: ts.Node,
): NonNullable<WebRouteIR["metadata"]["priorityImage"]> {
  const value = metadataRecord(input, "PriorityImage", context, at);
  return {
    url: requiredMetadataString(value, "URL", context, at),
    ...metadataString(value, "SourceSet", "sourceSet", context, at),
    ...metadataString(value, "Sizes", "sizes", context, at),
    ...metadataString(value, "Type", "type", context, at),
  };
}

function requiredMetadataString(
  value: Readonly<Record<string, unknown>>,
  name: string,
  context: ProgramSourceContext,
  at: ts.Node,
): string {
  const item = value[name];
  if (typeof item !== "string") {
    return context.source.fail(at, `Route Metadata ${name} must be a string.`);
  }
  return item;
}

function metadataChoice<const Values extends readonly string[]>(
  value: unknown,
  subject: string,
  values: Values,
  context: ProgramSourceContext,
  at: ts.Node,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    return context.source.fail(at, `Route Metadata ${subject} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalStringField<Key extends string>(
  source: SourceCompilerAPI,
  type: ts.Type,
  sourceName: string,
  target: Key,
  at: ts.Node,
): Partial<Record<Key, string>> {
  const value = source.optionalLiteral(type, sourceName, at);
  return value === undefined ? {} : ({ [target]: value } as Partial<Record<Key, string>>);
}

function routeParameterList(
  context: ProgramSourceContext,
  schema: ts.Type | undefined,
  at: ts.Node,
): WebRouteIR["params"] {
  const { checker, source } = context;
  return source.properties(schema).map((symbol) => {
    const location = symbol.valueDeclaration ?? at;
    const declared = checker.getTypeOfSymbolAtLocation(symbol, location);
    const optional = Boolean(symbol.flags & ts.SymbolFlags.Optional);
    const validationType = checker.getNonNullableType(declared);
    const validationSymbol = validationType
      .getProperties()
      .find((candidate) => candidate.getName().startsWith("__@validation@"));
    if (!validationSymbol) {
      return source.fail(
        location,
        `Route parameter ${JSON.stringify(symbol.getName())} must use Validate.`,
      );
    }
    const validationTypeValue = checker.getNonNullableType(
      checker.getTypeOfSymbolAtLocation(
        validationSymbol,
        validationSymbol.valueDeclaration ?? location,
      ),
    );
    const value = source.property(validationTypeValue, "Value", location);
    const rules = source.property(validationTypeValue, "Rules", location);
    if (!value) return source.fail(location, "Validate metadata has no Value type.");
    const scalar = scalarType(context, value, location);
    const rule = (name: string) => literalRule(context, rules, name, location);
    const defaultValue = rule("Default");
    return {
      name: symbol.getName(),
      kind: scalar.kind,
      optional,
      ...(scalar.repeated ? { repeated: true as const } : {}),
      ...(scalar.values ? { values: scalar.values } : {}),
      ...(rule("Integer") === true ? { integer: true as const } : {}),
      ...(typeof rule("Minimum") === "number" ? { minimum: rule("Minimum") as number } : {}),
      ...(typeof rule("Maximum") === "number" ? { maximum: rule("Maximum") as number } : {}),
      ...(typeof rule("MinimumLength") === "number"
        ? { minimumLength: rule("MinimumLength") as number }
        : {}),
      ...(typeof rule("MaximumLength") === "number"
        ? { maximumLength: rule("MaximumLength") as number }
        : {}),
      ...(rule("Format") === "uuid" ? { format: "uuid" as const } : {}),
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
    };
  });
}

function scalarType(
  context: ProgramSourceContext,
  type: ts.Type,
  at: ts.Node,
): Readonly<{
  kind: "boolean" | "number" | "string";
  repeated?: true;
  values?: readonly (boolean | number | string)[];
}> {
  const { checker, source } = context;
  const reference = type as ts.TypeReference;
  const collection = reference.target?.symbol?.getName() ?? type.symbol?.getName();
  const element =
    collection === "Array" || collection === "ReadonlyArray"
      ? checker.getIndexTypeOfType(type, ts.IndexKind.Number)
      : undefined;
  if (element) {
    const scalar = scalarType(context, element, at);
    if (scalar.repeated) source.fail(at, "Nested Route parameter collections are unsupported.");
    return { ...scalar, repeated: true };
  }
  const variants = type.isUnion() ? type.types : [type];
  const values: Array<boolean | number | string> = [];
  for (const variant of variants) {
    if (variant.isStringLiteral() || variant.isNumberLiteral()) values.push(variant.value);
    else if (variant.flags & ts.TypeFlags.BooleanLiteral) {
      values.push(checker.typeToString(variant) === "true");
    }
  }
  const kind = variants.every((variant) => variant.flags & ts.TypeFlags.StringLike)
    ? "string"
    : variants.every((variant) => variant.flags & ts.TypeFlags.NumberLike)
      ? "number"
      : variants.every((variant) => variant.flags & ts.TypeFlags.BooleanLike)
        ? "boolean"
        : undefined;
  if (!kind) {
    return source.fail(at, "Route parameters must be scalar values or finite scalar unions.");
  }
  return { kind, ...(values.length === variants.length ? { values } : {}) };
}

function literalRule(
  context: ProgramSourceContext,
  rules: ts.Type | undefined,
  name: string,
  at: ts.Node,
): boolean | number | string | undefined {
  const symbol = rules?.getProperty(name);
  if (!symbol) return undefined;
  const type = context.checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at);
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value;
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return context.checker.typeToString(type) === "true";
  }
  return context.source.fail(at, `Route validation rule ${name} must be a literal.`);
}

function relativeSpan(root: string, span: SourceSpan): SourceSpan {
  return { ...span, file: relative(root, span.file) || span.file };
}
