import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { invalidAllowedPathPattern } from "../domain/path-policy.mjs";
import { normalizeVerificationCommand } from "../domain/verification-command.mjs";
import { renderDesignPreview } from "../preview/render-preview.mjs";
import { ensureMakeItRealGitIgnore } from "../project/bootstrap.mjs";
import { writeCurrentRunState } from "../project/run-state.mjs";
import { runGates } from "../gates/index.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { approvalErrorsOnly, seedBlueprintReview } from "../blueprint/review.mjs";
import { LANES } from "../kanban/lanes.mjs";
import { loadRuntimeState } from "../orchestrator/runtime-state.mjs";

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
  return /\b(api|apis|endpoint|route|http|rest|openapi|swagger)\b/i.test(request);
}

function isOpsLike(request) {
  return /\b(ops|operational|platform|deployment|readiness|health[-\s]?check|healthz|smoke|ci|runbook|recovery)\b/i.test(request);
}

function defaultAllowedPaths(slug) {
  return [`modules/${slug}/**`];
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

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
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

function acceptanceCriteriaFor({ usesOpenApi, apiProfile, componentProfile }) {
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

function surfaceNameFor({ usesOpenApi, slug, apiProfile, componentProfile }) {
  if (usesOpenApi) {
    return `${apiProfile.method.toUpperCase()} ${apiProfile.routePath}`;
  }
  if (componentProfile) {
    return `${componentProfile.componentName}.props`;
  }
  return `${slug}.module`;
}

function moduleSignatureFor({ contractId, owns, title, usesOpenApi, slug, apiProfile, componentProfile }) {
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
          description: `Payload accepted by ${apiProfile.method.toUpperCase()} ${apiProfile.routePath} for: ${title}`
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
    inputs: [
      {
        name: "prdRequest",
        type: "PRD scope",
        required: true,
        description: `Accepted user request for this responsibility unit: ${title}`
      },
      {
        name: "ownedWorkspace",
        type: "project paths",
        required: true,
        description: owns.join(", ")
      }
    ],
    outputs: [
      {
        name: "verifiedBehavior",
        type: "module behavior",
        description: "Implementation satisfying the PRD acceptance criteria inside the declared ownership boundary."
      },
      {
        name: "publicSurface",
        type: "declared interface",
        description: `Consumers may rely on ${contractId} without reading implementation internals.`
      }
    ],
    errors: [
      {
        code: "BOUNDARY_CONTRACT_VIOLATION",
        when: "The work requires undeclared paths, undeclared cross-module imports, or behavior outside the Blueprint.",
        handling: "Fail fast and revise the Blueprint; do not add speculative fallback branches."
      }
    ]
  };
}

function moduleInterfaceFor({ responsibilityUnitId, owner, owns, contractId, title, slug, usesOpenApi, apiProfile, componentProfile }) {
  const surfaceName = surfaceNameFor({ usesOpenApi, slug, apiProfile, componentProfile });
  return {
    responsibilityUnitId,
    owner,
    moduleName: title,
    purpose: `Own delivery of "${title}" through declared paths and public surfaces only.`,
    owns,
    publicSurfaces: [
      {
        name: surfaceName,
        kind: usesOpenApi ? "http" : componentProfile ? "component" : "module",
        description: usesOpenApi
          ? `HTTP contract surface for ${title}.`
          : componentProfile
            ? `Component contract surface for ${componentProfile.componentName}.`
            : `Module boundary surface for ${title}.`,
        contractIds: [contractId],
        consumers: ["Declared downstream responsibility units and tests"],
        signature: moduleSignatureFor({ contractId, owns, title, usesOpenApi, slug, apiProfile, componentProfile })
      }
    ],
    imports: apiProfile?.dependencies ?? []
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

function callStacksFor({ moduleInterface, usesOpenApi, apiProfile, componentProfile }) {
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
    { entrypoint: moduleInterface.publicSurfaces[0].name, calls: ["validate declared inputs", "execute owned responsibility unit", "return declared outputs or fail fast"] }
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

async function materializeLaunchBoard({ runDir, runId, slug, workItem, runnerMode }) {
  const board = {
    schemaVersion: "1.0",
    boardId: `board.${slug}`,
    blueprintRunDir: ".",
    lanes: LANES,
    workItems: [workItem]
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
  const owns = allowedPaths.length > 0 ? allowedPaths : defaultAllowedPaths(slug);
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
  const acceptanceCriteria = acceptanceCriteriaFor({ usesOpenApi, apiProfile, componentProfile });
  await ensureMakeItRealGitIgnore({ projectRoot: resolvedProjectRoot });

  const prd = {
    schemaVersion: "1.0",
    id: `prd.${slug}`,
    title,
    goals: [
      `Deliver the requested capability: ${title}`
    ],
    userVisibleBehavior: [
      "The implemented behavior matches the PRD acceptance criteria and exposes only declared public surfaces."
    ],
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
  const moduleInterface = moduleInterfaceFor({ responsibilityUnitId, owner, owns, contractId, title, slug, usesOpenApi, apiProfile, componentProfile });
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
      { responsibilityUnitId, owns, mayUseContracts }
    ],
    moduleInterfaces: [moduleInterface],
    callStacks: callStacksFor({ moduleInterface, usesOpenApi, apiProfile, componentProfile }),
    sequences: sequencesFor({ workItemId, contractId, usesOpenApi, apiProfile, componentProfile })
  };

  const responsibilityUnits = {
    schemaVersion: "1.0",
    units: [
      {
        id: responsibilityUnitId,
        owner,
        owns,
        publicSurfaces: moduleInterface.publicSurfaces.map((surface) => surface.name),
        mayUseContracts
      }
    ]
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

  await writeJsonFile(path.join(runDir, "prd.json"), prd);
  await writeJsonFile(path.join(runDir, "design-pack.json"), designPack);
  await writeJsonFile(path.join(runDir, "responsibility-units.json"), responsibilityUnits);
  await writeJsonFile(path.join(runDir, "work-items", `${workItemId}.json`), workItem);
  if (usesOpenApi) {
    await writeJsonFile(path.join(runDir, "contracts", `${slug}.openapi.json`), openApiDocument({ title, slug, apiProfile }));
  }
  if (componentProfile) {
    await writeJsonFile(path.join(runDir, "contracts", `${slug}.component-contract.json`), componentContractDocument({ componentProfile, contractId, title }));
  }
  const launchBoard = await materializeLaunchBoard({ runDir, runId: resolvedRunId, slug, workItem, runnerMode });

  const blueprintReview = await seedBlueprintReview({ runDir, now });
  const preview = await renderDesignPreview({ runDir });
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
