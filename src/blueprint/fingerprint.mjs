import { createHash } from "node:crypto";
import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { fileExists, listJsonFiles, readJsonFile, stableStringify } from "../io/json.mjs";

async function readStableJson({ runDir, relativePath }) {
  const absolutePath = path.join(runDir, relativePath);
  try {
    const value = await readJsonFile(absolutePath);
    return { ok: true, relativePath, value, errors: [] };
  } catch (error) {
    return {
      ok: false,
      relativePath,
      value: null,
      errors: [createHarnessError({
        code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
        reason: `Blueprint fingerprint input is missing or invalid JSON: ${relativePath}`,
        evidence: [relativePath],
        recoverable: true
      })]
    };
  }
}

function normalizeFingerprintValue(relativePath, value) {
  if (relativePath !== "board.json" || !value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return {
    ...value,
    workItems: (value.workItems ?? []).map((workItem) => {
      const {
        lane,
        attemptNumber,
        nextRetryAt,
        errorCode,
        ...stableWorkItem
      } = workItem;
      return stableWorkItem;
    })
  };
}

function relativeJsonFiles(runDir, dirName, files) {
  return files
    .map((filePath) => path.relative(runDir, filePath).split(path.sep).join("/"))
    .filter((relativePath) => relativePath.startsWith(`${dirName}/`))
    .sort();
}

export async function listBlueprintFingerprintFiles({ runDir }) {
  const required = [
    "prd.json",
    "design-pack.json",
    "responsibility-units.json"
  ];
  if (await fileExists(path.join(runDir, "board.json"))) {
    required.push("board.json");
  }

  const contractFiles = relativeJsonFiles(runDir, "contracts", await listJsonFiles(path.join(runDir, "contracts")));
  const workItemFiles = relativeJsonFiles(runDir, "work-items", await listJsonFiles(path.join(runDir, "work-items")));
  return [...required, ...contractFiles, ...workItemFiles].sort();
}

export async function computeBlueprintFingerprint({ runDir }) {
  const files = await listBlueprintFingerprintFiles({ runDir });
  const errors = [];

  if (!files.some((filePath) => filePath.startsWith("work-items/"))) {
    errors.push(createHarnessError({
      code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
      reason: "Blueprint fingerprint requires at least one work-items/*.json artifact.",
      evidence: ["work-items"],
      recoverable: true
    }));
  }

  const normalized = [];
  for (const relativePath of files) {
    const read = await readStableJson({ runDir, relativePath });
    if (!read.ok) {
      errors.push(...read.errors);
      continue;
    }
    normalized.push(`${relativePath}\n${stableStringify(normalizeFingerprintValue(relativePath, read.value))}`);
  }

  if (errors.length > 0) {
    return { ok: false, fingerprint: null, files, errors };
  }

  const digest = createHash("sha256");
  for (const entry of normalized.sort()) {
    digest.update(entry);
    digest.update("\n---\n");
  }

  return {
    ok: true,
    fingerprint: `sha256:${digest.digest("hex")}`,
    files,
    errors: []
  };
}
