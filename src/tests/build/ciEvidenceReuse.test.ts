// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decideMainScope,
  REQUIRED_PR_JOBS,
  REUSED_EVIDENCE_ARTIFACTS,
  testedArtifactName,
} from '../../../scripts/ciEvidenceReuseSupport.mjs';
import { main as classifyScope } from '../../../scripts/classify-ci-change-scope.mjs';
import {
  getReusedEvidenceSource,
  isReusedEvidenceCommit,
} from '../../../scripts/gitReportState.mjs';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const repository = 'owner/hhr';
const mainSha = 'a'.repeat(40);
const mainTree = 'c'.repeat(40);
const head = 'b'.repeat(40);
const tested = 'e'.repeat(40);
const otherTree = 'd'.repeat(40);

const prRun = (overrides: Record<string, unknown> = {}) => ({
  id: 100,
  run_attempt: 1,
  event: 'pull_request',
  path: '.github/workflows/ci-cd.yml',
  head_sha: head,
  head_repository: { full_name: repository },
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});

const artifactsFor = (tree: string, extra: Array<Record<string, unknown>> = []) => {
  const artifacts = [
    { name: testedArtifactName({ commit: tested, tree }), expired: false },
    ...REUSED_EVIDENCE_ARTIFACTS.map(name => ({ name, expired: false })),
    ...extra,
  ];
  return { total_count: artifacts.length, artifacts };
};

const greenJobs = (overrides: Record<string, string> = {}) => {
  const jobs = [
    ...REQUIRED_PR_JOBS.map(name => ({ name, conclusion: 'success' })),
    { name: 'lighthouse-ci', conclusion: 'success' },
    { name: 'postmerge-evidence', conclusion: 'skipped' },
  ].map(job => ({ ...job, conclusion: overrides[job.name] ?? job.conclusion }));
  return { total_count: jobs.length, jobs };
};

interface Fixture {
  pulls?: Array<Record<string, unknown>>;
  runs?: Array<ReturnType<typeof prRun>>;
  artifacts?: Record<number, ReturnType<typeof artifactsFor>>;
  jobs?: Record<number, ReturnType<typeof greenJobs>>;
}

const mergedPull = { number: 7, merged_at: '2026-11-17T10:00:00Z', merge_commit_sha: mainSha };

const fakeApi =
  ({
    pulls = [{ ...mergedPull, base: { ref: 'main' }, head: { sha: head } }],
    runs = [prRun()],
    artifacts = { 100: artifactsFor(mainTree) },
    jobs = { 100: greenJobs() },
  }: Fixture) =>
  async (route: string) => {
    if (route === `/repos/${repository}/commits/${mainSha}/pulls`) return pulls;
    if (route.startsWith(`/repos/${repository}/actions/workflows/ci-cd.yml/runs?`)) {
      expect(route).toContain('event=pull_request');
      return {
        workflow_runs: runs.filter(run => route.includes(`head_sha=${run.head_sha}`)),
      };
    }
    const match = /\/actions\/runs\/(\d+)\/(artifacts|jobs)\?/.exec(route);
    if (match) {
      const table = match[2] === 'artifacts' ? artifacts : jobs;
      const value = table[Number(match[1])];
      if (value) return value;
    }
    throw new Error(`unexpected route ${route}`);
  };

const decide = (fixture: Fixture = {}) =>
  decideMainScope({ repository, sha: mainSha, mainTree, api: fakeApi(fixture) });

describe('main reuses the evidence of the pull request run that tested its tree', () => {
  it('reuses a complete green run whose tested tree is main tree', async () => {
    await expect(decide()).resolves.toEqual({
      scope: 'reused',
      reason: 'identical_tree_pull_request_run',
      usedFallback: false,
      evidence: { runId: 100, pullRequest: 7, commit: tested, tree: mainTree },
    });
  });

  it('runs everything when the tested tree differs (conflict resolved on merge, stale base)', async () => {
    await expect(decide({ artifacts: { 100: artifactsFor(otherTree) } })).resolves.toMatchObject({
      scope: 'full',
      reason: 'tree_mismatch',
    });
  });

  it.each(['cancelled', 'failure', 'timed_out'])(
    'runs everything when the run ended %s, even after partial retries',
    async conclusion => {
      await expect(
        decide({ runs: [prRun({ conclusion, run_attempt: 2 })] })
      ).resolves.toMatchObject({ scope: 'full', reason: 'run_not_green' });
    }
  );

  it('takes an older green run when the newest one was cancelled', async () => {
    const result = await decide({
      runs: [prRun({ id: 101, conclusion: 'cancelled' }), prRun()],
    });
    expect(result).toMatchObject({ scope: 'reused', evidence: { runId: 100 } });
  });

  it('accepts a retried run that ended green in its latest attempt', async () => {
    await expect(decide({ runs: [prRun({ run_attempt: 3 })] })).resolves.toMatchObject({
      scope: 'reused',
    });
  });

  it('decides by tested tree for a run of another pull request with the same head', async () => {
    const stacked = prRun({ id: 200 });
    const stackedArtifacts = { 200: artifactsFor(otherTree) };
    // Another pull request (e.g. into codex/**) tested a different merge: not reusable.
    await expect(
      decide({ runs: [stacked], artifacts: stackedArtifacts, jobs: { 200: greenJobs() } })
    ).resolves.toMatchObject({ scope: 'full', reason: 'tree_mismatch' });
    // The same tree is the same code, whichever pull request tested it.
    await expect(
      decide({
        runs: [stacked],
        artifacts: { 200: artifactsFor(mainTree) },
        jobs: { 200: greenJobs() },
      })
    ).resolves.toMatchObject({ scope: 'reused', evidence: { runId: 200, tree: mainTree } });
  });

  it.each([
    ['a direct push', []],
    ['a pull request merged as another commit', [{ ...mergedPull, merge_commit_sha: head }]],
    ['an unmerged pull request', [{ ...mergedPull, merged_at: null }]],
    ['a pull request into another branch', [{ ...mergedPull, base: { ref: 'develop' } }]],
  ])('runs everything for %s', async (_, pulls) => {
    const withHead = pulls.map(pull => ({ base: { ref: 'main' }, head: { sha: head }, ...pull }));
    await expect(decide({ pulls: withHead })).resolves.toMatchObject({
      scope: 'full',
      reason: 'no_merged_pull_request',
    });
  });

  it.each([
    [
      'docs-only run that skipped the gates',
      { jobs: { 100: greenJobs({ 'unit-risk': 'skipped' }) } },
    ],
    ['failed job', { jobs: { 100: greenJobs({ 'lighthouse-ci': 'failure' }) } }],
    [
      'truncated job list',
      { jobs: { 100: { ...greenJobs(), total_count: REQUIRED_PR_JOBS.length + 5 } } },
    ],
    [
      'run from before the tree was recorded',
      {
        artifacts: {
          100: {
            total_count: 1,
            artifacts: [{ name: 'dist', expired: false }],
          },
        },
      },
    ],
    [
      'run that recorded two trees',
      {
        artifacts: {
          100: artifactsFor(mainTree, [
            { name: testedArtifactName({ commit: tested, tree: otherTree }), expired: false },
          ]),
        },
      },
    ],
    [
      'expired evidence',
      {
        artifacts: {
          100: {
            ...artifactsFor(mainTree),
            artifacts: artifactsFor(mainTree).artifacts.map(artifact =>
              artifact.name === 'dist' ? { ...artifact, expired: true } : artifact
            ),
          },
        },
      },
    ],
    ['run from a fork', { runs: [prRun({ head_repository: { full_name: 'fork/hhr' } })] }],
    ['run of another workflow', { runs: [prRun({ path: '.github/workflows/other.yml' })] }],
  ] as Array<[string, Fixture]>)('runs everything for a %s', async (_, fixture) => {
    await expect(decide(fixture)).resolves.toMatchObject({ scope: 'full', usedFallback: true });
  });

  it('runs everything when GitHub cannot be read', async () => {
    const api = async () => {
      throw new Error('HTTP 502');
    };
    await expect(decideMainScope({ repository, sha: mainSha, mainTree, api })).resolves.toEqual({
      scope: 'full',
      reason: 'evidence_lookup_failed',
      usedFallback: true,
      error: 'HTTP 502',
    });
  });

  it('writes the evidence outputs only for a main push whose checkout is the pushed commit', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-evidence-output-'));
    tempRoots.push(outputDir);
    const outputFile = path.join(outputDir, 'output');
    const previous = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = outputFile;
    try {
      const env = {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: mainSha,
        GITHUB_REPOSITORY: repository,
      };
      await classifyScope({
        env,
        api: fakeApi({}),
        revision: () => ({ sha: mainSha, tree: mainTree }),
      });
      expect(fs.readFileSync(outputFile, 'utf8')).toBe(
        `scope=reused\nreason=identical_tree_pull_request_run\n` +
          `evidence_run_id=100\nevidence_commit=${tested}\nevidence_tree=${mainTree}\n`
      );
      fs.writeFileSync(outputFile, '');
      await classifyScope({
        env,
        api: fakeApi({}),
        revision: () => ({ sha: head, tree: mainTree }),
      });
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(
        'scope=full\nreason=evidence_lookup_failed\n'
      );
      fs.writeFileSync(outputFile, '');
      await classifyScope({ env: { ...env, GITHUB_REF: 'refs/heads/develop' }, api: fakeApi({}) });
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(
        'scope=full\nreason=non_pull_request_event\n'
      );
    } finally {
      if (previous === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = previous;
    }
  });
});

const workflow = () =>
  parseWorkflow(fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8'))
    .jobs;

const SCOPE_JOBS = ['ci-scope', 'docs-scope-gate', 'functions-scope-gate', 'tooling-scope-gate'];
// Run on a reused main push: the decision, its trivial scope records, the summary and
// the work that exists only on main.
const RUN_WHEN_REUSED = [
  ...SCOPE_JOBS,
  'ci-strict-summary',
  'postmerge-evidence',
  'function-deploy-scope',
  'deploy-functions',
];

describe('the workflow skips only what the reused run already proved', () => {
  it('requires of the pull request run exactly the gates ci-summary requires', () => {
    const jobs = workflow();
    const names = jobNeeds(jobs['ci-strict-summary'])
      .filter(job => !SCOPE_JOBS.includes(job))
      .flatMap(id => {
        const { name = id, strategy } = jobs[id];
        const values = Object.values(strategy?.matrix ?? {})[0];
        return values
          ? values.map(value => name.replace(/\$\{\{ matrix\.\w+ \}\}/, `${value}`))
          : [name];
      });
    expect(['ci-summary', ...names].sort()).toEqual([...REQUIRED_PR_JOBS].sort());
  });

  it('skips every test and quality job when the scope is reused', () => {
    const jobs = workflow();
    const skippedWhenReused = (id: string): boolean => {
      const job = jobs[id];
      const condition = job.if ?? '';
      if (condition.includes("needs.ci-scope.outputs.scope == 'full'")) return true;
      if (/always\(\)|cancelled\(\)/.test(condition)) return false;
      return jobNeeds(job).some(skippedWhenReused);
    };
    const running = Object.keys(jobs).filter(
      id => !RUN_WHEN_REUSED.includes(id) && !skippedWhenReused(id)
    );
    expect(running).toEqual([]);
  });

  it('keeps the Functions deployment and post-merge evidence independent of the scope', () => {
    const jobs = workflow();
    for (const id of ['function-deploy-scope', 'deploy-functions'])
      expect(jobs[id].if ?? '', id).not.toContain('ci-scope');
    expect(jobNeeds(jobs['function-deploy-scope'])).toEqual(['ci-strict-summary']);
    const postmerge = jobs['postmerge-evidence'];
    expect(postmerge.if).toContain("needs.ci-strict-summary.result == 'success'");
    expect(postmerge.env?.EVIDENCE_RUN_ID).toBe(
      '${{ needs.ci-scope.outputs.evidence-run-id || github.run_id }}'
    );
    const downloads = postmerge.steps.filter(step =>
      step.uses?.startsWith('actions/download-artifact')
    );
    expect(downloads.map(step => step.with?.name).sort()).toEqual(
      [...REUSED_EVIDENCE_ARTIFACTS].sort()
    );
    for (const step of downloads)
      expect(step.with).toMatchObject({
        'run-id': '${{ env.EVIDENCE_RUN_ID }}',
        'github-token': '${{ github.token }}',
      });
  });

  it('records the tested tree under the name the decision reads', () => {
    const scope = workflow()['ci-scope'];
    const upload = scope.steps.find(step => step.uses?.startsWith('actions/upload-artifact'));
    expect(upload?.with?.name).toBe(
      testedArtifactName({ commit: '${{ github.sha }}', tree: '${{ steps.tested.outputs.tree }}' })
    );
    expect(upload?.['continue-on-error']).toBe(true);
    expect(scope.permissions).toMatchObject({ actions: 'read' });
  });
});

describe('reused evidence counts as current only for HEAD tree', () => {
  const makeRepo = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reused-evidence-'));
    tempRoots.push(root);
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, 'a.txt'), 'synthetic\n');
    git('add', 'a.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'one');
    return { root, tree: git('rev-parse', 'HEAD^{tree}') };
  };
  const env = (tree: string, overrides: Record<string, string> = {}) => ({
    CI_EVIDENCE_RUN_ID: '100',
    CI_EVIDENCE_COMMIT: tested,
    CI_EVIDENCE_TREE: tree,
    ...overrides,
  });

  it('names the reused run and commit while the declared tree is HEAD tree', () => {
    const { root, tree } = makeRepo();
    const source = getReusedEvidenceSource(root, env(tree));
    expect(source).toEqual({ runId: '100', commit: tested });
    expect(isReusedEvidenceCommit(tested.slice(0, 9), source)).toBe(true);
    expect(isReusedEvidenceCommit(mainSha.slice(0, 9), source)).toBe(false);
    expect(isReusedEvidenceCommit('eee', source)).toBe(false);
  });

  it.each([
    ['another tree', otherTree, {}],
    ['no run', null, { CI_EVIDENCE_RUN_ID: '' }],
    ['a short commit', null, { CI_EVIDENCE_COMMIT: 'eeeeeee' }],
  ])('ignores a declaration with %s', (_, tree, overrides) => {
    const repo = makeRepo();
    expect(getReusedEvidenceSource(repo.root, env(tree ?? repo.tree, overrides))).toBeNull();
    expect(isReusedEvidenceCommit(tested, null)).toBe(false);
  });
});
