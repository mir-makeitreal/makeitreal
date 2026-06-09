# Make It Real — Documentation

Start here. Read in order if you're new, or jump to what you need.

## Getting Started

| Doc | What you'll learn |
|-----|-------------------|
| [Getting Started](getting-started.md) | Install → first blueprint → launch → monitor. The 5-minute walkthrough. |
| [How It Works](how-it-works.md) | Full visual pipeline: planning → review → gates → parallel execution → verification → done. |
| [Examples](examples.md) | Canonical fixture and example run artifacts you can inspect locally. |

## Core Concepts

Read these to understand *why* Make It Real works the way it does.

| Doc | What it covers |
|-----|---------------|
| [Blueprints](concepts/blueprints.md) | Architecture-first documents: PRD, design pack, responsibility boundaries. Generated before any code. |
| [Contracts](concepts/contracts.md) | OpenAPI specs and typed module surfaces that become machine-checkable conformance tests. The key differentiator. |
| [Responsibility Units](concepts/responsibility-units.md) | Ownership boundaries: `allowedPaths`, single-owner invariant, path overlap prevention. |
| [Orchestration](concepts/orchestration.md) | DAG scheduling, claims and leases, Ready/Done gates, retry with backoff, native Task dispatch. |

## Reference

| Doc | What it covers |
|-----|---------------|
| [Command Reference](command-reference.md) | Every CLI command with syntax, flags, and example output. Planning, execution, monitoring, configuration. |
| [Architecture](architecture.md) | Internal engine structure: plugin layer, domain modules, adapters, state management. |
| [Claude Code Runner](claude-code-runner.md) | How native Task sub-agents are launched, scoped, and verified. Runner modes and trust policy. |
| [Troubleshooting](troubleshooting.md) | The 10 most common `HARNESS_*` error codes, what triggers them, and how to fix them. |

## Comparison

| Doc | What it covers |
|-----|---------------|
| [Comparison](comparison.md) | Honest feature matrix: Make It Real vs Vanilla Claude Code, Superpowers, Spec Kit, GSD. Where each tool wins and loses. |

**New here?** Start with [Getting Started](getting-started.md), then read [Contracts](concepts/contracts.md) to understand the core idea. Everything else is reference.
