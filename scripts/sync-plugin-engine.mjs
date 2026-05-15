#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const embeddedRoot = path.join(repoRoot, "plugins", "makeitreal", "dev-harness");

const copiedDirectories = ["bin", "hooks", "src"];
const copiedFiles = ["package.json"];

function usage() {
  return [
    "Usage: node scripts/sync-plugin-engine.mjs [--check]",
    "",
    "Synchronizes the canonical engine into plugins/makeitreal/dev-harness.",
    "--check exits non-zero when the embedded plugin engine is stale."
  ].join("\n");
}

async function listFiles(root, relative = "") {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files.sort();
}

async function readMaybe(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function compareFile(sourcePath, targetPath, relativePath, stale) {
  const [source, target] = await Promise.all([
    readFile(sourcePath),
    readMaybe(targetPath)
  ]);
  if (target === null) {
    stale.push(`${relativePath} is missing from embedded engine`);
    return;
  }
  if (!source.equals(target)) {
    stale.push(`${relativePath} differs from canonical engine`);
  }
}

async function checkDirectory(directoryName, stale) {
  const sourceRoot = path.join(repoRoot, directoryName);
  const targetRoot = path.join(embeddedRoot, directoryName);
  const [sourceFiles, targetFiles] = await Promise.all([
    listFiles(sourceRoot),
    stat(targetRoot).then(() => listFiles(targetRoot)).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    })
  ]);
  if (targetFiles === null) {
    stale.push(`${directoryName}/ is missing from embedded engine`);
    return;
  }

  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  for (const file of sourceFiles) {
    await compareFile(
      path.join(sourceRoot, file),
      path.join(targetRoot, file),
      path.join(directoryName, file),
      stale
    );
  }
  for (const file of targetFiles) {
    if (!sourceSet.has(file)) {
      stale.push(`${path.join(directoryName, file)} exists only in embedded engine`);
    }
  }
  for (const file of sourceFiles) {
    targetSet.delete(file);
  }
}

async function checkEmbeddedEngine() {
  const stale = [];
  for (const directoryName of copiedDirectories) {
    await checkDirectory(directoryName, stale);
  }
  for (const fileName of copiedFiles) {
    await compareFile(
      path.join(repoRoot, fileName),
      path.join(embeddedRoot, fileName),
      fileName,
      stale
    );
  }
  return stale;
}

async function syncEmbeddedEngine() {
  await mkdir(embeddedRoot, { recursive: true });
  for (const directoryName of copiedDirectories) {
    const target = path.join(embeddedRoot, directoryName);
    await rm(target, { recursive: true, force: true });
    await cp(path.join(repoRoot, directoryName), target, { recursive: true });
  }
  for (const fileName of copiedFiles) {
    await writeFile(
      path.join(embeddedRoot, fileName),
      await readFile(path.join(repoRoot, fileName))
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }
  const allowed = new Set(["--check"]);
  for (const arg of args) {
    if (!allowed.has(arg)) {
      console.error(`Unknown argument: ${arg}`);
      console.error(usage());
      process.exitCode = 2;
      return;
    }
  }

  if (args.includes("--check")) {
    const stale = await checkEmbeddedEngine();
    if (stale.length > 0) {
      console.error("Embedded Make It Real plugin engine is stale:");
      for (const item of stale) {
        console.error(`- ${item}`);
      }
      console.error("Run: npm run plugin:sync");
      process.exitCode = 1;
      return;
    }
    console.log("Embedded Make It Real plugin engine is in sync.");
    return;
  }

  await syncEmbeddedEngine();
  console.log(`Synced embedded engine to ${path.relative(repoRoot, embeddedRoot)}.`);
}

await main();
