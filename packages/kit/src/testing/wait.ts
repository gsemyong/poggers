function wait(ms: number): Promise<void> {
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

export function withSuppressedConsole<Result>(levels: ConsoleLevel[], fn: () => Result): Result {
  const originals = new Map<ConsoleLevel, Console[ConsoleLevel]>();
  for (const level of levels) {
    originals.set(level, console[level]);
    console[level] = () => undefined;
  }

  const restore = () => {
    for (const [level, original] of originals) {
      console[level] = original;
    }
  };

  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(restore) as Result;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

type ConsoleLevel = "error" | "warn" | "log";
