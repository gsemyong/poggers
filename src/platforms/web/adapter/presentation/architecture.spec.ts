import { glob, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

const presentationDirectory = import.meta.dirname;

describe("web Presentation mutation ownership", () => {
  it("keeps autonomous browser animation APIs out of the canonical driver", async () => {
    const violations: string[] = [];
    for (const file of await implementationFiles()) {
      const source = await parse(file);
      visit(source, (node, ancestors) => {
        if (!ts.isCallExpression(node)) return;
        const name = calledName(node.expression);
        const allowedNativeAnimation =
          file === "runtime/execution.ts" &&
          name === "animate" &&
          enclosingFunction(ancestors) === "createNativeAnimation";
        if ((name === "animate" && !allowedNativeAnimation) || name === "startViewTransition") {
          violations.push(location(file, source, node, name));
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("permits persistent class and style writes only in the Presentation commit", async () => {
    const violations: string[] = [];
    for (const file of await implementationFiles()) {
      const source = await parse(file);
      visit(source, (node, ancestors) => {
        if (!ts.isCallExpression(node)) return;
        const name = calledName(node.expression);
        if (name === "add" || name === "remove" || name === "replace") {
          const receiver = calledReceiver(node.expression);
          if (receiver === "classList" && file !== "adapter.ts") {
            violations.push(location(file, source, node, `classList.${name}`));
          }
          return;
        }
        if (name !== "setProperty" && name !== "removeProperty") return;
        const owner = enclosingFunction(ancestors);
        const allowed =
          (file === "adapter.ts" && owner === "applyVariables") ||
          (file === "runtime/layout.ts" &&
            (owner === "restoreProperty" || owner === "suspendTransforms"));
        if (!allowed) violations.push(location(file, source, node, `${owner}.${name}`));
      });
    }
    expect(violations).toEqual([]);
  });

  it("limits temporary measurement writes to synchronously restored transform properties", async () => {
    const source = await parse("runtime/layout.ts");
    const sourceText = await readFile(resolve(presentationDirectory, "runtime/layout.ts"), "utf8");
    const written = new Set<string>();
    visit(source, (node, ancestors) => {
      if (!ts.isCallExpression(node) || calledName(node.expression) !== "setProperty") return;
      if (enclosingFunction(ancestors) !== "suspendTransforms") return;
      const property = node.arguments[0];
      if (property && ts.isIdentifier(property)) written.add(property.text);
    });
    expect(written).toEqual(new Set(["name"]));
    expect(sourceText).toContain(
      'const transformProperties = ["translate", "rotate", "scale", "transform"] as const;',
    );
    expect(sourceText).toContain(
      'for (const name of transformProperties) style.setProperty(name, "none");',
    );
    expect(sourceText).toContain(
      "finally {\n      for (const transform of suspended) restoreTransforms(transform);\n    }",
    );
  });
});

async function implementationFiles(): Promise<string[]> {
  const result: string[] = [];
  for await (const file of glob("**/*.ts", { cwd: presentationDirectory })) {
    if (!file.endsWith(".spec.ts")) result.push(file);
  }
  return result.sort();
}

async function parse(file: string): Promise<ts.SourceFile> {
  const text = await readFile(resolve(presentationDirectory, file), "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function visit(
  source: ts.SourceFile,
  inspect: (node: ts.Node, ancestors: readonly ts.Node[]) => void,
): void {
  const walk = (node: ts.Node, ancestors: readonly ts.Node[]) => {
    inspect(node, ancestors);
    node.forEachChild((child) => walk(child, [...ancestors, node]));
  };
  walk(source, []);
}

function calledName(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function calledReceiver(expression: ts.LeftHandSideExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const receiver = expression.expression;
  return ts.isPropertyAccessExpression(receiver) ? receiver.name.text : undefined;
}

function enclosingFunction(ancestors: readonly ts.Node[]): string {
  for (const node of [...ancestors].reverse()) {
    if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.parent &&
      ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      return node.parent.name.text;
    }
  }
  return "<module>";
}

function location(file: string, source: ts.SourceFile, node: ts.Node, operation: string): string {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${file}:${position.line + 1}:${position.character + 1} ${operation}`;
}
