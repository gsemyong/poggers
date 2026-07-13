import {
  type CandidateGeometry,
  type CandidateRecognizerScene,
  arrangeCandidate,
  selectCandidateStructure,
  createCandidateDerivedTargetHandle,
  createCandidateLayer,
  createCandidatePresentationIdentity,
  createCandidateReadExpression,
  createCandidateTargetHandle,
  createCandidateTransitionPolicy,
  flowCandidate,
  gridCandidate,
  constrainCandidateSize,
  padCandidate,
  participateCandidate,
  anchorCandidate,
  issueCandidateAction,
  issueCandidateStructurePart,
  lowerCandidateLayoutToWebStyle,
  lowerCandidatePresentationSceneToWebStyle,
  lowerCandidatePresentationToWebLayout,
  lowerCandidatePresentationToWeb,
  mountCandidateGesturesToWeb,
  mountCandidateReconciledStructureToWeb,
  mountCandidateStructureToWeb,
  normalizeSemanticOperations,
  normalizeSemanticLayout,
  normalizeCandidateStructure,
  notCandidate,
  overlayCandidate,
  setCandidateTarget,
  transitionCandidateTarget,
  updateCandidateStructureOnWeb,
} from "../../packages/kit/tests/ui-language-candidates";
import { runFamilyCandidateBrowser } from "./family-candidate-fixture";
import {
  createAnimeLayoutBackend,
  createAnimeMotionBackend,
  RetainedLayoutGraph,
  RetainedMotionGraph,
  type MotionTransition,
} from "../../packages/kit/src/visual-motion";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Poggers candidate web adapter</title>
    <script type="module" src="/client.js"></script>
  </head>
  <body><div id="app"></div></body>
</html>`;

async function runServer(): Promise<void> {
  const port = Number(Bun.env.PORT ?? 3041);
  const entrypoint = import.meta.path;
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/") {
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      if (pathname === "/health") return new Response("ok");
      if (pathname === "/client.js") {
        const result = await Bun.build({
          entrypoints: [entrypoint],
          target: "browser",
          format: "esm",
          minify: false,
          sourcemap: "inline",
        });
        if (!result.success) {
          return new Response(result.logs.map(String).join("\n"), { status: 500 });
        }
        return new Response(await result.outputs[0]!.text(), {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  console.log(`candidate web adapter fixture running on http://127.0.0.1:${port}`);
}

function runBrowser(): void {
  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-block-size: 100dvb; background: oklch(0.975 0.004 250); color: oklch(0.2 0.01 250); }
    button, input, select { font: inherit; }
    main { min-block-size: 100dvb; display: grid; align-content: center; gap: 18px; inline-size: min(100% - 32px, 560px); margin-inline: auto; padding-block: 40px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
    p { margin: 0; color: oklch(0.48 0.015 250); line-height: 1.55; }
    label { display: grid; gap: 8px; font-size: 13px; font-weight: 650; }
    input, select { inline-size: 100%; min-block-size: 42px; border: 1px solid oklch(0.84 0.01 250); border-radius: 7px; background: white; padding-inline: 12px; }
    input[type="range"] { padding-inline: 0; }
    button, a { min-block-size: 42px; border-radius: 7px; }
    button { border: 1px solid oklch(0.25 0.01 250); background: oklch(0.22 0.01 250); color: white; padding-inline: 16px; cursor: pointer; }
    button:hover { background: oklch(0.3 0.01 250); }
    a { display: inline-flex; align-items: center; color: oklch(0.45 0.16 255); text-underline-offset: 3px; }
    dialog { z-index: 1001; border: 0; padding: 0; overflow: clip; }
    dialog::backdrop { background: transparent; }
    dialog[data-retained="true"] { display: block; }
    dialog[data-exiting="true"] { pointer-events: none; }
    dialog h2, dialog p { margin: 0; }
    dialog button { margin: 0; }
    #BrowserLab\\.LayoutFrame { inline-size: 100%; justify-self: center; }
    #BrowserLab\\.LayoutRegion { inline-size: 100%; }
    #BrowserLab\\.LayoutPrimary, #BrowserLab\\.LayoutSecondary { min-inline-size: 0; min-block-size: 84px; padding: 16px; border: 1px solid oklch(0.84 0.01 250); border-radius: 8px; background: white; }
    #BrowserLab\\.LayoutPrimary { flex: 2 1 0; }
    #BrowserLab\\.LayoutSecondary { flex: 1 1 0; }
    output { min-block-size: 24px; font: 12px/1.5 ui-monospace, monospace; color: oklch(0.45 0.01 250); }
    :focus-visible, [data-forced-focus-visible="true"] { outline: 3px solid oklch(0.68 0.16 250); outline-offset: 3px; }
  `;
  document.head.append(style);

  const Root = issueCandidateStructurePart("BrowserLab", "Root", "main");
  const Title = issueCandidateStructurePart("BrowserLab", "Title", "h1");
  const Intro = issueCandidateStructurePart("BrowserLab", "Intro", "p");
  const PresetLabel = issueCandidateStructurePart("BrowserLab", "PresetLabel", "label");
  const Preset = issueCandidateStructurePart("BrowserLab", "Preset", "select");
  const PresetOption = issueCandidateStructurePart("BrowserLab", "PresetOption", "option");
  const Open = issueCandidateStructurePart("BrowserLab", "Open", "button");
  const LayoutToggle = issueCandidateStructurePart("BrowserLab", "LayoutToggle", "button");
  const LayoutFrame = issueCandidateStructurePart("BrowserLab", "LayoutFrame", "div");
  const LayoutRegion = issueCandidateStructurePart("BrowserLab", "LayoutRegion", "section");
  const LayoutPrimary = issueCandidateStructurePart("BrowserLab", "LayoutPrimary", "article");
  const LayoutSecondary = issueCandidateStructurePart("BrowserLab", "LayoutSecondary", "aside");
  const QueryLabel = issueCandidateStructurePart("BrowserLab", "QueryLabel", "label");
  const Query = issueCandidateStructurePart("BrowserLab", "Query", "input");
  const VolumeLabel = issueCandidateStructurePart("BrowserLab", "VolumeLabel", "label");
  const Volume = issueCandidateStructurePart("BrowserLab", "Volume", "input");
  const Help = issueCandidateStructurePart("BrowserLab", "Help", "a");
  const Status = issueCandidateStructurePart("BrowserLab", "Status", "div");
  const Dialog = issueCandidateStructurePart("BrowserLab", "Dialog", "dialog");
  const Backdrop = createCandidateLayer(
    createCandidatePresentationIdentity("BrowserLab.Dialog"),
    "backdrop",
  );
  const DialogTitle = issueCandidateStructurePart("BrowserLab", "DialogTitle", "h2");
  const DialogText = issueCandidateStructurePart("BrowserLab", "DialogText", "p");
  const DialogHeader = issueCandidateStructurePart("BrowserLab", "DialogHeader", "div");
  const DialogCopy = issueCandidateStructurePart("BrowserLab", "DialogCopy", "div");
  const DialogEyebrow = issueCandidateStructurePart("BrowserLab", "DialogEyebrow", "p");
  const OptionList = issueCandidateStructurePart("BrowserLab", "OptionList", "div");
  const Option = issueCandidateStructurePart("BrowserLab", "Option", "button");
  const OptionBadge = issueCandidateStructurePart("BrowserLab", "OptionBadge", "span");
  const OptionCopy = issueCandidateStructurePart("BrowserLab", "OptionCopy", "span");
  const OptionTitle = issueCandidateStructurePart("BrowserLab", "OptionTitle", "span");
  const OptionDetail = issueCandidateStructurePart("BrowserLab", "OptionDetail", "span");
  const OptionKey = issueCandidateStructurePart("BrowserLab", "OptionKey", "span");
  const DialogFooter = issueCandidateStructurePart("BrowserLab", "DialogFooter", "p");
  const Close = issueCandidateStructurePart("BrowserLab", "Close", "button");
  const dialogTitle = DialogTitle({}, "Protect this wallet");
  const openRead = createCandidateReadExpression<boolean>("dialog.open");
  const mountedRead = createCandidateReadExpression<boolean>("dialog.mounted");
  const close = Close(
    { name: "Close security center", activate: issueCandidateAction("BrowserLab.close") },
    "X",
  );
  const dialog = Dialog(
    {
      labelledBy: dialogTitle.reference,
      modal: openRead,
      hidden: notCandidate(mountedRead),
      inert: notCandidate(openRead),
      dismiss: issueCandidateAction("BrowserLab.close"),
    },
    DialogHeader(
      {},
      DialogCopy(
        {},
        DialogEyebrow({}, "Security center"),
        dialogTitle,
        DialogText({}, "Choose how to inspect or change this wallet's recovery access."),
      ),
      close,
    ),
    OptionList(
      {},
      Option(
        {
          key: "key",
          name: "Reveal private key",
          activate: issueCandidateAction("BrowserLab.privateKey"),
        },
        OptionBadge({ key: "key" }, "PK"),
        OptionCopy(
          { key: "key" },
          OptionTitle({ key: "key" }, "Private key"),
          OptionDetail({ key: "key" }, "Reveal the signing key for this wallet"),
        ),
        OptionKey({ key: "key" }, "01"),
      ),
      Option(
        {
          key: "phrase",
          name: "View recovery phrase",
          activate: issueCandidateAction("BrowserLab.phrase"),
        },
        OptionBadge({ key: "phrase" }, "RP"),
        OptionCopy(
          { key: "phrase" },
          OptionTitle({ key: "phrase" }, "Recovery phrase"),
          OptionDetail({ key: "phrase" }, "Review the words used to restore access"),
        ),
        OptionKey({ key: "phrase" }, "02"),
      ),
      Option(
        {
          key: "remove",
          name: "Remove wallet",
          activate: issueCandidateAction("BrowserLab.remove"),
        },
        OptionBadge({ key: "remove" }, "RM"),
        OptionCopy(
          { key: "remove" },
          OptionTitle({ key: "remove" }, "Remove wallet"),
          OptionDetail({ key: "remove" }, "Remove local access from this device"),
        ),
        OptionKey({ key: "remove" }, "03"),
      ),
    ),
    DialogFooter({}, "Protected actions require local device confirmation."),
  );
  const openTrigger = Open(
    {
      name: "Open dialog",
      controls: dialog.reference,
      popup: "dialog",
      expanded: openRead,
      activate: issueCandidateAction("BrowserLab.open"),
    },
    "Open dialog",
  );
  const hierarchy = Root(
    {},
    Title({}, "Candidate web adapter"),
    Intro({}, "Real native structure mounted from the backend-independent candidate IR."),
    PresetLabel(
      {},
      "Visual preset",
      Preset(
        {
          name: "Visual preset",
          value: "Monochrome",
          change: issueCandidateAction<(value: string) => void>("BrowserLab.preset"),
        },
        PresetOption({ name: "Monochrome", key: "monochrome" }, "Monochrome"),
        PresetOption({ name: "Editorial", key: "editorial" }, "Editorial"),
        PresetOption({ name: "Tactile", key: "tactile" }, "Tactile"),
      ),
    ),
    openTrigger,
    LayoutToggle(
      {
        name: "Toggle local container width",
        activate: issueCandidateAction("BrowserLab.layout"),
      },
      "Toggle local container width",
    ),
    LayoutFrame(
      {},
      LayoutRegion(
        {},
        LayoutPrimary({}, "Primary content keeps its semantic identity across layout modes."),
        LayoutSecondary(
          {},
          "Secondary content moves through logical flow, not a second hierarchy.",
        ),
      ),
    ),
    QueryLabel(
      {},
      "Search",
      Query({
        name: "Search",
        value: "Ada",
        change: issueCandidateAction<(value: string) => void>("BrowserLab.query"),
      }),
    ),
    VolumeLabel(
      {},
      "Volume",
      Volume({
        role: "slider",
        name: "Volume",
        value: 0.4,
        minimum: 0,
        maximum: 1,
        step: 0.1,
        largeStep: 0.5,
        change: issueCandidateAction<(value: number) => void>("BrowserLab.volume"),
      }),
    ),
    Help(
      {
        name: "Read adapter evidence",
        destination: "#evidence",
        activate: issueCandidateAction("BrowserLab.help"),
      },
      "Read adapter evidence",
    ),
    Status({ role: "status", key: "evidence" }, "Waiting for interaction."),
    dialog,
  );

  const normalize = (open: boolean, mounted: boolean) =>
    normalizeCandidateStructure(hierarchy, {
      reads: { "dialog.open": open, "dialog.mounted": mounted },
      ...(open
        ? {
            activeModal: {
              identity: dialog.reference,
              initialFocus: close.reference,
              returnFocus: openTrigger.reference,
            },
          }
        : {}),
    });
  let current = normalize(false, false);
  let openState = false;
  let mountedState = false;
  const dispatches: string[] = [];
  const updates: string[] = [];
  const platform = {
    create(element: string): HTMLElement {
      return document.createElement(element);
    },
    text(value: string): Text {
      return document.createTextNode(value);
    },
    attribute(node: Node, name: string, value: string | number | boolean | undefined): void {
      if (!(node instanceof Element)) return;
      if (value === undefined) node.removeAttribute(name);
      else node.setAttribute(name, String(value));
    },
    property(node: Node, name: string, value: string | number | boolean | undefined): void {
      if (!(node instanceof HTMLElement)) return;
      const currentValue = (node as unknown as Record<string, unknown>)[name];
      (node as unknown as Record<string, unknown>)[name] =
        value ?? (typeof currentValue === "boolean" ? false : "");
    },
    listen(node: Node, event: string, listener: (event: Event) => void): () => void {
      node.addEventListener(event, listener);
      return () => node.removeEventListener(event, listener);
    },
    append(parent: Node, child: Node): void {
      parent.appendChild(child);
    },
    remove(node: Node): void {
      node.parentNode?.removeChild(node);
    },
  };
  const status = (): HTMLElement =>
    document.getElementById("BrowserLab.Status:evidence") as HTMLElement;
  const applyDialogState = (open: boolean, retained: boolean): void => {
    const next = normalize(open, retained);
    const changed = updateCandidateStructureOnWeb(current, next, mounted, platform);
    updates.push(...changed.map((change) => `${change.identity}:${change.name}`));
    current = next;
    openState = open;
    mountedState = retained;
  };
  let applyPreset = (_preset: string): void => {};
  let applySecurityLayout = (): void => {};
  let toggleLocalLayout = (): void => {};
  let startExit = (_velocity?: number): void => {};
  let startEnter = (_fresh?: boolean): void => {};
  const mounted = mountCandidateStructureToWeb<Node, Event>(current, platform, (action, event) => {
    dispatches.push(action);
    const nativeDialog = document.getElementById("BrowserLab.Dialog") as HTMLDialogElement;
    if (action === "BrowserLab.open") {
      const fresh = !mountedState;
      applyDialogState(true, true);
      if (!nativeDialog.open) nativeDialog.showModal();
      startEnter(fresh);
      (document.getElementById("BrowserLab.Close") as HTMLButtonElement).focus();
    } else if (action === "BrowserLab.close") {
      event.preventDefault();
      startExit();
    } else if (action === "BrowserLab.help") {
      event.preventDefault();
      status().textContent = "Native link activation dispatched once.";
    } else if (
      action === "BrowserLab.privateKey" ||
      action === "BrowserLab.phrase" ||
      action === "BrowserLab.remove"
    ) {
      const destination =
        action === "BrowserLab.privateKey"
          ? "Private key"
          : action === "BrowserLab.phrase"
            ? "Recovery phrase"
            : "Remove wallet";
      status().textContent = `${destination} action dispatched without presentation access.`;
    } else if (action === "BrowserLab.preset") {
      const preset = (event.target as HTMLSelectElement).value;
      applyPreset(preset);
      status().textContent = `${preset} preset applied without semantic remount.`;
    } else if (action === "BrowserLab.layout") {
      toggleLocalLayout();
    } else if (action === "BrowserLab.query" || action === "BrowserLab.volume") {
      status().textContent = `${action} dispatched from native input.`;
    }
  });
  document.getElementById("app")!.append(...mounted.roots);
  const visualPresets = {
    Monochrome: {
      composition: "list",
      ink: { lightness: 0.2, chroma: 0.015, hue: 250 },
      paper: { lightness: 0.995, chroma: 0.003, hue: 250 },
      accent: { lightness: 0.2, chroma: 0.015, hue: 250 },
      buttonShape: "capsule",
      controlRadius: 7,
      dialogRadius: 12,
      optionRadius: 12,
      buttonSize: 44,
      dialogWidth: 420,
      dialogPadding: 22,
      dialogGap: 16,
      optionGap: 9,
      optionHeight: 70,
      titleSize: 28,
      shadow: { block: 8, blur: 24, spread: -8, alpha: 0.18 },
      spring: { mass: 1, stiffness: 520, damping: 38 },
      families: ["Inter", "ui-sans-serif", "sans-serif"],
    },
    Editorial: {
      composition: "gallery",
      ink: { lightness: 0.18, chroma: 0.035, hue: 270 },
      paper: { lightness: 1, chroma: 0, hue: 0 },
      accent: { lightness: 0.58, chroma: 0.22, hue: 28 },
      buttonShape: "rectangle",
      controlRadius: 2,
      dialogRadius: 2,
      optionRadius: 0,
      buttonSize: 50,
      dialogWidth: 760,
      dialogPadding: 30,
      dialogGap: 24,
      optionGap: 0,
      optionHeight: 158,
      titleSize: 34,
      shadow: { block: 12, blur: 0, spread: -2, alpha: 0.2 },
      spring: { mass: 0.85, stiffness: 680, damping: 44 },
      families: ["Georgia", "serif"],
    },
    Tactile: {
      composition: "stack",
      ink: { lightness: 0.16, chroma: 0.035, hue: 155 },
      paper: { lightness: 0.96, chroma: 0.025, hue: 145 },
      accent: { lightness: 0.64, chroma: 0.18, hue: 145 },
      buttonShape: "rectangle",
      controlRadius: 16,
      dialogRadius: 24,
      optionRadius: 17,
      buttonSize: 56,
      dialogWidth: 400,
      dialogPadding: 20,
      dialogGap: 18,
      optionGap: 11,
      optionHeight: 78,
      titleSize: 27,
      shadow: { block: 10, blur: 18, spread: -4, alpha: 0.32 },
      spring: { mass: 1.2, stiffness: 380, damping: 27 },
      families: ["Avenir Next", "ui-sans-serif", "sans-serif"],
    },
  } as const;
  const color = (value: {
    readonly lightness: number;
    readonly chroma: number;
    readonly hue: number;
  }) => ({ colorSpace: "oklch", ...value, alpha: 1 }) as const;
  const rectangle = (radius: number) => ({
    kind: "rectangle" as const,
    corners: {
      startStart: { radius: { dimension: "length" as const, value: radius }, smoothing: 0 },
      startEnd: { radius: { dimension: "length" as const, value: radius }, smoothing: 0 },
      endStart: { radius: { dimension: "length" as const, value: radius }, smoothing: 0 },
      endEnd: { radius: { dimension: "length" as const, value: radius }, smoothing: 0 },
    },
  });
  const createVisualScene = (name: keyof typeof visualPresets) => {
    const preset = visualPresets[name];
    const ink = color(preset.ink);
    const paper = color(preset.paper);
    const accent = color(preset.accent);
    const buttonShape =
      preset.buttonShape === "capsule"
        ? ({ kind: "capsule" } as const)
        : rectangle(preset.controlRadius);
    const buttonSize = createCandidateTargetHandle("BrowserLab.Open", "blockSize", "length");
    const buttonSizeTransition = createCandidateTransitionPolicy("preset-control-size", {
      normal: { kind: "spring", ...preset.spring },
      reduced: { kind: "instant" },
    });
    const typeStyle = (
      size: number,
      weight: number,
      options: { readonly lineHeight?: number; readonly families?: readonly string[] } = {},
    ) => ({
      families: options.families ?? preset.families,
      size: { dimension: "length" as const, value: size },
      lineHeight: {
        dimension: "length" as const,
        value: options.lineHeight ?? Math.ceil(size * 1.35),
      },
      weight,
      tracking: { dimension: "length" as const, value: 0 },
      align: "start" as const,
      wrap: "wrap" as const,
      overflow: "clip" as const,
      decoration: "none" as const,
      variations: {},
    });
    const optionKeys = ["key", "phrase", "remove"] as const;
    const optionParts = optionKeys.flatMap((key) => {
      const option = `BrowserLab.Option:${key}`;
      const badge = `BrowserLab.OptionBadge:${key}`;
      const title = `BrowserLab.OptionTitle:${key}`;
      const detail = `BrowserLab.OptionDetail:${key}`;
      const shortcut = `BrowserLab.OptionKey:${key}`;
      const optionFill =
        name === "Editorial"
          ? { ...paper, alpha: 0 }
          : name === "Tactile"
            ? { ...accent, lightness: 0.88, chroma: 0.045, alpha: 0.72 }
            : { ...ink, lightness: 0.96, chroma: 0.006, alpha: 1 };
      const optionHover =
        name === "Editorial"
          ? { ...accent, lightness: 0.96, chroma: 0.025, alpha: 1 }
          : name === "Tactile"
            ? { ...accent, lightness: 0.83, chroma: 0.065, alpha: 0.82 }
            : { ...ink, lightness: 0.92, chroma: 0.008, alpha: 1 };
      const engaged = createCandidateReadExpression<boolean>(`interaction.option.${key}`);
      return [
        setCandidateTarget(
          createCandidateTargetHandle(option, "fill", "paint"),
          engaged.choose(
            { kind: "solid" as const, color: optionHover },
            { kind: "solid" as const, color: optionFill },
          ),
        ),
        setCandidateTarget(createCandidateTargetHandle(option, "foreground", "paint"), {
          kind: "solid" as const,
          color: ink,
        }),
        setCandidateTarget(
          createCandidateTargetHandle(option, "shape", "shape"),
          rectangle(preset.optionRadius),
        ),
        setCandidateTarget(createCandidateTargetHandle(option, "stroke", "stroke"), {
          paint: {
            kind: "solid" as const,
            color: { ...ink, alpha: name === "Editorial" ? 0.28 : 0.1 },
          },
          width: { dimension: "length" as const, value: 1 },
          placement: "inside" as const,
        }),
        setCandidateTarget(
          createCandidateTargetHandle(option, "shadows", "shadows"),
          name === "Tactile"
            ? [
                {
                  kind: "outer" as const,
                  color: { ...ink, alpha: 0.12 },
                  offset: {
                    inline: { dimension: "length" as const, value: 0 },
                    block: { dimension: "length" as const, value: 5 },
                  },
                  blur: { dimension: "length" as const, value: 10 },
                  spread: { dimension: "length" as const, value: -6 },
                },
              ]
            : [],
        ),
        setCandidateTarget(createCandidateTargetHandle(badge, "fill", "paint"), {
          kind: "solid" as const,
          color: accent,
        }),
        setCandidateTarget(createCandidateTargetHandle(badge, "foreground", "paint"), {
          kind: "solid" as const,
          color: name === "Editorial" ? paper : { ...paper, alpha: 1 },
        }),
        setCandidateTarget(
          createCandidateTargetHandle(badge, "shape", "shape"),
          name === "Editorial" ? rectangle(0) : rectangle(name === "Tactile" ? 11 : 9),
        ),
        setCandidateTarget(
          createCandidateTargetHandle(badge, "type", "type"),
          typeStyle(11, 760, { lineHeight: 14 }),
        ),
        setCandidateTarget(
          createCandidateTargetHandle(title, "type", "type"),
          typeStyle(15, 680, { lineHeight: 19 }),
        ),
        setCandidateTarget(createCandidateTargetHandle(detail, "foreground", "paint"), {
          kind: "solid" as const,
          color: { ...ink, alpha: 0.58 },
        }),
        setCandidateTarget(
          createCandidateTargetHandle(detail, "type", "type"),
          typeStyle(12, 480, { lineHeight: 17 }),
        ),
        setCandidateTarget(createCandidateTargetHandle(shortcut, "foreground", "paint"), {
          kind: "solid" as const,
          color: { ...ink, alpha: 0.42 },
        }),
        setCandidateTarget(
          createCandidateTargetHandle(shortcut, "type", "type"),
          typeStyle(10, 720, { lineHeight: 13 }),
        ),
      ];
    });
    return normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Root", "foreground", "paint"), {
        kind: "solid",
        color: ink,
      }),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Root", "type", "type"), {
        families: preset.families,
        size: { dimension: "length", value: 15 },
        lineHeight: { dimension: "length", value: 22 },
        weight: 500,
        tracking: { dimension: "length", value: 0 },
        align: "start",
        wrap: "wrap",
        overflow: "clip",
        decoration: "none",
        variations: {},
      }),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Open", "fill", "paint"), {
        kind: "solid",
        color: accent,
      }),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Open", "foreground", "paint"), {
        kind: "solid",
        color: paper,
      }),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.Open", "shape", "shape"),
        buttonShape,
      ),
      setCandidateTarget(buttonSize, {
        dimension: "length",
        value: preset.buttonSize,
      }),
      transitionCandidateTarget(buttonSize, buttonSizeTransition),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Open", "shadows", "shadows"), [
        {
          kind: "outer",
          color: { ...ink, alpha: preset.shadow.alpha },
          offset: {
            inline: { dimension: "length", value: 0 },
            block: { dimension: "length", value: preset.shadow.block },
          },
          blur: { dimension: "length", value: preset.shadow.blur },
          spread: { dimension: "length", value: preset.shadow.spread },
        },
      ]),
      ...["Query", "Preset"].flatMap((part) => [
        setCandidateTarget(createCandidateTargetHandle(`BrowserLab.${part}`, "fill", "paint"), {
          kind: "solid",
          color: paper,
        }),
        setCandidateTarget(
          createCandidateTargetHandle(`BrowserLab.${part}`, "foreground", "paint"),
          { kind: "solid", color: ink },
        ),
        setCandidateTarget(
          createCandidateTargetHandle(`BrowserLab.${part}`, "shape", "shape"),
          rectangle(preset.controlRadius),
        ),
        setCandidateTarget(createCandidateTargetHandle(`BrowserLab.${part}`, "stroke", "stroke"), {
          paint: { kind: "solid", color: { ...ink, lightness: 0.72, alpha: 0.7 } },
          width: { dimension: "length", value: 1 },
          placement: "inside",
        }),
      ]),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Dialog", "fill", "paint"), {
        kind: "solid",
        color: paper,
      }),
      ...(name === "Tactile"
        ? [
            setCandidateTarget(
              createCandidateTargetHandle("BrowserLab.Dialog", "material", "material"),
              {
                backdropBlur: { dimension: "length", value: 18 },
                backdropSaturation: 1.18,
                tint: { kind: "solid", color: { ...paper, alpha: 0.42 } },
                noise: 0,
              },
            ),
          ]
        : []),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Dialog", "foreground", "paint"), {
        kind: "solid",
        color: ink,
      }),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.Dialog", "shape", "shape"),
        rectangle(preset.dialogRadius),
      ),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Dialog", "shadows", "shadows"), [
        {
          kind: "outer",
          color: { ...ink, alpha: Math.min(0.4, preset.shadow.alpha + 0.06) },
          offset: {
            inline: { dimension: "length", value: 0 },
            block: { dimension: "length", value: preset.shadow.block * 2 },
          },
          blur: { dimension: "length", value: Math.max(24, preset.shadow.blur * 2) },
          spread: { dimension: "length", value: preset.shadow.spread },
        },
      ]),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.DialogTitle", "type", "type"),
        typeStyle(preset.titleSize, name === "Editorial" ? 520 : 700, {
          lineHeight: preset.titleSize + 5,
          families:
            name === "Editorial" ? ["Iowan Old Style", "Georgia", "serif"] : preset.families,
        }),
      ),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.DialogEyebrow", "foreground", "paint"),
        {
          kind: "solid",
          color: accent,
        },
      ),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.DialogEyebrow", "type", "type"),
        typeStyle(11, 760, { lineHeight: 14 }),
      ),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.DialogText", "foreground", "paint"),
        {
          kind: "solid",
          color: { ...ink, alpha: 0.6 },
        },
      ),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.DialogText", "type", "type"),
        typeStyle(14, 470, { lineHeight: 20 }),
      ),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Close", "fill", "paint"), {
        kind: "solid",
        color: { ...ink, alpha: name === "Editorial" ? 0 : 0.07 },
      }),
      setCandidateTarget(createCandidateTargetHandle("BrowserLab.Close", "foreground", "paint"), {
        kind: "solid",
        color: ink,
      }),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.Close", "shape", "shape"),
        name === "Editorial" ? rectangle(0) : ({ kind: "capsule" } as const),
      ),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.Close", "type", "type"),
        typeStyle(12, 760, { lineHeight: 14 }),
      ),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.DialogFooter", "foreground", "paint"),
        {
          kind: "solid",
          color: { ...ink, alpha: 0.45 },
        },
      ),
      setCandidateTarget(
        createCandidateTargetHandle("BrowserLab.DialogFooter", "type", "type"),
        typeStyle(11, 520, { lineHeight: 16 }),
      ),
      ...optionParts,
      setCandidateTarget(Backdrop.fill, {
        kind: "solid",
        color: { ...ink, alpha: name === "Editorial" ? 0.26 : name === "Tactile" ? 0.38 : 0.32 },
      }),
      setCandidateTarget(Backdrop.opacity, 0),
      transitionCandidateTarget(
        Backdrop.opacity,
        createCandidateTransitionPolicy("dialog-backdrop-presence", {
          normal: { kind: "spring", ...preset.spring },
          reduced: { kind: "instant" },
        }),
      ),
    ]);
  };
  const appliedStyles = new Map<HTMLElement, Set<string>>();
  const generatedNodes = new Map<string, HTMLElement>();
  const interactionReads: Record<string, unknown> = Object.fromEntries(
    ["key", "phrase", "remove"].map((key) => [`interaction.option.${key}`, false]),
  );
  let currentVisualScene: ReturnType<typeof normalizeSemanticOperations>;
  const motionSamples: { readonly key: string; readonly value: number }[] = [];
  const motionGraph = new RetainedMotionGraph(
    createAnimeMotionBackend({
      render(key, value) {
        motionSamples.push({ key, value });
        if (motionSamples.length > 240) motionSamples.shift();
        document.body.dataset.motionSamples = JSON.stringify(motionSamples);
        if (key === "BrowserLab.Open:blockSize") {
          const node = mounted.nodes.get("BrowserLab.Open");
          if (node instanceof HTMLElement) node.style.blockSize = `${value}px`;
        } else if (key === "BrowserLab.Dialog:translation.block") {
          const node = mounted.nodes.get("BrowserLab.Dialog");
          if (node instanceof HTMLElement) node.style.translate = `0 ${Math.max(0, value)}px`;
        } else if (key === Backdrop.opacity.key) {
          const node = generatedNodes.get(Backdrop.identity.key);
          if (node) node.style.opacity = String(Math.min(1, Math.max(0, value)));
        }
      },
    }),
  );
  let initializedMotion = false;
  let currentPreset: keyof typeof visualPresets = "Monochrome";
  applyPreset = (name) => {
    if (!(name in visualPresets)) throw new Error(`Unknown visual preset "${name}".`);
    for (const [node, properties] of appliedStyles) {
      for (const property of properties) node.style.removeProperty(property);
    }
    appliedStyles.clear();
    const scene = createVisualScene(name as keyof typeof visualPresets);
    currentVisualScene = scene;
    const sizeTarget = lowerCandidatePresentationToWeb(scene).find(
      (target) => target.identity === "BrowserLab.Open" && target.property === "blockSize",
    );
    if (!sizeTarget?.transition) throw new Error("Preset needs control-size motion.");
    for (const instruction of lowerCandidatePresentationSceneToWebStyle(scene, interactionReads)) {
      let node = mounted.nodes.get(instruction.identity);
      if (instruction.generated) {
        if (!mounted.nodes.has(instruction.generated.owner)) {
          throw new Error(
            `Generated visual owner "${instruction.generated.owner}" is not mounted.`,
          );
        }
        let generatedNode = generatedNodes.get(instruction.generated.identity);
        if (!generatedNode) {
          generatedNode = document.createElement("div");
          generatedNode.dataset.generatedIdentity = instruction.generated.identity;
          generatedNode.dataset.generatedOwner = instruction.generated.owner;
          generatedNode.setAttribute("aria-hidden", "true");
          generatedNode.inert = true;
          generatedNode.style.position = "fixed";
          generatedNode.style.inset = "0";
          generatedNode.style.zIndex = "1000";
          generatedNode.style.pointerEvents = "none";
          generatedNode.style.opacity = "0";
          document.body.append(generatedNode);
          generatedNodes.set(instruction.generated.identity, generatedNode);
        }
        node = generatedNode;
      }
      if (!(node instanceof HTMLElement))
        throw new Error(`Missing visual node "${instruction.identity}".`);
      const properties = appliedStyles.get(node) ?? new Set<string>();
      for (const declaration of instruction.declarations) {
        const channel = instruction.channels.find((entry) => entry.name === declaration.name)!;
        if (channel.strategy === "retained-motion") {
          const supported =
            (instruction.identity === "BrowserLab.Open" && declaration.name === "block-size") ||
            (instruction.identity === Backdrop.identity.key && declaration.name === "opacity");
          if (!supported) {
            throw new Error(`Unsupported retained web declaration "${declaration.name}".`);
          }
          continue;
        }
        node.style.setProperty(declaration.name, declaration.value);
        if (instruction.identity === Backdrop.identity.key && declaration.name === "background") {
          const owner = mounted.nodes.get(Backdrop.owner.key);
          if (owner instanceof HTMLElement) {
            owner.style.setProperty("--candidate-dialog-backdrop", declaration.value);
          }
        }
        properties.add(declaration.name);
      }
      appliedStyles.set(node, properties);
    }
    const endpoint = (sizeTarget.value as { readonly value: number }).value;
    const control = mounted.nodes.get("BrowserLab.Open") as HTMLElement;
    const channel = motionGraph.channel(
      sizeTarget.target,
      sizeTarget.identity,
      initializedMotion ? Number.parseFloat(getComputedStyle(control).blockSize) : endpoint,
    );
    const driver = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? sizeTarget.transition.reduced
      : sizeTarget.transition.normal;
    const transition: MotionTransition =
      driver.kind === "spring"
        ? {
            spring: {
              mass: driver.mass,
              stiffness: driver.stiffness,
              damping: driver.damping,
            },
          }
        : driver.kind === "instant"
          ? "instant"
          : {
              duration: driver.milliseconds,
              easing:
                driver.curve.kind === "linear"
                  ? "linear"
                  : {
                      cubic: [driver.curve.x1, driver.curve.y1, driver.curve.x2, driver.curve.y2],
                    },
            };
    if (initializedMotion) void channel.target(endpoint, transition);
    else initializedMotion = true;
    motionGraph.flush();
    currentPreset = name as keyof typeof visualPresets;
    document.body.dataset.preset = name.toLowerCase();
    applySecurityLayout();
  };
  const dragChannel = motionGraph.channel(
    "BrowserLab.Dialog:translation.block",
    "BrowserLab.Dialog",
    0,
  );
  const backdropChannel = motionGraph.channel(Backdrop.opacity.key, Backdrop.identity.key, 0);
  const refreshReactiveOption = (key: string): void => {
    const identity = `BrowserLab.Option:${key}`;
    const instruction = lowerCandidatePresentationSceneToWebStyle(
      currentVisualScene,
      interactionReads,
    ).find((entry) => entry.identity === identity);
    const node = mounted.nodes.get(identity);
    if (!instruction || !(node instanceof HTMLElement)) return;
    for (const declaration of instruction.declarations) {
      const channel = instruction.channels.find((entry) => entry.name === declaration.name);
      if (channel?.strategy === "reactive-property") {
        node.style.setProperty(declaration.name, declaration.value);
      }
    }
  };
  for (const key of ["key", "phrase", "remove"]) {
    const node = mounted.nodes.get(`BrowserLab.Option:${key}`);
    if (!(node instanceof HTMLElement)) continue;
    const setEngaged = (value: boolean): void => {
      interactionReads[`interaction.option.${key}`] = value;
      refreshReactiveOption(key);
    };
    node.addEventListener("pointerenter", () => setEngaged(true));
    node.addEventListener("pointerleave", () => setEngaged(false));
    node.addEventListener("focus", () => setEngaged(true));
    node.addEventListener("blur", () => setEngaged(false));
  }
  const securityLayoutProperties = new Map<HTMLElement, Set<string>>();
  const securityIdentities = [
    "Dialog",
    "DialogHeader",
    "DialogCopy",
    "DialogEyebrow",
    "DialogTitle",
    "DialogText",
    "Close",
    "OptionList",
    "DialogFooter",
    ...["key", "phrase", "remove"].flatMap((key) => [
      `Option:${key}`,
      `OptionBadge:${key}`,
      `OptionCopy:${key}`,
      `OptionTitle:${key}`,
      `OptionDetail:${key}`,
      `OptionKey:${key}`,
    ]),
  ].map((part) => createCandidatePresentationIdentity(`BrowserLab.${part}`));
  const length = (value: number) => ({ dimension: "length" as const, value });
  applySecurityLayout = () => {
    for (const [node, properties] of securityLayoutProperties) {
      for (const property of properties) node.style.removeProperty(property);
    }
    securityLayoutProperties.clear();
    const preset = visualPresets[currentPreset];
    const compact =
      new URLSearchParams(location.search).get("environment") === "compact" ||
      matchMedia("(max-width: 600px)").matches;
    const identity = (part: string) => createCandidatePresentationIdentity(`BrowserLab.${part}`);
    const contributions = [
      arrangeCandidate(
        identity("Dialog"),
        [identity("DialogHeader"), identity("OptionList"), identity("DialogFooter")],
        flowCandidate({
          axis: "block",
          gap: length(preset.dialogGap),
          align: "stretch",
          distribute: "start",
          wrap: false,
        }),
      ),
      arrangeCandidate(
        identity("DialogHeader"),
        [identity("DialogCopy"), identity("Close")],
        flowCandidate({
          axis: "inline",
          gap: length(16),
          align: "start",
          distribute: "between",
          wrap: false,
        }),
      ),
      arrangeCandidate(
        identity("DialogCopy"),
        [identity("DialogEyebrow"), identity("DialogTitle"), identity("DialogText")],
        flowCandidate({
          axis: "block",
          gap: length(currentPreset === "Editorial" ? 9 : 5),
          align: "stretch",
          distribute: "start",
          wrap: false,
        }),
      ),
      arrangeCandidate(
        identity("OptionList"),
        [identity("Option:key"), identity("Option:phrase"), identity("Option:remove")],
        preset.composition === "gallery" && !compact
          ? gridCandidate({
              columns: [
                { size: "fraction", value: 1 },
                { size: "fraction", value: 1 },
                { size: "fraction", value: 1 },
              ],
              rows: [{ size: "intrinsic" }],
              gap: length(12),
            })
          : flowCandidate({
              axis: "block",
              gap: length(preset.optionGap),
              align: "stretch",
              distribute: "start",
              wrap: false,
            }),
      ),
      ...["key", "phrase", "remove"].flatMap((key) => [
        arrangeCandidate(
          identity(`Option:${key}`),
          [
            identity(`OptionBadge:${key}`),
            identity(`OptionCopy:${key}`),
            identity(`OptionKey:${key}`),
          ],
          flowCandidate({
            axis: preset.composition === "gallery" && !compact ? "block" : "inline",
            gap: length(12),
            align: preset.composition === "gallery" && !compact ? "start" : "center",
            distribute: "start",
            wrap: false,
          }),
        ),
        arrangeCandidate(
          identity(`OptionCopy:${key}`),
          [identity(`OptionTitle:${key}`), identity(`OptionDetail:${key}`)],
          flowCandidate({
            axis: "block",
            gap: length(1),
            align: "stretch",
            distribute: "center",
            wrap: false,
          }),
        ),
        arrangeCandidate(identity(`OptionBadge:${key}`), [], overlayCandidate({ align: "center" })),
        participateCandidate(identity(`OptionCopy:${key}`), {
          grow: 1,
          shrink: 1,
          basis: { size: "intrinsic" },
        }),
        padCandidate(identity(`Option:${key}`), {
          inlineStart: length(currentPreset === "Editorial" ? 16 : 13),
          inlineEnd: length(currentPreset === "Editorial" ? 16 : 13),
          blockStart: length(currentPreset === "Editorial" ? 15 : 0),
          blockEnd: length(currentPreset === "Editorial" ? 15 : 0),
        }),
        constrainCandidateSize(identity(`Option:${key}`), {
          block: { ideal: length(preset.optionHeight) },
        }),
        constrainCandidateSize(identity(`OptionBadge:${key}`), {
          inline: { ideal: length(36) },
          block: { ideal: length(36) },
        }),
      ]),
      participateCandidate(identity("DialogCopy"), {
        grow: 1,
        shrink: 1,
        basis: { size: "intrinsic" },
      }),
      arrangeCandidate(identity("Close"), [], overlayCandidate({ align: "center" })),
      padCandidate(identity("Close"), {
        inlineStart: length(0),
        inlineEnd: length(0),
        blockStart: length(0),
        blockEnd: length(0),
      }),
      padCandidate(identity("Dialog"), {
        inlineStart: length(compact ? Math.min(20, preset.dialogPadding) : preset.dialogPadding),
        inlineEnd: length(compact ? Math.min(20, preset.dialogPadding) : preset.dialogPadding),
        blockStart: length(compact ? 20 : preset.dialogPadding),
        blockEnd: length(compact ? 18 : preset.dialogPadding),
      }),
      constrainCandidateSize(identity("Dialog"), {
        inline: {
          minimum: length(280),
          ideal: length(Math.min(preset.dialogWidth, window.innerWidth - (compact ? 24 : 48))),
          maximum: { size: "available" },
        },
        block: { maximum: length(Math.max(320, window.innerHeight - (compact ? 24 : 48))) },
      }),
      constrainCandidateSize(identity("Close"), {
        inline: { ideal: length(34) },
        block: { ideal: length(34) },
      }),
      anchorCandidate(identity("Dialog"), "viewport", {
        inline: "center",
        block: compact ? "end" : "center",
        insets: {
          inlineStart: length(compact ? 12 : 24),
          inlineEnd: length(compact ? 12 : 24),
          blockStart: length(compact ? 0 : 24),
          blockEnd: length(compact ? 12 : 24),
        },
      }),
    ];
    const scene = normalizeSemanticLayout(securityIdentities, contributions);
    for (const instruction of lowerCandidateLayoutToWebStyle(scene)) {
      const node = mounted.nodes.get(instruction.identity);
      if (!(node instanceof HTMLElement))
        throw new Error(`Missing security layout node "${instruction.identity}".`);
      const properties = new Set<string>();
      for (const declaration of instruction.declarations) {
        node.style.setProperty(declaration.name, declaration.value);
        properties.add(declaration.name);
      }
      securityLayoutProperties.set(node, properties);
    }
    document.body.dataset.compact = String(compact);
  };
  addEventListener("resize", applySecurityLayout, { passive: true });
  applyPreset("Monochrome");
  const layoutFrame = mounted.nodes.get("BrowserLab.LayoutFrame") as HTMLElement;
  const layoutRegion = mounted.nodes.get("BrowserLab.LayoutRegion") as HTMLElement;
  const layoutIdentities = {
    region: createCandidatePresentationIdentity("BrowserLab.LayoutRegion"),
    primary: createCandidatePresentationIdentity("BrowserLab.LayoutPrimary"),
    secondary: createCandidatePresentationIdentity("BrowserLab.LayoutSecondary"),
  };
  const layoutGeometry = createCandidateDerivedTargetHandle<CandidateGeometry>(
    layoutIdentities.region.key,
    "geometry",
    "geometry",
  );
  const createLayoutInstruction = () => {
    const spring = visualPresets[currentPreset].spring;
    const scene = normalizeSemanticOperations(
      [
        transitionCandidateTarget(
          layoutGeometry,
          createCandidateTransitionPolicy("local-container-layout", {
            normal: {
              kind: "layout",
              driver: { kind: "spring", ...spring },
            },
            reduced: { kind: "instant" },
          }),
        ),
      ],
      [layoutGeometry],
    );
    const instruction = lowerCandidatePresentationToWebLayout(scene)[0];
    if (!instruction) throw new Error("Local container needs one retained layout instruction.");
    return instruction;
  };
  const layoutStyleProperties = new Map<HTMLElement, Set<string>>();
  const applyLayoutStyle = (compact: boolean): void => {
    for (const [node, properties] of layoutStyleProperties) {
      for (const property of properties) node.style.removeProperty(property);
    }
    layoutStyleProperties.clear();
    const scene = normalizeSemanticLayout(
      [layoutIdentities.region, layoutIdentities.primary, layoutIdentities.secondary],
      [
        arrangeCandidate(
          layoutIdentities.region,
          [layoutIdentities.primary, layoutIdentities.secondary],
          flowCandidate({
            axis: compact ? "block" : "inline",
            gap: { dimension: "length", value: compact ? 10 : 16 },
            align: "stretch",
            distribute: "start",
            wrap: false,
          }),
        ),
      ],
    );
    for (const instruction of lowerCandidateLayoutToWebStyle(scene)) {
      const node = mounted.nodes.get(instruction.identity);
      if (!(node instanceof HTMLElement)) {
        throw new Error(`Missing layout node "${instruction.identity}".`);
      }
      const properties = new Set<string>();
      for (const declaration of instruction.declarations) {
        node.style.setProperty(declaration.name, declaration.value);
        properties.add(declaration.name);
      }
      layoutStyleProperties.set(node, properties);
    }
    layoutRegion.dataset.layoutMode = compact ? "compact" : "wide";
  };
  const layoutGraph = new RetainedLayoutGraph(createAnimeLayoutBackend());
  const layoutKey = layoutGeometry.key;
  let compactLayout = false;
  const layoutParticipants = () => [
    layoutRegion,
    ...[...layoutRegion.children].filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    ),
  ];
  layoutFrame.style.inlineSize = "100%";
  applyLayoutStyle(compactLayout);
  layoutGraph.register(layoutKey, layoutIdentities.region.key, document.body, layoutParticipants());
  toggleLocalLayout = () => {
    layoutGraph.capture();
    layoutFrame.style.inlineSize = compactLayout ? "100%" : "300px";
    const nextCompact = layoutFrame.getBoundingClientRect().width < 360;
    applyLayoutStyle(nextCompact);
    const definition = createLayoutInstruction().transition;
    const selected = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? definition.reduced
      : definition.normal;
    const driver = selected.kind === "layout" ? selected.driver : selected;
    const transition: MotionTransition =
      driver.kind === "spring"
        ? {
            spring: {
              mass: driver.mass,
              stiffness: driver.stiffness,
              damping: driver.damping,
            },
          }
        : driver.kind === "instant"
          ? "instant"
          : {
              duration: driver.milliseconds,
              easing:
                driver.curve.kind === "linear"
                  ? "linear"
                  : {
                      cubic: [driver.curve.x1, driver.curve.y1, driver.curve.x2, driver.curve.y2],
                    },
            };
    compactLayout = nextCompact;
    status().textContent = `${nextCompact ? "Compact" : "Wide"} layout selected from ${Math.round(layoutFrame.getBoundingClientRect().width)}px local geometry.`;
    void layoutGraph.project(layoutKey, layoutParticipants(), transition);
    layoutGraph.flush();
  };
  const dialogTransition = (): MotionTransition => {
    const spring = visualPresets[currentPreset].spring;
    return {
      spring: { mass: spring.mass, stiffness: spring.stiffness, damping: spring.damping },
    };
  };
  const clearRetainedDialogGeometry = (dialog: HTMLDialogElement): void => {
    dialog.dataset.retained = "false";
    for (const property of ["position", "inset", "margin", "inline-size", "max-inline-size"]) {
      dialog.style.removeProperty(property);
    }
    applySecurityLayout();
  };
  startExit = (velocity = 0) => {
    if (!openState) return;
    const nativeDialog = mounted.nodes.get("BrowserLab.Dialog") as HTMLDialogElement;
    const rectangle = nativeDialog.getBoundingClientRect();
    nativeDialog.dataset.retained = "true";
    nativeDialog.style.position = "fixed";
    nativeDialog.style.inset = `${rectangle.top}px auto auto ${rectangle.left}px`;
    nativeDialog.style.margin = "0";
    nativeDialog.style.inlineSize = `${rectangle.width}px`;
    nativeDialog.style.maxInlineSize = "none";
    backdropChannel.direct(1);
    motionGraph.flush();
    nativeDialog.close();
    applyDialogState(false, true);
    nativeDialog.dataset.exiting = "true";
    (mounted.nodes.get("BrowserLab.Open") as HTMLButtonElement).focus();
    void Promise.all([
      dragChannel.target(window.innerHeight - rectangle.top + 48, dialogTransition(), { velocity }),
      backdropChannel.target(0, dialogTransition()),
    ]).then((outcomes) => {
      if (outcomes.some((outcome) => outcome !== "settled") || openState || !mountedState) return;
      applyDialogState(false, false);
      nativeDialog.dataset.exiting = "false";
      clearRetainedDialogGeometry(nativeDialog);
      dragChannel.direct(0);
      backdropChannel.direct(0);
      motionGraph.flush();
    });
    motionGraph.flush();
  };
  startEnter = (fresh = false) => {
    const nativeDialog = mounted.nodes.get("BrowserLab.Dialog") as HTMLDialogElement;
    nativeDialog.dataset.exiting = "false";
    clearRetainedDialogGeometry(nativeDialog);
    const rectangle = nativeDialog.getBoundingClientRect();
    const compact = document.body.dataset.compact === "true";
    void dragChannel.target(
      0,
      dialogTransition(),
      fresh ? { from: compact ? rectangle.height + 36 : 30 } : undefined,
    );
    void backdropChannel.target(1, dialogTransition(), fresh ? { from: 0 } : undefined);
    motionGraph.flush();
  };
  const gestureScene: CandidateRecognizerScene = {
    intents: [
      {
        name: "dismiss",
        kind: "drag",
        region: "BrowserLab.Dialog",
        activation: {
          axis: "block",
          threshold: { dimension: "length", value: 4 },
        },
        outcomes: [
          { outcome: "closed", action: "BrowserLab.close" },
          { outcome: "open", action: "BrowserLab.restore" },
        ],
        alternative: { kind: "action", action: "BrowserLab.close" },
      },
    ],
    relations: [],
  };
  const gestureMount = mountCandidateGesturesToWeb(
    gestureScene,
    new Map([["BrowserLab.Dialog", mounted.nodes.get("BrowserLab.Dialog") as HTMLDialogElement]]),
    {
      listen(node, event, listener) {
        const wrapped = (value: PointerEvent): void => {
          if (
            event === "pointerdown" &&
            value.target instanceof Element &&
            value.target.closest("button, input, select, textarea, a[href]")
          ) {
            return;
          }
          listener(value);
        };
        node.addEventListener(event, wrapped as EventListener);
        return () => node.removeEventListener(event, wrapped as EventListener);
      },
      touchAction(node, value) {
        const previous = node.style.touchAction;
        node.style.touchAction = value;
        return () => {
          node.style.touchAction = previous;
        };
      },
      capture(node, pointer) {
        node.setPointerCapture(pointer);
      },
      release(node, pointer) {
        if (node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
      },
    },
    (event) => {
      if (event.sample.kind !== "translation") return;
      if (document.body.dataset.compact !== "true") return;
      const value = Math.max(0, event.sample.value.block);
      if (event.phase === "begin" || event.phase === "change") {
        if (!openState) return;
        dragChannel.direct(value);
        motionGraph.flush();
        return;
      }
      const velocity = event.sample.velocity.block / 1000;
      const projected = value + velocity * 180;
      const dismiss = event.phase === "release" && projected >= 120;
      if (dismiss) startExit(velocity);
      else void dragChannel.target(0, dialogTransition(), { velocity });
      motionGraph.flush();
    },
  );
  (window as unknown as Record<string, unknown>).__poggersCandidateEvidence = {
    dispatches,
    updates,
    mounted,
    current: () => current,
    gestureMount,
    generatedNodes,
    layoutGraph,
    motionSamples,
  };
}

function runReconciliationBrowser(): void {
  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; min-block-size: 100%; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { min-block-size: 100dvb; display: grid; place-items: center; background: oklch(0.97 0.01 250); color: oklch(0.2 0.01 250); }
    main { inline-size: min(100% - 32px, 420px); display: grid; gap: 16px; }
    button { min-block-size: 44px; border: 1px solid oklch(0.82 0.01 250); border-radius: 10px; background: white; color: inherit; font: inherit; cursor: pointer; }
    [role="group"] { display: grid; gap: 12px; padding: 24px; border-radius: 18px; background: white; box-shadow: 0 20px 50px oklch(0.2 0.02 250 / 0.14); }
    h1, p { margin: 0; }
  `;
  document.head.append(style);

  const Root = issueCandidateStructurePart("ReconcileLab", "Root", "main");
  const Toggle = issueCandidateStructurePart("ReconcileLab", "Toggle", "button");
  const Default = issueCandidateStructurePart("ReconcileLab", "Default", "div");
  const DefaultTitle = issueCandidateStructurePart("ReconcileLab", "DefaultTitle", "h1");
  const DefaultAction = issueCandidateStructurePart("ReconcileLab", "DefaultAction", "button");
  const Detail = issueCandidateStructurePart("ReconcileLab", "Detail", "div");
  const DetailTitle = issueCandidateStructurePart("ReconcileLab", "DetailTitle", "h1");
  const DetailAction = issueCandidateStructurePart("ReconcileLab", "DetailAction", "button");
  const defaultAction = DefaultAction(
    { name: "Continue", activate: issueCandidateAction("ReconcileLab.toggle") },
    "Continue",
  );
  const detailAction = DetailAction(
    { name: "Return", activate: issueCandidateAction("ReconcileLab.toggle") },
    "Return",
  );
  const detailRead = createCandidateReadExpression<boolean>("view.detail");
  const hierarchy = Root(
    {},
    Toggle(
      { name: "Switch view", activate: issueCandidateAction("ReconcileLab.toggle") },
      "Switch view",
    ),
    selectCandidateStructure<boolean>(detailRead, {
      true: {
        content: Detail(
          { name: "Detail", role: "group" },
          DetailTitle({}, "Detail view"),
          detailAction,
        ),
        focus: detailAction.reference,
      },
      false: {
        content: Default(
          { name: "Default", role: "group" },
          DefaultTitle({}, "Default view"),
          defaultAction,
        ),
        focus: defaultAction.reference,
      },
    }),
  );
  const structure = (detail: boolean) =>
    normalizeCandidateStructure(hierarchy, { reads: { "view.detail": detail } });
  const activeAnimations = new Map<Node, Animation>();
  const retainedStyles = new Map<HTMLElement, string>();
  let nativeInstance = 0;
  const platform = {
    create(element: string): Node {
      const node = document.createElement(element);
      node.dataset.nativeInstance = String(++nativeInstance);
      return node;
    },
    text(value: string): Node {
      return document.createTextNode(value);
    },
    textValue(node: Node, value: string): void {
      node.nodeValue = value;
    },
    attribute(node: Node, name: string, value: string | number | boolean | undefined): void {
      if (!(node instanceof Element)) return;
      if (value === undefined) node.removeAttribute(name);
      else node.setAttribute(name, String(value));
    },
    property(node: Node, name: string, value: string | number | boolean | undefined): void {
      if (!(node instanceof HTMLElement)) return;
      const current = (node as unknown as Record<string, unknown>)[name];
      (node as unknown as Record<string, unknown>)[name] =
        value ?? (typeof current === "boolean" ? false : "");
    },
    listen(node: Node, event: string, listener: (event: Event) => void): () => void {
      node.addEventListener(event, listener);
      return () => node.removeEventListener(event, listener);
    },
    append(parent: Node, child: Node): void {
      parent.appendChild(child);
    },
    place(parent: Node, child: Node, index: number): void {
      parent.insertBefore(child, parent.childNodes.item(index));
    },
    remove(node: Node): void {
      node.parentNode?.removeChild(node);
    },
    retain(node: Node): void {
      if (!(node instanceof HTMLElement)) return;
      const rect = node.getBoundingClientRect();
      retainedStyles.set(node, node.style.cssText);
      Object.assign(node.style, {
        position: "fixed",
        inset: "auto",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        zIndex: "10",
        pointerEvents: "none",
      });
      document.body.append(node);
    },
    restore(node: Node): void {
      activeAnimations.get(node)?.cancel();
      activeAnimations.delete(node);
      if (!(node instanceof HTMLElement)) return;
      node.style.cssText = retainedStyles.get(node) ?? "";
      retainedStyles.delete(node);
    },
    focusedIdentity(): string | undefined {
      return document.activeElement?.id || undefined;
    },
    focus(node: Node): void {
      if (node instanceof HTMLElement) node.focus();
    },
    activateModal(): void {},
    deactivateModal(): void {},
  };
  let detail = false;
  let switchView = (): void => {};
  const mounted = mountCandidateReconciledStructureToWeb<Node, Event>(
    structure(detail),
    platform,
    (action) => {
      if (action === "ReconcileLab.toggle") switchView();
    },
  );
  document.getElementById("app")!.append(...mounted.roots);
  switchView = () => {
    const outgoing = detail ? "ReconcileLab.Detail" : "ReconcileLab.Default";
    detail = !detail;
    const transaction = mounted.reconcile(structure(detail), { retain: [outgoing] });
    for (const retained of transaction.retained) {
      const node = mounted.nodes.get(retained.identity);
      if (!(node instanceof HTMLElement)) continue;
      const animation = node.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(.96)" },
        ],
        { duration: 180, easing: "cubic-bezier(.26,.08,.25,1)", fill: "forwards" },
      );
      activeAnimations.set(node, animation);
      void animation.finished.then(
        () => {
          if (mounted.settleExit(retained.identity, retained.revision)) {
            activeAnimations.delete(node);
            retainedStyles.delete(node);
          }
        },
        () => {},
      );
    }
    const incoming = mounted.nodes.get(detail ? "ReconcileLab.Detail" : "ReconcileLab.Default");
    if (incoming instanceof HTMLElement && !transaction.reversed.length) {
      incoming.animate(
        [
          { opacity: 0, transform: "scale(.96)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 180, easing: "cubic-bezier(.26,.08,.25,1)" },
      );
    }
    document.body.dataset.reconciliation = JSON.stringify({
      detail,
      entering: transaction.entering,
      exiting: transaction.exiting,
      reversed: transaction.reversed,
      retained: transaction.retained,
    });
  };
  (window as unknown as Record<string, unknown>).__poggersReconciliationEvidence = {
    mounted,
    switchView,
  };
}

if (typeof document === "undefined") await runServer();
else if (new URLSearchParams(location.search).get("case") === "reconciliation") {
  runReconciliationBrowser();
} else if (new URLSearchParams(location.search).get("case") === "family") {
  runFamilyCandidateBrowser();
} else runBrowser();
