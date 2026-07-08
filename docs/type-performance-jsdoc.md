# Type Performance And JSDoc

## Goal

Generated app imports must feel instant in editors. A generated export such as `createChatMessage` should have a compact hover, a stable named return type, and useful documentation.

## Rules

- Public generated exports must use explicit named types.
- Avoid `Parameters<AppHooks<App>[...]>` and `ReturnType<AppHooks<App>[...]>` in public generated signatures.
- Keep heavy mapped and conditional types inside named aliases such as `ChatMessageOptions` and `ChatMessageInstance`.
- Keep `AppHooks<App>` as an internal runtime type only.
- Prefer exported interfaces or named aliases for any complex public shape.
- Put JSDoc in `types.ts`, directly above the resource or component declaration.
- Transfer that JSDoc to the generated `useX` or `createX` export.
- Keep fallback generated docs short when the app spec does not provide JSDoc.

## JSDoc Source

The app spec is the source of truth:

```ts
export type App = {
  Resources: {
    /** Local-first chat state, commands, streaming presence, and assistant messages. */
    chat: {
      // ...
    };
  };

  Components: {
    /** Message container for user, assistant, and streaming messages. */
    ChatMessage: {
      // ...
    };
  };
};
```

The generated module transfers those comments:

```ts
/** Local-first chat state, commands, streaming presence, and assistant messages. */
export function useChat(key: ChatResourceKey): ChatResource;

/** Message container for user, assistant, and streaming messages. */
export function createChatMessage(input: ChatMessageOptions): ChatMessageInstance;
```

## Generated Shape

Use this shape:

```ts
export type ChatMessageOptions = ComponentInstanceInput<AppSpec, "ChatMessage">;
export type ChatMessageInstance = ComponentInstanceResult<AppSpec, "ChatMessage">;

export function createChatMessage(input: ChatMessageOptions): ChatMessageInstance {
  return getHooks().createChatMessage(input);
}
```

Do not use this shape:

```ts
export function createChatMessage(
  ...args: Parameters<AppHooks<AppSpec>["createChatMessage"]>
): ReturnType<AppHooks<AppSpec>["createChatMessage"]>;
```

## Verification

- `runtime.spec.ts` asserts generated exports use named aliases.
- `runtime.spec.ts` asserts JSDoc is copied from `types.ts`.
- `typecheck` covers the generated aliases in app code.
