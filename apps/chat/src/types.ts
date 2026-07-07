export type AIPart =
  | { type: "text"; content: string }
  | { type: "heading"; content: string; level: 1 | 2 | 3 }
  | { type: "questions"; items: string[] }
  | { type: "summary"; title: string; points: string[] }
  | { type: "clarification"; understanding: string }
  | { type: "separator" };

export type AIResponse = { parts: AIPart[] };

export type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: AIPart[] | null;
  timestamp: number;
};

export type AIMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatProgramDeps = {
  ai: {
    complete(
      messages: AIMessage[],
      onChunk: (text: string) => Promise<void> | void,
    ): Promise<{ text: string; parsed: AIResponse | null }>;
  };
  clock: {
    now(): number;
  };
  ids: {
    create(seed: string): string;
  };
};

export type ChatState = {
  messages: DisplayMessage[];
  status: "idle" | "generating" | "error";
  understanding: string | null;
  error: string | null;
};

export type ChatEvents = {
  messageSent: { messageId: string; timestamp: number; text: string };
  generationCompleted: {
    text: string;
    messageId: string;
    timestamp: number;
    parsed: AIResponse | null;
  };
  generationError: { message: string };
};

export type ChatViews = {
  messages: DisplayMessage[];
  status: ChatState["status"];
  understanding: ChatState["understanding"];
  error: ChatState["error"];
  streamingText: string | null;
};

export type ChatCommands = {
  sendMessage: {
    args: [text: string];
    event: "messageSent";
    error: "empty";
  };
  completeGeneration: {
    args: [
      data: {
        text: string;
        messageId: string;
        timestamp: number;
        parsed: AIResponse | null;
      },
    ];
    event: "generationCompleted";
    error: "duplicate";
  };
  failGeneration: {
    args: [message: string];
    event: "generationError";
    error: never;
  };
  startStreaming: {
    args: [];
    error: never;
  };
  streamChunk: {
    args: [text: string];
    error: never;
  };
};

export type App = {
  Resources: {
    /** Local-first chat state, commands, streaming presence, and assistant messages. */
    chat: {
      Key: { sessionId: string };
      State: ChatState;
      Presence: { typing: boolean; streamingText: string | null };
      Events: ChatEvents;
      Views: ChatViews;
      Commands: ChatCommands;
    };
  };

  Environments: {
    server: {
      Deps: ChatProgramDeps;
    };
  };

  Components: {
    /** Full chat screen structure. Style-only parts are generated automatically. */
    ChatLayout: {
      Parts: {
        Root: "div";
        Topbar: "header";
        Brand: "div";
        BrandMark: "strong";
        BrandText: "span";
        PresetSwitch: "button";
        Messages: "main";
        Empty: "div";
        Status: "div";
        StatusText: "span";
        StatusMeta: "span";
        Understanding: "div";
        Composer: "div";
      };
    };
    /** Message container for user, assistant, and streaming messages. */
    ChatMessage: {
      Input: {
        role: "user" | "assistant";
        streaming: boolean;
      };
      Parts: {
        Root: "div";
        Role: "div";
        Content: "div";
      };
    };
    /** Structured assistant response part renderer. */
    AIPart: {
      Input: {
        kind: "heading" | "text" | "questions" | "summary" | "separator";
      };
      Parts: {
        Root: "div";
        Item: "div";
      };
    };
    /** Composer form with local text state, submit action, and derived button state. */
    Composer: {
      State: {
        value: string;
      };
      Derived: {
        canSubmit: boolean;
        busy: boolean;
      };
      Actions: {
        clear(): void;
        change(value: string): void;
        submit(): void;
      };
      Parts: {
        Root: "form";
        Input: "textarea";
        Send: "button";
      };
    };
  };

  Styles: {
    Presets: "paper" | "terminal";
    Theme: {
      Params: {
        density: { min: 0; max: 1; default: 0.5 };
      };
    };
  };
};
