#!/usr/bin/env node
/**
 * AUDIT 2: MCP SERVER ROBUSTNESS - actual attack of the stdio server
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const MCP_SERVER = '/Users/eugene/Workspace/52g-tools/dev-harness/plugins/makeitreal/mcp-server/index.mjs';

function startServer() {
  const proc = spawn('node', [MCP_SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {}); // suppress debug
  return proc;
}

function sendLine(proc, line) {
  return new Promise((resolve, reject) => {
    const buf = [];
    const onData = (chunk) => {
      const text = chunk.toString();
      buf.push(text);
      try {
        JSON.parse(buf.join('').trim());
        proc.stdout.removeListener('data', onData);
        clearTimeout(timer);
        resolve(JSON.parse(buf.join('').trim()));
      } catch {}
    };
    proc.stdout.on('data', onData);
    const timer = setTimeout(() => {
      proc.stdout.removeListener('data', onData);
      resolve({ timeout: true, partial: buf.join('') });
    }, 3000);
    proc.stdin.write(line + '\n');
  });
}

function sendLines(proc, lines) {
  return new Promise((resolve) => {
    const results = [];
    let remaining = lines.length;
    const buf = {};
    let idx = 0;

    for (const [i, line] of lines.entries()) {
      buf[i] = [];
    }

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split('\n').filter(Boolean)) {
        try {
          results.push(JSON.parse(line.trim()));
          if (results.length >= lines.length) {
            clearTimeout(timer);
            resolve(results);
          }
        } catch {}
      }
    });

    const timer = setTimeout(() => resolve(results), 5000);

    for (const line of lines) {
      proc.stdin.write(line + '\n');
    }
  });
}

async function test(name, fn) {
  process.stdout.write(`\nTEST: ${name}\n`);
  try {
    const result = await fn();
    process.stdout.write(`  RESULT: ${JSON.stringify(result).slice(0, 200)}\n`);
    return result;
  } catch(e) {
    process.stdout.write(`  ERROR/CRASH: ${e.message}\n`);
    return { crashed: true, error: e.message };
  }
}

async function main() {
  console.log('=== AUDIT 2: MCP SERVER ROBUSTNESS ===\n');

  // ── Test 1: Malformed JSON ──────────────────────────────────────
  await test('2.1 Malformed JSON to stdin', async () => {
    const proc = startServer();
    const result = await sendLine(proc, '{not valid json!!!}');
    proc.kill();
    return result;
  });

  // ── Test 2: Partial JSON (cut off) ─────────────────────────────
  await test('2.2 Partial JSON (no closing brace)', async () => {
    const proc = startServer();
    proc.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":');
    // don't close - wait for timeout
    const result = await new Promise(resolve => {
      const buf = [];
      proc.stdout.on('data', d => buf.push(d.toString()));
      setTimeout(() => {
        resolve({ receivedOutput: buf.join(''), timeout: true, note: 'no response - line-based server waits for newline' });
      }, 1500);
    });
    proc.kill();
    return result;
  });

  // ── Test 3: Wrong method names ─────────────────────────────────
  await test('2.3 Wrong method name (tools/execute)', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/execute',params:{name:'mir_blueprint',arguments:{}}}));
    proc.kill();
    return result;
  });

  await test('2.3b Unknown method (hack/inject)', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({jsonrpc:'2.0',id:1,method:'hack/inject',params:{}}));
    proc.kill();
    return result;
  });

  // ── Test 4: Missing required fields in tools/call ──────────────
  await test('2.4a Missing projectRoot', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: { runSlug: 'test' } }
    }));
    proc.kill();
    return result;
  });

  await test('2.4b Missing all required fields', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: {} }
    }));
    proc.kill();
    return result;
  });

  await test('2.4c Missing params entirely', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call'
    }));
    proc.kill();
    return result;
  });

  await test('2.4d Null arguments', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: null }
    }));
    proc.kill();
    return result;
  });

  // ── Test 5: 5 concurrent mir_blueprint calls ───────────────────
  await test('2.5 5 concurrent mir_blueprint calls', async () => {
    const proc = startServer();
    const lines = Array.from({length:5}, (_, i) => JSON.stringify({
      jsonrpc:'2.0', id: i+1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: {
        projectRoot: '/tmp/test-concurrent',
        runSlug: `run${i}`,
        title: `T${i}`, summary: `S${i}`,
        acceptanceCriteria: ['AC'],
        modules: [{name:'m', purpose:'p', ownedPaths:[`src/m${i}/**`]}],
        workItems: [{module:'m', title:'T', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:[]}]
      }}
    }));
    const results = await sendLines(proc, lines);
    proc.kill();
    return { count: results.length, ids: results.map(r => r?.id ?? r?.error?.code) };
  });

  // ── Test 6: mir_launch without calling start first ─────────────
  await test('2.6 mir_launch action=finish without start (missing board)', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_launch', arguments: {
        projectRoot: '/tmp/nonexistent-board-12345',
        runSlug: 'no-such-run',
        action: 'finish',
        workItemId: 'wi-1',
        attemptId: 'att-1',
        result: { makeitrealReport: { status: 'DONE' } }
      }}
    }));
    proc.kill();
    return result;
  });

  await test('2.6b mir_launch action=start without board.json', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_launch', arguments: {
        projectRoot: '/tmp',
        runSlug: 'no-board-run',
        action: 'start'
      }}
    }));
    proc.kill();
    return result;
  });

  // ── Test 7: Blueprint with 20 modules ─────────────────────────
  await test('2.7 Blueprint with 20 modules', async () => {
    const proc = startServer();
    const modules = Array.from({length:20}, (_,i) => ({
      name:`mod${i}`, purpose:`purpose${i}`, ownedPaths:[`src/mod${i}/**`]
    }));
    const workItems = modules.map(m => ({
      module: m.name, title: `Implement ${m.name}`,
      verifyCommand: {file:'npm',args:['test']},
      doneEvidence: [{kind:'test'}], dependsOn: []
    }));
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: {
        projectRoot: '/tmp/big-blueprint-test',
        runSlug: 'big-blueprint',
        title: 'Big Blueprint',
        summary: 'Testing 20 modules',
        acceptanceCriteria: ['All modules implemented'],
        modules, workItems
      }}
    }));
    proc.kill();
    return result?.result?.content?.[0]?.text
      ? { ok: JSON.parse(result.result.content[0].text)?.ok, runDir: JSON.parse(result.result.content[0].text)?.runDir }
      : result;
  });

  // ── Test 8: Circular dependencies ─────────────────────────────
  await test('2.8 Circular dependency A->B->A in blueprint', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: {
        projectRoot: '/tmp/circular-test',
        runSlug: 'circular-test',
        title: 'Circular', summary: 'Test circular deps',
        acceptanceCriteria: ['AC'],
        modules: [
          {name:'A', purpose:'p', ownedPaths:['src/a/**'], dependsOn:['B']},
          {name:'B', purpose:'p', ownedPaths:['src/b/**'], dependsOn:['A']},
        ],
        workItems: [
          {module:'A', title:'TA', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:['B']},
          {module:'B', title:'TB', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:['A']},
        ]
      }}
    }));
    proc.kill();
    const payload = result?.result?.content?.[0]?.text
      ? JSON.parse(result.result.content[0].text) : result;
    return { ok: payload?.ok, errors: payload?.errors?.map(e=>e.reason) };
  });

  // ── Test 9: Empty string fields ────────────────────────────────
  await test('2.9a Empty projectRoot', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: { projectRoot: '', runSlug: 'test' }}
    }));
    proc.kill();
    const p = result?.result?.content?.[0]?.text ? JSON.parse(result.result.content[0].text) : result;
    return { ok: p?.ok, errors: p?.errors?.map(e=>e.code) };
  });

  await test('2.9b Empty runSlug', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: { projectRoot: '/tmp', runSlug: '' }}
    }));
    proc.kill();
    const p = result?.result?.content?.[0]?.text ? JSON.parse(result.result.content[0].text) : result;
    return { ok: p?.ok, errors: p?.errors?.map(e=>e.code) };
  });

  // ── Test 10: Large payload ─────────────────────────────────────
  await test('2.10 Large payload (1MB title)', async () => {
    const proc = startServer();
    const bigTitle = 'X'.repeat(1_000_000);
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: {
        projectRoot: '/tmp', runSlug: 'big',
        title: bigTitle, summary: 'S', acceptanceCriteria: ['AC'],
        modules: [{name:'m', purpose:'p', ownedPaths:['src/**']}],
        workItems: [{module:'m', title:'T', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:[]}]
      }}
    }));
    proc.kill();
    return result ? { received: true, type: result?.result ? 'result' : result?.error ? 'error' : 'unknown' } : { timeout: true };
  });

  // ── Test 11: Wrong tool name ───────────────────────────────────
  await test('2.11 Unknown tool name in tools/call', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'evil_tool', arguments: {} }
    }));
    proc.kill();
    return result;
  });

  // ── Test 12: Path traversal in projectRoot ─────────────────────
  await test('2.12 Path traversal in projectRoot (accepted but targets weird path)', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: {
        projectRoot: '/tmp/safe/../../../tmp/attack',
        runSlug: 'traversal-test',
        title: 'T', summary: 'S', acceptanceCriteria: ['AC'],
        modules: [{name:'m', purpose:'p', ownedPaths:['src/**']}],
        workItems: [{module:'m', title:'T', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:[]}]
      }}
    }));
    proc.kill();
    const p = result?.result?.content?.[0]?.text ? JSON.parse(result.result.content[0].text) : result;
    // If ok=true, it resolved the runDir which could be a traversed path
    return { ok: p?.ok, runDir: p?.runDir };
  });

  // ── Test 13: Non-absolute projectRoot ─────────────────────────
  await test('2.13 Non-absolute projectRoot (relative path)', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_blueprint', arguments: {
        projectRoot: '../etc',
        runSlug: 'rel-test',
        title: 'T', summary: 'S', acceptanceCriteria: ['AC'],
        modules: [{name:'m', purpose:'p', ownedPaths:['src/**']}],
        workItems: [{module:'m', title:'T', verifyCommand:{file:'npm',args:['test']}, doneEvidence:[{kind:'test'}], dependsOn:[]}]
      }}
    }));
    proc.kill();
    const p = result?.result?.content?.[0]?.text ? JSON.parse(result.result.content[0].text) : result;
    return { ok: p?.ok, errors: p?.errors?.map(e=>e.code) };
  });

  // ── Test 14: JSON with prototype pollution ─────────────────────
  await test('2.14 __proto__ prototype pollution in tool args', async () => {
    const proc = startServer();
    const payload = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mir_blueprint","arguments":{"__proto__":{"polluted":true},"projectRoot":"/tmp","runSlug":"proto-test"}}}';
    const result = await sendLine(proc, payload);
    proc.kill();
    const polluted = {}.polluted;
    return { result: result?.result ? 'got-result' : 'error', prototypePolluted: polluted === true };
  });

  // ── Test 15: mir_launch with invalid action ────────────────────
  await test('2.15 mir_launch with invalid action value', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_launch', arguments: {
        projectRoot: '/tmp',
        runSlug: 'test',
        action: 'HACK; rm -rf /'
      }}
    }));
    proc.kill();
    const p = result?.result?.content?.[0]?.text ? JSON.parse(result.result.content[0].text) : result;
    return { ok: p?.ok, errors: p?.errors?.map(e=>e.code) };
  });

  // ── Test 16: runSlug with path traversal ──────────────────────
  await test('2.16 runSlug with path traversal', async () => {
    const proc = startServer();
    const result = await sendLine(proc, JSON.stringify({
      jsonrpc:'2.0', id:1, method:'tools/call',
      params: { name: 'mir_launch', arguments: {
        projectRoot: '/tmp',
        runSlug: '../../../etc/passwd',
        action: 'status'
      }}
    }));
    proc.kill();
    const p = result?.result?.content?.[0]?.text ? JSON.parse(result.result.content[0].text) : result;
    return { ok: p?.ok, errors: p?.errors?.map(e=>e.code), runDir: p?.runDir };
  });

  console.log('\n=== AUDIT 2 COMPLETE ===');
}

main().catch(e => { console.error('Unhandled:', e); process.exit(1); });
