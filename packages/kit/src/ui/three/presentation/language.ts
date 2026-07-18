import type { ComponentOwner } from "../../component.contract";
import type { Presentation as CorePresentation } from "../../presentation";

export type ThreeColor = number | `#${string}`;

export type ThreeTransition =
  | "instant"
  | Readonly<{ duration: number; easing?: "linear" | "smooth" | "accelerate" | "decelerate" }>
  | Readonly<{
      spring: Readonly<{
        mass?: number;
        stiffness: number;
        damping: number;
        velocity?: number;
      }>;
    }>;

export type ThreeMotionTarget = Readonly<{
  target: number;
  transition: ThreeTransition;
  velocity?: number;
}>;

export type ThreeMotionValue = number | ThreeMotionTarget;

export type ThreeVector = Readonly<{
  x?: ThreeMotionValue;
  y?: ThreeMotionValue;
  z?: ThreeMotionValue;
}>;

export type ThreeTransform = Readonly<{
  position?: ThreeVector;
  rotation?: ThreeVector;
  scale?: ThreeMotionValue | ThreeVector;
  visible?: boolean;
}>;

export type ThreeGeometry =
  | Readonly<{ kind: "box"; width: number; height: number; depth: number; segments?: number }>
  | Readonly<{ kind: "icosahedron"; radius: number; detail?: number }>
  | Readonly<{
      kind: "torus";
      radius: number;
      tube: number;
      radialSegments?: number;
      tubularSegments?: number;
    }>;

export type ThreeStandardMaterial = Readonly<{
  kind: "standard";
  color: ThreeColor;
  emissive?: ThreeColor;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  transparent?: boolean;
  opacity?: ThreeMotionValue;
  wireframe?: boolean;
}>;

export type ThreeShaderUniform =
  | number
  | ThreeColor
  | readonly number[]
  | ThreeMotionTarget
  | Readonly<{ kind: "time"; speed?: number }>;

export type ThreeShaderMaterial = Readonly<{
  kind: "shader";
  vertex: string;
  fragment: string;
  uniforms?: Readonly<Record<string, ThreeShaderUniform>>;
  transparent?: boolean;
}>;

export type ThreeMaterial = ThreeStandardMaterial | ThreeShaderMaterial;

export type ThreeSceneDeclaration = Readonly<{
  kind: "scene";
  background?: ThreeColor;
  fog?: Readonly<{ color: ThreeColor; near: number; far: number }>;
  particles?: Readonly<{
    count: number;
    radius: number;
    size: number;
    color: ThreeColor;
    seed?: number;
  }>;
  post?: Readonly<{
    bloom?: Readonly<{ strength: number; radius: number; threshold: number }>;
    exposure?: number;
  }>;
}>;

export type ThreeCameraDeclaration = Readonly<{
  kind: "camera";
  transform?: ThreeTransform;
  perspective?: Readonly<{ fov?: ThreeMotionValue; near?: number; far?: number }>;
  lookAt?: Readonly<{ x: number; y: number; z: number }>;
}>;

export type ThreeGroupDeclaration = Readonly<{
  kind: "group";
  transform?: ThreeTransform;
}>;

export type ThreeMeshDeclaration = Readonly<{
  kind: "mesh";
  geometry?: ThreeGeometry;
  material?: ThreeMaterial;
  transform?: ThreeTransform;
}>;

export type ThreeLightDeclaration = Readonly<{
  kind: "light";
  color?: ThreeColor;
  intensity?: ThreeMotionValue;
  distance?: number;
  decay?: number;
  transform?: ThreeTransform;
}>;

export type ThreePresentationDeclaration =
  | ThreeSceneDeclaration
  | ThreeCameraDeclaration
  | ThreeGroupDeclaration
  | ThreeMeshDeclaration
  | ThreeLightDeclaration;

export type ThreePresentationLanguage = {
  readonly Declaration: ThreePresentationDeclaration;
  readonly Declarations: {
    readonly scene: ThreeSceneDeclaration;
    readonly perspectiveCamera: ThreeCameraDeclaration;
    readonly group: ThreeGroupDeclaration;
    readonly mesh: ThreeMeshDeclaration;
    readonly ambientLight: ThreeLightDeclaration;
    readonly pointLight: ThreeLightDeclaration;
  };
};

export type ThreePresentation<Root extends ComponentOwner, Theme extends object> = CorePresentation<
  Root,
  ThreePresentationLanguage,
  Theme
>;
