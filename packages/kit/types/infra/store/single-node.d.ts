import type { Store } from "./types";
import type { ServerAdapter, ServerPubSub, ServerSequencer } from "./adapter-types";
export declare function createSingleNodePubSub(): ServerPubSub;
export declare function createSingleNodeSequencer(): ServerSequencer;
export declare function createSingleNodeAdapter(storage: Store): ServerAdapter;
