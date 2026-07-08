import path from 'node:path';
import { getEvidenceNode } from './evidenceDependencyGraph.mjs';
import { getGitReportState } from './gitReportState.mjs';

export const GOVERNANCE_SNAPSHOT_STEP_IDS = [
  'release-readiness-scorecard',
  'clinical-release-signoff',
  'runtime-contracts',
  'sync-convergence',
  'serverless-runtime-governance',
  'serverless-sensitive-coverage',
  'sustainable-change-policy',
  'maintenance-debt-scorecard',
];

export const GOVERNANCE_SNAPSHOT_PROFILE_BASENAME = 'ci-governance-snapshot-profile';

export const getGovernanceSnapshotSteps = () =>
  GOVERNANCE_SNAPSHOT_STEP_IDS.map(id => {
    const node = getEvidenceNode(id);
    return {
      id,
      command: node?.command || `report:${id}`,
      artifacts: node?.artifacts || [],
    };
  });

export const buildGovernanceSnapshotProfile = ({
  root,
  startedAt,
  completedAt,
  steps,
}) => {
  const durationMs = completedAt.getTime() - startedAt.getTime();
  const failedSteps = steps.filter(step => step.status !== 'passed');

  return {
    generatedAt: completedAt.toISOString(),
    ...getGitReportState(root),
    profile: GOVERNANCE_SNAPSHOT_PROFILE_BASENAME,
    durationMs,
    durationSeconds: Number((durationMs / 1000).toFixed(1)),
    status: failedSteps.length === 0 ? 'passed' : 'failed',
    failedSteps: failedSteps.map(step => step.id),
    steps,
    outputs: {
      json: path.join('reports', `${GOVERNANCE_SNAPSHOT_PROFILE_BASENAME}.json`),
      markdown: path.join('reports', `${GOVERNANCE_SNAPSHOT_PROFILE_BASENAME}.md`),
    },
  };
};

const formatDuration = durationMs => {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
};

export const formatGovernanceSnapshotProfileMarkdown = profile => `# CI Governance Snapshot Profile

- Generated: ${profile.generatedAt}
- Commit: ${profile.gitSha}
- Worktree: ${profile.gitDirty ? 'dirty' : 'clean'}
- Status: ${profile.status}
- Duration: ${formatDuration(profile.durationMs)}

## Steps

| Step | Status | Duration | Exit | Artifacts |
| --- | --- | ---: | ---: | --- |
${profile.steps
  .map(
    step =>
      `| \`${step.command}\` | ${step.status} | ${formatDuration(step.durationMs)} | ${step.exitCode ?? '-'} | ${step.artifacts.map(artifact => `\`${artifact}\``).join('<br>')} |`
  )
  .join('\n')}

## Notes

- \`report:release-readiness-scorecard\` reuses \`reports/critical-coverage.*\` only when the artifact declares the current git state and its dependencies are not newer than the artifact.
- The profile is CI evidence for the runtime cost of regenerating canonical release snapshots.
`;
