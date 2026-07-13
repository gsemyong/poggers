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
      Values: { active: boolean };
      States: "active";
      Events: { navigate(): void };
      Parts: { Root: "button"; Label: "span" };
    };
    PageHero: {
      Input: { page: Page };
      Values: { title: string; summary: string; sections: Section[] };
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
    Presets: "docs";
  };
};
