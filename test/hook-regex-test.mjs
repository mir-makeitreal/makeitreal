// Test bash harness control regex bypass
const harnessControlRegex = /\b(?:makeitreal-engine|harness\.mjs)\b[^;&|]*(?:\s|^)(?:setup|status|doctor|plan|blueprint|config|hooks|dashboard|gate|verify|wiki|contracts|board|orchestrator)\b/;

const tests = [
  // Legitimate
  ['makeitreal-engine status', 'legitimate harness cmd'],
  ['node harness.mjs plan', 'legitimate harness plan'],
  // Injection: what if we append malicious shell after harness cmd?
  ['makeitreal-engine setup && cat /etc/passwd', 'inject via && after harness cmd'],
  ['makeitreal-engine status; rm -rf /', 'inject via ; after harness cmd'],
  ['makeitreal-engine status || rm -rf /', 'inject via || after harness cmd'],
  ['cat /etc/passwd; makeitreal-engine status', 'prepend evil then harness cmd'],
  ['cat /etc/passwd && makeitreal-engine status', 'prepend evil with && then harness cmd'],
  // The regex stops at [^;&|]* so what does it match for 'makeitreal-engine setup && ...'?
  // The [^;&|]* part matches zero or more chars that are NOT ; & |
  // So 'makeitreal-engine setup ' matches through ' setup' (after 'makeitreal-engine')
  // Then the positive word boundary matches 'setup'
  // The command itself says: if bashLooksHarnessControl -> ALLOW completely (no path checks)
  ['makeitreal-engine setup\nrm -rf /', 'newline injection'],
  // Unicode bypass
  ['mak\u0435itreal-engine status', 'cyrillic e bypass (looks like e)'],
  ['makeitreal\u200b-engine status', 'zero-width space bypass'],
];

for (const [cmd, label] of tests) {
  const matches = harnessControlRegex.test(cmd);
  console.log(`[${matches ? 'BYPASS-ALLOWED' : 'NORMAL-FLOW'}] ${label}: ${JSON.stringify(cmd.slice(0,60))}`);
}

// Key insight: if bashLooksHarnessControl returns true, the hook returns
// ask("Bash command exposes no project file path to validate") which maps to allow()
// So the whole path-boundary check is skipped for these commands.
// The attack: if 'cat /etc/passwd; makeitreal-engine status' matches the regex,
// the hook would ALLOW it without checking paths.
// Let's test that specific case:
const evil = 'cat /etc/passwd; makeitreal-engine status';
console.log('\nDoes evil prepend command bypass harness control detection?', harnessControlRegex.test(evil));

// Also test: what if harnessControlBash is true but command has path writes?
// From the code: if harnessControlBash -> bashPaths = [] (path collection is skipped)
// Then bashHasPaths = false, bashNeedsDelegation = false
// mutatingTool = false (since MUTATING_TOOLS doesn't include 'Bash' unless bashHasPaths)
// Wait - check: mutatingTool = MUTATING_TOOLS.has(input?.tool_name) || bashHasPaths
// MUTATING_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"] - not Bash
// So if it's Bash and harnessControlBash=true: mutatingTool=false -> return allow("Non-mutating tool")
// This means ANY bash command that matches the regex is fully allowed, even if it writes files!

console.log('\n=== CRITICAL: bash allow bypass analysis ===');
const bypassCmds = [
  'makeitreal-engine plan && rm /tmp/important',
  'x=1; makeitreal-engine verify; echo pwned > /etc/cron.d/evil',
];
for (const cmd of bypassCmds) {
  const bypass = harnessControlRegex.test(cmd);
  console.log(`Bypasses path check: ${bypass} for: ${cmd.slice(0,70)}`);
}
