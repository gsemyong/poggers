import type { AppDefinition } from "@poggers/app";
import { fallbackPage, pages } from "src/pages";
import { docsPreset } from "src/presets";
import type { App } from "types";
import { Root } from "ui/app-root";

export default {
  version: 1,
  app: { name: "Poggers Kit" },
  pwa: {
    name: "Poggers Kit",
    shortName: "Poggers",
    description: "Documentation and examples for Poggers Kit.",
    themeColor: "oklch(25.88% 0.0127 258.37)",
    backgroundColor: "oklch(97.4% 0.006 255)",
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
      commands: { recordVisit() {} },
    },
  },
  components: {
    SiteShell: {
      derived({ input }) {
        return {
          get activeSlug() {
            return input.activeSlug;
          },
          get navItems() {
            return input.navItems;
          },
        };
      },
    },
    NavButton: {
      actions({ input }) {
        return { navigate: input.navigate };
      },
      bind({ input, actions }) {
        return {
          Root: {
            type: "button",
            "aria-current": input.active ? "page" : undefined,
            onClick: actions.navigate,
          },
          Label: { children: input.label },
        };
      },
    },
    PageHero: {
      derived({ input }) {
        return {
          get title() {
            return input.page.title;
          },
          get summary() {
            return input.page.summary;
          },
          get sections() {
            return input.page.sections;
          },
        };
      },
      bind({ derived }) {
        return {
          Title: { children: derived.title },
          Summary: { children: derived.summary },
        };
      },
    },
    SectionCard({ input }) {
      return {
        Title: { children: input.heading },
        Body: { children: input.body },
      };
    },
  },
  styles: { defaultPreset: "docs", presets: { docs: docsPreset } },
  root: Root,
} satisfies AppDefinition<App>;
