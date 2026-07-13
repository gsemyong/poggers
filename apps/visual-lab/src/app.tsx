import type { AppDef as AppDefinition } from "@poggers/kit";
import { Show } from "@poggers/kit/ui";
import { createPress, mountDialog } from "@poggers/kit/web";
import { familyIcons } from "src/family-icons";
import { familyPreset, studioPreset } from "src/presets";
import type { App } from "src/types";

export default {
  version: 1,
  app: { name: "Family Drawer" },
  resources: {},
  components: {
    Drawer: {
      values: {
        dragOffset: 0,
        dragVelocity: 0,
        dragProgress: 0,
        sheetHeight: 1,
      },
      initial: "closed",
      on: {
        togglePreset: {
          perform({ appearance, setAppearance }) {
            setAppearance({
              preset: appearance.preset === "family" ? "studio" : "family",
              theme: "default",
            });
          },
        },
      },
      states: {
        closed: { on: { open: "open", toggle: "open" } },
        open: {
          type: "parallel",
          states: {
            view: {
              initial: "open.view.default",
              states: {
                default: {
                  on: {
                    showKey: "open.view.key",
                    showPhrase: "open.view.phrase",
                    showRemove: "open.view.remove",
                    close: "closing.default",
                    toggle: "closing.default",
                    releaseDragging: [
                      {
                        allow: ({ parameters }, release) =>
                          release.progress >= parameters.dismissDistance ||
                          release.velocity >= parameters.dismissVelocity,
                        target: "closing.default",
                      },
                      {},
                    ],
                  },
                },
                key: {
                  on: {
                    back: "open.view.default",
                    close: "closing.key",
                    toggle: "closing.key",
                    releaseDragging: [
                      {
                        allow: ({ parameters }, release) =>
                          release.progress >= parameters.dismissDistance ||
                          release.velocity >= parameters.dismissVelocity,
                        target: "closing.key",
                      },
                      {},
                    ],
                  },
                },
                phrase: {
                  on: {
                    back: "open.view.default",
                    close: "closing.phrase",
                    toggle: "closing.phrase",
                    releaseDragging: [
                      {
                        allow: ({ parameters }, release) =>
                          release.progress >= parameters.dismissDistance ||
                          release.velocity >= parameters.dismissVelocity,
                        target: "closing.phrase",
                      },
                      {},
                    ],
                  },
                },
                remove: {
                  on: {
                    back: "open.view.default",
                    close: "closing.remove",
                    toggle: "closing.remove",
                    releaseDragging: [
                      {
                        allow: ({ parameters }, release) =>
                          release.progress >= parameters.dismissDistance ||
                          release.velocity >= parameters.dismissVelocity,
                        target: "closing.remove",
                      },
                      {},
                    ],
                  },
                },
              },
            },
            gesture: {
              initial: "open.gesture.idle",
              states: {
                idle: { on: { startDragging: "open.gesture.dragging" } },
                dragging: {
                  on: {
                    releaseDragging: "open.gesture.idle",
                    cancelDragging: "open.gesture.idle",
                  },
                },
              },
            },
          },
        },
        closing: {
          initial: "closing.default",
          settle: { phase: "exit", done: "closed", cancelled: "open" },
          on: { open: "open", toggle: "open" },
          states: { default: {}, key: {}, phrase: {}, remove: {} },
        },
      },
      derive({ state, appearance }) {
        const defaultVisible =
          state.matches("open.view.default") || state.matches("closing.default");
        return {
          opened: state.matches("open"),
          dragging: state.matches("open.gesture.dragging"),
          dialog: state.matches("closed") ? false : state.matches("closing") ? "nonmodal" : "modal",
          presetSwitchLabel: appearance.preset === "family" ? "Studio" : "Family",
          defaultVisible,
          keyVisible: state.matches("open.view.key") || state.matches("closing.key"),
          phraseVisible: state.matches("open.view.phrase") || state.matches("closing.phrase"),
          removeVisible: state.matches("open.view.remove") || state.matches("closing.remove"),
        };
      },
      render({
        values,
        events,
        parts: {
          Root,
          Page,
          PresetSwitch,
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
        const measureSurface = (surface: HTMLElement) => {
          const measure = () => {
            values.sheetHeight = Math.max(1, surface.getBoundingClientRect().height);
          };
          const observer = new ResizeObserver(measure);
          observer.observe(surface);
          measure();
          return () => observer.disconnect();
        };

        return (
          <Root>
            <Page>
              <PresetSwitch type="button" {...createPress(events.togglePreset)}>
                {values.presetSwitchLabel}
              </PresetSwitch>
              <Trigger
                type="button"
                aria-controls="family-drawer"
                aria-haspopup="dialog"
                aria-expanded={values.dialog === "modal"}
                {...createPress(events.open)}
              >
                Try it out
              </Trigger>
            </Page>

            <Panel
              ref={(dialog) => mountDialog(dialog, () => values.dialog)}
              id="family-drawer"
              aria-label="Wallet options"
              onCancel={(event) => {
                event.preventDefault();
                events.close();
              }}
            >
              <Backdrop aria-hidden onPointerDown={events.close} />
              <Surface ref={measureSurface}>
                <Handle aria-hidden>
                  <HandleBar />
                </Handle>
                <Close
                  autofocus
                  type="button"
                  aria-label="Close drawer"
                  {...createPress(events.close)}
                >
                  <CloseIcon src={familyIcons.close} alt="" aria-hidden />
                </Close>

                <Viewport>
                  <Show when={values.defaultVisible}>
                    <DefaultView>
                      <DefaultHeader>
                        <DefaultTitle>Options</DefaultTitle>
                      </DefaultHeader>
                      <OptionList>
                        <OptionButton type="button" {...createPress(events.showKey)}>
                          <OptionIcon src={familyIcons.lock} alt="" aria-hidden />
                          View Private Key
                        </OptionButton>
                        <OptionButton type="button" {...createPress(events.showPhrase)}>
                          <OptionIcon src={familyIcons.phrase} alt="" aria-hidden />
                          View Recovery Phase
                        </OptionButton>
                        <DangerOption type="button" {...createPress(events.showRemove)}>
                          <OptionIcon src={familyIcons.warning} alt="" aria-hidden />
                          Remove Wallet
                        </DangerOption>
                      </OptionList>
                    </DefaultView>
                  </Show>

                  <Show when={values.keyVisible}>
                    <DetailView>
                      <DetailBody>
                        <ViewHeader>
                          <ViewIcon src={familyIcons.recovery} alt="" aria-hidden />
                          <ViewTitle>Private Key</ViewTitle>
                          <ViewDescription>
                            Your Private Key is the key used to back up your wallet. Keep it secret
                            and secure at all times.
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
                        <SecondaryButton type="button" {...createPress(events.back)}>
                          Cancel
                        </SecondaryButton>
                        <PrimaryButton type="button" {...createPress(events.back)}>
                          <PrimaryIcon src={familyIcons.faceId} alt="" aria-hidden />
                          Reveal
                        </PrimaryButton>
                      </Actions>
                    </DetailView>
                  </Show>

                  <Show when={values.phraseVisible}>
                    <DetailView>
                      <DetailBody>
                        <ViewHeader>
                          <ViewIcon src={familyIcons.recovery} alt="" aria-hidden />
                          <ViewTitle>Secret Recovery Phrase</ViewTitle>
                          <ViewDescription>
                            Your Secret Recovery Phrase is the key used to back up your wallet. Keep
                            it secret at all times.
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
                        <SecondaryButton type="button" {...createPress(events.back)}>
                          Cancel
                        </SecondaryButton>
                        <PrimaryButton type="button" {...createPress(events.back)}>
                          <PrimaryIcon src={familyIcons.faceId} alt="" aria-hidden />
                          Reveal
                        </PrimaryButton>
                      </Actions>
                    </DetailView>
                  </Show>

                  <Show when={values.removeVisible}>
                    <DetailView>
                      <DetailBody>
                        <ViewHeader>
                          <ViewIcon src={familyIcons.danger} alt="" aria-hidden />
                          <ViewTitle>Are you sure?</ViewTitle>
                          <ViewDescription>
                            You haven’t backed up your wallet yet. If you remove it, you could lose
                            access forever. We suggest tapping and backing up your wallet first with
                            a valid recovery method.
                          </ViewDescription>
                        </ViewHeader>
                      </DetailBody>
                      <DangerActions>
                        <SecondaryButton type="button" {...createPress(events.back)}>
                          Cancel
                        </SecondaryButton>
                        <DangerButton type="button" {...createPress(events.back)}>
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
  styles: {
    defaultPreset: "family",
    presets: { family: familyPreset, studio: studioPreset },
  },
  root: "Drawer",
} satisfies AppDefinition<App>;
