#!/usr/bin/env node

import { runVerification } from "../src/adapters/command-evidence.mjs";
import { validateOpenApiContracts } from "../src/adapters/openapi-contract.mjs";
import { loadBoard } from "../src/board/board-store.mjs";
import { claimWorkItem } from "../src/board/claim-store.mjs";
import { getReadyWorkItems, validateDependencyGraph } from "../src/board/dependency-graph.mjs";
import { sendMailboxMessage } from "../src/board/mailbox.mjs";
import { applyInteractiveBlueprintApproval } from "../src/blueprint/interactive-approval.mjs";
import { decideBlueprintReview } from "../src/blueprint/review.mjs";
import { readProjectConfig, setDashboardRefresh, setLiveWikiEnabled, setProjectConfigProfile } from "../src/config/project-config.mjs";
import { openDashboard } from "../src/dashboard/open-dashboard.mjs";
import { runDoctor } from "../src/diagnostics/doctor.mjs";
import { createHarnessError } from "../src/domain/errors.mjs";
import { runGates } from "../src/gates/index.mjs";
import { getClaudeHookStatus, installClaudeHooks } from "../src/hooks/claude-settings.mjs";
import { completeVerifiedWork } from "../src/orchestrator/board-completion.mjs";
import { finishNativeClaudeTask, orchestratorTick, reconcileBoard, startNativeClaudeTask } from "../src/orchestrator/orchestrator.mjs";
import { generatePlanRun } from "../src/plan/plan-generator.mjs";
import { refreshPreviewForTrigger, renderDesignPreview } from "../src/preview/render-preview.mjs";
import { initializeProject } from "../src/project/bootstrap.mjs";
import { readBoardStatus } from "../src/status/board-status.mjs";
import { readRunStatus } from "../src/status/run-status.mjs";
import { syncLiveWiki } from "../src/wiki/live-wiki.mjs";
import { normalizeVerificationCommand } from "../src/domain/verification-command.mjs";

function printHelp() {
  console.log(`makeitreal-engine (internal)

Internal commands used by Make It Real skills:
  design render <runDir>       Render PRD/blueprint architecture preview
  gate <runDir> --target <lane> Evaluate gates for Ready or Done
  verify <runDir>              Run declared verification commands
  config get <projectRoot>     Show Make It Real project config
  config set <projectRoot>     Update config (--profile default|quiet, --live-wiki/--dashboard-* enabled|disabled)
  wiki sync <runDir>           Sync verified work to live wiki
  contracts openapi <runDir>   Validate OpenAPI contracts
  plan <projectRoot>           Generate PRD/design/contract/work-item run artifacts
    --request <text>           Required work request
    --slug <id>                Optional stable run id alias (--run also works)
    --owner <team>             Responsibility owner for this work item
    --allowed-path <pattern>   Repeatable ownership boundary
    --api openapi|rest|none    API contract mode; rest maps to OpenAPI
    --verify <json>            Repeatable verification command: {"file":"npm","args":["test"]}
                              {"command":"npm","args":["test"]} is accepted as an alias
    --runner scripted-simulator|claude-code
  blueprint approve <runDir>   Approve Blueprint review evidence
  blueprint reject <runDir>    Reject Blueprint review evidence
  blueprint review <runDir>    Classify a review answer with the LLM judge
  setup <projectRoot>          Initialize Make It Real state and optionally record --run
  status <projectRoot>         Show the active Make It Real run state
  doctor <projectRoot>         Diagnose plugin, hooks, config, dashboard, and Claude CLI
  dashboard open <runDir>      Open the generated Kanban dashboard in the default browser
  hooks install <projectRoot>  Install Claude hook settings for a run
  hooks status <projectRoot>   Show Make It Real Claude hook status
  board status <boardDir>      Show lane counts
  board ready <boardDir>       List dependency-unblocked Ready work
  board claim <boardDir>       Claim work with --work and --worker
  board mailbox send <boardDir> Send a worker-to-worker message
  orchestrator tick <boardDir> Dispatch scripted fixture work attempts (--runner scripted-simulator)
  orchestrator native start <boardDir> Prepare a parent-session Claude Code Task handoff
  orchestrator native finish <boardDir> Record a parent-session Task result from --result-json or stdin
  orchestrator complete <boardDir> Complete verified board work with --work [--runner scripted-simulator|claude-code]
  orchestrator reconcile <boardDir> Reconcile claims and retry-ready work
`);
}

function parseTarget(argv) {
  const index = argv.indexOf("--target");
  return index === -1 ? null : argv[index + 1];
}

function parseFlag(argv, flagName) {
  const index = argv.indexOf(flagName);
  if (index !== -1) {
    return argv[index + 1];
  }
  const prefix = `${flagName}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parseFlags(argv, flagName) {
  const values = [];
  const prefix = `${flagName}=`;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flagName && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    } else if (argv[index].startsWith(prefix)) {
      values.push(argv[index].slice(prefix.length));
    }
  }
  return values;
}

function parseVerificationCommands(argv) {
  const commands = [];
  const errors = [];
  for (const raw of parseFlags(argv, "--verify")) {
    let command;
    try {
      command = JSON.parse(raw);
    } catch {
      errors.push(createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_INVALID",
        reason: "--verify must be a JSON object with file and args fields.",
        evidence: ["--verify"],
        recoverable: true
      }));
      continue;
    }

    const normalized = normalizeVerificationCommand(command);
    if (!normalized.ok) {
      errors.push(createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_INVALID",
        reason: normalized.reason,
        evidence: ["--verify"],
        recoverable: true
      }));
      continue;
    }
    commands.push(normalized.command);
  }
  return { commands, errors };
}

async function readStdinText() {
  if (process.stdin.isTTY) {
    return "";
  }
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  return raw;
}

function parseEnabledFlag(value, flagName) {
  if (["enabled", "enable", "on", "true", "yes"].includes(String(value ?? "").toLowerCase())) {
    return { ok: true, enabled: true, errors: [] };
  }
  if (["disabled", "disable", "off", "false", "no"].includes(String(value ?? "").toLowerCase())) {
    return { ok: true, enabled: false, errors: [] };
  }
  return {
    ok: false,
    enabled: null,
    errors: [createHarnessError({
      code: "HARNESS_CONFIG_VALUE_INVALID",
      reason: `${flagName} must be enabled or disabled.`,
      evidence: [flagName],
      recoverable: true
    })]
  };
}

function parseOptionalEnabledFlag(argv, flagName) {
  const value = parseFlag(argv, flagName);
  if (value === null) {
    return { present: false, ok: true, enabled: null, errors: [] };
  }
  return { present: true, ...parseEnabledFlag(value, flagName) };
}

function parseDoctorRunDir(argv) {
  const flagged = parseFlag(argv, "--run");
  if (flagged) {
    return flagged;
  }
  const positional = argv[2];
  return positional && !positional.startsWith("--") ? positional : null;
}

function deterministicNow(argv = []) {
  return new Date(parseFlag(argv, "--now") ?? "2026-04-30T00:00:00.000Z");
}

function defaultProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR?.trim() || process.cwd();
}

function resolveProjectRootArg(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : defaultProjectRoot();
}

function resolveProjectRootFlag(value) {
  return value === null ? null : resolveProjectRootArg(value);
}

function blueprintReviewCliResult(output) {
  const action = output?.makeitreal?.action ?? "unknown";
  const ok = ["approved", "rejected", "revision-requested", "already-approved"].includes(action);
  if (ok) {
    return {
      ok: true,
      command: "blueprint review",
      action,
      runDir: output.makeitreal.runDir ?? null,
      reviewPath: output.makeitreal.reviewPath ?? null,
      launchRequested: output.makeitreal.launchRequested ?? false,
      reviewedBy: output.makeitreal.reviewedBy ?? null,
      judge: output.makeitreal.judge ?? null,
      additionalContext: output.hookSpecificOutput?.additionalContext ?? null,
      errors: []
    };
  }
  return {
    ok: false,
    command: "blueprint review",
    action,
    runDir: output?.makeitreal?.runDir ?? null,
    launchRequested: output?.makeitreal?.launchRequested ?? false,
    judge: output?.makeitreal?.judge ?? null,
    additionalContext: output?.hookSpecificOutput?.additionalContext ?? null,
    errors: output?.makeitreal?.errors ?? [createHarnessError({
      code: "HARNESS_BLUEPRINT_REVIEW_UNDECIDED",
      reason: output?.makeitreal?.reason ?? "The Blueprint review answer was not classified as approve, reject, or revise.",
      evidence: ["prompt"],
      recoverable: true
    })]
  };
}

async function runCommand(argv) {
  if (argv.length === 0 || argv.includes("--help")) {
    printHelp();
    return { exitCode: 0, result: null };
  }

  if (argv[0] === "design" && argv[1] === "render") {
    const result = await renderDesignPreview({ runDir: argv[2] });
    return { exitCode: result.ok ? 0 : 1, result: { command: "design render", ...result } };
  }

  if (argv[0] === "gate") {
    const result = await runGates({ runDir: argv[1], target: parseTarget(argv) });
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "verify") {
    const result = await runVerification({ runDir: argv[1] });
    const dashboard = await refreshPreviewForTrigger({
      runDir: argv[1],
      trigger: "verify",
      now: deterministicNow(argv)
    });
    return {
      exitCode: result.ok && dashboard.ok ? 0 : 1,
      result: {
        command: "verify",
        ...result,
        ok: result.ok && dashboard.ok,
        dashboardRefresh: dashboard.dashboardRefresh,
        errors: [...(result.errors ?? []), ...(dashboard.errors ?? [])]
      }
    };
  }

  if (argv[0] === "config" && argv[1] === "get") {
    const result = await readProjectConfig({ projectRoot: resolveProjectRootArg(argv[2]) });
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "config" && argv[1] === "set") {
    const profile = parseFlag(argv, "--profile");
    const liveWiki = parseOptionalEnabledFlag(argv, "--live-wiki");
    const dashboardAutoOpen = parseOptionalEnabledFlag(argv, "--dashboard-auto-open");
    const dashboardStatus = parseOptionalEnabledFlag(argv, "--dashboard-refresh-on-status");
    const dashboardLaunch = parseOptionalEnabledFlag(argv, "--dashboard-refresh-on-launch");
    const dashboardVerify = parseOptionalEnabledFlag(argv, "--dashboard-refresh-on-verify");
    const parsedFlags = [liveWiki, dashboardAutoOpen, dashboardStatus, dashboardLaunch, dashboardVerify];
    const errors = parsedFlags.flatMap((flag) => flag.errors);
    if (errors.length > 0 || (!profile && !parsedFlags.some((flag) => flag.present))) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "config set",
          errors: errors.length > 0 ? errors : [createHarnessError({
            code: "HARNESS_CONFIG_FLAG_REQUIRED",
            reason: "config set requires at least one supported config flag.",
            evidence: ["argv"],
            recoverable: true
          })]
        }
      };
    }
    const projectRoot = resolveProjectRootArg(argv[2]);
    let result;
    if (profile) {
      result = await setProjectConfigProfile({ projectRoot, profile });
    } else if (liveWiki.present) {
      result = await setLiveWikiEnabled({ projectRoot, enabled: liveWiki.enabled });
    } else {
      result = await readProjectConfig({ projectRoot });
    }
    if (result.ok && profile && liveWiki.present) {
      result = await setLiveWikiEnabled({ projectRoot, enabled: liveWiki.enabled });
    }
    if (result.ok && (dashboardStatus.present || dashboardLaunch.present || dashboardVerify.present)) {
      result = await setDashboardRefresh({
        projectRoot,
        autoOpen: dashboardAutoOpen.present ? dashboardAutoOpen.enabled : null,
        refreshOnStatus: dashboardStatus.present ? dashboardStatus.enabled : null,
        refreshOnLaunch: dashboardLaunch.present ? dashboardLaunch.enabled : null,
        refreshOnVerify: dashboardVerify.present ? dashboardVerify.enabled : null
      });
    } else if (result.ok && dashboardAutoOpen.present) {
      result = await setDashboardRefresh({
        projectRoot,
        autoOpen: dashboardAutoOpen.enabled
      });
    }
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "wiki" && argv[1] === "sync") {
    const result = await syncLiveWiki({ runDir: argv[2] });
    return { exitCode: result.ok ? 0 : 1, result: { command: "wiki sync", ...result } };
  }

  if (argv[0] === "contracts" && argv[1] === "openapi") {
    const result = await validateOpenApiContracts({ runDir: argv[2], baselineDir: parseFlag(argv, "--baseline") });
    return { exitCode: result.ok ? 0 : 1, result: { ok: result.ok, command: "contracts openapi", errors: result.errors } };
  }

  if (argv[0] === "plan") {
    const request = parseFlag(argv, "--request");
    if (!request) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "plan",
          errors: [createHarnessError({
            code: "HARNESS_PLAN_REQUEST_REQUIRED",
            reason: "plan requires --request <text>.",
            evidence: ["argv"]
          })]
        }
      };
    }
    const parsedVerification = parseVerificationCommands(argv);
    if (parsedVerification.errors.length > 0) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "plan",
          errors: parsedVerification.errors
        }
      };
    }
    const result = await generatePlanRun({
      projectRoot: resolveProjectRootArg(argv[1]),
      request,
      runId: parseFlag(argv, "--slug") ?? parseFlag(argv, "--run"),
      owner: parseFlag(argv, "--owner") ?? "team.implementation",
      allowedPaths: parseFlags(argv, "--allowed-path"),
      apiKind: parseFlag(argv, "--api"),
      verificationCommands: parsedVerification.commands,
      runnerMode: parseFlag(argv, "--runner") ?? "scripted-simulator",
      now: deterministicNow(argv)
    });
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "blueprint" && argv[1] === "review") {
    const prompt = parseFlag(argv, "--prompt");
    if (!prompt) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "blueprint review",
          errors: [createHarnessError({
            code: "HARNESS_BLUEPRINT_REVIEW_PROMPT_REQUIRED",
            reason: "blueprint review requires --prompt <operator answer>.",
            evidence: ["--prompt"],
            recoverable: true
          })]
        }
      };
    }
    const result = blueprintReviewCliResult(await applyInteractiveBlueprintApproval({
      projectRoot: resolveProjectRootArg(parseFlag(argv, "--project-root")),
      runDir: argv[2],
      prompt,
      approvalContext: parseFlag(argv, "--context") ?? "",
      sessionId: parseFlag(argv, "--session") ?? "question-ui",
      env: process.env,
      now: deterministicNow(argv)
    }));
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "blueprint" && (argv[1] === "approve" || argv[1] === "reject")) {
    const reviewedBy = parseFlag(argv, "--by");
    const result = await decideBlueprintReview({
      runDir: argv[2],
      status: argv[1] === "approve" ? "approved" : "rejected",
      reviewedBy,
      decisionNote: parseFlag(argv, "--note"),
      reviewSource: `makeitreal:plan ${argv[1]}`,
      now: deterministicNow(argv)
    });
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "setup") {
    const result = await initializeProject({
      projectRoot: resolveProjectRootArg(argv[1]),
      runDir: parseFlag(argv, "--run"),
      source: "makeitreal:setup",
      now: deterministicNow(argv)
    });
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "status") {
    const result = await readRunStatus({
      projectRoot: resolveProjectRootArg(argv[1]),
      now: deterministicNow(argv)
    });
    if (!result.ok) {
      return { exitCode: 1, result };
    }
    const dashboard = await refreshPreviewForTrigger({
      runDir: result.runDir,
      projectRoot: resolveProjectRootArg(argv[1]),
      trigger: "status",
      now: deterministicNow(argv)
    });
    return {
      exitCode: dashboard.ok ? 0 : 1,
      result: {
        ...result,
        ok: dashboard.ok,
        dashboardRefresh: dashboard.dashboardRefresh,
        errors: dashboard.errors
      }
    };
  }

  if (argv[0] === "doctor") {
    const result = await runDoctor({
      projectRoot: resolveProjectRootArg(argv[1]),
      runDir: parseDoctorRunDir(argv),
      env: process.env,
      now: deterministicNow(argv)
    });
    return { exitCode: 0, result };
  }

  if (argv[0] === "dashboard" && argv[1] === "open") {
    if (!argv[2]) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "dashboard open",
          errors: [createHarnessError({
            code: "HARNESS_RUN_DIR_REQUIRED",
            reason: "dashboard open requires <runDir>.",
            evidence: ["argv"],
            recoverable: true
          })]
        }
      };
    }
    const result = await openDashboard({
      runDir: argv[2],
      projectRoot: resolveProjectRootFlag(parseFlag(argv, "--project-root")),
      dryRun: argv.includes("--dry-run"),
      force: argv.includes("--force")
    });
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "hooks" && argv[1] === "install") {
    const runDir = parseFlag(argv, "--run");
    if (!runDir) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "hooks install",
          errors: [createHarnessError({
            code: "HARNESS_RUN_DIR_REQUIRED",
            reason: "hooks install requires --run <runDir>.",
            evidence: ["argv"]
          })]
        }
      };
    }
    const result = await installClaudeHooks({
      projectRoot: resolveProjectRootArg(argv[2]),
      runDir,
      scope: parseFlag(argv, "--scope") ?? "local"
    });
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "hooks" && argv[1] === "status") {
    const runDir = parseFlag(argv, "--run");
    if (!runDir) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "hooks status",
          errors: [createHarnessError({
            code: "HARNESS_RUN_DIR_REQUIRED",
            reason: "hooks status requires --run <runDir>.",
            evidence: ["argv"]
          })]
        }
      };
    }
    const result = await getClaudeHookStatus({
      projectRoot: resolveProjectRootArg(argv[2]),
      runDir,
      scope: parseFlag(argv, "--scope") ?? "local"
    });
    return { exitCode: result.ok ? 0 : 1, result };
  }

  if (argv[0] === "board" && argv[1] === "status") {
    const result = await readBoardStatus({ boardDir: argv[2], now: deterministicNow(argv) });
    return { exitCode: 0, result };
  }

  if (argv[0] === "board" && argv[1] === "ready") {
    const board = await loadBoard(argv[2]);
    const graph = validateDependencyGraph(board);
    if (!graph.ok) {
      return { exitCode: 1, result: { ok: false, command: "board ready", errors: graph.errors } };
    }
    return {
      exitCode: 0,
      result: {
        ok: true,
        command: "board ready",
        workItemIds: getReadyWorkItems(board).map((item) => item.id)
      }
    };
  }

  if (argv[0] === "board" && argv[1] === "claim") {
    const workItemId = parseFlag(argv, "--work");
    if (!workItemId) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "board claim",
          errors: [createHarnessError({
            code: "HARNESS_WORK_ID_REQUIRED",
            reason: "board claim requires --work <workItemId>.",
            evidence: ["argv"]
          })]
        }
      };
    }

    const workerId = parseFlag(argv, "--worker") ?? "worker.local";
    const result = await claimWorkItem({
      boardDir: argv[2],
      workItemId,
      workerId,
      now: deterministicNow(argv),
      leaseMs: 60000
    });
    return {
      exitCode: result.ok ? 0 : 1,
      result: {
        ok: result.ok,
        command: "board claim",
        workItemId,
        workerId,
        claim: result.claim,
        errors: result.errors
      }
    };
  }

  if (argv[0] === "board" && argv[1] === "mailbox" && argv[2] === "send") {
    const boardDir = argv[3];
    const fromWorkerId = parseFlag(argv, "--from") ?? "worker.local";
    const toWorkerId = parseFlag(argv, "--to") ?? "worker.local";
    const workItemId = parseFlag(argv, "--work");
    const message = parseFlag(argv, "--message") ?? "";
    const result = await sendMailboxMessage({
      boardDir,
      fromWorkerId,
      toWorkerId,
      workItemId,
      message,
      now: deterministicNow(argv)
    });
    return {
      exitCode: result.ok ? 0 : 1,
      result: {
        ok: result.ok,
        command: "board mailbox send",
        toWorkerId,
        workItemId,
        errors: result.errors
      }
    };
  }

  if (argv[0] === "orchestrator" && argv[1] === "tick") {
    const beforeDashboard = await refreshPreviewForTrigger({
      runDir: argv[2],
      trigger: "launch",
      now: deterministicNow(argv)
    });
    if (!beforeDashboard.ok) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "orchestrator tick",
          dashboardRefresh: beforeDashboard.dashboardRefresh,
          errors: beforeDashboard.errors
        }
      };
    }
    const result = await orchestratorTick({
      boardDir: argv[2],
      workerId: parseFlag(argv, "--worker") ?? "worker.local",
      concurrency: Number.parseInt(parseFlag(argv, "--concurrency") ?? "1", 10),
      now: deterministicNow(argv),
      runnerScript: ["session_started", "turn_completed"],
      runnerMode: parseFlag(argv, "--runner") ?? "scripted-simulator"
    });
    const afterDashboard = await refreshPreviewForTrigger({
      runDir: argv[2],
      trigger: "launch",
      now: deterministicNow(argv)
    });
    return {
      exitCode: result.ok && afterDashboard.ok ? 0 : 1,
      result: {
        command: "orchestrator tick",
        ...result,
        ok: result.ok && afterDashboard.ok,
        dashboardRefresh: afterDashboard.dashboardRefresh,
        dashboardRefreshBefore: beforeDashboard.dashboardRefresh,
        errors: [...(result.errors ?? []), ...(afterDashboard.errors ?? [])]
      }
    };
  }

  if (argv[0] === "orchestrator" && argv[1] === "native" && argv[2] === "start") {
    const beforeDashboard = await refreshPreviewForTrigger({
      runDir: argv[3],
      trigger: "launch",
      now: deterministicNow(argv)
    });
    if (!beforeDashboard.ok) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "orchestrator native start",
          dashboardRefresh: beforeDashboard.dashboardRefresh,
          errors: beforeDashboard.errors
        }
      };
    }

    const result = await startNativeClaudeTask({
      boardDir: argv[3],
      workerId: parseFlag(argv, "--worker") ?? "claude-code.parent",
      now: deterministicNow(argv)
    });
    const afterDashboard = await refreshPreviewForTrigger({
      runDir: argv[3],
      trigger: "launch",
      now: deterministicNow(argv)
    });
    return {
      exitCode: result.ok && afterDashboard.ok ? 0 : 1,
      result: {
        ...result,
        ok: result.ok && afterDashboard.ok,
        dashboardRefresh: afterDashboard.dashboardRefresh,
        dashboardRefreshBefore: beforeDashboard.dashboardRefresh,
        errors: [...(result.errors ?? []), ...(afterDashboard.errors ?? [])]
      }
    };
  }

  if (argv[0] === "orchestrator" && argv[1] === "native" && argv[2] === "finish") {
    const resultText = argv.includes("--result-stdin")
      ? await readStdinText()
      : parseFlag(argv, "--result-json") ?? "";
    const result = await finishNativeClaudeTask({
      boardDir: argv[3],
      workItemId: parseFlag(argv, "--work"),
      attemptId: parseFlag(argv, "--attempt"),
      workerId: parseFlag(argv, "--worker") ?? "claude-code.parent",
      resultText,
      now: deterministicNow(argv)
    });
    return {
      exitCode: result.ok ? 0 : 1,
      result: {
        ...result,
        errors: result.errors ?? []
      }
    };
  }

  if (argv[0] === "orchestrator" && argv[1] === "complete") {
    const workItemId = parseFlag(argv, "--work");
    if (!workItemId) {
      return {
        exitCode: 1,
        result: {
          ok: false,
          command: "orchestrator complete",
          errors: [createHarnessError({
            code: "HARNESS_WORK_ID_REQUIRED",
            reason: "orchestrator complete requires --work <workItemId>.",
            evidence: ["argv"]
          })]
        }
      };
    }

    const result = await completeVerifiedWork({
      boardDir: argv[2],
      workItemId,
      runnerMode: parseFlag(argv, "--runner"),
      now: deterministicNow(argv),
      refreshBeforeDone: () => refreshPreviewForTrigger({
        runDir: argv[2],
        trigger: "launch",
        now: deterministicNow(argv)
      })
    });
    return {
      exitCode: result.ok ? 0 : 1,
      result: {
        ...result,
        errors: result.errors ?? []
      }
    };
  }

  if (argv[0] === "orchestrator" && argv[1] === "reconcile") {
    const result = await reconcileBoard({ boardDir: argv[2], now: deterministicNow(argv) });
    return { exitCode: result.ok ? 0 : 1, result: { command: "orchestrator reconcile", ...result } };
  }

  return {
    exitCode: 1,
    result: {
      ok: false,
      command: argv[0] ?? "unknown",
      errors: [{
        code: "HARNESS_COMMAND_UNKNOWN",
        reason: `Unknown command: ${argv.join(" ")}`,
        contractId: null,
        ownerModule: null,
        evidence: [],
        recoverable: false
      }]
    }
  };
}

runCommand(process.argv.slice(2)).then(({ exitCode, result }) => {
  if (result) {
    console.log(JSON.stringify(result));
  }
  process.exitCode = exitCode;
}).catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    command: "unknown",
    errors: [{
      code: "HARNESS_UNCAUGHT_ERROR",
      reason: error instanceof Error ? error.message : String(error),
      contractId: null,
      ownerModule: null,
      evidence: [],
      recoverable: false
    }]
  }));
  process.exitCode = 1;
});
