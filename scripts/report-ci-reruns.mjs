#!/usr/bin/env node

// Read-only report of CI attempts that failed and later passed on the same commit.
// Usage: npm run report:ci-reruns -- [--days 7] [--workflow ci-cd.yml] [--repo owner/name]
//        [--ignore-jobs ci-summary,final-confidence-and-readiness] [--json]
// Only issues GET requests through the authenticated `gh` CLI.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDirectCliEntry } from './lib/cliEntry.mjs';

/**
 * @typedef {{runId: number, attempt: number, headSha: string, conclusion: string | null, startedAt: string}} Attempt
 * @typedef {Attempt & {recoveredBy: {runId: number, attempt: number}}} RecoveredAttempt
 * @typedef {{annotation_level: string, title?: string, message?: string}} Annotation
 * @typedef {{name?: string, conclusion?: string | null, failedSteps?: string[], annotations?: Annotation[]}} FailedJob
 * @typedef {{kind: 'test' | 'step', label: string}} FailureLabel
 * @typedef {{job: string, kind?: 'test' | 'step', label?: string, count: number, runs: string[]}} FailureGroup
 */

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out']);
const PASSING_JOB_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

/** @param {Attempt} left @param {Attempt} right */
const byStartTime = (left, right) =>
  String(left.startedAt).localeCompare(String(right.startedAt)) || left.attempt - right.attempt;

/** @param {string | null | undefined} conclusion */
export const isFailedConclusion = conclusion => FAILED_CONCLUSIONS.has(conclusion);

/**
 * A job counts against a failed attempt when it failed, was cancelled or never finished.
 * @param {{conclusion: string | null}} job
 */
export const isUnsuccessfulJob = job => !PASSING_JOB_CONCLUSIONS.has(job.conclusion);

/**
 * @template {Attempt} T
 * @param {T[]} attempts
 * @returns {Array<T & RecoveredAttempt>} failed attempts with `recoveredBy`, the first later
 *   green attempt on the same commit.
 */
export const findRecoveredFailures = attempts => {
  const bySha = new Map();
  for (const attempt of attempts) {
    const group = bySha.get(attempt.headSha) ?? [];
    group.push(attempt);
    bySha.set(attempt.headSha, group);
  }

  const recovered = [];
  for (const group of bySha.values()) {
    const ordered = [...group].sort(byStartTime);
    ordered.forEach((attempt, index) => {
      if (!isFailedConclusion(attempt.conclusion)) return;
      const green = ordered.slice(index + 1).find(later => later.conclusion === 'success');
      if (green) {
        recovered.push({ ...attempt, recoveredBy: { runId: green.runId, attempt: green.attempt } });
      }
    });
  }
  return recovered.sort(byStartTime);
};

/**
 * Playwright titles look like `[chromium] › e2e/a.spec.ts:422:3 › Suite › test`.
 * Vitest titles look like `src/a.test.ts > Suite > test`. Line numbers and the
 * browser project change between commits, so they are dropped from the key.
 * @param {string} title
 */
export const normalizeTestTitle = title =>
  String(title)
    .trim()
    .replace(/^\[[^\]]+\]\s*›\s*/, '')
    .replace(/^([^\s›>]+?):\d+(?::\d+)?(?=\s*[›>])/, '$1')
    .replace(/\s+/g, ' ');

/**
 * Labels one unsuccessful job: the tests named by its failure annotations when
 * the runner reported them, otherwise its first failed step. Later failed steps
 * are usually `if: always()` uploads that fail because the first step did.
 * @param {FailedJob} job
 * @returns {FailureLabel[]}
 */
export const describeJobFailure = ({ conclusion, failedSteps = [], annotations = [] }) => {
  const tests = [
    ...new Set(
      annotations
        .filter(annotation => annotation.annotation_level === 'failure' && annotation.title?.trim())
        .map(annotation => normalizeTestTitle(String(annotation.title)))
    ),
  ];
  if (tests.length > 0) return tests.map(test => ({ kind: 'test', label: test }));
  const [firstFailedStep] = failedSteps;
  if (firstFailedStep) return [{ kind: 'step', label: firstFailedStep }];
  if (conclusion === null || conclusion === undefined) {
    return [{ kind: 'step', label: '(job never finished)' }];
  }
  return [{ kind: 'step', label: `(job ${conclusion} without a failed step)` }];
};

/**
 * @param {Map<string, FailureGroup>} groups
 * @param {string} key
 * @param {Omit<FailureGroup, 'count' | 'runs'>} seed
 * @param {string} runRef
 */
const addToGroup = (groups, key, seed, runRef) => {
  const group = groups.get(key) ?? { ...seed, count: 0, runs: [] };
  if (!group.runs.includes(runRef)) {
    group.runs.push(runRef);
    group.count += 1;
  }
  groups.set(key, group);
};

/** @param {Map<string, FailureGroup>} groups */
const sortGroups = groups =>
  [...groups.values()].sort(
    (left, right) =>
      right.count - left.count ||
      `${left.job} ${left.label ?? ''}`.localeCompare(`${right.job} ${right.label ?? ''}`)
  );

/**
 * @param {Array<{runId: number, attempt: number, jobs: Array<FailedJob & {name: string}>}>} failures
 * @param {{ignoreJobs?: string[]}} [options]
 * @returns {{byJob: FailureGroup[], byFailure: FailureGroup[]}}
 */
export const groupRecoveredFailures = (failures, { ignoreJobs = [] } = {}) => {
  const ignored = new Set(ignoreJobs);
  const byJob = new Map();
  const byFailure = new Map();

  for (const failure of failures) {
    const runRef = `${failure.runId}#${failure.attempt}`;
    for (const job of failure.jobs) {
      if (ignored.has(job.name)) continue;
      addToGroup(byJob, job.name, { job: job.name }, runRef);
      for (const { kind, label } of describeJobFailure(job)) {
        const key = `${job.name}\u0000${kind}\u0000${label}`;
        addToGroup(byFailure, key, { job: job.name, kind, label }, runRef);
      }
    }
  }

  return { byJob: sortGroups(byJob), byFailure: sortGroups(byFailure) };
};

/**
 * @param {{days: number, totalRuns: number, ignoreJobs?: string[], recovered: unknown[],
 *   grouped: {byJob: FailureGroup[], byFailure: FailureGroup[]}}} report
 */
export const formatRerunReport = ({ days, totalRuns, ignoreJobs = [], recovered, grouped }) =>
  [
    `CI attempts that failed and later passed on the same commit (last ${days} days, ${totalRuns} runs):`,
    `${recovered.length} recovered failed attempt(s). Not counted: ${ignoreJobs.join(', ') || 'none'}.`,
    '',
    'By job:',
    ...grouped.byJob.map(group => `  ${String(group.count).padStart(3)}  ${group.job}`),
    '',
    'By test, or first failed step when no test was reported:',
    ...grouped.byFailure.map(
      group =>
        `  ${String(group.count).padStart(3)}  ${group.job} :: ` +
        `${group.kind === 'step' ? 'step: ' : ''}${group.label}\n       runs: ${group.runs.join(', ')}`
    ),
  ].join('\n');

const runCli = async () => {
  const readOption = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
  };

  const days = Number(readOption('--days', '7'));
  const workflow = readOption('--workflow', 'ci-cd.yml');
  // These jobs only collect the results of other jobs, so they fail whenever one of those does.
  // test-execution-manifest and preview-smoke folded into final-confidence-and-readiness on
  // 2026-11-17; they stay listed for older runs in the window.
  const ignoreJobs = readOption(
    '--ignore-jobs',
    'ci-summary,final-confidence-and-readiness,test-execution-manifest,preview-smoke'
  )
    .split(',')
    .filter(Boolean);
  const asJson = process.argv.includes('--json');

  if (!Number.isFinite(days) || days <= 0) {
    console.error('[ci-reruns] --days must be a positive number.');
    process.exit(1);
  }

  const execFileAsync = promisify(execFile);
  const gh = async args =>
    (await execFileAsync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })).stdout;
  const ghApi = async apiPath => JSON.parse(await gh(['api', apiPath]));
  const inBatches = async (items, mapper, size = 8) => {
    const results = [];
    for (let index = 0; index < items.length; index += size) {
      results.push(...(await Promise.all(items.slice(index, index + size).map(mapper))));
    }
    return results;
  };

  const repo =
    readOption('--repo', null) ??
    (await gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])).trim();

  const toAttempt = run => ({
    runId: run.id,
    attempt: run.run_attempt,
    headSha: run.head_sha,
    branch: run.head_branch,
    event: run.event,
    conclusion: run.conclusion,
    startedAt: run.run_started_at,
    url: `${run.html_url}/attempts/${run.run_attempt}`,
  });

  const listPaged = async (basePath, key) => {
    const items = [];
    for (let page = 1; ; page += 1) {
      const separator = basePath.includes('?') ? '&' : '?';
      const response = await ghApi(`${basePath}${separator}per_page=100&page=${page}`);
      items.push(...response[key]);
      if (response[key].length === 0 || items.length >= response.total_count) {
        return { items, totalCount: response.total_count };
      }
    }
  };

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { items: runs, totalCount } = await listPaged(
    `repos/${repo}/actions/workflows/${workflow}/runs?created=${encodeURIComponent(`>=${since}`)}`,
    'workflow_runs'
  );
  if (totalCount > 1000) {
    console.warn('[ci-reruns] GitHub returns at most 1000 runs per query; use fewer --days.');
  }

  const earlierAttempts = runs.flatMap(run =>
    Array.from({ length: run.run_attempt - 1 }, (_, index) => ({
      runId: run.id,
      attempt: index + 1,
    }))
  );
  const attempts = [
    ...runs.map(toAttempt),
    ...(await inBatches(earlierAttempts, async ({ runId, attempt }) =>
      toAttempt(await ghApi(`repos/${repo}/actions/runs/${runId}/attempts/${attempt}`))
    )),
  ];

  const describeJob = async job => ({
    name: job.name,
    conclusion: job.conclusion,
    url: job.html_url,
    failedSteps: (job.steps ?? [])
      .filter(step => isFailedConclusion(step.conclusion))
      .map(step => step.name),
    annotations: (await ghApi(`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`)).map(
      ({ annotation_level, title, message }) => ({ annotation_level, title, message })
    ),
  });

  const recovered = await inBatches(
    findRecoveredFailures(attempts),
    async failure => {
      const { items: jobs } = await listPaged(
        `repos/${repo}/actions/runs/${failure.runId}/attempts/${failure.attempt}/jobs`,
        'jobs'
      );
      return {
        ...failure,
        jobs: await Promise.all(jobs.filter(isUnsuccessfulJob).map(describeJob)),
      };
    },
    4
  );

  const grouped = groupRecoveredFailures(recovered, { ignoreJobs });
  const report = { repo, workflow, days, totalRuns: runs.length, ignoreJobs, recovered, grouped };

  console.log(asJson ? JSON.stringify(report, null, 2) : formatRerunReport(report));
};

if (isDirectCliEntry(import.meta.url)) {
  await runCli();
}
