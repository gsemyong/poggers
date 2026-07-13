import type { VisualValue, Writable } from "@poggers/kit";
import type { DragRelease } from "@poggers/kit/web";

export type App = {
  Resources: {};
  Components: {
    Drawer: {
      Context: {};
      States:
        | "closed"
        | "open"
        | "open.view"
        | "open.view.default"
        | "open.view.key"
        | "open.view.phrase"
        | "open.view.remove"
        | "open.gesture"
        | "open.gesture.idle"
        | "open.gesture.dragging"
        | "closing"
        | "closing.default"
        | "closing.key"
        | "closing.phrase"
        | "closing.remove";
      Values: {
        opened: boolean;
        dragging: boolean;
        dialog: false | "modal" | "nonmodal";
        presetSwitchLabel: "Family" | "Studio";
        defaultVisible: boolean;
        keyVisible: boolean;
        phraseVisible: boolean;
        removeVisible: boolean;
        dragOffset: Writable<VisualValue<"length">>;
        dragVelocity: Writable<number>;
        dragProgress: Writable<VisualValue<"progress">>;
        sheetHeight: Writable<VisualValue<"size">>;
      };
      Events: {
        open(): void;
        close(): void;
        toggle(): void;
        back(): void;
        showKey(): void;
        showPhrase(): void;
        showRemove(): void;
        startDragging(): void;
        releaseDragging(release: DragRelease): void;
        cancelDragging(): void;
        togglePreset(): void;
      };
      Parameters: {
        dismissDistance: number;
        dismissVelocity: number;
      };
      Parts: {
        Root: "main";
        Page: "section";
        PresetSwitch: "button";
        Trigger: "button";
        Panel: "dialog";
        Backdrop: "div";
        Surface: "section";
        Handle: "div";
        HandleBar: "div";
        Close: "button";
        CloseIcon: "img";
        Viewport: "div";
        DefaultView: "section";
        DefaultHeader: "header";
        DefaultTitle: "h2";
        OptionList: "div";
        OptionButton: "button";
        DangerOption: "button";
        OptionIcon: "img";
        DetailView: "section";
        DetailBody: "div";
        ViewHeader: "header";
        ViewIcon: "img";
        ViewTitle: "h2";
        ViewDescription: "p";
        AdviceList: "ul";
        AdviceItem: "li";
        AdviceIcon: "img";
        Actions: "div";
        DangerActions: "div";
        SecondaryButton: "button";
        PrimaryButton: "button";
        DangerButton: "button";
        PrimaryIcon: "img";
      };
    };
  };
  Styles: { Presets: "family" | "studio" };
};
