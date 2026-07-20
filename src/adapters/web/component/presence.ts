export type ScenePresence = "entering" | "present" | "exiting" | "detached";

export type PresenceNode<Target = unknown> = {
  readonly id: string;
  readonly owner: string;
  readonly element: string;
  readonly key?: string;
  readonly children: PresenceNode<Target>[];
  parent: PresenceNode<Target> | null;
  target: Target | null;
  presence: ScenePresence;
  visible: boolean;
};

export type SceneRegistration<Target> = {
  readonly owner: string;
  readonly element: string;
  readonly key?: string;
  readonly target: Target;
  readonly parent?: PresenceNode<Target> | null;
};

export class PresenceGraph<Target = unknown> {
  readonly roots: PresenceNode<Target>[] = [];

  readonly #nodes = new Map<string, PresenceNode<Target>>();
  readonly #occurrences = new Map<string, number>();

  get size(): number {
    return this.#nodes.size;
  }

  register(registration: SceneRegistration<Target>): PresenceNode<Target> {
    const id = this.#identity(registration.owner, registration.element, registration.key);
    const existing = this.#nodes.get(id);
    if (existing) {
      existing.target = registration.target;
      existing.presence = "present";
      this.reparent(existing, registration.parent ?? null);
      return existing;
    }

    const node: PresenceNode<Target> = {
      id,
      owner: registration.owner,
      element: registration.element,
      ...(registration.key === undefined ? {} : { key: registration.key }),
      children: [],
      parent: null,
      target: registration.target,
      presence: "entering",
      visible: true,
    };
    this.#nodes.set(id, node);
    this.#attach(node, registration.parent ?? null);
    return node;
  }

  get(id: string): PresenceNode<Target> | undefined {
    return this.#nodes.get(id);
  }

  reparent(node: PresenceNode<Target>, parent: PresenceNode<Target> | null, index?: number): void {
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

  setPresence(node: PresenceNode<Target>, presence: ScenePresence): void {
    if (this.#nodes.has(node.id)) node.presence = presence;
  }

  setVisible(node: PresenceNode<Target>, visible: boolean): void {
    if (this.#nodes.has(node.id)) node.visible = visible;
  }

  detach(node: PresenceNode<Target>): void {
    if (!this.#nodes.has(node.id)) return;
    while (node.children.length) this.detach(node.children[0]!);
    this.#detachFromParent(node);
    node.target = null;
    node.presence = "detached";
    this.#nodes.delete(node.id);
  }

  dispose(): void {
    for (const node of this.#nodes.values()) {
      node.target = null;
      node.presence = "detached";
      node.children.length = 0;
      node.parent = null;
    }
    this.#nodes.clear();
    this.roots.length = 0;
  }

  #identity(owner: string, element: string, key: string | undefined): string {
    if (key !== undefined) return `${owner}/${element}:${key}`;
    const occurrenceKey = `${owner}/${element}`;
    const occurrence = this.#occurrences.get(occurrenceKey) ?? 0;
    this.#occurrences.set(occurrenceKey, occurrence + 1);
    return `${occurrenceKey}:#${occurrence}`;
  }

  #attach(node: PresenceNode<Target>, parent: PresenceNode<Target> | null, index?: number): void {
    node.parent = parent;
    const siblings = parent?.children ?? this.roots;
    siblings.splice(
      index === undefined ? siblings.length : Math.min(index, siblings.length),
      0,
      node,
    );
  }

  #detachFromParent(node: PresenceNode<Target>): void {
    const siblings = node.parent?.children ?? this.roots;
    const index = siblings.indexOf(node);
    if (index >= 0) siblings.splice(index, 1);
    node.parent = null;
  }
}

export type SceneElementRegistration = {
  readonly scene: PresenceGraph<Element>;
  readonly owner: string;
  readonly element: string;
  readonly key?: string;
};

const sceneNodes = new WeakMap<Element, PresenceNode<Element>>();
const nodeScenes = new WeakMap<PresenceNode<Element>, PresenceGraph<Element>>();

export function mountPresenceElement(
  element: Element,
  registration: SceneElementRegistration,
  host: Element | null,
): PresenceNode<Element> {
  const parent = findPresenceParent(host, registration.scene);
  const node = registration.scene.register({
    owner: registration.owner,
    element: registration.element,
    ...(registration.key === undefined ? {} : { key: registration.key }),
    target: element,
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

export function unmountPresenceElement(element: Element, scene: PresenceGraph<Element>): void {
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

function findPresenceParent(
  host: Element | null,
  scene: PresenceGraph<Element>,
): PresenceNode<Element> | null {
  for (let candidate = host; candidate; candidate = candidate.parentElement) {
    const node = sceneNodes.get(candidate);
    if (node && scene.get(node.id) === node) return node;
  }
  return null;
}
