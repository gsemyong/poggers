import type { Program } from "@poggers/kit";
import type { BrowserMainThread, Child, Navigation, WebFeature, WebRoute } from "@poggers/kit/web";

import type { OperationsWeb } from "../system";
import type { IdentityClient, Session } from "./identity";

type AuthMode = "sign-in" | "sign-up";
type AuthPhase = "loading" | "signed-out" | "signed-in";
type ShellRoutes = {
  auth: WebRoute<{
    Path: "auth";
    Metadata: { Title: "Sign in"; Robots: "noindex" };
  }>;
};

export type ShellFeature = Readonly<{
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Requires: {
          identity: IdentityClient;
          navigation: Navigation<ShellRoutes, OperationsWeb>;
        };
        State: {
          phase: AuthPhase;
          mode: AuthMode;
          session: Session | undefined;
          name: string;
          email: string;
          password: string;
          working: boolean;
          error: string | undefined;
        };
        Actions: {
          refresh(): Promise<void>;
          changeName(input: { value: string }): void;
          changeEmail(input: { value: string }): void;
          changePassword(input: { value: string }): void;
          switchMode(): void;
          submit(): Promise<void>;
          signOut(): Promise<void>;
        };
        Components: {
          Layout: {
            Slots: { Content: Child };
            Elements: {
              Root: "main";
              Topbar: "header";
              BrandGroup: "div";
              Mark: "span";
              Brand: "h1";
              Account: "div";
              User: "p";
              SignOut: "button";
              Content: "div";
              AuthLayout: "section";
              AuthIntro: "div";
              AuthEyebrow: "p";
              AuthTitle: "h1";
              AuthCopy: "p";
              AuthPanel: "div";
              Form: "form";
              Label: "label";
              Input: "input";
              Submit: "button";
              Switch: "button";
              Error: "p";
            };
          };
        };
        Routes: ShellRoutes;
      }
    >;
  };
}>;

export const shell: WebFeature<ShellFeature, OperationsWeb> = {
  programs: {
    browser: {
      state: {
        phase: "loading",
        mode: "sign-in",
        session: undefined,
        name: "",
        email: "",
        password: "",
        working: false,
        error: undefined,
      },
      actions: {
        async refresh({ dependencies, state }) {
          try {
            const session = await dependencies.identity.session();
            state.session = session;
            state.phase = session ? "signed-in" : "signed-out";
            state.error = undefined;
            redirectForSession(dependencies.navigation, Boolean(session));
          } catch (error) {
            state.phase = "signed-out";
            state.error = message(error);
            redirectForSession(dependencies.navigation, false);
          }
        },
        changeName({ state }, { value }) {
          state.name = value;
        },
        changeEmail({ state }, { value }) {
          state.email = value;
        },
        changePassword({ state }, { value }) {
          state.password = value;
        },
        switchMode({ state }) {
          state.mode = state.mode === "sign-in" ? "sign-up" : "sign-in";
          state.error = undefined;
        },
        async submit({ dependencies, state }) {
          state.working = true;
          state.error = undefined;
          try {
            state.session =
              state.mode === "sign-up"
                ? await dependencies.identity.signUp({
                    name: state.name.trim(),
                    email: state.email.trim(),
                    password: state.password,
                  })
                : await dependencies.identity.signIn({
                    email: state.email.trim(),
                    password: state.password,
                  });
            state.password = "";
            state.phase = "signed-in";
            dependencies.navigation.navigate({ to: "tasks.list", replace: true });
          } catch (error) {
            state.error = message(error);
          } finally {
            state.working = false;
          }
        },
        async signOut({ dependencies, state }) {
          state.working = true;
          try {
            await dependencies.identity.signOut();
            state.session = undefined;
            state.phase = "signed-out";
            dependencies.navigation.navigate({ to: "auth", replace: true });
          } catch (error) {
            state.error = message(error);
          } finally {
            state.working = false;
          }
        },
      },
      components: {
        Layout: {
          mount({ feature }) {
            void feature.refresh();
          },
          view({ elements, feature, slots }) {
            const {
              Root,
              Topbar,
              BrandGroup,
              Mark,
              Brand,
              Account,
              User,
              SignOut,
              Content,
              AuthLayout,
              AuthIntro,
              AuthEyebrow,
              AuthTitle,
              AuthCopy,
              AuthPanel,
              Form,
              Label,
              Input,
              Submit,
              Switch,
              Error,
            } = elements;
            return (
              <Root>
                {() =>
                  feature.phase === "loading" ? (
                    <AuthLayout>
                      <AuthIntro>
                        <AuthEyebrow>Operations workspace</AuthEyebrow>
                        <AuthTitle>Loading your workspace</AuthTitle>
                        <AuthCopy>Restoring the secure session and task stream.</AuthCopy>
                      </AuthIntro>
                    </AuthLayout>
                  ) : feature.phase === "signed-out" ? (
                    <AuthLayout aria-label="Authentication">
                      <AuthIntro>
                        <AuthEyebrow>Operations workspace</AuthEyebrow>
                        <AuthTitle>Keep work clear and moving.</AuthTitle>
                        <AuthCopy>
                          A focused task workspace with durable history and live updates.
                        </AuthCopy>
                      </AuthIntro>
                      <AuthPanel>
                        <Form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void feature.submit();
                          }}
                        >
                          {() =>
                            feature.mode === "sign-up" ? (
                              <>
                                <Label for="auth-name">Name</Label>
                                <Input
                                  id="auth-name"
                                  name="name"
                                  autocomplete="name"
                                  value={() => feature.name}
                                  onInput={(event) =>
                                    feature.changeName({ value: event.currentTarget.value })
                                  }
                                />
                              </>
                            ) : null
                          }
                          <Label for="auth-email">Email</Label>
                          <Input
                            id="auth-email"
                            name="email"
                            type="email"
                            autocomplete="email"
                            value={() => feature.email}
                            onInput={(event) =>
                              feature.changeEmail({ value: event.currentTarget.value })
                            }
                          />
                          <Label for="auth-password">Password</Label>
                          <Input
                            id="auth-password"
                            name="password"
                            type="password"
                            minlength={8}
                            autocomplete={() =>
                              feature.mode === "sign-up" ? "new-password" : "current-password"
                            }
                            value={() => feature.password}
                            onInput={(event) =>
                              feature.changePassword({ value: event.currentTarget.value })
                            }
                          />
                          <Submit type="submit" disabled={() => feature.working}>
                            {() =>
                              feature.working
                                ? "Please wait"
                                : feature.mode === "sign-up"
                                  ? "Create account"
                                  : "Sign in"
                            }
                          </Submit>
                        </Form>
                        <Switch type="button" onClick={() => feature.switchMode()}>
                          {() =>
                            feature.mode === "sign-up"
                              ? "Already have an account? Sign in"
                              : "New here? Create an account"
                          }
                        </Switch>
                        {() => (feature.error ? <Error role="alert">{feature.error}</Error> : null)}
                      </AuthPanel>
                    </AuthLayout>
                  ) : (
                    <>
                      <Topbar>
                        <BrandGroup>
                          <Mark aria-hidden="true">P</Mark>
                          <Brand>Poggers Operations</Brand>
                        </BrandGroup>
                        <Account>
                          <User>{() => feature.session?.user.email ?? ""}</User>
                          <SignOut
                            type="button"
                            disabled={() => feature.working}
                            onClick={() => void feature.signOut()}
                          >
                            Sign out
                          </SignOut>
                        </Account>
                      </Topbar>
                      <Content>{slots.Content}</Content>
                    </>
                  )
                }
              </Root>
            );
          },
        },
      },
      routes: {
        auth: {
          view({ components: { Shell } }) {
            return <Shell.Layout Content={null} />;
          },
        },
      },
    },
  },
};

function redirectForSession(
  navigation: Navigation<ShellRoutes, OperationsWeb>,
  authenticated: boolean,
) {
  const current = navigation.current();
  const auth = navigation.href({ to: "auth" });
  const onAuthRoute = `${current.pathname}${current.search}` === auth;
  if (authenticated && onAuthRoute) {
    navigation.navigate({ to: "tasks.list", replace: true });
  } else if (!authenticated && !onAuthRoute) {
    navigation.navigate({ to: "auth", replace: true });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
