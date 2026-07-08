import type { App, AppSpec, Client } from "./app";
import type { ClientStore } from "./store/types";
export type ConnectOpts = {
  wsUrl: string;
  token: string;
  storage: ClientStore;
  WebSocket?: typeof WebSocket;
  reconnectMs?: number;
  persistIntervalMs?: number;
};
export declare function connect<Spec extends AppSpec>(
  app: App<Spec>,
  opts: ConnectOpts,
): Promise<Client<Spec>>;
