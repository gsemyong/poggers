/** @jsxImportSource @poggers/kit/presentation/three */

import {
  createThreePresentationAdapter,
  createThreeRenderer,
  type ThreeAmbientLight,
  type ThreeGroup,
  type ThreeMesh,
  type ThreePerspectiveCamera,
  type ThreePointLight,
  type ThreePresentation,
  type ThreeScene,
} from "@poggers/kit/presentation/three";
import type { VisualValue } from "@poggers/kit/ui";

type SceneProduct = {
  Components: {
    ScenePreview: {
      Props: { accent: `#${string}` };
      State: {
        active: boolean;
        pointerX: VisualValue<"angle">;
        pointerY: VisualValue<"angle">;
        velocity: VisualValue<"number">;
      };
      Elements: {
        Root: "scene";
        Camera: "perspectiveCamera";
        Rig: "group";
        Orb: "mesh";
        Ring: "mesh";
        Fill: "ambientLight";
        Key: "pointLight";
      };
    };
  };
};

type SceneState = {
  active: boolean;
  pointerX: number;
  pointerY: number;
  velocity: number;
};

const vertexShader = `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    float wave = sin(position.y * 4.0 + uTime * 1.8) * 0.055 * uPulse;
    vec3 displaced = position + normal * wave;
    vPosition = displaced;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uGlow;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0), 2.4);
    float latitude = 0.78 + 0.22 * sin(vPosition.y * 5.0);
    vec3 color = uColor * latitude + uColor * rim * uGlow;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const sceneTheme = {
  color: {
    background: "#03050b",
    fog: "#07101b",
    orb: "#5de9ff",
    ring: "#a57bff",
    stars: "#d8f8ff",
    key: "#71dfff",
  },
  motion: {
    responsive: { spring: { mass: 1, stiffness: 420, damping: 32 } },
    camera: { spring: { mass: 1, stiffness: 260, damping: 30 } },
  },
} as const;

const scenePresentation = ((tokens) => ({
  ScenePreview({ props, state }) {
    return {
      Root: {
        kind: "scene",
        background: tokens.color.background,
        fog: { color: tokens.color.fog, near: 8, far: 18 },
        particles: {
          count: 720,
          radius: 9,
          size: 0.018,
          color: tokens.color.stars,
          seed: 19,
        },
        post: {
          bloom: { strength: state.active ? 0.72 : 0.42, radius: 0.45, threshold: 0.18 },
          exposure: state.active ? 1.15 : 1,
        },
      },
      Camera: {
        kind: "camera",
        perspective: {
          fov: {
            target: state.active ? 39 : 43,
            velocity: state.velocity,
            transition: tokens.motion.camera,
          },
          near: 0.1,
          far: 60,
        },
        transform: {
          position: {
            x: state.pointerX * 0.7,
            y: state.pointerY * 0.45,
            z: {
              target: state.active ? 5.2 : 6.2,
              velocity: state.velocity,
              transition: tokens.motion.camera,
            },
          },
        },
        lookAt: { x: 0, y: 0, z: 0 },
      },
      Rig: {
        kind: "group",
        transform: { rotation: { x: state.pointerY * 0.18, y: state.pointerX * 0.28 } },
      },
      Orb: {
        kind: "mesh",
        geometry: { kind: "icosahedron", radius: 1.25, detail: 6 },
        material: {
          kind: "shader",
          vertex: vertexShader,
          fragment: fragmentShader,
          uniforms: {
            uTime: { kind: "time", speed: 1 },
            uPulse: {
              target: state.active ? 1.65 : 0.78,
              velocity: state.velocity,
              transition: tokens.motion.responsive,
            },
            uGlow: {
              target: state.active ? 1.5 : 0.8,
              transition: tokens.motion.responsive,
            },
            uColor: props.accent,
          },
        },
        transform: {
          rotation: { x: state.pointerY * 0.25, y: state.pointerX * 0.35 },
          scale: {
            target: state.active ? 1.12 : 1,
            velocity: state.velocity,
            transition: tokens.motion.responsive,
          },
        },
      },
      Ring: {
        kind: "mesh",
        geometry: {
          kind: "torus",
          radius: 1.82,
          tube: 0.022,
          radialSegments: 16,
          tubularSegments: 160,
        },
        material: {
          kind: "standard",
          color: tokens.color.ring,
          emissive: tokens.color.ring,
          emissiveIntensity: 1.8,
          metalness: 0.45,
          roughness: 0.24,
        },
        transform: {
          rotation: { x: 1.12 + state.pointerY * 0.12, y: state.pointerX * 0.2 },
          scale: {
            target: state.active ? 1.08 : 0.94,
            velocity: state.velocity,
            transition: tokens.motion.responsive,
          },
        },
      },
      Fill: { kind: "light", color: "#8ba7ff", intensity: 0.6 },
      Key: {
        kind: "light",
        color: tokens.color.key,
        intensity: {
          target: state.active ? 42 : 24,
          velocity: state.velocity,
          transition: tokens.motion.responsive,
        },
        distance: 14,
        decay: 1.7,
        transform: { position: { x: 2.6, y: 3.2, z: 4.2 } },
      },
    };
  },
})) satisfies ThreePresentation<SceneProduct, typeof sceneTheme>;

export function mountThreeScene(canvas: HTMLCanvasElement, toggle: HTMLButtonElement): Disposable {
  let scene: ThreeScene | undefined;
  let camera: ThreePerspectiveCamera | undefined;
  let rig: ThreeGroup | undefined;
  let orb: ThreeMesh | undefined;
  let ring: ThreeMesh | undefined;
  let fill: ThreeAmbientLight | undefined;
  let key: ThreePointLight | undefined;

  <scene
    ref={(target) => {
      scene = target;
    }}
  >
    <perspectiveCamera
      ref={(target) => {
        camera = target;
      }}
    />
    <group
      ref={(target) => {
        rig = target;
      }}
    >
      <mesh
        ref={(target) => {
          orb = target;
        }}
      />
      <mesh
        ref={(target) => {
          ring = target;
        }}
      />
    </group>
    <ambientLight
      ref={(target) => {
        fill = target;
      }}
    />
    <pointLight
      ref={(target) => {
        key = target;
      }}
    />
  </scene>;

  const sceneTarget = required(scene, "Root");
  const cameraTarget = required(camera, "Camera");
  const rigTarget = required(rig, "Rig");
  const orbTarget = required(orb, "Orb");
  const ringTarget = required(ring, "Ring");
  const fillTarget = required(fill, "Fill");
  const keyTarget = required(key, "Key");

  const renderer = createThreeRenderer(canvas);
  const adapter = createThreePresentationAdapter({ renderer });
  const session = adapter.create({
    boundary: sceneTarget,
    targets: {
      Root: () => [sceneTarget],
      Camera: () => [cameraTarget],
      Rig: () => [rigTarget],
      Orb: () => [orbTarget],
      Ring: () => [ringTarget],
      Fill: () => [fillTarget],
      Key: () => [keyTarget],
    },
  });
  const state: SceneState = { active: false, pointerX: 0, pointerY: 0, velocity: 0 };
  const definition = scenePresentation(sceneTheme).ScenePreview;
  let previousActivation = performance.now();

  const commit = () => {
    session.commit(
      definition({
        props: { accent: sceneTheme.color.orb },
        state,
        targets: {
          Root: { name: "Root" },
          Camera: { name: "Camera" },
          Rig: { name: "Rig" },
          Orb: { name: "Orb" },
          Ring: { name: "Ring" },
          Fill: { name: "Fill" },
          Key: { name: "Key" },
        },
      }),
    );
  };
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    adapter.resize(bounds.width, bounds.height);
  };
  const activate = () => {
    const now = performance.now();
    state.velocity = Math.min(2, 1_000 / Math.max(120, now - previousActivation));
    previousActivation = now;
    state.active = !state.active;
    toggle.setAttribute("aria-pressed", String(state.active));
    toggle.textContent = state.active ? "Settle scene" : "Pulse scene";
    commit();
  };
  const point = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    state.pointerX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    state.pointerY = ((event.clientY - bounds.top) / bounds.height - 0.5) * -2;
    commit();
  };
  const center = () => {
    state.pointerX = 0;
    state.pointerY = 0;
    commit();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };

  canvas.addEventListener("pointermove", point);
  canvas.addEventListener("pointerleave", center);
  canvas.addEventListener("keydown", keydown);
  toggle.addEventListener("click", activate);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  commit();
  renderer.setAnimationLoop((time) => adapter.render(time));

  return {
    [Symbol.dispose]() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener("pointermove", point);
      canvas.removeEventListener("pointerleave", center);
      canvas.removeEventListener("keydown", keydown);
      toggle.removeEventListener("click", activate);
      session.dispose();
      renderer.dispose();
    },
  };
}

function required<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) {
    throw new Error(`The Three scene structure did not create Element ${JSON.stringify(name)}.`);
  }
  return value;
}
