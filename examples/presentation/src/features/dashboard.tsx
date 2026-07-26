import { createFeature, type Program } from "kit";
import { createPress, For, mountDialog, mountDrag, type BrowserMainThread } from "kit/web";

type SheetView = "summary" | "detail";

export type SheetState =
  | Readonly<{
      status: "closed";
      view: SheetView;
      via:
        | Readonly<{ kind: "initial" }>
        | Readonly<{ kind: "dismiss"; source: "button" | "backdrop" | "escape" }>
        | Readonly<{ kind: "drag"; offset: number; velocity: number }>;
    }>
  | Readonly<{
      status: "open";
      view: SheetView;
      interaction:
        | Readonly<{ kind: "idle" }>
        | Readonly<{ kind: "dragging"; offset: number; velocity: number }>
        | Readonly<{ kind: "released"; offset: number; velocity: number }>;
    }>;

export type DashboardFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        State: {
          compact: boolean;
          reversed: boolean;
          warm: boolean;
          sheet: SheetState;
        };
        Actions: {
          toggleDensity(): void;
          reorderMetrics(): void;
          toggleAccent(): void;
          openSheet(): void;
          closeSheet(input: { source: "button" | "backdrop" | "escape" }): void;
          toggleSheetView(): void;
          beginSheetDrag(): void;
          updateSheetDrag(input: { offset: number; velocity: number }): void;
          releaseSheet(input: { offset: number; velocity: number }): void;
          cancelSheetDrag(): void;
        };
        Components: {
          Overview: {
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
              Reorder: "button";
              OpenSheet: "button";
              Sheet: "dialog";
              SheetBackdrop: "div";
              SheetPanel: "section";
              SheetHandle: "button";
              SheetTitle: "h2";
              SheetContent: "div";
              SheetSummary: "p";
              SheetDetail: "p";
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

export const dashboard = createFeature<DashboardFeature>({
  programs: {
    browser: {
      state: {
        compact: false,
        reversed: false,
        warm: true,
        sheet: { status: "closed", view: "summary", via: { kind: "initial" } },
      },
      actions: {
        toggleDensity({ state }) {
          state.compact = !state.compact;
        },
        reorderMetrics({ state }) {
          state.reversed = !state.reversed;
        },
        toggleAccent({ state }) {
          state.warm = !state.warm;
        },
        openSheet({ state }) {
          const sheet = state.sheet;
          if (sheet.status === "open") return;
          state.sheet = { status: "open", view: sheet.view, interaction: { kind: "idle" } };
        },
        closeSheet({ state }, { source }) {
          const sheet = state.sheet;
          if (sheet.status === "closed") return;
          state.sheet = {
            status: "closed",
            view: sheet.view,
            via: { kind: "dismiss", source },
          };
        },
        toggleSheetView({ state }) {
          const sheet = state.sheet;
          state.sheet = {
            ...sheet,
            view: sheet.view === "summary" ? "detail" : "summary",
          };
        },
        beginSheetDrag({ state }) {
          const sheet = state.sheet;
          if (sheet.status !== "open") return;
          state.sheet = {
            status: "open",
            view: sheet.view,
            interaction: { kind: "dragging", offset: 0, velocity: 0 },
          };
        },
        updateSheetDrag({ state }, { offset, velocity }) {
          const sheet = state.sheet;
          if (sheet.status !== "open" || sheet.interaction.kind !== "dragging") return;
          state.sheet = {
            status: "open",
            view: sheet.view,
            interaction: { kind: "dragging", offset, velocity },
          };
        },
        releaseSheet({ state }, { offset, velocity }) {
          const sheet = state.sheet;
          if (sheet.status !== "open" || sheet.interaction.kind !== "dragging") return;
          state.sheet =
            offset > 140 || velocity > 850
              ? { status: "closed", view: sheet.view, via: { kind: "drag", offset, velocity } }
              : {
                  status: "open",
                  view: sheet.view,
                  interaction: { kind: "released", offset, velocity },
                };
        },
        cancelSheetDrag({ state }) {
          const sheet = state.sheet;
          if (sheet.status !== "open") return;
          state.sheet = { status: "open", view: sheet.view, interaction: { kind: "idle" } };
        },
      },
      components: {
        Overview: {
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
              Reorder,
              OpenSheet,
              Sheet,
              SheetBackdrop,
              SheetPanel,
              SheetHandle,
              SheetTitle,
              SheetContent,
              SheetSummary,
              SheetDetail,
              SheetSwitch,
              SheetClose,
              Gallery,
            } = elements;
            const density = createPress(() => feature.toggleDensity());
            const accent = createPress(() => feature.toggleAccent());
            const reorder = createPress(() => feature.reorderMetrics());
            const openSheet = createPress(() => feature.openSheet());
            const closeSheet = createPress(() => feature.closeSheet({ source: "button" }));
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
                    <Reorder type="button" {...reorder}>
                      Reorder metrics
                    </Reorder>
                    <OpenSheet type="button" aria-controls="motion-sheet" {...openSheet}>
                      Open motion sheet
                    </OpenSheet>
                  </Toolbar>
                </Header>
                <Sheet
                  id="motion-sheet"
                  aria-labelledby="motion-sheet-title"
                  ref={(element) =>
                    mountDialog(element, () => (feature.sheet.status === "open" ? "modal" : false))
                  }
                  onCancel={(event) => {
                    event.preventDefault();
                    feature.closeSheet({ source: "escape" });
                  }}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                      feature.closeSheet({ source: "backdrop" });
                    }
                  }}
                >
                  <SheetBackdrop
                    aria-hidden="true"
                    onPointerDown={() => feature.closeSheet({ source: "backdrop" })}
                  />
                  <SheetPanel>
                    <SheetHandle
                      type="button"
                      aria-label="Drag to dismiss"
                      ref={(element) => {
                        const drag = mountDrag(element, {
                          axis: "block",
                          bounds: () => {
                            const extent = Math.max(320, innerHeight);
                            return { block: [-extent, extent] };
                          },
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
                        feature.sheet.view === "summary" ? "Motion continuity" : "Layout response"
                      }
                    </SheetTitle>
                    <SheetContent>
                      <SheetSummary aria-hidden={() => feature.sheet.view !== "summary"}>
                        Drag this surface, reverse it mid-flight, or change its content while it
                        remains mounted.
                      </SheetSummary>
                      <SheetDetail aria-hidden={() => feature.sheet.view !== "detail"}>
                        This longer view deliberately wraps across several lines so the panel
                        geometry changes without remounting its native element.
                      </SheetDetail>
                    </SheetContent>
                    <SheetSwitch type="button" {...switchSheet}>
                      {() =>
                        feature.sheet.view === "summary" ? "Show layout case" : "Show summary"
                      }
                    </SheetSwitch>
                    <SheetClose type="button" autoFocus {...closeSheet}>
                      Close
                    </SheetClose>
                  </SheetPanel>
                </Sheet>
                <Gallery aria-label="Service metrics">
                  <For
                    each={() => (feature.reversed ? [...metrics].reverse() : metrics)}
                    by="label"
                  >
                    {(metric) => <Metric {...metric} />}
                  </For>
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
      root: "Overview",
    },
  },
});

const metrics = [
  {
    label: "Availability",
    value: "99.997%",
    detail: "Rolling 30 days",
    tone: "accent",
  },
  { label: "Edge latency", value: "38 ms", detail: "Global p95", tone: "neutral" },
  {
    label: "Active regions",
    value: "24",
    detail: "All systems nominal",
    tone: "neutral",
  },
] as const;
