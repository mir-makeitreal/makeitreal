import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const canonicalSkillRoot = path.join(repoRoot, "plugins", "makeitreal", "skills");
const mirSkillRoot = path.join(repoRoot, "plugins", "mir", "skills");

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
    assert.match(skill, /Shared Language/i);
    assert.match(skill, /Boundary Proposal/i);
    assert.match(skill, /vertical slice/i);
    assert.match(skill, /suggestedBoundaries/);
    assert.match(skill, /acceptance criteria/i);
  });

  test(`${label} launch skill keeps subagents scoped to one work item and selective context`, async () => {
    const skill = await readSkill("launch");

    assert.match(skill, /Scoped Subagent/i);
    assert.match(skill, /MAKEITREAL_BOARD_DIR/);
    assert.match(skill, /MAKEITREAL_WORK_ITEM_ID/);
    assert.match(skill, /selective context/i);
    assert.match(skill, /contract-first slicing/i);
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
