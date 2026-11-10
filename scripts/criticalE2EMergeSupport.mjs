import {
  collectRequiredCiEvidenceIssues,
  validateTestEvidence,
} from './testExecutionManifestSupport.mjs';

export const mergeCriticalLaneReports = ({ records, identity, ci, expected }) => {
  const observations = records.map(evidence => {
    if (String(evidence.ci?.runAttempt) !== String(ci.runAttempt))
      throw new Error('Lane attempt differs');
    return { ...evidence, ...validateTestEvidence(evidence, identity, ci), accepted: true };
  });
  const issues = collectRequiredCiEvidenceIssues(observations, expected);
  if (issues.length) throw new Error(issues.join('\n'));
  const critical = records.filter(record => record.suiteId.startsWith('critical-'));
  const report = {
    ...critical[0].report,
    suites: critical.flatMap(record => record.report.suites),
    errors: critical.flatMap(record => record.report.errors || []),
    stats: { ...critical[0].report.stats },
  };
  for (const key of ['expected', 'unexpected', 'flaky', 'skipped', 'duration'])
    report.stats[key] = critical.reduce((sum, record) => sum + record.report.stats[key], 0);
  return report;
};
