import { createData, type DataApi, type DataModel } from "@/features/data";

type Documents = DataModel<{
  Name: "documents";
  Principal: Readonly<{ id: string }>;
  Record: Readonly<{
    id: string;
    ownerId: string;
    title: string;
    body: string;
    priority: number;
    archived: boolean;
    metadata: Readonly<{ source: string }>;
  }>;
  Create: Readonly<{ title: string; body: string }>;
  Update: Readonly<{ title?: string; body?: string; archived?: boolean }>;
}>;

createData<Documents>({
  indexes: ["ownerId", "priority", "archived"],
  search: ["title", "body"],
  create: ({ id, principal, input }) => ({
    id,
    ownerId: principal.id,
    title: input.title,
    body: input.body,
    priority: 0,
    archived: false,
    metadata: { source: "manual" },
  }),
  update: ({ previous, input }) => ({ ...previous, ...input }),
  authorize: ({ principal, record }) => principal.id === record.ownerId,
});

declare const documents: DataApi<Documents>;
documents.query({
  where: {
    archived: false,
    priority: { atLeast: 2, lessThan: 10 },
    title: { oneOf: ["First", "Second"] },
  },
  order: [{ field: "priority", direction: "descending" }],
  limit: 20,
});
documents.search({ text: "portable programs", where: { archived: false } });
documents.create({ title: "Typed", body: "Meaning" });
documents.update({ id: "one", changes: { archived: true } });

createData<Documents>({
  // @ts-expect-error Search fields must contain text.
  search: ["priority"],
  create: () => ({}) as Documents["Record"],
  update: () => ({}) as Documents["Record"],
  authorize: () => true,
});

documents.query({
  where: {
    // @ts-expect-error Object-valued fields have no portable query equality.
    metadata: { source: "import" },
  },
});
documents.query({
  where: {
    // @ts-expect-error Numeric predicates retain their field type.
    priority: { atLeast: "high" },
  },
});
documents.query({
  // @ts-expect-error Boolean fields cannot define an ordering.
  order: [{ field: "archived" }],
});
// @ts-expect-error Create input is inferred from the semantic model.
documents.create({ title: "Missing body" });
