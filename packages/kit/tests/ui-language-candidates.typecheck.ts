import {
  type CandidateCommand,
  type CandidateExpression,
  type CandidateGeometry,
  type CandidateRecognizerDefinitions,
  type CandidateKeyedCollection,
  type CandidateIntegratedAppDefinition,
  type CandidateLength,
  type CandidateParameter,
  type CandidatePaint,
  type CandidateSlot,
  type CandidateStructureDefinition,
  type CandidateStructureProps,
  type CandidateToken,
  type CandidateTransitionPolicy,
  type OperationalPreset,
  type SemanticOperationPreset,
  type SemanticOperationScope,
  aboveCandidate,
  addCandidate,
  andCandidate,
  arrangeCandidate,
  clampCandidate,
  createCandidateCollectionHandle,
  createCandidateRecognizerHandle,
  createCandidateLayer,
  createCandidateReadExpression,
  createCandidateRecipe,
  createCandidateTransitionPolicy,
  driveCandidate,
  flowCandidate,
  hitTestCandidate,
  issueCandidateAction,
  issueCandidateStructurePart,
  nativeLayerCandidate,
  normalizeCandidate,
  normalizeCandidateTransitionCompatibility,
  retainCandidate,
  setCandidateTarget,
  settleCandidate,
  setCandidateParameter,
  transitionCandidateTarget,
} from "./ui-language-candidates";

type ComparisonApp = {
  Components: {
    Action: {
      Input: { label: string };
      Context: { pending: boolean };
      Values: { count: number };
      Actions: { press(): void };
      States: "idle" | "pending" | "disabled";
      Recognizers: {
        press: { Kind: "drag"; Outcomes: "rest" | "pressed" };
      };
      Parameters: {
        pressScale: CandidateParameter<number>;
        gestureProjectionTime: CandidateParameter<number>;
        gestureResistance: CandidateParameter<number>;
      };
      Collections: {
        labels: CandidateKeyedCollection<
          { readonly id: string; readonly label: string },
          "id",
          "Label",
          "option"
        >;
      };
      Parts: { Root: "button"; Label: "span" };
    };
  };
  Styles: {
    Presets: {
      family: {
        Themes: "dim";
        Tokens: {
          opacity: { disabled: CandidateToken<number> };
          color: { canvas: CandidateToken<CandidatePaint> };
        };
      };
      studio: {
        Tokens: { color: { terminal: CandidateToken<CandidatePaint> } };
      };
    };
  };
};

declare const presentationScope: SemanticOperationScope<ComparisonApp, "Action">;
// @ts-expect-error Interaction is part-local; no component-wide bag exists.
void presentationScope.interaction;
// @ts-expect-error Semantic disabled state is not a raw interaction fact.
void presentationScope.parts.Root.interaction.disabled;
void presentationScope.recognizers.press.translation.block;
void presentationScope.recognizers.press.velocity.block;
// @ts-expect-error A drag exposes translation, not an arbitrary generic value.
void presentationScope.recognizers.press.value;
// @ts-expect-error A drag does not expose pinch scale.
void presentationScope.recognizers.press.scale;

const recognizerDefinitions: CandidateRecognizerDefinitions<ComparisonApp, "Action"> = {
  press: {
    region: "Root",
    activation: { axis: "block", threshold: { dimension: "length", value: 2 } },
    outcomes: {
      rest: { action: "press" },
      pressed: { action: "press" },
    },
    alternative: { kind: "action", action: "press" },
  },
};

const autoScrollRecognizerDefinitions: CandidateRecognizerDefinitions<ComparisonApp, "Action"> = {
  press: {
    ...recognizerDefinitions.press,
    autoScroll: {
      owner: "Root",
      edgeFraction: "gestureResistance",
      maximumViewportPerSecond: "gestureProjectionTime",
    },
  },
};
const invalidAutoScrollParameter: CandidateRecognizerDefinitions<ComparisonApp, "Action"> = {
  press: {
    ...recognizerDefinitions.press,
    autoScroll: {
      owner: "Root",
      // @ts-expect-error Auto-scroll coefficients must name generic-declared numeric parameters.
      edgeFraction: "missing",
      maximumViewportPerSecond: "gestureProjectionTime",
    },
  },
};

const invalidGestureIntents: CandidateRecognizerDefinitions<ComparisonApp, "Action"> = {
  press: {
    region: "Root",
    activation: { axis: "block", threshold: { dimension: "length", value: 2 } },
    // @ts-expect-error Every generic-declared gesture outcome needs an action mapping.
    outcomes: { rest: { action: "press" } },
    alternative: { kind: "action", action: "press" },
  },
};

void recognizerDefinitions;
void autoScrollRecognizerDefinitions;
void invalidAutoScrollParameter;
void invalidGestureIntents;

type MissingCollectionKey = CandidateKeyedCollection<
  { readonly id: string },
  // @ts-expect-error A keyed collection key must name a declared scalar item field.
  "missing",
  "Label",
  "option"
>;
type NonScalarCollectionKey = CandidateKeyedCollection<
  { readonly id: { readonly nested: string } },
  // @ts-expect-error Object-valued fields cannot become semantic collection identities.
  "id",
  "Label",
  "option"
>;

void (0 as unknown as MissingCollectionKey);
void (0 as unknown as NonScalarCollectionKey);

const structure: CandidateStructureDefinition<ComparisonApp> = {
  components: {
    Action({ input, context, values, actions, parts, state, collections, select }) {
      void context.pending;
      void values.count;
      const options = collections.labels.render(
        [{ id: "result", label: "Result" }],
        (item, _index, Label) => {
          Label({
            name: item.label,
            // @ts-expect-error Collection identity is supplied by the keyed contract.
            key: item.id,
          });
          return Label({ name: item.label });
        },
      );
      const option = options[0]!;
      const disabledReason = parts.Label({ key: "disabled-reason", name: "Unavailable" });
      // @ts-expect-error Structural choice conditions are typed booleans from the shared expression algebra.
      select<"list" | "detail">(createCandidateReadExpression<"list" | "detail">("Action.view"), {
        list: { content: disabledReason },
      });
      const activeOption = collections.labels.reference(
        createCandidateReadExpression<string | undefined>("Action.activeLabel"),
      );
      const listbox = parts.Label(
        { role: "listbox", key: "results", name: "Results", activeDescendant: activeOption },
        option,
      );
      parts.Label({
        role: "grid",
        key: "grid",
        name: "Grid",
        // @ts-expect-error A grid active descendant must be a row or gridcell reference.
        activeDescendant: option.reference,
      });
      // @ts-expect-error Structure receives only actions declared by the application generic.
      void actions.open;
      // @ts-expect-error Structure parts are semantic constructors, not presentation targets.
      void parts.Root.fill;
      collections.labels.render(
        [{ id: "wrong", label: "Wrong part" }],
        // @ts-expect-error A collection callback must render its declared compiler-issued item part.
        () => parts.Root({ name: "Wrong", activate: actions.press }),
      );
      return parts.Root(
        {
          name: input.label,
          activate: actions.press,
          disabled: state.matches("disabled"),
        },
        parts.Label({}, input.label),
        listbox,
        select<boolean>(state.matches("disabled"), {
          true: { content: disabledReason },
          false: { content: null },
        }),
      );
    },
  },
};

void structure;

const adjustable = issueCandidateStructurePart("Mixer", "Volume", "input");
adjustable({
  role: "slider",
  name: "Volume",
  value: 0.5,
  minimum: 0,
  maximum: 1,
  step: 0.05,
  largeStep: 0.25,
  change: issueCandidateAction<(value: number) => void>("Mixer.changeVolume"),
});
// @ts-expect-error An adjustable semantic part needs its complete typed range.
const incompleteAdjustable: CandidateStructureProps<"slider"> = {
  name: "Incomplete volume",
  value: 0.5,
  minimum: 0,
  maximum: 1,
  largeStep: 0.25,
  change: issueCandidateAction<(value: number) => void>("Mixer.changeIncompleteVolume"),
};
const invalidAdjustable: CandidateStructureProps<"slider"> = {
  name: "Invalid volume",
  value: 0.5,
  // @ts-expect-error Adjustable range values remain numeric through the structure contract.
  minimum: "zero",
  maximum: 1,
  step: 0.05,
  largeStep: 0.25,
  change: issueCandidateAction<(value: number) => void>("Mixer.changeInvalidVolume"),
};
void incompleteAdjustable;
void invalidAdjustable;

const link = issueCandidateStructurePart("Navigation", "Help", "a");
link({
  name: "Help",
  destination: "/help",
  activate: issueCandidateAction("Navigation.openHelp"),
});
// @ts-expect-error Native link meaning requires a destination even when activation is handled.
const incompleteLink: CandidateStructureProps<"link"> = {
  name: "Incomplete help",
  activate: issueCandidateAction("Navigation.openIncompleteHelp"),
};
const invalidLink: CandidateStructureProps<"link"> = {
  name: "Invalid help",
  // @ts-expect-error Link destinations are typed strings or string expressions.
  destination: 42,
};
void incompleteLink;
void invalidLink;

const image = issueCandidateStructurePart("Profile", "Avatar", "img");
image({ source: "/avatar.webp", alternative: "Profile portrait" });
image({ source: "/texture.webp", alternative: { kind: "decorative" } });
// @ts-expect-error An image requires both a source and an explicit alternative policy.
const incompleteImage: CandidateStructureProps<"image"> = {
  source: "/avatar.webp",
};
const invalidImage: CandidateStructureProps<"image"> = {
  source: "/avatar.webp",
  // @ts-expect-error Decorative intent is tagged rather than encoded as magic alternative text.
  alternative: { kind: "none" },
};
const invalidImageName: CandidateStructureProps<"image"> = {
  source: "/avatar.webp",
  alternative: "Profile portrait",
  // @ts-expect-error Image naming has one owner: the alternative field.
  name: "Duplicate portrait name",
};
const invalidButtonMedia: CandidateStructureProps<"button"> = {
  name: "Profile",
  activate: issueCandidateAction("Profile.open"),
  // @ts-expect-error Non-media structure cannot own an image source.
  source: "/avatar.webp",
};
void incompleteImage;
void invalidImage;
void invalidImageName;
void invalidButtonMedia;

type CompositionApp = {
  Components: {
    Item: {
      Input: { readonly label: string };
      Parts: { Root: "article" };
    };
    List: {
      Slots: {
        header: CandidateSlot<"Item", "optional">;
        items: CandidateSlot<"Item", "many">;
      };
      Parts: { Root: "section"; Header: "div"; Items: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

const composition: CandidateStructureDefinition<CompositionApp> = {
  components: {
    Item({ input, parts }) {
      return parts.Root({ name: input.label }, input.label);
    },
    List({ components, parts, slots }) {
      const extra = components.Item({ label: "Extra" });
      // @ts-expect-error A composed child exposes no private parts, state, or actions.
      void extra.parts;
      // @ts-expect-error Component input comes exactly from the explicit application generic.
      components.Item({ label: "Extra", tone: "muted" });
      // @ts-expect-error A required many slot cannot be omitted.
      components.List({});
      const nestedList = components.List({ items: [extra] });
      components.List({
        // @ts-expect-error The items slot accepts only Item component instances.
        items: [nestedList],
      });
      return parts.Root(
        {},
        slots.header,
        parts.Header({}, slots.header),
        parts.Items({}, slots.items),
      );
    },
  },
};

void composition;

type BehaviorApp = {
  Resources: {
    documents: {
      Key: string;
      Views: { title: string };
      Commands: { save(title: string): Promise<void> };
    };
  };
  Navigation: {
    home: {};
    detail: { id: string };
  };
  Components: {
    Editor: {
      Input: { id: string };
      Context: { draft: string };
      Values: { title: string; dirty: boolean };
      States: "idle" | "saving" | "error";
      Actions: { change(value: string): void; save(): void; open(): void };
      Commands: { navigate: CandidateCommand<{ id: string }> };
      Tasks: {
        save: { Input: { id: string; title: string }; Output: void; Error: Error };
      };
      Parts: { Root: "article"; Save: "button" };
    };
  };
  Styles: { Presets: "plain" };
};

const integrated: CandidateIntegratedAppDefinition<BehaviorApp> = {
  components: {
    Editor: {
      context: { draft: "" },
      initial: "idle",
      states: {
        idle: {
          on: {
            change: {
              update: ({ context }, value) => ({ draft: value || context.draft }),
            },
            save: "saving",
            // @ts-expect-error Every command request must return its generic-declared payload.
            open: {
              commands: [
                {
                  run: "navigate",
                  input: ({ input }) => ({ id: input.id }),
                },
                {
                  run: "navigate",
                  input: () => ({ slug: "wrong" }),
                },
              ],
            },
          },
        },
        saving: {
          task: {
            run: "save",
            input: ({ input, context }) => ({ id: input.id, title: context.draft }),
            done: "idle",
            fail: "error",
          },
        },
        error: { on: { save: "saving" } },
      },
      commands: {
        navigate(scope, value) {
          // @ts-expect-error Fire-and-forget commands have no state-scoped cancellation signal.
          void scope.signal;
          // @ts-expect-error Commands cannot change preset appearance.
          void scope.appearance;
          const { navigation } = scope;
          navigation.detail(value);
        },
      },
      tasks: {
        async save({ resources, value, signal }) {
          if (signal.aborted) throw new Error("cancelled");
          await resources.documents(value.id).save(value.title);
        },
      },
      derive(scope) {
        const document = scope.resources.documents(scope.input.id);
        // @ts-expect-error Pure derivation receives resource views, never mutation commands.
        document.save(scope.context.draft);
        // @ts-expect-error Pure derivation cannot navigate.
        void scope.navigation;
        return {
          title: scope.context.draft || document.title,
          dirty: scope.context.draft !== document.title,
        };
      },
      structure(scope) {
        // @ts-expect-error Structure receives derived values rather than resource capabilities.
        void scope.resources;
        // @ts-expect-error Structure binds actions but cannot navigate directly.
        void scope.navigation;
        return scope.parts.Root(
          {},
          scope.values.title,
          scope.parts.Save({
            name: "Save",
            activate: scope.actions.save,
            disabled: scope.state.matches("saving"),
          }),
        );
      },
    },
  },
};

void integrated;

type CompletionApp = {
  Components: {
    Flow: {
      States: "editing" | "done";
      Actions: { finish(): void };
      Output: { saved: boolean };
      Parts: { Root: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

const completion: CandidateIntegratedAppDefinition<CompletionApp> = {
  components: {
    Flow: {
      initial: "editing",
      states: {
        editing: {
          always: {
            allow: ({ context }) => Object.keys(context).length === 0,
            target: "editing",
          },
          on: {
            finish: [
              { allow: ({ state }) => state.matches("editing"), target: "done" },
              { target: "editing" },
            ],
          },
        },
        done: { type: "final", output: () => ({ saved: true }) },
      },
      structure() {
        throw new Error("type fixture");
      },
    },
  },
};

const invalidCompletion: CandidateIntegratedAppDefinition<CompletionApp> = {
  components: {
    Flow: {
      initial: "editing",
      states: {
        editing: {},
        done: {
          type: "final",
          // @ts-expect-error Final output is fixed by the explicit application generic.
          output: () => ({ saved: "yes" }),
        },
      },
      structure() {
        throw new Error("type fixture");
      },
    },
  },
};

void completion;
void invalidCompletion;

const clampedLength = clampCandidate(
  { dimension: "length", value: 10 } as const,
  { dimension: "length", value: 0 } as const,
  { dimension: "length", value: 20 } as const,
);

clampCandidate(
  { dimension: "length", value: 10 } as const,
  // @ts-expect-error Clamp bounds must preserve the value's physical dimension.
  { dimension: "time", value: 0 } as const,
  { dimension: "length", value: 20 } as const,
);

void clampedLength;

const valid: OperationalPreset<ComparisonApp, "family"> = {
  name: "family",
  components: {
    Action: {
      Root: [{ kind: "target", property: "opacity", value: 1 }],
    },
  },
};

// @ts-expect-error The explicit application generic owns the preset vocabulary.
const unknownPreset: OperationalPreset<ComparisonApp, "other"> = valid;

const unknownComponent: OperationalPreset<ComparisonApp, "family"> = {
  name: "family",
  components: {
    // @ts-expect-error The explicit application generic owns component names.
    Drawer: {},
  },
};

const unknownPart: OperationalPreset<ComparisonApp, "family"> = {
  name: "family",
  components: {
    Action: {
      // @ts-expect-error The explicit application generic owns presentable part names.
      Surface: [],
    },
  },
};

const unknownTarget: OperationalPreset<ComparisonApp, "family"> = {
  name: "family",
  components: {
    Action: {
      Root: [
        {
          kind: "target",
          // @ts-expect-error Backend property strings are not part of the semantic target algebra.
          property: "fontWeight",
          value: 700,
        },
      ],
    },
  },
};

void unknownPreset;
void unknownComponent;
void unknownPart;
void unknownTarget;

declare const opacitySpring: CandidateTransitionPolicy<number>;

const semanticOperations: SemanticOperationPreset<ComparisonApp, "family"> = ({ tokens }) => {
  void tokens.opacity.disabled;
  void tokens.color.canvas;
  // @ts-expect-error A preset receives only the tokens in its own generic contract.
  void tokens.color.terminal;
  return {
    theme: {
      opacity: { disabled: 0.46 },
      color: {
        canvas: {
          kind: "solid",
          color: {
            colorSpace: "oklch",
            lightness: 0.98,
            chroma: 0.01,
            hue: 250,
            alpha: 1,
          },
        },
      },
    },
    themes: { dim: { opacity: { disabled: 0.58 } } },
    components: {
      Action({
        parts,
        state,
        input,
        context,
        values,
        geometry,
        environment,
        recognizers,
        parameters,
      }) {
        const opacity = state.matches("disabled").choose(tokens.opacity.disabled, 1);
        void input.label;
        void context.pending;
        void values.count;
        void geometry.Root.inlineSize;
        void environment.safeArea.blockEnd;
        void parts.Root.interaction.focusVisible;
        void parts.Root.foreground;
        // @ts-expect-error Non-focusable semantic parts receive no focus capability.
        void parts.Label.focus;
        // @ts-expect-error Non-focusable semantic parts receive no focus-visible interaction.
        void parts.Label.interaction.focusVisible;
        const pressScale = parts.Root.interaction.pressed.choose(0.96, 1);
        const pressProgress = normalizeCandidate(
          recognizers.press.translation.block,
          [
            { dimension: "length", value: 0 },
            { dimension: "length", value: 44 },
          ],
          { clamp: true },
        );
        // @ts-expect-error State vocabulary comes from the explicit application generic.
        state.matches("open");
        // @ts-expect-error Presentation scope deliberately has no application actions.
        void state.actions;
        return [
          setCandidateTarget(parts.Root.opacity, opacity),
          setCandidateTarget(parts.Root.fill, tokens.color.canvas),
          transitionCandidateTarget(parts.Root.opacity, opacitySpring),
          retainCandidate(parts.Root, [parts.Root.opacity]),
          setCandidateTarget(parts.Label.opacity, environment.compact.choose(0, 1)),
          setCandidateParameter(parameters.pressScale, pressScale),
          driveCandidate(parts.Root.opacity, recognizers.press, pressProgress),
          settleCandidate(parts.Root.opacity, recognizers.press, {
            destinations: { rest: 1, pressed: 0.8 },
            policy: opacitySpring,
            preserve: "velocity",
            projectionTime: parameters.gestureProjectionTime,
            resistance: parameters.gestureResistance,
          }),
        ];
      },
    },
  };
};

declare const actionScope: Parameters<
  ReturnType<typeof semanticOperations>["components"]["Action"]
>[0];
declare const lengthExpression: CandidateExpression<CandidateLength>;
// @ts-expect-error Normalization range must match the source dimension.
normalizeCandidate(lengthExpression, [lengthExpression, { dimension: "angle", value: 1 }], {
  clamp: true,
});
const transform = {
  translation: {
    inline: { dimension: "length", value: 0 },
    block: { dimension: "length", value: 0 },
    depth: { dimension: "length", value: 0 },
  },
  scale: { inline: 1, block: 1, depth: 1 },
  rotation: { axis: { x: 0, y: 0, z: 1 }, angle: { dimension: "angle", value: 30 } },
  origin: { inline: 0.5, block: 0.5, depth: { dimension: "length", value: 0 } },
  perspective: "none",
} as const;
const invalidGradientAngle: CandidatePaint = {
  kind: "linear-gradient",
  // @ts-expect-error Gradient angles are typed measures, not unitless numbers.
  angle: 30,
  stops: [
    {
      position: 0,
      color: { colorSpace: "oklch", lightness: 0, chroma: 0, hue: 0, alpha: 1 },
    },
    {
      position: 1,
      color: { colorSpace: "oklch", lightness: 1, chroma: 0, hue: 0, alpha: 1 },
    },
  ],
};
void invalidGradientAngle;
normalizeCandidateTransitionCompatibility([
  {
    target: "surface:opacity",
    // @ts-expect-error Layout geometry has retained projection semantics, not value interpolation.
    valueType: "geometry",
    from: {},
    to: {},
  },
]);
setCandidateTarget(actionScope.parts.Root.transform, transform);
setCandidateTarget(actionScope.parts.Root.transform, {
  ...transform,
  // @ts-expect-error Rotation is one axis-angle value, not order-dependent Euler channels.
  rotation: { inline: 0, block: 0, depth: 30 },
});
const decorativeLayer = createCandidateLayer(actionScope.parts.Root, "decorative");
// @ts-expect-error Generated drawing layers cannot acquire typography semantics.
void decorativeLayer.type;
// @ts-expect-error Generated drawing layers cannot acquire media semantics.
void decorativeLayer.mediaFit;

// @ts-expect-error Preset parameters retain the value type declared by the app contract.
setCandidateParameter(actionScope.parameters.pressScale, "slow");

addCandidate(lengthExpression, { dimension: "length", value: 8 });
// @ts-expect-error Length arithmetic cannot accept an untyped scalar.
addCandidate(lengthExpression, 8);
// @ts-expect-error Measures with different dimensions cannot be combined.
addCandidate(lengthExpression, { dimension: "time", value: 8 });
// @ts-expect-error Boolean composition cannot accept a numeric expression.
andCandidate(actionScope.state.matches("idle"), actionScope.parts.Root.presence.phase);

const createActionAppearance = createCandidateRecipe(
  (part: typeof actionScope.parts.Root, tone: "normal" | "muted") =>
    [setCandidateTarget(part.opacity, tone === "muted" ? 0.6 : 1)] as const,
);
createActionAppearance(actionScope.parts.Root, "normal");
// @ts-expect-error Recipe variants are ordinary typed arguments, not an open string DSL.
createActionAppearance(actionScope.parts.Root, "danger");

createCandidateTransitionPolicy("invalid-sequence", {
  // @ts-expect-error Meaningful stages belong to statecharts; presentation has no timeline policy.
  normal: { kind: "sequence", stages: [] },
  reduced: { kind: "instant" },
});

// @ts-expect-error A length cannot be assigned to an opacity target.
setCandidateTarget(actionScope.parts.Root.opacity, { dimension: "length", value: 10 });

setCandidateTarget(
  actionScope.parts.Root.fill,
  // @ts-expect-error Colors use the single typed OKLCH representation, not raw strings.
  "red",
);

setCandidateTarget(
  // @ts-expect-error Every reactive branch must preserve the target value type.
  actionScope.parts.Root.opacity,
  actionScope.state.matches("idle").choose(1, "no"),
);

declare const lengthPolicy: CandidateTransitionPolicy<{
  readonly dimension: "length";
  readonly value: number;
}>;
declare const layoutPolicy: CandidateTransitionPolicy<CandidateGeometry>;

// @ts-expect-error A length policy cannot animate an opacity target.
transitionCandidateTarget(actionScope.parts.Root.opacity, lengthPolicy);
transitionCandidateTarget(actionScope.parts.Root.geometry, layoutPolicy);

setCandidateTarget(
  // @ts-expect-error Layout owns resolved geometry; presentation may only associate a policy.
  actionScope.parts.Root.geometry,
  {
    inline: { dimension: "length", value: 0 },
    block: { dimension: "length", value: 0 },
    inlineSize: { dimension: "length", value: 100 },
    blockSize: { dimension: "length", value: 100 },
  },
);

aboveCandidate(actionScope.parts.Root, actionScope.parts.Label);
hitTestCandidate(
  actionScope.parts.Root,
  actionScope.state.matches("disabled").choose("none" as const, "auto" as const),
);

// @ts-expect-error A button cannot acquire a structure-owned native top-layer capability.
nativeLayerCandidate(actionScope.parts.Root, actionScope.parts.Root.nativeLayer);

// @ts-expect-error Composition uses typed identities rather than selector or part-name strings.
aboveCandidate("Action.Root", actionScope.parts.Label);

arrangeCandidate(
  actionScope.parts.Root,
  [actionScope.parts.Label],
  flowCandidate({
    axis: "inline",
    gap: { dimension: "length", value: 8 },
    align: "center",
    distribute: "between",
    wrap: false,
  }),
);

flowCandidate({
  axis: "inline",
  // @ts-expect-error Semantic lengths are typed values, not backend CSS strings.
  gap: "8px",
  align: "center",
  distribute: "start",
  wrap: false,
});

flowCandidate({
  axis: "inline",
  // @ts-expect-error Unitless numbers cannot silently become lengths.
  gap: 8,
  align: "center",
  distribute: "start",
  wrap: false,
});

createCandidateCollectionHandle<string>("Action.records");

// @ts-expect-error Collection identities are constrained to stable scalar keys.
createCandidateCollectionHandle<{ readonly id: string }>("Action.records");

// @ts-expect-error A presentation identity is not a scalar visual target.
setCandidateTarget(actionScope.parts.Root.identity, 1);

driveCandidate(
  actionScope.parts.Root.opacity,
  actionScope.recognizers.press,
  // @ts-expect-error A recognizer projection must match its target value type.
  actionScope.recognizers.press.translation.block,
);

settleCandidate(actionScope.parts.Root.opacity, actionScope.recognizers.press, {
  // @ts-expect-error Every behavior-declared gesture outcome needs a destination.
  destinations: { rest: 1 },
  policy: opacitySpring,
  preserve: "velocity",
  projectionTime: actionScope.parameters.gestureProjectionTime,
  resistance: actionScope.parameters.gestureResistance,
});

const longPress = createCandidateRecognizerHandle<
  "longPress",
  "recognized" | "released" | "cancelled"
>("Action.longPress", "longPress");
void longPress.progress;
// @ts-expect-error A discrete long-press recognizer cannot own a continuous visual target.
driveCandidate(actionScope.parts.Root.opacity, longPress, longPress.progress);

void semanticOperations;
