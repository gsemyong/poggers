export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function poll(
  fn: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 10;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return;
    await wait(intervalMs);
  }

  throw new Error(`poll timed out after ${timeoutMs}ms`);
}

export function withSuppressedConsole(
  levels: Array<"error" | "warn" | "log">,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  const originals = levels.reduce<Record<string, (...args: any[]) => void>>((acc, l) => {
    acc[l] = console[l];
    return acc;
  }, {});
  for (const l of levels) {
    (console as any)[l] = () => {};
  }

  const restore = () => {
    for (const l of levels) {
      (console as any)[l] = originals[l];
    }
  };

  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        (v) => {
          restore();
          return v;
        },
        (e) => {
          restore();
          throw e;
        },
      );
    }
  } finally {
    restore();
  }
}
