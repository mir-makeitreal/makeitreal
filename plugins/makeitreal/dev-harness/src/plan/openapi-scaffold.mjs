import { fieldSchema, sampleValueForSchema, sampleValueForField, pascalName, uniqueValues, resourcePathFromRequest } from "./heuristics.mjs";
import { isOpsLike } from "./classify-request.mjs";

export function apiProfileFromRequest({ request, slug }) {
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

export function openApiDocument({ title, slug, apiProfile }) {
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

export function componentContractDocument({ componentProfile, contractId, title }) {
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
