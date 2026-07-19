/** The stable identity of one Feature contribution to a named Program. */
export type ProgramContributionAddress = Readonly<{
  program: string;
  feature: string;
}>;

/** Resolves external Capabilities required by one Program contribution. */
export type CapabilityResolver = Readonly<{
  resolve(
    address: ProgramContributionAddress,
  ): Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
}>;
