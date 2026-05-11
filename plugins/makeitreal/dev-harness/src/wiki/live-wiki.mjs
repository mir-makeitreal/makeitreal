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

function asCodeList(values = []) {
  if (!values || values.length === 0) {
    return "None declared";
  }
  return values.map((value) => `\`${value}\``).join(", ");
}

function tableCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function renderTable(headers, rows) {
  if (!rows || rows.length === 0) {
    return "None recorded";
  }
  return [
    `| ${headers.map(tableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`)
  ].join("\n");
}

function matchingModuleInterfaces({ artifacts, workItem }) {
  const direct = artifacts.designPack.moduleInterfaces ?? [];
  const owned = direct.filter((moduleInterface) => moduleInterface.responsibilityUnitId === workItem.responsibilityUnitId);
  return owned.length > 0 ? owned : direct;
}

function renderSignatureTable(items = [], columns) {
  return renderTable(columns.map((column) => column.label), items.map((item) => columns.map((column) => {
    if (column.key === "required") {
      return item.required === true ? "required" : "optional";
    }
    if (column.key === "name") {
      return `\`${item.name ?? item.code ?? "item"}\``;
    }
    return item[column.key] ?? "";
  })));
}

function renderPublicSurfaces({ artifacts, workItem }) {
  const interfaces = matchingModuleInterfaces({ artifacts, workItem });
  if (interfaces.length === 0) {
    return "No module interfaces were declared.";
  }
  return `## Public Surfaces

${interfaces.map((moduleInterface) => {
    const surfaces = (moduleInterface.publicSurfaces ?? []).map((surface) => `#### ${surface.name}

${renderTable(["Field", "Value"], [
      ["Kind", `\`${surface.kind ?? "surface"}\``],
      ["Contracts", asCodeList(surface.contractIds ?? [])],
      ["Consumers", (surface.consumers ?? []).join(", ") || "None declared"],
      ["Description", surface.description ?? "None recorded"]
    ])}

Inputs:

${renderSignatureTable(surface.signature?.inputs ?? [], [
      { key: "name", label: "Name" },
      { key: "type", label: "Type" },
      { key: "required", label: "Required" },
      { key: "description", label: "Description" }
    ])}

Outputs:

${renderSignatureTable(surface.signature?.outputs ?? [], [
      { key: "name", label: "Name" },
      { key: "type", label: "Type" },
      { key: "description", label: "Description" }
    ])}

Error contract:

${renderSignatureTable(surface.signature?.errors ?? [], [
      { key: "name", label: "Code" },
      { key: "when", label: "When" },
      { key: "handling", label: "Handling" }
    ])}
`).join("\n");
    return `### Module: ${moduleInterface.moduleName ?? moduleInterface.responsibilityUnitId}

${renderTable(["Field", "Value"], [
      ["Responsibility unit", `\`${moduleInterface.responsibilityUnitId}\``],
      ["Owner", moduleInterface.owner ?? "None recorded"],
      ["Purpose", moduleInterface.purpose ?? "None recorded"],
      ["Owns", asCodeList(moduleInterface.owns ?? [])]
    ])}

${surfaces || "No public surfaces declared."}`;
  }).join("\n\n")}`;
}

function renderAcceptanceCriteria(prd) {
  return asList(prd.acceptanceCriteria ?? [], (criterion) => `\`${criterion.id ?? "AC"}\` ${criterion.statement ?? criterion}`);
}

function renderVerificationEvidence(evidence) {
  return asList(evidence.commands ?? [], (command) => `\`${formatVerificationCommand(command.command)}\` -> exit ${command.exitCode}`);
}

export function renderWikiPage({ artifacts, evidence }) {
  const workItem = findPrimaryWorkItem(artifacts);
  const boundary = (artifacts.designPack.responsibilityBoundaries ?? [])
    .find((candidate) => candidate.responsibilityUnitId === workItem.responsibilityUnitId);
  const contracts = workItem.contractIds ?? [];
  const primaryInterface = matchingModuleInterfaces({ artifacts, workItem })[0];
  const referenceName = primaryInterface?.moduleName ?? workItem.id;
  return `# Contract Reference: ${referenceName}

## Public Outcome

PRD \`${workItem.prdId}\` defines this responsibility boundary.

${asList(artifacts.prd.userVisibleBehavior ?? artifacts.prd.goals ?? [])}

## Responsibility Boundary

${renderTable(["Field", "Value"], [
    ["Owner unit", `\`${workItem.responsibilityUnitId}\``],
    ["Owned paths", asCodeList(boundary?.owns ?? workItem.allowedPaths ?? [])],
    ["May use contracts", asCodeList(boundary?.mayUseContracts ?? contracts)]
  ])}

## Contracts

${asList(contracts, (contractId) => `\`${contractId}\``)}

${renderPublicSurfaces({ artifacts, workItem })}

## Acceptance Evidence

${renderAcceptanceCriteria(artifacts.prd)}

## Completion Evidence

${renderVerificationEvidence(evidence)}

- Blueprint preview: preview/index.html

## Audit Trail

- Work item: \`${workItem.id}\`
- Wiki sync evidence is required before Done unless live wiki is disabled by config.
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
