import fs from 'node:fs';
import path from 'node:path';

export const QUALITY_GROUP_PLAN = Object.freeze({
  boundaries: Object.freeze(['boundaries']),
  governance: Object.freeze(['governance', 'governance-inputs']),
  security: Object.freeze(['security', 'type-safety', 'hygiene']),
  size: Object.freeze(['size']),
  tests: Object.freeze(['tests']),
  reports: Object.freeze(['reports']),
});

export const getQualityGroupPlan = () =>
  Object.fromEntries(
    Object.entries(QUALITY_GROUP_PLAN).map(([group, sourceGroups]) => [group, [...sourceGroups]])
  );

export const getQualityGroupNames = () => Object.keys(QUALITY_GROUP_PLAN);

const normalizeScope = scope => (scope && scope !== 'all' ? scope : 'all');

export const selectQualitySteps = (checks, { group } = {}) => {
  const requestedGroup = normalizeScope(group);
  const qualityChecks = Array.isArray(checks) ? checks.filter(entry => entry?.id) : [];

  if (requestedGroup === 'all') {
    return qualityChecks;
  }

  const sourceGroups = QUALITY_GROUP_PLAN[requestedGroup];
  if (!sourceGroups) {
    throw new Error(
      `Unknown quality group "${requestedGroup}". Expected one of: ${getQualityGroupNames().join(', ')}`
    );
  }

  return qualityChecks.filter(entry => sourceGroups.includes(entry.group));
};

const countBy = (results, predicate) => results.filter(predicate).length;

export const buildQualityProfile = ({ scope, gitSha, startedAt, completedAt, results }) => {
  const safeResults = Array.isArray(results) ? results : [];
  const durationMs = safeResults.reduce((total, result) => total + (result.durationMs || 0), 0);
  const failed = countBy(safeResults, result => result.status === 'failed');
  const advisoryFailures = countBy(
    safeResults,
    result => result.status === 'failed' && result.reportOnly === true
  );
  const blockingFailures = countBy(
    safeResults,
    result => result.status === 'failed' && result.reportOnly !== true
  );

  const groups = {};
  for (const result of safeResults) {
    const group = result.group || 'ungrouped';
    groups[group] ||= { durationMs: 0, totalSteps: 0, failed: 0 };
    groups[group].durationMs += result.durationMs || 0;
    groups[group].totalSteps += 1;
    if (result.status === 'failed') {
      groups[group].failed += 1;
    }
  }

  return {
    generatedAt: completedAt,
    scope: normalizeScope(scope),
    gitSha,
    startedAt,
    completedAt,
    summary: {
      totalSteps: safeResults.length,
      passed: countBy(safeResults, result => result.status === 'passed'),
      failed,
      blockingFailures,
      advisoryFailures,
      durationMs,
    },
    groups,
    results: safeResults,
  };
};

const formatMs = durationMs => {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
};

const markdownRow = result =>
  `| \`${result.id}\` | ${result.group || 'ungrouped'} | ${result.status} | ${formatMs(
    result.durationMs || 0
  )} | ${result.reportOnly ? 'yes' : 'no'} |`;

export const buildQualityProfileMarkdown = profile => {
  const sortedResults = [...(profile.results || [])].sort(
    (left, right) => (right.durationMs || 0) - (left.durationMs || 0)
  );
  const lines = [
    '# CI Quality Static Profile',
    '',
    `Scope: \`${profile.scope}\``,
    `Commit: \`${profile.gitSha || 'unknown'}\``,
    `Duration: ${formatMs(profile.summary?.durationMs || 0)}`,
    `Blocking failures: ${profile.summary?.blockingFailures || 0}`,
    `Advisory failures: ${profile.summary?.advisoryFailures || 0}`,
    '',
    '## Groups',
    '',
    '| Group | Steps | Failed | Duration |',
    '| --- | ---: | ---: | ---: |',
  ];

  for (const [group, summary] of Object.entries(profile.groups || {}).sort(
    (left, right) => (right[1].durationMs || 0) - (left[1].durationMs || 0)
  )) {
    lines.push(
      `| ${group} | ${summary.totalSteps} | ${summary.failed} | ${formatMs(summary.durationMs)} |`
    );
  }

  lines.push(
    '',
    '## Steps',
    '',
    '| Step | Group | Status | Duration | Advisory |',
    '| --- | --- | --- | ---: | --- |'
  );
  for (const result of sortedResults) {
    lines.push(markdownRow(result));
  }

  return `${lines.join('\n')}\n`;
};

export const resolveQualityProfileBaseName = scope =>
  normalizeScope(scope) === 'all'
    ? 'ci-quality-static-profile'
    : `ci-quality-static-profile-${normalizeScope(scope)}`;

export const writeQualityProfileFiles = (profile, { root = process.cwd() } = {}) => {
  const reportsDir = path.join(root, 'reports');
  const baseName = resolveQualityProfileBaseName(profile.scope);
  const jsonPath = path.join(reportsDir, `${baseName}.json`);
  const mdPath = path.join(reportsDir, `${baseName}.md`);

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(profile, null, 2)}\n`);
  fs.writeFileSync(mdPath, buildQualityProfileMarkdown(profile));

  return { jsonPath, mdPath };
};
