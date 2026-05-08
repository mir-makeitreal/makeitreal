import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";

export function resolveWorkspace({ boardDir, workItemId }) {
  if (!/^[A-Za-z0-9._-]+$/.test(workItemId)) {
    return {
      ok: false,
      workspace: null,
      errors: [createHarnessError({
        code: "HARNESS_WORKSPACE_ESCAPE",
        reason: "Work item id contains unsafe workspace characters.",
        evidence: ["workItemId"]
      })]
    };
  }

  const root = path.resolve(boardDir, "workspaces");
  const workspace = path.resolve(root, workItemId);
  if (!workspace.startsWith(`${root}${path.sep}`)) {
    return {
      ok: false,
      workspace: null,
      errors: [createHarnessError({
        code: "HARNESS_WORKSPACE_ESCAPE",
        reason: "Workspace escaped board root.",
        evidence: ["workspaces"]
      })]
    };
  }

  return { ok: true, workspace, errors: [] };
}

export function validateWorkspaceCwd({ workspace, cwd }) {
  if (!cwd) {
    return { ok: true, errors: [] };
  }

  if (path.resolve(cwd) !== path.resolve(workspace)) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_WORKSPACE_CWD_INVALID",
        reason: "Runner cwd must equal the deterministic workspace path.",
        evidence: ["workspace"]
      })]
    };
  }

  return { ok: true, errors: [] };
}

export function resolveProjectRootForRun({ runDir }) {
  const resolvedRunDir = path.resolve(runDir);
  const runsDir = path.dirname(resolvedRunDir);
  const makeitrealDir = path.dirname(runsDir);
  if (path.basename(runsDir) !== "runs" || path.basename(makeitrealDir) !== ".makeitreal") {
    return null;
  }
  return path.dirname(makeitrealDir);
}
