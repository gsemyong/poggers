import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  ReferencePresenceCoordinator,
  ReferenceFocusRecoveryCoordinator,
  evaluateReferenceExpression,
  interpolateReferenceOklch,
  interpolateReferenceMaterial,
  interpolateReferenceMediaFit,
  interpolateReferencePaint,
  interpolateReferenceRotation,
  interpolateReferenceShape,
  interpolateReferenceShadows,
  interpolateReferenceStroke,
  interpolateReferenceTypeStyle,
  interpolateReferenceTransform,
  resolveReferenceAutoScroll,
  resolveReferenceAdjustableCommand,
  resolveReferenceAdjustableValue,
  resolveReferenceVisualTransitionBatch,
  resolveReferenceLayoutTransition,
  resolveReferenceStructureReconciliation,
  resolveReferenceHotReload,
  resolveReferenceTransitionUpdate,
} from "./ui-language-reference";
import {
  type CandidateCommand,
  type CandidateGeometry,
  type CandidateLength,
  type CandidateMaterial,
  type CandidateMediaFit,
  type CandidateParameter,
  type CandidateRecognizerDefinitions,
  type CandidateShadow,
  type CandidateStroke,
  type CandidateTargetHandle,
  type CandidateTransform,
  type CandidateTypeStyle,
  type CategorizedPreset,
  type EquationPreset,
  type OperationalPreset,
  CandidateAdjustableAdapter,
  CandidateAutoScrollAdapter,
  addCandidate,
  aboveCandidate,
  andCandidate,
  arrangeCandidate,
  selectCandidateStructure,
  clampCandidate,
  clipCandidate,
  compareCandidate,
  compileCandidateComponentArtifact,
  constrainCandidateAspect,
  constrainCandidateSize,
  createCandidateCollectionHandle,
  createCandidateDerivedTargetHandle,
  createCandidateLayer,
  createCandidateRecognizerHandle,
  createCandidatePresentationIdentity,
  createCandidateReadExpression,
  createCandidateRecipe,
  createCandidateTargetHandle,
  createCandidateTransitionPolicy,
  driveCandidate,
  deriveCandidateArtifactCapabilities,
  deriveCandidateHotReloadDescriptor,
  equalCandidate,
  evaluateCandidateExpression,
  flowCandidate,
  gridCandidate,
  hitTestCandidate,
  isolateCandidate,
  issueCandidateNativeLayerHandle,
  issueCandidateAction,
  issueCandidateParameterHandle,
  issueCandidateStructureComponentInstance,
  issueCandidateStructureCollection,
  issueCandidateStructurePart,
  interpolateCandidate,
  maskCandidate,
  matchCandidate,
  normalizeCategorizedPreset,
  normalizeCandidateParameters,
  normalizeCandidate,
  normalizeCandidateTransitionCompatibility,
  normalizeCandidatePresence,
  normalizeCandidateStructure,
  normalizeCandidateStatechart,
  normalizeCandidateRecognizers,
  normalizeEquationPreset,
  normalizeOperationalPreset,
  normalizeSemanticOperations,
  normalizeSemanticRelationships,
  normalizeCandidateDirectManipulation,
  normalizeSemanticLayout,
  notCandidate,
  orCandidate,
  overlayCandidate,
  padCandidate,
  participateCandidate,
  anchorCandidate,
  planCandidateStructureReconciliation,
  placeCandidate,
  retainCandidate,
  resolveCandidateHotReload,
  setCandidateTarget,
  setCandidateParameter,
  settleCandidate,
  scrollCandidate,
  scaleCandidate,
  stickCandidate,
  transitionCandidateTarget,
  nativeLayerCandidate,
  intrinsicCandidate,
  virtualizeCandidate,
  validateCandidateDirectManipulationParameters,
  validateCandidateArtifactCapabilities,
  validateCandidateAutoScrollOwnership,
  validateCandidateAutoScrollParameters,
} from "./ui-language-candidates";

type ComparisonApp = {
  Components: {
    Action: {
      Parts: {
        Root: "button";
      };
    };
  };
  Styles: { Presets: "family" | "studio" };
};

type ParallelStateApp = {
  Components: {
    Workflow: {
      States:
        | "workspace"
        | "workspace.list"
        | "workspace.detail"
        | "sync"
        | "sync.idle"
        | "sync.busy";
      Actions: { open(): void; reset(): void; start(): void };
      Tasks: { sync: { Input: void; Output: void; Error: Error } };
      Parts: { Root: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

type CompletionStateApp = {
  Components: {
    Flow: {
      Context: { count: number };
      States: "flow" | "flow.editing" | "flow.done" | "success";
      Actions: { finish(): void };
      Commands: { announce: CandidateCommand<{ message: string }> };
      Output: { result: string };
      Parts: { Root: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

type ArtifactApp = {
  Components: {
    Action: {
      States: "idle" | "pending" | "disabled";
      Actions: { press(): void };
      Recognizers: {
        press: { Kind: "drag"; Outcomes: "cancel" | "commit" };
      };
      Parts: { Root: "div"; Trigger: "button" };
    };
  };
  Styles: { Presets: "plain" };
};

type GestureIntentApp = {
  Components: {
    Canvas: {
      Actions: {
        moveByKeyboard(): void;
        cancelDrag(): void;
        commitDrag(): void;
        zoomByKeyboard(): void;
        resetZoom(): void;
        commitZoom(): void;
      };
      Recognizers: {
        move: { Kind: "drag"; Outcomes: "rest" | "dropped" };
        zoom: { Kind: "pinch"; Outcomes: "reset" | "zoomed" };
      };
      Parameters: {
        autoScrollEdge: CandidateParameter<number>;
        autoScrollSpeed: CandidateParameter<number>;
      };
      Parts: { Root: "div"; Surface: "div"; Overlay: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

type InteractionIntentApp = {
  Components: {
    Disclosure: {
      Actions: {
        open(): void;
        close(): void;
        openByKeyboard(): void;
        cancelLongPress(): void;
        releaseLongPress(): void;
      };
      Recognizers: {
        preview: { Kind: "hoverIntent" };
        inspect: { Kind: "longPress" };
      };
      Parts: { Trigger: "button"; Panel: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

const timingDefinition = {
  normal: { kind: "timing", milliseconds: 160, curve: { kind: "linear" } },
  reduced: { kind: "instant" },
} as const;
const springDefinition = {
  normal: { kind: "spring", mass: 1, stiffness: 420, damping: 34 },
  reduced: { kind: "instant" },
} as const;
const layoutDefinition = {
  normal: {
    kind: "layout",
    driver: { kind: "spring", mass: 1, stiffness: 360, damping: 32 },
  },
  reduced: { kind: "instant" },
} as const;
const gestureProjectionTime = issueCandidateParameterHandle<number>("Gesture.projectionTime");
const gestureResistance = issueCandidateParameterHandle<number>("Gesture.resistance");

describe("semantic structure candidate", () => {
  test("normalizes typed hierarchy and reactive semantics through the reference model", () => {
    const Form = issueCandidateStructurePart("Profile", "Form", "form");
    const Field = issueCandidateStructurePart("Profile", "Field", "input");
    const ErrorMessage = issueCandidateStructurePart("Profile", "Error", "span");
    const Results = issueCandidateStructurePart("Profile", "Results", "div");
    const Result = issueCandidateStructurePart("Profile", "Result", "div");
    const results = issueCandidateStructureCollection<
      { readonly id: string; readonly label: string },
      "id",
      "Result",
      "div",
      "option"
    >("Profile.results", "id", Result, "option");
    const form = Form({ submit: issueCandidateAction<() => void>("Profile.submit") });
    const error = ErrorMessage({ role: "alert", key: "name" }, "A name is required.");
    const options = results.render([{ id: "ada", label: "Ada" }], (item, _index, Item) =>
      Item({ name: item.label }),
    );
    const option = options[0]!;
    const listbox = Results(
      {
        role: "listbox",
        name: "Suggestions",
        activeDescendant: results.reference(
          createCandidateReadExpression<string | null>("profile.activeResult"),
        ),
      },
      option,
    );
    const field = Field({
      name: "Name",
      value: "",
      change: issueCandidateAction<(value: string) => void>("Profile.changeName"),
      formOwner: form.reference,
      invalid: createCandidateReadExpression<boolean>("profile.invalid"),
      errorMessage: error.reference,
    });

    const normalized = normalizeCandidateStructure([form, field, error, listbox], {
      rootIdentity: "Profile.Scene",
      reads: { "profile.invalid": true, "profile.activeResult": "ada" },
      focused: field.reference,
    });

    expect(normalized.scene).toEqual({
      order: [
        "Profile.Scene",
        "Profile.Form",
        "Profile.Field",
        "Profile.Error:name",
        "Profile.Results",
        "Profile.Result:ada",
      ],
      parent: {
        "Profile.Error:name": "Profile.Scene",
        "Profile.Field": "Profile.Scene",
        "Profile.Form": "Profile.Scene",
        "Profile.Result:ada": "Profile.Results",
        "Profile.Results": "Profile.Scene",
      },
      focused: "Profile.Field",
    });
    expect(normalized.nodes.find((node) => node.identity === "Profile.Field")?.invalid).toBe(true);
    expect(normalized.nodes.find((node) => node.identity === "Profile.Form")?.actions).toEqual([
      { event: "submit", action: "Profile.submit" },
    ]);
    expect(normalized.nodes.find((node) => node.identity === "Profile.Field")?.actions).toEqual([
      { event: "change", action: "Profile.changeName" },
    ]);
  });

  test("rejects duplicate instances and runtime role forgery", () => {
    const Result = issueCandidateStructurePart("Search", "Result", "div");
    expect(() =>
      normalizeCandidateStructure([
        Result({ role: "option", name: "One" }),
        Result({ role: "option", name: "Two" }),
      ]),
    ).toThrow('Duplicate semantic identity "Search.Result".');

    const Button = issueCandidateStructurePart("Search", "Trigger", "button");
    const unsafeButton = Button as unknown as (props: Readonly<Record<string, unknown>>) => unknown;
    expect(() => unsafeButton({ role: "option", name: "Forged" })).toThrow(
      'Element "button" cannot have semantic role "option".',
    );
    expect(() =>
      normalizeCandidateStructure(Button({ name: "Uncompiled", activate() {} })),
    ).toThrow('Semantic activate binding on "Search.Trigger" was not issued by the compiler.');
  });

  test("normalizes informative and decorative image meaning without magic strings", () => {
    const Informative = issueCandidateStructurePart("Profile", "Portrait", "img");
    const Decorative = issueCandidateStructurePart("Profile", "Texture", "img");
    const source = createCandidateReadExpression<string>("profile.portrait");
    const normalized = normalizeCandidateStructure(
      [
        Informative({ source, alternative: "Profile portrait" }),
        Decorative({ source: "/texture.webp", alternative: { kind: "decorative" } }),
      ],
      { rootIdentity: "Profile.Scene", reads: { "profile.portrait": "/portrait.webp" } },
    );

    expect(normalized.nodes.find((node) => node.identity === "Profile.Portrait")).toMatchObject({
      role: "image",
      source: "/portrait.webp",
      name: "Profile portrait",
    });
    expect(normalized.nodes.find((node) => node.identity === "Profile.Texture")).toMatchObject({
      role: "image",
      source: "/texture.webp",
      decorative: true,
    });
    expect(() =>
      normalizeCandidateStructure(Informative({ source: "", alternative: "Profile portrait" })),
    ).toThrow("needs a source");
    expect(() =>
      normalizeCandidateStructure(Informative({ source: "/portrait.webp", alternative: "" })),
    ).toThrow("needs alternative text");
  });

  test("plans one retained structural branch transaction through the independent model", () => {
    const Root = issueCandidateStructurePart("Wallet", "Root", "main");
    const Common = issueCandidateStructurePart("Wallet", "Common", "p");
    const Default = issueCandidateStructurePart("Wallet", "Default", "div");
    const DefaultAction = issueCandidateStructurePart("Wallet", "DefaultAction", "button");
    const Detail = issueCandidateStructurePart("Wallet", "Detail", "div");
    const DetailCopy = issueCandidateStructurePart("Wallet", "DetailCopy", "p");
    const hierarchy = Root(
      {},
      Common({}, "Shared"),
      selectCandidateStructure<boolean>(createCandidateReadExpression<boolean>("wallet.detail"), {
        true: {
          content: Detail({ role: "group", name: "Detail" }, DetailCopy({}, "Detail")),
        },
        false: {
          content: Default(
            { role: "group", name: "Default" },
            DefaultAction({ name: "Open detail", activate: issueCandidateAction("Wallet.open") }),
          ),
        },
      }),
    );
    const previous = normalizeCandidateStructure(hierarchy, {
      reads: { "wallet.detail": false },
    });
    const next = normalizeCandidateStructure(hierarchy, { reads: { "wallet.detail": true } });

    expect(planCandidateStructureReconciliation(previous, next, ["Wallet.Default"])).toEqual(
      resolveReferenceStructureReconciliation(previous.nodes, next.nodes, ["Wallet.Default"]),
    );
    expect(planCandidateStructureReconciliation(previous, next, ["Wallet.Default"])).toMatchObject({
      surviving: ["Wallet.Root", "Wallet.Common"],
      entering: ["Wallet.Detail", "Wallet.DetailCopy"],
      enterRoots: ["Wallet.Detail"],
      exiting: ["Wallet.Default", "Wallet.DefaultAction"],
      exitRoots: [{ identity: "Wallet.Default", presentation: "retain" }],
    });
  });

  test("derives repeated identity from domain keys and rejects duplicates", () => {
    const Result = issueCandidateStructurePart("Search", "Result", "div");
    const results = issueCandidateStructureCollection<
      { readonly id: number; readonly label: string },
      "id",
      "Result",
      "div",
      "option"
    >("Search.results", "id", Result, "option");
    const render = (items: readonly { readonly id: number; readonly label: string }[]) =>
      results.render(items, (item, _index, Item) => Item({ name: item.label }));

    expect(
      render([
        { id: 2, label: "Two" },
        { id: 1, label: "One" },
      ]),
    ).toEqual([
      expect.objectContaining({ identity: "Search.Result:2", part: "Result" }),
      expect.objectContaining({ identity: "Search.Result:1", part: "Result" }),
    ]);
    expect(() =>
      render([
        { id: 1, label: "One" },
        { id: 1, label: "Again" },
      ]),
    ).toThrow('Structure collection "Search.results" has duplicate key "1".');

    fc.assert(
      fc.property(fc.uniqueArray(fc.integer(), { maxLength: 40 }), (keys) => {
        const nodes = render(keys.map((id) => ({ id, label: String(id) })));
        expect(nodes.map((node) => node.identity)).toEqual(keys.map((id) => `Search.Result:${id}`));
      }),
    );
  });

  test("places opaque child component roots without exposing their private hierarchy", () => {
    const Page = issueCandidateStructurePart("Page", "Root", "main");
    const Item = issueCandidateStructurePart("Page.item-one", "Root", "article");
    const child = issueCandidateStructureComponentInstance(
      "Item",
      "one",
      Item({ name: "First item" }, "First item"),
    );
    const normalized = normalizeCandidateStructure(Page({}, child));

    expect(normalized.scene.parent["Page.item-one.Root"]).toBe("Page.Root");
    expect(Object.keys(child).sort()).toEqual(["component", "key"]);
    expect(() => issueCandidateStructureComponentInstance("Item", "empty", null)).toThrow(
      'Component instance "Item" needs at least one semantic root.',
    );
    expect(() =>
      normalizeCandidateStructure(Page({}, { component: "Item", key: "forged" } as never)),
    ).toThrow("component instance not issued by its compiler");
  });

  test("selects one stable semantic branch from a reactive condition", () => {
    const Root = issueCandidateStructurePart("Disclosure", "Root", "section");
    const Detail = issueCandidateStructurePart("Disclosure", "Detail", "div");
    const detail = Detail({ role: "group", name: "Details" });
    const hierarchy = Root(
      {},
      selectCandidateStructure<boolean>(createCandidateReadExpression<boolean>("disclosure.open"), {
        true: { content: detail },
        false: { content: null },
      }),
    );

    const closed = normalizeCandidateStructure(hierarchy, {
      reads: { "disclosure.open": false },
    });
    const open = normalizeCandidateStructure(hierarchy, {
      reads: { "disclosure.open": true },
    });
    const reopened = normalizeCandidateStructure(hierarchy, {
      reads: { "disclosure.open": true },
    });

    expect(closed.nodes.map((node) => node.identity)).toEqual(["Disclosure.Root"]);
    expect(open.scene.parent["Disclosure.Detail"]).toBe("Disclosure.Root");
    expect(reopened.nodes.map((node) => node.identity)).toEqual(
      open.nodes.map((node) => node.identity),
    );
  });

  test("declares focus recovery at a responsive structural selection", () => {
    const Root = issueCandidateStructurePart("Navigation", "Root", "nav");
    const Wide = issueCandidateStructurePart("Navigation", "Wide", "button");
    const Compact = issueCandidateStructurePart("Navigation", "Compact", "button");
    const wide = Wide({ name: "Current section", activate: issueCandidateAction("wide") });
    const compact = Compact({ name: "Open navigation", activate: issueCandidateAction("compact") });
    const responsive = Root(
      {},
      selectCandidateStructure<boolean>(createCandidateReadExpression<boolean>("navigation.wide"), {
        true: { content: wide, focus: wide.reference },
        false: { content: compact, focus: compact.reference },
      }),
    );
    const wideScene = normalizeCandidateStructure(responsive, {
      reads: { "navigation.wide": true },
    });
    const compactScene = normalizeCandidateStructure(responsive, {
      reads: { "navigation.wide": false },
    });
    expect(wideScene.focusRecovery).toEqual([
      {
        selection: "Navigation.Compact / Navigation.Wide",
        departing: ["Navigation.Compact"],
        destination: "Navigation.Wide",
      },
    ]);
    expect(compactScene.focusRecovery).toEqual([
      {
        selection: "Navigation.Compact / Navigation.Wide",
        departing: ["Navigation.Wide"],
        destination: "Navigation.Compact",
      },
    ]);
    const focus = new ReferenceFocusRecoveryCoordinator("Navigation.Wide");
    expect(
      focus.replace(
        compactScene.nodes.map((node) => ({
          identity: node.identity,
          focusable: node.focusable ?? false,
          hidden: node.hidden,
          inert: node.inert,
        })),
        compactScene.focusRecovery?.[0]?.destination,
      ),
    ).toMatchObject({ focused: "Navigation.Compact", strategy: "replace" });
    const invalid = Root(
      {},
      selectCandidateStructure<boolean>(createCandidateReadExpression<boolean>("navigation.wide"), {
        true: { content: wide, focus: compact.reference },
        false: { content: compact, focus: wide.reference },
      }),
    );
    expect(() =>
      normalizeCandidateStructure(invalid, { reads: { "navigation.wide": true } }),
    ).toThrow("outside case");
  });

  test("selects an exhaustive multi-view union with one focus contract", () => {
    const Root = issueCandidateStructurePart("Family", "Root", "main");
    const Default = issueCandidateStructurePart("Family", "Default", "button");
    const Key = issueCandidateStructurePart("Family", "Key", "button");
    const Phrase = issueCandidateStructurePart("Family", "Phrase", "button");
    const Remove = issueCandidateStructurePart("Family", "Remove", "button");
    const action = issueCandidateAction("Family.select");
    const views = {
      default: Default({ name: "Options", activate: action }),
      key: Key({ name: "Private key", activate: action }),
      phrase: Phrase({ name: "Recovery phrase", activate: action }),
      remove: Remove({ name: "Remove wallet", activate: action }),
    };
    const hierarchy = Root(
      {},
      selectCandidateStructure<"default" | "key" | "phrase" | "remove">(
        createCandidateReadExpression<"default" | "key" | "phrase" | "remove">("family.view"),
        {
          default: { content: views.default, focus: views.default.reference },
          key: { content: views.key, focus: views.key.reference },
          phrase: { content: views.phrase, focus: views.phrase.reference },
          remove: { content: views.remove, focus: views.remove.reference },
        },
      ),
    );

    const key = normalizeCandidateStructure(hierarchy, { reads: { "family.view": "key" } });
    expect(key.nodes.map((node) => node.identity)).toEqual(["Family.Root", "Family.Key"]);
    expect(key.focusRecovery).toEqual([
      {
        selection: "Family.Default / Family.Key / Family.Phrase / Family.Remove",
        departing: ["Family.Default", "Family.Phrase", "Family.Remove"],
        destination: "Family.Key",
      },
    ]);
    expect(() =>
      normalizeCandidateStructure(hierarchy, { reads: { "family.view": "unknown" } }),
    ).toThrow('has no case "unknown"');
  });

  test("shares one adjustable range between semantic structure and every input path", () => {
    const Slider = issueCandidateStructurePart("Mixer", "Volume", "input");
    const change = issueCandidateAction<(value: number) => void>("Mixer.changeVolume");
    const slider = Slider({
      role: "slider",
      name: "Volume",
      value: createCandidateReadExpression<number>("mixer.volume"),
      minimum: -1,
      maximum: 1,
      step: 0.1,
      largeStep: 0.5,
      change,
    });
    const normalized = normalizeCandidateStructure(slider, {
      reads: { "mixer.volume": 0.3 },
    });
    expect(normalized.nodes[0]).toMatchObject({
      role: "slider",
      value: 0.3,
      minimum: -1,
      maximum: 1,
      step: 0.1,
      largeStep: 0.5,
      actions: [{ event: "change", action: "Mixer.changeVolume" }],
    });

    const range = { minimum: -1, maximum: 1, step: 0.1, largeStep: 0.5 };
    const adapter = new CandidateAdjustableAdapter(range);
    for (const source of ["pointer", "keyboard", "programmatic"] as const) {
      expect(adapter.resolve(0, 0.26, source)).toEqual(
        resolveReferenceAdjustableValue(0, 0.26, range, source),
      );
    }
    for (const command of [
      "increment",
      "decrement",
      "largeIncrement",
      "largeDecrement",
      "minimum",
      "maximum",
    ] as const) {
      expect(adapter.command(0.3, command)).toEqual(
        resolveReferenceAdjustableCommand(0.3, command, range),
      );
    }
  });
});

describe("integrated behavior candidate", () => {
  test("normalizes candidate statechart notation through the independent topology model", () => {
    const topology = normalizeCandidateStatechart<ParallelStateApp, "Workflow">(
      {
        type: "parallel",
        on: { reset: { target: ["workspace.list", "sync.idle"] } },
        task: { run: "sync", input: () => undefined },
        after: { wait: 10_000, transition: "sync.idle" },
        states: {
          workspace: {
            initial: "workspace.list",
            states: {
              list: { on: { open: "workspace.detail" } },
              detail: {
                on: { reset: { target: ["workspace.list", "sync.idle"] } },
              },
            },
          },
          sync: {
            initial: "sync.idle",
            states: {
              idle: { on: { start: "sync.busy" } },
              busy: {
                task: {
                  run: "sync",
                  input: () => undefined,
                  done: "sync.idle",
                  fail: "sync.idle",
                },
                after: { wait: 5000, transition: "sync.idle" },
              },
            },
          },
        },
      },
      ["sync"],
    );

    expect(topology.nodes.find((node) => node.path === "sync.busy")).toMatchObject({
      tasks: ["sync"],
      taskResults: [
        {
          task: "sync",
          done: [{ targets: ["sync.idle"] }],
          fail: [{ targets: ["sync.idle"] }],
        },
      ],
      delays: [{ wait: 5000, targets: ["sync.idle"] }],
    });
    expect(topology).toMatchObject({
      tasks: ["sync"],
      events: [
        {
          event: "reset",
          alternatives: [{ targets: ["workspace.list", "sync.idle"] }],
        },
      ],
      delays: [{ wait: 10_000, targets: ["sync.idle"] }],
    });
    expect(topology.nodes.find((node) => node.path === "workspace.detail")?.events).toEqual([
      {
        event: "reset",
        alternatives: [{ targets: ["workspace.list", "sync.idle"] }],
      },
    ]);
    expect(() =>
      normalizeCandidateStatechart<ParallelStateApp, "Workflow">(
        {
          initial: "workspace",
          states: {
            workspace: {
              initial: "list" as never,
              states: { list: {}, detail: {} },
            },
          },
        },
        ["sync"],
      ),
    ).toThrow('Initial state "list" is not a direct child of "workspace".');
  });

  test("normalizes guarded choice, completion, and typed final output", () => {
    const topology = normalizeCandidateStatechart<CompletionStateApp, "Flow">(
      {
        initial: "flow",
        states: {
          flow: {
            initial: "flow.editing",
            done: "success",
            states: {
              editing: {
                always: { allow: () => false, target: "flow.done" },
                on: {
                  finish: [
                    {
                      allow: () => false,
                      target: "flow.done",
                      update: ({ context }) => ({ count: context.count + 1 }),
                      commands: {
                        run: "announce",
                        input: () => ({ message: "done" }),
                      },
                    },
                    { target: "flow.done" },
                  ],
                },
              },
              done: { type: "final", output: () => ({ result: "saved" }) },
            },
          },
          success: { type: "final", output: () => ({ result: "complete" }) },
        },
      },
      [],
      ["announce"],
    );

    expect(topology.nodes.find((node) => node.path === "flow.editing")?.events).toEqual([
      {
        event: "finish",
        alternatives: [
          {
            guard: "flow.editing.on.finish.0",
            targets: ["flow.done"],
            update: "flow.editing.on.finish.0.update",
            commands: [
              {
                name: "announce",
                input: "flow.editing.on.finish.0.command.0.input",
              },
            ],
          },
          { targets: ["flow.done"] },
        ],
      },
    ]);
    expect(topology.nodes.find((node) => node.path === "flow.editing")?.always).toEqual([
      { guard: "flow.editing.always.0", targets: ["flow.done"] },
    ]);
    expect(topology.nodes.find((node) => node.path === "flow")?.done).toEqual([
      { targets: ["success"] },
    ]);
    expect(topology.nodes.find((node) => node.path === "flow.done")?.output).toEqual({
      resolver: "flow.done.output",
    });
  });
});

describe("candidate compiler artifact", () => {
  test("emits one canonical plain-data golden across behavior, structure, and presentation", () => {
    const Root = issueCandidateStructurePart("Action", "Root", "div");
    const Trigger = issueCandidateStructurePart("Action", "Trigger", "button");
    const structure = normalizeCandidateStructure(
      Root(
        {},
        Trigger({
          name: "Continue",
          activate: issueCandidateAction<() => void>("Action.press"),
        }),
      ),
    );
    const behavior = normalizeCandidateStatechart<ArtifactApp, "Action">(
      {
        initial: "idle",
        states: {
          idle: { on: { press: "pending" } },
          pending: {},
          disabled: {},
        },
      },
      [],
    );
    const root = createCandidatePresentationIdentity("Action.Root");
    const trigger = createCandidatePresentationIdentity("Action.Trigger");
    const opacity = createCandidateTargetHandle<number>("Action.Trigger", "opacity", "number");
    const spring = createCandidateTransitionPolicy<number>("settle", springDefinition);
    const targets = normalizeSemanticOperations([
      setCandidateTarget(opacity, createCandidateReadExpression<number>("interaction.opacity")),
      transitionCandidateTarget(opacity, spring),
    ]);
    const relationships = normalizeSemanticRelationships(
      [root, trigger],
      [aboveCandidate(root, trigger), hitTestCandidate(trigger, "auto")],
    );
    const layout = normalizeSemanticLayout(
      [root, trigger],
      [
        arrangeCandidate(
          root,
          [trigger],
          flowCandidate({
            axis: "block",
            gap: { dimension: "length", value: 8 },
            align: "center",
            distribute: "start",
            wrap: false,
          }),
        ),
      ],
    );
    const artifact = compileCandidateComponentArtifact({
      component: "Action",
      behavior,
      structure,
      recognizers: normalizeCandidateRecognizers<ArtifactApp, "Action">(
        "Action",
        {
          press: {
            region: "Trigger",
            activation: {
              axis: "block",
              threshold: { dimension: "length", value: 2 },
            },
            outcomes: {
              cancel: { action: "press" },
              commit: { action: "press" },
            },
            alternative: { kind: "action", action: "press" },
          },
        },
        { press: { kind: "drag", outcomes: ["cancel", "commit"] } },
        new Set(["Root", "Trigger"]),
        new Set(["press"]),
      ),
      targets,
      relationships,
      directManipulation: normalizeCandidateDirectManipulation([]),
      layout,
    });

    expect(artifact.value).toEqual(JSON.parse(artifact.json));
    expect(artifact.json).not.toContain("function");
    expect(artifact.json).toContain('"action": "Action.press"');
    expect(artifact.json).toContain('"kind": "read"');
    const capabilities = deriveCandidateArtifactCapabilities(artifact.value);
    expect(capabilities).toEqual([
      "behavior.events",
      "behavior.statechart",
      "composition.hitTest",
      "composition.order",
      "expression.read",
      "gesture.accessibleAlternative",
      "gesture.activation",
      "gesture.drag",
      "layout.flow",
      "semantic.action.activate",
      "semantic.role.button",
      "semantic.role.generic",
      "transition.instant",
      "transition.spring",
    ]);
    expect(() =>
      validateCandidateArtifactCapabilities(
        artifact.value,
        new Set(capabilities.filter((capability) => capability !== "semantic.action.activate")),
      ),
    ).toThrow('Adapter does not support required UI meaning "semantic.action.activate".');
    expect(() =>
      validateCandidateArtifactCapabilities(artifact.value, new Set(capabilities)),
    ).not.toThrow();
    const live = {
      presence: [
        { identity: "Action.Trigger", phase: "entering" as const },
        { identity: "Action.Trigger", phase: "entering" as const },
      ],
      motions: [
        { kind: "scalar" as const, identity: "Action.Trigger:opacity", value: 0.64, velocity: 1.2 },
        { kind: "scalar" as const, identity: "Action.Removed:opacity", value: 0.2, velocity: 0 },
      ],
      tasks: ["Action.save", "Action.save"],
      gestures: ["Action.press"],
    };
    const presentationReload = {
      ...artifact.value,
      presentation: {
        ...artifact.value.presentation,
        targets: {
          ...artifact.value.presentation.targets,
          targets: { "Action.Trigger:opacity": 0.5 },
        },
      },
    };
    expect(resolveCandidateHotReload(artifact.value, presentationReload, live)).toEqual(
      resolveReferenceHotReload(
        deriveCandidateHotReloadDescriptor(artifact.value),
        deriveCandidateHotReloadDescriptor(presentationReload),
        live,
      ),
    );
    expect(resolveCandidateHotReload(artifact.value, presentationReload, live)).toEqual({
      cause: "presentation",
      remount: false,
      retain: {
        context: true,
        state: true,
        presence: [{ identity: "Action.Trigger", phase: "entering" }],
        motion: [
          { kind: "scalar", identity: "Action.Trigger:opacity", value: 0.64, velocity: 1.2 },
        ],
      },
      dispose: {
        motions: ["Action.Removed:opacity"],
        tasks: ["Action.save"],
        gestures: ["Action.press"],
      },
    });
    const geometry = createCandidateDerivedTargetHandle<CandidateGeometry>(
      "Action.Root",
      "geometry",
      "geometry",
    );
    const layoutTargets = normalizeSemanticOperations(
      [
        transitionCandidateTarget(
          geometry,
          createCandidateTransitionPolicy("layout", layoutDefinition),
        ),
      ],
      [geometry],
    );
    expect(
      deriveCandidateHotReloadDescriptor({
        ...artifact.value,
        presentation: { ...artifact.value.presentation, targets: layoutTargets },
      }).targetIdentities,
    ).toEqual(["Action.Root:geometry"]);
    const incompatibleReload = {
      ...presentationReload,
      structure: {
        ...presentationReload.structure,
        nodes: presentationReload.structure.nodes.map((node) =>
          node.identity === "Action.Trigger" ? { ...node, role: "link" as const } : node,
        ),
      },
    };
    expect(resolveCandidateHotReload(artifact.value, incompatibleReload, live)).toMatchObject({
      cause: "contract",
      remount: true,
      retain: { context: false, state: false, presence: [], motion: [] },
    });
    expect(
      compileCandidateComponentArtifact({
        component: artifact.value.component,
        behavior: artifact.value.behavior,
        structure: artifact.value.structure,
        recognizers: artifact.value.recognizers,
        targets: artifact.value.presentation.targets,
        relationships: artifact.value.presentation.relationships,
        directManipulation: artifact.value.presentation.directManipulation,
        layout: artifact.value.presentation.layout,
      }).json,
    ).toBe(artifact.json);
    expect(() =>
      compileCandidateComponentArtifact({
        component: "Invalid",
        behavior,
        structure,
        targets: {
          ...targets,
          targets: { "Invalid:opacity": (() => 1) as never },
        },
        relationships,
        directManipulation: normalizeCandidateDirectManipulation([]),
        layout,
      }),
    ).toThrow("Compiled candidate IR cannot contain function.");
    expect(artifact.json).toMatchInlineSnapshot(`
      "{
        "behavior": {
          "always": [],
          "delays": [],
          "done": [],
          "events": [],
          "initial": "idle",
          "kind": "compound",
          "nodes": [
            {
              "always": [],
              "children": [],
              "delays": [],
              "done": [],
              "events": [],
              "kind": "atomic",
              "path": "disabled",
              "taskResults": [],
              "tasks": []
            },
            {
              "always": [],
              "children": [],
              "delays": [],
              "done": [],
              "events": [
                {
                  "alternatives": [
                    {
                      "targets": [
                        "pending"
                      ]
                    }
                  ],
                  "event": "press"
                }
              ],
              "kind": "atomic",
              "path": "idle",
              "taskResults": [],
              "tasks": []
            },
            {
              "always": [],
              "children": [],
              "delays": [],
              "done": [],
              "events": [],
              "kind": "atomic",
              "path": "pending",
              "taskResults": [],
              "tasks": []
            }
          ],
          "taskResults": [],
          "tasks": []
        },
        "component": "Action",
        "presentation": {
          "directManipulation": {
            "drives": [],
            "lifecycle": {
              "capture": "on-recognition",
              "release": [
                "commit",
                "cancel",
                "capture-lost",
                "absent",
                "dispose"
              ],
              "stale": "ignore"
            },
            "settlements": []
          },
          "layout": {
            "anchors": [],
            "arrangements": [
              {
                "arrangement": {
                  "algorithm": "flow",
                  "align": "center",
                  "axis": "block",
                  "distribute": "start",
                  "gap": {
                    "dimension": "length",
                    "value": 8
                  },
                  "wrap": false
                },
                "children": [
                  "Action.Trigger"
                ],
                "parent": "Action.Root"
              }
            ],
            "aspects": [],
            "intrinsic": [],
            "padding": [],
            "parents": {
              "Action.Trigger": "Action.Root"
            },
            "participation": [],
            "placements": [],
            "scrolls": [],
            "sizes": [],
            "sticky": [],
            "virtualized": []
          },
          "relationships": {
            "clips": [],
            "composition": [
              "Action.Trigger",
              "Action.Root"
            ],
            "hitTests": {
              "Action.Trigger": "auto"
            },
            "isolates": [],
            "masks": [],
            "matches": [],
            "nativeLayers": []
          },
          "targets": {
            "addresses": {
              "Action.Trigger:opacity": {
                "identity": "Action.Trigger",
                "property": "opacity"
              }
            },
            "targets": {
              "Action.Trigger:opacity": {
                "kind": "read",
                "path": "interaction.opacity"
              }
            },
            "transaction": {
              "targets": [
                "Action.Trigger:opacity"
              ]
            },
            "transitions": [
              {
                "definition": {
                  "normal": {
                    "damping": 34,
                    "kind": "spring",
                    "mass": 1,
                    "stiffness": 420
                  },
                  "reduced": {
                    "kind": "instant"
                  }
                },
                "policy": "settle",
                "target": "Action.Trigger:opacity"
              }
            ],
            "valueTypes": {
              "Action.Trigger:opacity": "number"
            }
          }
        },
        "recognizers": {
          "intents": [
            {
              "activation": {
                "axis": "block",
                "threshold": {
                  "dimension": "length",
                  "value": 2
                }
              },
              "alternative": {
                "action": "press",
                "kind": "action"
              },
              "kind": "drag",
              "name": "press",
              "outcomes": [
                {
                  "action": "press",
                  "outcome": "cancel"
                },
                {
                  "action": "press",
                  "outcome": "commit"
                }
              ],
              "region": "Trigger"
            }
          ],
          "relations": []
        },
        "structure": {
          "nodes": [
            {
              "children": [
                "Action.Trigger"
              ],
              "content": [
                {
                  "identity": "Action.Trigger",
                  "kind": "node"
                }
              ],
              "focusable": false,
              "identity": "Action.Root",
              "platformKind": "div",
              "role": "generic"
            },
            {
              "actions": [
                {
                  "action": "Action.press",
                  "event": "activate"
                }
              ],
              "focusable": true,
              "identity": "Action.Trigger",
              "name": "Continue",
              "platformKind": "button",
              "role": "button"
            }
          ],
          "scene": {
            "order": [
              "Action.Root",
              "Action.Trigger"
            ],
            "parent": {
              "Action.Trigger": "Action.Root"
            }
          }
        },
        "version": 1
      }
      "
    `);
  });
});

describe("candidate gesture intent", () => {
  const contract = {
    move: { kind: "drag", outcomes: ["rest", "dropped"] },
    zoom: { kind: "pinch", outcomes: ["reset", "zoomed"] },
  } as const;
  const definitions = {
    move: {
      region: "Surface",
      activation: {
        axis: "both",
        threshold: { dimension: "length", value: 4 },
      },
      outcomes: {
        rest: { action: "cancelDrag" },
        dropped: { action: "commitDrag" },
      },
      alternative: { kind: "action", action: "moveByKeyboard" },
      available: () => true,
      relations: [{ kind: "simultaneous", with: "zoom" }],
    },
    zoom: {
      region: "Surface",
      activation: { threshold: 0.04 },
      outcomes: {
        reset: { action: "resetZoom" },
        zoomed: { action: "commitZoom" },
      },
      alternative: { kind: "action", action: "zoomByKeyboard" },
    },
  } satisfies CandidateRecognizerDefinitions<GestureIntentApp, "Canvas">;
  const parts = new Set(["Root", "Surface"]);
  const actions = new Set([
    "moveByKeyboard",
    "cancelDrag",
    "commitDrag",
    "zoomByKeyboard",
    "resetZoom",
    "commitZoom",
  ]);

  test("normalizes activation, complete outcomes, accessibility, and arbitration", () => {
    expect(
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        definitions,
        contract,
        parts,
        actions,
      ),
    ).toEqual({
      intents: [
        {
          name: "move",
          kind: "drag",
          region: "Surface",
          activation: { axis: "both", threshold: { dimension: "length", value: 4 } },
          outcomes: [
            { outcome: "dropped", action: "commitDrag" },
            { outcome: "rest", action: "cancelDrag" },
          ],
          alternative: { kind: "action", action: "moveByKeyboard" },
          available: "Canvas.recognizer.move.available",
        },
        {
          name: "zoom",
          kind: "pinch",
          region: "Surface",
          activation: { threshold: 0.04 },
          outcomes: [
            { outcome: "reset", action: "resetZoom" },
            { outcome: "zoomed", action: "commitZoom" },
          ],
          alternative: { kind: "action", action: "zoomByKeyboard" },
        },
      ],
      relations: [{ kind: "simultaneous", first: "move", second: "zoom" }],
    });
  });

  test("rejects implicit conflicts and runtime contracts that lose outcomes", () => {
    expect(() =>
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        {
          ...definitions,
          move: { ...definitions.move, relations: [] },
        },
        contract,
        parts,
        actions,
      ),
    ).toThrow("Gesture conflict has no explicit relationship: move, zoom.");
    expect(() =>
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        definitions,
        {
          ...contract,
          move: { kind: "drag", outcomes: ["rest"] },
        } as never,
        parts,
        actions,
      ),
    ).toThrow('Gesture "move" outcomes do not match its generic contract.');
  });

  test("arbitrates only gestures that share an activation region", () => {
    const separate = {
      ...definitions,
      move: { ...definitions.move, relations: [] },
      zoom: { ...definitions.zoom, region: "Overlay" },
    } satisfies CandidateRecognizerDefinitions<GestureIntentApp, "Canvas">;
    expect(
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        separate,
        contract,
        new Set([...parts, "Overlay"]),
        actions,
      ).relations,
    ).toEqual([]);
    expect(() =>
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        {
          ...separate,
          move: {
            ...separate.move,
            relations: [{ kind: "simultaneous", with: "zoom" }],
          },
        },
        contract,
        new Set([...parts, "Overlay"]),
        actions,
      ),
    ).toThrow("use different regions and cannot arbitrate");
  });

  test("normalizes exclusive preference and directional failure dependency", () => {
    const exclusive = {
      ...definitions,
      move: {
        ...definitions.move,
        relations: [{ kind: "exclusive", with: "zoom", prefer: "other" }],
      },
    } satisfies CandidateRecognizerDefinitions<GestureIntentApp, "Canvas">;
    expect(
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        exclusive,
        contract,
        parts,
        actions,
      ).relations,
    ).toEqual([{ kind: "exclusive", first: "zoom", second: "move" }]);

    const dependent = {
      ...definitions,
      move: {
        ...definitions.move,
        relations: [{ kind: "afterFailure", with: "zoom" }],
      },
    } satisfies CandidateRecognizerDefinitions<GestureIntentApp, "Canvas">;
    expect(
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        dependent,
        contract,
        parts,
        actions,
      ).relations,
    ).toEqual([{ kind: "afterFailure", first: "move", second: "zoom" }]);
    expect(() =>
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        {
          ...definitions,
          move: {
            ...definitions.move,
            relations: [{ kind: "exclusive", with: "zoom" }],
          },
        } as never,
        contract,
        parts,
        actions,
      ),
    ).toThrow("needs an explicit tie preference");
  });

  test("materializes native-scroll boundary competition from structure", () => {
    const scrollAware = {
      ...definitions,
      move: {
        ...definitions.move,
        activation: {
          axis: "block",
          threshold: { dimension: "length", value: 4 },
        },
        scroll: { owner: "Surface", boundary: "start", outward: "positive" },
      },
    } satisfies CandidateRecognizerDefinitions<GestureIntentApp, "Canvas">;
    expect(
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        scrollAware,
        contract,
        parts,
        actions,
      ).intents[0]!.scroll,
    ).toEqual({ owner: "Surface", boundary: "start", outward: "positive" });
  });

  test("materializes parameterized edge auto-scroll and matches the independent kinematic law", () => {
    const autoScrollAware = {
      ...definitions,
      move: {
        ...definitions.move,
        activation: {
          axis: "block",
          threshold: { dimension: "length" as const, value: 4 },
        },
        autoScroll: {
          owner: "Surface",
          edgeFraction: "autoScrollEdge",
          maximumViewportPerSecond: "autoScrollSpeed",
        },
      },
    } satisfies CandidateRecognizerDefinitions<GestureIntentApp, "Canvas">;
    const scene = normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
      "Canvas",
      autoScrollAware,
      contract,
      parts,
      actions,
      new Set(["autoScrollEdge", "autoScrollSpeed"]),
    );
    expect(scene.intents[0]!.autoScroll).toEqual({
      owner: "Surface",
      edgeFraction: "autoScrollEdge",
      maximumViewportPerSecond: "autoScrollSpeed",
    });
    const surface = createCandidatePresentationIdentity("Surface");
    const content = createCandidatePresentationIdentity("Content");
    const layout = normalizeSemanticLayout(
      [surface, content],
      [
        scrollCandidate(surface, content, {
          axis: "block",
          behavior: "free",
          indicators: "automatic",
        }),
      ],
    );
    expect(() => validateCandidateAutoScrollOwnership(scene, layout)).not.toThrow();
    const parameters = { autoScrollEdge: 0.2, autoScrollSpeed: 2.5 };
    expect(() => validateCandidateAutoScrollParameters(scene, parameters)).not.toThrow();
    const adapter = new CandidateAutoScrollAdapter(scene.intents[0]!.autoScroll!, parameters);
    const revision = adapter.start();
    const frame = {
      pointer: 360,
      viewportStart: 0,
      viewportEnd: 400,
      seconds: 0.016,
      position: 500,
      minimum: 0,
      maximum: 1_000,
    };
    expect(adapter.step(revision, frame)).toEqual(
      resolveReferenceAutoScroll({
        ...frame,
        edgeExtent: 80,
        maximumSpeed: 1_000,
      }),
    );
    expect(adapter.stop(revision)).toBe(true);
    expect(adapter.step(revision, frame)).toBeUndefined();
    expect(() =>
      normalizeCandidateRecognizers<GestureIntentApp, "Canvas">(
        "Canvas",
        autoScrollAware,
        contract,
        parts,
        actions,
      ),
    ).toThrow("unknown auto-scroll parameter");
  });

  test("materializes hover intent and long press without leaking raw pointer policy", () => {
    const scene = normalizeCandidateRecognizers<InteractionIntentApp, "Disclosure">(
      "Disclosure",
      {
        preview: {
          region: "Trigger",
          activation: {
            dwell: { dimension: "time", value: 0.12 },
            maximumSpeed: {
              perSecond: { dimension: "length", value: 80 },
            },
            leaveDelay: { dimension: "time", value: 0.08 },
          },
          handoff: { destination: "Panel", corridor: "safe-polygon" },
          outcomes: {
            engaged: { action: "open" },
            disengaged: { action: "close" },
          },
          alternative: { kind: "focus" },
          relations: [{ kind: "simultaneous", with: "inspect" }],
        },
        inspect: {
          region: "Trigger",
          activation: {
            duration: { dimension: "time", value: 0.45 },
            movementTolerance: { dimension: "length", value: 8 },
          },
          outcomes: {
            recognized: { action: "open" },
            released: { action: "releaseLongPress" },
            cancelled: { action: "cancelLongPress" },
          },
          alternative: { kind: "action", action: "openByKeyboard" },
        },
      },
      {
        preview: { kind: "hoverIntent", outcomes: ["engaged", "disengaged"] },
        inspect: { kind: "longPress", outcomes: ["recognized", "released", "cancelled"] },
      },
      new Set(["Trigger", "Panel"]),
      new Set(["open", "close", "openByKeyboard", "cancelLongPress", "releaseLongPress"]),
    );

    expect(scene).toEqual({
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
            { outcome: "cancelled", action: "cancelLongPress" },
            { outcome: "recognized", action: "open" },
            { outcome: "released", action: "releaseLongPress" },
          ],
          alternative: { kind: "action", action: "openByKeyboard" },
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
            { outcome: "disengaged", action: "close" },
            { outcome: "engaged", action: "open" },
          ],
          alternative: { kind: "focus" },
        },
      ],
      relations: [{ kind: "simultaneous", first: "inspect", second: "preview" }],
    });
    expect(() =>
      normalizeCandidateRecognizers<InteractionIntentApp, "Disclosure">(
        "Disclosure",
        {
          preview: {
            region: "Trigger",
            activation: {
              dwell: { dimension: "time", value: 0.12 },
              maximumSpeed: { perSecond: { dimension: "length", value: 80 } },
              leaveDelay: { dimension: "time", value: 0.08 },
            },
            outcomes: {
              engaged: { action: "open" },
              disengaged: { action: "close" },
            },
            alternative: { kind: "focus" },
            relations: [{ kind: "simultaneous", with: "inspect" }],
          },
          inspect: {
            region: "Trigger",
            activation: {
              duration: { dimension: "time", value: 0.45 },
              movementTolerance: { dimension: "length", value: 8 },
            },
            outcomes: {
              recognized: { action: "open" },
              released: { action: "releaseLongPress" },
              cancelled: { action: "cancelLongPress" },
            },
            alternative: { kind: "action", action: "openByKeyboard" },
          },
        },
        {
          preview: { kind: "hoverIntent", outcomes: ["engaged"] },
          inspect: { kind: "longPress", outcomes: ["recognized", "released", "cancelled"] },
        },
        new Set(["Trigger", "Panel"]),
        new Set(["open", "close", "openByKeyboard", "cancelLongPress", "releaseLongPress"]),
      ),
    ).toThrow("inconsistent generated outcome contract");
  });
});

const categorized: CategorizedPreset<ComparisonApp, "family"> = {
  name: "family",
  components: {
    Action: {
      Root: [
        {
          layout: { minimumBlock: 44, inset: 12 },
          shape: { corners: 12 },
          paint: { fill: "surface", stroke: "border", opacity: 1 },
          typography: { type: "label" },
          motion: {
            targets: { scale: 1 },
            transitions: [
              { property: "fill", policy: "hover" },
              { property: "scale", policy: "press" },
            ],
          },
        },
      ],
    },
  },
};

const operational: OperationalPreset<ComparisonApp, "family"> = {
  name: "family",
  components: {
    Action: {
      Root: [
        { kind: "target", property: "minimumBlock", value: 44 },
        { kind: "target", property: "inset", value: 12 },
        { kind: "target", property: "corners", value: 12 },
        { kind: "target", property: "fill", value: "surface" },
        { kind: "target", property: "stroke", value: "border" },
        { kind: "target", property: "type", value: "label" },
        { kind: "target", property: "scale", value: 1 },
        { kind: "target", property: "opacity", value: 1 },
        { kind: "transition", property: "scale", policy: "press" },
        { kind: "transition", property: "fill", policy: "hover" },
      ],
    },
  },
};

const equations: EquationPreset<ComparisonApp, "family"> = {
  name: "family",
  components: {
    Action: {
      Root: {
        targets: {
          minimumBlock: 44,
          inset: 12,
          corners: 12,
          fill: "surface",
          stroke: "border",
          type: "label",
          scale: 1,
          opacity: 1,
        },
        transitions: { scale: "press", fill: "hover" },
      },
    },
  },
};

describe("UI language candidate normalization", () => {
  test("normalizes three notations to one target scene", () => {
    const expected = normalizeCategorizedPreset(categorized);
    expect(normalizeOperationalPreset(operational)).toEqual(expected);
    expect(normalizeEquationPreset(equations)).toEqual(expected);
  });

  test("rejects duplicate target ownership in fragment and operation candidates", () => {
    const duplicateCategorized: CategorizedPreset<ComparisonApp, "family"> = {
      ...categorized,
      components: {
        Action: {
          Root: [{ paint: { opacity: 1 } }, { paint: { opacity: 0.5 } }],
        },
      },
    };
    const duplicateOperational: OperationalPreset<ComparisonApp, "family"> = {
      ...operational,
      components: {
        Action: {
          Root: [
            { kind: "target", property: "scale", value: 1 },
            { kind: "target", property: "scale", value: 0.95 },
          ],
        },
      },
    };

    expect(() => normalizeCategorizedPreset(duplicateCategorized)).toThrow(
      'Target "Action.Root:opacity" is owned by both "Action.Root[0]" and "Action.Root[1]".',
    );
    expect(() => normalizeOperationalPreset(duplicateOperational)).toThrow(
      'Target "Action.Root:scale" is owned by both "Action.Root[0]" and "Action.Root[1]".',
    );
  });

  test("normalizes typed semantic operations and policy associations", () => {
    const opacity = createCandidateTargetHandle<number>("Action.Root", "opacity", "number");
    const scale = createCandidateTargetHandle<number>("Action.Root", "scale", "number");
    const press = createCandidateTransitionPolicy<number>("press", timingDefinition);
    const scene = normalizeSemanticOperations([
      setCandidateTarget(opacity, 1),
      setCandidateTarget(scale, 0.98),
      transitionCandidateTarget(scale, press),
    ]);

    expect(scene).toEqual({
      transaction: { targets: ["Action.Root:opacity", "Action.Root:scale"] },
      targets: { "Action.Root:opacity": 1, "Action.Root:scale": 0.98 },
      addresses: {
        "Action.Root:opacity": { identity: "Action.Root", property: "opacity" },
        "Action.Root:scale": { identity: "Action.Root", property: "scale" },
      },
      valueTypes: { "Action.Root:opacity": "number", "Action.Root:scale": "number" },
      transitions: [{ target: "Action.Root:scale", policy: "press", definition: timingDefinition }],
    });
  });

  test("rejects invalid backend-independent transition policy values", () => {
    expect(() =>
      createCandidateTransitionPolicy("bad-timing", {
        normal: { kind: "timing", milliseconds: -1, curve: { kind: "linear" } },
        reduced: { kind: "instant" },
      }),
    ).toThrow("Timing duration must be finite and non-negative.");
    expect(() =>
      createCandidateTransitionPolicy("bad-curve", {
        normal: {
          kind: "timing",
          milliseconds: 100,
          curve: { kind: "cubic", x1: 2, y1: 0, x2: 1, y2: 1 },
        },
        reduced: { kind: "instant" },
      }),
    ).toThrow("Timing curve x coordinates must be within zero and one.");
    expect(() =>
      createCandidateTransitionPolicy("bad-spring", {
        normal: { kind: "spring", mass: 0, stiffness: 420, damping: 34 },
        reduced: { kind: "instant" },
      }),
    ).toThrow("Spring parameters must be finite with positive mass and stiffness.");
  });

  test("binds retained presence to local transition settlements", () => {
    const content = createCandidatePresentationIdentity("Drawer.Content");
    const other = createCandidatePresentationIdentity("Drawer.Other");
    const opacity = createCandidateTargetHandle<number>("Drawer.Content", "opacity");
    const otherOpacity = createCandidateTargetHandle<number>("Drawer.Other", "opacity");
    const policy = createCandidateTransitionPolicy<number>("content", timingDefinition);
    const scene = normalizeSemanticOperations([
      setCandidateTarget(opacity, 0),
      transitionCandidateTarget(opacity, policy),
    ]);

    expect(
      normalizeCandidatePresence([content, other], [retainCandidate(content, [opacity])], scene),
    ).toEqual([
      {
        identity: "Drawer.Content",
        until: ["Drawer.Content:opacity"],
        release: {
          interaction: "exit-start",
          accessibility: "exit-start",
          unmount: "all-settled",
          stale: "ignore",
        },
      },
    ]);
    expect(() =>
      normalizeCandidatePresence(
        [content, other],
        [retainCandidate(content, [otherOpacity])],
        scene,
      ),
    ).toThrow('Presence identity "Drawer.Content" cannot await target "Drawer.Other:opacity".');
    expect(() =>
      normalizeCandidatePresence(
        [content],
        [retainCandidate(content, [opacity])],
        normalizeSemanticOperations([setCandidateTarget(opacity, 0)]),
      ),
    ).toThrow('Presence settlement target "Drawer.Content:opacity" has no transition policy.');
    expect(() =>
      normalizeCandidatePresence(
        [content],
        [retainCandidate(content, [opacity]), retainCandidate(content, [opacity])],
        scene,
      ),
    ).toThrow("owned by both");
  });

  test("allows transition policy on layout-owned geometry without presentation ownership", () => {
    const geometry = createCandidateDerivedTargetHandle<CandidateGeometry>(
      "Drawer.Surface",
      "geometry",
      "geometry",
    );
    const projection = createCandidateTransitionPolicy<CandidateGeometry>(
      "layout",
      layoutDefinition,
    );

    expect(
      normalizeSemanticOperations([transitionCandidateTarget(geometry, projection)], [geometry]),
    ).toEqual({
      transaction: { targets: ["Drawer.Surface:geometry"] },
      targets: {},
      addresses: {
        "Drawer.Surface:geometry": { identity: "Drawer.Surface", property: "geometry" },
      },
      valueTypes: { "Drawer.Surface:geometry": "geometry" },
      transitions: [
        {
          target: "Drawer.Surface:geometry",
          policy: "layout",
          definition: layoutDefinition,
        },
      ],
    });
    expect(() =>
      normalizeSemanticOperations(
        [
          {
            kind: "set",
            target: geometry,
            value: {
              inline: { dimension: "length", value: 0 },
              block: { dimension: "length", value: 0 },
              inlineSize: { dimension: "length", value: 100 },
              blockSize: { dimension: "length", value: 100 },
            },
          },
        ],
        [geometry],
      ),
    ).toThrow('Target "Drawer.Surface:geometry" is owned by another semantic domain.');
  });

  test("evaluates one reactive condition algebra with active dependencies only", () => {
    const disabled = createCandidateReadExpression<boolean>("state.disabled");
    const compactOpacity = createCandidateReadExpression<number>("tokens.compactOpacity");
    const opacity = disabled.choose(compactOpacity, 1);

    expect(
      evaluateCandidateExpression(opacity, {
        "state.disabled": true,
        "tokens.compactOpacity": 0.46,
      }),
    ).toEqual({ value: 0.46, dependencies: ["state.disabled", "tokens.compactOpacity"] });
    expect(
      evaluateCandidateExpression(opacity, {
        "state.disabled": false,
      }),
    ).toEqual({ value: 1, dependencies: ["state.disabled"] });
    expect(() => evaluateCandidateExpression(opacity, {})).toThrow(
      'Unknown expression dependency "state.disabled".',
    );
  });

  test("evaluates closed boolean and dimension-safe length expressions", () => {
    const compact = createCandidateReadExpression<boolean>("environment.compact");
    const hovered = createCandidateReadExpression<boolean>("parts.Trigger.interaction.hovered");
    const width = createCandidateReadExpression<{ dimension: "length"; value: number }>(
      "geometry.width",
    );
    const inactive = createCandidateReadExpression<boolean>("inactive");
    const inset = addCandidate(scaleCandidate(width, 0.1), {
      dimension: "length",
      value: 8,
    });

    expect(
      evaluateCandidateExpression(inset, {
        "geometry.width": { dimension: "length", value: 320 },
      }),
    ).toEqual({
      value: { dimension: "length", value: 40 },
      dependencies: ["geometry.width"],
    });
    expect(
      evaluateCandidateExpression(andCandidate(compact, orCandidate(hovered, inactive)), {
        "environment.compact": false,
      }),
    ).toEqual({ value: false, dependencies: ["environment.compact"] });
    expect(
      evaluateCandidateExpression(notCandidate(compact), { "environment.compact": true }).value,
    ).toBe(false);
    expect(
      evaluateCandidateExpression(
        equalCandidate({ dimension: "length", value: 12 }, { dimension: "length", value: 12 }),
        {},
      ).value,
    ).toBe(true);
    expect(
      evaluateCandidateExpression(
        clampCandidate(
          { dimension: "length", value: 140 },
          { dimension: "length", value: 0 },
          { dimension: "length", value: 100 },
        ),
        {},
      ).value,
    ).toEqual({ dimension: "length", value: 100 });
    expect(() =>
      evaluateCandidateExpression(
        clampCandidate(
          { dimension: "time", value: 1 },
          { dimension: "time", value: 2 },
          { dimension: "time", value: 0 },
        ),
        {},
      ),
    ).toThrow("Clamp bounds are reversed.");
    expect(
      evaluateCandidateExpression(
        normalizeCandidate(
          width,
          [
            { dimension: "length", value: 100 },
            { dimension: "length", value: 300 },
          ],
          { clamp: true },
        ),
        { "geometry.width": { dimension: "length", value: 250 } },
      ),
    ).toEqual({ value: 0.75, dependencies: ["geometry.width"] });
    expect(() =>
      evaluateCandidateExpression(
        normalizeCandidate(
          width,
          [
            { dimension: "length", value: 100 },
            { dimension: "length", value: 100 },
          ],
          { clamp: false },
        ),
        { "geometry.width": { dimension: "length", value: 250 } },
      ),
    ).toThrow("Normalization range cannot have zero extent.");
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(
          1.5,
          [0, 1],
          [
            { dimension: "length", value: 0 },
            { dimension: "length", value: 100 },
          ],
          { clamp: true },
        ),
        {},
      ).value,
    ).toEqual({ dimension: "length", value: 100 });
    expect(
      evaluateCandidateExpression(
        compareCandidate({ dimension: "time", value: 0.18 }, "less", {
          dimension: "time",
          value: 0.3,
        }),
        {},
      ).value,
    ).toBe(true);
    const angle = createCandidateReadExpression<{ dimension: "angle"; value: number }>("angle");
    expect(() =>
      evaluateCandidateExpression(addCandidate(angle, { dimension: "angle", value: 1 }), {
        angle: { dimension: "length", value: 2 },
      }),
    ).toThrow("Numeric operands must have the same dimension.");
    const from = { colorSpace: "oklch" as const, lightness: 0.6, chroma: 0.2, hue: 350, alpha: 1 };
    const to = { colorSpace: "oklch" as const, lightness: 0.8, chroma: 0.1, hue: 10, alpha: 1 };
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [from, to], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferenceOklch(from, to, 0.5));
    const gradientFrom = {
      kind: "linear-gradient" as const,
      angle: { dimension: "angle" as const, value: 350 },
      stops: [
        { position: 0, color: from },
        { position: 1, color: to },
      ],
    };
    const gradientTo = {
      kind: "linear-gradient" as const,
      angle: { dimension: "angle" as const, value: 10 },
      stops: [
        { position: 0.2, color: to },
        { position: 0.8, color: from },
      ],
    };
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [gradientFrom, gradientTo], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferencePaint(gradientFrom, gradientTo, 0.5));
    expect(() =>
      evaluateCandidateExpression(
        interpolateCandidate(
          0.5,
          [0, 1],
          [
            gradientFrom,
            {
              ...gradientTo,
              stops: [...gradientTo.stops, { position: 1, color: to }],
            },
          ],
          { clamp: true },
        ),
        {},
      ),
    ).toThrow("matching stop topology");

    const rectangleFrom = {
      kind: "rectangle" as const,
      corners: {
        startStart: { radius: { dimension: "length" as const, value: 0 }, smoothing: 0 },
        startEnd: { radius: { dimension: "length" as const, value: 4 }, smoothing: 0.2 },
        endStart: { radius: { dimension: "length" as const, value: 8 }, smoothing: 0.4 },
        endEnd: { radius: { dimension: "length" as const, value: 12 }, smoothing: 0.6 },
      },
    };
    const rectangleTo = {
      kind: "rectangle" as const,
      corners: {
        startStart: { radius: { dimension: "length" as const, value: 20 }, smoothing: 1 },
        startEnd: { radius: { dimension: "length" as const, value: 16 }, smoothing: 0.8 },
        endStart: { radius: { dimension: "length" as const, value: 12 }, smoothing: 0.6 },
        endEnd: { radius: { dimension: "length" as const, value: 8 }, smoothing: 0.4 },
      },
    };
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [rectangleFrom, rectangleTo], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferenceShape(rectangleFrom, rectangleTo, 0.5));

    const pathFrom = {
      kind: "path" as const,
      viewBox: { inlineSize: 1, blockSize: 1 },
      commands: [
        { kind: "move" as const, inline: 0, block: 0 },
        { kind: "line" as const, inline: 1, block: 0 },
        { kind: "close" as const },
      ],
      fillRule: "nonzero" as const,
    };
    const pathTo = {
      ...pathFrom,
      commands: [
        { kind: "move" as const, inline: 0.5, block: 0.5 },
        { kind: "line" as const, inline: 0, block: 1 },
        { kind: "close" as const },
      ],
    };
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [pathFrom, pathTo], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferenceShape(pathFrom, pathTo, 0.5));
    expect(() =>
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [pathFrom, { ...pathTo, fillRule: "even-odd" }], {
          clamp: true,
        }),
        {},
      ),
    ).toThrow("matching coordinate and fill semantics");

    const transformFrom: CandidateTransform = {
      translation: {
        inline: { dimension: "length", value: 0 },
        block: { dimension: "length", value: 0 },
        depth: { dimension: "length", value: 0 },
      },
      scale: { inline: 1, block: 1, depth: 1 },
      rotation: {
        axis: { x: 0, y: 0, z: 1 },
        angle: { dimension: "angle", value: 350 },
      },
      origin: { inline: 0.5, block: 0.5, depth: { dimension: "length", value: 0 } },
      perspective: "none",
    };
    const transformTo: CandidateTransform = {
      ...transformFrom,
      translation: { ...transformFrom.translation, block: { dimension: "length", value: 100 } },
      scale: { inline: 0.8, block: 0.8, depth: 1 },
      rotation: {
        axis: { x: 0, y: 0, z: 1 },
        angle: { dimension: "angle", value: 10 },
      },
      perspective: { dimension: "length", value: 400 },
    };
    const transformMidpoint = evaluateCandidateExpression(
      interpolateCandidate(0.5, [0, 1], [transformFrom, transformTo], { clamp: true }),
      {},
    ).value;
    expect(transformMidpoint.translation.block.value).toBe(50);
    expect(transformMidpoint.scale.inline).toBe(0.9);
    expect(transformMidpoint.perspective).toEqual({ dimension: "length", value: 800 });
    expect(transformMidpoint.rotation.angle.value).toBeCloseTo(
      interpolateReferenceRotation(
        { axis: transformFrom.rotation.axis, degrees: transformFrom.rotation.angle.value },
        { axis: transformTo.rotation.axis, degrees: transformTo.rotation.angle.value },
        0.5,
      ).degrees,
    );
    expect(transformMidpoint).toEqual(
      interpolateReferenceTransform(transformFrom, transformTo, 0.5),
    );
  });

  test("interpolates compatible visual composites through independent reference laws", () => {
    const length = (value: number): CandidateLength => ({ dimension: "length", value });
    const dark = { colorSpace: "oklch" as const, lightness: 0.2, chroma: 0.04, hue: 250, alpha: 1 };
    const light = {
      colorSpace: "oklch" as const,
      lightness: 0.9,
      chroma: 0.02,
      hue: 20,
      alpha: 0.6,
    };
    const solid = (color: typeof dark | typeof light) => ({ kind: "solid" as const, color });

    const strokeFrom: CandidateStroke = {
      paint: solid(dark),
      width: length(1),
      placement: "inside",
      dash: [length(2), length(4)],
    };
    const strokeTo: CandidateStroke = {
      paint: solid(light),
      width: length(3),
      placement: "inside",
      dash: [length(4), length(8)],
    };
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [strokeFrom, strokeTo], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferenceStroke(strokeFrom, strokeTo, 0.5));
    expect(() =>
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [strokeFrom, { ...strokeTo, placement: "outside" }], {
          clamp: true,
        }),
        {},
      ),
    ).toThrow("matching placement");

    const shadowsFrom: readonly CandidateShadow[] = [
      {
        kind: "outer",
        color: dark,
        offset: { inline: length(0), block: length(2) },
        blur: length(4),
        spread: length(-1),
      },
    ];
    const shadowsTo: readonly CandidateShadow[] = [
      {
        kind: "outer",
        color: light,
        offset: { inline: length(2), block: length(6) },
        blur: length(12),
        spread: length(1),
      },
    ];
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [shadowsFrom, shadowsTo], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferenceShadows(shadowsFrom, shadowsTo, 0.5));
    expect(() =>
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [shadowsFrom, []], { clamp: true }),
        {},
      ),
    ).toThrow("matching list topology");

    const materialFrom: CandidateMaterial = {
      backdropBlur: length(8),
      backdropSaturation: 1,
      tint: solid(dark),
      noise: 0,
    };
    const materialTo: CandidateMaterial = {
      backdropBlur: length(24),
      backdropSaturation: 1.4,
      tint: solid(light),
      noise: 0.2,
    };
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [materialFrom, materialTo], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferenceMaterial(materialFrom, materialTo, 0.5));

    const typeFrom: CandidateTypeStyle = {
      families: ["Inter", "sans-serif"],
      size: length(14),
      lineHeight: length(20),
      weight: 400,
      tracking: length(0),
      align: "start",
      wrap: "wrap",
      overflow: "clip",
      decoration: "none",
      variations: { opsz: 14, wght: 400 },
    };
    const typeTo: CandidateTypeStyle = {
      ...typeFrom,
      size: length(18),
      lineHeight: length(26),
      weight: 600,
      tracking: length(0.2),
      variations: { opsz: 18, wght: 600 },
    };
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [typeFrom, typeTo], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferenceTypeStyle(typeFrom, typeTo, 0.5));
    expect(() =>
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [typeFrom, { ...typeTo, wrap: "balance" }], {
          clamp: true,
        }),
        {},
      ),
    ).toThrow("matching text semantics");

    const mediaFrom: CandidateMediaFit = {
      mode: "cover",
      focalPoint: { inline: 0.2, block: 0.4 },
    };
    const mediaTo: CandidateMediaFit = {
      mode: "cover",
      focalPoint: { inline: 0.8, block: 0.6 },
    };
    expect(
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [mediaFrom, mediaTo], { clamp: true }),
        {},
      ).value,
    ).toEqual(interpolateReferenceMediaFit(mediaFrom, mediaTo, 0.5));
    expect(() =>
      evaluateCandidateExpression(
        interpolateCandidate(0.5, [0, 1], [mediaFrom, { ...mediaTo, mode: "contain" }], {
          clamp: true,
        }),
        {},
      ),
    ).toThrow("matching modes");
  });

  test("preflights every visual endpoint before an atomic transition batch", () => {
    const black = { colorSpace: "oklch" as const, lightness: 0, chroma: 0, hue: 0, alpha: 1 };
    const white = { colorSpace: "oklch" as const, lightness: 1, chroma: 0, hue: 0, alpha: 1 };
    const entries = [
      { target: "surface:opacity", valueType: "number" as const, from: 0, to: 1 },
      {
        target: "surface:paint",
        valueType: "paint" as const,
        from: { kind: "solid" as const, color: black },
        to: { kind: "solid" as const, color: white },
      },
      {
        target: "surface:shape",
        valueType: "shape" as const,
        from: { kind: "capsule" as const },
        to: { kind: "capsule" as const },
      },
    ];
    expect(normalizeCandidateTransitionCompatibility(entries)).toEqual(
      resolveReferenceVisualTransitionBatch(entries),
    );

    const incompatible = [
      entries[0]!,
      {
        target: "surface:paint",
        valueType: "paint" as const,
        from: { kind: "solid" as const, color: black },
        to: {
          kind: "linear-gradient" as const,
          angle: { dimension: "angle" as const, value: 0 },
          stops: [
            { position: 0, color: black },
            { position: 1, color: white },
          ],
        },
      },
    ];
    expect(() => normalizeCandidateTransitionCompatibility(incompatible)).toThrow("matching kinds");
    expect(() => resolveReferenceVisualTransitionBatch(incompatible)).toThrow("matching kinds");

    const strokePresence = [
      {
        target: "surface:stroke",
        valueType: "stroke" as const,
        from: "none" as const,
        to: {
          paint: { kind: "solid" as const, color: black },
          width: { dimension: "length" as const, value: 1 },
          placement: "inside" as const,
        },
      },
    ];
    expect(() => normalizeCandidateTransitionCompatibility(strokePresence)).toThrow(
      "explicit presentation presence",
    );
    expect(() => resolveReferenceVisualTransitionBatch(strokePresence)).toThrow(
      "explicit presentation presence",
    );

    expect(() => normalizeCandidateTransitionCompatibility([entries[0]!, entries[0]!])).toThrow(
      "same target",
    );
    expect(() => resolveReferenceVisualTransitionBatch([entries[0]!, entries[0]!])).toThrow(
      "same target",
    );
  });

  test("matches the reference algebra across generated scalar clamp and comparison inputs", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
        (value, leftBound, rightBound) => {
          const minimum = Math.min(leftBound, rightBound);
          const maximum = Math.max(leftBound, rightBound);
          const candidate = evaluateCandidateExpression(
            clampCandidate(value, minimum, maximum),
            {},
          ).value;
          const reference = evaluateReferenceExpression(
            {
              kind: "clamp",
              value: { kind: "literal", value: { dimension: "scalar", value } },
              minimum: { kind: "literal", value: { dimension: "scalar", value: minimum } },
              maximum: { kind: "literal", value: { dimension: "scalar", value: maximum } },
            },
            {},
          ).value;
          expect(candidate).toBe((reference as { readonly value: number }).value);

          expect(
            evaluateCandidateExpression(compareCandidate(value, "lessOrEqual", maximum), {}).value,
          ).toBe(
            evaluateReferenceExpression(
              {
                kind: "compare",
                relation: "lessOrEqual",
                left: { kind: "literal", value: { dimension: "scalar", value } },
                right: { kind: "literal", value: { dimension: "scalar", value: maximum } },
              },
              {},
            ).value as boolean,
          );
        },
      ),
    );
  });

  test("composes explicit typed recipes without ordering precedence", () => {
    const createOpacity = createCandidateRecipe(
      (target: CandidateTargetHandle<number>, value: number) =>
        [setCandidateTarget(target, value)] as const,
    );
    const root = createCandidateTargetHandle<number>("Action.Root", "opacity");
    const label = createCandidateTargetHandle<number>("Action.Label", "opacity");
    const first = normalizeSemanticOperations([
      ...createOpacity(root, 1),
      ...createOpacity(label, 0.8),
    ]);
    const reversed = normalizeSemanticOperations([
      ...createOpacity(label, 0.8),
      ...createOpacity(root, 1),
    ]);

    expect(reversed).toEqual(first);
    expect(() =>
      normalizeSemanticOperations([...createOpacity(root, 1), ...createOpacity(root, 0.5)]),
    ).toThrow("owned by both");
  });

  test("rejects duplicate semantic targets and policies for targets absent from the scene", () => {
    const opacity = createCandidateTargetHandle<number>("Action.Root", "opacity");
    const missing = createCandidateTargetHandle<number>("Action.Root", "scale");
    const policy = createCandidateTransitionPolicy<number>("state", timingDefinition);

    expect(() =>
      normalizeSemanticOperations([setCandidateTarget(opacity, 1), setCandidateTarget(opacity, 0)]),
    ).toThrow(
      'Target "Action.Root:opacity:value" is owned by both "contribution[0]" and "contribution[1]".',
    );
    expect(() =>
      normalizeSemanticOperations([
        setCandidateTarget(opacity, 1),
        transitionCandidateTarget(missing, policy),
      ]),
    ).toThrow('Transition policy references unknown target "Action.Root:scale".');
  });

  test("normalizes composition, clipping, hit testing, and shared identity", () => {
    const page = createCandidatePresentationIdentity("Drawer.Page");
    const chrome = createCandidatePresentationIdentity("Drawer.Chrome");
    const backdrop = createCandidatePresentationIdentity("Drawer.Backdrop");
    const surface = createCandidatePresentationIdentity("Drawer.Surface");
    const source = createCandidatePresentationIdentity("List.CardImage");
    const destination = createCandidatePresentationIdentity("Detail.HeroImage");

    expect(
      normalizeSemanticRelationships(
        [page, chrome, backdrop, surface, source, destination],
        [
          aboveCandidate(chrome, page),
          aboveCandidate(backdrop, chrome),
          aboveCandidate(surface, backdrop),
          clipCandidate(surface, destination),
          hitTestCandidate(backdrop, "capture"),
          matchCandidate("wallet-image", source, destination),
        ],
      ),
    ).toEqual({
      composition: [
        "Drawer.Page",
        "Drawer.Chrome",
        "Drawer.Backdrop",
        "Drawer.Surface",
        "List.CardImage",
        "Detail.HeroImage",
      ],
      clips: [{ owner: "Drawer.Surface", member: "Detail.HeroImage" }],
      hitTests: { "Drawer.Backdrop": "capture" },
      matches: [
        {
          identity: "wallet-image",
          source: "List.CardImage",
          destination: "Detail.HeroImage",
        },
      ],
      isolates: [],
      nativeLayers: [],
      masks: [],
    });
  });

  test("composes matched geometry, crossfade, presence, and interruption without another primitive", () => {
    const source = createCandidatePresentationIdentity("List.CardImage");
    const destination = createCandidatePresentationIdentity("Detail.HeroImage");
    const sourceOpacity = createCandidateTargetHandle<number>(
      "List.CardImage",
      "opacity",
      "number",
    );
    const destinationOpacity = createCandidateTargetHandle<number>(
      "Detail.HeroImage",
      "opacity",
      "number",
    );
    const policy = createCandidateTransitionPolicy<number>("shared.spring", {
      normal: { kind: "spring", mass: 1, stiffness: 420, damping: 34 },
      reduced: { kind: "instant" },
    });
    const initial = normalizeSemanticOperations([
      setCandidateTarget(sourceOpacity, 1),
      transitionCandidateTarget(sourceOpacity, policy),
      setCandidateTarget(destinationOpacity, 0),
      transitionCandidateTarget(destinationOpacity, policy),
    ]);
    const detail = normalizeSemanticOperations([
      setCandidateTarget(sourceOpacity, 0),
      transitionCandidateTarget(sourceOpacity, policy),
      setCandidateTarget(destinationOpacity, 1),
      transitionCandidateTarget(destinationOpacity, policy),
    ]);
    expect(
      normalizeSemanticRelationships(
        [source, destination],
        [matchCandidate("wallet-image", source, destination)],
      ).matches,
    ).toEqual([
      {
        identity: "wallet-image",
        source: "List.CardImage",
        destination: "Detail.HeroImage",
      },
    ]);
    expect(
      normalizeCandidatePresence([source], [retainCandidate(source, [sourceOpacity])], detail),
    ).toEqual([
      {
        identity: "List.CardImage",
        until: ["List.CardImage:opacity"],
        release: {
          interaction: "exit-start",
          accessibility: "exit-start",
          unmount: "all-settled",
          stale: "ignore",
        },
      },
    ]);
    const endpoints = [
      {
        target: sourceOpacity.key,
        valueType: "number" as const,
        from: initial.targets[sourceOpacity.key],
        to: detail.targets[sourceOpacity.key],
      },
      {
        target: destinationOpacity.key,
        valueType: "number" as const,
        from: initial.targets[destinationOpacity.key],
        to: detail.targets[destinationOpacity.key],
      },
    ];
    expect(normalizeCandidateTransitionCompatibility(endpoints)).toEqual(
      resolveReferenceVisualTransitionBatch(endpoints),
    );

    const descriptor = { name: "shared.spring", kind: "spring", valueType: "number" } as const;
    const opening = resolveReferenceTransitionUpdate({
      previous: {
        [sourceOpacity.key]: { target: 1, policy: descriptor, active: false, reducedMotion: false },
        [destinationOpacity.key]: {
          target: 0,
          policy: descriptor,
          active: false,
          reducedMotion: false,
        },
      },
      next: {
        [sourceOpacity.key]: { target: 0, policy: descriptor, active: true, reducedMotion: false },
        [destinationOpacity.key]: {
          target: 1,
          policy: descriptor,
          active: true,
          reducedMotion: false,
        },
      },
      presented: {
        [sourceOpacity.key]: { value: 1, velocity: 0 },
        [destinationOpacity.key]: { value: 0, velocity: 0 },
      },
      transaction: { cause: "semantic", revision: 1, epoch: 1 },
    });
    expect(opening.changes.map((change) => change.handoff?.strategy)).toEqual([
      "replace",
      "replace",
    ]);
    const layout = resolveReferenceLayoutTransition({
      identity: "wallet-image",
      previousParent: "List",
      nextParent: "Detail",
      presented: { inline: 20, block: 100, inlineSize: 80, blockSize: 80 },
      target: { inline: 0, block: 0, inlineSize: 320, blockSize: 240 },
      velocity: { inline: 0, block: -40, logInlineSize: 0.2, logBlockSize: 0.1 },
      driver: "spring",
      reducedMotion: false,
    });
    expect(layout).toMatchObject({ parentChanged: true, strategy: "retarget" });

    const presence = new ReferencePresenceCoordinator("List.CardImage");
    const enter = presence.target(true, [sourceOpacity.key]);
    expect(presence.settle(enter, sourceOpacity.key)).toBe(true);
    const exit = presence.target(false, [sourceOpacity.key]);
    expect(presence.snapshot).toMatchObject({ interactive: false, accessible: false });
    const reversal = presence.target(true, [sourceOpacity.key]);
    const reversing = resolveReferenceTransitionUpdate({
      previous: {
        [sourceOpacity.key]: { target: 0, policy: descriptor, active: true, reducedMotion: false },
        [destinationOpacity.key]: {
          target: 1,
          policy: descriptor,
          active: true,
          reducedMotion: false,
        },
      },
      next: {
        [sourceOpacity.key]: { target: 1, policy: descriptor, active: true, reducedMotion: false },
        [destinationOpacity.key]: {
          target: 0,
          policy: descriptor,
          active: true,
          reducedMotion: false,
        },
      },
      presented: {
        [sourceOpacity.key]: { value: 0.4, velocity: -2 },
        [destinationOpacity.key]: { value: 0.6, velocity: 2 },
      },
      transaction: { cause: "semantic", revision: 2, epoch: 2 },
    });
    expect(reversing.changes.map((change) => change.handoff?.velocity)).toEqual([2, -2]);
    expect(presence.settle(exit, sourceOpacity.key)).toBe(false);
    expect(presence.settle(reversal, sourceOpacity.key)).toBe(true);
    expect(presence.snapshot).toMatchObject({ phase: "present", mounted: true });
  });

  test("normalizes explicit isolation and structure-issued native layers", () => {
    const root = createCandidatePresentationIdentity("Dialog.Root");
    const surface = createCandidatePresentationIdentity("Dialog.Surface");
    const modal = issueCandidateNativeLayerHandle("Dialog.Root", "modal");

    expect(
      normalizeSemanticRelationships(
        [root, surface],
        [isolateCandidate(surface), nativeLayerCandidate(root, modal)],
      ),
    ).toEqual({
      composition: ["Dialog.Root", "Dialog.Surface"],
      clips: [],
      hitTests: {},
      matches: [],
      isolates: ["Dialog.Surface"],
      nativeLayers: [{ identity: "Dialog.Root", kind: "modal" }],
      masks: [],
    });

    expect(() =>
      normalizeSemanticRelationships([root, surface], [nativeLayerCandidate(surface, modal)]),
    ).toThrow('Native layer capability "Dialog.Root" cannot own "Dialog.Surface".');
  });

  test("normalizes alpha and luminance masks with one acyclic owner", () => {
    const surface = createCandidatePresentationIdentity("Card.Surface");
    const fade = createCandidatePresentationIdentity("Card.Fade");
    const detail = createCandidatePresentationIdentity("Card.Detail");

    expect(
      normalizeSemanticRelationships(
        [surface, fade, detail],
        [maskCandidate(surface, fade, "alpha")],
      ).masks,
    ).toEqual([{ owner: "Card.Surface", source: "Card.Fade", mode: "alpha" }]);
    expect(() =>
      normalizeSemanticRelationships(
        [surface, fade, detail],
        [maskCandidate(surface, fade, "alpha"), maskCandidate(surface, detail, "luminance")],
      ),
    ).toThrow("owned by both");
    expect(() =>
      normalizeSemanticRelationships(
        [surface, fade],
        [maskCandidate(surface, fade, "alpha"), maskCandidate(fade, surface, "alpha")],
      ),
    ).toThrow("Composition cycle");
  });

  test("creates accessibility-inert generated layers with stable typed targets", () => {
    const control = createCandidatePresentationIdentity("Control.Root");
    const background = createCandidatePresentationIdentity("Control.Background");
    const highlight = createCandidateLayer(control, "highlight");
    const accent = {
      kind: "solid",
      color: {
        colorSpace: "oklch",
        lightness: 0.7,
        chroma: 0.16,
        hue: 240,
        alpha: 1,
      },
    } as const;

    expect(highlight.identity.key).toBe("Control.Root:layer:9:highlight");
    expect(
      normalizeSemanticOperations([
        setCandidateTarget(highlight.fill, accent),
        setCandidateTarget(highlight.opacity, 0.8),
      ]),
    ).toEqual({
      transaction: {
        targets: ["Control.Root:layer:9:highlight:fill", "Control.Root:layer:9:highlight:opacity"],
      },
      targets: {
        "Control.Root:layer:9:highlight:fill": accent,
        "Control.Root:layer:9:highlight:opacity": 0.8,
      },
      addresses: {
        "Control.Root:layer:9:highlight:fill": {
          identity: "Control.Root:layer:9:highlight",
          property: "fill",
        },
        "Control.Root:layer:9:highlight:opacity": {
          identity: "Control.Root:layer:9:highlight",
          property: "opacity",
        },
      },
      valueTypes: {
        "Control.Root:layer:9:highlight:fill": "paint",
        "Control.Root:layer:9:highlight:opacity": "number",
      },
      transitions: [],
      generated: [
        {
          identity: "Control.Root:layer:9:highlight",
          owner: "Control.Root",
        },
      ],
    });
    expect(
      normalizeSemanticRelationships(
        [control, background, highlight.identity],
        [clipCandidate(control, highlight), aboveCandidate(highlight, background)],
      ).composition,
    ).toEqual(["Control.Root", "Control.Background", "Control.Root:layer:9:highlight"]);
    expect(() => createCandidateLayer(control, "bad:name")).toThrow(
      "Generated layer names must be non-empty and cannot contain a colon.",
    );
  });

  test("rejects invalid visual-value domains before adapter execution", () => {
    const layer = createCandidateLayer(
      createCandidatePresentationIdentity("Control.Root"),
      "validation",
    );
    const color = {
      colorSpace: "oklch",
      lightness: 0.7,
      chroma: 0.1,
      hue: 240,
      alpha: 1,
    } as const;
    expect(() =>
      normalizeSemanticOperations([
        setCandidateTarget(layer.fill, {
          kind: "linear-gradient",
          angle: { dimension: "angle", value: 0 },
          stops: [
            { position: 0.8, color },
            { position: 0.2, color },
          ],
        }),
      ]),
    ).toThrow("Gradient stops must be ordered.");
    expect(() =>
      normalizeSemanticOperations([
        setCandidateTarget(layer.shape, {
          kind: "rectangle",
          corners: {
            startStart: { radius: { dimension: "length", value: 8 }, smoothing: 2 },
            startEnd: { radius: { dimension: "length", value: 8 }, smoothing: 0.8 },
            endStart: { radius: { dimension: "length", value: 8 }, smoothing: 0.8 },
            endEnd: { radius: { dimension: "length", value: 8 }, smoothing: 0.8 },
          },
        }),
      ]),
    ).toThrow("corner smoothing must be within zero and one.");
    const transform = createCandidateTargetHandle<CandidateTransform>(
      "Control.Root",
      "transform-validation",
      "transform",
    );
    expect(() =>
      normalizeSemanticOperations([
        setCandidateTarget(transform, {
          translation: {
            inline: { dimension: "length", value: 0 },
            block: { dimension: "length", value: 0 },
            depth: { dimension: "length", value: 0 },
          },
          scale: { inline: 1, block: 1, depth: 1 },
          rotation: {
            axis: { x: 0, y: 0, z: 0 },
            angle: { dimension: "angle", value: 30 },
          },
          origin: { inline: 0.5, block: 0.5, depth: { dimension: "length", value: 0 } },
          perspective: "none",
        }),
      ]),
    ).toThrow("Transform rotation axis cannot be zero.");
  });

  test("rejects relationship cycles, duplicate hit-test owners, and unknown identities", () => {
    const page = createCandidatePresentationIdentity("Drawer.Page");
    const surface = createCandidatePresentationIdentity("Drawer.Surface");
    const missing = createCandidatePresentationIdentity("Drawer.Missing");

    expect(() =>
      normalizeSemanticRelationships(
        [page, surface],
        [aboveCandidate(surface, page), aboveCandidate(page, surface)],
      ),
    ).toThrow("Composition cycle: Drawer.Page -> Drawer.Surface");
    expect(() =>
      normalizeSemanticRelationships(
        [page],
        [hitTestCandidate(page, "auto"), hitTestCandidate(page, "none")],
      ),
    ).toThrow('Target "Drawer.Page:participation" is owned by both "hitTest[0]" and "hitTest[1]".');
    expect(() => normalizeSemanticRelationships([page], [clipCandidate(page, missing)])).toThrow(
      'Unknown clip identity "Drawer.Missing".',
    );
  });

  test("normalizes one direct gesture owner and one velocity-preserving settlement", () => {
    const block = createCandidateTargetHandle<CandidateLength>(
      "Drawer.Surface",
      "translation.block",
    );
    const dismiss = createCandidateRecognizerHandle<"drag", "open" | "closed">(
      "Drawer.dismiss",
      "drag",
    );
    const spring = createCandidateTransitionPolicy<CandidateLength>("sheet", springDefinition);

    const scene = normalizeCandidateDirectManipulation([
      driveCandidate(block, dismiss, dismiss.translation.block),
      settleCandidate(block, dismiss, {
        destinations: {
          open: { dimension: "length", value: 0 },
          closed: { dimension: "length", value: 844 },
        },
        policy: spring,
        preserve: "velocity",
        projectionTime: gestureProjectionTime,
        resistance: gestureResistance,
      }),
    ]);
    expect(scene).toEqual({
      lifecycle: {
        capture: "on-recognition",
        release: ["commit", "cancel", "capture-lost", "absent", "dispose"],
        stale: "ignore",
      },
      drives: [
        {
          target: "Drawer.Surface:translation.block",
          gesture: "Drawer.dismiss",
          recognizer: "drag",
          projection: { kind: "read", path: "Drawer.dismiss.translation.block" },
        },
      ],
      settlements: [
        {
          target: "Drawer.Surface:translation.block",
          gesture: "Drawer.dismiss",
          recognizer: "drag",
          destinations: {
            open: { dimension: "length", value: 0 },
            closed: { dimension: "length", value: 844 },
          },
          policy: "sheet",
          definition: springDefinition,
          preserve: "velocity",
          projectionTime: "Gesture.projectionTime",
          resistance: "Gesture.resistance",
        },
      ],
    });
    expect(() =>
      validateCandidateDirectManipulationParameters(scene, {
        "Gesture.projectionTime": 0.2,
        "Gesture.resistance": 0.5,
      }),
    ).not.toThrow();
    expect(() =>
      validateCandidateDirectManipulationParameters(scene, {
        "Gesture.projectionTime": 0.2,
        "Gesture.resistance": 2,
      }),
    ).toThrow("Gesture resistance must be within zero and one.");
  });

  test("resolves bounded preset parameters without transferring semantic commitment", () => {
    const distance = issueCandidateParameterHandle<number>("Drawer.dismiss.distance");
    const rubberBand = issueCandidateParameterHandle<number>("Drawer.dismiss.rubberBand");
    const definitions = [
      { parameter: distance, default: 0.5, minimum: 0.1, maximum: 0.9 },
      { parameter: rubberBand, default: 0.14, minimum: 0, maximum: 0.5 },
    ];

    expect(
      normalizeCandidateParameters(definitions, [setCandidateParameter(distance, 0.42)]),
    ).toEqual({
      "Drawer.dismiss.distance": 0.42,
      "Drawer.dismiss.rubberBand": 0.14,
    });
    expect(() =>
      normalizeCandidateParameters(definitions, [setCandidateParameter(distance, 1)]),
    ).toThrow('Presentation parameter "Drawer.dismiss.distance" is outside its bounds.');
    expect(() =>
      normalizeCandidateParameters(definitions, [
        setCandidateParameter(distance, 0.4),
        setCandidateParameter(distance, 0.6),
      ]),
    ).toThrow("owned by both");
  });

  test("rejects duplicate, missing, and mismatched direct gesture ownership", () => {
    const block = createCandidateTargetHandle<CandidateLength>(
      "Drawer.Surface",
      "translation.block",
    );
    const dismiss = createCandidateRecognizerHandle<"drag", "open" | "closed">(
      "Drawer.dismiss",
      "drag",
    );
    const scroll = createCandidateRecognizerHandle<"pan", "rest">("Drawer.scroll", "pan");
    const spring = createCandidateTransitionPolicy<CandidateLength>("sheet", springDefinition);

    expect(() =>
      normalizeCandidateDirectManipulation([
        driveCandidate(block, dismiss, dismiss.translation.block),
        driveCandidate(block, scroll, scroll.translation.block),
      ]),
    ).toThrow(
      'Target "Drawer.Surface:translation.block:directOwner" is owned by both "drive[0]" and "drive[1]".',
    );
    expect(() =>
      normalizeCandidateDirectManipulation([
        settleCandidate(block, dismiss, {
          destinations: {
            open: { dimension: "length", value: 0 },
            closed: { dimension: "length", value: 844 },
          },
          policy: spring,
          preserve: "velocity",
          projectionTime: gestureProjectionTime,
          resistance: gestureResistance,
        }),
      ]),
    ).toThrow('Gesture settlement target "Drawer.Surface:translation.block" has no direct owner.');
    expect(() =>
      normalizeCandidateDirectManipulation([
        driveCandidate(block, scroll, scroll.translation.block),
        settleCandidate(block, dismiss, {
          destinations: {
            open: { dimension: "length", value: 0 },
            closed: { dimension: "length", value: 844 },
          },
          policy: spring,
          preserve: "velocity",
          projectionTime: gestureProjectionTime,
          resistance: gestureResistance,
        }),
      ]),
    ).toThrow(
      'Gesture target "Drawer.Surface:translation.block" is driven by "Drawer.scroll" but settled by "Drawer.dismiss".',
    );
  });

  test("normalizes arrangement, intrinsic measurement, and virtual extent relations", () => {
    const page = createCandidatePresentationIdentity("List.Page");
    const viewport = createCandidatePresentationIdentity("List.Viewport");
    const content = createCandidatePresentationIdentity("List.Content");
    const status = createCandidatePresentationIdentity("List.Status");
    const records = createCandidateCollectionHandle<string>("List.records");
    const gap = { dimension: "length", value: 12 } as const;

    expect(
      normalizeSemanticLayout(
        [page, viewport, content, status],
        [
          arrangeCandidate(
            page,
            [viewport, status],
            flowCandidate({
              axis: "block",
              gap,
              align: "stretch",
              distribute: "start",
              wrap: false,
            }),
          ),
          scrollCandidate(viewport, content, {
            axis: "block",
            behavior: "free",
            indicators: "automatic",
          }),
          intrinsicCandidate(page, content, ["block"]),
          virtualizeCandidate(records, viewport, {
            axis: "block",
            estimate: { dimension: "length", value: 44 },
            overscan: 8,
            offscreen: "retain-focused",
          }),
        ],
      ),
    ).toEqual({
      parents: {
        "List.Content": "List.Viewport",
        "List.Status": "List.Page",
        "List.Viewport": "List.Page",
      },
      arrangements: [
        {
          parent: "List.Page",
          children: ["List.Viewport", "List.Status"],
          arrangement: {
            algorithm: "flow",
            axis: "block",
            gap,
            align: "stretch",
            distribute: "start",
            wrap: false,
          },
        },
      ],
      intrinsic: [{ owner: "List.Page", content: "List.Content", axes: ["block"] }],
      scrolls: [
        {
          container: "List.Viewport",
          content: "List.Content",
          axis: "block",
          behavior: "free",
          indicators: "automatic",
        },
      ],
      virtualized: [
        {
          collection: "List.records",
          viewport: "List.Viewport",
          axis: "block",
          estimate: { dimension: "length", value: 44 },
          overscan: 8,
          offscreen: "retain-focused",
          measurement: { source: "observed", identity: "keyed", stale: "ignore" },
        },
      ],
      placements: [],
      sticky: [],
      aspects: [],
      padding: [],
      sizes: [],
      participation: [],
      anchors: [],
    });
  });

  test("normalizes insets, logical size constraints, and flow participation", () => {
    const surface = createCandidatePresentationIdentity("Panel.Surface");
    const content = createCandidatePresentationIdentity("Panel.Content");
    const length = (value: number) => ({ dimension: "length" as const, value });
    const scene = normalizeSemanticLayout(
      [surface, content],
      [
        arrangeCandidate(
          surface,
          [content],
          flowCandidate({
            axis: "block",
            gap: length(12),
            align: "stretch",
            distribute: "start",
            wrap: false,
          }),
        ),
        padCandidate(surface, {
          inlineStart: length(20),
          inlineEnd: length(20),
          blockStart: length(16),
          blockEnd: length(24),
        }),
        constrainCandidateSize(surface, {
          inline: { minimum: length(280), ideal: length(420), maximum: { size: "available" } },
          block: { maximum: length(640) },
        }),
        participateCandidate(content, {
          grow: 1,
          shrink: 1,
          basis: { size: "intrinsic" },
        }),
      ],
    );

    expect(scene.padding).toEqual([
      {
        identity: "Panel.Surface",
        insets: {
          inlineStart: length(20),
          inlineEnd: length(20),
          blockStart: length(16),
          blockEnd: length(24),
        },
      },
    ]);
    expect(scene.sizes).toEqual([
      {
        identity: "Panel.Surface",
        inline: { minimum: length(280), ideal: length(420), maximum: { size: "available" } },
        block: { maximum: length(640) },
      },
    ]);
    expect(scene.participation).toEqual([
      {
        identity: "Panel.Content",
        parent: "Panel.Surface",
        flow: { grow: 1, shrink: 1, basis: { size: "intrinsic" } },
      },
    ]);

    expect(() =>
      normalizeSemanticLayout(
        [surface, content],
        [
          constrainCandidateSize(surface, {
            inline: { minimum: length(500), maximum: length(300) },
          }),
        ],
      ),
    ).toThrow('Size constraint for "Panel.Surface" is descending.');
    expect(() =>
      normalizeSemanticLayout(
        [surface, content],
        [participateCandidate(content, { grow: 1, shrink: 1, basis: length(0) })],
      ),
    ).toThrow('Flow participation for "Panel.Content" needs one flow parent.');
  });

  test("normalizes viewport and local anchoring without platform coordinates", () => {
    const dialog = createCandidatePresentationIdentity("Dialog.Surface");
    const close = createCandidatePresentationIdentity("Dialog.Close");
    const length = (value: number) => ({ dimension: "length" as const, value });
    const placement = {
      inline: "stretch" as const,
      block: "end" as const,
      insets: {
        inlineStart: length(12),
        inlineEnd: length(12),
        blockStart: length(0),
        blockEnd: length(16),
      },
    };
    expect(
      normalizeSemanticLayout([dialog], [anchorCandidate(dialog, "viewport", placement)]),
    ).toMatchObject({
      anchors: [{ identity: "Dialog.Surface", anchor: "viewport", placement }],
    });
    const localPlacement = {
      ...placement,
      inline: "end" as const,
      block: "start" as const,
    };
    expect(
      normalizeSemanticLayout([dialog, close], [anchorCandidate(close, dialog, localPlacement)]),
    ).toMatchObject({
      parents: { "Dialog.Close": "Dialog.Surface" },
      anchors: [{ identity: "Dialog.Close", anchor: "Dialog.Surface", placement: localPlacement }],
    });
    expect(() =>
      normalizeSemanticLayout(
        [dialog],
        [
          anchorCandidate(dialog, "viewport", placement),
          anchorCandidate(dialog, "viewport", placement),
        ],
      ),
    ).toThrow('Target "Dialog.Surface:anchor" is owned by both');
    expect(() =>
      normalizeSemanticLayout([dialog], [anchorCandidate(dialog, dialog, placement)]),
    ).toThrow("cannot anchor to itself");
  });

  test("rejects ambiguous layout ownership and hierarchy cycles", () => {
    const page = createCandidatePresentationIdentity("Layout.Page");
    const first = createCandidatePresentationIdentity("Layout.First");
    const second = createCandidatePresentationIdentity("Layout.Second");
    const missing = createCandidatePresentationIdentity("Layout.Missing");
    const flow = flowCandidate({
      axis: "block",
      gap: { dimension: "length", value: 8 },
      align: "stretch",
      distribute: "start",
      wrap: false,
    });

    expect(() =>
      normalizeSemanticLayout(
        [page, first, second],
        [arrangeCandidate(page, [first], flow), arrangeCandidate(page, [second], flow)],
      ),
    ).toThrow(
      'Target "Layout.Page:arrangementOwner" is owned by both "arrange[0]" and "arrange[1]".',
    );
    expect(() =>
      normalizeSemanticLayout(
        [page, first, second],
        [arrangeCandidate(page, [second], flow), arrangeCandidate(first, [second], flow)],
      ),
    ).toThrow(
      'Target "Layout.Second:layoutParent" is owned by both "arrange[0]" and "arrange[1]".',
    );
    expect(() =>
      normalizeSemanticLayout(
        [page, first],
        [arrangeCandidate(page, [first], flow), arrangeCandidate(first, [page], flow)],
      ),
    ).toThrow("Composition cycle: Layout.First -> Layout.Page");
    expect(() =>
      normalizeSemanticLayout([page], [arrangeCandidate(page, [missing], flow)]),
    ).toThrow('Unknown layout child identity "Layout.Missing".');
  });

  test("normalizes grid placement, sticky attachment, and aspect constraints", () => {
    const viewport = createCandidatePresentationIdentity("Gallery.Viewport");
    const content = createCandidatePresentationIdentity("Gallery.Content");
    const grid = createCandidatePresentationIdentity("Gallery.Grid");
    const header = createCandidatePresentationIdentity("Gallery.Header");
    const card = createCandidatePresentationIdentity("Gallery.Card");
    const scene = normalizeSemanticLayout(
      [viewport, content, grid, header, card],
      [
        scrollCandidate(viewport, content, {
          axis: "block",
          behavior: "free",
          indicators: "automatic",
        }),
        arrangeCandidate(
          content,
          [header, grid],
          flowCandidate({
            axis: "block",
            gap: { dimension: "length", value: 12 },
            align: "stretch",
            distribute: "start",
            wrap: false,
          }),
        ),
        arrangeCandidate(
          grid,
          [card],
          gridCandidate({
            columns: [
              { size: "fraction", value: 1 },
              { size: "fraction", value: 1 },
            ],
            rows: [{ size: "intrinsic" }],
            gap: { dimension: "length", value: 16 },
          }),
        ),
        placeCandidate(card, {
          column: { start: 1, span: 2 },
          row: { start: 1 },
        }),
        stickCandidate(header, viewport, {
          edge: "blockStart",
          inset: { dimension: "length", value: 0 },
        }),
        constrainCandidateAspect(card, 4 / 3),
      ],
    );

    expect(scene.placements).toEqual([
      {
        child: "Gallery.Card",
        parent: "Gallery.Grid",
        column: { start: 1, span: 2 },
        row: { start: 1, span: 1 },
      },
    ]);
    expect(scene.sticky).toEqual([
      {
        identity: "Gallery.Header",
        container: "Gallery.Viewport",
        edge: "blockStart",
        inset: { dimension: "length", value: 0 },
      },
    ]);
    expect(scene.aspects).toEqual([{ identity: "Gallery.Card", ratio: 4 / 3 }]);
    expect(() =>
      normalizeSemanticLayout(
        [grid, card],
        [
          arrangeCandidate(
            grid,
            [card],
            gridCandidate({
              columns: [{ size: "fraction", value: 1 }],
              rows: [],
              gap: { dimension: "length", value: 0 },
            }),
          ),
          placeCandidate(card, { column: { start: 2 }, row: { start: 1 } }),
        ],
      ),
    ).toThrow("exceeds declared tracks");
  });

  test("preserves child identity while its layout parent changes between scenes", () => {
    const grid = createCandidatePresentationIdentity("Swap.Grid");
    const detail = createCandidatePresentationIdentity("Swap.Detail");
    const card = createCandidatePresentationIdentity("Swap.Card");
    const overlay = overlayCandidate({ align: "stretch" });
    const first = normalizeSemanticLayout(
      [grid, detail, card],
      [arrangeCandidate(grid, [card], overlay)],
    );
    const second = normalizeSemanticLayout(
      [grid, detail, card],
      [arrangeCandidate(detail, [card], overlay)],
    );
    expect(first.parents).toEqual({ "Swap.Card": "Swap.Grid" });
    expect(second.parents).toEqual({ "Swap.Card": "Swap.Detail" });
  });

  test("rejects invalid grids, intrinsic relations, and virtualization parameters", () => {
    const page = createCandidatePresentationIdentity("Layout.Page");
    const content = createCandidatePresentationIdentity("Layout.Content");
    const records = createCandidateCollectionHandle<string>("Layout.records");

    expect(() =>
      normalizeSemanticLayout(
        [page, content],
        [
          arrangeCandidate(
            page,
            [content],
            gridCandidate({
              columns: [],
              rows: [],
              gap: { dimension: "length", value: 0 },
            }),
          ),
        ],
      ),
    ).toThrow('Grid arrangement for "Layout.Page" has no columns.');
    expect(() =>
      normalizeSemanticLayout(
        [page, content],
        [intrinsicCandidate(page, content, ["block", "block"])],
      ),
    ).toThrow('Intrinsic relation for "Layout.Page" needs unique axes.');
    expect(() =>
      normalizeSemanticLayout(
        [page],
        [
          virtualizeCandidate(records, page, {
            axis: "block",
            estimate: { dimension: "length", value: 0 },
            overscan: 1.5,
            offscreen: "remove",
          }),
        ],
      ),
    ).toThrow("virtual estimate must be a finite positive length.");
  });

  test("supports two-axis virtualization and requires compatible scroll ownership", () => {
    const viewport = createCandidatePresentationIdentity("Grid.Viewport");
    const content = createCandidatePresentationIdentity("Grid.Content");
    const rows = createCandidateCollectionHandle<string>("Grid.rows");
    const columns = createCandidateCollectionHandle<string>("Grid.columns");
    const virtualRows = virtualizeCandidate(rows, viewport, {
      axis: "block",
      estimate: { dimension: "length", value: 36 },
      overscan: 8,
      offscreen: "retain-focused",
    });
    const virtualColumns = virtualizeCandidate(columns, viewport, {
      axis: "inline",
      estimate: { dimension: "length", value: 120 },
      overscan: 3,
      offscreen: "retain-focused",
    });

    expect(
      normalizeSemanticLayout(
        [viewport, content],
        [
          scrollCandidate(viewport, content, {
            axis: "both",
            behavior: "free",
            indicators: "automatic",
          }),
          virtualRows,
          virtualColumns,
        ],
      ).virtualized,
    ).toEqual([
      {
        collection: "Grid.columns",
        viewport: "Grid.Viewport",
        axis: "inline",
        estimate: { dimension: "length", value: 120 },
        overscan: 3,
        offscreen: "retain-focused",
        measurement: { source: "observed", identity: "keyed", stale: "ignore" },
      },
      {
        collection: "Grid.rows",
        viewport: "Grid.Viewport",
        axis: "block",
        estimate: { dimension: "length", value: 36 },
        overscan: 8,
        offscreen: "retain-focused",
        measurement: { source: "observed", identity: "keyed", stale: "ignore" },
      },
    ]);
    expect(() => normalizeSemanticLayout([viewport], [virtualRows])).toThrow(
      'Virtual block extent for "Grid.rows" needs a compatible scroll relation on "Grid.Viewport".',
    );
  });
});
