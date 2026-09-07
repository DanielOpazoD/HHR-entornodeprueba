import fs from 'node:fs';
import { expect, it } from 'vitest';

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
