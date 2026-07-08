const EXPECTED_UNIT_SHARD_COUNT = 4;
const UNIT_SHARD_JOB_PATTERN = /^unit-risk-shard-(\d+)$/;

/**
 * @typedef {object} CiRuntimeInputJob
 * @property {string} [name]
 * @property {string} [status]
 * @property {string} [conclusion]
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 */

/**
 * @typedef {object} CiRuntimeShardJob
 * @property {string} name
 * @property {number} index
 * @property {string} status
 * @property {string} conclusion
 * @property {string} startedAt
 * @property {string} completedAt
 * @property {number} durationMs
 */

const roundOneDecimal = value => Math.round(Number(value || 0) * 10) / 10;

const formatMinutes = ms => `${(Number(ms || 0) / 60000).toFixed(1)}m`;

const parseTimeMs = value => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
};

const calculateSpread = shards => {
  const durations = shards.map(shard => Number(shard.durationMs || 0)).filter(duration => duration > 0);
  const slowestMs = Math.max(...durations, 0);
  const fastestMs = Math.min(...durations, slowestMs || 0);
  const spreadMs = Math.max(0, slowestMs - fastestMs);
  return {
    fastestMs,
    slowestMs,
    spreadMs,
    spreadPercent: fastestMs > 0 ? roundOneDecimal((spreadMs / fastestMs) * 100) : 0,
  };
};

const isCompletedJob = job => {
  const status = String(job?.status || '').toUpperCase();
  return status === 'COMPLETED' || Boolean(job?.completedAt);
};

const parseUnitShardJobIndex = job => {
  const match = String(job?.name || '').match(UNIT_SHARD_JOB_PATTERN);
  return match ? Number(match[1]) : null;
};

const collectMissingShardIndices = shards => {
  const observedIndices = new Set((shards || []).map(shard => Number(shard.index)));
  return Array.from({ length: EXPECTED_UNIT_SHARD_COUNT }, (_, offset) => offset + 1).filter(
    index => !observedIndices.has(index)
  );
};

/**
 * @param {CiRuntimeInputJob[]} jobs
 * @returns {CiRuntimeShardJob[]}
 */
export const normalizeCiRuntimeJobs = jobs =>
  Array.from(
    (jobs || []).reduce((selectedByIndex, job) => {
      const index = parseUnitShardJobIndex(job);
      if (!index || !isCompletedJob(job)) return selectedByIndex;
      const startedAtMs = parseTimeMs(job.startedAt);
      const completedAtMs = parseTimeMs(job.completedAt);
      if (startedAtMs === null || completedAtMs === null) return selectedByIndex;
      const durationMs = Math.max(0, completedAtMs - startedAtMs);
      if (durationMs <= 0) return selectedByIndex;
      if (index < 1 || index > EXPECTED_UNIT_SHARD_COUNT) return selectedByIndex;
      if (selectedByIndex.has(index)) return selectedByIndex;
      selectedByIndex.set(index, {
        completedAt: String(job.completedAt || ''),
        conclusion: String(job.conclusion || '').toUpperCase(),
        durationMs,
        index,
        name: String(job.name),
        startedAt: String(job.startedAt || ''),
        status: String(job.status || 'COMPLETED').toUpperCase(),
      });
      return selectedByIndex;
    }, new Map()).values()
  ).sort((a, b) => a.index - b.index);

/**
 * @param {CiRuntimeInputJob[]} jobs
 * @returns {string[]}
 */
const collectInvalidTimestampShardJobs = jobs =>
  (jobs || [])
    .filter(job => {
      const index = parseUnitShardJobIndex(job);
      if (!index || index < 1 || index > EXPECTED_UNIT_SHARD_COUNT || !isCompletedJob(job)) {
        return false;
      }
      return parseTimeMs(job.startedAt) === null || parseTimeMs(job.completedAt) === null;
    })
    .map(job => String(job.name))
    .sort();

/**
 * @param {CiRuntimeInputJob[]} jobs
 * @returns {string[]}
 */
const collectDuplicateShardJobs = jobs => {
  const seenIndices = new Set();
  const duplicateNames = new Set();
  for (const job of jobs || []) {
    const index = parseUnitShardJobIndex(job);
    if (!index || index < 1 || index > EXPECTED_UNIT_SHARD_COUNT || !isCompletedJob(job)) {
      continue;
    }
    const startedAtMs = parseTimeMs(job.startedAt);
    const completedAtMs = parseTimeMs(job.completedAt);
    if (startedAtMs === null || completedAtMs === null || completedAtMs <= startedAtMs) {
      continue;
    }
    if (seenIndices.has(index)) {
      duplicateNames.add(String(job.name));
      continue;
    }
    seenIndices.add(index);
  }
  return Array.from(duplicateNames).sort();
};

/**
 * @param {CiRuntimeInputJob[]} jobs
 * @returns {string[]}
 */
const collectUnexpectedShardJobs = jobs =>
  (jobs || [])
    .filter(job => {
      const index = parseUnitShardJobIndex(job);
      return Boolean(index && isCompletedJob(job) && (index < 1 || index > EXPECTED_UNIT_SHARD_COUNT));
    })
    .map(job => String(job.name))
    .sort();

const resolveEstimatedTotalDurationMs = estimatedProfile =>
  Number(estimatedProfile?.summary?.totalEstimatedDurationMs || 0) ||
  (estimatedProfile?.shards || []).reduce((sum, shard) => sum + Number(shard.estimatedDurationMs || 0), 0);

const buildEstimatedObservedRuntimeComparison = ({ estimatedProfile, observedProfile }) => {
  const observedShards = observedProfile?.shards || [];
  const estimatedShards = estimatedProfile?.shards || [];
  const shards = observedShards
    .map(observedShard => {
      const estimatedShard = estimatedShards.find(shard => Number(shard.index) === Number(observedShard.index));
      const estimatedDurationMs = Number(estimatedShard?.estimatedDurationMs || 0);
      const observedDurationMs = Number(observedShard.durationMs || 0);
      return {
        deltaMs: observedDurationMs - estimatedDurationMs,
        estimatedDurationMs,
        index: Number(observedShard.index),
        observedDurationMs,
        ratioPercent:
          estimatedDurationMs > 0 && observedDurationMs > 0
            ? roundOneDecimal((observedDurationMs / estimatedDurationMs) * 100)
            : 0,
      };
    })
    .filter(shard => shard.estimatedDurationMs > 0 || shard.observedDurationMs > 0)
    .sort((a, b) => a.index - b.index);
  const estimatedTotalDurationMs = resolveEstimatedTotalDurationMs(estimatedProfile);
  const observedTotalDurationMs = Number(observedProfile?.summary?.totalDurationMs || 0);

  return {
    shards,
    summary: {
      estimatedTotalDurationMs,
      observedTotalDurationMs,
      totalDeltaMs: observedTotalDurationMs - estimatedTotalDurationMs,
      totalRatioPercent:
        estimatedTotalDurationMs > 0 && observedTotalDurationMs > 0
          ? roundOneDecimal((observedTotalDurationMs / estimatedTotalDurationMs) * 100)
          : 0,
    },
  };
};

/**
 * @param {{ jobs?: CiRuntimeInputJob[], tolerancePercent?: number }} [options]
 */
export const buildCiRuntimeObservedProfile = ({ jobs = [], tolerancePercent = 25 } = {}) => {
  const normalizedJobs = normalizeCiRuntimeJobs(jobs);
  const unexpectedShardJobs = collectUnexpectedShardJobs(jobs);
  const invalidTimestampShardJobs = collectInvalidTimestampShardJobs(jobs);
  const duplicateShardJobs = collectDuplicateShardJobs(jobs);
  const missingShardIndices = collectMissingShardIndices(normalizedJobs);

  if (
    normalizedJobs.length === 0 &&
    unexpectedShardJobs.length === 0 &&
    invalidTimestampShardJobs.length === 0 &&
    duplicateShardJobs.length === 0
  ) {
    return {
      reportId: 'ci-runtime-observed-profile',
      status: 'no_observed_ci_data',
      summary: {
        observedShardCount: 0,
        expectedShardCount: EXPECTED_UNIT_SHARD_COUNT,
        totalDurationMs: 0,
        spreadPercent: 0,
        tolerancePercent,
      },
      shards: [],
      duplicateShardJobs: [],
      invalidTimestampShardJobs: [],
      missingShardIndices: [],
      unexpectedShardJobs: [],
      recommendation:
        'No observed CI unit shard data is available yet; keep this signal advisory until GitHub Actions data is captured.',
    };
  }

  const spread = calculateSpread(normalizedJobs);
  const totalDurationMs = normalizedJobs.reduce((sum, job) => sum + job.durationMs, 0);
  const slowestShard = normalizedJobs.reduce(
    (selected, shard) => (shard.durationMs > selected.durationMs ? shard : selected),
    normalizedJobs[0] || { index: 0, durationMs: 0 }
  );
  const fastestShard = normalizedJobs.reduce(
    (selected, shard) => (shard.durationMs < selected.durationMs ? shard : selected),
    normalizedJobs[0] || { index: 0, durationMs: 0 }
  );
  const outsideTolerance = spread.spreadPercent > Number(tolerancePercent || 0);

  return {
    reportId: 'ci-runtime-observed-profile',
    status: 'observed_ci_data',
    summary: {
      observedShardCount: normalizedJobs.length,
      expectedShardCount: EXPECTED_UNIT_SHARD_COUNT,
      totalDurationMs,
      slowestShard: {
        index: slowestShard.index,
        durationMs: slowestShard.durationMs,
      },
      fastestShard: {
        index: fastestShard.index,
        durationMs: fastestShard.durationMs,
      },
      ...spread,
      tolerancePercent: Number(tolerancePercent || 0),
    },
    shards: normalizedJobs,
    duplicateShardJobs,
    invalidTimestampShardJobs,
    missingShardIndices,
    unexpectedShardJobs,
    recommendation: outsideTolerance
      ? 'Observed CI unit shard spread is outside tolerance; review perFileOverheadMs, durationHints, affinityGroups or lockedAssignments after more than one run.'
      : 'Observed CI unit shard spread is within observed tolerance; keep monitoring trend data.',
  };
};

export const collectCiRuntimeTelemetryIssues = profile => {
  const issues = [];
  if (!profile || typeof profile !== 'object') {
    return ['CI runtime telemetry report is missing or invalid.'];
  }
  if (profile.status === 'no_observed_ci_data') return issues;
  if (profile.status !== 'observed_ci_data') {
    issues.push(`CI runtime telemetry has unsupported status: ${String(profile.status || 'missing')}.`);
  }
  for (const name of profile.invalidTimestampShardJobs || []) {
    issues.push(`Observed CI runtime includes invalid timestamps for unit shard job(s): ${name}.`);
  }
  for (const name of profile.unexpectedShardJobs || []) {
    issues.push(`Observed CI runtime includes unexpected unit shard job: ${name}.`);
  }
  for (const name of profile.duplicateShardJobs || []) {
    issues.push(`Observed CI runtime includes duplicate unit shard job(s): ${name}.`);
  }
  const observed = Number(profile.summary?.observedShardCount || 0);
  const expected = Number(profile.summary?.expectedShardCount || EXPECTED_UNIT_SHARD_COUNT);
  if (profile.status === 'observed_ci_data' && observed !== expected) {
    const missingShardIndices =
      profile.missingShardIndices ||
      Array.from({ length: expected }, (_, offset) => offset + 1).filter(
        index => !(profile.shards || []).some(shard => Number(shard.index) === index)
      );
    issues.push(`Observed CI runtime is missing unit shard(s): ${missingShardIndices.join(', ')}.`);
  }
  return issues;
};

export const collectCiRuntimeTelemetryCheckIssues = report => {
  const runtimeIssues = collectCiRuntimeTelemetryIssues(report);
  const runtimeIssueSet = new Set(runtimeIssues);
  const comparisonIssues = (report?.comparison?.blockingIssues || [])
    .filter(issue => !runtimeIssueSet.has(issue))
    .map(issue => `Comparison: ${issue}`);
  return Array.from(new Set([...runtimeIssues, ...comparisonIssues]));
};

export const compareEstimatedAndObservedRuntime = ({ estimatedProfile, observedProfile }) => {
  if (!observedProfile || observedProfile.status === 'no_observed_ci_data') {
    return {
      status: 'no_observed_ci_data',
      blockingIssues: [],
      advisoryFindings: ['No observed CI runtime data is available yet.'],
      shards: [],
      summary: {
        estimatedTotalDurationMs: resolveEstimatedTotalDurationMs(estimatedProfile),
        observedTotalDurationMs: 0,
        totalDeltaMs: 0,
        totalRatioPercent: 0,
      },
    };
  }

  const blockingIssues = collectCiRuntimeTelemetryIssues(observedProfile);
  const advisoryFindings = [];
  const estimatedObservedComparison = buildEstimatedObservedRuntimeComparison({
    estimatedProfile,
    observedProfile,
  });
  const observedSpread = Number(observedProfile.summary?.spreadPercent || 0);
  const observedTolerance = Number(observedProfile.summary?.tolerancePercent || 0);
  const estimatedSpread = Number(estimatedProfile?.summary?.spreadPercent || 0);
  const estimatedTolerance = Number(estimatedProfile?.summary?.tolerancePercent || 0);

  if (observedSpread > observedTolerance) {
    advisoryFindings.push(
      `Observed CI shard spread ${observedSpread}% exceeds advisory tolerance ${observedTolerance}%.`
    );
  }
  if (estimatedSpread <= estimatedTolerance && observedSpread > observedTolerance) {
    advisoryFindings.push(
      `Observed CI runtime is imbalanced while estimated balance is still within tolerance (${estimatedSpread}%).`
    );
  }

  for (const shard of estimatedObservedComparison.shards) {
    if (shard.ratioPercent >= 250) {
      advisoryFindings.push(
        `Observed shard ${shard.index} runtime is ${shard.ratioPercent}% of the estimated duration.`
      );
    }
  }

  return {
    status: observedSpread > observedTolerance ? 'observed_outside_tolerance' : 'observed_within_tolerance',
    blockingIssues,
    advisoryFindings,
    shards: estimatedObservedComparison.shards,
    summary: estimatedObservedComparison.summary,
  };
};

export const formatCiRuntimeObservedProfileMarkdown = profile => {
  const lines = [
    '# CI Runtime Observed Profile',
    '',
  ];

  if (profile.generatedAt) {
    lines.push(`- Generated: ${profile.generatedAt}`);
  }
  if (profile.gitSha) {
    lines.push(`- Git SHA: \`${profile.gitSha}\``);
  }
  if (typeof profile.gitDirty === 'boolean') {
    lines.push(`- Worktree dirty: \`${profile.gitDirty}\``);
  }
  if (profile.source?.provider) {
    lines.push(`- Source: \`${profile.source.provider}\``);
  }
  if (profile.source?.repository) {
    lines.push(`- Repository: \`${profile.source.repository}\``);
  }
  if (profile.source?.runId) {
    lines.push(`- Run: \`${profile.source.runId}\``);
  }
  if (profile.source?.inputPath) {
    lines.push(`- Input: \`${profile.source.inputPath}\``);
  }

  lines.push(
    `- Status: \`${profile.status}\``,
    `- Observed shards: ${profile.summary?.observedShardCount || 0}/${profile.summary?.expectedShardCount || EXPECTED_UNIT_SHARD_COUNT}`,
    `- Spread: ${profile.summary?.spreadPercent || 0}% (tolerance ${profile.summary?.tolerancePercent || 0}%)`,
    ''
  );

  if (profile.status === 'no_observed_ci_data') {
    lines.push(
      profile.recommendation,
      '',
      'Run `npm run collect:ci-runtime-observed-input` in GitHub Actions before `npm run report:ci-runtime-observed-profile` to capture real job timings.',
      ''
    );
    return `${lines.join('\n')}\n`;
  }

  const slowestShard = profile.summary?.slowestShard;
  const fastestShard = profile.summary?.fastestShard;
  lines.push(`- Total observed runtime: ${formatMinutes(profile.summary?.totalDurationMs)}`);
  if (slowestShard?.index) {
    lines.push(`- Slowest shard: #${slowestShard.index} (${formatMinutes(slowestShard.durationMs)})`);
  }
  if (fastestShard?.index) {
    lines.push(`- Fastest shard: #${fastestShard.index} (${formatMinutes(fastestShard.durationMs)})`);
  }
  lines.push('');

  lines.push(
    '## Observed Unit Shards',
    '',
    '| Shard | Job | Duration | Conclusion |',
    '| ---: | --- | ---: | --- |',
    ...(profile.shards || []).map(
      shard => `| ${shard.index} | ${shard.name} | ${formatMinutes(shard.durationMs)} | ${shard.conclusion || 'UNKNOWN'} |`
    ),
    '',
    '## Recommendation',
    '',
    profile.recommendation,
    ''
  );

  if ((profile.comparison?.shards || []).length > 0) {
    lines.push(
      '## Estimated vs Observed',
      '',
      '| Shard | Estimated | Observed | Ratio |',
      '| ---: | ---: | ---: | ---: |',
      ...profile.comparison.shards.map(
        shard =>
          `| ${shard.index} | ${formatMinutes(shard.estimatedDurationMs)} | ${formatMinutes(
            shard.observedDurationMs
          )} | ${shard.ratioPercent}% |`
      ),
      ''
    );
    if (profile.comparison.summary?.estimatedTotalDurationMs > 0) {
      lines.push(
        `- Estimated total: ${formatMinutes(profile.comparison.summary.estimatedTotalDurationMs)}`,
        `- Observed total: ${formatMinutes(profile.comparison.summary.observedTotalDurationMs)}`,
        `- Total ratio: ${profile.comparison.summary.totalRatioPercent}%`,
        ''
      );
    }
  }

  const structuralWarnings = [
    ...(profile.invalidTimestampShardJobs || []).map(name => `Invalid timestamp: ${name}`),
    ...(profile.unexpectedShardJobs || []).map(name => `Unexpected shard: ${name}`),
    ...(profile.duplicateShardJobs || []).map(name => `Duplicate shard: ${name}`),
    ...(profile.missingShardIndices || []).map(index => `Missing shard: ${index}`),
  ];
  if (structuralWarnings.length > 0) {
    lines.push('## Structural Warnings', '', ...structuralWarnings.map(warning => `- ${warning}`), '');
  }

  if ((profile.comparison?.advisoryFindings || []).length > 0) {
    lines.push(
      '## Advisory Findings',
      '',
      ...profile.comparison.advisoryFindings.map(finding => `- ${finding}`),
      ''
    );
  }

  return `${lines.join('\n')}\n`;
};
