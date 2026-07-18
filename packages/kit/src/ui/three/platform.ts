import type { AmbientLight, Group, Mesh, PerspectiveCamera, PointLight, Scene } from "three";

import type { PlatformDefinition, PlatformPrimitive } from "../platform";
import type {
  ThreeCameraProps,
  ThreeChild,
  ThreeLightProps,
  ThreeNodeProps,
  ThreePointLightProps,
} from "./jsx-runtime";
import type {
  ThreeCameraDeclaration,
  ThreeGroupDeclaration,
  ThreeLightDeclaration,
  ThreeMeshDeclaration,
  ThreeSceneDeclaration,
} from "./presentation/language";

/** The typed structure and Presentation vocabulary of the Three platform. */
export type ThreePlatform = Readonly<{
  Name: "three";
  Child: ThreeChild;
  Primitives: {
    scene: PlatformPrimitive<ThreeNodeProps<Scene>, Scene, ThreeSceneDeclaration>;
    group: PlatformPrimitive<ThreeNodeProps<Group>, Group, ThreeGroupDeclaration>;
    mesh: PlatformPrimitive<ThreeNodeProps<Mesh>, Mesh, ThreeMeshDeclaration>;
    perspectiveCamera: PlatformPrimitive<
      ThreeCameraProps,
      PerspectiveCamera,
      ThreeCameraDeclaration
    >;
    ambientLight: PlatformPrimitive<
      ThreeLightProps<AmbientLight>,
      AmbientLight,
      ThreeLightDeclaration
    >;
    pointLight: PlatformPrimitive<ThreePointLightProps, PointLight, ThreeLightDeclaration>;
  };
}>;

type ThreePlatformSatisfiesContract =
  ThreePlatform extends PlatformDefinition<ThreePlatform> ? true : never;
const threePlatformSatisfiesContract: ThreePlatformSatisfiesContract = true;
void threePlatformSatisfiesContract;
