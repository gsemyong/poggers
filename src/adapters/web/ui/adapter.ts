import { createApplicationUI, type WebComponentAdapter } from "@/adapters/web/ui/component/adapter";
import { jsx as webJSX } from "@/adapters/web/ui/component/runtime";
import type { WebPresentationAdapter } from "@/adapters/web/ui/presentation/adapter";
import { webUIRuntime } from "@/adapters/web/ui/runtime";
import type { UIAdapter } from "@/contracts/platform";
import { activateJSXRenderer } from "@/jsx/runtime";
import type { WebUI } from "@/platforms/web/platform";
import type { WebPresentationEnvironment } from "@/platforms/web/presentation";
import { activateWebUIRuntime } from "@/platforms/web/ui";

export { HotUpdateCoordinator } from "@/runtime/interpreter";
export { render } from "@/adapters/web/ui/component/runtime";

const renderWebIntrinsic = (type: string, props: Readonly<Record<string, unknown>>) =>
  webJSX(type, props as Parameters<typeof webJSX>[1]);

export type WebUIAdapter = UIAdapter<WebUI, WebComponentAdapter, WebPresentationAdapter>;

/** Creates the paired web structure and Presentation implementation. */
export function createWebUIAdapter(
  presentation: WebPresentationAdapter = emptyWebPresentationAdapter,
): WebUIAdapter {
  const component: WebComponentAdapter = {
    async createApplicationUI(options) {
      const activation = activateJSXRenderer(renderWebIntrinsic, "web");
      const runtime = activateWebUIRuntime(webUIRuntime);
      let ui;
      try {
        ui = await createApplicationUI({ ...options, presentationAdapter: presentation });
      } catch (error) {
        runtime[Symbol.dispose]();
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
            runtime[Symbol.dispose]();
            activation[Symbol.dispose]();
          }
        },
      };
    },
  };
  return { name: "web", component, presentation };
}

const emptyWebPresentationEnvironment: WebPresentationEnvironment = Object.freeze({
  viewport: Object.freeze({ inlineSize: 0, blockSize: 0, scale: 1 }),
  safeArea: Object.freeze({ blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 }),
  preferences: Object.freeze({
    reducedMotion: false,
    contrast: "normal",
    colorScheme: "light",
  }),
  input: Object.freeze({ hover: false, pointer: "none" }),
});

const emptyWebPresentationAdapter: WebPresentationAdapter = {
  mount() {
    return {
      environment: emptyWebPresentationEnvironment,
      create() {
        return {
          render() {},
          reconfigure() {},
          dispose() {},
          inspect() {
            throw new Error("An application without a Presentation has no frame to inspect.");
          },
          snapshot() {
            return Object.freeze({ channels: Object.freeze([]) });
          },
        };
      },
      snapshot() {},
      dispose() {},
    };
  },
};
