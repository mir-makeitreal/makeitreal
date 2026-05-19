# How Make It Real compares to other Claude Code workflows

An honest comparison of Make It Real (MIR) against the alternatives developers actually reach for. We've read the source of every competitor in this table. If something here is wrong about one of them — especially something we've marked ❌ or ⚠️ that they actually do well — open an issue.

## What we compared

| Tool | What it is | Source |
|------|------------|--------|
| **Make It Real** | Claude Code plugin: contract-first Blueprint + DAG-scheduled sub-agents + Kanban gates | this repo |
| **Vanilla Claude Code** | Claude Code with no plugin, no scaffolding — just chat + tools | Anthropic |
| **Superpowers** | Zero-dep markdown skills plugin: composable skills library (brainstorm → plan → TDD → review) | [obra/superpowers](https://github.com/obra/superpowers) |
| **Spec Kit** | Python CLI for spec-driven development: `/speckit.constitution` → `specify` → `plan` → `tasks` → `implement` | [github/spec-kit](https://github.com/github/spec-kit) |
| **GSD (Get Shit Done)** | Node.js task management skill pack: 6-command loop (new-project → discuss → plan → execute → verify → ship) | [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) |

## Feature matrix

Legend: ✅ first-class · ⚠️ partial / opt-in · ❌ not built in

| Feature | Make It Real | Vanilla CC | Superpowers | Spec Kit | GSD |
|---|---|---|---|---|---|
| **Architecture-first** (design before code) | ✅ Blueprint required, fingerprinted approval gate blocks code | ❌ | ✅ `brainstorming` + `writing-plans` skills | ✅ `/speckit.specify` + `/speckit.plan` before `/speckit.implement` | ✅ Discuss + plan phases before execute |
| **Contract enforcement** (machine-checkable interfaces) | ✅ OpenAPI + module-surface contracts frozen, fingerprinted, generate conformance tests | ❌ | ❌ Plans are prose, not enforceable | ⚠️ Plan step emits `contracts/`, but they're docs — no runtime conformance check | ❌ |
| **Parallel sub-agents** | ✅ DAG-scheduled with claims/leases + per-agent path policy | ⚠️ Manual `Task` tool, no scheduler | ✅ `dispatching-parallel-agents` skill | ⚠️ `[P]` markers in `/speckit.tasks` are hints; most agents execute serially | ✅ "Parallel waves" with fresh-context executors |
| **Quality gates** (refusable before "done") | ✅ Ready gate + Done gate + evidence audit, transitions enforced by engine | ❌ | ⚠️ `verification-before-completion` skill, advisory | ⚠️ `/speckit.analyze` advisory | ✅ Verify step + diagnosed fix plans (advisory) |
| **Interactive dashboard** | ✅ Local HTML dashboard (Kanban lanes + DAG + live evidence) | ❌ | ❌ | ❌ | ❌ |
| **Recursive decomposition** (agents spawn sub-agents) | ✅ `Decomposing` lane is a first-class Kanban state | ⚠️ Manual | ⚠️ `subagent-driven-development` skill dispatches fresh agents per task | ❌ | ⚠️ Executors spawn researchers/planners; no formal recursion |
| **Install complexity** (one-command?) | ✅ `/plugin install makeitreal@52g` | ✅ Already installed | ✅ `/plugin install superpowers` | ❌ Requires `uv` + Python 3.11 + `specify init` | ✅ `npx get-shit-done-cc` |
| **Runtime dependencies** | ✅ **Zero** (vendored Node) | ✅ None (built in) | ✅ None (pure markdown) | ❌ Python toolchain + `uv` | ⚠️ Node only |

## Where each tool actually wins

### Vanilla Claude Code

**Wins on**: simplicity, zero install, full control, lowest latency. For a single-file change, a throwaway script, or exploring an idea, nothing beats no plugin. The `Task` tool gives you manual parallelism when you want it.

**Where it falls short**: no architecture phase, no contracts, no scheduler, no boundaries, no gates, no dashboard. This is the failure mode the architecture-first tools exist to address — agents start coding before they understand the system, and integration is left to hope.

### Superpowers (obra/superpowers)

**Wins on**: zero dependencies, philosophy, multi-runtime reach. Superpowers is the most polished "process-as-skills" library. The whole plugin is markdown — skills as files, no installer, no runtime. It runs on Claude Code, Codex, Gemini, Cursor, Copilot CLI, OpenCode, and Factory Droid from the same files. The TDD skill is strict ("RED-GREEN-REFACTOR; deletes code written before tests"), and `dispatching-parallel-agents` is genuinely good at fanning work out.

**Where MIR is different**: Superpowers' artifacts are plans and design notes in prose; tests are written by an agent from the plan. There's no machine-checkable contract layer, no Kanban state machine, no boundary enforcement, no dashboard. If your failure mode is "agents wander off scope and step on each other," Superpowers slows them down with process but doesn't prevent it with structure.

**Where Superpowers is honestly ahead of MIR**: multi-runtime support (MIR is Claude Code only), zero-dep markdown-only distribution (lighter than any plugin shipping code), and Anthropic-marketplace presence with a real community.

### Spec Kit (github/spec-kit)

**Wins on**: institutional weight, extensions/presets, integration breadth (30+ agents). Spec Kit is the most "enterprise-shaped" of the lot. `/speckit.constitution` → `specify` → `clarify` → `plan` → `tasks` → `analyze` → `implement` is a serious workflow with cross-artifact consistency checks. The constitution layer is a real idea — org-level rules that propagate into every spec.

**Where MIR is different**: Spec Kit's `contracts/` directory is documents the implementer reads, not artifacts a conformance harness runs against. The `[P]` parallel markers on tasks are hints — most agents execute them serially. There's no DAG runtime, no `allowedPaths` boundary policy, no dashboard. Spec Kit is excellent for the spec-and-plan phase and weaker on enforcing what came out of it.

**Where Spec Kit is honestly ahead of MIR**: multi-runtime support, constitution/extension model, mature brownfield workflow. Where it's behind: Python + `uv` install is heavier than a plugin install, and the "contracts" don't actually constrain execution.

### GSD (Get Shit Done)

**Wins on**: developer ergonomics, context engineering, persistent memory, parallelism that actually parallelizes. GSD is the closest competitor in spirit. It's a six-command loop with fresh-context subagents, atomic commits per task, and an explicit verify step with diagnosed fix plans. The `PROJECT.md` / `STATE.md` / `CONTEXT.md` memory model is **genuinely better than what MIR persists today** — it survives session boundaries and re-grounds the agent on each run. MIR stores per-run artifacts under `.makeitreal/runs/<id>/` but doesn't yet have a first-class "what does this project look like" memory layer.

**Where MIR is different**: GSD doesn't extract or freeze contracts, doesn't generate conformance tests from contracts, has no path-boundary enforcement, and has no dashboard. Its parallelism is a "wave" of executors with fresh context; MIR's is a DAG with claims/leases, gate transitions, and per-agent path policies. GSD's verify step is a manual walk-through; MIR's verification is automated against contracts plus a Ready/Done gate audit.

**Where GSD is honestly ahead of MIR**: better persistent project memory, more polished installer, multi-runtime support (Claude, Codex, OpenCode, Copilot, Cursor, Windsurf, Gemini, Kilo), more mature release cadence (v1.42.1 vs MIR's v0.1.46). If you want speed and clean context without ceremony, GSD will feel lighter than MIR.

## The Make It Real bet

The bet MIR is making — and that the alternatives mostly aren't — is that **AI sub-agents are a distributed systems problem, not a workflow problem**. Three claims fall out of that:

1. **Contracts must be machine-checkable, not just documented.** A plan that says "the auth module exposes `login(email, password) -> Session`" is a hope. An OpenAPI spec or typed module surface paired with a generated conformance test is a contract. MIR generates the second; the others stop at the first.
2. **Boundaries must be enforced, not requested.** Telling an agent "only touch `src/auth/**`" is a prompt. Validating after the run that no file outside `allowedPaths` was modified is enforcement. MIR does the second.
3. **Done means gates passed, not "the agent said so."** The Ready gate (PRD trace + contract completeness + boundaries + verify plans) and the Done gate (evidence + wiki sync) are explicit and refusable by the engine. The agent can't self-declare completion.

If you don't believe those claims matter for your work, MIR is over-engineered for you and GSD or Superpowers will feel lighter.

## Where Make It Real is honestly behind

- **Persistent project memory.** GSD's `STATE.md` / `CONTEXT.md` model beats what MIR persists between runs.
- **Multi-runtime support.** Superpowers, Spec Kit, and GSD all run on Codex, Gemini, Cursor, etc. MIR is Claude Code only.
- **Brownfield workflows.** GSD's `/gsd-map-codebase`, Spec Kit's brownfield phase, and Superpowers' worktree skill all have explicit "you already have code" entry points. MIR's Blueprint generation works on existing code but isn't optimized for re-grounding on a large legacy codebase.
- **Community & maturity.** Superpowers has Anthropic's official marketplace. GSD has Discord + npm downloads at v1.42.1. MIR is v0.1.46.
- **Installer polish.** GSD's single `npx` and Spec Kit's interactive `specify init` are more battle-tested than MIR's plugin install across edge cases.

The places MIR is ahead — contract-first artifacts, DAG-scheduled parallelism with path enforcement, gate-enforced state transitions, visual dashboard with live evidence — are real, but they buy correctness at the cost of ceremony. That's a trade.

## When to use what

| Your situation | Best fit |
|----------------|----------|
| Greenfield, complex, multi-module system you want correct the first time | **Make It Real** |
| Small task, single-file change, exploring an idea | **Vanilla Claude Code** |
| You want strict process (TDD, code review, plans) across multiple AI runtimes, zero install footprint | **Superpowers** |
| You're in an org that needs a constitution, traceable specs, and extension points | **Spec Kit** |
| Solo dev, "just ship it," want clean context and parallel execution without ceremony | **GSD** |
