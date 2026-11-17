import { execSync } from 'node:child_process';

const runGitCommand = (root, command) =>
  execSync(command, { cwd: root, encoding: 'utf8' }).trimEnd();
// Generated reports are written to the ignored reports/ folder and none is
// tracked, so every `git status` line is a real source change.
export const hasMeaningfulWorktreeChanges = gitStatusOutput =>
  String(gitStatusOutput || '').trim() !== '';

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

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * A main push that reuses a pull request run (scripts/ciEvidenceReuseSupport.mjs)
 * downloads evidence produced by that run, for the commit GitHub tested, not by
 * this run for HEAD. CI declares that run, its latest attempt, commit and tree in
 * CI_EVIDENCE_*; checks then compare producers with that run (its id, attempt and
 * commit) instead of this one, and the evidence counts as current only while the
 * tree is HEAD's tree. Otherwise null: evidence must then match this run and HEAD.
 */
export const getReusedEvidenceSource = (root, env = process.env) => {
  const {
    CI_EVIDENCE_RUN_ID: runId,
    CI_EVIDENCE_RUN_ATTEMPT: runAttempt,
    CI_EVIDENCE_COMMIT: commit,
    CI_EVIDENCE_TREE: tree,
  } = env;
  if (
    !/^\d+$/.test(runId || '') ||
    !/^[1-9]\d*$/.test(runAttempt || '') ||
    !FULL_SHA.test(commit || '') ||
    !FULL_SHA.test(tree || '')
  )
    return null;
  try {
    return runGitCommand(root, 'git rev-parse HEAD^{tree}') === tree
      ? { runId, runAttempt, commit }
      : null;
  } catch {
    return null;
  }
};

/** True when a (possibly short) report SHA names the reused evidence commit. */
export const isReusedEvidenceCommit = (sha, source) =>
  Boolean(source) &&
  /^[0-9a-f]{7,40}$/i.test(String(sha || '')) &&
  source.commit.startsWith(String(sha).toLowerCase());
