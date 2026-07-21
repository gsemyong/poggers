import type { WebUI } from "@/adapters/web/platform";
import { createApplicationUI, type WebComponentAdapter } from "@/adapters/web/ui/component/adapter";
import { jsx as webJSX } from "@/adapters/web/ui/component/runtime";
import {
  createWebPresentationAdapter,
  type WebPresentationAdapter,
} from "@/adapters/web/ui/presentation/adapter";
import type { UIAdapter } from "@/contracts/platform";
import { activateJSXRenderer } from "@/core/jsx/runtime";

export { HotUpdateCoordinator } from "@/core/development";
export { render } from "@/adapters/web/ui/component/runtime";

const renderWebIntrinsic = (type: string, props: Readonly<Record<string, unknown>>) =>
  webJSX(type, props as Parameters<typeof webJSX>[1]);

export type WebUIAdapter = UIAdapter<WebUI, WebComponentAdapter, WebPresentationAdapter>;

/** Creates the paired web structure and Presentation implementation. */
export function createWebUIAdapter(): WebUIAdapter {
  const presentation = createWebPresentationAdapter();
  const component: WebComponentAdapter = {
    createApplicationUI(options) {
      const activation = activateJSXRenderer(renderWebIntrinsic);
      let ui;
      try {
        ui = createApplicationUI({ ...options, presentationAdapter: presentation });
      } catch (error) {
        activation[Symbol.dispose]();
        throw error;
      }
      let disposed = false;
      return {
        api: ui.api,
        features: ui.features,
        components: ui.components,
        renderRoot: () => ui.renderRoot(),
        captureHotState: () => ui.captureHotState(),
        updatePresentations: (presentations) => ui.updatePresentations(presentations),
        async dispose() {
          if (disposed) return;
          disposed = true;
          try {
            await ui.dispose();
          } finally {
            activation[Symbol.dispose]();
          }
        },
      };
    },
  };
  return { name: "web", component, presentation };
}
