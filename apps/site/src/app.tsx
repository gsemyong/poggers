import type { AppDef as AppDefinition, AppScreen } from "@poggers/kit";
import { For, createPress } from "@poggers/kit/ui";
import { docsPreset } from "src/presets/docs";

export type Section = { heading: string; body: string };

export type NavItem = { slug: string; title: string };

export type Page = {
  slug: string;
  title: string;
  summary: string;
  sections: Section[];
};

export type SiteState = { pages: Page[] };
export type SiteViews = {
  page: Page;
  nav: NavItem[];
};
export type SiteCommands = { recordVisit: { Input: {}; Error: never } };

export type App = {
  Resources: {
    page: {
      Key: { slug: string };
      State: SiteState;
      Events: {};
      Views: SiteViews;
      Commands: SiteCommands;
    };
  };
  Navigation: {
    home: {};
    page: { slug: string };
  };
  API: {
    page(slug: string): SiteViews;
  };
  Components: {
    SiteShell: {
      State: SiteViews & { slug: string };
      Parts: {
        Root: "main";
        Sidebar: "aside";
        Brand: "div";
        Nav: "nav";
        Content: "div";
      };
    };
    NavButton: {
      Input: { active: boolean; label: string; slug: string };
      State: { active: boolean; label: string; slug: string };
      Phases: "active" | "navigating";
      Tasks: { navigate: { Input: string; Output: void; Error: never } };
      Actions: { navigate(): void };
      Parts: { Root: "button"; Label: "span" };
    };
    PageHero: {
      Input: { page: Page };
      State: { title: string; summary: string; sections: Section[] };
      Parts: {
        Root: "section";
        Mark: "div";
        Eyebrow: "p";
        Title: "h1";
        Summary: "p";
        Sections: "div";
      };
    };
    SectionCard: {
      Input: Section;
      State: Section;
      Parts: { Root: "article"; Title: "h2"; Body: "p" };
    };
  };
  Styles: {
    Presets: "docs";
  };
};

const pages: Page[] = [
  {
    slug: "home",
    title: "Poggers Kit",
    summary:
      "A small event-sourced full-stack kit for building typed local-first applications with Bun.",
    sections: [
      {
        heading: "One application contract",
        body: "Resources, dependencies, components, navigation, and visual presets derive from the same generic app type.",
      },
      {
        heading: "One runtime",
        body: "The kit owns the server, browser bundle, sync layer, programs, snapshots, migrations, and executable build.",
      },
      {
        heading: "One visual language",
        body: "Presets author typed tokens and low-level visual intent while StyleX, Anime.js, and PreText stay internal.",
      },
    ],
  },
  {
    slug: "getting-started",
    title: "Getting Started",
    summary: "Create, develop, typecheck, and ship an app without installing a global CLI.",
    sections: [
      { heading: "Create", body: "Run bun create poggers@latest my-app." },
      {
        heading: "Develop",
        body: "Run bun dev. Generated declarations and visual output stay disposable under .poggers.",
      },
      {
        heading: "Ship",
        body: "Run bun run build to produce a single executable with statically extracted visual CSS.",
      },
    ],
  },
  {
    slug: "api",
    title: "Application API",
    summary:
      "Applications own semantics, state, actions, accessibility, dependencies, and their stable component part tree.",
    sections: [
      {
        heading: "Resources",
        body: "Typed state, events, views, and commands form the local-first data model.",
      },
      {
        heading: "Components",
        body: "Finite state and actions stay in the app while generated parts keep JSX semantic and predictable.",
      },
      {
        heading: "Programs",
        body: "Persistent async programs consume durable events with environment-specific dependencies.",
      },
    ],
  },
  {
    slug: "visual-system",
    title: "Visual System",
    summary:
      "A closed TypeScript-first language compiles structured visual intent into atomic StyleX output and scoped motion transactions.",
    sections: [
      {
        heading: "Typed presets",
        body: "Each preset owns its token vocabulary, themes, container rules, component visuals, and motion character.",
      },
      {
        heading: "Modern defaults",
        body: "Logical directions, OKLCH color, container queries, native state, and reduced motion are built in.",
      },
      {
        heading: "Scoped motion",
        body: "CSS, WAAPI, Anime springs, layout transactions, and text geometry are selected behind one declarative contract.",
      },
    ],
  },
  {
    slug: "store",
    title: "Store And Migrations",
    summary:
      "Snapshots and event tails form the canonical durable state, with explicit type-safe migration paths between schema hashes.",
    sections: [
      {
        heading: "Snapshots",
        body: "A snapshot covers a stream through a specific sequence number.",
      },
      {
        heading: "Event tail",
        body: "Only events after the snapshot sequence remain necessary for replay.",
      },
      {
        heading: "Migrations",
        body: "Old snapshots migrate and old events upcast before normal application processing resumes.",
      },
    ],
  },
];

const fallbackPage = pages[0]!;

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
  api: ({ resources }) => ({ page: (slug) => resources.page({ slug }) }),
  components: {
    SiteShell: {
      state({ api, screen }) {
        const slug = screenSlug(screen);
        const page = api.page(slug);
        return { slug, page: page.page, nav: page.nav };
      },
      view({
        components: { NavButton, PageHero },
        state,
        parts: { Root, Sidebar, Brand, Nav, Content },
      }) {
        return (
          <Root>
            <Sidebar>
              <Brand>Poggers Kit</Brand>
              <Nav>
                <For each={state.nav} by="slug">
                  {(item) => {
                    return (
                      <NavButton
                        active={item.slug === state.slug}
                        label={item.title}
                        slug={item.slug}
                      />
                    );
                  }}
                </For>
              </Nav>
            </Sidebar>
            <Content>
              <PageHero page={state.page} />
            </Content>
          </Root>
        );
      },
    },
    NavButton: {
      state({ input }) {
        return { active: input.active, label: input.label, slug: input.slug };
      },
      machine: {
        initial: "active",
        phases: {
          active: {
            on: {
              navigate: "navigating",
            },
          },
          navigating: {
            task: { run: "navigate", input: ({ input }) => input.slug, done: "active" },
          },
        },
        tasks: {
          navigate({ navigation, value }) {
            if (value === "home") navigation.home();
            else navigation.page({ slug: value });
          },
        },
      },
      view({ state, actions, parts: { Root, Label } }) {
        return (
          <Root
            type="button"
            aria-current={state.active ? "page" : undefined}
            {...createPress(actions.navigate)}
          >
            <Label>{state.label}</Label>
          </Root>
        );
      },
    },
    PageHero: {
      state({ input }) {
        return {
          title: input.page.title,
          summary: input.page.summary,
          sections: input.page.sections,
        };
      },
      view({
        state,
        components: { SectionCard },
        parts: { Root, Mark, Eyebrow, Title, Summary, Sections },
      }) {
        return (
          <Root>
            <Mark aria-hidden>PK</Mark>
            <Eyebrow>Built with Poggers Kit</Eyebrow>
            <Title>{state.title}</Title>
            <Summary>{state.summary}</Summary>
            <Sections>
              <For each={state.sections} by="heading">
                {(section) => <SectionCard {...section} />}
              </For>
            </Sections>
          </Root>
        );
      },
    },
    SectionCard: {
      state: ({ input }) => ({ heading: input.heading, body: input.body }),
      view({ state, parts: { Root, Title, Body } }) {
        return (
          <Root>
            <Title>{state.heading}</Title>
            <Body>{state.body}</Body>
          </Root>
        );
      },
    },
  },
  styles: { defaultPreset: "docs", presets: { docs: docsPreset } },
  root: "SiteShell",
} satisfies AppDefinition<App>;

function screenSlug(screen: AppScreen<App>) {
  return screen.name === "page" ? screen.params.slug : "home";
}
