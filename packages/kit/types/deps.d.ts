export type DependencyProvider<Value> = Value | (() => Value | Promise<Value>);
export type DependencyProviderSet<Value> = {
  production: DependencyProvider<Value>;
  mock?: DependencyProvider<Value>;
} & Record<string, DependencyProvider<Value> | undefined>;
export type DependencyEntry<Value> = DependencyProviderSet<Value> | DependencyProvider<Value>;
export type DependencyConfig<Deps> = {
  mode?: string | (() => string | Promise<string>);
  deps?: {
    [Name in keyof Deps]: DependencyEntry<Deps[Name]>;
  };
} & {
  [Name in keyof Deps]?: DependencyEntry<Deps[Name]>;
};
export type DependencyMount<Deps> = (() => Deps | Promise<Deps>) | Deps | DependencyConfig<Deps>;
