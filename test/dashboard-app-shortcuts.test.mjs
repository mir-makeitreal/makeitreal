import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = new URL("../src/dashboard/app/src/App.tsx", import.meta.url);

test("dashboard app declares the keyboard shortcut contract", async () => {
  const source = await readFile(appSource, "utf8");

  assert.match(source, /const VIEW_SHORTCUTS: Record<string, ViewId> = \{\s*'1': 'overview',\s*'2': 'architecture',\s*'3': 'tasks',\s*'4': 'contracts',/s);
  assert.match(source, /document\.addEventListener\('keydown', handleKeyDown\)/);
  assert.match(source, /document\.removeEventListener\('keydown', handleKeyDown\)/);
  assert.match(source, /isEditableTarget\(event\.target\)/);
  assert.match(source, /setShortcutsOpen\(true\)/);
  assert.match(source, /setShortcutsOpen\(false\)/);
  assert.match(source, /event\.key === 'Escape'/);

  for (const label of [
    "1",
    "Overview view",
    "2",
    "Architecture view",
    "3",
    "Tasks view",
    "4",
    "Contracts view",
    "5",
    "Approval view",
    "6",
    "Surfaces view",
    "7",
    "Scenarios view",
    "8",
    "Reviews view",
    "d",
    "Toggle dark/light mode",
    "?",
    "Show keyboard shortcuts",
    "Escape",
    "Close drawer or modal"
  ]) {
    assert.match(source, new RegExp(label.replace(/[/?]/g, "\\$&")));
  }
});
