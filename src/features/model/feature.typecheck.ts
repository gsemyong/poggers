import { createStructuredModel, type StructuredModel } from "@/features/model";

type Decision = StructuredModel<{
  Name: "decision";
  Output: {
    answer: "proceed" | "reconsider";
    reasons: readonly string[];
  };
}>;

export const decision = createStructuredModel<Decision>();
