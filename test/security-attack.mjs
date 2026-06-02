#!/usr/bin/env node
/**
 * SECURITY ATTACK SCRIPT - active penetration test
 */
import { invalidAllowedPathPattern, normalizeMatchInput, matchesPattern } from '../src/domain/path-policy.mjs';
import { normalizeVerificationCommand } from '../src/domain/verification-command.mjs';
import { validateBlueprintProposal } from '../src/plan/blueprint-validator.mjs';
import { validateChangedPaths } from '../src/board/responsibility-boundaries.mjs';
import { resolveWorkspace } from '../src/orchestrator/workspace-manager.mjs';

const results = [];
function check(name, condition, detail = '') {
  const status = condition ? 'BLOCKED' : 'SUCCEEDED (VULN)';
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ': ' + detail : ''}`);
}

// ================================================================
// AUDIT 1: PATH TRAVERSAL IN ownedPaths
// ================================================================
console.log('\n=== AUDIT 1A: invalidAllowedPathPattern ===');
check('A1: ../../../etc/passwd', invalidAllowedPathPattern('../../../etc/passwd'));
check('A2: src/..\\..\\..\\etc (backslash)', invalidAllowedPathPattern('src/..\\..\\..\\etc'));
check('A3: /etc/passwd (absolute)', invalidAllowedPathPattern('/etc/passwd'));
check('A4: null', invalidAllowedPathPattern(null));
check('A5: .. (parent)', invalidAllowedPathPattern('..'));
check('A6: src/../../../etc', invalidAllowedPathPattern('src/../../../etc'));
check('A7: .makeitreal/config (reserved control plane)', invalidAllowedPathPattern('.makeitreal/config'));
check('A8: .claude/settings (reserved)', invalidAllowedPathPattern('.claude/settings'));
check('A9: evidence/foo.json (reserved)', invalidAllowedPathPattern('evidence/foo.json'));
// Edge: looks like parent but isn't traversal
const dotNotTraversal = invalidAllowedPathPattern('src/..hidden/file');
console.log(`[INFO] src/..hidden/file (double-dot non-traversal) invalid? ${dotNotTraversal}`);

console.log('\n=== AUDIT 1B: normalizeMatchInput - what does path normalization return? ===');
const tests = [
  '../../../etc/passwd',
  'src/../../etc/passwd',
  '/etc/passwd',
  'src/..\\..\\etc',
  'src/./file.js',
  'src//file.js',
];
for (const t of tests) {
  const n = normalizeMatchInput(t);
  console.log(`  normalizeMatchInput("${t}") => ${JSON.stringify(n)}`);
}

console.log('\n=== AUDIT 1C: validateChangedPaths boundary attacks ===');
const workItem = { id: 'test', allowedPaths: ['src/**', 'test/**', 'package.json'] };
const changed = [
  ['../../etc/passwd', 'direct parent traversal'],
  ['src/../../etc/passwd', 'mid-path traversal starting with allowed prefix'],
  ['/tmp/../../../etc/attack', 'absolute path with traversal'],
  ['src\\..\\..\\etc', 'backslash traversal'],
  ['src\x00/evil.js', 'null byte injection'],
  ['SRC/file.js', 'case bypass on macOS (SRC vs src)'],
  ['src/..hidden/file', 'double-dot non-traversal segment'],
];
for (const [p, label] of changed) {
  const r = validateChangedPaths({ workItem, changedPaths: [p] });
  check(`changedPath: ${label} (${JSON.stringify(p)})`, !r.ok, r.ok ? 'PASSED BOUNDARY - BYPASSED' : r.errors?.[0]?.code);
}

// ================================================================
// AUDIT 1D: VERIFY COMMAND INJECTION
// ================================================================
console.log('\n=== AUDIT 1D: verifyCommand injection ===');
const cmds = [
  [{file:'bash', args:['-c','cat /etc/passwd']}, 'bash -c cat /etc/passwd'],
  [{file:'node', args:['--eval','require("fs").writeFileSync("/tmp/pwned","pwned")']}, 'node --eval writeFile'],
  [{file:'rm', args:['-rf','/tmp']}, 'rm -rf /tmp'],
  [{command:'/bin/sh', args:['-c','id > /tmp/pwned2']}, '/bin/sh via command alias'],
  [{file:'/bin/bash', args:['-c','id']}, 'absolute path /bin/bash'],
  [{file:'../../../bin/sh', args:['-c','id']}, 'traversal in file field'],
  [{file:'npm', args:['test'], env:{PATH:'/tmp/evil:$PATH'}}, 'PATH env injection'],
  [{file:'', args:['test']}, 'empty file'],
  [{file:123, args:['test']}, 'non-string file'],
  [{file:'npm', args:['test'], extra:'field'}, 'unsupported extra field'],
  [{file:'npm', args:[1,2,3]}, 'non-string args'],
  ['not-an-object', 'string instead of object'],
  [null, 'null command'],
  [[], 'array command'],
];
for (const [cmd, label] of cmds) {
  const r = normalizeVerificationCommand(cmd);
  // Note: normalized OK means the command WILL be executed - so we check if dangerous commands normalize
  const isDangerous = r.ok && cmd && typeof cmd === 'object' && !Array.isArray(cmd) && 
    (String(cmd.file||'').includes('bash') || String(cmd.file||'').includes('sh') || 
     String(cmd.file||'').startsWith('/') || String(cmd.file||'').includes('..'));
  if (r.ok) {
    console.log(`[NORMALIZED-OK] ${label}: ${JSON.stringify(r.command)} ${isDangerous ? '<-- NOTE: dangerous cmd allowed' : ''}`);
  } else {
    console.log(`[REJECTED] ${label}: ${r.reason}`);
  }
}

// ================================================================
// AUDIT 1E: BLUEPRINT ATTACKS
// ================================================================
console.log('\n=== AUDIT 1E: Blueprint injection attacks ===');
const baseBp = {
  title: 'T', summary: 'S', acceptanceCriteria: ['AC1'],
  workItems: [{module:'mod', title:'T', verifyCommand:{file:'npm',args:['test']},
    doneEvidence:[{kind:'test'}], dependsOn:[]}],
  modules: [{name:'mod', purpose:'p', ownedPaths:['src/**']}]
};

// Contract name injection
const bp1 = structuredClone(baseBp);
bp1.modules[0].contracts = [{type:'http',name:'POST /auth; rm -rf /tmp',inputs:[],outputs:[]}];
const v1 = validateBlueprintProposal(bp1);
console.log(`[${!v1.ok ? 'BLOCKED' : 'PASSED'}] Contract name 'POST /auth; rm -rf /tmp': ${v1.errors?.map(e=>e.reason).join('; ') || 'accepted'}`);

// Module name with traversal
const bp2 = structuredClone(baseBp);
bp2.modules[0].name = '../secret';
bp2.workItems[0].module = '../secret';
const v2 = validateBlueprintProposal(bp2);
console.log(`[${!v2.ok ? 'BLOCKED' : 'PASSED (VULN)'}] Module name '../secret': ${v2.errors?.map(e=>e.reason).join('; ') || 'accepted'}`);

// ownedPaths traversal
const bp3 = structuredClone(baseBp);
bp3.modules[0].ownedPaths = ['../../../etc/passwd'];
const v3 = validateBlueprintProposal(bp3);
console.log(`[${!v3.ok ? 'BLOCKED' : 'PASSED (VULN)'}] ownedPaths '../../../etc/passwd': ${v3.errors?.map(e=>e.reason).join('; ') || 'accepted'}`);

const bp4 = structuredClone(baseBp);
bp4.modules[0].ownedPaths = ['src/..\\..\\..\\etc'];
const v4 = validateBlueprintProposal(bp4);
console.log(`[${!v4.ok ? 'BLOCKED' : 'PASSED (VULN)'}] ownedPaths backslash traversal: ${v4.errors?.map(e=>e.reason).join('; ') || 'accepted'}`);

// 20 modules
const bpBig = structuredClone(baseBp);
bpBig.modules = Array.from({length:20}, (_,i) => ({name:`mod${i}`, purpose:`p${i}`, ownedPaths:[`src/m${i}/**`]}));
bpBig.workItems = bpBig.modules.map(m => ({module:m.name, title:'T', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:[]}));
const v5 = validateBlueprintProposal(bpBig);
console.log(`[${v5.ok ? 'ACCEPTED' : 'REJECTED'}] 20 modules: ${v5.ok ? 'ok' : v5.errors?.[0]?.reason}`);

// Circular dependency
const bpCirc = structuredClone(baseBp);
bpCirc.modules = [
  {name:'A', purpose:'p', ownedPaths:['src/a/**'], dependsOn:['B']},
  {name:'B', purpose:'p', ownedPaths:['src/b/**'], dependsOn:['A']},
];
bpCirc.workItems = [
  {module:'A', title:'T', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:['B']},
  {module:'B', title:'T', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:['A']},
];
const v6 = validateBlueprintProposal(bpCirc);
console.log(`[${!v6.ok ? 'BLOCKED' : 'PASSED (VULN)'}] Circular dependency A->B->A: ${v6.errors?.map(e=>e.reason).join('; ') || 'accepted'}`);

// Empty string fields
const bp7 = structuredClone(baseBp);
bp7.title = '';
const v7 = validateBlueprintProposal(bp7);
console.log(`[${!v7.ok ? 'BLOCKED' : 'PASSED (VULN)'}] Empty title: ${v7.errors?.map(e=>e.reason).join('; ') || 'accepted'}`);

// ================================================================
// AUDIT 1F: Workspace escape via workItemId
// ================================================================
console.log('\n=== AUDIT 1F: Workspace escape via workItemId ===');
const boardDir = '/tmp/test-board';
const badIds = [
  '../../../etc',
  '/etc/passwd',
  '../../root',
  'a/b/c',
  'normal-id',
  'a.b-c_1',
];
for (const id of badIds) {
  const r = resolveWorkspace({ boardDir, workItemId: id });
  console.log(`[${!r.ok ? 'BLOCKED' : 'ALLOWED'}] workItemId "${id}": ${r.ok ? r.workspace : r.errors?.[0]?.code}`);
}

console.log('\n=== AUDIT 1: SUMMARY ===');
const vulns = results.filter(r => r.status.includes('VULN'));
console.log(`Total checks: ${results.length}, Issues found: ${vulns.length}`);
vulns.forEach(v => console.log(`  VULN: ${v.name}`));
