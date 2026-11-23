// @vitest-environment node
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { parseWorkflow } from './workflowYamlTestSupport';

const run = promisify(execFile);

const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts as Record<
  string,
  string
>;

const installsDependencies = (job: (typeof jobs)[string]) =>
  job.steps.some(
    step =>
      step.uses === './.github/actions/setup-ci-dependencies' ||
      /\bnpm (?:ci|install)\b/.test(step.run ?? '')
  );

/** Node entry files behind `npm run <script>`, following `npm run` chains. */
const entryFiles = (script: string, seen = new Set<string>()): string[] => {
  if (seen.has(script)) return [];
  seen.add(script);
  const command = scripts[script] ?? '';
  return [
    ...[...command.matchAll(/\bnode\s+(scripts\/[\w./-]+\.mjs)/g)].map(match => match[1]),
    ...[...command.matchAll(/\bnpm run ([\w:.-]+)/g)].flatMap(match => entryFiles(match[1], seen)),
  ];
};

/** Bare package imports reachable from `file` through relative imports. */
const packageImports = (file: string, seen = new Set<string>()): string[] => {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  // Statements start a line, so specifiers quoted inside string literals do not count.
  return [
    ...source.matchAll(/^\s*(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].flatMap(([, specifier]) => {
    if (specifier.startsWith('.'))
      return packageImports(path.normalize(path.join(path.dirname(file), specifier)), seen);
    return specifier.startsWith('node:') ? [] : [`${file} -> ${specifier}`];
  });
};

it('keeps jobs that skip dependency installation on Node built-ins only', () => {
  const zeroInstallJobs = Object.entries(jobs).filter(
    ([, job]) =>
      job.steps.some(step => /\bnpm run\b/.test(step.run ?? '')) && !installsDependencies(job)
  );
  // unit-risk and ci-runtime-telemetry start fast because they never run npm ci.
  expect(zeroInstallJobs.map(([name]) => name)).toEqual(
    expect.arrayContaining(['unit-risk', 'ci-runtime-telemetry'])
  );

  for (const [name, job] of zeroInstallJobs) {
    const files = job.steps.flatMap(step =>
      [...(step.run ?? '').matchAll(/\bnpm run ([\w:.-]+)/g)].flatMap(match => entryFiles(match[1]))
    );
    expect(files.length, `${name} runs npm scripts backed by Node files`).toBeGreaterThan(0);
    expect(
      files.flatMap(file => packageImports(file)),
      name
    ).toEqual([]);
  }
});

it('collects, reports and checks telemetry without installing application dependencies', async () => {
  const job = jobs['ci-runtime-telemetry'];
  expect(job).toBeDefined();
  const runs = job.steps.map(step => step.run ?? '');
  expect(job.steps.some(step => step.with?.cache === 'npm')).toBe(false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-telemetry-zero-install-'));
  const observedJobs = Array.from({ length: 4 }, (_, index) => ({
    name: `unit-risk-shard-${index + 1}`,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-09-05T12:00:00Z',
    completed_at: '2026-09-05T12:01:00Z',
  }));
  const server = http.createServer((request, response) => {
    const page = new URL(request.url!, 'http://localhost').searchParams.get('page');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ jobs: page === '1' ? observedJobs : [] }));
  });

  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync('package.json', path.join(root, 'package.json'));
    for (const file of [
      'collect-github-actions-runtime.mjs',
      'report-ci-runtime-observed-profile.mjs',
      'check-ci-runtime-telemetry.mjs',
      'ciRuntimeTelemetrySupport.mjs',
      'gitReportState.mjs',
      'unitShardBalanceSupport.mjs',
    ]) {
      fs.copyFileSync(path.join('scripts', file), path.join(root, 'scripts', file));
    }
    fs.mkdirSync(path.join(root, 'scripts/config'));
    fs.mkdirSync(path.join(root, 'src/tests'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts/config/unit-shard-balance.json'),
      JSON.stringify({
        shardCount: 4,
        durationSource: 'hints',
        durationHints: [{ globs: ['src/tests/**'], estimatedDurationMs: 120 }],
      })
    );
    for (const name of ['a', 'b', 'c', 'd']) {
      fs.writeFileSync(path.join(root, `src/tests/${name}.test.ts`), '// synthetic');
    }
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const env = {
      ...process.env,
      NODE_PATH: '',
      NODE_OPTIONS: '',
      GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
      GITHUB_TOKEN: 'test-token-placeholder',
      GITHUB_REPOSITORY: 'test/repository',
      GITHUB_RUN_ID: '1',
      CI_RUNTIME_COLLECTION_REQUIRED: '1',
      CI_RUNTIME_OBSERVED_INPUT: 'reports/ci-runtime-observed-input.json',
    };
    for (const command of [
      'collect:ci-runtime-observed-input',
      'report:ci-runtime-observed-profile',
      'check:ci-runtime-telemetry',
    ]) {
      expect(runs).toContain(`npm run ${command}`);
      await run('npm', ['run', command], { cwd: root, env, timeout: 10000 });
    }

    const report = JSON.parse(
      fs.readFileSync(path.join(root, 'reports/ci-runtime-observed-profile.json'), 'utf8')
    );
    expect(report.source.status).toBe('collected');
    expect(report.summary.observedShardCount).toBe(4);
    expect(report.comparison.summary.estimatedTotalDurationMs).toBe(480);
    expect(report.comparison.blockingIssues).toEqual([]);
    expect(fs.existsSync(path.join(root, 'reports/ci-runtime-observed-profile.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
