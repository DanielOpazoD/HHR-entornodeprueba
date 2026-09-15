import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('CI change scope governance', () => {
  it('bypasses expensive gates only for allowlisted documentation changes', () => {
    const workflow = readText('.github/workflows/ci-cd.yml');
    const scopeConfig = JSON.parse(readText('scripts/config/ci-change-scope.json'));
    const gatedJobs = [
      'critical-coverage-report',
      'quality-static-base',
      'clinical-sync-release-gate',
      'unit-risk-shards',
      'rules-emulator',
      'e2e-critical-emulator',
      'census-startup-performance',
    ];

    expect(workflow).toContain('name: Checkout trusted classifier revision');
    expect(workflow).toContain('github.event.pull_request.base.sha || github.sha');
    expect(workflow).toContain('path: trusted-ci');
    expect(workflow).toContain('name: Checkout immutable candidate revision');
    expect(workflow).toContain('ref: ${{ github.event.pull_request.head.sha }}');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('CI_GIT_ROOT: ${{ github.workspace }}/candidate');
    expect(workflow).toContain('node scripts/classify-ci-change-scope.mjs');
    expect(workflow).toContain('reason=trusted_classifier_unavailable');
    expect(workflow).toContain('name: docs-scope-gate');
    expect(workflow).toContain('name: functions-scope-gate');
    expect(workflow).toContain('npx vitest run src/tests/functions');
    expect(workflow).toContain('npm run check:serverless-sensitive-coverage');
    expect(workflow).toContain('npm --prefix functions run check:clinical-pdf-runtime');
    expect(workflow).toContain(
      'run: npm run check:docs-drift && npm run check:operational-runbooks'
    );
    expect(scopeConfig.docsOnly.excluded).toContain('docs/api/**');
    expect(scopeConfig.functionsOnly.excluded).toContain('functions/package-lock.json');

    for (const jobName of gatedJobs) {
      const start = workflow.indexOf(`  ${jobName}:`);
      const remaining = workflow.slice(start + jobName.length + 3);
      const nextJob = remaining.search(/\n {2}[a-z][a-z0-9-]+:\n/);
      const job = workflow.slice(
        start,
        nextJob === -1 ? undefined : start + jobName.length + 3 + nextJob
      );
      expect(job, `${jobName} must depend on ci-scope`).toContain('needs: [ci-scope]');
      expect(job, `${jobName} must run only for full changes`).toContain(
        "if: needs.ci-scope.outputs.scope == 'full'"
      );
    }
  });
});
