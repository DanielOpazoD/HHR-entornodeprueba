#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildValidationClosePlan } from './validationClosePlan.mjs';

const root = process.cwd();
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const sourceIdentity = () => {
  const hash = createHash('sha256');
  hash.update(git(['rev-parse', 'HEAD']));
  // Gates regenerate reports; source, config, dependencies and local env must stay fixed.
  hash.update(git(['diff', 'HEAD', '--binary', '--', '.', ':(exclude)reports']));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter(file => !file.startsWith('reports/'));
  const localConfig = fs.readdirSync(root).filter(file => file.startsWith('.env'));
  const files = [
    ...new Set([...untracked, ...localConfig, 'node_modules/.package-lock.json']),
  ].sort();
  for (const file of files) {
    hash.update(`${file}\0`);
    const absolute = path.join(root, file);
    hash.update(fs.existsSync(absolute) ? fs.readFileSync(absolute) : 'missing');
    hash.update('\0');
  }
  return hash.digest('hex');
};

try {
  const identity = sourceIdentity();
  const assertUnchanged = () => {
    if (sourceIdentity() !== identity) {
      throw new Error('Inputs changed during validation. Restart ci:close for the new tree.');
    }
  };
  const plan = buildValidationClosePlan({
    scripts: readJson('package.json').scripts,
    confidence: readJson('scripts/config/release-confidence-pack.json'),
  });
  assertUnchanged();
  for (const { script, args } of plan) {
    assertUnchanged();
    console.log(
      `[validation-close] npm run ${script}${args.length ? ` -- ${args.join(' ')}` : ''}`
    );
    const result = spawnSync('npm', ['run', script, ...(args.length ? ['--', ...args] : [])], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status !== 0) {
      if (result.status === null) {
        console.error(
          `[validation-close] Runner did not complete: ${result.error?.message || result.signal}`
        );
      }
      process.exit(result.status ?? 1);
    }
    assertUnchanged();
  }
  console.log('[validation-close] Merge gate and blocking release-confidence passed.');
} catch (error) {
  console.error(`[validation-close] ${error.message}`);
  process.exitCode = 1;
}
