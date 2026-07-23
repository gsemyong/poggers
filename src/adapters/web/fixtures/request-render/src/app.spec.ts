import { testApplication } from "@poggers/kit/testing";
import { chromium, firefox, webkit, type BrowserContext } from "playwright";
import { expect } from "vitest";

const referenceDocuments = new Map<string, string>();

testApplication({
  name: "request-rendered web application",
  directory: new URL("..", import.meta.url).pathname,
  async verify({ location, realization, metrics }) {
    const request = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${location}${path}`, {
        ...init,
        headers: { accept: "text/html", ...init.headers },
      });
      return response;
    };
    const defaultGreeting = await request("/hello/Ada");
    const defaultHtml = await defaultGreeting.text();
    expect(defaultGreeting.status).toBe(200);
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
      route: { feature: "greeting", name: "greeting" },
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

    const manifestResponse = await fetch(`${location}/manifest.webmanifest`);
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
      route: { feature: "greeting", name: "loaded" },
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
      route: { feature: "greeting", name: "deferred" },
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
    expect(failedBody).not.toContain("app.tsx");

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
        ? await verifyProductionPerformance(location, defaultHtml, metrics)
        : undefined;
    const browserMetrics = await verifyBrowsers(location, realization);
    if (serverMetrics) {
      console.info(
        `[poggers] web production metrics ${JSON.stringify({ ...serverMetrics, browsers: browserMetrics })}`,
      );
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
  expect(routePreloads[0]).toContain("route-greeting-greeting-");
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

async function verifyBrowsers(
  location: string,
  realization: "development" | "production",
): Promise<
  readonly Readonly<{
    engine: string;
    hydrationMs: number;
    longestTaskMs: number;
    layoutShift: number;
    lcpMs?: number;
    longestEventMs?: number;
  }>[]
> {
  const metrics: Array<{
    engine: string;
    hydrationMs: number;
    longestTaskMs: number;
    layoutShift: number;
    lcpMs?: number;
    longestEventMs?: number;
  }> = [];
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({
      headless: true,
      ...(name === "chromium" ? { channel: "chromium" } : {}),
    });
    try {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        const evidence: {
          hydratedAt?: number;
          initial?: Element;
          longTasks: number[];
          layoutShift: number;
          lcpMs?: number;
          eventDurations: number[];
        } = {
          longTasks: [],
          layoutShift: 0,
          eventDurations: [],
        };
        Object.defineProperty(window, "__poggersHydrationEvidence", { value: evidence });
        const capture = () => {
          evidence.initial ??= document.querySelector('main[data-kind="greeting"]') ?? undefined;
          if (
            evidence.hydratedAt === undefined &&
            document.querySelector("#app")?.getAttribute("data-poggers-rendering") === "hydrated"
          ) {
            evidence.hydratedAt = performance.now();
          }
        };
        new MutationObserver(capture).observe(document, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        document.addEventListener("DOMContentLoaded", capture);
        addEventListener("load", capture);
        try {
          new PerformanceObserver((list) => {
            evidence.longTasks.push(...list.getEntries().map(({ duration }) => duration));
          }).observe({ type: "longtask", buffered: true });
        } catch {}
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & {
                hadRecentInput?: boolean;
                value?: number;
              };
              if (!shift.hadRecentInput) evidence.layoutShift += shift.value ?? 0;
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}
        try {
          new PerformanceObserver((list) => {
            evidence.lcpMs = list.getEntries().at(-1)?.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {}
        try {
          new PerformanceObserver((list) => {
            evidence.eventDurations.push(...list.getEntries().map(({ duration }) => duration));
          }).observe({
            type: "event",
            buffered: true,
            durationThreshold: 16,
          } as PerformanceObserverInit & { durationThreshold: number });
        } catch {}
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
          errors.push(message.text());
        }
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (response.status() >= 400 && url.pathname !== "/favicon.ico") {
          errors.push(`${response.status()} ${url.pathname}`);
        }
      });
      const routeDataRequests: string[] = [];
      const routeModuleRequests: string[] = [];
      let redirectDataStarted: number | undefined;
      let redirectModuleStarted: number | undefined;
      page.on("request", (request) => {
        if (request.headers().accept?.includes("application/vnd.poggers.route+json")) {
          const path = new URL(request.url()).pathname;
          routeDataRequests.push(path);
          if (path === "/go") redirectDataStarted = performance.now();
        }
        if (
          request.resourceType() === "script" &&
          request.url().includes("route-greeting-loaded-")
        ) {
          routeModuleRequests.push(request.url());
        }
        if (
          request.resourceType() === "script" &&
          request.url().includes("route-greeting-redirect-")
        ) {
          redirectModuleStarted = performance.now();
        }
      });

      await page.goto(`${location}/hello/Ada`, { waitUntil: "load" });
      await page.locator('[aria-label="Hydration input"]').waitFor();
      await expect
        .poll(() => page.locator("[data-poggers-h]").count(), { message: `${name} hydration` })
        .toBe(0);
      await expect
        .poll(() => page.locator("#app").getAttribute("data-poggers-rendering"), {
          message: `${name} hydration state`,
        })
        .toBe("hydrated");
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (
                  window as unknown as {
                    __poggersHydrationEvidence: { hydratedAt?: number };
                  }
                ).__poggersHydrationEvidence.hydratedAt,
            ),
          { message: `${name} hydration evidence` },
        )
        .toBeTypeOf("number");
      const hydrationMs = await page.evaluate(
        () =>
          (
            window as unknown as {
              __poggersHydrationEvidence: { hydratedAt: number };
            }
          ).__poggersHydrationEvidence.hydratedAt,
      );
      expect(hydrationMs, `${name} hydration duration`).toBeLessThan(5_000);
      expect(
        await page.evaluate(() => {
          const evidence = (
            window as unknown as { __poggersHydrationEvidence: { initial?: Element } }
          ).__poggersHydrationEvidence;
          return evidence.initial === document.querySelector('main[data-kind="greeting"]');
        }),
        `${name} retained the server DOM node`,
      ).toBe(true);
      expect(
        await page
          .locator('main[data-kind="greeting"]')
          .evaluate((element) => getComputedStyle(element).boxSizing),
      ).toBe("border-box");
      expect(
        await page.locator("style[data-poggers-ssr],style[data-poggers-presentation]").count(),
      ).toBe(1);
      expect(await page.locator('meta[property="og:type"][content="website"]').count()).toBe(1);
      expect(await page.locator('script[type="application/ld+json"]').count()).toBe(1);
      expect(routeDataRequests).toEqual([]);

      expect(
        await page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return { supported: false };
          const registration = await navigator.serviceWorker.ready;
          const ask = (message: string) =>
            new Promise<unknown>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error(`Service-worker Program did not respond to ${message}.`)),
                5_000,
              );
              navigator.serviceWorker.addEventListener(
                "message",
                (event) => {
                  clearTimeout(timeout);
                  resolve(event.data);
                },
                { once: true },
              );
              registration.active?.postMessage(message);
            });
          return {
            supported: true,
            registrations: (await navigator.serviceWorker.getRegistrations()).length,
            responses: [await ask("poggers:ping"), await ask("poggers:status")],
          };
        }),
      ).toEqual({
        supported: true,
        registrations: 1,
        responses: ["poggers:pong", "poggers:ready"],
      });

      const input = page.getByLabel("Hydration input");
      await input.fill("draft");
      await input.focus();
      await page
        .getByRole("button", { name: "Increment" })
        .evaluate((button) => (button as HTMLButtonElement).click());
      await expect.poll(() => page.getByLabel("Count").textContent()).toBe("1");
      expect(await input.inputValue()).toBe("draft");
      expect(await input.evaluate((element) => element === document.activeElement)).toBe(true);

      await page.getByRole("link", { name: "Prefetch loaded route" }).hover();
      await expect.poll(() => routeModuleRequests.length).toBe(1);
      expect(routeDataRequests).toEqual([]);

      await page.getByRole("button", { name: "Open client route" }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/client");
      await expect
        .poll(() => page.getByRole("heading").textContent())
        .toBe("Rendered in the browser");
      await page.goBack({ waitUntil: "load" });
      await expect.poll(() => new URL(page.url()).pathname).toBe("/hello/Ada");
      await expect.poll(() => page.getByRole("heading").textContent()).toBe("Hello, Ada!");
      expect(await page.locator('meta[property="og:type"][content="website"]').count()).toBe(1);

      await page.getByRole("link", { name: "Prefetch loaded route" }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/loaded/Prefetched");
      await expect
        .poll(() => page.getByRole("heading").textContent())
        .toBe("Loaded for Prefetched");
      await expect.poll(() => page.title()).toBe("Loaded Prefetched");
      expect(await page.locator('meta[property="og:type"]').count()).toBe(0);
      expect(await page.locator('script[type="application/ld+json"]').count()).toBe(0);
      expect(routeDataRequests).toEqual(["/loaded/Prefetched"]);
      expect(routeModuleRequests).toHaveLength(1);

      await page.evaluate(() => {
        history.pushState(null, "", "/go");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect.poll(() => new URL(page.url()).pathname).toBe("/client");
      await expect
        .poll(() => page.getByRole("heading").textContent())
        .toBe("Rendered in the browser");
      expect(routeDataRequests).toEqual(["/loaded/Prefetched", "/go"]);
      expect(redirectDataStarted).toBeTypeOf("number");
      expect(redirectModuleStarted).toBeTypeOf("number");
      expect(Math.abs(redirectDataStarted! - redirectModuleStarted!)).toBeLessThan(250);

      await page.goto(`${location}/loaded/Ada`, { waitUntil: "load" });
      await expect.poll(() => page.getByRole("heading").textContent()).toBe("Loaded for Ada");

      await page.evaluate(() => {
        history.pushState(null, "", "/deferred/Browser");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect.poll(() => new URL(page.url()).pathname).toBe("/deferred/Browser");
      await expect
        .poll(() => page.locator("#app").innerText(), {
          message: `${name} deferred Route (${errors.join("; ") || "no browser error"})`,
        })
        .toContain("Loaded for Browser");
      expect(await page.getByText("Loading activity", { exact: true }).count()).toBe(0);
      expect(errors, `${name} successful hydration errors`).toEqual([]);
      const browserTiming = await page.evaluate(() => {
        const evidence = (
          window as unknown as {
            __poggersHydrationEvidence: {
              hydratedAt?: number;
              longTasks: number[];
              layoutShift: number;
              lcpMs?: number;
              eventDurations: number[];
            };
          }
        ).__poggersHydrationEvidence;
        return {
          longestTaskMs: Math.max(0, ...evidence.longTasks),
          layoutShift: evidence.layoutShift,
          lcpMs: evidence.lcpMs,
          longestEventMs: evidence.eventDurations.length
            ? Math.max(...evidence.eventDurations)
            : undefined,
        };
      });
      const timing = { hydrationMs, ...browserTiming };
      if (realization === "production") {
        expect(timing.longestTaskMs, `${name} longest task`).toBeLessThan(250);
        expect(timing.layoutShift, `${name} cumulative layout shift proxy`).toBeLessThan(0.1);
        if (timing.lcpMs !== undefined) {
          expect(timing.lcpMs, `${name} largest-contentful-paint proxy`).toBeLessThan(5_000);
        }
        if (timing.longestEventMs !== undefined) {
          expect(timing.longestEventMs, `${name} longest event duration`).toBeLessThan(250);
        }
      }
      metrics.push({ engine: name, ...timing });

      if (realization === "production" && name !== "webkit") {
        await verifyOfflineApplication(context, location, name);
      }

      const mismatch = await context.newPage();
      const mismatchErrors: string[] = [];
      mismatch.on("console", (message) => {
        if (message.type() === "error") mismatchErrors.push(message.text());
      });
      mismatch.on("pageerror", (error) => mismatchErrors.push(error.message));
      await mismatch.addInitScript(() => {
        const observer = new MutationObserver(() => {
          const title = document.querySelector('main[data-kind="greeting"] h1');
          if (!title) return;
          title.lastChild!.textContent = "tampered";
          observer.disconnect();
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      await mismatch.goto(`${location}/hello/Grace`, { waitUntil: "load" });
      await expect
        .poll(() => mismatch.locator("#app").getAttribute("data-poggers-rendering"))
        .toBe("client-recovered");
      expect(
        mismatchErrors.filter((message) => message.includes("SSR hydration mismatch")),
      ).toHaveLength(1);
      expect(
        await mismatch.evaluate(() => performance.getEntriesByType("navigation").length),
        `${name} mismatch recovery did not reload`,
      ).toBe(1);
      await context.close();
    } finally {
      await browser.close();
    }
  }
  return Object.freeze(metrics);
}

async function verifyOfflineApplication(
  context: BrowserContext,
  location: string,
  engine: string,
): Promise<void> {
  const page = await context.newPage();
  const errors: string[] = [];
  const failed: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    failed.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? "failed"}`);
  });
  try {
    await page.goto(`${location}/client`, { waitUntil: "load" });
    await expect
      .poll(() => page.getByRole("heading").textContent())
      .toBe("Rendered in the browser");
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const names = await caches.keys();
            return {
              controlled: Boolean(navigator.serviceWorker.controller),
              caches: names,
              entries: (
                await Promise.all(
                  names.map(async (name) =>
                    (await (await caches.open(name)).keys()).map(
                      ({ url }) => new URL(url).pathname,
                    ),
                  ),
                )
              ).flat(),
            };
          }),
        { message: `${engine} service-worker control` },
      )
      .toMatchObject({
        controlled: true,
        caches: expect.arrayContaining([
          expect.stringMatching(/^poggers-assets-/),
          expect.stringMatching(/^poggers-documents-/),
        ]),
        entries: expect.arrayContaining(["/client"]),
      });

    await context.setOffline(true);
    await page.goto(`${location}/hello/Offline`, { waitUntil: "load" });
    await expect
      .poll(() => page.locator("#app").innerText(), {
        message: `${engine} offline application (${errors.join("; ")}; ${failed.join("; ")})`,
      })
      .toContain("Hello, Offline!");
    expect(errors, `${engine} offline browser errors`).toEqual([]);
    expect(
      await page
        .locator('main[data-kind="greeting"]')
        .evaluate((element) => getComputedStyle(element).boxSizing),
    ).toBe("border-box");
  } finally {
    await context.setOffline(false);
    await page.close();
  }
}
