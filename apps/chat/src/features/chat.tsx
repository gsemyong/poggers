import type { Feature, Program, Server, WebMain } from "@poggers/kit";
import { For, createPress } from "@poggers/kit/ui";

export type Message = Readonly<{
  id: number;
  role: "user" | "assistant";
  text: string;
}>;

type Chat = Readonly<{
  subscribe(receive: (messages: readonly Message[]) => void): Disposable;
  send(input: { text: string }): Promise<void>;
}>;

export type ChatFeature = {
  Programs: {
    browser: Program<
      WebMain,
      {
        Provides: { chat: Chat };
        State: {
          messages: readonly Message[];
          sending: boolean;
        };
        Actions: {
          send(input: { text: string }): Promise<void>;
          receive(input: { messages: readonly Message[] }): void;
        };
        Components: {
          Chat: {
            Input: { openAbout(): void };
            State: {
              draft: string;
            };
            Actions: {
              change(value: string): void;
              send(): Promise<void>;
            };
            Parts: {
              Root: "main";
              Header: "header";
              Brand: "h1";
              Summary: "p";
              Messages: "section";
              Empty: "p";
              Composer: "div";
              Input: "textarea";
              Send: "button";
              About: "button";
              Status: "span";
            };
          };
          Message: {
            Input: Message;
            State: Message;
            Parts: { Root: "article"; Role: "span"; Text: "p" };
          };
        };
      }
    >;
    audit: Program<Server, { Requires: { chat: Chat } }>;
  };
};

let values: readonly Message[] = [
  {
    id: 1,
    role: "assistant",
    text: "What would you like to make clearer today?",
  },
];
let nextId = 2;
const listeners = new Set<(messages: readonly Message[]) => void>();

const chat: Chat = {
  subscribe(receive) {
    listeners.add(receive);
    receive(values);
    return {
      [Symbol.dispose]() {
        listeners.delete(receive);
      },
    };
  },
  async send({ text }) {
    const value = text.trim();
    if (!value) return;
    values = [...values, { id: nextId++, role: "user", text: value }];
    for (const listener of listeners) listener(values);
    await new Promise((resolve) => setTimeout(resolve, 180));
    values = [
      ...values,
      {
        id: nextId++,
        role: "assistant",
        text: `I understand. What outcome would make “${value}” feel complete?`,
      },
    ];
    for (const listener of listeners) listener(values);
  },
};

export const chatFeature = {
  programs: {
    audit: {},
    browser: {
      start({ actions }) {
        const subscription = chat.subscribe((messages) => actions.receive({ messages }));
        return {
          chat: {
            ...chat,
            [Symbol.dispose]() {
              subscription[Symbol.dispose]();
            },
          },
        };
      },
      state: {
        messages: [],
        sending: false,
      },
      actions: {
        async send({ state, capabilities }, input) {
          state.sending = true;
          try {
            await capabilities.chat.send(input);
          } finally {
            state.sending = false;
          }
        },
        receive({ state }, { messages }) {
          state.messages = messages;
        },
      },
      components: {
        Chat: {
          state: { draft: "" },
          actions: {
            change({ state }, value) {
              state.draft = value;
            },
            async send({ state, process }) {
              const text = state.draft.trim();
              if (!text || process.sending) return;
              state.draft = "";
              await process.send({ text });
            },
          },
          view({ input, process, state, actions, components: { Message }, parts }) {
            const {
              Root,
              Header,
              Brand,
              Summary,
              Messages,
              Empty,
              Composer,
              Input,
              Send,
              About,
              Status,
            } = parts;
            return (
              <Root>
                <Header>
                  <Brand>Poggers Chat</Brand>
                  <Summary>
                    Behavior, composition, and appearance stay independently legible.
                  </Summary>
                </Header>
                <Messages aria-live="polite">
                  <For each={process.messages} by="id" fallback={<Empty>No messages yet.</Empty>}>
                    {(message) => <Message {...message} />}
                  </For>
                </Messages>
                <Composer>
                  <Input
                    value={state.draft}
                    disabled={process.sending}
                    rows={2}
                    aria-label="Message"
                    placeholder="Write a message"
                    onInput={(event) => actions.change(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
                      event.preventDefault();
                      actions.send();
                    }}
                  />
                  <Send
                    type="button"
                    disabled={process.sending || state.draft.trim().length === 0}
                    {...createPress(actions.send)}
                  >
                    Send
                  </Send>
                  <About type="button" {...createPress(input.openAbout)}>
                    About this example
                  </About>
                  <Status aria-live="polite">{process.sending ? "Thinking" : "Ready"}</Status>
                </Composer>
              </Root>
            );
          },
        },
        Message: {
          state({ input }) {
            return input;
          },
          view({ state, parts: { Root, Role, Text } }) {
            return (
              <Root data-role={state.role}>
                <Role>{state.role === "user" ? "You" : "Assistant"}</Role>
                <Text>{state.text}</Text>
              </Root>
            );
          },
        },
      },
    },
  },
} satisfies Feature<ChatFeature>;
