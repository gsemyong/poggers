export const WEB_REALTIME_PATH = "/_kit/realtime";
export const WEB_REALTIME_MAX_FRAME_BYTES = 64 * 1024;

export type WebRealtimeRequestFrame = Readonly<{
  type: "request";
  id: string;
  method: string;
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
}>;

export type WebRealtimeCancelFrame = Readonly<{
  type: "cancel";
  id: string;
}>;

export type WebRealtimeClientFrame = WebRealtimeRequestFrame | WebRealtimeCancelFrame;

export type WebRealtimeResponseFrame = Readonly<{
  type: "response";
  id: string;
  status: number;
  headers: readonly (readonly [string, string])[];
}>;

export type WebRealtimeChunkFrame = Readonly<{
  type: "chunk";
  id: string;
  value: string;
}>;

export type WebRealtimeEndFrame = Readonly<{
  type: "end";
  id: string;
}>;

export type WebRealtimeErrorFrame = Readonly<{
  type: "error";
  id: string;
  message: string;
}>;

export type WebRealtimeServerFrame =
  | WebRealtimeResponseFrame
  | WebRealtimeChunkFrame
  | WebRealtimeEndFrame
  | WebRealtimeErrorFrame;

const realtimeEncoder = new TextEncoder();

/** Serializes one bounded browser-to-server frame. Large values use another Dependency. */
export function serializeWebRealtimeClientFrame(frame: WebRealtimeClientFrame): string {
  const value = JSON.stringify(frame);
  assertWebRealtimeFrameSize(value);
  return value;
}

/** Serializes and safely partitions a server body chunk into bounded text frames. */
export function serializeWebRealtimeServerFrames(frame: WebRealtimeServerFrame): readonly string[] {
  const value = JSON.stringify(frame);
  if (webRealtimeFrameBytes(value) <= WEB_REALTIME_MAX_FRAME_BYTES) return [value];
  if (frame.type !== "chunk" || frame.value.length < 2) {
    throw new TypeError("Realtime server frame exceeds the transport limit.");
  }
  let middle = Math.floor(frame.value.length / 2);
  const before = frame.value.charCodeAt(middle - 1);
  const after = frame.value.charCodeAt(middle);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    middle -= 1;
  }
  return [
    ...serializeWebRealtimeServerFrames({ ...frame, value: frame.value.slice(0, middle) }),
    ...serializeWebRealtimeServerFrames({ ...frame, value: frame.value.slice(middle) }),
  ];
}

/** Parses one bounded transport frame without assigning product meaning to it. */
export function parseWebRealtimeClientFrame(value: string): WebRealtimeClientFrame {
  assertWebRealtimeFrameSize(value);
  const frame = JSON.parse(value) as Partial<WebRealtimeClientFrame>;
  if (!frame || typeof frame !== "object" || typeof frame.id !== "string") {
    throw new TypeError("Realtime client frame is invalid.");
  }
  if (frame.type === "cancel") return { type: "cancel", id: frame.id };
  if (
    frame.type !== "request" ||
    typeof frame.method !== "string" ||
    typeof frame.path !== "string" ||
    !frame.path.startsWith("/") ||
    !frame.headers ||
    typeof frame.headers !== "object" ||
    (frame.body !== undefined && typeof frame.body !== "string")
  ) {
    throw new TypeError("Realtime request frame is invalid.");
  }
  return frame as WebRealtimeRequestFrame;
}

/** Parses one server frame before it reaches a browser Dependency implementation. */
export function parseWebRealtimeServerFrame(value: string): WebRealtimeServerFrame {
  assertWebRealtimeFrameSize(value);
  const frame = JSON.parse(value) as Partial<WebRealtimeServerFrame>;
  if (!frame || typeof frame !== "object" || typeof frame.id !== "string") {
    throw new TypeError("Realtime server frame is invalid.");
  }
  if (frame.type === "chunk" && typeof frame.value === "string") {
    return frame as WebRealtimeChunkFrame;
  }
  if (frame.type === "end") return frame as WebRealtimeEndFrame;
  if (frame.type === "error" && typeof frame.message === "string") {
    return frame as WebRealtimeErrorFrame;
  }
  if (
    frame.type === "response" &&
    typeof frame.status === "number" &&
    Array.isArray(frame.headers) &&
    frame.headers.every(
      (header) =>
        Array.isArray(header) &&
        header.length === 2 &&
        typeof header[0] === "string" &&
        typeof header[1] === "string",
    )
  ) {
    return frame as WebRealtimeResponseFrame;
  }
  throw new TypeError("Realtime server frame is invalid.");
}

function assertWebRealtimeFrameSize(value: string): void {
  if (webRealtimeFrameBytes(value) > WEB_REALTIME_MAX_FRAME_BYTES) {
    throw new TypeError("Realtime frame exceeds the transport limit.");
  }
}

function webRealtimeFrameBytes(value: string): number {
  return realtimeEncoder.encode(value).byteLength;
}
