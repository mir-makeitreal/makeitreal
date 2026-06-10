import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REVIEW_STATUSES } from "../src/orchestrator/review-evidence.mjs";
import { AGENT_STATUSES } from "../src/orchestrator/dynamic-role-handoff.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const launchSkills = [
  "plugins/makeitreal/skills/launch/SKILL.md",
  "plugins/mir/skills/launch/SKILL.md"
];

function statusTokens(content, label, file) {
  const match = content.match(new RegExp(`${label}[^:\\n]*: ([^\\n]+)`));
  assert.ok(match, `${file}: missing "${label} ...:" line`);
  return [...match[1].matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]);
}

for (const rel of launchSkills) {
  test(`doc contract: ${rel} status vocabularies match engine constants`, () => {
    const content = readFileSync(path.join(root, rel), "utf8");

    assert.deepEqual(
      statusTokens(content, "Valid node-report `status` values", rel),
      [...AGENT_STATUSES],
      `${rel}: node-report status list must match AGENT_STATUSES`
    );
    assert.deepEqual(
      statusTokens(content, "Valid review `status` values", rel),
      [...REVIEW_STATUSES],
      `${rel}: review status list must match REVIEW_STATUSES`
    );

    const envelope = [...content.matchAll(/```json\n([\s\S]*?)```/g)]
      .map((m) => JSON.parse(m[1]))
      .find((block) => Array.isArray(block.makeitrealReviews));
    assert.ok(envelope, `${rel}: missing finish result envelope JSON example`);
    assert.ok(
      AGENT_STATUSES.includes(envelope.makeitrealReport.status),
      `${rel}: example node-report status "${envelope.makeitrealReport.status}" is not a valid AGENT_STATUSES value`
    );
    for (const review of envelope.makeitrealReviews) {
      assert.ok(
        REVIEW_STATUSES.includes(review.status),
        `${rel}: example review status "${review.status}" is not a valid REVIEW_STATUSES value`
      );
    }
  });
}
