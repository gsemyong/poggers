import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { defineApp, testFeature } from "@poggers/kit/testing";
import definition, { type App } from "src/app";
import type { ChatProgramDeps } from "src/features/chat";

async function createChatFixture() {
  const dependencies: ChatProgramDeps = {
    ai: {
      async complete(_messages, onChunk) {
        await onChunk("Fixture stream");
        return { text: "Fixture response", parsed: null };
      },
    },
    clock: { now: () => 100 },
    ids: { create: (seed) => `fixture:${seed}` },
  };
  const runtime = await testFeature(defineApp<App>(definition), "chat", {
    actor: { id: "test" },
    dependencies: { server: dependencies },
  });
  return {
    ...runtime,
    session: runtime.api.session,
  };
}

test("the Chat fixture replaces infrastructure and exercises the semantic session", async () => {
  const fixture = await createChatFixture();
  const streaming: Array<string | null> = [];
  const stop = fixture.observe(
    (api) => api.session.streamingText,
    (value) => streaming.push(value),
  );
  expect(await fixture.session.sendMessage({ text: "Clarify this task" })).toEqual({
    ok: true,
    cursor: 1,
  });
  await fixture.drain();
  expect(fixture.session.messages).toMatchObject([
    { role: "user", content: "Clarify this task", timestamp: expect.any(Number) },
    { role: "assistant", content: "Fixture response", timestamp: 100 },
  ]);
  expect(fixture.session.status).toBe("idle");
  expect(streaming).toContain("Fixture stream");
  expect(fixture.session.streamingText).toBeNull();
  stop();
  await fixture.dispose();
});

test("chat commands reject a different actor from the Resource owner", async () => {
  const runtime = await testFeature(defineApp<App>(definition), "chat", {
    actor: { id: "intruder" },
  });
  const session = runtime.resource("chat", {
    ownerId: "owner",
    sessionId: "protected",
  });

  expect(await session.sendMessage({ text: "Read another actor's chat" })).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(() => session.messages).toThrow("Read is forbidden");
  await runtime.dispose();
});

test("the standalone chat executable serves the app", async () => {
  const appDir = resolve(import.meta.dir, "../..");
  const workingDir = await mkdtemp(resolve(tmpdir(), "poggers-chat-executable-"));
  const executable = resolve(workingDir, "chat");
  const port = await reservePort();
  await buildStandalone(appDir, executable);
  const process = Bun.spawn([executable], {
    cwd: workingDir,
    env: { ...Bun.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const response = await waitForServer(process, port);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<!doctype html>");
  } finally {
    process.kill("SIGTERM");
    expect(await process.exited).toBe(0);
    await rm(workingDir, { force: true, recursive: true });
  }
}, 30_000);

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a local port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

async function buildStandalone(appDir: string, executable: string): Promise<void> {
  const build = Bun.spawn(
    [resolve(appDir, "node_modules/.bin/poggers"), "build", "--outfile", executable],
    { cwd: appDir, stdout: "pipe", stderr: "pipe" },
  );
  const code = await build.exited;
  if (code === 0) return;
  throw new Error(
    `Standalone build exited with ${code}.\n${await new Response(build.stdout).text()}\n${await new Response(build.stderr).text()}`,
  );
}

async function waitForServer(process: Bun.Subprocess<"ignore", "pipe", "pipe">, port: number) {
  const exited = process.exited.then((code) => ({ code }));
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const state = await Promise.race([exited, Bun.sleep(50).then(() => undefined)]);
    if (state) {
      const stdout = await new Response(process.stdout).text();
      const stderr = await new Response(process.stderr).text();
      throw new Error(`Standalone app exited with ${state.code}.\n${stdout}\n${stderr}`);
    }
    try {
      return await fetch(`http://127.0.0.1:${port}/`);
    } catch {}
  }
  throw new Error("Standalone app did not start within 15 seconds.");
}
