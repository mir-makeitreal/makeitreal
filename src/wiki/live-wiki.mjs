import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readVerificationEvidence } from "../domain/evidence.mjs";
import { findPrimaryWorkItem, loadRunArtifacts } from "../domain/artifacts.mjs";
import { formatVerificationCommand } from "../domain/verification-command.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { liveWikiEnabled, resolveProjectConfigForRun } from "../config/project-config.mjs";

function asList(values = [], formatter = (value) => value) {
  if (!values || values.length === 0) {
    return "- None recorded";
  }
  return values.map((value) => `- ${formatter(value)}`).join("\n");
}

function renderVerificationEvidence(evidence) {
  return asList(evidence.commands ?? [], (command) => `\`${formatVerificationCommand(command.command)}\` -> exit ${command.exitCode}`);
}

export function renderWikiPage({ artifacts, evidence }) {
  const workItem = findPrimaryWorkItem(artifacts);
  // Doctrine: LLM decides. If wikiContent is declared on the workItem, use it verbatim.
  if (typeof workItem.wikiContent === "string" && workItem.wikiContent.trim().length > 0) {
    return workItem.wikiContent;
  }
  // Fallback: MINIMAL stub. LLM declares wikiContent; engine does not fabricate rich content.
  return `# ${workItem.id}\n\n> Wiki content not declared in blueprint. Declare workItem.wikiContent.\n\nLane: ${workItem.lane ?? "unknown"}\nResponsibility unit: ${workItem.responsibilityUnitId ?? "unknown"}`;
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
