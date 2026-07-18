import {
  activateThree,
  dispatchThreeHit,
  Fragment,
  jsx,
  jsxs,
  threeSemantics,
} from "./jsx-runtime";

/** Native Three structure operations paired with the Three Presentation adapter. */
export const threeStructure = Object.freeze({
  jsx,
  jsxs,
  Fragment,
  activate: activateThree,
  dispatchHit: dispatchThreeHit,
  semantics: threeSemantics,
});

export type ThreeStructureAdapter = typeof threeStructure;
