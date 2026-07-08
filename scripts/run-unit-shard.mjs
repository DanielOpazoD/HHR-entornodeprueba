#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  buildUnitShardBalanceReport,
  collectCurrentUnitShardBalanceIssues,
  parseUnitShardRunArguments,
} from './unitShardBalanceSupport.mjs';

const root = process.cwd();
const rawArgs = process.argv.slice(2);

let requestedShard;
let passthroughArgs;
try {
  ({ requestedShard, passthroughArgs } = parseUnitShardRunArguments(rawArgs));
} catch (error) {
  console.error(`[unit-shard] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const issues = collectCurrentUnitShardBalanceIssues(root);
if (issues.length > 0) {
  console.error('[unit-shard] Balance contract failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

const report = buildUnitShardBalanceReport(root);
if (requestedShard.count !== report.summary.shardCount) {
  console.error(
    `[unit-shard] Expected ${report.summary.shardCount} shards but received ${requestedShard.count}.`
  );
  process.exit(1);
}

const shard = report.shards.find(candidate => candidate.index === requestedShard.index);
if (!shard) {
  console.error(`[unit-shard] Unknown shard index ${requestedShard.index}.`);
  process.exit(1);
}
if (shard.files.length === 0) {
  console.error(`[unit-shard] Shard ${requestedShard.index}/${requestedShard.count} has no files.`);
  process.exit(1);
}

console.log(
  `[unit-shard] Running shard ${requestedShard.index}/${requestedShard.count}: ${shard.files.length} files, estimated ${(shard.estimatedDurationMs / 1000).toFixed(1)}s.`
);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['vitest', 'run', ...passthroughArgs, ...shard.files], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CI: process.env.CI || 'true' },
});

process.exit(result.status || 0);
