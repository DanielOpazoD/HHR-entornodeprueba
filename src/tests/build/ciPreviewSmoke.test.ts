import fs from 'node:fs';
import { expect, it } from 'vitest';
import { renderPreviewSummary } from '../../../scripts/report-preview-summary.mjs';

it('runs census and library preview smoke together against the existing build', () => {
  const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;

  expect(scripts['ci:preview-smoke:built']).toBe(
    'PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 playwright test -c playwright.preview.config.ts e2e/census-preview-bootstrap.spec.ts e2e/clinical-library-smoke.spec.ts --project=chromium'
  );
  expect(scripts['ci:preview-gate'].split(' && ')).toEqual([
    'npm run check:bundle-budget',
    'npm run check:chunk-graph',
    'npm run check:runtime-asset-margin',
    'npm run ci:preview-smoke:built',
  ]);
  expect(fs.readFileSync('.github/workflows/preview.yml', 'utf8')).toContain(
    'run: npm run ci:preview-gate'
  );
  expect(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8')).toContain(
    'run: npm run ci:preview-smoke:built'
  );
});

it('summarizes nested results without hiding failures, skips or global errors', () => {
  const spec = (file: string, title: string, status: string) => ({
    file,
    title,
    line: 42,
    tests: [{ status, results: [{ duration: 1000 }] }],
  });
  const summary = renderPreviewSummary({
    stats: { duration: 4500 },
    errors: [{ message: 'Sensitive error content must not be copied' }],
    suites: [
      {
        suites: [
          {
            specs: [
              spec('census-preview-bootstrap.spec.ts', 'keeps navigation at 375px', 'expected'),
              spec('census-preview-bootstrap.spec.ts', 'loads persisted state', 'unexpected'),
              spec('clinical-library-smoke.spec.ts', 'opens tools', 'skipped'),
            ],
          },
        ],
      },
    ],
  });
  expect(summary).toContain('Censo: navegación adaptable | ✅ 1/1 | 1.0 s');
  expect(summary).toContain('Censo: arranque y recargas | ⚠️ 0/1');
  expect(summary).toContain('Biblioteca: documentos y herramientas | ⚠️ 0/1');
  expect(summary).toContain('census-preview-bootstrap.spec.ts:42');
  expect(summary).toContain('(skipped)');
  expect(summary).toContain('4.5 s');
  expect(summary).toContain('errores globales');
  expect(summary).not.toContain('Sensitive error content');
});

it('does not present an empty or malformed report as a successful run', () => {
  expect(renderPreviewSummary({ suites: [], stats: { duration: 0 } })).toContain(
    'No se ejecutaron pruebas'
  );
  expect(() => renderPreviewSummary({})).toThrow('Informe incompleto');
  for (const workflow of ['preview.yml', 'ci-cd.yml']) {
    expect(fs.readFileSync(`.github/workflows/${workflow}`, 'utf8')).toContain(
      'name: Summarize census and library results\n        if: always()\n        run: node scripts/report-preview-summary.mjs'
    );
  }
});
