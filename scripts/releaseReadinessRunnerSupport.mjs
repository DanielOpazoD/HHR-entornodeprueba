import fs from 'node:fs';
import path from 'node:path';
import {
  getEvidenceNode,
  getEvidenceReportDependencyFiles,
  getEvidenceReportDependencies,
} from './evidenceDependencyGraph.mjs';

const CRITICAL_COVERAGE_ID = 'critical-coverage';
const RELEASE_READINESS_SCORECARD_ID = 'release-readiness-scorecard';

export const RELEASE_READINESS_INPUTS = getEvidenceReportDependencies(RELEASE_READINESS_SCORECARD_ID);

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const hasSameSha = (left, right) => {
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
};

const getArtifactMtimeMs = (root, relativePath) => fs.statSync(path.join(root, relativePath)).mtimeMs;

const getOldestExistingArtifactMtimeMs = (root, artifacts) =>
  Math.min(...artifacts.map(artifact => getArtifactMtimeMs(root, artifact)));

const getMissingFiles = (root, files) =>
  files.filter(file => !fs.existsSync(path.join(root, file)));

const getDependencyFiles = id => getEvidenceReportDependencyFiles(id);

export const getCriticalCoverageReuseInputs = () => {
  const node = getEvidenceNode(CRITICAL_COVERAGE_ID);
  return {
    artifacts: node?.artifacts || [],
    dependencies: getDependencyFiles(CRITICAL_COVERAGE_ID),
  };
};

export const isCriticalCoverageArtifactReusable = (root, gitState) => {
  const { artifacts, dependencies } = getCriticalCoverageReuseInputs();
  const missingArtifacts = getMissingFiles(root, artifacts);
  if (missingArtifacts.length > 0) {
    return {
      reusable: false,
      reason: `missing artifacts: ${missingArtifacts.join(', ')}`,
    };
  }

  let parsedReport;
  try {
    parsedReport = readJson(path.join(root, 'reports/critical-coverage.json'));
  } catch (error) {
    return {
      reusable: false,
      reason: `invalid reports/critical-coverage.json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!hasSameSha(String(parsedReport.gitSha || ''), gitState.gitSha)) {
    return {
      reusable: false,
      reason: `gitSha mismatch: report=${parsedReport.gitSha || 'missing'} current=${gitState.gitSha}`,
    };
  }

  if (typeof parsedReport.gitDirty === 'boolean' && parsedReport.gitDirty !== gitState.gitDirty) {
    return {
      reusable: false,
      reason: `gitDirty mismatch: report=${parsedReport.gitDirty ? 'dirty' : 'clean'} current=${gitState.gitDirty ? 'dirty' : 'clean'}`,
    };
  }

  const artifactMtimeMs = getOldestExistingArtifactMtimeMs(root, artifacts);
  for (const dependency of dependencies) {
    const dependencyPath = path.join(root, dependency);
    if (!fs.existsSync(dependencyPath)) {
      continue;
    }

    if (fs.statSync(dependencyPath).mtimeMs > artifactMtimeMs) {
      return {
        reusable: false,
        reason: `${dependency} is newer than reports/critical-coverage.*`,
      };
    }
  }

  return {
    reusable: true,
    reason: `reports/critical-coverage.* match ${gitState.gitSha}`,
  };
};

export const buildReleaseReadinessPlan = (root, gitState) => {
  const criticalCoverageReuse = isCriticalCoverageArtifactReusable(root, gitState);

  return {
    gitSha: gitState.gitSha,
    gitDirty: gitState.gitDirty,
    steps: RELEASE_READINESS_INPUTS.map(id => {
      const node = getEvidenceNode(id);
      const command = node?.command || id;
      const reuse = id === CRITICAL_COVERAGE_ID && criticalCoverageReuse.reusable;
      return {
        id,
        command,
        action: reuse ? 'reuse' : 'run',
        reason: id === CRITICAL_COVERAGE_ID ? criticalCoverageReuse.reason : 'required release readiness input',
        artifacts: node?.artifacts || [],
      };
    }),
    finalizer: 'node scripts/report-release-readiness-scorecard.mjs',
  };
};

export const formatReleaseReadinessPlanSummary = plan => {
  const lines = [
    `[release-readiness] Inputs for ${plan.gitSha} (${plan.gitDirty ? 'dirty' : 'clean'} worktree):`,
  ];

  for (const step of plan.steps) {
    const prefix = step.action === 'reuse' ? 'reuse' : 'run';
    lines.push(`- ${prefix}: ${step.command} (${step.reason})`);
  }

  lines.push(`- run: ${plan.finalizer}`);
  return lines.join('\n');
};
