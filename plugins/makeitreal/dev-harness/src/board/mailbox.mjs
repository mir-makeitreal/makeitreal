import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function mailboxPath(boardDir, workerId) {
  return path.join(boardDir, "mailbox", `${workerId}.jsonl`);
}

export async function sendMailboxMessage({ boardDir, fromWorkerId, toWorkerId, workItemId, message, now }) {
  const entry = { fromWorkerId, toWorkerId, workItemId, message, timestamp: now.toISOString() };
  await mkdir(path.dirname(mailboxPath(boardDir, toWorkerId)), { recursive: true });
  await writeFile(mailboxPath(boardDir, toWorkerId), `${JSON.stringify(entry)}\n`, { flag: "a" });
  return { ok: true, message: entry, errors: [] };
}

export async function readMailbox({ boardDir, workerId }) {
  try {
    return (await readFile(mailboxPath(boardDir, workerId), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
