// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAIN_ONLY_JOBS, mainOnlyJobViolations } from '../../../scripts/ciEvidenceReuseSupport.mjs';
import {
  fullRunNothingToDeploy,
  fullRunPreflightNotEligible,
  type RecordedRun,
  reusedRunDeployed,
  reusedRunSkippedDeployScope,
} from './mainOnlyJobRuns.fixture';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

type Needs = Record<string, { result: string; outputs: Record<string, string> }>;

const DEPLOY_JOB = 'validated-functions-deployment';

// The `needs` context the checker receives in a recorded run. The reusable deployment is
// one caller job: the API lists its inner jobs, or the caller alone when it was skipped.
const needsFromRun = (run: RecordedRun): Needs => {
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
    (deployJobs.includes('success') ? 'success' : 'skipped');
  return {
    'ci-strict-summary': { result: conclusion('ci-summary'), outputs: {} },
    'postmerge-evidence': { result: conclusion('postmerge-evidence'), outputs: {} },
    'function-deploy-scope': {
      result: conclusion('function-deploy-scope'),
      outputs: run.functionDeployScopeChanged ? { changed: run.functionDeployScopeChanged } : {},
    },
    'deploy-functions': { result: deployResult, outputs: {} },
  };
};

const green = (changed: 'true' | 'false'): Needs => ({
  'ci-strict-summary': { result: 'success', outputs: {} },
  'postmerge-evidence': { result: 'success', outputs: {} },
  'function-deploy-scope': { result: 'success', outputs: { changed } },
  'deploy-functions': { result: changed === 'true' ? 'success' : 'skipped', outputs: {} },
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

  it('requires the deployment when the scope found Functions changes', () => {
    const needs = green('true');
    needs['deploy-functions'].result = 'skipped';
    expect(mainOnlyJobViolations(needs)).toEqual(['deploy-functions: skipped, expected success']);
  });

  it('accepts a deployment whose preflight found nothing eligible to roll out', () => {
    // Run 44024696522: preflight succeeded with eligible false and skipped its deploy job.
    expect(mainOnlyJobViolations(needsFromRun(fullRunPreflightNotEligible))).toEqual([]);
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

describe('the main-only-jobs job in ci-cd.yml', () => {
  const jobs = parseWorkflow(
    fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8')
  ).jobs;
  const checker = jobs['main-only-jobs'];

  it('checks every job that runs only on main, after ci-summary', () => {
    const mainOnly = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const [id, job] of Object.entries(jobs)) {
        if (id === 'main-only-jobs' || mainOnly.has(id)) continue;
        const onMain = (job.if ?? '').includes("github.ref == 'refs/heads/main'");
        if (onMain || jobNeeds(job).some(need => mainOnly.has(need))) {
          mainOnly.add(id);
          grew = true;
        }
      }
    }
    expect([...mainOnly].sort()).toEqual([...MAIN_ONLY_JOBS].sort());
    expect(jobNeeds(checker).sort()).toEqual(['ci-strict-summary', ...MAIN_ONLY_JOBS].sort());
  });

  it('runs on main pushes after skipped or failed ancestors, never on a pull request', () => {
    expect(checker.if).toBe(
      "${{ !cancelled() && github.event_name == 'push' && github.ref == 'refs/heads/main' }}"
    );
    const step = checker.steps.find(s => s.run === 'node scripts/check-main-only-jobs.mjs');
    expect(step?.env?.NEEDS_JSON).toBe('${{ toJSON(needs) }}');
  });

  it('leaves the required ci-summary check unchanged', () => {
    expect(jobNeeds(jobs['ci-strict-summary'])).not.toContain('main-only-jobs');
  });
});
