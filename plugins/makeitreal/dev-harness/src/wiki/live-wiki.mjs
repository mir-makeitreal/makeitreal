import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readVerificationEvidence } from "../domain/evidence.mjs";
import { findPrimaryWorkItem, loadRunArtifacts } from "../domain/artifacts.mjs";
import { formatVerificationCommand } from "../domain/verification-command.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { liveWikiEnabled, resolveProjectConfigForRun } from "../config/project-config.mjs";

export function renderWikiPage({ artifacts, evidence }) {
  const workItem = findPrimaryWorkItem(artifacts);
  return `# ${workItem.id}

PRD: ${workItem.prdId}

Responsibility Unit: ${workItem.responsibilityUnitId}

Contracts:
${workItem.contractIds.map((contractId) => `- ${contractId}`).join("\n")}

Verification Evidence:
${evidence.commands.map((command) => `- ${formatVerificationCommand(command.command)} -> exit ${command.exitCode}`).join("\n")}

Preview:
- preview/index.html

Final Lane:
- Human Review -> Done requires this wiki sync evidence.
`;
}

export async function syncLiveWiki({ runDir, wikiRoot, projectRoot = null, env = process.env }) {
  const artifacts = await loadRunArtifacts(runDir);
  const workItem = findPrimaryWorkItem(artifacts);
  const verification = await readVerificationEvidence(runDir, { workItem });
  if (!verification.ok) {
    return { ok: false, errors: verification.errors, outputPath: null, evidencePath: null };
  }
  const verificationEvidence = verification.evidence;
  const config = await resolveProjectConfigForRun({ runDir, projectRoot, env });
  if (!config.ok) {
    return { ok: false, skipped: false, errors: config.errors, outputPath: null, evidencePath: null, configPath: config.configPath };
  }
  const evidencePath = path.join(runDir, "evidence", "wiki-sync.json");
  if (!liveWikiEnabled(config.config)) {
    await writeJsonFile(evidencePath, {
      kind: "wiki-sync",
      workItemId: workItem.id,
      skipped: true,
      reason: "Live wiki is disabled by Make It Real config.",
      configPath: config.configPath,
      outputPath: null
    });
    return {
      ok: true,
      skipped: true,
      errors: [],
      outputPath: null,
      evidencePath,
      configPath: config.configPath
    };
  }

  const targetRoot = wikiRoot ?? path.join(runDir, ".makeitreal", "wiki", "live");
  const outputPath = path.join(targetRoot, `${workItem.id}.md`);
  await mkdir(targetRoot, { recursive: true });
  await writeFile(outputPath, renderWikiPage({ artifacts, evidence: verificationEvidence }), "utf8");

  await writeJsonFile(evidencePath, {
    kind: "wiki-sync",
    workItemId: workItem.id,
    skipped: false,
    outputPath
  });

  return { ok: true, skipped: false, errors: [], outputPath, evidencePath };
}
