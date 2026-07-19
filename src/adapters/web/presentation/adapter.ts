import type {
  PresentationAdapter,
  PresentationAdapterSession,
  PresentationTargetResolver,
} from "../../../core/presentation";
import { compileWebStyle, type CompiledWebStyle } from "./compiler";
import type {
  WebAudioAsset,
  WebElementPresentation,
  WebFeedback,
  WebImageAsset,
  WebPresentationLanguage,
} from "./language";
import { createNativeMotionHost, type WebMotion, type WebMotionHost } from "./motion";

export type WebStyleHost = {
  replace(css: string): void;
  dispose(): void;
};

export type WebPresentationAdapterOptions = Readonly<{
  createStyleHost?: (boundary: Element) => WebStyleHost;
  createImageHost?: (boundary: Element) => WebImageHost;
  createFeedbackHost?: (boundary: Element) => WebFeedbackHost;
  createMotionHost?: (boundary: Element) => WebMotionHost;
}>;

export type WebImageHost = {
  set(target: Element, image: WebImageAsset | undefined): void;
  dispose(): void;
};

export type WebFeedbackHost = {
  set(target: Element, feedback: WebFeedback | undefined): void;
  dispose(): void;
};

type RegistryEntry = {
  readonly css: string;
  references: number;
};

type CompiledSource = Readonly<{
  source: Readonly<WebElementPresentation>;
  compiled: CompiledWebStyle;
}>;

type AppliedStyle = Readonly<{
  className: string;
  image?: WebImageAsset;
  feedback?: WebFeedback;
  motion?: WebMotion;
}>;

type ResolvedPresentation = Readonly<{
  compiled: CompiledWebStyle;
  image?: WebImageAsset;
  feedback?: WebFeedback;
  motion?: WebMotion;
}>;

const webReset =
  ":where(*,::before,::after){box-sizing:border-box}" +
  ":where(html,body){margin:0;min-block-size:100%}" +
  ":where(body){text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}" +
  ":where(h1,h2,h3,h4,p,figure,blockquote,dl,dd){margin:0}" +
  ":where(button,input,textarea,select){color:inherit;font:inherit}" +
  ":where(button){appearance:none}" +
  ":where(img,picture,video,canvas,svg){display:block;max-inline-size:100%}";

/** Realizes web Presentation declarations through document-scoped native hosts. */
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
          options.createImageHost ?? createNativeImageHost,
          options.createFeedbackHost ?? createNativeFeedbackHost,
          options.createMotionHost ?? createNativeMotionHost,
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
  const compiledSources = new Map<ElementName, CompiledSource>();
  let disposed = false;

  return {
    commit(declarations) {
      if (disposed) throw new Error("Cannot commit a disposed web Presentation session.");
      const next = resolveStyles(targets, declarations, compiledSources);
      const motionUpdates = new Map<Element, WebMotion | undefined>();
      for (const [target, current] of applied) {
        const replacement = next.get(target);
        const replacementClass = replacement?.compiled.css ? replacement.compiled.className : "";
        if (
          replacementClass !== current.className ||
          !sameMotion(current.motion, replacement?.motion)
        ) {
          motionUpdates.set(target, replacement?.motion);
        }
      }
      for (const [target, declaration] of next) {
        if (!applied.has(target)) motionUpdates.set(target, declaration.motion);
      }
      const measuresLayout = [...motionUpdates].some(
        ([target, motion]) => motion?.layout || applied.get(target)?.motion?.layout,
      );
      registry.beginMotion(motionUpdates);
      try {
        for (const [target, declaration] of next) {
          const { compiled, image, feedback, motion } = declaration;
          const nextClassName = compiled.css ? compiled.className : "";
          const current = applied.get(target);
          if (current?.className !== nextClassName) {
            if (nextClassName) registry.acquire(compiled);
            if (current?.className && nextClassName) {
              target.classList.replace(current.className, nextClassName);
            } else if (current?.className) {
              target.classList.remove(current.className);
            } else if (nextClassName) {
              target.classList.add(nextClassName);
            }
          }
          if (!sameImage(current?.image, image)) registry.setImage(target, image);
          if (!sameFeedback(current?.feedback, feedback)) registry.setFeedback(target, feedback);
          if (!sameMotion(current?.motion, motion)) registry.setMotion(target, motion);
        }

        for (const [target, current] of applied) {
          const replacement = next.get(target);
          const replacementClassName = replacement?.compiled.css
            ? replacement.compiled.className
            : "";
          if (replacementClassName !== current.className) {
            if (!replacement && current.className) target.classList.remove(current.className);
            if (current.className) registry.release(current.className);
          }
          if (!replacement && current.feedback) registry.setFeedback(target, undefined);
          if (!replacement && current.image) registry.setImage(target, undefined);
          if (!replacement && current.motion) registry.setMotion(target, undefined);
        }

        if (measuresLayout) registry.flushStylesNow();
        applied.clear();
        for (const [target, { compiled, image, feedback, motion }] of next) {
          applied.set(target, {
            className: compiled.css ? compiled.className : "",
            image,
            feedback,
            motion,
          });
        }
      } finally {
        registry.completeMotion();
      }
      registry.scheduleFlush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [target, current] of applied) {
        if (current.className) {
          target.classList.remove(current.className);
          registry.release(current.className);
        }
        if (current.image) registry.setImage(target, undefined);
        if (current.feedback) registry.setFeedback(target, undefined);
        if (current.motion) registry.setMotion(target, undefined);
      }
      applied.clear();
      registry.releaseSession();
    },
  };
}

function resolveStyles<ElementName extends string>(
  targets: PresentationTargetResolver<ElementName, Element>,
  declarations: Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>,
  compiledSources: Map<ElementName, CompiledSource>,
): Map<Element, ResolvedPresentation> {
  const result = new Map<Element, ResolvedPresentation>();
  for (const [name, source] of Object.entries(targets) as Array<
    [ElementName, () => readonly Element[]]
  >) {
    const declaration = declarations[name];
    if (!declaration) continue;
    const cached = compiledSources.get(name);
    validateMotionOwnership(declaration);
    const compiled =
      cached?.source === declaration ? cached.compiled : compileWebStyle(declaration);
    if (cached?.source !== declaration)
      compiledSources.set(name, { source: declaration, compiled });
    for (const target of source()) {
      const current = result.get(target);
      if (
        current &&
        (current.compiled.className !== compiled.className ||
          !sameImage(current.image, declaration.image) ||
          !sameFeedback(current.feedback, declaration.feedback) ||
          !sameMotion(current.motion, declaration.motion))
      ) {
        throw new TypeError(
          `Web Presentation target ${String(name)} resolves to an Element already styled by another target.`,
        );
      }
      result.set(target, {
        compiled,
        image: declaration.image,
        feedback: declaration.feedback,
        motion: declaration.motion,
      });
    }
  }
  return result;
}

class WebStyleRegistry {
  readonly #entries = new Map<string, RegistryEntry>();
  readonly #boundary: Element;
  readonly #createHost: (boundary: Element) => WebStyleHost;
  readonly #createImageHost: (boundary: Element) => WebImageHost;
  readonly #createFeedbackHost: (boundary: Element) => WebFeedbackHost;
  readonly #createMotionHost: (boundary: Element) => WebMotionHost;
  readonly #onUnused: () => void;
  #host: WebStyleHost | undefined;
  #imageHost: WebImageHost | undefined;
  #feedbackHost: WebFeedbackHost | undefined;
  #motionHost: WebMotionHost | undefined;
  #sessions = 0;
  #dirty = false;
  #scheduled = false;
  #emitted = "";

  constructor(
    boundary: Element,
    createHost: (boundary: Element) => WebStyleHost,
    createImageHost: (boundary: Element) => WebImageHost,
    createFeedbackHost: (boundary: Element) => WebFeedbackHost,
    createMotionHost: (boundary: Element) => WebMotionHost,
    onUnused: () => void,
  ) {
    this.#boundary = boundary;
    this.#createHost = createHost;
    this.#createImageHost = createImageHost;
    this.#createFeedbackHost = createFeedbackHost;
    this.#createMotionHost = createMotionHost;
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
    if (current.references < 0) {
      throw new Error(`Web Presentation class ${className} ownership underflow.`);
    }
  }

  scheduleFlush(): void {
    if (this.#scheduled || !this.#dirty) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#flush();
    });
  }

  setFeedback(target: Element, feedback: WebFeedback | undefined): void {
    if (feedback) {
      this.#feedbackHost ??= this.#createFeedbackHost(this.#boundary);
      this.#feedbackHost.set(target, feedback);
    } else {
      this.#feedbackHost?.set(target, undefined);
    }
  }

  setImage(target: Element, image: WebImageAsset | undefined): void {
    if (image) {
      this.#imageHost ??= this.#createImageHost(this.#boundary);
      this.#imageHost.set(target, image);
    } else {
      this.#imageHost?.set(target, undefined);
    }
  }

  setMotion(target: Element, motion: WebMotion | undefined): void {
    if (motion) {
      this.#motionHost ??= this.#createMotionHost(this.#boundary);
      this.#motionHost.set(target, motion);
    } else {
      this.#motionHost?.set(target, undefined);
    }
  }

  beginMotion(updates: ReadonlyMap<Element, WebMotion | undefined>): void {
    const needsMotion = [...updates.values()].some(Boolean);
    if (needsMotion) this.#motionHost ??= this.#createMotionHost(this.#boundary);
    this.#motionHost?.begin(updates);
  }

  completeMotion(): void {
    this.#motionHost?.complete();
  }

  flushStylesNow(): void {
    this.#flush();
  }

  #flush(): void {
    if (!this.#dirty || !this.#sessions) return;
    this.#dirty = false;
    this.#host ??= this.#createHost(this.#boundary);
    const css = [...this.#entries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => entry.css)
      .join("");
    const emitted =
      `@layer poggers.reset,poggers.presentation;@layer poggers.reset{${webReset}}` +
      `@layer poggers.presentation{${css}}`;
    if (emitted === this.#emitted) return;
    this.#emitted = emitted;
    this.#host.replace(emitted);
  }

  releaseSession(): void {
    this.#sessions -= 1;
    if (this.#sessions < 0) throw new Error("Web Presentation session ownership underflow.");
    if (this.#sessions) {
      this.scheduleFlush();
      return;
    }
    this.#host?.dispose();
    this.#imageHost?.dispose();
    this.#feedbackHost?.dispose();
    this.#motionHost?.dispose();
    this.#host = undefined;
    this.#imageHost = undefined;
    this.#feedbackHost = undefined;
    this.#motionHost = undefined;
    this.#entries.clear();
    this.#dirty = false;
    this.#emitted = "";
    this.#onUnused();
  }
}

function sameImage(left: WebImageAsset | undefined, right: WebImageAsset | undefined): boolean {
  return left?.source === right?.source;
}

function sameFeedback(left: WebFeedback | undefined, right: WebFeedback | undefined): boolean {
  return left?.activate?.audio === right?.activate?.audio;
}

function sameMotion(left: WebMotion | undefined, right: WebMotion | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    sameStructuredValue(left.opacity, right.opacity) &&
    sameStructuredValue(left.transform, right.transform) &&
    sameStructuredValue(left.layout, right.layout) &&
    sameStructuredValue(left.presence, right.presence)
  );
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value]) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameStructuredValue(value, (right as Record<string, unknown>)[key]),
    )
  );
}

function validateMotionOwnership(declaration: WebElementPresentation): void {
  if (!declaration.motion) return;
  const fragments = [declaration, ...(declaration.rules?.map((rule) => rule.use) ?? [])];
  if (
    declaration.motion.opacity &&
    fragments.some((fragment) => fragment.paint?.opacity !== undefined)
  ) {
    throw new TypeError(
      "A web Presentation target cannot assign opacity through both style and motion.",
    );
  }
  if (declaration.motion.transform && fragments.some((fragment) => fragment.transform)) {
    throw new TypeError(
      "A web Presentation target cannot assign transform through both style and motion.",
    );
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

/** @internal Native resource owner used by web image declarations. */
export function createNativeImageHost(boundary: Element): WebImageHost {
  if (!boundary.ownerDocument) {
    throw new Error("A web image boundary must belong to a Document.");
  }
  const originals = new Map<Element, string | null>();
  let disposed = false;

  const restore = (target: Element) => {
    if (!originals.has(target)) return;
    const original = originals.get(target) as string | null;
    if (original === null) target.removeAttribute("src");
    else target.setAttribute("src", original);
    originals.delete(target);
  };

  return {
    set(target, image) {
      if (disposed) throw new Error("Cannot update a disposed web image host.");
      if (!image) {
        restore(target);
        return;
      }
      if (target.localName !== "img") {
        throw new TypeError("A web image declaration can only target an img Element.");
      }
      if (!originals.has(target)) originals.set(target, target.getAttribute("src"));
      if (target.getAttribute("src") !== image.source) target.setAttribute("src", image.source);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const target of originals.keys()) restore(target);
    },
  };
}

export type WebAudioOutput = {
  prepare(asset: WebAudioAsset): void;
  play(asset: WebAudioAsset): void;
  dispose(): void;
};

/** @internal Exposed from this module only so native activation semantics stay deterministic. */
export function createNativeFeedbackHost(
  boundary: Element,
  output?: WebAudioOutput,
): WebFeedbackHost {
  const ownerDocument = boundary.ownerDocument;
  if (!ownerDocument) {
    throw new Error("A web feedback boundary must belong to a Document.");
  }
  const audio = output ?? createNativeAudioOutput(ownerDocument);
  const declarations = new Map<Element, WebFeedback>();
  const pointerActivations = new Map<Element, ReturnType<typeof setTimeout>>();

  const resolve = (event: Event): readonly [Element, WebFeedback] | undefined => {
    for (const candidate of event.composedPath()) {
      const target = candidate as Element;
      const declaration = declarations.get(target);
      if (declaration) return [target, declaration];
    }
    return undefined;
  };
  const play = (declaration: WebFeedback) => {
    const asset = declaration.activate?.audio;
    if (asset) audio.play(asset);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const resolved = resolve(event);
    if (!resolved || interactionDisabled(resolved[0])) return;
    const [target, declaration] = resolved;
    const previous = pointerActivations.get(target);
    if (previous !== undefined) clearTimeout(previous);
    pointerActivations.set(
      target,
      setTimeout(() => pointerActivations.delete(target), 1_000),
    );
    play(declaration);
  };
  const onClick = (event: MouseEvent) => {
    const resolved = resolve(event);
    if (!resolved || interactionDisabled(resolved[0])) return;
    const [target, declaration] = resolved;
    const timeout = pointerActivations.get(target);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      pointerActivations.delete(target);
      if (event.detail > 0) return;
    }
    play(declaration);
  };

  ownerDocument.addEventListener("pointerdown", onPointerDown, true);
  ownerDocument.addEventListener("click", onClick, true);
  let disposed = false;
  return {
    set(target, feedback) {
      if (disposed) throw new Error("Cannot update a disposed web feedback host.");
      if (feedback) {
        declarations.set(target, feedback);
        const asset = feedback.activate?.audio;
        if (asset) audio.prepare(asset);
      } else {
        declarations.delete(target);
        const timeout = pointerActivations.get(target);
        if (timeout !== undefined) clearTimeout(timeout);
        pointerActivations.delete(target);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
      ownerDocument.removeEventListener("click", onClick, true);
      for (const timeout of pointerActivations.values()) clearTimeout(timeout);
      pointerActivations.clear();
      declarations.clear();
      audio.dispose();
    },
  };
}

/** @internal Native resource owner used by the web feedback host. */
export function createNativeAudioOutput(ownerDocument: Document): WebAudioOutput {
  const buffers = new Map<string, Promise<AudioBuffer>>();
  const sources = new Map<AudioBufferSourceNode, GainNode | undefined>();
  let context: AudioContext | undefined;
  let disposed = false;

  const getContext = (): AudioContext => {
    if (disposed) throw new Error("The web audio output is disposed.");
    if (context) return context;
    const Constructor = ownerDocument.defaultView?.AudioContext ?? globalThis.AudioContext;
    if (!Constructor) throw new Error("Web Audio is not supported in this environment.");
    context = new Constructor({ latencyHint: "interactive" });
    return context;
  };
  const load = (asset: WebAudioAsset): Promise<AudioBuffer> => {
    let pending = buffers.get(asset.source);
    if (pending) return pending;
    pending = fetch(asset.source)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load web audio asset ${asset.source}.`);
        return response.arrayBuffer();
      })
      .then((encoded) => getContext().decodeAudioData(encoded));
    pending.catch(() => undefined);
    buffers.set(asset.source, pending);
    return pending;
  };

  return {
    prepare(asset) {
      if (!disposed) load(asset);
    },
    play(asset) {
      if (disposed) return;
      let audioContext: AudioContext;
      try {
        audioContext = getContext();
        if (audioContext.state !== "running") void audioContext.resume().catch(() => undefined);
      } catch {
        return;
      }
      void load(asset)
        .then((buffer) => {
          if (disposed || audioContext.state === "closed") return;
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          if (asset.playbackRate !== undefined) source.playbackRate.value = asset.playbackRate;
          let gain: GainNode | undefined;
          if (asset.gain !== undefined && asset.gain !== 1) {
            gain = audioContext.createGain();
            gain.gain.value = asset.gain;
            source.connect(gain).connect(audioContext.destination);
          } else {
            source.connect(audioContext.destination);
          }
          sources.set(source, gain);
          source.addEventListener(
            "ended",
            () => {
              sources.delete(source);
              source.disconnect();
              gain?.disconnect();
            },
            { once: true },
          );
          source.start();
        })
        .catch(() => undefined);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      buffers.clear();
      for (const [source, gain] of sources) {
        try {
          source.stop();
        } catch {
          // A source that already ended needs no further work.
        }
        source.disconnect();
        gain?.disconnect();
      }
      sources.clear();
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
      context = undefined;
    },
  };
}

function interactionDisabled(target: Element): boolean {
  for (let current: Element | null = target; current; current = current.parentElement) {
    if ("disabled" in current && Boolean((current as HTMLButtonElement).disabled)) return true;
    if (current.getAttribute("aria-disabled") === "true" || current.hasAttribute("inert")) {
      return true;
    }
  }
  return false;
}
