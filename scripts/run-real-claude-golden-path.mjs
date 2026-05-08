#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile } from "../src/io/json.mjs";

const harnessRoot = fileURLToPath(new URL("../", import.meta.url));
const harnessBin = path.join(harnessRoot, "bin", "harness.mjs");
const evidenceDir = path.join(harnessRoot, "docs", "e2e-evidence");
const now = new Date("2026-05-07T00:00:00.000Z");
const runnerCommand = {
  file: "claude",
  args: [
    "--print",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "Read,Write,Edit,MultiEdit,Glob,Grep,LS,Task",
    "--agents",
    "${agents}",
    "--add-dir",
    "${workspace}",
    "--",
    "${prompt}"
  ]
};

function usage() {
  console.log(`run-real-claude-golden-path

Runs the Make It Real first-run golden path with a real Claude Code runner:
plan --runner claude-code -> dashboard render/open dry-run -> approve -> launch -> verify/complete -> Done.

This command is intentionally not part of npm run check because it consumes real Claude Code quota.
`);
}

function runHarness(args, { allowFailure = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [harnessBin, ...args], {
      cwd: harnessRoot,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15 * 60 * 1000
    });
    return { status: 0, stdout, json: stdout.trim() ? JSON.parse(stdout) : null };
  } catch (error) {
    if (!allowFailure) {
      throw error;
    }
    const stdout = error.stdout?.toString?.() ?? "";
    return { status: error.status ?? 1, stdout, json: stdout.trim() ? JSON.parse(stdout) : null };
  }
}

function runProcess(file, args, { allowFailure = true, cwd = harnessRoot, timeout = 30000 } = {}) {
  try {
    const stdout = execFileSync(file, args, {
      cwd,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    if (!allowFailure) {
      throw error;
    }
    return {
      status: error.status ?? 1,
      stdout: error.stdout?.toString?.() ?? "",
      stderr: error.stderr?.toString?.() ?? "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function resolveClaudeBinary() {
  const which = runProcess("zsh", ["-lc", "command -v claude"]);
  const resolvedPath = which.status === 0 ? which.stdout.trim() : null;
  const realPath = resolvedPath ? await realpath(resolvedPath).catch(() => null) : null;
  const version = resolvedPath ? runProcess(resolvedPath, ["--version"], { timeout: 30000 }) : null;
  const hash = realPath ? await sha256File(realPath).catch(() => null) : null;
  return {
    command: "claude",
    resolvedPath,
    realPath,
    hash,
    version
  };
}

async function maybeReadJson(filePath) {
  try {
    return await readJsonFile(filePath);
  } catch {
    return null;
  }
}

async function listAttempts(boardDir, workItemId) {
  const attemptsDir = path.join(boardDir, "attempts");
  let names = [];
  try {
    names = await readdir(attemptsDir);
  } catch {
    return [];
  }

  const attempts = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    const attempt = await maybeReadJson(path.join(attemptsDir, name));
    if (attempt?.workItemId === workItemId) {
      attempts.push({ ...attempt, evidenceFile: path.join(attemptsDir, name) });
    }
  }
  return attempts.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
}

function htmlHasNoMutatingControls(html) {
  return ![
    "data-harness-action",
    "makeitreal-engine blueprint approve",
    "makeitreal-engine orchestrator tick"
  ].some((needle) => html.includes(needle));
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  await mkdir(evidenceDir, { recursive: true });
  const claudeBinary = await resolveClaudeBinary();
  if (!claudeBinary.resolvedPath || !claudeBinary.realPath || !claudeBinary.hash) {
    console.log(JSON.stringify({
      ok: false,
      reason: "Claude Code binary could not be resolved.",
      claudeBinary
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-real-golden-"));
  const projectRoot = path.join(root, "project");
  await mkdir(projectRoot, { recursive: true });
  const runDir = path.join(projectRoot, ".makeitreal", "runs", "slug-stats-golden");
  const request = [
    "Build a dependency-free CommonJS module at modules/slug-stats/index.cjs.",
    "Export function slugStats(input).",
    "Throw TypeError for non-string input.",
    "For ASCII text, return { words, uniqueWords, slug }.",
    "The slug must lowercase words, keep repeated words, and join them with hyphens."
  ].join(" ");
  const verificationCommand = {
    file: "node",
    args: [
      "-e",
      "const { slugStats } = require('./modules/slug-stats/index.cjs'); const r = slugStats('Hello hello world!'); if (r.words !== 3 || r.uniqueWords !== 2 || r.slug !== 'hello-hello-world') throw new Error(JSON.stringify(r)); try { slugStats(123); throw new Error('expected TypeError'); } catch (error) { if (!(error instanceof TypeError)) throw error; } console.log('slugStats golden path ok');"
    ]
  };

  const plan = runHarness([
    "plan", projectRoot,
    "--request", request,
    "--run", "slug-stats-golden",
    "--owner", "team.utility",
    "--allowed-path", "modules/slug-stats/**",
    "--runner", "claude-code",
    "--verify", JSON.stringify(verificationCommand),
    "--now", now.toISOString()
  ]);
  const pendingStatus = runHarness(["status", projectRoot, "--now", now.toISOString()]);
  const dashboardDryRun = runHarness(["dashboard", "open", runDir, "--project-root", projectRoot, "--dry-run"]);
  const preApprovalTick = runHarness([
    "orchestrator", "tick", runDir,
    "--runner", "claude-code",
    "--runner-command", JSON.stringify(runnerCommand),
    "--worker", "worker.real-golden",
    "--now", now.toISOString()
  ], { allowFailure: true });
  const approve = runHarness(["blueprint", "approve", runDir, "--by", "operator:e2e", "--now", now.toISOString()]);
  const approvedStatus = runHarness(["status", projectRoot, "--now", now.toISOString()]);
  const readyGate = runHarness(["gate", runDir, "--target", "Ready"]);
  const tick = runHarness([
    "orchestrator", "tick", runDir,
    "--runner", "claude-code",
    "--runner-command", JSON.stringify(runnerCommand),
    "--worker", "worker.real-golden",
    "--now", now.toISOString()
  ], { allowFailure: true });

  let complete = null;
  let doneGate = null;
  if (tick.status === 0 && tick.json?.ok) {
    complete = runHarness([
      "orchestrator", "complete", runDir,
      "--work", "work.slug-stats-golden",
      "--runner", "claude-code",
      "--now", now.toISOString()
    ], { allowFailure: true });
    doneGate = runHarness(["gate", runDir, "--target", "Done"], { allowFailure: true });
  }
  const finalStatus = runHarness(["status", projectRoot, "--now", now.toISOString()], { allowFailure: true });

  const workspace = path.join(runDir, "workspaces", "work.slug-stats-golden");
  const artifactPath = path.join(workspace, "modules", "slug-stats", "index.cjs");
  const attempts = await listAttempts(runDir, "work.slug-stats-golden");
  const successfulAttempts = attempts.filter((attempt) => attempt.status === "completed");
  const previewModel = await maybeReadJson(path.join(runDir, "preview", "preview-model.json"));
  const dashboardHtml = await readFile(path.join(runDir, "preview", "index.html"), "utf8").catch(() => "");
  const productContent = await readFile(artifactPath, "utf8").catch(() => null);

  const evidence = {
    generatedAt: new Date().toISOString(),
    root,
    projectRoot,
    runDir,
    workspace,
    artifactPath,
    commands: {
      setup: null,
      plan: plan.json,
      pendingStatus: pendingStatus.json,
      dashboardDryRun: dashboardDryRun.json,
      preApprovalTick: preApprovalTick.json,
      approve: approve.json,
      approvedStatus: approvedStatus.json,
      readyGate: readyGate.json,
      tick: tick.json,
      complete: complete?.json ?? null,
      doneGate: doneGate?.json ?? null,
      finalStatus: finalStatus.json
    },
    claudeBinary,
    preview: {
      readOnly: previewModel?.operatorCockpit?.readOnly ?? null,
      controlSurface: previewModel?.operatorCockpit?.controlSurface ?? null,
      dashboardUrl: dashboardDryRun.json?.dashboardUrl ?? null,
      noMutatingControls: htmlHasNoMutatingControls(dashboardHtml)
    },
    attempts: {
      all: attempts,
      latest: attempts.at(-1) ?? null,
      latestSuccessful: successfulAttempts.at(-1) ?? null
    },
    handoff: await maybeReadJson(path.join(workspace, ".makeitreal", "handoff.json")),
    product: {
      exists: Boolean(productContent),
      content: productContent
    },
    verificationEvidence: await maybeReadJson(path.join(runDir, "evidence", "work.slug-stats-golden.verification.json")),
    wikiEvidence: await maybeReadJson(path.join(runDir, "evidence", "work.slug-stats-golden.wiki-sync.json")),
    trustPolicy: await maybeReadJson(path.join(runDir, "trust-policy.json"))
  };

  const evidencePath = path.join(evidenceDir, `real-claude-golden-path-${Date.now()}.json`);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const summary = {
    ok: Boolean(doneGate?.json?.ok),
    evidencePath,
    root,
    runDir,
    workspace,
    claudeBinaryResolved: Boolean(claudeBinary.resolvedPath && claudeBinary.realPath && claudeBinary.hash),
    planTrustPolicy: evidence.trustPolicy?.runnerMode,
    preApprovalBlocked: preApprovalTick.status !== 0 && preApprovalTick.json?.errors?.some((error) => error.code?.startsWith("HARNESS_BLUEPRINT")),
    readyGateOk: readyGate.json?.ok,
    tickOk: tick.json?.ok,
    completeOk: complete?.json?.ok ?? false,
    doneGateOk: doneGate?.json?.ok ?? false,
    finalPhase: finalStatus.json?.phase ?? null,
    attemptCaptured: Boolean(successfulAttempts.at(-1)?.runner?.mode === "claude-code"),
    artifactExists: evidence.product.exists,
    dashboardReadOnly: evidence.preview.readOnly === true && evidence.preview.controlSurface === "claude-code" && evidence.preview.noMutatingControls,
    dashboardUrl: evidence.preview.dashboardUrl,
    tickErrors: tick.json?.errors ?? [],
    completeErrors: complete?.json?.errors ?? []
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
