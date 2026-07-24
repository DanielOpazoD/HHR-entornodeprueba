import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  buildBaseline,
  collectBaselineUpdateIssues,
  collectExtensionMetrics,
  evaluateExtensionHotspots,
} from '../../../scripts/check-extension-hotspots.mjs';

type Baseline = {
  $schemaNote: string;
  schemaVersion: number;
  extensionRoot: string;
  complexityThreshold: number;
  vendorFiles: string[];
  files: Record<string, { maxLines: number; hotspots: Record<string, number> }>;
};

const baselineTemplate = (): Baseline => ({
  $schemaNote: 'fixture',
  schemaVersion: 1,
  extensionRoot: 'extension',
  complexityThreshold: 15,
  vendorFiles: ['vendor.min.js'],
  files: {},
});

const complexFunction = (name: string, branches: number, prefix = '') => `${prefix}
function ${name}(value) {
${Array.from({ length: branches }, (_, index) => `  if (value === ${index}) return ${index};`).join('\n')}
  return -1;
}
`;

const createFixture = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-hotspots-'));
  const extensionRoot = path.join(root, 'extension');
  fs.mkdirSync(extensionRoot, { recursive: true });
  fs.writeFileSync(path.join(extensionRoot, 'vendor.min.js'), 'minified();\n');
  for (const [file, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(extensionRoot, file), source);
  }
  return root;
};

const currentBaseline = (root: string, template = baselineTemplate()) => {
  const metrics = collectExtensionMetrics({ root, baseline: template });
  return buildBaseline({ baseline: template, metrics }) as Baseline;
};

describe('extension hotspot budget', () => {
  it('governs the complete current authored extension inventory', () => {
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'scripts/config/extension-hotspots-baseline.json'),
        'utf8'
      )
    ) as Baseline;
    const metrics = collectExtensionMetrics({ root: process.cwd(), baseline });

    expect(metrics.authoredFiles).toHaveLength(71);
    expect(
      Object.values(metrics.files).reduce(
        (total, file) => total + Object.keys(file.hotspots).length,
        0
      )
    ).toBe(86);
    expect(evaluateExtensionHotspots({ baseline, metrics })).toEqual([]);
  });

  it('uses stable function identities when line numbers move', () => {
    const root = createFixture({ 'owned.js': complexFunction('legacy', 15) });
    const baseline = currentBaseline(root);
    fs.writeFileSync(
      path.join(root, 'extension/owned.js'),
      complexFunction('legacy', 15, '\n\n// moved without semantic changes')
    );

    const metrics = collectExtensionMetrics({ root, baseline });
    const ownedMetrics = (
      metrics.files as Record<string, { lines: number; hotspots: Record<string, number> }>
    )['owned.js'];
    expect(Object.keys(ownedMetrics.hotspots)).toEqual(
      Object.keys(baseline.files['owned.js'].hotspots)
    );
    expect(Object.values(ownedMetrics.hotspots)).toEqual(
      Object.values(baseline.files['owned.js'].hotspots)
    );
  });

  it('keeps a complex callback identity stable when a simple sibling is inserted', () => {
    const complexCallback = `items.forEach(value => {
${Array.from({ length: 15 }, (_, index) => `  if (value === ${index}) return ${index};`).join('\n')}
});`;
    const root = createFixture({ 'owned.js': complexCallback });
    const baseline = currentBaseline(root);
    fs.writeFileSync(
      path.join(root, 'extension/owned.js'),
      `items.forEach(() => 0);\n${complexCallback}\n`
    );

    const metrics = collectExtensionMetrics({ root, baseline });
    const ownedMetrics = (
      metrics.files as Record<string, { lines: number; hotspots: Record<string, number> }>
    )['owned.js'];
    expect(ownedMetrics.hotspots).toEqual(baseline.files['owned.js'].hotspots);
  });

  it('budgets class field initializers and class static blocks', () => {
    const conditions = Array.from(
      { length: 15 },
      (_, index) => `value === ${index} ? ${index} : `
    ).join('');
    const branches = Array.from(
      { length: 15 },
      (_, index) => `if (value === ${index}) result += 1;`
    ).join('\n');
    const root = createFixture({
      'owned.js': `class Example {
  field = ${conditions}-1;
  static {
    const value = 1;
    let result = 0;
    ${branches}
  }
}\n`,
    });
    const baseline = currentBaseline(root);

    expect(baseline.files['owned.js'].hotspots).toMatchObject({
      'class-field:field': 16,
      'class-static-block': 16,
    });
  });

  it('rejects replacing a removed hotspot with a different complex function', () => {
    const root = createFixture({ 'owned.js': complexFunction('legacy', 15) });
    const baseline = currentBaseline(root);
    fs.writeFileSync(path.join(root, 'extension/owned.js'), complexFunction('replacement', 15));

    const issues = evaluateExtensionHotspots({
      baseline,
      metrics: collectExtensionMetrics({ root, baseline }),
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('hotspot nuevo function:replacement'),
        expect.stringContaining('hotspot resuelto u obsoleto function:legacy'),
      ])
    );
  });

  it('rejects growth in an existing hotspot', () => {
    const root = createFixture({ 'owned.js': complexFunction('legacy', 15) });
    const baseline = currentBaseline(root);
    fs.writeFileSync(path.join(root, 'extension/owned.js'), complexFunction('legacy', 16));

    expect(
      evaluateExtensionHotspots({
        baseline,
        metrics: collectExtensionMetrics({ root, baseline }),
      })
    ).toEqual(expect.arrayContaining([expect.stringContaining('aumentó de 16 a 17')]));
  });

  it('rejects authored file size growth without complexity changes', () => {
    const root = createFixture({ 'owned.js': 'const value = 1;\n' });
    const baseline = currentBaseline(root);
    fs.appendFileSync(path.join(root, 'extension/owned.js'), '// accidental growth\n');

    expect(
      evaluateExtensionHotspots({
        baseline,
        metrics: collectExtensionMetrics({ root, baseline }),
      })
    ).toEqual(expect.arrayContaining([expect.stringContaining('líneas exceden el límite')]));
  });

  it('rejects new authored files even when their names look vendored', () => {
    const root = createFixture({ 'owned.js': 'const value = 1;\n' });
    const baseline = currentBaseline(root);
    fs.writeFileSync(path.join(root, 'extension/lookalike.min.js'), complexFunction('hidden', 15));

    const metrics = collectExtensionMetrics({ root, baseline });
    expect(metrics.authoredFiles).toContain('lookalike.min.js');
    expect(evaluateExtensionHotspots({ baseline, metrics })).toEqual(
      expect.arrayContaining([expect.stringContaining('lookalike.min.js: falta')])
    );
  });

  it('allows baseline reductions but refuses automatic increases', () => {
    const root = createFixture({ 'owned.js': complexFunction('legacy', 15) });
    const previous = currentBaseline(root);
    fs.writeFileSync(path.join(root, 'extension/owned.js'), complexFunction('legacy', 14));
    const reduced = buildBaseline({
      baseline: previous,
      metrics: collectExtensionMetrics({ root, baseline: previous }),
    }) as Baseline;
    expect(collectBaselineUpdateIssues({ previous, next: reduced })).toEqual([]);

    fs.writeFileSync(path.join(root, 'extension/owned.js'), complexFunction('legacy', 16));
    const increased = buildBaseline({
      baseline: previous,
      metrics: collectExtensionMetrics({ root, baseline: previous }),
    }) as Baseline;
    expect(collectBaselineUpdateIssues({ previous, next: increased })).not.toEqual([]);
  });

  it('allows an empty authored file to remain a valid reduced baseline', () => {
    const root = createFixture({ 'owned.js': 'const value = 1;\n' });
    const previous = currentBaseline(root);
    fs.writeFileSync(path.join(root, 'extension/owned.js'), '');
    const metrics = collectExtensionMetrics({ root, baseline: previous });
    const reduced = buildBaseline({ baseline: previous, metrics }) as Baseline;

    expect(reduced.files['owned.js'].maxLines).toBe(0);
    expect(collectBaselineUpdateIssues({ previous, next: reduced })).toEqual([]);
    expect(evaluateExtensionHotspots({ baseline: reduced, metrics })).toEqual([]);
  });
});

describe('extension hotspot CI wiring', () => {
  it('keeps extension lint and hotspot checks blocking without a broad ignore', () => {
    const eslintConfig = fs.readFileSync(path.join(process.cwd(), 'eslint.config.js'), 'utf8');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    );
    const governance = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'scripts/config/guardrail-governance.json'), 'utf8')
    );

    expect(eslintConfig).not.toMatch(/['"]extension['"]/);
    expect(eslintConfig).toContain("files: ['extension/*.js']");
    expect(eslintConfig).toContain("'no-unused-vars': [\n        'error'");
    expect(packageJson.scripts['lint:extension']).toContain('extension/*.js');
    expect(packageJson.scripts['check:extension-hotspots']).toBe(
      'node scripts/check-extension-hotspots.mjs'
    );
    expect(governance.qualityAggregate.checks).toContainEqual({
      id: 'check:extension-hotspots',
      group: 'size',
    });
  });

  it('lints exactly the 71 authored JavaScript files with the real config', async () => {
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'scripts/config/extension-hotspots-baseline.json'),
        'utf8'
      )
    ) as Baseline;
    const results = await new ESLint({ cwd: process.cwd() }).lintFiles(['extension/*.js']);
    const lintedFiles = results.map(result => path.basename(result.filePath)).sort();

    expect(lintedFiles).toEqual(Object.keys(baseline.files).sort());
    expect(results.reduce((total, result) => total + result.errorCount, 0)).toBe(0);
    expect(results.reduce((total, result) => total + result.warningCount, 0)).toBe(0);
  });
});
