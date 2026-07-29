import type {
  Dependency,
  DependencyImplementation,
  DependencyImplementations,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { typeSchema, type TypeSchema } from "@/core/intrinsic";
import type { ServerDependencyProvider, ServerProcess } from "@/platforms/server";

export { vercelAiGatewayRealtime } from "@/features/model/realtime";
export type {
  RealtimeActionDefinition,
  RealtimeConnection,
  RealtimeCredential,
  RealtimeCredentials,
  RealtimeServerEvent,
  RealtimeSession,
  RealtimeTranscription,
  RealtimeTransport,
  RealtimeTurnDetection,
} from "@/features/model/realtime";

export type LanguageModelMessage = Readonly<{
  role: "system" | "user" | "assistant";
  content: string;
}>;

export type LanguageModelUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
}>;

export type LanguageModelResult = Readonly<{
  text: string;
  value?: object;
  finishReason: string;
  usage: LanguageModelUsage;
}>;

export type LanguageModel = Dependency<{
  Operations: {
    generate(input: {
      model?: string;
      messages: readonly LanguageModelMessage[];
      temperature?: number;
      maxTokens?: number;
      output?: Readonly<{
        name: string;
        description?: string;
        schema: TypeSchema;
      }>;
    }): Promise<LanguageModelResult>;
  };
}>;

type LanguageModelFeatureContract = Readonly<{
  Providers: {
    server: {
      model: ServerDependencyProvider<LanguageModel>;
    };
  };
}>;

type StructuredModelInput = Readonly<{
  Name: string;
  Output: object;
}>;

export type StructuredModelDefinition = Readonly<{
  Name: string;
  Output: object;
}>;

/** Validates the semantic name and output carried by one structured model Feature. */
export type StructuredModel<Model extends StructuredModelInput> = Readonly<Model>;

export type StructuredModelApi<Model extends StructuredModelDefinition> = Dependency<{
  Operations: {
    generate(input: {
      model?: string;
      messages: readonly LanguageModelMessage[];
      temperature?: number;
      maxTokens?: number;
    }): Promise<
      Readonly<{
        value: Model["Output"];
        finishReason: string;
        usage: LanguageModelUsage;
      }>
    >;
  };
}>;

export type StructuredModelFeature<Model extends StructuredModelDefinition> = Readonly<{
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: { model: LanguageModel };
      Provides: Readonly<{ [Name in Model["Name"]]: StructuredModelApi<Model> }>;
    };
  };
}>;

/**
 * Derives a model's structured-output schema from its generic declaration.
 * Product code receives the typed value; provider wire formats remain private.
 */
export function createStructuredModel<const Model extends StructuredModelDefinition>(): Feature<
  StructuredModelFeature<Model>
> {
  return createFeature<StructuredModelFeature<Model>>({
    programs: {
      server: {
        start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const schema = typeSchema<Model["Output"]>();
          const implementation = {
            async generate({ input, invocation }) {
              const generated = await dependencies.model.generate(
                {
                  ...input,
                  output: {
                    name,
                    schema,
                  },
                },
                { idempotencyKey: invocation.id },
              );
              if (generated.value === undefined) {
                throw new Error(`Structured model ${name} returned no value.`);
              }
              return {
                value: generated.value as Model["Output"],
                finishReason: generated.finishReason,
                usage: generated.usage,
              };
            },
          } satisfies DependencyImplementation<StructuredModelApi<Model>>;
          return {
            [name]: implementation,
          } as DependencyImplementations<
            Readonly<{ [Name in Model["Name"]]: StructuredModelApi<Model> }>
          >;
        },
      },
    },
  });
}

type GatewayResponse = Readonly<{
  choices?: readonly Readonly<{
    finish_reason?: string;
    message?: Readonly<{ content?: string }>;
  }>[];
  usage?: Readonly<{
    prompt_tokens?: number;
    completion_tokens?: number;
  }>;
}>;

const vercelAiGatewayProvider: ServerDependencyProvider<LanguageModel> = {
  development({ configuration }) {
    const gateway = configuration.gateway ?? "https://ai-gateway.vercel.sh/v1";
    const apiKey = configuration.apiKey;
    const defaultModel = configuration.model ?? "poolside/laguna-s-2.1";
    if (!apiKey) throw new Error("The Vercel AI Gateway provider requires AI_GATEWAY_API_KEY.");
    return {
      async generate({ input }) {
        const response = await fetch(`${gateway}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: input.model ?? defaultModel,
            messages: input.messages,
            ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
            ...(input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens }),
            ...(input.output === undefined
              ? {}
              : {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: input.output.name,
                      strict: true,
                      ...(input.output.description === undefined
                        ? {}
                        : { description: input.output.description }),
                      schema: jsonSchema(input.output.schema),
                    },
                  },
                }),
          }),
        });
        if (!response.ok) {
          throw new Error(
            `Vercel AI Gateway returned ${response.status}: ${await response.text()}`,
          );
        }
        const value = (await response.json()) as GatewayResponse;
        const text = value.choices?.[0]?.message?.content ?? "";
        return {
          text,
          ...(input.output === undefined
            ? {}
            : { value: parseStructuredModelValue(text, input.output.schema) }),
          finishReason: value.choices?.[0]?.finish_reason ?? "unknown",
          usage: {
            inputTokens: value.usage?.prompt_tokens ?? 0,
            outputTokens: value.usage?.completion_tokens ?? 0,
          },
        };
      },
    } satisfies DependencyImplementation<LanguageModel>;
  },
  production: {
    configuration: [
      {
        name: "gateway",
        environment: "AI_GATEWAY_URL",
        default: "https://ai-gateway.vercel.sh/v1",
      },
      {
        name: "apiKey",
        environment: "AI_GATEWAY_API_KEY",
        required: true,
      },
      {
        name: "model",
        environment: "AI_GATEWAY_MODEL",
        default: "poolside/laguna-s-2.1",
      },
    ],
    crate: {
      package: "kit-server-model",
      directory: "./providers/server/rust",
    },
    rust: {
      type: "kit_server_model::Model",
      constructor: "kit_server_model::create",
    },
  },
};

/** Ready-to-mount Vercel AI Gateway realization for the semantic `model` Dependency. */
export const vercelAiGateway: Feature<LanguageModelFeatureContract> =
  createFeature<LanguageModelFeatureContract>({
    providers: {
      server: {
        model: vercelAiGatewayProvider,
      },
    },
  });

type PortableTypeData =
  | Readonly<{ kind: "primitive"; name: string }>
  | Readonly<{ kind: "literal"; value: string | number | boolean | null }>
  | Readonly<{ kind: "array"; element: PortableTypeData }>
  | Readonly<{ kind: "tuple"; elements: readonly PortableTypeData[] }>
  | Readonly<{
      kind: "record";
      fields: readonly Readonly<{
        name: string;
        optional: boolean;
        type: PortableTypeData;
      }>[];
    }>
  | Readonly<{ kind: "union"; variants: readonly PortableTypeData[] }>;

function jsonSchema(schema: TypeSchema): Readonly<Record<string, unknown>> {
  const type = schema as PortableTypeData;
  if (type.kind === "primitive") {
    if (type.name === "string") return { type: "string" };
    if (type.name === "number") return { type: "number" };
    if (type.name === "boolean") return { type: "boolean" };
    if (type.name === "null") return { type: "null" };
    throw new Error(`Structured model output cannot contain primitive ${type.name}.`);
  }
  if (type.kind === "literal") return { const: type.value };
  if (type.kind === "array") return { type: "array", items: jsonSchema(type.element) };
  if (type.kind === "tuple") {
    return {
      type: "array",
      prefixItems: type.elements.map(jsonSchema),
      minItems: type.elements.length,
      maxItems: type.elements.length,
    };
  }
  if (type.kind === "union") {
    const literals = type.variants.every((variant) => variant.kind === "literal")
      ? type.variants.map((variant) => variant.value)
      : undefined;
    return literals === undefined ? { anyOf: type.variants.map(jsonSchema) } : { enum: literals };
  }
  const properties = Object.fromEntries(
    type.fields.map((field) => [field.name, jsonSchema(field.type)]),
  );
  const required = type.fields.filter(({ optional }) => !optional).map(({ name }) => name);
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function parseStructuredModelValue(text: string, schema: TypeSchema): object {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Structured model output is not valid JSON.");
  }
  const mismatch = typeMismatch(value, schema as PortableTypeData);
  if (mismatch !== undefined) {
    throw new Error(`Structured model output does not satisfy its declared type: ${mismatch}.`);
  }
  return value as object;
}

function typeMismatch(value: unknown, type: PortableTypeData, path = "$"): string | undefined {
  if (type.kind === "primitive") {
    if (type.name === "string" && typeof value !== "string") return `${path} must be a string`;
    if (type.name === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      return `${path} must be a finite number`;
    }
    if (type.name === "boolean" && typeof value !== "boolean") {
      return `${path} must be a boolean`;
    }
    if (type.name === "null" && value !== null) return `${path} must be null`;
    return undefined;
  }
  if (type.kind === "literal") {
    return value === type.value ? undefined : `${path} must equal ${JSON.stringify(type.value)}`;
  }
  if (type.kind === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    for (const [index, entry] of value.entries()) {
      const mismatch = typeMismatch(entry, type.element, `${path}[${index}]`);
      if (mismatch !== undefined) return mismatch;
    }
    return undefined;
  }
  if (type.kind === "tuple") {
    if (!Array.isArray(value)) return `${path} must be a tuple`;
    if (value.length !== type.elements.length) {
      return `${path} must contain ${type.elements.length} items`;
    }
    for (const [index, entry] of value.entries()) {
      const mismatch = typeMismatch(entry, type.elements[index]!, `${path}[${index}]`);
      if (mismatch !== undefined) return mismatch;
    }
    return undefined;
  }
  if (type.kind === "union") {
    for (const variant of type.variants) {
      if (typeMismatch(value, variant, path) === undefined) return undefined;
    }
    return `${path} does not satisfy any declared variant`;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `${path} must be an object`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const fields = new Map(type.fields.map((field) => [field.name, field]));
  for (const name of Object.keys(record)) {
    if (!fields.has(name)) return `${path}.${name} is not declared`;
  }
  for (const field of type.fields) {
    if (!(field.name in record)) {
      if (!field.optional) return `${path}.${field.name} is required`;
      continue;
    }
    const mismatch = typeMismatch(record[field.name], field.type, `${path}.${field.name}`);
    if (mismatch !== undefined) return mismatch;
  }
  return undefined;
}
