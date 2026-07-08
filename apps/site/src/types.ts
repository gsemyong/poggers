export type Section = {
  heading: string;
  body: string;
};

export type Page = {
  slug: string;
  title: string;
  summary: string;
  sections: Section[];
};

export type SiteState = {
  pages: Page[];
};

export type SiteViews = {
  page: Page;
  nav: Array<{ slug: string; title: string }>;
};

export type SiteCommands = {
  recordVisit: {
    args: [];
    error: never;
  };
};

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
      Input: {
        active: boolean;
        label: string;
      };
      Actions: {
        navigate(): void;
      };
      Parts: {
        Root: "button";
        Label: "span";
      };
    };
    PageHero: {
      Derived: {
        title: string;
        summary: string;
        sections: Section[];
      };
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
      Parts: {
        Root: "article";
        Title: "h2";
        Body: "p";
      };
    };
  };

  Styles: {
    Presets: "system" | "dense";
    Theme: {
      Params: {
        density: { min: 0; max: 1; default: 0.5 };
      };
    };
  };
};
