import type { FeatureContractOf } from "kit";
import {
  createIdentity,
  type AuthenticatedUser,
  type IdentityClient as FeatureIdentityClient,
  type IdentityModel,
  type IdentitySession,
} from "kit/features/identity";

export type User = Readonly<{ id: string; name: string; email: string }>;

export type Identity = IdentityModel<{
  Name: "identity";
  Version: 1;
  Principal: User;
}>;

export type Session = IdentitySession<Identity>;
export type IdentityClient = FeatureIdentityClient<Identity>;

export const identity = createIdentity<Identity>({
  principal: (user: AuthenticatedUser): User => user,
});

export type IdentityBrowserFeature = FeatureContractOf<typeof identity>;
