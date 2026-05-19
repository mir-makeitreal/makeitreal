import { validateBlueprintProposal, VALIDATION_RULES } from "./blueprint-validator.mjs";
import { normalizeBlueprintProposal, writeBlueprintArtifacts } from "./blueprint-normalizer.mjs";

/**
 * System prompt for Claude to generate a BlueprintProposal.
 * The plugin sends this as the system prompt when invoking Claude.
 */
export function getSystemPrompt() {
  return `You are a software architect generating a structured blueprint for a Make It Real work session. You will receive a user's feature request and optionally project context (file tree, existing patterns, package.json).

Your job is to produce a BlueprintProposal JSON object that captures:
1. What the user wants (PRD-level)
2. How to architect it (responsibility units, contracts, dependencies)
3. How to decompose it into work items (DAG with ordering)
4. How to verify each piece works

RULES:
- Every work item must have explicit allowedPaths (glob patterns for files it may touch)
- Every cross-boundary dependency must be declared as a contract
- The work item DAG must be acyclic
- Work items should be vertical slices when possible
- Verification must be concrete: actual test commands, not "write tests"
- If a work item is too large for one agent session, mark it decomposable: true
- Do NOT invent file paths that don't exist unless the work item creates them
- Do NOT assume frameworks/libraries not visible in project context
- When uncertain, mark assumptions explicitly in the \`assumptions\` array
- Maximum 12 work items
- Maximum dependency chain depth of 5

OUTPUT FORMAT:
Return a single JSON object matching the BlueprintProposal schema.
Do NOT include markdown fences or explanation outside the JSON.`;
}

/**
 * JSON Schema describing what Claude must output.
 * Used for structured output / validation.
 */
export function getBlueprintSchema() {
  return {
    $schema: "BlueprintProposal/1.0",
    type: "object",
    required: ["intent", "architecture", "responsibilityUnits", "contracts", "workItems"],
    properties: {
      intent: {
        type: "object",
        required: ["title", "summary", "goals", "userVisibleBehavior", "acceptanceCriteria"],
        properties: {
          title: { type: "string", description: "Human-readable title" },
          summary: { type: "string", description: "1-3 sentence description" },
          goals: { type: "array", items: { type: "string" }, description: "Measurable outcomes" },
          nonGoals: { type: "array", items: { type: "string" }, description: "Explicit exclusions" },
          userVisibleBehavior: { type: "array", items: { type: "string" }, description: "Observable behaviors when done" },
          acceptanceCriteria: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "statement"],
              properties: {
                id: { type: "string", pattern: "^AC-\\d{3}$" },
                statement: { type: "string" },
                verifiedBy: { type: "string", description: "workItemId that proves this" }
              }
            }
          },
          assumptions: {
            type: "array",
            items: {
              type: "object",
              required: ["assumption", "confidence"],
              properties: {
                assumption: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                ifWrong: { type: "string" }
              }
            }
          }
        }
      },
      architecture: {
        type: "object",
        required: ["nodes", "edges"],
        properties: {
          style: { type: "string", description: "Architecture style" },
          rationale: { type: "string" },
          nodes: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "label", "kind", "responsibilityUnitId"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                kind: { type: "string", enum: ["service", "module", "database", "external", "queue", "ui-component"] },
                responsibilityUnitId: { type: "string" },
                description: { type: "string" }
              }
            }
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              required: ["from", "to"],
              properties: {
                from: { type: "string" },
                to: { type: "string" },
                contractId: { type: "string" },
                label: { type: "string" },
                style: { type: "string", enum: ["sync", "async", "event", "import"] }
              }
            }
          }
        }
      },
      responsibilityUnits: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "label", "owns", "responsibility"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            owner: { type: "string" },
            owns: { type: "array", items: { type: "string" } },
            mustProvideContracts: { type: "array", items: { type: "string" } },
            mayUseContracts: { type: "array", items: { type: "string" } },
            responsibility: { type: "string" }
          }
        }
      },
      contracts: {
        type: "array",
        items: {
          type: "object",
          required: ["contractId", "kind", "title", "provider"],
          properties: {
            contractId: { type: "string" },
            kind: { type: "string", enum: ["openapi", "module-io", "component", "event", "migration"] },
            title: { type: "string" },
            provider: { type: "string" },
            consumers: { type: "array", items: { type: "string" } },
            surface: { type: "object" }
          }
        }
      },
      workItems: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "title", "responsibilityUnitId", "allowedPaths"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            kind: { type: "string", enum: ["implementation", "domain-pm", "integration-evidence"] },
            responsibilityUnitId: { type: "string" },
            contractIds: { type: "array", items: { type: "string" } },
            dependsOn: { type: "array", items: { type: "string" } },
            allowedPaths: { type: "array", items: { type: "string" } },
            estimatedComplexity: { type: "string", enum: ["trivial", "small", "medium", "large"] },
            decomposable: { type: "boolean" },
            verificationCommands: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  command: { type: "string" },
                  purpose: { type: "string" }
                }
              }
            },
            deliverables: { type: "array", items: { type: "string" } },
            acceptanceCriteriaIds: { type: "array", items: { type: "string" } }
          }
        }
      },
      sequences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            participants: { type: "array", items: { type: "string" } },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  action: { type: "string" },
                  data: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  };
}

/**
 * Build the user prompt from request and project context.
 * The plugin calls this to assemble the full prompt for Claude.
 */
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

// Re-export validator and normalizer for convenience
export { validateBlueprintProposal, VALIDATION_RULES } from "./blueprint-validator.mjs";
export { normalizeBlueprintProposal, writeBlueprintArtifacts } from "./blueprint-normalizer.mjs";
