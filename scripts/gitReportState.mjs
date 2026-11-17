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
