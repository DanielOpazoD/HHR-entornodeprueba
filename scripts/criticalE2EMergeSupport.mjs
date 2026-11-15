import {
  collectRequiredCiEvidenceIssues,
  validateTestEvidence,
} from './testExecutionManifestSupport.mjs';

/**
 * Picks, for each lane, the artifact of the newest attempt of this run that uploaded it.
 * "Re-run failed jobs" repeats only the failed lane, so the lanes that passed keep their
 * earlier attempt. Whether that newest attempt passed is decided by the lanes' job result.
 * @param {string[]} names downloaded artifact folders
 * @param {readonly string[]} lanes
 * @param {string | number | undefined} currentAttempt
 * @returns {{ lane: string, attempt: number, name: string }[]}
 */
export const selectLatestLaneArtifacts = (names, lanes, currentAttempt) => {
  const current = Number(currentAttempt);
  if (!Number.isInteger(current) || current < 1) throw new Error('Invalid current run attempt');
  const latest = new Map();
  for (const name of names) {
    const match = /^e2e-critical-lane-([1-9]\d*)-(\d+)$/.exec(name);
    if (!match) continue;
    const attempt = Number(match[1]);
    if (attempt > current) throw new Error(`${name} is newer than the current attempt`);
    if (attempt > (latest.get(match[2])?.attempt ?? 0))
      latest.set(match[2], { lane: match[2], attempt, name });
  }
  return lanes.map(lane => {
    if (!latest.has(lane)) throw new Error(`Lane ${lane} has no evidence in this run`);
    return latest.get(lane);
  });
};

export const mergeCriticalLaneReports = ({ records, identity, ci, expected }) => {
  const observations = records.map(evidence => ({
    ...evidence,
    ...validateTestEvidence(evidence, identity, ci),
    accepted: true,
  }));
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
