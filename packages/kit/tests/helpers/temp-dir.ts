import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;

export function createTempDir(): { path: string; cleanup: () => void } {
  counter++;
  const path = mkdtempSync(join(tmpdir(), `na-test-${counter}-`));
  return {
    path,
    cleanup: () => {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {}
    },
  };
}
