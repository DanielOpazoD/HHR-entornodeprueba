#!/usr/bin/env node

// Read-only report of CI attempts that failed and later passed on the same commit.
// Usage: npm run report:ci-reruns -- [--days 7] [--workflow ci-cd.yml] [--repo owner/name]
//        [--ignore-jobs ci-summary,test-execution-manifest,preview-smoke] [--json]
// Only issues GET requests through the authenticated `gh` CLI.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  findRecoveredFailures,
  formatRerunReport,
  groupRecoveredFailures,
  isFailedConclusion,
  isUnsuccessfulJob,
} from './ciRerunReportSupport.mjs';

const readOption = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const days = Number(readOption('--days', '7'));
const workflow = readOption('--workflow', 'ci-cd.yml');
// These jobs only collect the results of other jobs, so they fail whenever one of those does.
const ignoreJobs = readOption('--ignore-jobs', 'ci-summary,test-execution-manifest,preview-smoke')
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
  Array.from({ length: run.run_attempt - 1 }, (_, index) => ({ runId: run.id, attempt: index + 1 }))
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
    return { ...failure, jobs: await Promise.all(jobs.filter(isUnsuccessfulJob).map(describeJob)) };
  },
  4
);

const grouped = groupRecoveredFailures(recovered, { ignoreJobs });
const report = { repo, workflow, days, totalRuns: runs.length, ignoreJobs, recovered, grouped };

console.log(asJson ? JSON.stringify(report, null, 2) : formatRerunReport(report));
