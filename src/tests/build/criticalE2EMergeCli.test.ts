// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import {
  buildRequiredCiSuites,
  captureTestSourceIdentity,
} from '../../../scripts/testExecutionManifestSupport.mjs';

const root = process.cwd();
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }))
);
const write = (dir: string, file: string, value: unknown) => {
  const target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
};

const fixture = (attempts: Record<string, number> = { '1': 1, '2': 1, '3': 1 }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'critical-merge-'));
  temporary.push(dir);
  const archive = execFileSync(
    'git',
    ['archive', 'HEAD', 'package.json', 'scripts/config', '.gitignore'],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  execFileSync('tar', ['-x', '-C', dir], { input: archive });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  write(dir, 'scripts/config/unit-shard-balance.json', { shardCount: 4 });
  git('init', '-q');
  git('add', '.');
  git(
    '-c',
    'user.name=Synthetic',
    '-c',
    'user.email=synthetic@example.test',
    'commit',
    '-qm',
    'fixture'
  );
  const identity = captureTestSourceIdentity(dir);
  const suites = buildRequiredCiSuites(dir).filter(suite => suite.kind === 'playwright');
  for (const suite of suites) {
    const lane = suite.suiteId.startsWith('critical-') ? suite.suiteId.slice(-1) : '3';
    const base = `reports/critical-lanes/e2e-critical-lane-${attempts[lane]}-${lane}`;
    const report = {
      suites: suite.files.map((file: string) => ({
        file,
        specs: ['first', 'second'].map(caseName => ({
          id: `${file}-${caseName}`,
          file,
          title: `synthetic ${caseName}`,
          tests: [
            {
              projectName: 'chromium',
              status: 'expected',
              results: [{ status: 'passed', duration: 10 }],
            },
          ],
        })),
      })),
      errors: [],
      stats: {
        expected: suite.files.length * 2,
        unexpected: 0,
        flaky: 0,
        skipped: 0,
        duration: 10,
      },
    };
    write(dir, `${base}/reports/execution/${suite.suiteId}.evidence.json`, {
      schemaVersion: 1,
      suiteId: suite.suiteId,
      kind: 'playwright',
      mode: 'execution',
      identity,
      sourceUnchanged: true,
      ci: { runId: '123', runAttempt: String(attempts[lane]), job: suite.job },
      command: ['npm', 'run', suite.script, ...('args' in suite ? suite.args : [])],
      exitCode: 0,
      report,
    });
    if (suite.suiteId.startsWith('critical-')) {
      const listing = structuredClone(report);
      listing.stats.skipped = listing.stats.expected;
      listing.stats.expected = 0;
      for (const file of listing.suites)
        for (const spec of file.specs) {
          spec.tests[0].status = 'skipped';
          spec.tests[0].results = [{ status: 'skipped', duration: 0 }];
        }
      write(dir, `${base}/reports/e2e/critical-expected.json`, listing);
    }
  }
  for (const file of [
    'flow-performance-budget.json',
    'flow-performance-budget-summary.json',
    'flow-performance-playwright-report.json',
  ])
    write(dir, `reports/critical-lanes/e2e-critical-lane-${attempts['3']}-3/reports/e2e/${file}`, {
      synthetic: true,
    });
  fs.writeFileSync(
    path.join(
      dir,
      `reports/critical-lanes/e2e-critical-lane-${attempts['3']}-3/reports/e2e/flow-performance-budget.md`
    ),
    'synthetic'
  );
  return dir;
};
const run = (dir: string, attempt = '1') =>
  spawnSync(process.execPath, [path.join(root, 'scripts/merge-critical-e2e-lanes.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: attempt,
    },
  });

it('merges all three lanes without Playwright on PATH and produces every downstream artifact', () => {
  const dir = fixture();
  const result = run(dir);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  for (const suite of ['critical', 'flow', 'cudyr'])
    expect(fs.existsSync(path.join(dir, `reports/execution/${suite}.evidence.json`))).toBe(true);
  const report = JSON.parse(
    fs.readFileSync(path.join(dir, 'reports/e2e/critical-playwright-report.json'), 'utf8')
  );
  expect(report.stats.expected).toBe(40);
  for (const file of [
    'flow-performance-budget.json',
    'flow-performance-budget-summary.json',
    'flow-performance-budget.md',
    'flow-performance-playwright-report.json',
  ])
    expect(fs.existsSync(path.join(dir, `reports/e2e/${file}`))).toBe(true);
});

it('after re-running only lane 3, merges lanes 1 and 2 from attempt 1 and lane 3 from attempt 2', () => {
  const dir = fixture({ '1': 1, '2': 1, '3': 2 });
  // The failed first attempt of lane 3 left evidence too; the newer attempt replaces it.
  const stale = path.join(dir, 'reports/critical-lanes/e2e-critical-lane-1-3');
  fs.cpSync(path.join(dir, 'reports/critical-lanes/e2e-critical-lane-2-3'), stale, {
    recursive: true,
  });
  const staleFile = path.join(stale, 'reports/execution/critical-3.evidence.json');
  fs.writeFileSync(
    staleFile,
    JSON.stringify({ ...JSON.parse(fs.readFileSync(staleFile, 'utf8')), exitCode: 1 })
  );
  const result = run(dir, '2');
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const index = JSON.parse(
    fs.readFileSync(path.join(dir, 'reports/execution/critical.evidence.json'), 'utf8')
  );
  expect(
    index.lanes.map((lane: { suiteId: string; ci: { runAttempt: string } }) => [
      lane.suiteId,
      lane.ci.runAttempt,
    ])
  ).toEqual([
    ['critical-1', '1'],
    ['critical-2', '1'],
    ['critical-3', '2'],
  ]);
});

it('rejects a lane whose evidence was captured in another attempt than its artifact', () => {
  const dir = fixture({ '1': 1, '2': 1, '3': 2 });
  const file = path.join(
    dir,
    'reports/critical-lanes/e2e-critical-lane-2-3/reports/execution/cudyr.evidence.json'
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(file, 'utf8')),
      ci: { runId: '123', runAttempt: '1', job: 'e2e-critical-lanes' },
    })
  );
  const result = run(dir, '2');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    'e2e-critical-lane-2-3/cudyr.evidence.json was captured in another attempt'
  );
});

it.each([
  'missing-lane',
  'duplicate-case',
  'missing-case',
  'missing-list-file',
  'missing-list-case',
])('rejects %s', kind => {
  const dir = fixture();
  const base = 'reports/critical-lanes/e2e-critical-lane-1-';
  const file = path.join(dir, `${base}1/reports/execution/critical-1.evidence.json`);
  if (kind.startsWith('missing-list-')) {
    const listingFile = path.join(dir, `${base}1/reports/e2e/critical-expected.json`);
    const listing = JSON.parse(fs.readFileSync(listingFile, 'utf8'));
    if (kind === 'missing-list-file') listing.suites.shift();
    else listing.suites[0].specs[0].tests = [];
    fs.writeFileSync(listingFile, JSON.stringify(listing));
  } else if (kind === 'missing-lane') fs.unlinkSync(file);
  else {
    const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (kind === 'missing-case') evidence.report.suites[0].specs = [];
    else {
      const second = JSON.parse(
        fs.readFileSync(
          path.join(dir, `${base}2/reports/execution/critical-2.evidence.json`),
          'utf8'
        )
      );
      evidence.report.suites[0].specs.push(second.report.suites[0].specs[0]);
    }
    fs.writeFileSync(file, JSON.stringify(evidence));
  }
  const result = run(dir);
  expect(result.status).not.toBe(0);
  expect(result.stderr).not.toMatch(/playwright.*not found/);
  expect(result.stderr).toMatch(
    kind === 'missing-lane'
      ? /ENOENT/
      : /canonical suite|outside the canonical pack|did not run|more than once/
  );
});

it.each(
  ['critical-1', 'critical-2', 'critical-3', 'cudyr', 'flow'].flatMap(suite =>
    ['partial', 'all'].map(omission => ({ suite, omission }))
  )
)('rejects $omission skipped execution in $suite and names the case', ({ suite, omission }) => {
  const dir = fixture();
  const lane = suite.startsWith('critical-') ? suite.slice(-1) : '3';
  const file = path.join(
    dir,
    `reports/critical-lanes/e2e-critical-lane-1-${lane}/reports/execution/${suite}.evidence.json`
  );
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const group of evidence.report.suites) {
    for (const spec of group.specs) {
      if (omission === 'partial' && spec !== evidence.report.suites[0].specs[0]) continue;
      spec.tests[0].status = 'skipped';
      spec.tests[0].results = [{ status: 'skipped', duration: 0 }];
      evidence.report.stats.expected--;
      evidence.report.stats.skipped++;
    }
  }
  fs.writeFileSync(file, JSON.stringify(evidence));
  const result = run(dir);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(suite);
  expect(result.stderr).toContain('synthetic first');
});
