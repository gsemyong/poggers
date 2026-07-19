/** One primitive's platform-specific structural contract. */
export type UIPlatformPrimitive<Props extends object = object, Target = unknown> = Readonly<{
  Props: Props;
  Target: Target;
}>;

/** The complete authoring language contributed by one UI platform. */
export type UIPlatformContract = Readonly<{
  Name: string;
  Child: unknown;
  Primitives: object;
}>;

type InvalidUIPlatformPrimitiveName<Platform extends UIPlatformContract> = {
  [Name in keyof Platform["Primitives"]]: Platform["Primitives"][Name] extends UIPlatformPrimitive
    ? never
    : Name;
}[keyof Platform["Primitives"]];

/** Rejects contracts containing entries that are not complete primitives. */
export type UIPlatformDefinition<Platform extends UIPlatformContract> = [
  InvalidUIPlatformPrimitiveName<Platform>,
] extends [never]
  ? Platform
  : never;

export type UIPlatformPrimitiveName<Platform extends UIPlatformContract> = Extract<
  {
    [Name in keyof Platform["Primitives"]]: Platform["Primitives"][Name] extends UIPlatformPrimitive
      ? Name
      : never;
  }[keyof Platform["Primitives"]],
  string
>;

type PrimitiveOf<
  Platform extends UIPlatformContract,
  Primitive extends UIPlatformPrimitiveName<Platform>,
> = Platform["Primitives"][Primitive];

export type UIPlatformPrimitiveProps<
  Platform extends UIPlatformContract,
  Primitive extends UIPlatformPrimitiveName<Platform>,
> =
  PrimitiveOf<Platform, Primitive> extends UIPlatformPrimitive<infer Props, unknown>
    ? Props
    : never;

export type UIPlatformPrimitiveTarget<
  Platform extends UIPlatformContract,
  Primitive extends UIPlatformPrimitiveName<Platform>,
> =
  PrimitiveOf<Platform, Primitive> extends UIPlatformPrimitive<object, infer Target>
    ? Target
    : never;

export type UIPlatformChild<Platform extends UIPlatformContract> = Platform["Child"];

export type UIPlatformTarget<Platform extends UIPlatformContract> = {
  [Primitive in UIPlatformPrimitiveName<Platform>]: UIPlatformPrimitiveTarget<Platform, Primitive>;
}[UIPlatformPrimitiveName<Platform>];

/**
 * Associates a platform's structural implementation with its Presentation
 * adapter. Structure remains platform-specific; only the pairing is universal.
 */
export type UIPlatformAdapter<Platform extends UIPlatformContract, Component, Presentation> =
  Platform extends UIPlatformDefinition<Platform>
    ? Readonly<{
        name: Platform["Name"];
        component: Component;
        presentation: Presentation;
      }>
    : never;
