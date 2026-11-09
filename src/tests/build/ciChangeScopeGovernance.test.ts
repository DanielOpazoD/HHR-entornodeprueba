// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

const readText = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('CI change scope governance', () => {
  it('bypasses expensive gates only for allowlisted documentation changes', () => {
    const { jobs } = parseWorkflow(readText('.github/workflows/ci-cd.yml'));
    const scopeConfig = JSON.parse(readText('scripts/config/ci-change-scope.json'));
    const gatedJobs = [
      'critical-coverage-shards',
      'quality-static-base',
      'clinical-sync-release-gate',
      'unit-risk-shards',
      'rules-emulator',
      'e2e-critical-emulator',
      'census-startup-performance',
    ];

    // The trusted base revision classifies an immutable checkout of the candidate.
    const [trusted, candidate, classify] = jobs['ci-scope'].steps;
    expect(trusted).toMatchObject({
      name: 'Checkout trusted classifier revision',
      with: { path: 'trusted-ci' },
    });
    expect(String(trusted.with?.ref)).toContain('github.event.pull_request.base.sha || github.sha');
    expect(candidate).toMatchObject({
      name: 'Checkout immutable candidate revision',
      with: {
        ref: '${{ github.event.pull_request.head.sha }}',
        'fetch-depth': 0,
        path: 'candidate',
      },
    });
    expect(classify.env?.CI_GIT_ROOT).toBe('${{ github.workspace }}/candidate');
    expect(classify.run).toContain('node scripts/classify-ci-change-scope.mjs');
    expect(classify.run).toContain('reason=trusted_classifier_unavailable');

    const commandsOf = (jobName: string) =>
      jobs[jobName].steps.map(step => step.run ?? '').join('\n');
    expect(jobs['docs-scope-gate'].name).toBe('docs-scope-gate');
    expect(jobs['docs-scope-gate'].steps.map(step => step.run)).toContain(
      'npm run check:docs-drift && npm run check:operational-runbooks'
    );
    expect(jobs['functions-scope-gate'].name).toBe('functions-scope-gate');
    for (const command of [
      'npx vitest run src/tests/functions',
      'src/tests/build/firebaseFunctionDeployVerification.test.ts',
      'src/tests/build/firebaseFunctionDeleteResult.test.ts',
      'src/tests/build/firebaseFunctionRegionVerification.test.ts',
      'npm run check:serverless-sensitive-coverage',
      'npm --prefix functions run check:clinical-pdf-runtime',
    ])
      expect(commandsOf('functions-scope-gate')).toContain(command);
    expect(scopeConfig.docsOnly.excluded).toContain('docs/api/**');
    expect(scopeConfig.functionsOnly.excluded).toContain('functions/package-lock.json');

    for (const jobName of gatedJobs) {
      expect(jobNeeds(jobs[jobName]), `${jobName} must depend on ci-scope`).toEqual(['ci-scope']);
      expect(jobs[jobName].if, `${jobName} must run only for full changes`).toBe(
        "needs.ci-scope.outputs.scope == 'full'"
      );
    }
  });
});
