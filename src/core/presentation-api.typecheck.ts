import {
  animate,
  settled,
  velocity,
  type ActionCompleted,
  type Animation,
  type Event,
  type Presentation,
} from "./presentation";

type Child = {
  State: { visible: boolean };
  Actions: { reveal(input: { source: "keyboard" | "pointer" }): void };
  Components: {
    Badge: {
      Props: { label: string };
      Elements: { Root: "surface"; Label: "text" };
    };
  };
};

type Root = {
  State: {
    open: boolean;
    dragOffset: number;
    dragVelocity: number;
    particles: readonly Readonly<{
      id: string;
      position: readonly [number, number, number];
      opacity: number;
    }>[];
  };
  Actions: {
    save(input: { documentId: string }): Promise<{ revision: number }>;
    dismiss(input: { source: "button" | "drag" | "escape" }): void;
  };
  Features: { child: Child };
  Components: {
    Sheet: {
      Props: { documentId: string };
      State: { dragging: boolean };
      Actions: { press(input: { pointerId: number }): void };
      Elements: { Root: "surface"; Label: "text"; Scene: "scene" };
    };
  };
};

type Point = readonly [number, number, number];

type Language = {
  Declarations: {
    surface: Readonly<{
      opacity?: number;
      translateBlock?: number;
      scale?: number;
      sound?: Readonly<{ asset: string; when: Event<unknown> }>;
      continuity?: string;
    }>;
    text: Readonly<{ color?: string; blur?: number }>;
    scene: Readonly<{
      entities?: readonly Readonly<{
        key: string;
        position: Point;
        opacity: number;
      }>[];
    }>;
  };
  Environment: Readonly<{ reducedMotion: boolean; viewportBlockSize: number }>;
  Observations: {
    surface: Readonly<{
      present: boolean;
      box: Readonly<{ inlineSize: number; blockSize: number }>;
      pointerVelocity: number;
    }>;
    text: Readonly<{ lines: number }>;
    scene: Readonly<{ scale: number }>;
  };
};

type SaveCompleted = ActionCompleted<Root["Actions"]["save"]>;

type PresentationParameters = Readonly<{
  foreground: string;
  click: string;
  sheet: Animation<number, number, number>;
  confirmation: Animation<Event<SaveCompleted>, number, number>;
  particles: Animation<Root["State"]["particles"], Root["State"]["particles"]>;
}>;

declare function follow(velocity: number): Animation<number, number, number>;

const presentation = (({ parameters, environment, events }) => {
  const confirmation = animate(events.save.completed, parameters.confirmation);

  return {
    Sheet({ props, state, events, elements }) {
      const openness = animate(
        state.dragging
          ? 1 - state.dragOffset / Math.max(elements.Root.box.blockSize, 1)
          : state.open
            ? 1
            : 0,
        state.dragging ? follow(state.dragVelocity) : parameters.sheet,
      );
      const particles = animate(state.particles, parameters.particles);
      const currentVelocity = velocity(openness);
      const isSettled = settled(openness);

      void environment.reducedMotion;
      void events.dismiss;
      void events.press;
      void elements.Label.lines;
      void elements.Scene.scale;
      void isSettled;

      // @ts-expect-error Animated outputs are ordinary values, not sampled wrappers.
      void openness.value;
      // @ts-expect-error Presentation receives observations, never native handles.
      void elements.Root.ownerDocument;
      // @ts-expect-error A Component cannot observe undeclared Elements.
      void elements.Backdrop;

      return {
        Root: {
          continuity: props.documentId,
          opacity: confirmation > 0 ? 1 : openness,
          scale: 0.98 + openness * 0.02,
          sound: { asset: parameters.click, when: events.press },
          translateBlock: elements.Root.box.blockSize * (1 - openness),
        },
        Label: {
          blur: Math.abs(currentVelocity) / 1_000,
          color: parameters.foreground,
        },
        Scene: {
          entities: particles.map(({ id, opacity, position }) => ({
            key: id,
            opacity,
            position,
          })),
        },
      };
    },
    Child: ({ state, events }) => {
      const visible = animate(state.visible ? 1 : 0, parameters.sheet);
      void events.reveal;
      return {
        Badge({ props, elements }) {
          return {
            Root: { opacity: elements.Root.present ? visible : 0 },
            Label: { color: props.label ? parameters.foreground : "transparent" },
          };
        },
      };
    },
  };
}) satisfies Presentation<Root, Language, PresentationParameters>;

void presentation;

declare const scalarAnimation: Animation<number, number, number>;
declare const pointAnimation: Animation<Point, Point, Point>;

// @ts-expect-error Source and Animation domains must agree.
animate("open", scalarAnimation);
// @ts-expect-error Structured domains preserve tuple dimensions.
animate([1, 2] as const, pointAnimation);
// @ts-expect-error velocity only accepts a directly animated value.
velocity(1);
// @ts-expect-error settled only accepts a directly animated value.
settled(1);

const invalidDeclaration = (({ parameters }) => ({
  Sheet: () => ({
    // @ts-expect-error Adapter declarations reject unknown vocabulary.
    Root: { backgroundColor: parameters.foreground },
  }),
  Child: () => ({ Badge: () => ({}) }),
})) satisfies Presentation<Root, Language, PresentationParameters>;

void invalidDeclaration;
