import { mountDialog as mountRetainedDialog } from "./ui";

export {
  mountDrag,
  type DragAxis,
  type DragBounds,
  type DragDriver,
  type DragDriverMount,
  type DragOptions,
  type DragRelease,
  type DragSample,
} from "./web-drag";

export type PressBindings = {
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onClick: (event: MouseEvent) => void;
};

export type Shortcut = {
  readonly key: string;
  readonly modifiers?: readonly ("mod" | "shift" | "alt")[];
};

export type ShortcutBinding = {
  readonly aria: string;
  readonly handle: (event: KeyboardEvent) => void;
};

export type DialogMode = false | "modal" | "nonmodal";

export function mountDialog(element: HTMLDialogElement, readMode: () => DialogMode): void {
  mountRetainedDialog(element, readMode);
}

export function createPress(activate: () => void): PressBindings {
  let suppressPointerClick = false;
  return {
    onPointerDown(event) {
      if (
        event.button !== 0 ||
        event.pointerType === "touch" ||
        interactionDisabled(event.currentTarget)
      ) {
        return;
      }
      suppressPointerClick = true;
      activate();
    },
    onClick(event) {
      if (interactionDisabled(event.currentTarget)) return;
      if (event.detail > 0 && suppressPointerClick) {
        suppressPointerClick = false;
        event.preventDefault();
        return;
      }
      suppressPointerClick = false;
      activate();
    },
  };
}

export function createShortcut(shortcut: Shortcut, activate: () => void): ShortcutBinding {
  const modifiers = new Set(shortcut.modifiers ?? []);
  const key = shortcut.key.toLowerCase();
  const ariaKey = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  const prefix = [
    ...(modifiers.has("shift") ? ["Shift"] : []),
    ...(modifiers.has("alt") ? ["Alt"] : []),
  ];
  const aria = modifiers.has("mod")
    ? [`Meta+${[...prefix, ariaKey].join("+")}`, `Control+${[...prefix, ariaKey].join("+")}`].join(
        " ",
      )
    : [...prefix, ariaKey].join("+");

  return {
    aria,
    handle(event) {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.key.toLowerCase() !== key) return;
      if ((event.metaKey || event.ctrlKey) !== modifiers.has("mod")) return;
      if (event.shiftKey !== modifiers.has("shift")) return;
      if (event.altKey !== modifiers.has("alt")) return;
      event.preventDefault();
      activate();
    },
  };
}

function interactionDisabled(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as EventTarget & {
    disabled?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  return element.disabled === true || element.getAttribute?.("aria-disabled") === "true";
}
