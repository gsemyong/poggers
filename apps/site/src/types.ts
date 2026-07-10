export type Section = { heading: string; body: string };

export type Page = {
  slug: string;
  title: string;
  summary: string;
  sections: Section[];
};

export type SiteState = { pages: Page[] };
export type SiteViews = {
  page: Page;
  nav: Array<{ slug: string; title: string }>;
};
export type SiteCommands = { recordVisit: { args: []; error: never } };

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
  Components: {
    SiteShell: {
      Input: {
        activeSlug: string;
        navItems: Array<{ slug: string; title: string }>;
      };
      Derived: {
        activeSlug: string;
        navItems: Array<{ slug: string; title: string }>;
      };
      Parts: {
        Root: "main";
        Sidebar: "aside";
        Brand: "div";
        Nav: "nav";
        Content: "div";
      };
    };
    NavButton: {
      Input: { active: boolean; label: string; navigate(): void };
      Variants: { active: "yes" | "no" };
      Actions: { navigate(): void };
      Parts: { Root: "button"; Label: "span" };
    };
    PageHero: {
      Input: { page: Page };
      Derived: { title: string; summary: string; sections: Section[] };
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
      Parts: { Root: "article"; Title: "h2"; Body: "p" };
    };
  };
  Styles: {
    Presets: {
      docs: {
        Tokens: {
          color:
            | "canvas"
            | "panel"
            | "panelMuted"
            | "text"
            | "muted"
            | "line"
            | "accent"
            | "accentSoft"
            | "focus";
          space: "xs" | "sm" | "md" | "lg" | "xl";
          size: "sidebar" | "content" | "measure";
          radius: "control" | "panel";
          shadow: "panel";
          font: "body" | "display" | "mono";
          motion: "quick" | "settle";
        };
        Themes: "default";
        Containers: "compact";
      };
    };
  };
};
