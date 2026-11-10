// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCiChangeScopeConfig } from '../../../scripts/ciChangeScopeSupport.mjs';
import {
  assertToolingControls,
  inventoryToolingControls,
  repositoryInventory,
} from './toolingScopeTestSupport';
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
      'e2e-critical-lanes',
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

    expect(jobNeeds(jobs['e2e-critical-emulator'])).toEqual(['ci-scope', 'e2e-critical-lanes']);
    expect(jobs['e2e-critical-emulator'].if).toBe(
      "always() && needs.ci-scope.outputs.scope == 'full'"
    );
    for (const jobName of gatedJobs) {
      expect(jobNeeds(jobs[jobName]), `${jobName} must depend on ci-scope`).toEqual(['ci-scope']);
      expect(jobs[jobName].if, `${jobName} must run only for full changes`).toBe(
        "needs.ci-scope.outputs.scope == 'full'"
      );
    }
  });
});

describe('tooling scope safety', () => {
  it('allows only aggregate controls without external consumers or classifier dependencies', () => {
    const config = loadCiChangeScopeConfig(process.cwd());
    expect(config.toolingOnly.paths).toEqual(['src/tests/scripts/**', 'src/tests/build/**']);
    expect(config.toolingOnly).not.toHaveProperty('excluded');
    expect(config.toolingOnly.controls.length).toBeGreaterThan(0);
    expect(JSON.parse(readText('package.json')).scripts['check:quality']).toBe(
      'node scripts/check-quality-aggregate.mjs'
    );
    assertToolingControls(config.toolingOnly.controls);
    const inventory = inventoryToolingControls(repositoryInventory());
    expect(
      inventory.find(entry => entry.control === 'scripts/check-rayen-extension-release.mjs')
        ?.reasons
    ).toContain(
      'external_reference:src/tests/rayen-import/extensionReleaseDependencyGraph.test.ts'
    );
  });

  it('rejects an allowlisted control referenced by an external synthetic test, naming both files', () => {
    const control = 'scripts/check-synthetic.mjs';
    const input = {
      files: {
        [control]: '',
        'src/tests/rayen-import/external.test.ts': "readFileSync('scripts/check-synthetic.mjs')",
      },
      scripts: { 'check:synthetic': `node ${control}` },
      aggregateIds: ['check:synthetic'],
    };
    expect(() => assertToolingControls([control], input)).toThrow(
      'scripts/check-synthetic.mjs: external_reference:src/tests/rayen-import/external.test.ts'
    );
    expect(() =>
      assertToolingControls([control], { ...input, files: { [control]: '' } })
    ).not.toThrow();
  });

  it.each([
    'src/features/example.ts',
    'src/tests/other/external.test.ts',
    'e2e/example.ts',
    'netlify/functions/example.ts',
    'functions/src/example.ts',
    'extension/example.js',
    'vite.config.ts',
    'vitest.config.ts',
    'playwright.config.ts',
    '.github/workflows/rules-drift.yml',
    '.github/workflows/security-audit.yml',
    '.github/actions/example/action.yml',
    '.husky/pre-commit',
    'netlify.toml',
    'scripts/run-example.mjs',
  ])('rejects consumers in %s, including nested npm aliases', consumer => {
    const control = 'scripts/check-example.mjs';
    const input = {
      files: { [control]: '', [consumer]: 'npm run outer' },
      scripts: { 'check:example': `node ${control}`, outer: 'npm run check:example' },
      aggregateIds: ['check:example'],
    };
    expect(() => assertToolingControls([control], input)).toThrow(control);
    expect(() => assertToolingControls([control], input)).toThrow(consumer);
  });

  it('follows matrix aliases, lifecycle hooks and invocations from other package scripts', () => {
    const control = 'scripts/check-example.mjs';
    const scripts = {
      'check:example': 'node harmless.mjs',
      'precheck:example': `node ${control}`,
      outer: 'npm run check:example',
    };
    const entry = inventoryToolingControls({
      files: {
        [control]: '',
        '.github/workflows/future.yml': 'check: [outer]\nrun: npm run ${{ matrix.check }}',
      },
      scripts,
      aggregateIds: ['precheck:example'],
    }).find(item => item.control === control);
    expect(entry?.reasons).toContain('external_reference:.github/workflows/future.yml');
    expect(entry?.reasons).toContain('external_reference:package.json#outer');
  });

  it('rejects non-aggregate controls and transitive aggregate/classifier dependencies', () => {
    const control = 'scripts/check-example.mjs';
    const input = {
      files: {
        [control]: '',
        'scripts/check-quality-aggregate.mjs': "import './support.mjs'",
        'scripts/support.mjs': "import './check-example.mjs'",
      },
      scripts: { 'check:example': `node ${control}` },
      aggregateIds: ['check:example'],
    };
    expect(
      inventoryToolingControls(input).find(entry => entry.control === control)?.reasons
    ).toContain('aggregate_or_classifier_dependency');
    expect(() => assertToolingControls([control], { ...input, aggregateIds: [] })).toThrow(
      'not_in_aggregate'
    );
  });

  it('validates the reduced scope with cached dependencies, formatting, aggregate and tests', () => {
    const { jobs } = parseWorkflow(readText('.github/workflows/ci-cd.yml'));
    const job = jobs['tooling-scope-gate'];
    expect(jobNeeds(job)).toEqual(['ci-scope']);
    expect(job.steps.some(step => step.uses === './.github/actions/setup-ci-dependencies')).toBe(
      true
    );
    const commands = job.steps.map(step => step.run ?? '').join('\n');
    expect(commands).toContain('eslint');
    expect(commands).toContain('prettier');
    expect(commands).toContain('npm run check:quality');
    expect(commands).toContain('npm run typecheck');
    expect(commands.indexOf('npm run typecheck')).toBeLessThan(commands.indexOf('vitest run'));
    expect(commands).toContain('vitest run src/tests/scripts src/tests/build');
    expect(commands).not.toContain('--maxWorkers=1');
    const aggregate = JSON.parse(readText('scripts/config/guardrail-governance.json'));
    expect(
      aggregate.qualityAggregate.checks.some(
        (entry: { id: string }) => entry.id === 'check:unchecked-index'
      )
    ).toBe(true);
  });
});
