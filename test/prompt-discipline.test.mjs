import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const canonicalSkillRoot = path.join(repoRoot, "plugins", "makeitreal", "skills");
const mirSkillRoot = path.join(repoRoot, "plugins", "mir", "skills");
const implementationPlansRoot = path.join(repoRoot, "docs", "superpowers", "plans");
const gsdSpecKitReviewPath = path.join(repoRoot, "docs", "research", "2026-05-08-gsd-speckit-feature-review.md");

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
    assert.match(skill, /Dynamic Intake/i);
    assert.match(skill, /Read-Only Parallel Reconnaissance/i);
    assert.match(skill, /Operator-Facing Questions/i);
    assert.match(skill, /Operator-Facing Blueprint Report/i);
    assert.match(skill, /vertical slice/i);
    assert.match(skill, /suggestedBoundaries/);
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
    assert.match(skill, /same LLM review judge/i);
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

test("implementation plans are self-contained and do not require external workflow skills", async () => {
  const planFiles = (await readdir(implementationPlansRoot)).filter((fileName) => fileName.endsWith(".md"));
  assert.ok(planFiles.length > 0);

  for (const fileName of planFiles) {
    const plan = await readFile(path.join(implementationPlansRoot, fileName), "utf8");
    assert.match(plan, /This plan is self-contained/i, fileName);
    assert.doesNotMatch(plan, /REQUIRED SUB-SKILL/i, fileName);
    assert.doesNotMatch(plan, /superpowers:(subagent-driven-development|executing-plans)/i, fileName);
  }
});

test("GSD and Spec Kit review captures dynamic subagent architecture without external agent dependency", async () => {
  const review = await readFile(gsdSpecKitReviewPath, "utf8");

  assert.match(review, /Superpowers Subagent-Driven Development Review/);
  assert.match(review, /fresh subagent per work item attempt/i);
  assert.match(review, /spec compliance reviewer/i);
  assert.match(review, /code quality reviewer/i);
  assert.match(review, /Native Claude Compatibility Without Pre-Created Agents/);
  assert.match(review, /Selective Adoption Decision/);
  assert.match(review, /pre-created role agents are not/i);
  assert.match(review, /dynamic prompts and handoff packets/i);
  assert.match(review, /Dynamic role handoff templates/i);
  assert.match(review, /Control-plane coordination/i);
  assert.match(review, /Direct free-form agent-to-agent chat/i);
  assert.match(review, /Worker self-scoping/i);
  assert.match(review, /optional .*\.claude\/agents/);
  assert.match(review, /drifts from the engine-generated handoff/i);
  assert.match(review, /does not require\s+Superpowers/i);
  assert.match(review, /must stay self-contained/i);
  assert.doesNotMatch(review, /REQUIRED SUB-SKILL/i);
  assert.doesNotMatch(review, /should therefore ship a small plugin `agents` roster/i);
});
