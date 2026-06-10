#!/usr/bin/env node
// Release guard: package.json, plugin manifests, marketplace.json, and CHANGELOG.md must agree on the version.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const readJson = (relPath) => JSON.parse(readFileSync(path.join(repoRoot, relPath), "utf8"));

const { version } = readJson("package.json");
if (!version) {
  console.error("check-version-sync: package.json has no version field.");
  process.exit(1);
}

const errors = [];
const expect = (label, actual) => {
  if (actual !== version) errors.push(`${label} version "${actual}" does not match package.json version "${version}".`);
};

expect("plugins/makeitreal/.claude-plugin/plugin.json", readJson("plugins/makeitreal/.claude-plugin/plugin.json").version);
expect("plugins/mir/.claude-plugin/plugin.json", readJson("plugins/mir/.claude-plugin/plugin.json").version);

const marketplace = readJson(".claude-plugin/marketplace.json");
expect(".claude-plugin/marketplace.json", marketplace.version);
for (const plugin of marketplace.plugins ?? []) {
  expect(`.claude-plugin/marketplace.json plugin "${plugin.name}"`, plugin.version);
}

if (!readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8").includes(`## [${version}]`)) {
  errors.push(`CHANGELOG.md has no "## [${version}]" entry for the current version.`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`check-version-sync: ${error}`);
  process.exit(1);
}
console.log(`check-version-sync: version ${version} is in sync across package.json, plugin manifests, marketplace.json, and CHANGELOG.md.`);
