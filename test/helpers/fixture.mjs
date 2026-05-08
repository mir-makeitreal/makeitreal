import { cp, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

export function shouldCopyFixturePath(sourceRoot, candidatePath) {
  const relativePath = path.relative(sourceRoot, candidatePath);
  if (relativePath === "") {
    return true;
  }
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }
  if (path.basename(candidatePath).endsWith(".tmp")) {
    return false;
  }
  const [firstSegment] = relativePath.split(path.sep);
  return !["preview", "evidence", ".makeitreal"].includes(firstSegment);
}

export async function withFixture(testFunction) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-fixture-"));
  const source = new URL("../../examples/canonical/.makeitreal/runs/feature-auth", import.meta.url);
  const sourcePath = fileURLToPath(source);
  const runDir = path.join(root, "feature-auth");
  await cp(sourcePath, runDir, {
    recursive: true,
    filter: (candidatePath) => shouldCopyFixturePath(sourcePath, candidatePath)
  });
  await rm(path.join(runDir, "preview"), { recursive: true, force: true });
  await rm(path.join(runDir, "evidence"), { recursive: true, force: true });
  await rm(path.join(runDir, ".makeitreal"), { recursive: true, force: true });

  try {
    await testFunction({ root, runDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
