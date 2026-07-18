import type { PresentationAdapter } from "./presentation";

/** One primitive's platform-specific structure and Presentation contract. */
export type PlatformPrimitive<
  Props extends object = object,
  Target = unknown,
  Declaration extends object = object,
> = Readonly<{
  Props: Props;
  Target: Target;
  Presentation: Declaration;
}>;

/** The complete authoring language contributed by one UI platform. */
export type PlatformContract = Readonly<{
  Name: string;
  Child: unknown;
  Primitives: object;
}>;

type InvalidPlatformPrimitiveName<Platform extends PlatformContract> = {
  [Name in keyof Platform["Primitives"]]: Platform["Primitives"][Name] extends PlatformPrimitive
    ? never
    : Name;
}[keyof Platform["Primitives"]];

/** Rejects contracts containing entries that are not complete primitives. */
export type PlatformDefinition<Platform extends PlatformContract> = [
  InvalidPlatformPrimitiveName<Platform>,
] extends [never]
  ? Platform
  : never;

export type PlatformPrimitiveName<Platform extends PlatformContract> = Extract<
  {
    [Name in keyof Platform["Primitives"]]: Platform["Primitives"][Name] extends PlatformPrimitive
      ? Name
      : never;
  }[keyof Platform["Primitives"]],
  string
>;

type PrimitiveOf<
  Platform extends PlatformContract,
  Primitive extends PlatformPrimitiveName<Platform>,
> = Platform["Primitives"][Primitive];

export type PlatformPrimitiveProps<
  Platform extends PlatformContract,
  Primitive extends PlatformPrimitiveName<Platform>,
> =
  PrimitiveOf<Platform, Primitive> extends PlatformPrimitive<infer Props, unknown, object>
    ? Props
    : never;

export type PlatformPrimitiveTarget<
  Platform extends PlatformContract,
  Primitive extends PlatformPrimitiveName<Platform>,
> =
  PrimitiveOf<Platform, Primitive> extends PlatformPrimitive<object, infer Target, object>
    ? Target
    : never;

export type PlatformPrimitivePresentation<
  Platform extends PlatformContract,
  Primitive extends PlatformPrimitiveName<Platform>,
> =
  PrimitiveOf<Platform, Primitive> extends PlatformPrimitive<object, unknown, infer Declaration>
    ? Declaration
    : never;

export type PlatformChild<Platform extends PlatformContract> = Platform["Child"];

export type PlatformTarget<Platform extends PlatformContract> = {
  [Primitive in PlatformPrimitiveName<Platform>]: PlatformPrimitiveTarget<Platform, Primitive>;
}[PlatformPrimitiveName<Platform>];

/** The Presentation language mechanically associated with a platform. */
export type PlatformPresentationLanguage<Platform extends PlatformContract> = Readonly<{
  Declaration: {
    [Primitive in PlatformPrimitiveName<Platform>]: PlatformPrimitivePresentation<
      Platform,
      Primitive
    >;
  }[PlatformPrimitiveName<Platform>];
  Declarations: {
    readonly [Primitive in PlatformPrimitiveName<Platform>]: PlatformPrimitivePresentation<
      Platform,
      Primitive
    >;
  };
}>;

/**
 * Associates a platform's structural implementation with its Presentation
 * adapter. Structure remains platform-specific; only the pairing is universal.
 */
export type PlatformAdapter<
  Platform extends PlatformContract,
  Structure,
  Target = PlatformTarget<Platform>,
> =
  Platform extends PlatformDefinition<Platform>
    ? Readonly<{
        name: Platform["Name"];
        structure: Structure;
        presentation: PresentationAdapter<PlatformPresentationLanguage<Platform>, Target>;
      }>
    : never;
