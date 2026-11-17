// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { MAIN_ONLY_JOBS, mainOnlyJobViolations } from '../../../scripts/ciEvidenceReuseSupport.mjs';
import {
  fullRunNothingToDeploy,
  fullRunPreflightNotEligible,
  type RecordedRun,
  reusedRunDeployed,
  reusedRunSkippedDeployScope,
} from './mainOnlyJobRuns.fixture';
import { jobNeeds, parseWorkflow, type WorkflowJob } from './workflowYamlTestSupport';

type Needs = Record<string, { result: string; outputs: Record<string, string> }>;

const DEPLOY_JOB = 'validated-functions-deployment';

// The `needs` context the checker receives in a recorded run. The API lists the inner jobs
// of the reusable deployment, or the caller alone when it was skipped, but never the
// caller's own result. When the inner jobs mix success and skipped (a preflight that chose
// not to deploy), GitHub's aggregate is unobserved, so tests pass it in as `mixedAs`.
const needsFromRun = (run: RecordedRun, mixedAs: 'success' | 'skipped' = 'success'): Needs => {
  const conclusion = (name: string) => {
    const found = run.jobs.filter(([job]) => job === name);
    expect(found, name).toHaveLength(1);
    return found[0][1];
  };
  const deployJobs = run.jobs
    .filter(([job]) => job === DEPLOY_JOB || job.startsWith(`${DEPLOY_JOB} / `))
    .map(([, result]) => result);
  const deployResult =
    deployJobs.find(result => result !== 'success' && result !== 'skipped') ??
    (deployJobs.every(result => result === 'success')
      ? 'success'
      : deployJobs.includes('success')
        ? mixedAs
        : 'skipped');
  return {
    'ci-strict-summary': { result: conclusion('ci-summary'), outputs: {} },
    'postmerge-evidence': { result: conclusion('postmerge-evidence'), outputs: {} },
    'function-deploy-scope': {
      result: conclusion('function-deploy-scope'),
      outputs: run.functionDeployScopeChanged ? { changed: run.functionDeployScopeChanged } : {},
    },
    'deploy-functions': {
      result: deployResult,
      outputs: run.deployPreflightEligible ? { eligible: run.deployPreflightEligible } : {},
    },
  };
};

const green = (changed: 'true' | 'false'): Needs => ({
  'ci-strict-summary': { result: 'success', outputs: {} },
  'postmerge-evidence': { result: 'success', outputs: {} },
  'function-deploy-scope': { result: 'success', outputs: { changed } },
  'deploy-functions':
    changed === 'true'
      ? { result: 'success', outputs: { eligible: 'true' } }
      : { result: 'skipped', outputs: {} },
});

describe('main-only jobs must really run on a main push', () => {
  it('names the skipped function-deploy-scope of run 44155642457, which ended green', () => {
    expect(mainOnlyJobViolations(needsFromRun(reusedRunSkippedDeployScope))).toEqual([
      'function-deploy-scope: skipped, expected success',
    ]);
  });

  it('accepts the reused run that deployed and a full run with nothing to deploy', () => {
    expect(mainOnlyJobViolations(needsFromRun(reusedRunDeployed))).toEqual([]);
    expect(mainOnlyJobViolations(needsFromRun(fullRunNothingToDeploy))).toEqual([]);
  });

  it('reports nothing when ci-summary did not pass: the run is already red', () => {
    for (const result of ['failure', 'cancelled']) {
      const needs = green('true');
      needs['ci-strict-summary'].result = result;
      for (const job of MAIN_ONLY_JOBS) needs[job] = { result: 'skipped', outputs: {} };
      expect(mainOnlyJobViolations(needs), result).toEqual([]);
    }
  });

  it('requires the deployment to reach its preflight when the scope found Functions changes', () => {
    const needs = green('true');
    needs['deploy-functions'] = { result: 'skipped', outputs: {} };
    expect(mainOnlyJobViolations(needs)).toEqual([
      'deploy-functions: skipped and its preflight decided nothing (eligible missing)',
    ]);
  });

  it('requires an eligible deployment to succeed', () => {
    for (const result of ['skipped', 'failure', 'cancelled']) {
      const needs = green('true');
      needs['deploy-functions'].result = result;
      expect(mainOnlyJobViolations(needs), result).toHaveLength(1);
    }
  });

  it('accepts a preflight that chose not to deploy, whatever GitHub reports for the call', () => {
    // Run 44024696522: preflight succeeded with eligible false and skipped its deploy job.
    for (const mixedAs of ['success', 'skipped'] as const)
      expect(
        mainOnlyJobViolations(needsFromRun(fullRunPreflightNotEligible, mixedAs)),
        mixedAs
      ).toEqual([]);
    const failed = needsFromRun(fullRunPreflightNotEligible);
    failed['deploy-functions'].result = 'failure';
    expect(mainOnlyJobViolations(failed)).toEqual(['deploy-functions: failure, expected success']);
  });

  it('requires post-merge evidence and a scope decision', () => {
    const needs = green('false');
    needs['postmerge-evidence'].result = 'skipped';
    needs['function-deploy-scope'].outputs = {};
    expect(mainOnlyJobViolations(needs)).toEqual([
      'postmerge-evidence: skipped, expected success',
      'function-deploy-scope: output changed is missing',
    ]);
  });

  it('fails when the needs context lacks ci-summary or a main-only job', () => {
    expect(mainOnlyJobViolations({})).toEqual(['ci-summary: result unavailable']);
    const needs: Partial<Needs> = green('false');
    delete needs['postmerge-evidence'];
    expect(mainOnlyJobViolations(needs)).toEqual([
      'postmerge-evidence: unavailable, expected success',
    ]);
  });
});

describe('check-main-only-jobs.mjs', () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['scripts/check-main-only-jobs.mjs'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
    });

  it('fails the job with one error per violation', () => {
    const result = run({ NEEDS_JSON: JSON.stringify(needsFromRun(reusedRunSkippedDeployScope)) });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::function-deploy-scope: skipped, expected success');
  });

  it('passes a run whose main-only jobs ran', () => {
    expect(run({ NEEDS_JSON: JSON.stringify(needsFromRun(reusedRunDeployed)) }).status).toBe(0);
  });

  it('fails without a readable needs context', () => {
    expect(run({}).status).toBe(1);
    expect(run({ NEEDS_JSON: 'not json' }).status).toBe(1);
  });
});

// Every job ci-summary does not need, directly or through another job, is outside the
// required check: nothing fails when it is skipped. Each one is either checked by
// main-only-jobs or listed here because it also runs on pull requests, where its absence
// shows in the pull request itself. No condition is parsed: a new job is classified by
// where it hangs, however its `if` is spelled.
const OUTSIDE_CI_SUMMARY_ON_PULL_REQUESTS = ['docs', 'lighthouse-ci'];

const jobsOutsideCiSummary = (jobs: Record<string, WorkflowJob>): string[] => {
  const required = new Set(['ci-strict-summary']);
  const visit = (id: string) => {
    for (const need of jobNeeds(jobs[id])) {
      if (required.has(need)) continue;
      required.add(need);
      visit(need);
    }
  };
  visit('ci-strict-summary');
  return Object.keys(jobs)
    .filter(id => !required.has(id))
    .sort();
};

describe('the main-only-jobs job in ci-cd.yml', () => {
  const jobs = parseWorkflow(
    fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8')
  ).jobs;
  const checker = jobs['main-only-jobs'];

  it('checks every job outside ci-summary that does not also run on pull requests', () => {
    expect(jobsOutsideCiSummary(jobs)).toEqual(
      [...MAIN_ONLY_JOBS, ...OUTSIDE_CI_SUMMARY_ON_PULL_REQUESTS, 'main-only-jobs'].sort()
    );
    expect(jobNeeds(checker).sort()).toEqual(['ci-strict-summary', ...MAIN_ONLY_JOBS].sort());
    for (const id of OUTSIDE_CI_SUMMARY_ON_PULL_REQUESTS)
      expect(jobs[id].if ?? '', id).not.toMatch(/github\.(ref|ref_name|event_name)/);
  });

  it.each([
    ["${{ github.ref=='refs/heads/main' }}"],
    ["${{ startsWith(github.ref, 'refs/heads/main') && github.event_name == 'push' }}"],
    ["${{ format('{0}', github.ref) == 'refs/heads/main' }}"],
    [undefined],
  ])('makes a new job outside ci-summary be classified, whatever its condition (%s)', condition => {
    const extra: WorkflowJob = { if: condition, 'runs-on': 'ubuntu-latest', steps: [] };
    expect(jobsOutsideCiSummary({ ...jobs, 'extra-job': extra })).toContain('extra-job');
  });

  it('runs on main pushes after skipped or failed ancestors, never on a pull request', () => {
    expect(checker.if).toBe(
      "${{ !cancelled() && github.event_name == 'push' && github.ref == 'refs/heads/main' }}"
    );
    const step = checker.steps.find(s => s.run === 'node scripts/check-main-only-jobs.mjs');
    expect(step?.env?.NEEDS_JSON).toBe('${{ toJSON(needs) }}');
  });

  it('receives the preflight decision from the reusable deployment', () => {
    const deploy = parse(
      fs.readFileSync(path.join(process.cwd(), '.github/workflows/deploy-functions.yml'), 'utf8')
    );
    expect(deploy.on.workflow_call.outputs.eligible.value).toBe(
      '${{ jobs.preflight.outputs.eligible }}'
    );
    expect(deploy.jobs.preflight.outputs.eligible).toBe('${{ steps.guard.outputs.eligible }}');
    expect(deploy.on).toHaveProperty('workflow_dispatch');
    expect(jobs['deploy-functions'].uses).toBe('./.github/workflows/deploy-functions.yml');
  });

  it('leaves the required ci-summary check unchanged', () => {
    expect(jobNeeds(jobs['ci-strict-summary'])).not.toContain('main-only-jobs');
  });
});
