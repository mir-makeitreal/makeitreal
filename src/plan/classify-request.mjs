import { invalidAllowedPathPattern } from "../domain/path-policy.mjs";
import { uniqueValues, escapeRegExp, pascalName, humanizeIdentifier, resourcePathFromRequest } from "./heuristics.mjs";

export { componentProfileFromRequest } from "./component-profile.mjs";
export { moduleProfileFromRequest } from "./module-profile.mjs";
export { apiProfileFromRequest } from "./openapi-scaffold.mjs";

export function normalizedApiKind(explicitKind) {
  if (!explicitKind) {
    return null;
  }
  const value = String(explicitKind).toLowerCase();
  if (["openapi", "rest", "swagger", "http"].includes(value)) {
    return "openapi";
  }
  if (["none", "false", "off"].includes(value)) {
    return "none";
  }
  return value;
}

export function isApiLike(request, explicitKind) {
  const kind = normalizedApiKind(explicitKind);
  if (kind) {
    return kind === "openapi";
  }
  if (hasPublicApiContractIntent(request)) {
    return true;
  }
  if (isModuleIoLike(request)) {
    return false;
  }
  return /\b(openapi|swagger)\b/i.test(request);
}

export function hasPublicApiContractIntent(request) {
  const text = String(request ?? "");
  return /\b(openapi|swagger)\b/i.test(text)
    || /\b(?:public|external|client[-\s]?facing)?\s*(?:rest|http)?\s*api\s+(?:endpoint|contract|surface)\b/i.test(text)
    || /\b(?:backend|back-end|server|service)\s+API\b/i.test(text)
    || /\b(?:build|create|implement|add|expose)\s+(?:a\s+|an\s+)?(?:rest\s+|http\s+)?(?:api\s+)?endpoint\b/i.test(text)
    || /\b(?:build|create|implement|add|expose)\s+(?:a\s+|an\s+)?REST\s+API\b/i.test(text);
}

export function isModuleIoLike(request) {
  const text = String(request ?? "");
  const declaresCodeSurface = /\b(exporting?|exposes?|function|module|library|utility|parser|matcher|normalizer|view[-\s]?model|component|class)\b/i.test(text)
    || /\b[A-Za-z_$][\w$]*\s*\([^)]*\)/.test(text);
  const declaresLocalUnit = /\b(local|in[-\s]?process|internal|pure\s+(javascript|typescript)|responsibility\s+unit|source|codebase|contract:\s*)\b/i.test(text)
    || explicitAllowedPathsFromRequest(text).length > 0;
  return declaresCodeSurface && declaresLocalUnit;
}

export function isOpsLike(request) {
  return /\b(ops|operational|platform|deployment|readiness|health[-\s]?check|healthz|smoke|ci|runbook|recovery)\b/i.test(request);
}

export function hasApiOwnedPath(owns) {
  return owns.some((candidate) => /(^|\/)(api|routes?)(\/|$)/i.test(String(candidate ?? "").replaceAll("\\", "/")));
}

export function defaultAllowedPaths(slug) {
  return [`modules/${slug}/**`];
}

export function allowedPathsMatch(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function resolveOwnedPaths({ allowedPaths, requestAllowedPaths, slug }) {
  const defaults = defaultAllowedPaths(slug);
  if (requestAllowedPaths.length > 0 && allowedPathsMatch(allowedPaths, defaults)) {
    return requestAllowedPaths;
  }
  if (allowedPaths.length > 0) {
    return allowedPaths;
  }
  if (requestAllowedPaths.length > 0) {
    return requestAllowedPaths;
  }
  return defaults;
}

export function explicitAllowedPathsFromRequest(request) {
  const text = String(request ?? "");
  const candidates = [];
  const tokenPattern = /(?:^|[\s("'`])([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:\/|\.[A-Za-z0-9._-]+)?)(?=$|[\s)"'`,.;:!?])/g;
  for (const match of text.matchAll(tokenPattern)) {
    const candidate = match[1].replace(/\/+$/, "").replace(/[.,;:!?]+$/, "");
    if (!candidate || candidate.startsWith("http/") || candidate.startsWith("https/")) {
      continue;
    }
    const root = candidate.split("/")[0];
    const hasFileExtension = /\.[A-Za-z0-9._-]+$/.test(candidate);
    const looksLikeGlob = candidate.endsWith("/**");
    const knownProjectRoot = [
      ".github", "app", "apps", "bin", "client", "components", "contracts",
      "db", "docs", "hooks", "lib", "migrations", "modules", "packages",
      "plugins", "scripts", "server", "services", "src", "test", "tests",
      "tools", "web"
    ].includes(root);
    if (!hasFileExtension && !looksLikeGlob && !knownProjectRoot) {
      continue;
    }
    candidates.push(candidate.includes(".") || candidate.endsWith("/**") ? candidate : `${candidate}/**`);
  }
  const generalTestPattern = /(?:^|[\s("'`])((?:test|tests)\/\*\*)(?=$|[\s)"'`,.;:!?])/g;
  for (const match of text.matchAll(generalTestPattern)) {
    candidates.push(match[1]);
  }
  return uniqueValues(candidates).filter((candidate) => !invalidAllowedPathPattern(candidate));
}

export function detectedResponsibilityDomains(request) {
  const text = String(request).toLowerCase();
  const domains = [];
  if (/\b(frontend|front-end|fe|ui|client|web)\b/.test(text)) {
    domains.push("frontend");
  }
  if (/\b(backend|back-end|be|server|api|endpoint|worker|service)\b/.test(text)) {
    domains.push("backend");
  }
  if (/\b(database|db|sql|postgres|mysql|redis|schema|migration)\b/.test(text)) {
    domains.push("data");
  }
  return domains;
}

export function suggestedBoundaryForDomain(domain) {
  const definitions = {
    frontend: {
      owner: "team.frontend",
      allowedPaths: ["apps/web/**", "apps/frontend/**", "src/ui/**"],
      verificationCommand: { file: "npm", args: ["test", "--", "--grep", "frontend"] },
      responsibility: "Own user-facing UI behavior and consume only declared UI/API contracts."
    },
    backend: {
      owner: "team.backend",
      allowedPaths: ["apps/api/**", "services/**", "src/server/**"],
      verificationCommand: { file: "npm", args: ["test", "--", "--grep", "api"] },
      responsibility: "Own server-side behavior and publish stable service/API contracts."
    },
    data: {
      owner: "team.data",
      allowedPaths: ["db/**", "migrations/**", "src/data/**"],
      verificationCommand: { file: "npm", args: ["test", "--", "--grep", "data"] },
      responsibility: "Own persistence schema, migrations, and data access contracts."
    }
  };
  const definition = definitions[domain] ?? {
    owner: `team.${domain}`,
    allowedPaths: [`modules/${domain}/**`],
    verificationCommand: { file: "npm", args: ["test"] },
    responsibility: `Own the ${domain} responsibility unit.`
  };

  return {
    domain,
    owner: definition.owner,
    allowedPaths: definition.allowedPaths,
    contractId: `contract.${domain}.boundary`,
    responsibility: definition.responsibility,
    verificationCommand: definition.verificationCommand
  };
}

export function boundaryAmbiguityGuidance(domains) {
  return {
    nextAction: "/makeitreal:plan <request> --owner <team> --allowed-path <path> --verify <json>",
    guidance: "Split the request into reviewable vertical slices when one owner can own the full slice. If multiple teams must work in parallel, define explicit responsibility boundaries and contracts first.",
    suggestedBoundaries: domains.map(suggestedBoundaryForDomain)
  };
}
