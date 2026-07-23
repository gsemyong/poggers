import {
  createPress,
  createShortcut,
  mountDialog,
  mountDrag,
} from "@/adapters/web/ui/component/interaction";
import { Await, For, Show } from "@/adapters/web/ui/component/runtime";
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
