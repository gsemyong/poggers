export type PoggersEnv = Record<string, string | undefined>;

export function env(name: string): string | undefined;
export function env(): Readonly<PoggersEnv>;
