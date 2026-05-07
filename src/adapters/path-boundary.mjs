import path from "node:path";
import { validateChangedPaths } from "../board/responsibility-boundaries.mjs";
import { findPrimaryWorkItem, loadRunArtifacts } from "../domain/artifacts.mjs";

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

export async function validateRunChangedPaths({ runDir, changedPaths, repoRoot }) {
  const artifacts = await loadRunArtifacts(runDir);
  const workItem = findPrimaryWorkItem(artifacts);
  return validateChangedPaths({
    workItem,
    changedPaths: changedPaths.map((filePath) => toRelativePath({ filePath, repoRoot, runDir }))
  });
}
