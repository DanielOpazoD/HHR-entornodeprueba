// Flake risk counts the test files that really failed or needed a retry in the
// complete execution manifest of this CI run. Without that evidence the risk is
// unmeasured: it is reported as such and never counted as zero.

import fs from 'node:fs';
import path from 'node:path';

export const TEST_EXECUTION_MANIFEST = 'reports/test-execution-manifest.json';

// CI test runs outside the manifest's capture scope (.github/workflows/ci-cd.yml). A failure
// there turns CI red; a re-run of one of them makes this run's flake risk unmeasured.
export const TEST_RUNS_OUTSIDE_MANIFEST = [
  'preview smoke lanes',
  'census startup performance',
  'critical coverage shards',
  'clinical-sync-release-gate',
  'Firestore rules, sync, UI and accounts emulator suites',
  'extra critical E2E steps (Rayen extension, urgency login, shared offscreen, remote census performance)',
  'tooling script tests',
];

const unmeasured = (reason, files = []) => ({
  measured: false,
  reason,
  fileCount: null,
  files,
  suites: [],
});

const countFailedAndRetriedFiles = observations => {
  const byFile = new Map();
  const count = (file, kind) => {
    const entry = byFile.get(file) ?? { file, failed: 0, retried: 0 };
    entry[kind] += 1;
    byFile.set(file, entry);
  };
  for (const observation of observations) {
    for (const suiteError of observation.suiteErrors ?? []) count(suiteError.file, 'failed');
    for (const testCase of observation.cases ?? []) {
      if (testCase.status === 'failed' || testCase.status === 'interrupted') {
        count(testCase.file, 'failed');
      } else if (testCase.flaky || testCase.attempts > 1) {
        count(testCase.file, 'retried');
      }
    }
  }
  return [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
};

/**
 * @param {unknown} manifest parsed reports/test-execution-manifest.json
 * @param {{gitSha?: string, runAttempt?: string | number}} [current] commit the evidence must
 *   belong to (reports keep the short SHA) and the attempt of the job that reads it
 */
export const measureFlakeRisk = (manifest, { gitSha, runAttempt } = {}) => {
  const manifestSha = String(manifest?.identity?.gitSha ?? '');
  if (gitSha && !manifestSha.startsWith(gitSha)) {
    return unmeasured(`manifest is for ${manifestSha || 'an unknown commit'}, not ${gitSha}`);
  }
  // A re-run replaces the failed attempt's evidence, and jobs outside the manifest
  // (preview smoke, performance, coverage) re-run without regenerating it.
  if (Number(runAttempt) > 1) {
    return unmeasured(
      `this report was built in run attempt ${runAttempt}; failures of earlier attempts are not in the manifest, see npm run report:ci-reruns`
    );
  }
  const observations = (Array.isArray(manifest?.observations) ? manifest.observations : []).filter(
    observation => observation?.mode === 'execution' && observation.accepted === true
  );
  const files = countFailedAndRetriedFiles(observations);
  const rerun = observations.find(observation => Number(observation.ci?.runAttempt) > 1);
  if (rerun) {
    return unmeasured(
      `${rerun.suiteId} ran again in attempt ${rerun.ci.runAttempt}; earlier attempts are not in the manifest, see npm run report:ci-reruns`,
      files
    );
  }
  if (!Array.isArray(manifest?.requiredCiSuites) || manifest.requiredCiSuites.length === 0) {
    return unmeasured('manifest does not list its required suites', files);
  }
  const missing = manifest.requiredCiSuites
    .map(suite => suite.suiteId)
    .filter(suiteId => !observations.some(observation => observation.suiteId === suiteId));
  if (missing.length > 0) {
    return unmeasured(`manifest lacks required suites: ${missing.join(', ')}`, files);
  }
  const issues = Array.isArray(manifest.issues) ? manifest.issues : [];
  if (issues.length > 0) {
    return unmeasured(`manifest records ${issues.length} issue(s): ${issues[0]}`, files);
  }

  return {
    measured: true,
    reason: null,
    fileCount: files.length,
    files,
    suites: observations.map(observation => observation.suiteId),
  };
};

/** @param {string} root @param {{gitSha?: string, runAttempt?: string | number}} [current] */
export const readMeasuredFlakeRisk = (root, current) => {
  const manifestPath = path.join(root, TEST_EXECUTION_MANIFEST);
  if (!fs.existsSync(manifestPath)) return unmeasured(`missing ${TEST_EXECUTION_MANIFEST}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return unmeasured(`${TEST_EXECUTION_MANIFEST} is not valid JSON`);
  }
  return measureFlakeRisk(manifest, current);
};

export const formatFlakeRiskSummary = flakeRisk =>
  flakeRisk.measured ? String(flakeRisk.fileCount) : `unmeasured (${flakeRisk.reason})`;
