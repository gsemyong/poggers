export type CommandId = "compose" | "search" | "review" | "share" | "settings";
export type PresetName = "precision" | "tactile" | "editorial";

export type Command = {
  id: CommandId;
  label: string;
  detail: string;
  shortcut: string;
};

export type App = {
  Resources: {};
  Components: {
    CommandMenu: {
      State: {
        open: boolean;
        phase: "idle" | "opening" | "open" | "closing" | "dragging" | "settling";
        query: string;
        selected: CommandId | undefined;
        mode: "ready" | "loading" | "error";
        dragOffset: number;
      };
      Derived: {
        commands: Command[];
        resultText: string;
        statusTitle: string;
        statusDetail: string;
      };
      Actions: {
        toggleOpen(): void;
        close(): void;
        selectPrecision(): void;
        selectTactile(): void;
        selectEditorial(): void;
        toggleTheme(): void;
        syncOpen(open: boolean): void;
        setQuery(query: string): void;
        select(id: CommandId): void;
        move(delta: number): void;
        choose(id: CommandId): void;
        retry(): void;
      };
      StyleValues: {
        dragOffset: "length";
        openness: "progress";
      };
      Shared: "active-result";
      Parts: {
        Root: "main";
        Stage: "section";
        Heading: "div";
        Kicker: "p";
        Title: "h1";
        Summary: "p";
        PresetNav: "nav";
        PrecisionPreset: "button";
        TactilePreset: "button";
        EditorialPreset: "button";
        ThemeToggle: "button";
        Trigger: "button";
        TriggerIcon: "span";
        TriggerLabel: "span";
        TriggerKey: "span";
        Panel: "dialog";
        Backdrop: "div";
        Surface: "div";
        Handle: "div";
        Search: "label";
        SearchIcon: "span";
        SearchInput: "input";
        Results: "div";
        Status: "div";
        StatusTitle: "strong";
        StatusDetail: "span";
        Retry: "button";
        Result: "button";
        Selection: "span";
        ResultCopy: "span";
        ResultLabel: "span";
        ResultDetail: "span";
        ResultKey: "span";
        Footer: "footer";
        ResultCount: "span";
        Close: "button";
      };
    };
  };
  Styles: {
    Presets: {
      precision: {
        Tokens: {
          color:
            | "canvas"
            | "panel"
            | "panelRaised"
            | "text"
            | "muted"
            | "line"
            | "active"
            | "activeText"
            | "focus"
            | "backdrop";
          space: "xs" | "sm" | "md" | "lg" | "xl" | "stage";
          size: "panel" | "result";
          radius: "control" | "panel";
          shadow: "panel";
          font: "body";
          motion: "fast" | "settle";
          z: "popover";
        };
        Themes: "default" | "dark";
        Containers: "compact" | "roomy";
      };
      tactile: {
        Tokens: {
          color:
            | "canvas"
            | "panel"
            | "panelRaised"
            | "well"
            | "text"
            | "muted"
            | "line"
            | "accent"
            | "accentInk"
            | "focus"
            | "backdrop"
            | "handle";
          space: "xs" | "sm" | "md" | "lg" | "xl" | "stage";
          size: "panel" | "result";
          radius: "control" | "panel" | "key";
          shadow: "panel" | "control" | "pressed";
          font: "body" | "mono";
          gradient: "canvas" | "panel" | "selection";
          motion: "snap" | "settle" | "press";
          z: "popover";
        };
        Containers: "compact" | "roomy";
      };
      editorial: {
        Tokens: {
          color:
            | "canvas"
            | "paper"
            | "text"
            | "muted"
            | "line"
            | "accent"
            | "accentSoft"
            | "focus"
            | "backdrop";
          space: "xs" | "sm" | "md" | "lg" | "xl" | "stage";
          size: "panel" | "result";
          radius: "control" | "panel";
          shadow: "panel";
          font: "body" | "display";
          motion: "quick" | "layout";
          z: "popover";
        };
        Containers: "compact" | "roomy";
      };
    };
  };
};
