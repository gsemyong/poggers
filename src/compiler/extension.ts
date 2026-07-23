import type * as ts from "@typescript/typescript6";

import type { ExtensionIR, FunctionIR, SourceSpan, SystemIR, TypeIR } from "@/compiler/ir";

export type SourceCompilerAPI = Readonly<{
  properties(type: ts.Type | undefined): readonly ts.Symbol[];
  property(type: ts.Type, name: string, at: ts.Node): ts.Type | undefined;
  object(value: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined;
  member(object: ts.ObjectLiteralExpression | undefined, name: string): ts.Expression | undefined;
  resolveMember(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined;
  memberDeclaration(
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.ObjectLiteralElementLike | undefined;
  literal(type: ts.Type, name: string, at: ts.Node): string;
  optionalLiteral(type: ts.Type, name: string, at: ts.Node): string | undefined;
  lower(type: ts.Type, at: ts.Node): TypeIR;
  portable(
    declaration: ts.ObjectLiteralElementLike | ts.FunctionLikeDeclaration,
    options: Readonly<{ id: string; name: string }>,
  ): Readonly<{ entry: FunctionIR; functions: readonly FunctionIR[] }>;
  emptyRecord(): TypeIR;
  span(node: ts.Node): SourceSpan;
  fail(node: ts.Node, message: string): never;
}>;

export type FeatureSourceContext = Readonly<{
  checker: ts.TypeChecker;
  source: SourceCompilerAPI;
  contract: ts.Type;
  implementation: ts.ObjectLiteralExpression | undefined;
  location: ts.Node;
  path: string;
  root: string;
}>;

export type ProgramSourceContext = FeatureSourceContext &
  Readonly<{
    feature: string;
    interface?: string;
    name: string;
  }>;

export type SystemSourceContext = Readonly<{
  checker: ts.TypeChecker;
  source: SourceCompilerAPI;
  contract: ts.Type;
  implementation: ts.ObjectLiteralExpression;
  location: ts.Node;
  root: string;
}>;

/** Lets a Platform compiler own meaning carried by generic core as versioned extension IR. */
export type SourceCompilerExtension = Readonly<{
  name: string;
  system?(context: SystemSourceContext): ExtensionIR | undefined;
  feature?(context: FeatureSourceContext): ExtensionIR | undefined;
  program?(context: ProgramSourceContext): ExtensionIR | undefined;
  validate?(ir: SystemIR): void;
}>;
