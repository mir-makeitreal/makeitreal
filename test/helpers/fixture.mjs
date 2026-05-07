import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function withFixture(testFunction) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-fixture-"));
  const source = new URL("../../examples/canonical/.harness/runs/feature-auth", import.meta.url);
  const runDir = path.join(root, "feature-auth");
  await cp(source, runDir, { recursive: true });
  await rm(path.join(runDir, "preview"), { recursive: true, force: true });
  await rm(path.join(runDir, "evidence"), { recursive: true, force: true });
  await rm(path.join(runDir, ".harness"), { recursive: true, force: true });

  try {
    await testFunction({ root, runDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
