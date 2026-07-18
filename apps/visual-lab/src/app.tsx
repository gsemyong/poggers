import type { Application, Feature, Program, WebMain } from "@poggers/kit";
import {
  Show,
  createPress,
  type DragRelease,
  type DragSample,
  mountDialog,
  type PresentationControl,
  type VisualValue,
} from "@poggers/kit/ui";
import { familyPresentation } from "src/presentations/family";
import { studioPresentation } from "src/presentations/studio";

const svg = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`;

const familyIcons = {
  close: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10.4854 2 2 10.4853M10.4854 10.4844 2 1.9991" stroke="#999" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ),
  lock: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none"><path d="M6 9V6a4 4 0 0 1 8 0v3" stroke="#8f8f8f" stroke-width="2.333"/><path d="M6.684 9h6.632V7H6.684V9ZM16 11.684v4.632h2v-4.632h-2ZM13.316 19H6.684v2h6.632v-2ZM4 16.316v-4.632H2v4.632h2ZM6.684 19A2.684 2.684 0 0 1 4 16.316H2A4.684 4.684 0 0 0 6.684 21v-2ZM16 16.316A2.684 2.684 0 0 1 13.316 19v2A4.684 4.684 0 0 0 18 16.316h-2ZM13.316 9A2.684 2.684 0 0 1 16 11.684h2A4.684 4.684 0 0 0 13.316 7v2ZM6.684 7A4.684 4.684 0 0 0 2 11.684h2A2.684 2.684 0 0 1 6.684 9V7Z" fill="#8f8f8f"/></svg>`,
  ),
  phrase: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="20" viewBox="0 0 24 20" fill="none"><path d="M2.862 14.805A136 136 0 0 1 2.75 10c0-1.438.054-3.261.112-4.805A2.434 2.434 0 0 1 5.191 2.886 215 215 0 0 1 12 2.75c2.06 0 4.742.07 6.81.136a2.434 2.434 0 0 1 2.328 2.309c.058 1.544.112 3.367.112 4.805s-.054 3.261-.112 4.805a2.434 2.434 0 0 1-2.329 2.309A215 215 0 0 1 12 17.25c-2.06 0-4.742-.07-6.809-.136a2.434 2.434 0 0 1-2.329-2.309Z" stroke="#8f8f8f" stroke-width="2"/><path d="M5.5 5.122h5.85v1.95H5.5zm0 3.901h5.85v1.95H5.5zm0 3.902h5.85v1.95H5.5zm7.151-7.803h5.85v1.95h-5.85zm0 3.901h5.85v1.95h-5.85zm0 3.902h5.85v1.95h-5.85z" fill="#8f8f8f"/></svg>`,
  ),
  warning: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="21" height="20" viewBox="0 0 21 20" fill="none"><path d="m11.632 11.251.251-3.754a1.053 1.053 0 0 0-2.1 0l.25 3.754a.802.802 0 0 0 1.599 0Z" fill="#ff3f3f"/><circle cx="10.833" cy="14.062" r=".938" fill="#ff3f3f"/><path d="M8.711 3.096a2.56 2.56 0 0 1 4.244 0c1.204 1.783 2.669 4.003 3.69 5.716.961 1.61 2.032 3.614 2.908 5.306.863 1.667-.292 3.638-2.168 3.715-2.069.085-4.577.166-6.552.166-1.976 0-4.484-.081-6.553-.166-1.876-.077-3.03-2.048-2.168-3.715.876-1.692 1.948-3.696 2.908-5.306 1.022-1.713 2.487-3.933 3.691-5.716Z" stroke="#ff3f3f" stroke-width="2"/></svg>`,
  ),
  recovery: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M16.452 37c-1.424-.023-2.86-.051-4.234-.082-3.048-.067-4.573-.101-5.802-.729a6 6 0 0 1-2.627-2.623c-.63-1.229-.666-2.729-.737-5.728A162 162 0 0 1 3 24.026c0-1.163.021-2.479.052-3.812.071-3 .107-4.5.737-5.728a6 6 0 0 1 2.627-2.623c1.23-.628 2.754-.662 5.802-.73C15.484 11.061 19.105 11 22.057 11c3.636 0 8.288.092 12.04.185.957.024 1.435.036 1.873.112a6 6 0 0 1 4.908 4.876c.078.438.093.905.122 1.84v.579M10 24h9m-9 6h6" stroke="#999" stroke-width="2.75" stroke-linecap="round"/><path d="M36.861 32.124a3.9 3.9 0 0 1-3.914 3.88 3.9 3.9 0 0 1-3.913-3.88 3.9 3.9 0 0 1 3.913-3.88 3.9 3.9 0 0 1 3.914 3.88Z" stroke="#999" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M21.009 33.464a3.3 3.3 0 0 1 0-2.68c2.024-4.543 6.608-7.713 11.939-7.713s9.915 3.17 11.939 7.713a3.3 3.3 0 0 1 0 2.68c-2.024 4.543-6.608 7.713-11.939 7.713s-9.915-3.17-11.939-7.713Z" stroke="#999" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ),
  danger: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="22" cy="24" r="19" stroke="#ff3f3f" stroke-width="2.75"/><path d="m23.55 26.501.383-11.502a1.934 1.934 0 0 0-3.866 0l.383 11.502a1.55 1.55 0 0 0 3.1 0Z" fill="#ff3f3f"/><circle cx="21.987" cy="33.299" r="1.987" fill="#ff3f3f"/></svg>`,
  ),
  shield: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3.087 6.412a.946.946 0 0 1 .899-.819c2.805-.205 5.021-1.29 7.075-2.994a1.08 1.08 0 0 1 1.378 0c2.053 1.704 4.269 2.79 7.075 2.994a.946.946 0 0 1 .899.819c.057.523.087 1.054.087 1.592 0 5.946-3.032 11.04-8.078 13.178a1.73 1.73 0 0 1-1.345 0C6.031 19.044 3 13.95 3 8.004c0-.538.029-1.069.087-1.592Z" stroke="#a5a5a5" stroke-width="2"/><path d="m8.491 11.73 2.337 2.306 4.674-4.613" stroke="#a5a5a5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ),
  pass: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="1.75" y="3.75" width="20.5" height="16.5" rx="3.4" stroke="#a5a5a5" stroke-width="2"/><path d="M5.5 7.122h5.85v1.95H5.5zm0 3.901h5.85v1.95H5.5zm0 3.902h5.85v1.95H5.5zm7.15-7.803h5.85v1.95h-5.85zm0 3.901h5.85v1.95h-5.85zm0 3.902h5.85v1.95h-5.85z" fill="#a5a5a5"/></svg>`,
  ),
  banned: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#a5a5a5" stroke-width="2.2"/><path d="m5.636 5.636 12.728 12.728" stroke="#a5a5a5" stroke-width="2.2"/></svg>`,
  ),
  faceId: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="19" viewBox="0 0 20 19" fill="none"><path d="M1.664 6.444c-.659 0-1.03-.371-1.03-1.048V3.16C.634 1.12 1.729.043 3.779.043h2.236c.677 0 1.048.362 1.048 1.03s-.371 1.039-1.048 1.039h-2.06c-.816 0-1.252.408-1.252 1.262v2.022c0 .677-.362 1.048-1.039 1.048Zm16.486 0c-.668 0-1.039-.371-1.039-1.048V3.374c0-.854-.445-1.262-1.253-1.262H13.8c-.678 0-1.049-.371-1.049-1.039S13.121.043 13.8.043h2.235c2.06 0 3.145 1.085 3.145 3.117v2.236c0 .677-.362 1.048-1.03 1.048ZM9.17 10.87c-.492 0-.798-.26-.798-.696 0-.371.287-.65.668-.65h.26c.074 0 .12-.046.12-.13V6.472c0-.399.27-.668.677-.668.4 0 .659.269.659.668v2.895c0 .965-.529 1.503-1.503 1.503H9.17Zm-2.71-2.171c-.464 0-.807-.334-.807-.807V6.63c0-.473.343-.816.807-.816.473 0 .807.343.807.816v1.262c0 .473-.334.807-.807.807Zm6.875 0c-.473 0-.817-.334-.817-.807V6.63c0-.473.344-.816.817-.816.464 0 .797.343.797.816v1.262c0 .473-.333.807-.797.807Zm-3.47 5.186c-1.178 0-2.356-.464-3.09-1.308a.75.75 0 0 1-.185-.482c0-.381.288-.669.668-.669.232 0 .371.112.538.27.52.528 1.308.862 2.069.862.789 0 1.577-.352 2.069-.853.185-.205.325-.279.52-.279.38 0 .677.288.677.669 0 .204-.065.37-.186.491-.816.817-1.957 1.28-3.08 1.28ZM3.779 18.589c-2.05 0-3.145-1.086-3.145-3.117v-2.246c0-.668.362-1.039 1.03-1.039s1.039.371 1.039 1.039v2.032c0 .853.436 1.261 1.252 1.261h2.06c.677 0 1.048.371 1.048 1.03 0 .668-.371 1.04-1.048 1.04H3.779Zm10.02 0c-.678 0-1.049-.372-1.049-1.04 0-.659.371-1.03 1.049-1.03h2.059c.808 0 1.253-.408 1.253-1.261v-2.032c0-.668.37-1.039 1.039-1.039.658 0 1.03.371 1.03 1.039v2.246c0 2.031-1.086 3.117-3.145 3.117H13.8Z" fill="#fff"/></svg>`,
  ),
} as const;

export type App = {
  Features: { visual: VisualFeature };
  Presentations: "family" | "studio";
};

type VisualFeature = {
  Programs: {
    browser: Program<
      WebMain,
      {
        Requires: { presentation: PresentationControl<App> };
        Components: {
          PresentationSwitch: {
            State: {
              presentation: "family" | "studio";
              label: "Family" | "Studio";
            };
            Actions: { toggle(): void };
            Parts: { Root: "button" };
          };
          Drawer: {
            State: {
              phase: "closed" | "opening" | "open" | "closing";
              view: "default" | "key" | "phrase" | "remove";
              dragging: boolean;
              dragOffset: VisualValue<"length">;
              dragVelocity: number;
              dragProgress: VisualValue<"progress">;
              sheetHeight: VisualValue<"size">;
            };
            Actions: {
              open(): void;
              close(): void;
              toggle(): void;
              back(): void;
              showKey(): void;
              showPhrase(): void;
              showRemove(): void;
              startDragging(): void;
              drag(sample: DragSample): void;
              releaseDragging(release: DragRelease): void;
              cancelDragging(): void;
              measure(height: number): void;
              finishOpening(): void;
              finishClosing(): void;
            };
            Parameters: {
              dismissDistance: number;
              dismissVelocity: number;
            };
            Parts: {
              Root: "main";
              Page: "section";
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
      }
    >;
  };
};

const visualFeature = {
  programs: {
    browser: {
      components: {
        PresentationSwitch: {
          state: ({ presentation }) => ({
            presentation: presentation.presentation,
            label: presentation.presentation === "family" ? "Studio" : "Family",
          }),
          actions: {
            toggle({ state, capabilities }) {
              const presentation = state.presentation === "family" ? "studio" : "family";
              state.presentation = presentation;
              state.label = presentation === "family" ? "Studio" : "Family";
              capabilities.presentation.select({ presentation, theme: "default" });
            },
          },
          view({ state, actions, parts: { Root } }) {
            return (
              <Root type="button" {...createPress(actions.toggle)}>
                {state.label}
              </Root>
            );
          },
        },
        Drawer: {
          state: {
            phase: "closed",
            view: "default",
            dragging: false,
            dragOffset: 0,
            dragVelocity: 0,
            dragProgress: 0,
            sheetHeight: 1,
          },
          actions: {
            open({ state }) {
              if (state.phase === "open" || state.phase === "opening") return;
              state.phase = "opening";
              state.view = "default";
            },
            close({ state }) {
              if (state.phase === "closed" || state.phase === "closing") return;
              state.dragging = false;
              state.phase = "closing";
            },
            toggle({ state }) {
              if (state.phase === "closed" || state.phase === "closing") {
                state.phase = "opening";
                state.view = "default";
              } else {
                state.dragging = false;
                state.phase = "closing";
              }
            },
            back({ state }) {
              state.view = "default";
            },
            showKey({ state }) {
              state.view = "key";
            },
            showPhrase({ state }) {
              state.view = "phrase";
            },
            showRemove({ state }) {
              state.view = "remove";
            },
            startDragging({ state }) {
              state.dragging = true;
            },
            drag({ state }, sample) {
              state.dragOffset = sample.block;
              state.dragVelocity = sample.velocityBlock;
              state.dragProgress = sample.progressBlock;
            },
            releaseDragging({ state, parameters }, release) {
              state.dragging = false;
              state.dragVelocity = release.velocity;
              if (
                release.progress >= parameters.dismissDistance ||
                release.velocity >= parameters.dismissVelocity
              ) {
                state.phase = "closing";
              } else {
                state.dragOffset = 0;
                state.dragProgress = 0;
              }
            },
            cancelDragging({ state }) {
              state.dragging = false;
              state.dragOffset = 0;
              state.dragVelocity = 0;
              state.dragProgress = 0;
            },
            measure({ state }, height) {
              state.sheetHeight = Math.max(1, height);
            },
            finishOpening({ state }) {
              if (state.phase === "opening") state.phase = "open";
            },
            finishClosing({ state }) {
              if (state.phase !== "closing") return;
              state.phase = "closed";
              state.dragging = false;
              state.dragOffset = 0;
              state.dragVelocity = 0;
              state.dragProgress = 0;
            },
          },
          start({ actions, parts: { Surface, Viewport } }) {
            const surface = Surface.element;
            const viewport = Viewport.element;
            if (!(surface instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return;
            const measure = () => actions.measure(surface.scrollHeight);
            const observer = new ResizeObserver(measure);
            observer.observe(viewport);
            measure();
            return { [Symbol.dispose]: () => observer.disconnect() };
          },
          view({
            state,
            actions,
            components: { PresentationSwitch },
            parts: {
              Root,
              Page,
              Trigger,
              Panel,
              Backdrop,
              Surface,
              Handle,
              HandleBar,
              Close,
              CloseIcon,
              Viewport,
              DefaultView,
              DefaultHeader,
              DefaultTitle,
              OptionList,
              OptionButton,
              DangerOption,
              OptionIcon,
              DetailView,
              DetailBody,
              ViewHeader,
              ViewIcon,
              ViewTitle,
              ViewDescription,
              AdviceList,
              AdviceItem,
              AdviceIcon,
              Actions,
              DangerActions,
              SecondaryButton,
              PrimaryButton,
              DangerButton,
              PrimaryIcon,
            },
          }) {
            return (
              <Root>
                <Page>
                  <PresentationSwitch />
                  <Trigger
                    type="button"
                    aria-controls="family-drawer"
                    aria-haspopup="dialog"
                    aria-expanded={state.phase === "open" || state.phase === "opening"}
                    {...createPress(actions.open)}
                  >
                    Try it out
                  </Trigger>
                </Page>

                <Panel
                  ref={(dialog) =>
                    mountDialog(dialog, () =>
                      state.phase === "closed"
                        ? false
                        : state.phase === "closing"
                          ? "nonmodal"
                          : "modal",
                    )
                  }
                  id="family-drawer"
                  aria-label="Wallet options"
                  onCancel={(event) => {
                    event.preventDefault();
                    actions.close();
                  }}
                >
                  <Backdrop aria-hidden onPointerDown={actions.close} />
                  <Surface>
                    <Handle aria-hidden>
                      <HandleBar />
                    </Handle>
                    <Close
                      autofocus
                      type="button"
                      aria-label="Close drawer"
                      {...createPress(actions.close)}
                    >
                      <CloseIcon src={familyIcons.close} alt="" aria-hidden />
                    </Close>

                    <Viewport>
                      <Show when={state.view === "default"}>
                        <DefaultView>
                          <DefaultHeader>
                            <DefaultTitle>Options</DefaultTitle>
                          </DefaultHeader>
                          <OptionList>
                            <OptionButton type="button" {...createPress(actions.showKey)}>
                              <OptionIcon src={familyIcons.lock} alt="" aria-hidden />
                              View Private Key
                            </OptionButton>
                            <OptionButton type="button" {...createPress(actions.showPhrase)}>
                              <OptionIcon src={familyIcons.phrase} alt="" aria-hidden />
                              View Recovery Phrase
                            </OptionButton>
                            <DangerOption type="button" {...createPress(actions.showRemove)}>
                              <OptionIcon src={familyIcons.warning} alt="" aria-hidden />
                              Remove Wallet
                            </DangerOption>
                          </OptionList>
                        </DefaultView>
                      </Show>

                      <Show when={state.view === "key"}>
                        <DetailView>
                          <DetailBody>
                            <ViewHeader>
                              <ViewIcon src={familyIcons.recovery} alt="" aria-hidden />
                              <ViewTitle>Private Key</ViewTitle>
                              <ViewDescription>
                                Your Private Key is the key used to back up your wallet. Keep it
                                secret and secure at all times.
                              </ViewDescription>
                            </ViewHeader>
                            <AdviceList>
                              <AdviceItem>
                                <AdviceIcon src={familyIcons.shield} alt="" aria-hidden />
                                Keep your private key safe
                              </AdviceItem>
                              <AdviceItem>
                                <AdviceIcon src={familyIcons.pass} alt="" aria-hidden />
                                Don’t share it with anyone else
                              </AdviceItem>
                              <AdviceItem>
                                <AdviceIcon src={familyIcons.banned} alt="" aria-hidden />
                                If you lose it, we can’t recover it
                              </AdviceItem>
                            </AdviceList>
                          </DetailBody>
                          <Actions>
                            <SecondaryButton type="button" {...createPress(actions.back)}>
                              Cancel
                            </SecondaryButton>
                            <PrimaryButton type="button" {...createPress(actions.back)}>
                              <PrimaryIcon src={familyIcons.faceId} alt="" aria-hidden />
                              Reveal
                            </PrimaryButton>
                          </Actions>
                        </DetailView>
                      </Show>

                      <Show when={state.view === "phrase"}>
                        <DetailView>
                          <DetailBody>
                            <ViewHeader>
                              <ViewIcon src={familyIcons.recovery} alt="" aria-hidden />
                              <ViewTitle>Secret Recovery Phrase</ViewTitle>
                              <ViewDescription>
                                Your Secret Recovery Phrase is the key used to back up your wallet.
                                Keep it secret at all times.
                              </ViewDescription>
                            </ViewHeader>
                            <AdviceList>
                              <AdviceItem>
                                <AdviceIcon src={familyIcons.shield} alt="" aria-hidden />
                                Keep your Secret Phrase safe
                              </AdviceItem>
                              <AdviceItem>
                                <AdviceIcon src={familyIcons.pass} alt="" aria-hidden />
                                Don’t share it with anyone else
                              </AdviceItem>
                              <AdviceItem>
                                <AdviceIcon src={familyIcons.banned} alt="" aria-hidden />
                                If you lose it, we can’t recover it
                              </AdviceItem>
                            </AdviceList>
                          </DetailBody>
                          <Actions>
                            <SecondaryButton type="button" {...createPress(actions.back)}>
                              Cancel
                            </SecondaryButton>
                            <PrimaryButton type="button" {...createPress(actions.back)}>
                              <PrimaryIcon src={familyIcons.faceId} alt="" aria-hidden />
                              Reveal
                            </PrimaryButton>
                          </Actions>
                        </DetailView>
                      </Show>

                      <Show when={state.view === "remove"}>
                        <DetailView>
                          <DetailBody>
                            <ViewHeader>
                              <ViewIcon src={familyIcons.danger} alt="" aria-hidden />
                              <ViewTitle>Are you sure?</ViewTitle>
                              <ViewDescription>
                                You haven’t backed up your wallet yet. If you remove it, you could
                                lose access forever. We suggest tapping and backing up your wallet
                                first with a valid recovery method.
                              </ViewDescription>
                            </ViewHeader>
                          </DetailBody>
                          <DangerActions>
                            <SecondaryButton type="button" {...createPress(actions.back)}>
                              Cancel
                            </SecondaryButton>
                            <DangerButton type="button" {...createPress(actions.back)}>
                              Continue
                            </DangerButton>
                          </DangerActions>
                        </DetailView>
                      </Show>
                    </Viewport>
                  </Surface>
                </Panel>
              </Root>
            );
          },
        },
      },
      root: "Drawer",
    },
  },
} satisfies Feature<VisualFeature>;

export default {
  metadata: { name: "Family Drawer" },
  features: { visual: visualFeature },
  presentations: { family: familyPresentation, studio: studioPresentation },
} satisfies Application<App>;
