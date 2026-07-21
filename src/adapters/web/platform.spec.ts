import { afterEach, describe, expect, test, vi } from "vitest";

import { createWebHost } from "@/adapters/web/platform";

afterEach(() => vi.unstubAllGlobals());

describe("web Platform host", () => {
  test("creates only the Capabilities required by one Program instance", () => {
    const added: string[] = [];
    const removed: string[] = [];
    vi.stubGlobal("location", new URL("http://localhost:3000/tasks"));
    vi.stubGlobal("addEventListener", (name: string) => added.push(name));
    vi.stubGlobal("removeEventListener", (name: string) => removed.push(name));

    expect(createWebHost({ capabilities: [] })).toEqual({});
    expect(added).toEqual([]);

    const host = createWebHost({ capabilities: ["navigation"] });
    expect(Object.keys(host)).toEqual(["navigation"]);
    expect(added).toEqual(["popstate"]);
    (host.navigation as Navigation & Disposable)[Symbol.dispose]();
    expect(removed).toEqual(["popstate"]);
  });
});

type Navigation = ReturnType<typeof createWebHost>["navigation"];
