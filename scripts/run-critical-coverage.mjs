#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { getCriticalCoverageTestTargets } from './criticalCoverageSupport.mjs';

const root = process.cwd();
const vitestEntry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const targets = getCriticalCoverageTestTargets(root);
const requested = process.argv.slice(2);
const blobDirectory = 'reports/critical-coverage-blobs';
let args = ['run', '-c', 'vitest.critical-coverage.config.ts', ...targets];

if (requested.length > 0) {
  if (requested.length === 1 && /^--shard=[12]\/2$/.test(requested[0])) {
    const index = requested[0].match(/\d/)[0];
    args.push(
      requested[0],
      '--reporter=default',
      '--reporter=blob',
      `--outputFile.blob=${blobDirectory}/shard-${index}.json`,
      `--coverage.reportsDirectory=coverage/critical-${index}`
    );
  } else if (requested.length === 1 && requested[0] === '--merge-shards') {
    const files = fs.existsSync(blobDirectory) ? fs.readdirSync(blobDirectory).sort() : [];
    if (JSON.stringify(files) !== JSON.stringify(['shard-1.json', 'shard-2.json'])) {
      console.error(
        '[critical-coverage] Both shard reports are required; unexpected files are rejected.'
      );
      process.exit(1);
    }
    args = ['-c', 'vitest.critical-coverage.config.ts', `--merge-reports=${blobDirectory}`];
  } else {
    console.error('[critical-coverage] Expected --shard=1/2, --shard=2/2 or --merge-shards.');
    process.exit(1);
  }
}

if (targets.length === 0) {
  console.error('[critical-coverage] No critical coverage test targets were configured.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [vitestEntry, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.error || result.signal) {
  console.error(
    `[critical-coverage] Runner did not complete: ${result.error?.message || result.signal}`
  );
}
process.exit(result.status ?? 1);
