import type * as ts from "@typescript/typescript6";

import type {
  DependencyIR,
  ExtensionIR,
  FunctionIR,
  SourceSpan,
  SystemIR,
  TypeIR,
} from "@/compiler/ir";

export type SourceCompilerAPI = Readonly<{
  properties(type: ts.Type | undefined): readonly ts.Symbol[];
  property(type: ts.Type, name: string, at: ts.Node): ts.Type | undefined;
  object(value: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined;
  member(object: ts.ObjectLiteralExpression | undefined, name: string): ts.Expression | undefined;
  resolveMember(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined;
  callable(
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.FunctionLikeDeclaration | ts.ObjectLiteralElementLike | undefined;
  sources(value: ts.Expression): readonly Readonly<{ path: string; text: string }>[];
  memberDeclaration(
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.ObjectLiteralElementLike | undefined;
  constant(value: ts.Expression): ExtensionIR | undefined;
  literal(type: ts.Type, name: string, at: ts.Node): string;
  optionalLiteral(type: ts.Type, name: string, at: ts.Node): string | undefined;
  numberLiteral(type: ts.Type, name: string, at: ts.Node): number;
  lower(type: ts.Type, at: ts.Node): TypeIR;
  dependencies(type: ts.Type, at: ts.Node): readonly DependencyIR[];
  portable(
    declaration: ts.ObjectLiteralElementLike | ts.FunctionLikeDeclaration | ts.Expression,
    options: Readonly<{
      context?: Readonly<{
        dependencies: string;
        provides?: string;
      }>;
      id: string;
      name: string;
      parameterIRTypes?: readonly TypeIR[];
      provides?: readonly string[];
    }>,
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
    app?: string;
    feature: string;
    interface?: string;
    implementationOrigin: "direct" | "expanded" | "unresolved";
    name: string;
    platform: string;
  }>;

export type InterfaceSourceContext = FeatureSourceContext &
  Readonly<{
    app: string;
    platform: string;
  }>;

export type SystemSourceContext = Readonly<{
  checker: ts.TypeChecker;
  source: SourceCompilerAPI;
  contract: ts.Type;
  implementation: ts.ObjectLiteralExpression;
  location: ts.Node;
  root: string;
}>;

/** Serializable, independently versioned meaning owned by one Platform dialect. */
export type VersionedExtensionIR = object & Readonly<{ version: number }>;

/** One dialect compilation plus the exact source ownership used for invalidation. */
export type SourceDialectCompilation = Readonly<{
  ir: VersionedExtensionIR;
  sources?: readonly string[];
}>;

/** Lets a Platform compiler own meaning carried by generic core as versioned extension IR. */
export type SourceCompilerExtension = Readonly<{
  /** The Platform identity whose Program and Application-interface languages this owns. */
  name: string;
  cacheSources?: readonly string[];
  system?(context: SystemSourceContext): ExtensionIR | undefined;
  feature?(context: FeatureSourceContext): ExtensionIR | undefined;
  interface?(context: InterfaceSourceContext): SourceDialectCompilation;
  program?(context: ProgramSourceContext): SourceDialectCompilation;
  validate?(ir: SystemIR): void;
}>;
