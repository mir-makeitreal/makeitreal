import path from "node:path";

const RESERVED_CONTROL_PLANE_PREFIXES = [".harness/", ".claude/", "evidence/", "preview/"];

export function reservedControlPlanePath(pattern) {
  return RESERVED_CONTROL_PLANE_PREFIXES.some((prefix) =>
    pattern === prefix.slice(0, -1) || pattern.startsWith(prefix)
  );
}

export function invalidAllowedPathPattern(pattern) {
  return typeof pattern !== "string"
    || pattern.trim().length === 0
    || path.isAbsolute(pattern)
    || pattern === "."
    || pattern === ".."
    || pattern.startsWith("../")
    || pattern.includes("/../")
    || pattern.includes("\\")
    || reservedControlPlanePath(pattern);
}
