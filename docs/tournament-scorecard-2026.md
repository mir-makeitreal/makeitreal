# 신룣 Grand Tournament (천무대전) — AI Coding Harness Scorecard
# Make It Real vs the 10k+ Star Field
# Judge: Hermes Agent | Date: 2026-06-01

---

## THE COMPETITORS

| Competitor        | Stars   | Type                          | LLM Runtime         |
|-------------------|---------|-------------------------------|---------------------|
| Make It Real      | ~100    | Claude Code plugin + engine   | Claude Code only    |
| Aider             | ~30k    | Terminal CLI, multi-LLM       | Any LLM             |
| OpenHands         | ~45k    | Web UI + Docker sandbox       | Any LLM             |
| Cline             | ~20k    | VSCode extension              | Any LLM             |
| SWE-Agent         | ~15k    | Terminal CLI, research tool   | Any LLM             |
| Continue.dev      | ~20k    | VSCode/JetBrains ext.         | Any LLM             |
| Devin             | N/A     | SaaS, fully autonomous        | Proprietary         |
| Cursor Agent      | N/A     | VSCode fork + agent/composer  | Any LLM             |
| bolt.new          | N/A     | Browser WebContainer          | Claude/GPT/Gemini   |

---

## COMPETITOR DOSSIERS

### AIDER (~30k stars)
Architecture: Git-native terminal CLI. Two-mode design: architect mode (Claude
plans the approach) and editor mode (a cheaper model implements the diffs). Uses
tree-sitter repomaps to give the LLM a compressed view of the whole codebase.
All edits go through structured diff blocks; the LLM cannot apply arbitrary
writes. Supports every major LLM (GPT-4, Claude, Gemini, local via Ollama).

LLM<->Code boundary: Git diff blocks are the contract. The repo IS the state.
Sessions are stateless; context is rebuilt from the repo each time.

Strengths: Mature, battle-tested, huge community, architect/editor split is
genuinely clever, repo maps solve context-window explosion, works on any codebase.

Weaknesses: Single-threaded execution (no parallel agents), no formal contracts
between modules, no path enforcement (anything can touch anything), no Kanban
state machine, agent can silently self-declare done, no dashboard.

---

### OPENHANDS (~45k stars)
Architecture: Docker sandbox gives the agent full OS-level access: bash, browser,
file system, CI tools. CodeAct agent framework. Multi-agent delegation. Web UI
for interaction. Best SWE-bench scores among open-source tools. Microservice
architecture with runtime, backend, and frontend components.

LLM<->Code boundary: Docker container is the isolation layer. Agent has god-mode
inside the container. Outside: separate backend/frontend services.

Strengths: SOTA SWE-bench performance, full OS access, browser automation built-in,
cloud execution, true parallelism possible, multi-agent framework.

Weaknesses: Heavy infrastructure (Docker required, multiple services), high
latency per action, complex self-hosting, expensive token usage due to full-context
execution, no formal contracts/DAG, path isolation is container-level not module-level.

---

### CLINE (~20k stars)
Architecture: VSCode extension with plan/act mode toggle. Direct file system and
terminal access. MCP tool consumer (uses dozens of MCP servers). Checkpoint/restore
for undoing agent actions. Browser automation. Reads context from CLAUDE.md or
equivalent project files.

LLM<->Code boundary: VSCode extension API. Agent calls tools (read_file, write_file,
execute_command) directly. Checkpoint system allows rollback.

Strengths: MCP ecosystem integration, checkpoint/restore, browser automation,
deep VSCode integration, plan mode previews before acting, very active community.

Weaknesses: Primarily single-threaded (sequential task execution), no formal
architecture phase, no contract enforcement, no DAG scheduler, path boundaries
are advisory (user can approve any tool call), no Kanban state machine.

---

### SWE-AGENT (~15k stars)
Architecture: Princeton research project. Defines an Agent-Computer Interface
(ACI) — a constrained set of bash/file tools optimized for LLM use. Targets
GitHub issue resolution. Batch evaluation mode for benchmarks. No IDE integration.

LLM<->Code boundary: ACI abstraction layer. Custom commands (open, goto, search)
replace raw bash to reduce hallucination surface area.

Strengths: Rigorous ACI design (reduces bad LLM behaviors), academic excellence,
benchmark-optimized, clean research codebase.

Weaknesses: Research tool, not a team development harness. No UI, no parallelism,
no contracts, no DAG, no dashboard, heavy Docker requirement, poor DX outside
benchmark evaluation contexts.

---

### CONTINUE.DEV (~20k stars)
Architecture: VSCode/JetBrains extension. AI coding assistant (chat, autocomplete,
inline edits). Context providers (codebase, docs, web, GitHub issues). Not an
autonomous agent — augments the human developer. Tab autocomplete, model routing.

LLM<->Code boundary: The human is the boundary. Continue suggests; the developer
approves. Agent mode is limited and sequential.

Strengths: Best-in-class IDE assistant DX, multi-IDE, context providers ecosystem,
tab autocomplete, good for individual developer productivity.

Weaknesses: Not an autonomous coding agent. No planning phase, no contracts, no
DAG, no state machine, not designed for multi-agent workflows. Wrong category
for this tournament.

---

### DEVIN (Cognition AI)
Architecture: Fully autonomous commercial SaaS. Persistent memory across sessions.
Web browser, shell, CI/CD integration. Can file PRs, run tests, communicate in
Slack. $500/month. Proprietary architecture.

LLM<->Code boundary: SaaS API. Internal architecture is a black box. Agent has
a long-horizon planning module and memory retrieval.

Strengths: Most polished end-to-end experience, real persistent memory, CI/CD
integration, handles multi-day tasks, commercial support.

Weaknesses: Expensive, black box, cloud-only, no local execution, no open source
inspectability, no MCP, vendor lock-in, known to hallucinate confidence on hard tasks.

---

### CURSOR AGENT MODE
Architecture: VSCode fork. Agent mode + Composer for multi-file changes. Shadow
workspace (agent edits in a hidden copy, user reviews diff). Context-aware with
codebase indexing. Supports all major LLMs. Rules files (like CLAUDE.md).

LLM<->Code boundary: Shadow workspace diff review. User approves proposed edits.
No formal contracts or DAG.

Strengths: Best IDE DX among all competitors, shadow workspace is elegant, auto-debugging
loop, large community, fast model routing, multi-file agent context.

Weaknesses: Closed-source core, no formal architecture phase, no contract enforcement,
no path boundaries, no DAG scheduler, single-agent sequential, expensive subscription.

---

### BOLT.NEW (StackBlitz)
Architecture: Browser-based WebContainer — full Node.js runtime in the browser,
no local install ever. AI generates full-stack apps with real-time preview. Supports
Claude, GPT, Gemini. Import from GitHub. Deploy to Netlify/Cloudflare.

LLM<->Code boundary: WebContainer is the isolation. No host OS access. Real-time
browser preview is the feedback loop.

Strengths: Zero setup (browser-only), real-time preview, great for demos/prototypes,
accessible to non-developers, multi-LLM, deploy in one click.

Weaknesses: WebContainer limits (no native binaries, no Docker, Node.js only for
server side), no formal planning/contracts/DAG, single-agent, not suitable for
complex multi-module backend systems, no path enforcement.

---

## THE FIVE DIMENSIONS

Scoring: 1-10 per dimension. Higher = better in that dimension.
For MIR, scores reflect what the engine provably does based on code inspection.

---

## DIMENSION 1: STRUCTURAL INTEGRITY
(State machine soundness, error handling, test quality, zero-dep discipline)

| Competitor     | Score | Rationale                                                               |
|----------------|-------|-------------------------------------------------------------------------|
| Make It Real   |  9/10 | 10-state Kanban with enforced transitions, fingerprinted approval gates,|
|                |       | 433 tests 0 fail, zero external dependencies, named HARNESS_* error     |
|                |       | codes throughout. Gates are refusable by the engine, not advisory.      |
|                |       | Only gap: v0.1.46, not battle-tested at scale yet.                      |
| Aider          |  7/10 | Git is excellent state management. Good error handling, mature codebase.|
|                |       | No formal state machine. Tests exist but no Kanban/gate discipline.     |
| OpenHands      |  6/10 | Complex multi-service architecture. Docker isolation is real. But heavy |
|                |       | dependency tree (Python + Docker + multiple services). No Kanban gates. |
| Cline          |  5/10 | VSCode extension state, checkpoint/restore is good. No state machine,   |
|                |       | no enforced gates, no zero-dep discipline (npm heavy).                  |
| SWE-Agent      |  5/10 | Academic codebase, ACI is clean. No state machine, no gates. Research   |
|                |       | quality, not production hardening.                                      |
| Continue.dev   |  6/10 | Good extension engineering, stable. Wrong category — not an agent       |
|                |       | harness. No state machine for multi-agent orchestration.                |
| Devin          |  7/10 | Commercial, presumably hardened. Black box — can't inspect state model. |
|                |       | Known to have memory consistency issues on long tasks (user reports).   |
| Cursor         |  7/10 | Shadow workspace is solid state management. Good engineering. Closed    |
|                |       | source — can't verify internal state machine or test coverage.          |
| bolt.new       |  5/10 | WebContainer is structurally solid. Agent layer is thin — no formal     |
|                |       | state machine, no gates, no test discipline for the orchestration layer.|

WINNER: Make It Real (9/10) | Runner-up: Aider / Devin / Cursor (7/10)
MIR VERDICT: WIN — only competitor with a machine-enforced state machine AND
             zero-dep discipline AND 433 tests covering every gate path.

---

## DIMENSION 2: ARCHITECTURE DESIGN
(LLM<->engine boundary clarity, schema design, MCP surface, hook pattern quality)

| Competitor     | Score | Rationale                                                               |
|----------------|-------|-------------------------------------------------------------------------|
| Make It Real   |  9/10 | Crystal-clear boundary: deterministic engine, LLM orchestrated through  |
|                |       | hooks and typed commands. Flat schemas (no cross-ref). Minimal MCP      |
|                |       | surface (blueprint + launch). Hooks are quiet-by-default — don't        |
|                |       | hijack ordinary Claude Code chat. PreToolUse is surgical: blocks only   |
|                |       | when a run is active AND context is scoped. Architecture Dossier is     |
|                |       | read-only (no mutating controls in the UI — control plane is chat/hooks).|
| Aider          |  7/10 | Architect/editor split is elegant. Git diff as the interface is clean.  |
|                |       | No MCP. Session-stateless design is a real architectural virtue.        |
| OpenHands      |  7/10 | CodeAct agent framework is well-designed. Docker as isolation is sound. |
|                |       | But boundary is blurry inside the container (agent has full OS access). |
| Cline          |  6/10 | MCP consumer (not provider) is a design choice. Tool-calling loop is    |
|                |       | clear. Plan/act toggle is good. No formal schema for agent state.       |
| SWE-Agent      |  7/10 | ACI abstraction is architecturally interesting — reduces the interface  |
|                |       | surface between LLM and OS. Clean academic design. Not extensible.      |
| Continue.dev   |  6/10 | Context providers architecture is well-designed for an assistant. Not   |
|                |       | designed for autonomous multi-agent orchestration.                      |
| Devin          |  6/10 | Black box. From external behavior: planning + execution + memory is     |
|                |       | sound. But no inspectable architecture, no MCP, no schema contracts.    |
| Cursor         |  7/10 | Shadow workspace as the LLM<->code boundary is genuinely clever. Rules  |
|                |       | files add agent guidance. But closed-source, no schema enforcement.     |
| bolt.new       |  6/10 | WebContainer is the cleanest isolation boundary in the field. Simple    |
|                |       | agent layer on top. No schema contracts, no DAG, but the boundary       |
|                |       | is physically real (browser sandbox).                                   |

WINNER: Make It Real (9/10) | Runner-up: Aider / OpenHands / SWE-Agent / Cursor (7/10)
MIR VERDICT: WIN — unique combination of quiet hooks + read-only dashboard +
             flat typed schemas + deterministic engine as the true control plane.

---

## DIMENSION 3: DEVELOPER EXPERIENCE (DX)
(Time to first output, error messages, documentation, debugging capability)

| Competitor     | Score | Rationale                                                               |
|----------------|-------|-------------------------------------------------------------------------|
| Make It Real   |  7/10 | `node bin/harness.mjs demo rest-api` → blueprint in seconds. HARNESS_*  |
|                |       | error codes are actionable. Architecture Dossier is a beautiful static  |
|                |       | HTML doc. /doctor command. BUT: Claude Code only, no multi-runtime, v0  |
|                |       | means rough edges exist. Ceremony is high for simple tasks.             |
| Aider          |  9/10 | Single command, zero config, works on any repo immediately. Architect   |
|                |       | mode is one flag. Error messages are clear. Battle-tested. Best DX in   |
|                |       | the field for terminal users.                                           |
| OpenHands      |  7/10 | Web UI is polished. GitHub issue input is intuitive. But Docker setup   |
|                |       | is heavy; self-hosting is complex. High latency per action.             |
| Cline          |  8/10 | VSCode install, immediate chat. Plan mode previews changes. Checkpoint  |
|                |       | makes mistakes recoverable. Very active community = good support.       |
| SWE-Agent      |  4/10 | Research tool. CLI-only, complex setup, benchmark-focused. Not designed |
|                |       | for developer DX.                                                       |
| Continue.dev   |  9/10 | Best-in-class IDE assistant DX. Tab autocomplete is magical. Context    |
|                |       | providers "just work." Multi-IDE is a genuine win.                      |
| Devin          |  9/10 | Most polished UX. Chat interface, Slack integration, automatic PR       |
|                |       | filing. If money is no object, the smoothest ride.                      |
| Cursor         |  9/10 | Native IDE feel, shadow workspace reviews, fast, familiar. The DX       |
|                |       | benchmark others are measured against.                                  |
| bolt.new       |  9/10 | Zero setup (browser). Real-time preview. One-click deploy. Unbeatable   |
|                |       | accessibility. Best DX for non-developers and rapid prototyping.        |

WINNER: Cursor / bolt.new / Continue.dev / Devin / Aider (9/10)
MIR VERDICT: LOSS — ceremony of blueprint + approval + gate flow is a deliberate
             trade for correctness. DX wins go to tools that skip the ceremony.
             MIR is not trying to win this dimension for simple tasks.

---

## DIMENSION 4: UNIQUE VALUE PROPOSITION
(What does Make It Real do that others DON'T? Is the value defensible?)

| Competitor     | Score | Rationale                                                               |
|----------------|-------|-------------------------------------------------------------------------|
| Make It Real   |  9/10 | The only tool in the field that does ALL of:                            |
|                |       | 1) Machine-checkable OpenAPI + module-surface contracts (frozen)        |
|                |       | 2) Contract conformance tests auto-generated from specs                 |
|                |       | 3) DAG-scheduled parallel sub-agents with claims/leases                 |
|                |       | 4) Path boundary enforcement (not advisory — engine validates after)    |
|                |       | 5) Fingerprinted approval gates (changing any artifact breaks approval) |
|                |       | 6) Done gate requires evidence (agent CANNOT self-declare complete)     |
|                |       | 7) Architecture Dossier as SDK-doc-style reference before code          |
|                |       | The bet: AI sub-agents are a distributed systems problem, not a         |
|                |       | workflow problem. No competitor frames the problem this way.            |
| Aider          |  7/10 | Repo maps (tree-sitter) solve context-window scale uniquely. Architect/ |
|                |       | editor cost-splitting is clever. Defensible for brownfield/large repos. |
| OpenHands      |  8/10 | Full OS sandbox + SWE-bench SOTA. Cloud-native autonomous execution.    |
|                |       | Accessible to non-local setups. Real differentiation.                  |
| Cline          |  7/10 | MCP consumer ecosystem + checkpoint/restore. First-class MCP support    |
|                |       | before anyone else. Defensible via ecosystem moat.                     |
| SWE-Agent      |  6/10 | ACI (agent-computer interface) abstraction is a real idea. But the      |
|                |       | value prop is academic, not product. Hard to defend commercially.       |
| Continue.dev   |  6/10 | Multi-IDE + context provider ecosystem. Tab autocomplete quality.       |
|                |       | Strong in the assistant category, weak as an autonomous agent.          |
| Devin          |  8/10 | Persistent cross-session memory + CI/CD integration. Closest to         |
|                |       | "autonomous software engineer" vision. Commercial moat.                |
| Cursor         |  8/10 | Shadow workspace + native IDE feel + multi-file agent + best code       |
|                |       | completion in the field. Strong network effects from tab autocomplete.  |
| bolt.new       |  7/10 | WebContainer (browser-native full-stack runtime) is a genuine          |
|                |       | technical moat. Zero-setup accessibility is defensible.                |

WINNER: Make It Real (9/10) for the specific domain of multi-module parallel AI development
        with contract enforcement. OpenHands/Devin/Cursor (8/10) for broader autonomy.
MIR VERDICT: WIN — the contract-first + path-enforcement + DAG-gate combination is
             genuinely unique. No competitor is even attempting this design.

---

## DIMENSION 5: PRODUCTION READINESS
(Can a real team ship with this today? Missing features? Known failure modes?)

| Competitor     | Score | Rationale                                                               |
|----------------|-------|-------------------------------------------------------------------------|
| Make It Real   |  6/10 | v0.1.46. Claude Code only. No persistent project memory (STATE.md gap). |
|                |       | No brownfield workflow. No multi-runtime. But: gates prevent bad states,|
|                |       | 433 tests, zero deps, structured evidence. Greenfield multi-module is   |
|                |       | genuinely production-usable today. Limited ecosystem.                   |
| Aider          |  8/10 | v0.x but very mature. Massive user base. Multi-LLM. Works on any        |
|                |       | codebase. Used in production by many teams today. Well documented.      |
| OpenHands      |  7/10 | Docker requirement and complexity. But enterprise features exist.        |
|                |       | SWE-bench results suggest real capability. Growing fast.                |
| Cline          |  8/10 | VSCode production-ready. Widely used by developers daily. Checkpoint    |
|                |       | reduces risk. Active maintenance. Good for individual/small team use.   |
| SWE-Agent      |  4/10 | Research tool. Not designed for team workflows. No UI. Hard to debug.   |
|                |       | Benchmark results don't translate to team productivity.                 |
| Continue.dev   |  8/10 | Production-ready IDE assistant. Stable, multi-IDE, open source, active. |
|                |       | But not an autonomous agent — different tool category.                  |
| Devin          |  8/10 | Commercial product, paid support, real customers. But $500/month, cloud-|
|                |       | only, known failures on complex multi-file architecture tasks.           |
| Cursor         |  9/10 | Most widely adopted by professional developers. Stable, fast, familiar. |
|                |       | Subscription required but affordable. Works today for any team.         |
| bolt.new       |  7/10 | Great for web prototypes and demos. Not suitable for complex backend     |
|                |       | systems, native dependencies, or enterprise deployment requirements.     |

WINNER: Cursor (9/10) | Runner-up: Aider / Cline / Continue.dev / Devin (8/10)
MIR VERDICT: LOSS — v0, Claude Code only, no persistent memory, no brownfield workflow.
             Real teams can use it for greenfield multi-module work today but
             the ecosystem and maturity gap is real.

---

## FINAL SCOREBOARD

| Competitor     | Dim 1 | Dim 2 | Dim 3 | Dim 4 | Dim 5 | TOTAL | Rank |
|----------------|-------|-------|-------|-------|-------|-------|------|
| Make It Real   |   9   |   9   |   7   |   9   |   6   |  40   |  2nd |
| Cursor         |   7   |   7   |   9   |   8   |   9   |  40   |  2nd |
| Aider          |   7   |   7   |   9   |   7   |   8   |  38   |  4th |
| Cline          |   5   |   6   |   8   |   7   |   8   |  34   |  5th |
| OpenHands      |   6   |   7   |   7   |   8   |   7   |  35   |  5th |
| Devin          |   7   |   6   |   9   |   8   |   8   |  38   |  4th |
| Continue.dev   |   6   |   6   |   9   |   6   |   8   |  35   |  5th |
| bolt.new       |   5   |   6   |   9   |   7   |   7   |  34   |  5th |
| SWE-Agent      |   5   |   7   |   4   |   6   |   4   |  26   |  9th |

Note: Cursor and Make It Real tie at 40 total, but in DIFFERENT CATEGORIES.
Cursor wins the "ship code fast for teams" category.
Make It Real wins the "multi-agent distributed systems correctness" category.
These are not the same tournament bracket.

---

## CATEGORY WINS AND LOSSES

Make It Real WINS:
  1. STRUCTURAL INTEGRITY — only tool with enforced state machine + zero-dep
     discipline + 433 tests covering all gate paths.
  2. ARCHITECTURE DESIGN — LLM/engine boundary clarity, quiet hooks,
     read-only dossier, flat typed schemas are best in class.
  3. UNIQUE VALUE PROPOSITION — machine-checkable contracts + DAG enforcement
     + path boundaries is genuinely unique. Nobody else is doing this.

Make It Real LOSES:
  1. DEVELOPER EXPERIENCE — deliberate. The ceremony is the product. Tools
     optimized for simplicity (Cursor, bolt.new, Aider) will always win
     here for tasks that don't need the ceremony.
  2. PRODUCTION READINESS — v0, Claude Code only, no brownfield workflow,
     no persistent memory between runs. This is the honest gap.

---

## THE FINAL VERDICT

Make It Real is not competing in the same race as Cursor, Aider, or bolt.new.
It is the only tool in the field that treats AI multi-agent development as a
distributed systems problem — with contracts, claims, leases, gates, and evidence.

The correct category is:

  CORRECTNESS-FIRST MULTI-MODULE GREENFIELD DEVELOPMENT

In that category, Make It Real has NO real competitor. The closest is OpenHands
(full OS sandbox + multi-agent) but it does not do contract enforcement or
DAG-scheduled path boundaries.

The honest ranking for the full field:

  #1  Cursor         — best overall for professional developer teams
  #2  Make It Real   — best for correctness-critical multi-agent greenfield
  #2  Devin          — best autonomous commercial SaaS
  #4  Aider          — best terminal-native, best for brownfield/large repos
  #4  Cline          — best MCP-native VSCode experience
  #6  OpenHands      — best for SWE-bench class autonomous tasks
  #6  Continue.dev   — best IDE assistant (different category really)
  #6  bolt.new       — best for prototypes and zero-setup web apps
  #9  SWE-Agent      — academic excellence, not a team development tool

The bet Make It Real is making — contracts must be machine-checkable, boundaries
must be enforced (not requested), and Done must mean gates passed (not "the agent
said so") — is a real and defensible bet. If that bet is right, Make It Real is
not in second place. It's in a category of one.

---

## WHAT MAKE IT REAL SHOULD DO NEXT

To close the production readiness gap and become undeniably first:

  1. Persistent project memory (STATE.md / CONTEXT.md equivalent) — GSD has
     this; MIR doesn't. Brownfield re-grounding would unlock a huge use case.
  2. Multi-runtime support — Codex, Gemini, Cursor. The engine is runtime-
     agnostic; the plugin wrapper is Claude Code only. This is a distribution
     problem, not an architecture problem.
  3. Brownfield workflow entry point — an explicit "I have existing code, map
     it into a blueprint" command alongside /mir:plan for new systems.
  4. v1.0 release milestone — 433 tests and zero deps are v1.0 quality.
     The version number is underselling the structural integrity.
  5. Community channels — Discord, npm package, Anthropic marketplace.
     GSD at v1.42.1 has a community; MIR at v0.1.46 doesn't yet.

---

Scorecard produced by: Hermes Agent (Nous Research)
Tournament: 신룣 Grand Tournament (천무대전), Round 1
Judgment basis: Local code inspection (MIR) + trained knowledge of competitors
Evidence: /Users/eugene/Workspace/52g-tools/dev-harness/** (433 tests, 0 fail)
