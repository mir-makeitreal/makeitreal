import { validateBlueprintProposal, VALIDATION_RULES } from "./blueprint-validator.mjs";
import { normalizeBlueprintProposal, writeBlueprintArtifacts } from "./blueprint-normalizer.mjs";

export function getSystemPrompt() {
  return `You are a software architect generating a flat BlueprintProposal for a Make It Real work session.

Produce a single JSON object with this top-level shape:
{
  "title": string,
  "summary": string,
  "goals": [string],
  "nonGoals": [string],
  "acceptanceCriteria": [string],
  "assumptions": [string],
  "modules": [Module],
  "workItems": [WorkItem],
  "scenarios": [Scenario]
}

Module:
{
  "name": string,                       // unique within the proposal — the only identifier
  "purpose": string,
  "ownedPaths": [string],               // non-empty, glob patterns
  "dependsOn": [string],                // other module names
  "contracts": [{
    "name": string,
    "type": "http" | "function" | "event" | "component",
    "inputs":  [{ "name": string, "type": string, "required"?: boolean }],
    "outputs": [{ "name": string, "type": string }],
    "errors":  [{ "code": string, "when": string }]
  }]
}

WorkItem:
{
  "module": string,                     // must match a Module.name
  "title": string,
  "dependsOn": [string],                // module names this work waits on
  "verifyCommand": string,              // e.g. "npm test -- --grep auth"
  "complexity": "trivial" | "small" | "medium" | "large"
}

Scenario (optional sequence diagram):
{
  "title": string,
  "steps": [{ "from": string, "to": string, "action": string }]
}

RULES:
- Module names are the only identifiers. There are NO cross-referenced IDs.
- Module paths must not overlap across modules.
- Module.dependsOn and WorkItem.dependsOn must reference declared module names.
- The dependency DAG must be acyclic.
- Each contract must list inputs, outputs, and errors arrays.
- Do NOT invent file paths that do not exist unless the work item creates them.
- Do NOT assume frameworks/libraries not visible in project context.
- Mark uncertain decisions in the \`assumptions\` array.
- Output a single JSON object — no markdown fences, no explanation around it.`;
}

export function getBlueprintSchema() {
  return {
    $schema: "BlueprintProposal/2.0",
    type: "object",
    required: ["title", "summary", "modules", "workItems"],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      goals: { type: "array", items: { type: "string" } },
      nonGoals: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      modules: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["name", "purpose", "ownedPaths"],
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            ownedPaths: { type: "array", items: { type: "string" }, minItems: 1 },
            dependsOn: { type: "array", items: { type: "string" } },
            contracts: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "type", "inputs", "outputs"],
                properties: {
                  name: { type: "string" },
                  type: { type: "string", enum: ["http", "function", "event", "component"] },
                  inputs: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["name", "type"],
                      properties: {
                        name: { type: "string" },
                        type: { type: "string" },
                        required: { type: "boolean" }
                      }
                    }
                  },
                  outputs: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["name", "type"],
                      properties: {
                        name: { type: "string" },
                        type: { type: "string" }
                      }
                    }
                  },
                  errors: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["code", "when"],
                      properties: {
                        code: { type: "string" },
                        when: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      workItems: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["module", "title"],
          properties: {
            module: { type: "string" },
            title: { type: "string" },
            dependsOn: { type: "array", items: { type: "string" } },
            verifyCommand: { type: "string" },
            complexity: { type: "string", enum: ["trivial", "small", "medium", "large"] }
          }
        }
      },
      scenarios: {
        type: "array",
        items: {
          type: "object",
          required: ["title", "steps"],
          properties: {
            title: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                required: ["from", "to", "action"],
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  action: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  };
}

export function buildUserPrompt(request, projectContext, constraints) {
  const prompt = {
    userRequest: request,
    projectContext: projectContext ?? {},
    constraints: {
      maxWorkItems: 8,
      maxDepth: 2,
      ...(constraints ?? {})
    }
  };
  return JSON.stringify(prompt, null, 2);
}

export { validateBlueprintProposal, VALIDATION_RULES } from "./blueprint-validator.mjs";
export { normalizeBlueprintProposal, writeBlueprintArtifacts } from "./blueprint-normalizer.mjs";
