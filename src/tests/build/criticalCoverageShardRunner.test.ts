// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

const runner = path.resolve('scripts/run-critical-coverage.mjs');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const sandbox = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-critical-shards-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'scripts/config/critical-coverage-thresholds.json'),
    JSON.stringify({ zones: { src: { tests: ['src/tests/synthetic.test.ts'] } } })
  );
  fs.writeFileSync(
    path.join(root, 'node_modules/vitest/vitest.mjs'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.TEST_CHILD_EXIT || 0));'
  );
  return root;
};
const run = (root: string, args: string[], code = 0) =>
  spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, TEST_CHILD_EXIT: String(code) },
  });

it.each([1, 2, 3, 4])(
  'runs coverage shard %s without changing the configured test selectors',
  index => {
    const root = sandbox();
    const result = run(root, [`--shard=${index}/4`]);
    expect(result.status, result.stderr).toBe(0);
    const args = JSON.parse(result.stdout);
    expect(args).toContain('src/tests/synthetic.test.ts');
    expect(args).toContain(`--shard=${index}/4`);
    expect(args).toContain(`--outputFile.blob=reports/critical-coverage-blobs/shard-${index}.json`);
    expect(args).toContain(`--coverage.reportsDirectory=coverage/critical-${index}`);
    expect(run(root, [`--shard=${index}/4`], 7).status).toBe(7);
  }
);
it.each(
  [
    [],
    ['shard-1.json'],
    ['shard-1.json', 'shard-2.json'],
    ['shard-1.json', 'shard-2.json', 'shard-3.json'],
    ['shard-1.json', 'shard-2.json', 'shard-3.json', 'shard-4.json', 'stale.json'],
  ].map(files => ({ files }))
)('rejects an incomplete or contaminated merge: %j', ({ files }) => {
  const root = sandbox();
  fs.mkdirSync(path.join(root, 'reports/critical-coverage-blobs'), { recursive: true });
  files.forEach(file =>
    fs.writeFileSync(path.join(root, 'reports/critical-coverage-blobs', file), '{}')
  );
  expect(run(root, ['--merge-shards']).status).toBe(1);
});
it('merges the exact four reports without running tests again and propagates failures', () => {
  const root = sandbox();
  fs.mkdirSync(path.join(root, 'reports/critical-coverage-blobs'), { recursive: true });
  for (const file of ['shard-1.json', 'shard-2.json', 'shard-3.json', 'shard-4.json'])
    fs.writeFileSync(path.join(root, 'reports/critical-coverage-blobs', file), '{}');
  const result = run(root, ['--merge-shards']);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    '-c',
    'vitest.critical-coverage.config.ts',
    '--merge-reports=reports/critical-coverage-blobs',
  ]);
  expect(run(root, ['--merge-shards'], 8).status).toBe(8);
});
it.each(['--shard=0/4', '--shard=5/4', '--shard=1/2', '--shard=1/3', '--merge-reports=elsewhere'])(
  'rejects unsupported arguments: %s',
  arg => {
    expect(run(sandbox(), [arg]).status).toBe(1);
  }
);
it('waits for all same-run shards before enforcing the original coverage gate', () => {
  const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
  expect(jobs['critical-coverage-shards'].strategy?.matrix.shard).toEqual([1, 2, 3, 4]);
  expect(jobNeeds(jobs['critical-coverage-report'])).toEqual([
    'ci-scope',
    'critical-coverage-shards',
  ]);
  expect(
    jobs['critical-coverage-report'].steps.some(
      step => step.run === 'node scripts/run-critical-coverage.mjs --merge-shards'
    )
  ).toBe(true);
  const downloads = jobs['critical-coverage-report'].steps.filter(step =>
    step.uses?.startsWith('actions/download-artifact@')
  );
  expect(downloads.map(step => step.with)).toEqual(
    [1, 2, 3, 4].map(index => ({
      name: `critical-coverage-shard-${index}`,
      path: 'reports/critical-coverage-blobs',
    }))
  );
  for (const download of downloads) {
    expect(download.with).not.toHaveProperty('run-id');
    expect(download.with).not.toHaveProperty('github-token');
  }
  expect(
    jobs['critical-coverage-report'].steps.some(
      step =>
        step.run ===
        'node scripts/report-critical-coverage.mjs && node scripts/check-critical-coverage.mjs'
    )
  ).toBe(true);
});
