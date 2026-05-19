export function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

export function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pascalName(slug) {
  const value = String(slug ?? "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
  return value || "Work";
}

export function humanizeIdentifier(value) {
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

export function fieldSchema(name) {
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

export function sampleValueForSchema(schema) {
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

export function sampleValueForField(field) {
  return sampleValueForSchema({
    ...fieldSchema(field),
    description: field
  });
}

export function pluralResource(name) {
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

export function resourcePathFromRequest({ request, slug }) {
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
