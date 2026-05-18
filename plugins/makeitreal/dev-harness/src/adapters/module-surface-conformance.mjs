import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { fileExists } from "../io/json.mjs";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"]);

function isTestPath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.startsWith("test/")
    || normalized.includes("/test/")
    || normalized.includes("/__tests__/")
    || /[._-](test|spec)\.[cm]?[jt]sx?$/.test(normalized);
}

function isExactSourcePath(relativePath) {
  if (relativePath.includes("*")) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.extname(relativePath));
}

function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitExportList(list) {
  return list
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const alias = item.match(/\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (alias) {
        return alias[1];
      }
      return item.match(/^([A-Za-z_$][\w$]*)$/)?.[1] ?? null;
    })
    .filter(Boolean);
}

export function extractNamedModuleExports(source) {
  const exports = new Set();
  const withoutBlocks = stripBlockComments(source);
  const lines = withoutBlocks
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!line.startsWith("export ")) {
      continue;
    }

    if (/^export\s+default\b/.test(line)) {
      exports.add("default");
      continue;
    }

    const declaration = line.match(/^export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)\b/);
    if (declaration) {
      exports.add(declaration[1]);
      continue;
    }

    const variable = line.match(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/);
    if (variable) {
      exports.add(variable[1]);
      continue;
    }

    const list = line.match(/^export\s+\{([^}]+)\}/);
    if (list) {
      for (const name of splitExportList(list[1])) {
        exports.add(name);
      }
    }
  }

  return [...exports].sort();
}

function moduleInterfacesForWorkItem({ artifacts, workItem }) {
  return artifacts.designPack.moduleInterfaces
    .filter((moduleInterface) => moduleInterface.responsibilityUnitId === workItem.responsibilityUnitId)
    .filter((moduleInterface) => moduleInterface.publicSurfaces.some((surface) => surface.kind === "module"));
}

function sourcePathsFor({ moduleInterface, workItem }) {
  return [...new Set([...moduleInterface.owns, ...workItem.allowedPaths])]
    .filter(isExactSourcePath)
    .filter((relativePath) => !isTestPath(relativePath))
    .sort();
}

function resolveProjectFile({ projectRoot, relativePath }) {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }
  return null;
}

export async function validateModuleSurfaceConformance({ runDir, projectRoot, workItem }) {
  const artifacts = await loadRunArtifacts(runDir);
  const moduleInterfaces = moduleInterfacesForWorkItem({ artifacts, workItem });
  const errors = [];

  for (const moduleInterface of moduleInterfaces) {
    const declared = new Set(moduleInterface.publicSurfaces
      .filter((surface) => surface.kind === "module")
      .map((surface) => surface.name)
      .filter(Boolean));
    const sourcePaths = sourcePathsFor({ moduleInterface, workItem });
    if (sourcePaths.length === 0) {
      continue;
    }
    if (!projectRoot) {
      errors.push(createHarnessError({
        code: "HARNESS_PROJECT_ROOT_MISSING",
        reason: "Module surface conformance requires a project root.",
        ownerModule: workItem.responsibilityUnitId,
        evidence: ["projectRoot"]
      }));
      continue;
    }
    const actual = new Set();

    for (const relativePath of sourcePaths) {
      const filePath = resolveProjectFile({ projectRoot, relativePath });
      if (!filePath || !await fileExists(filePath)) {
        errors.push(createHarnessError({
          code: "HARNESS_MODULE_SURFACE_FILE_MISSING",
          reason: `Declared module surface source file is missing: ${relativePath}`,
          ownerModule: workItem.responsibilityUnitId,
          evidence: [relativePath],
          recoverable: true
        }));
        continue;
      }

      for (const name of extractNamedModuleExports(await readFile(filePath, "utf8"))) {
        actual.add(name);
      }
    }

    const missing = [...declared].filter((name) => !actual.has(name)).sort();
    const extra = [...actual].filter((name) => !declared.has(name)).sort();

    if (missing.length > 0) {
      errors.push(createHarnessError({
        code: "HARNESS_MODULE_SURFACE_MISSING",
        reason: `${workItem.id} is missing declared module exports: ${missing.join(", ")}.`,
        ownerModule: workItem.responsibilityUnitId,
        evidence: sourcePaths,
        recoverable: true
      }));
    }

    if (extra.length > 0) {
      errors.push(createHarnessError({
        code: "HARNESS_MODULE_SURFACE_EXTRA",
        reason: `${workItem.id} exposes undeclared module exports: ${extra.join(", ")}.`,
        ownerModule: workItem.responsibilityUnitId,
        evidence: sourcePaths,
        recoverable: true
      }));
    }
  }

  return { ok: errors.length === 0, errors };
}
