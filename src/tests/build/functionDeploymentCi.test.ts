import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  affectsFunctionDeployment,
  captureFunctionsList,
  deploymentChangedFiles,
  deploymentSourceChanged,
  alreadyDeployed,
  findDeploymentBaseline,
  FUNCTION_DEPLOY_JOB_NAME,
  resolveDeploymentScope,
  verifyFunctionDeploymentCi,
} from '../../../scripts/functionDeploymentSupport.mjs';

const sha = 'a'.repeat(40);
const run = {
  id: 42,
  run_attempt: 2,
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci-cd.yml',
};
const verify = (event: string, api: ReturnType<typeof vi.fn>) =>
  verifyFunctionDeploymentCi({ repository: 'owner/repo', sha, event, runId: '42', api });

describe('validated Functions deployment', () => {
  it('accepts the exact caller revision only after ci-summary passed', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ jobs: [{ name: 'ci-summary', conclusion: 'success' }] });
    await expect(verify('push', api)).resolves.toBe(42);
    expect(api.mock.calls[1][0]).toContain('/attempts/2/jobs');
  });

  it.each([
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'develop' },
    { event: 'pull_request' },
    { path: '.github/workflows/other.yml' },
    { id: undefined },
    { run_attempt: undefined },
  ])('rejects a nonmatching CI run: %j', async mismatch => {
    await expect(
      verify('push', vi.fn().mockResolvedValue({ ...run, ...mismatch }))
    ).rejects.toThrow('matching main CI');
  });

  it.each(['failure', 'skipped', 'cancelled', null])('blocks a %s summary', async conclusion => {
    const api = vi
      .fn()
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ jobs: [{ name: 'ci-summary', conclusion }] });
    await expect(verify('push', api)).rejects.toThrow('not passed ci-summary');
  });

  it.each(
    [
      [],
      [{ name: 'build', conclusion: 'success' }],
      Array(2).fill({ name: 'ci-summary', conclusion: 'success' }),
    ].map(jobs => ({ jobs }))
  )('rejects missing or ambiguous summaries', async ({ jobs }) => {
    const api = vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce({ jobs });
    await expect(verify('push', api)).rejects.toThrow('not passed ci-summary');
  });

  it('permits a manual retry when CI passed but deployment failed', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ workflow_runs: [{ ...run, conclusion: 'failure' }] })
      .mockResolvedValueOnce({
        jobs: [
          { name: 'ci-summary', conclusion: 'success' },
          { name: 'deploy-firebase-functions', conclusion: 'failure' },
        ],
      });
    await expect(verify('workflow_dispatch', api)).resolves.toBe(42);
  });

  it('uses the newest matching CI run, without falling back to an older passing run', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ workflow_runs: [run, { ...run, id: 43 }] })
      .mockResolvedValueOnce({ jobs: [{ name: 'ci-summary', conclusion: 'failure' }] });
    await expect(verify('workflow_dispatch', api)).rejects.toThrow('not passed ci-summary');
    expect(api.mock.calls[1][0]).toContain('/runs/43/');
  });

  it('fails closed for missing history or an unavailable GitHub API', async () => {
    await expect(
      verify('workflow_dispatch', vi.fn().mockResolvedValue({ workflow_runs: [] }))
    ).rejects.toThrow();
    await expect(
      verify('push', vi.fn().mockRejectedValue(new Error('Unavailable')))
    ).rejects.toThrow('Unavailable');
    await expect(verify('pull_request', vi.fn())).rejects.toThrow();
  });

  it('detects relevant source, tooling and lockfile changes while skipping frontend-only changes', () => {
    for (const file of [
      'functions/lib/authority.js',
      'functions/package-lock.json',
      'firebase.json',
      'package-lock.json',
      'src/services/cudyr/cudyrCensusParser.ts',
      'scripts/check-function-deployment-ci.mjs',
    ])
      expect(affectsFunctionDeployment(file), file).toBe(true);
    for (const file of ['src/views/CensusView.tsx', 'README.md', 'docs/API.md'])
      expect(affectsFunctionDeployment(file), file).toBe(false);
  });

  it('conservatively schedules a validated deployment when the old Git object is unavailable', () => {
    const git = vi.fn().mockImplementation(() => {
      throw new Error('Missing Git object');
    });
    expect(deploymentSourceChanged(git, 'b'.repeat(40), sha)).toBe(true);
  });

  it('includes a Functions deletion when Git detects a rename outside the deployment scope', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'function-deploy-rename-'));
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    try {
      git(['init', '-q']);
      git(['config', 'user.name', 'Synthetic CI']);
      git(['config', 'user.email', 'ci@example.invalid']);
      mkdirSync(path.join(root, 'functions'));
      writeFileSync(path.join(root, 'functions/source.js'), 'export const synthetic = true;\n');
      git(['add', '.']);
      git(['commit', '-qm', 'Synthetic baseline']);
      const before = git(['rev-parse', 'HEAD']);
      renameSync(path.join(root, 'functions/source.js'), path.join(root, 'unrelated.js'));
      git(['add', '-A']);
      git(['commit', '-qm', 'Move outside Functions']);
      const files = deploymentChangedFiles(git, before, 'HEAD');
      expect(files).toContain('functions/source.js');
      expect(files.some(affectsFunctionDeployment)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('orders credentials after preflight and deploys the immutable revision with the installed CLI', () => {
    const caller = parse(readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
    const workflow = parse(readFileSync('.github/workflows/deploy-functions.yml', 'utf8'));
    expect(caller.jobs['function-deploy-scope'].needs).toContain('ci-strict-summary');
    expect(caller.jobs['deploy-functions'].needs).toContain('ci-strict-summary');
    expect(caller.jobs['deploy-functions'].uses).toBe('./.github/workflows/deploy-functions.yml');
    expect(workflow.concurrency.queue).toBe('max');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.on.workflow_call).toBeDefined();
    expect(workflow.jobs.deploy.needs).toEqual(['preflight']);
    expect(workflow.jobs.deploy.if).toContain("eligible == 'true'");
    expect(workflow.jobs.preflight.permissions).toEqual({ contents: 'read', actions: 'read' });
    const checkout = workflow.jobs.deploy.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith('actions/checkout@')
    );
    expect(checkout.with.ref).toBe('${{ github.sha }}');
    expect(readFileSync('.github/workflows/deploy-functions.yml', 'utf8')).not.toContain(
      'firebase-tools@latest'
    );
  });

  const historyApi = (runs: { id: number; head_sha: string; jobs: object[] }[]) =>
    vi.fn().mockImplementation(async (route: string) => {
      if (route.includes('/workflows/ci-cd.yml/runs'))
        return { workflow_runs: runs.map(({ id, head_sha }) => ({ id, head_sha })) };
      const runId = Number(route.match(/runs\/(\d+)\/jobs/)?.[1]);
      return { jobs: runs.find(run => run.id === runId)?.jobs };
    });
  const deployJob = (conclusion: string | null) => ({
    name: FUNCTION_DEPLOY_JOB_NAME,
    conclusion,
  });
  const lastSuccess = 'c'.repeat(40);

  it('finds the last successful deployment and flags failed attempts made after it', async () => {
    const api = historyApi([
      { id: 10, head_sha: lastSuccess, jobs: [deployJob('success')] },
      // Sibling jobs that succeed even when the deployment failed must not count.
      {
        id: 30,
        head_sha: 'e'.repeat(40),
        jobs: [
          { name: 'ci-summary', conclusion: 'success' },
          { name: 'validated-functions-deployment / verify-functions-ci', conclusion: 'success' },
          deployJob('failure'),
        ],
      },
      { id: 20, head_sha: 'd'.repeat(40), jobs: [deployJob('skipped')] },
      { id: 40, head_sha: sha, jobs: [deployJob(null)] },
    ]);
    await expect(findDeploymentBaseline({ repository: 'owner/repo', api })).resolves.toEqual({
      lastSuccessSha: lastSuccess,
      unsettled: true,
    });
    // In-flight runs are inspected: only final conclusions decide.
    expect(api.mock.calls[0][0]).toBe(
      '/repos/owner/repo/actions/workflows/ci-cd.yml/runs?branch=main&event=push&per_page=50'
    );
    expect(api.mock.calls.slice(1).map(([route]) => route)).toEqual(
      [40, 30, 20, 10].map(
        id => `/repos/owner/repo/actions/runs/${id}/jobs?filter=latest&per_page=100`
      )
    );
    await expect(
      findDeploymentBaseline({
        repository: 'owner/repo',
        api: historyApi([{ id: 20, head_sha: 'd'.repeat(40), jobs: [deployJob('skipped')] }]),
      })
    ).resolves.toEqual({ lastSuccessSha: null, unsettled: false });
  });

  it('retries a deployment that failed on an earlier push even when this push is frontend-only', () => {
    // 2026-10-22 UTC: aec75b6 changed Functions but its deployment failed verification;
    // the next push only changed tests and must still deploy the validated head.
    const failedDeploy = 'e'.repeat(40);
    const diffs: Record<string, string[]> = {
      [`${failedDeploy}..${sha}`]: ['src/tests/build/ciSummaryGovernance.test.ts'],
      [`${lastSuccess}..${sha}`]: [
        'functions/lib/dailyRecordErasureGuard.js',
        'src/tests/build/ciSummaryGovernance.test.ts',
      ],
      [`${sha}..${sha}`]: [],
    };
    const git = (args: string[]) => {
      if (args[0] === 'cat-file') return '';
      const [from, to] = args.slice(-2);
      return (diffs[`${from}..${to}`] || []).join('\0');
    };
    const settled = (lastSuccessSha: string | null) => ({ lastSuccessSha, unsettled: false });
    const scope = (
      baseline?: { lastSuccessSha: string | null; unsettled: boolean },
      before = failedDeploy
    ) => resolveDeploymentScope({ git, before, sha, baseline });

    expect(scope(settled(lastSuccess))).toEqual({ changed: true, reason: 'since-last-success' });
    expect(scope(settled(sha), sha)).toEqual({ changed: false, reason: 'unchanged' });
    expect(scope(settled(null))).toEqual({ changed: true, reason: 'no-recent-success' });
    // A revert after a failed deploy leaves identical sources but possibly the reverted code live.
    expect(scope({ lastSuccessSha: sha, unsettled: true }, sha)).toEqual({
      changed: true,
      reason: 'unsettled-attempt',
    });
    // The push diff still deploys when the lookup found an identical last success.
    expect(scope(settled(sha), lastSuccess)).toEqual({ changed: true, reason: 'push-diff' });
    // A GitHub outage keeps the previous push-only decision instead of deploying less.
    expect(scope(undefined)).toEqual({ changed: false, reason: 'lookup-unavailable' });
    expect(scope(undefined, lastSuccess)).toEqual({ changed: true, reason: 'push-diff' });
    expect(scope(settled(lastSuccess), '0'.repeat(40))).toEqual({
      changed: true,
      reason: 'new-branch',
    });

    // The queued preflight skips only a rollout already completed with these sources.
    expect(alreadyDeployed({ git, sha, baseline: settled(sha) })).toBe(true);
    expect(alreadyDeployed({ git, sha, baseline: settled(lastSuccess) })).toBe(false);
    expect(alreadyDeployed({ git, sha, baseline: { lastSuccessSha: sha, unsettled: true } })).toBe(
      false
    );
    expect(alreadyDeployed({ git, sha, baseline: settled(null) })).toBe(false);
  });

  it('retries functions:list and reports the CLI error instead of hiding it in the evidence file', async () => {
    const success = JSON.stringify({ status: 'success', result: [{ id: 'checkUserRole' }] });
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: '{"status":"error","error":"HTTP 429 quota"}' })
      .mockReturnValueOnce({
        status: null,
        stdout: '',
        error: { code: 'ETIMEDOUT' },
        signal: 'SIGKILL',
      })
      .mockReturnValueOnce({ status: 0, stdout: success });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    await expect(captureFunctionsList({ run, sleep, log })).resolves.toBe(success);
    expect(sleep.mock.calls).toEqual([[30000], [60000]]);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'functions:list attempt 1/3 failed: exit 1; HTTP 429 quota',
      'functions:list attempt 2/3 failed: spawn ETIMEDOUT signal SIGKILL',
    ]);

    for (const result of [
      { status: 0, stdout: '{"status":"success"}' },
      { status: 1, stdout: success },
      { status: 1, stdout: '', stderr: 'socket hang up' },
    ]) {
      const failing = vi.fn().mockReturnValue(result);
      await expect(captureFunctionsList({ run: failing, sleep, log })).rejects.toThrow(
        'failed after 3 attempts'
      );
      expect(failing).toHaveBeenCalledTimes(3);
    }
    const noisy = vi.fn().mockReturnValue({ status: 1, stdout: '', stderr: 'x'.repeat(900) });
    log.mockClear();
    await expect(captureFunctionsList({ run: noisy, sleep, log })).rejects.toThrow();
    expect(log.mock.calls[0][0]).toHaveLength('functions:list attempt 1/3 failed: '.length + 400);
  });

  it('lets the scope read earlier runs and verifies the deployment through the retrying capture', () => {
    const caller = parse(readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
    const workflow = parse(readFileSync('.github/workflows/deploy-functions.yml', 'utf8'));
    const scopeJob = caller.jobs['function-deploy-scope'];
    expect(scopeJob.permissions).toEqual({ actions: 'read', contents: 'read' });
    expect(scopeJob.steps.at(-1).env.GITHUB_TOKEN).toBe('${{ github.token }}');
    const verifyStep = workflow.jobs.deploy.steps.find(
      (step: { name?: string }) => step.name === 'Verify deployed clinical fast path'
    );
    expect(verifyStep.run).toContain(
      'node scripts/capture-firebase-functions-list.mjs \\\n  --project hhr-pruebas'
    );
    expect(verifyStep.run).not.toContain('firebase functions:list');
    expect(workflow.jobs.deploy['timeout-minutes']).toBe(30);
    // The lookup matches the job name GitHub builds from both workflow files.
    expect(`${caller.jobs['deploy-functions'].name} / ${workflow.jobs.deploy.name}`).toBe(
      FUNCTION_DEPLOY_JOB_NAME
    );
    expect(affectsFunctionDeployment('scripts/capture-firebase-functions-list.mjs')).toBe(true);
  });
});
