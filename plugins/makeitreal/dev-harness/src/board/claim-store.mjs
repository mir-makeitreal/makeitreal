import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { fileExists, readJsonFile, writeJsonFile } from "../io/json.mjs";
import { canTransition } from "../kanban/state-engine.mjs";
import { validateBoardBlueprintApproval } from "../blueprint/review.mjs";
import { appendBoardEvent, loadBoard, saveBoard } from "./board-store.mjs";
import { getReadyWorkItems, validateDependencyGraph } from "./dependency-graph.mjs";
import { validateBoardWorkItemBoundary, validateBoardWorkItemOwner } from "./responsibility-boundaries.mjs";

function claimPath(boardDir, workItemId) {
  return path.join(boardDir, "claims", `${workItemId}.json`);
}

function isExpired(claim, now) {
  return new Date(claim.leaseExpiresAt).getTime() <= now.getTime();
}

export async function getClaim({ boardDir, workItemId, now }) {
  const filePath = claimPath(boardDir, workItemId);
  if (!await fileExists(filePath)) {
    return null;
  }

  const claim = await readJsonFile(filePath);
  return isExpired(claim, now) ? null : claim;
}

export async function listClaims({ boardDir, now }) {
  const dirPath = path.join(boardDir, "claims");
  let names = [];
  try {
    names = await readdir(dirPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const claims = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".json")).sort()) {
    const claim = await readJsonFile(path.join(dirPath, name));
    if (!isExpired(claim, now)) {
      claims.push(claim);
    }
  }
  return claims;
}

export async function claimWorkItem({ boardDir, workItemId, workerId, now, leaseMs }) {
  const board = await loadBoard(boardDir);
  const graph = validateDependencyGraph(board);
  if (!graph.ok) {
    return { ok: false, errors: graph.errors };
  }

  const workItem = board.workItems.find((candidate) => candidate.id === workItemId);
  if (!workItem) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_WORK_ITEM_UNKNOWN",
        reason: `Unknown work item: ${workItemId}.`,
        evidence: ["board.json"]
      })]
    };
  }

  const blueprintApproval = await validateBoardBlueprintApproval({ boardDir });
  if (!blueprintApproval.ok) {
    return { ok: false, errors: blueprintApproval.errors };
  }

  const existing = await getClaim({ boardDir, workItemId, now });
  if (existing) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_CLAIM_CONFLICT",
        reason: `Work item is already claimed by ${existing.workerId}.`,
        ownerModule: existing.responsibilityUnitId ?? null,
        evidence: [`claims/${workItemId}.json`]
      })]
    };
  }

  const claimFilePath = claimPath(boardDir, workItemId);
  if (await fileExists(claimFilePath)) {
    const expiredClaim = await readJsonFile(claimFilePath);
    if (isExpired(expiredClaim, now)) {
      await rm(claimFilePath, { force: true });
      if (workItem.lane === "Claimed") {
        const expired = canTransition({
          from: workItem.lane,
          to: "Ready",
          context: { gates: { leaseExpired: true } }
        });
        if (!expired.ok) {
          return { ok: false, errors: expired.errors };
        }
        workItem.lane = "Ready";
        await saveBoard(boardDir, board);
        await appendBoardEvent(boardDir, {
          event: "claim_expired",
          workItemId,
          workerId: expiredClaim.workerId,
          timestamp: now.toISOString()
        });
      }
    }
  }

  const readyIds = new Set(getReadyWorkItems(board).map((item) => item.id));
  if (!readyIds.has(workItemId)) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: workItem.lane === "Ready" ? "HARNESS_WORK_BLOCKED" : "HARNESS_WORK_NOT_READY",
        reason: `${workItemId} is not unblocked Ready work.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["board.json"]
      })]
    };
  }

  const owner = await validateBoardWorkItemOwner({ boardDir, workItem });
  if (!owner.ok) {
    return owner;
  }

  const boundary = await validateBoardWorkItemBoundary({ boardDir, workItem });
  if (!boundary.ok) {
    return boundary;
  }

  const transition = canTransition({ from: workItem.lane, to: "Claimed", context: { gates: {} } });
  if (!transition.ok) {
    return { ok: false, errors: transition.errors };
  }

  const claim = {
    workItemId,
    workerId,
    responsibilityUnitId: workItem.responsibilityUnitId,
    claimedAt: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString()
  };
  await writeJsonFile(claimPath(boardDir, workItemId), claim);
  workItem.lane = "Claimed";
  await saveBoard(boardDir, board);
  await appendBoardEvent(boardDir, {
    event: "claim_created",
    workItemId,
    workerId,
    responsibilityUnitId: workItem.responsibilityUnitId,
    timestamp: now.toISOString()
  });
  return { ok: true, claim, errors: [] };
}

export async function releaseClaim({ boardDir, workItemId, workerId }) {
  const filePath = claimPath(boardDir, workItemId);
  if (!await fileExists(filePath)) {
    return { ok: true, errors: [] };
  }

  const claim = await readJsonFile(filePath);
  if (claim.workerId !== workerId) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_CLAIM_OWNER_MISMATCH",
        reason: `${workerId} cannot release claim owned by ${claim.workerId}.`,
        evidence: [`claims/${workItemId}.json`]
      })]
    };
  }

  await rm(filePath, { force: true });
  const board = await loadBoard(boardDir);
  const workItem = board.workItems.find((candidate) => candidate.id === workItemId);
  if (workItem?.lane === "Claimed") {
    const released = canTransition({
      from: workItem.lane,
      to: "Ready",
      context: { gates: { leaseExpired: true } }
    });
    if (!released.ok) {
      return { ok: false, errors: released.errors };
    }
    workItem.lane = "Ready";
    await saveBoard(boardDir, board);
  }
  return { ok: true, errors: [] };
}
