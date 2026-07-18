import type { Application, Feature, Program, WebMain } from "@poggers/kit";
import { Show, createPress } from "@poggers/kit/ui";
import { chatFeature, type ChatFeature } from "src/features/chat";
import { paperPresentation, paperTheme } from "src/presentations/paper";

type Route = "chat" | "about";

type Navigation = Readonly<{
  subscribe(receive: (route: Route) => void): Disposable;
  navigate(input: { route: Route }): void;
}>;

export type App = {
  Features: { shell: ShellFeature };
  Presentations: "paper";
};

type ShellFeature = {
  Features: { chat: ChatFeature };
  Programs: {
    browser: Program<
      WebMain,
      {
        Provides: { navigation: Navigation };
        State: { route: Route };
        Actions: {
          navigate(input: { route: Route }): void;
          updateRoute(input: { route: Route }): void;
        };
        Components: {
          Shell: {
            Parts: {
              Root: "div";
              Navigation: "nav";
              ChatLink: "button";
              AboutLink: "button";
              Content: "div";
              About: "main";
              AboutTitle: "h1";
              AboutText: "p";
            };
          };
        };
      }
    >;
  };
};

const navigationListeners = new Set<(route: Route) => void>();

function readRoute(): Route {
  return globalThis.location?.hash === "#about" ? "about" : "chat";
}

const navigation: Navigation = {
  subscribe(receive) {
    const receiveHistory = () => receive(readRoute());
    navigationListeners.add(receive);
    globalThis.addEventListener?.("popstate", receiveHistory);
    receive(readRoute());
    return {
      [Symbol.dispose]() {
        navigationListeners.delete(receive);
        globalThis.removeEventListener?.("popstate", receiveHistory);
      },
    };
  },
  navigate({ route }) {
    globalThis.history?.pushState(null, "", route === "chat" ? "#chat" : "#about");
    for (const listener of navigationListeners) listener(route);
  },
};

const shellFeature = {
  features: { chat: chatFeature },
  programs: {
    browser: {
      start({ actions }) {
        const subscription = navigation.subscribe((route) => actions.updateRoute({ route }));
        return {
          navigation: {
            ...navigation,
            [Symbol.dispose]() {
              subscription[Symbol.dispose]();
            },
          },
        };
      },
      state: { route: "chat" },
      actions: {
        navigate({ capabilities }, input) {
          capabilities.navigation.navigate(input);
        },
        updateRoute({ state }, { route }) {
          state.route = route;
        },
      },
      components: {
        Shell: {
          view({ process, components: { Chat }, parts }) {
            const { Root, Navigation, ChatLink, AboutLink, Content, About, AboutTitle, AboutText } =
              parts;
            return (
              <Root>
                <Navigation aria-label="Primary navigation">
                  <ChatLink
                    type="button"
                    aria-current={process.route === "chat" ? "page" : undefined}
                    {...createPress(() => process.navigate({ route: "chat" }))}
                  >
                    Chat
                  </ChatLink>
                  <AboutLink
                    type="button"
                    aria-current={process.route === "about" ? "page" : undefined}
                    {...createPress(() => process.navigate({ route: "about" }))}
                  >
                    About
                  </AboutLink>
                </Navigation>
                <Content>
                  <Show
                    when={process.route === "chat"}
                    fallback={
                      <About>
                        <AboutTitle>One application, clean boundaries</AboutTitle>
                        <AboutText>
                          The application owns navigation. The reusable chat feature only exposes a
                          typed navigation intent through its component input.
                        </AboutText>
                        <ChatLink
                          type="button"
                          {...createPress(() => process.navigate({ route: "chat" }))}
                        >
                          Return to chat
                        </ChatLink>
                      </About>
                    }
                  >
                    <Chat.Chat openAbout={() => process.navigate({ route: "about" })} />
                  </Show>
                </Content>
              </Root>
            );
          },
        },
      },
      root: "Shell",
    },
  },
} satisfies Feature<ShellFeature>;

export default {
  metadata: { name: "Poggers Chat" },
  pwa: {
    name: "Poggers Chat",
    shortName: "Chat",
    description: "A focused example of a vertically composed Poggers feature.",
    themeColor: "oklch(22% 0.01 260)",
    backgroundColor: "oklch(97% 0.01 90)",
    display: "standalone",
  },
  features: { shell: shellFeature },
  presentations: { paper: { default: paperPresentation(paperTheme) } },
} satisfies Application<App>;
