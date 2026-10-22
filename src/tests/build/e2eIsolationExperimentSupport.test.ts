// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectIsolationExperimentIssues,
  fingerprintIsolationCorpus,
  getIsolationLanePlan,
  getIsolationVariantLanes,
} from '../../../scripts/e2eIsolationExperimentSupport.mjs';
import { criticalCorpus, fixture, report } from './e2eIsolationExperimentCorpus.fixture';

const root = process.cwd();
const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
);
type Experiment = ReturnType<typeof fixture>;
const issues = (mutate: (input: Experiment) => void) => {
  const input = fixture();
  mutate(input);
  return collectIsolationExperimentIssues(input);
};

describe('closed E2E isolation plan', () => {
  it('preserves canonical order and a disjoint complete partition', () => {
    const full = getIsolationLanePlan(root, 'full');
    const first = getIsolationLanePlan(root, 'lane-1');
    const second = getIsolationLanePlan(root, 'lane-2');
    expect(first.specs).toEqual(full.specs.filter(file => first.specs.includes(file)));
    expect(second.specs).toEqual(full.specs.filter(file => second.specs.includes(file)));
    expect(new Set([...first.specs, ...second.specs])).toEqual(new Set(full.specs));
    expect(first.specs.some(file => second.specs.includes(file))).toBe(false);
    expect(full.command).toEqual(['npm', 'run', 'test:e2e:critical:ci']);
    expect(first.command).toEqual(['npm', 'run', 'test:e2e:critical:experiment', '--', 'lane-1']);
    expect([full.auxiliary, first.auxiliary, second.auxiliary]).toEqual([true, true, false]);
    expect(getIsolationVariantLanes('A')).toEqual(['full']);
    expect(() => getIsolationVariantLanes('C')).toThrow();
    expect(() => getIsolationLanePlan(root, 'unexpected')).toThrow();
  });
  it.each(['duplicate', 'missing', 'filter'])('rejects %s package selection drift', change => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-plan-'));
    directories.push(directory);
    const original = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts[
      'test:e2e:critical'
    ];
    const command =
      change === 'duplicate'
        ? `${original} e2e/critical-emulator.spec.ts`
        : change === 'missing'
          ? original.replace(' e2e/critical-emulator.spec.ts', '')
          : `${original} --grep changed`;
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ scripts: { 'test:e2e:critical': command } })
    );
    expect(() => getIsolationLanePlan(directory, 'full')).toThrow();
  });
});

describe('experimental evidence provenance and completeness', () => {
  it('accepts complete independent B lane envelopes and frozen canonical IDs', () => {
    expect(fingerprintIsolationCorpus(report(criticalCorpus, false))).toEqual({
      count: 46,
      hash: 'cd5ac1130f825cab1212853ffcf993d1d0e1be878b4f36dcf7bb35bbf82a5bbd',
    });
    expect(collectIsolationExperimentIssues(fixture())).toEqual([]);
    expect(collectIsolationExperimentIssues(fixture('A'))).toEqual([]);
  });
  const failures: [string, (input: Experiment) => void, string][] = [
    [
      'missing lane',
      input => {
        input.records.pop();
      },
      'Missing or duplicate lane',
    ],
    [
      'duplicate lane',
      input => {
        input.records.push(input.records[0]);
      },
      'Missing or duplicate lane',
    ],
    [
      'unknown lane',
      input => {
        input.records[0].lane = 'foreign';
      },
      'Unknown lane',
    ],
    [
      'dirty tree',
      input => {
        input.identity.worktreeDirty = true;
      },
      'clean source',
    ],
    [
      'stale attempt',
      input => {
        input.records[0].critical.ci.runAttempt = '0';
      },
      'exact attempt',
    ],
    [
      'wrong producer',
      input => {
        input.records[0].critical.ci.job = 'other';
      },
      'producer',
    ],
    [
      'wrong command',
      input => {
        input.records[0].critical.command.push('--grep', 'one');
      },
      'command',
    ],
    [
      'zero execution',
      input => {
        input.records[0].critical.report.suites = [];
      },
      'Empty',
    ],
    [
      'skip',
      input => {
        input.records[0].critical.report.suites[0].specs[0].tests[0].results[0].status = 'skipped';
      },
      'pass exactly once',
    ],
    [
      'retry',
      input => {
        input.records[0].critical.report.suites[0].specs[0].tests[0].results.push({
          status: 'passed',
        });
      },
      'pass exactly once',
    ],
    [
      'duplicate ID',
      input => {
        input.records[0].critical.report.suites.push(input.records[0].critical.report.suites[0]);
      },
      'duplicate test IDs',
    ],
    [
      'missing flow',
      input => {
        input.records[0].flow = null;
      },
      'artifact is absent',
    ],
    [
      'failed metadata phase',
      input => {
        input.records[0].metadata.phases[0].exitCode = 1;
      },
      'did not complete',
    ],
    [
      'wrong auxiliary command',
      input => {
        input.records[0].metadata.phases
          .find(phase => phase.name === 'extension-runtime')
          ?.command.splice(0, 3, 'true');
      },
      'Unexpected phase command',
    ],
    [
      'inconsistent reporter stats',
      input => {
        input.records[0].critical.report.stats.expected = 999;
      },
      'Execution stats',
    ],
    [
      'missing phase',
      input => {
        input.records[0].metadata.phases.pop();
      },
      'Missing or duplicate phase',
    ],
    [
      'missing version',
      input => {
        input.records[0].metadata.versions.node = '';
      },
      'Missing version',
    ],
    [
      'different toolchain',
      input => {
        input.records[1].metadata.versions.node = 'another';
      },
      'versions differ',
    ],
    [
      'mutated listed corpus',
      input => {
        input.records[0].listed.report.suites[0].specs[0].id = 'other-id';
      },
      'frozen count or fingerprint',
    ],
    [
      'extra execution ID',
      input => {
        input.records[0].critical.report.suites[0].specs[0].id = 'extra';
      },
      'outside the canonical pack',
    ],
  ];
  it.each(failures)('rejects %s', (_name, mutate, message) => {
    expect(issues(mutate).join('\n')).toContain(message);
  });
});

it('writes a derived failure report despite malformed evidence and never fabricates execution', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-report-'));
  directories.push(directory);
  fs.mkdirSync(path.join(directory, 'input/full'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'input/full/metadata.json'), '{broken');
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts/report-e2e-isolation-experiment.mjs'),
      '--variant',
      'A',
      '--input',
      path.join(directory, 'input'),
    ],
    { cwd: directory, encoding: 'utf8' }
  );
  expect(result.status).toBe(1);
  const summary = JSON.parse(
    fs.readFileSync(path.join(directory, 'reports/e2e-isolation/summary.json'), 'utf8')
  );
  expect(summary.issues.join('\n')).toContain('metadata.json');
  expect(summary.references).toHaveLength(1);
  expect(summary.references[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(summary).not.toHaveProperty('report');
  expect(
    fs.readFileSync(path.join(directory, 'reports/e2e-isolation/summary.md'), 'utf8')
  ).toContain('Validation FAILED');
});
