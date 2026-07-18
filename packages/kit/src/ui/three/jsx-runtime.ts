import { AmbientLight, Group, Mesh, Object3D, PerspectiveCamera, PointLight, Scene } from "three";

export type ThreeChild = Object3D | readonly ThreeChild[] | null | undefined | false;
type Ref<T> = (target: T) => void | (() => void);

export type ThreeSemantics = Readonly<{
  label: string;
  role?: "button" | "image" | "group";
  value?: string;
}>;

export type ThreeNodeProps<T extends Object3D> = Readonly<{
  name?: string;
  children?: ThreeChild;
  ref?: Ref<T>;
  semantics?: ThreeSemantics;
  onActivate?(): void;
}>;

export type ThreeCameraProps = ThreeNodeProps<PerspectiveCamera> &
  Readonly<{ fov?: number; aspect?: number; near?: number; far?: number }>;
export type ThreeLightProps<T extends AmbientLight | PointLight> = ThreeNodeProps<T> &
  Readonly<{ color?: number | string; intensity?: number }>;
export type ThreePointLightProps = ThreeLightProps<PointLight> &
  Readonly<{ distance?: number; decay?: number }>;

export namespace JSX {
  export type Element = Object3D;
  export interface IntrinsicElements {
    scene: ThreeNodeProps<Scene>;
    group: ThreeNodeProps<Group>;
    mesh: ThreeNodeProps<Mesh>;
    perspectiveCamera: ThreeCameraProps;
    ambientLight: ThreeLightProps<AmbientLight>;
    pointLight: ThreePointLightProps;
  }
}

export function jsx(type: keyof JSX.IntrinsicElements, props: Record<string, unknown>): Object3D {
  const node = createNode(type, props);
  if (typeof props.name === "string") node.name = props.name;
  if (props.semantics) node.userData.poggersSemantics = props.semantics;
  if (typeof props.onActivate === "function") node.userData.poggersActivate = props.onActivate;
  appendChildren(node, props.children as ThreeChild);
  if (typeof props.ref === "function") (props.ref as Ref<Object3D>)(node);
  return node;
}

export const jsxs = jsx;

export function Fragment(props: Readonly<{ children?: ThreeChild }>): Object3D {
  const group = new Group();
  appendChildren(group, props.children);
  return group;
}

/** Reads the semantic proxy definition owned by Three structure. */
export function threeSemantics(target: Object3D): ThreeSemantics | undefined {
  return target.userData.poggersSemantics as ThreeSemantics | undefined;
}

/** Delivers a native raycast/assistive activation through the structural path. */
export function activateThree(target: Object3D): void {
  const activate = target.userData.poggersActivate;
  if (typeof activate === "function") activate();
}

/** Resolves renderer hit-test results through the structural activation path. */
export function dispatchThreeHit(
  hits: readonly Readonly<{ object: Object3D }>[],
): Object3D | undefined {
  for (const hit of hits) {
    let target: Object3D | null = hit.object;
    while (target) {
      if (typeof target.userData.poggersActivate === "function") {
        activateThree(target);
        return target;
      }
      target = target.parent;
    }
  }
  return undefined;
}

function createNode(type: keyof JSX.IntrinsicElements, props: Record<string, unknown>): Object3D {
  switch (type) {
    case "scene":
      return new Scene();
    case "group":
      return new Group();
    case "mesh":
      return new Mesh();
    case "perspectiveCamera":
      return new PerspectiveCamera(
        number(props.fov, 50),
        number(props.aspect, 1),
        number(props.near, 0.1),
        number(props.far, 1_000),
      );
    case "ambientLight":
      return new AmbientLight(
        props.color as number | string | undefined,
        number(props.intensity, 1),
      );
    case "pointLight":
      return new PointLight(
        props.color as number | string | undefined,
        number(props.intensity, 1),
        number(props.distance, 0),
        number(props.decay, 2),
      );
  }
}

function appendChildren(parent: Object3D, children: ThreeChild): void {
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(parent, child);
  } else if (children instanceof Object3D) {
    parent.add(children);
  }
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
