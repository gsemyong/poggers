import type { Feature, Program } from "@poggers/kit";
import { createPress, mountDialog, mountDrag, type BrowserMainThread } from "@poggers/kit/web";

export type DashboardFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        State: {
          compact: boolean;
          warm: boolean;
          sheetOpen: boolean;
          sheetView: "summary" | "detail";
          sheetDragging: boolean;
          sheetOffset: number;
          sheetVelocity: number;
        };
        Actions: {
          toggleDensity(): void;
          toggleAccent(): void;
          openSheet(): void;
          closeSheet(): void;
          toggleSheetView(): void;
          beginSheetDrag(): void;
          updateSheetDrag(input: { offset: number; velocity: number }): void;
          releaseSheet(input: { offset: number; velocity: number }): void;
          cancelSheetDrag(): void;
        };
        Components: {
          Application: {
            Elements: {
              Root: "main";
              Header: "header";
              Kicker: "p";
              Title: "h1";
              Summary: "p";
              Toolbar: "div";
              Density: "button";
              Accent: "button";
              AccentIcon: "img";
              AccentMode: "output";
              OpenSheet: "button";
              Sheet: "dialog";
              SheetPanel: "section";
              SheetHandle: "button";
              SheetTitle: "h2";
              SheetBody: "p";
              SheetSwitch: "button";
              SheetClose: "button";
              Gallery: "section";
            };
          };
          Metric: {
            Props: {
              label: string;
              value: string;
              detail: string;
              tone: "accent" | "neutral";
            };
            Elements: {
              Root: "article";
              Label: "p";
              Value: "strong";
              Detail: "p";
              Rule: "div";
            };
          };
        };
      }
    >;
  };
};

export const dashboard: Feature<DashboardFeature> = {
  programs: {
    browser: {
      state: {
        compact: false,
        warm: true,
        sheetOpen: false,
        sheetView: "summary",
        sheetDragging: false,
        sheetOffset: 0,
        sheetVelocity: 0,
      },
      actions: {
        toggleDensity({ state }) {
          state.compact = !state.compact;
        },
        toggleAccent({ state }) {
          state.warm = !state.warm;
        },
        openSheet({ state }) {
          state.sheetOpen = true;
          state.sheetDragging = false;
          state.sheetOffset = 0;
          state.sheetVelocity = 0;
        },
        closeSheet({ state }) {
          state.sheetOpen = false;
          state.sheetDragging = false;
          state.sheetVelocity = 0;
        },
        toggleSheetView({ state }) {
          state.sheetView = state.sheetView === "summary" ? "detail" : "summary";
        },
        beginSheetDrag({ state }) {
          state.sheetDragging = true;
          state.sheetVelocity = 0;
        },
        updateSheetDrag({ state }, { offset, velocity }) {
          state.sheetOffset = Math.max(0, offset);
          state.sheetVelocity = velocity;
        },
        releaseSheet({ state }, { offset, velocity }) {
          state.sheetDragging = false;
          state.sheetOffset = Math.max(0, offset);
          state.sheetVelocity = velocity;
          if (offset > 140 || velocity > 850) state.sheetOpen = false;
          else state.sheetOffset = 0;
        },
        cancelSheetDrag({ state }) {
          state.sheetDragging = false;
          state.sheetOffset = 0;
          state.sheetVelocity = 0;
        },
      },
      components: {
        Application: {
          view({ feature, components: { Metric }, elements }) {
            const {
              Root,
              Header,
              Kicker,
              Title,
              Summary,
              Toolbar,
              Density,
              Accent,
              AccentIcon,
              AccentMode,
              OpenSheet,
              Sheet,
              SheetPanel,
              SheetHandle,
              SheetTitle,
              SheetBody,
              SheetSwitch,
              SheetClose,
              Gallery,
            } = elements;
            const density = createPress(() => feature.toggleDensity());
            const accent = createPress(() => feature.toggleAccent());
            const openSheet = createPress(() => feature.openSheet());
            const closeSheet = createPress(() => feature.closeSheet());
            const switchSheet = createPress(() => feature.toggleSheetView());
            return (
              <Root>
                <Header>
                  <Kicker>Northstar operations</Kicker>
                  <Title>Systems overview</Title>
                  <Summary>Live service health across the production edge.</Summary>
                  <Toolbar>
                    <Density type="button" {...density}>
                      {() => (feature.compact ? "Comfortable view" : "Compact view")}
                    </Density>
                    <Accent type="button" {...accent}>
                      <AccentIcon alt="" aria-hidden="true" />
                      {() => (feature.warm ? "Cool accent" : "Warm accent")}
                    </Accent>
                    <AccentMode aria-live="polite">
                      {() => (feature.warm ? "Bright click" : "Deep click")}
                    </AccentMode>
                    <OpenSheet type="button" aria-controls="motion-sheet" {...openSheet}>
                      Open motion sheet
                    </OpenSheet>
                  </Toolbar>
                </Header>
                <Sheet
                  id="motion-sheet"
                  aria-labelledby="motion-sheet-title"
                  ref={(element) =>
                    mountDialog(element, () => (feature.sheetOpen ? "modal" : false))
                  }
                  onCancel={(event) => {
                    event.preventDefault();
                    feature.closeSheet();
                  }}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) feature.closeSheet();
                  }}
                >
                  <SheetPanel>
                    <SheetHandle
                      type="button"
                      aria-label="Drag to dismiss"
                      ref={(element) => {
                        const drag = mountDrag(element, {
                          axis: "block",
                          bounds: () => ({ block: [0, Math.max(320, innerHeight)] }),
                          start: () => feature.beginSheetDrag(),
                          change: ({ block, velocityBlock }) =>
                            feature.updateSheetDrag({ offset: block, velocity: velocityBlock }),
                          release: ({ block, velocityBlock }) =>
                            feature.releaseSheet({ offset: block, velocity: velocityBlock }),
                          cancel: () => feature.cancelSheetDrag(),
                        });
                        return () => drag[Symbol.dispose]();
                      }}
                    />
                    <SheetTitle id="motion-sheet-title">
                      {() =>
                        feature.sheetView === "summary" ? "Motion continuity" : "Layout response"
                      }
                    </SheetTitle>
                    <SheetBody>
                      {() =>
                        feature.sheetView === "summary"
                          ? "Drag this surface, reverse it mid-flight, or change its content while it remains mounted."
                          : "This longer view deliberately wraps across several lines so the panel geometry changes without remounting its native element."
                      }
                    </SheetBody>
                    <SheetSwitch type="button" {...switchSheet}>
                      {() =>
                        feature.sheetView === "summary" ? "Show layout case" : "Show summary"
                      }
                    </SheetSwitch>
                    <SheetClose type="button" autoFocus {...closeSheet}>
                      Close
                    </SheetClose>
                  </SheetPanel>
                </Sheet>
                <Gallery aria-label="Service metrics">
                  <Metric
                    label="Availability"
                    value="99.997%"
                    detail="Rolling 30 days"
                    tone="accent"
                  />
                  <Metric label="Edge latency" value="38 ms" detail="Global p95" tone="neutral" />
                  <Metric
                    label="Active regions"
                    value="24"
                    detail="All systems nominal"
                    tone="neutral"
                  />
                </Gallery>
              </Root>
            );
          },
        },
        Metric: {
          view({ props, elements: { Root, Label, Value, Detail, Rule } }) {
            return (
              <Root>
                <Label>{props.label}</Label>
                <Value>{props.value}</Value>
                <Rule aria-hidden="true" />
                <Detail>{props.detail}</Detail>
              </Root>
            );
          },
        },
      },
      root: "Application",
    },
  },
};
