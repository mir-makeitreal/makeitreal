import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { invalidAllowedPathPattern } from "../domain/path-policy.mjs";
import { normalizeVerificationCommand } from "../domain/verification-command.mjs";
import { projectBoardDag } from "../domain/work-item-dag.mjs";
import { renderDesignPreview } from "../preview/render-preview.mjs";
import { ensureMakeItRealGitIgnore } from "../project/bootstrap.mjs";
import { writeCurrentRunState } from "../project/run-state.mjs";
import { runGates } from "../gates/index.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { approvalErrorsOnly, seedBlueprintReview } from "../blueprint/review.mjs";
import { LANES } from "../kanban/lanes.mjs";
import { loadRuntimeState } from "../orchestrator/runtime-state.mjs";
import { decomposeResponsibilities } from "./responsibility-decomposer.mjs";

export function slugifyTask(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = normalized.length > 48
    ? normalized.slice(0, 48).replace(/-[^-]*$/, "")
    : normalized;
  const slug = truncated
    .replace(/-(with|for|and|or|to|of|a|an|the)$/g, "")
    .replace(/^-+|-+$/g, "");
  return slug || "work";
}

function titleFromRequest(request) {
  const normalized = String(request ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Make It Real planned work";
  }
  return normalized;
}

function normalizedApiKind(explicitKind) {
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

function isApiLike(request, explicitKind) {
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

function hasPublicApiContractIntent(request) {
  const text = String(request ?? "");
  return /\b(openapi|swagger)\b/i.test(text)
    || /\b(?:public|external|client[-\s]?facing)?\s*(?:rest|http)?\s*api\s+(?:endpoint|contract|surface)\b/i.test(text)
    || /\b(?:build|create|implement|add|expose)\s+(?:a\s+|an\s+)?(?:rest\s+|http\s+)?(?:api\s+)?endpoint\b/i.test(text)
    || /\b(?:build|create|implement|add|expose)\s+(?:a\s+|an\s+)?REST\s+API\b/i.test(text);
}

function isModuleIoLike(request) {
  const text = String(request ?? "");
  const declaresCodeSurface = /\b(exporting?|exposes?|function|module|library|utility|parser|matcher|normalizer|view[-\s]?model|component|class)\b/i.test(text)
    || /\b[A-Za-z_$][\w$]*\s*\([^)]*\)/.test(text);
  const declaresLocalUnit = /\b(local|in[-\s]?process|internal|pure\s+(javascript|typescript)|responsibility\s+unit|source|codebase|contract:\s*)\b/i.test(text)
    || explicitAllowedPathsFromRequest(text).length > 0;
  return declaresCodeSurface && declaresLocalUnit;
}

function isOpsLike(request) {
  return /\b(ops|operational|platform|deployment|readiness|health[-\s]?check|healthz|smoke|ci|runbook|recovery)\b/i.test(request);
}

function defaultAllowedPaths(slug) {
  return [`modules/${slug}/**`];
}

function allowedPathsMatch(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveOwnedPaths({ allowedPaths, requestAllowedPaths, slug }) {
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

function explicitAllowedPathsFromRequest(request) {
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
  return uniqueValues(candidates).filter((candidate) => !invalidAllowedPathPattern(candidate));
}

function defaultVerificationCommands() {
  return [];
}

function detectedResponsibilityDomains(request) {
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

function suggestedBoundaryForDomain(domain) {
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

function boundaryAmbiguityGuidance(domains) {
  return {
    nextAction: "/makeitreal:plan <request> --owner <team> --allowed-path <path> --verify <json>",
    guidance: "Split the request into reviewable vertical slices when one owner can own the full slice. If multiple teams must work in parallel, define explicit responsibility boundaries and contracts first.",
    suggestedBoundaries: domains.map(suggestedBoundaryForDomain)
  };
}

function pascalName(slug) {
  const value = String(slug ?? "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
  return value || "Work";
}

function humanizeIdentifier(value) {
  return String(value ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldSchema(name) {
  if (/^is[A-Z]|enabled|disabled|active|ok|required/i.test(name)) {
    return { type: "boolean" };
  }
  if (/items/i.test(name)) {
    return {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true
      }
    };
  }
  if (/address|payload|metadata|result/i.test(name)) {
    return {
      type: "object",
      additionalProperties: true
    };
  }
  return { type: "string" };
}

function sampleValueForSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return null;
  }
  if (schema.type === "boolean") {
    return true;
  }
  if (schema.type === "integer" || schema.type === "number") {
    return 1;
  }
  if (schema.type === "array") {
    return [];
  }
  if (schema.type === "object") {
    const value = {};
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      value[key] = sampleValueForSchema(propertySchema);
    }
    if (Object.keys(value).length > 0) {
      return value;
    }
    if (/address/i.test(String(schema.description ?? ""))) {
      return { line1: "1 Example St", city: "Example City" };
    }
    return {};
  }
  return "example";
}

function sampleValueForField(field) {
  return sampleValueForSchema({
    ...fieldSchema(field),
    description: field
  });
}

function pluralResource(name) {
  const value = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!value) {
    return null;
  }
  if (value.endsWith("ies")) {
    return value;
  }
  if (value.endsWith("s")) {
    return value;
  }
  if (value.endsWith("y")) {
    return `${value.slice(0, -1)}ies`;
  }
  return `${value}s`;
}

function resourcePathFromRequest({ request, slug }) {
  const text = String(request ?? "");
  const resources = [
    ["book", "books"],
    ["order", "orders"],
    ["invoice", "invoices"],
    ["user", "users"],
    ["product", "products"],
    ["profile", "profiles"],
    ["session", "sessions"],
    ["report", "reports"],
    ["message", "messages"],
    ["notification", "notifications"],
    ["catalog", "catalog"]
  ];
  const matched = resources
    .filter(([singular, plural]) => new RegExp(`\\b(${singular}|${plural})\\b`, "i").test(text))
    .map(([, plural]) => plural);
  const unique = uniqueValues(matched);
  if (unique.includes("catalog") && unique.includes("books")) {
    return "/catalog/books";
  }
  const primary = unique.find((resource) => resource !== "catalog") ?? unique[0];
  if (primary) {
    if (/\b(search|filter|query)\b/i.test(text)) {
      return `/${primary}/search`;
    }
    return `/${primary}`;
  }
  return `/${slug}`;
}

function apiProfileFromRequest({ request, slug }) {
  const text = String(request ?? "");
  const methodPath = text.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s,;)"']+)/i);
  const opsLike = isOpsLike(text);
  const inferredHealthPath = /\bhealthz\b/i.test(text)
    ? "/healthz"
    : /\bhealth[-\s]?check|health endpoint\b/i.test(text)
      ? "/health"
      : null;
  const method = (methodPath?.[1] ?? (opsLike && inferredHealthPath ? "GET" : "POST")).toLowerCase();
  const routePath = methodPath?.[2] ?? inferredHealthPath ?? resourcePathFromRequest({ request: text, slug });
  const requestBodyAllowed = !["get", "delete"].includes(method);
  const explicitStatuses = uniqueValues([...text.matchAll(/\b([1-5]\d\d)\b/g)].map((match) => match[1]));
  const successStatus = explicitStatuses.find((status) => status.startsWith("2"))
    ?? "200";
  const errorStatuses = explicitStatuses.filter((status) => /^[45]\d\d$/.test(status));
  if (errorStatuses.length === 0) {
    errorStatuses.push("400", "500");
  }

  const knownFields = [
    "customerId",
    "orderId",
    "userId",
    "email",
    "password",
    "title",
    "author",
    "isbn",
    "limit",
    "cursor",
    "items",
    "shippingAddress",
    "query"
  ];
  const requestFields = uniqueValues(knownFields.filter((field) => new RegExp(`\\b${field}\\b`, "i").test(text)));
  if (requestFields.length === 0 && requestBodyAllowed) {
    requestFields.push("query");
  }

  const headers = [];
  if (/idempotency[-\s]?key/i.test(text)) {
    headers.push("Idempotency-Key");
  }

  const dependencies = [];
  if (/\binventory\b/i.test(text)) {
    dependencies.push({
      contractId: "contract.inventory.check",
      providerResponsibilityUnitId: "ru.inventory-service",
      surface: "InventoryService.check",
      allowedUse: "Check declared inventory availability only."
    });
  }
  if (/\bpostgres|postgresql|database|db\b/i.test(text)) {
    dependencies.push({
      contractId: "contract.data.persistence",
      providerResponsibilityUnitId: "ru.data-store",
      surface: "Postgres persistence",
      allowedUse: "Persist and read records through declared persistence behavior only."
    });
  }
  if (/\bkafka|event|events?\b/i.test(text)) {
    dependencies.push({
      contractId: "contract.events.publish",
      providerResponsibilityUnitId: "ru.event-bus",
      surface: "Event publisher",
      allowedUse: "Publish only declared domain events."
    });
  }

  return {
    method,
    routePath,
    operationId: `${method}${pascalName(routePath)}`,
    schemaPrefix: pascalName(routePath === `/${slug}` ? slug : routePath),
    successStatus,
    errorStatuses: uniqueValues(errorStatuses),
    requestFields,
    requestBodyRequired: requestBodyAllowed && requestFields.length > 0,
    headers,
    dependencies,
    opsLike
  };
}

function componentProfileFromRequest({ request, slug }) {
  const text = String(request ?? "");
  if (!/\b(frontend|front-end|fe|ui|client|web|react|component|storybook|aria|keyboard|datatable|data table)\b/i.test(text)) {
    return null;
  }
  const isDataTableRequest = /\bdata[-\s]?table|datatable\b/i.test(text);
  const namedComponent = text.match(/\b([A-Z][A-Za-z0-9]+)\s+component\b/)
    ?? text.match(/\bcomponent\s+([A-Z][A-Za-z0-9]+)\b/);
  const descriptiveComponent = text.match(/\b([a-z][a-z0-9]*(?:[-\s]+[a-z][a-z0-9]*){0,2})[-\s]+(card|widget|banner|modal|form|table)\b/i);
  const componentName = isDataTableRequest
    ? "DataTable"
    : namedComponent?.[1]
      ?? (descriptiveComponent
        ? pascalName(`${descriptiveComponent[1]}-${descriptiveComponent[2]}`.replace(/\b(a|an|the|react|reusable|frontend|front-end|ui)\b/gi, ""))
        : pascalName(slug.replace(/^(fe|ui|web|frontend)-/, "")));
  const capabilities = [
    [/sort/i, "sorting"],
    [/paginat/i, "pagination"],
    [/select/i, "selection"],
    [/sticky/i, "sticky headers"],
    [/empty/i, "empty state"],
    [/loading/i, "loading state"],
    [/error/i, "error state"],
    [/aria|accessib|a11y/i, "ARIA semantics"],
    [/keyboard/i, "keyboard navigation"],
    [/storybook/i, "Storybook story coverage"],
    [/visual|screenshot/i, "visual regression evidence"]
  ].filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  const dataTableProps = [
    { name: "columns", type: "ColumnDefinition[]", required: true, description: "Column id, header, cell renderer, sorting metadata, and optional width/pinning metadata." },
    { name: "rows", type: "RowData[]", required: true, description: "Rows rendered by the table; the component must not fetch data implicitly." },
    { name: "rowKey", type: "(row: RowData) => string", required: true, description: "Stable row identity used for selection, focus, and virtualization-safe updates." },
    { name: "sortState", type: "SortState", required: false, description: "Controlled sorting state declared by column id and direction." },
    { name: "paginationState", type: "PaginationState", required: false, description: "Controlled page index and page size when pagination is enabled." },
    { name: "selectionState", type: "SelectionState", required: false, description: "Controlled selected row ids when row selection is enabled." },
    { name: "status", type: "\"loading\" | \"empty\" | \"error\" | \"ready\"", required: true, description: "Explicit render state; the component must not infer hidden fallback states." },
    { name: "onSortChange", type: "(next: SortState) => void", required: false, description: "Sorting event callback." },
    { name: "onPageChange", type: "(next: PaginationState) => void", required: false, description: "Pagination event callback." },
    { name: "onSelectionChange", type: "(next: SelectionState) => void", required: false, description: "Row-selection event callback." }
  ];
  const genericProps = [
    ...[
      ["title", "string", true, "Primary text rendered by the component."],
      ["label", "string", true, "Visible label text rendered by the component."],
      ["subtitle", "string", false, "Supporting text rendered under the primary title."],
      ["description", "string", false, "Longer descriptive copy for the component."],
      ["ctaLabel", "string", false, "Visible label for the primary call to action."],
      ["ctaHref", "string", false, "Navigation target for the primary call to action."],
      ["avatarUrl", "string", false, "Optional avatar or image source shown by the component."],
      ["planBadge", "string", false, "Optional badge text for account, plan, or status labeling."],
      ["tone", "\"default\" | \"success\" | \"warning\" | \"danger\" | \"info\"", false, "Declared visual tone variants; do not invent additional variants without Blueprint revision."],
      ["variant", "string", false, "Declared visual variant when the request explicitly needs variants."],
      ["status", "\"loading\" | \"empty\" | \"error\" | \"ready\"", true, "Explicit render state; the component must not infer hidden fallback states."],
      ["errorMessage", "string", false, "Displayed only for the declared error state."]
    ]
      .filter(([name]) => new RegExp(`\\b${name}\\b`, "i").test(text) || (name === "status" && /\b(loading|empty|error|ready|state)\b/i.test(text)) || (name === "tone" && /\b(tone|success|warning|danger|info)\b/i.test(text)))
      .map(([name, type, required, description]) => ({ name, type, required, description })),
    ...[
      ["onRetry", "(event: UIEvent) => void", "Retry callback for recoverable error state."],
      ["onClick", "(event: UIEvent) => void", "Click callback for the primary interactive control."],
      ["onSubmit", "(event: FormEvent) => void", "Submit callback for form-like components."],
      ["onDismiss", "(event: UIEvent) => void", "Dismiss callback for dismissible components."]
    ]
      .filter(([name]) => new RegExp(`\\b${name}\\b`, "i").test(text) || (name === "onRetry" && /\bretry\b/i.test(text)) || (name === "onClick" && /\bclick|cta|button\b/i.test(text)) || (name === "onSubmit" && /\bsubmit|form\b/i.test(text)) || (name === "onDismiss" && /\bdismiss|close\b/i.test(text)))
      .map(([name, type, description]) => ({ name, type, required: false, description }))
  ];
  if (genericProps.length === 0) {
    genericProps.push(
      { name: "data", type: "array", required: true, description: "Rows or view model data rendered by the component." },
      { name: "state", type: "component-state", required: true, description: "Declared loading, empty, error, and ready states." },
      { name: "onChange", type: "event callback", required: false, description: "Declared user interaction callback surface." }
    );
  }
  const isDataTable = componentName === "DataTable";
  return {
    componentName,
    capabilities: capabilities.length > 0 ? capabilities : ["declared component behavior"],
    props: isDataTable ? dataTableProps : genericProps,
    storybookStories: isDataTable
      ? ["ready", "loading", "empty", "error", "sorted", "paginated", "selected", "sticky-header"]
      : uniqueValues(["ready", ...capabilities.filter((capability) => /loading|empty|error/i.test(capability)).map((capability) => capability.replace(/\s+state$/i, "")), /\btone|variant|success|warning|danger|info\b/i.test(text) ? "variants" : null]),
    ariaChecklist: isDataTable
      ? ["role=grid or semantic table", "aria-sort reflects sort state", "aria-selected reflects row selection", "focus stays visible during keyboard navigation"]
      : ["named region or landmark where applicable", "interactive controls expose accessible names"],
    keyboardMap: isDataTable
      ? [
          { key: "ArrowUp/ArrowDown", behavior: "Move focused row or cell without losing table context." },
          { key: "Home/End", behavior: "Move to first or last row/cell in the active axis." },
          { key: "PageUp/PageDown", behavior: "Change page or viewport chunk when pagination is enabled." },
          { key: "Space/Enter", behavior: "Toggle selectable row or activate focused cell action." }
        ]
      : []
  };
}

function moduleProfileFromRequest({ request, slug }) {
  const text = String(request ?? "");
  const functionMatch = text.match(/\b(?:exporting|exposes?|function|create)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/i)
    ?? text.match(/\b([a-z][A-Za-z0-9_$]*)\s*\(([^)]*)\)/);
  const functionName = functionMatch?.[1] ?? null;
  const rawArgs = functionMatch?.[2]
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean) ?? [];
  const moduleName = functionName ? humanizeIdentifier(functionName) : humanizeIdentifier(slug);
  const surfaceName = functionName ?? `${slug}.execute`;
  const cases = moduleContractCases(text);
  const outputName = inferModuleOutputName({ text, functionName });
  const returnType = inferModuleReturnType({ text, outputName, cases });
  const declaredErrors = declaredModuleErrors(text);
  const inputs = rawArgs.length > 0
    ? rawArgs.map((arg) => ({
        name: arg,
        type: inferModuleInputType({ text, arg }),
        required: true,
        description: `Declared ${arg} input for ${surfaceName}.`
      }))
    : [{
        name: "request",
        type: "declared input",
        required: true,
        description: `Input accepted by ${surfaceName}; refine the Blueprint if additional fields are required.`
      }];
  const outputs = [{
    name: outputName,
    type: returnType,
    cases,
    description: outputName === "normalizedValue"
      ? "Returned value after the declared normalization rules are applied."
      : "Returned value defined by the module contract."
  }];
  const errors = declaredErrors.map((code) => ({
    code,
    when: moduleErrorWhen({ code, text }),
    handling: `Throw the declared error with code ${code}; do not coerce invalid input through fallback behavior.`
  }));
  if (!declaredErrors.includes("BOUNDARY_CONTRACT_VIOLATION")) {
    errors.push({
      code: "BOUNDARY_CONTRACT_VIOLATION",
      when: "The work requires undeclared paths, undeclared cross-module imports, or behavior outside the Blueprint.",
      handling: "Fail fast and revise the Blueprint; do not add speculative fallback branches."
    });
  }
  return {
    moduleName,
    surfaceName,
    purpose: `Own the ${moduleName} contract and its tests through declared paths only.`,
    inputs,
    outputs,
    errors,
    cases,
    calls: [
      "validate declared inputs",
      functionName ? `execute ${functionName}` : "execute owned module behavior",
      "return declared output or throw declared error"
    ]
  };
}

function moduleContractCases(text) {
  const source = String(text ?? "");
  const cases = [];
  const routeCasePattern = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_/:.-]+)[\s\S]{0,180}?handler:\s*"([^"]+)"[\s\S]{0,80}?params:\s*(\{[^}]*\})/gi;
  for (const match of source.matchAll(routeCasePattern)) {
    cases.push({
      name: `${match[1].toUpperCase()} ${match[2]}`,
      input: `${match[1].toUpperCase()} ${match[2]}`,
      output: `{ handler: "${match[3]}", params: ${match[4].trim()} }`
    });
  }
  if (/\breturn\s+null\s+for\s+unmatched\b/i.test(source)) {
    cases.push({
      name: "unmatched route",
      input: "request outside declared route cases",
      output: "null"
    });
  }
  return cases;
}

function inferModuleOutputName({ text, functionName }) {
  const source = String(text ?? "");
  const name = String(functionName ?? "");
  if (/^match/i.test(name) || /\bmatcher\b/i.test(source)) {
    return "matchResult";
  }
  if (/^parse/i.test(name) || /\bparser\b/i.test(source)) {
    return "parsedResult";
  }
  if (/^format/i.test(name) || /\bformatter\b/i.test(source)) {
    return "formattedValue";
  }
  if (/^normalize/i.test(name) || /\bnormalization\b/i.test(source)) {
    return "normalizedValue";
  }
  return "result";
}

function declaredModuleErrors(text) {
  const codes = [...String(text ?? "").matchAll(/\bcode\s+([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]);
  const uniqueCodes = uniqueValues(codes);
  return uniqueCodes.length > 0 ? uniqueCodes : ["BOUNDARY_CONTRACT_VIOLATION"];
}

function inferModuleReturnType({ text, outputName, cases = [] }) {
  const source = String(text ?? "");
  const handlerCases = cases
    .map((contractCase) => String(contractCase.output ?? "").match(/handler:\s*"([^"]+)"/)?.[1])
    .filter(Boolean);
  if (handlerCases.length > 0) {
    const handlers = uniqueValues(handlerCases).map((handler) => `"${handler}"`).join(" | ");
    const nullSuffix = cases.some((contractCase) => contractCase.output === "null") ? " | null" : "";
    return `{ handler: ${handlers}, params: object }${nullSuffix}`;
  }
  if (/\breturn\s+null\s+for\s+unmatched\b/i.test(source) && /\bhandler\b/i.test(source) && /\bparams\b/i.test(source)) {
    return "{ handler: string, params: object } | null";
  }
  if (/\breturn\s*\{[^}]+}\s*(?:where|\.|$)/i.test(source)) {
    return "object";
  }
  if (/\breturn(?:s|ed)?\s+(?:the\s+|an?\s+)?integer\b/i.test(source)) {
    return "integer";
  }
  if (/\breturn(?:s|ed)?\s+(?:the\s+|an?\s+)?number\b/i.test(source)) {
    return "number";
  }
  if (/\breturn(?:s|ed)?\s+(?:the\s+|an?\s+)?boolean\b/i.test(source)) {
    return "boolean";
  }
  if (/\breturn(?:s|ed)?\s+(?:the\s+|an?\s+)?string\b/i.test(source) || outputName === "normalizedValue") {
    return "string";
  }
  if (outputName === "parsedResult" && /\binteger\b/i.test(source)) {
    return "integer";
  }
  return "module result";
}

function inferModuleInputType({ text, arg }) {
  const source = String(text ?? "");
  const name = String(arg ?? "");
  const escaped = escapeRegExp(name);
  if (/\bmin\s+and\s+max\s+must\s+be\s+finite\s+integers\b/i.test(source) && /^(min|max)$/i.test(name)) {
    return "integer";
  }
  if (new RegExp(`\\b${escaped}\\b\\s+(?:may\\s+be|can\\s+be)\\s+(?:a\\s+)?string\\s+or\\s+number`, "i").test(source)) {
    return "string | number";
  }
  if (new RegExp(`\\b${escaped}\\b\\s+must\\s+be\\s+(?:a\\s+)?finite\\s+integer`, "i").test(source)
    || new RegExp(`\\b${escaped}\\b\\s+must\\s+be\\s+(?:an?\\s+)?integer`, "i").test(source)) {
    return "integer";
  }
  if (new RegExp(`\\b${escaped}\\b\\s+must\\s+be\\s+(?:a\\s+)?string`, "i").test(source)
    || (name === "input" && /\binput\s+must\s+be\s+a\s+string\b/i.test(source))) {
    return "string";
  }
  if (new RegExp(`\\b${escaped}\\b\\s+must\\s+be\\s+(?:a\\s+)?number`, "i").test(source)) {
    return "number";
  }
  if (new RegExp(`\\b${escaped}\\b\\s+must\\s+be\\s+(?:an?\\s+)?object`, "i").test(source)) {
    if (/\bmethod\s+string\b/i.test(source) && /\bpath\s+string\b/i.test(source)) {
      return "object { method: string, path: string }";
    }
    return "object";
  }
  if (/^(min|max|limit|count|size|index|offset|page)$/i.test(name)) {
    return "number";
  }
  return "declared input";
}

function moduleErrorWhen({ code, text }) {
  const source = String(text ?? "");
  if (/OUT_OF_RANGE/i.test(code)) {
    return "The parsed value is outside the declared inclusive min/max range.";
  }
  if (/INVALID/i.test(code) && /\bmin\s+and\s+max\b/i.test(source)) {
    return "Input is not an integer, or min/max bounds are not finite integers.";
  }
  if (/INVALID/i.test(code) && /\bobject\b/i.test(source)) {
    return "Input object is missing declared fields or contains invalid field types.";
  }
  if (/INVALID/i.test(code) && /non-string|empty/i.test(source)) {
    return "Input is non-string or normalizes to an empty value.";
  }
  if (/INVALID/i.test(code)) {
    return "Input violates the declared module contract.";
  }
  return "The call violates the declared module contract.";
}

function acceptanceCriteriaFor({ usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
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

function verificationCommandLabel(commands = []) {
  const command = commands[0];
  if (!command) {
    return "declared verification command";
  }
  return [command.file, ...(command.args ?? [])].filter(Boolean).join(" ");
}

function prdGoalsFor({ title, usesOpenApi, apiProfile, componentProfile, moduleProfile, owns, verificationCommands }) {
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

function userVisibleBehaviorFor({ usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
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

function openApiDocument({ title, slug, apiProfile }) {
  const profile = apiProfile ?? apiProfileFromRequest({ request: title, slug });
  const operationId = profile.operationId;
  const schemaPrefix = pascalName(slug);
  const requestSchemaName = `${profile.schemaPrefix}Request`;
  const responseSchemaName = `${profile.schemaPrefix}Response`;
  const errorSchemaName = `${profile.schemaPrefix}Error`;
  const requestProperties = Object.fromEntries(profile.requestFields.map((field) => [field, {
    ...fieldSchema(field),
    description: `Declared ${field} input for ${title}.`
  }]));
  const responseDataProperties = Object.fromEntries([
    ["id", { type: "string", description: `Stable identifier returned by ${profile.method.toUpperCase()} ${profile.routePath}.` }],
    ["status", { type: "string", description: "Declared business status for the successful response." }],
    ...profile.requestFields.map((field) => [field, {
      ...fieldSchema(field),
      description: `Echoed or persisted ${field} value in the successful response when applicable.`
    }])
  ]);
  const successExample = sampleValueForSchema({
    type: "object",
    properties: {
      ok: { type: "boolean" },
      data: {
        type: "object",
        properties: responseDataProperties
      }
    }
  });
  const responses = {
    [profile.successStatus]: {
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${responseSchemaName}` },
          examples: {
            success: {
              value: successExample
            }
          }
        }
      }
    }
  };
  const operation = {
    tags: [schemaPrefix],
    summary: title,
    operationId,
    parameters: profile.headers.map((header) => ({
      name: header,
      in: "header",
      required: true,
      schema: { type: "string" }
    })),
    responses
  };
  if (profile.requestBodyRequired) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${requestSchemaName}` },
          examples: {
            sample: {
              value: Object.fromEntries(profile.requestFields.map((field) => [field, sampleValueForField(field)]))
            }
          }
        }
      }
    };
  }
  for (const status of profile.errorStatuses) {
    responses[status] = {
      description: `Declared ${status} error response.`,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${errorSchemaName}` },
          examples: {
            error: {
              value: {
                error: {
                  code: `HTTP_${status}`,
                  message: `Declared ${status} error.`
                }
              }
            }
          }
        }
      }
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: `${title} Contract`,
      version: "0.1.0"
    },
    tags: [
      {
        name: schemaPrefix,
        description: `Contract-first API surface for ${title}.`
      }
    ],
    paths: {
      [profile.routePath]: {
        [profile.method]: operation
      }
    },
    components: {
      schemas: {
        [requestSchemaName]: {
          type: "object",
          additionalProperties: false,
          properties: requestProperties,
          required: profile.requestFields
        },
        [responseSchemaName]: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: {
              type: "boolean"
            },
            data: {
              type: "object",
              additionalProperties: false,
              properties: responseDataProperties,
              required: Object.keys(responseDataProperties)
            }
          },
          required: ["ok", "data"]
        },
        [errorSchemaName]: {
          type: "object",
          additionalProperties: false,
          properties: {
            error: {
              type: "object",
              additionalProperties: false,
              properties: {
                code: { type: "string" },
                message: { type: "string" }
              },
              required: ["code", "message"]
            }
          },
          required: ["error"]
        }
      }
    }
  };
}

function surfaceNameFor({ usesOpenApi, slug, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    return `${apiProfile.method.toUpperCase()} ${apiProfile.routePath}`;
  }
  if (componentProfile) {
    return `${componentProfile.componentName}.props`;
  }
  return moduleProfile?.surfaceName ?? `${slug}.execute`;
}

function apiModuleName(apiProfile, fallbackSlug) {
  const resource = String(apiProfile?.routePath ?? "")
    .split("/")
    .filter((part) => part && !/^v\d+$/i.test(part) && part.toLowerCase() !== "api")
    .filter((part) => !part.startsWith(":"))
    .at(-1);
  return `${humanizeIdentifier(resource || fallbackSlug)} API`;
}

function moduleDisplayNameFor({ title, slug, usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    return apiModuleName(apiProfile, slug);
  }
  return componentProfile?.componentName ?? moduleProfile?.moduleName ?? title;
}

function moduleSignatureFor({ contractId, owns, title, usesOpenApi, slug, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    return {
      inputs: [
        ...apiProfile.headers.map((header) => ({
          name: `header.${header}`,
          type: "string",
          required: true,
          description: `Required ${header} header declared by the OpenAPI contract.`
        })),
        ...(apiProfile.requestBodyRequired ? [{
          name: "requestBody",
          type: "object",
          required: true,
          fields: apiProfile.requestFields,
          description: `Payload accepted by ${apiProfile.method.toUpperCase()} ${apiProfile.routePath}.`
        }] : [{
          name: "requestContext",
          type: "http request context",
          required: true,
          description: `Declared request metadata accepted by ${apiProfile.method.toUpperCase()} ${apiProfile.routePath}; no JSON request body is allowed for this contract.`
        }])
      ],
      outputs: [
        {
          name: `${apiProfile.successStatus} response`,
          type: "object",
          description: "Successful response body defined by the OpenAPI contract."
        }
      ],
      errors: [
        ...apiProfile.errorStatuses.map((status) => ({
          code: `${status}.DECLARED_ERROR`,
          when: `The implementation returns the declared ${status} response.`,
          handling: "Return only the declared OpenAPI error shape; do not invent fallback response bodies."
        })),
        {
          code: "CONTRACT_MISMATCH",
          when: "The implementation needs an input, output, status, or dependency not declared in the OpenAPI contract.",
          handling: "Fail fast and revise the Blueprint contract before implementation; do not hide the mismatch with fallback behavior."
        }
      ]
    };
  }

  if (componentProfile) {
    return {
      inputs: componentProfile.props,
      outputs: [
        {
          name: "renderedStates",
          type: "component render contract",
          description: `Rendered states must cover: ${componentProfile.capabilities.join(", ")}.`
        },
        {
          name: "storybookCoverage",
          type: "visual review surface",
          description: "Storybook or equivalent preview exposes the declared component states for review."
        }
      ],
      errors: [
        {
          code: "COMPONENT_STATE_UNDECLARED",
          when: "Implementation needs a prop, state, event, or visual variant not declared by the Blueprint.",
          handling: "Fail fast and revise the component contract before implementation."
        },
        {
          code: "A11Y_CONTRACT_MISMATCH",
          when: "Keyboard, focus, or ARIA behavior cannot satisfy the declared accessibility contract.",
          handling: "Fail fast with the concrete accessibility mismatch; do not hide it behind visual-only tests."
        }
      ]
    };
  }

  return {
    inputs: moduleProfile?.inputs ?? [{
      name: "request",
      type: "declared input",
      required: true,
      description: `Input accepted by ${title}.`
    }],
    outputs: moduleProfile?.outputs ?? [{
      name: "result",
      type: "module result",
      description: `Consumers may rely on ${contractId} without reading implementation internals.`
    }],
    errors: moduleProfile?.errors ?? [{
      code: "BOUNDARY_CONTRACT_VIOLATION",
      when: "The work requires undeclared paths, undeclared cross-module imports, or behavior outside the Blueprint.",
      handling: "Fail fast and revise the Blueprint; do not add speculative fallback branches."
    }]
  };
}

function moduleInterfaceFor({ responsibilityUnitId, owner, owns, contractId, title, slug, usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
  const surfaceName = surfaceNameFor({ usesOpenApi, slug, apiProfile, componentProfile, moduleProfile });
  const moduleName = moduleDisplayNameFor({ title, slug, usesOpenApi, apiProfile, componentProfile, moduleProfile });
  return {
    responsibilityUnitId,
    owner,
    moduleName,
    purpose: usesOpenApi || componentProfile
      ? usesOpenApi
        ? `Own ${apiProfile.method.toUpperCase()} ${apiProfile.routePath} through declared paths, response statuses, and dependency contracts only.`
        : `Own delivery of "${title}" through declared paths and public surfaces only.`
      : moduleProfile?.purpose ?? `Own delivery of "${title}" through declared paths and public surfaces only.`,
    owns,
    publicSurfaces: [
      {
        name: surfaceName,
        kind: usesOpenApi ? "http" : componentProfile ? "component" : "module",
        description: usesOpenApi
          ? `HTTP contract surface for ${apiProfile.method.toUpperCase()} ${apiProfile.routePath}.`
          : componentProfile
            ? `Component contract surface for ${componentProfile.componentName}.`
            : `Module boundary surface for ${moduleName}.`,
        contractIds: [contractId],
        consumers: ["Declared downstream responsibility units and tests"],
        signature: moduleSignatureFor({ contractId, owns, title, usesOpenApi, slug, apiProfile, componentProfile, moduleProfile })
      }
    ],
    imports: apiProfile?.dependencies ?? []
  };
}

function dependencyModuleInterfaceFor(dependency) {
  return {
    responsibilityUnitId: dependency.providerResponsibilityUnitId,
    owner: "external.provider",
    moduleName: dependency.surface,
    purpose: `Own the declared provider side of ${dependency.contractId}.`,
    owns: [`external contract surface: ${dependency.surface}`],
    publicSurfaces: [
      {
        name: dependency.surface,
        kind: "external-contract",
        description: dependency.allowedUse,
        contractIds: [dependency.contractId],
        consumers: ["implementation responsibility unit"],
        signature: {
          inputs: [
            {
              name: "declaredRequest",
              type: "contract input",
              required: true,
              description: `Input declared by ${dependency.contractId}.`
            }
          ],
          outputs: [
            {
              name: "declaredResult",
              type: "contract result",
              description: `Result declared by ${dependency.contractId}.`
            }
          ],
          errors: [
            {
              code: "DEPENDENCY_CONTRACT_MISMATCH",
              when: `The implementation needs behavior outside ${dependency.contractId}.`,
              handling: "Fail fast and revise the Blueprint; do not hide dependency mismatch behind fallback behavior."
            }
          ]
        }
      }
    ],
    imports: []
  };
}

function componentContractDocument({ componentProfile, contractId, title }) {
  return {
    schemaVersion: "1.0",
    kind: "component-contract",
    contractId,
    componentName: componentProfile.componentName,
    title,
    props: componentProfile.props,
    storybookStories: componentProfile.storybookStories,
    ariaChecklist: componentProfile.ariaChecklist,
    keyboardMap: componentProfile.keyboardMap,
    failFastRules: [
      "Do not add undeclared props, states, callbacks, or visual variants without Blueprint revision.",
      "Do not satisfy accessibility gaps with fallback-only visual changes; record the ARIA or keyboard mismatch."
    ]
  };
}

function callStacksFor({ moduleInterface, usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    const calls = ["validate declared inputs"];
    for (const dependency of apiProfile.dependencies) {
      calls.push(`call ${dependency.surface} via ${dependency.contractId}`);
    }
    calls.push("execute owned responsibility unit");
    calls.push(`return ${apiProfile.successStatus} or declared errors ${apiProfile.errorStatuses.join(", ")}`);
    return [{ entrypoint: moduleInterface.publicSurfaces[0].name, calls }];
  }
  if (componentProfile) {
    return [{
      entrypoint: `${componentProfile.componentName}.props`,
      calls: [
        "validate declared props and controlled state",
        "render declared Storybook states",
        "apply keyboard map and ARIA checklist",
        "emit only declared callbacks"
      ]
    }];
  }
  return [
    { entrypoint: moduleInterface.publicSurfaces[0].name, calls: moduleProfile?.calls ?? ["validate declared inputs", "execute owned responsibility unit", "return declared outputs or fail fast"] }
  ];
}

function sequencesFor({ workItemId, contractId, usesOpenApi, apiProfile, componentProfile }) {
  if (usesOpenApi) {
    const participants = ["Client", "Owned Service", ...apiProfile.dependencies.map((dependency) => dependency.surface)];
    const messages = [
      { from: "Client", to: "Owned Service", label: `${apiProfile.method.toUpperCase()} ${apiProfile.routePath}` },
      ...apiProfile.dependencies.map((dependency) => ({
        from: "Owned Service",
        to: dependency.surface,
        label: dependency.allowedUse
      })),
      { from: "Owned Service", to: "Client", label: `${apiProfile.successStatus} or ${apiProfile.errorStatuses.join("/")}` }
    ];
    return [{ title: `${apiProfile.method.toUpperCase()} ${apiProfile.routePath} contract sequence`, participants, messages }];
  }
  if (componentProfile) {
    return [{
      title: `${componentProfile.componentName} render and interaction sequence`,
      participants: ["Consumer", componentProfile.componentName, "Storybook/Tests"],
      messages: [
        { from: "Consumer", to: componentProfile.componentName, label: "pass declared props and controlled state" },
        { from: componentProfile.componentName, to: "Consumer", label: "render declared states and emit declared callbacks" },
        { from: "Storybook/Tests", to: componentProfile.componentName, label: "verify stories, ARIA checklist, keyboard map, and visual states" }
      ]
    }];
  }
  return [{
    title: "Plan to implementation handoff",
    participants: ["User", "Make It Real", "Implementation Responsibility Unit"],
    messages: [
      { from: "User", to: "Make It Real", label: "request planned work" },
      { from: "Make It Real", to: "Implementation Responsibility Unit", label: `assign ${workItemId} via ${contractId}` }
    ]
  }];
}

function trustPolicyFor({ runnerMode, runId }) {
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

async function materializeLaunchBoard({ runDir, runId, slug, workItems, workItemDag, runnerMode }) {
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

export async function generatePlanRun({
  projectRoot,
  request,
  runId,
  owner = "team.implementation",
  allowedPaths = [],
  apiKind = null,
  verificationCommands = null,
  runnerMode = "scripted-simulator",
  now = new Date()
}) {
  if (!projectRoot) {
    throw new Error("projectRoot is required.");
  }
  if (!request || !String(request).trim()) {
    throw new Error("plan requires a non-empty request.");
  }

  const domains = detectedResponsibilityDomains(request);
  if (domains.length > 1 && allowedPaths.length === 0) {
    const ambiguity = boundaryAmbiguityGuidance(domains);
    return {
      ok: false,
      command: "plan",
      projectRoot: path.resolve(projectRoot),
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      ...ambiguity,
      errors: [createHarnessError({
        code: "HARNESS_RESPONSIBILITY_BOUNDARY_AMBIGUOUS",
        reason: `Request appears to span multiple responsibility domains (${domains.join(", ")}). This generator cannot safely collapse them into one owner.`,
        evidence: ["--request", "--allowed-path"],
        recoverable: true,
        ...ambiguity
      })]
    };
  }

  const unsafePath = allowedPaths.find(invalidAllowedPathPattern);
  if (unsafePath) {
    return {
      ok: false,
      command: "plan",
      projectRoot: path.resolve(projectRoot),
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      errors: [createHarnessError({
        code: "HARNESS_ALLOWED_PATH_INVALID",
        reason: `Allowed path must be a safe project-relative pattern: ${unsafePath}`,
        evidence: ["--allowed-path"],
        recoverable: true
      })]
    };
  }

  if (!["scripted-simulator", "claude-code"].includes(runnerMode)) {
    return {
      ok: false,
      command: "plan",
      projectRoot: path.resolve(projectRoot),
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_MODE_UNSUPPORTED",
        reason: `Unsupported plan runner mode: ${runnerMode}.`,
        evidence: ["--runner"],
        recoverable: true
      })]
    };
  }

  const slug = slugifyTask(runId ?? request);
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedRunId = runId ? slugifyTask(runId) : `feature-${slug}`;
  const runDir = path.join(resolvedProjectRoot, ".makeitreal", "runs", resolvedRunId);
  const title = titleFromRequest(request);
  const responsibilityUnitId = `ru.${slug}`;
  const contractId = `contract.${slug}.boundary`;
  const workItemId = `work.${slug}`;
  const requestAllowedPaths = explicitAllowedPathsFromRequest(request);
  const owns = resolveOwnedPaths({ allowedPaths, requestAllowedPaths, slug });
  const commands = verificationCommands ?? defaultVerificationCommands();
  const invalidCommand = commands.find((command) => !normalizeVerificationCommand(command).ok);
  if (invalidCommand) {
    return {
      ok: false,
      command: "plan",
      projectRoot: resolvedProjectRoot,
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      errors: [createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_INVALID",
        reason: normalizeVerificationCommand(invalidCommand).reason,
        evidence: ["--verify"],
        recoverable: true
      })]
    };
  }
  const usesOpenApi = isApiLike(request, apiKind);
  const apiProfile = usesOpenApi ? apiProfileFromRequest({ request, slug }) : null;
  const componentProfile = usesOpenApi ? null : componentProfileFromRequest({ request, slug });
  const moduleProfile = usesOpenApi || componentProfile ? null : moduleProfileFromRequest({ request, slug });
  const acceptanceCriteria = acceptanceCriteriaFor({ usesOpenApi, apiProfile, componentProfile, moduleProfile });
  const goals = prdGoalsFor({ title, usesOpenApi, apiProfile, componentProfile, moduleProfile, owns, verificationCommands: commands });
  const userVisibleBehavior = userVisibleBehaviorFor({ usesOpenApi, apiProfile, componentProfile, moduleProfile });
  await ensureMakeItRealGitIgnore({ projectRoot: resolvedProjectRoot });

  const prd = {
    schemaVersion: "1.0",
    id: `prd.${slug}`,
    title,
    goals,
    userVisibleBehavior,
    acceptanceCriteria,
    nonGoals: [
      "Generate production implementation code during planning.",
      "Infer undeclared fallback behavior for external SDKs or APIs."
    ],
    request: String(request).trim()
  };

  const dependencySpecs = apiProfile?.dependencies.map((dependency) => ({
    kind: "none",
    contractId: dependency.contractId,
    reason: `External dependency contract declared for ${dependency.surface}.`
  })) ?? [];
  const mayUseContracts = [contractId, ...dependencySpecs.map((spec) => spec.contractId)];
  const apiSpec = usesOpenApi
    ? { kind: "openapi", contractId, path: `contracts/${slug}.openapi.json` }
    : {
        kind: "none",
        contractId,
        reason: "Non-API work: the boundary contract is enforced through declared ownership, allowed paths, and planned static/AST checks."
      };
  const moduleInterface = moduleInterfaceFor({ responsibilityUnitId, owner, owns, contractId, title, slug, usesOpenApi, apiProfile, componentProfile, moduleProfile });
  const dependencyModuleInterfaces = apiProfile?.dependencies.map(dependencyModuleInterfaceFor) ?? [];
  const componentContracts = componentProfile
    ? [{ kind: "component", contractId, path: `contracts/${slug}.component-contract.json` }]
    : [];
  const apiSpecs = [apiSpec, ...dependencySpecs];
  const dependencyNodes = apiProfile?.dependencies.map((dependency) => ({
    id: dependency.providerResponsibilityUnitId.replace(/^ru\./, ""),
    label: dependency.surface,
    responsibilityUnitId: dependency.providerResponsibilityUnitId
  })) ?? [];
  const dependencyEdges = apiProfile?.dependencies.map((dependency) => ({
    from: "implementation-unit",
    to: dependency.providerResponsibilityUnitId.replace(/^ru\./, ""),
    contractId: dependency.contractId
  })) ?? [];

  const designPack = {
    schemaVersion: "1.0",
    runId: resolvedRunId,
    workItemId,
    prdId: prd.id,
    architecture: {
      nodes: [
        { id: "prd", label: "PRD Source", responsibilityUnitId },
        { id: "implementation-unit", label: "Implementation Responsibility Unit", responsibilityUnitId },
        ...dependencyNodes
      ],
      edges: [
        { from: "prd", to: "implementation-unit", contractId },
        ...dependencyEdges
      ]
    },
    stateFlow: {
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen", "Ready", "Claimed", "Running", "Verifying", "Human Review", "Done"],
      transitions: [
        { from: "Contract Frozen", to: "Ready", gate: "design-pack" },
        { from: "Human Review", to: "Done", gate: "wiki" }
      ]
    },
    apiSpecs,
    componentContracts,
    responsibilityBoundaries: [
      { responsibilityUnitId, owns, mayUseContracts },
      ...dependencyModuleInterfaces.map((dependencyInterface) => ({
        responsibilityUnitId: dependencyInterface.responsibilityUnitId,
        owns: dependencyInterface.owns,
        mayUseContracts: []
      }))
    ],
    moduleInterfaces: [moduleInterface, ...dependencyModuleInterfaces],
    callStacks: callStacksFor({ moduleInterface, usesOpenApi, apiProfile, componentProfile, moduleProfile }),
    sequences: sequencesFor({ workItemId, contractId, usesOpenApi, apiProfile, componentProfile })
  };

  const doneEvidence = [
    { kind: "verification", path: `evidence/${workItemId}.verification.json` },
    { kind: "wiki-sync", path: `evidence/${workItemId}.wiki-sync.json` }
  ];
  if (usesOpenApi) {
    doneEvidence.splice(1, 0, { kind: "openapi-conformance", path: `evidence/${workItemId}.openapi-conformance.json` });
  }

  const workItem = {
    schemaVersion: "1.0",
    id: workItemId,
    title,
    prdId: prd.id,
    lane: "Contract Frozen",
    responsibilityUnitId,
    contractIds: mayUseContracts,
    dependencyContracts: apiProfile?.dependencies.map((dependency) => ({
      contractId: dependency.contractId,
      providerResponsibilityUnitId: dependency.providerResponsibilityUnitId,
      surface: dependency.surface,
      allowedUse: dependency.allowedUse
    })) ?? [],
    dependsOn: [],
    allowedPaths: owns,
    prdTrace: {
      acceptanceCriteriaIds: acceptanceCriteria.map((criterion) => criterion.id)
    },
    doneEvidence,
    verificationCommands: commands
  };
  const decomposition = decomposeResponsibilities({
    slug,
    owner,
    owns,
    contractId,
    moduleInterface,
    workItem,
    allowedPaths: owns,
    request
  });
  const declaredApiSpecs = [
    ...designPack.apiSpecs,
    ...decomposition.additionalApiSpecs
  ].filter((spec, index, specs) => specs.findIndex((candidate) => candidate.contractId === spec.contractId) === index);
  const dependencyInterfaceIds = new Set(dependencyModuleInterfaces.map((item) => item.responsibilityUnitId));
  const decomposedModuleIds = new Set(decomposition.moduleInterfaces.map((item) => item.responsibilityUnitId));
  designPack.workItemId = decomposition.primaryWorkItemId;
  designPack.apiSpecs = declaredApiSpecs;
  if (decomposition.workItems.length > 1) {
    const provideContractByUnit = new Map(decomposition.responsibilityUnits.map((unit) => [unit.id, unit.mustProvideContracts[0]]));
    designPack.architecture.nodes = [
      { id: "prd", label: "PRD Source" },
      ...decomposition.architectureNodes
    ];
    designPack.architecture.edges = [
      ...decomposition.architectureNodes.map((node) => ({
        from: "prd",
        to: node.id,
        contractId: provideContractByUnit.get(node.responsibilityUnitId)
      })),
      ...decomposition.architectureEdges
    ];
  } else {
    designPack.architecture.nodes = [
      ...designPack.architecture.nodes,
      ...decomposition.architectureNodes.filter((node) => !designPack.architecture.nodes.some((candidate) => candidate.id === node.id))
    ];
    designPack.architecture.edges = [
      ...designPack.architecture.edges,
      ...decomposition.architectureEdges
    ];
  }
  designPack.responsibilityBoundaries = [
    ...decomposition.responsibilityUnits.map((unit) => ({
      responsibilityUnitId: unit.id,
      owns: unit.owns,
      mayUseContracts: unit.mayUseContracts
    })),
    ...dependencyModuleInterfaces
      .filter((dependencyInterface) => !decomposedModuleIds.has(dependencyInterface.responsibilityUnitId))
      .map((dependencyInterface) => ({
        responsibilityUnitId: dependencyInterface.responsibilityUnitId,
        owns: dependencyInterface.owns,
        mayUseContracts: []
      }))
  ];
  designPack.moduleInterfaces = [
    ...decomposition.moduleInterfaces,
    ...dependencyModuleInterfaces.filter((dependencyInterface) => !decomposedModuleIds.has(dependencyInterface.responsibilityUnitId))
  ];
  designPack.callStacks = decomposition.moduleInterfaces.flatMap((item) => callStacksFor({
    moduleInterface: item,
    usesOpenApi: item.responsibilityUnitId.endsWith("-api") ? usesOpenApi : false,
    apiProfile,
    componentProfile: item.responsibilityUnitId === responsibilityUnitId ? componentProfile : null,
    moduleProfile: item.responsibilityUnitId === responsibilityUnitId ? moduleProfile : null
  }));

  const responsibilityUnits = {
    schemaVersion: "1.0",
    units: decomposition.responsibilityUnits.filter((unit) => !dependencyInterfaceIds.has(unit.id))
  };

  await writeJsonFile(path.join(runDir, "prd.json"), prd);
  await writeJsonFile(path.join(runDir, "design-pack.json"), designPack);
  await writeJsonFile(path.join(runDir, "responsibility-units.json"), responsibilityUnits);
  for (const item of decomposition.workItems) {
    await writeJsonFile(path.join(runDir, "work-items", `${item.id}.json`), item);
  }
  await writeJsonFile(path.join(runDir, "work-item-dag.json"), decomposition.workItemDag);
  if (usesOpenApi) {
    await writeJsonFile(path.join(runDir, "contracts", `${slug}.openapi.json`), openApiDocument({ title, slug, apiProfile }));
  }
  if (componentProfile) {
    await writeJsonFile(path.join(runDir, "contracts", `${slug}.component-contract.json`), componentContractDocument({ componentProfile, contractId, title }));
  }
  const launchBoard = await materializeLaunchBoard({
    runDir,
    runId: resolvedRunId,
    slug,
    workItems: decomposition.workItems,
    workItemDag: decomposition.workItemDag,
    runnerMode
  });

  const blueprintReview = await seedBlueprintReview({ runDir, now });
  const preview = await renderDesignPreview({ runDir, now });
  const readyGate = await runGates({ runDir, target: "Ready" });
  const readyErrorsAreApprovalOnly = approvalErrorsOnly(readyGate.errors);
  const planOk = blueprintReview.ok && preview.ok && (readyGate.ok || readyErrorsAreApprovalOnly);
  const currentRun = planOk
    ? await writeCurrentRunState({
        projectRoot: resolvedProjectRoot,
        runDir,
        source: "makeitreal:plan",
        now
      })
    : null;
  const currentRunOk = currentRun?.ok ?? false;

  return {
    ok: planOk && currentRunOk,
    planOk,
    implementationReady: readyGate.ok,
    currentRunUpdated: currentRunOk,
    command: "plan",
    projectRoot: resolvedProjectRoot,
    runDir,
    runId: resolvedRunId,
    workItemId,
    contractId,
    launchBoard,
    blueprintReview,
    preview,
    currentRun,
    readyGate,
    errors: [
      ...(blueprintReview.errors ?? []),
      ...(preview.errors ?? []),
      ...(currentRun?.errors ?? []),
      ...(readyGate.errors ?? [])
    ]
  };
}
