import { describe, expect, test } from "bun:test";
import {
  type CandidateLayoutScene,
  type CandidateLength,
  type CandidateGeometry,
  type CandidateRecognizerScene,
  type CandidateDirectManipulationScene,
  type CandidateWebGestureSample,
  type CandidateRelationshipScene,
  type CandidateSemanticScene,
  CandidateHoverIntentAdapter,
  CandidateLongPressAdapter,
  CandidateMeasurementAdapter,
  CandidateOverlayCloseAdapter,
  aboveCandidate,
  arrangeCandidate,
  selectCandidateStructure,
  clipCandidate,
  constrainCandidateAspect,
  constrainCandidateSize,
  createCandidateDerivedTargetHandle,
  createCandidateLayer,
  createCandidatePresentationIdentity,
  createCandidateReadExpression,
  createCandidateRecognizerHandle,
  createCandidateTargetHandle,
  createCandidateTransitionPolicy,
  CandidateWebGestureAdapter,
  flowCandidate,
  gridCandidate,
  driveCandidate,
  executeCandidateHotReload,
  hitTestCandidate,
  issueCandidateAction,
  issueCandidateParameterHandle,
  issueCandidateStructurePart,
  lowerCandidateStructureToWeb,
  lowerCandidateLayoutToWebStyle,
  lowerCandidatePresentationSceneToWebStyle,
  lowerCandidateWebSceneToStyle,
  lowerCandidatePresentationToWebLayout,
  lowerCandidatePresentationToWeb,
  lowerCandidatePresentationTargetToWebStyle,
  mountCandidatePresentationToWeb,
  mountCandidateReconciledStructureToWeb,
  mountCandidateStructureToWeb,
  matchCandidate,
  mountCandidateGesturesToWeb,
  normalizeSemanticOperations,
  normalizeSemanticLayout,
  normalizeCandidateDirectManipulation,
  normalizeCandidateStructure,
  normalizeSemanticRelationships,
  notCandidate,
  overlayCandidate,
  padCandidate,
  planCandidatePresenceCommands,
  participateCandidate,
  anchorCandidate,
  placeCandidate,
  resolveCandidateWebGesturePlan,
  setCandidateTarget,
  scrollCandidate,
  settleCandidate,
  stickCandidate,
  transitionCandidateTarget,
  updateCandidateStructureOnWeb,
} from "./ui-language-candidates";
import {
  ReferenceMotionChannel,
  ReferenceGestureSession,
  ReferenceHoverIntent,
  ReferenceLongPress,
  ReferenceMeasurementCoordinator,
  ReferenceOverlayCloseCascade,
  ReferencePresenceCoordinator,
  normalizeReferenceChart,
  type ReferenceRect,
  type ReferenceLayoutVelocity,
  resolveReferenceLayoutProjection,
  resolveReferenceLayoutTransition,
  resolveReferenceTransitionUpdate,
  type ReferenceTransitionDescriptor,
} from "./ui-language-reference";

const springDefinition = {
  normal: { kind: "spring", mass: 1, stiffness: 420, damping: 34 },
  reduced: { kind: "instant" },
} as const;
const timingDefinition = {
  normal: { kind: "timing", milliseconds: 160, curve: { kind: "linear" } },
  reduced: { kind: "instant" },
} as const;
const layoutDefinition = {
  normal: {
    kind: "layout",
    driver: { kind: "spring", mass: 1, stiffness: 360, damping: 32 },
  },
  reduced: { kind: "instant" },
} as const;

type ObservableAdapterScene = {
  readonly targets: Readonly<Record<string, unknown>>;
  readonly composition: readonly string[];
  readonly clips: CandidateRelationshipScene["clips"];
  readonly hitTests: CandidateRelationshipScene["hitTests"];
  readonly matches: CandidateRelationshipScene["matches"];
  readonly isolates: CandidateRelationshipScene["isolates"];
  readonly nativeLayers: CandidateRelationshipScene["nativeLayers"];
  readonly masks: CandidateRelationshipScene["masks"];
  readonly layout: CandidateLayoutScene;
  readonly gestures: CandidateDirectManipulationScene;
};

class ReferenceCandidateAdapter {
  apply(
    targets: CandidateSemanticScene,
    relationships: CandidateRelationshipScene,
    layout: CandidateLayoutScene,
    gestures: CandidateDirectManipulationScene = normalizeCandidateDirectManipulation([]),
  ): ObservableAdapterScene {
    return observableScene(targets.targets, relationships, layout, gestures);
  }
}

type ObservableProjection = ReturnType<typeof resolveReferenceLayoutProjection>;

class FormulaProjectionAdapter {
  apply(
    identity: string,
    previousLayout: CandidateLayoutScene,
    nextLayout: CandidateLayoutScene,
    previous: ReferenceRect,
    next: ReferenceRect,
  ): ObservableProjection {
    const previousParent = previousLayout.parents[identity];
    const nextParent = nextLayout.parents[identity];
    if (!previousParent || !nextParent) throw new Error(`Missing layout parent for "${identity}".`);
    return {
      identity,
      parentChanged: previousParent !== nextParent,
      target: next,
      projection: {
        translateInline: previous.inline - next.inline,
        translateBlock: previous.block - next.block,
        scaleInline: previous.inlineSize / next.inlineSize,
        scaleBlock: previous.blockSize / next.blockSize,
      },
    };
  }
}

class ReferenceProjectionAdapter {
  apply(
    identity: string,
    previousLayout: CandidateLayoutScene,
    nextLayout: CandidateLayoutScene,
    previous: ReferenceRect,
    next: ReferenceRect,
  ): ObservableProjection {
    const previousParent = previousLayout.parents[identity];
    const nextParent = nextLayout.parents[identity];
    if (!previousParent || !nextParent) throw new Error(`Missing layout parent for "${identity}".`);
    return resolveReferenceLayoutProjection({
      identity,
      previousParent,
      nextParent,
      previous,
      next,
    });
  }
}

class FormulaLayoutTransitionAdapter {
  apply(options: {
    readonly identity: string;
    readonly previousParent: string;
    readonly nextParent: string;
    readonly presented: ReferenceRect;
    readonly velocity: ReferenceLayoutVelocity;
    readonly target: ReferenceRect;
    readonly driver: "instant" | "timing" | "spring";
    readonly reducedMotion: boolean;
  }): ReturnType<typeof resolveReferenceLayoutTransition> {
    const settled = options.reducedMotion || options.driver === "instant";
    const from = settled ? options.target : options.presented;
    return {
      identity: options.identity,
      parentChanged: options.previousParent !== options.nextParent,
      target: options.target,
      from,
      velocity:
        !settled && options.driver === "spring"
          ? options.velocity
          : { inline: 0, block: 0, logInlineSize: 0, logBlockSize: 0 },
      projection: settled
        ? { translateInline: 0, translateBlock: 0, scaleInline: 1, scaleBlock: 1 }
        : {
            translateInline: from.inline - options.target.inline,
            translateBlock: from.block - options.target.block,
            scaleInline: from.inlineSize / options.target.inlineSize,
            scaleBlock: from.blockSize / options.target.blockSize,
          },
      strategy: settled ? "settle" : options.driver === "spring" ? "retarget" : "replace",
    };
  }
}

class FormulaGestureSession {
  #revision = 0;
  #pointer?: number;
  #captured = false;
  #value = 0;
  #velocity = 0;
  #outcome?: "commit" | "cancel" | "capture-lost" | "absent";

  begin(pointer: number): number {
    if (this.#captured) throw new Error("captured");
    this.#pointer = pointer;
    this.#captured = true;
    this.#outcome = undefined;
    return ++this.#revision;
  }

  sample(revision: number, pointer: number, value: number, velocity: number): boolean {
    if (!this.#captured || revision !== this.#revision || pointer !== this.#pointer) return false;
    this.#value = value;
    this.#velocity = velocity;
    return true;
  }

  end(revision: number, reason: "commit" | "cancel" | "capture-lost" | "absent"): boolean {
    if (!this.#captured || revision !== this.#revision) return false;
    this.#captured = false;
    this.#pointer = undefined;
    this.#outcome = reason;
    return true;
  }

  get snapshot() {
    return {
      revision: this.#revision,
      captured: this.#captured,
      value: this.#value,
      velocity: this.#velocity,
      ...(this.#outcome ? { outcome: this.#outcome } : {}),
    };
  }
}

class FormulaPresenceCoordinator {
  #phase: "absent" | "entering" | "present" | "exiting" = "absent";
  #revision = 0;
  #pending = new Set<string>();
  #interactive = false;
  #accessible = false;

  target(present: boolean, targets: readonly string[]): number {
    const next = present
      ? this.#phase === "present" || this.#phase === "entering"
        ? this.#phase
        : "entering"
      : this.#phase === "absent" || this.#phase === "exiting"
        ? this.#phase
        : "exiting";
    if (next === this.#phase) return this.#revision;
    this.#phase = next;
    this.#pending = new Set(targets);
    this.#interactive = present;
    this.#accessible = present;
    return ++this.#revision;
  }

  settle(revision: number, target: string): boolean {
    if (revision !== this.#revision || !this.#pending.delete(target)) return false;
    if (this.#pending.size) return false;
    this.#phase = this.#phase === "entering" ? "present" : "absent";
    return true;
  }

  get snapshot() {
    return {
      identity: "Presence.Content",
      phase: this.#phase,
      revision: this.#revision,
      pending: [...this.#pending].sort() as readonly string[],
      mounted: this.#phase !== "absent",
      interactive: this.#interactive,
      accessible: this.#accessible,
      disposed: false,
    };
  }
}

class RetainedCandidateAdapter {
  readonly #values = new Map<string, unknown>();
  readonly #channels = new Map<string, ReferenceMotionChannel>();
  readonly #policies = new Map<string, ReferenceTransitionDescriptor>();
  readonly #direct = new Set<string>();
  readonly #targets = new Map<string, number>();
  readonly #reduced = new Map<string, boolean>();
  #transactionRevision = 0;
  #motionCount = 0;
  readonly #lastMotion = new Map<
    string,
    {
      readonly from: number;
      readonly velocity: number;
      readonly to: number;
      readonly policy: string;
    }
  >();

  direct(key: string, value: number, velocity: number): void {
    const channel = this.#channels.get(key) ?? new ReferenceMotionChannel(key, "adapter", value);
    this.#channels.set(key, channel);
    channel.direct(value, velocity);
    this.#values.set(key, value);
    this.#direct.add(key);
  }

  active(key: string) {
    return this.#channels.get(key)?.active;
  }

  lastMotion(key: string) {
    return this.#lastMotion.get(key);
  }

  get motionCount(): number {
    return this.#motionCount;
  }

  apply(
    targets: CandidateSemanticScene,
    relationships: CandidateRelationshipScene,
    layout: CandidateLayoutScene,
    reducedMotion = false,
    gestures: CandidateDirectManipulationScene = normalizeCandidateDirectManipulation([]),
    cause:
      | "semantic"
      | "preset"
      | "theme"
      | "environment"
      | "geometry"
      | "reducedMotion" = "semantic",
  ): ObservableAdapterScene {
    const policies = new Map(targets.transitions.map((entry) => [entry.target, entry]));
    const numeric = Object.entries(targets.targets)
      .filter(([key, value]) => typeof value === "number" && policies.has(key))
      .sort(([left], [right]) => left.localeCompare(right));
    const previous: Record<
      string,
      {
        target: number;
        policy: ReferenceTransitionDescriptor;
        active: boolean;
        reducedMotion: boolean;
      }
    > = {};
    const next: typeof previous = {};
    const presented: Record<string, { value: number; velocity: number }> = {};
    for (const [key, value] of numeric) {
      const policy = policies.get(key);
      if (!policy || typeof value !== "number") continue;
      const channel = this.#channels.get(key) ?? new ReferenceMotionChannel(key, "adapter", value);
      this.#channels.set(key, channel);
      const selected = reducedMotion ? policy.definition.reduced : policy.definition.normal;
      const descriptor = {
        name: policy.policy,
        kind: selected.kind,
        valueType: "number",
      } satisfies ReferenceTransitionDescriptor;
      previous[key] = {
        target: this.#targets.get(key) ?? channel.value,
        policy: this.#policies.get(key) ?? descriptor,
        active: this.#direct.has(key) || channel.active !== undefined,
        reducedMotion: this.#reduced.get(key) ?? false,
      };
      next[key] = { target: value, policy: descriptor, active: true, reducedMotion };
      presented[key] = { value: channel.value, velocity: channel.velocity };
    }
    const update = resolveReferenceTransitionUpdate({
      previous,
      next,
      presented,
      transaction: {
        cause,
        revision: ++this.#transactionRevision,
        epoch: this.#transactionRevision,
      },
    });

    for (const change of update.changes) {
      const key = change.targetIdentity;
      const state = next[key]!;
      const channel = this.#channels.get(key)!;
      if (change.handoff) {
        const revision = channel.target(state.target, state.policy.name, change.handoff.velocity);
        this.#lastMotion.set(key, {
          from: change.handoff.from,
          velocity: change.handoff.velocity,
          to: change.handoff.to,
          policy: state.policy.name,
        });
        this.#motionCount++;
        channel.settle(revision.revision);
      }
      this.#policies.set(key, state.policy);
      this.#targets.set(key, state.target);
      this.#reduced.set(key, state.reducedMotion);
      this.#values.set(key, channel.value);
      this.#direct.delete(key);
    }
    for (const [key] of numeric) {
      const state = next[key]!;
      const channel = this.#channels.get(key)!;
      this.#policies.set(key, state.policy);
      this.#targets.set(key, state.target);
      this.#reduced.set(key, state.reducedMotion);
      this.#values.set(key, channel.value);
      this.#direct.delete(key);
    }
    for (const [key, value] of Object.entries(targets.targets)) {
      if (!policies.has(key) || typeof value !== "number") this.#values.set(key, value);
    }
    return observableScene(Object.fromEntries(this.#values), relationships, layout, gestures);
  }
}

function observableScene(
  targets: Readonly<Record<string, unknown>>,
  relationships: CandidateRelationshipScene,
  layout: CandidateLayoutScene,
  gestures: CandidateDirectManipulationScene,
): ObservableAdapterScene {
  return {
    targets: Object.fromEntries(
      Object.entries(targets).sort(([left], [right]) => left.localeCompare(right)),
    ),
    composition: relationships.composition,
    clips: relationships.clips,
    hitTests: relationships.hitTests,
    matches: relationships.matches,
    isolates: relationships.isolates,
    nativeLayers: relationships.nativeLayers,
    masks: relationships.masks,
    layout,
    gestures,
  };
}

type CandidateCapability =
  | "nativeDialog"
  | "physicalSpring"
  | "layoutProjection"
  | "pointerCapture"
  | "compositionClip";

function validateCandidateCapabilities(
  requirements: readonly CandidateCapability[],
  capabilities: Readonly<Partial<Record<CandidateCapability, "native" | "lowered">>>,
): void {
  for (const requirement of [...new Set(requirements)].sort()) {
    if (capabilities[requirement]) continue;
    throw new Error(`Adapter does not support required UI meaning "${requirement}".`);
  }
}

function drawerRelationships(): CandidateRelationshipScene {
  const page = createCandidatePresentationIdentity("Drawer.Page");
  const backdrop = createCandidatePresentationIdentity("Drawer.Backdrop");
  const surface = createCandidatePresentationIdentity("Drawer.Surface");
  const source = createCandidatePresentationIdentity("List.Image");
  const destination = createCandidatePresentationIdentity("Detail.Image");
  return normalizeSemanticRelationships(
    [page, backdrop, surface, source, destination],
    [
      aboveCandidate(backdrop, page),
      aboveCandidate(surface, backdrop),
      clipCandidate(surface, destination),
      hitTestCandidate(backdrop, "capture"),
      matchCandidate("selected-image", source, destination),
    ],
  );
}

function drawerLayout(): CandidateLayoutScene {
  const page = createCandidatePresentationIdentity("Drawer.Page");
  const content = createCandidatePresentationIdentity("Drawer.Content");
  return normalizeSemanticLayout(
    [page, content],
    [
      arrangeCandidate(
        page,
        [content],
        flowCandidate({
          axis: "block",
          gap: { dimension: "length", value: 12 },
          align: "stretch",
          distribute: "start",
          wrap: false,
        }),
      ),
    ],
  );
}

function drawerGestures(): CandidateDirectManipulationScene {
  const target = createCandidateTargetHandle<CandidateLength>("Drawer.Surface", "offset");
  const gesture = createCandidateRecognizerHandle<"drag", "open" | "closed">("Drawer.drag", "drag");
  const projectionTime = issueCandidateParameterHandle<number>("Drawer.projectionTime");
  const resistance = issueCandidateParameterHandle<number>("Drawer.resistance");
  const spring = createCandidateTransitionPolicy<CandidateLength>("release", springDefinition);
  return normalizeCandidateDirectManipulation([
    driveCandidate(target, gesture, gesture.translation.block),
    settleCandidate(target, gesture, {
      destinations: {
        open: { dimension: "length", value: 0 },
        closed: { dimension: "length", value: 1 },
      },
      policy: spring,
      preserve: "velocity",
      projectionTime,
      resistance,
    }),
  ]);
}

describe("candidate adapter equivalence", () => {
  test("lowers native structure, accessibility, controlled values, and actions without guessing", () => {
    const Root = issueCandidateStructurePart("Controls", "Root", "main");
    const Form = issueCandidateStructurePart("Controls", "Form", "form");
    const Query = issueCandidateStructurePart("Controls", "Query", "input");
    const Volume = issueCandidateStructurePart("Controls", "Volume", "input");
    const Help = issueCandidateStructurePart("Controls", "Help", "a");
    const Portrait = issueCandidateStructurePart("Controls", "Portrait", "img");
    const Texture = issueCandidateStructurePart("Controls", "Texture", "img");
    const Custom = issueCandidateStructurePart("Controls", "Custom", "div");
    const Dialog = issueCandidateStructurePart("Controls", "Dialog", "dialog");
    const DialogClose = issueCandidateStructurePart("Controls", "DialogClose", "button");
    const form = Form({ submit: issueCandidateAction("Controls.submit") });
    const dialogClose = DialogClose(
      { name: "Close", activate: issueCandidateAction("Controls.dismiss") },
      "Close",
    );
    const dialog = Dialog(
      {
        name: "Confirmation",
        modal: true,
        dismiss: issueCandidateAction("Controls.dismiss"),
      },
      dialogClose,
    );
    const custom = Custom({
      role: "button",
      name: "Custom action",
      controls: dialog.reference,
      popup: "dialog",
      expanded: false,
      activate: issueCandidateAction("Controls.custom"),
    });
    const structure = normalizeCandidateStructure(
      Root(
        {},
        form,
        Query({
          name: "Search",
          value: "Ada",
          change: issueCandidateAction<(value: string) => void>("Controls.changeQuery"),
          formOwner: form.reference,
        }),
        Volume({
          role: "slider",
          name: "Volume",
          value: 0.3,
          minimum: 0,
          maximum: 1,
          step: 0.1,
          largeStep: 0.5,
          change: issueCandidateAction<(value: number) => void>("Controls.changeVolume"),
        }),
        Help({
          name: "Help",
          destination: "/help",
          activate: issueCandidateAction("Controls.openHelp"),
        }),
        Portrait({ source: "/portrait.webp", alternative: "Profile portrait" }),
        Texture({ source: "/texture.webp", alternative: { kind: "decorative" } }),
        custom,
        dialog,
      ),
      {
        activeModal: {
          identity: dialog.reference,
          initialFocus: dialogClose.reference,
          returnFocus: custom.reference,
        },
      },
    );

    const web = lowerCandidateStructureToWeb(structure);
    expect(web.find((node) => node.identity === "Controls.Query")).toMatchObject({
      element: "input",
      attributes: { type: "text", "aria-label": "Search", form: "Controls.Form" },
      properties: { value: "Ada" },
      events: [{ event: "input", action: "Controls.changeQuery" }],
    });
    expect(web.find((node) => node.identity === "Controls.Volume")).toMatchObject({
      element: "input",
      attributes: {
        type: "range",
        "aria-valuenow": 0.3,
        "aria-valuemin": 0,
        "aria-valuemax": 1,
      },
      properties: { value: 0.3, min: 0, max: 1, step: 0.1 },
      adjustable: { step: 0.1, largeStep: 0.5 },
      events: [{ event: "input", action: "Controls.changeVolume" }],
    });
    expect(
      Object.keys(web.find((node) => node.identity === "Controls.Volume")!.properties),
    ).toEqual(["min", "max", "step", "value"]);
    expect(web.find((node) => node.identity === "Controls.Help")).toMatchObject({
      element: "a",
      attributes: { href: "/help" },
      events: [{ event: "click", action: "Controls.openHelp" }],
    });
    expect(web.find((node) => node.identity === "Controls.Portrait")).toMatchObject({
      element: "img",
      attributes: { src: "/portrait.webp", alt: "Profile portrait" },
    });
    expect(web.find((node) => node.identity === "Controls.Texture")).toMatchObject({
      element: "img",
      attributes: { src: "/texture.webp", alt: "", "aria-hidden": true },
    });
    expect(web.find((node) => node.identity === "Controls.Custom")).toMatchObject({
      element: "div",
      attributes: {
        role: "button",
        "aria-controls": "Controls.Dialog",
        "aria-haspopup": "dialog",
        "aria-expanded": false,
      },
      properties: { tabIndex: 0 },
    });
    expect(web.find((node) => node.identity === "Controls.Dialog")).toMatchObject({
      element: "dialog",
      attributes: { "aria-modal": true },
      events: [{ event: "cancel", action: "Controls.dismiss" }],
    });

    expect(() =>
      lowerCandidateStructureToWeb({
        ...structure,
        nodes: structure.nodes.map((node) =>
          node.identity === "Controls.Root" ? { ...node, platformKind: "script" } : node,
        ),
      }),
    ).toThrow('unsafe web element "script"');
  });

  test("selects static, fine-grained reactive, and retained visual strategies from typed IR", () => {
    const opacity = createCandidateTargetHandle<number>("Card", "opacity", "number");
    const blockSize = createCandidateTargetHandle<CandidateLength>("Card", "blockSize", "length");
    const fill = createCandidateTargetHandle("Card", "fill", "paint");
    const scene = normalizeSemanticOperations([
      setCandidateTarget(fill, {
        kind: "solid",
        color: { colorSpace: "oklch", lightness: 0.9, chroma: 0.02, hue: 240, alpha: 1 },
      }),
      setCandidateTarget(
        blockSize,
        createCandidateReadExpression<CandidateLength>("card.blockSize"),
      ),
      setCandidateTarget(opacity, createCandidateReadExpression<number>("card.opacity")),
      transitionCandidateTarget(opacity, createCandidateTransitionPolicy("fade", springDefinition)),
    ]);

    expect(lowerCandidatePresentationToWeb(scene)).toEqual([
      expect.objectContaining({
        target: "Card:blockSize",
        identity: "Card",
        property: "blockSize",
        valueType: "length",
        strategy: "reactive-property",
        encoding: "scalar",
      }),
      expect.objectContaining({
        target: "Card:fill",
        identity: "Card",
        property: "fill",
        valueType: "paint",
        strategy: "stylesheet",
        encoding: "composite",
      }),
      expect.objectContaining({
        target: "Card:opacity",
        identity: "Card",
        property: "opacity",
        valueType: "number",
        strategy: "retained-motion",
        encoding: "scalar",
        transition: springDefinition,
      }),
    ]);
    expect(() =>
      lowerCandidatePresentationToWeb(
        normalizeSemanticOperations([
          setCandidateTarget(createCandidateTargetHandle("Card", "custom"), 1),
        ]),
      ),
    ).toThrow("no concrete value type");
    expect(() => createCandidateTargetHandle("", "malformed", "number")).toThrow(
      "non-empty identity",
    );
  });

  test("preserves policy-only derived geometry as a dedicated retained-layout instruction", () => {
    const geometry = createCandidateDerivedTargetHandle<CandidateGeometry>(
      "Results.Root",
      "geometry",
      "geometry",
    );
    const transition = createCandidateTransitionPolicy<CandidateGeometry>(
      "results-layout",
      layoutDefinition,
    );
    const scene = normalizeSemanticOperations(
      [transitionCandidateTarget(geometry, transition)],
      [geometry],
    );

    expect(lowerCandidatePresentationToWeb(scene)).toEqual([
      {
        target: "Results.Root:geometry",
        identity: "Results.Root",
        property: "geometry",
        valueType: "geometry",
        strategy: "retained-motion",
        encoding: "layout",
        value: undefined,
        transition: layoutDefinition,
      },
    ]);
    expect(lowerCandidatePresentationSceneToWebStyle(scene)).toEqual([]);
    expect(lowerCandidatePresentationToWebLayout(scene)).toEqual([
      {
        target: "Results.Root:geometry",
        identity: "Results.Root",
        strategy: "retained-layout",
        transition: layoutDefinition,
      },
    ]);
  });

  test("lowers semantic layout algorithms to stable logical web properties", () => {
    const Flow = createCandidatePresentationIdentity("Layout.Flow");
    const FlowChild = createCandidatePresentationIdentity("Layout.Flow.Child");
    const flow = lowerCandidateLayoutToWebStyle(
      normalizeSemanticLayout(
        [Flow, FlowChild],
        [
          arrangeCandidate(
            Flow,
            [FlowChild],
            flowCandidate({
              axis: "block",
              gap: { dimension: "length", value: 12 },
              align: "stretch",
              distribute: "between",
              wrap: false,
            }),
          ),
          padCandidate(Flow, {
            inlineStart: { dimension: "length", value: 20 },
            inlineEnd: { dimension: "length", value: 20 },
            blockStart: { dimension: "length", value: 16 },
            blockEnd: { dimension: "length", value: 24 },
          }),
          constrainCandidateSize(Flow, {
            inline: {
              minimum: { dimension: "length", value: 280 },
              ideal: { dimension: "length", value: 420 },
              maximum: { size: "available" },
            },
          }),
          participateCandidate(FlowChild, {
            grow: 1,
            shrink: 1,
            basis: { size: "intrinsic" },
          }),
          constrainCandidateAspect(FlowChild, 16 / 9),
        ],
      ),
    );
    expect(flow).toEqual([
      {
        identity: "Layout.Flow",
        declarations: [
          { name: "align-items", value: "stretch" },
          { name: "display", value: "flex" },
          { name: "flex-direction", value: "column" },
          { name: "flex-wrap", value: "nowrap" },
          { name: "gap", value: "12px" },
          { name: "inline-size", value: "420px" },
          { name: "justify-content", value: "space-between" },
          { name: "max-inline-size", value: "100%" },
          { name: "min-inline-size", value: "280px" },
          { name: "padding-block-end", value: "24px" },
          { name: "padding-block-start", value: "16px" },
          { name: "padding-inline-end", value: "20px" },
          { name: "padding-inline-start", value: "20px" },
        ],
      },
      {
        identity: "Layout.Flow.Child",
        declarations: [
          { name: "aspect-ratio", value: String(16 / 9) },
          { name: "flex-basis", value: "auto" },
          { name: "flex-grow", value: "1" },
          { name: "flex-shrink", value: "1" },
          { name: "min-inline-size", value: "0" },
        ],
      },
    ]);

    const Dialog = createCandidatePresentationIdentity("Layout.Dialog");
    expect(
      lowerCandidateLayoutToWebStyle(
        normalizeSemanticLayout(
          [Dialog],
          [
            anchorCandidate(Dialog, "viewport", {
              inline: "stretch",
              block: "end",
              insets: {
                inlineStart: { dimension: "length", value: 12 },
                inlineEnd: { dimension: "length", value: 12 },
                blockStart: { dimension: "length", value: 0 },
                blockEnd: { dimension: "length", value: 16 },
              },
            }),
          ],
        ),
      ),
    ).toEqual([
      {
        identity: "Layout.Dialog",
        declarations: [
          { name: "inset-block-end", value: "16px" },
          { name: "inset-block-start", value: "auto" },
          { name: "inset-inline-end", value: "12px" },
          { name: "inset-inline-start", value: "12px" },
          { name: "margin-block", value: "0" },
          { name: "margin-inline", value: "0" },
          { name: "position", value: "fixed" },
        ],
      },
    ]);

    const Close = createCandidatePresentationIdentity("Layout.Dialog.Close");
    expect(
      lowerCandidateLayoutToWebStyle(
        normalizeSemanticLayout(
          [Dialog, Close],
          [
            anchorCandidate(Close, Dialog, {
              inline: "end",
              block: "start",
              insets: {
                inlineStart: { dimension: "length", value: 0 },
                inlineEnd: { dimension: "length", value: 24 },
                blockStart: { dimension: "length", value: 20 },
                blockEnd: { dimension: "length", value: 0 },
              },
            }),
          ],
        ),
      ),
    ).toEqual([
      {
        identity: "Layout.Dialog",
        declarations: [{ name: "position", value: "relative" }],
      },
      {
        identity: "Layout.Dialog.Close",
        declarations: [
          { name: "inset-block-end", value: "auto" },
          { name: "inset-block-start", value: "20px" },
          { name: "inset-inline-end", value: "24px" },
          { name: "inset-inline-start", value: "auto" },
          { name: "margin-block", value: "0" },
          { name: "margin-inline", value: "0" },
          { name: "position", value: "absolute" },
        ],
      },
    ]);
    const nestedAnchors = lowerCandidateLayoutToWebStyle(
      normalizeSemanticLayout(
        [Dialog, Close],
        [
          anchorCandidate(Dialog, "viewport", {
            inline: "center",
            block: "end",
            insets: {
              inlineStart: { dimension: "length", value: 12 },
              inlineEnd: { dimension: "length", value: 12 },
              blockStart: { dimension: "length", value: 0 },
              blockEnd: { dimension: "length", value: 16 },
            },
          }),
          anchorCandidate(Close, Dialog, {
            inline: "end",
            block: "start",
            insets: {
              inlineStart: { dimension: "length", value: 0 },
              inlineEnd: { dimension: "length", value: 24 },
              blockStart: { dimension: "length", value: 20 },
              blockEnd: { dimension: "length", value: 0 },
            },
          }),
        ],
      ),
    );
    expect(
      nestedAnchors.find((entry) => entry.identity === "Layout.Dialog")?.declarations,
    ).toContainEqual({ name: "position", value: "fixed" });

    const Grid = createCandidatePresentationIdentity("Layout.Grid");
    const Tile = createCandidatePresentationIdentity("Layout.Grid.Tile");
    expect(
      lowerCandidateLayoutToWebStyle(
        normalizeSemanticLayout(
          [Grid, Tile],
          [
            arrangeCandidate(
              Grid,
              [Tile],
              gridCandidate({
                columns: [
                  { size: "fraction", value: 1 },
                  { dimension: "length", value: 180 },
                ],
                rows: [{ size: "intrinsic" }],
                gap: { dimension: "length", value: 8 },
              }),
            ),
            placeCandidate(Tile, {
              column: { start: 2 },
              row: { start: 1 },
            }),
          ],
        ),
      ),
    ).toEqual([
      {
        identity: "Layout.Grid",
        declarations: [
          { name: "display", value: "grid" },
          { name: "gap", value: "8px" },
          { name: "grid-template-columns", value: "1fr 180px" },
          { name: "grid-template-rows", value: "max-content" },
        ],
      },
      {
        identity: "Layout.Grid.Tile",
        declarations: [
          { name: "grid-column", value: "2 / span 1" },
          { name: "grid-row", value: "1 / span 1" },
        ],
      },
    ]);

    const Viewport = createCandidatePresentationIdentity("Layout.Viewport");
    const Content = createCandidatePresentationIdentity("Layout.Content");
    const Header = createCandidatePresentationIdentity("Layout.Header");
    const scroll = lowerCandidateLayoutToWebStyle(
      normalizeSemanticLayout(
        [Viewport, Content, Header],
        [
          scrollCandidate(Viewport, Content, {
            axis: "block",
            behavior: "paged",
            indicators: "hidden",
          }),
          arrangeCandidate(Content, [Header], overlayCandidate({ align: "center" })),
          stickCandidate(Header, Viewport, {
            edge: "blockStart",
            inset: { dimension: "length", value: 4 },
          }),
        ],
      ),
    );
    expect(Object.fromEntries(scroll.map((entry) => [entry.identity, entry.declarations]))).toEqual(
      {
        "Layout.Content": [
          { name: "display", value: "grid" },
          { name: "place-items", value: "center" },
        ],
        "Layout.Header": [
          { name: "grid-area", value: "1 / 1" },
          { name: "inset-block-start", value: "4px" },
          { name: "position", value: "sticky" },
        ],
        "Layout.Viewport": [
          { name: "overflow-block", value: "auto" },
          { name: "overflow-inline", value: "hidden" },
          { name: "scroll-snap-type", value: "block mandatory" },
          { name: "scrollbar-width", value: "none" },
        ],
      },
    );
  });

  test("gives semantic hidden state final precedence over authored layout", () => {
    const Root = issueCandidateStructurePart("Hidden", "Root", "div");
    const Child = issueCandidateStructurePart("Hidden", "Child", "div");
    const structure = normalizeCandidateStructure(Root({ hidden: true }, Child({}, "Content")));
    const root = createCandidatePresentationIdentity("Hidden.Root");
    const child = createCandidatePresentationIdentity("Hidden.Child");
    const layout = normalizeSemanticLayout(
      [root, child],
      [
        arrangeCandidate(
          root,
          [child],
          flowCandidate({
            axis: "block",
            gap: { dimension: "length", value: 8 },
            align: "stretch",
            distribute: "start",
            wrap: false,
          }),
        ),
      ],
    );

    const hidden = lowerCandidateWebSceneToStyle({
      structure,
      presentation: normalizeSemanticOperations([]),
      layout,
    });
    expect(hidden.find((entry) => entry.identity === root.key)?.declarations).toContainEqual({
      name: "display",
      value: "none",
    });

    const visible = lowerCandidateWebSceneToStyle({
      structure: normalizeCandidateStructure(Root({ hidden: false }, Child({}, "Content"))),
      presentation: normalizeSemanticOperations([]),
      layout,
    });
    expect(visible.find((entry) => entry.identity === root.key)?.declarations).toContainEqual({
      name: "display",
      value: "flex",
    });
  });

  test("encodes supported semantic values without parsing target keys", () => {
    const color = {
      colorSpace: "oklch",
      lightness: 0.62,
      chroma: 0.14,
      hue: 248,
      alpha: 0.9,
    } as const;
    const scene = normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("Card", "fill", "paint"), {
        kind: "solid",
        color,
      }),
      setCandidateTarget(createCandidateTargetHandle("Card", "foreground", "paint"), {
        kind: "solid",
        color: { ...color, lightness: 0.18, chroma: 0.02 },
      }),
      setCandidateTarget(createCandidateTargetHandle("Card", "shape", "shape"), {
        kind: "capsule",
      }),
      setCandidateTarget(createCandidateTargetHandle("Card", "shadows", "shadows"), [
        {
          kind: "outer",
          color,
          offset: {
            inline: { dimension: "length", value: 0 },
            block: { dimension: "length", value: 8 },
          },
          blur: { dimension: "length", value: 24 },
          spread: { dimension: "length", value: -4 },
        },
      ]),
      setCandidateTarget(createCandidateTargetHandle("Card", "type", "type"), {
        families: ["Inter Variable", "sans-serif"],
        size: { dimension: "length", value: 15 },
        lineHeight: { dimension: "length", value: 22 },
        weight: 620,
        tracking: { dimension: "length", value: 0 },
        align: "start",
        wrap: "balance",
        overflow: "ellipsis",
        decoration: "none",
        variations: { opsz: 15, wght: 620 },
      }),
      setCandidateTarget(createCandidateTargetHandle("Card", "mediaFit", "media-fit"), {
        mode: "cover",
        focalPoint: { inline: 0.25, block: 0.75 },
      }),
      setCandidateTarget(createCandidateTargetHandle("Card", "transform", "transform"), {
        translation: {
          inline: { dimension: "length", value: 3 },
          block: { dimension: "length", value: 5 },
          depth: { dimension: "length", value: 0 },
        },
        scale: { inline: 0.98, block: 0.98, depth: 1 },
        rotation: {
          axis: { x: 0, y: 0, z: 1 },
          angle: { dimension: "angle", value: 2 },
        },
        origin: {
          inline: 0.5,
          block: 0.5,
          depth: { dimension: "length", value: 0 },
        },
        perspective: "none",
      }),
      setCandidateTarget(
        createCandidateTargetHandle("Card", "opacity", "number"),
        createCandidateReadExpression<number>("card.opacity"),
      ),
    ]);
    const declarations = Object.fromEntries(
      lowerCandidatePresentationToWeb(scene).flatMap((target) =>
        lowerCandidatePresentationTargetToWebStyle(target, { "card.opacity": 0.72 }).map(
          (declaration) => [`${target.identity}.${declaration.name}`, declaration.value],
        ),
      ),
    );

    expect(declarations["Card.background"]).toBe("oklch(62% 0.14 248 / 0.9)");
    expect(declarations["Card.color"]).toBe("oklch(18% 0.02 248 / 0.9)");
    expect(declarations["Card.border-radius"]).toBe("9999px");
    expect(declarations["Card.opacity"]).toBe("0.72");
    expect(declarations["Card.object-position"]).toBe("25% 75%");
    expect(declarations["Card.font-family"]).toBe('"Inter Variable", sans-serif');
    expect(declarations["Card.font-variation-settings"]).toBe('"opsz" 15, "wght" 620');
    expect(declarations["Card.box-shadow"]).toContain("8px 24px -4px");
    expect(declarations["Card.transform"]).toContain("translate3d(3px, 5px, 0px)");
  });

  test("rejects web visual approximations that need a richer lowering", () => {
    const color = {
      colorSpace: "oklch",
      lightness: 0.5,
      chroma: 0.1,
      hue: 20,
      alpha: 1,
    } as const;
    const unsupported = normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("Card", "material", "material"), {
        backdropBlur: { dimension: "length", value: 12 },
        backdropSaturation: 1.1,
        tint: { kind: "solid", color },
        noise: 0,
      }),
    ]);
    expect(() =>
      lowerCandidatePresentationTargetToWebStyle(lowerCandidatePresentationToWeb(unsupported)[0]!),
    ).toThrow("node-level material and fill composition");
  });

  test("preserves generated-layer ownership through the final web instruction", () => {
    const owner = createCandidatePresentationIdentity("Dialog.Root");
    const backdrop = createCandidateLayer(owner, "backdrop");
    const scene = normalizeSemanticOperations([
      setCandidateTarget(backdrop.fill, {
        kind: "solid",
        color: {
          colorSpace: "oklch",
          lightness: 0.1,
          chroma: 0.01,
          hue: 250,
          alpha: 0.32,
        },
      }),
      setCandidateTarget(backdrop.opacity, 1),
    ]);

    expect(scene.generated).toEqual([
      { identity: "Dialog.Root:layer:8:backdrop", owner: "Dialog.Root" },
    ]);
    expect(lowerCandidatePresentationSceneToWebStyle(scene)[0]!.generated).toEqual({
      identity: "Dialog.Root:layer:8:backdrop",
      owner: "Dialog.Root",
    });
    const Root = issueCandidateStructurePart("Dialog", "Root", "dialog");
    const webScene = lowerCandidateWebSceneToStyle({
      structure: normalizeCandidateStructure(
        Root({ name: "Dialog", dismiss: issueCandidateAction("Dialog.dismiss") }),
      ),
      presentation: scene,
      layout: normalizeSemanticLayout([owner, backdrop.identity], []),
    });
    expect(
      webScene.find((entry) => entry.identity === backdrop.identity.key)?.declarations,
    ).toContainEqual({ name: "pointer-events", value: "none" });
  });

  test("composes material and surface paint once at the visual-node boundary", () => {
    const fill = {
      colorSpace: "oklch",
      lightness: 0.12,
      chroma: 0.02,
      hue: 250,
      alpha: 0.7,
    } as const;
    const tint = { ...fill, lightness: 0.98, chroma: 0.01, alpha: 0.36 };
    const scene = normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("Glass", "fill", "paint"), {
        kind: "solid",
        color: fill,
      }),
      setCandidateTarget(createCandidateTargetHandle("Glass", "material", "material"), {
        backdropBlur: { dimension: "length", value: 18 },
        backdropSaturation: 1.24,
        tint: { kind: "solid", color: tint },
        noise: 0,
      }),
    ]);

    expect(lowerCandidatePresentationSceneToWebStyle(scene)).toEqual([
      {
        identity: "Glass",
        sources: ["Glass:fill", "Glass:material"],
        declarations: [
          {
            name: "background",
            value:
              "linear-gradient(oklch(98% 0.01 250 / 0.36), oklch(98% 0.01 250 / 0.36)), oklch(12% 0.02 250 / 0.7)",
          },
          { name: "backdrop-filter", value: "blur(18px) saturate(1.24)" },
        ],
        channels: [
          {
            name: "background",
            strategy: "stylesheet",
            sources: ["Glass:fill", "Glass:material"],
          },
          {
            name: "backdrop-filter",
            strategy: "stylesheet",
            sources: ["Glass:material"],
          },
        ],
      },
    ]);
    expect(() =>
      lowerCandidatePresentationSceneToWebStyle(
        normalizeSemanticOperations([
          setCandidateTarget(createCandidateTargetHandle("Glass", "material", "material"), {
            backdropBlur: { dimension: "length", value: 18 },
            backdropSaturation: 1.24,
            tint: { kind: "solid", color: tint },
            noise: 0.08,
          }),
        ]),
      ),
    ).toThrow("generated noise-layer lowering");

    const animatedFill = createCandidateTargetHandle("Glass", "fill", "paint");
    const animated = normalizeSemanticOperations([
      setCandidateTarget(animatedFill, { kind: "solid", color: fill }),
      transitionCandidateTarget(
        animatedFill,
        createCandidateTransitionPolicy("glass-fill", springDefinition),
      ),
      setCandidateTarget(createCandidateTargetHandle("Glass", "material", "material"), {
        backdropBlur: { dimension: "length", value: 18 },
        backdropSaturation: 1.24,
        tint: { kind: "solid", color: tint },
        noise: 0,
      }),
    ]);
    expect(lowerCandidatePresentationSceneToWebStyle(animated)[0]!.channels).toEqual([
      {
        name: "background",
        strategy: "retained-motion",
        sources: ["Glass:fill", "Glass:material"],
      },
      {
        name: "backdrop-filter",
        strategy: "stylesheet",
        sources: ["Glass:material"],
      },
    ]);
  });

  test("mounts native hierarchy and visual strategies without a virtual tree", () => {
    type FakeEvent = { readonly type: string };
    type FakeNode = {
      readonly identity: string;
      readonly element: string;
      readonly attributes: Record<string, string | number | boolean>;
      readonly properties: Record<string, string | number | boolean>;
      readonly children: FakeNode[];
      readonly listeners: Map<string, (event: FakeEvent) => void>;
    };
    const Root = issueCandidateStructurePart("Mount", "Root", "main");
    const Action = issueCandidateStructurePart("Mount", "Action", "button");
    const hierarchy = Root(
      {},
      Action(
        {
          name: "Run",
          expanded: createCandidateReadExpression<boolean>("mount.expanded"),
          activate: issueCandidateAction("Mount.run"),
        },
        "Run",
      ),
    );
    const structure = normalizeCandidateStructure(hierarchy, {
      reads: { "mount.expanded": false },
    });
    const removed: string[] = [];
    const listenerDisposals: string[] = [];
    const dispatched: string[] = [];
    const mounted = mountCandidateStructureToWeb<FakeNode, FakeEvent>(
      structure,
      {
        create: (element, identity) => ({
          identity,
          element,
          attributes: {},
          properties: {},
          children: [],
          listeners: new Map(),
        }),
        text: (value) => ({
          identity: `#text:${value}`,
          element: "#text",
          attributes: {},
          properties: {},
          children: [],
          listeners: new Map(),
        }),
        attribute(node, name, value) {
          if (value === undefined) delete node.attributes[name];
          else node.attributes[name] = value;
        },
        property(node, name, value) {
          if (value === undefined) delete node.properties[name];
          else node.properties[name] = value;
        },
        listen(node, event, listener) {
          node.listeners.set(event, listener);
          return () => {
            listenerDisposals.push(`${node.identity}:${event}`);
            node.listeners.delete(event);
          };
        },
        append(parent, child) {
          parent.children.push(child);
        },
        remove(node) {
          removed.push(node.identity);
        },
      },
      (action) => dispatched.push(action),
    );
    expect(mounted.roots).toHaveLength(1);
    expect(mounted.roots[0]?.children.map((child) => child.identity)).toEqual(["Mount.Action"]);
    expect(mounted.nodes.get("Mount.Action")?.children.map((child) => child.identity)).toEqual([
      "#text:Run",
    ]);
    const expanded = normalizeCandidateStructure(hierarchy, {
      reads: { "mount.expanded": true },
    });
    expect(
      updateCandidateStructureOnWeb(structure, expanded, mounted, {
        attribute(node, name, value) {
          if (value === undefined) delete node.attributes[name];
          else node.attributes[name] = value;
        },
        property(node, name, value) {
          if (value === undefined) delete node.properties[name];
          else node.properties[name] = value;
        },
      }),
    ).toEqual([{ identity: "Mount.Action", kind: "attribute", name: "aria-expanded" }]);
    expect(mounted.nodes.get("Mount.Action")?.attributes["aria-expanded"]).toBe(true);
    mounted.nodes.get("Mount.Action")?.listeners.get("click")?.({ type: "click" });
    expect(dispatched).toEqual(["Mount.run"]);
    mounted.dispose();
    mounted.dispose();
    expect(listenerDisposals).toEqual(["Mount.Action:click"]);
    expect(removed).toEqual(["Mount.Root"]);
    expect(mounted.nodes.size).toBe(0);

    const opacity = createCandidateTargetHandle<number>("Mount.Action", "opacity", "number");
    const fill = createCandidateTargetHandle("Mount.Action", "fill", "paint");
    const blockSize = createCandidateTargetHandle<CandidateLength>(
      "Mount.Action",
      "blockSize",
      "length",
    );
    const scene = normalizeSemanticOperations([
      setCandidateTarget(fill, {
        kind: "solid",
        color: { colorSpace: "oklch", lightness: 0.5, chroma: 0.1, hue: 30, alpha: 1 },
      }),
      setCandidateTarget(
        blockSize,
        createCandidateReadExpression<CandidateLength>("mount.blockSize"),
      ),
      setCandidateTarget(opacity, createCandidateReadExpression<number>("mount.opacity")),
      transitionCandidateTarget(opacity, createCandidateTransitionPolicy("fade", springDefinition)),
    ]);
    const starts: string[] = [];
    const stops: string[] = [];
    const visual = mountCandidatePresentationToWeb(scene, {
      stylesheet(target) {
        starts.push(`stylesheet:${target.property}`);
        return () => stops.push(`stylesheet:${target.property}`);
      },
      reactive(target) {
        starts.push(`reactive:${target.property}`);
        return () => stops.push(`reactive:${target.property}`);
      },
      retained(target) {
        starts.push(`retained:${target.property}`);
        return () => stops.push(`retained:${target.property}`);
      },
    });
    expect(starts).toEqual(["reactive:blockSize", "stylesheet:fill", "retained:opacity"]);
    visual.dispose();
    visual.dispose();
    expect(stops).toEqual(["retained:opacity", "stylesheet:fill", "reactive:blockSize"]);
  });

  test("reconciles retained branches, releases semantics, and reverses with native identity", () => {
    type FakeEvent = { readonly type: string };
    type FakeNode = {
      readonly identity: string;
      readonly element: string;
      attributes: Record<string, string | number | boolean>;
      properties: Record<string, string | number | boolean>;
      children: FakeNode[];
      parent?: FakeNode;
      value?: string;
      retained?: boolean;
      readonly listeners: Map<string, (event: FakeEvent) => void>;
    };
    const Root = issueCandidateStructurePart("Wallet", "Root", "main");
    const Common = issueCandidateStructurePart("Wallet", "Common", "p");
    const Default = issueCandidateStructurePart("Wallet", "Default", "div");
    const DefaultAction = issueCandidateStructurePart("Wallet", "DefaultAction", "button");
    const Detail = issueCandidateStructurePart("Wallet", "Detail", "div");
    const DetailAction = issueCandidateStructurePart("Wallet", "DetailAction", "button");
    const defaultAction = DefaultAction(
      { name: "Open", activate: issueCandidateAction("Wallet.open") },
      "Open",
    );
    const detailAction = DetailAction(
      { name: "Back", activate: issueCandidateAction("Wallet.back") },
      "Back",
    );
    const hierarchy = Root(
      {},
      Common({}, "Shared"),
      selectCandidateStructure<boolean>(createCandidateReadExpression<boolean>("wallet.detail"), {
        true: {
          content: Detail({ role: "group", name: "Detail" }, detailAction),
          focus: detailAction.reference,
        },
        false: {
          content: Default({ role: "group", name: "Default" }, defaultAction),
          focus: defaultAction.reference,
        },
      }),
    );
    const structure = (detail: boolean) =>
      normalizeCandidateStructure(hierarchy, { reads: { "wallet.detail": detail } });
    const removed: string[] = [];
    const retained: string[] = [];
    const restored: string[] = [];
    const focusCalls: string[] = [];
    let focusedIdentity = "Wallet.DefaultAction";
    const detach = (node: FakeNode): void => {
      const index = node.parent?.children.indexOf(node) ?? -1;
      if (index >= 0) node.parent!.children.splice(index, 1);
      delete node.parent;
    };
    const platform = {
      create: (element: string, identity: string): FakeNode => ({
        identity,
        element,
        attributes: {},
        properties: {},
        children: [],
        listeners: new Map(),
      }),
      text: (value: string): FakeNode => ({
        identity: `#text:${value}`,
        element: "#text",
        value,
        attributes: {},
        properties: {},
        children: [],
        listeners: new Map(),
      }),
      textValue(node: FakeNode, value: string) {
        node.value = value;
      },
      attribute(node: FakeNode, name: string, value: string | number | boolean | undefined) {
        if (value === undefined) delete node.attributes[name];
        else node.attributes[name] = value;
      },
      property(node: FakeNode, name: string, value: string | number | boolean | undefined) {
        if (value === undefined) delete node.properties[name];
        else node.properties[name] = value;
      },
      listen(node: FakeNode, event: string, listener: (event: FakeEvent) => void) {
        node.listeners.set(event, listener);
        return () => node.listeners.delete(event);
      },
      append(parent: FakeNode, child: FakeNode) {
        detach(child);
        parent.children.push(child);
        child.parent = parent;
      },
      place(parent: FakeNode, child: FakeNode, index: number) {
        detach(child);
        parent.children.splice(Math.min(index, parent.children.length), 0, child);
        child.parent = parent;
      },
      remove(node: FakeNode) {
        detach(node);
        removed.push(node.identity);
      },
      retain(node: FakeNode) {
        detach(node);
        node.retained = true;
        retained.push(node.identity);
      },
      restore(node: FakeNode) {
        node.retained = false;
        restored.push(node.identity);
      },
      focusedIdentity: () => focusedIdentity,
      focus(node: FakeNode) {
        focusedIdentity = node.identity;
        focusCalls.push(node.identity);
      },
      activateModal(_node: FakeNode, initialFocus: FakeNode) {
        focusedIdentity = initialFocus.identity;
      },
      deactivateModal(_node: FakeNode, returnFocus: FakeNode) {
        focusedIdentity = returnFocus.identity;
      },
    };
    const mounted = mountCandidateReconciledStructureToWeb<FakeNode, FakeEvent>(
      structure(false),
      platform,
      () => {},
    );
    const root = mounted.nodes.get("Wallet.Root")!;
    const defaultNode = mounted.nodes.get("Wallet.Default")!;
    const first = mounted.reconcile(structure(true), { retain: ["Wallet.Default"] });
    expect(
      root.children.filter((node) => node.element !== "#text").map((node) => node.identity),
    ).toEqual(["Wallet.Common", "Wallet.Detail"]);
    expect(defaultNode).toMatchObject({
      retained: true,
      attributes: { "aria-hidden": true },
      properties: { inert: true },
    });
    expect(defaultNode.children[0]?.listeners.size).toBe(0);
    expect(first.focusRecovery).toEqual({
      from: "Wallet.DefaultAction",
      to: "Wallet.DetailAction",
    });
    expect(focusedIdentity).toBe("Wallet.DetailAction");
    expect(mounted.settleExit("Wallet.Default", first.retained[0]!.revision - 1)).toBe(false);
    const partial = normalizeCandidateStructure(
      Root(
        {},
        DefaultAction({ name: "Open", activate: issueCandidateAction("Wallet.open") }, "Open"),
      ),
    );
    expect(() => mounted.reconcile(partial)).toThrow(
      'cannot reenter without subtree root "Wallet.Default"',
    );

    const second = mounted.reconcile(structure(false), { retain: ["Wallet.Detail"] });
    expect(second.reversed).toEqual(["Wallet.Default"]);
    expect(planCandidatePresenceCommands(second)).toEqual({
      enter: [{ identity: "Wallet.Default", reversal: true }],
      exit: [{ identity: "Wallet.Detail", revision: second.retained[0]!.revision }],
    });
    expect(mounted.nodes.get("Wallet.Default")).toBe(defaultNode);
    expect(
      root.children.filter((node) => node.element !== "#text").map((node) => node.identity),
    ).toEqual(["Wallet.Common", "Wallet.Default"]);
    expect(defaultNode).toMatchObject({ retained: false, attributes: {}, properties: {} });
    expect(defaultNode.children[0]?.listeners.has("click")).toBe(true);
    expect(second.focusRecovery).toEqual({
      from: "Wallet.DetailAction",
      to: "Wallet.DefaultAction",
    });
    expect(focusCalls).toEqual(["Wallet.DetailAction", "Wallet.DefaultAction"]);
    expect(mounted.settleExit("Wallet.Default", first.retained[0]!.revision)).toBe(false);
    expect(mounted.settleExit("Wallet.Detail", second.retained[0]!.revision)).toBe(true);
    expect(retained).toEqual(["Wallet.Default", "Wallet.Detail"]);
    expect(restored).toEqual(["Wallet.Default"]);
    expect(removed).toContain("Wallet.Detail");
    mounted.dispose();
  });

  test("coordinates native modal activation with declared initial and return focus", () => {
    type Node = {
      identity: string;
      children: Node[];
      parent?: Node;
      attributes: Record<string, string | number | boolean>;
      properties: Record<string, string | number | boolean>;
      listeners: Map<string, (event: unknown) => void>;
    };
    const Root = issueCandidateStructurePart("Modal", "Root", "main");
    const Trigger = issueCandidateStructurePart("Modal", "Trigger", "button");
    const Dialog = issueCandidateStructurePart("Modal", "Dialog", "dialog");
    const Close = issueCandidateStructurePart("Modal", "Close", "button");
    const open = createCandidateReadExpression<boolean>("modal.open");
    const present = createCandidateReadExpression<boolean>("modal.present");
    const close = Close({ name: "Close", activate: issueCandidateAction("Modal.close") }, "Close");
    const dialog = Dialog(
      {
        name: "Modal",
        modal: open,
        hidden: notCandidate(present),
        dismiss: issueCandidateAction("Modal.close"),
      },
      close,
    );
    const trigger = Trigger(
      {
        name: "Open",
        controls: dialog.reference,
        activate: issueCandidateAction("Modal.open"),
      },
      "Open",
    );
    const hierarchy = Root({}, trigger, dialog);
    const structure = (isOpen: boolean, isPresent: boolean) =>
      normalizeCandidateStructure(hierarchy, {
        reads: { "modal.open": isOpen, "modal.present": isPresent },
        ...(isOpen
          ? {
              activeModal: {
                identity: dialog.reference,
                initialFocus: close.reference,
                returnFocus: trigger.reference,
              },
            }
          : {}),
      });
    const detach = (node: Node): void => {
      if (!node.parent) return;
      node.parent.children = node.parent.children.filter((child) => child !== node);
      delete node.parent;
    };
    const modalCalls: string[] = [];
    let focused: string | undefined;
    const mounted = mountCandidateReconciledStructureToWeb<Node, unknown>(
      structure(false, false),
      {
        create: (_element, identity) => ({
          identity,
          children: [],
          attributes: {},
          properties: {},
          listeners: new Map(),
        }),
        text: (value) => ({
          identity: `#text:${value}`,
          children: [],
          attributes: {},
          properties: {},
          listeners: new Map(),
        }),
        textValue: () => {},
        attribute(node, name, value) {
          if (value === undefined) delete node.attributes[name];
          else node.attributes[name] = value;
        },
        property(node, name, value) {
          if (value === undefined) delete node.properties[name];
          else node.properties[name] = value;
        },
        listen(node, event, listener) {
          node.listeners.set(event, listener);
          return () => node.listeners.delete(event);
        },
        append(parent, child) {
          detach(child);
          parent.children.push(child);
          child.parent = parent;
        },
        place(parent, child, index) {
          detach(child);
          parent.children.splice(index, 0, child);
          child.parent = parent;
        },
        remove: detach,
        retain: detach,
        restore: () => {},
        focusedIdentity: () => focused,
        focus(node) {
          focused = node.identity;
        },
        activateModal(node, initialFocus, focusVisibility) {
          modalCalls.push(`open:${node.identity}:${initialFocus.identity}:${focusVisibility}`);
          focused = initialFocus.identity;
        },
        deactivateModal(node, returnFocus) {
          modalCalls.push(`close:${node.identity}:${returnFocus.identity}`);
          focused = returnFocus.identity;
        },
      },
      () => {},
    );

    mounted.reconcile(structure(true, true));
    expect(modalCalls).toEqual(["open:Modal.Dialog:Modal.Close:visible"]);
    expect(focused).toBe("Modal.Close");
    mounted.reconcile(structure(false, true));
    expect(modalCalls).toEqual([
      "open:Modal.Dialog:Modal.Close:visible",
      "close:Modal.Dialog:Modal.Trigger",
    ]);
    expect(focused as string | undefined).toBe("Modal.Trigger");
    focused = undefined;
    mounted.reconcile(structure(false, false));
    expect(focused as string | undefined).toBe("Modal.Trigger");
    mounted.dispose();
  });

  test("different internal strategies preserve observable endpoints and relationships", () => {
    const opacity = createCandidateTargetHandle<number>("Drawer.Backdrop", "opacity");
    const scale = createCandidateTargetHandle<number>("Drawer.Page", "scale");
    const fill = createCandidateTargetHandle<string>("Drawer.Surface", "fill");
    const spring = createCandidateTransitionPolicy<number>("spring", springDefinition);
    const targets = normalizeSemanticOperations([
      setCandidateTarget(opacity, 0.32),
      setCandidateTarget(scale, 0.96),
      setCandidateTarget(fill, "surface"),
      transitionCandidateTarget(opacity, spring),
      transitionCandidateTarget(scale, spring),
    ]);
    const relationships = drawerRelationships();
    const layout = drawerLayout();
    const gestures = drawerGestures();

    expect(targets.transaction.targets).toEqual([
      "Drawer.Backdrop:opacity",
      "Drawer.Page:scale",
      "Drawer.Surface:fill",
    ]);

    expect(
      new RetainedCandidateAdapter().apply(targets, relationships, layout, false, gestures),
    ).toEqual(new ReferenceCandidateAdapter().apply(targets, relationships, layout, gestures));
  });

  test("retained lowering retargets from its presented value and velocity", () => {
    const scale = createCandidateTargetHandle<number>("Drawer.Page", "scale");
    const spring = createCandidateTransitionPolicy<number>("spring", springDefinition);
    const adapter = new RetainedCandidateAdapter();
    adapter.direct(scale.key, 0.8, -1.5);

    const scene = normalizeSemanticOperations([
      setCandidateTarget(scale, 1),
      transitionCandidateTarget(scale, spring),
    ]);
    adapter.apply(scene, drawerRelationships(), drawerLayout());

    expect(adapter.lastMotion(scale.key)).toEqual({
      from: 0.8,
      velocity: -1.5,
      to: 1,
      policy: "spring",
    });
    expect(adapter.active(scale.key)).toBeUndefined();
    expect(adapter.apply(scene, drawerRelationships(), drawerLayout()).targets[scale.key]).toBe(1);
    expect(adapter.motionCount).toBe(1);
  });

  test("derives policy-only and reduced-motion updates without restarting unchanged channels", () => {
    const scale = createCandidateTargetHandle<number>("Drawer.Page", "scale");
    const spring = createCandidateTransitionPolicy<number>("spring", springDefinition);
    const soft = createCandidateTransitionPolicy<number>("soft", {
      normal: { kind: "spring", mass: 1, stiffness: 260, damping: 28 },
      reduced: { kind: "instant" },
    });
    const adapter = new RetainedCandidateAdapter();
    const initial = normalizeSemanticOperations([
      setCandidateTarget(scale, 1),
      transitionCandidateTarget(scale, spring),
    ]);
    adapter.apply(initial, drawerRelationships(), drawerLayout());
    expect(adapter.motionCount).toBe(0);

    adapter.direct(scale.key, 0.9, 1.7);
    const themed = normalizeSemanticOperations([
      setCandidateTarget(scale, 1),
      transitionCandidateTarget(scale, soft),
    ]);
    adapter.apply(themed, drawerRelationships(), drawerLayout(), false, undefined, "theme");
    expect(adapter.lastMotion(scale.key)).toEqual({
      from: 0.9,
      velocity: 1.7,
      to: 1,
      policy: "soft",
    });
    expect(adapter.motionCount).toBe(1);
    adapter.apply(themed, drawerRelationships(), drawerLayout(), false, undefined, "theme");
    expect(adapter.motionCount).toBe(1);

    adapter.direct(scale.key, 0.95, 0.8);
    adapter.apply(themed, drawerRelationships(), drawerLayout(), true, undefined, "reducedMotion");
    expect(adapter.lastMotion(scale.key)).toEqual({
      from: 1,
      velocity: 0,
      to: 1,
      policy: "soft",
    });
    expect(adapter.motionCount).toBe(2);
    adapter.apply(themed, drawerRelationships(), drawerLayout(), false, undefined, "environment");
    expect(adapter.motionCount).toBe(2);
  });

  test("retained lowering follows timing and reduced-motion handoff semantics", () => {
    const scale = createCandidateTargetHandle<number>("Drawer.Page", "scale");
    const timing = createCandidateTransitionPolicy<number>("timing", timingDefinition);
    const spring = createCandidateTransitionPolicy<number>("spring", springDefinition);
    const adapter = new RetainedCandidateAdapter();
    adapter.direct(scale.key, 0.8, -1.5);
    adapter.apply(
      normalizeSemanticOperations([
        setCandidateTarget(scale, 1),
        transitionCandidateTarget(scale, timing),
      ]),
      drawerRelationships(),
      drawerLayout(),
    );
    expect(adapter.lastMotion(scale.key)).toEqual({
      from: 0.8,
      velocity: 0,
      to: 1,
      policy: "timing",
    });

    adapter.direct(scale.key, 0.9, 2);
    adapter.apply(
      normalizeSemanticOperations([
        setCandidateTarget(scale, 1),
        transitionCandidateTarget(scale, spring),
      ]),
      drawerRelationships(),
      drawerLayout(),
      true,
    );
    expect(adapter.lastMotion(scale.key)).toEqual({
      from: 1,
      velocity: 0,
      to: 1,
      policy: "spring",
    });
  });

  test("independent layout adapters agree across a stable-identity parent swap", () => {
    const grid = createCandidatePresentationIdentity("Swap.Grid");
    const detail = createCandidatePresentationIdentity("Swap.Detail");
    const card = createCandidatePresentationIdentity("Swap.Card");
    const previousLayout = normalizeSemanticLayout(
      [grid, detail, card],
      [arrangeCandidate(grid, [card], overlayCandidate({ align: "stretch" }))],
    );
    const nextLayout = normalizeSemanticLayout(
      [grid, detail, card],
      [arrangeCandidate(detail, [card], overlayCandidate({ align: "stretch" }))],
    );
    const previous = { inline: 12, block: 24, inlineSize: 120, blockSize: 80 };
    const next = { inline: 160, block: 96, inlineSize: 300, blockSize: 200 };

    expect(
      new FormulaProjectionAdapter().apply(card.key, previousLayout, nextLayout, previous, next),
    ).toEqual(
      new ReferenceProjectionAdapter().apply(card.key, previousLayout, nextLayout, previous, next),
    );
  });

  test("independent layout-transition formulas agree across interruption and resize traces", () => {
    const formula = new FormulaLayoutTransitionAdapter();
    let seed = 0x7a11_0a7;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let trace = 0; trace < 1_000; trace++) {
      const presented = {
        inline: (random() - 0.5) * 2_000,
        block: (random() - 0.5) * 2_000,
        inlineSize: 1 + random() * 1_000,
        blockSize: 1 + random() * 1_000,
      };
      const target = {
        inline: (random() - 0.5) * 2_000,
        block: (random() - 0.5) * 2_000,
        inlineSize: 1 + random() * 1_000,
        blockSize: 1 + random() * 1_000,
      };
      const velocity = {
        inline: (random() - 0.5) * 2_000,
        block: (random() - 0.5) * 2_000,
        logInlineSize: (random() - 0.5) * 4,
        logBlockSize: (random() - 0.5) * 4,
      };
      const driver = (["instant", "timing", "spring"] as const)[trace % 3]!;
      const options = {
        identity: `item-${trace}`,
        previousParent: trace % 2 ? "grid" : "detail",
        nextParent: "detail",
        presented,
        velocity,
        target,
        driver,
        reducedMotion: trace % 7 === 0,
      } as const;
      expect(formula.apply(options)).toEqual(resolveReferenceLayoutTransition(options));
    }
  });

  test("executes hot refresh by capturing, disposing, then rebinding retained samples", () => {
    const Root = issueCandidateStructurePart("Refresh", "Root", "div");
    const structure = normalizeCandidateStructure(Root({}));
    const target = createCandidateTargetHandle<number>("Refresh.Root", "opacity", "number");
    const geometry = createCandidateDerivedTargetHandle<CandidateGeometry>(
      "Refresh.Root",
      "geometry",
      "geometry",
    );
    const layoutPolicy = createCandidateTransitionPolicy<CandidateGeometry>(
      "refresh-layout",
      layoutDefinition,
    );
    const targets = normalizeSemanticOperations(
      [setCandidateTarget(target, 1), transitionCandidateTarget(geometry, layoutPolicy)],
      [geometry],
    );
    const artifact = {
      version: 1,
      component: "Refresh",
      behavior: normalizeReferenceChart({ initial: "ready", states: { ready: {} } }),
      structure,
      presentation: {
        targets,
        relationships: normalizeSemanticRelationships(
          [createCandidatePresentationIdentity("Refresh.Root")],
          [],
        ),
        directManipulation: normalizeCandidateDirectManipulation([]),
        layout: normalizeSemanticLayout([createCandidatePresentationIdentity("Refresh.Root")], []),
      },
    } as const;
    const next = {
      ...artifact,
      presentation: {
        ...artifact.presentation,
        targets: normalizeSemanticOperations(
          [setCandidateTarget(target, 0.8), transitionCandidateTarget(geometry, layoutPolicy)],
          [geometry],
        ),
      },
    };
    const calls: string[] = [];
    const resolution = executeCandidateHotReload(artifact, next, {
      snapshot() {
        calls.push("snapshot");
        return {
          presence: [{ identity: "Refresh.Root", phase: "exiting" }],
          motions: [
            { kind: "scalar", identity: target.key, value: 0.43, velocity: -1.25 },
            {
              kind: "layout",
              identity: geometry.key,
              value: { inline: 18, block: 42, inlineSize: 320, blockSize: 180 },
              velocity: {
                inline: -32,
                block: 14,
                logInlineSize: 0.2,
                logBlockSize: -0.1,
              },
            },
            {
              kind: "scalar",
              identity: "Refresh.Removed:opacity",
              value: 0.2,
              velocity: 0,
            },
          ],
          tasks: ["Refresh.save"],
          gestures: ["Refresh.drag"],
        };
      },
      disposeMotion(identity) {
        calls.push(`dispose-motion:${identity}`);
      },
      disposeTask(identity) {
        calls.push(`dispose-task:${identity}`);
      },
      disposeGesture(identity) {
        calls.push(`dispose-gesture:${identity}`);
      },
      rebind(_artifact, retained) {
        const layout = retained.motion.find((sample) => sample.kind === "layout");
        calls.push(`rebind:${retained.presence[0]?.phase}:${layout?.velocity.inline}`);
      },
      remount() {
        calls.push("remount");
      },
    });
    expect(resolution.remount).toBe(false);
    expect(calls).toEqual([
      "snapshot",
      "dispose-motion:Refresh.Removed:opacity",
      "dispose-task:Refresh.save",
      "dispose-gesture:Refresh.drag",
      "rebind:exiting:-32",
    ]);

    const incompatible = {
      ...next,
      component: "Refresh.v2",
    };
    const incompatibleCalls: string[] = [];
    expect(
      executeCandidateHotReload(next, incompatible, {
        snapshot: () => ({ presence: [], motions: [], tasks: [], gestures: [] }),
        disposeMotion: () => incompatibleCalls.push("dispose-motion"),
        disposeTask: () => incompatibleCalls.push("dispose-task"),
        disposeGesture: () => incompatibleCalls.push("dispose-gesture"),
        rebind: () => incompatibleCalls.push("rebind"),
        remount: () => incompatibleCalls.push("remount"),
      }).remount,
    ).toBe(true);
    expect(incompatibleCalls).toEqual(["remount"]);
  });

  test("measurement adapters transact font and media geometry without replaying semantics", () => {
    const reference = new ReferenceMeasurementCoordinator();
    const candidate = new CandidateMeasurementAdapter();
    const staleReference = reference.begin("font");
    const staleCandidate = candidate.begin("font");
    const currentReference = reference.begin("container");
    const currentCandidate = candidate.begin("container");
    const measurements = [
      { identity: "Card.Media", inlineSize: 320, blockSize: 180 },
      { identity: "Card.Content", inlineSize: 320, blockSize: 124 },
    ];
    expect(reference.commit(staleReference, measurements)).toEqual({ accepted: false });
    expect(candidate.commit(staleCandidate, measurements)).toEqual({ accepted: false });
    const referenceCommit = reference.commit(currentReference, measurements);
    const candidateCommit = candidate.commit(currentCandidate, measurements);
    expect(candidateCommit).toEqual(referenceCommit);
    expect(referenceCommit).toMatchObject({
      accepted: true,
      cause: "geometry",
      origin: "container",
      semanticChanged: false,
      presenceChanged: false,
      changes: [{ identity: "Card.Content" }, { identity: "Card.Media" }],
    });

    const mediaReference = reference.begin("media");
    const mediaCandidate = candidate.begin("media");
    expect(candidate.commit(mediaCandidate, measurements)).toEqual(
      reference.commit(mediaReference, measurements),
    );
    expect(candidate.commit(candidate.begin("font"), measurements)).toMatchObject({ changes: [] });
    expect(reference.commit(reference.begin("font"), measurements)).toMatchObject({ changes: [] });

    const invalidReference = reference.begin("font");
    const invalidCandidate = candidate.begin("font");
    const invalid = [...measurements, { identity: "Card.Invalid", inlineSize: 0, blockSize: 20 }];
    expect(() => reference.commit(invalidReference, invalid)).toThrow("positive size");
    expect(() => candidate.commit(invalidCandidate, invalid)).toThrow("positive size");

    const changed = [{ identity: "Card.Content", inlineSize: 320, blockSize: 180 }];
    const changedReference = reference.commit(reference.begin("content"), changed);
    const changedCandidate = candidate.commit(candidate.begin("content"), changed);
    expect(changedCandidate).toEqual(changedReference);
    expect(changedReference).toMatchObject({ semanticChanged: false, presenceChanged: false });
    expect(
      resolveReferenceLayoutTransition({
        identity: "Card.Content",
        previousParent: "Card",
        nextParent: "Card",
        presented: { inline: 0, block: 0, inlineSize: 320, blockSize: 142 },
        target: { inline: 0, block: 0, inlineSize: 320, blockSize: 180 },
        velocity: { inline: 0, block: 0, logInlineSize: 0, logBlockSize: 0.4 },
        driver: "spring",
        reducedMotion: false,
      }),
    ).toMatchObject({ from: { blockSize: 142 }, target: { blockSize: 180 }, strategy: "retarget" });
  });

  test("independent gesture adapters agree on capture loss and stale callbacks", () => {
    const reference = new ReferenceGestureSession();
    const formula = new FormulaGestureSession();
    const referenceRevision = reference.begin(4);
    const formulaRevision = formula.begin(4);
    expect(formulaRevision).toBe(referenceRevision);
    expect(formula.sample(formulaRevision, 4, 120, 600)).toBe(
      reference.sample(referenceRevision, 4, 120, 600),
    );
    expect(formula.end(formulaRevision, "capture-lost")).toBe(
      reference.end(referenceRevision, "capture-lost"),
    );
    expect(formula.sample(formulaRevision, 4, 140, 500)).toBe(
      reference.sample(referenceRevision, 4, 140, 500),
    );
    expect(formula.snapshot).toEqual(reference.snapshot);

    const target = createCandidateTargetHandle<number>("Gesture", "value");
    const gesture = createCandidateRecognizerHandle<"pinch", "rest">("Gesture.pinch", "pinch");
    expect(
      normalizeCandidateDirectManipulation([driveCandidate(target, gesture, gesture.scale)])
        .lifecycle,
    ).toEqual({
      capture: "on-recognition",
      release: ["commit", "cancel", "capture-lost", "absent", "dispose"],
      stale: "ignore",
    });
  });

  test("independent presence adapters agree through multi-target exit reversal", () => {
    const targets = ["Presence.Content:transform", "Presence.Content:layer:8:backdrop:opacity"];
    const reference = new ReferencePresenceCoordinator("Presence.Content");
    const formula = new FormulaPresenceCoordinator();
    const enter = reference.target(true, targets);
    expect(formula.target(true, targets)).toBe(enter);
    for (const target of targets) {
      expect(formula.settle(enter, target)).toBe(reference.settle(enter, target));
    }
    expect(formula.snapshot).toEqual(reference.snapshot);

    const exit = reference.target(false, targets);
    expect(formula.target(false, targets)).toBe(exit);
    expect(formula.snapshot).toEqual(reference.snapshot);
    const reversal = reference.target(true, targets);
    expect(formula.target(true, targets)).toBe(reversal);
    expect(formula.settle(exit, targets[0]!)).toBe(reference.settle(exit, targets[0]!));
    for (const target of targets) {
      expect(formula.settle(reversal, target)).toBe(reference.settle(reversal, target));
    }
    expect(formula.snapshot).toEqual(reference.snapshot);
  });

  test("nested overlay close waits for descendants and reverses as one revision", () => {
    const reference = new ReferenceOverlayCloseCascade();
    const candidate = new CandidateOverlayCloseAdapter();
    const stack = ["Dialog", "Popover"];
    const parentPresence = new ReferencePresenceCoordinator("Dialog");
    const childPresence = new ReferencePresenceCoordinator("Popover");
    const parentTarget = "Dialog:opacity";
    const childTarget = "Popover:opacity";
    const parentEnter = parentPresence.target(true, [parentTarget]);
    const childEnter = childPresence.target(true, [childTarget]);
    parentPresence.settle(parentEnter, parentTarget);
    childPresence.settle(childEnter, childTarget);

    const firstReference = reference.begin(stack, "Dialog");
    const firstCandidate = candidate.begin(stack, "Dialog");
    expect(firstCandidate).toEqual(firstReference);
    expect(firstReference.current).toBe("Popover");
    const childExit = childPresence.target(false, [childTarget]);
    expect(parentPresence.snapshot.phase).toBe("present");
    expect(childPresence.snapshot).toMatchObject({
      phase: "exiting",
      interactive: false,
      accessible: false,
    });
    const referenceReversal = reference.reverse(firstReference.revision);
    const candidateReversal = candidate.reverse(firstCandidate.revision);
    expect(candidateReversal).toEqual(referenceReversal);
    expect(referenceReversal).toEqual({
      accepted: true,
      revision: firstReference.revision + 1,
      restore: ["Dialog", "Popover"],
    });
    const childReversal = childPresence.target(true, [childTarget]);
    expect(childPresence.settle(childExit, childTarget)).toBe(false);
    expect(childPresence.settle(childReversal, childTarget)).toBe(true);
    expect(reference.settle(firstReference.revision, "Popover")).toEqual({ accepted: false });
    expect(candidate.settle(firstCandidate.revision, "Popover")).toEqual({ accepted: false });

    const finalReference = reference.begin(stack, "Dialog");
    const finalCandidate = candidate.begin(stack, "Dialog");
    const finalChildExit = childPresence.target(false, [childTarget]);
    childPresence.settle(finalChildExit, childTarget);
    const nextReference = reference.settle(finalReference.revision, "Popover");
    const nextCandidate = candidate.settle(finalCandidate.revision, "Popover");
    expect(nextCandidate).toEqual(nextReference);
    expect(nextReference).toEqual({ accepted: true, next: "Dialog" });
    const parentExit = parentPresence.target(false, [parentTarget]);
    expect(parentPresence.settle(parentExit, parentTarget)).toBe(true);
    expect(reference.settle(finalReference.revision, "Dialog")).toEqual({
      accepted: true,
      complete: true,
    });
    expect(candidate.settle(finalCandidate.revision, "Dialog")).toEqual({
      accepted: true,
      complete: true,
    });
    expect(parentPresence.snapshot.phase).toBe("absent");
  });

  test("unsupported meaning fails before adapter execution", () => {
    expect(() =>
      validateCandidateCapabilities(["nativeDialog", "physicalSpring", "compositionClip"], {
        nativeDialog: "native",
        compositionClip: "lowered",
      }),
    ).toThrow('Adapter does not support required UI meaning "physicalSpring".');
    expect(() =>
      validateCandidateCapabilities(["nativeDialog", "physicalSpring", "compositionClip"], {
        nativeDialog: "native",
        physicalSpring: "lowered",
        compositionClip: "lowered",
      }),
    ).not.toThrow();
  });
});

function gestureIntentScene(
  intents: CandidateRecognizerScene["intents"],
  relations: CandidateRecognizerScene["relations"] = [],
): CandidateRecognizerScene {
  return { intents, relations };
}

function gestureSampleFinite(sample: CandidateWebGestureSample): boolean {
  if (sample.kind === "translation") {
    return [...Object.values(sample.value), ...Object.values(sample.velocity)].every(
      Number.isFinite,
    );
  }
  if (sample.kind === "rotation") {
    return Number.isFinite(sample.value.value) && Number.isFinite(sample.velocity);
  }
  return Number.isFinite(sample.value) && Number.isFinite(sample.velocity);
}

const dragActivation = {
  axis: "block",
  threshold: { dimension: "length", value: 4 },
} as const;

describe("candidate web gesture lowering", () => {
  test("mounts pointer delivery, capture, prediction, release, and disposal through a thin port", () => {
    type Pointer = {
      readonly pointerId: number;
      readonly clientX: number;
      readonly clientY: number;
      readonly timeStamp: number;
      readonly getCoalescedEvents?: () => readonly Pointer[];
      readonly getPredictedEvents?: () => readonly Pointer[];
    };
    type Node = {
      readonly listeners: Map<string, (event: Pointer) => void>;
    };
    const node: Node = { listeners: new Map() };
    const captures: number[] = [];
    const releases: number[] = [];
    const touchActions: string[] = [];
    const events: Array<[string, string, number]> = [];
    const predicted: number[] = [];
    const cleanups: string[] = [];
    const scene = gestureIntentScene([
      {
        name: "dismiss",
        kind: "drag",
        region: "Surface",
        activation: dragActivation,
        outcomes: [
          { outcome: "closed", action: "close" },
          { outcome: "open", action: "restore" },
        ],
        alternative: { kind: "action", action: "close" },
      },
    ]);
    const mounted = mountCandidateGesturesToWeb(
      scene,
      new Map([["Surface", node]]),
      {
        listen(owner, event, listener) {
          owner.listeners.set(event, listener);
          return () => {
            cleanups.push(event);
            owner.listeners.delete(event);
          };
        },
        touchAction(_owner, value) {
          touchActions.push(value);
          return () => cleanups.push("touch-action");
        },
        capture(_owner, pointer) {
          captures.push(pointer);
        },
        release(_owner, pointer) {
          releases.push(pointer);
        },
      },
      (event) => {
        const value = event.sample.kind === "translation" ? event.sample.value.block : 0;
        events.push([event.phase, event.reason ?? "", value]);
      },
      (samples) => predicted.push(...samples.map((sample) => sample.block)),
    );
    const fire = (
      event: "pointerdown" | "pointermove" | "pointerup",
      pointerId: number,
      block: number,
      timeStamp: number,
      extra: Partial<Pointer> = {},
    ) =>
      node.listeners.get(event)?.({
        pointerId,
        clientX: 20,
        clientY: block,
        timeStamp,
        ...extra,
      });

    fire("pointerdown", 7, 100, 0);
    fire("pointermove", 7, 108, 20, {
      getPredictedEvents: () => [{ pointerId: 7, clientX: 20, clientY: 112, timeStamp: 24 }],
    });
    fire("pointerup", 7, 112, 30);
    expect(touchActions).toEqual(["pan-x"]);
    expect(captures).toEqual([7]);
    expect(releases).toEqual([7]);
    expect(predicted).toEqual([112]);
    expect(events).toEqual([
      ["begin", "", 8],
      ["release", "", 12],
    ]);

    fire("pointerdown", 9, 50, 40);
    fire("pointermove", 9, 60, 50);
    mounted.dispose();
    mounted.dispose();
    expect(captures).toEqual([7, 9]);
    expect(releases).toEqual([7, 9]);
    expect(events.at(-1)).toEqual(["cancel", "capture-lost", 10]);
    expect(cleanups).toEqual([
      "lostpointercapture",
      "pointercancel",
      "pointerup",
      "pointermove",
      "pointerdown",
      "touch-action",
    ]);
  });

  test("derives browser policy and lowers drag to capture, samples, and release", () => {
    const scene = gestureIntentScene([
      {
        name: "dismiss",
        kind: "drag",
        region: "Surface",
        activation: dragActivation,
        outcomes: [
          { outcome: "closed", action: "close" },
          { outcome: "open", action: "restore" },
        ],
        alternative: { kind: "action", action: "close" },
      },
    ]);
    expect(resolveCandidateWebGesturePlan(scene)).toEqual({
      regions: [
        {
          region: "Surface",
          touchAction: "pan-x",
          coalescedInput: true,
          predictedInput: "presentation-only",
          capture: "on-recognition",
          delivery: "direct",
        },
      ],
    });
    expect(resolveCandidateWebGesturePlan(scene, "vertical").regions[0]!.touchAction).toBe("pan-y");
    const adapter = new CandidateWebGestureAdapter(scene);
    expect(adapter.alternative("dismiss")).toEqual({ kind: "action", action: "close" });
    expect(
      adapter.process({
        phase: "down",
        pointer: 7,
        region: "Surface",
        inline: 20,
        block: 100,
        time: 0,
      }),
    ).toEqual({ events: [], effects: [] });
    expect(
      adapter.process({
        phase: "move",
        pointer: 7,
        region: "Surface",
        inline: 20,
        block: 102,
        time: 10,
      }),
    ).toEqual({ events: [], effects: [] });
    expect(
      adapter.process({
        phase: "move",
        pointer: 7,
        region: "Surface",
        inline: 20,
        block: 108,
        time: 20,
      }),
    ).toEqual({
      events: [
        {
          gesture: "dismiss",
          recognizer: "drag",
          phase: "begin",
          pointers: [7],
          sample: {
            kind: "translation",
            value: { inline: 0, block: 8 },
            velocity: { inline: 0, block: 600 },
          },
        },
      ],
      effects: [{ kind: "capture", pointer: 7, region: "Surface" }],
    });
    expect(
      adapter.process({
        phase: "up",
        pointer: 7,
        region: "Surface",
        inline: 20,
        block: 112,
        time: 30,
      }),
    ).toEqual({
      events: [
        {
          gesture: "dismiss",
          recognizer: "drag",
          phase: "release",
          pointers: [7],
          sample: {
            kind: "translation",
            value: { inline: 0, block: 12 },
            velocity: { inline: 0, block: 400 },
          },
        },
      ],
      effects: [{ kind: "release", pointer: 7, region: "Surface" }],
    });
  });

  test("shares capture across simultaneous pinch and rotation, then cancels once", () => {
    const scene = gestureIntentScene(
      [
        {
          name: "pinch",
          kind: "pinch",
          region: "Canvas",
          activation: { threshold: 0.05 },
          outcomes: [{ outcome: "settled", action: "settleZoom" }],
          alternative: { kind: "action", action: "zoomByKeyboard" },
        },
        {
          name: "rotate",
          kind: "rotate",
          region: "Canvas",
          activation: { threshold: { dimension: "angle", value: 5 } },
          outcomes: [{ outcome: "settled", action: "settleRotation" }],
          alternative: { kind: "action", action: "rotateByKeyboard" },
        },
      ],
      [{ kind: "simultaneous", first: "pinch", second: "rotate" }],
    );
    expect(resolveCandidateWebGesturePlan(scene).regions[0]!.touchAction).toBe("none");
    const adapter = new CandidateWebGestureAdapter(scene);
    adapter.process({ phase: "down", pointer: 1, region: "Canvas", inline: 0, block: 0, time: 0 });
    adapter.process({
      phase: "down",
      pointer: 2,
      region: "Canvas",
      inline: 100,
      block: 0,
      time: 0,
    });
    const pinch = adapter.process({
      phase: "move",
      pointer: 2,
      region: "Canvas",
      inline: 120,
      block: 0,
      time: 20,
    });
    expect(pinch.events.map((event) => [event.gesture, event.phase])).toEqual([["pinch", "begin"]]);
    const pinchSample = pinch.events[0]!.sample;
    expect(pinchSample.kind).toBe("scale");
    if (pinchSample.kind !== "scale") throw new Error("Expected a scale sample.");
    expect(pinchSample.value).toBe(1.2);
    expect(pinchSample.velocity).toBeCloseTo(10, 10);
    expect(pinch.effects).toEqual([
      { kind: "capture", pointer: 1, region: "Canvas" },
      { kind: "capture", pointer: 2, region: "Canvas" },
    ]);
    const coordinated = adapter.process({
      phase: "move",
      pointer: 2,
      region: "Canvas",
      inline: 104,
      block: 60,
      time: 40,
    });
    expect(coordinated.events.map((event) => [event.gesture, event.phase])).toEqual([
      ["pinch", "change"],
      ["rotate", "begin"],
    ]);
    expect(coordinated.events.every((event) => gestureSampleFinite(event.sample))).toBe(true);
    expect(coordinated.effects).toEqual([]);
    const cancelled = adapter.process({
      phase: "capture-lost",
      pointer: 2,
      region: "Canvas",
      inline: 104,
      block: 60,
      time: 41,
    });
    expect(cancelled.events.map((event) => [event.gesture, event.phase, event.reason])).toEqual([
      ["pinch", "cancel", "capture-lost"],
      ["rotate", "cancel", "capture-lost"],
    ]);
    expect(cancelled.effects).toEqual([
      { kind: "release", pointer: 1, region: "Canvas" },
      { kind: "release", pointer: 2, region: "Canvas" },
    ]);
  });

  test("uses explicit exclusivity and failure dependencies without declaration-order races", () => {
    const exclusive = gestureIntentScene(
      [
        {
          name: "first",
          kind: "drag",
          region: "Surface",
          activation: dragActivation,
          outcomes: [{ outcome: "done", action: "firstDone" }],
          alternative: { kind: "action", action: "firstKeyboard" },
        },
        {
          name: "second",
          kind: "drag",
          region: "Surface",
          activation: dragActivation,
          outcomes: [{ outcome: "done", action: "secondDone" }],
          alternative: { kind: "action", action: "secondKeyboard" },
        },
      ],
      [{ kind: "exclusive", first: "second", second: "first" }],
    );
    const preferred = new CandidateWebGestureAdapter(exclusive);
    preferred.process({
      phase: "down",
      pointer: 1,
      region: "Surface",
      inline: 0,
      block: 0,
      time: 0,
    });
    expect(
      preferred
        .process({
          phase: "move",
          pointer: 1,
          region: "Surface",
          inline: 0,
          block: 8,
          time: 10,
        })
        .events.map((event) => event.gesture),
    ).toEqual(["second"]);

    const dependent = gestureIntentScene(
      [
        {
          name: "horizontal",
          kind: "pan",
          region: "Surface",
          activation: {
            axis: "inline",
            threshold: { dimension: "length", value: 4 },
          },
          outcomes: [{ outcome: "done", action: "horizontalDone" }],
          alternative: { kind: "action", action: "horizontalKeyboard" },
        },
        {
          name: "vertical",
          kind: "pan",
          region: "Surface",
          activation: dragActivation,
          outcomes: [{ outcome: "done", action: "verticalDone" }],
          alternative: { kind: "action", action: "verticalKeyboard" },
        },
      ],
      [{ kind: "afterFailure", first: "vertical", second: "horizontal" }],
    );
    const fallback = new CandidateWebGestureAdapter(dependent);
    fallback.process({
      phase: "down",
      pointer: 2,
      region: "Surface",
      inline: 0,
      block: 0,
      time: 0,
    });
    expect(
      fallback
        .process({
          phase: "move",
          pointer: 2,
          region: "Surface",
          inline: 1,
          block: 8,
          time: 10,
        })
        .events.map((event) => event.gesture),
    ).toEqual(["vertical"]);

    const waiting = new CandidateWebGestureAdapter(
      gestureIntentScene(
        [
          {
            name: "required",
            kind: "pan",
            region: "Surface",
            activation: {
              axis: "block",
              threshold: { dimension: "length", value: 20 },
            },
            outcomes: [{ outcome: "done", action: "requiredDone" }],
            alternative: { kind: "action", action: "requiredKeyboard" },
          },
          {
            name: "waiter",
            kind: "pan",
            region: "Surface",
            activation: dragActivation,
            outcomes: [{ outcome: "done", action: "waiterDone" }],
            alternative: { kind: "action", action: "waiterKeyboard" },
          },
        ],
        [{ kind: "afterFailure", first: "waiter", second: "required" }],
      ),
    );
    waiting.process({ phase: "down", pointer: 3, region: "Surface", inline: 0, block: 0, time: 0 });
    expect(
      waiting.process({
        phase: "move",
        pointer: 3,
        region: "Surface",
        inline: 0,
        block: 8,
        time: 10,
      }).events,
    ).toEqual([]);
  });

  test("keeps the accessible alternative when pointer recognition is unavailable", () => {
    const scene = gestureIntentScene([
      {
        name: "dismiss",
        kind: "drag",
        region: "Surface",
        activation: dragActivation,
        outcomes: [{ outcome: "done", action: "done" }],
        alternative: { kind: "action", action: "close" },
        available: "Drawer.gesture.dismiss.available",
      },
    ]);
    const adapter = new CandidateWebGestureAdapter(scene, { dismiss: false });
    expect(adapter.alternative("dismiss")).toEqual({ kind: "action", action: "close" });
    adapter.process({ phase: "down", pointer: 1, region: "Surface", inline: 0, block: 0, time: 0 });
    expect(
      adapter.process({
        phase: "move",
        pointer: 1,
        region: "Surface",
        inline: 0,
        block: 20,
        time: 10,
      }),
    ).toEqual({ events: [], effects: [] });
  });

  test("uses coalesced confirmation while keeping prediction presentation-only", () => {
    const scene = gestureIntentScene([
      {
        name: "dismiss",
        kind: "drag",
        region: "Surface",
        activation: dragActivation,
        outcomes: [{ outcome: "done", action: "done" }],
        alternative: { kind: "action", action: "close" },
      },
    ]);
    const adapter = new CandidateWebGestureAdapter(scene);
    adapter.process({ phase: "down", pointer: 1, region: "Surface", inline: 0, block: 0, time: 0 });
    const packet = adapter.processPacket({
      current: {
        phase: "move",
        pointer: 1,
        region: "Surface",
        inline: 0,
        block: 6,
        time: 12,
      },
      coalesced: [
        {
          phase: "move",
          pointer: 1,
          region: "Surface",
          inline: 0,
          block: 2,
          time: 4,
        },
        {
          phase: "move",
          pointer: 1,
          region: "Surface",
          inline: 0,
          block: 6,
          time: 12,
        },
      ],
      predicted: [
        {
          phase: "move",
          pointer: 1,
          region: "Surface",
          inline: 0,
          block: 20,
          time: 20,
        },
      ],
    });
    expect(packet.events.map((event) => [event.gesture, event.phase])).toEqual([
      ["dismiss", "begin"],
    ]);
    expect(packet.effects).toEqual([{ kind: "capture", pointer: 1, region: "Surface" }]);
    expect(packet.predicted[0]!.block).toBe(20);
  });

  test("validates a pointer packet atomically before changing recognizer state", () => {
    const scene = gestureIntentScene([
      {
        name: "dismiss",
        kind: "drag",
        region: "Surface",
        activation: dragActivation,
        outcomes: [{ outcome: "done", action: "done" }],
        alternative: { kind: "action", action: "close" },
      },
    ]);
    const adapter = new CandidateWebGestureAdapter(scene);
    adapter.process({ phase: "down", pointer: 1, region: "Surface", inline: 0, block: 0, time: 0 });
    expect(() =>
      adapter.processPacket({
        current: {
          phase: "move",
          pointer: 1,
          region: "Surface",
          inline: 0,
          block: 8,
          time: 10,
        },
        coalesced: [
          {
            phase: "move",
            pointer: 1,
            region: "Surface",
            inline: 0,
            block: 8,
            time: 10,
          },
        ],
        predicted: [
          {
            phase: "move",
            pointer: 1,
            region: "Surface",
            inline: 0,
            block: 20,
            time: 5,
          },
        ],
      }),
    ).toThrow("Predicted pointer samples must follow");
    expect(
      adapter.process({
        phase: "move",
        pointer: 1,
        region: "Surface",
        inline: 0,
        block: 2,
        time: 11,
      }),
    ).toEqual({ events: [], effects: [] });
  });

  test("keeps generated pointer lifecycles finite, balanced, and terminal", () => {
    const scene = gestureIntentScene([
      {
        name: "drag",
        kind: "drag",
        region: "Surface",
        activation: dragActivation,
        outcomes: [{ outcome: "done", action: "done" }],
        alternative: { kind: "action", action: "moveByKeyboard" },
      },
    ]);
    let seed = 0x51f15e;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let trace = 0; trace < 1_000; trace++) {
      const adapter = new CandidateWebGestureAdapter(scene);
      const pointer = trace;
      const events: { readonly phase: string; readonly finite: boolean }[] = [];
      const effects: string[] = [];
      adapter.process({ phase: "down", pointer, region: "Surface", inline: 0, block: 0, time: 0 });
      let block = 0;
      let time = 0;
      const samples = 1 + Math.floor(random() * 8);
      for (let sample = 0; sample < samples; sample++) {
        block += (random() - 0.25) * 8;
        time += 1 + Math.floor(random() * 20);
        const result = adapter.process({
          phase: "move",
          pointer,
          region: "Surface",
          inline: 0,
          block,
          time,
        });
        events.push(
          ...result.events.map((event) => ({
            phase: event.phase,
            finite: gestureSampleFinite(event.sample),
          })),
        );
        effects.push(...result.effects.map((effect) => effect.kind));
      }
      time += 1;
      const terminal = (["up", "cancel", "capture-lost"] as const)[Math.floor(random() * 3)]!;
      const result = adapter.process({
        phase: terminal,
        pointer,
        region: "Surface",
        inline: 0,
        block,
        time,
      });
      events.push(
        ...result.events.map((event) => ({
          phase: event.phase,
          finite: gestureSampleFinite(event.sample),
        })),
      );
      effects.push(...result.effects.map((effect) => effect.kind));

      const begins = events.filter((event) => event.phase === "begin").length;
      const terminals = events.filter(
        (event) => event.phase === "release" || event.phase === "cancel",
      ).length;
      expect(begins).toBeLessThanOrEqual(1);
      expect(terminals).toBe(begins);
      expect(events.every((event) => event.finite)).toBe(true);
      expect(effects.filter((effect) => effect === "capture").length).toBe(begins);
      expect(effects.filter((effect) => effect === "release").length).toBe(begins);
      expect(
        adapter.process({
          phase: "move",
          pointer,
          region: "Surface",
          inline: 0,
          block: block + 100,
          time: time + 1,
        }),
      ).toEqual({ events: [], effects: [] });
    }
  });

  test("yields to native scrolling except for outward movement at its declared boundary", () => {
    const scene = gestureIntentScene([
      {
        name: "dismiss",
        kind: "drag",
        region: "Surface",
        activation: dragActivation,
        scroll: { owner: "Content", boundary: "start", outward: "positive" },
        outcomes: [{ outcome: "done", action: "done" }],
        alternative: { kind: "action", action: "close" },
      },
    ]);
    expect(resolveCandidateWebGesturePlan(scene).regions).toEqual([
      {
        region: "Surface",
        touchAction: "pan-y",
        coalescedInput: true,
        predictedInput: "presentation-only",
        capture: "on-recognition",
        delivery: "native-scroll-boundary",
      },
    ]);
    const run = (position: number, movement: number) => {
      const adapter = new CandidateWebGestureAdapter(scene, {}, () => ({
        position,
        minimum: 0,
        maximum: 500,
      }));
      adapter.process({
        phase: "down",
        pointer: 1,
        region: "Surface",
        inline: 0,
        block: 0,
        time: 0,
      });
      return adapter.process({
        phase: "move",
        pointer: 1,
        region: "Surface",
        inline: 0,
        block: movement,
        time: 10,
      });
    };
    expect(run(40, 8)).toEqual({ events: [], effects: [] });
    expect(run(0, -8)).toEqual({ events: [], effects: [] });
    expect(run(0, 8).events.map((event) => [event.gesture, event.phase])).toEqual([
      ["dismiss", "begin"],
    ]);
  });
});

describe("candidate derived interaction lowering", () => {
  const scene: CandidateRecognizerScene = {
    intents: [
      {
        name: "inspect",
        kind: "longPress",
        region: "Trigger",
        activation: {
          duration: { dimension: "time", value: 0.45 },
          movementTolerance: { dimension: "length", value: 8 },
        },
        outcomes: [
          { outcome: "cancelled", action: "cancelInspect" },
          { outcome: "recognized", action: "inspect" },
          { outcome: "released", action: "releaseInspect" },
        ],
        alternative: { kind: "action", action: "inspectByKeyboard" },
      },
      {
        name: "preview",
        kind: "hoverIntent",
        region: "Trigger",
        activation: {
          dwell: { dimension: "time", value: 0.12 },
          maximumSpeed: { perSecond: { dimension: "length", value: 80 } },
          leaveDelay: { dimension: "time", value: 0.08 },
        },
        handoff: { destination: "Panel", corridor: "safe-polygon" },
        outcomes: [
          { outcome: "disengaged", action: "closePreview" },
          { outcome: "engaged", action: "openPreview" },
        ],
        alternative: { kind: "focus" },
      },
    ],
    relations: [],
  };

  test("matches independent hover timing and focus equivalence", () => {
    const candidate = new CandidateHoverIntentAdapter(scene, "preview");
    const reference = new ReferenceHoverIntent({
      dwell: 120,
      maximumSpeed: 80,
      leaveDelay: 80,
    });

    candidate.enter(0, 10, 20);
    reference.enter(0, 10, 20);
    expect(candidate.advance(119)).toBeUndefined();
    reference.advance(119);
    expect(candidate.snapshot.engaged).toBe(reference.snapshot.engaged);
    expect(candidate.advance(120)).toEqual({
      recognizer: "preview",
      signal: "engaged",
      action: "openPreview",
    });
    reference.advance(120);
    expect(candidate.snapshot.engaged).toBe(reference.snapshot.engaged);

    candidate.leave(130);
    reference.leave(130);
    expect(candidate.advance(209)).toBeUndefined();
    reference.advance(209);
    expect(candidate.advance(210)).toEqual({
      recognizer: "preview",
      signal: "disengaged",
      action: "closePreview",
    });
    reference.advance(210);
    expect(candidate.snapshot.engaged).toBe(reference.snapshot.engaged);

    expect(candidate.focus(220, true)?.signal).toBe("engaged");
    reference.focus(220);
    expect(candidate.snapshot.engaged).toBe(reference.snapshot.engaged);
    expect(candidate.focus(230, false)?.signal).toBe("disengaged");
    reference.blur(230);
    expect(candidate.snapshot.engaged).toBe(reference.snapshot.engaged);
  });

  test("retains engagement through the declared safe-polygon handoff", () => {
    const candidate = new CandidateHoverIntentAdapter(scene, "preview");
    candidate.focus(0, true);
    candidate.focus(1, false);
    candidate.enter(2, 0, 0);
    candidate.advance(122);
    expect(candidate.leave(130, "safe-polygon")).toBeUndefined();
    expect(candidate.advance(220)).toBeUndefined();
    expect(candidate.destination(230, true)).toBeUndefined();
    expect(candidate.snapshot.engaged).toBe(true);
    candidate.destination(240, false);
    expect(candidate.advance(320)?.signal).toBe("disengaged");
  });

  test("matches long-press progress, recognition, release, and stale cancellation", () => {
    const candidate = new CandidateLongPressAdapter(scene, "inspect");
    const reference = new ReferenceLongPress({ duration: 450, movementTolerance: 8 });
    const candidateRevision = candidate.down(7, 0, 10, 20);
    const referenceRevision = reference.down(7, 0, 10, 20);
    expect(candidateRevision).toBe(referenceRevision);
    expect(candidate.advance(225)).toBeUndefined();
    reference.advance(225);
    expect(candidate.snapshot.progress).toBe(reference.snapshot.progress);
    expect(candidate.advance(450)?.signal).toBe("recognized");
    expect(reference.advance(450)).toBe("recognized");
    expect(candidate.up(candidateRevision, 7, 460)?.signal).toBe("released");
    expect(reference.up(referenceRevision, 7, 460)).toBe("commit");
    expect(candidate.cancel(candidateRevision, 7, 470)).toBeUndefined();

    const nextCandidate = candidate.down(8, 500, 0, 0);
    const nextReference = reference.down(8, 500, 0, 0);
    expect(candidate.move(nextCandidate, 8, 510, 9, 0)?.signal).toBe("cancelled");
    expect(reference.move(nextReference, 8, 510, 9, 0)).toBe(true);
    expect(candidate.snapshot.progress).toBe(reference.snapshot.progress);
  });
});
