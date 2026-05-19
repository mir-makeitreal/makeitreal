import { uniqueValues, escapeRegExp, humanizeIdentifier } from "./heuristics.mjs";

export function moduleProfileFromRequest({ request, slug }) {
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

export function moduleContractCases(text) {
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

export function inferModuleOutputName({ text, functionName }) {
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

export function inferModuleReturnType({ text, outputName, cases = [] }) {
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
  if (/\breturn\s*\{[^}]+}\s*(?:where|\.|\$)/i.test(source)) {
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

export function inferModuleInputType({ text, arg }) {
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

export function declaredModuleErrors(text) {
  const codes = [...String(text ?? "").matchAll(/\bcode\s+([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]);
  const uniqueCodes = uniqueValues(codes);
  return uniqueCodes.length > 0 ? uniqueCodes : ["BOUNDARY_CONTRACT_VIOLATION"];
}

export function moduleErrorWhen({ code, text }) {
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
