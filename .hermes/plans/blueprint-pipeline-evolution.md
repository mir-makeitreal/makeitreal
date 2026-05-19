# Blueprint Pipeline Evolution: From Regex Heuristics to Claude-Driven Generation

**Author**: Architecture Design Agent
**Date**: 2026-05-19
**Status**: DESIGN PROPOSAL — ready for owner review

---

## 1. Current State Analysis

### What plan-generator.mjs Does Today (1880 lines)

The current pipeline is **entirely deterministic**:

1. **Classify the request** via regex heuristics:
   - `isApiLike()` — 5 regex patterns detect REST/HTTP/OpenAPI intent
   - `isModuleIoLike()` — regex detects function/module/parser intent
   - `isOpsLike()` — regex detects deployment/healthcheck intent
   - `hasPublicApiContractIntent()` — 5 regex patterns detect API surface
   - `componentProfileFromRequest()` — regex detects React/Vue component intent

2. **Generate profile** based on classification:
   - `apiProfileFromRequest()` — extracts method, route, fields, statuses from text
   - `moduleProfileFromRequest()` — infers inputs, outputs, return types via regex
   - `componentProfileFromRequest()` — infers props, stories, ARIA from regex

3. **Emit fixed-shape artifacts**:
   - `prd.json` — goals, acceptance criteria, user-visible behavior
   - `design-pack.json` — architecture, state flow, API specs, boundaries, call stacks
   - `responsibility-units.json` — ownership decomposition
   - `work-items/*.json` — individual work packages
   - `work-item-dag.json` — dependency graph
   - `contracts/*.json` — OpenAPI or component contracts
   - `board.json` — Kanban board with lanes

### What Breaks

- **Regex can't understand intent**: "build auth with email/password" could mean
  a full-stack auth system, a single login endpoint, a password-reset flow, or a
  Firebase integration. Regex picks one pattern and hard-codes everything.

- **Architecture is template-driven**: Every API request gets the same
  `prd → implementation-unit` two-node graph. Every module gets the same
  single-boundary layout. Complex multi-service architectures can't be expressed.

- **Decomposition is mechanical**: `responsibility-decomposer.mjs` splits by
  path patterns, not by semantic responsibility. It can't reason about "this
  needs a migration step before the API can be built."

- **Acceptance criteria are formulaic**: AC-001 through AC-005 follow fixed
  templates per classification. They don't reflect the actual intent.

---

## 2. Recommended Approach: Option C — Hybrid (Claude Proposes, Engine Validates)

### Why Not Pure Claude (Option B)?

Claude can hallucinate contract IDs, invent non-existent paths, create cyclic
DAGs, and produce schemas that don't match what the engine expects. The engine
must remain the authority on structural correctness.

### Why Not Pure Heuristics (Option A)?

The regex approach has hit its ceiling. Every new domain (GraphQL, CLI tools,
data pipelines, ML workflows) requires hundreds of lines of new regex. The
classification is brittle and the output is formulaic.

### The Hybrid Split

```
┌─────────────────────────────────────────────────────┐
│                   Claude (Semantic)                   │
│                                                       │
│  "I understand you want auth with email/password.     │
│   This needs: a registration endpoint, a login        │
│   endpoint, a password-hash utility, a session store, │
│   and a migration for the users table. The login      │
│   endpoint depends on the hash utility and session     │
│   store. Here's the architecture..."                  │
│                                                       │
│  Output: BlueprintProposal (semantic JSON)            │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Engine (Structural Validation)            │
│                                                       │
│  ✓ All node IDs are unique                           │
│  ✓ All edges reference declared nodes                │
│  ✓ DAG is acyclic                                    │
│  ✓ Every work item has allowedPaths                  │
│  ✓ Contract IDs are consistent across artifacts      │
│  ✓ Responsibility boundaries don't overlap           │
│  ✓ State flow lanes are from canonical set           │
│  ✓ Verification commands parse correctly             │
│  ✓ Schema versions are set                           │
│                                                       │
│  Output: Canonical artifacts (prd.json, etc.)        │
└─────────────────────────────────────────────────────┘
```

---

## 3. Claude's Role: The BlueprintProposal

### 3.1 System Prompt for Blueprint Generation

```
You are a software architect generating a structured blueprint for a Make It Real
work session. You will receive a user's feature request and optionally project
context (file tree, existing patterns, package.json).

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
- When uncertain, mark assumptions explicitly in the `assumptions` array

OUTPUT FORMAT:
Return a single JSON object matching the BlueprintProposal schema below.
Do NOT include markdown fences or explanation outside the JSON.
```

### 3.2 BlueprintProposal Schema (Claude's Output)

```jsonc
{
  "$schema": "BlueprintProposal/1.0",

  // PRD-level intent
  "intent": {
    "title": "string — human-readable title",
    "summary": "string — 1-3 sentence description of what will be delivered",
    "goals": ["string — each goal is a measurable outcome"],
    "nonGoals": ["string — explicit exclusions"],
    "userVisibleBehavior": ["string — observable behaviors when done"],
    "acceptanceCriteria": [
      {
        "id": "AC-001",
        "statement": "string — concrete, verifiable criterion",
        "verifiedBy": "workItemId that proves this"
      }
    ],
    "assumptions": [
      {
        "assumption": "string — what we're assuming",
        "confidence": "high | medium | low",
        "ifWrong": "string — what changes if this assumption is wrong"
      }
    ]
  },

  // Architecture
  "architecture": {
    "style": "string — e.g. 'layered', 'microservice', 'monolith-module', 'pipeline'",
    "rationale": "string — why this architecture fits",
    "nodes": [
      {
        "id": "string — unique node identifier",
        "label": "string — human-readable label",
        "kind": "service | module | database | external | queue | ui-component",
        "responsibilityUnitId": "string — which RU owns this node",
        "description": "string — what this node does"
      }
    ],
    "edges": [
      {
        "from": "string — source node id",
        "to": "string — target node id",
        "contractId": "string — which contract governs this edge",
        "label": "string — what flows across this edge",
        "style": "sync | async | event | import"
      }
    ]
  },

  // Responsibility decomposition
  "responsibilityUnits": [
    {
      "id": "string — e.g. 'ru.auth-api'",
      "label": "string — human name",
      "owner": "string — team or individual",
      "owns": ["string — glob patterns for owned files"],
      "mustProvideContracts": ["string — contract IDs this unit publishes"],
      "mayUseContracts": ["string — contract IDs this unit consumes"],
      "responsibility": "string — one sentence: what this unit is accountable for"
    }
  ],

  // Contracts between units
  "contracts": [
    {
      "contractId": "string — e.g. 'contract.auth.login'",
      "kind": "openapi | module-io | component | event | migration",
      "title": "string",
      "provider": "string — responsibilityUnitId",
      "consumers": ["string — responsibilityUnitIds"],
      "surface": {
        // For openapi:
        "method": "GET | POST | PUT | DELETE | PATCH",
        "path": "/api/auth/login",
        "requestSchema": { /* JSON Schema subset */ },
        "responseSchema": { /* JSON Schema subset */ },
        "errorCodes": [400, 401, 500],

        // For module-io:
        "functionName": "hashPassword",
        "inputTypes": [{ "name": "password", "type": "string" }],
        "outputType": "string",
        "throws": ["INVALID_INPUT"],

        // For component:
        "componentName": "LoginForm",
        "props": [{ "name": "onSubmit", "type": "(credentials: Credentials) => void" }],

        // For event:
        "eventName": "user.registered",
        "payloadSchema": { /* JSON Schema subset */ },

        // For migration:
        "description": "Create users table with email, password_hash, created_at"
      }
    }
  ],

  // Work item DAG
  "workItems": [
    {
      "id": "string — e.g. 'wi.create-users-table'",
      "title": "string",
      "kind": "implementation | domain-pm | integration-evidence",
      "responsibilityUnitId": "string",
      "contractIds": ["string — contracts this item implements or verifies"],
      "dependsOn": ["string — work item IDs that must complete first"],
      "allowedPaths": ["string — glob patterns"],
      "estimatedComplexity": "trivial | small | medium | large",
      "decomposable": false,
      "verificationCommands": [
        {
          "command": "string — e.g. 'npm test -- --grep auth'",
          "purpose": "string — what this command proves"
        }
      ],
      "deliverables": ["string — concrete outputs when done"],
      "acceptanceCriteriaIds": ["AC-001"]
    }
  ],

  // Sequences (optional, for complex flows)
  "sequences": [
    {
      "title": "string — e.g. 'User Registration Flow'",
      "participants": ["string — node labels"],
      "steps": [
        {
          "from": "string",
          "to": "string",
          "action": "string — what happens",
          "data": "string — what's passed (optional)"
        }
      ]
    }
  ]
}
```

### 3.3 What Claude Sees (Input Context)

The prompt is assembled from project reconnaissance:

```jsonc
{
  "userRequest": "build auth with email/password",
  "projectContext": {
    "packageJson": { /* if exists */ },
    "fileTree": [ /* top-level + relevant subdirs */ ],
    "existingPatterns": {
      "hasExpress": true,
      "hasReact": true,
      "testFramework": "node:test",
      "existingRouteFiles": ["src/routes/health.mjs"],
      "existingMigrations": ["db/migrations/001-init.sql"],
      "buildCommand": "npm run build",
      "testCommand": "npm test"
    },
    "existingContracts": [ /* any prior MIR contracts */ ],
    "existingResponsibilityUnits": [ /* from prior runs */ ]
  },
  "constraints": {
    "maxWorkItems": 8,
    "maxDepth": 2,
    "allowedRootPaths": ["src/**", "db/**", "test/**"],
    "mustNotTouch": ["node_modules/**", ".env"]
  }
}
```

---

## 4. Deterministic Validation Engine

### 4.1 Validation Rules (engine/blueprint-validator.mjs)

The engine receives the BlueprintProposal and runs these checks:

```javascript
// blueprint-validator.mjs — validation rule catalog

export const VALIDATION_RULES = [
  // === Structural Integrity ===
  {
    id: "UNIQUE_NODE_IDS",
    severity: "error",
    check: (proposal) => {
      const ids = proposal.architecture.nodes.map(n => n.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      return dupes.length === 0 ? null : `Duplicate node IDs: ${dupes.join(", ")}`;
    }
  },
  {
    id: "UNIQUE_WORK_ITEM_IDS",
    severity: "error",
    check: (proposal) => {
      const ids = proposal.workItems.map(wi => wi.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      return dupes.length === 0 ? null : `Duplicate work item IDs: ${dupes.join(", ")}`;
    }
  },
  {
    id: "EDGES_REFERENCE_DECLARED_NODES",
    severity: "error",
    check: (proposal) => {
      const nodeIds = new Set(proposal.architecture.nodes.map(n => n.id));
      const bad = proposal.architecture.edges.filter(e => !nodeIds.has(e.from) || !nodeIds.has(e.to));
      return bad.length === 0 ? null : `Edges reference undeclared nodes: ${bad.map(e => `${e.from}->${e.to}`).join(", ")}`;
    }
  },
  {
    id: "DAG_IS_ACYCLIC",
    severity: "error",
    check: (proposal) => {
      // Topological sort on workItems.dependsOn
      // Returns cycle description if found
    }
  },
  {
    id: "CONTRACTS_REFERENCED_EXIST",
    severity: "error",
    check: (proposal) => {
      const contractIds = new Set(proposal.contracts.map(c => c.contractId));
      const allRefs = [
        ...proposal.architecture.edges.map(e => e.contractId),
        ...proposal.workItems.flatMap(wi => wi.contractIds),
        ...proposal.responsibilityUnits.flatMap(ru => [...ru.mustProvideContracts, ...ru.mayUseContracts])
      ].filter(Boolean);
      const missing = allRefs.filter(id => !contractIds.has(id));
      return missing.length === 0 ? null : `Undeclared contracts: ${[...new Set(missing)].join(", ")}`;
    }
  },

  // === Ownership Integrity ===
  {
    id: "NO_OVERLAPPING_OWNERSHIP",
    severity: "error",
    check: (proposal) => {
      // For each pair of RUs, check allowedPaths don't overlap
      // Uses patternBase() and patternsOverlap() from existing code
    }
  },
  {
    id: "WORK_ITEMS_WITHIN_RU_PATHS",
    severity: "error",
    check: (proposal) => {
      // Each work item's allowedPaths must be subset of its RU's owns
    }
  },
  {
    id: "ALLOWED_PATHS_ARE_VALID",
    severity: "error",
    check: (proposal) => {
      // Reuse invalidAllowedPathPattern() from path-policy.mjs
    }
  },

  // === Completeness ===
  {
    id: "EVERY_RU_HAS_WORK_ITEMS",
    severity: "warning",
    check: (proposal) => {
      const coveredRUs = new Set(proposal.workItems.map(wi => wi.responsibilityUnitId));
      const uncovered = proposal.responsibilityUnits.filter(ru => !coveredRUs.has(ru.id));
      return uncovered.length === 0 ? null : `RUs without work items: ${uncovered.map(ru => ru.id).join(", ")}`;
    }
  },
  {
    id: "EVERY_CONTRACT_HAS_PROVIDER_WORK_ITEM",
    severity: "warning",
    check: (proposal) => {
      // At least one work item must implement each contract
    }
  },
  {
    id: "ACCEPTANCE_CRITERIA_COVERED",
    severity: "warning",
    check: (proposal) => {
      const covered = new Set(proposal.workItems.flatMap(wi => wi.acceptanceCriteriaIds ?? []));
      const uncovered = proposal.intent.acceptanceCriteria.filter(ac => !covered.has(ac.id));
      return uncovered.length === 0 ? null : `Uncovered AC: ${uncovered.map(ac => ac.id).join(", ")}`;
    }
  },

  // === Feasibility ===
  {
    id: "VERIFICATION_COMMANDS_PARSE",
    severity: "error",
    check: (proposal) => {
      // Reuse normalizeVerificationCommand() from existing code
    }
  },
  {
    id: "WORK_ITEM_COUNT_WITHIN_LIMITS",
    severity: "error",
    check: (proposal) => {
      return proposal.workItems.length <= 12 ? null : `Too many work items: ${proposal.workItems.length} (max 12)`;
    }
  },
  {
    id: "DEPENDENCY_DEPTH_WITHIN_LIMITS",
    severity: "warning",
    check: (proposal) => {
      // Longest path in DAG should be <= 5
    }
  }
];
```

### 4.2 Normalization (engine/blueprint-normalizer.mjs)

After validation passes, the engine normalizes Claude's proposal into canonical
artifacts. This is a **deterministic transform** — no AI involved.

```javascript
// Normalization steps:
export function normalizeProposal(proposal) {
  return {
    prd: normalizePrd(proposal.intent),
    designPack: normalizeDesignPack(proposal),
    responsibilityUnits: normalizeResponsibilityUnits(proposal.responsibilityUnits),
    workItems: normalizeWorkItems(proposal.workItems),
    workItemDag: normalizeWorkItemDag(proposal.workItems),
    contracts: normalizeContracts(proposal.contracts)
  };
}

function normalizePrd(intent) {
  return {
    schemaVersion: "1.0",
    id: `prd.${slugify(intent.title)}`,
    title: intent.title,
    goals: intent.goals,
    userVisibleBehavior: intent.userVisibleBehavior,
    acceptanceCriteria: intent.acceptanceCriteria.map(ac => ({
      id: ac.id,
      statement: ac.statement
    })),
    nonGoals: intent.nonGoals,
    request: intent.summary
  };
}

function normalizeDesignPack(proposal) {
  const slug = slugify(proposal.intent.title);
  const workItemId = proposal.workItems[0]?.id ?? `wi.${slug}`;

  return {
    schemaVersion: "1.0",
    runId: null,  // Set by caller
    workItemId,
    prdId: `prd.${slug}`,
    architecture: {
      nodes: proposal.architecture.nodes.map(n => ({
        id: n.id,
        label: n.label,
        responsibilityUnitId: n.responsibilityUnitId
      })),
      edges: proposal.architecture.edges.map(e => ({
        from: e.from,
        to: e.to,
        contractId: e.contractId
      }))
    },
    stateFlow: {
      lanes: CANONICAL_LANES,
      transitions: CANONICAL_TRANSITIONS
    },
    apiSpecs: proposal.contracts
      .filter(c => c.kind === "openapi")
      .map(c => ({
        kind: "openapi",
        contractId: c.contractId,
        path: `contracts/${slugify(c.title)}.openapi.json`
      })),
    responsibilityBoundaries: proposal.responsibilityUnits.map(ru => ({
      responsibilityUnitId: ru.id,
      owns: ru.owns,
      mayUseContracts: ru.mayUseContracts
    })),
    moduleInterfaces: buildModuleInterfaces(proposal),
    callStacks: buildCallStacks(proposal),
    sequences: normalizeSequences(proposal.sequences)
  };
}

function normalizeWorkItemDag(workItems) {
  return {
    schemaVersion: "1.0",
    nodes: workItems.map(wi => ({
      id: wi.id,
      kind: wi.kind,
      responsibilityUnitId: wi.responsibilityUnitId,
      requiredForDone: wi.kind !== "domain-pm"
    })),
    edges: workItems.flatMap(wi =>
      (wi.dependsOn ?? []).map(dep => ({
        from: dep,
        to: wi.id,
        kind: "contract-dependency"
      }))
    )
  };
}

const CANONICAL_LANES = [
  "Intake", "Discovery", "Scoped", "Blueprint Bound",
  "Contract Frozen", "Ready", "Claimed", "Running",
  "Verifying", "Human Review", "Done"
];

const CANONICAL_TRANSITIONS = [
  { from: "Contract Frozen", to: "Ready", gate: "design-pack" },
  { from: "Human Review", to: "Done", gate: "wiki" }
];
```

### 4.3 Retry Loop

If validation fails, the engine can ask Claude to fix specific issues:

```javascript
async function generateBlueprint({ request, projectContext, constraints }) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const proposal = await callClaude({
      systemPrompt: BLUEPRINT_SYSTEM_PROMPT,
      userMessage: buildPrompt({ request, projectContext, constraints }),
      // On retry, include previous errors
      ...(attempt > 1 && {
        retryContext: {
          previousProposal: lastProposal,
          validationErrors: lastErrors,
          instruction: "Fix the listed validation errors. Do not change parts that passed validation."
        }
      })
    });

    const validation = validateProposal(proposal);
    if (validation.ok) {
      return normalizeProposal(proposal);
    }

    // Only retry on fixable errors
    if (validation.errors.every(e => e.severity === "warning")) {
      return normalizeProposal(proposal); // Warnings don't block
    }

    lastProposal = proposal;
    lastErrors = validation.errors;
  }

  throw new BlueprintGenerationError("Failed after 3 attempts", lastErrors);
}
```

---

## 5. Preview Model Evolution

### 5.1 Schema Changes (preview-model v2.0)

The preview-model.json needs to grow to support Claude-generated richness,
recursive decomposition, and live progress tracking.

```jsonc
{
  "schemaVersion": "2.0",
  "generatedAt": "ISO timestamp",

  "run": {
    "runDir": "string",
    "runId": "string",
    "workItemId": "string",
    "prdId": "string",
    "generationMethod": "claude-hybrid | deterministic-heuristic",
    "generationMetadata": {
      "model": "claude-sonnet-4-20250514",
      "attempts": 1,
      "validationWarnings": [],
      "assumptions": [
        {
          "assumption": "Project uses Express for HTTP",
          "confidence": "high",
          "ifWrong": "Route file paths may differ"
        }
      ]
    }
  },

  "blueprint": {
    "title": "string",
    "summary": ["string — user-visible behaviors"],
    "goals": ["string"],
    "nonGoals": ["string"],
    "acceptanceCriteria": [
      {
        "id": "AC-001",
        "statement": "string",
        "status": "pending | covered | verified",
        "coveredBy": ["wi.auth-api"]  // NEW: traceability
      }
    ],
    "architectureStyle": "string",   // NEW: from Claude
    "architectureRationale": "string", // NEW: from Claude

    // Existing fields preserved
    "primaryContract": { /* ... */ },
    "contracts": [
      {
        // Existing fields plus:
        "kind": "openapi | module-io | component | event | migration",
        "provider": "string — RU id",
        "consumers": ["string — RU ids"]
      }
    ],
    "boundaries": [ /* existing */ ],
    "moduleInterfaces": [ /* existing */ ],
    "architecture": {
      "nodes": [
        {
          // Existing fields plus:
          "kind": "service | module | database | external | queue | ui-component",
          "description": "string"  // NEW
        }
      ],
      "edges": [
        {
          // Existing fields plus:
          "label": "string",  // NEW
          "style": "sync | async | event | import"  // NEW
        }
      ]
    },
    "stateTransitions": [ /* existing */ ],
    "callStacks": [ /* existing */ ],
    "sequences": [
      {
        "title": "string",
        "participants": ["string"],
        "messages": [
          {
            "from": "string",
            "to": "string",
            "label": "string",
            "data": "string"  // NEW: optional payload hint
          }
        ]
      }
    ],
    "systemDossier": { /* existing */ }
  },

  "design": { /* existing — human-readable stringified versions */ },

  // === NEW: Decomposition Hierarchy ===
  "hierarchy": {
    "roots": ["wi.auth-api"],  // top-level work items (no parent)
    "children": {
      // parent work item ID → child work item IDs
      "wi.auth-api": ["wi.auth-api.routes", "wi.auth-api.middleware", "wi.auth-api.tests"]
    },
    "decompositionEvents": [
      {
        "parentId": "wi.auth-api",
        "childIds": ["wi.auth-api.routes", "wi.auth-api.middleware", "wi.auth-api.tests"],
        "reason": "Worker reported NEEDS_DECOMPOSE: unit too large for single session",
        "timestamp": "ISO timestamp",
        "depth": 1
      }
    ],
    "maxDepth": 2,
    "currentMaxDepth": 1
  },

  // === NEW: Live Progress ===
  "progress": {
    "overall": {
      "total": 5,
      "done": 2,
      "running": 1,
      "blocked": 0,
      "ready": 2,
      "percentComplete": 40
    },
    "byResponsibilityUnit": {
      "ru.auth-api": { "total": 3, "done": 1, "running": 1, "ready": 1 },
      "ru.password-hash": { "total": 1, "done": 1, "running": 0, "ready": 0 },
      "ru.session-store": { "total": 1, "done": 0, "running": 0, "ready": 1 }
    },
    "criticalPath": ["wi.create-users-table", "wi.password-hash", "wi.auth-api", "wi.integration-test"],
    "estimatedCompletion": null,  // future: time estimate
    "lastUpdate": "ISO timestamp"
  },

  "status": { /* existing */ },
  "operatorCockpit": { /* existing */ },

  "board": {
    // Existing fields plus:
    "lanes": [
      {
        "name": "string",
        "workItems": [
          {
            // Existing fields plus:
            "parentId": null,      // NEW: for decomposed items
            "childIds": [],         // NEW: if this item was decomposed
            "depth": 0,            // NEW: nesting level (0 = root)
            "decomposable": false, // NEW: can this item be decomposed?
            "estimatedComplexity": "small" // NEW: from Claude
          }
        ]
      }
    ]
  }
}
```

### 5.2 Backward Compatibility

The schema version bump from "1.0" to "2.0" is detected by the dashboard:

```javascript
function isV2Model(model) {
  return model.schemaVersion === "2.0" || model.hierarchy != null;
}

// V1 models rendered with existing dashboard
// V2 models get hierarchy panel, progress bar, enhanced architecture graph
```

All new fields are additive — a V1 consumer ignores them. The `generationMethod`
field tells the dashboard whether to show assumption badges and Claude metadata.

---

## 6. Migration Path

### Phase 1: Parallel Generation (Week 1-2)

Keep the existing `plan-generator.mjs` as the primary path. Add Claude generation
as an opt-in alternative:

```
/mir plan 'build auth' --engine=claude     # New Claude path
/mir plan 'build auth'                      # Existing heuristic path (default)
```

Implementation:

```
plan-generator.mjs (existing, unchanged)
plan-generator-claude.mjs (NEW)
├── assembleProjectContext()    — scan project for Claude input
├── callClaude()               — invoke Claude with blueprint prompt
├── validateProposal()         — run validation rules
├── normalizeProposal()        — transform to canonical artifacts
└── writePlanArtifacts()       — reuse existing file-writing logic
```

The file-writing logic at the bottom of plan-generator.mjs (lines 1820-1879)
is extracted into a shared `plan-writer.mjs`:

```javascript
// plan-writer.mjs — shared artifact writer
export async function writePlanArtifacts({
  runDir, projectRoot, prd, designPack, responsibilityUnits,
  workItems, workItemDag, contracts, slug, runId, runnerMode, now
}) {
  await writeJsonFile(path.join(runDir, "prd.json"), prd);
  await writeJsonFile(path.join(runDir, "design-pack.json"), designPack);
  await writeJsonFile(path.join(runDir, "responsibility-units.json"), responsibilityUnits);
  for (const item of workItems) {
    await writeJsonFile(path.join(runDir, "work-items", `${item.id}.json`), item);
  }
  await writeJsonFile(path.join(runDir, "work-item-dag.json"), workItemDag);
  for (const contract of contracts) {
    await writeJsonFile(path.join(runDir, "contracts", contract.fileName), contract.document);
  }
  // ... board materialization, blueprint review, preview, gates
}
```

### Phase 2: A/B Testing (Week 3-4)

Run both generators on the same requests. Compare:
- Blueprint review pass rate (does the user approve more often?)
- Gate failure rate (does Ready gate pass more consistently?)
- Work item completion rate (do sub-agents succeed more with Claude blueprints?)

Store comparison data in `.makeitreal/generation-comparison.jsonl`.

### Phase 3: Claude as Default (Week 5-6)

If Claude blueprints consistently outperform heuristic blueprints:

```
/mir plan 'build auth'                      # Claude path (new default)
/mir plan 'build auth' --engine=heuristic   # Fallback to old path
```

### Phase 4: Heuristic Removal (Week 8+)

Once Claude is proven reliable:
- Remove `plan-generator.mjs` (1880 lines)
- Remove `responsibility-decomposer.mjs` (830 lines)
- Remove all regex heuristic functions
- Keep only `plan-generator-claude.mjs` + `blueprint-validator.mjs` + `blueprint-normalizer.mjs` + `plan-writer.mjs`

Net code change: ~2700 lines removed, ~800 lines added.

---

## 7. NEEDS_DECOMPOSE: End-to-End Flow

### 7.1 The Protocol

```
     Sub-agent Working on wi.auth-api
     ├── Reads work item: allowedPaths, contracts, deliverables
     ├── Starts implementation
     ├── Realizes: "This is too complex for one session.
     │   I need to split into route handler, middleware, and integration tests."
     │
     ├── Reports NEEDS_DECOMPOSE:
     │   {
     │     "status": "NEEDS_DECOMPOSE",
     │     "reason": "Unit requires 3 distinct concerns with separate test surfaces",
     │     "proposal": {
     │       "childWorkItems": [
     │         {
     │           "id": "wi.auth-api.routes",
     │           "title": "Auth route handlers",
     │           "kind": "implementation",
     │           "allowedPaths": ["src/routes/auth/**"],
     │           "contractIds": ["contract.auth.login", "contract.auth.register"],
     │           "dependsOn": [],
     │           "verificationCommands": [
     │             { "command": "npm test -- --grep 'auth routes'" }
     │           ]
     │         },
     │         {
     │           "id": "wi.auth-api.middleware",
     │           "title": "Auth middleware",
     │           "kind": "implementation",
     │           "allowedPaths": ["src/middleware/auth/**"],
     │           "contractIds": ["contract.auth.session"],
     │           "dependsOn": [],
     │           "verificationCommands": [
     │             { "command": "npm test -- --grep 'auth middleware'" }
     │           ]
     │         },
     │         {
     │           "id": "wi.auth-api.integration",
     │           "title": "Auth integration verification",
     │           "kind": "integration-evidence",
     │           "allowedPaths": ["test/integration/auth/**"],
     │           "contractIds": ["contract.auth.login", "contract.auth.register", "contract.auth.session"],
     │           "dependsOn": ["wi.auth-api.routes", "wi.auth-api.middleware"],
     │           "verificationCommands": [
     │             { "command": "npm test -- --grep 'auth integration'" }
     │           ]
     │         }
     │       ]
     │     }
     │   }
     │
     └── Sub-agent STOPS work, returns report to orchestrator
```

### 7.2 Orchestrator Validation (decomposition-validator.mjs)

```javascript
export function validateDecompositionProposal({ proposal, parentWorkItem, board, dag, blueprint }) {
  const errors = [];

  // 1. Depth check
  const parentDepth = parentWorkItem.depth ?? 0;
  if (parentDepth >= 2) {
    errors.push({
      code: "DECOMPOSE_MAX_DEPTH",
      reason: `Work item ${parentWorkItem.id} is at depth ${parentDepth}, max is 2. Cannot decompose further.`,
      recovery: "BLOCKED — escalate to user"
    });
  }

  // 2. Path containment — children must be subset of parent
  for (const child of proposal.childWorkItems) {
    for (const childPath of child.allowedPaths) {
      const contained = parentWorkItem.allowedPaths.some(parentPath =>
        isSubsetPath(childPath, parentPath)
      );
      if (!contained) {
        errors.push({
          code: "DECOMPOSE_PATH_LEAK",
          reason: `Child ${child.id} path "${childPath}" is outside parent's allowed paths`,
          recovery: "Remove or narrow the child's allowedPaths"
        });
      }
    }
  }

  // 3. Contract consistency — children can only reference parent's contracts
  const parentContracts = new Set(parentWorkItem.contractIds);
  for (const child of proposal.childWorkItems) {
    for (const contractId of child.contractIds) {
      if (!parentContracts.has(contractId)) {
        errors.push({
          code: "DECOMPOSE_CONTRACT_LEAK",
          reason: `Child ${child.id} references contract "${contractId}" not in parent's scope`,
          recovery: "Remove undeclared contract reference or revise blueprint"
        });
      }
    }
  }

  // 4. DAG acyclicity — adding children must not create cycles
  const testDag = cloneDag(dag);
  for (const child of proposal.childWorkItems) {
    testDag.nodes.push({ id: child.id, kind: child.kind });
    for (const dep of child.dependsOn) {
      testDag.edges.push({ from: dep, to: child.id, kind: "contract-dependency" });
    }
  }
  if (hasCycle(testDag)) {
    errors.push({
      code: "DECOMPOSE_CYCLE",
      reason: "Proposed child items create a cycle in the dependency graph",
      recovery: "Revise dependsOn to break the cycle"
    });
  }

  // 5. Coverage — children should collectively cover parent's deliverables
  const hasIntegrationEvidence = proposal.childWorkItems.some(
    child => child.kind === "integration-evidence"
  );
  if (!hasIntegrationEvidence) {
    errors.push({
      code: "DECOMPOSE_NO_INTEGRATION",
      severity: "warning",
      reason: "No integration-evidence work item. Children won't be verified as a group.",
      recovery: "Add an integration-evidence child that depends on all implementation children"
    });
  }

  // 6. ID format — children should be prefixed with parent ID
  for (const child of proposal.childWorkItems) {
    if (!child.id.startsWith(parentWorkItem.id + ".")) {
      errors.push({
        code: "DECOMPOSE_ID_FORMAT",
        severity: "warning",
        reason: `Child ID "${child.id}" should be prefixed with "${parentWorkItem.id}."`,
        recovery: "Use parent-prefixed IDs for hierarchy tracking"
      });
    }
  }

  return {
    ok: errors.filter(e => e.severity !== "warning").length === 0,
    errors,
    warnings: errors.filter(e => e.severity === "warning")
  };
}
```

### 7.3 Materialization Flow

```javascript
// In orchestrator.mjs

async function handleDecomposeReport({ workItemId, report, runDir }) {
  const board = await loadBoard(runDir);
  const dag = await readJsonFile(path.join(runDir, "work-item-dag.json"));
  const parentWorkItem = board.workItems.find(wi => wi.id === workItemId);
  const artifacts = await loadRunArtifacts(runDir);

  // 1. Validate
  const validation = validateDecompositionProposal({
    proposal: report.proposal,
    parentWorkItem,
    board,
    dag,
    blueprint: artifacts
  });

  if (!validation.ok) {
    // Mark parent as BLOCKED, not failed
    transitionLane(board, workItemId, "Ready", {}, {
      blockedReason: "Decomposition proposal rejected",
      decompositionErrors: validation.errors
    });
    await saveBoard(runDir, board);
    await appendBoardEvent(runDir, {
      event: "decompose-rejected",
      workItemId,
      errors: validation.errors,
      timestamp: new Date().toISOString()
    });
    return { ok: false, errors: validation.errors };
  }

  // 2. Create child work items on disk
  for (const child of report.proposal.childWorkItems) {
    const childWorkItem = {
      schemaVersion: "1.0",
      id: child.id,
      title: child.title,
      prdId: parentWorkItem.prdId,
      lane: "Contract Frozen",
      responsibilityUnitId: child.responsibilityUnitId ?? parentWorkItem.responsibilityUnitId,
      contractIds: child.contractIds,
      dependsOn: child.dependsOn,
      allowedPaths: child.allowedPaths,
      parentId: workItemId,
      depth: (parentWorkItem.depth ?? 0) + 1,
      verificationCommands: child.verificationCommands?.map(vc =>
        typeof vc === "string" ? { command: vc } : vc
      ) ?? parentWorkItem.verificationCommands,
      doneEvidence: [
        { kind: "verification", path: `evidence/${child.id}.verification.json` }
      ]
    };
    await writeJsonFile(path.join(runDir, "work-items", `${child.id}.json`), childWorkItem);
  }

  // 3. Update DAG
  const newNodes = report.proposal.childWorkItems.map(child => ({
    id: child.id,
    kind: child.kind ?? "implementation",
    responsibilityUnitId: child.responsibilityUnitId ?? parentWorkItem.responsibilityUnitId,
    requiredForDone: true,
    parentId: workItemId
  }));
  const newEdges = report.proposal.childWorkItems.flatMap(child =>
    (child.dependsOn ?? []).map(dep => ({
      from: dep,
      to: child.id,
      kind: "contract-dependency"
    }))
  );

  // Mark parent node as decomposed (no longer required itself; children are)
  const parentNode = dag.nodes.find(n => n.id === workItemId);
  if (parentNode) {
    parentNode.requiredForDone = false;
    parentNode.decomposedInto = report.proposal.childWorkItems.map(c => c.id);
  }

  dag.nodes.push(...newNodes);
  dag.edges.push(...newEdges);
  await writeJsonFile(path.join(runDir, "work-item-dag.json"), dag);

  // 4. Update board
  const childBoardItems = report.proposal.childWorkItems.map(child => ({
    id: child.id,
    title: child.title,
    lane: "Contract Frozen",
    responsibilityUnitId: child.responsibilityUnitId ?? parentWorkItem.responsibilityUnitId,
    contractIds: child.contractIds,
    dependsOn: child.dependsOn,
    allowedPaths: child.allowedPaths,
    parentId: workItemId,
    depth: (parentWorkItem.depth ?? 0) + 1
  }));
  board.workItems.push(...childBoardItems);

  // Parent moves to a "Decomposed" pseudo-lane (or stays in Running with flag)
  parentWorkItem.decomposed = true;
  parentWorkItem.childIds = report.proposal.childWorkItems.map(c => c.id);
  transitionLane(board, workItemId, "Running", {}, { decomposed: true });

  await saveBoard(runDir, board);

  // 5. Record event
  await appendBoardEvent(runDir, {
    event: "decomposed",
    workItemId,
    childIds: report.proposal.childWorkItems.map(c => c.id),
    reason: report.reason,
    timestamp: new Date().toISOString()
  });

  // 6. Rebuild preview model to update dashboard
  await renderDesignPreview({ runDir, now: new Date() });

  return {
    ok: true,
    parentId: workItemId,
    childIds: report.proposal.childWorkItems.map(c => c.id),
    errors: validation.warnings
  };
}
```

### 7.4 Dashboard Rendering

The dashboard shows hierarchy as expandable groups:

```
Board: Auth with Email/Password
═══════════════════════════════════════════════════════════

Progress: ████████░░░░░░░░ 40% (2/5 done)

Ready           │ Running          │ Done
────────────────┼──────────────────┼────────────────
wi.session-store│ ▼ wi.auth-api    │ wi.password-hash
                │   ├ routes    ▶  │ wi.users-table
                │   ├ middleware ○  │
                │   └ integration○  │

Legend: ▶ Running  ○ Ready  ■ Done  ▼ Decomposed parent

Architecture:
  [Users Table] ──migration──▶ [Password Hash] ──module-io──▶ [Auth API]
                                                                  │
                               [Session Store] ──module-io────────┘
```

### 7.5 Completion Rollup

When all children of a decomposed item finish:

```javascript
async function checkDecomposedCompletion({ workItemId, runDir }) {
  const board = await loadBoard(runDir);
  const parent = board.workItems.find(wi => wi.id === workItemId);

  if (!parent?.decomposed || !parent.childIds?.length) {
    return { complete: false };
  }

  const children = board.workItems.filter(wi => parent.childIds.includes(wi.id));
  const allDone = children.every(child => child.lane === "Done");

  if (allDone) {
    // Parent can now move to Done (or to Verifying if it had its own integration test)
    transitionLane(board, workItemId, "Done", {}, {
      completedVia: "child-rollup",
      childCompletions: children.map(c => ({
        id: c.id,
        lane: c.lane,
        completedAt: c.completedAt
      }))
    });
    await saveBoard(runDir, board);
    return { complete: true };
  }

  return {
    complete: false,
    remaining: children.filter(c => c.lane !== "Done").map(c => c.id)
  };
}
```

---

## 8. File Structure After Evolution

```
dev-harness/plugins/makeitreal/dev-harness/src/
├── plan/
│   ├── plan-generator.mjs              # EXISTING — heuristic path (Phase 1-3)
│   ├── plan-generator-claude.mjs       # NEW — Claude hybrid path
│   ├── blueprint-prompt.mjs            # NEW — prompt assembly
│   ├── blueprint-validator.mjs         # NEW — structural validation rules
│   ├── blueprint-normalizer.mjs        # NEW — proposal → canonical artifacts
│   ├── plan-writer.mjs                 # EXTRACTED from plan-generator.mjs
│   ├── responsibility-decomposer.mjs   # EXISTING — used by heuristic path
│   └── project-context-scanner.mjs     # NEW — scan project for Claude context
├── orchestrator/
│   ├── orchestrator.mjs                # EXISTING — add handleDecomposeReport
│   ├── decomposition-validator.mjs     # NEW — validate NEEDS_DECOMPOSE proposals
│   └── completion-rollup.mjs           # NEW — child completion → parent done
├── preview/
│   ├── preview-model.mjs               # EXISTING — evolve to v2.0 schema
│   └── hierarchy-model.mjs             # NEW — build hierarchy from board
└── domain/
    ├── work-item-dag.mjs               # EXISTING — add parentId/depth support
    └── artifacts.mjs                   # EXISTING — unchanged
```

---

## 9. Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Claude generates invalid JSON | Structured output mode + retry loop (max 3) |
| Claude invents non-existent paths | project-context-scanner provides real file tree |
| Claude over-decomposes (too many items) | Hard limit: max 12 work items, max depth 2 |
| Blueprint quality regression | A/B test phase before switching default |
| Network latency for Claude calls | Cache proposals by request hash; offline fallback to heuristic |
| Cost per blueprint | Single Claude call (~2K input, ~4K output) ≈ $0.02 |
| Existing tests break | plan-generator.mjs unchanged in Phase 1; all new code has own tests |
| NEEDS_DECOMPOSE abuse | Depth limit + orchestrator rate limit (max 2 decompositions per run) |

---

## 10. Decision Points for Owner

1. **Phase 1 timeline**: When to start building plan-generator-claude.mjs?
2. **Context scanning depth**: How deep should project scanning go? (costs tokens)
3. **Claude model choice**: Sonnet (fast, cheap) vs Opus (higher quality blueprints)?
4. **NEEDS_DECOMPOSE trigger**: Should sub-agents auto-detect, or only decompose when explicitly marked `decomposable: true` in the blueprint?
5. **Dashboard hierarchy UX**: Tree view vs flat-with-indent vs collapsible groups?
