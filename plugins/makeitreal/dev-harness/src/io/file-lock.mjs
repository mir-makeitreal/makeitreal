import { mkdir, rmdir } from "node:fs/promises";
import path from "node:path";

async function acquireLock(lockPath, timeoutMs) {
  const start = Date.now();
  let attempt = 0;
  while (true) {
    try {
      await mkdir(lockPath, { recursive: false });
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - start >= timeoutMs) {
        const lockError = new Error(`Failed to acquire lock ${lockPath} within ${timeoutMs}ms`);
        lockError.code = "HARNESS_LOCK_TIMEOUT";
        throw lockError;
      }
      attempt += 1;
      const delay = Math.min(50, 2 ** attempt) + Math.floor(Math.random() * 10);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function withFileLock({ lockPath, timeoutMs = 5000 }, fn) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  await acquireLock(lockPath, timeoutMs);
  try {
    return await fn();
  } finally {
    await rmdir(lockPath).catch(() => {});
  }
}

export function boardLockPath(boardDir) {
  return path.join(boardDir, ".board.lock");
}

export async function withBoardLock(boardDir, fn, { timeoutMs = 5000 } = {}) {
  return withFileLock({ lockPath: boardLockPath(boardDir), timeoutMs }, fn);
}
