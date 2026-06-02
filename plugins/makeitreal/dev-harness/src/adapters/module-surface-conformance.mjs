import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { fileExists } from "../io/json.mjs";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"]);

const DEFAULT_TEST_PATTERNS = [
  /^test\//,
  /\/test\//,
  /\/__tests__\//,
  /[._-](test|spec)\.[cm]?[jt]sx?$/
];

function isTestPath(relativePath, patterns = DEFAULT_TEST_PATTERNS) {
  const normalized = relativePath.split(path.sep).join("/");
  return patterns.some((pattern) =>
    typeof pattern === "string" ? normalized.includes(pattern) : pattern.test(normalized)
  );
}

function isExactSourcePath(relativePath, extensions = SOURCE_EXTENSIONS) {
  if (relativePath.includes("*")) {
    return false;
  }
  const ext = extensions instanceof Set ? extensions.has(path.extname(relativePath)) : extensions.includes(path.extname(relativePath));
  return ext;
}

function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripLineComments(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
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

function parseParameterNames(rawParams) {
  const trimmed = String(rawParams ?? "").trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.split(",")
    .map((item) => item.trim())
    .map((item) => item.replace(/=.*$/, "").trim())
    .map((item) => item.replace(/^\.\.\./, "").trim())
    .map((item) => item.match(/^([A-Za-z_$][\w$]*)/)?.[1] ?? null);
}

function expectedInputNames(surface) {
  return (surface.signature?.inputs ?? [])
    .map((input) => input.name)
    .filter(Boolean);
}

function sameSignature(expected, actual) {
  return expected.length === actual.length && expected.every((name, index) => name === actual[index]);
}

function addFunctionDescriptors(descriptors, source) {
  const patterns = [
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g,
    /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g,
    /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      descriptors.set(match[1], { kind: "function", params: parseParameterNames(match[2]) });
    }
  }

  const singleParamArrow = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/g;
  for (const match of source.matchAll(singleParamArrow)) {
    descriptors.set(match[1], { kind: "function", params: [match[2]] });
  }
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function classMethods(body) {
  const methods = new Map();
  const methodPattern = /(?:^|\n)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  for (const match of body.matchAll(methodPattern)) {
    methods.set(match[1], parseParameterNames(match[2]));
  }
  return methods;
}

function addClassDescriptors(descriptors, source) {
  const classPattern = /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/g;
  for (const match of source.matchAll(classPattern)) {
    const openIndex = match.index + match[0].lastIndexOf("{");
    const closeIndex = findMatchingBrace(source, openIndex);
    const body = closeIndex === -1 ? "" : source.slice(openIndex + 1, closeIndex);
    descriptors.set(match[1], { kind: "class", methods: classMethods(body) });
  }
}

function extractModuleDescriptors(source) {
  const cleaned = stripLineComments(stripBlockComments(source));
  const descriptors = new Map();
  addFunctionDescriptors(descriptors, cleaned);
  addClassDescriptors(descriptors, cleaned);

  const variable = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g;
  for (const match of cleaned.matchAll(variable)) {
    if (!descriptors.has(match[1])) {
      descriptors.set(match[1], { kind: "value" });
    }
  }

  return descriptors;
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

function surfaceDescriptor({ actual, descriptors, surfaceName }) {
  if (actual.has(surfaceName) && descriptors.has(surfaceName)) {
    return descriptors.get(surfaceName);
  }

  const dotted = surfaceName.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
  if (!dotted) {
    return null;
  }
  if (!actual.has(dotted[1])) {
    return null;
  }
  const classDescriptor = descriptors.get(dotted[1]);
  if (classDescriptor?.kind !== "class") {
    return null;
  }
  if (!classDescriptor.methods.has(dotted[2])) {
    return null;
  }
  return { kind: "method", params: classDescriptor.methods.get(dotted[2]) };
}

function exportSatisfiesSurface({ actual, descriptors, surfaceName }) {
  if (actual.has(surfaceName)) {
    return true;
  }
  return Boolean(surfaceDescriptor({ actual, descriptors, surfaceName }));
}

function actualExportIsDeclared({ actualName, declared, descriptors }) {
  if (declared.has(actualName)) {
    return true;
  }
  for (const surfaceName of declared) {
    const dotted = surfaceName.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
    if (dotted?.[1] === actualName && surfaceDescriptor({ actual: new Set([actualName]), descriptors, surfaceName })) {
      return true;
    }
  }
  return false;
}

function moduleInterfacesForWorkItem({ artifacts, workItem }) {
  return artifacts.designPack.moduleInterfaces
    .filter((moduleInterface) => moduleInterface.responsibilityUnitId === workItem.responsibilityUnitId)
    .filter((moduleInterface) => moduleInterface.publicSurfaces.some((surface) => surface.kind === "module"));
}

function sourcePathsFor({ moduleInterface, workItem, projectConfig }) {
  const extensions = projectConfig?.sourceExtensions
    ? new Set(projectConfig.sourceExtensions)
    : SOURCE_EXTENSIONS;
  const patterns = projectConfig?.testPathPatterns ?? DEFAULT_TEST_PATTERNS;
  return [...new Set([...moduleInterface.owns, ...workItem.allowedPaths])]
    .filter((p) => isExactSourcePath(p, extensions))
    .filter((relativePath) => !isTestPath(relativePath, patterns))
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

export async function validateModuleSurfaceConformance({ runDir, projectRoot, workItem, projectConfig = null }) {
  const artifacts = await loadRunArtifacts(runDir);
  const moduleInterfaces = moduleInterfacesForWorkItem({ artifacts, workItem });
  const errors = [];

  for (const moduleInterface of moduleInterfaces) {
    const declared = new Set(moduleInterface.publicSurfaces
      .filter((surface) => surface.kind === "module")
      .map((surface) => surface.name)
      .filter(Boolean));
    const sourcePaths = sourcePathsFor({ moduleInterface, workItem, projectConfig });
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
    const descriptors = new Map();

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

      const source = await readFile(filePath, "utf8");
      for (const [name, descriptor] of extractModuleDescriptors(source)) {
        descriptors.set(name, descriptor);
      }
      for (const name of extractNamedModuleExports(source)) {
        actual.add(name);
      }
    }

    const missing = [...declared].filter((name) => !exportSatisfiesSurface({ actual, descriptors, surfaceName: name })).sort();
    const extra = [...actual].filter((name) => !actualExportIsDeclared({ actualName: name, declared, descriptors })).sort();

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

    for (const surface of moduleInterface.publicSurfaces.filter((item) => item.kind === "module")) {
      const descriptor = surfaceDescriptor({ actual, descriptors, surfaceName: surface.name });
      const expected = expectedInputNames(surface);
      if (!descriptor?.params) {
        if (expected.length > 0) {
          errors.push(createHarnessError({
            code: "HARNESS_MODULE_SIGNATURE_UNVERIFIABLE",
            reason: `${workItem.id} exposes ${surface.name}, but its declared input signature cannot be verified from the owned source files.`,
            ownerModule: workItem.responsibilityUnitId,
            evidence: sourcePaths,
            recoverable: true
          }));
        }
        continue;
      }
      if (!sameSignature(expected, descriptor.params)) {
        errors.push(createHarnessError({
          code: "HARNESS_MODULE_SIGNATURE_MISMATCH",
          reason: `${workItem.id} exposes ${surface.name} with parameter signature drift: expected ${expected.join(", ") || "(none)"}; actual ${descriptor.params.join(", ") || "(none)"}.`,
          ownerModule: workItem.responsibilityUnitId,
          evidence: sourcePaths,
          recoverable: true
        }));
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
