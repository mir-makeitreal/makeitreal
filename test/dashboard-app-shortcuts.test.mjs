import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = new URL("../src/dashboard/app/src/App.tsx", import.meta.url);
const sidebarSource = new URL("../src/dashboard/app/src/components/Sidebar.tsx", import.meta.url);

test("dashboard app is a single scrollable architecture document", async () => {
  const source = await readFile(appSource, "utf8");

  // Sections are declared with ids for scroll-to anchors.
  for (const label of [
    "'architecture'",
    "'execution'",
    "'modules'",
    "'surfaces'",
    "'scenarios'",
    "Architecture",
    "Execution Plan",
    "Modules",
    "Contract Surfaces",
    "Scenarios",
  ]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  // Scroll spy via IntersectionObserver is wired up.
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /setActiveSection/);

  // Page is a document, not a tabbed dashboard.
  assert.match(source, /Architecture Dossier/);
  assert.doesNotMatch(source, /KanbanBoard/);
  assert.doesNotMatch(source, /ApprovalScopeView/);
  assert.doesNotMatch(source, /HeroSection/);
  assert.doesNotMatch(source, /ReviewDecisionsView/);
  assert.doesNotMatch(source, /EvidencePanel/);
});

test("sidebar renders a table of contents", async () => {
  const source = await readFile(sidebarSource, "utf8");

  assert.match(source, /doc-toc/);
  assert.match(source, /activeSection/);
  assert.match(source, /scrollIntoView/);
});
