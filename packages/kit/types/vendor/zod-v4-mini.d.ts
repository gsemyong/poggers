type ZodSchema = unknown;

export const z: {
  array(schema: ZodSchema): ZodSchema;
  discriminatedUnion(discriminator: string, schemas: ZodSchema[]): ZodSchema;
  literal(value: string | number | boolean | null): ZodSchema;
  object(shape: Record<string, ZodSchema>): ZodSchema;
  string(): ZodSchema;
  union(schemas: ZodSchema[]): ZodSchema;
};
