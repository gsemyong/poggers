export function env(name: string): string | undefined;
export function env(): Readonly<Record<string, string | undefined>>;
export function env(
  name?: string,
): string | undefined | Readonly<Record<string, string | undefined>> {
  const values = readProcessEnv();
  return name === undefined ? values : values[name];
}

function readProcessEnv(): Record<string, string | undefined> {
  return (
    (
      globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env ?? {}
  );
}
