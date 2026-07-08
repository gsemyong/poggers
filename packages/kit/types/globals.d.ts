type PoggersEnv = Record<string, string | undefined>;

declare const process: {
  readonly env: PoggersEnv;
};

interface ImportMeta {
  readonly env?: PoggersEnv;
}
