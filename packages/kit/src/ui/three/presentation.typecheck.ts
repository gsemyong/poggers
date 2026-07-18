import type { VisualValue } from "../component.contract";
import type { ThreePresentation } from "./presentation/language";

type SceneApp = {
  Components: {
    ScenePreview: {
      Props: { accent: `#${string}` };
      State: { active: boolean; tilt: VisualValue<"angle"> };
      Elements: {
        Root: "scene";
        Camera: "perspectiveCamera";
        Rig: "group";
        Orb: "mesh";
        Fill: "ambientLight";
        Key: "pointLight";
      };
    };
  };
};

const theme = {
  color: { background: "#05070d", accent: "#6ee7ff" },
  motion: { spring: { spring: { stiffness: 360, damping: 28 } } },
} as const;

export const typedThreePresentation = ((tokens) => ({
  ScenePreview({ props, state, targets }) {
    targets.Orb.name satisfies "Orb";
    return {
      Root: { kind: "scene", background: tokens.color.background },
      Camera: {
        kind: "camera",
        transform: { position: { z: state.active ? 5 : 6 } },
        lookAt: { x: 0, y: 0, z: 0 },
      },
      Rig: { kind: "group", transform: { rotation: { y: state.tilt } } },
      Orb: {
        kind: "mesh",
        geometry: { kind: "icosahedron", radius: 1.2, detail: 5 },
        material: { kind: "standard", color: props.accent },
        transform: {
          scale: {
            target: state.active ? 1.15 : 1,
            transition: tokens.motion.spring,
          },
        },
      },
      Fill: { kind: "light", intensity: 0.55 },
      Key: { kind: "light", color: tokens.color.accent, intensity: 24 },
    };
  },
})) satisfies ThreePresentation<SceneApp, typeof theme>;

export const rejectsPrimitiveMismatch = ((_) => ({
  // @ts-expect-error A mesh Element cannot receive a camera declaration.
  ScenePreview() {
    return {
      Orb: { kind: "camera", perspective: { fov: 40 } },
    };
  },
})) satisfies ThreePresentation<SceneApp, typeof theme>;
