import type { BufferGeometry, Object3D } from "three";

import type { Feature, Program, WebMain } from "../application";
import type { PlatformAdapter, PlatformPresentationLanguage } from "./platform";
import type { PresentationAdapter } from "./presentation";
import type { ThreePlatform } from "./three/platform";
import type { WebPlatform } from "./web/platform";

type ThreeMain = { readonly Name: "three-main"; readonly Platform: ThreePlatform };

type SceneFeature = {
  Programs: {
    scene: Program<
      ThreeMain,
      {
        Components: {
          World: {
            Elements: { Root: "scene"; Camera: "perspectiveCamera"; Model: "mesh" };
          };
        };
      }
    >;
  };
};

const sceneFeature = {
  programs: {
    scene: {
      components: {
        World: {
          view({ elements: { Root, Camera, Model } }) {
            Root({ name: "world" });
            Camera({ fov: 42, near: 0.1 });
            Model({
              name: "model",
              semantics: { label: "Open model", role: "button" },
              onActivate() {},
            });
            const model = Model.element;
            if (model) model.geometry satisfies BufferGeometry;
            // @ts-expect-error Scene props cannot configure camera fields.
            Root({ fov: 42 });
            // @ts-expect-error Camera props cannot configure light intensity.
            Camera({ intensity: 2 });
            // @ts-expect-error Three semantic roles are platform-specific and exhaustive.
            Model({ semantics: { label: "Model", role: "dialog" } });
            return Root();
          },
        },
      },
      root: "World",
    },
  },
} satisfies Feature<SceneFeature>;

void sceneFeature;

type InvalidWebProgram = Program<
  WebMain,
  { Components: { Scene: { Elements: { Root: "scene" } } } }
>;

// @ts-expect-error A web Program cannot name a Three primitive.
const invalidWebProgram: InvalidWebProgram = {
  Runtime: { Name: "web-main", Platform: {} as WebPlatform },
  Components: { Scene: { Elements: { Root: "scene" } } },
};

void invalidWebProgram;

type ThreeLanguage = PlatformPresentationLanguage<ThreePlatform>;

const meshDeclaration: ThreeLanguage["Declarations"]["mesh"] = {
  kind: "mesh",
  geometry: { kind: "box", width: 1, height: 1, depth: 1 },
};

// @ts-expect-error Primitive declarations are selected by primitive identity.
const invalidMeshDeclaration: ThreeLanguage["Declarations"]["mesh"] = { kind: "scene" };

void meshDeclaration;
void invalidMeshDeclaration;

declare const threePresentationAdapter: PresentationAdapter<ThreeLanguage, Object3D>;

const pairedThreeAdapter = {
  name: "three",
  structure: { renderer: "retained-scene" },
  presentation: threePresentationAdapter,
} satisfies PlatformAdapter<ThreePlatform, { renderer: string }, Object3D>;

void pairedThreeAdapter;
