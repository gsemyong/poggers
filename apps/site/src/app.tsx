import { defineApp } from "@poggers/kit";
import { Root } from "./components/Root";
import { fallbackPage, pages } from "./helpers/content/pages";
import type { App } from "./types";

export default defineApp<App>({
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

  ui() {
    return <Root />;
  },
});
