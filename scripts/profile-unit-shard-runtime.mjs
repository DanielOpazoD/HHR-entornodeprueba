#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUnitShardBalanceConfig } from './unitShardBalanceSupport.mjs';

const root = process.cwd();
const reportDir = path.join(root, 'reports');
const rawProfile = path.join(reportDir, 'unit-shard-vitest-profile.json');
const config = loadUnitShardBalanceConfig(root);
const excludes = (config.excludedFromUnitSuite || []).flatMap(glob => ['--exclude', glob]);

fs.mkdirSync(reportDir, { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  npx,
  [
    'vitest',
    'run',
    ...excludes,
    '--reporter=json',
    `--outputFile=${rawProfile}`,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: process.env.CI || 'true' },
  }
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

const reportResult = spawnSync(process.execPath, ['scripts/report-unit-shard-runtime-profile.mjs'], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(reportResult.status || 0);
