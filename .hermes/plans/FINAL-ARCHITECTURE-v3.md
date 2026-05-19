# Make It Real — Final Architecture (v3, Post-환골탈태)

## Status: IMPLEMENTATION-READY

**Date:** 2026-05-19
**Review Rounds:** 3 (architect, UX, DX strategist, integration architect, pragmatic engineer)
**Constraint:** 272 existing tests must pass at every commit

---

## Core Architecture: superpowers Pattern + React Flow

```
AGENT writes preview-model.json (structured data, never HTML/SVG)
  → SERVER (zero-dep Node.js HTTP+WS) detects change via fs.watch
  → SERVER pushes model via WebSocket to browser
  → PRE-BUILT REACT APP (committed dist/) renders using React Flow + components
  → USER interacts (click nodes, approve blueprint, navigate)
  → EVENTS flow back via WebSocket → state/events file → AGENT reads
```

The AI NEVER generates the page. It generates DATA that plugs into pre-built components.

## Detailed Specs (separate documents)

| Document | Lines | Contents |
|----------|-------|----------|
| react-component-library-spec.md | 3438 | 9 React components (TypeScript), Zustand store, theme, routing, build strategy |
| blueprint-pipeline-evolution.md | 1248 | Claude-driven generation, validation engine, NEEDS_DECOMPOSE, migration path |
| visual-companion-analysis.md | 596 | superpowers pattern analysis, Make It Real adaptation |

## Key Decisions

### 1. ONE tier: React app served from live localhost server
- NO static HTML file:/// tier. ONE rendering path.
- Server: zero-dep Node.js HTTP+WS (like superpowers)
- Client: pre-built React 19 + React Flow + Zustand (~300-400KB)
- Bundle committed to repo as dist/. No runtime build.

### 2. React Flow for interactive graphs
- TopologyGraph: architecture modules + contract edges (React Flow)
- TaskDAG: work item dependency graph with status colors (React Flow)
- Non-graph panels: ContractPanel, ResponsibilityMap, SequenceDiagram, KanbanBoard (React, no RF)
- Cross-panel linking via Zustand selection store

### 3. Claude-driven blueprint generation (hybrid)
- Claude generates semantic blueprint via structured output (BlueprintProposal schema)
- Engine validates: acyclic DAG, unique IDs, path containment, ownership non-overlap
- Current regex heuristics become FALLBACK (--offline mode)
- Migration: 4 phases, opt-in → A/B → default → heuristic removal

### 4. Recursive sub-agents (NEEDS_DECOMPOSE)
- Sub-agent returns {status: "NEEDS_DECOMPOSE", suggestedSplit}
- Orchestrator validates depth < 2
- Child work items materialized on board with parentWorkItemId
- Dashboard shows expandable hierarchy in real-time

### 5. Browser approval supplements terminal
- POST /api/blueprint/review → same decideBlueprintReview() function
- Terminal hooks unchanged. Browser is additional surface.

## Implementation Phases (~22 working days)

### Phase 1: Docs + Demo (Days 1-5) — zero code risk
1. README.md (compelling narrative, pipeline diagram, comparison table)
2. docs/ (getting-started, how-it-works, concepts)
3. /mir:demo + 3 example blueprints (todo-app, rest-api, monorepo)

### Phase 2: Dashboard React App (Days 6-14) — highest visual impact
4. React app scaffold (Vite + React Flow + Zustand + theme)
5. Server (zero-dep HTTP+WS, superpowers lifecycle pattern)
6. Core components: HeroSection, TopologyGraph, TaskDAG
7. Content panels: ContractPanel, ResponsibilityMap, FileTree
8. DetailDrawer + cross-panel linking + KanbanBoard

### Phase 3: Blueprint Intelligence (Days 15-20)
9. Plan generator file split (no logic changes)
10. Claude-driven blueprint generation (hybrid with validation)
11. Recursive sub-agent orchestration (NEEDS_DECOMPOSE)

### Phase 4: Polish (Days 21-22)
12. Source sync CI, JSON schemas, extended docs, CONTRIBUTING.md

## Parallelizable Streams

Stream A: Changes 1,2,3,12 (docs — writing agent)
Stream B: Changes 4,5,6,7,8 (React dashboard — frontend agent)
Stream C: Changes 9,10,11 (blueprint + orchestration — backend agent)

## Done Criteria

- All 272 original + ~54 new tests pass
- npm run check succeeds end-to-end
- /mir:demo generates blueprint + opens dashboard in < 30 seconds
- Dashboard: React Flow interactive graphs, dark mode, live WebSocket updates
- Dashboard: contract display, file tree, responsibility map, sequence diagrams
- Live server: browser-based blueprint approval
- Recursive sub-agents: NEEDS_DECOMPOSE to depth 2
- README + docs + 3 example blueprints
- asciicast GIF in README
