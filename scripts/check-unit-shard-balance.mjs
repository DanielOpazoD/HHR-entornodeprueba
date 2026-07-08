#!/usr/bin/env node

import { collectCurrentUnitShardBalanceIssues } from './unitShardBalanceSupport.mjs';

const issues = collectCurrentUnitShardBalanceIssues(process.cwd());

if (issues.length > 0) {
  console.error('[unit-shard-balance] Contract failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('[unit-shard-balance] OK');
