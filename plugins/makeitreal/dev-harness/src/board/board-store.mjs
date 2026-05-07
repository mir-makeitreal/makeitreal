import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeRuntimeEvent } from "../domain/runtime-events.mjs";
import { readJsonFile, writeJsonFile } from "../io/json.mjs";

export async function loadBoard(boardDir) {
  return readJsonFile(path.join(boardDir, "board.json"));
}

export async function saveBoard(boardDir, board) {
  await writeJsonFile(path.join(boardDir, "board.json"), board);
}

export async function appendBoardEvent(boardDir, event) {
  const normalized = normalizeRuntimeEvent(event);
  if (!normalized.ok) {
    return normalized;
  }
  await mkdir(boardDir, { recursive: true });
  await writeFile(path.join(boardDir, "events.jsonl"), `${JSON.stringify(normalized.event)}\n`, { flag: "a" });
  return { ok: true, event: normalized.event, errors: [] };
}
