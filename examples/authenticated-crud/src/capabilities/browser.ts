import type { ProgramCapabilities, ProgramExternalCapabilities } from "@poggers/kit";
import { createAuthClient } from "better-auth/client";

import type { App } from "../app";
import type { IdentityClient, Session } from "../features/identity";
import { createTasksClient, type TaskDestination, type TaskNavigation } from "../features/tasks";

export function createBrowserCapabilities(
  input: Readonly<{ serverOrigin?: string; taskPath?: string }> = {},
): ProgramExternalCapabilities<App, "browser"> {
  const serverOrigin = input.serverOrigin ?? "http://localhost:3010";
  return {
    identity: createIdentityClient(serverOrigin),
    tasks: createTasksClient(serverOrigin),
    navigation: createTaskNavigation(input.taskPath ?? "/tasks"),
  };
}

export default {
  development: () => createBrowserCapabilities(),
  production: () => createBrowserCapabilities(),
} satisfies ProgramCapabilities<App, "browser">;

function createIdentityClient(origin: string): IdentityClient {
  const auth = createAuthClient({ baseURL: origin });
  return Object.freeze({
    async session() {
      const result = await auth.getSession();
      if (result.error) throw new Error(result.error.message ?? "Unable to read the session.");
      return result.data ? session(result.data) : undefined;
    },
    async signIn(input) {
      const result = await auth.signIn.email(input);
      if (result.error) throw new Error(result.error.message ?? "Unable to sign in.");
      if (!result.data) throw new Error("Better Auth returned no session after sign in.");
      return session(result.data);
    },
    async signUp(input) {
      const result = await auth.signUp.email(input);
      if (result.error) throw new Error(result.error.message ?? "Unable to create the account.");
      if (!result.data) throw new Error("Better Auth returned no session after sign up.");
      return session(result.data);
    },
    async signOut() {
      const result = await auth.signOut();
      if (result.error) throw new Error(result.error.message ?? "Unable to sign out.");
    },
  });
}

function createTaskNavigation(base: string): TaskNavigation & Disposable {
  const listeners = new Set<(destination: TaskDestination) => void>();
  const read = () => parseDestination(location.pathname, base);
  const publish = () => {
    const destination = read();
    for (const listener of listeners) listener(destination);
  };
  addEventListener("popstate", publish);
  return {
    current: read,
    navigate({ destination, replace = false }) {
      const url = destinationUrl(destination, base);
      if (replace) history.replaceState(null, "", url);
      else history.pushState(null, "", url);
      publish();
    },
    subscribe(receive) {
      listeners.add(receive);
      return { [Symbol.dispose]: () => listeners.delete(receive) };
    },
    [Symbol.dispose]() {
      removeEventListener("popstate", publish);
      listeners.clear();
    },
  };
}

function parseDestination(pathname: string, base: string): TaskDestination {
  const normalized = pathname.replace(/\/$/, "") || "/";
  if (normalized === `${base}/new`) return { name: "create" };
  if (normalized.startsWith(`${base}/`)) {
    const id = decodeURIComponent(normalized.slice(base.length + 1));
    if (id) return { name: "edit", id };
  }
  return { name: "list" };
}

function destinationUrl(destination: TaskDestination, base: string): string {
  if (destination.name === "create") return `${base}/new`;
  if (destination.name === "edit") return `${base}/${encodeURIComponent(destination.id)}`;
  return base;
}

function session(value: { user: { id: string; name: string; email: string } }): Session {
  return { user: { id: value.user.id, name: value.user.name, email: value.user.email } };
}
