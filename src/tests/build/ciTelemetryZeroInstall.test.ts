import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { parseWorkflowJobs } from '../../../scripts/ciArtifactContractSupport.mjs';

const run = promisify(execFile);

it('collects, reports and checks telemetry without installing application dependencies', async () => {
  const job = parseWorkflowJobs(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8')).get(
    'ci-runtime-telemetry'
  );
  expect(job).toBeDefined();
  expect(job!.body).not.toContain('npm ci');
  expect(job!.body).not.toContain("cache: 'npm'");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-telemetry-zero-install-'));
  const jobs = Array.from({ length: 4 }, (_, index) => ({
    name: `unit-risk-shard-${index + 1}`,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-09-05T12:00:00Z',
    completed_at: '2026-09-05T12:01:00Z',
  }));
  const server = http.createServer((request, response) => {
    const page = new URL(request.url!, 'http://localhost').searchParams.get('page');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ jobs: page === '1' ? jobs : [] }));
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
    ]) {
      fs.copyFileSync(path.join('scripts', file), path.join(root, 'scripts', file));
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
      expect(job!.body).toContain(`npm run ${command}`);
      await run('npm', ['run', command], { cwd: root, env, timeout: 10000 });
    }

    const report = JSON.parse(
      fs.readFileSync(path.join(root, 'reports/ci-runtime-observed-profile.json'), 'utf8')
    );
    expect(report.source.status).toBe('collected');
    expect(report.summary.observedShardCount).toBe(4);
    expect(report.comparison.blockingIssues).toEqual([]);
    expect(fs.existsSync(path.join(root, 'reports/ci-runtime-observed-profile.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
