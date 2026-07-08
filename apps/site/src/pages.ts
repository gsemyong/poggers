import type { Page } from "./types";

export const pages: Page[] = [
  {
    slug: "home",
    title: "Poggers Kit",
    summary: "A small event-sourced full-stack kit for building applications with Bun.",
    sections: [
      {
        heading: "Three files",
        body: "Define the app spec once, build the UI with semantic hooks, and keep background logic in environment programs only when you need it.",
      },
      {
        heading: "Single process",
        body: "The runtime owns the server, browser bundle, sync layer, program lifecycle, snapshots, and binary build.",
      },
      {
        heading: "Local-first store",
        body: "Durable state is latest snapshot plus the event tail after that snapshot.",
      },
    ],
  },
  {
    slug: "getting-started",
    title: "Getting Started",
    summary: "Create an app without installing a global CLI.",
    sections: [
      {
        heading: "Create",
        body: "Run bun create poggers@latest my-app.",
      },
      {
        heading: "Develop",
        body: "Run bun dev inside the app. The local poggers binary comes from @poggers/kit.",
      },
      {
        heading: "Ship",
        body: "Run bun run build to produce a single executable.",
      },
    ],
  },
  {
    slug: "api",
    title: "API Surface",
    summary: "Apps are defined by one generic app spec, semantic hooks, and optional programs.",
    sections: [
      {
        heading: "defineApp",
        body: "The generic type parameter describes resources, keys, events, views, commands, navigation, and dependencies.",
      },
      {
        heading: "Semantic hooks",
        body: "UI code receives hooks derived from resource names, such as useChat or usePage.",
      },
      {
        heading: "Programs",
        body: "Environment programs are persistent async scripts with typed deps and durable event streams.",
      },
    ],
  },
  {
    slug: "store",
    title: "Store And Migrations",
    summary: "Snapshots and event tails form the canonical durable state.",
    sections: [
      {
        heading: "Snapshots",
        body: "A snapshot covers a stream through a specific sequence number.",
      },
      {
        heading: "Event tail",
        body: "Only events after the snapshot sequence need to remain for rebuild.",
      },
      {
        heading: "Migrations",
        body: "Old snapshots are migrated and old events are upcast before replay.",
      },
    ],
  },
];

export const fallbackPage = pages[0]!;
