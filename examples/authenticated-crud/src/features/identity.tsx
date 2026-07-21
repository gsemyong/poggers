import {
  createIdentity,
  placePrograms,
  type AuthenticatedUser,
  type IdentityClient as FeatureIdentityClient,
  type IdentityFeature as FeatureIdentity,
  type IdentityModel,
  type PlacedFeature,
  type IdentitySession,
  type IdentityService,
} from "@poggers/kit";

export type User = Readonly<{ id: string; name: string; email: string }>;

export type Identity = IdentityModel<{
  Name: "identity";
  Principal: User;
}>;

export type IdentityServer = IdentityService<Identity>;
export type Session = IdentitySession<Identity>;
export type IdentityClient = FeatureIdentityClient<Identity>;
export type IdentityFeature = PlacedFeature<
  FeatureIdentity<Identity>,
  { server: "api"; browser: "browser" }
>;

export const identity = placePrograms(
  createIdentity<Identity>({
    name: "identity",
    principal: (user: AuthenticatedUser): User => user,
  }),
  { server: "api", browser: "browser" },
);
