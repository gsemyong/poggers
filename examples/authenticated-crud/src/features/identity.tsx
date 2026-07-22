import {
  createIdentity,
  type FeatureContractOf,
  placePrograms,
  type AuthenticatedUser,
  type IdentityClient as FeatureIdentityClient,
  type IdentityModel,
  type IdentitySession,
} from "@poggers/kit";

export type User = Readonly<{ id: string; name: string; email: string }>;

export type Identity = IdentityModel<{
  Name: "identity";
  Principal: User;
}>;

export type Session = IdentitySession<Identity>;
export type IdentityClient = FeatureIdentityClient<Identity>;
export type IdentityFeature = FeatureContractOf<typeof identity>;

export const identity = placePrograms(
  createIdentity<Identity>({
    name: "identity",
    principal: (user: AuthenticatedUser): User => user,
  }),
  { server: "api", browser: "browser" },
);
