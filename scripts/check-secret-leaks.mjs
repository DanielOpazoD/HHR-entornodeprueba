#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  findFunctionSourcesMissingLocalSecretIgnore,
  scanTrackedFilesForSecretLeaks,
} from './lib/secretLeakChecks.mjs';

const root = process.cwd();

const trackedFiles = execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter(Boolean);

const { forbiddenPathMatches, failures } = scanTrackedFilesForSecretLeaks({
  root,
  trackedFiles,
});
const firebaseConfig = JSON.parse(
  readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')
);
const unsafeFunctionSources = findFunctionSourcesMissingLocalSecretIgnore(firebaseConfig);

if (forbiddenPathMatches.length > 0 || failures.length > 0 || unsafeFunctionSources.length > 0) {
  console.error('\nSecret leakage safeguards failed:\n');

  if (forbiddenPathMatches.length > 0) {
    console.error(
      '- Forbidden tracked paths detected (build artifacts or credential files must be untracked):'
    );
    for (const file of forbiddenPathMatches.slice(0, 20)) {
      console.error(`  - ${file}`);
    }
    if (forbiddenPathMatches.length > 20) {
      console.error(`  - ... and ${forbiddenPathMatches.length - 20} more`);
    }
  }

  for (const failure of failures) {
    console.error(`- [${failure.check.id}] ${failure.check.description} (${failure.file})`);
  }

  for (const source of unsafeFunctionSources) {
    console.error(
      `- Firebase Functions source ${source} must ignore .secret.local during packaging.`
    );
  }

  process.exit(1);
}

console.log('Secret leakage safeguards passed.');
