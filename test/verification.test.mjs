import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runVerification } from "../src/adapters/command-evidence.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { withFixture } from "./helpers/fixture.mjs";

test("verification commands write evidence", async () => {
  await withFixture(async ({ runDir }) => {
    const result = await runVerification({ runDir });
    assert.equal(result.ok, true);

    const evidence = await readJsonFile(path.join(runDir, "evidence", "verification.json"));
    assert.equal(evidence.kind, "verification");
    assert.equal(evidence.ok, true);
    assert.equal(evidence.commands.length, 1);
    assert.equal(evidence.commands[0].exitCode, 0);
    assert.match(evidence.commands[0].stdout, /verification ok/);
    assert.equal(typeof evidence.commands[0].commandHash, "string");
  });
});

test("failed verification writes failing evidence", async () => {
  await withFixture(async ({ runDir }) => {
    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.verificationCommands = [{ file: "node", args: ["-e", "process.exit(7)"] }];
    await writeJsonFile(workItemPath, workItem);

    const result = await runVerification({ runDir });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_VERIFICATION_COMMAND_FAILED");

    const evidence = await readJsonFile(path.join(runDir, "evidence", "verification.json"));
    assert.equal(evidence.ok, false);
    assert.equal(evidence.commands[0].exitCode, 7);
  });
});

test("verification commands preserve declared environment", async () => {
  await withFixture(async ({ runDir }) => {
    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.verificationCommands = [{
      file: "node",
      args: ["-e", "if (process.env.MAKEITREAL_DOGFOOD_ENV !== 'enabled') process.exit(9); console.log(process.env.MAKEITREAL_DOGFOOD_ENV)"],
      env: {
        MAKEITREAL_DOGFOOD_ENV: "enabled"
      }
    }];
    await writeJsonFile(workItemPath, workItem);

    const result = await runVerification({ runDir });
    assert.equal(result.ok, true);

    const evidence = await readJsonFile(path.join(runDir, "evidence", "verification.json"));
    assert.equal(evidence.commands[0].command.env.MAKEITREAL_DOGFOOD_ENV, "enabled");
    assert.match(evidence.commands[0].stdout, /enabled/);
  });
});

test("verification commands reject unsupported fields instead of dropping them", async () => {
  await withFixture(async ({ runDir }) => {
    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.verificationCommands = [{
      file: "node",
      args: ["-e", "console.log('ok')"],
      cwd: "/tmp"
    }];
    await writeJsonFile(workItemPath, workItem);

    const result = await runVerification({ runDir });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_VERIFICATION_COMMAND_INVALID");
    assert.match(result.errors[0].reason, /unsupported field/);
  });
});

test("missing verification commands fail fast instead of producing a passing result", async () => {
  await withFixture(async ({ runDir }) => {
    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.verificationCommands = [];
    await writeJsonFile(workItemPath, workItem);

    const result = await runVerification({ runDir });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_VERIFICATION_COMMANDS_MISSING");

    const evidence = await readJsonFile(path.join(runDir, "evidence", "verification.json"));
    assert.equal(evidence.ok, false);
    assert.equal(evidence.commands.length, 0);
  });
});
