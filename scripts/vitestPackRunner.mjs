import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const runVitestPack = files => {
  const uniqueFiles = [...new Set(files)];
  if (uniqueFiles.length === 0) throw new Error('No test files configured');
  for (const file of uniqueFiles) {
    if (
      typeof file !== 'string' ||
      !/^src\/tests\/[^\s]+\.test\.tsx?$/.test(file) ||
      !fs.existsSync(path.resolve(file))
    ) {
      throw new Error(`Invalid or missing test file: ${file}`);
    }
  }

  const maxWorkers = process.env.VITEST_MAX_WORKERS || '4';
  if (!/^[1-9]\d*$/.test(maxWorkers)) {
    throw new Error('VITEST_MAX_WORKERS must be a positive integer');
  }

  const result = spawnSync(
    'npx',
    ['vitest', 'run', ...uniqueFiles, '--isolate', '--maxWorkers', maxWorkers],
    { cwd: process.cwd(), stdio: 'inherit', env: process.env }
  );
  if (result.status === null) {
    console.error(
      `[vitest-pack] Runner did not complete: ${result.error?.message || result.signal}`
    );
  }
  return result.status ?? 1;
};
