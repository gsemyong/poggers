export const WEB_REALTIME_PATH = "/_kit/realtime";

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

/** Parses one bounded transport frame without assigning product meaning to it. */
export function parseWebRealtimeClientFrame(value: string): WebRealtimeClientFrame {
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
