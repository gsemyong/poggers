export type ScenePresence = "entering" | "present" | "exiting" | "detached";

export type SceneNode<Backend = unknown> = {
  readonly id: string;
  readonly owner: string;
  readonly part: string;
  readonly key?: string;
  readonly children: SceneNode<Backend>[];
  parent: SceneNode<Backend> | null;
  backend: Backend | null;
  presence: ScenePresence;
  visible: boolean;
};

export type SceneRegistration<Backend> = {
  readonly owner: string;
  readonly part: string;
  readonly key?: string;
  readonly backend: Backend;
  readonly parent?: SceneNode<Backend> | null;
};

export class PresenceScene<Backend = unknown> {
  readonly roots: SceneNode<Backend>[] = [];

  readonly #nodes = new Map<string, SceneNode<Backend>>();
  readonly #occurrences = new Map<string, number>();

  get size(): number {
    return this.#nodes.size;
  }

  register(registration: SceneRegistration<Backend>): SceneNode<Backend> {
    const id = this.#identity(registration.owner, registration.part, registration.key);
    const existing = this.#nodes.get(id);
    if (existing) {
      existing.backend = registration.backend;
      existing.presence = "present";
      this.reparent(existing, registration.parent ?? null);
      return existing;
    }

    const node: SceneNode<Backend> = {
      id,
      owner: registration.owner,
      part: registration.part,
      ...(registration.key === undefined ? {} : { key: registration.key }),
      children: [],
      parent: null,
      backend: registration.backend,
      presence: "entering",
      visible: true,
    };
    this.#nodes.set(id, node);
    this.#attach(node, registration.parent ?? null);
    return node;
  }

  get(id: string): SceneNode<Backend> | undefined {
    return this.#nodes.get(id);
  }

  reparent(node: SceneNode<Backend>, parent: SceneNode<Backend> | null, index?: number): void {
    const siblings = parent?.children ?? this.roots;
    if (node.parent === parent) {
      if (index === undefined || siblings[index] === node) return;
      const previous = siblings.indexOf(node);
      if (previous >= 0) siblings.splice(previous, 1);
      siblings.splice(Math.min(index, siblings.length), 0, node);
      return;
    }
    this.#detachFromParent(node);
    this.#attach(node, parent, index);
  }

  setPresence(node: SceneNode<Backend>, presence: ScenePresence): void {
    if (this.#nodes.has(node.id)) node.presence = presence;
  }

  setVisible(node: SceneNode<Backend>, visible: boolean): void {
    if (this.#nodes.has(node.id)) node.visible = visible;
  }

  detach(node: SceneNode<Backend>): void {
    if (!this.#nodes.has(node.id)) return;
    for (const child of node.children) this.detach(child);
    this.#detachFromParent(node);
    node.backend = null;
    node.presence = "detached";
    this.#nodes.delete(node.id);
  }

  dispose(): void {
    for (const node of this.#nodes.values()) {
      node.backend = null;
      node.presence = "detached";
      node.children.length = 0;
      node.parent = null;
    }
    this.#nodes.clear();
    this.roots.length = 0;
  }

  #identity(owner: string, part: string, key: string | undefined): string {
    if (key !== undefined) return `${owner}/${part}:${key}`;
    const occurrenceKey = `${owner}/${part}`;
    const occurrence = this.#occurrences.get(occurrenceKey) ?? 0;
    this.#occurrences.set(occurrenceKey, occurrence + 1);
    return `${occurrenceKey}:#${occurrence}`;
  }

  #attach(node: SceneNode<Backend>, parent: SceneNode<Backend> | null, index?: number): void {
    node.parent = parent;
    const siblings = parent?.children ?? this.roots;
    siblings.splice(
      index === undefined ? siblings.length : Math.min(index, siblings.length),
      0,
      node,
    );
  }

  #detachFromParent(node: SceneNode<Backend>): void {
    const siblings = node.parent?.children ?? this.roots;
    const index = siblings.indexOf(node);
    if (index >= 0) siblings.splice(index, 1);
    node.parent = null;
  }
}

export type SceneElementRegistration = {
  readonly scene: PresenceScene<Element>;
  readonly owner: string;
  readonly part: string;
  readonly key?: string;
};

const sceneNodes = new WeakMap<Element, SceneNode<Element>>();
const nodeScenes = new WeakMap<SceneNode<Element>, PresenceScene<Element>>();

export function mountSceneElement(
  element: Element,
  registration: SceneElementRegistration,
  host: Element | null,
): SceneNode<Element> {
  const parent = findSceneParent(host, registration.scene);
  const node = registration.scene.register({
    owner: registration.owner,
    part: registration.part,
    ...(registration.key === undefined ? {} : { key: registration.key }),
    backend: element,
    parent,
  });
  sceneNodes.set(element, node);
  nodeScenes.set(node, registration.scene);
  return node;
}

export function setSceneElementPresence(element: Element, presence: ScenePresence): void {
  const node = sceneNodes.get(element);
  if (node) nodeScenes.get(node)?.setPresence(node, presence);
}

export function setSceneElementVisible(element: Element, visible: boolean): void {
  const node = sceneNodes.get(element);
  if (node) nodeScenes.get(node)?.setVisible(node, visible);
}

export function unmountSceneElement(element: Element, scene: PresenceScene<Element>): void {
  const node = sceneNodes.get(element);
  if (!node) return;
  sceneNodes.delete(element);
  scene.detach(node);
}

export function adoptSceneChildren(element: Element): void {
  const parent = sceneNodes.get(element);
  const scene = parent ? nodeScenes.get(parent) : undefined;
  if (!parent || !scene) return;
  let index = 0;
  const visit = (candidate: Element) => {
    const node = sceneNodes.get(candidate);
    if (node && node !== parent && scene.get(node.id) === node) {
      scene.reparent(node, parent, index++);
      return;
    }
    for (const child of candidate.children ?? []) visit(child);
  };
  for (const child of element.children ?? []) visit(child);
}

function findSceneParent(
  host: Element | null,
  scene: PresenceScene<Element>,
): SceneNode<Element> | null {
  for (let candidate = host; candidate; candidate = candidate.parentElement) {
    const node = sceneNodes.get(candidate);
    if (node && scene.get(node.id) === node) return node;
  }
  return null;
}
