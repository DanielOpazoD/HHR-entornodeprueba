export const POST_MERGE_EVIDENCE_COMMANDS = [
  { name: 'quality-metrics', command: 'npm run report:quality-metrics' },
  { name: 'system-confidence', command: 'npm run report:system-confidence' },
  { name: 'operational-health', command: 'npm run report:operational-health' },
  { name: 'clinical-release-validation', command: 'npm run report:clinical-release-validation' },
  { name: 'clinical-release-signoff', command: 'npm run report:clinical-release-signoff' },
  { name: 'release-confidence-matrix', command: 'npm run report:release-confidence-matrix' },
  { name: 'release-readiness-scorecard', command: 'npm run report:release-readiness-scorecard' },
  { name: 'maintenance-debt-scorecard', command: 'npm run report:maintenance-debt-scorecard' },
  { name: 'report-freshness-strict', command: 'npm run check:report-freshness:strict' },
];

export const REQUIRED_POST_MERGE_EVIDENCE_RESULTS = POST_MERGE_EVIDENCE_COMMANDS.map(
  command => command.name
);

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
