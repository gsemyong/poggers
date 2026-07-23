import {
  createApp,
  createFeature,
  type Feature,
  type PlatformInterfaceContract,
  type Program,
} from "@poggers/kit";
import type { HttpServer, ServerProcess } from "@poggers/kit/server";
import {
  Await,
  type BrowserMainThread,
  type BrowserServiceWorker,
  type Deferred,
  type Navigation,
  type Validate,
  type WebFeature,
  type WebPlatform,
  type WebRoute,
  type WebServiceWorkerRuntime,
  createWebInterface,
} from "@poggers/kit/web";

type GreetingRoutes = {
  greeting: WebRoute<{
    Path: "hello/:name";
    Metadata: {
      Title: "Greeting";
      Description: "A request-rendered greeting";
      Alternates: { sk: "/sk/hello" };
      Social: {
        Type: "website";
        Card: "summary_large_image";
        Images: readonly [
          {
            URL: "https://example.test/greeting.jpg";
            Alt: "Greeting preview";
            Width: 1200;
            Height: 630;
          },
        ];
      };
      Icons: readonly [{ URL: "data:image/svg+xml,%3Csvg%2F%3E"; Type: "image/svg+xml" }];
      StructuredData: readonly [
        { "@context": "https://schema.org"; "@type": "WebPage"; name: "Greeting" },
      ];
    };
    Params: { name: Validate<string, { MinimumLength: 1; MaximumLength: 40 }> };
    Search: { punctuation?: Validate<"!" | "?", { Default: "!" }> };
  }>;
  loaded: WebRoute<{
    Path: "loaded/:name";
    Params: { name: Validate<string, { MinimumLength: 1; MaximumLength: 40 }> };
    Data: { message: string };
    Dependencies: { greetings: Greetings };
  }>;
  redirect: WebRoute<{
    Path: "go";
    Data: { message: string };
  }>;
  failure: WebRoute<{
    Path: "failure";
    Data: { message: string };
    Dependencies: { greetings: Greetings };
  }>;
  deferred: WebRoute<{
    Path: "deferred/:name";
    Params: { name: Validate<string, { MinimumLength: 1; MaximumLength: 40 }> };
    Data: { message: string; activity: Deferred<string> };
    Dependencies: { greetings: Greetings };
  }>;
  privateRequest: WebRoute<{
    Path: "private";
    Cache: { Scope: "private"; MaxAge: "1m" };
    Data: { message: string };
  }>;
  typed: WebRoute<{
    Path: "typed/:count/:enabled";
    Cache: { Scope: "public"; MaxAge: "1m"; StaleWhileRevalidate: "30s" };
    Params: {
      count: Validate<number, { Integer: true; Minimum: 1; Maximum: 99 }>;
      enabled: Validate<boolean>;
    };
    Search: {
      mode?: Validate<"compact" | "full", { Default: "compact" }>;
      tag?: Validate<readonly string[], { MaximumLength: 12 }>;
    };
  }>;
  cached: WebRoute<{
    Path: "cached/:name";
    Cache: { Scope: "public"; MaxAge: "500ms"; StaleWhileRevalidate: "2s" };
    Params: { name: Validate<string, { MinimumLength: 1; MaximumLength: 40 }> };
    Data: { message: string };
    Dependencies: { greetings: Greetings };
  }>;
  typedRedirect: WebRoute<{
    Path: "typed-go";
    Data: { message: string };
  }>;
  fileNew: WebRoute<{ Path: "files/new" }>;
  file: WebRoute<{ Path: "files/:id" }>;
  files: WebRoute<{ Path: "files/*rest" }>;
  client: WebRoute<{ Path: "client"; Metadata: { Title: "Client"; Robots: "noindex" } }>;
};

type Greetings = Readonly<{
  message(input: { name: string }): string;
  cached(input: { name: string }): Promise<string>;
}>;

type Greeting = Readonly<{
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Requires: { navigation: Navigation<GreetingRoutes, WebContract> };
        Actions: { goClient(): void };
        Components: {
          Message: {
            Props: { message: string };
            State: { count: number };
            Actions: { increment(): void };
            Elements: {
              Root: "main";
              Title: "h1";
              Input: "input";
              Increment: "button";
              Count: "output";
              Navigate: "button";
              Link: "a";
            };
          };
        };
        Routes: GreetingRoutes;
      }
    >;
  };
}>;

type Origin = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      { Requires: { http: HttpServer }; Provides: { greetings: Greetings } }
    >;
  };
}>;

type Background = Readonly<{
  Programs: {
    offline: Program<
      BrowserServiceWorker,
      { Requires: { serviceWorker: WebServiceWorkerRuntime } }
    >;
    diagnostics: Program<
      BrowserServiceWorker,
      { Requires: { serviceWorker: WebServiceWorkerRuntime } }
    >;
  };
}>;

type AdminRoutes = {
  dashboard: WebRoute<{
    Path: "";
    Metadata: {
      Title: "Admin";
      Description: "Independent administration interface";
      Robots: "noindex";
    };
  }>;
};

type AdminDashboard = Readonly<{
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Components: {
          Dashboard: {
            Elements: {
              Root: "main";
              Title: "h1";
            };
          };
        };
        Routes: AdminRoutes;
      }
    >;
  };
}>;

type AdminContract = Readonly<{
  Features: {
    background: Background;
    dashboard: AdminDashboard;
  };
}>;

export type WebContract = Readonly<{
  Features: { background: Background; greeting: Greeting };
}>;

export type Product = Readonly<{
  Features: {
    admin: PlatformInterfaceContract<AdminContract, WebPlatform>;
    origin: Origin;
    web: PlatformInterfaceContract<WebContract, WebPlatform>;
  };
}>;

const greeting: WebFeature<Greeting, WebContract> = {
  programs: {
    browser: {
      actions: {
        goClient({ dependencies }) {
          dependencies.navigation.navigate({ to: "client" });
        },
      },
      components: {
        Message: {
          state: { count: 0 },
          actions: {
            increment({ state }) {
              state.count += 1;
            },
          },
          view({
            actions,
            elements: { Root, Title, Input, Increment, Count, Navigate, Link },
            feature,
            props,
            state,
          }) {
            return (
              <Root data-kind="greeting">
                <Title>{props.message}</Title>
                <Input aria-label="Hydration input" />
                <Increment type="button" onClick={() => actions.increment()}>
                  Increment
                </Increment>
                <Count aria-label="Count">{() => state.count}</Count>
                <Navigate type="button" onClick={() => feature.goClient()}>
                  Open client route
                </Navigate>
                <Link href="/loaded/Prefetched">Prefetch loaded route</Link>
              </Root>
            );
          },
        },
      },
      routes: {
        greeting: {
          view({ components: { Greeting }, params, search }) {
            return <Greeting.Message message={`Hello, ${params.name}${search.punctuation}`} />;
          },
        },
        loaded: {
          load({ dependencies, params }) {
            return {
              data: { message: dependencies.greetings.message({ name: params.name }) },
              metadata: { title: `Loaded ${params.name}` },
            };
          },
          view({ components: { Greeting }, data }) {
            return <Greeting.Message message={data.message} />;
          },
        },
        redirect: {
          load() {
            return { redirect: { to: "greeting.client" as const } };
          },
          view({ components: { Greeting }, data }) {
            return <Greeting.Message message={data.message} />;
          },
        },
        failure: {
          load({ dependencies }) {
            return { data: { message: dependencies.greetings.message({ name: "Failure" }) } };
          },
          view({ components: { Greeting }, data }) {
            return <Greeting.Message message={data.message} />;
          },
        },
        deferred: {
          load({ dependencies, params }) {
            return {
              data: {
                message: `Activity for ${params.name}`,
                activity: () => dependencies.greetings.message({ name: params.name }),
              },
            };
          },
          view({ components: { Greeting }, data }) {
            return (
              <>
                <Greeting.Message message={data.message} />
                <Await
                  value={data.activity}
                  fallback="Loading activity"
                  error={(_error) => "Unavailable"}
                >
                  {(activity) => <>{activity}</>}
                </Await>
              </>
            );
          },
        },
        privateRequest: {
          load({ request }) {
            return { data: { message: `Request ${request.headers.cookie ?? "anonymous"}` } };
          },
          view({ components: { Greeting }, data }) {
            return <Greeting.Message message={data.message} />;
          },
        },
        typed: {
          view({ components: { Greeting }, params, search }) {
            return (
              <Greeting.Message
                message={`Typed ${params.count}/${params.enabled}/${search.mode}`}
              />
            );
          },
        },
        cached: {
          async load({ dependencies, params }) {
            return {
              data: { message: await dependencies.greetings.cached({ name: params.name }) },
            };
          },
          view({ components: { Greeting }, data }) {
            return <Greeting.Message message={data.message} />;
          },
        },
        typedRedirect: {
          load() {
            return {
              redirect: {
                to: "greeting.typed" as const,
                params: { count: 2, enabled: true },
                search: { mode: "compact", tag: ["one", "two"] },
                hash: "details",
              },
            };
          },
          view({ components: { Greeting }, data }) {
            return <Greeting.Message message={data.message} />;
          },
        },
        fileNew: {
          view({ components: { Greeting } }) {
            return <Greeting.Message message="Literal file" />;
          },
        },
        file: {
          view({ components: { Greeting }, params }) {
            return <Greeting.Message message={`File ${params.id}`} />;
          },
        },
        files: {
          view({ components: { Greeting }, params }) {
            return <Greeting.Message message={`Files ${params.rest}`} />;
          },
        },
        client: {
          view({ components: { Greeting } }) {
            return <Greeting.Message message="Rendered in the browser" />;
          },
        },
      },
    },
  },
};

const origin: Feature<Origin> = {
  programs: {
    server: {
      start() {
        let cacheCalls = 0;
        return {
          greetings: {
            message({ name }) {
              if (name === "Failure") throw new Error("sensitive fixture failure");
              return `Loaded for ${name}`;
            },
            async cached({ name }) {
              cacheCalls += 1;
              return `Cached ${name} ${cacheCalls}`;
            },
          },
        };
      },
    },
  },
};

const background: Feature<Background> = {
  programs: {
    offline: {
      start({ dependencies }) {
        return dependencies.serviceWorker.subscribe({
          message(event) {
            if (event.data === "poggers:ping") event.respond("poggers:pong");
          },
        });
      },
    },
    diagnostics: {
      start({ dependencies }) {
        return dependencies.serviceWorker.subscribe({
          message(event) {
            if (event.data === "poggers:status") event.respond("poggers:ready");
          },
        });
      },
    },
  },
};

const dashboard: WebFeature<AdminDashboard, AdminContract> = {
  programs: {
    browser: {
      components: {
        Dashboard: {
          view({ elements: { Root, Title } }) {
            return (
              <Root data-interface="admin">
                <Title>Administration</Title>
              </Root>
            );
          },
        },
      },
      routes: {
        dashboard: {
          view({ components: { Dashboard } }) {
            return <Dashboard.Dashboard />;
          },
        },
      },
    },
  },
};

const admin = createWebInterface<AdminContract>({
  features: { background, dashboard },
  presentation: {
    parameters: {},
    create() {
      return {
        Dashboard: () => ({
          Dashboard: () => ({}),
        }),
      };
    },
  },
  installation: {
    shortName: "Admin",
    start: { to: "dashboard.dashboard" },
    icons: [
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='24' fill='%23522'/%3E%3C/svg%3E",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='64' fill='%23522'/%3E%3C/svg%3E",
        sizes: "512x512",
        type: "image/svg+xml",
      },
    ],
    offline: { fallback: { to: "dashboard.dashboard" } },
  },
});

const web = createWebInterface<WebContract>({
  features: { background, greeting },
  presentation: {
    parameters: {},
    create() {
      return {
        Greeting: () => ({
          Message: () => ({}),
        }),
      };
    },
  },
  installation: {
    shortName: "Conformance",
    start: { to: "greeting.client" },
    icons: [
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%23111'/%3E%3C/svg%3E",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='104' fill='%23111'/%3E%3C/svg%3E",
        sizes: "512x512",
        type: "image/svg+xml",
      },
    ],
    offline: { fallback: { to: "greeting.client" } },
  },
});

export const product = createApp(
  createFeature<Product>({
    features: { admin, origin, web },
  }),
);
