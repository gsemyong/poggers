import {
  AmbientLight,
  Color,
  Fog,
  Group,
  type Material,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { describe, expect, it, vi } from "vitest";

import {
  presentationAdapterConformance,
  type PresentationAdapterConformanceHarness,
} from "../../presentation.conformance";
import type { MotionBackend, MotionScheduler } from "../../web/motion";
import { createThreePresentationAdapter } from "./adapter";
import type { ThreePresentationDeclaration, ThreePresentationLanguage } from "./language";

function createScheduler(): MotionScheduler {
  return {
    now: () => 0,
    requestFrame: (callback) => callback,
    cancelFrame() {},
  };
}

function createMotionBackend(records: Array<Readonly<Record<string, unknown>>>): MotionBackend {
  return {
    create(key, initial) {
      let value = initial;
      let velocity = 0;
      return {
        read: () => value,
        velocity: () => velocity,
        write(next) {
          value = next;
          velocity = 0;
          records.push({ key, kind: "direct", value: next });
        },
        retarget(target) {
          value = target.value;
          velocity = target.velocity;
          records.push({
            key,
            kind: "target",
            value: target.value,
            velocity: target.velocity,
            transition: target.transition,
          });
          target.settled();
        },
        stop() {
          records.push({ key, kind: "stop" });
        },
        dispose() {
          records.push({ key, kind: "dispose" });
        },
      };
    },
  };
}

function createFixture() {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const rig = new Group();
  const mesh = new Mesh();
  const light = new AmbientLight();
  rig.add(mesh);
  scene.add(camera, rig, light);
  return { scene, camera, rig, mesh, light };
}

function threeConformanceHarness(): PresentationAdapterConformanceHarness<
  ThreePresentationLanguage,
  Object3D
> {
  const initial = new WeakMap<Mesh, number>();
  const applications = new WeakMap<Mesh, number>();
  const releases = new WeakMap<Mesh, number>();
  const boundaries = new WeakMap<Mesh, Scene>();
  const target = (id: string) => {
    const mesh = new Mesh();
    mesh.name = id;
    const scene = new Scene();
    scene.add(mesh);
    boundaries.set(mesh, scene);
    let x = 0;
    Object.defineProperty(mesh.position, "x", {
      configurable: true,
      get: () => x,
      set(value: number) {
        const previous = x;
        x = value;
        if (previous !== value) applications.set(mesh, (applications.get(mesh) ?? 0) + 1);
        if (value === initial.get(mesh) && previous !== value) {
          releases.set(mesh, (releases.get(mesh) ?? 0) + 1);
        }
      },
    });
    return mesh;
  };
  const adapter = createThreePresentationAdapter({ scheduler: createScheduler() });
  return {
    adapter,
    target,
    boundary: (mesh) => boundaries.get(mesh as Mesh)!,
    declaration: (value) => ({ kind: "mesh", transform: { position: { x: value } } }),
    initialize(mesh, value) {
      const target = mesh as Mesh;
      target.position.x = value;
      initial.set(target, value);
      applications.set(target, 0);
      releases.set(target, 0);
    },
    inspect: (mesh) => mesh.position.x,
    applications: (mesh) => applications.get(mesh as Mesh) ?? 0,
    releases: (mesh) => releases.get(mesh as Mesh) ?? 0,
    settle: () => adapter.flushMotion(),
  };
}

presentationAdapterConformance<ThreePresentationLanguage, Object3D>(
  "Three presentation",
  threeConformanceHarness,
);

describe("Three Presentation adapter", () => {
  it("applies typed scene declarations and retained motion to a native object graph", () => {
    const adapter = createThreePresentationAdapter({
      scheduler: createScheduler(),
    });
    const fixture = createFixture();
    const session = adapter.create({
      boundary: fixture.scene,
      targets: {
        Root: () => [fixture.scene],
        Camera: () => [fixture.camera],
        Rig: () => [fixture.rig],
        Orb: () => [fixture.mesh],
        Fill: () => [fixture.light],
      },
    });

    session.commit({
      Root: {
        kind: "scene",
        background: "#05070d",
        particles: { count: 16, radius: 4, size: 0.03, color: "#6ee7ff", seed: 7 },
      },
      Camera: {
        kind: "camera",
        perspective: { fov: 42 },
        transform: { position: { z: 6 } },
        lookAt: { x: 0, y: 0, z: 0 },
      },
      Rig: { kind: "group", transform: { rotation: { y: 0.2 } } },
      Orb: {
        kind: "mesh",
        geometry: { kind: "icosahedron", radius: 1.2, detail: 2 },
        material: {
          kind: "standard",
          color: "#6ee7ff",
          opacity: {
            target: 0.9,
            velocity: 0.4,
            transition: { spring: { stiffness: 360, damping: 28 } },
          },
          transparent: true,
        },
        transform: {
          scale: 1.15,
        },
      },
      Fill: { kind: "light", intensity: 0.65 },
    });
    adapter.flushMotion();

    expect(fixture.scene.background).not.toBeNull();
    expect(fixture.scene.getObjectByName("poggers-presentation-particles")).toBeDefined();
    expect(fixture.camera.position.z).toBe(6);
    expect(fixture.camera.fov).toBe(42);
    expect(fixture.rig.rotation.y).toBe(0.2);
    expect(fixture.mesh.scale.toArray()).toEqual([1.15, 1.15, 1.15]);
    expect(fixture.light.intensity).toBe(0.65);
    session.dispose();
  });

  it("hands explicit release velocity and spring data to the retained motion backend", () => {
    const records: Array<Readonly<Record<string, unknown>>> = [];
    const fixture = createFixture();
    const adapter = createThreePresentationAdapter({
      motionBackend: createMotionBackend(records),
      scheduler: createScheduler(),
    });
    const session = adapter.create({
      boundary: fixture.scene,
      targets: { Orb: () => [fixture.mesh] },
    });
    session.commit({
      Orb: {
        kind: "mesh",
        transform: {
          position: {
            y: {
              target: 1.25,
              velocity: 0.4,
              transition: { spring: { stiffness: 360, damping: 28 } },
            },
          },
        },
      },
    });
    adapter.flushMotion();

    expect(records).toContainEqual(
      expect.objectContaining({ kind: "target", value: 1.25, velocity: 0.4 }),
    );
    session.dispose();
  });

  it("validates the complete target snapshot before performing any writes", () => {
    const fixture = createFixture();
    const adapter = createThreePresentationAdapter({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    });
    const session = adapter.create({
      boundary: fixture.scene,
      targets: { Root: () => [fixture.scene], Orb: () => [fixture.mesh] },
    });

    expect(() =>
      session.commit({
        Root: { kind: "scene", background: "#ff0000" },
        Orb: { kind: "camera", perspective: { fov: 20 } },
      } as unknown as Record<string, ThreePresentationDeclaration>),
    ).toThrow(/does not match/);
    expect(fixture.scene.background).toBeNull();

    session.dispose();
  });

  it("replaces and disposes adapter-owned resources exactly once", () => {
    const fixture = createFixture();
    const originalGeometry = fixture.mesh.geometry;
    const originalMaterial = fixture.mesh.material;
    const adapter = createThreePresentationAdapter({
      motionBackend: createMotionBackend([]),
      scheduler: createScheduler(),
    });
    const session = adapter.create({
      boundary: fixture.scene,
      targets: { Root: () => [fixture.scene], Orb: () => [fixture.mesh] },
    });

    session.commit({
      Root: { kind: "scene", particles: { count: 8, radius: 2, size: 0.02, color: 0xffffff } },
      Orb: {
        kind: "mesh",
        geometry: { kind: "box", width: 1, height: 1, depth: 1 },
        material: { kind: "standard", color: 0xffffff },
      },
    });
    const firstGeometry = fixture.mesh.geometry;
    const firstMaterial = fixture.mesh.material as Material;
    const firstGeometryDispose = vi.spyOn(firstGeometry, "dispose");
    const firstMaterialDispose = vi.spyOn(firstMaterial, "dispose");

    session.commit({
      Root: { kind: "scene" },
      Orb: {
        kind: "mesh",
        geometry: { kind: "torus", radius: 1, tube: 0.2 },
        material: { kind: "standard", color: "#ff00ff", wireframe: true },
      },
    });
    expect(firstGeometryDispose).toHaveBeenCalledOnce();
    expect(firstMaterialDispose).toHaveBeenCalledOnce();

    const finalGeometry = fixture.mesh.geometry;
    const finalMaterial = fixture.mesh.material as Material;
    const finalGeometryDispose = vi.spyOn(finalGeometry, "dispose");
    const finalMaterialDispose = vi.spyOn(finalMaterial, "dispose");
    session.dispose();
    session.dispose();

    expect(finalGeometryDispose).toHaveBeenCalledOnce();
    expect(finalMaterialDispose).toHaveBeenCalledOnce();
    expect(fixture.mesh.geometry).toBe(originalGeometry);
    expect(fixture.mesh.material).toBe(originalMaterial);
    expect(fixture.scene.children.some((child) => child instanceof Mesh)).toBe(false);
  });

  it("treats omission and target removal as release of adapter ownership", () => {
    const records: Array<Readonly<Record<string, unknown>>> = [];
    const fixture = createFixture();
    const originalBackground = new Color("#102030");
    const originalFog = new Fog("#182838", 2, 20);
    const originalGeometry = fixture.mesh.geometry;
    const originalMaterial = fixture.mesh.material;
    fixture.scene.background = originalBackground;
    fixture.scene.fog = originalFog;
    fixture.camera.position.set(1, 2, 3);
    fixture.camera.fov = 58;
    fixture.rig.rotation.set(0.1, 0.2, 0.3);
    fixture.light.color.set("#ccddee");
    fixture.light.intensity = 0.25;

    const adapter = createThreePresentationAdapter({
      motionBackend: createMotionBackend(records),
      scheduler: createScheduler(),
    });
    const session = adapter.create({
      boundary: fixture.scene,
      targets: {
        Root: () => [fixture.scene],
        Camera: () => [fixture.camera],
        Rig: () => [fixture.rig],
        Orb: () => [fixture.mesh],
        Fill: () => [fixture.light],
      },
    });

    session.commit({
      Root: { kind: "scene", background: "#ff0000", fog: { color: "#000000", near: 1, far: 8 } },
      Camera: {
        kind: "camera",
        perspective: {
          fov: {
            target: 34,
            transition: { spring: { stiffness: 300, damping: 24 } },
          },
        },
        transform: { position: { x: 8, z: 7 } },
      },
      Rig: { kind: "group", transform: { rotation: { y: 1.2 } } },
      Orb: {
        kind: "mesh",
        geometry: { kind: "box", width: 2, height: 2, depth: 2 },
        material: { kind: "standard", color: "#00ff00", opacity: 0.4 },
      },
      Fill: { kind: "light", color: "#ff00ff", intensity: 4 },
    });
    adapter.flushMotion();

    session.commit({
      Root: { kind: "scene" },
      Camera: { kind: "camera" },
      Rig: { kind: "group" },
      Orb: { kind: "mesh" },
      Fill: { kind: "light" },
    });
    adapter.flushMotion();

    expect(fixture.scene.background).toBe(originalBackground);
    expect(fixture.scene.fog).toBe(originalFog);
    expect(fixture.camera.position.toArray()).toEqual([1, 2, 3]);
    expect(fixture.camera.fov).toBe(58);
    expect(fixture.rig.rotation.toArray().slice(0, 3)).toEqual([0.1, 0.2, 0.3]);
    expect(fixture.mesh.geometry).toBe(originalGeometry);
    expect(fixture.mesh.material).toBe(originalMaterial);
    expect(fixture.light.color.getHexString()).toBe("ccddee");
    expect(fixture.light.intensity).toBe(0.25);
    expect(records).toContainEqual(expect.objectContaining({ kind: "dispose" }));

    session.commit({});
    session.dispose();
    expect(fixture.camera.position.toArray()).toEqual([1, 2, 3]);
    expect(fixture.mesh.geometry).toBe(originalGeometry);
    expect(fixture.mesh.material).toBe(originalMaterial);
  });

  it("rejects cross-Element target ownership atomically", () => {
    const fixture = createFixture();
    const adapter = createThreePresentationAdapter();
    const session = adapter.create({
      boundary: fixture.scene,
      targets: { First: () => [fixture.mesh], Second: () => [fixture.mesh] },
    });
    expect(() => session.commit({})).toThrow(/claimed by two Elements/);
    session.dispose();
  });
});
