# GSD And Spec Kit Feature Review For Make It Real

Status: absorption plan
Date: 2026-05-08

## Purpose

This review defines what Make It Real should absorb, extend, or intentionally
avoid from GSD and GitHub Spec Kit.

The goal is not feature parity. Make It Real should remain a Claude Code
contract-first harness: PRD and Blueprint before implementation, one owner per
work item, explicit boundary contracts, scoped workers, no undeclared fallback,
and evidence before Done.

## Sources Reviewed

- GSD repository and README: https://github.com/gsd-build/get-shit-done
- GSD architecture: https://github.com/gsd-build/get-shit-done/blob/main/docs/ARCHITECTURE.md
- GSD features reference: https://github.com/gsd-build/get-shit-done/blob/main/docs/FEATURES.md
- GitHub Spec Kit repository and README: https://github.com/github/spec-kit
- Superpowers subagent-driven-development skill and prompt templates in the
  local installed Superpowers bundle.
- Claude Code native subagents documentation:
  https://code.claude.com/docs/en/sub-agents

## Current Make It Real Baseline

Make It Real already has:

- Claude Code plugin packaging for `makeitreal@52g` and `mir@52g`.
- PRD, design pack, responsibility units, contracts, work items, trust policy,
  Blueprint review evidence, and read-only dashboard artifacts.
- Kanban lanes, dependency graph, claims, retry/reconcile, runtime attempts,
  runner provenance, path boundary enforcement, and Done gates.
- Real Claude Code runner support through scoped workspaces and selective
  handoff packets.
- Live wiki evidence or explicit wiki-skip evidence.
- Operator-facing `plan`, `launch`, `status`, `verify`, `config`, `doctor`, and
  `setup` commands.

Make It Real does not yet have:

- A first-class project constitution/governance artifact.
- Brownfield codebase mapping before planning.
- A durable agent-role catalog with model/tool profiles.
- Claude-native Make It Real subagent definitions that appear in Claude Code's
  `/agents` UI and can be selected through native subagent invocation.
- Wave-level execution planning visible to users.
- A progress-next command that selects the next appropriate public action.
- Lifecycle commands for ship/archive/milestone/release.
- Extension/preset/plugin architecture for optional capability packs.

## GSD Review

### What GSD Does Well

GSD's public loop is compact: initialize, discuss, plan, execute, verify, then
ship/repeat. The strong idea is that each command owns one workflow phase and
keeps the operator from managing internal steps.

The most relevant GSD concepts are:

| GSD Concept | Why It Works | Make It Real Decision |
| --- | --- | --- |
| Fresh context per agent | Reduces context rot by giving each worker a focused packet. | Adopt, but bind every worker to a Make It Real work item, contract, allowed path set, and verification command. |
| Structured file memory | Session resets do not lose state because artifacts live on disk. | Adopt as `.makeitreal/memory/` and project constitution, not as a separate `.planning/` system. |
| Discuss before plan | Captures implementation decisions that are too detailed for a roadmap sentence. | Adopt as Blueprint refinement and structured clarification before Ready. |
| Plan verification loop | Plans are checked before execution. | Already partly present through gates; extend with Blueprint quality checks. |
| Parallel execution waves | Independent plans run in waves and dependent work waits. | Extend existing Kanban dependency graph into explicit wave plans. |
| Manual acceptance verification | Verification is not only "tests ran"; broken work produces a fix plan. | Adopt as verification debt and rework plan artifact. |
| Model profiles | Users can choose quality, balanced, or budget profiles. | Adopt as runner profiles, but do not let profiles weaken gates. |
| Workflow feature toggles | Research, plan-check, verifier, and parallelization can be enabled/disabled. | Adopt as semantic config profiles with deterministic engine validation. |
| Agent role roster | Researchers, planners, checkers, executors, verifiers have distinct prompts and tools. | Adopt a smaller Make It Real role catalog scoped to contract-first work. |
| Progress-next | User can ask the system to pick the next workflow action. | Adopt as `/mir:next` or a status-driven recommendation before adding more commands. |

### What To Avoid From GSD

| Avoid | Reason |
| --- | --- |
| Broad command sprawl | Make It Real should stay small and operator-facing; internal engine commands remain private. |
| Permission-skipping as the default story | Make It Real's value is controlled execution, explicit approval, and path/contract boundaries. |
| Generic agent platform positioning | Make It Real should not compete as a general multi-agent suite; it should own contract-first development. |
| Loose plan execution without boundary contracts | This would undermine the core philosophy. |
| User-visible internal state dumps | Recent UX work explicitly moved raw engine fields to diagnostics. |

## Superpowers Subagent-Driven Development Review

Superpowers' strongest contribution is not a reusable runtime dependency. It is
an execution discipline: a controller extracts each task from a plan, gives a
fresh subagent only the context needed for that task, then reviews the result in
two stages before moving on.

Make It Real should adopt that shape, but bind it to Blueprint artifacts instead
of Superpowers plan files. The Make It Real version does not require
Superpowers, does not reference Superpowers skills in generated artifacts, and
does not ask workers to read the parent chat or the whole run directory.

### Architecture To Adopt

| Superpowers Pattern | Make It Real Adaptation | Claude Native Compatibility |
| --- | --- | --- |
| Fresh subagent per task | Fresh subagent per work item attempt; resume only the same implementer for review fixes on the same work item. | Use Claude Code subagents with separate context windows. |
| Controller provides full task context | Engine writes `agent-handoff.json` and prompt from PRD slice, Blueprint work item, contracts, dependency artifacts, allowed paths, and verification command. | Handoff prompt can be passed to a plugin/project subagent through native `@agent` or `--agent` flows. |
| Implementer reports `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED` | Map status to board events: `DONE` enters review, `DONE_WITH_CONCERNS` opens a review blocker, `NEEDS_CONTEXT` asks the operator or planner for missing context, `BLOCKED` fast-fails with root cause and rework planning. | Status is plain text plus structured output captured by the runner, so it works with native agents and CLI automation. |
| Spec compliance review before quality review | Add a `spec-reviewer` role that checks actual diff against PRD, Blueprint, contracts, and acceptance criteria before any quality review. | Reviewer can be a read-only Claude subagent with `Read`, `Glob`, `Grep`, and bounded `Bash` verification tools. |
| Code quality review after spec compliance | Add a `quality-reviewer` role that checks boundaries, naming, tests, maintainability, and overengineering only after spec compliance passes. | Reviewer can be a second native subagent; it receives base/head diff and spec-review evidence, not broad session context. |
| Final review after all tasks | Add a run-level `verification-reviewer` before Done to check evidence, unresolved concerns, dependency artifacts, and wiki/export state. | Native read-only agent can summarize final readiness without mutating board state. |
| No parallel implementers by default | Parallelize only execution waves whose work items have disjoint allowed paths, no dependency edge, and frozen shared contracts. | Claude Code supports multiple subagents, but Make It Real's board remains the authority on safe fan-out. |

### Make It Real Execution Loop

1. Blueprint approval freezes PRD, contracts, responsibility boundaries, allowed
   paths, and verification commands.
2. The orchestrator computes safe execution waves from the dependency graph.
3. For each ready work item, the controller creates a compact native-compatible
   subagent packet:
   - task intent and user-facing acceptance criteria;
   - owned paths and explicitly forbidden paths;
   - contract/API/IO documents;
   - dependency artifacts from completed upstream work;
   - exact verification command and expected evidence shape;
   - report-status contract.
4. The implementation subagent works only inside its packet and reports one of
   the four statuses.
5. A spec compliance reviewer reads the actual changed files and checks whether
   the result implements the Blueprint exactly, with no missing requirements and
   no unrequested behavior.
6. A code quality reviewer runs only after spec compliance passes and checks
   clean-code, naming, modularity, test quality, and boundary discipline.
7. Review failures route back to the same implementer context for that work item.
8. The run-level verification reviewer checks all work items and evidence before
   Done.

### Native Claude Agent Surface

Claude Code stores subagents as Markdown files with YAML frontmatter in
project-level `.claude/agents/`, user-level `~/.claude/agents/`, CLI-provided
`--agents` JSON, managed settings, or a plugin `agents/` directory. Make It Real
should therefore ship a small plugin `agents/` roster and optionally allow
`/mir:setup` to copy stricter project-level agents when a project wants local
overrides.

Initial native-compatible agents:

| Agent | Purpose | Default Tools |
| --- | --- | --- |
| `makeitreal-repo-mapper` | Read-only brownfield map before planning. | `Read`, `Glob`, `Grep`, safe `Bash` for listing/tests discovery. |
| `makeitreal-implementation-worker` | Implement one approved work item from `agent-handoff.json`. | `Read`, `Write`, `Edit`, `MultiEdit`, `Glob`, `Grep`, bounded `Bash`. |
| `makeitreal-spec-reviewer` | Verify implementation against PRD, Blueprint, contracts, and acceptance criteria. | Read-only tools plus bounded verification `Bash`. |
| `makeitreal-quality-reviewer` | Review maintainability, naming, modularity, tests, and overengineering after spec compliance. | Read-only tools plus bounded verification `Bash`. |
| `makeitreal-verification-reviewer` | Check final evidence, unresolved concerns, dependency artifacts, and Done readiness. | Read-only tools. |

Plugin-level agents should avoid frontmatter fields that Claude ignores for
plugin subagents, such as per-agent hooks or permission modes. Make It Real's
existing hooks and runner boundary checks remain the enforcement layer. If a
project needs stricter per-agent hooks, setup can materialize project-level
`.claude/agents/` files where those fields are supported.

### Guardrails

- Generated Make It Real plans and prompts must stay self-contained and must
  not require Superpowers or any external workflow skill.
- The controller, not the worker, decides the task packet. Workers should not
  inspect broad run state or parent conversation history to discover scope.
- Reviewers must verify actual code and evidence, not trust implementer claims.
- Implementation subagents may run in parallel only when the board proves
  disjoint paths, disjoint ownership, and frozen shared contracts.
- A `DONE_WITH_CONCERNS` report is not a pass; it becomes explicit review debt.
- `NEEDS_CONTEXT` should create an operator-facing clarification or planner
  rework item, not a silent fallback.
- Native Claude subagent compatibility is a product requirement: Make It Real
  should work through Claude Code's `/agents` UI, explicit agent mentions, and
  plugin-provided agent definitions, with the current structured runner kept as
  the automation fallback.

## Spec Kit Review

### What Spec Kit Does Well

Spec Kit's strongest idea is that specs are not disposable planning prose. They
become executable project artifacts used by later commands.

The most relevant Spec Kit concepts are:

| Spec Kit Concept | Why It Works | Make It Real Decision |
| --- | --- | --- |
| Constitution | Project principles guide every later spec, plan, and implementation. | Adopt as `.makeitreal/constitution.md` plus machine-readable `constitution.json`. |
| Specify | Separates what/why from tech stack. | Strengthen Make It Real `plan` intake so PRD creation stays product/behavior-first. |
| Clarify before plan | Structured questions reduce downstream rework. | Adopt as a first-class `clarifications` artifact attached to the Blueprint. |
| Plan | Technical plan is separate from functional spec. | Already present as design pack; extend with research and decision records. |
| Tasks | Implementation tasks are generated from plan artifacts. | Already present as Kanban work items; extend with traceability back to spec sections. |
| Implement | Build follows the generated task list. | Already present through `launch`; improve worker role selection and wave execution. |
| Contracts/data model/quickstart/research files | Creates specific artifacts beyond a single plan. | Adopt selectively in design pack: contracts, data model, quickstart, research notes. |
| Review and acceptance checklist | Forces spec quality before implementation. | Adopt as Blueprint review checklist and gate evidence. |
| Extensions/presets | Optional packs add integrations and governance without bloating core. | Adopt later as capability packs only after core contract-first flow is stable. |

### What To Avoid From Spec Kit

| Avoid | Reason |
| --- | --- |
| Duplicating `.specify/` layout | Make It Real already owns `.makeitreal/`; two state roots would confuse agents. |
| Treating generated docs as implementation authority without runtime gates | Make It Real must keep gates and evidence authoritative. |
| Broad extension ecosystem before core hardening | Extensions should not arrive before first-run, recovery, and runner UX are stable. |
| Tech-stack-first planning | Make It Real should preserve PRD-first, boundary-first design. |

## Absorption Backlog

### P0: Next Refinement Tranche

These should be implemented before broadening the product surface.

| Item | Source | Make It Real Shape | Acceptance Evidence |
| --- | --- | --- | --- |
| Project constitution | Spec Kit | `.makeitreal/constitution.md` and `constitution.json`; `plan` reads it before PRD/Blueprint generation. | Plan output cites constitution rules; gate fails when required constitution is missing only if config requires it. |
| Brownfield map | GSD and Spec Kit Brownfield | Read-only repo map containing stack, test commands, modules/responsibility candidates, existing contracts, naming conventions, and reusable modules. | `plan` can propose boundaries from map without exposing internal harness terms. |
| Blueprint clarification artifact | Spec Kit clarify | `clarifications.json` with question, answer, affected spec section, and decision provenance. | AskUserQuestion answers are recorded and shown in dashboard Blueprint docs. |
| Blueprint quality checker | GSD plan-checker | Engine validates PRD/design/contract/task traceability before Ready. | New gate errors distinguish missing acceptance criteria, missing boundary contract, missing verification, and untraceable work item. |
| Agent role catalog | GSD agent roster and Superpowers SDD | Small Claude-native role set: `repo-mapper`, `implementation-worker`, `spec-reviewer`, `quality-reviewer`, `verification-reviewer`, `rework-planner`. | Plugin/project agent files are valid Claude native subagents; launch docs select roles without broad context dumping; tests assert role prompts stay scoped. |
| Execution waves | GSD execute-phase and Superpowers SDD | Board dependency graph projects wave 1/2/3 and launch reports wave state; implementation fan-out is allowed only for disjoint work items with frozen contracts. | Dashboard and status show wave grouping; orchestrator dispatch respects wave boundaries and blocks conflicting implementation agents. |
| Progress-next | GSD progress | `/mir:next` or `/mir:status --next` recommends setup/plan/review/launch/verify/rework/done. | No raw engine fields; recommendation is derived from run status and gate blockers. |

### P1: Operator Quality And Recovery

| Item | Source | Make It Real Shape | Acceptance Evidence |
| --- | --- | --- | --- |
| Verification debt file | GSD verifier | `verification-debt.json` records failed checks, root cause category, fix plan, and owner. | Failed verify writes debt; Done gate rejects unresolved debt. |
| Rework plan generator | GSD verify/fix plan | Failed run produces bounded rework work item instead of vague "try again". | Rework item has owner, allowed paths, contract IDs, verification command. |
| Model and runner profiles | GSD model profiles | `quality`, `balanced`, `budget`, `inherit` profiles for runner command/model/tool policy. | Config schema validates profiles; gates never weaken by profile. |
| Ship summary | GSD ship | Generate PR/commit summary from PRD, contracts, work items, verification, wiki evidence. | `ship` is read-only by default and emits markdown unless configured for git integration. |
| Session resume packet | GSD context continuation | Compact resume summary for active run with current phase, blockers, and next public command. | `/mir:status` can emit a copyable resume block. |

### P2: Ecosystem And Scale

| Item | Source | Make It Real Shape | Acceptance Evidence |
| --- | --- | --- | --- |
| Capability packs | Spec Kit extensions/presets | Optional local packs for security review, API evolution, CI, GitHub Issues, docs export. | Pack manifest validates commands, gates, and extra artifacts without changing core. |
| Namespace router | GSD namespace meta-skills | Only if command count grows; keep primary `/mir:*` surface small. | Router does not hide canonical commands and has tests for routing text. |
| Milestone archive | GSD milestones | Archive completed runs to `.makeitreal/archive/` with release notes. | Archive preserves evidence and removes active-run pointer safely. |
| Cost/token report | Spec Kit cost/token extensions | Optional run report for tokens, duration, retries, and runner failure classes. | Generated from attempt metadata; no external service required. |

## Feature Fit Matrix

| Capability | Make It Real Today | Gap | Priority |
| --- | --- | --- | --- |
| PRD/spec creation | Yes | Needs constitution and clarification trace. | P0 |
| Technical plan/design pack | Yes | Needs research notes, quality checker, data model/quickstart slots. | P0 |
| Task breakdown | Yes, as Kanban work items | Needs wave projection and traceability visualization. | P0 |
| Scoped execution | Yes | Needs first-class role catalog, Superpowers-style review loop, and Claude native subagent routing. | P0 |
| Verification | Yes | Needs verification debt and rework planning. | P1 |
| Status/progress | Yes | Needs progress-next and resume packet. | P0/P1 |
| Config | Basic semantic profiles | Needs runner/model/workflow profiles. | P1 |
| Dashboard | Read-only docs/Kanban | Needs wave view, constitution/clarification panels. | P0 |
| Brownfield onboarding | Shallow | Needs repo map and reusable-module audit. | P0 |
| Ship/release | No | Add read-only ship summary before write integration. | P1 |
| Extensions | No | Delay until core flow is stable. | P2 |

## Recommended Next Implementation Order

1. Constitution and brownfield map.
2. Clarification artifact and Blueprint quality checker.
3. Claude-native agent role catalog and Superpowers-style implementer /
   spec-reviewer / quality-reviewer loop.
4. Wave projection with conflict-safe fan-out.
5. Progress-next and resume packet.
6. Verification debt and rework plan generator.
7. Runner/model profiles.
8. Read-only ship summary.
9. Capability pack skeleton.

This order improves Make It Real's actual golden path before broadening the
surface. It also preserves the public command boundary: the operator should
still mainly use `plan`, `launch`, and `status`, with `verify`, `config`,
`doctor`, and later `next` as support commands.

## Product Positioning

Make It Real should not describe itself as "GSD plus Spec Kit." The stronger
position is:

> Make It Real is a contract-first Claude Code harness that turns a feature
> request into approved Blueprint artifacts, scoped agent work packets,
> contract-bound execution, and evidence-backed Done gates.

GSD contributes context hygiene and agent-wave execution ideas. Spec Kit
contributes constitution/spec/clarification discipline. Make It Real contributes
the stricter engineering topology: responsibility ownership, boundary contracts,
path enforcement, fail-fast behavior, and auditable gates.

Superpowers contributes the proven task-controller and review-loop pattern. Make
It Real should absorb that architecture into Blueprint-native, Claude-native
subagent packets without inheriting Superpowers as an operator dependency.
