// Flake risk counts the test files that really failed or needed a retry in the
// execution manifest of this CI run. Without that manifest the risk is
// unmeasured: it is reported as such and never counted as zero.

import fs from 'node:fs';
import path from 'node:path';

export const TEST_EXECUTION_MANIFEST = 'reports/test-execution-manifest.json';

const unmeasured = reason => ({ measured: false, reason, fileCount: null, files: [], suites: [] });

/**
 * @param {unknown} manifest parsed reports/test-execution-manifest.json
 * @param {string} [expectedGitSha] commit the evidence must belong to (reports keep the short SHA)
 */
export const measureFlakeRisk = (manifest, expectedGitSha) => {
  const manifestSha = String(manifest?.identity?.gitSha ?? '');
  if (expectedGitSha && !manifestSha.startsWith(expectedGitSha)) {
    return unmeasured(
      `manifest is for ${manifestSha || 'an unknown commit'}, not ${expectedGitSha}`
    );
  }
  const observations = (Array.isArray(manifest?.observations) ? manifest.observations : []).filter(
    observation => observation?.mode === 'execution'
  );
  if (observations.length === 0) return unmeasured('manifest has no executed suites');
  // A re-run job replaces its evidence, so the failure that caused the re-run is gone.
  const rerun = observations.find(observation => Number(observation.ci?.runAttempt) > 1);
  if (rerun) {
    return unmeasured(
      `${rerun.suiteId} ran again in attempt ${rerun.ci.runAttempt}; earlier attempts are not in the manifest, see npm run report:ci-reruns`
    );
  }

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

  const files = [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
  return {
    measured: true,
    reason: null,
    fileCount: files.length,
    files,
    suites: observations.map(observation => observation.suiteId),
  };
};

/** @param {string} root @param {string} [expectedGitSha] */
export const readMeasuredFlakeRisk = (root, expectedGitSha) => {
  const manifestPath = path.join(root, TEST_EXECUTION_MANIFEST);
  if (!fs.existsSync(manifestPath)) return unmeasured(`missing ${TEST_EXECUTION_MANIFEST}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return unmeasured(`${TEST_EXECUTION_MANIFEST} is not valid JSON`);
  }
  return measureFlakeRisk(manifest, expectedGitSha);
};

export const formatFlakeRiskSummary = flakeRisk =>
  flakeRisk.measured ? String(flakeRisk.fileCount) : `unmeasured (${flakeRisk.reason})`;
