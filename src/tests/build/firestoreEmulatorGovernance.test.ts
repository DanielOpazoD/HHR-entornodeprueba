import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectFirestoreEmulatorGovernanceIssues } from '../../../scripts/firestoreEmulatorGovernanceSupport.mjs';

const tempRoots: string[] = [];

const writeText = (root: string, relativePath: string, value: string) => {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
};

const writeJson = (root: string, relativePath: string, value: unknown) =>
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);

const createGovernanceRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'firestore-emulator-governance-'));
  tempRoots.push(root);

  writeJson(root, 'package.json', {
    scripts: {
      test: 'npm run test:ci:unit && npm run test:rules:ci && npm run test:emulator:sync:ci',
      'test:rules':
        'RUN_FIRESTORE_RULES_TESTS=1 vitest run -c vitest.rules.config.ts src/tests/security/firestore-rules.test.ts',
      'test:rules:ci': 'bash scripts/run-firestore-rules-ci.sh',
      'test:emulator:sync':
        'RUN_FIRESTORE_EMULATOR_TESTS=1 vitest run -c vitest.emulator.config.ts',
      'test:emulator:ui':
        'RUN_FIRESTORE_EMULATOR_TESTS=1 vitest run -c vitest.emulator-ui.config.ts',
      'test:emulator:sync:ci': 'bash scripts/run-firestore-sync-emulator-ci.sh',
      'test:firestore:release:ci': 'bash scripts/run-firestore-release-gate-ci.sh',
      'test:firestore:cma:ci': 'bash scripts/run-firestore-cma-specialty-ci.sh',
      'ci:release-gate':
        'npm run ci:merge-gate && npm run report:release-evidence && npm run check:release-evidence && npm run test:firestore:release:ci',
    },
  });
  writeJson(root, 'scripts/config/release-confidence-pack.json', {
    profiles: {
      blocking: ['rules_ci', 'emulator_sync_ci'],
    },
    steps: [
      { id: 'rules_ci', command: 'npm run test:rules:ci', tier: 'blocking' },
      { id: 'emulator_sync_ci', command: 'npm run test:emulator:sync:ci', tier: 'blocking' },
    ],
  });
  writeText(
    root,
    'scripts/run-firestore-rules-ci.sh',
    [
      '#!/usr/bin/env bash',
      'source "$(dirname "$0")/lib/firebase-emulator-ci.sh"',
      'ensure_java_available',
      'run_firestore_emulator_exec "npm run test:rules"',
    ].join('\n')
  );
  writeText(
    root,
    'scripts/run-firestore-sync-emulator-ci.sh',
    [
      '#!/usr/bin/env bash',
      'source "$(dirname "$0")/lib/firebase-emulator-ci.sh"',
      'ensure_java_available',
      'run_firestore_emulator_exec "npm run test:emulator:sync && npm run test:emulator:ui"',
    ].join('\n')
  );
  writeText(
    root,
    'scripts/run-firestore-release-gate-ci.sh',
    'run_firestore_emulator_exec "npm run test:rules && npm run test:emulator:sync && npm run test:emulator:ui"'
  );
  writeText(
    root,
    'scripts/run-firestore-cma-specialty-ci.sh',
    [
      '#!/usr/bin/env bash',
      'source "$(dirname "$0")/lib/firebase-emulator-ci.sh"',
      'ensure_java_available',
      'run_firestore_emulator_exec "RUN_FIRESTORE_EMULATOR_TESTS=1 npx vitest run -c vitest.emulator.config.ts src/tests/emulator/cma-specialty-readback.emulator.test.ts"',
    ].join('\n')
  );
  writeText(
    root,
    'scripts/lib/firebase-emulator-ci.sh',
    [
      '#!/usr/bin/env bash',
      'ensure_java_available() { :; }',
      'run_firestore_emulator_exec() {',
      '  export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:18080}"',
      '  local firebase_config="$(mktemp)"',
      '  ./node_modules/.bin/firebase emulators:exec --config "$firebase_config" --only firestore "$1"',
      '}',
    ].join('\n')
  );
  writeText(
    root,
    '.github/workflows/ci-cd.yml',
    [
      'rules-emulator:',
      '  steps:',
      '    - name: Setup Java (Firestore emulator)',
      '    - name: Run Firestore rules tests with emulator',
      '      run: npm run test:rules:ci',
      '      env:',
      '        RUN_FIRESTORE_RULES_TESTS: 1',
      '    - name: Run Firestore emulator test suites (sync + UI)',
      '      run: npm run test:emulator:sync:ci',
      '      env:',
      '        RUN_FIRESTORE_EMULATOR_TESTS: 1',
    ].join('\n')
  );

  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('firestore emulator governance', () => {
  it('accepts the local, release and CI emulator wiring when all blocking paths are present', () => {
    const root = createGovernanceRoot();

    expect(collectFirestoreEmulatorGovernanceIssues(root)).toEqual([]);
  });

  it('fails when the shared emulator helper cannot override the Firestore port', () => {
    const root = createGovernanceRoot();
    writeText(
      root,
      'scripts/lib/firebase-emulator-ci.sh',
      [
        '#!/usr/bin/env bash',
        'ensure_java_available() { :; }',
        'run_firestore_emulator_exec() {',
        '  ./node_modules/.bin/firebase emulators:exec --only firestore "$1"',
        '}',
      ].join('\n')
    );

    expect(collectFirestoreEmulatorGovernanceIssues(root)).toContain(
      'scripts/lib/firebase-emulator-ci.sh must export FIRESTORE_EMULATOR_HOST for isolated local CI ports.'
    );
  });

  it('fails when the CI rules job stops running the sync emulator suite', () => {
    const root = createGovernanceRoot();
    writeText(
      root,
      '.github/workflows/ci-cd.yml',
      [
        'rules-emulator:',
        '  steps:',
        '    - name: Setup Java (Firestore emulator)',
        '    - name: Run Firestore rules tests with emulator',
        '      run: npm run test:rules:ci',
        '      env:',
        '        RUN_FIRESTORE_RULES_TESTS: 1',
      ].join('\n')
    );

    expect(collectFirestoreEmulatorGovernanceIssues(root)).toContain(
      '.github/workflows/ci-cd.yml must run npm run test:emulator:sync:ci in the rules-emulator job.'
    );
  });

  it('fails when the focused CMA release readback gate is not wired through the emulator helper', () => {
    const root = createGovernanceRoot();
    writeText(
      root,
      'scripts/run-firestore-cma-specialty-ci.sh',
      [
        '#!/usr/bin/env bash',
        'source "$(dirname "$0")/lib/firebase-emulator-ci.sh"',
        'ensure_java_available',
        'RUN_FIRESTORE_EMULATOR_TESTS=1 npx vitest run -c vitest.emulator.config.ts src/tests/emulator/cma-specialty-readback.emulator.test.ts',
      ].join('\n')
    );

    expect(collectFirestoreEmulatorGovernanceIssues(root)).toContain(
      'scripts/run-firestore-cma-specialty-ci.sh must execute the CMA specialty readback test through the Firestore emulator.'
    );
  });
});
