import path from "node:path";
import { validateChangedPaths } from "../board/responsibility-boundaries.mjs";
import { findPrimaryWorkItem, loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";

function toRelativePath({ filePath, repoRoot, runDir }) {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }

  const roots = [repoRoot, runDir].filter(Boolean).map((root) => path.resolve(root));
  const resolved = path.resolve(filePath);
  for (const root of roots) {
    const relative = path.relative(root, resolved);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative;
    }
  }

  return filePath;
}

export async function validateRunChangedPaths({ runDir, changedPaths, repoRoot, workItemId = null }) {
  const artifacts = await loadRunArtifacts(runDir);
  const workItem = workItemId
    ? artifacts.workItems.find((candidate) => candidate.id === workItemId)
    : findPrimaryWorkItem(artifacts);
  if (!workItem) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_WORK_ITEM_NOT_FOUND",
        reason: `Work item not found for boundary validation: ${workItemId}.`,
        evidence: ["work-items"],
        recoverable: true
      })]
    };
  }
  return validateChangedPaths({
    workItem,
    changedPaths: changedPaths.map((filePath) => toRelativePath({ filePath, repoRoot, runDir }))
  });
}
