import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  affectsFunctionDeployment,
  deploymentChangedFiles,
  deploymentSourceChanged,
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
});
