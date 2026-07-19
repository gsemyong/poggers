export type ReactiveCell<Value> = {
  (): Value;
  (value: Value): void;
};

export type ReactiveCellFactory = <Value>(value: Value, path: string) => ReactiveCell<Value>;

export type ReactiveState = Readonly<{
  read: Readonly<Record<string, unknown>>;
  mutable: Record<string, unknown>;
  cells: Readonly<Record<string, ReactiveCell<unknown>>>;
  snapshot(): Record<string, unknown>;
}>;

const rawValues = new WeakMap<object, object>();

/** Creates a fixed-root state record with lazy property-level nested reactivity. */
export function createReactiveState(
  initial: Readonly<Record<string, unknown>>,
  createCell: ReactiveCellFactory,
  active: () => boolean = () => true,
): ReactiveState {
  const graph = new ReactiveObjectGraph(createCell, active);
  const source = cloneStateRecord(initial);
  const cells = Object.create(null) as Record<string, ReactiveCell<unknown>>;

  for (const [name, initialValue] of Object.entries(source)) {
    const cell = createCell(graph.wrap(initialValue, name), name);
    cells[name] = cell;
  }
  const mutable = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, name) {
      return typeof name === "string" ? cells[name]?.() : undefined;
    },
    set(_target, name, value) {
      if (typeof name !== "string") return false;
      const cell = cells[name];
      if (!cell) throw new Error(`Unknown UI state "${name}".`);
      if (active()) {
        cell(value && typeof value === "object" ? graph.wrap(value, name) : value);
      }
      return true;
    },
    ownKeys() {
      return Object.keys(cells);
    },
    getOwnPropertyDescriptor(_target, name) {
      return typeof name === "string" && Object.hasOwn(cells, name)
        ? { configurable: true, enumerable: true }
        : undefined;
    },
  });

  return {
    read: mutable,
    mutable,
    cells: Object.freeze(cells),
    snapshot() {
      return Object.fromEntries(
        Object.entries(cells).map(([name, cell]) => [name, cloneSnapshot(cell())]),
      );
    },
  };
}

class ReactiveObjectGraph {
  readonly #nodes = new WeakMap<object, ReactiveObjectNode>();
  readonly #createCell: ReactiveCellFactory;
  readonly #active: () => boolean;

  constructor(createCell: ReactiveCellFactory, active: () => boolean) {
    this.#createCell = createCell;
    this.#active = active;
  }

  wrap(value: unknown, path: string): unknown {
    if (!isTrackable(value)) return value;
    const raw = rawValues.get(value) ?? value;
    const existing = this.#nodes.get(raw);
    if (existing) return existing.proxy;

    const node = this.#createNode(raw, path);
    this.#nodes.set(raw, node);
    rawValues.set(node.proxy, raw);
    return node.proxy;
  }

  #createNode(target: object, path: string): ReactiveObjectNode {
    const cells = new Map<PropertyKey, ReactiveCell<unknown>>();
    const shape = this.#createCell(0, `${path}.*`);
    let shapeVersion = 0;
    const readCell = (property: PropertyKey): ReactiveCell<unknown> => {
      let cell = cells.get(property);
      if (!cell) {
        cell = this.#createCell(
          this.wrap(Reflect.get(target, property), childPath(path, property)),
          childPath(path, property),
        );
        cells.set(property, cell);
      }
      return cell;
    };
    const updateShape = () => shape(++shapeVersion);
    let proxy: object;

    proxy = new Proxy(target, {
      get: (_target, property, receiver) => {
        if (typeof property === "symbol") return Reflect.get(target, property, receiver);
        return readCell(property)();
      },
      set: (_target, property, value) => {
        if (!this.#active()) return true;
        const existed = Object.hasOwn(target, property);
        const previousLength = Array.isArray(target) ? target.length : undefined;
        const previous = Reflect.get(target, property);
        const raw = rawValues.get(value as object) ?? value;
        if (Object.is(previous, raw)) return true;

        const removed =
          Array.isArray(target) && property === "length" && typeof raw === "number"
            ? [...cells.keys()].filter(
                (key) => typeof key === "string" && isArrayIndex(key) && Number(key) >= raw,
              )
            : [];
        if (!Reflect.set(target, property, raw)) return false;
        cells.get(property)?.(this.wrap(raw, childPath(path, property)));

        for (const key of removed) cells.get(key)?.(undefined);
        if (!existed || removed.length) updateShape();
        if (Array.isArray(target) && property !== "length" && target.length !== previousLength) {
          cells.get("length")?.(target.length);
          updateShape();
        }
        return true;
      },
      deleteProperty: (_target, property) => {
        if (!this.#active()) return true;
        if (!Object.hasOwn(target, property)) return true;
        if (!Reflect.deleteProperty(target, property)) return false;
        cells.get(property)?.(undefined);
        updateShape();
        return true;
      },
      has: (_target, property) => {
        shape();
        return Reflect.has(target, property);
      },
      ownKeys: () => {
        shape();
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor: (_target, property) =>
        Reflect.getOwnPropertyDescriptor(target, property),
    });

    return { proxy };
  }
}

type ReactiveObjectNode = Readonly<{ proxy: object }>;

function childPath(parent: string, property: PropertyKey): string {
  return typeof property === "symbol" ? parent : `${parent}.${String(property)}`;
}

function isTrackable(value: unknown): value is object {
  if (!value || typeof value !== "object") return false;
  const raw = rawValues.get(value) ?? value;
  const prototype = Object.getPrototypeOf(raw);
  return Array.isArray(raw) || prototype === Object.prototype || prototype === null;
}

function isArrayIndex(value: string): boolean {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && String(index) === value;
}

function cloneStateRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  try {
    return structuredClone(value);
  } catch {
    return cloneSnapshot(value) as Record<string, unknown>;
  }
}

function cloneSnapshot(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = rawValues.get(value) ?? value;
  const existing = seen.get(raw);
  if (existing) return existing;
  if (!isTrackable(raw)) {
    try {
      return structuredClone(raw);
    } catch {
      return raw;
    }
  }

  const clone: unknown[] | Record<string, unknown> = Array.isArray(raw)
    ? []
    : Object.create(Object.getPrototypeOf(raw));
  seen.set(raw, clone);
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== "string") continue;
    (clone as Record<string, unknown>)[key] = cloneSnapshot(Reflect.get(raw, key), seen);
  }
  return clone;
}
