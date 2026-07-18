import { resolve } from "node:path";

import * as ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

describe("Presentation authoring grammar", () => {
  it(
    "extracts satisfies-authored tokens, Components, props, state, and targets without execution",
    { timeout: 30_000 },
    () => {
      const entry = resolve(import.meta.dirname, "presentation.typecheck.ts");
      const configuration = ts.findConfigFile(
        import.meta.dirname,
        ts.sys.fileExists,
        "tsconfig.json",
      );
      expect(configuration).toBeDefined();
      const parsed = ts.getParsedCommandLineOfConfigFile(configuration!, {}, compilerHost());
      expect(parsed?.errors).toEqual([]);
      const program = ts.createProgram([entry], {
        ...parsed?.options,
        noEmit: true,
      });
      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      expect(diagnostics.map(formatDiagnostic)).toEqual([]);

      const source = program.getSourceFile(entry);
      expect(source).toBeDefined();
      const declaration = source?.statements.find(
        (statement): statement is ts.VariableStatement =>
          ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(
            (item) => ts.isIdentifier(item.name) && item.name.text === "referencePresentation",
          ),
      );
      expect(declaration).toBeDefined();
      const variable = declaration?.declarationList.declarations.find(
        (item) => ts.isIdentifier(item.name) && item.name.text === "referencePresentation",
      );
      expect(variable).toBeDefined();

      const checker = program.getTypeChecker();
      const presentation = checker.getTypeAtLocation(variable!.name);
      const materialize = presentation.getCallSignatures()[0];
      expect(materialize).toBeDefined();
      expect(
        properties(checker.getTypeOfSymbolAtLocation(materialize!.parameters[0]!, variable!)),
      ).toEqual(["emphasis"]);

      const definition = materialize!.getReturnType();
      expect(properties(definition)).toEqual(["Badge", "Child"]);
      const badge = checker.getPropertyOfType(definition, "Badge");
      expect(badge).toBeDefined();
      const badgeType = checker.getTypeOfSymbolAtLocation(badge!, variable!);
      const scope = badgeType.getCallSignatures()[0]?.parameters[0];
      expect(scope).toBeDefined();
      const scopeType = checker.getTypeOfSymbolAtLocation(scope!, variable!);
      expect(properties(scopeType)).toEqual(["props", "state", "targets"]);
    },
  );
});

function compilerHost(): ts.ParseConfigFileHost {
  return {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(formatDiagnostic(diagnostic));
    },
  };
}

function properties(type: ts.Type): string[] {
  return type
    .getProperties()
    .map((property) => property.getName())
    .sort((left, right) => left.localeCompare(right));
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
