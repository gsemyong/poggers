import { familyIcons } from "../../apps/visual-lab/src/family-icons";
import {
  aboveCandidate,
  anchorCandidate,
  arrangeCandidate,
  constrainCandidateSize,
  createCandidateDerivedTargetHandle,
  createCandidateLayer,
  createCandidatePresentationIdentity,
  createCandidateReadExpression,
  createCandidateTargetHandle,
  createCandidateTransitionPolicy,
  flowCandidate,
  gridCandidate,
  issueCandidateAction,
  issueCandidateStructurePart,
  isolateCandidate,
  lowerCandidateWebSceneToStyle,
  lowerCandidatePresentationToWebLayout,
  mountCandidateGesturesToWeb,
  mountCandidateReconciledStructureToWeb,
  normalizeCandidateStructure,
  normalizeSemanticLayout,
  normalizeSemanticOperations,
  normalizeSemanticRelationships,
  notCandidate,
  overlayCandidate,
  padCandidate,
  planCandidatePresenceCommands,
  setCandidateTarget,
  selectCandidateStructure,
  transitionCandidateTarget,
  type CandidateGeometry,
  type CandidatePaint,
  type CandidateRecognizerScene,
  type CandidateSemanticScene,
} from "../../packages/kit/tests/ui-language-candidates";
import {
  createAnimeLayoutBackend,
  createAnimeMotionBackend,
  RetainedLayoutGraph,
  RetainedMotionGraph,
  type MotionTransition,
} from "../../packages/kit/src/visual-motion";

type FamilyView = "default" | "key" | "phrase" | "remove";

const length = (value: number) => ({ dimension: "length" as const, value });
const paint = (lightness: number, chroma: number, hue: number, alpha = 1): CandidatePaint => ({
  kind: "solid",
  color: { colorSpace: "oklch", lightness, chroma, hue, alpha },
});
const rectangle = (radius: number) => ({
  kind: "rectangle" as const,
  corners: {
    startStart: { radius: length(radius), smoothing: 0 },
    startEnd: { radius: length(radius), smoothing: 0 },
    endStart: { radius: length(radius), smoothing: 0 },
    endEnd: { radius: length(radius), smoothing: 0 },
  },
});
const typeStyle = (
  size: number,
  weight: number,
  lineHeight: number,
  colorAlign: "start" | "center" = "start",
) => ({
  families: ["Open Runde", "Inter", "ui-rounded", "system-ui", "sans-serif"],
  size: length(size),
  lineHeight: length(lineHeight),
  weight,
  tracking: length(0),
  align: colorAlign,
  wrap: "wrap" as const,
  overflow: "clip" as const,
  decoration: "none" as const,
  variations: {},
});

export function runFamilyCandidateBrowser(): void {
  const reset = document.createElement("style");
  reset.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html { color-scheme: light; font-family: "Open Runde", Inter, ui-rounded, system-ui, sans-serif; }
    html, body, #app { margin: 0; min-block-size: 100%; }
    body { min-block-size: 100dvb; overflow: clip; background: oklch(0.97 0.003 250); color: oklch(0.252 0 0); }
    button, dialog { color: inherit; font: inherit; }
    button { border: 0; padding: 0; cursor: pointer; }
    dialog { z-index: 1001; border: 0; padding: 0; overflow: clip; max-inline-size: none; max-block-size: none; }
    dialog::backdrop { background: transparent; }
    dialog[data-retained="true"] { display: block; }
    dialog[data-exiting="true"] { pointer-events: none; }
    img { display: block; }
    h2, p, ul { margin: 0; padding: 0; }
    li { list-style: none; }
    :focus-visible, [data-forced-focus-visible="true"] { outline: 2px solid oklch(0.72 0.16 246); outline-offset: 2px; }
  `;
  document.head.append(reset);

  const Root = issueCandidateStructurePart("Family", "Root", "main");
  const Trigger = issueCandidateStructurePart("Family", "Trigger", "button");
  const Dialog = issueCandidateStructurePart("Family", "Dialog", "dialog");
  const Close = issueCandidateStructurePart("Family", "Close", "button");
  const Icon = issueCandidateStructurePart("Family", "Icon", "img");
  const Viewport = issueCandidateStructurePart("Family", "Viewport", "div");
  const View = issueCandidateStructurePart("Family", "View", "div");
  const Header = issueCandidateStructurePart("Family", "Header", "header");
  const TitleCopy = issueCandidateStructurePart("Family", "TitleCopy", "div");
  const Title = issueCandidateStructurePart("Family", "Title", "h2");
  const Description = issueCandidateStructurePart("Family", "Description", "p");
  const OptionList = issueCandidateStructurePart("Family", "OptionList", "div");
  const Option = issueCandidateStructurePart("Family", "Option", "button");
  const Advice = issueCandidateStructurePart("Family", "Advice", "ul");
  const AdviceItem = issueCandidateStructurePart("Family", "AdviceItem", "li");
  const Actions = issueCandidateStructurePart("Family", "Actions", "div");
  const Action = issueCandidateStructurePart("Family", "Action", "button");

  const openAction = issueCandidateAction("Family.open");
  const closeAction = issueCandidateAction("Family.close");
  const backAction = issueCandidateAction("Family.back");
  const keyAction = issueCandidateAction("Family.key");
  const phraseAction = issueCandidateAction("Family.phrase");
  const removeAction = issueCandidateAction("Family.remove");
  const revealAction = issueCandidateAction("Family.reveal");
  const continueAction = issueCandidateAction("Family.continue");

  const option = (
    key: "key" | "phrase" | "remove",
    name: string,
    source: string,
    action: ReturnType<typeof issueCandidateAction>,
  ) =>
    Option(
      { key, name, activate: action },
      Icon({
        key: `option-${key}`,
        source,
        alternative: { kind: "decorative" },
      }),
      name,
    );
  const defaultKey = option("key", "View Private Key", familyIcons.lock, keyAction);
  const defaultPhrase = option("phrase", "View Recovery Phase", familyIcons.phrase, phraseAction);
  const defaultRemove = option("remove", "Remove Wallet", familyIcons.warning, removeAction);
  const defaultTitle = Title({ key: "default" }, "Options");
  const defaultHeader = Header({ key: "default" }, defaultTitle);
  const defaultView = View(
    { key: "default", role: "group", name: "Wallet options" },
    defaultHeader,
    OptionList({ key: "default" }, defaultKey, defaultPhrase, defaultRemove),
  );

  const advice = (view: "key" | "phrase", labels: readonly [string, string, string]) =>
    Advice(
      { key: view },
      AdviceItem(
        { key: `${view}-safe` },
        Icon({
          key: `${view}-shield`,
          source: familyIcons.shield,
          alternative: { kind: "decorative" },
        }),
        labels[0],
      ),
      AdviceItem(
        { key: `${view}-share` },
        Icon({
          key: `${view}-pass`,
          source: familyIcons.pass,
          alternative: { kind: "decorative" },
        }),
        labels[1],
      ),
      AdviceItem(
        { key: `${view}-loss` },
        Icon({
          key: `${view}-banned`,
          source: familyIcons.banned,
          alternative: { kind: "decorative" },
        }),
        labels[2],
      ),
    );

  const detail = (
    view: "key" | "phrase",
    title: string,
    description: string,
    labels: readonly [string, string, string],
  ) => {
    const cancel = Action(
      { key: `${view}-cancel`, name: "Cancel", activate: backAction },
      "Cancel",
    );
    const reveal = Action(
      { key: `${view}-reveal`, name: "Reveal", activate: revealAction },
      Icon({
        key: `${view}-face-id`,
        source: familyIcons.faceId,
        alternative: { kind: "decorative" },
      }),
      "Reveal",
    );
    return {
      focus: cancel.reference,
      root: View(
        { key: view, role: "group", name: title },
        Header(
          { key: view },
          Icon({
            key: `${view}-hero`,
            source: familyIcons.recovery,
            alternative: { kind: "decorative" },
          }),
          TitleCopy(
            { key: view },
            Title({ key: view }, title),
            Description({ key: view }, description),
          ),
        ),
        advice(view, labels),
        Actions({ key: view }, cancel, reveal),
      ),
    };
  };

  const keyView = detail(
    "key",
    "Private Key",
    "Your Private Key is the key used to back up your wallet. Keep it secret and secure at all times.",
    [
      "Keep your private key safe",
      "Don’t share it with anyone else",
      "If you lose it, we can’t recover it",
    ],
  );
  const phraseView = detail(
    "phrase",
    "Secret Recovery Phrase",
    "Your Secret Recovery Phrase is the key used to back up your wallet. Keep it secret at all times.",
    [
      "Keep your Secret Phrase safe",
      "Don’t share it with anyone else",
      "If you lose it, we can’t recover it",
    ],
  );
  const removeCancel = Action(
    { key: "remove-cancel", name: "Cancel", activate: backAction },
    "Cancel",
  );
  const removeContinue = Action(
    { key: "remove-continue", name: "Continue", activate: continueAction },
    "Continue",
  );
  const removeView = View(
    { key: "remove", role: "group", name: "Remove wallet confirmation" },
    Header(
      { key: "remove" },
      Icon({
        key: "remove-hero",
        source: familyIcons.danger,
        alternative: { kind: "decorative" },
      }),
      TitleCopy(
        { key: "remove" },
        Title({ key: "remove" }, "Are you sure?"),
        Description(
          { key: "remove" },
          "You haven’t backed up your wallet yet. If you remove it, you could lose access forever. We suggest tapping and backing up your wallet first with a valid recovery method.",
        ),
      ),
    ),
    Actions({ key: "remove" }, removeCancel, removeContinue),
  );

  const closeIcon = Icon({
    key: "close",
    source: familyIcons.close,
    alternative: { kind: "decorative" },
  });
  const close = Close({ name: "Close drawer", activate: closeAction }, closeIcon);
  const dialogRead = createCandidateReadExpression<boolean>("family.open");
  const mountedRead = createCandidateReadExpression<boolean>("family.mounted");
  const viewRead = createCandidateReadExpression<FamilyView>("family.view");
  const dialog = Dialog(
    {
      name: "Wallet options",
      modal: dialogRead,
      hidden: notCandidate(mountedRead),
      inert: notCandidate(dialogRead),
      dismiss: closeAction,
    },
    close,
    Viewport(
      {},
      selectCandidateStructure<FamilyView>(viewRead, {
        default: { content: defaultView, focus: defaultKey.reference },
        key: { content: keyView.root, focus: keyView.focus },
        phrase: { content: phraseView.root, focus: phraseView.focus },
        remove: { content: removeView, focus: removeCancel.reference },
      }),
    ),
  );
  const trigger = Trigger(
    {
      name: "Try it out",
      controls: dialog.reference,
      popup: "dialog",
      expanded: dialogRead,
      activate: openAction,
    },
    "Try it out",
  );
  const hierarchy = Root({}, trigger, dialog);

  const normalize = (view: FamilyView, open: boolean, mounted: boolean) =>
    normalizeCandidateStructure(hierarchy, {
      reads: { "family.view": view, "family.open": open, "family.mounted": mounted },
      ...(open
        ? {
            activeModal: {
              identity: dialog.reference,
              initialFocus: close.reference,
              returnFocus: trigger.reference,
            },
          }
        : {}),
    });

  const retainedStyles = new Map<HTMLElement, string>();
  const activeAnimations = new Map<Node, Animation>();
  const platform = {
    create(element: string): Node {
      return document.createElement(element);
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
      const bounds = node.getBoundingClientRect();
      retainedStyles.set(node, node.style.cssText);
      Object.assign(node.style, {
        position: "fixed",
        inset: "auto",
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        margin: "0",
        pointerEvents: "none",
        zIndex: "1002",
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
    activateModal(node: Node, initialFocus: Node, focusVisibility: "visible"): void {
      if (node instanceof HTMLDialogElement && !node.open) node.showModal();
      if (initialFocus instanceof HTMLElement) {
        if (focusVisibility === "visible") {
          initialFocus.setAttribute("data-forced-focus-visible", "true");
        }
        initialFocus.addEventListener(
          "blur",
          () => initialFocus.removeAttribute("data-forced-focus-visible"),
          { once: true },
        );
        initialFocus.focus({ preventScroll: true, focusVisible: true } as FocusOptions & {
          focusVisible: true;
        });
      }
      queueMicrotask(() => {
        if (
          node instanceof HTMLDialogElement &&
          node.open &&
          initialFocus instanceof HTMLElement &&
          !node.contains(document.activeElement)
        ) {
          initialFocus.focus({ preventScroll: true, focusVisible: true } as FocusOptions & {
            focusVisible: true;
          });
        }
      });
    },
    deactivateModal(node: Node, returnFocus: Node): void {
      if (!(node instanceof HTMLDialogElement) || !(returnFocus instanceof HTMLElement)) return;
      node.addEventListener(
        "close",
        () => {
          requestAnimationFrame(() => {
            if (
              !node.open &&
              (document.activeElement === document.body || node.contains(document.activeElement))
            ) {
              returnFocus.focus({ preventScroll: true });
            }
          });
        },
        { once: true },
      );
      if (node.open) node.close();
      returnFocus.focus({ preventScroll: true });
    },
  };

  let view: FamilyView = "default";
  let open = false;
  let present = false;
  let dispatch = (_action: string): void => {};
  const mounted = mountCandidateReconciledStructureToWeb<Node, Event>(
    normalize(view, open, present),
    platform,
    (action) => dispatch(action),
  );
  document.getElementById("app")!.append(...mounted.roots);

  const Backdrop = createCandidateLayer(
    createCandidatePresentationIdentity("Family.Dialog"),
    "backdrop",
  );
  const defaultSeparator = createCandidateLayer(
    createCandidatePresentationIdentity(defaultHeader.identity),
    "separator",
  );
  const adviceSeparators = (["key", "phrase"] as const).map((key) =>
    createCandidateLayer(createCandidatePresentationIdentity(`Family.Advice:${key}`), "separator"),
  );
  const generated = [Backdrop, defaultSeparator, ...adviceSeparators];
  const generatedNodes = new Map<string, HTMLElement>();

  const ink = paint(0.252, 0, 0);
  const muted = paint(0.683, 0, 0);
  const panel = paint(0.998, 0.002, 145);
  const control = paint(0.977, 0.003, 250);
  const secondary = paint(0.958, 0.005, 250);
  const blue = paint(0.738, 0.154, 246);
  const danger = paint(0.655, 0.236, 27);
  const dangerSoft = paint(0.969, 0.023, 24);
  const white = paint(1, 0, 0);
  const line = paint(0.976, 0, 0);
  const triggerLine = paint(0.906, 0, 0);
  const target = (
    identity: string,
    property: string,
    valueType: Parameters<typeof createCandidateTargetHandle>[2],
  ) => createCandidateTargetHandle(identity, property, valueType);
  const set = (
    identity: string,
    property: string,
    valueType: Parameters<typeof createCandidateTargetHandle>[2],
    value: unknown,
  ) => setCandidateTarget(target(identity, property, valueType), value as never);

  const allViews: readonly FamilyView[] = ["default", "key", "phrase", "remove"];
  const allSemanticIdentities = [
    ...new Set(
      allViews.flatMap((candidateView) =>
        normalize(candidateView, false, true).nodes.map((node) => node.identity),
      ),
    ),
  ];
  const presentation: CandidateSemanticScene = normalizeSemanticOperations([
    set("Family.Trigger", "fill", "paint", panel),
    set("Family.Trigger", "foreground", "paint", ink),
    set("Family.Trigger", "shape", "shape", { kind: "capsule" }),
    set("Family.Trigger", "stroke", "stroke", {
      paint: triggerLine,
      width: length(1),
      placement: "inside",
    }),
    set("Family.Trigger", "type", "type", typeStyle(14, 500, 14, "center")),
    set("Family.Dialog", "fill", "paint", panel),
    set("Family.Dialog", "shape", "shape", rectangle(36)),
    set("Family.Dialog", "foreground", "paint", ink),
    set("Family.Close", "fill", "paint", control),
    set("Family.Close", "shape", "shape", { kind: "capsule" }),
    set("Family.Title:default", "type", "type", typeStyle(19, 500, 23)),
    ...(["key", "phrase", "remove"] as const).flatMap((candidateView) => [
      set(`Family.Title:${candidateView}`, "type", "type", typeStyle(22, 500, 26.4)),
      set(`Family.Description:${candidateView}`, "foreground", "paint", muted),
      set(`Family.Description:${candidateView}`, "type", "type", typeStyle(17, 400, 24)),
    ]),
    ...(["key", "phrase", "remove"] as const).flatMap((candidateView) => {
      const cancel = `Family.Action:${candidateView}-cancel`;
      const confirm = `Family.Action:${candidateView}-${candidateView === "remove" ? "continue" : "reveal"}`;
      return [
        set(cancel, "fill", "paint", secondary),
        set(cancel, "foreground", "paint", ink),
        set(cancel, "shape", "shape", { kind: "capsule" }),
        set(cancel, "type", "type", typeStyle(19, 500, 19, "center")),
        set(confirm, "fill", "paint", candidateView === "remove" ? danger : blue),
        set(confirm, "foreground", "paint", white),
        set(confirm, "shape", "shape", { kind: "capsule" }),
        set(confirm, "type", "type", typeStyle(19, 500, 19, "center")),
      ];
    }),
    ...(["key", "phrase", "remove"] as const).flatMap((key) => {
      const identity = `Family.Option:${key}`;
      const destructive = key === "remove";
      return [
        set(identity, "fill", "paint", destructive ? dangerSoft : control),
        set(identity, "foreground", "paint", destructive ? danger : ink),
        set(identity, "shape", "shape", rectangle(16)),
        set(identity, "type", "type", typeStyle(17, 500, 17)),
      ];
    }),
    ...(["key", "phrase"] as const).flatMap((candidateView) =>
      (["safe", "share", "loss"] as const).flatMap((item) => {
        const identity = `Family.AdviceItem:${candidateView}-${item}`;
        return [
          set(identity, "foreground", "paint", muted),
          set(identity, "type", "type", typeStyle(15, 500, 18)),
        ];
      }),
    ),
    ...allSemanticIdentities
      .filter((identity) => identity.startsWith("Family.Icon:"))
      .map((identity) =>
        set(identity, "mediaFit", "media-fit", {
          mode: "contain",
          focalPoint: { inline: 0.5, block: 0.5 },
        }),
      ),
    setCandidateTarget(Backdrop.fill, paint(0, 0, 0, 0.3)),
    setCandidateTarget(defaultSeparator.fill, line),
    ...adviceSeparators.map((separator) => setCandidateTarget(separator.fill, line)),
  ]);

  const ensureGeneratedNode = (
    identity: string,
    ownerIdentity: string,
  ): HTMLElement | undefined => {
    const owner = mounted.nodes.get(ownerIdentity);
    if (!(owner instanceof HTMLElement)) return undefined;
    let node = generatedNodes.get(identity);
    if (!node || (!node.isConnected && identity !== Backdrop.identity.key)) {
      node = document.createElement("div");
      node.dataset.generatedIdentity = identity;
      node.dataset.generatedOwner = ownerIdentity;
      node.setAttribute("aria-hidden", "true");
      node.inert = true;
      generatedNodes.set(identity, node);
    }
    if (identity === Backdrop.identity.key) {
      if (!node.isConnected) document.body.insertBefore(node, document.getElementById("app"));
    } else if (node.parentNode !== owner) {
      owner.append(node);
    }
    return node;
  };

  const identity = (value: string) => createCandidatePresentationIdentity(value);
  const generatedIdentities = generated.map((layer) => layer.identity.key);
  const allLayoutIdentities = [...new Set([...allSemanticIdentities, ...generatedIdentities])].map(
    identity,
  );
  const optionIdentities = (["key", "phrase", "remove"] as const).map((key) =>
    identity(`Family.Option:${key}`),
  );
  const viewIdentities = allViews.map((candidateView) => identity(`Family.View:${candidateView}`));
  const layoutContributions = [
    anchorCandidate(identity("Family.Trigger"), "viewport", {
      inline: "center",
      block: "center",
      insets: {
        inlineStart: length(0),
        inlineEnd: length(0),
        blockStart: length(0),
        blockEnd: length(0),
      },
    }),
    anchorCandidate(identity("Family.Dialog"), "viewport", {
      inline: "center",
      block: "end",
      insets: {
        inlineStart: length(16),
        inlineEnd: length(16),
        blockStart: length(0),
        blockEnd: length(16),
      },
    }),
    anchorCandidate(Backdrop, "viewport", {
      inline: "stretch",
      block: "stretch",
      insets: {
        inlineStart: length(0),
        inlineEnd: length(0),
        blockStart: length(0),
        blockEnd: length(0),
      },
    }),
    arrangeCandidate(
      identity("Family.Dialog"),
      [identity("Family.Viewport")],
      overlayCandidate({ align: "stretch" }),
    ),
    anchorCandidate(identity("Family.Close"), identity("Family.Dialog"), {
      inline: "end",
      block: "start",
      insets: {
        inlineStart: length(0),
        inlineEnd: length(32),
        blockStart: length(28),
        blockEnd: length(0),
      },
    }),
    arrangeCandidate(
      identity("Family.Close"),
      [identity("Family.Icon:close")],
      overlayCandidate({ align: "center" }),
    ),
    arrangeCandidate(
      identity("Family.Viewport"),
      viewIdentities,
      overlayCandidate({ align: "stretch" }),
    ),
    arrangeCandidate(
      identity("Family.View:default"),
      [identity("Family.Header:default"), identity("Family.OptionList:default")],
      flowCandidate({
        axis: "block",
        gap: length(16),
        align: "stretch",
        distribute: "start",
        wrap: false,
      }),
    ),
    arrangeCandidate(
      identity("Family.Header:default"),
      [identity("Family.Title:default")],
      flowCandidate({
        axis: "inline",
        gap: length(0),
        align: "center",
        distribute: "start",
        wrap: false,
      }),
    ),
    arrangeCandidate(
      identity("Family.OptionList:default"),
      optionIdentities,
      flowCandidate({
        axis: "block",
        gap: length(12),
        align: "stretch",
        distribute: "start",
        wrap: false,
      }),
    ),
    ...(["key", "phrase", "remove"] as const).flatMap((candidateView) => {
      const header = identity(`Family.Header:${candidateView}`);
      const titleCopy = identity(`Family.TitleCopy:${candidateView}`);
      const actions = identity(`Family.Actions:${candidateView}`);
      const detailChildren =
        candidateView === "remove"
          ? [header, actions]
          : [header, identity(`Family.Advice:${candidateView}`), actions];
      return [
        arrangeCandidate(
          identity(`Family.View:${candidateView}`),
          detailChildren,
          flowCandidate({
            axis: "block",
            gap: length(24),
            align: "stretch",
            distribute: "start",
            wrap: false,
          }),
        ),
        arrangeCandidate(
          header,
          [identity(`Family.Icon:${candidateView}-hero`), titleCopy],
          flowCandidate({
            axis: "block",
            gap: length(10),
            align: "stretch",
            distribute: "start",
            wrap: false,
          }),
        ),
        arrangeCandidate(
          titleCopy,
          [
            identity(`Family.Title:${candidateView}`),
            identity(`Family.Description:${candidateView}`),
          ],
          flowCandidate({
            axis: "block",
            gap: length(12),
            align: "stretch",
            distribute: "start",
            wrap: false,
          }),
        ),
        arrangeCandidate(
          actions,
          [
            identity(`Family.Action:${candidateView}-cancel`),
            identity(
              `Family.Action:${candidateView}-${candidateView === "remove" ? "continue" : "reveal"}`,
            ),
          ],
          gridCandidate({
            columns: [
              { size: "fraction", value: 1 },
              { size: "fraction", value: 1 },
            ],
            rows: [{ size: "intrinsic" }],
            gap: length(16),
          }),
        ),
      ];
    }),
    ...(["key", "phrase"] as const).flatMap((candidateView) => {
      const items = (["safe", "share", "loss"] as const).map((item) =>
        identity(`Family.AdviceItem:${candidateView}-${item}`),
      );
      return [
        arrangeCandidate(
          identity(`Family.Advice:${candidateView}`),
          items,
          flowCandidate({
            axis: "block",
            gap: length(16),
            align: "stretch",
            distribute: "start",
            wrap: false,
          }),
        ),
        ...items.map((item, index) =>
          arrangeCandidate(
            item,
            [identity(`Family.Icon:${candidateView}-${["shield", "pass", "banned"][index]}`)],
            flowCandidate({
              axis: "inline",
              gap: length(12),
              align: "center",
              distribute: "start",
              wrap: false,
            }),
          ),
        ),
      ];
    }),
    ...optionIdentities.map((optionIdentity, index) =>
      arrangeCandidate(
        optionIdentity,
        [identity(`Family.Icon:option-${["key", "phrase", "remove"][index]}`)],
        flowCandidate({
          axis: "inline",
          gap: length(15),
          align: "center",
          distribute: "start",
          wrap: false,
        }),
      ),
    ),
    ...(["key", "phrase"] as const).map((candidateView) =>
      arrangeCandidate(
        identity(`Family.Action:${candidateView}-reveal`),
        [identity(`Family.Icon:${candidateView}-face-id`)],
        flowCandidate({
          axis: "inline",
          gap: length(15),
          align: "center",
          distribute: "center",
          wrap: false,
        }),
      ),
    ),
    arrangeCandidate(
      identity("Family.Action:remove-continue"),
      [],
      overlayCandidate({ align: "center" }),
    ),
    arrangeCandidate(
      identity("Family.Action:remove-cancel"),
      [],
      overlayCandidate({ align: "center" }),
    ),
    ...(["key", "phrase"] as const).map((candidateView) =>
      arrangeCandidate(
        identity(`Family.Action:${candidateView}-cancel`),
        [],
        overlayCandidate({ align: "center" }),
      ),
    ),
    constrainCandidateSize(identity("Family.Trigger"), {
      inline: { ideal: { size: "intrinsic" } },
      block: { ideal: length(44) },
    }),
    padCandidate(identity("Family.Trigger"), {
      inlineStart: length(16),
      inlineEnd: length(16),
      blockStart: length(0),
      blockEnd: length(0),
    }),
    constrainCandidateSize(identity("Family.Dialog"), {
      inline: { minimum: length(280), ideal: length(361), maximum: { size: "available" } },
    }),
    padCandidate(identity("Family.Viewport"), {
      inlineStart: length(24),
      inlineEnd: length(24),
      blockStart: length(10),
      blockEnd: length(24),
    }),
    constrainCandidateSize(identity("Family.Close"), {
      inline: { ideal: length(32) },
      block: { ideal: length(32) },
    }),
    constrainCandidateSize(identity("Family.Icon:close"), {
      inline: { ideal: length(12) },
      block: { ideal: length(12) },
    }),
    constrainCandidateSize(identity("Family.Header:default"), { block: { ideal: length(72) } }),
    padCandidate(identity("Family.Header:default"), {
      inlineStart: length(8),
      inlineEnd: length(32),
      blockStart: length(0),
      blockEnd: length(0),
    }),
    ...optionIdentities.flatMap((optionIdentity) => [
      constrainCandidateSize(optionIdentity, { block: { ideal: length(48) } }),
      padCandidate(optionIdentity, {
        inlineStart: length(16),
        inlineEnd: length(16),
        blockStart: length(0),
        blockEnd: length(0),
      }),
    ]),
    ...(["key", "phrase", "remove"] as const).flatMap((candidateView) => [
      padCandidate(identity(`Family.View:${candidateView}`), {
        inlineStart: length(0),
        inlineEnd: length(0),
        blockStart: length(21),
        blockEnd: length(7),
      }),
      padCandidate(identity(`Family.Header:${candidateView}`), {
        inlineStart: length(8),
        inlineEnd: length(8),
        blockStart: length(0),
        blockEnd: length(0),
      }),
      padCandidate(identity(`Family.Actions:${candidateView}`), {
        inlineStart: length(0),
        inlineEnd: length(0),
        blockStart: length(4),
        blockEnd: length(0),
      }),
      constrainCandidateSize(identity(`Family.Icon:${candidateView}-hero`), {
        inline: { ideal: length(48) },
        block: { ideal: length(48) },
      }),
      constrainCandidateSize(identity(`Family.Action:${candidateView}-cancel`), {
        block: { ideal: length(48) },
      }),
      constrainCandidateSize(
        identity(
          `Family.Action:${candidateView}-${candidateView === "remove" ? "continue" : "reveal"}`,
        ),
        { block: { ideal: length(48) } },
      ),
    ]),
    ...allSemanticIdentities
      .filter((value) =>
        /Family\.Icon:(?:option-|key-(?:shield|pass|banned)|phrase-(?:shield|pass|banned))/.test(
          value,
        ),
      )
      .map((value) =>
        constrainCandidateSize(identity(value), {
          inline: { ideal: length(24) },
          block: { ideal: length(24) },
        }),
      ),
    ...(["key", "phrase"] as const).map((candidateView) =>
      padCandidate(identity(`Family.Advice:${candidateView}`), {
        inlineStart: length(8),
        inlineEnd: length(8),
        blockStart: length(25),
        blockEnd: length(0),
      }),
    ),
    anchorCandidate(defaultSeparator, identity("Family.Header:default"), {
      inline: "stretch",
      block: "end",
      insets: {
        inlineStart: length(0),
        inlineEnd: length(0),
        blockStart: length(0),
        blockEnd: length(0),
      },
    }),
    constrainCandidateSize(defaultSeparator, { block: { ideal: length(1) } }),
    ...adviceSeparators.flatMap((separator, index) => [
      anchorCandidate(separator, identity(`Family.Advice:${["key", "phrase"][index]}`), {
        inline: "stretch",
        block: "start",
        insets: {
          inlineStart: length(0),
          inlineEnd: length(0),
          blockStart: length(0),
          blockEnd: length(0),
        },
      }),
      constrainCandidateSize(separator, { block: { ideal: length(1) } }),
    ]),
  ];
  const layout = normalizeSemanticLayout(allLayoutIdentities, layoutContributions);
  const relationships = normalizeSemanticRelationships(allLayoutIdentities, [
    aboveCandidate(identity("Family.Close"), identity("Family.Viewport")),
    aboveCandidate(identity("Family.Dialog"), Backdrop),
    isolateCandidate(identity("Family.Dialog")),
  ]);
  const applyScene = (): void => {
    for (const instruction of lowerCandidateWebSceneToStyle({
      structure: normalize(view, open, present),
      presentation,
      layout,
    })) {
      let node =
        mounted.nodes.get(instruction.identity) ?? generatedNodes.get(instruction.identity);
      if (instruction.generated) {
        node = ensureGeneratedNode(instruction.generated.identity, instruction.generated.owner);
      }
      if (!(node instanceof HTMLElement)) continue;
      for (const declaration of instruction.declarations) {
        node.style.setProperty(declaration.name, declaration.value);
      }
    }
  };
  const applyComposition = (): void => {
    for (const [index, nodeIdentity] of relationships.composition.entries()) {
      const node = mounted.nodes.get(nodeIdentity) ?? generatedNodes.get(nodeIdentity);
      if (node instanceof HTMLElement) node.style.zIndex = String(index);
    }
    for (const nodeIdentity of relationships.isolates) {
      const node = mounted.nodes.get(nodeIdentity) ?? generatedNodes.get(nodeIdentity);
      if (node instanceof HTMLElement) node.style.isolation = "isolate";
    }
  };

  applyScene();
  applyComposition();
  const nativeDialog = mounted.nodes.get("Family.Dialog") as HTMLDialogElement;
  const backdropNode = ensureGeneratedNode(Backdrop.identity.key, Backdrop.owner.key)!;
  backdropNode.style.opacity = "0";

  const motionSamples: { key: string; value: number }[] = [];
  const motionGraph = new RetainedMotionGraph(
    createAnimeMotionBackend({
      render(key, value) {
        motionSamples.push({ key, value });
        if (motionSamples.length > 360) motionSamples.shift();
        if (key === "Family.Dialog:translation.block") {
          nativeDialog.style.translate = `0 ${Math.max(0, value)}px`;
        } else if (key === Backdrop.opacity.key) {
          backdropNode.style.opacity = String(Math.min(1, Math.max(0, value)));
        } else if (key.endsWith(":viewOpacity")) {
          const viewIdentity = key.slice(0, -":viewOpacity".length);
          const node = mounted.nodes.get(viewIdentity);
          if (node instanceof HTMLElement)
            node.style.opacity = String(Math.min(1, Math.max(0, value)));
        } else if (key.endsWith(":viewScale")) {
          const viewIdentity = key.slice(0, -":viewScale".length);
          const node = mounted.nodes.get(viewIdentity);
          if (node instanceof HTMLElement) node.style.scale = String(value);
        }
        document.body.dataset.familyMotion = JSON.stringify(motionSamples);
      },
    }),
  );
  const surfaceChannel = motionGraph.channel("Family.Dialog:translation.block", "Family.Dialog", 0);
  const backdropChannel = motionGraph.channel(Backdrop.opacity.key, Backdrop.identity.key, 0);
  const sheetTransition: MotionTransition = { spring: { mass: 1, stiffness: 700, damping: 48 } };
  const dialogTransition: MotionTransition = { spring: { mass: 1, stiffness: 1100, damping: 68 } };
  const contentTransition: MotionTransition = { spring: { mass: 1, stiffness: 1600, damping: 80 } };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const compact = (): boolean =>
    new URLSearchParams(location.search).get("environment") === "compact" ||
    matchMedia("(max-width: 600px)").matches;
  const selectedSurfaceTransition = (): MotionTransition =>
    reduced ? "instant" : compact() ? sheetTransition : dialogTransition;

  const layoutTarget = createCandidateDerivedTargetHandle<CandidateGeometry>(
    "Family.Dialog",
    "geometry",
    "geometry",
  );
  const layoutMotion = normalizeSemanticOperations(
    [
      transitionCandidateTarget(
        layoutTarget,
        createCandidateTransitionPolicy("family-resize", {
          normal: {
            kind: "layout",
            driver: { kind: "spring", mass: 1, stiffness: 1200, damping: 70 },
          },
          reduced: { kind: "instant" },
        }),
      ),
    ],
    [layoutTarget],
  );
  const layoutInstruction = lowerCandidatePresentationToWebLayout(layoutMotion)[0]!;
  const layoutGraph = new RetainedLayoutGraph(createAnimeLayoutBackend());
  const participants = (): HTMLElement[] => [
    nativeDialog,
    ...[...nativeDialog.querySelectorAll<HTMLElement>("[id]")],
  ];
  layoutGraph.register(
    layoutTarget.key,
    layoutTarget.address.identity,
    document.body,
    participants(),
  );

  const animateView = (
    identity: string,
    phase: "enter" | "exit",
    retained?: { identity: string; revision: number },
  ): void => {
    const opacity = motionGraph.channel(
      `${identity}:viewOpacity`,
      identity,
      phase === "enter" ? 0 : 1,
    );
    const scale = motionGraph.channel(
      `${identity}:viewScale`,
      identity,
      phase === "enter" ? 0.96 : 1,
    );
    const endpoint = phase === "enter" ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 };
    void Promise.all([
      opacity.target(endpoint.opacity, reduced ? "instant" : contentTransition),
      scale.target(endpoint.scale, reduced ? "instant" : contentTransition),
    ]).then((outcomes) => {
      if (phase !== "exit" || !retained || outcomes.some((outcome) => outcome !== "settled"))
        return;
      mounted.settleExit(retained.identity, retained.revision);
    });
    motionGraph.flush();
  };

  const reconcile = (nextView: FamilyView, nextOpen: boolean, nextPresent: boolean): void => {
    const previousView = view;
    const viewChanged = previousView !== nextView;
    const animatedViewChange = viewChanged && nextPresent;
    if (animatedViewChange) layoutGraph.capture();
    view = nextView;
    open = nextOpen;
    present = nextPresent;
    const transaction = mounted.reconcile(normalize(view, open, present), {
      retain: animatedViewChange ? [`Family.View:${previousView}`] : [],
    });
    applyScene();
    applyComposition();
    if (animatedViewChange) {
      const commands = planCandidatePresenceCommands(transaction);
      for (const outgoing of commands.exit) {
        animateView(outgoing.identity, "exit", outgoing);
      }
      for (const incoming of commands.enter) animateView(incoming.identity, "enter");
      const driver = layoutInstruction.transition.normal;
      const transition: MotionTransition =
        reduced || driver.kind === "instant"
          ? "instant"
          : driver.kind === "layout" && driver.driver.kind === "spring"
            ? {
                spring: {
                  mass: driver.driver.mass,
                  stiffness: driver.driver.stiffness,
                  damping: driver.driver.damping,
                },
              }
            : contentTransition;
      void layoutGraph.project(layoutTarget.key, participants(), transition);
      layoutGraph.flush();
    }
    document.body.dataset.familyState = JSON.stringify({
      view,
      open,
      present,
      entering: transaction.entering,
      exiting: transaction.exiting,
      reversed: transaction.reversed,
    });
  };

  const startOpen = (): void => {
    if (open) return;
    const fresh = !present;
    reconcile("default", true, true);
    nativeDialog.dataset.exiting = "false";
    nativeDialog.dataset.retained = "false";
    const bounds = nativeDialog.getBoundingClientRect();
    void surfaceChannel.target(
      0,
      selectedSurfaceTransition(),
      fresh ? { from: Math.min(40, bounds.height * 0.12) } : undefined,
    );
    void backdropChannel.target(1, selectedSurfaceTransition(), fresh ? { from: 0 } : undefined);
    motionGraph.flush();
  };
  const startClose = (velocity = 0): void => {
    if (!open) return;
    const bounds = nativeDialog.getBoundingClientRect();
    nativeDialog.dataset.retained = "true";
    nativeDialog.dataset.exiting = "true";
    nativeDialog.style.position = "fixed";
    nativeDialog.style.inset = `${bounds.top}px auto auto ${bounds.left}px`;
    nativeDialog.style.margin = "0";
    nativeDialog.style.inlineSize = `${bounds.width}px`;
    reconcile(view, false, true);
    void Promise.all([
      surfaceChannel.target(window.innerHeight - bounds.top + 40, selectedSurfaceTransition(), {
        velocity,
      }),
      backdropChannel.target(0, selectedSurfaceTransition()),
    ]).then((outcomes) => {
      if (outcomes.some((outcome) => outcome !== "settled") || open) return;
      reconcile("default", false, false);
      nativeDialog.dataset.retained = "false";
      nativeDialog.dataset.exiting = "false";
      nativeDialog.style.removeProperty("inset");
      nativeDialog.style.removeProperty("inline-size");
      nativeDialog.style.removeProperty("margin");
      surfaceChannel.direct(0);
      motionGraph.flush();
    });
    motionGraph.flush();
  };

  dispatch = (action) => {
    if (action === "Family.open") startOpen();
    else if (action === "Family.close") startClose();
    else if (action === "Family.back") reconcile("default", open, present);
    else if (action === "Family.key") reconcile("key", open, present);
    else if (action === "Family.phrase") reconcile("phrase", open, present);
    else if (action === "Family.remove") reconcile("remove", open, present);
    else if (action === "Family.reveal" || action === "Family.continue") {
      reconcile("default", open, present);
    }
  };
  nativeDialog.addEventListener("click", (event) => {
    if (event.target === nativeDialog) startClose();
  });
  nativeDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    startClose();
  });
  const gestureScene: CandidateRecognizerScene = {
    intents: [
      {
        name: "dismiss",
        kind: "drag",
        region: "Family.Dialog",
        activation: { axis: "block", threshold: length(3) },
        outcomes: [
          { outcome: "closed", action: "Family.close" },
          { outcome: "open", action: "Family.open" },
        ],
        alternative: { kind: "action", action: "Family.close" },
      },
    ],
    relations: [],
  };
  const gestureMount = mountCandidateGesturesToWeb(
    gestureScene,
    new Map([["Family.Dialog", nativeDialog]]),
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
      if (!compact() || event.sample.kind !== "translation" || !open) return;
      const value = Math.max(0, event.sample.value.block);
      if (event.phase === "begin" || event.phase === "change") {
        surfaceChannel.direct(value);
        backdropChannel.direct(Math.max(0, 1 - value / Math.max(1, nativeDialog.offsetHeight)));
        motionGraph.flush();
        return;
      }
      const velocity = event.sample.velocity.block / 1000;
      const projected = value + velocity * 180;
      const dismiss =
        event.phase === "release" &&
        (value >= nativeDialog.offsetHeight * 0.25 || velocity >= 0.48 || projected >= 120);
      if (dismiss) startClose(velocity);
      else {
        void surfaceChannel.target(0, selectedSurfaceTransition(), { velocity });
        void backdropChannel.target(1, selectedSurfaceTransition());
        motionGraph.flush();
      }
    },
  );
  addEventListener("resize", () => applyScene(), { passive: true });

  (window as unknown as Record<string, unknown>).__poggersFamilyCandidateEvidence = {
    mounted,
    presentation,
    layout,
    relationships,
    layoutMotion,
    layoutGraph,
    motionGraph,
    motionSamples,
    gestureMount,
    state: () => ({ view, open, present }),
  };
}
