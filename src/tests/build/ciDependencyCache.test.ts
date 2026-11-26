// @vitest-environment node
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  collectTransitiveNeeds,
  parseWorkflowJobs,
} from '../../../scripts/ciArtifactContractSupport.mjs';
import { jobNeeds, parseWorkflow, type WorkflowJob } from './workflowYamlTestSupport';

const workflow = fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8');
const nightlyWorkflowFiles = [
  '.github/workflows/nightly-test-runtime.yml',
  '.github/workflows/nightly-census-visual.yml',
];
const setupActionRef = './.github/actions/setup-ci-dependencies';
const actionPath = '.github/actions/setup-ci-dependencies/action.yml';
const action = parse(fs.readFileSync(actionPath, 'utf8'));

const isExplicitlyDisabledSaveCache = (value: unknown): boolean =>
  value === undefined || value === false || value === 'false';

const isContinueOnErrorDisabled = (value: unknown): boolean =>
  value === undefined || value === false;

const saveCacheEntries = (stepWith?: Record<string, unknown>) =>
  Object.entries(stepWith ?? {}).filter(([key]) => key.toLowerCase() === 'save-cache');

const hasOnlyDisabledSaveCache = (stepWith?: Record<string, unknown>): boolean =>
  saveCacheEntries(stepWith).every(([, value]) => isExplicitlyDisabledSaveCache(value));

const NPM_CI_SUBCOMMANDS = new Set([
  'ci',
  'cit',
  'clean-install',
  'clean-install-test',
  'ic',
  'install-ci-test',
  'install-clean',
  'isntall-clean',
  'sit',
]);

const NPM_VALUE_FLAGS = new Set([
  '-C',
  '-w',
  '--allow-git',
  '--cache',
  '--globalconfig',
  '--include',
  '--install-strategy',
  '--loglevel',
  '--omit',
  '--otp',
  '--prefix',
  '--registry',
  '--script-shell',
  '--tag',
  '--userconfig',
  '--workspace',
]);

const NPM_BOOLEAN_FLAGS = new Set([
  '-d',
  '-dd',
  '-ddd',
  '-g',
  '-q',
  '-s',
  '--dry-run',
  '--foreground-scripts',
  '--global-style',
  '--ignore-scripts',
  '--include-workspace-root',
  '--install-links',
  '--json',
  '--legacy-bundling',
  '--offline',
  '--prefer-offline',
  '--prefer-online',
  '--quiet',
  '--silent',
  '--strict-peer-deps',
  '--verbose',
  '--workspaces',
]);

const NPM_NON_CI_SUBCOMMANDS = new Set(['exec', 'run', 'run-script', 'start', 't', 'test', 'x']);

const splitShellCommands = (script: string): string[][] => {
  const commands: string[][] = [];
  let currentCmd: string[] = [];
  let currentToken = '';
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;

  const pushToken = () => {
    if (!hasToken) return;
    currentCmd.push(currentToken);
    currentToken = '';
    hasToken = false;
  };
  const pushCommand = () => {
    pushToken();
    if (currentCmd.length > 0) {
      commands.push(currentCmd);
      currentCmd = [];
    }
  };

  for (let i = 0; i < script.length; i += 1) {
    const ch = script[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else {
        currentToken += ch;
        hasToken = true;
      }
      continue;
    }
    if (ch === '\\') {
      if (script[i + 1] === '\n') {
        i += 1;
        continue;
      }
      if (script[i + 1] === '\r' && script[i + 2] === '\n') {
        i += 2;
        continue;
      }
      if (i + 1 < script.length) {
        currentToken += script[i + 1];
        hasToken = true;
        i += 1;
        continue;
      }
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else {
        currentToken += ch;
        hasToken = true;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }
    if (ch === '#' && !hasToken) {
      while (i < script.length && script[i] !== '\n') i += 1;
      pushCommand();
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      pushCommand();
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pushToken();
      continue;
    }
    currentToken += ch;
    hasToken = true;
  }
  pushCommand();
  return commands;
};

const normalizeNpmSubcommand = (token: string): string =>
  token.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

const runsNpmCi = (script?: string): boolean => {
  if (!script) return false;
  for (const words of splitShellCommands(script)) {
    let i = 0;
    while (i < words.length) {
      const word = words[i];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
        i += 1;
        continue;
      }
      if (word === 'env' || word === 'command' || word === 'exec' || word === 'time') {
        i += 1;
        while (i < words.length && words[i].startsWith('-')) i += 1;
        continue;
      }
      break;
    }
    const exe = words[i]?.split('/').pop()?.toLowerCase();
    if (exe !== 'npm' && exe !== 'npm.cmd') continue;
    for (let j = i + 1; j < words.length; ) {
      const token = words[j];
      if (token === '--') break;
      if (token.startsWith('-')) {
        if (token.includes('=')) {
          j += 1;
          continue;
        }
        if (NPM_BOOLEAN_FLAGS.has(token) || token.startsWith('--no-')) {
          const next = words[j + 1]?.toLowerCase();
          j += next === 'true' || next === 'false' ? 2 : 1;
          continue;
        }
        if (NPM_VALUE_FLAGS.has(token)) {
          j += 2;
          continue;
        }
        const next = words[j + 1];
        const nextNormalized = next ? normalizeNpmSubcommand(next) : '';
        if (
          next &&
          !next.startsWith('-') &&
          !NPM_CI_SUBCOMMANDS.has(nextNormalized) &&
          !NPM_NON_CI_SUBCOMMANDS.has(nextNormalized)
        ) {
          j += 2;
          continue;
        }
        j += 1;
        continue;
      }
      if (NPM_CI_SUBCOMMANDS.has(normalizeNpmSubcommand(token))) return true;
      break;
    }
  }
  return false;
};

const setupDependencySteps = (job: WorkflowJob) =>
  job.steps.filter(step => step.uses === setupActionRef);

const mayWriteCache = (job: WorkflowJob): boolean =>
  setupDependencySteps(job).some(step => !hasOnlyDisabledSaveCache(step.with));

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, string>;
};
const steps: Step[] = action.runs.steps;

it('only skips a clean install after an exact, successful dependency restore', () => {
  const restore = steps.find(step => step.id === 'dependencies')!;
  const install = steps.find(step => step.run === 'npm ci')!;
  const image = steps.find(step => step.id === 'image')!;
  expect(image.run).toContain('${ImageOS:?}');
  expect(image.run).toContain('${ImageVersion:?}');
  expect(image.if).toBeUndefined();
  expect(isContinueOnErrorDisabled(image['continue-on-error'])).toBe(true);
  expect(steps.indexOf(image)).toBeLessThan(steps.indexOf(restore));
  expect(restore.if).toBeUndefined();
  expect(restore.uses).toMatch(/^actions\/cache\/restore@/);
  expect(restore.with?.path).toBe('node_modules');
  expect(restore.with).not.toHaveProperty('restore-keys');
  for (const input of [
    'steps.image.outputs.version',
    'runner.os',
    'runner.arch',
    'steps.node.outputs.node-version',
    'package.json',
    'package-lock.json',
    '.npmrc',
    actionPath,
  ]) {
    expect(restore.with?.key).toContain(input);
  }
  expect(install.if).toBe(
    "steps.dependencies.outputs.cache-hit != 'true' || steps.dependencies.outcome != 'success'"
  );
  expect(isContinueOnErrorDisabled(install['continue-on-error'])).toBe(true);
  // Cache outages may fall back, but installation errors must still fail the job.
  expect(restore['continue-on-error']).toBe(true);
  expect(steps.indexOf(restore)).toBeLessThan(steps.indexOf(install));
});

it('publishes only the pristine installation, before the calling job runs checks', () => {
  const save = steps.find(step => step.uses?.startsWith('actions/cache/save@'))!;
  expect(save.if).toBe(
    "inputs.save-cache == 'true' && steps.dependencies.outputs.cache-hit != 'true'"
  );
  expect(action.inputs['save-cache'].default).toBe('false');
  expect(save.with).toEqual({
    path: 'node_modules',
    key: '${{ steps.dependencies.outputs.cache-primary-key }}',
  });
  expect(save['continue-on-error']).toBe(true);
  expect(steps.indexOf(save)).toBeGreaterThan(steps.findIndex(step => step.run === 'npm ci'));
});

it('reuses exact dependencies across compatible jobs with one PR-phase writer per image and post-merge main publication', () => {
  const { jobs } = parseWorkflow(workflow);
  const reusable = Object.entries(jobs).filter(([, job]) => setupDependencySteps(job).length > 0);
  expect(reusable.length).toBeGreaterThan(0);
  const isMainPushOnly = (job: WorkflowJob) =>
    Boolean(
      job.if?.includes("github.event_name == 'push'") &&
      job.if?.includes("github.ref == 'refs/heads/main'")
    );
  const writers = reusable.filter(([, job]) => mayWriteCache(job));
  const prPhaseWriters = writers.filter(([, job]) => !isMainPushOnly(job));
  const mainOnlyWriters = writers.filter(([, job]) => isMainPushOnly(job));
  // The restore key includes the runner image: every image used by a consumer
  // needs exactly one PR-phase writer so parallel jobs never race on cache saves.
  const imageOf = (job: WorkflowJob) => String(job['runs-on']);
  const consumerImages = new Set(reusable.map(([, job]) => imageOf(job)));
  expect([...consumerImages].sort()).toEqual(['ubuntu-24.04', 'ubuntu-latest']);
  for (const image of consumerImages) {
    expect(
      prPhaseWriters.filter(([, job]) => imageOf(job) === image).map(([name]) => name),
      `PR-phase pristine writers for ${image}`
    ).toHaveLength(1);
  }
  expect(prPhaseWriters.map(([name]) => name).sort()).toEqual([
    'quality-static-base',
    'rules-emulator',
  ]);
  const qualityBaseSetup = setupDependencySteps(jobs['quality-static-base'])[0];
  expect(qualityBaseSetup?.if).toBeUndefined();
  expect(qualityBaseSetup?.with).toEqual({
    'save-cache': "${{ matrix.check == 'lint' && 'true' || 'false' }}",
  });
  const rulesEmulatorSetup = setupDependencySteps(jobs['rules-emulator'])[0];
  expect(rulesEmulatorSetup?.if).toBeUndefined();
  expect(rulesEmulatorSetup?.with).toEqual({
    'save-cache': 'true',
  });
  // Reused-evidence main pushes skip quality-static-base (lint), so postmerge-evidence
  // publishes main's ubuntu-latest cache unconditionally after ci-strict-summary (never racing lint).
  expect(mainOnlyWriters.map(([name]) => name)).toEqual(['postmerge-evidence']);
  const postmerge = jobs['postmerge-evidence'];
  expect(imageOf(postmerge)).toBe('ubuntu-latest');
  expect(postmerge.if).toBe(
    "${{ !cancelled() && github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.ci-strict-summary.result == 'success' }}"
  );
  const postmergeSetup = setupDependencySteps(postmerge)[0];
  expect(postmergeSetup?.if).toBeUndefined();
  expect(postmergeSetup?.with).toEqual({
    'save-cache': 'true',
  });
  expect(collectTransitiveNeeds(parseWorkflowJobs(workflow), 'postmerge-evidence')).toContain(
    'quality-static-base'
  );
  for (const [jobName, job] of reusable) {
    expect(isContinueOnErrorDisabled(Reflect.get(job, 'continue-on-error')), jobName).toBe(true);
    expect(setupDependencySteps(job), jobName).toHaveLength(1);
    const setupIndex = job.steps.findIndex(step => step.uses === setupActionRef);
    expect(isContinueOnErrorDisabled(job.steps[setupIndex]['continue-on-error']), jobName).toBe(
      true
    );
    const checkoutIndex = job.steps.findIndex(step => /^actions\/checkout@/i.test(step.uses ?? ''));
    const firstCommandIndex = job.steps.findIndex(
      step =>
        /\b(?:npm|npx|node)\b/.test(step.run ?? '') ||
        /^treosh\/lighthouse-ci-action@/i.test(step.uses ?? '')
    );
    expect(checkoutIndex, jobName).toBeGreaterThanOrEqual(0);
    expect(setupIndex, jobName).toBeGreaterThan(checkoutIndex);
    expect(firstCommandIndex, jobName).toBeGreaterThan(setupIndex);
    expect(
      job.steps.some(step => runsNpmCi(step.run)),
      jobName
    ).toBe(false);
  }
});

it('publishes and reuses the exact ubuntu-24.04 dependency cache across nightly main workflows', () => {
  const nightlyJobs = nightlyWorkflowFiles.flatMap(file => {
    const text = fs.readFileSync(file, 'utf8');
    const raw = parse(text) as { on?: { schedule?: Array<{ cron?: string }> } };
    const schedule = raw.on?.schedule;
    expect(Array.isArray(schedule) && schedule.length > 0, `${file} schedule trigger`).toBe(true);
    for (const entry of schedule ?? []) {
      expect(typeof entry.cron === 'string' && entry.cron.trim().length > 0, `${file} cron`).toBe(
        true
      );
    }
    return Object.entries(parseWorkflow(text).jobs).map(([jobName, job]) => ({
      file,
      jobName,
      job,
    }));
  });

  expect(nightlyJobs.map(entry => entry.jobName).sort()).toEqual([
    'nightly-census-visual',
    'nightly-runtime-governance',
    'nightly-sync-model',
  ]);

  const writers = nightlyJobs.filter(({ job }) => mayWriteCache(job));
  expect(writers.map(entry => entry.jobName)).toEqual(['nightly-sync-model']);
  const nightlyPublisherSetup = setupDependencySteps(writers[0].job)[0];
  expect(nightlyPublisherSetup?.if).toBeUndefined();
  expect(nightlyPublisherSetup?.with).toEqual({
    'save-cache': 'true',
  });

  for (const { file, jobName, job } of nightlyJobs) {
    const label = `${file}#${jobName}`;
    expect(String(job['runs-on']), label).toBe('ubuntu-24.04');
    // Every nightly job must stay active on scheduled runs, never gated off to workflow_dispatch.
    expect(job.if, label).toBeUndefined();
    expect(isContinueOnErrorDisabled(Reflect.get(job, 'continue-on-error')), label).toBe(true);
    expect(setupDependencySteps(job), label).toHaveLength(1);
    const setupIndex = job.steps.findIndex(step => step.uses === setupActionRef);
    expect(setupIndex, label).toBeGreaterThanOrEqual(0);
    expect(job.steps[setupIndex].if, label).toBeUndefined();
    expect(isContinueOnErrorDisabled(job.steps[setupIndex]['continue-on-error']), label).toBe(true);
    if (jobName !== 'nightly-sync-model') {
      expect(
        hasOnlyDisabledSaveCache(job.steps[setupIndex].with),
        `${label} must not save cache`
      ).toBe(true);
    }
    const checkoutIndex = job.steps.findIndex(step => /^actions\/checkout@/i.test(step.uses ?? ''));
    expect(checkoutIndex, label).toBeGreaterThanOrEqual(0);
    expect(setupIndex, label).toBeGreaterThan(checkoutIndex);
    const firstDependentIndex = job.steps.findIndex(
      step =>
        /\b(?:npm|npx|node)\b/.test(step.run ?? '') ||
        step.uses === './.github/actions/setup-ci-chromium' ||
        step.uses === './.github/actions/setup-ci-firestore-emulator'
    );
    expect(firstDependentIndex, label).toBeGreaterThan(setupIndex);
    expect(
      job.steps.some(step => runsNpmCi(step.run)),
      label
    ).toBe(false);
    expect(
      job.steps.some(step => /^actions\/setup-node@/i.test(step.uses ?? '')),
      label
    ).toBe(false);
  }
});

it('preserves docs-only conditions and parallel cold-miss fallbacks without a producer barrier', () => {
  const { jobs } = parseWorkflow(workflow);
  const docsSetup = jobs['docs-scope-gate'].steps.find(
    step => step.uses === './.github/actions/setup-ci-dependencies'
  );
  expect(docsSetup?.if).toBe("needs.ci-scope.outputs.scope == 'docs-only'");
  const independent = [
    'docs-scope-gate',
    'critical-coverage-shards',
    'quality-static-groups',
    'clinical-sync-release-gate',
    'unit-risk-shards',
    'rules-emulator',
    'e2e-critical-lanes',
    'census-startup-performance',
  ];
  for (const name of independent) {
    expect(jobNeeds(jobs[name])).toEqual(['ci-scope']);
  }
  // Dedicated roots/toolchains must retain their own clean install contracts.
  const functions = jobs['functions-scope-gate'].steps;
  expect(functions.some(step => step.uses === './.github/actions/setup-ci-dependencies')).toBe(
    false
  );
  expect(functions.find(step => step.uses?.startsWith('actions/setup-node@'))?.with).toMatchObject({
    'node-version': '22',
    'cache-dependency-path': 'package-lock.json\nfunctions/package-lock.json\n',
  });
  expect(functions.some(step => step.run === 'npm ci')).toBe(true);
  expect(functions.some(step => step.run === 'npm ci --prefix functions')).toBe(true);
  expect(steps.find(step => step.id === 'node')?.with?.['node-version']).toBe('22');
});

it('restores npm downloads only when an exact installed dependency restore cannot be used', () => {
  const activate = steps.find(step => step.id === 'node')!;
  const restore = steps.find(step => step.id === 'dependencies')!;
  const downloads = steps.find(
    step => step.name === 'Restore npm downloads for a clean installation'
  )!;
  const install = steps.find(step => step.run === 'npm ci')!;
  expect(activate.if).toBeUndefined();
  expect(activate.with).not.toHaveProperty('cache');
  expect(isContinueOnErrorDisabled(activate['continue-on-error'])).toBe(true);
  expect(downloads.if).toBe(install.if);
  expect(downloads.with).toEqual({
    'node-version': '${{ steps.node.outputs.node-version }}',
    cache: 'npm',
  });
  expect(downloads['continue-on-error']).toBe(true);
  expect(steps.indexOf(downloads)).toBeGreaterThan(steps.indexOf(restore));
  expect(steps.indexOf(downloads)).toBeLessThan(steps.indexOf(install));
  expect(isContinueOnErrorDisabled(install['continue-on-error'])).toBe(true);
});

it('detects shell variants and aliases of npm ci without rejecting npm run scripts containing ci', () => {
  for (const script of [
    'npm ci',
    'npm ci --no-audit --no-fund',
    'set -e\n  npm ci\n',
    'npm --cache "$RUNNER_TEMP/npm cache" ci',
    'npm \\\n  ci',
    'npm isntall-clean',
    'npm clean-install',
    'npm ic',
    'npm install-clean',
    'npm cleanInstall',
    'npm install-ci-test',
    'npm --ignore-scripts true ci',
    'npm --dry-run false --no-audit false ci',
    'CI=true npm --no-audit --no-fund ci',
  ]) {
    expect(runsNpmCi(script), script).toBe(true);
  }

  for (const script of [
    'npm --silent run ci:preview-smoke:built',
    'npm --ignore-scripts true run build',
    'npm run ci:verify',
    'npm run test:e2e:census-visual:ci',
    'echo "npm ci"',
    '# npm ci\nnpm run build',
  ]) {
    expect(runsNpmCi(script), script).toBe(false);
  }
});
