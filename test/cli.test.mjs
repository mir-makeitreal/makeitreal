import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("CLI help lists the supported commands", () => {
  const result = spawnSync(process.execPath, ["bin/harness.mjs", "--help"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /makeitreal-engine \(internal\)/);
  assert.match(result.stdout, /Internal commands used by Make It Real skills/);
  assert.match(result.stdout, /design render/);
  assert.match(result.stdout, /gate/);
  assert.match(result.stdout, /verify/);
  assert.match(result.stdout, /config get/);
  assert.match(result.stdout, /doctor <projectRoot>/);
  assert.match(result.stdout, /wiki sync/);
  assert.match(result.stdout, /--runner scripted-simulator\|claude-code/);
});
