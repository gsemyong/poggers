import { resolve } from "node:path";

import { testSystem } from "kit/testing";
import { expect } from "vitest";

testSystem({
  name: "System",
  directory: resolve(import.meta.dirname, ".."),
  async verify({ location }) {
    const response = await fetch(location);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  },
});
