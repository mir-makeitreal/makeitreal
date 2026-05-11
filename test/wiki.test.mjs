import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runVerification } from "../src/adapters/command-evidence.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { syncLiveWiki } from "../src/wiki/live-wiki.mjs";
import { withFixture } from "./helpers/fixture.mjs";

test("syncs verified work to live wiki and writes evidence", async () => {
  await withFixture(async ({ runDir }) => {
    await runVerification({ runDir });
    const result = await syncLiveWiki({ runDir });
    assert.equal(result.ok, true);

    const markdown = await readFile(path.join(runDir, ".makeitreal", "wiki", "live", "work.feature-auth.md"), "utf8");
    assert.match(markdown, /# Contract Reference: Auth UI/);
    assert.match(markdown, /## Public Outcome/);
    assert.match(markdown, /PRD `prd.auth` defines this responsibility boundary/);
    assert.match(markdown, /## Responsibility Boundary/);
    assert.match(markdown, /Owner unit/);
    assert.match(markdown, /`ru.frontend`/);
    assert.match(markdown, /## Public Surfaces/);
    assert.match(markdown, /LoginForm.submit/);
    assert.match(markdown, /credentials.email/);
    assert.match(markdown, /sessionResult/);
    assert.match(markdown, /AUTH_LOGIN_REJECTED/);
    assert.match(markdown, /## Acceptance Evidence/);
    assert.match(markdown, /AC-001/);
    assert.match(markdown, /## Completion Evidence/);
    assert.match(markdown, /contract.auth.login/);
    assert.match(markdown, /Blueprint preview: preview\/index.html/);
    assert.match(markdown, /## Audit Trail/);

    const evidence = await readJsonFile(path.join(runDir, "evidence", "wiki-sync.json"));
    assert.equal(evidence.kind, "wiki-sync");
    assert.equal(evidence.workItemId, "work.feature-auth");
  });
});

test("wiki sync requires passing verification evidence", async () => {
  await withFixture(async ({ runDir }) => {
    const missing = await syncLiveWiki({ runDir });
    assert.equal(missing.ok, false);
    assert.equal(missing.errors[0].code, "HARNESS_EVIDENCE_MISSING");

    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.verificationCommands = [{ file: "node", args: ["-e", "process.exit(3)"] }];
    await writeJsonFile(workItemPath, workItem);

    await runVerification({ runDir });
    const failed = await syncLiveWiki({ runDir });
    assert.equal(failed.ok, false);
    assert.equal(failed.errors[0].code, "HARNESS_VERIFICATION_FAILED");
  });
});
