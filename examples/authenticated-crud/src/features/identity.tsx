import {
  createIdentity,
  type FeatureContractOf,
  placePrograms,
  type AuthenticatedUser,
  type IdentityClient as FeatureIdentityClient,
  type IdentityModel,
  type IdentitySession,
} from "@duction/kit";

export type User = Readonly<{ id: string; name: string; email: string }>;

export type Identity = IdentityModel<{
  Name: "identity";
  Principal: User;
}>;

export type Session = IdentitySession<Identity>;
export type IdentityClient = FeatureIdentityClient<Identity>;

export const identity = createIdentity<Identity>({
  name: "identity",
  principal: (user: AuthenticatedUser): User => user,
});

export const identityServer = placePrograms(identity.server, { server: "api" });
export const identityBrowser = placePrograms(identity.browser, { browser: "browser" });

export type IdentityBrowserFeature = FeatureContractOf<typeof identityBrowser>;
