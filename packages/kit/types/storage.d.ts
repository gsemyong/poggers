import type { Snapshot } from "./protocol";
export type ClientStore = {
  loadSnapshot(): Promise<unknown> | unknown;
  saveSnapshot(snapshot: unknown): Promise<void> | void;
};
export interface Store {
  loadSnapshot(key: string): Snapshot | null;
  saveSnapshot(key: string, snapshot: Snapshot): void;
  appendEvents(key: string, events: unknown[], commandId?: string): void;
  getEvents(key: string): unknown[];
  compactEvents(key: string, throughSeq: number): void;
  saveCommandId(scopeId: string, commandId: string): void;
  getCommandIds(scopeId: string): Set<string>;
  clearCommandIds(scopeId: string): void;
}
export declare function createFileClientStore(snapshotPath: string): ClientStore;
export declare function createFileStore(baseDir: string): Store;
export declare function createBrowserStore(opts?: { dbName?: string }): ClientStore;
