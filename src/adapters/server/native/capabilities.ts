import { resolve } from "node:path";

import {
  defineNativeCapabilityAdapter,
  type NativeCapabilityAdapter,
  type NativeOperationContract,
  type NativeTypeContract,
} from "@/contracts/native";

const directory = (name: string): string => resolve(import.meta.dirname, "capabilities", name);
const operation = (
  name: string,
  mode: NativeOperationContract["mode"],
  input: NativeTypeContract,
  output: NativeTypeContract,
): NativeOperationContract => ({ name, mode, input, output });
const any = { kind: "any" } as const;
const number = { kind: "primitive", name: "number" } as const;
const string = { kind: "primitive", name: "string" } as const;
const field = (name: string, type: NativeTypeContract, optional = false) => ({
  name,
  optional,
  type,
});
const record = (fields: readonly ReturnType<typeof field>[], open = false): NativeTypeContract => ({
  kind: "record",
  fields,
  ...(open ? { open: true } : {}),
});
const array = (element: NativeTypeContract): NativeTypeContract => ({ kind: "array", element });
const option = (value: NativeTypeContract): NativeTypeContract => ({ kind: "option", value });
const stream = (element: NativeTypeContract): NativeTypeContract => ({ kind: "stream", element });
const promise = (value: NativeTypeContract): NativeTypeContract => ({ kind: "promise", value });
const function_ = (
  parameters: readonly NativeTypeContract[],
  result: NativeTypeContract,
): NativeTypeContract => ({
  kind: "function",
  parameters: parameters.map((type) => ({ optional: false, type })),
  result,
});
const empty = record([]);
const header = record([field("name", string), field("value", string)]);
const request = record([
  field("body", string),
  field("headers", array(header)),
  field("method", string),
  field("path", string),
  field("query", array(header)),
]);
const response = record([
  field("body", option(string)),
  field("headers", array(header)),
  field("status", number),
  field("stream", option(stream(string))),
]);
const user = record([field("email", string), field("id", string), field("name", string)]);
const persistedEvent = record([
  field("event", any),
  field("revision", number),
  field("stream", string),
]);

export const nativeClock = defineNativeCapabilityAdapter({
  name: "clock",
  platform: "server",
  contract: {
    name: "clock",
    operations: [operation("now", "synchronous", empty, number)],
  },
  configuration: [],
  crate: { package: "poggers-native-clock", directory: directory("clock") },
  rust: { type: "poggers_native_clock::Clock", constructor: "poggers_native_clock::create" },
});

export const nativeIdentifiers = defineNativeCapabilityAdapter({
  name: "identifiers",
  platform: "server",
  contract: {
    name: "identifiers",
    operations: [operation("create", "synchronous", empty, string)],
  },
  configuration: [],
  crate: { package: "poggers-native-identifiers", directory: directory("identifiers") },
  rust: {
    type: "poggers_native_identifiers::Identifiers",
    constructor: "poggers_native_identifiers::create",
  },
});

export const nativeEvents = defineNativeCapabilityAdapter({
  name: "events-sqlite",
  platform: "server",
  contract: {
    name: "events",
    operations: [
      operation(
        "append",
        "asynchronous",
        record([
          field("events", array(any)),
          field("expectedRevision", number),
          field("stream", string),
        ]),
        option(array(persistedEvent)),
      ),
      operation(
        "read",
        "asynchronous",
        record([field("after", number, true), field("stream", string)]),
        array(persistedEvent),
      ),
      operation(
        "subscribe",
        "stream",
        record([field("after", number, true), field("stream", string)]),
        persistedEvent,
      ),
    ],
  },
  configuration: [
    {
      name: "database",
      environment: "POGGERS_DATABASE",
      default: ".data/application.sqlite",
    },
  ],
  crate: { package: "poggers-native-events", directory: directory("events") },
  rust: { type: "poggers_native_events::Events", constructor: "poggers_native_events::create" },
});

export const nativeJetStreamEvents = defineNativeCapabilityAdapter({
  ...nativeEvents,
  name: "events-jetstream",
  configuration: [
    { name: "servers", environment: "NATS_URL", default: "nats://127.0.0.1:4222" },
    { name: "stream", environment: "POGGERS_EVENT_STREAM", default: "POGGERS_EVENTS" },
  ],
  crate: {
    package: "poggers-native-events-jetstream",
    directory: directory("events-jetstream"),
  },
  rust: {
    type: "poggers_native_events_jetstream::Events",
    constructor: "poggers_native_events_jetstream::create",
  },
});

export const nativeAuthentication = defineNativeCapabilityAdapter({
  name: "authentication",
  platform: "server",
  contract: {
    name: "authentication",
    operations: [
      operation(
        "authenticate",
        "asynchronous",
        record([field("cookie", string, true)]),
        option(user),
      ),
      operation(
        "handle",
        "asynchronous",
        record([field("path", string), field("request", request)]),
        response,
      ),
    ],
  },
  configuration: [
    {
      name: "database",
      environment: "POGGERS_DATABASE",
      default: ".data/application.sqlite",
    },
  ],
  crate: {
    package: "poggers-native-authentication",
    directory: directory("authentication"),
  },
  rust: {
    type: "poggers_native_authentication::Authentication",
    constructor: "poggers_native_authentication::create",
  },
});

export const nativeHttp = defineNativeCapabilityAdapter({
  name: "http",
  platform: "server",
  contract: {
    name: "http",
    operations: [
      operation(
        "route",
        "synchronous",
        record([field("handle", function_([request], promise(response))), field("path", string)]),
        { kind: "opaque", name: "Disposable" },
      ),
    ],
  },
  configuration: [
    { name: "host", environment: "HOST", default: "127.0.0.1" },
    { name: "port", environment: "PORT", default: "3010" },
    {
      name: "webOrigin",
      environment: "POGGERS_WEB_ORIGIN",
      default: "http://localhost:3000",
    },
    { name: "webRoot", environment: "POGGERS_WEB_ROOT" },
  ],
  crate: { package: "poggers-native-http", directory: directory("http") },
  rust: { type: "poggers_native_http::Http", constructor: "poggers_native_http::create" },
});

export const nativeServerCapabilities: readonly NativeCapabilityAdapter[] = Object.freeze([
  nativeAuthentication,
  nativeClock,
  nativeEvents,
  nativeHttp,
  nativeIdentifiers,
]);
