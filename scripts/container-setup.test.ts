import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SETUP_KILL, SETUP_WRAPPER, createLineBatcher, setupExecArgs, setupKillArgs } from '../src/main/container/docker.ts';

const hasSetsid = process.platform === 'linux' && spawnSync('setsid', ['--version']).status === 0;

test('setup runs as the todex user in its own process group', () => {
  assert.deepEqual(setupExecArgs('c1', '/work', 'echo hi', '/tmp/x.pgid'), [
    'exec', '-u', 'todex', '-w', '/work', 'c1', 'setsid', '-w', 'bash', '-c', SETUP_WRAPPER, '/tmp/x.pgid', 'echo hi',
  ]);
  assert.deepEqual(setupKillArgs('c1', '/tmp/x.pgid'), ['exec', '-u', 'todex', 'c1', 'bash', '-c', SETUP_KILL, '/tmp/x.pgid']);
});

test('the kill script ends the whole setup process group', { skip: !hasSetsid }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'todex-setup-'));
  try {
    const pgidFile = join(dir, 'run.pgid');
    const childPid = join(dir, 'child.pid');
    // The script starts a background grandchild, like a package manager would.
    const script = `sleep 300 & echo $! > ${JSON.stringify(childPid)}; wait`;
    const run = spawn('setsid', ['-w', 'bash', '-c', SETUP_WRAPPER, pgidFile, script], { stdio: 'ignore' });
    const exited = new Promise<number | null>((resolve) => run.on('close', (code) => resolve(code)));
    for (let i = 0; i < 50 && !existsSync(childPid); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    const grandchild = Number(readFileSync(childPid, 'utf8'));
    assert.ok(grandchild > 0);
    const kill = spawnSync('bash', ['-c', SETUP_KILL, pgidFile], { timeout: 15_000 });
    assert.equal(kill.status, 0);
    assert.notEqual(await exited, 0);
    assert.throws(() => process.kill(grandchild, 0));
    assert.equal(existsSync(pgidFile), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a finished run keeps its exit status and removes its pgid file', { skip: !hasSetsid }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'todex-setup-'));
  try {
    const pgidFile = join(dir, 'run.pgid');
    const run = spawnSync('setsid', ['-w', 'bash', '-c', SETUP_WRAPPER, pgidFile, 'exit 3']);
    assert.equal(run.status, 3);
    assert.equal(existsSync(pgidFile), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('output lines are batched by time and size', async () => {
  const batches: string[][] = [];
  const batcher = createLineBatcher((lines) => batches.push(lines), 20, 10);
  batcher.push('a');
  batcher.push('b');
  assert.equal(batches.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(batches, [['a', 'b']]);
  batcher.push('0123456789');
  assert.deepEqual(batches.at(-1), ['0123456789']);
  batcher.push('tail');
  batcher.flush();
  assert.deepEqual(batches.at(-1), ['tail']);
  batcher.flush();
  assert.equal(batches.length, 3);
});
