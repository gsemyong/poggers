import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Fog,
  Group,
  IcosahedronGeometry,
  Light,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  ACESFilmicToneMapping,
  type Material,
  type Object3D,
  type Vector3,
  Vector2,
  WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import type {
  PresentationAdapter,
  PresentationAdapterSession,
  PresentationTargetSources,
} from "../../presentation";
import {
  createAnimeMotionBackend,
  RetainedMotionGraph,
  type MotionBackend,
  type MotionScheduler,
} from "../../web/motion";
import type {
  ThreeCameraDeclaration,
  ThreeGeometry,
  ThreeGroupDeclaration,
  ThreeLightDeclaration,
  ThreeMaterial,
  ThreeMeshDeclaration,
  ThreeMotionValue,
  ThreePresentationDeclaration,
  ThreePresentationLanguage,
  ThreeSceneDeclaration,
  ThreeShaderMaterial,
  ThreeStandardMaterial,
  ThreeTransform,
} from "./language";

type Binding = Readonly<{ read(): number; write(value: number): void }>;
type Desired =
  | Readonly<{ kind: "direct"; value: number }>
  | Readonly<{ kind: "target"; value: number; velocity?: number; transition: string }>;

type OwnedMesh = {
  readonly originalGeometry: BufferGeometry;
  readonly originalMaterial: Material | Material[];
  geometry?: BufferGeometry;
  geometrySignature?: string;
  material?: Material;
  materialSignature?: string;
};

type OriginalObject = Readonly<{
  position: Vector3;
  rotation: readonly [number, number, number];
  scale: Vector3;
  visible: boolean;
  camera?: Readonly<{ fov: number; near: number; far: number }>;
  light?: Readonly<{
    color: Color;
    intensity: number;
    distance?: number;
    decay?: number;
  }>;
}>;

type PostState = {
  composer: EffectComposer;
  render: RenderPass;
  bloom: UnrealBloomPass;
};

type SessionState = {
  readonly owner: string;
  readonly scene: Scene;
  readonly renderer: WebGLRenderer | undefined;
  readonly originalBackground: Scene["background"];
  readonly originalFog: Scene["fog"];
  readonly originalExposure: number | undefined;
  readonly motion: RetainedMotionGraph;
  readonly bindings: Map<string, Binding>;
  readonly desired: Map<string, Desired>;
  readonly originals: Map<Object3D, OriginalObject>;
  readonly meshes: Map<Mesh, OwnedMesh>;
  readonly shaders: Set<ShaderMaterial>;
  readonly managed: Set<Object3D>;
  readonly targetIds: WeakMap<Object3D, number>;
  nextTargetId: number;
  activeKeys: Set<string>;
  particles?: Points;
  particleSignature?: string;
  camera?: PerspectiveCamera;
  post?: PostState;
  disposed: boolean;
};

export type ThreePresentationAdapterOptions = Readonly<{
  renderer?: WebGLRenderer;
  motionBackend?: MotionBackend;
  scheduler?: MotionScheduler;
}>;

export type ThreePresentationAdapter = PresentationAdapter<ThreePresentationLanguage, Object3D> &
  Readonly<{
    render(time?: number): void;
    resize(width: number, height: number, pixelRatio?: number): void;
    flushMotion(): void;
  }>;

let nextSession = 0;

export function createThreeRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: false,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  return renderer;
}

export function createThreePresentationAdapter(
  options: ThreePresentationAdapterOptions = {},
): ThreePresentationAdapter {
  const sessions = new Set<SessionState>();
  const renderer = options.renderer;

  return {
    create<const ElementName extends string>(input: {
      readonly boundary: Object3D;
      readonly targets: PresentationTargetSources<ElementName, Object3D>;
    }): PresentationAdapterSession<ThreePresentationLanguage, ElementName> {
      if (!(input.boundary instanceof Scene)) {
        throw new TypeError("A Three Presentation boundary must be a Scene.");
      }
      const state = createSessionState(input.boundary, options);
      sessions.add(state);
      return {
        commit(declarations) {
          commitThreePresentation(state, input.targets, declarations, renderer);
        },
        dispose() {
          if (state.disposed) return;
          state.disposed = true;
          sessions.delete(state);
          disposeSession(state);
        },
      };
    },
    render(time = 0) {
      for (const state of sessions) {
        updateTimeUniforms(state, time);
        if (state.post) state.post.composer.render();
        else if (renderer && state.camera) renderer.render(state.scene, state.camera);
      }
    },
    resize(width, height, pixelRatio = globalThis.devicePixelRatio || 1) {
      if (!renderer) return;
      const safeWidth = Math.max(1, width);
      const safeHeight = Math.max(1, height);
      renderer.setPixelRatio(Math.min(2, Math.max(1, pixelRatio)));
      renderer.setSize(safeWidth, safeHeight, false);
      for (const state of sessions) {
        if (state.camera) {
          state.camera.aspect = safeWidth / safeHeight;
          state.camera.updateProjectionMatrix();
        }
        state.post?.composer.setSize(safeWidth, safeHeight);
      }
    },
    flushMotion() {
      for (const state of sessions) state.motion.flush();
    },
  };
}

function createSessionState(scene: Scene, options: ThreePresentationAdapterOptions): SessionState {
  const bindings = new Map<string, Binding>();
  const backend =
    options.motionBackend ??
    createAnimeMotionBackend({
      render(key, value) {
        bindings.get(key)?.write(value);
      },
    });
  return {
    owner: `three-presentation-${nextSession++}`,
    scene,
    renderer: options.renderer,
    originalBackground: scene.background,
    originalFog: scene.fog,
    originalExposure: options.renderer?.toneMappingExposure,
    motion: new RetainedMotionGraph(backend, options.scheduler),
    bindings,
    desired: new Map(),
    originals: new Map(),
    meshes: new Map(),
    shaders: new Set(),
    managed: new Set(),
    targetIds: new WeakMap(),
    nextTargetId: 0,
    activeKeys: new Set(),
    disposed: false,
  };
}

function commitThreePresentation<ElementName extends string>(
  state: SessionState,
  sources: PresentationTargetSources<ElementName, Object3D>,
  declarations: Readonly<Partial<Record<ElementName, Readonly<ThreePresentationDeclaration>>>>,
  renderer: WebGLRenderer | undefined,
): void {
  if (state.disposed) throw new Error("Cannot commit a disposed Three Presentation session.");
  const targets = resolveTargets(sources);
  const prepared: Array<readonly [Object3D, ThreePresentationDeclaration]> = [];
  for (const name of Object.keys(declarations) as ElementName[]) {
    const declaration = declarations[name];
    if (!declaration) continue;
    validateSerializable(declaration, `Three declaration ${JSON.stringify(name)}`, new Set());
    for (const target of targets.get(name) ?? []) {
      validateDeclarationTarget(target, declaration, String(name));
      prepared.push([target, declaration]);
    }
  }

  const nextKeys = new Set<string>();
  const nextManaged = new Set<Object3D>();
  state.camera = undefined;
  for (const [target, declaration] of prepared) {
    nextManaged.add(target);
    rememberObject(state, target);
    switch (declaration.kind) {
      case "scene":
        applyScene(state, target as Scene, declaration, renderer);
        break;
      case "camera":
        state.camera = target as PerspectiveCamera;
        applyCamera(state, target as PerspectiveCamera, declaration, nextKeys);
        break;
      case "group":
        applyGroup(state, target as Group, declaration, nextKeys);
        break;
      case "mesh":
        applyMesh(state, target as Mesh, declaration, nextKeys);
        break;
      case "light":
        applyLight(state, target as Light, declaration, nextKeys);
        break;
    }
  }
  configurePost(state, renderer, prepared);
  for (const key of state.activeKeys) {
    if (nextKeys.has(key)) continue;
    state.motion.release(key);
    state.bindings.delete(key);
    state.desired.delete(key);
  }
  for (const [target, declaration] of prepared) {
    restoreOmittedProperties(state, target, declaration);
  }
  for (const target of state.managed) {
    if (!nextManaged.has(target)) restoreTarget(state, target);
  }
  state.activeKeys = nextKeys;
  state.managed.clear();
  for (const target of nextManaged) state.managed.add(target);
}

function resolveTargets<ElementName extends string>(
  sources: PresentationTargetSources<ElementName, Object3D>,
): ReadonlyMap<ElementName, readonly Object3D[]> {
  const result = new Map<ElementName, readonly Object3D[]>();
  const owners = new Map<Object3D, ElementName>();
  for (const name of Object.keys(sources) as ElementName[]) {
    const targets = [...new Set(sources[name]?.() ?? [])];
    for (const target of targets) {
      const owner = owners.get(target);
      if (owner !== undefined && owner !== name) {
        throw new Error(
          `Three Presentation target is claimed by two Elements: ${JSON.stringify(owner)} and ${JSON.stringify(name)}.`,
        );
      }
      owners.set(target, name);
    }
    result.set(name, targets);
  }
  return result;
}

function validateDeclarationTarget(
  target: Object3D,
  declaration: ThreePresentationDeclaration,
  name: string,
): void {
  const valid =
    (declaration.kind === "scene" && target instanceof Scene) ||
    (declaration.kind === "camera" && target instanceof PerspectiveCamera) ||
    (declaration.kind === "group" && target instanceof Group && !(target instanceof Scene)) ||
    (declaration.kind === "mesh" && target instanceof Mesh) ||
    (declaration.kind === "light" && target instanceof Light);
  if (!valid) {
    throw new TypeError(
      `Three declaration ${JSON.stringify(name)} of kind ${JSON.stringify(declaration.kind)} does not match its native target.`,
    );
  }
}

function applyScene(
  state: SessionState,
  scene: Scene,
  declaration: ThreeSceneDeclaration,
  renderer: WebGLRenderer | undefined,
): void {
  scene.background =
    declaration.background === undefined
      ? state.originalBackground
      : new Color(declaration.background);
  scene.fog = declaration.fog
    ? new Fog(declaration.fog.color, declaration.fog.near, declaration.fog.far)
    : state.originalFog;
  if (renderer && declaration.post?.exposure !== undefined) {
    renderer.toneMappingExposure = declaration.post.exposure;
  } else if (renderer && state.originalExposure !== undefined) {
    renderer.toneMappingExposure = state.originalExposure;
  }
  const signature = JSON.stringify(declaration.particles ?? null);
  if (signature === state.particleSignature) return;
  disposeParticles(state);
  state.particleSignature = signature;
  if (declaration.particles) {
    state.particles = createParticles(declaration.particles);
    scene.add(state.particles);
  }
}

function applyCamera(
  state: SessionState,
  camera: PerspectiveCamera,
  declaration: ThreeCameraDeclaration,
  keys: Set<string>,
): void {
  applyTransform(state, camera, declaration.transform, keys);
  if (declaration.perspective?.near !== undefined) camera.near = declaration.perspective.near;
  if (declaration.perspective?.far !== undefined) camera.far = declaration.perspective.far;
  if (declaration.perspective?.fov !== undefined) {
    applyMotionValue(state, camera, "fov", declaration.perspective.fov, keys, {
      read: () => camera.fov,
      write(value) {
        camera.fov = value;
        camera.updateProjectionMatrix();
      },
    });
  }
  if (declaration.lookAt) {
    camera.lookAt(declaration.lookAt.x, declaration.lookAt.y, declaration.lookAt.z);
  }
  camera.updateProjectionMatrix();
}

function applyGroup(
  state: SessionState,
  group: Group,
  declaration: ThreeGroupDeclaration,
  keys: Set<string>,
): void {
  applyTransform(state, group, declaration.transform, keys);
}

function applyMesh(
  state: SessionState,
  mesh: Mesh,
  declaration: ThreeMeshDeclaration,
  keys: Set<string>,
): void {
  applyTransform(state, mesh, declaration.transform, keys);
  const owned =
    state.meshes.get(mesh) ??
    ({ originalGeometry: mesh.geometry, originalMaterial: mesh.material } satisfies OwnedMesh);
  state.meshes.set(mesh, owned);
  if (declaration.geometry) replaceGeometry(owned, mesh, declaration.geometry);
  else restoreGeometry(owned, mesh);
  if (declaration.material) replaceMaterial(state, owned, mesh, declaration.material, keys);
  else restoreMaterial(state, owned, mesh);
}

function applyLight(
  state: SessionState,
  light: Light,
  declaration: ThreeLightDeclaration,
  keys: Set<string>,
): void {
  applyTransform(state, light, declaration.transform, keys);
  if (declaration.color !== undefined) light.color.set(declaration.color);
  if (declaration.intensity !== undefined) {
    applyMotionValue(state, light, "intensity", declaration.intensity, keys, {
      read: () => light.intensity,
      write: (value) => {
        light.intensity = value;
      },
    });
  }
  if (!(light instanceof AmbientLight)) {
    if (declaration.distance !== undefined && "distance" in light)
      light.distance = declaration.distance;
    if (declaration.decay !== undefined && "decay" in light) light.decay = declaration.decay;
  }
}

function applyTransform(
  state: SessionState,
  target: Object3D,
  transform: ThreeTransform | undefined,
  keys: Set<string>,
): void {
  if (!transform) return;
  if (transform.visible !== undefined) target.visible = transform.visible;
  applyVector(state, target, "position", target.position, transform.position, keys);
  applyVector(state, target, "rotation", target.rotation, transform.rotation, keys);
  if (typeof transform.scale === "number" || isMotionTarget(transform.scale)) {
    for (const axis of ["x", "y", "z"] as const) {
      applyMotionValue(state, target, `scale.${axis}`, transform.scale, keys, {
        read: () => target.scale[axis],
        write: (value) => {
          target.scale[axis] = value;
        },
      });
    }
  } else {
    applyVector(state, target, "scale", target.scale, transform.scale, keys);
  }
}

function applyVector(
  state: SessionState,
  target: Object3D,
  name: string,
  vector: { x: number; y: number; z: number },
  declaration:
    | Readonly<{ x?: ThreeMotionValue; y?: ThreeMotionValue; z?: ThreeMotionValue }>
    | undefined,
  keys: Set<string>,
): void {
  if (!declaration) return;
  for (const axis of ["x", "y", "z"] as const) {
    const value = declaration[axis];
    if (value === undefined) continue;
    applyMotionValue(state, target, `${name}.${axis}`, value, keys, {
      read: () => vector[axis],
      write: (next) => {
        vector[axis] = next;
      },
    });
  }
}

function applyMotionValue(
  state: SessionState,
  target: Object3D,
  property: string,
  value: ThreeMotionValue,
  keys: Set<string>,
  binding: Binding,
): void {
  const key = `${state.owner}/${targetId(state, target)}/${property}`;
  state.bindings.set(key, binding);
  keys.add(key);
  const channel = state.motion.channel(key, state.owner, binding.read());
  if (typeof value === "number") {
    const previous = state.desired.get(key);
    if (previous?.kind === "direct" && previous.value === value) return;
    state.desired.set(key, { kind: "direct", value });
    channel.direct(value);
    return;
  }
  const signature = JSON.stringify(value.transition);
  const previous = state.desired.get(key);
  if (
    previous?.kind === "target" &&
    previous.value === value.target &&
    previous.velocity === value.velocity &&
    previous.transition === signature
  ) {
    return;
  }
  state.desired.set(key, {
    kind: "target",
    value: value.target,
    ...(value.velocity === undefined ? {} : { velocity: value.velocity }),
    transition: signature,
  });
  void channel.target(value.target, value.transition, { velocity: value.velocity });
}

function replaceGeometry(owned: OwnedMesh, mesh: Mesh, definition: ThreeGeometry): void {
  const signature = JSON.stringify(definition);
  if (owned.geometrySignature === signature) return;
  owned.geometry?.dispose();
  owned.geometry = createGeometry(definition);
  owned.geometrySignature = signature;
  mesh.geometry = owned.geometry;
}

function restoreGeometry(owned: OwnedMesh, mesh: Mesh): void {
  if (!owned.geometry) return;
  owned.geometry.dispose();
  owned.geometry = undefined;
  owned.geometrySignature = undefined;
  mesh.geometry = owned.originalGeometry;
}

function createGeometry(definition: ThreeGeometry): BufferGeometry {
  switch (definition.kind) {
    case "box":
      return new BoxGeometry(
        definition.width,
        definition.height,
        definition.depth,
        definition.segments,
        definition.segments,
        definition.segments,
      );
    case "icosahedron":
      return new IcosahedronGeometry(definition.radius, definition.detail);
    case "torus":
      return new TorusGeometry(
        definition.radius,
        definition.tube,
        definition.radialSegments,
        definition.tubularSegments,
      );
  }
}

function replaceMaterial(
  state: SessionState,
  owned: OwnedMesh,
  mesh: Mesh,
  definition: ThreeMaterial,
  keys: Set<string>,
): void {
  const signature = materialSignature(definition);
  if (owned.materialSignature !== signature) {
    if (owned.material) {
      state.shaders.delete(owned.material as ShaderMaterial);
      owned.material.dispose();
    }
    owned.material = createMaterial(state, definition);
    owned.materialSignature = signature;
    mesh.material = owned.material;
  }
  if (definition.kind === "standard" && owned.material instanceof MeshStandardMaterial) {
    applyStandardMaterial(state, mesh, owned.material, definition, keys);
  } else if (definition.kind === "shader" && owned.material instanceof ShaderMaterial) {
    applyShaderUniforms(state, mesh, owned.material, definition, keys);
  }
}

function restoreMaterial(state: SessionState, owned: OwnedMesh, mesh: Mesh): void {
  if (!owned.material) return;
  state.shaders.delete(owned.material as ShaderMaterial);
  owned.material.dispose();
  owned.material = undefined;
  owned.materialSignature = undefined;
  mesh.material = owned.originalMaterial;
}

function materialSignature(definition: ThreeMaterial): string {
  return JSON.stringify(
    definition.kind === "standard"
      ? { ...definition, opacity: undefined }
      : { ...definition, uniforms: undefined },
  );
}

function createMaterial(state: SessionState, definition: ThreeMaterial): Material {
  if (definition.kind === "standard") {
    return new MeshStandardMaterial({
      color: definition.color,
      ...(definition.emissive === undefined ? {} : { emissive: definition.emissive }),
      ...(definition.emissiveIntensity === undefined
        ? {}
        : { emissiveIntensity: definition.emissiveIntensity }),
      ...(definition.metalness === undefined ? {} : { metalness: definition.metalness }),
      ...(definition.roughness === undefined ? {} : { roughness: definition.roughness }),
      ...(definition.transparent === undefined ? {} : { transparent: definition.transparent }),
      ...(definition.wireframe === undefined ? {} : { wireframe: definition.wireframe }),
    });
  }
  const material = new ShaderMaterial({
    vertexShader: definition.vertex,
    fragmentShader: definition.fragment,
    ...(definition.transparent === undefined ? {} : { transparent: definition.transparent }),
    uniforms: Object.fromEntries(
      Object.entries(definition.uniforms ?? {}).map(([name, value]) => [
        name,
        { value: uniformInitialValue(value) },
      ]),
    ),
  });
  material.userData.poggersDefinition = definition;
  state.shaders.add(material);
  return material;
}

function applyStandardMaterial(
  state: SessionState,
  mesh: Mesh,
  material: MeshStandardMaterial,
  definition: ThreeStandardMaterial,
  keys: Set<string>,
): void {
  material.color.set(definition.color);
  if (definition.emissive !== undefined) material.emissive.set(definition.emissive);
  if (definition.emissiveIntensity !== undefined) {
    material.emissiveIntensity = definition.emissiveIntensity;
  }
  if (definition.metalness !== undefined) material.metalness = definition.metalness;
  if (definition.roughness !== undefined) material.roughness = definition.roughness;
  if (definition.opacity !== undefined) {
    applyMotionValue(state, mesh, "material.opacity", definition.opacity, keys, {
      read: () => material.opacity,
      write(value) {
        material.opacity = value;
      },
    });
  }
}

function applyShaderUniforms(
  state: SessionState,
  mesh: Mesh,
  material: ShaderMaterial,
  definition: ThreeShaderMaterial,
  keys: Set<string>,
): void {
  material.userData.poggersDefinition = definition;
  for (const name of Object.keys(material.uniforms)) {
    if (!(name in (definition.uniforms ?? {}))) delete material.uniforms[name];
  }
  for (const [name, value] of Object.entries(definition.uniforms ?? {})) {
    const uniform = (material.uniforms[name] ??= { value: uniformInitialValue(value) });
    if (typeof value === "number" || isMotionTarget(value)) {
      applyMotionValue(state, mesh, `uniform.${name}`, value, keys, {
        read: () => (typeof uniform.value === "number" ? uniform.value : 0),
        write: (next) => {
          uniform.value = next;
        },
      });
    } else if (!(typeof value === "object" && value && "kind" in value && value.kind === "time")) {
      uniform.value = uniformInitialValue(value);
    }
  }
}

function uniformInitialValue(value: unknown): unknown {
  if (isMotionTarget(value)) return value.target;
  if (Array.isArray(value)) return value.length === 2 ? new Vector2(...value) : value;
  if (typeof value === "string" && value.startsWith("#")) return new Color(value);
  if (typeof value === "object" && value && "kind" in value && value.kind === "time") return 0;
  return value;
}

function configurePost(
  state: SessionState,
  renderer: WebGLRenderer | undefined,
  prepared: readonly (readonly [Object3D, ThreePresentationDeclaration])[],
): void {
  const sceneDeclaration = prepared.find(([, declaration]) => declaration.kind === "scene")?.[1];
  const bloom = sceneDeclaration?.kind === "scene" ? sceneDeclaration.post?.bloom : undefined;
  if (!renderer || !state.camera || !bloom) {
    state.post?.composer.dispose();
    state.post = undefined;
    return;
  }
  if (!state.post) {
    const composer = new EffectComposer(renderer);
    const render = new RenderPass(state.scene, state.camera);
    const bloomPass = new UnrealBloomPass(new Vector2(1, 1), 1, 0, 0);
    composer.addPass(render);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    state.post = { composer, render, bloom: bloomPass };
  }
  state.post.render.camera = state.camera;
  state.post.bloom.strength = bloom.strength;
  state.post.bloom.radius = bloom.radius;
  state.post.bloom.threshold = bloom.threshold;
}

function createParticles(definition: NonNullable<ThreeSceneDeclaration["particles"]>): Points {
  const positions = new Float32Array(definition.count * 3);
  let seed = definition.seed ?? 1;
  for (let index = 0; index < definition.count; index++) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    const u = seed / 0xffff_ffff;
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    const v = seed / 0xffff_ffff;
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const radius = definition.radius * (0.35 + 0.65 * ((index % 17) / 16));
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: definition.color,
    size: definition.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
  });
  const particles = new Points(geometry, material);
  particles.name = "poggers-presentation-particles";
  particles.frustumCulled = false;
  return particles;
}

function updateTimeUniforms(state: SessionState, time: number): void {
  for (const [mesh, owned] of state.meshes) {
    if (!(owned.material instanceof ShaderMaterial)) continue;
    const definition = owned.material.userData.poggersDefinition as ThreeShaderMaterial | undefined;
    for (const [name, value] of Object.entries(definition?.uniforms ?? {})) {
      if (typeof value === "object" && value && "kind" in value && value.kind === "time") {
        const uniform = owned.material.uniforms[name];
        if (uniform) uniform.value = (time / 1_000) * (value.speed ?? 1);
      }
    }
    mesh.matrixWorldNeedsUpdate = true;
  }
}

function restoreOmittedProperties(
  state: SessionState,
  target: Object3D,
  declaration: ThreePresentationDeclaration,
): void {
  const original = state.originals.get(target);
  if (!original) return;
  const transform = declaration.kind === "scene" ? undefined : declaration.transform;
  if (transform?.visible === undefined) target.visible = original.visible;
  restoreVector(target.position, original.position, transform?.position);

  const controlsRotation = declaration.kind === "camera" && declaration.lookAt !== undefined;
  if (!controlsRotation) {
    restoreRotation(target, original.rotation, transform?.rotation);
  }
  if (typeof transform?.scale !== "number" && !isMotionTarget(transform?.scale)) {
    restoreVector(target.scale, original.scale, transform?.scale);
  }

  if (target instanceof PerspectiveCamera && original.camera) {
    if (declaration.kind !== "camera" || declaration.perspective?.fov === undefined) {
      target.fov = original.camera.fov;
    }
    if (declaration.kind !== "camera" || declaration.perspective?.near === undefined) {
      target.near = original.camera.near;
    }
    if (declaration.kind !== "camera" || declaration.perspective?.far === undefined) {
      target.far = original.camera.far;
    }
    target.updateProjectionMatrix();
  }

  if (target instanceof Light && original.light) {
    if (declaration.kind !== "light" || declaration.color === undefined) {
      target.color.copy(original.light.color);
    }
    if (declaration.kind !== "light" || declaration.intensity === undefined) {
      target.intensity = original.light.intensity;
    }
    const spatial = target as Light & { distance?: number; decay?: number };
    if (declaration.kind !== "light" || declaration.distance === undefined) {
      if (original.light.distance !== undefined) spatial.distance = original.light.distance;
    }
    if (declaration.kind !== "light" || declaration.decay === undefined) {
      if (original.light.decay !== undefined) spatial.decay = original.light.decay;
    }
  }

  if (target instanceof Mesh && declaration.kind === "mesh") {
    const owned = state.meshes.get(target);
    if (
      owned?.material instanceof MeshStandardMaterial &&
      (declaration.material?.kind !== "standard" || declaration.material.opacity === undefined)
    ) {
      owned.material.opacity = 1;
    }
  }
}

function restoreVector(
  target: { x: number; y: number; z: number },
  original: { x: number; y: number; z: number },
  declaration:
    | Readonly<{ x?: ThreeMotionValue; y?: ThreeMotionValue; z?: ThreeMotionValue }>
    | undefined,
): void {
  for (const axis of ["x", "y", "z"] as const) {
    if (declaration?.[axis] === undefined) target[axis] = original[axis];
  }
}

function restoreRotation(
  target: Object3D,
  original: readonly [number, number, number],
  declaration:
    | Readonly<{ x?: ThreeMotionValue; y?: ThreeMotionValue; z?: ThreeMotionValue }>
    | undefined,
): void {
  for (const [index, axis] of ["x", "y", "z"].entries()) {
    const typedAxis = axis as "x" | "y" | "z";
    if (declaration?.[typedAxis] === undefined) target.rotation[typedAxis] = original[index]!;
  }
}

function rememberObject(state: SessionState, target: Object3D): void {
  if (state.originals.has(target)) return;
  const spatialLight = target as Light & { distance?: number; decay?: number };
  state.originals.set(target, {
    position: target.position.clone(),
    rotation: [target.rotation.x, target.rotation.y, target.rotation.z],
    scale: target.scale.clone(),
    visible: target.visible,
    ...(target instanceof PerspectiveCamera
      ? { camera: { fov: target.fov, near: target.near, far: target.far } }
      : {}),
    ...(target instanceof Light
      ? {
          light: {
            color: target.color.clone(),
            intensity: target.intensity,
            ...("distance" in target ? { distance: spatialLight.distance } : {}),
            ...("decay" in target ? { decay: spatialLight.decay } : {}),
          },
        }
      : {}),
  });
}

function targetId(state: SessionState, target: Object3D): number {
  const current = state.targetIds.get(target);
  if (current !== undefined) return current;
  const identity = state.nextTargetId++;
  state.targetIds.set(target, identity);
  return identity;
}

function disposeSession(state: SessionState): void {
  state.motion.dispose();
  state.post?.composer.dispose();
  for (const target of state.managed) restoreTarget(state, target);
  disposeParticles(state);
  if (state.renderer && state.originalExposure !== undefined) {
    state.renderer.toneMappingExposure = state.originalExposure;
  }
  state.meshes.clear();
  state.shaders.clear();
  state.bindings.clear();
  state.desired.clear();
  state.originals.clear();
  state.managed.clear();
}

function restoreTarget(state: SessionState, target: Object3D): void {
  if (target === state.scene) {
    state.scene.background = state.originalBackground;
    state.scene.fog = state.originalFog;
    disposeParticles(state);
    if (state.renderer && state.originalExposure !== undefined) {
      state.renderer.toneMappingExposure = state.originalExposure;
    }
  }
  if (target instanceof Mesh) {
    const owned = state.meshes.get(target);
    if (owned) {
      restoreGeometry(owned, target);
      restoreMaterial(state, owned, target);
      state.meshes.delete(target);
    }
  }
  const original = state.originals.get(target);
  if (!original) return;
  target.position.copy(original.position);
  target.rotation.set(...original.rotation);
  target.scale.copy(original.scale);
  target.visible = original.visible;
  if (target instanceof PerspectiveCamera && original.camera) {
    target.fov = original.camera.fov;
    target.near = original.camera.near;
    target.far = original.camera.far;
    target.updateProjectionMatrix();
  }
  if (target instanceof Light && original.light) {
    target.color.copy(original.light.color);
    target.intensity = original.light.intensity;
    const spatial = target as Light & { distance?: number; decay?: number };
    if (original.light.distance !== undefined) spatial.distance = original.light.distance;
    if (original.light.decay !== undefined) spatial.decay = original.light.decay;
  }
  state.originals.delete(target);
}

function disposeParticles(state: SessionState): void {
  if (!state.particles) return;
  state.particles.removeFromParent();
  state.particles.geometry.dispose();
  (state.particles.material as Material).dispose();
  state.particles = undefined;
}

function isMotionTarget(value: unknown): value is Exclude<ThreeMotionValue, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    "target" in value &&
    typeof value.target === "number" &&
    "transition" in value
  );
}

function validateSerializable(value: unknown, path: string, ancestors: Set<object>): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${path} contains a non-finite number.`);
  }
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${path} contains unsupported data.`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains cyclic data.`);
  ancestors.add(value);
  for (const item of Object.values(value)) validateSerializable(item, path, ancestors);
  ancestors.delete(value);
}
