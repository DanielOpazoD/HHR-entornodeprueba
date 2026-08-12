import { REPORT_FRESHNESS_CONTRACTS } from './reportFreshnessSupport.mjs';
import { getReleaseEvidenceRefreshSteps } from './releaseEvidenceContract.mjs';

const releaseEvidenceCommands = getReleaseEvidenceRefreshSteps({
  // Main reuses the coverage artifact produced by this same workflow run.
  skipReportIds: ['critical-coverage'],
}).map(step => ({ name: step.id, command: `npm run ${step.command}` }));

export const POST_MERGE_EVIDENCE_COMMANDS = [
  { name: 'preview-bootstrap-evidence', command: 'npm run check:preview-bootstrap-evidence' },
  {
    name: 'critical-coverage-freshness',
    command: 'npm run check:report-freshness:strict -- --only critical-coverage',
  },
  ...releaseEvidenceCommands,
  { name: 'report-freshness-strict', command: 'npm run check:report-freshness:strict' },
  { name: 'release-evidence-contract', command: 'npm run report:release-evidence-contract' },
  {
    name: 'release-evidence-contract-strict',
    command: 'npm run check:release-evidence-contract:strict',
  },
];

export const REQUIRED_POST_MERGE_EVIDENCE_RESULTS = POST_MERGE_EVIDENCE_COMMANDS.map(
  command => command.name
);

export const collectPostMergeEvidenceContractIssues = (
  commands = POST_MERGE_EVIDENCE_COMMANDS,
  freshnessContracts = REPORT_FRESHNESS_CONTRACTS
) => {
  const configuredCommands = commands.map(entry => entry.command);
  const strictCommand = 'npm run check:report-freshness:strict';
  const strictIndex = configuredCommands.indexOf(strictCommand);
  const issues = strictIndex === -1 ? [`postmerge:evidence does not run ${strictCommand}`] : [];

  const criticalFreshnessCommand =
    'npm run check:report-freshness:strict -- --only critical-coverage';
  const criticalFreshnessIndex = configuredCommands.indexOf(criticalFreshnessCommand);
  if (criticalFreshnessIndex === -1) {
    issues.push(`postmerge:evidence does not validate downloaded critical coverage`);
  } else if (strictIndex !== -1 && criticalFreshnessIndex > strictIndex) {
    issues.push(`postmerge:evidence validates critical coverage after strict freshness`);
  }

  for (const contract of freshnessContracts) {
    if (contract.id === 'critical-coverage') continue;
    const refreshCommand = `npm run ${contract.refreshScript}`;
    const refreshIndex = configuredCommands.indexOf(refreshCommand);
    if (refreshIndex === -1) {
      issues.push(`postmerge:evidence does not regenerate ${refreshCommand}`);
    } else if (strictIndex !== -1 && refreshIndex > strictIndex) {
      issues.push(`postmerge:evidence runs ${refreshCommand} after strict freshness`);
    }
  }

  const manifestIndex = configuredCommands.indexOf('npm run report:release-evidence-contract');
  const contractIndex = configuredCommands.indexOf(
    'npm run check:release-evidence-contract:strict'
  );
  if (manifestIndex === -1) {
    issues.push('postmerge:evidence does not generate the release evidence contract');
  } else if (strictIndex !== -1 && manifestIndex < strictIndex) {
    issues.push('postmerge:evidence generates the release evidence contract before freshness');
  }
  if (contractIndex === -1) {
    issues.push('postmerge:evidence does not validate the release evidence contract');
  } else if (manifestIndex !== -1 && contractIndex < manifestIndex) {
    issues.push('postmerge:evidence validates the release evidence contract before generating it');
  }

  return issues;
};

const statusLabel = status => (status === 'passed' ? 'verde' : 'revisar');

const isSameCommit = (recordedCommit, currentCommit) =>
  recordedCommit === currentCommit ||
  recordedCommit.startsWith(currentCommit) ||
  currentCommit.startsWith(recordedCommit);

export const findPostMergeEvidenceIssues = ({ evidence, currentCommit }) => {
  const issues = [];
  const recordedCommit = typeof evidence?.commit === 'string' ? evidence.commit : '';
  const results = Array.isArray(evidence?.results) ? evidence.results : [];

  if (!recordedCommit) {
    issues.push('reports/postmerge-evidence.json does not declare commit.');
  } else if (currentCommit && !isSameCommit(recordedCommit, currentCommit)) {
    issues.push(
      `reports/postmerge-evidence.json was generated for ${recordedCommit}, current HEAD is ${currentCommit}.`
    );
  }

  const resultByName = new Map(results.map(result => [result.name, result]));
  for (const requiredName of REQUIRED_POST_MERGE_EVIDENCE_RESULTS) {
    const result = resultByName.get(requiredName);
    if (!result) {
      issues.push(`reports/postmerge-evidence.json is missing result ${requiredName}.`);
      continue;
    }

    if (result.status !== 'passed') {
      issues.push(`reports/postmerge-evidence.json records ${requiredName} as ${result.status}.`);
    }
  }

  return issues;
};

export const buildPostMergeEvidencePayload = ({
  generatedAt,
  branch,
  commit,
  workflow = {},
  results,
}) => {
  const safeResults = Array.isArray(results) ? results : [];
  const freshness = safeResults.find(result => result.name === 'report-freshness-strict');
  const passedBlocks = safeResults.filter(result => result.status === 'passed').length;
  const failedBlocks = safeResults.filter(result => result.status !== 'passed').length;

  return {
    generatedAt,
    branch,
    commit,
    provenance: {
      evidenceKind: 'post-merge-main',
      generatedFor: {
        branch,
        gitSha: commit,
      },
      workflow: {
        eventName: workflow.eventName || 'local',
        runId: workflow.runId || 'local',
        runAttempt: workflow.runAttempt || '1',
      },
    },
    summary: {
      totalBlocks: safeResults.length,
      passedBlocks,
      failedBlocks,
      freshnessStrictStatus: freshness?.status || 'missing',
    },
    results: safeResults,
  };
};

export const buildPostMergeEvidenceSummary = ({ generatedAt, branch, commit, results }) => {
  const freshness = results.find(result => result.name === 'report-freshness-strict');
  const lines = [
    '# Evidencia post-merge',
    '',
    `Generado: ${generatedAt}`,
    `Rama: \`${branch}\``,
    `Commit: \`${commit}\``,
    `Freshness estricta: ${statusLabel(freshness?.status)}`,
    '',
    '| Bloque | Estado | Comando |',
    '| --- | --- | --- |',
  ];

  for (const result of results) {
    lines.push(`| ${result.name} | ${result.status} | \`${result.command}\` |`);
  }

  return `${lines.join('\n')}\n`;
};
