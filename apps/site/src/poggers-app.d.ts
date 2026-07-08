import type { App as AppSpec } from "./types.ts";

type EmptyObject = Record<never, never>;
type Signal<T> = {
  (): T;
  (value: T): void;
};
type Child = Node | string | number | boolean | null | undefined | Child[] | (() => Child);
type CommandReceipt<E = never> = Promise<
  | { ok: true; cursor?: number }
  | { ok: false; error: E; data?: unknown }
>;
type SyncMeta = {
  cursor: number;
  syncing: boolean;
  stale: boolean;
  error: string | null;
};
type AppPreset = "system" | "dense";
type AppThemeValues = {
  readonly density: number;
};
export type StartConnect = unknown;
type RootProps = { connect?: StartConnect };
type PartValue<T> = T | null | undefined;
type PartEvent<T extends EventTarget, E extends Event> = {
  bivarianceHack(event: E & { readonly currentTarget: T }): void;
}["bivarianceHack"];
type PartStyle = string | Record<string, string | number | null | undefined>;
type PartDataAttributes = {
  [Key in `data-${string}`]?: PartValue<string | number | boolean>;
};
type PartAriaAttributes = {
  [Key in `aria-${string}`]?: PartValue<string | number | boolean>;
};
type PartCommonProps<T extends Element> = PartDataAttributes &
  PartAriaAttributes & {
    id?: PartValue<string>;
    class?: PartValue<string | false>;
    className?: PartValue<string | false>;
    hidden?: PartValue<boolean | "hidden" | "until-found">;
    role?: PartValue<string>;
    style?: PartValue<PartStyle>;
    tabIndex?: PartValue<number>;
    tabindex?: PartValue<number>;
    title?: PartValue<string>;
    children?: Child;
    ref?: (element: T) => void;
    onBlur?: PartEvent<T, FocusEvent>;
    onChange?: PartEvent<T, Event>;
    onClick?: PartEvent<T, MouseEvent>;
    onFocus?: PartEvent<T, FocusEvent>;
    onInput?: PartEvent<T, InputEvent>;
    onKeyDown?: PartEvent<T, KeyboardEvent>;
    onKeyUp?: PartEvent<T, KeyboardEvent>;
    onMouseDown?: PartEvent<T, MouseEvent>;
    onMouseUp?: PartEvent<T, MouseEvent>;
    onPointerDown?: PartEvent<T, PointerEvent>;
    onPointerUp?: PartEvent<T, PointerEvent>;
    onSubmit?: PartEvent<T, SubmitEvent>;
  };
type PartHtmlProps = PartCommonProps<HTMLElement>;
type PartButtonProps = PartCommonProps<HTMLButtonElement> & {
  disabled?: PartValue<boolean>;
  type?: PartValue<"button" | "submit" | "reset">;
  value?: PartValue<string | number>;
};
type PartInputProps = PartCommonProps<HTMLInputElement> & {
  checked?: PartValue<boolean>;
  disabled?: PartValue<boolean>;
  name?: PartValue<string>;
  placeholder?: PartValue<string>;
  type?: PartValue<string>;
  value?: PartValue<string | number | readonly string[]>;
};
type PartTextareaProps = PartCommonProps<HTMLTextAreaElement> & {
  disabled?: PartValue<boolean>;
  name?: PartValue<string>;
  placeholder?: PartValue<string>;
  rows?: PartValue<number>;
  value?: PartValue<string | number>;
};
type PartSelectProps = PartCommonProps<HTMLSelectElement> & {
  disabled?: PartValue<boolean>;
  multiple?: PartValue<boolean>;
  name?: PartValue<string>;
  value?: PartValue<string | number | readonly string[]>;
};
type PartAnchorProps = PartCommonProps<HTMLAnchorElement> & {
  href?: PartValue<string>;
  rel?: PartValue<string>;
  target?: PartValue<string>;
};
type PartFormProps = PartCommonProps<HTMLFormElement> & {
  action?: PartValue<string>;
  method?: PartValue<"dialog" | "get" | "post">;
};
type PartSvgProps = PartCommonProps<SVGElement> & {
  d?: PartValue<string>;
  fill?: PartValue<string>;
  height?: PartValue<string | number>;
  stroke?: PartValue<string>;
  strokeWidth?: PartValue<string | number>;
  viewBox?: PartValue<string>;
  width?: PartValue<string | number>;
};

export type AppScreen =
  | { readonly name: "home"; readonly params: AppSpec["Navigation"]["home"] }
  | { readonly name: "page"; readonly params: AppSpec["Navigation"]["page"] };
export type AppNavigation = {
  home(params?: AppSpec["Navigation"]["home"]): void;
  page(params: AppSpec["Navigation"]["page"]): void;
};

/** Access the page resource. */
type PageResourceSpec = AppSpec["Resources"]["page"];
type PageResourceViews = PageResourceSpec["Views"];
type PageResourceCommands = PageResourceSpec["Commands"];
export type PageResourceKey = PageResourceSpec["Key"];
export type PageResource = {
  readonly page: PageResourceViews["page"];
  readonly nav: PageResourceViews["nav"];
  recordVisit(...args: PageResourceCommands["recordVisit"]["args"]): CommandReceipt<PageResourceCommands["recordVisit"]["error"]>;
  readonly sync: SyncMeta;
};
export function usePage(key: PageResourceKey): PageResource;

/** Create a SiteShell component instance. */
type SiteShellInput = EmptyObject;
type SiteShellState = EmptyObject;
type SiteShellDerived = AppSpec["Components"]["SiteShell"]["Derived"];
type SiteShellActions = EmptyObject;
type SiteShellActionHandlers = {

};
type SiteShellRefs = {
  readonly Root?: Element | null;
  readonly Sidebar?: Element | null;
  readonly Brand?: Element | null;
  readonly Nav?: Element | null;
  readonly Content?: Element | null;
};
type SiteShellDerivedContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: SiteShellInput;
  readonly state: SiteShellState;
  readonly refs: SiteShellRefs;
};
type SiteShellContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: SiteShellInput;
  readonly state: SiteShellState;
  readonly derived: SiteShellDerived;
  readonly refs: SiteShellRefs;
};
type SiteShellActionFactory = (ctx: SiteShellContext) => SiteShellActionHandlers;
type SiteShellDerivedFactory = (ctx: SiteShellDerivedContext) => SiteShellDerived;
export type SiteShellOptions = {
  input?: SiteShellInput;
  state?: SiteShellState;
  actions?: SiteShellActionFactory;
  derived: SiteShellDerivedFactory;
};
export type SiteShellInstance = {
  readonly input: SiteShellInput;
  readonly state: SiteShellState;
  readonly derived: SiteShellDerived;
  readonly actions: SiteShellActionHandlers;
  readonly refs: SiteShellRefs;
  readonly activeSlug: SiteShellDerived["activeSlug"];
  readonly navItems: SiteShellDerived["navItems"];
  readonly Root: (props?: PartHtmlProps) => Child;
  readonly Sidebar: (props?: PartHtmlProps) => Child;
  readonly Brand: (props?: PartHtmlProps) => Child;
  readonly Nav: (props?: PartHtmlProps) => Child;
  readonly Content: (props?: PartHtmlProps) => Child;
};
export function createSiteShell(input: SiteShellOptions): SiteShellInstance;

/** Create a NavButton component instance. */
type NavButtonInput = AppSpec["Components"]["NavButton"]["Input"];
type NavButtonState = EmptyObject;
type NavButtonDerived = EmptyObject;
type NavButtonActions = AppSpec["Components"]["NavButton"]["Actions"];
type NavButtonActionHandlers = {
  readonly navigate: () => void;
};
type NavButtonRefs = {
  readonly Root?: Element | null;
  readonly Label?: Element | null;
};
type NavButtonDerivedContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: NavButtonInput;
  readonly state: NavButtonState;
  readonly refs: NavButtonRefs;
};
type NavButtonContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: NavButtonInput;
  readonly state: NavButtonState;
  readonly derived: NavButtonDerived;
  readonly refs: NavButtonRefs;
};
type NavButtonActionFactory = (ctx: NavButtonContext) => NavButtonActionHandlers;
type NavButtonDerivedFactory = (ctx: NavButtonDerivedContext) => NavButtonDerived;
export type NavButtonOptions = {
  input: NavButtonInput;
  state?: NavButtonState;
  actions: NavButtonActionFactory;
  derived?: NavButtonDerivedFactory;
};
export type NavButtonInstance = {
  readonly input: NavButtonInput;
  readonly state: NavButtonState;
  readonly derived: NavButtonDerived;
  readonly actions: NavButtonActionHandlers;
  readonly refs: NavButtonRefs;
  readonly navigate: NavButtonActionHandlers["navigate"];
  readonly Root: (props?: PartButtonProps) => Child;
  readonly Label: (props?: PartHtmlProps) => Child;
};
export function createNavButton(input: NavButtonOptions): NavButtonInstance;

/** Create a PageHero component instance. */
type PageHeroInput = EmptyObject;
type PageHeroState = EmptyObject;
type PageHeroDerived = AppSpec["Components"]["PageHero"]["Derived"];
type PageHeroActions = EmptyObject;
type PageHeroActionHandlers = {

};
type PageHeroRefs = {
  readonly Root?: Element | null;
  readonly Mark?: Element | null;
  readonly Eyebrow?: Element | null;
  readonly Title?: Element | null;
  readonly Summary?: Element | null;
  readonly Sections?: Element | null;
};
type PageHeroDerivedContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: PageHeroInput;
  readonly state: PageHeroState;
  readonly refs: PageHeroRefs;
};
type PageHeroContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: PageHeroInput;
  readonly state: PageHeroState;
  readonly derived: PageHeroDerived;
  readonly refs: PageHeroRefs;
};
type PageHeroActionFactory = (ctx: PageHeroContext) => PageHeroActionHandlers;
type PageHeroDerivedFactory = (ctx: PageHeroDerivedContext) => PageHeroDerived;
export type PageHeroOptions = {
  input?: PageHeroInput;
  state?: PageHeroState;
  actions?: PageHeroActionFactory;
  derived: PageHeroDerivedFactory;
};
export type PageHeroInstance = {
  readonly input: PageHeroInput;
  readonly state: PageHeroState;
  readonly derived: PageHeroDerived;
  readonly actions: PageHeroActionHandlers;
  readonly refs: PageHeroRefs;
  readonly title: PageHeroDerived["title"];
  readonly summary: PageHeroDerived["summary"];
  readonly sections: PageHeroDerived["sections"];
  readonly Root: (props?: PartHtmlProps) => Child;
  readonly Mark: (props?: PartHtmlProps) => Child;
  readonly Eyebrow: (props?: PartHtmlProps) => Child;
  readonly Title: (props?: PartHtmlProps) => Child;
  readonly Summary: (props?: PartHtmlProps) => Child;
  readonly Sections: (props?: PartHtmlProps) => Child;
};
export function createPageHero(input: PageHeroOptions): PageHeroInstance;

/** Create a SectionCard component instance. */
type SectionCardInput = AppSpec["Components"]["SectionCard"]["Input"];
type SectionCardState = EmptyObject;
type SectionCardDerived = EmptyObject;
type SectionCardActions = EmptyObject;
type SectionCardActionHandlers = {

};
type SectionCardRefs = {
  readonly Root?: Element | null;
  readonly Title?: Element | null;
  readonly Body?: Element | null;
};
type SectionCardDerivedContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: SectionCardInput;
  readonly state: SectionCardState;
  readonly refs: SectionCardRefs;
};
type SectionCardContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: SectionCardInput;
  readonly state: SectionCardState;
  readonly derived: SectionCardDerived;
  readonly refs: SectionCardRefs;
};
type SectionCardActionFactory = (ctx: SectionCardContext) => SectionCardActionHandlers;
type SectionCardDerivedFactory = (ctx: SectionCardDerivedContext) => SectionCardDerived;
export type SectionCardOptions = {
  input: SectionCardInput;
  state?: SectionCardState;
  actions?: SectionCardActionFactory;
  derived?: SectionCardDerivedFactory;
};
export type SectionCardInstance = {
  readonly input: SectionCardInput;
  readonly state: SectionCardState;
  readonly derived: SectionCardDerived;
  readonly actions: SectionCardActionHandlers;
  readonly refs: SectionCardRefs;
  readonly Root: (props?: PartHtmlProps) => Child;
  readonly Title: (props?: PartHtmlProps) => Child;
  readonly Body: (props?: PartHtmlProps) => Child;
};
export function createSectionCard(input: SectionCardOptions): SectionCardInstance;

type AppDefinitionSpecMarker<Spec> = {
  readonly __poggersAppSpec?: Spec;
};
type AppActor = AppSpec extends { Actor: infer Actor extends { id: string } } ? Actor : { id: string };
type SessionData<Actor, Presence> = {
  readonly id: string;
  readonly actor: Actor;
  readonly presence: Presence;
};
type ResourcePresence<Resource> = Resource extends { Presence: infer Presence } ? Presence : EmptyObject;
type CommandArgs<Command> = Command extends { args: infer Args extends any[] }
  ? Args
  : Command extends any[]
    ? Command
    : [];
type CommandError<Command> = Command extends { error: infer Error } ? Error : never;
type CommandErrorFn<Command> = CommandError<Command> extends string
  ? (code: CommandError<Command>) => void
  : CommandError<Command> extends [infer Code extends string, infer Data]
    ? (code: Code, data: Data) => void
    : never;
type AppMetadata = {
  name?: string;
};
type PwaIconDef =
  | string
  | {
      src: string;
      sizes?: string;
      type?: string;
      purpose?: string;
    };
type PwaDef = {
  name: string;
  shortName?: string;
  description?: string;
  themeColor: string;
  backgroundColor: string;
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  orientation?: string;
  startUrl?: string;
  scope?: string;
  icons?: {
    any?: PwaIconDef | PwaIconDef[];
    maskable?: PwaIconDef | PwaIconDef[];
  };
};
type AppUIContext = {
  usePage(key: PageResourceKey): PageResource;
  readonly screen: Signal<AppScreen>;
  readonly nav: AppNavigation;
};

type PageResourceEvents = PageResourceSpec["Events"];
type PageResourcePresence = ResourcePresence<PageResourceSpec>;
type PageEventArgs<Event extends keyof PageResourceEvents> = {
  readonly state: PageResourceSpec["State"];
  readonly payload: PageResourceEvents[Event];
  readonly actor: AppActor;
  readonly at: number;
  readonly seq: number;
};
type PageViewArgs = {
  readonly state: PageResourceSpec["State"];
  readonly actor: AppActor | null;
  readonly sessions: SessionData<AppActor, PageResourcePresence>[];
  readonly key: PageResourceKey;
};
type PageCommandEvents = {

};
type PageCommandEvent<Command extends keyof PageResourceCommands> =
  Command extends keyof PageCommandEvents
    ? PageCommandEvents[Command] extends keyof PageResourceEvents
      ? {
          [Event in PageCommandEvents[Command]]: (
            payload: PageResourceEvents[Event],
          ) => void;
        }
      : EmptyObject
    : EmptyObject;
type PageCommandContext<Command extends keyof PageResourceCommands> = {
  readonly state: PageResourceSpec["State"];
  readonly actor: AppActor;
  readonly key: PageResourceKey;
  event: PageCommandEvent<Command>;
  setPresence(patch: Partial<PageResourcePresence>): void;
  error: CommandErrorFn<PageResourceCommands[Command]>;
  id(): string;
  now(): number;
};
type PageResourceDefinition = {
  state: PageResourceSpec["State"];
  presence?: PageResourcePresence;
  events: {

  };
  views?: {
  page(args: PageViewArgs): PageResourceViews["page"];
  nav(args: PageViewArgs): PageResourceViews["nav"];
  };
  commands?: {
  recordVisit(ctx: PageCommandContext<"recordVisit">, ...args: CommandArgs<PageResourceCommands["recordVisit"]>): void;
  };
};



type SiteShellControllerContext = SiteShellContext & {
  readonly actions: SiteShellActionHandlers;
};
type SiteShellControllerResult = Partial<{
  Root?: Partial<PartHtmlProps>;
  Sidebar?: Partial<PartHtmlProps>;
  Brand?: Partial<PartHtmlProps>;
  Nav?: Partial<PartHtmlProps>;
  Content?: Partial<PartHtmlProps>;
}>;

type NavButtonControllerContext = NavButtonContext & {
  readonly actions: NavButtonActionHandlers;
};
type NavButtonControllerResult = Partial<{
  Root?: Partial<PartButtonProps>;
  Label?: Partial<PartHtmlProps>;
}>;

type PageHeroControllerContext = PageHeroContext & {
  readonly actions: PageHeroActionHandlers;
};
type PageHeroControllerResult = Partial<{
  Root?: Partial<PartHtmlProps>;
  Mark?: Partial<PartHtmlProps>;
  Eyebrow?: Partial<PartHtmlProps>;
  Title?: Partial<PartHtmlProps>;
  Summary?: Partial<PartHtmlProps>;
  Sections?: Partial<PartHtmlProps>;
}>;

type SectionCardControllerContext = SectionCardContext & {
  readonly actions: SectionCardActionHandlers;
};
type SectionCardControllerResult = Partial<{
  Root?: Partial<PartHtmlProps>;
  Title?: Partial<PartHtmlProps>;
  Body?: Partial<PartHtmlProps>;
}>;

export type AppDefinition = AppDefinitionSpecMarker<AppSpec> & {
  version: number;
  app?: AppMetadata;
  pwa?: PwaDef;
  navigation?: {
    home: string;
    page: string;
  };



  components?: {
    SiteShell?: (ctx: SiteShellControllerContext) => SiteShellControllerResult;
    NavButton?: (ctx: NavButtonControllerContext) => NavButtonControllerResult;
    PageHero?: (ctx: PageHeroControllerContext) => PageHeroControllerResult;
    SectionCard?: (ctx: SectionCardControllerContext) => SectionCardControllerResult;
  };

  ui?: (ctx: AppUIContext) => unknown;
  resources: {
    page: PageResourceDefinition;
  };
};

type StyleDefinitionSpecMarker<Spec> = {
  readonly __poggersStyleSpec?: Spec;
};
type StyleOutput = Record<string, unknown>;
type StyleSlot<Context> = StyleOutput | ((ctx: Context) => StyleOutput);

type SiteShellStyleContext = {
  readonly preset: AppPreset;
  readonly input: SiteShellInput;
  readonly state: SiteShellState;
  readonly derived: SiteShellDerived;
  readonly theme: AppThemeValues;
};
type SiteShellStyleDefinition = {
  Root?: StyleSlot<SiteShellStyleContext>;
  Sidebar?: StyleSlot<SiteShellStyleContext>;
  Brand?: StyleSlot<SiteShellStyleContext>;
  Nav?: StyleSlot<SiteShellStyleContext>;
  Content?: StyleSlot<SiteShellStyleContext>;
};

type NavButtonStyleContext = {
  readonly preset: AppPreset;
  readonly input: NavButtonInput;
  readonly state: NavButtonState;
  readonly derived: NavButtonDerived;
  readonly theme: AppThemeValues;
};
type NavButtonStyleDefinition = {
  Root?: StyleSlot<NavButtonStyleContext>;
  Label?: StyleSlot<NavButtonStyleContext>;
};

type PageHeroStyleContext = {
  readonly preset: AppPreset;
  readonly input: PageHeroInput;
  readonly state: PageHeroState;
  readonly derived: PageHeroDerived;
  readonly theme: AppThemeValues;
};
type PageHeroStyleDefinition = {
  Root?: StyleSlot<PageHeroStyleContext>;
  Mark?: StyleSlot<PageHeroStyleContext>;
  Eyebrow?: StyleSlot<PageHeroStyleContext>;
  Title?: StyleSlot<PageHeroStyleContext>;
  Summary?: StyleSlot<PageHeroStyleContext>;
  Sections?: StyleSlot<PageHeroStyleContext>;
};

type SectionCardStyleContext = {
  readonly preset: AppPreset;
  readonly input: SectionCardInput;
  readonly state: SectionCardState;
  readonly derived: SectionCardDerived;
  readonly theme: AppThemeValues;
};
type SectionCardStyleDefinition = {
  Root?: StyleSlot<SectionCardStyleContext>;
  Title?: StyleSlot<SectionCardStyleContext>;
  Body?: StyleSlot<SectionCardStyleContext>;
};

export type StyleDefinition = StyleDefinitionSpecMarker<AppSpec> & {
  defaultPreset?: AppPreset;
  presets: {
    [Preset in AppPreset]?: {
      SiteShell?: SiteShellStyleDefinition;
      NavButton?: NavButtonStyleDefinition;
      PageHero?: PageHeroStyleDefinition;
      SectionCard?: SectionCardStyleDefinition;
    };
  };
};

export const nav: AppNavigation;

export function useScreen(): AppScreen;

export function usePreset(): AppPreset;

export function setPreset(preset: AppPreset): void;

export function useTheme(): AppThemeValues;

export function setThemeParam(param: "density", value: number): void;

export function start(connect?: StartConnect): void;

export function Root(props?: RootProps): Child;

export default Root;
