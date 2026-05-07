import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileExists } from "../src/io/json.mjs";

if (process.env.MAKEITREAL_CHECK_CONTRACT_CHILD === "1") {
  test("deterministic check contract child skips recursive npm invocation", { skip: true }, () => {});
} else {
  async function withPoisonedClaude(callback) {
    const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-no-real-claude-"));
    const marker = path.join(root, "invoked.txt");
    const sentinel = path.join(root, "claude");
    await writeFile(sentinel, `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(marker)}, process.argv.join(' '));
process.exit(97);
`, "utf8");
    await chmod(sentinel, 0o755);
    try {
      await callback({ root, marker });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  function runNpm(args, root) {
    return spawnSync("npm", args, {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        MAKEITREAL_CHECK_CONTRACT_CHILD: "1",
        PATH: `${root}${path.delimiter}${process.env.PATH}`
      },
      timeout: 120000
    });
  }

  test("npm test and npm run check do not invoke a real claude binary", async () => {
    await withPoisonedClaude(async ({ root, marker }) => {
      let result = runNpm(["test"], root);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(await fileExists(marker), false, await fileExists(marker) ? await readFile(marker, "utf8") : "");

      result = runNpm(["run", "check"], root);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(await fileExists(marker), false, await fileExists(marker) ? await readFile(marker, "utf8") : "");
    });
  });
}
