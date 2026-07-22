import { testApplication } from "@poggers/kit/testing";
import { expect } from "vitest";

testApplication({
  name: "application",
  async verify({ location }) {
    const response = await fetch(location);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  },
});
