import { execSync } from 'node:child_process';

const runGitCommand = (root, command) =>
  execSync(command, { cwd: root, encoding: 'utf8' }).trimEnd();
// These tracked snapshots still need reader migration or a clinical-owner decision.
// Other generated reports are ignored by Git and must not need status exceptions.
// Keep this temporary set limited to the remaining tracked snapshots and the
// clinical visual evidence retained by the same release pipeline.
const GENERATED_REPORT_STATUS_SUFFIXES = new Set([
  'reports/clinical-release-validation.json',
  'reports/clinical-release-validation.md',
  'reports/clinical-release-signoff.json',
  'reports/clinical-release-signoff.md',
  'reports/e2e/clinical-visual-release-report.json',
  'reports/quality-metrics.json',
  'reports/quality-metrics.md',
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
