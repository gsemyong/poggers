import { createApplication, createFeature, type Dependency } from "kit";
import type { HttpServer, ServerProcess } from "kit/server";
import {
  Await,
  type BrowserMainThread,
  type BrowserServiceWorker,
  type Choice,
  type ConfiguredWebPresentation,
  type Flag,
  type Integer,
  type List,
  type Deferred,
  type Navigation,
  type Text,
  type WebPresentation,
  type WebPlatform,
  type WebServiceWorkerRuntime,
  createImageAsset,
} from "kit/web";

type GreetingRoutes = {
  root: {
    Path: "";
  };
  greeting: {
    Parent: "root";
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
    Params: { name: Text<{ MinimumLength: 1; MaximumLength: 40 }> };
    Search: { punctuation?: Choice<"!" | "?", { Default: "!" }> };
  };
  loaded: {
    Parent: "root";
    Path: "loaded/:name";
    Params: { name: Text<{ MinimumLength: 1; MaximumLength: 40 }> };
    Data: { message: string };
  };
  redirect: {
    Parent: "root";
    Path: "go";
    Data: { message: string };
  };
  failure: {
    Parent: "root";
    Path: "failure";
    Data: { message: string };
  };
  deferred: {
    Parent: "root";
    Path: "deferred/:name";
    Params: { name: Text<{ MinimumLength: 1; MaximumLength: 40 }> };
    Data: { message: string; activity: Deferred<string> };
  };
  privateRequest: {
    Parent: "root";
    Path: "private";
    Cache: { Scope: "private"; MaxAge: "1m" };
    Data: { message: string };
  };
  typed: {
    Parent: "root";
    Path: "typed/:count/:enabled";
    Cache: { Scope: "public"; MaxAge: "1m"; StaleWhileRevalidate: "30s" };
    Params: {
      count: Integer<{ Minimum: 1; Maximum: 99 }>;
      enabled: Flag;
    };
    Search: {
      mode?: Choice<"compact" | "full", { Default: "compact" }>;
      tag?: List<string, { MaximumLength: 12 }>;
    };
  };
  cached: {
    Parent: "root";
    Path: "cached/:name";
    Cache: { Scope: "public"; MaxAge: "500ms"; StaleWhileRevalidate: "2s" };
    Params: { name: Text<{ MinimumLength: 1; MaximumLength: 40 }> };
    Data: { message: string };
  };
  nested: {
    Parent: "root";
    Path: "nested/:workspace";
    Params: { workspace: Text<{ MinimumLength: 1; MaximumLength: 40 }> };
    Data: { message: string };
  };
  nestedDetail: {
    Parent: "nested";
    Path: ":item";
    Params: { item: Text<{ MinimumLength: 1; MaximumLength: 40 }> };
    Data: { message: string };
  };
  typedRedirect: {
    Parent: "root";
    Path: "typed-go";
    Data: { message: string };
  };
  fileNew: { Parent: "root"; Path: "files/new"; Status: 410 };
  file: { Parent: "root"; Path: "files/:id" };
  files: { Parent: "root"; Path: "files/*rest" };
  client: {
    Parent: "root";
    Path: "client";
    Metadata: { Title: "Client"; Robots: "noindex" };
  };
};

type Greetings = Dependency<{
  Operations: {
    message(input: { name: string }): string;
    cached(input: { name: string }): Promise<string>;
  };
}>;

type Greeting = Readonly<{
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Requires: { greetings: Greetings; navigation: Navigation<GreetingRoutes> };
      Actions: { goClient(): void };
      Components: {
        Message: {
          Props: { message: string };
          State: { count: number };
          Actions: { increment(): void };
          Elements: {
            Root: "main";
            Icon: "img";
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
    };
  };
}>;

type Origin = Readonly<{
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: { http: HttpServer };
      Provides: { greetings: Greetings };
    };
  };
}>;

type Background = Readonly<{
  Programs: {
    offline: {
      Environment: BrowserServiceWorker;
      Requires: { serviceWorker: WebServiceWorkerRuntime };
    };
    diagnostics: {
      Environment: BrowserServiceWorker;
      Requires: { serviceWorker: WebServiceWorkerRuntime };
    };
  };
}>;

type AdminRoutes = {
  dashboard: {
    Path: "";
    Metadata: {
      Title: "Admin";
      Description: "Independent administration interface";
      Robots: "noindex";
    };
  };
};

type AdminDashboard = Readonly<{
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Components: {
        Dashboard: {
          Elements: {
            Root: "main";
            Title: "h1";
          };
        };
      };
      Routes: AdminRoutes;
    };
  };
}>;

type AdminContract = Readonly<{
  Features: {
    background: Background;
    dashboard: AdminDashboard;
  };
}>;

export type WebContract = Readonly<{
  Features: { background: Background; greeting: Greeting; origin: Origin };
}>;

export const greeting = createFeature<Greeting>({
  programs: {
    browser: {
      actions: {
        goClient({ dependencies }) {
          dependencies.navigation.navigate({ route: "client" });
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
            elements: { Root, Icon, Title, Input, Increment, Count, Navigate, Link },
            feature,
            props,
            state,
          }) {
            return (
              <Root data-kind="greeting">
                <Icon alt="" aria-hidden="true" />
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
        root: {
          view({ children }) {
            return children;
          },
        },
        greeting: {
          view({ components: { Message }, params, search }) {
            return <Message message={`Hello, ${params.name}${search.punctuation}`} />;
          },
        },
        loaded: {
          load({ dependencies, params }) {
            return {
              data: { message: dependencies.greetings.message({ name: params.name }) },
              metadata: { title: `Loaded ${params.name}` },
              status: 203 as const,
            };
          },
          view({ components: { Message }, data }) {
            return <Message message={data.message} />;
          },
        },
        redirect: {
          load() {
            return { redirect: { route: "client" as const }, status: 308 as const };
          },
          view({ components: { Message }, data }) {
            return <Message message={data.message} />;
          },
        },
        failure: {
          load({ dependencies }) {
            return { data: { message: dependencies.greetings.message({ name: "Failure" }) } };
          },
          view({ components: { Message }, data }) {
            return <Message message={data.message} />;
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
          view({ components: { Message }, data }) {
            return (
              <>
                <Message message={data.message} />
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
          view({ components: { Message }, data }) {
            return <Message message={data.message} />;
          },
        },
        typed: {
          view({ components: { Message }, params, search }) {
            return <Message message={`Typed ${params.count}/${params.enabled}/${search.mode}`} />;
          },
        },
        cached: {
          async load({ dependencies, params }) {
            return {
              data: { message: await dependencies.greetings.cached({ name: params.name }) },
            };
          },
          view({ components: { Message }, data }) {
            return <Message message={data.message} />;
          },
        },
        nested: {
          load({ dependencies, params }) {
            return {
              data: {
                message: dependencies.greetings.message({ name: `Workspace ${params.workspace}` }),
              },
            };
          },
          view({ components: { Message }, data, children }) {
            return (
              <>
                <Message message={data.message} />
                {children}
              </>
            );
          },
        },
        nestedDetail: {
          load({ dependencies, params }) {
            return {
              data: {
                message: dependencies.greetings.message({ name: `Item ${params.item}` }),
              },
              metadata: { title: `${params.workspace}/${params.item}` },
            };
          },
          view({ components: { Message }, data }) {
            return <Message message={data.message} />;
          },
        },
        typedRedirect: {
          load() {
            return {
              redirect: {
                route: "typed" as const,
                params: { count: 2, enabled: true },
                search: { mode: "compact", tag: ["one", "two"] },
                hash: "details",
              },
            };
          },
          view({ components: { Message }, data }) {
            return <Message message={data.message} />;
          },
        },
        fileNew: {
          view({ components: { Message } }) {
            return <Message message="Literal file" />;
          },
        },
        file: {
          view({ components: { Message }, params }) {
            return <Message message={`File ${params.id}`} />;
          },
        },
        files: {
          view({ components: { Message }, params }) {
            return <Message message={`Files ${params.rest}`} />;
          },
        },
        client: {
          view({ components: { Message } }) {
            return <Message message="Rendered in the browser" />;
          },
        },
      },
    },
  },
});

export const origin = createFeature<Origin>({
  programs: {
    server: {
      start() {
        let cacheCalls = 0;
        return {
          greetings: {
            message({ input: { name } }) {
              if (name === "Failure") throw new Error("sensitive fixture failure");
              return `Loaded for ${name}`;
            },
            async cached({ input: { name } }) {
              cacheCalls += 1;
              return `Cached ${name} ${cacheCalls}`;
            },
          },
        };
      },
    },
  },
});

export const background = createFeature<Background>({
  programs: {
    offline: {
      start({ dependencies }) {
        return dependencies.serviceWorker.subscribe({
          message(event) {
            if (event.data === "kit:ping") event.respond("kit:pong");
          },
        });
      },
    },
    diagnostics: {
      start({ dependencies }) {
        return dependencies.serviceWorker.subscribe({
          message(event) {
            if (event.data === "kit:status") event.respond("kit:ready");
          },
        });
      },
    },
  },
});

export const dashboard = createFeature<AdminDashboard>({
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
            return <Dashboard />;
          },
        },
      },
    },
  },
});

const admin = {
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
    start: { feature: "dashboard", route: "dashboard" },
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
    offline: { fallback: { feature: "dashboard", route: "dashboard" } },
  },
} as const;

const webPresentationParameters = {
  icon: createImageAsset(new URL("./presentation-icon.svg", import.meta.url)),
};

const webPresentation = {
  parameters: webPresentationParameters,
  create: (({ parameters }) => ({
    Greeting: () => ({
      Message: () => ({
        Icon: {
          image: parameters.icon,
          layout: { inlineSize: 16, blockSize: 16 },
        },
      }),
    }),
  })) satisfies WebPresentation<WebContract, typeof webPresentationParameters>,
} satisfies ConfiguredWebPresentation<WebContract, typeof webPresentationParameters>;

const web = {
  presentation: webPresentation,
  installation: {
    shortName: "Conformance",
    description: "Web delivery conformance application",
    start: { feature: "greeting", route: "client" },
    orientation: "any",
    themeColor: "#111111",
    backgroundColor: "#ffffff",
    categories: ["productivity"],
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
    screenshots: [
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'%3E%3Crect width='1280' height='720' fill='%23111'/%3E%3C/svg%3E",
        sizes: "1280x720",
        type: "image/svg+xml",
        formFactor: "wide",
        label: "Conformance application",
      },
    ],
    offline: { fallback: { feature: "greeting", route: "client" } },
  },
} as const;

type ProductApplication = WebContract & {
  Name: "Product";
  Interfaces: WebPlatform<{
    Mounts: {
      greeting: { Path: ""; Route: "root" };
    };
  }>;
};
type AdministrationApplication = AdminContract & {
  Name: "Administration";
  Interfaces: WebPlatform<{
    Mounts: {
      dashboard: { Path: ""; Route: "dashboard" };
    };
  }>;
};

export const product = createApplication<ProductApplication>({
  interfaces: { web },
});

export const administration = createApplication<AdministrationApplication>({
  interfaces: { web: admin },
});
