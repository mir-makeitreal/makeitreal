import path from "node:path";
import { listJsonFiles, readJsonFile } from "../io/json.mjs";

export async function loadRunArtifacts(runDir) {
  const [prd, designPack, responsibilityUnits] = await Promise.all([
    readJsonFile(path.join(runDir, "prd.json")),
    readJsonFile(path.join(runDir, "design-pack.json")),
    readJsonFile(path.join(runDir, "responsibility-units.json"))
  ]);

  const contractFiles = await listJsonFiles(path.join(runDir, "contracts"));
  const workItemFiles = await listJsonFiles(path.join(runDir, "work-items"));
  const evidenceFiles = await listJsonFiles(path.join(runDir, "evidence"));

  return {
    runDir,
    prd,
    designPack,
    responsibilityUnits,
    contracts: await Promise.all(contractFiles.map(readJsonFile)),
    contractFiles,
    workItems: await Promise.all(workItemFiles.map(readJsonFile)),
    workItemFiles,
    evidence: await Promise.all(evidenceFiles.map(readJsonFile)),
    evidenceFiles
  };
}

export function findPrimaryWorkItem(artifacts) {
  const match = artifacts.workItems.find((workItem) => workItem.id === artifacts.designPack.workItemId);
  if (!match) {
    throw new Error(`Primary work item not found: ${artifacts.designPack.workItemId}`);
  }
  return match;
}
