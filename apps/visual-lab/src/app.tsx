import type { Application, Feature, Program, WebMain } from "@poggers/kit";
import {
  For,
  Show,
  createPress,
  type DragRelease,
  type DragSample,
  mountDrag,
  mountDialog,
  type PresentationControl,
} from "@poggers/kit/ui";
import { family } from "src/presentations/family";
import { studio } from "src/presentations/studio";
import { mountThreeScene } from "src/three-scene";

const svg = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`;

const familyIcons = {
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

const collectionItems = Array.from({ length: 10_000 }, (_, index) => ({
  id: index,
  label: `Vault record ${String(index + 1).padStart(5, "0")}`,
}));
const collectionIds = collectionItems.map(({ id }) => id);
const streamFragments = [
  "A recovery key was encrypted on this device.",
  " The encrypted archive is being checked against the local vault.",
  " Verification completed without sending private material over the network.",
  " You can now continue from any trusted device.",
] as const;

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
              theme: "default" | "vivid";
              label: "Family" | "Family vivid" | "Studio";
            };
            Actions: { toggle(): void };
            Elements: { Root: "button" };
          };
          MorphingNotice: {
            State: { expanded: boolean; unread: number };
            Actions: { toggle(): void; increment(): void };
            Elements: {
              Root: "section";
              Toggle: "button";
              Symbol: "img";
              Copy: "span";
              Title: "strong";
              Body: "span";
              Badge: "span";
              Increment: "button";
            };
          };
          TextStream: {
            State: { running: boolean; step: number };
            Actions: { toggle(): void; advance(): void; reset(): void };
            Elements: {
              Root: "section";
              Controls: "div";
              Start: "button";
              Reset: "button";
              Text: "p";
            };
          };
          MaterialControl: {
            State: { level: 0 | 1 | 2; disabled: boolean };
            Actions: { activate(): void; toggleDisabled(): void };
            Elements: {
              Root: "section";
              Button: "button";
              Label: "span";
              Status: "span";
              Disable: "button";
            };
          };
          ScenePreview: {
            Elements: {
              Root: "section";
              Canvas: "canvas";
              Copy: "span";
              Toggle: "button";
            };
          };
          CollectionRecord: {
            Props: {
              item: { id: number; label: string };
              zone: "pinned" | "vault";
              index: number;
              selected: boolean;
              onSelect(input: { id: number }): void;
              onMove(input: { id: number; index: number; zone: "pinned" | "vault" }): void;
            };
            State: {
              dragging: boolean;
              targetIndex: number;
              targetZone: "pinned" | "vault";
              dragOffset: number;
            };
            Actions: {
              select(): void;
              move(input: { index: number }): void;
              startDrag(): void;
              previewDrag(input: { index: number; zone: "pinned" | "vault"; offset: number }): void;
              finishDrag(): void;
              cancelDrag(): void;
            };
            Elements: { Root: "button"; Grip: "span"; Label: "span" };
          };
          Drawer: {
            State: {
              open: boolean;
              view: "default" | "key" | "phrase" | "remove" | "collection";
              dragging: boolean;
              dragOffset: number;
              dragVelocity: number;
              dragProgress: number;
              sheetHeight: number;
              collectionIds: readonly number[];
              pinnedIds: readonly number[];
              activeRow: number;
            };
            Actions: {
              open(): void;
              close(): void;
              toggle(): void;
              back(): void;
              showKey(): void;
              showPhrase(): void;
              showRemove(): void;
              showCollection(): void;
              reverseCollection(): void;
              selectRow(input: { id: number }): void;
              moveRow(input: { id: number; index: number; zone: "pinned" | "vault" }): void;
              startDragging(): void;
              drag(sample: DragSample): void;
              releaseDragging(release: DragRelease): void;
              cancelDragging(): void;
              measure(height: number): void;
            };
            Elements: {
              Root: "main";
              Page: "section";
              LabTools: "div";
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
              KeyOptionIcon: "img";
              PhraseOptionIcon: "img";
              RemoveOptionIcon: "img";
              CollectionOptionIcon: "img";
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
              CollectionView: "section";
              CollectionToolbar: "div";
              PinnedList: "div";
              CollectionList: "div";
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
          state: { presentation: "family", theme: "default", label: "Family vivid" },
          actions: {
            toggle({ state, capabilities }) {
              if (state.presentation === "family" && state.theme === "default") {
                state.theme = "vivid";
                state.label = "Studio";
              } else if (state.presentation === "family") {
                state.presentation = "studio";
                state.theme = "default";
                state.label = "Family";
              } else {
                state.presentation = "family";
                state.theme = "default";
                state.label = "Family vivid";
              }
              capabilities.presentation.select({
                presentation: state.presentation,
                theme: state.theme,
              });
            },
          },
          view({ state, actions, elements: { Root } }) {
            return (
              <Root type="button" {...createPress(actions.toggle)}>
                {state.label}
              </Root>
            );
          },
        },
        MorphingNotice: {
          state: { expanded: false, unread: 3 },
          actions: {
            toggle({ state }) {
              state.expanded = !state.expanded;
            },
            increment({ state }) {
              state.unread += 1;
              state.expanded = true;
            },
          },
          view({
            state,
            actions,
            elements: { Root, Toggle, Symbol, Copy, Title, Body, Badge, Increment },
          }) {
            return (
              <Root aria-label="Notification fixture">
                <Toggle
                  type="button"
                  aria-expanded={state.expanded}
                  {...createPress(actions.toggle)}
                >
                  <Symbol alt="" aria-hidden />
                  <Copy>
                    <Title>Vault secured</Title>
                    <Show when={state.expanded}>
                      <Body>Recovery material is encrypted and available offline.</Body>
                    </Show>
                  </Copy>
                  <Badge aria-label={`${state.unread} unread`}>{state.unread}</Badge>
                </Toggle>
                <Increment type="button" {...createPress(actions.increment)}>
                  Add
                </Increment>
              </Root>
            );
          },
        },
        TextStream: {
          state: { running: false, step: 1 },
          actions: {
            toggle({ state }) {
              state.running = !state.running;
            },
            advance({ state }) {
              if (!state.running) return;
              if (state.step >= streamFragments.length) {
                state.running = false;
                return;
              }
              state.step += 1;
            },
            reset({ state }) {
              state.running = false;
              state.step = 1;
            },
          },
          start({ state, actions }) {
            const timer = setInterval(() => {
              if (state.running) actions.advance();
            }, 180);
            return { [Symbol.dispose]: () => clearInterval(timer) };
          },
          view({ state, actions, elements: { Root, Controls, Start, Reset, Text } }) {
            return (
              <Root aria-label="Streaming text fixture">
                <Controls>
                  <Start type="button" {...createPress(actions.toggle)}>
                    {state.running ? "Pause" : "Stream"}
                  </Start>
                  <Reset type="button" {...createPress(actions.reset)}>
                    Reset
                  </Reset>
                </Controls>
                <Text aria-live="polite">{streamFragments.slice(0, state.step).join("")}</Text>
              </Root>
            );
          },
        },
        MaterialControl: {
          state: { level: 0, disabled: false },
          actions: {
            activate({ state }) {
              if (state.disabled) return;
              state.level = ((state.level + 1) % 3) as 0 | 1 | 2;
            },
            toggleDisabled({ state }) {
              state.disabled = !state.disabled;
            },
          },
          view({ state, actions, elements: { Root, Button, Label, Status, Disable } }) {
            return (
              <Root aria-label="Material control fixture">
                <Button type="button" disabled={state.disabled} {...createPress(actions.activate)}>
                  <Label>Depth</Label>
                  <Status>{state.level + 1}</Status>
                </Button>
                <Disable type="button" {...createPress(actions.toggleDisabled)}>
                  {state.disabled ? "Enable" : "Disable"}
                </Disable>
              </Root>
            );
          },
        },
        ScenePreview: {
          start({ elements: { Canvas, Toggle } }) {
            const canvas = Canvas.element;
            const toggle = Toggle.element;
            if (!(canvas instanceof HTMLCanvasElement) || !(toggle instanceof HTMLButtonElement)) {
              return;
            }
            return mountThreeScene(canvas, toggle);
          },
          view({ elements: { Root, Canvas, Copy, Toggle } }) {
            return (
              <Root aria-label="Three-dimensional Presentation adapter fixture">
                <Canvas role="img" aria-label="Interactive glowing orb scene" tabindex={0} />
                <Copy>Three.js adapter</Copy>
                <Toggle type="button" aria-pressed="false">
                  Pulse scene
                </Toggle>
              </Root>
            );
          },
        },
        CollectionRecord: {
          state: ({ props }) => ({
            dragging: false,
            targetIndex: props.index,
            targetZone: props.zone,
            dragOffset: 0,
          }),
          actions: {
            select({ props }) {
              props.onSelect({ id: props.item.id });
            },
            move({ props }, { index }) {
              props.onMove({ id: props.item.id, index, zone: props.zone });
            },
            startDrag({ props, state }) {
              state.dragging = true;
              state.targetIndex = props.index;
              state.targetZone = props.zone;
              state.dragOffset = 0;
            },
            previewDrag({ state }, { index, zone, offset }) {
              state.dragging = true;
              state.targetIndex = index;
              state.targetZone = zone;
              state.dragOffset = offset;
            },
            finishDrag({ props, state }) {
              if (!state.dragging) return;
              state.dragging = false;
              state.dragOffset = 0;
              props.onSelect({ id: props.item.id });
              props.onMove({
                id: props.item.id,
                index: state.targetIndex,
                zone: state.targetZone,
              });
            },
            cancelDrag({ state }) {
              state.dragging = false;
              state.dragOffset = 0;
            },
          },
          start({ actions, elements: { Root } }) {
            const row = Root.element;
            if (!(row instanceof HTMLElement)) return;
            const list = row.closest('[role="listbox"]');
            if (!(list instanceof HTMLElement)) return;
            let dragOrigin = 0;
            const drag = mountDrag(row, {
              axis: "block",
              bounds: () => ({ block: [-540, 540] }),
              threshold: 3,
              maxVelocity: 3,
              resistance: 1,
              cursor: { idle: "grab", active: "grabbing" },
              start() {
                const bounds = row.getBoundingClientRect();
                dragOrigin = bounds.top + bounds.height / 2;
                actions.startDrag();
              },
              change(sample) {
                const projectedCenter = dragOrigin + sample.block;
                const zones = [
                  ...row.ownerDocument.querySelectorAll<HTMLElement>("[data-drop-zone]"),
                ];
                const targetZone =
                  zones.find((zone) => {
                    const bounds = zone.getBoundingClientRect();
                    return projectedCenter >= bounds.top && projectedCenter <= bounds.bottom;
                  }) ?? list;
                const zone =
                  targetZone.dataset.dropZone === "pinned"
                    ? ("pinned" as const)
                    : ("vault" as const);
                const zoneBounds = targetZone.getBoundingClientRect();
                const index = Math.max(
                  0,
                  Math.floor((projectedCenter - zoneBounds.top + targetZone.scrollTop) / 54),
                );
                const listBounds = list.getBoundingClientRect();
                const rowBounds = row.getBoundingClientRect();
                const projected = rowBounds.top + sample.deltaBlock;
                const edge = 48;
                if (projected < listBounds.top + edge) {
                  list.scrollBy({ top: -8, behavior: "instant" });
                } else if (projected + rowBounds.height > listBounds.bottom - edge) {
                  list.scrollBy({ top: 8, behavior: "instant" });
                }
                actions.previewDrag({ index, zone, offset: sample.block });
              },
              release: actions.finishDrag,
              cancel: actions.cancelDrag,
            });
            return drag;
          },
          view({ props, state, actions, elements: { Root, Grip, Label } }) {
            return (
              <Root
                type="button"
                role="option"
                aria-selected={props.selected}
                aria-grabbed={state.dragging}
                onClick={(event) => {
                  if (event.detail === 0) actions.select();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  actions.move({ index: props.index + (event.key === "ArrowDown" ? 1 : -1) });
                }}
              >
                <Grip aria-hidden>::</Grip>
                <Label>{props.item.label}</Label>
              </Root>
            );
          },
        },
        Drawer: {
          state: {
            open: false,
            view: "default",
            dragging: false,
            dragOffset: 0,
            dragVelocity: 0,
            dragProgress: 0,
            sheetHeight: 1,
            collectionIds,
            pinnedIds: [],
            activeRow: 0,
          },
          actions: {
            open({ state }) {
              if (state.open) return;
              state.open = true;
              state.view = "default";
              state.dragging = false;
              state.dragOffset = 0;
              state.dragVelocity = 0;
              state.dragProgress = 0;
            },
            close({ state }) {
              if (!state.open) return;
              state.dragging = false;
              state.open = false;
            },
            toggle({ state }) {
              if (!state.open) {
                state.open = true;
                state.view = "default";
                state.dragOffset = 0;
                state.dragVelocity = 0;
                state.dragProgress = 0;
              } else {
                state.dragging = false;
                state.open = false;
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
            showCollection({ state }) {
              state.view = "collection";
            },
            reverseCollection({ state }) {
              state.collectionIds = [...state.collectionIds].reverse();
            },
            selectRow({ state }, input) {
              state.activeRow = input.id;
            },
            moveRow({ state }, input) {
              const vault = state.collectionIds.filter((id) => id !== input.id);
              const pinned = state.pinnedIds.filter((id) => id !== input.id);
              const target = input.zone === "pinned" ? pinned : vault;
              target.splice(Math.min(target.length, Math.max(0, input.index)), 0, input.id);
              state.collectionIds = vault;
              state.pinnedIds = pinned;
              state.activeRow = input.id;
            },
            startDragging({ state }) {
              state.dragging = true;
            },
            drag({ state }, sample) {
              state.dragOffset = sample.block;
              state.dragVelocity = sample.velocityBlock;
              state.dragProgress = sample.progressBlock;
            },
            releaseDragging({ state }, release) {
              state.dragging = false;
              state.dragVelocity = release.velocity;
              if (release.progress >= 0.28 || release.velocity >= 0.5) {
                state.open = false;
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
          },
          start({ state, actions, elements: { Panel, Handle, Surface, Viewport } }) {
            const panel = Panel.element;
            const handle = Handle.element;
            const surface = Surface.element;
            const viewport = Viewport.element;
            if (
              !(panel instanceof HTMLDialogElement) ||
              !(handle instanceof HTMLElement) ||
              !(surface instanceof HTMLElement) ||
              !(viewport instanceof HTMLElement)
            ) {
              return;
            }
            let sheetHeight = Math.max(1, surface.scrollHeight);
            let measureFrame: number | undefined;
            const measure = () => {
              sheetHeight = Math.max(1, surface.scrollHeight);
              actions.measure(sheetHeight);
            };
            const observer = new ResizeObserver(() => {
              if (measureFrame !== undefined) return;
              measureFrame = requestAnimationFrame(() => {
                measureFrame = undefined;
                measure();
              });
            });
            observer.observe(viewport);
            measure();
            mountDialog(panel, () => (state.open ? "modal" : false));
            const drag = mountDrag(handle, {
              axis: "block",
              bounds: () => ({ block: [0, sheetHeight] }),
              threshold: 3,
              maxVelocity: 3,
              resistance: 1,
              cursor: { idle: "grab", active: "grabbing" },
              start: actions.startDragging,
              change: actions.drag,
              release: actions.releaseDragging,
              cancel: actions.cancelDragging,
            });
            return {
              [Symbol.dispose]() {
                observer.disconnect();
                if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
                drag[Symbol.dispose]();
              },
            };
          },
          view({
            state,
            actions,
            components: {
              CollectionRecord,
              MaterialControl,
              MorphingNotice,
              PresentationSwitch,
              ScenePreview,
              TextStream,
            },
            elements: {
              Root,
              Page,
              LabTools,
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
              KeyOptionIcon,
              PhraseOptionIcon,
              RemoveOptionIcon,
              CollectionOptionIcon,
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
              CollectionView,
              CollectionToolbar,
              PinnedList,
              CollectionList,
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
                    aria-expanded={state.open}
                    {...createPress(actions.open)}
                  >
                    Try it out
                  </Trigger>
                  <LabTools>
                    <MorphingNotice />
                    <TextStream />
                    <MaterialControl />
                    <ScenePreview />
                  </LabTools>
                </Page>

                <Panel
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
                      <CloseIcon alt="" aria-hidden />
                    </Close>

                    <Viewport>
                      <Show when={state.view === "default"}>
                        <DefaultView>
                          <DefaultHeader>
                            <DefaultTitle>Options</DefaultTitle>
                          </DefaultHeader>
                          <OptionList>
                            <OptionButton type="button" {...createPress(actions.showKey)}>
                              <KeyOptionIcon alt="" aria-hidden />
                              View Private Key
                            </OptionButton>
                            <OptionButton type="button" {...createPress(actions.showPhrase)}>
                              <PhraseOptionIcon alt="" aria-hidden />
                              View Recovery Phrase
                            </OptionButton>
                            <DangerOption type="button" {...createPress(actions.showRemove)}>
                              <RemoveOptionIcon alt="" aria-hidden />
                              Remove Wallet
                            </DangerOption>
                            <OptionButton type="button" {...createPress(actions.showCollection)}>
                              <CollectionOptionIcon alt="" aria-hidden />
                              Inspect 10,000 records
                            </OptionButton>
                          </OptionList>
                        </DefaultView>
                      </Show>

                      <Show when={state.view === "key"}>
                        <DetailView>
                          <DetailBody>
                            <ViewHeader>
                              <ViewIcon alt="" aria-hidden />
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
                              <ViewIcon alt="" aria-hidden />
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
                              <ViewIcon alt="" aria-hidden />
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

                      <Show when={state.view === "collection"}>
                        <CollectionView>
                          <CollectionToolbar>
                            <ViewTitle>Vault records</ViewTitle>
                            <PrimaryButton
                              type="button"
                              {...createPress(actions.reverseCollection)}
                            >
                              Reverse order
                            </PrimaryButton>
                          </CollectionToolbar>
                          <PinnedList
                            role="listbox"
                            aria-label="Pinned vault records"
                            data-drop-zone="pinned"
                          >
                            <For
                              each={state.pinnedIds.map((id) => collectionItems[id]!)}
                              by="id"
                              fallback="Drag a record here to pin it"
                            >
                              {(item) => (
                                <CollectionRecord
                                  item={item}
                                  zone="pinned"
                                  index={state.pinnedIds.indexOf(item.id)}
                                  selected={state.activeRow === item.id}
                                  onSelect={actions.selectRow}
                                  onMove={actions.moveRow}
                                />
                              )}
                            </For>
                          </PinnedList>
                          <CollectionList
                            role="listbox"
                            aria-label="Vault records"
                            data-drop-zone="vault"
                          >
                            <For
                              each={state.collectionIds.map((id) => collectionItems[id]!)}
                              by="id"
                              virtual={{ anchor: "start" }}
                              active={state.activeRow}
                            >
                              {(item) => (
                                <CollectionRecord
                                  item={item}
                                  zone="vault"
                                  index={state.collectionIds.indexOf(item.id)}
                                  selected={state.activeRow === item.id}
                                  onSelect={actions.selectRow}
                                  onMove={actions.moveRow}
                                />
                              )}
                            </For>
                          </CollectionList>
                          <SecondaryButton type="button" {...createPress(actions.back)}>
                            Done
                          </SecondaryButton>
                        </CollectionView>
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
  presentations: { family, studio },
} satisfies Application<App>;
