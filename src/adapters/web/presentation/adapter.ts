import type {
  PresentationAdapter,
  PresentationAdapterSession,
  PresentationTargetResolver,
} from "../../../core/presentation";
import { compileWebStyle, type CompiledWebStyle } from "./compiler";
import type { WebPresentationLanguage, WebStyle } from "./language";

export type WebStyleHost = {
  replace(css: string): void;
  dispose(): void;
};

export type WebPresentationAdapterOptions = Readonly<{
  createStyleHost?: (boundary: Element) => WebStyleHost;
}>;

type RegistryEntry = {
  readonly css: string;
  references: number;
};

type AppliedStyle = Readonly<{
  className: string;
}>;

/** Realizes static web Presentation declarations as shared native CSS classes. */
export function createWebPresentationAdapter(
  options: WebPresentationAdapterOptions = {},
): PresentationAdapter<WebPresentationLanguage, Element> {
  const registries = new WeakMap<object, WebStyleRegistry>();

  return {
    create<const ElementName extends string>(input: {
      readonly boundary: Element;
      readonly targets: PresentationTargetResolver<ElementName, Element>;
    }): PresentationAdapterSession<WebPresentationLanguage, ElementName> {
      const key = styleScope(input.boundary);
      let registry = registries.get(key);
      if (!registry) {
        registry = new WebStyleRegistry(
          input.boundary,
          options.createStyleHost ?? createNativeStyleHost,
          () => registries.delete(key),
        );
        registries.set(key, registry);
      }
      registry.retainSession();
      return createSession(input.targets, registry);
    },
  };
}

function createSession<ElementName extends string>(
  targets: PresentationTargetResolver<ElementName, Element>,
  registry: WebStyleRegistry,
): PresentationAdapterSession<WebPresentationLanguage, ElementName> {
  const applied = new Map<Element, AppliedStyle>();
  let disposed = false;

  return {
    commit(declarations) {
      if (disposed) throw new Error("Cannot commit a disposed web Presentation session.");
      const next = resolveStyles(targets, declarations);

      for (const [target, compiled] of next) {
        const current = applied.get(target);
        if (current?.className === compiled.className) continue;
        registry.acquire(compiled);
        target.classList.add(compiled.className);
      }

      for (const [target, current] of applied) {
        const replacement = next.get(target);
        if (replacement?.className === current.className) continue;
        target.classList.remove(current.className);
        registry.release(current.className);
      }

      applied.clear();
      for (const [target, compiled] of next) applied.set(target, { className: compiled.className });
      registry.flush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [target, current] of applied) {
        target.classList.remove(current.className);
        registry.release(current.className);
      }
      applied.clear();
      registry.releaseSession();
    },
  };
}

function resolveStyles<ElementName extends string>(
  targets: PresentationTargetResolver<ElementName, Element>,
  declarations: Readonly<Partial<Record<ElementName, Readonly<WebStyle>>>>,
): Map<Element, CompiledWebStyle> {
  const result = new Map<Element, CompiledWebStyle>();
  for (const [name, source] of Object.entries(targets) as Array<
    [ElementName, () => readonly Element[]]
  >) {
    const declaration = declarations[name];
    if (!declaration) continue;
    const compiled = compileWebStyle(declaration);
    if (!compiled.css) continue;
    for (const target of source()) {
      const current = result.get(target);
      if (current && current.className !== compiled.className) {
        throw new TypeError(
          `Web Presentation target ${String(name)} resolves to an Element already styled by another target.`,
        );
      }
      result.set(target, compiled);
    }
  }
  return result;
}

class WebStyleRegistry {
  readonly #entries = new Map<string, RegistryEntry>();
  readonly #boundary: Element;
  readonly #createHost: (boundary: Element) => WebStyleHost;
  readonly #onUnused: () => void;
  #host: WebStyleHost | undefined;
  #sessions = 0;
  #dirty = false;

  constructor(
    boundary: Element,
    createHost: (boundary: Element) => WebStyleHost,
    onUnused: () => void,
  ) {
    this.#boundary = boundary;
    this.#createHost = createHost;
    this.#onUnused = onUnused;
  }

  retainSession(): void {
    this.#sessions += 1;
  }

  acquire(compiled: CompiledWebStyle): void {
    const current = this.#entries.get(compiled.className);
    if (current) {
      if (current.css !== compiled.css) {
        throw new Error(`Web Presentation class collision for ${compiled.className}.`);
      }
      current.references += 1;
      return;
    }
    this.#entries.set(compiled.className, { css: compiled.css, references: 1 });
    this.#dirty = true;
  }

  release(className: string): void {
    const current = this.#entries.get(className);
    if (!current) throw new Error(`Web Presentation class ${className} is not registered.`);
    current.references -= 1;
    if (current.references > 0) return;
    this.#entries.delete(className);
    this.#dirty = true;
  }

  flush(): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    if (!this.#entries.size) {
      this.#host?.dispose();
      this.#host = undefined;
      return;
    }
    this.#host ??= this.#createHost(this.#boundary);
    const css = [...this.#entries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => entry.css)
      .join("");
    this.#host.replace(`@layer poggers.presentation{${css}}`);
  }

  releaseSession(): void {
    this.#sessions -= 1;
    if (this.#sessions < 0) throw new Error("Web Presentation session ownership underflow.");
    this.flush();
    if (this.#sessions || this.#entries.size) return;
    this.#host?.dispose();
    this.#host = undefined;
    this.#onUnused();
  }
}

function styleScope(boundary: Element): object {
  return boundary.ownerDocument ?? boundary;
}

function createNativeStyleHost(boundary: Element): WebStyleHost {
  const ownerDocument = boundary.ownerDocument;
  if (!ownerDocument) {
    throw new Error("A web Presentation boundary must belong to a Document.");
  }
  const element = ownerDocument.createElement("style");
  element.setAttribute("data-poggers-presentation", "");
  (ownerDocument.head ?? ownerDocument.documentElement).append(element);
  return {
    replace(css) {
      element.textContent = css;
    },
    dispose() {
      element.remove();
    },
  };
}
