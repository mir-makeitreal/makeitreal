import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { fileExists, readJsonFile, writeJsonFile } from "../io/json.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: "1.1",
  features: Object.freeze({
    liveWiki: Object.freeze({ enabled: true }),
    dashboard: Object.freeze({
      autoOpen: true,
      refreshOnStatus: true,
      refreshOnLaunch: true,
      refreshOnVerify: true
    })
  })
});

export const CONFIG_PROFILES = Object.freeze({
  default: DEFAULT_CONFIG,
  quiet: Object.freeze({
    schemaVersion: "1.1",
    features: Object.freeze({
      liveWiki: Object.freeze({ enabled: true }),
      dashboard: Object.freeze({
        autoOpen: false,
        refreshOnStatus: false,
        refreshOnLaunch: true,
        refreshOnVerify: true
      })
    })
  })
});

const ROOT_KEYS = new Set(["schemaVersion", "features"]);
const FEATURE_KEYS = new Set(["liveWiki", "dashboard"]);
const LIVE_WIKI_KEYS = new Set(["enabled"]);
const DASHBOARD_KEYS = new Set(["autoOpen", "refreshOnStatus", "refreshOnLaunch", "refreshOnVerify"]);

export function projectConfigPath(projectRoot) {
  return path.join(path.resolve(projectRoot), ".makeitreal", "config.json");
}

export function inferProjectRootFromRunDir(runDir) {
  const resolved = path.resolve(runDir);
  const marker = `${path.sep}.makeitreal${path.sep}runs${path.sep}`;
  const markerIndex = resolved.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  return resolved.slice(0, markerIndex) || path.parse(resolved).root;
}

function unknownKeyErrors(value, allowed, evidencePrefix) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => createHarnessError({
      code: "HARNESS_CONFIG_KEY_UNKNOWN",
      reason: `Unsupported Make It Real config key: ${evidencePrefix}.${key}`,
      evidence: [`${evidencePrefix}.${key}`],
      recoverable: true
    }));
}

function booleanField(value, fallback, evidence, errors) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  errors.push(createHarnessError({
    code: "HARNESS_CONFIG_VALUE_INVALID",
    reason: `${evidence} must be a boolean.`,
    evidence: [evidence],
    recoverable: true
  }));
  return fallback;
}

export function validateProjectConfig(config = {}) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {
      ok: false,
      config: null,
      errors: [createHarnessError({
        code: "HARNESS_CONFIG_SCHEMA_INVALID",
        reason: "Make It Real config must be a JSON object.",
        evidence: [".makeitreal/config.json"],
        recoverable: true
      })]
    };
  }

  errors.push(...unknownKeyErrors(config, ROOT_KEYS, "config"));
  const schemaVersion = config.schemaVersion ?? "1.1";
  if (!["1.0", "1.1"].includes(schemaVersion)) {
    errors.push(createHarnessError({
      code: "HARNESS_CONFIG_SCHEMA_UNSUPPORTED",
      reason: `Unsupported Make It Real config schemaVersion: ${schemaVersion}`,
      evidence: ["schemaVersion"],
      recoverable: true
    }));
  }

  const features = config.features ?? {};
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    errors.push(createHarnessError({
      code: "HARNESS_CONFIG_SCHEMA_INVALID",
      reason: "features must be an object.",
      evidence: ["features"],
      recoverable: true
    }));
  } else {
    errors.push(...unknownKeyErrors(features, FEATURE_KEYS, "features"));
  }

  const liveWiki = features?.liveWiki ?? {};
  if (liveWiki && (typeof liveWiki !== "object" || Array.isArray(liveWiki))) {
    errors.push(createHarnessError({
      code: "HARNESS_CONFIG_SCHEMA_INVALID",
      reason: "features.liveWiki must be an object.",
      evidence: ["features.liveWiki"],
      recoverable: true
    }));
  } else {
    errors.push(...unknownKeyErrors(liveWiki, LIVE_WIKI_KEYS, "features.liveWiki"));
  }

  const dashboard = features?.dashboard ?? {};
  if (dashboard && (typeof dashboard !== "object" || Array.isArray(dashboard))) {
    errors.push(createHarnessError({
      code: "HARNESS_CONFIG_SCHEMA_INVALID",
      reason: "features.dashboard must be an object.",
      evidence: ["features.dashboard"],
      recoverable: true
    }));
  } else {
    errors.push(...unknownKeyErrors(dashboard, DASHBOARD_KEYS, "features.dashboard"));
  }

  const normalized = {
    schemaVersion: "1.1",
    features: {
      liveWiki: {
        enabled: booleanField(
          liveWiki?.enabled,
          DEFAULT_CONFIG.features.liveWiki.enabled,
          "features.liveWiki.enabled",
          errors
        )
      },
      dashboard: {
        autoOpen: booleanField(
          dashboard?.autoOpen,
          DEFAULT_CONFIG.features.dashboard.autoOpen,
          "features.dashboard.autoOpen",
          errors
        ),
        refreshOnStatus: booleanField(
          dashboard?.refreshOnStatus,
          DEFAULT_CONFIG.features.dashboard.refreshOnStatus,
          "features.dashboard.refreshOnStatus",
          errors
        ),
        refreshOnLaunch: booleanField(
          dashboard?.refreshOnLaunch,
          DEFAULT_CONFIG.features.dashboard.refreshOnLaunch,
          "features.dashboard.refreshOnLaunch",
          errors
        ),
        refreshOnVerify: booleanField(
          dashboard?.refreshOnVerify,
          DEFAULT_CONFIG.features.dashboard.refreshOnVerify,
          "features.dashboard.refreshOnVerify",
          errors
        )
      }
    }
  };

  return { ok: errors.length === 0, config: errors.length === 0 ? normalized : null, errors };
}

export function normalizeProjectConfig(config = {}) {
  const validated = validateProjectConfig(config);
  if (!validated.ok) {
    throw new Error(validated.errors.map((error) => error.reason).join("; "));
  }
  return validated.config;
}

export async function readProjectConfig({ projectRoot }) {
  const configPath = projectConfigPath(projectRoot);
  if (!await fileExists(configPath)) {
    return {
      ok: true,
      command: "config get",
      projectRoot: path.resolve(projectRoot),
      configPath,
      source: "default",
      config: normalizeProjectConfig(),
      errors: []
    };
  }
  const validated = validateProjectConfig(await readJsonFile(configPath));
  if (!validated.ok) {
    return {
      ok: false,
      command: "config get",
      projectRoot: path.resolve(projectRoot),
      configPath,
      source: "project",
      config: null,
      errors: validated.errors
    };
  }
  return {
    ok: true,
    command: "config get",
    projectRoot: path.resolve(projectRoot),
    configPath,
    source: "project",
    config: validated.config,
    errors: []
  };
}

export async function writeProjectConfig({ projectRoot, config }) {
  const validated = validateProjectConfig(config);
  if (!validated.ok) {
    return {
      ok: false,
      command: "config set",
      projectRoot: path.resolve(projectRoot),
      configPath: projectConfigPath(projectRoot),
      source: "project",
      config: null,
      errors: validated.errors
    };
  }
  const normalized = validated.config;
  const configPath = projectConfigPath(projectRoot);
  await writeJsonFile(configPath, normalized);
  return {
    ok: true,
    command: "config set",
    projectRoot: path.resolve(projectRoot),
    configPath,
    source: "project",
    config: normalized,
    errors: []
  };
}

export async function setProjectConfigProfile({ projectRoot, profile }) {
  const config = CONFIG_PROFILES[profile];
  if (!config) {
    return {
      ok: false,
      command: "config set",
      projectRoot: path.resolve(projectRoot),
      configPath: projectConfigPath(projectRoot),
      source: "project",
      config: null,
      errors: [createHarnessError({
        code: "HARNESS_CONFIG_PROFILE_UNSUPPORTED",
        reason: `Unsupported Make It Real config profile: ${profile}`,
        evidence: ["--profile"],
        recoverable: true
      })]
    };
  }
  return writeProjectConfig({ projectRoot, config });
}

export async function setLiveWikiEnabled({ projectRoot, enabled }) {
  const current = await readProjectConfig({ projectRoot });
  if (!current.ok) {
    return { ...current, command: "config set" };
  }
  return writeProjectConfig({
    projectRoot,
    config: {
      ...current.config,
      features: {
        ...current.config.features,
        liveWiki: { enabled }
      }
    }
  });
}

export async function setDashboardRefresh({ projectRoot, autoOpen, refreshOnStatus, refreshOnLaunch, refreshOnVerify }) {
  const current = await readProjectConfig({ projectRoot });
  if (!current.ok) {
    return { ...current, command: "config set" };
  }
  return writeProjectConfig({
    projectRoot,
    config: {
      ...current.config,
      features: {
        ...current.config.features,
        dashboard: {
          ...current.config.features.dashboard,
          ...(autoOpen === null || autoOpen === undefined ? {} : { autoOpen }),
          ...(refreshOnStatus === null || refreshOnStatus === undefined ? {} : { refreshOnStatus }),
          ...(refreshOnLaunch === null || refreshOnLaunch === undefined ? {} : { refreshOnLaunch }),
          ...(refreshOnVerify === null || refreshOnVerify === undefined ? {} : { refreshOnVerify })
        }
      }
    }
  });
}

export async function resolveProjectConfigForRun({
  runDir,
  projectRoot = null,
  env = process.env
}) {
  const resolvedProjectRoot =
    projectRoot ??
    env.MAKEITREAL_PROJECT_ROOT ??
    env.CLAUDE_PROJECT_DIR ??
    inferProjectRootFromRunDir(runDir);
  if (!resolvedProjectRoot) {
    return {
      ok: true,
      command: "config get",
      projectRoot: null,
      configPath: null,
      source: "default",
      config: normalizeProjectConfig(),
      errors: []
    };
  }
  return readProjectConfig({ projectRoot: resolvedProjectRoot });
}

export function liveWikiEnabled(config) {
  return normalizeProjectConfig(config).features.liveWiki.enabled;
}

export function dashboardRefreshEnabled(config, trigger) {
  const dashboard = normalizeProjectConfig(config).features.dashboard;
  if (trigger === "status") {
    return dashboard.refreshOnStatus;
  }
  if (trigger === "launch") {
    return dashboard.refreshOnLaunch;
  }
  if (trigger === "verify") {
    return dashboard.refreshOnVerify;
  }
  throw new Error(`Unknown dashboard refresh trigger: ${trigger}`);
}
