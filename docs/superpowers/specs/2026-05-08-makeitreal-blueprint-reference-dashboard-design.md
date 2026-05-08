# Make It Real Blueprint Reference Dashboard Design

## Context

The current generated dashboard is read-only and useful as proof, but its visual hierarchy is wrong. It leads with operator status, first-run checklist, large Kanban lanes, blockers, evidence, and then flat design-pack lists. That makes a planned Blueprint feel like an internal harness dump rather than a reviewable software architecture document.

The approved direction is **Blueprint Reference**: the dashboard should read like API/SDK documentation. Kanban remains visible, but only as compact runtime state. The main surface is the Blueprint contract: what will be delivered, which API or IO contract is authoritative, which responsibility unit owns which paths, how calls flow, and what evidence proves correctness.

## Goals

- Make the first viewport explain the planned software change, not the engine state.
- Present Blueprint artifacts in a reference-document structure: overview, contract, boundaries, sequence/call stack, evidence, and raw artifact escape hatch.
- Keep the dashboard strictly read-only. No browser approval, launch, retry, reconcile, or Done actions.
- Keep Kanban present but visually secondary and compact.
- Preserve auto-reload and command-copy behavior.

## Non-Goals

- Do not turn the dashboard into a full project-management product.
- Do not add mutating browser actions.
- Do not introduce frontend dependencies or a build step.
- Do not redesign the runtime state machine or board schema.

## Content Model

The preview model should expose structured document-oriented fields derived from existing artifacts:

- `blueprint.title`, `blueprint.summary`, `blueprint.goals`, `blueprint.nonGoals`, `blueprint.acceptanceCriteria`
- `blueprint.contracts` from `design-pack.apiSpecs`
- `blueprint.boundaries` from `design-pack.responsibilityBoundaries`
- `blueprint.architecture` from nodes and edges
- `blueprint.callStacks` and `blueprint.sequences`
- compact `board` and `operatorCockpit` status for the right rail

The existing flat `design.*` arrays can remain for compatibility, but the renderer should prefer the new `blueprint` structure.

## Layout

Use a three-column documentation layout on desktop:

- Left navigation: Overview, API / IO Contract, Responsibility Boundaries, Sequence & Call Stack, Acceptance Evidence, Raw Artifacts.
- Center document: Blueprint title, summary, delivery table, contract reference, boundary cards, flow/call-stack sections.
- Right status rail: phase, Blueprint approval state, next Claude Code action, compact Kanban counts, blockers, evidence links.

On mobile, collapse to a single column with navigation first, document second, status rail last.

## Visual Direction

Use a sober developer-docs aesthetic:

- White/off-white document panels, sharp information hierarchy, restrained borders.
- Accent colors for state only, not decorative gradients.
- Dense but readable tables and contract cards.
- Card radius at or below 8px where feasible.
- No nested decorative cards, no marketing hero, no large illustrative empty states.

## Acceptance Criteria

- The dashboard HTML contains `Blueprint Reference`, `What Will Be Delivered`, `API / IO Contract`, `Responsibility Boundaries`, `Sequence & Call Stack`, `Acceptance Evidence`, and `Runtime Snapshot`.
- The first viewport includes PRD title, user-visible behavior, primary contract, status, and next action.
- Kanban appears as compact lane counts plus a small work-item list, not the main page body.
- Generated JS still contains auto-reload and clipboard copy, and still contains no `makeitreal-engine`, Blueprint mutation fetch, or orchestrator mutation fetch.
- Existing canonical preview tests pass and assert read-only invariants.
- `npm run check` and `npm run plugin:validate` pass.
