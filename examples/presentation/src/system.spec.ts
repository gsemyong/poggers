import { testSystem } from "kit/testing";
import { expect } from "vitest";

testSystem({
  name: "Presentation System",
  directory: new URL("..", import.meta.url),
  async verify({ location }) {
    const response = await fetch(location);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const document = await response.text();
    expect(document).toContain('<div id="app"');
    expect(document).toContain("<style");
    const entry = document.match(/<script[^>]+src="([^"]+)"/)?.[1];
    expect(entry).toBeDefined();
    const asset = await fetch(new URL(entry!, location));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
  },
});
