import type { Page } from "types";

export const pages: Page[] = [
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

export const fallbackPage = pages[0]!;
