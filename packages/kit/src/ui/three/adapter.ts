import type { Object3D } from "three";

import type { PlatformAdapter } from "../platform";
import type { ThreePlatform } from "./platform";
import {
  createThreePresentationAdapter,
  type ThreePresentationAdapterOptions,
} from "./presentation/adapter";
import { threeStructure, type ThreeStructureAdapter } from "./structure";

export type ThreePlatformAdapter = PlatformAdapter<ThreePlatform, ThreeStructureAdapter, Object3D>;

/** Creates one paired Three structure and Presentation implementation. */
export function createThreePlatformAdapter(
  options: ThreePresentationAdapterOptions = {},
): ThreePlatformAdapter {
  return {
    name: "three",
    structure: threeStructure,
    presentation: createThreePresentationAdapter(options),
  };
}
