import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const canonicalSkillRoot = path.join(repoRoot, "plugins", "makeitreal", "skills");
const mirSkillRoot = path.join(repoRoot, "plugins", "mir", "skills");

const forbiddenPublicDocReferences = [
  /\.hermes/i,
  /docs\/superpowers/i,
  /superpowers\/(plans|specs)/i,
  /docs\/e2e(?:-|\/)/i,
  /e2e-evidence/i,
  /r[23]-.*(?:e2e|release-packaging)/i,
  /backlog\.md/i,
  /doctrine-violations-full-audit/i,
  /tournament-scorecard/i,
  /session-scoped-multi-run-plan/i
];

async function listMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readCanonicalSkill(name) {
  return readFile(path.join(canonicalSkillRoot, name, "SKILL.md"), "utf8");
}

async function readMirSkill(name) {
  return readFile(path.join(mirSkillRoot, name, "SKILL.md"), "utf8");
}

for (const [label, readSkill] of [
  ["makeitreal", readCanonicalSkill],
  ["mir", readMirSkill]
]) {
  test(`${label} plan skill teaches boundary proposals and conditional review instead of vague fail-fast`, async () => {
    const skill = await readSkill("plan");

    assert.match(skill, /Conditional Grill/i);
    assert.match(skill, /Dynamic Intake/i);
    assert.match(skill, /Read-Only Parallel Reconnaissance/i);
    assert.match(skill, /Operator-Facing Questions/i);
    assert.match(skill, /Operator-Facing Blueprint Report/i);
    assert.match(skill, /vertical slice/i);
    assert.match(skill, /acceptance criteria/i);
    assert.match(skill, /Do not use a fixed question script/i);
    assert.match(skill, /derive the next question/i);
    assert.match(skill, /Do not expose internal harness terms/i);
    assert.match(skill, /Task subagents/i);
    assert.match(skill, /Do not lead with raw engine fields/i);
    assert.match(skill, /What will be delivered/i);
    assert.match(skill, /Diagnostics are secondary/i);
    assert.match(skill, /Review Decision UX/i);
    assert.match(skill, /question UI/i);
    assert.match(skill, /current Claude Code session as the review judge/i);
    assert.match(skill, /blueprint review --decision-json/i);
    assert.match(skill, /Do not branch on option labels/i);
    assert.match(skill, /If the question is dismissed/i);
  });

  test(`${label} launch skill keeps subagents scoped to one work item and selective context`, async () => {
    const skill = await readSkill("launch");

    assert.match(skill, /Scoped Subagent/i);
    assert.match(skill, /MAKEITREAL_BOARD_DIR/);
    assert.match(skill, /MAKEITREAL_WORK_ITEM_ID/);
    assert.match(skill, /selective context/i);
    assert.match(skill, /contract-first slicing/i);
    assert.match(skill, /dynamic role handoff/i);
    assert.match(skill, /pre-created Claude agent files/i);
    assert.match(skill, /DONE_WITH_CONCERNS/);
    assert.match(skill, /NEEDS_CONTEXT/);
    assert.match(skill, /Direct free-form agent-to-agent chat/i);
    assert.match(skill, /approved reviewer evidence/i);
    assert.match(skill, /routes the work item to Rework/i);
    assert.match(skill, /parent-session native Task path/i);
    assert.match(skill, /Do not spawn `claude --print`/i);
  });

  test(`${label} verify skill uses stop-the-line root-cause recovery`, async () => {
    const skill = await readSkill("verify");

    assert.match(skill, /Stop-the-Line/i);
    assert.match(skill, /reproduce/i);
    assert.match(skill, /localize/i);
    assert.match(skill, /minimal failing/i);
    assert.match(skill, /regression evidence/i);
    assert.match(skill, /Do not delete tests/i);
  });

  test(`${label} status skill reports zoom-out guidance without mutating control state`, async () => {
    const skill = await readSkill("status");

    assert.match(skill, /Zoom-Out/i);
    assert.match(skill, /why blocked/i);
    assert.match(skill, /one next action/i);
    assert.match(skill, /suggestedBoundaries/);
    assert.match(skill, /must not mutate board\/run\/approval\/config\/evidence state/);
  });
}

test("public docs do not link to internal planning or evidence artifacts", async () => {
  const markdownFiles = await listMarkdownFiles(path.join(repoRoot, "docs"));
  assert.ok(markdownFiles.length > 0);

  for (const filePath of markdownFiles) {
    const doc = await readFile(filePath, "utf8");
    const relativePath = path.relative(repoRoot, filePath);

    for (const pattern of forbiddenPublicDocReferences) {
      assert.doesNotMatch(doc, pattern, relativePath);
    }
  }
});
