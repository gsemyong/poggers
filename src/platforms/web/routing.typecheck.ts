import type { Feature } from "@/core/feature";
import type { Program } from "@/core/program";
import {
  Await,
  type BrowserMainThread,
  type BrowserServiceWorker,
  type Navigation,
  type WebServiceWorkerRuntime,
} from "@/platforms/web/platform";
import type {
  Deferred,
  Validate,
  ValidationInput,
  ValidationOutput,
  WebFeature,
  WebRoute,
  WebRoutes,
} from "@/platforms/web/routing";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

type SearchSchema = {
  page: Validate<number, { Integer: true; Minimum: 1; Default: 1 }>;
  query?: Validate<string, { MaximumLength: 100 }>;
  sort: Validate<"created" | "title", { Default: "created" }>;
  tags?: Validate<readonly string[], { MaximumLength: 20 }>;
};

type SearchInputProof = Expect<
  Equal<
    ValidationInput<SearchSchema>,
    Readonly<{
      page?: number;
      query?: string;
      sort?: "created" | "title";
      tags?: readonly string[];
    }>
  >
>;
type SearchOutputProof = Expect<
  Equal<
    ValidationOutput<SearchSchema>,
    Readonly<{
      page: number;
      query?: string;
      sort: "created" | "title";
      tags?: readonly string[];
    }>
  >
>;

type EditRoute = WebRoute<{
  Path: ":id";
  Params: { id: Validate<string, { Format: "uuid" }> };
  Search: SearchSchema;
  Data: Readonly<{ title: string }>;
  Dependencies: { tasks: { get(input: { id: string }): Promise<{ title: string }> } };
}>;

type RouteParamsProof = Expect<Equal<EditRoute["Params"], Readonly<{ id: string }>>>;
type RouteDataProof = Expect<Equal<EditRoute["Data"], Readonly<{ title: string }>>>;
type NoRenderModeProof = Expect<Equal<Extract<"Render", keyof WebRoute<{ Path: "" }>>, never>>;
type MetadataProof = Expect<
  Equal<
    WebRoute<{
      Path: "";
      Cache: { Scope: "public"; MaxAge: "5m" };
      Metadata: { Title: "Tasks"; Description: "Manage tasks" };
    }>["Metadata"],
    { Title: "Tasks"; Description: "Manage tasks" }
  >
>;
type PublicRoute = WebRoute<{
  Path: "public";
  Cache: { Scope: "public"; MaxAge: "5m" };
  Data: { title: string };
}>;
type PublicRequestAuthorityProof = Expect<
  Equal<"request" extends keyof PublicRoute["LoadContext"] ? true : false, false>
>;
type InvalidParamsProof = Expect<
  Equal<
    WebRoute<{
      Path: ":id";
      Params: { slug: Validate<string> };
    }>,
    never
  >
>;

type DeferredRoute = WebRoute<{
  Path: "activity";
  Data: Readonly<{
    title: string;
    activity: Deferred<readonly string[]>;
  }>;
}>;
type DeferredKeysProof = Expect<Equal<keyof DeferredRoute["Deferred"], "activity">>;

type DeferredFeature = {
  Programs: {
    browser: Program<BrowserMainThread, { Routes: { activity: DeferredRoute } }>;
  };
};

const deferred = {
  programs: {
    browser: {
      routes: {
        activity: {
          load() {
            return {
              data: {
                title: "Activity",
                activity: async () => ["created", "updated"],
              },
            };
          },
          view({ data }) {
            return Await({
              value: data.activity,
              fallback: "Loading activity",
              children: (activity) => activity.join(", "),
              error: () => "Unable to load activity",
            });
          },
        },
      },
    },
  },
} satisfies WebFeature<DeferredFeature>;

type RoutedFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Routes: { edit: EditRoute };
      }
    >;
  };
};

type IdentityFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Routes: {
          signIn: WebRoute<{
            Path: "sign-in";
            Search: { returnTo?: Validate<string> };
          }>;
        };
      }
    >;
  };
};

type RoutedApplication = { Features: { identity: IdentityFeature; tasks: RoutedFeature } };
type GlobalRouteNamesProof = Expect<
  Equal<keyof WebRoutes<RoutedApplication>, "identity.signIn" | "tasks.edit">
>;

declare const navigation: Navigation<
  RoutedFeature["Programs"]["browser"]["Routes"],
  RoutedApplication
>;
navigation.navigate({ to: "edit", params: { id: "8da942a4-835f-4d4e-bc08-89545d523963" } });
navigation.navigate({ to: "identity.signIn", search: { returnTo: "/tasks" } });
// @ts-expect-error Unknown cross-Feature destinations are rejected.
navigation.navigate({ to: "identity.missing" });

const routed = {
  programs: {
    browser: {
      routes: {
        edit: {
          async load({ dependencies, params, request, search }) {
            void request.url;
            void request.headers.cookie;
            const task = await dependencies.tasks.get({ id: params.id });
            return {
              data: { title: `${task.title}:${search.page}` },
              metadata: { title: task.title },
            };
          },
          view() {
            return undefined;
          },
        },
      },
    },
  },
} satisfies WebFeature<RoutedFeature>;

type OfflineFeature = {
  Programs: {
    offline: Program<
      BrowserServiceWorker,
      { Requires: { serviceWorker: WebServiceWorkerRuntime } }
    >;
  };
};

const offline = {
  programs: {
    offline: {
      start({ dependencies }) {
        return dependencies.serviceWorker.subscribe({
          push({ data }) {
            return dependencies.serviceWorker.showNotification({
              title: "Update",
              ...(data ? { body: data } : {}),
            });
          },
        });
      },
    },
  },
} satisfies Feature<OfflineFeature>;

void routed;
void deferred;
void offline;
void (false as SearchInputProof);
void (false as SearchOutputProof);
void (false as RouteParamsProof);
void (false as RouteDataProof);
void (false as NoRenderModeProof);
void (false as MetadataProof);
void (false as PublicRequestAuthorityProof);
void (false as InvalidParamsProof);
void (false as GlobalRouteNamesProof);
void (false as DeferredKeysProof);
