import { afterEach, describe, expect, it, vi } from "vitest";

import { createUncheckedDependencyClient } from "@/core/dependency";
import {
  type RealtimeCredentials,
  type RealtimeServerEvent,
  type RealtimeSession,
  type RealtimeTransport,
  vercelAiGatewayRealtime,
} from "@/features/model";
import { createVercelRealtimeTransportImplementation } from "@/features/model/realtime";

const actionTypes = {
  kind: "record",
  fields: [
    {
      name: "startGame",
      optional: false,
      type: {
        kind: "function",
        parameters: [
          {
            name: "input",
            optional: false,
            type: {
              kind: "record",
              fields: [
                {
                  name: "name",
                  optional: false,
                  type: { kind: "primitive", name: "string" },
                },
              ],
            },
          },
        ],
        result: { kind: "record", fields: [] },
      },
    },
  ],
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("realtime model gateway", () => {
  it("mints a scoped Gateway credential without exposing the long-lived key", async () => {
    const requests: Readonly<{ url: string; init?: RequestInit }>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return Response.json({ token: "vcst_test", expiresAt: 4_200 });
      }),
    );
    vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
    const provider = vercelAiGatewayRealtime.providers?.server.credentials;
    if (!provider) throw new Error("Realtime credential provider is unavailable.");
    const implementation = await provider.development({
      appName: "voice-test",
      configuration: {
        apiKey: "long-lived-secret",
        gateway: "https://gateway.example/v4/ai",
        team: "product team",
      },
      origin: "http://localhost",
      allowedOrigins: [],
      sqlite() {
        throw new Error("The realtime provider does not use SQLite.");
      },
    });
    const credentials = createUncheckedDependencyClient<RealtimeCredentials>(implementation);

    await expect(
      credentials.create({
        model: "openai/gpt-realtime-mini",
        expiresAfterSeconds: 90,
      }),
    ).resolves.toEqual({
      token: "vcst_test",
      url: "wss://gateway.example/v4/ai/realtime-model?ai-model-id=openai%2Fgpt-realtime-mini",
      protocols: [
        "ai-gateway-realtime.v1",
        "ai-gateway-auth.vcst_test",
        "ai-gateway-team.cHJvZHVjdCB0ZWFt",
      ],
      expiresAt: 4_200,
    });
    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.url)).toBe("https://gateway.example/v1/realtime/client-secrets");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer long-lived-secret",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      model: "openai/gpt-realtime-mini",
      expiresIn: 90,
    });
  });

  it("speaks the normalized Gateway WebSocket protocol and maps its complete event families", async () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
    vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
    const sockets: MockSocket[] = [];
    const received: RealtimeServerEvent[] = [];
    const implementation = createVercelRealtimeTransportImplementation({
      webSocket(url, protocols) {
        const socket = new MockSocket(url, protocols);
        sockets.push(socket);
        return socket;
      },
      audio() {
        return {
          async start() {},
          play() {},
          interrupt() {},
          finish() {},
          dispose() {},
        };
      },
    });
    const transport = createUncheckedDependencyClient<RealtimeTransport>(implementation);
    const session = realtimeSession("Conversation mode.");
    const connection = await transport.open({
      credential: {
        token: "vcst_test",
        url: "wss://gateway.example/realtime",
        protocols: ["ai-gateway-realtime.v1", "ai-gateway-auth.vcst_test"],
      },
      session: { ...session, output: ["audio", "text"] },
      receive(event) {
        received.push(event);
      },
    });
    const socket = sockets[0];
    if (!socket) throw new Error("The transport did not open a socket.");
    socket.open();

    const update = JSON.parse(String(socket.sent[0])) as {
      type: string;
      config: {
        instructions: string;
        outputModalities: readonly string[];
        turnDetection: object;
        tools: readonly Readonly<{ name: string; parameters: object }>[];
      };
    };
    expect(update).toMatchObject({
      type: "session-update",
      config: {
        instructions: "Conversation mode.",
        outputModalities: ["audio"],
        turnDetection: { type: "server-vad", silenceDurationMs: 350 },
        tools: [
          {
            name: "startGame",
            parameters: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
              additionalProperties: false,
            },
          },
        ],
      },
    });

    socket.message({ type: "session-created", sessionId: "session-1" });
    socket.message({ type: "speech-started" });
    socket.message({ type: "input-transcription-completed", transcript: "Play a game." });
    socket.message({ type: "audio-transcript-delta", delta: "Let's" });
    socket.message({ type: "audio-transcript-done", transcript: "Let's play." });
    socket.message({
      type: "function-call-arguments-done",
      callId: "call-1",
      name: "startGame",
      arguments: '{"name":"Questions"}',
    });
    socket.message({ type: "response-done", responseId: "response-1", status: "completed" });
    await vi.waitFor(() => expect(received).toHaveLength(7));
    expect(received).toEqual([
      { type: "connected" },
      { type: "speech-started" },
      { type: "input-transcript-done", text: "Play a game." },
      { type: "audio-transcript-delta", delta: "Let's" },
      { type: "audio-transcript-done", text: "Let's play." },
      {
        type: "function-call",
        call: "call-1",
        name: "startGame",
        input: { name: "Questions" },
      },
      { type: "response-done", status: "completed" },
    ]);

    connection.send({ text: "Hello." });
    socket.message({ type: "response-created", responseId: "response-2" });
    connection.actionResult({ call: "call-1", result: { mode: "game" } });
    socket.message({ type: "response-done", responseId: "response-2", status: "completed" });
    socket.message({ type: "response-created", responseId: "response-3" });
    connection.cancel();
    expect(socket.sent.map((value) => JSON.parse(String(value)).type)).toEqual([
      "session-update",
      "conversation-item-create",
      "response-create",
      "conversation-item-create",
      "response-create",
      "response-cancel",
    ]);
  });

  it("serializes replacement prompts while a realtime response is being created", async () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const socket = new MockSocket("wss://gateway.example/realtime", []);
    const implementation = createVercelRealtimeTransportImplementation({
      webSocket() {
        return socket;
      },
      audio() {
        return {
          async start() {},
          play() {},
          interrupt() {},
          finish() {},
          dispose() {},
        };
      },
    });
    const transport = createUncheckedDependencyClient<RealtimeTransport>(implementation);
    const connection = await transport.open({
      credential: {
        token: "vcst_test",
        url: "wss://gateway.example/realtime",
        protocols: ["ai-gateway-realtime.v1"],
      },
      session: realtimeSession("Conversation mode."),
      receive() {},
    });
    socket.open();

    connection.respond();
    connection.send({ text: "Replace the greeting with a game." });
    expect(socket.sent.map((value) => JSON.parse(String(value)).type)).toEqual([
      "session-update",
      "response-create",
      "conversation-item-create",
    ]);

    socket.message({ type: "response-created", responseId: "response-1" });
    socket.message({ type: "response-done", responseId: "response-1", status: "cancelled" });
    expect(socket.sent.map((value) => JSON.parse(String(value)).type)).toEqual([
      "session-update",
      "response-create",
      "conversation-item-create",
      "response-cancel",
      "response-create",
    ]);
  });

  it("keeps controlled sessions silent until the durable brain requests a response", async () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const socket = new MockSocket("wss://gateway.example/realtime", []);
    const implementation = createVercelRealtimeTransportImplementation({
      webSocket() {
        return socket;
      },
      audio() {
        return {
          async start() {},
          play() {},
          interrupt() {},
          finish() {},
          dispose() {},
        };
      },
    });
    const transport = createUncheckedDependencyClient<RealtimeTransport>(implementation);
    const base = realtimeSession("Wait for the durable brain.");
    const connection = await transport.open({
      credential: {
        token: "vcst_test",
        url: "wss://gateway.example/realtime",
        protocols: ["ai-gateway-realtime.v1"],
      },
      session: {
        ...base,
        turn: { type: "semantic", interrupt: true, response: "controlled" },
      },
      receive() {},
    });
    socket.open();

    connection.send({ text: "Please revise the plan." });
    expect(socket.sent.map((value) => JSON.parse(String(value)).type)).toEqual([
      "session-update",
      "conversation-item-create",
    ]);

    connection.respond();
    expect(socket.sent.map((value) => JSON.parse(String(value)).type)).toEqual([
      "session-update",
      "conversation-item-create",
      "response-create",
    ]);
  });

  it("acquires requested media before opening a WebSocket", async () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new Error("Permission denied");
        }),
      },
    });
    let sockets = 0;
    const implementation = createVercelRealtimeTransportImplementation({
      webSocket() {
        sockets += 1;
        return new MockSocket("wss://gateway.example/realtime", []);
      },
      audio() {
        return {
          async start() {},
          play() {},
          interrupt() {},
          finish() {},
          dispose() {},
        };
      },
    });
    const transport = createUncheckedDependencyClient<RealtimeTransport>(implementation);

    await expect(
      transport.open({
        credential: {
          token: "vcst_test",
          url: "wss://gateway.example/realtime",
          protocols: ["ai-gateway-realtime.v1"],
        },
        session: realtimeSession("Conversation mode."),
        microphone: true,
        receive() {},
      }),
    ).rejects.toThrow("Permission denied");
    expect(sockets).toBe(0);
  });

  it("captures only enabled audio and flushes each direction once", async () => {
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
    vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
    const socket = new MockSocket("wss://gateway.example/realtime", []);
    const stored: Readonly<{ direction: "input" | "output"; data: string }>[] = [];
    let capture: ((direction: "input" | "output", data: string) => void) | undefined;
    const implementation = createVercelRealtimeTransportImplementation({
      webSocket() {
        return socket;
      },
      audio(input) {
        capture = input.capture;
        return {
          async start() {},
          play() {},
          interrupt() {},
          finish() {},
          dispose() {},
        };
      },
    });
    const transport = createUncheckedDependencyClient<RealtimeTransport>(implementation);
    const connection = await transport.open({
      credential: {
        token: "vcst_test",
        url: "wss://gateway.example/realtime",
        protocols: ["ai-gateway-realtime.v1"],
      },
      session: { ...realtimeSession("Conversation mode."), recording: "none" },
      receive() {},
      capture({ direction, data }) {
        stored.push({ direction, data });
      },
    });
    socket.open();
    capture?.("input", Buffer.from("ignored").toString("base64"));
    connection.update({ ...realtimeSession("Conversation mode."), recording: "both" });
    capture?.("input", Buffer.from("input").toString("base64"));
    capture?.("output", Buffer.from("output").toString("base64"));
    connection.close();
    connection.close();

    expect(stored).toEqual([
      { direction: "input", data: Buffer.from("input").toString("base64") },
      { direction: "output", data: Buffer.from("output").toString("base64") },
    ]);
  });
});

function realtimeSession(instructions: string): RealtimeSession {
  return {
    revision: 1,
    model: "openai/gpt-realtime-mini",
    instructions,
    voice: "alloy",
    output: ["audio"],
    turn: { type: "server", silence: 350, interrupt: true },
    transcription: { input: { language: "en" }, output: true },
    actions: [{ name: "startGame", input: actionTypes }],
    recording: "none",
  };
}

class MockSocket {
  readyState: 0 | 1 | 2 | 3 = 0;
  readonly sent: unknown[] = [];
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: readonly string[],
  ) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  message(value: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  send(value: unknown): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = 3;
  }
}
