# Doctrine Violations — Full Audit
**Doctrine: LLM decides everything. Engine validates + saves only.**
**Date: 2026-06-02**

## Summary
- Files audited: 67
- Files with violations: ~29
- Files clean: ~38
- Total violations: ~190

## Severity Breakdown
- CRITICAL: ~35 (autonomous state transitions, content fabrication, policy enforcement)
- HIGH: ~65 (hardcoded policies, heuristic classification, prompt generation)
- MEDIUM: ~70 (default fallbacks, domain rules, inference)
- LOW: ~20 (minor cosmetic decisions)

## Top Offenders

### 1. test-scaffold.mjs — 28 violations (ENTIRE FILE IS DOCTRINE VIOLATION)
Engine generates test code. LLM should write tests. Delete and replace with prompt builder.

### 2. orchestrator.mjs — 16 violations
- COMPLETION_POLICIES hardcoded (CRITICAL)
- renderNativeTaskPrompt fabricates all LLM prompts (CRITICAL)
- renderNativeReviewerPrompt fabricates reviewer prompts (CRITICAL)
- Auto-retry with engine-computed backoff (HIGH)
- nodeKindForWorkItem silent fallback (CRITICAL)

### 3. operator-summary.mjs — 16 violations
- ENTIRE FILE generates user-facing prose the LLM should write
- Every headline, every nextAction, every blocker message
- Should be: engine emits structured state codes, LLM writes the messages

### 4. system-dossier.mjs — 17 violations
- deriveDesignPatterns() fabricates pattern names, rationales, Mermaid diagrams (CRITICAL)
- derivedScenariosFromModuleGraph() fabricates interaction sequences (CRITICAL)
- modelReviewDecisions() generates prose policy statements (CRITICAL)
- harnessSequence() classifies sequences by keyword scanning (HIGH)

### 5. blueprint-normalizer.mjs — 18 violations
- ERROR_STATUS_RULES infers HTTP status from error names (CRITICAL)
- defaultSignature fabricates 6 field values (CRITICAL)
- owner hardcoded "team.implementation" (CRITICAL)
- fabricated callStacks/sequences (CRITICAL)
- CANONICAL_LANES/TRANSITIONS hardcoded state machine (HIGH)
- doneEvidence hardcoded + HTTP-conditional (HIGH)

### 6. interactive-approval.mjs — 9 violations
- buildNativeReviewDelegationContext generates full LLM prompt (CRITICAL)
- Engine scripting LLM behavior for approve/reject/revise (HIGH x3)
- Fabricated reason text saved as LLM evidence (HIGH)

### 7. board-mutator.mjs — 8 violations
- completeParentWhenChildrenDone auto-transitions parent to Verifying (CRITICAL)
- MAX_DECOMPOSITION_DEPTH/MAX_CHILDREN hardcoded (HIGH)
- required evidence kinds hardcoded (HIGH)

## Clean Files (no violations)
Pure I/O, state machine transitions, structural validation only:
- src/io/*.mjs
- src/kanban/*.mjs
- src/board/board-store.mjs, claim-store.mjs, dependency-graph.mjs, mailbox.mjs, responsibility-boundaries.mjs
- src/domain/path-policy.mjs, prd.mjs, work-item-dag.mjs
- src/adapters/command-evidence.mjs, openapi-conformance.mjs, path-boundary.mjs
- src/orchestrator/attempt-store.mjs, native-packets.mjs, runner-simulator.mjs, runtime-state.mjs, review-evidence.mjs
- src/preview/render-dashboard-html.mjs, render-preview.mjs, templates/execution-plan.mjs, templates/modules.mjs, templates/overview.mjs

## Fix Priority

### IMMEDIATE (blocks correctness)
1. test-scaffold.mjs — delete, replace with prompt builder
2. orchestrator.mjs renderNativeTaskPrompt/renderNativeReviewerPrompt — move to skill files
3. system-dossier.mjs deriveDesignPatterns + derivedScenariosFromModuleGraph — delete
4. operator-summary.mjs — delete prose generation, emit structured codes only
5. board-mutator.mjs completeParentWhenChildrenDone — emit event, don't auto-transition

### NEXT (doctrine hygiene)
6. blueprint-normalizer.mjs ERROR_STATUS_RULES — require httpStatus in schema
7. interactive-approval.mjs — move prompt strings to skill files
8. board-status.mjs auto-promotion — remove, require explicit LLM action
9. retry-policy.mjs — make configurable
10. COMPLETION_POLICIES — read from blueprint artifacts

### LATER (low risk)
- All LOW severity violations
- Display/rendering heuristics
- Configuration defaults
