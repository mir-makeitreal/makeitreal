# Make It Real OMC-Style Command UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make Make It Real slash commands feel like OMC-style Claude Code workflows by hiding internal config keys and exposing semantic operator choices.

**Architecture:** Keep the engine deterministic and add only small semantic config profiles there. Put conversational UX, question UI, and presentation rules in the plugin command and skill markdown for both the canonical `makeitreal` plugin and the `mir` alias plugin.

**Tech Stack:** Node.js ESM, `node:test`, Markdown Claude Code plugin commands, Make It Real internal engine CLI.

---

## File Structure

- Modify `src/config/project-config.mjs`: add deterministic config profiles.
- Modify `bin/harness.mjs`: parse `config set --profile default|quiet`.
- Modify `plugins/makeitreal/dev-harness/src/config/project-config.mjs`: sync embedded engine copy.
- Modify `plugins/makeitreal/dev-harness/bin/harness.mjs`: sync embedded engine CLI copy.
- Modify `plugins/makeitreal/commands/config.md` and `plugins/mir/commands/config.md`: OMC-style config interaction.
- Modify `plugins/makeitreal/skills/config/SKILL.md` and `plugins/mir/skills/config/SKILL.md`: durable semantic config rules.
- Modify `plugins/*/commands/{status,doctor,verify,launch}.md` and `plugins/*/skills/{status,doctor,verify,launch}/SKILL.md`: primary-vs-diagnostic output rules.
- Modify `test/config.test.mjs`: profile behavior tests.
- Modify `test/makeitreal-plugin.test.mjs`: plugin UX contract tests.
- Modify `README.md` and `docs/architecture.md`: document the semantic command layer.

### Task 1: Add Deterministic Config Profiles

**Files:**
- Modify: `src/config/project-config.mjs`
- Modify: `bin/harness.mjs`
- Modify: `plugins/makeitreal/dev-harness/src/config/project-config.mjs`
- Modify: `plugins/makeitreal/dev-harness/bin/harness.mjs`
- Test: `test/config.test.mjs`

- [x] **Step 1: Write profile behavior tests**

Add this test to `test/config.test.mjs`:

```js
test("config command applies semantic profiles", async () => {
  await withProjectRun(async ({ root }) => {
    const quiet = runHarness(["config", "set", root, "--profile", "quiet"]);
    assert.equal(quiet.status, 0, quiet.stdout || quiet.stderr);
    assert.deepEqual(JSON.parse(quiet.stdout).config.features, {
      liveWiki: { enabled: true },
      dashboard: {
        autoOpen: false,
        refreshOnLaunch: true,
        refreshOnStatus: false,
        refreshOnVerify: true
      }
    });

    const restored = runHarness(["config", "set", root, "--profile", "default"]);
    assert.equal(restored.status, 0, restored.stdout || restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout).config.features, {
      liveWiki: { enabled: true },
      dashboard: {
        autoOpen: true,
        refreshOnLaunch: true,
        refreshOnStatus: true,
        refreshOnVerify: true
      }
    });
  });
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
node --test test/config.test.mjs
```

Expected: fail with `HARNESS_CONFIG_FLAG_REQUIRED` or equivalent because `--profile` is not supported yet.

- [x] **Step 3: Implement profiles**

Add `CONFIG_PROFILES` and `setProjectConfigProfile` in `src/config/project-config.mjs`:

```js
export const CONFIG_PROFILES = Object.freeze({
  default: DEFAULT_CONFIG,
  quiet: Object.freeze({
    schemaVersion: "1.1",
    features: Object.freeze({
      liveWiki: Object.freeze({ enabled: true }),
      dashboard: Object.freeze({
        autoOpen: false,
        refreshOnStatus: false,
        refreshOnLaunch: true,
        refreshOnVerify: true
      })
    })
  })
});

export async function setProjectConfigProfile({ projectRoot, profile }) {
  const config = CONFIG_PROFILES[profile];
  if (!config) {
    return {
      ok: false,
      command: "config set",
      projectRoot: path.resolve(projectRoot),
      configPath: projectConfigPath(projectRoot),
      source: "project",
      config: null,
      errors: [createHarnessError({
        code: "HARNESS_CONFIG_PROFILE_UNSUPPORTED",
        reason: `Unsupported Make It Real config profile: ${profile}`,
        evidence: ["--profile"],
        recoverable: true
      })]
    };
  }
  return writeProjectConfig({ projectRoot, config });
}
```

Update `bin/harness.mjs` to import `setProjectConfigProfile`, parse `--profile`,
and apply it before individual flags.

- [x] **Step 4: Run focused config tests**

Run:

```bash
node --test test/config.test.mjs
```

Expected: all config tests pass.

### Task 2: Rewrite Config Command UX

**Files:**
- Modify: `plugins/makeitreal/commands/config.md`
- Modify: `plugins/mir/commands/config.md`
- Modify: `plugins/makeitreal/skills/config/SKILL.md`
- Modify: `plugins/mir/skills/config/SKILL.md`
- Test: `test/makeitreal-plugin.test.mjs`

- [x] **Step 1: Add plugin UX regression assertions**

Add assertions that both config commands:

```js
assert.match(command, /AskUserQuestion/);
assert.match(command, /semantic operator intent/i);
assert.match(command, /--profile quiet/);
assert.match(command, /Do not present key\/value config editing as the normal path/i);
assert.doesNotMatch(command, /features\.liveWiki\.enabled=false/);
```

- [x] **Step 2: Run plugin tests and confirm failure**

Run:

```bash
node --test test/makeitreal-plugin.test.mjs
```

Expected: fail because current config docs still pass `$ARGUMENTS` directly.

- [x] **Step 3: Rewrite command markdown**

Both config command files must:

```md
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
```

They must instruct Claude to:

1. Always run `config get`.
2. If arguments are empty, show a compact settings table and use
   `AskUserQuestion`.
3. If arguments are present, classify semantic operator intent.
4. Run only one of the supported deterministic actions.
5. Keep internal keys and raw JSON out of the primary answer.

- [x] **Step 4: Rewrite config skills**

Both config skills must define:

- semantic choices,
- natural-language aliases,
- exact engine flags,
- advanced mode,
- forbidden normal UX: raw `features.*` keys and key/value editing.

- [x] **Step 5: Run plugin tests**

Run:

```bash
node --test test/makeitreal-plugin.test.mjs
```

Expected: pass.

### Task 3: Apply Primary-vs-Diagnostic Rules To Adjacent Commands

**Files:**
- Modify: `plugins/makeitreal/commands/status.md`
- Modify: `plugins/mir/commands/status.md`
- Modify: `plugins/makeitreal/commands/doctor.md`
- Modify: `plugins/mir/commands/doctor.md`
- Modify: `plugins/makeitreal/commands/verify.md`
- Modify: `plugins/mir/commands/verify.md`
- Modify: `plugins/makeitreal/commands/launch.md`
- Modify: `plugins/mir/commands/launch.md`
- Modify: matching skill files under `plugins/*/skills/`
- Test: `test/makeitreal-plugin.test.mjs`

- [x] **Step 1: Add assertions for UX contract wording**

Assert that status, doctor, verify, and launch docs mention primary operator
reports and advanced diagnostics, and do not instruct the assistant to lead with
raw engine fields.

- [x] **Step 2: Update docs**

Add concise sections to each affected command/skill:

```md
## Operator Report

Lead with the operator-facing state and next action. Keep raw engine fields,
JSON envelopes, run ids, hashes, and HARNESS codes in an advanced diagnostic
note only when the user asks or when troubleshooting requires it.
```

- [x] **Step 3: Run plugin tests**

Run:

```bash
node --test test/makeitreal-plugin.test.mjs
```

Expected: pass.

### Task 4: Document The Semantic Command Layer

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

- [x] **Step 1: Update README**

Add a note under normal workflow:

```md
`/makeitreal:config` and `/mir:config` are semantic workflows. Use natural
phrases such as `wiki off` or `dashboard quiet`; the plugin maps intent to
deterministic engine flags.
```

- [x] **Step 2: Update architecture docs**

Document the public/private command boundary:

```md
Public slash commands present semantic operator workflows. Internal engine
commands remain deterministic, scriptable, and JSON-oriented.
```

### Task 5: Verify, Commit, And Update Plugin Install

**Files:**
- Verify all changed files.

- [x] **Step 1: Run focused tests**

Run:

```bash
node --test test/config.test.mjs test/makeitreal-plugin.test.mjs
```

Expected: pass.

- [x] **Step 2: Run full checks**

Run:

```bash
npm run check
npm run plugin:validate
```

Expected: pass.

- [x] **Step 3: Commit without OmX co-author trailer**

Run with the local OMX guard disabled for this commit only:

```bash
OMX_LORE_COMMIT_GUARD=0 git commit -m "Make command UX semantic" -m "<Lore body and trailers>"
```

Expected: commit succeeds and does not contain the unwanted OmX co-author
trailer.

## Self-Review

- Spec coverage: Tasks 1-4 cover semantic config profiles, config workflow,
  adjacent command output rules, and documentation.
- Placeholder scan: no TODO/TBD placeholders are used.
- Type consistency: profile names are `default` and `quiet` everywhere; dashboard
  keys match `autoOpen`, `refreshOnStatus`, `refreshOnLaunch`, and
  `refreshOnVerify`.
