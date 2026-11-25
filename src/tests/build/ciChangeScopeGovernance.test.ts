// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyCiChangeScope,
  collectChangedFilesFromGit,
  loadCiChangeScopeConfig,
  parseGitNameStatus,
} from '../../../scripts/ciChangeScopeSupport.mjs';
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

    expect(jobNeeds(jobs['final-confidence-and-readiness'])).toContain('ci-scope');
    expect(jobs['final-confidence-and-readiness'].if).toBe(
      "${{ !cancelled() && needs.ci-scope.outputs.scope == 'full' }}"
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
    const prodTsconfig = JSON.parse(readText('tsconfig.prod.json'));
    const netlifyTsconfig = JSON.parse(readText('tsconfig.netlify.json'));
    expect(prodTsconfig.compilerOptions?.noUncheckedIndexedAccess).toBe(true);
    expect(netlifyTsconfig.compilerOptions?.noUncheckedIndexedAccess).toBe(true);
  });
});

describe('CI change scope classification', () => {
  const config = {
    maxFiles: 3,
    docsOnly: {
      directories: ['docs/**'],
      rootFiles: ['README.md'],
      excluded: ['docs/api/**'],
    },
    functionsOnly: {
      directories: ['functions/**'],
      supportFiles: ['scripts/check-firebase-function-regions.mjs'],
      excluded: ['functions/package.json', 'functions/package-lock.json'],
    },
  };

  const changed = (filename: string, status = 'modified') => ({ filename, status });

  it('classifies only explicit documentation paths as docs-only', () => {
    expect(
      classifyCiChangeScope({
        eventName: 'pull_request',
        files: [changed('README.md'), changed('docs/CI_GATES.md')],
        config,
      })
    ).toMatchObject({ scope: 'docs-only', usedFallback: false });
  });

  it('classifies function source and its approved verification helper as functions-only', () => {
    expect(
      classifyCiChangeScope({
        eventName: 'pull_request',
        files: [
          changed('functions/src/index.ts'),
          changed('scripts/check-firebase-function-regions.mjs'),
        ],
        config,
      })
    ).toMatchObject({ scope: 'functions-only', usedFallback: false });
  });

  it.each([
    ['pushes', 'push', [changed('docs/guide.md')]],
    ['mixed paths', 'pull_request', [changed('docs/guide.md'), changed('src/App.tsx')]],
    ['generated API docs', 'pull_request', [changed('docs/api/index.html')]],
    ['function dependencies', 'pull_request', [changed('functions/package.json')]],
    ['workflow changes', 'pull_request', [changed('.github/workflows/ci-cd.yml')]],
    ['deletions', 'pull_request', [changed('docs/old.md', 'removed')]],
    ['missing files', 'pull_request', []],
    [
      'large changes',
      'pull_request',
      [changed('docs/1.md'), changed('docs/2.md'), changed('docs/3.md'), changed('docs/4.md')],
    ],
  ])('falls back to full for %s', (_label, eventName, files) => {
    expect(classifyCiChangeScope({ eventName, files, config }).scope).toBe('full');
  });

  it('collects a revision-pinned git diff and marks deletions or renames unsafe', () => {
    const execFile = vi
      .fn()
      .mockReturnValue(
        Buffer.from(
          ':100644 100644 abcdef0 abcdef1 M\0docs/guide.md\0:100644 000000 abcdef0 0000000 D\0docs/old.md\0:100644 100644 abcdef0 abcdef1 R100\0src/old.ts\0docs/renamed.ts\0'
        )
      );

    expect(
      collectChangedFilesFromGit({
        root: '/tmp/candidate',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        execFile,
      })
    ).toEqual([
      { filename: 'docs/guide.md', status: 'modified' },
      { filename: 'docs/old.md', status: 'unsafe' },
      { filename: 'docs/renamed.ts', status: 'unsafe' },
    ]);
    expect(execFile).toHaveBeenCalledOnce();
  });

  it('preserves Git pathname identity when safe and unsafe paths resemble each other', () => {
    expect(
      parseGitNameStatus(Buffer.from('R100\0src/old.ts\0docs\\guide.md\0A\0docs/guide.md\0'))
    ).toEqual([
      { filename: 'docs\\guide.md', status: 'unsafe' },
      { filename: 'docs/guide.md', status: 'modified' },
    ]);
  });

  it('applies the repository tooling-only and docs-only classification policies', () => {
    const repositoryConfig = loadCiChangeScopeConfig(process.cwd());
    const classify = (files: ReturnType<typeof changed>[]) =>
      classifyCiChangeScope({ eventName: 'pull_request', files, config: repositoryConfig });

    expect(
      classify([
        changed('scripts/check-module-size.mjs'),
        changed('src/tests/build/moduleSizeGovernance.test.ts'),
      ]).scope
    ).toBe('tooling-only');
    expect(
      classify([
        changed('docs/architecture.md'),
        changed('src/context/README.md'),
        changed('src/services/firebase-runtime/README.md'),
      ]).scope
    ).toBe('docs-only');
    expect(
      classify([changed('src/context/README.md'), changed('src/context/AuthContext.tsx')]).scope
    ).toBe('full');

    for (const files of [
      [changed('scripts/check-bundle-budget.mjs')],
      [changed('scripts/check-rayen-extension-release.mjs')],
      [changed('scripts/check-quality-aggregate.mjs')],
      [changed('scripts/check-module-size.mjs'), changed('src/App.tsx')],
      [changed('scripts/check-module-size.mjs', 'removed')],
      [changed('scripts/check-module-size.mjs', 'renamed')],
      [changed('scripts/config/guardrail-governance.json')],
      [changed('scripts/lib/firebase-emulator-ci.sh')],
    ]) {
      expect(classify(files).scope).toBe('full');
    }
  });

  it('forces full validation for a new symlink in an allowed test directory', () => {
    const files = collectChangedFilesFromGit({
      root: '/tmp/candidate',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      execFile: vi
        .fn()
        .mockImplementation((_command: string, args: string[]) =>
          Buffer.from(
            args.includes('--raw')
              ? ':000000 120000 0000000 abcdef0 A\0src/tests/build/link.ts\0'
              : 'A\0src/tests/build/link.ts\0'
          )
        ),
    });
    expect(
      classifyCiChangeScope({
        eventName: 'pull_request',
        files,
        config: loadCiChangeScopeConfig(process.cwd()),
      }).scope
    ).toBe('full');
  });
});
