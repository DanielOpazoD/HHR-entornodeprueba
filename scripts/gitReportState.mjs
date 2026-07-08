import { execSync } from 'node:child_process';

const runGitCommand = (root, command) =>
  execSync(command, { cwd: root, encoding: 'utf8' }).trimEnd();
// Tracked report files that `report:governance-snapshots` regenerates after
// the scorecard captures its `gitDirty` field. Excluding them from the dirty
// check prevents the scorecard from being flagged as stale just because a
// later step in the same pipeline rewrote these tracked files. Keep this
// list aligned with the tracked report artifacts that any CI flow rewrites
// before `check:report-freshness` runs.
const GENERATED_REPORT_STATUS_SUFFIXES = new Set([
  'reports/clinical-release-validation.json',
  'reports/clinical-release-validation.md',
  'reports/clinical-release-signoff.json',
  'reports/clinical-release-signoff.md',
  'reports/compatibility-governance.json',
  'reports/compatibility-governance.md',
  'reports/compatibility-import-governance.json',
  'reports/compatibility-import-governance.md',
  'reports/critical-coverage.json',
  'reports/critical-coverage.md',
  'reports/e2e/clinical-visual-release-report.json',
  'reports/guardrail-governance.json',
  'reports/guardrail-governance.md',
  'reports/legacy-bridge-governance.json',
  'reports/legacy-bridge-governance.md',
  'reports/maintenance-debt-scorecard.json',
  'reports/maintenance-debt-scorecard.md',
  'reports/operational-health.json',
  'reports/operational-health.md',
  'reports/quality-metrics.json',
  'reports/quality-metrics.md',
  'reports/release-confidence-matrix.json',
  'reports/release-confidence-matrix.md',
  'reports/release-readiness-scorecard.json',
  'reports/release-readiness-scorecard.md',
  'reports/runtime-contracts.json',
  'reports/runtime-contracts.md',
  'reports/sync-convergence.json',
  'reports/sync-convergence.md',
  'reports/system-confidence.json',
  'reports/system-confidence.md',
  'reports/test-runtime-governance.json',
  'reports/test-runtime-governance.md',
  'reports/technical-ownership-map.json',
  'reports/technical-ownership-map.md',
  'reports/ci-runtime-observed-profile.json',
  'reports/ci-runtime-observed-profile.md',
  'reports/unit-shard-runtime-profile.json',
  'reports/unit-shard-runtime-profile.md',
]);

const normalizeGitStatusPath = statusLine => {
  const rawLine = String(statusLine || '').trimEnd();
  if (!rawLine.trim()) return '';

  const content = rawLine.length > 3 ? rawLine.slice(3).trim() : '';
  if (!content) return '';

  if (content.includes(' -> ')) {
    return content.split(' -> ').pop()?.trim() || '';
  }

  return content;
};

export const isIgnorableGeneratedReportStatusLine = statusLine => {
  const normalizedPath = normalizeGitStatusPath(statusLine);
  return GENERATED_REPORT_STATUS_SUFFIXES.has(normalizedPath);
};

export const hasMeaningfulWorktreeChanges = gitStatusOutput =>
  String(gitStatusOutput || '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .some(line => !isIgnorableGeneratedReportStatusLine(line));

export const getGitSha = root => {
  try {
    return runGitCommand(root, 'git rev-parse --short HEAD');
  } catch {
    return 'unknown';
  }
};

export const getDirectMergeParentShas = root => {
  try {
    const [head, ...parents] = runGitCommand(
      root,
      'git rev-list --parents --abbrev-commit -n 1 HEAD'
    ).split(/\s+/);
    if (!head || parents.length < 2) {
      return [];
    }
    return parents;
  } catch {
    return [];
  }
};

export const isGitWorktreeDirty = root => {
  try {
    return hasMeaningfulWorktreeChanges(runGitCommand(root, 'git status --short'));
  } catch {
    return false;
  }
};

export const getGitReportState = root => ({
  gitSha: getGitSha(root),
  gitDirty: isGitWorktreeDirty(root),
});

export const formatWorktreeState = gitDirty => (gitDirty ? 'dirty' : 'clean');
