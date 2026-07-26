import {
  createPress,
  createShortcut,
  mountDialog,
  mountDrag,
} from "@/platforms/web/adapter/ui/component/interaction";
import { Await, For, Show } from "@/platforms/web/adapter/ui/component/runtime";
import type { WebUIRuntime } from "@/platforms/web/ui";

/** Concrete web behavior supplied to the public UI authoring intrinsics. */
export const webUIRuntime: WebUIRuntime = Object.freeze({
  Await,
  For,
  Show,
  createPress,
  createShortcut,
  mountDialog,
  mountDrag,
});
