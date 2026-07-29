import type { Dependency, DependencyImplementation } from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import type { TypeSchema } from "@/core/intrinsic";
import type { ServerDependencyProvider } from "@/platforms/server";
import type { WebDependencyProvider } from "@/platforms/web";

export type RealtimeTurnDetection =
  | Readonly<{ type: "manual" }>
  | Readonly<{
      type: "server";
      threshold?: number;
      silence?: number;
      prefixPadding?: number;
      interrupt?: boolean;
      response?: "automatic" | "controlled";
    }>
  | Readonly<{
      type: "semantic";
      eagerness?: "low" | "medium" | "high" | "automatic";
      interrupt?: boolean;
      response?: "automatic" | "controlled";
    }>;

export type RealtimeTranscription = Readonly<{
  input?: Readonly<{
    model?: string;
    language?: string;
    prompt?: string;
  }>;
  output?: boolean;
}>;

export type RealtimeCredential = Readonly<{
  token: string;
  url: string;
  protocols: readonly string[];
  expiresAt?: number;
}>;

export type RealtimeCredentials = Dependency<{
  Operations: {
    create(input: { model: string; expiresAfterSeconds?: number }): Promise<RealtimeCredential>;
  };
}>;

export type RealtimeActionDefinition = Readonly<{
  name: string;
  input: TypeSchema;
}>;

export type RealtimeSession = Readonly<{
  revision: number;
  model: string;
  instructions: string;
  voice?: string;
  output: readonly ("audio" | "text")[];
  turn: RealtimeTurnDetection;
  transcription: RealtimeTranscription;
  actions: readonly RealtimeActionDefinition[];
  recording: "none" | "input" | "output" | "both";
}>;

export type RealtimeServerEvent =
  | Readonly<{ type: "connected" }>
  | Readonly<{ type: "disconnected"; reason?: string }>
  | Readonly<{ type: "speech-started" }>
  | Readonly<{ type: "speech-stopped" }>
  | Readonly<{ type: "input-transcript-delta"; delta: string }>
  | Readonly<{ type: "input-transcript-done"; text: string }>
  | Readonly<{ type: "audio-transcript-delta"; delta: string }>
  | Readonly<{ type: "audio-transcript-done"; text: string }>
  | Readonly<{ type: "response-created" }>
  | Readonly<{ type: "response-done"; status: "completed" | "cancelled" | "failed" }>
  | Readonly<{ type: "audio-delta"; delta: string }>
  | Readonly<{
      type: "function-call";
      call: string;
      name: string;
      input: object;
    }>
  | Readonly<{ type: "error"; message: string; recoverable: boolean }>;

export type RealtimeConnection = Readonly<{
  update(session: RealtimeSession): void;
  send(input: Readonly<{ text: string }>): void;
  actionResult(input: Readonly<{ call: string; result: object }>): void;
  respond(): void;
  cancel(): void;
  close(): void;
}>;

export type RealtimeTransport = Dependency<{
  Operations: {
    open(input: {
      credential: RealtimeCredential;
      session: RealtimeSession;
      microphone?: true;
      receive(event: RealtimeServerEvent): void;
      capture?(input: { direction: "input" | "output"; contentType: string; data: string }): void;
    }): Promise<RealtimeConnection>;
  };
}>;

type RealtimeProviderFeature = Readonly<{
  Providers: {
    server: {
      credentials: ServerDependencyProvider<RealtimeCredentials>;
    };
    web: {
      realtime: WebDependencyProvider<RealtimeTransport>;
    };
  };
}>;

type GatewayClientSecretResponse = Readonly<{
  token?: string;
  expiresAt?: number | null;
}>;

const vercelRealtimeCredentialsProvider: ServerDependencyProvider<RealtimeCredentials> = {
  development({ configuration }) {
    const base = configuration.gateway ?? "https://ai-gateway.vercel.sh/v4/ai";
    const apiKey = configuration.apiKey;
    const team = configuration.team;
    return {
      async create({ input }) {
        if (!apiKey) {
          throw new Error("The Vercel realtime provider requires AI_GATEWAY_API_KEY.");
        }
        const response = await fetch(new URL("/v1/realtime/client-secrets", base), {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            ...(input.expiresAfterSeconds === undefined
              ? {}
              : { expiresIn: input.expiresAfterSeconds }),
          }),
        });
        if (!response.ok) {
          throw new Error(
            `Vercel AI Gateway returned ${response.status}: ${await response.text()}`,
          );
        }
        const value = (await response.json()) as GatewayClientSecretResponse;
        if (!value.token) throw new Error("Vercel AI Gateway returned no realtime token.");
        const url = new URL(`${base.replace(/^http/, "ws")}/realtime-model`);
        url.searchParams.set("ai-model-id", input.model);
        return {
          token: value.token,
          url: url.toString(),
          protocols: [
            "ai-gateway-realtime.v1",
            `ai-gateway-auth.${value.token}`,
            ...(team ? [`ai-gateway-team.${base64Url(team)}`] : []),
          ],
          ...(value.expiresAt == null ? {} : { expiresAt: value.expiresAt }),
        };
      },
    } satisfies DependencyImplementation<RealtimeCredentials>;
  },
  production: {
    configuration: [
      {
        name: "gateway",
        environment: "AI_GATEWAY_REALTIME_URL",
        default: "https://ai-gateway.vercel.sh/v4/ai",
      },
      {
        name: "apiKey",
        environment: "AI_GATEWAY_API_KEY",
        required: true,
      },
      {
        name: "team",
        environment: "AI_GATEWAY_TEAM",
      },
    ],
    crate: {
      package: "kit-server-model",
      directory: "./providers/server/rust",
    },
    rust: {
      type: "kit_server_model::RealtimeCredentials",
      constructor: "kit_server_model::create_realtime_credentials",
    },
  },
};

const vercelRealtimeTransportProvider: WebDependencyProvider<RealtimeTransport> = {
  requirements: {},
  development() {
    return createVercelRealtimeTransportImplementation();
  },
};

/** Ready-to-mount raw Vercel AI Gateway realtime realization for server and web. */
export const vercelAiGatewayRealtime: Feature<RealtimeProviderFeature> =
  createFeature<RealtimeProviderFeature>({
    providers: {
      server: { credentials: vercelRealtimeCredentialsProvider },
      web: { realtime: vercelRealtimeTransportProvider },
    },
  });

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

type PortableTypeData =
  | Readonly<{ kind: "primitive"; name: string }>
  | Readonly<{ kind: "literal"; value: string | number | boolean | null }>
  | Readonly<{ kind: "array"; element: PortableTypeData }>
  | Readonly<{
      kind: "record";
      fields: readonly Readonly<{
        name: string;
        optional: boolean;
        type: PortableTypeData;
      }>[];
    }>
  | Readonly<{ kind: "union"; members: readonly PortableTypeData[] }>
  | Readonly<{
      kind: "function";
      parameters: readonly Readonly<{
        name: string;
        optional: boolean;
        type: PortableTypeData;
      }>[];
      result: PortableTypeData;
    }>;

type JsonSchema = Readonly<Record<string, unknown>>;

function jsonSchema(type: PortableTypeData | undefined): JsonSchema {
  if (!type) return { type: "object", additionalProperties: false };
  if (type.kind === "primitive") {
    if (type.name === "string") return { type: "string" };
    if (type.name === "number") return { type: "number" };
    if (type.name === "boolean") return { type: "boolean" };
    return {};
  }
  if (type.kind === "literal") return { const: type.value };
  if (type.kind === "array") return { type: "array", items: jsonSchema(type.element) };
  if (type.kind === "union") return { anyOf: type.members.map(jsonSchema) };
  if (type.kind === "function") {
    const parameter = type.parameters[0];
    return parameter ? jsonSchema(parameter.type) : { type: "object", additionalProperties: false };
  }
  const properties = Object.fromEntries(
    type.fields.map((field) => [field.name, jsonSchema(field.type)]),
  );
  const required = type.fields.filter(({ optional }) => !optional).map(({ name }) => name);
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function actionJsonSchema(actions: TypeSchema, name: string): JsonSchema {
  const type = actions as PortableTypeData;
  if (type.kind !== "record") return { type: "object", additionalProperties: false };
  const action = type.fields.find((field) => field.name === name)?.type;
  return jsonSchema(action);
}

type BrowserAudio = Readonly<{
  start(stream: MediaStream): Promise<void>;
  play(data: string): void;
  interrupt(): void;
  finish(): void;
  dispose(): void;
}>;

type RealtimeWebSocket = Pick<
  WebSocket,
  "readyState" | "send" | "close" | "onopen" | "onmessage" | "onerror" | "onclose"
>;

export type VercelRealtimeTransportOptions = Readonly<{
  webSocket?(url: string, protocols: readonly string[]): RealtimeWebSocket;
  audio?(input: {
    sampleRate: number;
    send(data: string): void;
    capture(direction: "input" | "output", data: string): void;
  }): BrowserAudio;
}>;

function normalizedSession(session: RealtimeSession): object {
  const turn =
    session.turn.type === "manual"
      ? { type: "disabled" }
      : session.turn.type === "semantic"
        ? {
            type: "semantic-vad",
            createResponse: session.turn.response !== "controlled",
            interruptResponse: session.turn.interrupt ?? true,
            ...(session.turn.eagerness === undefined
              ? {}
              : {
                  eagerness:
                    session.turn.eagerness === "automatic" ? "auto" : session.turn.eagerness,
                }),
          }
        : {
            type: "server-vad",
            createResponse: session.turn.response !== "controlled",
            interruptResponse: session.turn.interrupt ?? true,
            ...(session.turn.threshold === undefined ? {} : { threshold: session.turn.threshold }),
            ...(session.turn.silence === undefined
              ? {}
              : { silenceDurationMs: session.turn.silence }),
            ...(session.turn.prefixPadding === undefined
              ? {}
              : { prefixPaddingMs: session.turn.prefixPadding }),
          };
  return {
    instructions: session.instructions,
    ...(session.voice === undefined ? {} : { voice: session.voice }),
    // Gateway realtime sessions select one generation modality. Audio sessions
    // still expose text through output transcription.
    outputModalities: session.output.includes("audio") ? ["audio"] : ["text"],
    inputAudioFormat: { type: "audio/pcm", rate: 24_000 },
    outputAudioFormat: { type: "audio/pcm", rate: 24_000 },
    ...(session.transcription.input === undefined
      ? {}
      : { inputAudioTranscription: session.transcription.input }),
    ...(session.transcription.output ? { outputAudioTranscription: {} } : {}),
    turnDetection: turn,
    tools: session.actions.map(({ name, input }) => ({
      type: "function",
      name,
      parameters: actionJsonSchema(input, name),
    })),
  };
}

function mapRealtimeEvent(value: unknown): readonly RealtimeServerEvent[] {
  if (!value || typeof value !== "object" || !("type" in value)) return [];
  const event = value as Readonly<Record<string, unknown> & { type: string }>;
  if (event.type === "session-created") return [{ type: "connected" }];
  if (event.type === "speech-started") return [{ type: "speech-started" }];
  if (event.type === "speech-stopped") return [{ type: "speech-stopped" }];
  if (event.type === "input-transcription-completed") {
    return [{ type: "input-transcript-done", text: String(event.transcript ?? "") }];
  }
  if (event.type === "audio-transcript-delta") {
    return [{ type: "audio-transcript-delta", delta: String(event.delta ?? "") }];
  }
  if (event.type === "audio-transcript-done") {
    return [{ type: "audio-transcript-done", text: String(event.transcript ?? "") }];
  }
  if (event.type === "response-created") return [{ type: "response-created" }];
  if (event.type === "response-done") {
    const status =
      event.status === "cancelled"
        ? "cancelled"
        : event.status === "failed"
          ? "failed"
          : "completed";
    return [{ type: "response-done", status }];
  }
  if (event.type === "audio-delta") {
    return [{ type: "audio-delta", delta: String(event.delta ?? "") }];
  }
  if (event.type === "function-call-arguments-done") {
    let input: object = {};
    try {
      const parsed = JSON.parse(String(event.arguments ?? "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as object;
    } catch {
      return [
        {
          type: "error",
          message: "Realtime action input is not valid JSON.",
          recoverable: false,
        },
      ];
    }
    return [
      {
        type: "function-call",
        call: String(event.callId ?? ""),
        name: String(event.name ?? ""),
        input,
      },
    ];
  }
  if (event.type === "error") {
    const detail = event.error && typeof event.error === "object" ? event.error : undefined;
    const message =
      detail && "message" in detail
        ? String(detail.message)
        : String(event.message ?? "Realtime provider error.");
    const code = detail && "code" in detail ? String(detail.code) : "";
    return [
      {
        type: "error",
        message,
        recoverable:
          code === "response_cancel_not_active" ||
          message === "Cancellation failed: no active response found" ||
          message.startsWith("Conversation already has an active response in progress:"),
      },
    ];
  }
  return [];
}

function bytesFromBase64(data: string): Uint8Array {
  const binary = atob(data);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function combineAudio(chunks: readonly string[]): string {
  const values = chunks.map(bytesFromBase64);
  const output = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return base64FromBytes(output);
}

function decodeAudio(data: string): Float32Array {
  const bytes = bytesFromBase64(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32_768;
  }
  return samples;
}

function createBrowserAudio(input: {
  sampleRate: number;
  send(data: string): void;
  capture(direction: "input" | "output", data: string): void;
}): BrowserAudio {
  let captureContext: AudioContext | undefined;
  let captureSource: MediaStreamAudioSourceNode | undefined;
  let captureProcessor: AudioWorkletNode | undefined;
  let captureSink: GainNode | undefined;
  let playbackContext: AudioContext | undefined;
  let playbackAt = 0;
  const playback = new Set<AudioBufferSourceNode>();
  return {
    async start(stream) {
      captureContext = new AudioContext({ sampleRate: input.sampleRate });
      captureSource = captureContext.createMediaStreamSource(stream);
      const source = `
        class KitRealtimePcmCapture extends AudioWorkletProcessor {
          process(inputs) {
            const samples = inputs[0] && inputs[0][0];
            if (samples && samples.length) {
              const pcm = new Int16Array(samples.length);
              for (let index = 0; index < samples.length; index += 1) {
                const sample = Math.max(-1, Math.min(1, samples[index] || 0));
                pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
              }
              this.port.postMessage(pcm.buffer, [pcm.buffer]);
            }
            return true;
          }
        }
        registerProcessor("kit-realtime-pcm-capture", KitRealtimePcmCapture);
      `;
      const module = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      try {
        await captureContext.audioWorklet.addModule(module);
      } finally {
        URL.revokeObjectURL(module);
      }
      captureProcessor = new AudioWorkletNode(captureContext, "kit-realtime-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      captureProcessor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const encoded = base64FromBytes(new Uint8Array(event.data));
        input.capture("input", encoded);
        input.send(encoded);
      };
      captureSink = captureContext.createGain();
      captureSink.gain.value = 0;
      captureSource.connect(captureProcessor);
      captureProcessor.connect(captureSink);
      captureSink.connect(captureContext.destination);
      await captureContext.resume();
    },
    play(data) {
      playbackContext ??= new AudioContext({ sampleRate: input.sampleRate });
      input.capture("output", data);
      const samples = decodeAudio(data);
      const buffer = playbackContext.createBuffer(1, samples.length, input.sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = playbackContext.createBufferSource();
      source.buffer = buffer;
      source.connect(playbackContext.destination);
      const start = Math.max(playbackAt, playbackContext.currentTime);
      source.start(start);
      playbackAt = start + buffer.duration;
      playback.add(source);
      source.onended = () => playback.delete(source);
    },
    interrupt() {
      for (const source of playback) {
        try {
          source.stop();
        } catch {
          // The source may have ended between iteration and stop.
        }
      }
      playback.clear();
      playbackAt = playbackContext?.currentTime ?? 0;
    },
    finish() {
      captureProcessor?.disconnect();
      captureProcessor?.port.close();
      captureSink?.disconnect();
      captureSource?.disconnect();
      void captureContext?.close();
      captureContext = undefined;
      captureProcessor = undefined;
      captureSink = undefined;
      captureSource = undefined;
    },
    dispose() {
      this.finish();
      this.interrupt();
      void playbackContext?.close();
      playbackContext = undefined;
    },
  };
}

/** @internal Raw normalized Gateway WebSocket realization used by the web provider and tests. */
export function createVercelRealtimeTransportImplementation(
  options: VercelRealtimeTransportOptions = {},
): DependencyImplementation<RealtimeTransport> {
  return {
    async open({ input }) {
      const inputRecording: string[] = [];
      const outputRecording: string[] = [];
      let microphone: MediaStream | undefined;
      let socket: RealtimeWebSocket | undefined;
      let recording = input.session;
      let disposed = false;
      let opened = false;
      let recordingsFlushed = false;
      let response: "idle" | "requested" | "active" = "idle";
      let responseQueued = false;
      let cancelWhenActive = false;
      const send = (event: object) => {
        if (socket?.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify(event));
      };
      const requestResponse = (replace: boolean) => {
        if (response === "idle") {
          response = "requested";
          send({ type: "response-create" });
          return;
        }
        responseQueued = true;
        if (!replace) return;
        audio.interrupt();
        if (response === "active") send({ type: "response-cancel" });
        else cancelWhenActive = true;
      };
      const cancelResponse = () => {
        responseQueued = false;
        audio.interrupt();
        if (response === "active") send({ type: "response-cancel" });
        else if (response === "requested") cancelWhenActive = true;
      };
      const audio = (options.audio ?? createBrowserAudio)({
        sampleRate: 24_000,
        send(data) {
          send({ type: "input-audio-append", audio: data });
        },
        capture(direction, data) {
          const policy = recording.recording;
          if (direction === "input" && (policy === "input" || policy === "both")) {
            inputRecording.push(data);
          }
          if (direction === "output" && (policy === "output" || policy === "both")) {
            outputRecording.push(data);
          }
        },
      });
      const flushRecordings = () => {
        if (recordingsFlushed) return;
        recordingsFlushed = true;
        const policy = recording.recording;
        if ((policy === "input" || policy === "both") && inputRecording.length) {
          input.capture?.({
            direction: "input",
            contentType: "audio/pcm;rate=24000",
            data: combineAudio(inputRecording),
          });
        }
        if ((policy === "output" || policy === "both") && outputRecording.length) {
          input.capture?.({
            direction: "output",
            contentType: "audio/pcm;rate=24000",
            data: combineAudio(outputRecording),
          });
        }
      };
      const stopMicrophone = () => {
        for (const track of microphone?.getTracks() ?? []) track.stop();
        microphone = undefined;
      };
      const update = (session: RealtimeSession) => {
        recording = session;
        send({ type: "session-update", config: normalizedSession(session) });
      };
      if (input.microphone) {
        microphone = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        try {
          await audio.start(microphone);
        } catch (error) {
          stopMicrophone();
          audio.dispose();
          throw error;
        }
      }
      try {
        socket =
          options.webSocket?.(input.credential.url, input.credential.protocols) ??
          new WebSocket(input.credential.url, [...input.credential.protocols]);
      } catch (error) {
        audio.dispose();
        stopMicrophone();
        throw error;
      }
      socket.onopen = () => {
        if (disposed) return;
        opened = true;
        update(input.session);
      };
      socket.onmessage = (message) => {
        void (async () => {
          const text =
            typeof message.data === "string"
              ? message.data
              : message.data instanceof Blob
                ? await message.data.text()
                : new TextDecoder().decode(message.data as ArrayBuffer);
          let value: unknown;
          try {
            value = JSON.parse(text);
          } catch {
            return;
          }
          for (const event of mapRealtimeEvent(value)) {
            if (event.type === "response-created") {
              response = "active";
              if (cancelWhenActive) {
                cancelWhenActive = false;
                send({ type: "response-cancel" });
              }
            }
            if (event.type === "response-done") {
              response = "idle";
              cancelWhenActive = false;
            }
            if (event.type === "audio-delta") audio.play(event.delta);
            if (event.type === "speech-started") audio.interrupt();
            input.receive(event);
            if (event.type === "response-done" && responseQueued) {
              responseQueued = false;
              requestResponse(false);
            }
          }
        })();
      };
      socket.onerror = () =>
        input.receive({
          type: "error",
          message: "WebSocket connection error.",
          recoverable: false,
        });
      socket.onclose = (event) => {
        audio.finish();
        stopMicrophone();
        flushRecordings();
        if (!disposed) {
          input.receive({
            type: "disconnected",
            reason: event.reason || `WebSocket closed with ${event.code}.`,
          });
        }
      };
      return {
        update,
        send({ text }) {
          send({
            type: "conversation-item-create",
            item: { type: "text-message", role: "user", text },
          });
          if (recording.turn.type !== "manual" && recording.turn.response !== "controlled") {
            requestResponse(true);
          }
        },
        actionResult({ call, result }) {
          send({
            type: "conversation-item-create",
            item: {
              type: "function-call-output",
              callId: call,
              output: JSON.stringify(result),
            },
          });
          requestResponse(false);
        },
        respond() {
          requestResponse(false);
        },
        cancel() {
          cancelResponse();
        },
        close() {
          if (disposed) return;
          disposed = true;
          audio.dispose();
          stopMicrophone();
          if (opened) flushRecordings();
          socket?.close();
        },
      };
    },
  };
}
