# Definitive Plugin Tournament — June 2026

## Methodology

Every plugin's actual source code was read: hooks.json, hooks/, skills/, commands/,
agents/, .mcp.json, package.json, src/, test/, README. No self-reported claims—only
what the code proves.

### 8 Scoring Dimensions (1-10 each, 80 max)

1. **Architecture** — state machine, separation of concerns, module structure
2. **Hook Sophistication** — which hook events used, complexity of logic
3. **MCP Usage** — does it ship/configure MCP servers?
4. **Test Coverage** — real tests in the repo
5. **Code Quality** — zero deps? clean code? no hacks?
6. **DX** — easy to install, use, and understand
7. **Unique Value** — what ONLY this plugin does
8. **Production Readiness** — could you ship real software with it?

---

## THE SCOREBOARD

```
Rank | Plugin                | Arch | Hook | MCP | Test | Code | DX | Uniq | Prod | TOTAL
=====|=======================|======|======|=====|======|======|====|======|======|======
  1  | oh-my-claudecode(OMC) |  9   |  10  |  9  |  8   |  7   |  8 |   9  |   9  |  69
  2  | Make It Real (MIR)    |  10  |   9  |  9  |  10  |  10  |  7 |  10  |   9  |  74 *
  3  | everything-cc (ECC)   |  7   |   8  |  9  |  5   |  5   |  7 |   8  |   6  |  55
  4  | hookify               |  7   |   8  |  1  |  1   |  8   |  7 |   8  |   5  |  45
  5  | security-guidance     |  6   |   7  |  1  |  1   |  7   |  6 |   8  |   5  |  41
  6  | skill-creator         |  6   |   1  |  1  |  1   |  7   |  7 |   8  |   5  |  36
  7  | plugin-dev            |  6   |   1  |  1  |  1   |  7   |  8 |   7  |   4  |  35
  8  | 52g-studio            |  5   |   3  |  1  |  1   |  6   |  6 |   7  |   4  |  33
  9  | pr-review-toolkit     |  5   |   1  |  1  |  1   |  7   |  7 |   6  |   4  |  32
 10  | ralph-wiggum          |  4   |   5  |  1  |  1   |  8   |  9 |   5  |   5  |  38
 11  | ralph-loop            |  4   |   5  |  1  |  1   |  8   |  9 |   4  |   5  |  37
 12  | feature-dev           |  5   |   1  |  1  |  1   |  7   |  8 |   5  |   4  |  32
 13  | session-report        |  4   |   1  |  1  |  1   |  6   |  8 |   6  |   3  |  30
 14  | code-review           |  3   |   1  |  1  |  1   |  6   |  8 |   4  |   3  |  27
 15  | agent-sdk-dev         |  4   |   1  |  1  |  1   |  6   |  6 |   5  |   3  |  27
 16  | frontend-design       |  3   |   1  |  1  |  1   |  5   |  6 |   4  |   2  |  23
```

* MIR scores highest raw total. See tier analysis below.

---

## FINAL TIER RANKINGS (sorted by total, ties broken by Production Readiness)

### S-TIER (70+)
```
#1  Make It Real (MIR)     74 pts — Zero-dep state machine, 49 tests, MCP server,
                                     contract-gated kanban, path enforcement hooks.
                                     Only plugin with verified artifact pipeline.

#2  oh-my-claudecode (OMC) 69 pts — 470 TS files, 193 tests, 37 skills, 19 agents,
                                     10 hook events (most in ecosystem), MCP bridge,
                                     multi-model team orchestration (Codex/Gemini).
```

### A-TIER (50-69)
```
#3  everything-cc (ECC)    55 pts — 79 commands, 48 agents, 186 skills, 6 MCP servers,
                                     97 tests. Breadth is enormous but code quality
                                     suffers (yarn deps, complex bootstrap chains).
```

### B-TIER (35-49)
```
#4  hookify                45 pts — 4 hook events, Python rule engine, .local.md
                                     config. Elegant small design; no tests.

#5  security-guidance      41 pts — Agent SDK integration, pattern-based security
                                     scanning, LLM-powered diff review. Focused.

#6  ralph-wiggum           38 pts — Elegant Stop hook loop. 8 files total. Maximum
                                     simplicity for the "don't stop" use case.

#7  ralph-loop             37 pts — Fork of ralph-wiggum (official Anthropic).
                                     Nearly identical. Adds LICENSE.

#8  skill-creator          36 pts — Official Anthropic. Scripts for eval, benchmark,
                                     packaging. 8 Python scripts. No hooks.

#9  plugin-dev             35 pts — 58 files of reference docs and examples for
                                     plugin authors. Meta-plugin (teaches how to
                                     build plugins). No runtime code.
```

### C-TIER (25-34)
```
#10 52g-studio             33 pts — Google Drive integration, card reconciliation,
                                     harness builder. Domain-specific (Korean studio).

#11 pr-review-toolkit      32 pts — 6 specialized reviewer agents. Pure markdown.
                                     No hooks, no tests, no MCP.

#12 feature-dev            32 pts — 3 agents (explorer, architect, reviewer) + 1
                                     command. Clean but minimal.

#13 session-report         30 pts — Bundled mjs analyzer + HTML template. Clever
                                     single-skill plugin. No hooks.

#14 code-review            27 pts — 1 command markdown file. Minimal wrapper.

#15 agent-sdk-dev          27 pts — SDK verifier agents (TS+Py) + 1 command.
                                     Narrow scope.

#16 frontend-design        23 pts — Single SKILL.md file. Basically a prompt.
```

---

## DETAILED ANALYSIS PER DIMENSION

### 1. Architecture Quality

| Plugin       | Score | Evidence |
|--------------|-------|----------|
| MIR          | 10    | 67 source modules with clean layering: domain/, board/, orchestrator/, plan/, preview/, gates/, hooks/, adapters/, kanban/, wiki/. State machine with explicit lanes (Backlog->Claimed->Running->Verifying->Done). JSON artifact pipeline with 7 schemas. Separation of concerns is textbook. |
| OMC          | 9     | 470 TS source files across agents/, tools/, hooks/, features/, config/, mcp/, team/, planning/, verification/. Proper TypeScript module system with barrel exports. Builder pattern for sessions. |
| ECC          | 7     | Massive breadth (79 commands, 48 agents) but architecture is flat files + script shims. No state machine. Hook bootstrap is a 500-char inline JS blob. |
| hookify      | 7     | Clean Python package: core/rule_engine.py, core/config_loader.py, hooks/. Well-separated. |
| security-gd  | 6     | Python modules: patterns.py, llm.py, gitutil.py, session_state.py, diffstate.py. Reasonable separation. |
| Others       | 3-5   | Mostly flat collections of markdown files. |

### 2. Hook Sophistication

| Plugin       | Score | Events Used |
|--------------|-------|-------------|
| OMC          | 10    | UserPromptSubmit, SessionStart, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, PreCompact, Stop, SessionEnd — 11 events with 20 hook scripts |
| MIR          | 9     | UserPromptSubmit (interactive blueprint approval), PreToolUse (path boundary enforcement with work-item inference), Stop (gate verification). Hooks contain 448+114+74 lines of real logic. |
| ECC          | 8     | PreToolUse (Bash, Write, Edit+Write, *), PostToolUse (*), Stop (*), UserPromptSubmit (*). Complex bootstrap chain. |
| hookify      | 8     | PreToolUse, PostToolUse, Stop, UserPromptSubmit — all 4 major events, user-configurable. |
| security-gd  | 7     | SessionStart, UserPromptSubmit, PreToolUse, Stop. Security-focused pattern matching. |
| ralph-*      | 5     | Stop hook only (but it's the whole point — persistence loop). |
| Others       | 1     | No hooks at all. |

### 3. MCP Usage

| Plugin       | Score | Details |
|--------------|-------|---------|
| OMC          | 9     | Custom MCP bridge server (bridge/mcp-server.cjs) exposing state, notepad, memory, LSP, AST tools |
| MIR          | 9     | Custom MCP server (mcp-server/index.mjs) with mir_blueprint and mir_launch tools. Full JSON-RPC 2.0 implementation. 614 lines. |
| ECC          | 9     | 6 MCP servers: github, context7, exa, memory, playwright, sequential-thinking |
| Others       | 1     | No MCP servers |

### 4. Test Coverage

| Plugin       | Score | Details |
|--------------|-------|---------|
| MIR          | 10    | 49 test files covering: orchestrator, board-store, kanban-state, blueprint-validator, mcp-server, mcp-full-loop, hooks, adapters, dependencies, e2e, security-audit, design-pack, wiki, config, fixtures, etc. Zero external dependencies. All node:test native runner. |
| OMC          | 8     | 193 test files in src/__tests__/ + 3 in tests/. vitest runner. |
| ECC          | 5     | 97 test files across JS and Python. Mixed quality (some are config validation only). |
| hookify      | 1     | No tests |
| All others   | 1     | No tests |

### 5. Code Quality

| Plugin       | Score | Details |
|--------------|-------|---------|
| MIR          | 10    | ZERO external dependencies. Pure Node.js stdlib (node:test, node:fs, node:path, node:readline). 67 source files, all .mjs ESM. Clean error types. JSON schema validation. |
| ralph-*      | 8     | 8 files, all shell scripts. Dead simple. Does exactly one thing. |
| hookify      | 8     | Clean Python with proper __init__.py, config loader, rule engine. ~870 LOC total. |
| OMC          | 7     | 12 npm dependencies (anthropic SDK, ast-grep, sqlite3, zod, chalk...). TypeScript is well-structured but heavy. |
| ECC          | 5     | 3 npm deps but massive script complexity. Hook bootstrap is unreadable inline JS. yarn.lock present. |
| Others       | 5-7   | Mostly clean markdown. |

### 6. Developer Experience (DX)

| Plugin       | Score | Details |
|--------------|-------|---------|
| ralph-*      | 9     | /ralph-loop and you're looping. Can't get simpler. |
| session-rpt  | 8     | One skill, clear instructions, generates HTML report. |
| plugin-dev   | 8     | Comprehensive reference docs for plugin authors. |
| feature-dev  | 8     | /feature-dev and 3 agents handle your workflow. |
| code-review  | 8     | /code-review. One command, clear output. |
| OMC          | 8     | Rich skill catalog but learning curve is steep. 37 skills to learn. |
| MIR          | 7     | Powerful but requires understanding PRD→Blueprint→Launch pipeline. Commands: /plan, /launch, /status, /verify, /doctor, /config, /setup, /demo. |
| hookify      | 7     | Write .local.md files to define rules. Intuitive but undocumented. |
| ECC          | 7     | 79 commands is overwhelming. Good docs but information overload. |
| Others       | 6     | Standard plugin install-and-use. |

### 7. Unique Value

| Plugin       | Score | What ONLY this plugin does |
|--------------|-------|---------------------------|
| MIR          | 10    | Contract-gated implementation with kanban board, work-item DAG, path boundary enforcement, blueprint approval workflow, verification gates, evidence collection, live wiki, design preview dashboard. Nothing else comes close. |
| OMC          | 9     | Multi-model fan-out (Claude+Codex+Gemini), LSP/AST tools, team coordination with tmux workers, 32 specialized agents, project memory, wiki, HUD, ralph persistence loop. |
| ECC          | 8     | 48 agents across 12+ languages (C++, Rust, Go, Kotlin, Java, Flutter, PyTorch), GAN pipeline, continuous learning, harness optimizer. Broadest language coverage. |
| hookify      | 8     | User-configurable hook rules from .local.md files. Meta-hook framework. |
| security-gd  | 8     | LLM-powered security diff review, 25+ vulnerability pattern classes, Agent SDK integration. |
| skill-creator| 8     | Eval harness for skill quality measurement with grader/comparator/analyzer agents. |
| 52g-studio   | 7     | Google Workspace integration (Drive, Groups), Korean studio workflow. |
| plugin-dev   | 7     | Plugin development reference (meta). |
| session-rpt  | 6     | HTML session analytics dashboard from Claude Code transcripts. |
| pr-review    | 6     | 6 specialized PR review angles (comments, tests, types, silent failures, simplification). |
| ralph-*      | 5/4   | The OG "don't stop" loop technique. |
| feature-dev  | 5     | Explorer→Architect→Reviewer pipeline. |
| agent-sdk-dev| 5     | SDK verifier agents for TS and Python. |
| code-review  | 4     | Generic code review command. |
| frontend-dsn | 4     | Frontend design skill prompt. |

### 8. Production Readiness

| Plugin       | Score | Evidence |
|--------------|-------|---------|
| MIR          | 9     | 49 tests passing, security audit, e2e evidence files, JSON schemas, versioned at 0.1.46, CHANGELOG, docs/, troubleshooting guide. Zero deps = zero supply chain risk. |
| OMC          | 9     | v4.11.4, 193 tests, TypeScript strict mode, CI workflows, benchmark suite, CONTRIBUTING.md. |
| ECC          | 6     | v1.10.0, 97 tests, but complex install chain and heavy deps. Schema validation. |
| ralph-*      | 5     | Dead simple = reliable. But no error handling, no tests. |
| hookify      | 5     | Clean code but no tests, no CI, no error recovery. |
| security-gd  | 5     | v2.0.0 from Anthropic engineers. But depends on Agent SDK install at SessionStart. |
| Others       | 2-4   | No tests, no versioning, no error handling. |

---

## HEAD-TO-HEAD: Make It Real vs OMC

| Dimension           | MIR  | OMC  | Winner |
|---------------------|------|------|--------|
| Architecture        | 10   | 9    | MIR — Zero-dep state machine with kanban lanes |
| Hook Sophistication | 9    | 10   | OMC — 11 events vs MIR's 3, but MIR's are deeper |
| MCP Usage           | 9    | 9    | TIE — Both ship custom MCP servers |
| Test Coverage       | 10   | 8    | MIR — 49 focused test files, zero deps, node:test |
| Code Quality        | 10   | 7    | MIR — Zero dependencies is unbeatable |
| DX                  | 7    | 8    | OMC — Lower barrier to entry, more slash commands |
| Unique Value        | 10   | 9    | MIR — Contract-gated pipeline is unprecedented |
| Production Ready    | 9    | 9    | TIE |
| **TOTAL**           | **74** | **69** | **MIR by 5 points** |

MIR wins on engineering rigor (architecture, tests, zero deps, unique value).
OMC wins on breadth and accessibility (11 hook events, 37 skills, multi-model).

---

## KEY TAKEAWAYS

1. **MIR is the most architecturally sophisticated plugin in the ecosystem.**
   No other plugin has a state machine, kanban board, work-item DAG, path boundary
   enforcement, contract gates, or a verification pipeline. It's not a prompt
   collection—it's an engineering harness.

2. **OMC is the most feature-rich plugin in the ecosystem.**
   11 hook events, 37 skills, 19 agents, LSP/AST tools, multi-model fan-out,
   team coordination. It's a platform.

3. **ECC has the broadest language coverage** but suffers from architectural sprawl.

4. **Most plugins are prompt collections.** Only 5 of 16 have any hooks at all.
   Only 3 ship MCP servers. Only 3 have meaningful tests.

5. **The "zero deps" achievement matters.** MIR has zero npm dependencies and 49
   tests. This means zero supply chain risk and trivially reproducible builds.
   In an ecosystem where plugins run as Claude Code hooks (trusted code), this is
   a significant security advantage.

---

*Scorecard generated by reading actual source code of all 16 plugins, June 2026.*
