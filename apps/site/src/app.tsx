import { defineApp } from "@poggers/kit";
import type { AppDefinition } from "@poggers/app";
import { Root } from "./components/app-root";
import { fallbackPage, pages } from "./pages";

const app: AppDefinition = {
  version: 1,

  app: {
    name: "Poggers Kit",
  },

  pwa: {
    name: "Poggers Kit",
    shortName: "Poggers",
    description: "Documentation and examples for Poggers Kit.",
    themeColor: "#20242a",
    backgroundColor: "#f7f3ea",
    display: "standalone",
  },

  navigation: {
    home: "/",
    page: "/:slug",
  },

  resources: {
    page: {
      state: { pages },
      events: {},
      views: {
        page({ state, key }) {
          return state.pages.find((page) => page.slug === key.slug) ?? fallbackPage;
        },
        nav({ state }) {
          return state.pages.map(({ slug, title }) => ({ slug, title }));
        },
      },
      commands: {
        recordVisit() {},
      },
    },
  },

  components: {
    NavButton({ input, actions }) {
      return {
        Root: {
          type: "button",
          onClick: actions.navigate,
        },
        Label: {
          children: input.label,
        },
      };
    },
    PageHero({ derived }) {
      return {
        Title: {
          children: derived.title,
        },
        Summary: {
          children: derived.summary,
        },
      };
    },
    SectionCard({ input }) {
      return {
        Title: {
          children: input.heading,
        },
        Body: {
          children: input.body,
        },
      };
    },
  },

  ui() {
    return <Root />;
  },
};

export default defineApp(app);
