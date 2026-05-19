import path from "node:path";
import { projectBoardDag } from "../domain/work-item-dag.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { LANES } from "../kanban/lanes.mjs";
import { loadRuntimeState } from "../orchestrator/runtime-state.mjs";

export function acceptanceCriteriaFor({ usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    if (apiProfile.opsLike) {
      return [
        {
          id: "AC-001",
          statement: `${apiProfile.method.toUpperCase()} ${apiProfile.routePath} exposes only the declared operational health surface.`
        },
        {
          id: "AC-002",
          statement: "Smoke verification records machine-readable evidence for local and CI execution."
        },
        {
          id: "AC-003",
          statement: `Responses declare success ${apiProfile.successStatus} and error statuses ${apiProfile.errorStatuses.join(", ")} without hidden fallback behavior.`
        },
        {
          id: "AC-004",
          statement: "Verification failure leaves recovery guidance that points to the failing command and the owning responsibility unit."
        },
        {
          id: "AC-005",
          statement: "Ready gate passes before implementation starts and Done requires verification, contract conformance, and wiki evidence."
        }
      ];
    }
    return [
      {
        id: "AC-001",
        statement: `${apiProfile.method.toUpperCase()} ${apiProfile.routePath} is the only public HTTP surface for this work item.`
      },
      {
        id: "AC-002",
        statement: `Request body declares: ${apiProfile.requestFields.join(", ")}${apiProfile.headers.length ? `; headers declare: ${apiProfile.headers.join(", ")}` : ""}.`
      },
      {
        id: "AC-003",
        statement: `Responses declare success ${apiProfile.successStatus} and error statuses ${apiProfile.errorStatuses.join(", ")}.`
      },
      {
        id: "AC-004",
        statement: "Declared dependency contracts are the only allowed cross-module calls; undeclared Inventory, persistence, or event behavior requires Blueprint revision."
      },
      {
        id: "AC-005",
        statement: "Ready gate passes before implementation starts and Done requires verification, OpenAPI conformance, and wiki evidence."
      }
    ];
  }
  if (componentProfile) {
    const criteria = [
      {
        id: "AC-001",
        statement: `${componentProfile.componentName} exposes the declared component prop/event contract without reading adjacent implementation internals.`
      }
    ];
    componentProfile.capabilities.forEach((capability, index) => {
      criteria.push({
        id: `AC-${String(index + 2).padStart(3, "0")}`,
        statement: `${componentProfile.componentName} implements declared ${capability} behavior with explicit props, state, or event callbacks.`
      });
    });
    criteria.push(
      {
        id: `AC-${String(criteria.length + 1).padStart(3, "0")}`,
        statement: `Storybook coverage includes: ${componentProfile.storybookStories.join(", ")}.`
      },
      {
        id: `AC-${String(criteria.length + 2).padStart(3, "0")}`,
        statement: `Accessibility contract includes: ${componentProfile.ariaChecklist.join("; ")}.`
      },
      {
        id: `AC-${String(criteria.length + 3).padStart(3, "0")}`,
        statement: "Verification evidence covers type safety, rendered states, accessibility expectations, visual regression, and declared user interactions."
      },
      {
        id: `AC-${String(criteria.length + 4).padStart(3, "0")}`,
        statement: "Ready gate passes before implementation starts."
      }
    );
    return criteria;
  }
  if (moduleProfile) {
    const inputNames = moduleProfile.inputs.map((input) => input.name).join(", ");
    const outputNames = moduleProfile.outputs.map((output) => output.name).join(", ");
    const caseSummary = moduleProfile.cases.length > 0
      ? ` (${moduleProfile.cases.map((contractCase) => `${contractCase.name} -> ${contractCase.output}`).join("; ")})`
      : "";
    const errorCodes = moduleProfile.errors.map((error) => error.code).join(", ");
    return [
      {
        id: "AC-001",
        statement: `${moduleProfile.surfaceName} is the only public surface for the ${moduleProfile.moduleName} responsibility unit.`
      },
      {
        id: "AC-002",
        statement: `Inputs are explicitly validated: ${inputNames}.`
      },
      {
        id: "AC-003",
        statement: `Successful execution returns declared output: ${outputNames}${caseSummary}.`
      },
      {
        id: "AC-004",
        statement: `Invalid or out-of-contract calls fail fast through declared errors: ${errorCodes}.`
      },
      {
        id: "AC-005",
        statement: "Ready gate passes before implementation starts and Done requires verification plus wiki evidence."
      }
    ];
  }
  return [
    {
      id: "AC-001",
      statement: "Implementation traces to this PRD and its generated design pack."
    },
    {
      id: "AC-002",
      statement: "Exactly one responsibility unit owns the executable work item."
    },
    {
      id: "AC-003",
      statement: "Cross-boundary communication uses only the declared contract IDs."
    },
    {
      id: "AC-004",
      statement: "Ready gate passes before implementation starts."
    }
  ];
}

export function verificationCommandLabel(commands = []) {
  const command = commands[0];
  if (!command) {
    return "declared verification command";
  }
  return [command.file, ...(command.args ?? [])].filter(Boolean).join(" ");
}

export function prdGoalsFor({ title, usesOpenApi, apiProfile, componentProfile, moduleProfile, owns, verificationCommands }) {
  const verify = verificationCommandLabel(verificationCommands);
  if (usesOpenApi) {
    return [
      `Expose ${apiProfile.method.toUpperCase()} ${apiProfile.routePath} as the declared public API contract.`,
      `Validate request, response, status, and dependency behavior through contract evidence.`,
      `Verify the slice with ${verify}.`
    ];
  }
  if (componentProfile) {
    return [
      `Deliver ${componentProfile.componentName} through its declared props, states, events, and accessibility contract.`,
      `Keep implementation inside ${owns.join(", ")}.`,
      `Verify rendered behavior and declared interactions with ${verify}.`
    ];
  }
  if (moduleProfile) {
    return [
      `Implement the ${moduleProfile.moduleName} responsibility unit inside ${owns.join(", ")}.`,
      `Expose ${moduleProfile.surfaceName} with the declared input, output, and error contract.`,
      `Verify the responsibility unit with ${verify}.`
    ];
  }
  return [
    `Deliver ${title} inside ${owns.join(", ")}.`,
    `Expose only declared public surfaces for the owning responsibility unit.`,
    `Verify the work with ${verify}.`
  ];
}

export function userVisibleBehaviorFor({ usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    return [
      `${apiProfile.method.toUpperCase()} ${apiProfile.routePath} accepts only the declared request contract and returns only declared responses.`
    ];
  }
  if (componentProfile) {
    return [
      `${componentProfile.componentName} renders the declared states and interactions without relying on adjacent implementation internals.`
    ];
  }
  if (moduleProfile) {
    const inputs = moduleProfile.inputs.map((input) => input.name).join(", ");
    const outputs = moduleProfile.outputs.map((output) => output.name).join(", ");
    const cases = moduleProfile.cases.length > 0
      ? ` Cases: ${moduleProfile.cases.map((contractCase) => `${contractCase.name} -> ${contractCase.output}`).join("; ")}.`
      : "";
    const errors = moduleProfile.errors.map((error) => error.code).join(", ");
    return [
      `${moduleProfile.surfaceName} accepts ${inputs}, returns ${outputs}, and fails through ${errors}.${cases}`
    ];
  }
  return [
    "The implemented behavior matches the PRD acceptance criteria and exposes only declared public surfaces."
  ];
}

export function trustPolicyFor({ runnerMode, runId }) {
  if (runnerMode === "claude-code") {
    return {
      schemaVersion: "1.0",
      runnerMode: "claude-code",
      realAgentLaunch: "enabled",
      approvalPolicy: "never",
      sandbox: "workspace-only",
      commandExecution: "structured-command-only",
      userInputRequired: "fail-fast",
      unsupportedToolCall: "fail-fast",
      source: "makeitreal:plan",
      runId
    };
  }

  return {
    schemaVersion: "1.0",
    runnerMode: "scripted-simulator",
    realAgentLaunch: "disabled",
    approvalPolicy: "never",
    sandbox: "workspace-only",
    commandExecution: "trusted-fixture-only",
    userInputRequired: "fail-fast",
    unsupportedToolCall: "fail-fast",
    source: "makeitreal:plan",
    runId
  };
}

export async function materializeLaunchBoard({ runDir, runId, slug, workItems, workItemDag, runnerMode }) {
  const board = {
    schemaVersion: "1.0",
    boardId: `board.${slug}`,
    blueprintRunDir: ".",
    lanes: LANES,
    workItemDAG: projectBoardDag(workItemDag),
    workItems
  };
  await writeJsonFile(path.join(runDir, "board.json"), board);
  await writeJsonFile(path.join(runDir, "trust-policy.json"), trustPolicyFor({ runnerMode, runId }));
  const runtimeState = await loadRuntimeState(runDir);
  return {
    ok: true,
    boardPath: path.join(runDir, "board.json"),
    trustPolicyPath: path.join(runDir, "trust-policy.json"),
    runtimeStatePath: path.join(runDir, "runtime-state.json"),
    runtimeState,
    errors: []
  };
}
