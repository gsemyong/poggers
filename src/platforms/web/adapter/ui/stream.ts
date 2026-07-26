export type WebDeferredState<Value = unknown> =
  | Readonly<{ status: "resolved"; value: Value }>
  | Readonly<{ status: "rejected"; error: Readonly<{ message: string }> }>;

type DeferredHub = {
  states: Map<string, WebDeferredState>;
  listeners: Map<string, Set<(state: WebDeferredState) => void>>;
  claims: Map<string, number>;
  observer?: MutationObserver;
};

const hubKey = Symbol.for("kit.web.deferred");
const maximumRecordBytes = 8 * 1024 * 1024;

/** Decodes newline-framed JSON independently of transport chunk boundaries. */
export async function* readWebJSONLines(body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffered += decoder.decode(value, { stream: true });
        if (buffered.length > maximumRecordBytes && !buffered.includes("\n")) {
          throw new TypeError("Deferred stream record exceeds its size limit.");
        }
      }
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line) yield parseJSONLine(line);
        newline = buffered.indexOf("\n");
      }
      if (!done) continue;
      buffered += decoder.decode();
      if (buffered) yield parseJSONLine(buffered);
      return;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Starts the adapter-owned parser for inert deferred completion records. */
export function startWebDeferredStream(): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  const hub = deferredHub();
  if (hub.observer) return;
  processDeferredRecords(document, hub);
  hub.observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element || node instanceof DocumentFragment) {
          processDeferredRecords(node, hub);
        }
      }
    }
  });
  hub.observer.observe(document.documentElement, { childList: true, subtree: true });
}

/** Claims one boundary for reactive UI and returns any completion that arrived first. */
export function observeWebDeferredState(
  boundary: string,
  receive: (state: WebDeferredState) => void,
): Disposable {
  assertBoundary(boundary);
  const hub = deferredHub();
  const listeners = hub.listeners.get(boundary) ?? new Set();
  listeners.add(receive);
  hub.listeners.set(boundary, listeners);
  hub.claims.set(boundary, (hub.claims.get(boundary) ?? 0) + 1);
  const settled = hub.states.get(boundary);
  if (settled) {
    hub.states.delete(boundary);
    receive(settled);
  }
  let disposed = false;
  return {
    [Symbol.dispose]() {
      if (disposed) return;
      disposed = true;
      listeners.delete(receive);
      if (!listeners.size) hub.listeners.delete(boundary);
      const claims = (hub.claims.get(boundary) ?? 1) - 1;
      if (claims > 0) hub.claims.set(boundary, claims);
      else hub.claims.delete(boundary);
    },
  };
}

/** @internal Publishes a parsed completion to the reactive side of the adapter. */
export function publishWebDeferredState(boundary: string, state: WebDeferredState): void {
  assertBoundary(boundary);
  validateState(state);
  const hub = deferredHub();
  const listeners = hub.listeners.get(boundary);
  if (!listeners?.size) hub.states.set(boundary, state);
  for (const receive of listeners ?? []) receive(state);
}

function processDeferredRecords(root: ParentNode, hub: DeferredHub): void {
  const records = root.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"][data-kit-deferred-state]',
  );
  for (const record of records) {
    const boundary = record.dataset.kitDeferredState;
    if (!boundary) continue;
    try {
      assertBoundary(boundary);
      const state = JSON.parse(record.textContent ?? "") as WebDeferredState;
      validateState(state);
      const frame = document.querySelector<HTMLTemplateElement>(
        `template[data-kit-deferred-frame="${boundary}"]`,
      );
      if (!hub.claims.has(boundary) && frame) applyDeferredFrame(boundary, frame);
      publishWebDeferredState(boundary, state);
      frame?.remove();
      record.remove();
    } catch (error) {
      console.error("[kit] invalid deferred completion", error);
      record.remove();
    }
  }
}

function applyDeferredFrame(boundary: string, frame: HTMLTemplateElement): void {
  const start = document.querySelector<HTMLTemplateElement>(
    `template[data-kit-boundary-start="${boundary}"]`,
  );
  const end = document.querySelector<HTMLTemplateElement>(
    `template[data-kit-boundary-end="${boundary}"]`,
  );
  if (!start || !end || start.parentNode !== end.parentNode) return;
  let current = start.nextSibling;
  while (current && current !== end) {
    const next = current.nextSibling;
    current.parentNode?.removeChild(current);
    current = next;
  }
  end.parentNode?.insertBefore(frame.content, end);
}

function deferredHub(): DeferredHub {
  const global = globalThis as typeof globalThis & { [hubKey]?: DeferredHub };
  return (global[hubKey] ??= {
    states: new Map(),
    listeners: new Map(),
    claims: new Map(),
  });
}

function assertBoundary(boundary: string): void {
  if (!/^d\d+$/.test(boundary)) {
    throw new TypeError(`Invalid web deferred boundary ${JSON.stringify(boundary)}.`);
  }
}

function validateState(state: WebDeferredState): void {
  if (!state || typeof state !== "object") {
    throw new TypeError("Deferred completion state must be an object.");
  }
  if (state.status === "resolved") return;
  if (
    state.status !== "rejected" ||
    !state.error ||
    typeof state.error !== "object" ||
    typeof state.error.message !== "string"
  ) {
    throw new TypeError("Deferred completion state is invalid.");
  }
}

function parseJSONLine(line: string): unknown {
  if (line.length > maximumRecordBytes) {
    throw new TypeError("Deferred stream record exceeds its size limit.");
  }
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new TypeError("Deferred stream contains malformed JSON.", { cause: error });
  }
}
