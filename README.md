[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [中文](README.zh.md)

<div align="center">

# Make It Real

**Make It Simple. Make It Work. Make It Real.**

*Write your product docs first. Claude Code builds exactly what you specified.*

<p>
  <img src="https://img.shields.io/badge/tests-424-brightgreen" alt="424 tests" />
  <img src="https://img.shields.io/badge/dependencies-0-lightgrey" alt="zero deps" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
  <img src="https://img.shields.io/badge/node-%E2%89%A520-blue" alt="node ≥20" />
</p>

<p>
  <a href="#60-second-quickstart">Try it</a> ·
  <a href="#the-docs-first-philosophy">Philosophy</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#before--after">Before / After</a> ·
  <a href="docs/README.md">Docs</a>
</p>

</div>

---

Most AI coding tools start with the code. Make It Real starts with the docs.

You write what the product **should** be — goals, interfaces, acceptance criteria, module boundaries. Make It Real freezes those as machine-checkable contracts, then dispatches parallel Claude sub-agents that can only implement what the docs describe. When the agents finish, the code and the docs are in sync by construction.

---

## 60-Second Quickstart

No install. No API keys. Clone and run a demo:

```bash
git clone https://github.com/mir-makeitreal/makeitreal && cd makeitreal
node bin/harness.mjs demo rest-api --pretty
```

That generates a full architecture blueprint — PRD, contracts, work-item DAG, interactive dashboard — into a temp directory. Open it:

```bash
# the path is printed in the demo output under "runDir"
open <runDir>/preview/index.html
```

Inside Claude Code, one command does the same thing:

```
/mir:demo rest-api
```

Three demo templates: `todo-app` (simple) · `rest-api` (medium) · `auth-system` (complex).

---

## The Docs-First Philosophy

Most teams write docs **after** the code. They document what was built, not what should be built. The result: docs that drift, specs that lie, and integrations that surprise.

Make It Real inverts this. **The docs are the source of truth.** Code is just the proof that the docs are correct.

```
Traditional:  request → code → (maybe) docs → tests catch surprises
Make It Real: request → docs → frozen contracts → code proves docs → no surprises
```

This isn't just a better workflow for developers. It's a shared language for **everyone** on the team:

- **PMs** write acceptance criteria that become automated gates — not Jira tickets that get forgotten
- **Architects** define module boundaries that sub-agents literally cannot cross
- **Engineers** implement against contracts they didn't write, knowing the interface is already proven
- **Reviewers** approve a blueprint, not a diff — before a single line of code is written

The spec is the test. The contract is the interface. The docs and the code are always in sync.

---

## How It Works

```mermaid
flowchart LR
    A["You describe\nwhat you want"] --> B["Engine blueprints\nthe system"]
    B --> C["You review\n& approve"]
    C --> D["Contracts\nfrozen ❄️"]
    D --> E1["Sub-agent A\nsrc/auth/**"]
    D --> E2["Sub-agent B\nsrc/session/**"]
    D --> E3["Sub-agent C\nsrc/api/**"]
    E1 --> F["Contract conformance\nverified ✓"]
    E2 --> F
    E3 --> F
    F --> G["Done — docs\nand code in sync"]
```

**Step 1 — You describe what you want.**
One sentence, a feature request, or a full spec. The intake system asks focused clarifying questions until it has enough to generate a reviewable plan.

**Step 2 — The engine blueprints the system.**
Before any code: a PRD with acceptance criteria, an architecture with module boundaries, OpenAPI contracts for every interface, a dependency graph (DAG) for all work items, and an interactive dashboard. All cross-validated.

**Step 3 — You review and approve.**
Read the blueprint. Ask for changes. The approval is fingerprinted — if any artifact changes afterward, the gate blocks until you re-approve. No silent drift.

**Step 4 — Contracts are frozen.**
Every interface between modules is now immutable. Sub-agents receive their contracts as input. They know exactly what they must implement and what they can depend on.

**Step 5 — Sub-agents build in parallel.**
Each agent owns one responsibility unit, implements against frozen contracts, and is physically prevented from touching files outside its declared paths. An agent assigned `src/auth/**` cannot edit `src/database/schema.ts` — the hook rejects the write.

**Step 6 — Gates enforce completion.**
The Done gate runs verification commands. There is no self-declaring "done." An agent must prove conformance to its contracts. Evidence is written to disk.

Full walkthrough: [docs/how-it-works.md](docs/how-it-works.md)

---

## Before / After

The same request — "build a 4-module auth system" — with and without Make It Real:

| | Without Make It Real | With Make It Real |
|---|---|---|
| **Planning** | Starts coding immediately | Blueprint generated first: PRD, module map, contracts, DAG. You approve before a line of code is written. |
| **Boundaries** | One agent touches everything. Auth calls into the DB layer. | Each sub-agent has `allowedPaths`. The hook **rejects** writes outside the declared module. |
| **Contracts** | Hope modules fit together at the end | OpenAPI specs and typed interfaces are frozen before implementation. Sub-agents implement against them. |
| **Parallelism** | Sequential, or `Task` calls that step on each other | DAG-scheduled sub-agents with claims, leases, and retry. Dependency order enforced. |
| **Integration** | "Works on my branch" → merge conflicts | Contract conformance at the unit level proves integration. No separate integration phase. |
| **Evidence** | "I think it's done" | Structured verification evidence for every work item. The Done gate blocks until proof exists. |
| **Docs–code sync** | Docs drift within days | Docs are the source of truth. Code is the proof. They can't diverge. |

---

## Three Commands to Know

| Command | What it does |
|---------|-------------|
| `/mir:plan "your request"` | Generate a blueprint. PRD, architecture, contracts, DAG, dashboard. Review and approve inline. |
| `/mir:launch` | Execute the approved blueprint. Dispatches sub-agents in DAG order through the gated loop. |
| `/mir:status` | Current phase, work-item states, blockers, dashboard URL. |

That's the core loop: **plan → launch → status**.

Every `/mir:` command has a `/makeitreal:` equivalent for those who prefer the full name. Power-user commands: [docs/command-reference.md](docs/command-reference.md)

---

## What Gets Generated

```
.makeitreal/runs/<run-id>/
├── prd.json                    # Goals, acceptance criteria, non-goals
├── design-pack.json            # Architecture topology, APIs, module interfaces
├── responsibility-units.json   # Ownership boundaries with allowed file paths
├── work-item-dag.json          # Dependency graph with contract-typed edges
├── blueprint-review.json       # Approval status, fingerprint, reviewer identity
├── contracts/
│   ├── auth-api.openapi.json   # OpenAPI 3.x with schemas and examples
│   └── session-store.json      # Typed module surface signatures
├── work-items/                 # Per-item tasks with verification commands
├── evidence/                   # Contract conformance + wiki sync evidence
├── preview/
│   └── index.html              # Interactive dashboard — board, DAG, contracts
└── board.json                  # Kanban state for all work items
```

Every artifact cross-references the others. The engine validates all references bidirectionally — orphaned traces and dangling contract edges are caught at the Ready gate, before any agent runs.

---

## Why It Works

**433 tests. Zero dependencies.**

The engine is pure Node.js validation logic. No network calls, no API keys, no external services. It runs inside Claude Code's runtime, offline, at zero marginal cost.

**Contracts aren't documentation. They're enforcement.**

A contract is an OpenAPI 3.x specification or a typed module surface. The engine validates completeness at generation time: every path has an operation, every operation has an `operationId`, every non-GET endpoint has a request body schema, every success response has a JSON schema, every error case is declared. When a sub-agent's tests pass, it has proven it implements the contract. Integration isn't a separate phase — it falls out of conformance.

**Path boundaries aren't suggestions. They're enforced by a hook.**

The `PreToolUse` hook intercepts every `Write` and `Edit` call from a sub-agent and checks the target path against `allowedPaths`. An agent that steps outside its declared boundary fails immediately — not at code review, not at merge time.

**Approval fingerprinting prevents silent drift.**

The blueprint fingerprint is a SHA-256 of all artifacts. If a contract changes after approval — even one character — the Ready gate rejects the run and demands re-approval. There is no way to start implementation against a blueprint you didn't review.

Read more: [Contracts](docs/concepts/contracts.md) · [Responsibility Units](docs/concepts/responsibility-units.md) · [Blueprints](docs/concepts/blueprints.md) · [Orchestration](docs/concepts/orchestration.md)

---

## Compared to Alternatives

| | Make It Real | Vanilla Claude Code | Superpowers | Spec Kit | GSD |
|---|:---:|:---:|:---:|:---:|:---:|
| Architecture before code | ✅ | ❌ | ✅ | ✅ | ✅ |
| Machine-checkable contracts | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| Contract-to-test generation | ✅ | ❌ | ❌ | ❌ | ❌ |
| DAG-scheduled parallel agents | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
| Path boundary enforcement (hook) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Approval fingerprinting | ✅ | ❌ | ❌ | ❌ | ❌ |
| Quality gates (engine-enforced) | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ |
| Interactive dashboard | ✅ | ❌ | ❌ | ❌ | ❌ |
| Zero runtime deps | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| Docs–code sync guarantee | ✅ | ❌ | ❌ | ⚠️ | ❌ |

⚠️ = partial or optional · Full honest comparison: [docs/comparison.md](docs/comparison.md)

---

## Requirements

- Claude Code (latest)
- Node.js ≥ 20

---

## Contributing

Found a bug? Have an idea? [Open an issue](https://github.com/mir-makeitreal/makeitreal/issues).

```bash
git clone https://github.com/mir-makeitreal/makeitreal && cd makeitreal
node --test          # runs all 433 tests, ~12s
```

No build step. No dependencies to install. Clone and test.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. The key rule: **every change must be documented first.** If you can't write the docs for a feature, the feature isn't ready to be built.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**[Get started →](docs/getting-started.md)**
&nbsp;&nbsp;·&nbsp;&nbsp;
[Read the docs](docs/README.md)
&nbsp;&nbsp;·&nbsp;&nbsp;
[Report an issue](https://github.com/mir-makeitreal/makeitreal/issues)

*Write the docs. Then make it real.*

</div>
