import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  collectPreviewSmokeCompletenessIssues,
  readPreviewSmokeSpecs,
} from './previewSmokeLaneSupport.mjs';
import {
  collectRequiredCiEvidenceIssues,
  validateTestEvidence,
} from './testExecutionManifestSupport.mjs';

const partition = {
  'lane-1':
    'auth-fixture-readiness authenticated-clinical-smoke release-role-smoke sync-conflict-resolution rayen-delayed-health-preflight manual-eloisa-patient-code census-specialty-save rayen-mother-newborn-d1-discharge-critical night-admission-sync-recovery-critical eloisa-day-bootstrap-critical'.split(
      ' '
    ),
  'lane-2':
    'critical-emulator auth-multi-tab-lock pre-outbox-multitab auth-login-resilience clinical-document-ai-import legacy-firebase-compat census-persistence-reload multiuser-offline-conflict admit-edit-discharge-smoke bed-crib-lifecycle-critical'.split(
      ' '
    ),
};
const phaseScripts = {
  'extension-runtime': 'test:e2e:rayen-extension-runtime',
  'extension-upgrade': 'test:e2e:rayen-extension-upgrade',
  'shared-offscreen': 'test:e2e:shared-offscreen',
  'remote-performance': 'test:e2e:census-remote-performance',
  build: 'build',
  budget: 'check:flow-performance-budget',
};
const corpus = {
  critical: { count: 46, hash: 'cd5ac1130f825cab1212853ffcf993d1d0e1be878b4f36dcf7bb35bbf82a5bbd' },
  preview: { count: 64, hash: '0f01cda2e6ba015fe5c0efd9a2797e468730016b476246f55555004e6b4d191c' },
};
const versionKeys =
  'node java playwright chromium firestore lockfile runnerImage runnerOS runnerArch'.split(' ');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameIdentity = (a, b) =>
  a?.gitSha === b?.gitSha &&
  a?.sourceFingerprint === b?.sourceFingerprint &&
  a?.worktreeDirty === b?.worktreeDirty;

export const getIsolationVariantLanes = variant => {
  if (variant === 'A') return ['full'];
  if (variant === 'B') return ['lane-1', 'lane-2'];
  throw new Error('Isolation variant must be A or B');
};

export const getIsolationLanePlan = (root, lane) => {
  if (!['full', 'lane-1', 'lane-2'].includes(lane)) throw new Error('Unknown isolation lane');
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const command = scripts?.['test:e2e:critical'];
  if (typeof command !== 'string') throw new Error('Missing canonical critical script');
  const tokens = command.split(/\s+/);
  if (
    !same(tokens.slice(0, 6), [
      'unset',
      'NO_COLOR;',
      'playwright',
      'test',
      '-c',
      'playwright.emulator-critical.config.ts',
    ]) ||
    tokens.slice(6).some(token => !/^e2e\/[\w/.-]+\.spec\.ts$/.test(token))
  )
    throw new Error('Unexpected canonical critical runner arguments');
  const specs = tokens.filter(token => /^e2e\/[\w/.-]+\.spec\.ts$/.test(token));
  const expected = Object.values(partition)
    .flat()
    .map(name => `e2e/${name}.spec.ts`);
  if (
    tokens.filter(token => token.startsWith('e2e/')).length !== specs.length ||
    specs.length !== expected.length ||
    new Set(specs).size !== specs.length ||
    expected.some(file => !specs.includes(file))
  )
    throw new Error('Canonical critical selection differs from the closed experiment partition');
  const selected =
    lane === 'full'
      ? specs
      : specs.filter(file => partition[lane].some(name => file === `e2e/${name}.spec.ts`));
  return {
    lane,
    suiteId: `isolation-${lane}`,
    specs: selected,
    auxiliary: lane !== 'lane-2',
    command:
      lane === 'full'
        ? ['npm', 'run', 'test:e2e:critical:ci']
        : ['npm', 'run', 'test:e2e:critical:experiment', '--', lane],
  };
};

export const collectIsolationTestEntries = report => {
  if (!Array.isArray(report?.suites)) throw new Error('Missing Playwright suites');
  const entries = [];
  const visit = suite => {
    for (const spec of suite.specs || [])
      for (const test of spec.tests || []) {
        if (
          typeof spec.id !== 'string' ||
          !spec.id ||
          typeof test.projectName !== 'string' ||
          !test.projectName
        )
          throw new Error('Missing canonical test id or projectName');
        entries.push({
          id: `${spec.id}:${test.projectName}`,
          file: spec.file || suite.file,
          results: test.results || [],
        });
      }
    for (const child of suite.suites || []) visit(child);
  };
  report.suites.forEach(visit);
  return entries;
};

export const fingerprintIsolationCorpus = report => {
  const ids = collectIsolationTestEntries(report)
    .map(test => test.id)
    .sort();
  return {
    count: ids.length,
    hash: createHash('sha256')
      .update(`${ids.join('\n')}\n`)
      .digest('hex'),
  };
};
const requiredPhases = (variant, plan) => [
  'critical-list',
  'preview-list',
  ...(plan.auxiliary ? ['extension-runtime', 'extension-upgrade', 'shared-offscreen'] : []),
  ...(variant === 'A'
    ? ['critical-ci']
    : ['emulator', 'build', 'critical', ...(plan.auxiliary ? ['flow', 'budget'] : [])]),
  'operational-metrics',
  ...(plan.auxiliary ? ['remote-performance'] : []),
];

const validateMetadata = (metadata, plan, variant, identity, ci) => {
  const issues = [];
  if (metadata?.error) issues.push(`Runner failed: ${metadata.error}`);
  if (
    metadata?.schemaVersion !== 1 ||
    metadata.lane !== plan.lane ||
    !sameIdentity(metadata.identity, identity) ||
    metadata.sourceUnchanged !== true
  )
    issues.push('Invalid metadata source identity or lane');
  if (
    !metadata?.ci ||
    metadata.ci.runId !== ci.runId ||
    String(metadata.ci.runAttempt) !== String(ci.runAttempt) ||
    metadata.ci.job !== ci.job
  )
    issues.push('Metadata CI producer, run or attempt differs');
  for (const key of versionKeys)
    if (typeof metadata?.versions?.[key] !== 'string' || !metadata.versions[key].trim())
      issues.push(`Missing version ${key}`);
  const start = Date.parse(metadata?.startedAt),
    end = Date.parse(metadata?.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    issues.push('Invalid metadata timing');
  const phases = Array.isArray(metadata?.phases) ? metadata.phases : [];
  const expected = requiredPhases(variant, plan);
  for (const name of expected)
    if (phases.filter(phase => phase?.name === name).length !== 1)
      issues.push(`Missing or duplicate phase ${name}`);
  for (const phase of phases) {
    if (!phase || !expected.includes(phase.name)) {
      issues.push('Unknown phase');
      continue;
    }
    if (phaseScripts[phase.name] && !same(phase.command, ['npm', 'run', phaseScripts[phase.name]]))
      issues.push(`Unexpected phase command ${phase.name}`);
    const began = Date.parse(phase.startedAt),
      ended = Date.parse(phase.finishedAt);
    if (
      !Array.isArray(phase.command) ||
      !phase.command.length ||
      phase.command.some(arg => typeof arg !== 'string' || !arg) ||
      phase.exitCode !== 0 ||
      phase.signal !== null
    )
      issues.push(`Phase ${phase.name} did not complete successfully`);
    if (
      !Number.isFinite(began) ||
      !Number.isFinite(ended) ||
      ended < began ||
      began < start ||
      ended > end ||
      !Number.isFinite(phase.durationMs) ||
      phase.durationMs < 0 ||
      Math.abs(ended - began - phase.durationMs) > 1000
    )
      issues.push(`Invalid phase timing ${phase.name}`);
  }
  return issues;
};

export const collectIsolationExperimentIssues = ({ root, variant, records, identity, ci }) => {
  const issues = [];
  let lanes;
  try {
    lanes = getIsolationVariantLanes(variant);
  } catch (error) {
    return [error.message];
  }
  if (
    !identity ||
    identity.worktreeDirty !== false ||
    !/^[a-f0-9]{40}$/.test(identity.gitSha || '') ||
    !/^[a-f0-9]{64}$/.test(identity.sourceFingerprint || '')
  )
    issues.push('Experiment requires a clean source identity');
  if (!ci?.runId || !/^[1-9]\d*$/.test(String(ci.runAttempt)) || ci.job !== 'e2e-isolation-lanes')
    issues.push('Experiment requires current CI run, exact attempt and lane producer');
  const inputs = Array.isArray(records) ? records : [];
  for (const record of inputs)
    if (!lanes.includes(record?.lane)) issues.push(`Unknown lane ${record?.lane}`);
  const allCritical = [],
    lists = [],
    previews = [],
    versions = [];
  for (const lane of lanes) {
    const matches = inputs.filter(record => record?.lane === lane);
    if (matches.length !== 1) {
      issues.push(`Missing or duplicate lane ${lane}`);
      continue;
    }
    const record = matches[0];
    let plan;
    try {
      plan = getIsolationLanePlan(root, lane);
    } catch (error) {
      issues.push(error.message);
      continue;
    }
    const add = message => issues.push(`${lane}: ${message}`);
    validateMetadata(record.metadata, plan, variant, identity, ci || {}).forEach(add);
    versions.push(record.metadata?.versions);
    const validateEnvelope = (evidence, suiteId, mode, command, files) => {
      try {
        const summary = validateTestEvidence(evidence, identity);
        if (
          !evidence.ci ||
          evidence.ci.runId !== ci?.runId ||
          String(evidence.ci.runAttempt) !== String(ci?.runAttempt) ||
          evidence.ci.job !== 'e2e-isolation-lanes'
        )
          throw new Error('Evidence CI producer, run or exact attempt differs');
        if (evidence.sourceUnchanged !== true) throw new Error('Evidence source changed');
        if (
          evidence.kind !== 'playwright' ||
          evidence.suiteId !== suiteId ||
          evidence.mode !== mode ||
          evidence.exitCode !== 0 ||
          !same(evidence.command, command)
        )
          throw new Error('Unexpected suite, mode, command or exit code');
        if (
          (evidence.report.errors !== undefined && !Array.isArray(evidence.report.errors)) ||
          summary.globalErrors ||
          summary.suiteErrors.length ||
          summary.diagnostics.length
        )
          throw new Error('Reporter errors');
        const entries = collectIsolationTestEntries(evidence.report);
        if (!entries.length || new Set(entries.map(test => test.id)).size !== entries.length)
          throw new Error('Empty or duplicate test IDs');
        if (mode === 'execution') {
          const stats = evidence.report.stats;
          if (
            !stats ||
            stats.expected !== entries.length ||
            ['unexpected', 'flaky', 'skipped', 'interrupted'].some(
              key => (stats[key] ?? (key === 'interrupted' ? 0 : -1)) !== 0
            )
          )
            throw new Error('Execution stats must match a complete clean report');
          if (
            evidence.report.config?.workers !== 1 ||
            evidence.report.config?.fullyParallel !== false ||
            !same(
              evidence.report.config?.projects?.map(project => project.name),
              ['chromium']
            )
          )
            throw new Error('Execution must retain one worker, serial specs and chromium');
          if (
            entries.some(
              test => test.results.length !== 1 || test.results[0].status !== 'passed'
            ) ||
            summary.counts.flaky ||
            summary.counts.skipped ||
            summary.counts.failed ||
            summary.counts.notRun ||
            summary.counts.interrupted
          )
            throw new Error('Every test must pass exactly once without skips or retries');
          const [executable, , script, ...args] = command;
          collectRequiredCiEvidenceIssues(
            [{ ...evidence, ...summary, accepted: true }],
            [
              {
                suiteId,
                job: 'e2e-isolation-lanes',
                kind: 'playwright',
                script,
                args,
                files,
                allowSkipped: false,
              },
            ]
          ).forEach(add);
          if (executable !== 'npm') throw new Error('Unexpected executable');
        } else {
          if (entries.some(test => test.results.length))
            throw new Error('Collection contains execution results');
          if (!same(summary.files, [...files].sort()))
            throw new Error('Collection file membership differs');
        }
        return evidence.report;
      } catch (error) {
        add(`${suiteId}: ${error.message}`);
        return null;
      }
    };
    const critical = validateEnvelope(
      record.critical,
      plan.suiteId,
      'execution',
      plan.command,
      plan.specs
    );
    if (critical) allCritical.push(critical);
    const listed = validateEnvelope(
      record.listed,
      'isolation-critical-list',
      'collection',
      ['npm', 'run', 'test:e2e:critical', '--', '--list', '--reporter=json'],
      getIsolationLanePlan(root, 'full').specs
    );
    const preview = validateEnvelope(
      record.previewListed,
      'isolation-preview-list',
      'collection',
      ['npm', 'run', 'ci:preview-smoke:built', '--', '--list', '--reporter=json'],
      readPreviewSmokeSpecs(root)
    );
    for (const [name, report, collection] of [
      ['critical', listed, lists],
      ['preview', preview, previews],
    ])
      if (report) {
        collection.push(report);
        if (!same(fingerprintIsolationCorpus(report), corpus[name]))
          add(`${name} canonical corpus differs from frozen count or fingerprint`);
      }
    if (plan.auxiliary)
      validateEnvelope(
        record.flow,
        'flow',
        'execution',
        ['npm', 'run', 'test:e2e:flow-performance:built'],
        ['e2e/startup-performance-budget.spec.ts']
      );
    else if (record.flow) add('Auxiliary flow must not run in this lane');
  }
  for (const [name, collection] of [
    ['critical', lists],
    ['preview', previews],
  ])
    if (
      collection.length > 1 &&
      collection.some(
        report =>
          !same(fingerprintIsolationCorpus(report), fingerprintIsolationCorpus(collection[0]))
      )
    )
      issues.push(`${name} listing differs between lanes`);
  if (
    versions.length > 1 &&
    versions.some(value => !versionKeys.every(key => value?.[key] === versions[0]?.[key]))
  )
    issues.push('Lane toolchain versions differ');
  if (lists[0]) {
    try {
      collectPreviewSmokeCompletenessIssues({
        listed: lists[0],
        merged: { suites: allCritical.flatMap(report => report.suites) },
      }).forEach(issue => issues.push(`Critical completeness: ${issue}`));
    } catch (error) {
      issues.push(`Critical completeness: ${error.message}`);
    }
  }
  return issues;
};
