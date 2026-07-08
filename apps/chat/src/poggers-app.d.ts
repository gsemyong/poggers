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
type AppPreset = "paper" | "terminal";
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
  | { readonly name: "home"; readonly params: EmptyObject };
export type AppNavigation = {
  home(params?: EmptyObject): void;
};

/** Local-first chat state, commands, streaming presence, and assistant messages. */
type ChatResourceSpec = AppSpec["Resources"]["chat"];
type ChatResourceViews = ChatResourceSpec["Views"];
type ChatResourceCommands = ChatResourceSpec["Commands"];
export type ChatResourceKey = ChatResourceSpec["Key"];
export type ChatResource = {
  readonly messages: ChatResourceViews["messages"];
  readonly status: ChatResourceViews["status"];
  readonly understanding: ChatResourceViews["understanding"];
  readonly error: ChatResourceViews["error"];
  readonly streamingText: ChatResourceViews["streamingText"];
  sendMessage(...args: ChatResourceCommands["sendMessage"]["args"]): CommandReceipt<ChatResourceCommands["sendMessage"]["error"]>;
  completeGeneration(...args: ChatResourceCommands["completeGeneration"]["args"]): CommandReceipt<ChatResourceCommands["completeGeneration"]["error"]>;
  failGeneration(...args: ChatResourceCommands["failGeneration"]["args"]): CommandReceipt<ChatResourceCommands["failGeneration"]["error"]>;
  startStreaming(...args: ChatResourceCommands["startStreaming"]["args"]): CommandReceipt<ChatResourceCommands["startStreaming"]["error"]>;
  streamChunk(...args: ChatResourceCommands["streamChunk"]["args"]): CommandReceipt<ChatResourceCommands["streamChunk"]["error"]>;
  readonly sync: SyncMeta;
};
export function useChat(key: ChatResourceKey): ChatResource;

/** Full chat screen structure. Style-only parts are generated automatically. */
type ChatLayoutInput = EmptyObject;
type ChatLayoutState = EmptyObject;
type ChatLayoutDerived = AppSpec["Components"]["ChatLayout"]["Derived"];
type ChatLayoutActions = AppSpec["Components"]["ChatLayout"]["Actions"];
type ChatLayoutActionHandlers = {
  readonly togglePreset: () => void;
};
type ChatLayoutRefs = {
  readonly Root?: Element | null;
  readonly Topbar?: Element | null;
  readonly Brand?: Element | null;
  readonly BrandMark?: Element | null;
  readonly BrandText?: Element | null;
  readonly PresetSwitch?: Element | null;
  readonly Messages?: Element | null;
  readonly Empty?: Element | null;
  readonly Status?: Element | null;
  readonly StatusText?: Element | null;
  readonly StatusMeta?: Element | null;
  readonly Understanding?: Element | null;
  readonly Composer?: Element | null;
};
type ChatLayoutDerivedContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: ChatLayoutInput;
  readonly state: ChatLayoutState;
  readonly refs: ChatLayoutRefs;
};
type ChatLayoutContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: ChatLayoutInput;
  readonly state: ChatLayoutState;
  readonly derived: ChatLayoutDerived;
  readonly refs: ChatLayoutRefs;
};
type ChatLayoutActionFactory = (ctx: ChatLayoutContext) => ChatLayoutActionHandlers;
type ChatLayoutDerivedFactory = (ctx: ChatLayoutDerivedContext) => ChatLayoutDerived;
export type ChatLayoutOptions = {
  input?: ChatLayoutInput;
  state?: ChatLayoutState;
  actions: ChatLayoutActionFactory;
  derived: ChatLayoutDerivedFactory;
};
export type ChatLayoutInstance = {
  readonly input: ChatLayoutInput;
  readonly state: ChatLayoutState;
  readonly derived: ChatLayoutDerived;
  readonly actions: ChatLayoutActionHandlers;
  readonly refs: ChatLayoutRefs;
  readonly brandText: ChatLayoutDerived["brandText"];
  readonly presetSwitchLabel: ChatLayoutDerived["presetSwitchLabel"];
  readonly statusText: ChatLayoutDerived["statusText"];
  readonly statusMeta: ChatLayoutDerived["statusMeta"];
  readonly understandingText: ChatLayoutDerived["understandingText"];
  readonly hasUnderstanding: ChatLayoutDerived["hasUnderstanding"];
  readonly togglePreset: ChatLayoutActionHandlers["togglePreset"];
  readonly Root: (props?: PartHtmlProps) => Child;
  readonly Topbar: (props?: PartHtmlProps) => Child;
  readonly Brand: (props?: PartHtmlProps) => Child;
  readonly BrandMark: (props?: PartHtmlProps) => Child;
  readonly BrandText: (props?: PartHtmlProps) => Child;
  readonly PresetSwitch: (props?: PartButtonProps) => Child;
  readonly Messages: (props?: PartHtmlProps) => Child;
  readonly Empty: (props?: PartHtmlProps) => Child;
  readonly Status: (props?: PartHtmlProps) => Child;
  readonly StatusText: (props?: PartHtmlProps) => Child;
  readonly StatusMeta: (props?: PartHtmlProps) => Child;
  readonly Understanding: (props?: PartHtmlProps) => Child;
  readonly Composer: (props?: PartHtmlProps) => Child;
};
export function createChatLayout(input: ChatLayoutOptions): ChatLayoutInstance;

/** Message container for user, assistant, and streaming messages. */
type ChatMessageInput = AppSpec["Components"]["ChatMessage"]["Input"];
type ChatMessageState = EmptyObject;
type ChatMessageDerived = AppSpec["Components"]["ChatMessage"]["Derived"];
type ChatMessageActions = EmptyObject;
type ChatMessageActionHandlers = {

};
type ChatMessageRefs = {
  readonly Root?: Element | null;
  readonly Role?: Element | null;
  readonly Content?: Element | null;
};
type ChatMessageDerivedContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: ChatMessageInput;
  readonly state: ChatMessageState;
  readonly refs: ChatMessageRefs;
};
type ChatMessageContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: ChatMessageInput;
  readonly state: ChatMessageState;
  readonly derived: ChatMessageDerived;
  readonly refs: ChatMessageRefs;
};
type ChatMessageActionFactory = (ctx: ChatMessageContext) => ChatMessageActionHandlers;
type ChatMessageDerivedFactory = (ctx: ChatMessageDerivedContext) => ChatMessageDerived;
export type ChatMessageOptions = {
  input: ChatMessageInput;
  state?: ChatMessageState;
  actions?: ChatMessageActionFactory;
  derived: ChatMessageDerivedFactory;
};
export type ChatMessageInstance = {
  readonly input: ChatMessageInput;
  readonly state: ChatMessageState;
  readonly derived: ChatMessageDerived;
  readonly actions: ChatMessageActionHandlers;
  readonly refs: ChatMessageRefs;
  readonly roleLabel: ChatMessageDerived["roleLabel"];
  readonly contentText: ChatMessageDerived["contentText"];
  readonly hidden: ChatMessageDerived["hidden"];
  readonly Root: (props?: PartHtmlProps) => Child;
  readonly Role: (props?: PartHtmlProps) => Child;
  readonly Content: (props?: PartHtmlProps) => Child;
};
export function createChatMessage(input: ChatMessageOptions): ChatMessageInstance;

/** Structured assistant response part renderer. */
type AIPartInput = AppSpec["Components"]["AIPart"]["Input"];
type AIPartState = EmptyObject;
type AIPartDerived = EmptyObject;
type AIPartActions = EmptyObject;
type AIPartActionHandlers = {

};
type AIPartRefs = {
  readonly Root?: Element | null;
  readonly Item?: Element | null;
};
type AIPartDerivedContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: AIPartInput;
  readonly state: AIPartState;
  readonly refs: AIPartRefs;
};
type AIPartContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: AIPartInput;
  readonly state: AIPartState;
  readonly derived: AIPartDerived;
  readonly refs: AIPartRefs;
};
type AIPartActionFactory = (ctx: AIPartContext) => AIPartActionHandlers;
type AIPartDerivedFactory = (ctx: AIPartDerivedContext) => AIPartDerived;
export type AIPartOptions = {
  input: AIPartInput;
  state?: AIPartState;
  actions?: AIPartActionFactory;
  derived?: AIPartDerivedFactory;
};
export type AIPartInstance = {
  readonly input: AIPartInput;
  readonly state: AIPartState;
  readonly derived: AIPartDerived;
  readonly actions: AIPartActionHandlers;
  readonly refs: AIPartRefs;
  readonly Root: (props?: PartHtmlProps) => Child;
  readonly Item: (props?: PartHtmlProps) => Child;
};
export function createAIPart(input: AIPartOptions): AIPartInstance;

/** Composer form with local text state, submit action, and derived button state. */
type ComposerInput = EmptyObject;
type ComposerState = AppSpec["Components"]["Composer"]["State"];
type ComposerDerived = AppSpec["Components"]["Composer"]["Derived"];
type ComposerActions = AppSpec["Components"]["Composer"]["Actions"];
type ComposerActionHandlers = {
  readonly clear: () => void;
  readonly change: (value: string) => void;
  readonly submit: () => void;
  readonly submitFromKeyboard: (event: KeyboardEvent) => void;
};
type ComposerRefs = {
  readonly Root?: Element | null;
  readonly Input?: Element | null;
  readonly Send?: Element | null;
};
type ComposerDerivedContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: ComposerInput;
  readonly state: ComposerState;
  readonly refs: ComposerRefs;
};
type ComposerContext = {
  readonly preset: AppPreset;
  readonly theme: AppThemeValues;
  readonly input: ComposerInput;
  readonly state: ComposerState;
  readonly derived: ComposerDerived;
  readonly refs: ComposerRefs;
};
type ComposerActionFactory = (ctx: ComposerContext) => ComposerActionHandlers;
type ComposerDerivedFactory = (ctx: ComposerDerivedContext) => ComposerDerived;
export type ComposerOptions = {
  input?: ComposerInput;
  state: ComposerState;
  actions: ComposerActionFactory;
  derived: ComposerDerivedFactory;
};
export type ComposerInstance = {
  readonly input: ComposerInput;
  readonly state: ComposerState;
  readonly derived: ComposerDerived;
  readonly actions: ComposerActionHandlers;
  readonly refs: ComposerRefs;
  readonly canSubmit: ComposerDerived["canSubmit"];
  readonly busy: ComposerDerived["busy"];
  readonly clear: ComposerActionHandlers["clear"];
  readonly change: ComposerActionHandlers["change"];
  readonly submit: ComposerActionHandlers["submit"];
  readonly submitFromKeyboard: ComposerActionHandlers["submitFromKeyboard"];
  readonly Root: (props?: PartFormProps) => Child;
  readonly Input: (props?: PartTextareaProps) => Child;
  readonly Send: (props?: PartButtonProps) => Child;
};
export function createComposer(input: ComposerOptions): ComposerInstance;

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
  useChat(key: ChatResourceKey): ChatResource;
  readonly screen: Signal<AppScreen>;
  readonly nav: AppNavigation;
};

type ChatResourceEvents = ChatResourceSpec["Events"];
type ChatResourcePresence = ResourcePresence<ChatResourceSpec>;
type ChatEventArgs<Event extends keyof ChatResourceEvents> = {
  readonly state: ChatResourceSpec["State"];
  readonly payload: ChatResourceEvents[Event];
  readonly actor: AppActor;
  readonly at: number;
  readonly seq: number;
};
type ChatViewArgs = {
  readonly state: ChatResourceSpec["State"];
  readonly actor: AppActor | null;
  readonly sessions: SessionData<AppActor, ChatResourcePresence>[];
  readonly key: ChatResourceKey;
};
type ChatCommandEvents = {
  "sendMessage": "messageSent";
  "completeGeneration": "generationCompleted";
  "failGeneration": "generationError";
};
type ChatCommandEvent<Command extends keyof ChatResourceCommands> =
  Command extends keyof ChatCommandEvents
    ? ChatCommandEvents[Command] extends keyof ChatResourceEvents
      ? {
          [Event in ChatCommandEvents[Command]]: (
            payload: ChatResourceEvents[Event],
          ) => void;
        }
      : EmptyObject
    : EmptyObject;
type ChatCommandContext<Command extends keyof ChatResourceCommands> = {
  readonly state: ChatResourceSpec["State"];
  readonly actor: AppActor;
  readonly key: ChatResourceKey;
  event: ChatCommandEvent<Command>;
  setPresence(patch: Partial<ChatResourcePresence>): void;
  error: CommandErrorFn<ChatResourceCommands[Command]>;
  id(): string;
  now(): number;
};
type ChatResourceDefinition = {
  state: ChatResourceSpec["State"];
  presence?: ChatResourcePresence;
  events: {
  messageSent(args: ChatEventArgs<"messageSent">): void;
  generationCompleted(args: ChatEventArgs<"generationCompleted">): void;
  generationError(args: ChatEventArgs<"generationError">): void;
  };
  views?: {
  messages(args: ChatViewArgs): ChatResourceViews["messages"];
  status(args: ChatViewArgs): ChatResourceViews["status"];
  understanding(args: ChatViewArgs): ChatResourceViews["understanding"];
  error(args: ChatViewArgs): ChatResourceViews["error"];
  streamingText(args: ChatViewArgs): ChatResourceViews["streamingText"];
  };
  commands?: {
  sendMessage(ctx: ChatCommandContext<"sendMessage">, ...args: CommandArgs<ChatResourceCommands["sendMessage"]>): void;
  completeGeneration(ctx: ChatCommandContext<"completeGeneration">, ...args: CommandArgs<ChatResourceCommands["completeGeneration"]>): void;
  failGeneration(ctx: ChatCommandContext<"failGeneration">, ...args: CommandArgs<ChatResourceCommands["failGeneration"]>): void;
  startStreaming(ctx: ChatCommandContext<"startStreaming">, ...args: CommandArgs<ChatResourceCommands["startStreaming"]>): void;
  streamChunk(ctx: ChatCommandContext<"streamChunk">, ...args: CommandArgs<ChatResourceCommands["streamChunk"]>): void;
  };
};

type ChatProgramResource = {
  readonly messages: ChatResourceViews["messages"];
  readonly status: ChatResourceViews["status"];
  readonly understanding: ChatResourceViews["understanding"];
  readonly error: ChatResourceViews["error"];
  readonly streamingText: ChatResourceViews["streamingText"];
  sendMessage(...args: ChatResourceCommands["sendMessage"]["args"]): CommandReceipt<ChatResourceCommands["sendMessage"]["error"]>;
  completeGeneration(...args: ChatResourceCommands["completeGeneration"]["args"]): CommandReceipt<ChatResourceCommands["completeGeneration"]["error"]>;
  failGeneration(...args: ChatResourceCommands["failGeneration"]["args"]): CommandReceipt<ChatResourceCommands["failGeneration"]["error"]>;
  startStreaming(...args: ChatResourceCommands["startStreaming"]["args"]): CommandReceipt<ChatResourceCommands["startStreaming"]["error"]>;
  streamChunk(...args: ChatResourceCommands["streamChunk"]["args"]): CommandReceipt<ChatResourceCommands["streamChunk"]["error"]>;
  readonly view: ChatResourceViews;
};

type ChatMessageSentProgramEventItem = {
  readonly event: {
    readonly id: string;
    readonly seq: number;
    readonly at: number;
    readonly version: number;
    readonly actor: AppActor;
    readonly resource: "chat";
    readonly key: ChatResourceKey;
    readonly name: "messageSent";
    readonly payload: ChatResourceEvents["messageSent"];
  };
  readonly resource: "chat";
  readonly key: ChatResourceKey;
  readonly view: ChatResourceViews;
  readonly chat: ChatProgramResource;
};

type ChatGenerationCompletedProgramEventItem = {
  readonly event: {
    readonly id: string;
    readonly seq: number;
    readonly at: number;
    readonly version: number;
    readonly actor: AppActor;
    readonly resource: "chat";
    readonly key: ChatResourceKey;
    readonly name: "generationCompleted";
    readonly payload: ChatResourceEvents["generationCompleted"];
  };
  readonly resource: "chat";
  readonly key: ChatResourceKey;
  readonly view: ChatResourceViews;
  readonly chat: ChatProgramResource;
};

type ChatGenerationErrorProgramEventItem = {
  readonly event: {
    readonly id: string;
    readonly seq: number;
    readonly at: number;
    readonly version: number;
    readonly actor: AppActor;
    readonly resource: "chat";
    readonly key: ChatResourceKey;
    readonly name: "generationError";
    readonly payload: ChatResourceEvents["generationError"];
  };
  readonly resource: "chat";
  readonly key: ChatResourceKey;
  readonly view: ChatResourceViews;
  readonly chat: ChatProgramResource;
};

type ServerProgramContext = {
  readonly signal: AbortSignal;
  events(name: "chat.messageSent", options: { id: string; signal?: AbortSignal }): AsyncIterable<ChatMessageSentProgramEventItem>;
  events(name: "chat.generationCompleted", options: { id: string; signal?: AbortSignal }): AsyncIterable<ChatGenerationCompletedProgramEventItem>;
  events(name: "chat.generationError", options: { id: string; signal?: AbortSignal }): AsyncIterable<ChatGenerationErrorProgramEventItem>;
  useChat(key: ChatResourceKey): ChatProgramResource;
};

type ChatLayoutControllerContext = ChatLayoutContext & {
  readonly actions: ChatLayoutActionHandlers;
};
type ChatLayoutControllerResult = Partial<{
  Root?: Partial<PartHtmlProps>;
  Topbar?: Partial<PartHtmlProps>;
  Brand?: Partial<PartHtmlProps>;
  BrandMark?: Partial<PartHtmlProps>;
  BrandText?: Partial<PartHtmlProps>;
  PresetSwitch?: Partial<PartButtonProps>;
  Messages?: Partial<PartHtmlProps>;
  Empty?: Partial<PartHtmlProps>;
  Status?: Partial<PartHtmlProps>;
  StatusText?: Partial<PartHtmlProps>;
  StatusMeta?: Partial<PartHtmlProps>;
  Understanding?: Partial<PartHtmlProps>;
  Composer?: Partial<PartHtmlProps>;
}>;

type ChatMessageControllerContext = ChatMessageContext & {
  readonly actions: ChatMessageActionHandlers;
};
type ChatMessageControllerResult = Partial<{
  Root?: Partial<PartHtmlProps>;
  Role?: Partial<PartHtmlProps>;
  Content?: Partial<PartHtmlProps>;
}>;

type AIPartControllerContext = AIPartContext & {
  readonly actions: AIPartActionHandlers;
};
type AIPartControllerResult = Partial<{
  Root?: Partial<PartHtmlProps>;
  Item?: Partial<PartHtmlProps>;
}>;

type ComposerControllerContext = ComposerContext & {
  readonly actions: ComposerActionHandlers;
};
type ComposerControllerResult = Partial<{
  Root?: Partial<PartFormProps>;
  Input?: Partial<PartTextareaProps>;
  Send?: Partial<PartButtonProps>;
}>;

export type AppDefinition = AppDefinitionSpecMarker<AppSpec> & {
  version: number;
  app?: AppMetadata;
  pwa?: PwaDef;
  navigation?: {
    home: string;
  };

  deps?: {
    server?: () => AppSpec["Environments"]["server"] extends { Deps: infer Deps } ? Deps : EmptyObject | Promise<AppSpec["Environments"]["server"] extends { Deps: infer Deps } ? Deps : EmptyObject>;
  };

  programs?: {
    server?: (ctx: ServerProgramContext, deps: AppSpec["Environments"]["server"] extends { Deps: infer Deps } ? Deps : EmptyObject) => void | Promise<void>;
  };

  components?: {
    ChatLayout?: (ctx: ChatLayoutControllerContext) => ChatLayoutControllerResult;
    ChatMessage?: (ctx: ChatMessageControllerContext) => ChatMessageControllerResult;
    AIPart?: (ctx: AIPartControllerContext) => AIPartControllerResult;
    Composer?: (ctx: ComposerControllerContext) => ComposerControllerResult;
  };

  ui?: (ctx: AppUIContext) => unknown;
  resources: {
    chat: ChatResourceDefinition;
  };
};

type StyleDefinitionSpecMarker<Spec> = {
  readonly __poggersStyleSpec?: Spec;
};
type StyleOutput = Record<string, unknown>;
type StyleSlot<Context> = StyleOutput | ((ctx: Context) => StyleOutput);

type ChatLayoutStyleContext = {
  readonly preset: AppPreset;
  readonly input: ChatLayoutInput;
  readonly state: ChatLayoutState;
  readonly derived: ChatLayoutDerived;
  readonly theme: AppThemeValues;
};
type ChatLayoutStyleDefinition = {
  Root?: StyleSlot<ChatLayoutStyleContext>;
  Topbar?: StyleSlot<ChatLayoutStyleContext>;
  Brand?: StyleSlot<ChatLayoutStyleContext>;
  BrandMark?: StyleSlot<ChatLayoutStyleContext>;
  BrandText?: StyleSlot<ChatLayoutStyleContext>;
  PresetSwitch?: StyleSlot<ChatLayoutStyleContext>;
  Messages?: StyleSlot<ChatLayoutStyleContext>;
  Empty?: StyleSlot<ChatLayoutStyleContext>;
  Status?: StyleSlot<ChatLayoutStyleContext>;
  StatusText?: StyleSlot<ChatLayoutStyleContext>;
  StatusMeta?: StyleSlot<ChatLayoutStyleContext>;
  Understanding?: StyleSlot<ChatLayoutStyleContext>;
  Composer?: StyleSlot<ChatLayoutStyleContext>;
};

type ChatMessageStyleContext = {
  readonly preset: AppPreset;
  readonly input: ChatMessageInput;
  readonly state: ChatMessageState;
  readonly derived: ChatMessageDerived;
  readonly theme: AppThemeValues;
};
type ChatMessageStyleDefinition = {
  Root?: StyleSlot<ChatMessageStyleContext>;
  Role?: StyleSlot<ChatMessageStyleContext>;
  Content?: StyleSlot<ChatMessageStyleContext>;
};

type AIPartStyleContext = {
  readonly preset: AppPreset;
  readonly input: AIPartInput;
  readonly state: AIPartState;
  readonly derived: AIPartDerived;
  readonly theme: AppThemeValues;
};
type AIPartStyleDefinition = {
  Root?: StyleSlot<AIPartStyleContext>;
  Item?: StyleSlot<AIPartStyleContext>;
};

type ComposerStyleContext = {
  readonly preset: AppPreset;
  readonly input: ComposerInput;
  readonly state: ComposerState;
  readonly derived: ComposerDerived;
  readonly theme: AppThemeValues;
};
type ComposerStyleDefinition = {
  Root?: StyleSlot<ComposerStyleContext>;
  Input?: StyleSlot<ComposerStyleContext>;
  Send?: StyleSlot<ComposerStyleContext>;
};

export type StyleDefinition = StyleDefinitionSpecMarker<AppSpec> & {
  defaultPreset?: AppPreset;
  presets: {
    [Preset in AppPreset]?: {
      ChatLayout?: ChatLayoutStyleDefinition;
      ChatMessage?: ChatMessageStyleDefinition;
      AIPart?: AIPartStyleDefinition;
      Composer?: ComposerStyleDefinition;
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
