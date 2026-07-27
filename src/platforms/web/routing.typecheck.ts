import { createFeature } from "@/core/feature";
import {
  Await,
  type BrowserMainThread,
  type BrowserServiceWorker,
  type Navigation,
  type WebServiceWorkerRuntime,
} from "@/platforms/web";
import type {
  Choice,
  Deferred,
  Integer,
  List,
  Text,
  UUID,
  ValidationInput,
  ValidationOutput,
  WebRoute,
  WebRoutes,
} from "@/platforms/web/routing";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

type SearchSchema = {
  page: Integer<{ Minimum: 1; Default: 1 }>;
  query?: Text<{ MaximumLength: 100 }>;
  sort: Choice<"created" | "title", { Default: "created" }>;
  tags?: List<string, { MaximumLength: 20 }>;
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
  Params: { id: UUID };
  Search: SearchSchema;
  Data: Readonly<{ title: string }>;
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
      Params: { slug: Text };
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
    browser: {
      Environment: BrowserMainThread;
      Routes: {
        activity: {
          Path: "activity";
          Data: Readonly<{
            title: string;
            activity: Deferred<readonly string[]>;
          }>;
        };
      };
    };
  };
};

const deferred = createFeature<DeferredFeature>({
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
});

type RoutedFeature = {
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Requires: {
        tasks: { get(input: { id: string }): Promise<{ title: string }> };
      };
      Routes: {
        edit: {
          Path: ":id";
          Params: { id: UUID };
          Search: SearchSchema;
          Data: Readonly<{ title: string }>;
        };
      };
    };
  };
};

type IdentityFeature = {
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Routes: {
        signIn: {
          Path: "sign-in";
          Search: { returnTo?: Text };
        };
      };
    };
  };
};

type RoutedApplication = { Features: { identity: IdentityFeature; tasks: RoutedFeature } };
type GlobalRouteNamesProof = Expect<
  Equal<keyof WebRoutes<RoutedApplication>, "identity.signIn" | "tasks.edit">
>;

type NestedFeature = {
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Routes: {
        root: { Path: ""; Search: { locale?: Choice<"en" | "sk", { Default: "en" }> } };
        workspace: {
          Parent: "root";
          Path: ":workspace";
          Params: { workspace: Text };
        };
        detail: {
          Parent: "workspace";
          Path: ":id";
          Params: { id: UUID };
          Data: { label: string };
        };
      };
    };
  };
};
type NestedApplication = { Features: { nested: NestedFeature } };
type NestedRouteNamesProof = Expect<
  Equal<keyof WebRoutes<NestedApplication>, "nested.root" | "nested.workspace" | "nested.detail">
>;

const nested = createFeature<NestedFeature>({
  programs: {
    browser: {
      routes: {
        root: {
          view({ children }) {
            return children;
          },
        },
        workspace: {
          view({ children, params, search }) {
            return `${params.workspace}:${search.locale}:${String(children)}`;
          },
        },
        detail: {
          load({ params, search }) {
            return { data: { label: `${params.workspace}:${params.id}:${search.locale}` } };
          },
          view({ data }) {
            return data.label;
          },
        },
      },
    },
  },
});

declare const navigation: Navigation<
  RoutedFeature["Programs"]["browser"]["Routes"],
  RoutedApplication
>;
navigation.navigate({ route: "edit", params: { id: "8da942a4-835f-4d4e-bc08-89545d523963" } });
navigation.navigate({ feature: "identity", route: "signIn", search: { returnTo: "/tasks" } });
navigation.reload();
// @ts-expect-error Unknown cross-Feature destinations are rejected.
navigation.navigate({ feature: "identity", route: "missing" });

const routed = createFeature<RoutedFeature>({
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
});

type OfflineFeature = {
  Programs: {
    offline: {
      Environment: BrowserServiceWorker;
      Requires: { serviceWorker: WebServiceWorkerRuntime };
    };
  };
};

const offline = createFeature<OfflineFeature>({
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
});

void routed;
void nested;
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
void (false as NestedRouteNamesProof);
