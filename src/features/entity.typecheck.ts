import type { UIContributionAPI } from "@/core/feature";
import {
  createEntity,
  type EntityApi,
  type EntityFeature,
  type EntityModel,
  type EntityService,
} from "@/features/entity";

type Valid = EntityModel<{
  Name: "notes";
  Principal: { id: string };
  Value: { id: string; text: string };
  Create: { text: string };
  Update: { text?: string };
  Filter: { text?: string };
}>;

declare const api: EntityApi<Valid>;
api.create({ text: "note" }) satisfies Promise<{ readonly id: string; readonly text: string }>;
api.update({ id: "note", changes: { text: "updated" } });
declare const service: EntityService<Valid>;
service.create({ principal: { id: "owner" }, value: { text: "note" } }) satisfies Promise<{
  readonly id: string;
  readonly text: string;
}>;

declare const state: UIContributionAPI<EntityFeature<Valid>>;
state.entities satisfies readonly Valid["Value"][];
state.synchronization satisfies
  | "signed-out"
  | "loading"
  | "synchronizing"
  | "synchronized"
  | "offline";
state.create({ text: "Local first" }) satisfies Valid["Value"];
state.update({ id: "note", changes: { text: "Immediate" } }) satisfies Valid["Value"];

// @ts-expect-error Entity values require stable string identity.
type MissingIdentity = EntityModel<{
  Name: "invalid";
  Principal: { id: string };
  Value: { text: string };
  Create: { text: string };
  Update: { text?: string };
  Filter: {};
}>;

void (undefined as unknown as MissingIdentity);

// @ts-expect-error Create input is exact and does not accept unknown fields.
api.create({ text: "note", unknown: true });

createEntity<Valid>({
  name: "notes",
  // @ts-expect-error Domain creation must return the model's complete Entity value.
  create: ({ input }) => ({ text: input.text }),
  update: ({ previous, input }) => ({ ...previous, ...input }),
  authorize: () => true,
});
