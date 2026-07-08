import fs from 'node:fs';
import path from 'node:path';

const readText = (root, relativePath) => {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
};

const readJson = (root, relativePath, issues) => {
  const source = readText(root, relativePath);
  if (source === null) {
    issues.push(`${relativePath} is missing.`);
    return null;
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    issues.push(
      `${relativePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
};

const requireScript = (scripts, name, expectedFragment, issues) => {
  const command = scripts?.[name];
  if (typeof command !== 'string') {
    issues.push(`package.json must define script "${name}".`);
    return;
  }

  if (!command.includes(expectedFragment)) {
    issues.push(`package.json script "${name}" must include "${expectedFragment}".`);
  }
};

const requireText = (source, relativePath, expectedFragment, message, issues) => {
  if (source === null) {
    issues.push(`${relativePath} is missing.`);
    return;
  }

  if (!source.includes(expectedFragment)) {
    issues.push(message);
  }
};

const getReleasePackStep = (releasePack, id) =>
  Array.isArray(releasePack?.steps) ? releasePack.steps.find(step => step?.id === id) : null;

export const collectFirestoreEmulatorGovernanceIssues = (root = process.cwd()) => {
  const issues = [];
  const packageJson = readJson(root, 'package.json', issues);
  const scripts = packageJson?.scripts;

  requireScript(scripts, 'test', 'npm run test:rules:ci', issues);
  requireScript(scripts, 'test', 'npm run test:emulator:sync:ci', issues);
  requireScript(scripts, 'test:rules', 'RUN_FIRESTORE_RULES_TESTS=1', issues);
  requireScript(scripts, 'test:rules', 'vitest.rules.config.ts', issues);
  requireScript(scripts, 'test:rules:ci', 'scripts/run-firestore-rules-ci.sh', issues);
  requireScript(scripts, 'test:emulator:sync', 'RUN_FIRESTORE_EMULATOR_TESTS=1', issues);
  requireScript(scripts, 'test:emulator:sync', 'vitest.emulator.config.ts', issues);
  requireScript(scripts, 'test:emulator:ui', 'RUN_FIRESTORE_EMULATOR_TESTS=1', issues);
  requireScript(scripts, 'test:emulator:ui', 'vitest.emulator-ui.config.ts', issues);
  requireScript(scripts, 'test:emulator:sync:ci', 'scripts/run-firestore-sync-emulator-ci.sh', issues);
  requireScript(scripts, 'test:firestore:release:ci', 'scripts/run-firestore-release-gate-ci.sh', issues);
  requireScript(scripts, 'test:firestore:cma:ci', 'scripts/run-firestore-cma-specialty-ci.sh', issues);
  requireScript(scripts, 'ci:release-gate', 'npm run test:firestore:release:ci', issues);

  const releasePack = readJson(root, 'scripts/config/release-confidence-pack.json', issues);
  const blockingProfile = Array.isArray(releasePack?.profiles?.blocking)
    ? releasePack.profiles.blocking
    : [];

  if (!blockingProfile.includes('rules_ci')) {
    issues.push('release-confidence blocking profile must include rules_ci.');
  }
  if (!blockingProfile.includes('emulator_sync_ci')) {
    issues.push('release-confidence blocking profile must include emulator_sync_ci.');
  }

  const rulesStep = getReleasePackStep(releasePack, 'rules_ci');
  if (rulesStep?.command !== 'npm run test:rules:ci') {
    issues.push('release-confidence step rules_ci must run "npm run test:rules:ci".');
  }
  const emulatorStep = getReleasePackStep(releasePack, 'emulator_sync_ci');
  if (emulatorStep?.command !== 'npm run test:emulator:sync:ci') {
    issues.push(
      'release-confidence step emulator_sync_ci must run "npm run test:emulator:sync:ci".'
    );
  }

  const rulesCi = readText(root, 'scripts/run-firestore-rules-ci.sh');
  requireText(
    rulesCi,
    'scripts/run-firestore-rules-ci.sh',
    'ensure_java_available',
    'scripts/run-firestore-rules-ci.sh must verify Java before starting the emulator.',
    issues
  );
  requireText(
    rulesCi,
    'scripts/run-firestore-rules-ci.sh',
    'run_firestore_emulator_exec "npm run test:rules"',
    'scripts/run-firestore-rules-ci.sh must execute npm run test:rules through the Firestore emulator.',
    issues
  );

  const syncCi = readText(root, 'scripts/run-firestore-sync-emulator-ci.sh');
  requireText(
    syncCi,
    'scripts/run-firestore-sync-emulator-ci.sh',
    'ensure_java_available',
    'scripts/run-firestore-sync-emulator-ci.sh must verify Java before starting the emulator.',
    issues
  );
  requireText(
    syncCi,
    'scripts/run-firestore-sync-emulator-ci.sh',
    'run_firestore_emulator_exec "npm run test:emulator:sync && npm run test:emulator:ui"',
    'scripts/run-firestore-sync-emulator-ci.sh must execute sync and UI suites through the Firestore emulator.',
    issues
  );

  const releaseGate = readText(root, 'scripts/run-firestore-release-gate-ci.sh');
  requireText(
    releaseGate,
    'scripts/run-firestore-release-gate-ci.sh',
    'npm run test:rules && npm run test:emulator:sync && npm run test:emulator:ui',
    'scripts/run-firestore-release-gate-ci.sh must include rules, sync and UI emulator suites.',
    issues
  );

  const cmaGate = readText(root, 'scripts/run-firestore-cma-specialty-ci.sh');
  requireText(
    cmaGate,
    'scripts/run-firestore-cma-specialty-ci.sh',
    'ensure_java_available',
    'scripts/run-firestore-cma-specialty-ci.sh must verify Java before starting the emulator.',
    issues
  );
  requireText(
    cmaGate,
    'scripts/run-firestore-cma-specialty-ci.sh',
    'run_firestore_emulator_exec',
    'scripts/run-firestore-cma-specialty-ci.sh must execute the CMA specialty readback test through the Firestore emulator.',
    issues
  );
  requireText(
    cmaGate,
    'scripts/run-firestore-cma-specialty-ci.sh',
    'src/tests/emulator/cma-specialty-readback.emulator.test.ts',
    'scripts/run-firestore-cma-specialty-ci.sh must target the CMA specialty readback emulator test.',
    issues
  );

  const emulatorHelper = readText(root, 'scripts/lib/firebase-emulator-ci.sh');
  requireText(
    emulatorHelper,
    'scripts/lib/firebase-emulator-ci.sh',
    'FIRESTORE_EMULATOR_HOST',
    'scripts/lib/firebase-emulator-ci.sh must export FIRESTORE_EMULATOR_HOST for isolated local CI ports.',
    issues
  );
  requireText(
    emulatorHelper,
    'scripts/lib/firebase-emulator-ci.sh',
    '--config',
    'scripts/lib/firebase-emulator-ci.sh must run firebase emulators with a temporary port-specific config.',
    issues
  );

  const workflow = readText(root, '.github/workflows/ci-cd.yml');
  requireText(
    workflow,
    '.github/workflows/ci-cd.yml',
    'rules-emulator:',
    '.github/workflows/ci-cd.yml must define the rules-emulator job.',
    issues
  );
  requireText(
    workflow,
    '.github/workflows/ci-cd.yml',
    'Setup Java (Firestore emulator)',
    '.github/workflows/ci-cd.yml rules-emulator job must set up Java.',
    issues
  );
  requireText(
    workflow,
    '.github/workflows/ci-cd.yml',
    'run: npm run test:rules:ci',
    '.github/workflows/ci-cd.yml must run npm run test:rules:ci in the rules-emulator job.',
    issues
  );
  requireText(
    workflow,
    '.github/workflows/ci-cd.yml',
    'RUN_FIRESTORE_RULES_TESTS: 1',
    '.github/workflows/ci-cd.yml must set RUN_FIRESTORE_RULES_TESTS=1 for rules CI.',
    issues
  );
  requireText(
    workflow,
    '.github/workflows/ci-cd.yml',
    'run: npm run test:emulator:sync:ci',
    '.github/workflows/ci-cd.yml must run npm run test:emulator:sync:ci in the rules-emulator job.',
    issues
  );
  requireText(
    workflow,
    '.github/workflows/ci-cd.yml',
    'RUN_FIRESTORE_EMULATOR_TESTS: 1',
    '.github/workflows/ci-cd.yml must set RUN_FIRESTORE_EMULATOR_TESTS=1 for emulator sync/UI CI.',
    issues
  );

  return issues;
};
