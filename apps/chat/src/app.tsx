import type { AppDef as AppDefinition } from "@poggers/kit";
import { chatFeature, type ChatFeature } from "src/features/chat";
import { monoPreset } from "src/presets/mono";
import { paperPreset } from "src/presets/paper";
import { terminalPreset } from "src/presets/terminal";

export type App = {
  Actor: { readonly id: string };
  Resources: {};
  Features: { chat: ChatFeature };
  Components: {
    Shell: {
      Parts: { Root: "div" };
    };
  };
  Styles: {
    Presets: "paper" | "mono" | "terminal";
  };
};

export default {
  version: 1,
  app: { name: "Poggers Chat" },
  pwa: {
    name: "Poggers Chat",
    shortName: "Chat",
    description: "A local-first assistant for clarifying personal tasks.",
    themeColor: "oklch(26.35% 0.0103 260.7)",
    backgroundColor: "oklch(96.48% 0.0127 86.83)",
    display: "standalone",
  },
  features: { chat: chatFeature },
  components: {
    Shell: {
      view({
        features: {
          chat: { ChatLayout },
        },
        parts: { Root },
      }) {
        return (
          <Root>
            <ChatLayout />
          </Root>
        );
      },
    },
  },
  styles: {
    defaultPreset: "paper",
    presets: { paper: paperPreset, mono: monoPreset, terminal: terminalPreset },
  },
  root: "Shell",
} satisfies AppDefinition<App>;
