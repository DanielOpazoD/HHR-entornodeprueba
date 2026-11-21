import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCommandConcurrency,
  runCommandsWithConcurrency,
} from '../lib/parallelCommandRunner.mjs';

test('resolveCommandConcurrency respects explicit positive HHR_CHECK_CONCURRENCY', () => {
  assert.equal(resolveCommandConcurrency(4, { HHR_CHECK_CONCURRENCY: '2' }), 2);
  assert.equal(resolveCommandConcurrency(4, { HHR_CHECK_CONCURRENCY: '0' }) >= 1, true);
  assert.equal(resolveCommandConcurrency(4, { HHR_CHECK_CONCURRENCY: 'invalid' }) >= 1, true);
});

test('runCommandsWithConcurrency preserves input order and reports failures without throwing', async () => {
  const tasks = [
    {
      command: process.execPath,
      args: ['-e', 'setTimeout(() => console.log("first"), 60)'],
    },
    {
      command: process.execPath,
      args: ['-e', 'console.log("second")'],
    },
    {
      command: process.execPath,
      args: ['-e', 'console.error("boom"); process.exit(3)'],
    },
  ];

  const results = await runCommandsWithConcurrency(tasks, { concurrency: 3 });

  assert.equal(results.length, 3);
  assert.equal(results[0].status, 0);
  assert.equal(results[0].stdout.trim(), 'first');
  assert.equal(results[1].status, 0);
  assert.equal(results[1].stdout.trim(), 'second');
  assert.equal(results[2].status, 3);
  assert.equal(results[2].stderr.trim(), 'boom');
});
