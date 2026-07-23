import { testSystem } from "@poggers/kit/testing";
import { expect } from "vitest";

const referenceDocuments = new Map<string, string>();

testSystem({
  name: "request-rendered web System",
  directory: new URL("..", import.meta.url).pathname,
  async verify({ location, locations, realization, metrics }) {
    const productLocation = locations["interface/product.web"]?.[0] ?? location;
    const adminLocation = locations["interface/product.admin"]?.[0];
    expect(adminLocation).toBeTruthy();
    expect(adminLocation).not.toBe(productLocation);
    expect(locations["program/server"]).toHaveLength(1);
    const request = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${productLocation}${path}`, {
        ...init,
        headers: { accept: "text/html", ...init.headers },
      });
      return response;
    };
    const admin = await fetch(`${adminLocation}/`, {
      headers: { accept: "text/html" },
    });
    const adminHtml = await admin.text();
    expect(
      admin.status,
      `${adminLocation}\n${admin.url}\n${JSON.stringify(locations)}\n${adminHtml}`,
    ).toBe(200);
    expect(adminHtml).toContain("<title>Admin</title>");
    expect(adminHtml).toContain('data-poggers-rendering="client"');
    expect(adminHtml).not.toContain("Administration");
    expect(adminHtml).not.toContain('data-interface="admin"');

    const adminManifest = await fetch(`${adminLocation}/manifest.webmanifest`);
    expect(adminManifest.status).toBe(200);
    expect(await adminManifest.json()).toMatchObject({
      name: "Web request conformance",
      short_name: "Admin",
      start_url: "/",
      scope: "/",
    });

    const workerPath =
      realization === "production" ? "/service-worker.js" : "/service-worker.generated.ts";
    const [productWorker, adminWorker] = await Promise.all([
      fetch(`${productLocation}${workerPath}`).then((response) => response.text()),
      fetch(`${adminLocation}${workerPath}`).then((response) => response.text()),
    ]);
    expect(productWorker).toContain("poggers-assets-");
    expect(adminWorker).toContain("poggers-assets-");
    expect(adminWorker).not.toBe(productWorker);

    const defaultGreeting = await request("/hello/Ada");
    const defaultHtml = await defaultGreeting.text();
    expect(defaultGreeting.status, defaultHtml).toBe(200);
    expect(defaultGreeting.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(defaultGreeting.headers.get("cache-control")).toBe("no-store");
    expect(defaultGreeting.headers.get("x-poggers-cache")).toBe("bypass");
    expect(defaultGreeting.headers.get("x-content-type-options")).toBe("nosniff");
    expect(defaultGreeting.headers.get("x-request-id")).toBeTruthy();
    expect(defaultHtml).toContain("<title>Greeting</title>");
    expect(defaultHtml).toContain('name="description" content="A request-rendered greeting"');
    expect(defaultHtml).toContain('rel="alternate" hreflang="sk" href="/sk/hello"');
    expect(defaultHtml).toContain('property="og:type" content="website"');
    expect(defaultHtml).toContain('name="twitter:card" content="summary_large_image"');
    expect(defaultHtml).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(defaultHtml).toContain('type="application/ld+json"');
    expect(defaultHtml).toContain("Hello, Ada!");
    expect(defaultHtml).toContain('data-poggers-rendering="hydrate"');
    expect(hydration(defaultHtml)).toEqual({
      loader: false,
      location: "/hello/Ada",
      metadata: {
        alternates: [{ language: "sk", href: "/sk/hello" }],
        description: "A request-rendered greeting",
        icons: [{ url: "data:image/svg+xml,%3Csvg%2F%3E", type: "image/svg+xml" }],
        language: "en",
        manifest: "/manifest.webmanifest",
        social: {
          type: "website",
          card: "summary_large_image",
          images: [
            {
              url: "https://example.test/greeting.jpg",
              alt: "Greeting preview",
              width: 1200,
              height: 630,
            },
          ],
        },
        structuredData: [
          { "@context": "https://schema.org", "@type": "WebPage", name: "Greeting" },
        ],
        title: "Greeting",
      },
      params: { name: "Ada" },
      route: { feature: "product.web.greeting", name: "greeting" },
      search: { punctuation: "!" },
      version: 1,
    });
    expectDocumentParity(realization, "default", defaultHtml);

    const markdownResponse = await request("/hello/Ada", {
      headers: { accept: "text/markdown" },
    });
    const markdown = await markdownResponse.text();
    expect(markdownResponse.status).toBe(200);
    expect(markdownResponse.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(markdownResponse.headers.get("vary")).toContain("Accept");
    expect(markdown).toContain('title: "Greeting"');
    expect(markdown).toContain("Hello, Ada!");

    const manifestResponse = await fetch(`${productLocation}/manifest.webmanifest`);
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get("content-type")).toContain("application/manifest+json");
    expect(await manifestResponse.json()).toMatchObject({
      name: "Web request conformance",
      short_name: "Conformance",
      start_url: "/client",
      scope: "/",
    });

    const searched = await request("/hello/Ada?punctuation=%3F");
    const searchedHtml = await searched.text();
    expect(searched.status).toBe(200);
    expect(searchedHtml).toContain("Hello, Ada?");
    expect(hydration(searchedHtml)).toMatchObject({
      location: "/hello/Ada?punctuation=%3F",
      search: { punctuation: "?" },
    });
    expectDocumentParity(realization, "search", searchedHtml);

    const escaped = await request("/hello/%3Cscript%3E");
    const escapedHtml = await escaped.text();
    expect(escaped.status).toBe(200);
    expect(escapedHtml).toContain("Hello, &lt;script&gt;!");
    expect(escapedHtml).not.toContain("Hello, <script>!");

    const loaded = await request("/loaded/Ada");
    const loadedHtml = await loaded.text();
    expect(loaded.status).toBe(200);
    expect(loadedHtml).toContain("<title>Loaded Ada</title>");
    expect(loadedHtml).toContain("Loaded for Ada");
    expect(hydration(loadedHtml)).toMatchObject({
      loader: { data: { message: "Loaded for Ada" } },
      params: { name: "Ada" },
      route: { feature: "product.web.greeting", name: "loaded" },
    });
    expectDocumentParity(realization, "loader", loadedHtml);

    const deferred = await request("/deferred/Ada");
    const deferredHtml = await deferred.text();
    expect(deferred.status).toBe(200);
    expect(deferredHtml).toContain('data-poggers-boundary-start="d0"');
    expect(deferredHtml).toContain("Loading activity");
    expect(deferredHtml).toContain('data-poggers-deferred-frame="d0"');
    expect(deferredHtml).toContain("Loaded for Ada");
    expect(hydration(deferredHtml)).toMatchObject({
      loader: {
        data: {
          message: "Activity for Ada",
          activity: {
            version: 1,
            kind: "deferred",
            boundary: "d0",
            field: "activity",
            state: { status: "pending" },
          },
        },
      },
      route: { feature: "product.web.greeting", name: "deferred" },
    });

    const streamStarted = performance.now();
    const streamed = await request("/deferred/Stream");
    const streamHeadersMs = performance.now() - streamStarted;
    const reader = streamed.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    const firstChunk = await reader!.read();
    const streamShellMs = performance.now() - streamStarted;
    const shell = decoder.decode(firstChunk.value, { stream: true });
    expect(firstChunk.done).toBe(false);
    expect(shell).toContain("Loading activity");
    expect(shell).not.toContain('data-poggers-deferred-frame="d0"');
    let completion = "";
    while (true) {
      const chunk = await reader!.read();
      if (chunk.done) break;
      completion += decoder.decode(chunk.value, { stream: true });
    }
    completion += decoder.decode();
    const streamCompleteMs = performance.now() - streamStarted;
    expect(completion).toContain('data-poggers-deferred-frame="d0"');
    expect(completion).toContain("Loaded for Stream");
    expect(streamHeadersMs).toBeLessThan(5_000);
    expect(streamShellMs).toBeGreaterThanOrEqual(streamHeadersMs);
    expect(streamCompleteMs).toBeGreaterThanOrEqual(streamShellMs);

    const redirected = await request("/go", { redirect: "manual" });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe("/client");
    expect(await redirected.text()).toBe("");

    const failed = await request("/failure");
    expect(failed.status).toBe(500);
    const failedBody = await failed.text();
    expect(failedBody).toContain("Internal server error.");
    expect(failedBody).not.toContain("sensitive fixture failure");
    expect(failedBody).not.toContain("system.ts");

    const privateRequest = await request("/private", {
      headers: { cookie: "session=private" },
    });
    const privateHtml = await privateRequest.text();
    expect(privateRequest.status).toBe(200);
    expect(privateRequest.headers.get("cache-control")).toBe("private, max-age=60");
    expect(privateRequest.headers.get("x-poggers-cache")).toBe("bypass");
    expect(privateHtml).toContain("Request session=private");
    expect(privateRequest.headers.get("cache-control")).not.toContain("public");
    expectDocumentParity(realization, "private-request", privateHtml);
    const privateMarkdown = await request("/private", {
      headers: { accept: "text/markdown", cookie: "session=private" },
    });
    expect(privateMarkdown.status).toBe(406);

    const typed = await request("/typed/7/true?tag=one&tag=two");
    const typedHtml = await typed.text();
    expect(typed.status).toBe(200);
    expect(typed.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=30",
    );
    expect(typed.headers.get("x-poggers-cache")).toBe("miss");
    expect(typedHtml).toContain("Typed 7/true/compact");
    expect(hydration(typedHtml)).toMatchObject({
      params: { count: 7, enabled: true },
      search: { mode: "compact", tag: ["one", "two"] },
    });
    expectDocumentParity(realization, "typed", typedHtml);

    const typedFresh = await request("/typed/7/true?tag=one&tag=two");
    expect(typedFresh.status).toBe(200);
    expect(typedFresh.headers.get("x-poggers-cache")).toBe("fresh");
    expect(await typedFresh.text()).toBe(typedHtml);

    const typedDifferent = await request("/typed/8/true?tag=one&tag=two");
    expect(typedDifferent.status).toBe(200);
    expect(typedDifferent.headers.get("x-poggers-cache")).toBe("miss");
    expect(await typedDifferent.text()).toContain("Typed 8/true/compact");

    const cachedBurst = await Promise.all(Array.from({ length: 12 }, () => request("/cached/Ada")));
    const cachedBodies = await Promise.all(cachedBurst.map((response) => response.text()));
    expect(new Set(cachedBodies).size).toBe(1);
    expect(cachedBodies[0]).toContain("Cached Ada 1");
    expect(cachedBurst.map((response) => response.headers.get("x-poggers-cache"))).toContain(
      "miss",
    );
    const cachedFresh = await request("/cached/Ada");
    expect(cachedFresh.headers.get("x-poggers-cache")).toBe("fresh");
    expect(await cachedFresh.text()).toBe(cachedBodies[0]);
    await new Promise((resolve) => setTimeout(resolve, 550));
    const cachedStale = await request("/cached/Ada");
    expect(cachedStale.headers.get("x-poggers-cache")).toBe("stale");
    expect(await cachedStale.text()).toBe(cachedBodies[0]);
    await expect
      .poll(async () => {
        const refreshed = await request("/cached/Ada");
        return {
          body: (await refreshed.text()).includes("Cached Ada 2"),
          cache: refreshed.headers.get("x-poggers-cache"),
        };
      })
      .toEqual({ body: true, cache: "fresh" });

    const typedRedirect = await request("/typed-go", { redirect: "manual" });
    expect(typedRedirect.status).toBe(302);
    expect(typedRedirect.headers.get("location")).toBe("/typed/2/true?tag=one&tag=two#details");

    const literal = await request("/files/new");
    expect(literal.status).toBe(200);
    expect(await literal.text()).toContain("Literal file");
    const parameter = await request("/files/report%20one");
    expect(parameter.status).toBe(200);
    expect(await parameter.text()).toContain("File report one");
    const wildcard = await request("/files/a%20b/c");
    expect(wildcard.status).toBe(200);
    expect(await wildcard.text()).toContain("Files a b/c");

    for (const path of [
      "/typed/0/true",
      "/typed/2/not-boolean",
      "/typed/2/false?tag=longer-than-twelve",
      "/typed/2/false?mode=unknown",
    ]) {
      const response = await request(path);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ message: "Invalid request." });
    }

    const invalid = await request("/hello/Ada?punctuation=.");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ message: "Invalid request." });

    const duplicate = await request("/hello/Ada?punctuation=%21&punctuation=%3F");
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({ message: "Invalid request." });

    const missing = await request("/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: "Not found." });

    const disallowed = await request("/hello/Ada", { method: "POST" });
    expect(disallowed.status).toBe(405);
    expect(disallowed.headers.get("allow")).toBe("GET, HEAD");

    const head = await request("/hello/Ada", { method: "HEAD" });
    expect(head.status).toBe(defaultGreeting.status);
    expect(head.headers.get("content-type")).toBe(defaultGreeting.headers.get("content-type"));
    expect(head.headers.get("etag")).toBe(defaultGreeting.headers.get("etag"));
    expect(await head.text()).toBe("");

    const notModified = await request("/hello/Ada", {
      headers: { "if-none-match": defaultGreeting.headers.get("etag")! },
    });
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const client = await request("/client");
    const clientHtml = await client.text();
    expect(client.status).toBe(200);
    expect(clientHtml).toContain("<title>Client</title>");
    expect(clientHtml).toContain('name="robots" content="noindex"');
    expect(clientHtml).toContain('data-poggers-rendering="client"');
    expect(clientHtml).not.toContain('id="poggers-hydration"');
    expect(clientHtml).toContain(
      realization === "production"
        ? '<script type="module" async src="/assets/'
        : '<script type="module" async src="/browser.generated.ts">',
    );
    expectDocumentParity(realization, "client", clientHtml);

    const serverMetrics =
      realization === "production"
        ? await verifyProductionPerformance(productLocation, defaultHtml, metrics)
        : undefined;
    if (serverMetrics) {
      console.info(`[poggers] web production metrics ${JSON.stringify(serverMetrics)}`);
    }
  },
});

function expectDocumentParity(
  realization: "development" | "production",
  name: string,
  html: string,
): void {
  const normalized = normalizeDocument(html);
  if (realization === "development") {
    referenceDocuments.set(name, normalized);
    return;
  }
  const reference = referenceDocuments.get(name);
  if (reference !== undefined) expect(normalized, `${name} document parity`).toBe(reference);
}

function normalizeDocument(html: string): string {
  return html
    .replace(/<link rel="modulepreload"[^>]*>/g, "")
    .replace(/<script type="module"[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(
      /(<script id="poggers-hydration" type="application\/json">)([^<]*)(<\/script>)/,
      (_, open: string, value: string, close: string) =>
        `${open}${JSON.stringify(sortJSON(JSON.parse(value)))}${close}`,
    )
    .replace(/>\s+</g, "><")
    .trim();
}

function sortJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJSON);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJSON(Reflect.get(value, key))]),
  );
}

function hydration(html: string): unknown {
  const match = html.match(
    /<script id="poggers-hydration" type="application\/json">([^<]*)<\/script>/,
  );
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

async function verifyProductionPerformance(
  location: string,
  html: string,
  realization: Readonly<{
    buildMs?: number;
    startupMs: number;
    artifactBytes?: number;
    environment: string;
  }>,
): Promise<Readonly<Record<string, unknown>>> {
  const entry = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  expect(entry).toMatch(/^\/assets\/app-[A-Za-z0-9_-]+\.js$/);
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(
    (match) => match[1]!,
  );
  expect(new Set(preloads).size).toBe(preloads.length);
  expect(preloads).toContain(entry);
  const routePreloads = preloads.filter((path) => path.includes("/route-"));
  expect(routePreloads).toHaveLength(1);
  expect(routePreloads[0]).toContain("route-product-web-greeting-greeting-");
  const javascriptBytes = (
    await Promise.all(
      preloads.map(async (path) => {
        const asset = await fetch(new URL(path, location));
        expect(asset.status).toBe(200);
        return (await asset.arrayBuffer()).byteLength;
      }),
    )
  ).reduce((total, size) => total + size, 0);
  const htmlBytes = new TextEncoder().encode(html).byteLength;
  const cssBytes = new TextEncoder().encode(
    html.match(/<style data-poggers-ssr>([\s\S]*?)<\/style>/)?.[1] ?? "",
  ).byteLength;
  const requests = await requestDistribution(location, "/hello/Performance", 80, 8);

  expect(realization.startupMs).toBeLessThan(5_000);
  expect(realization.buildMs).toBeLessThan(240_000);
  expect(realization.artifactBytes).toBeLessThan(100 * 1024 * 1024);
  expect(htmlBytes).toBeLessThan(32 * 1024);
  expect(cssBytes).toBeLessThan(16 * 1024);
  expect(javascriptBytes).toBeLessThan(200 * 1024);
  expect(requests.p95Ms).toBeLessThan(500);
  expect(requests.requestsPerSecond).toBeGreaterThan(20);

  return Object.freeze({
    ...realization,
    htmlBytes,
    cssBytes,
    javascriptBytes,
    requests,
  });
}

async function requestDistribution(
  location: string,
  path: string,
  count: number,
  concurrency: number,
): Promise<Readonly<{ p50Ms: number; p95Ms: number; requestsPerSecond: number }>> {
  for (let index = 0; index < concurrency; index++) {
    const response = await fetch(new URL(path, location));
    await response.arrayBuffer();
  }
  const durations: number[] = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next++;
        if (index >= count) return;
        const requestStarted = performance.now();
        const response = await fetch(new URL(path, location));
        expect(response.status).toBe(200);
        await response.arrayBuffer();
        durations.push(performance.now() - requestStarted);
      }
    }),
  );
  const elapsed = performance.now() - started;
  durations.sort((left, right) => left - right);
  return Object.freeze({
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    requestsPerSecond: count / (elapsed / 1_000),
  });
}

function percentile(values: readonly number[], fraction: number): number {
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))]!;
}
