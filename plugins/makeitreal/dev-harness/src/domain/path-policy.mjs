import path from "node:path";

const RESERVED_CONTROL_PLANE_PREFIXES = [".makeitreal/", ".claude/", "evidence/", "preview/"];

export function reservedControlPlanePath(pattern) {
  return RESERVED_CONTROL_PLANE_PREFIXES.some((prefix) =>
    pattern === prefix.slice(0, -1) || pattern.startsWith(prefix)
  );
}

export function isCaseInsensitiveFs() {
  return process.platform === "darwin" || process.platform === "win32";
}

function containsParentSegment(normalized) {
  if (normalized === "..") {
    return true;
  }
  return normalized.startsWith("../")
    || normalized.endsWith("/..")
    || normalized.includes("/../");
}

function toForwardSlashes(value) {
  return value.replaceAll("\\", "/");
}

export function normalizeMatchInput(value) {
  if (typeof value !== "string") {
    return null;
  }
  const replaced = toForwardSlashes(value);
  const normalized = path.posix.normalize(replaced).replace(/\/+$/, "");
  if (containsParentSegment(normalized)) {
    return null;
  }
  return normalized;
}

export function matchesPattern(pattern, candidate) {
  const normalizedPattern = normalizeMatchInput(pattern);
  if (normalizedPattern === null) {
    return false;
  }
  const normalizedCandidate = normalizeMatchInput(candidate);
  if (normalizedCandidate === null) {
    return false;
  }

  const caseInsensitive = isCaseInsensitiveFs();
  const cmpPattern = caseInsensitive ? normalizedPattern.toLowerCase() : normalizedPattern;
  const cmpCandidate = caseInsensitive ? normalizedCandidate.toLowerCase() : normalizedCandidate;

  if (cmpPattern.endsWith("/**")) {
    const base = cmpPattern.slice(0, -3);
    if (base.length === 0) {
      return true;
    }
    return cmpCandidate === base || cmpCandidate.startsWith(`${base}/`);
  }
  return cmpPattern === cmpCandidate;
}

export function invalidAllowedPathPattern(pattern) {
  if (typeof pattern !== "string"
    || pattern.trim().length === 0
    || pattern.includes("\\")
    || path.isAbsolute(pattern)
    || pattern === "."
    || reservedControlPlanePath(pattern)) {
    return true;
  }
  const normalized = path.posix.normalize(pattern);
  if (normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.endsWith("/..")
    || normalized.includes("/../")) {
    return true;
  }
  return false;
}
