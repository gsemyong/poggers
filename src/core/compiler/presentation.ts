import * as ts from "@typescript/typescript6";

import type { SourceSpan } from "@/core/compiler/ir";

export type PresentationAnimationIR = Readonly<{
  id: string;
  scope: string;
  binding: string;
  source: string;
  animation: string;
  events: readonly string[];
  span: SourceSpan;
}>;

export type PresentationDeclarationIR = Readonly<{
  destination: string;
  expression: string;
  animations: readonly string[];
  span: SourceSpan;
}>;

export type PresentationSourceIR = Readonly<{
  file: string;
  animations: readonly PresentationAnimationIR[];
  declarations: readonly PresentationDeclarationIR[];
}>;

export type PresentationSourceCompilation = Readonly<{
  ir: PresentationSourceIR;
  code: string;
}>;

type AnimationBinding = Readonly<{
  id: string;
  declaration: ts.VariableDeclaration;
  call: ts.CallExpression;
  source: ts.Expression;
  animation: ts.Expression;
  scope: string;
  name: string;
}>;

type DeclarationCollection = Readonly<{
  ir: readonly PresentationDeclarationIR[];
  temporal: ReadonlyMap<ts.ObjectLiteralElementLike, readonly string[]>;
}>;

export class PresentationSourceDiagnostic extends Error {
  readonly span: SourceSpan;

  constructor(message: string, span: SourceSpan) {
    super(`${span.file}:${span.line}:${span.column}: ${message}`);
    this.name = "PresentationSourceDiagnostic";
    this.span = span;
  }
}

/** Analyzes and lowers compiler intrinsics without executing authored source. */
export function compilePresentationSource(
  source: string,
  fileName = "presentation.ts",
): PresentationSourceCompilation {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const bindings = collectAnimationBindings(file);
  if (bindings.length === 0) {
    return {
      ir: Object.freeze({
        file: fileName,
        animations: Object.freeze([]),
        declarations: Object.freeze([]),
      }),
      code: source,
    };
  }
  validatePresentationSource(file, bindings);
  const byDeclaration = new Map(bindings.map((binding) => [binding.declaration, binding]));
  const byCall = new Map(bindings.map((binding) => [binding.call, binding]));
  const declarations = collectDeclarations(file, bindings);
  const byBindingDeclaration = new Map(
    bindings.map((binding) => [binding.declaration, binding] as const),
  );
  const bindingsByName = animationBindingsByName(bindings);

  const result = ts.transform(file, [
    (context) => {
      const visit: ts.Visitor = (node) => {
        if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
          const dependencies = declarations.temporal.get(node);
          if (dependencies) {
            const source = ts.isPropertyAssignment(node) ? node.initializer : node.name;
            const current = ts.visitNode(source, visit) as ts.Expression;
            const sampled = expandTemporalExpression({
              file,
              expression: source,
              context,
              bindingsByName,
              byBindingDeclaration,
            });
            const value = context.factory.createCallExpression(
              context.factory.createPropertyAccessExpression(
                context.factory.createIdentifier("animate"),
                "temporal",
              ),
              undefined,
              [
                current,
                context.factory.createArrowFunction(
                  undefined,
                  undefined,
                  [],
                  undefined,
                  context.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                  sampled,
                ),
                context.factory.createArrayLiteralExpression(
                  dependencies.map((identity) => context.factory.createStringLiteral(identity)),
                ),
              ],
            );
            return context.factory.createPropertyAssignment(
              ts.isShorthandPropertyAssignment(node)
                ? context.factory.createIdentifier(node.name.text)
                : node.name,
              value,
            );
          }
        }
        if (ts.isCallExpression(node) && byCall.has(node)) {
          const binding = byCall.get(node)!;
          return context.factory.updateCallExpression(node, node.expression, node.typeArguments, [
            ...node.arguments,
            context.factory.createStringLiteral(binding.id),
          ]);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          (node.expression.text === "velocity" || node.expression.text === "settled")
        ) {
          const argument = node.arguments[0] && unwrap(node.arguments[0]);
          if (!argument || !ts.isIdentifier(argument)) {
            throw diagnostic(
              file,
              node,
              `${node.expression.text}() must reference a directly named animate() binding.`,
            );
          }
          const declaration = resolveVariableDeclaration(argument);
          const binding = declaration && byDeclaration.get(declaration);
          if (!binding) {
            throw diagnostic(
              file,
              node,
              `${node.expression.text}() must reference a directly named animate() binding.`,
            );
          }
          return context.factory.updateCallExpression(node, node.expression, node.typeArguments, [
            ...node.arguments,
            context.factory.createStringLiteral(binding.id),
          ]);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (root) => ts.visitNode(root, visit) as ts.SourceFile;
    },
  ]);
  const transformed = result.transformed[0] as ts.SourceFile;
  const code = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed);
  result.dispose();

  return Object.freeze({
    ir: Object.freeze({
      file: fileName,
      animations: Object.freeze(
        bindings
          .map((binding) =>
            Object.freeze({
              id: binding.id,
              scope: binding.scope,
              binding: binding.name,
              source: normalize(binding.source.getText(file)),
              animation: normalize(binding.animation.getText(file)),
              events: Object.freeze(eventDependencies(binding.source, file)),
              span: spanOf(file, binding.call),
            }),
          )
          .sort(({ id: left }, { id: right }) => left.localeCompare(right)),
      ),
      declarations: Object.freeze(declarations.ir),
    }),
    code,
  });
}

/** Vite/compiler convenience for source that may not contain Presentation intrinsics. */
export function transformPresentationSource(source: string, fileName?: string): string {
  return source.includes("animate(") || source.includes("velocity(") || source.includes("settled(")
    ? compilePresentationSource(source, fileName).code
    : source;
}

function collectAnimationBindings(file: ts.SourceFile): AnimationBinding[] {
  const result: AnimationBinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "animate"
    ) {
      if (node.arguments.length !== 2) {
        throw diagnostic(file, node, "animate() requires exactly a source and an Animation.");
      }
      const declaration = directConstBinding(file, node);
      const scope = lexicalScope(file, declaration);
      const name = (declaration.name as ts.Identifier).text;
      result.push({
        id: `${scope}::${name}`,
        declaration,
        call: node,
        source: node.arguments[0]!,
        animation: node.arguments[1]!,
        scope,
        name,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const identities = new Set<string>();
  for (const binding of result) {
    if (identities.has(binding.id)) {
      throw diagnostic(
        file,
        binding.call,
        `Duplicate Animation identity ${JSON.stringify(binding.id)}.`,
      );
    }
    identities.add(binding.id);
  }
  return result;
}

function directConstBinding(file: ts.SourceFile, call: ts.CallExpression): ts.VariableDeclaration {
  let current: ts.Expression = call;
  while (isTransparentExpression(current.parent)) current = current.parent;
  const declaration = current.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== current ||
    !ts.isIdentifier(declaration.name)
  ) {
    throw diagnostic(
      file,
      call,
      "animate() must be assigned directly to a named const binding for stable identity.",
    );
  }
  if (!(declaration.parent.flags & ts.NodeFlags.Const)) {
    throw diagnostic(file, call, "Animation bindings must be const.");
  }
  return declaration;
}

function lexicalScope(file: ts.SourceFile, declaration: ts.VariableDeclaration): string {
  const names: string[] = [];
  let node: ts.Node | undefined = declaration.parent;
  while (node && !ts.isSourceFile(node)) {
    if (ts.isMethodDeclaration(node) && node.name) names.push(propertyName(file, node.name));
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const parent = unwrapParent(node);
      if (ts.isPropertyAssignment(parent)) names.push(propertyName(file, parent.name));
      else if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        names.push(parent.name.text);
      } else if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
        throw diagnostic(
          file,
          declaration,
          "animate() inside an unkeyed callback has no stable structural identity.",
        );
      }
    }
    if (ts.isFunctionDeclaration(node)) {
      throw diagnostic(
        file,
        declaration,
        "A reusable helper cannot own Animation history; return an Animation description or source instead.",
      );
    }
    node = node.parent;
  }
  const path = names.reverse();
  if (path.length === 0) path.push("Presentation");
  return path.join("/");
}

function validatePresentationSource(
  file: ts.SourceFile,
  bindings: readonly AnimationBinding[],
): void {
  const roots = new Set(bindings.map(({ call }) => outerFunction(call)).filter(Boolean));
  for (const root of roots) {
    const visit = (node: ts.Node): void => {
      if (ts.isAwaitExpression(node)) throw diagnostic(file, node, "Presentation cannot await.");
      if (ts.isNewExpression(node))
        throw diagnostic(file, node, "Presentation cannot construct resources.");
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        throw diagnostic(file, node, "Presentation cannot mutate state.");
      }
      if (ts.isCallExpression(node)) {
        const callee = normalize(node.expression.getText(file));
        if (
          [
            "Date.now",
            "Math.random",
            "fetch",
            "setTimeout",
            "setInterval",
            "queueMicrotask",
          ].includes(callee)
        ) {
          throw diagnostic(file, node, `Presentation cannot call ${callee}.`);
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ["getBoundingClientRect", "addEventListener", "subscribe"].includes(
            node.expression.name.text,
          )
        ) {
          throw diagnostic(
            file,
            node,
            "Presentation cannot access native handles or subscriptions.",
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    if (root) visit(root);
  }
}

function collectDeclarations(
  file: ts.SourceFile,
  bindings: readonly AnimationBinding[],
): DeclarationCollection {
  const byName = animationBindingsByName(bindings);
  const result: PresentationDeclarationIR[] = [];
  const temporal = new Map<ts.ObjectLiteralElementLike, readonly string[]>();
  const visit = (node: ts.Node, path: readonly string[] = []): void => {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = propertyName(file, node.name);
      const expression = ts.isPropertyAssignment(node) ? node.initializer : node.name;
      const value = unwrap(expression);
      if (ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) visit(property, [...path, name]);
        return;
      }
      if (ts.isArrayLiteralExpression(value)) {
        for (const element of value.elements) visit(element, [...path, name]);
        return;
      }
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        ts.forEachChild(value, (child) => visit(child, [...path, name]));
        return;
      } else {
        const dependencies = animationDependencies(value, byName);
        if (dependencies.length) {
          temporal.set(node, Object.freeze(dependencies));
          result.push(
            Object.freeze({
              destination: [...path, name].join("/"),
              expression: normalize(value.getText(file)),
              animations: Object.freeze(dependencies),
              span: spanOf(file, value),
            }),
          );
        }
      }
    } else if (ts.isMethodDeclaration(node) && node.name) {
      ts.forEachChild(node, (child) => visit(child, [...path, propertyName(file, node.name)]));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, path));
  };
  visit(file);
  return Object.freeze({
    ir: Object.freeze(
      result.sort(({ destination: left }, { destination: right }) => left.localeCompare(right)),
    ),
    temporal,
  });
}

function animationBindingsByName(
  bindings: readonly AnimationBinding[],
): Map<string, AnimationBinding[]> {
  const result = new Map<string, AnimationBinding[]>();
  for (const binding of bindings) {
    const entries = result.get(binding.name) ?? [];
    entries.push(binding);
    result.set(binding.name, entries);
  }
  return result;
}

function expandTemporalExpression(options: {
  file: ts.SourceFile;
  expression: ts.Expression;
  context: ts.TransformationContext;
  bindingsByName: ReadonlyMap<string, readonly AnimationBinding[]>;
  byBindingDeclaration: ReadonlyMap<ts.VariableDeclaration, AnimationBinding>;
}): ts.Expression {
  const expanding = new Set<ts.VariableDeclaration>();
  const visit: ts.Visitor = (node) => {
    if (ts.isIdentifier(node) && (node === options.expression || isValueReference(node))) {
      const declaration = resolveVariableDeclaration(node);
      const binding = declaration && options.byBindingDeclaration.get(declaration);
      if (binding) {
        return options.context.factory.createCallExpression(
          options.context.factory.createPropertyAccessExpression(
            options.context.factory.createIdentifier("animate"),
            "value",
          ),
          undefined,
          [options.context.factory.createStringLiteral(binding.id)],
        );
      }
      if (
        declaration?.initializer &&
        animationDependencies(declaration.initializer, options.bindingsByName).length
      ) {
        if (expanding.has(declaration)) {
          throw diagnostic(options.file, node, "A temporal declaration dependency is recursive.");
        }
        expanding.add(declaration);
        const expanded = ts.visitNode(declaration.initializer, visit) as ts.Expression;
        expanding.delete(declaration);
        return options.context.factory.createParenthesizedExpression(expanded);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "velocity" || node.expression.text === "settled")
    ) {
      const argument = node.arguments[0] && unwrap(node.arguments[0]);
      const declaration =
        argument && ts.isIdentifier(argument) && resolveVariableDeclaration(argument);
      const binding = declaration && options.byBindingDeclaration.get(declaration);
      if (!binding) {
        throw diagnostic(
          options.file,
          node,
          `${node.expression.text}() must reference a directly named animate() binding.`,
        );
      }
      return options.context.factory.updateCallExpression(
        node,
        node.expression,
        node.typeArguments,
        [
          ...(node.arguments.map((value) => ts.visitNode(value, visit)) as ts.Expression[]),
          options.context.factory.createStringLiteral(binding.id),
        ],
      );
    }
    return ts.visitEachChild(node, visit, options.context);
  };
  return ts.visitNode(options.expression, visit) as ts.Expression;
}

function isValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }
  if (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }
  return true;
}

function animationDependencies(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, readonly AnimationBinding[]>,
): string[] {
  const result = new Set<string>();
  const visited = new Set<ts.VariableDeclaration>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const declaration = resolveVariableDeclaration(node);
      for (const binding of bindings.get(node.text) ?? []) {
        if (binding.declaration === declaration) result.add(binding.id);
      }
      if (
        declaration?.initializer &&
        !ts.isArrowFunction(unwrap(declaration.initializer)) &&
        !ts.isFunctionExpression(unwrap(declaration.initializer)) &&
        !visited.has(declaration)
      ) {
        visited.add(declaration);
        visit(declaration.initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return [...result].sort();
}

function resolveVariableDeclaration(identifier: ts.Identifier): ts.VariableDeclaration | undefined {
  let scope: ts.Node | undefined = identifier;
  while (scope) {
    const candidate = findDeclarationBefore(scope, identifier.text, identifier.pos);
    if (candidate) return candidate;
    scope = scope.parent;
  }
  return undefined;
}

function findDeclarationBefore(
  root: ts.Node,
  name: string,
  before: number,
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (node.pos >= before) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.pos < before
    ) {
      if (!found || node.pos > found.pos) found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function outerFunction(node: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  let result: ts.Node | undefined;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) result = current;
    current = current.parent;
  }
  return result;
}

function eventDependencies(expression: ts.Expression, file: ts.SourceFile): string[] {
  const result = new Set<string>();
  const visited = new Set<ts.VariableDeclaration>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      !ts.isPropertyAccessExpression(node.parent) &&
      propertyRoot(node).text === "events"
    ) {
      result.add(normalize(node.getText(file)));
      return;
    }
    if (ts.isIdentifier(node) && node.text !== "events") {
      const declaration = resolveVariableDeclaration(node);
      if (declaration?.initializer && !visited.has(declaration)) {
        visited.add(declaration);
        visit(declaration.initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return [...result].sort();
}

function propertyRoot(expression: ts.PropertyAccessExpression): ts.Identifier {
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return current as ts.Identifier;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (isTransparentExpression(current)) current = current.expression;
  return current;
}

function unwrapParent(node: ts.Node): ts.Node {
  let current = node;
  while (isTransparentExpression(current.parent)) current = current.parent;
  return current.parent;
}

function isTransparentExpression(
  node: ts.Node | undefined,
): node is
  | ts.ParenthesizedExpression
  | ts.SatisfiesExpression
  | ts.AsExpression
  | ts.TypeAssertion {
  return Boolean(
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node)),
  );
}

function propertyName(file: ts.SourceFile, name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw diagnostic(file, name, "Computed Presentation property names are not portable.");
}

function diagnostic(file: ts.SourceFile, node: ts.Node, message: string) {
  return new PresentationSourceDiagnostic(message, spanOf(file, node));
}

function spanOf(file: ts.SourceFile, node: ts.Node): SourceSpan {
  const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return Object.freeze({ file: file.fileName, line: line + 1, column: character + 1 });
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
