import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dashboardRefreshEnabled, resolveProjectConfigForRun } from "../config/project-config.mjs";
import { dashboardLocation } from "../dashboard/open-dashboard.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { buildPreviewModel } from "./preview-model.mjs";
import { renderDashboardCss, renderDashboardHtml, renderDashboardJs } from "./render-dashboard-html.mjs";

function refreshEnvelope({ attempted, skipped, reason = null, configPath = null, previewDir = null, generatedAt, errors = [] }) {
  const location = previewDir
    ? dashboardLocation({ runDir: path.dirname(path.resolve(previewDir)) })
    : { indexPath: null, dashboardUrl: null };
  return {
    attempted,
    skipped,
    reason,
    configPath,
    previewDir,
    indexPath: location.indexPath,
    dashboardUrl: location.dashboardUrl,
    generatedAt: generatedAt.toISOString(),
    errors
  };
}

export async function refreshDesignPreview({ runDir, now = new Date() }) {
  const resolvedRunDir = path.resolve(runDir);
  const previewDir = path.join(resolvedRunDir, "preview");
  await mkdir(previewDir, { recursive: true });
  await writeFile(path.join(previewDir, "index.html"), "<!doctype html><title>Rendering Make It Real dashboard</title>\n", "utf8");

  const preview = await buildPreviewModel({ runDir: resolvedRunDir, now });
  if (!preview.ok) {
    return {
      ...preview,
      dashboardRefresh: refreshEnvelope({
        attempted: true,
        skipped: false,
        previewDir,
        generatedAt: now,
        errors: preview.errors
      })
    };
  }

  await writeJsonFile(path.join(previewDir, "design-pack.json"), preview.designPack);
  await writeJsonFile(path.join(previewDir, "operator-status.json"), {
    runStatus: preview.runStatus,
    boardStatus: preview.boardStatus,
    dashboardRefresh: refreshEnvelope({ attempted: true, skipped: false, previewDir, generatedAt: now })
  });
  await writeJsonFile(path.join(previewDir, "preview-model.json"), preview.model);
  await writeJsonFile(path.join(previewDir, "preview-meta.json"), {
    renderedFrom: "design-pack.json",
    statusSource: "readRunStatus/readBoardStatus",
    workItemId: preview.designPack.workItemId,
    dashboardModel: "preview-model.json"
  });
  await writeFile(path.join(previewDir, "index.html"), renderDashboardHtml(preview.model), "utf8");
  await writeFile(path.join(previewDir, "preview.css"), renderDashboardCss(), "utf8");
  await writeFile(path.join(previewDir, "preview.js"), renderDashboardJs(), "utf8");

  return {
    ok: true,
    previewDir,
    dashboardRefresh: refreshEnvelope({ attempted: true, skipped: false, previewDir, generatedAt: now }),
    errors: []
  };
}

export async function refreshPreviewForTrigger({
  runDir,
  trigger,
  projectRoot = null,
  now = new Date(),
  env = process.env
}) {
  const config = await resolveProjectConfigForRun({ runDir, projectRoot, env });
  if (!config.ok) {
    return {
      ok: false,
      dashboardRefresh: refreshEnvelope({
        attempted: false,
        skipped: false,
        reason: "Make It Real config is invalid.",
        configPath: config.configPath,
        generatedAt: now,
        errors: config.errors
      }),
      errors: config.errors
    };
  }

  if (!dashboardRefreshEnabled(config.config, trigger)) {
    const dashboardRefresh = refreshEnvelope({
      attempted: false,
      skipped: true,
      reason: `Dashboard refresh on ${trigger} is disabled by Make It Real config.`,
      configPath: config.configPath,
      generatedAt: now
    });
    return { ok: true, skipped: true, dashboardRefresh, errors: [] };
  }

  const refreshed = await refreshDesignPreview({ runDir, now });
  if (!refreshed.ok) {
    const errors = refreshed.errors.length > 0
      ? refreshed.errors
      : [createHarnessError({
          code: "HARNESS_DASHBOARD_REFRESH_FAILED",
          reason: `Dashboard refresh failed for ${trigger}.`,
          evidence: ["preview/index.html"],
          recoverable: true
        })];
    return {
      ok: false,
      dashboardRefresh: {
        ...refreshed.dashboardRefresh,
        configPath: config.configPath,
        errors
      },
      errors
    };
  }

  return {
    ok: true,
    skipped: false,
    dashboardRefresh: {
      ...refreshed.dashboardRefresh,
      configPath: config.configPath
    },
    errors: []
  };
}

export async function renderDesignPreview({ runDir, now = new Date() }) {
  return refreshDesignPreview({ runDir, now });
}
