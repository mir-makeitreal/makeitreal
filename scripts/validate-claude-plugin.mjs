#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const targets = [
  {
    kind: "plugin",
    path: path.join(repoRoot, "plugins", "makeitreal")
  },
  {
    kind: "plugin",
    path: path.join(repoRoot, "plugins", "mir")
  },
  {
    kind: "marketplace",
    path: path.join(repoRoot, ".claude-plugin", "marketplace.json")
  }
];

function usage() {
  console.log(`validate-claude-plugin

Validates the Make It Real Claude Code plugin packaging with the local Claude CLI.

Checks:
- claude plugin validate plugins/makeitreal
- claude plugin validate plugins/mir
- claude plugin validate .claude-plugin/marketplace.json

This command does not run real Claude Code tasks or consume model quota.
`);
}

function runClaude(args) {
  const result = spawnSync("claude", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? result.error.message : null
  };
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const version = runClaude(["--version"]);
  if (version.status !== 0) {
    console.log(JSON.stringify({
      ok: false,
      command: "plugin:validate",
      error: "Claude CLI is required to validate Claude Code plugin packaging.",
      version
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const validations = targets.map((target) => {
    const result = runClaude(["plugin", "validate", target.path]);
    return {
      ...target,
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      error: result.error
    };
  });
  const ok = validations.every((validation) => validation.ok);

  console.log(JSON.stringify({
    ok,
    command: "plugin:validate",
    claudeVersion: version.stdout.trim() || version.stderr.trim(),
    validations
  }, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
}

main();
