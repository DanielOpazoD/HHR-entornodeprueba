// @vitest-environment node
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { renderPreviewSummary } from '../../../scripts/report-preview-summary.mjs';
import {
  buildPreviewSmokeLanes,
  collectPreviewSmokeCompletenessIssues,
  DICOM_PREVIEW_SPEC,
  GRAPHICS_STRESS_TAG,
  PREVIEW_SMOKE_LANE_NAMES,
  readPreviewSmokeSpecs,
} from '../../../scripts/previewSmokeLaneSupport.mjs';
import { parseWorkflow } from './workflowYamlTestSupport';

it('runs census, library, clinical-panel, sync-navigation and DICOM/carryover preview smoke together against the existing build', () => {
  const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;

  expect(scripts['ci:preview-smoke:built']).toBe(
    'PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 playwright test -c playwright.preview.config.ts e2e/census-preview-bootstrap.spec.ts e2e/clinical-library-smoke.spec.ts e2e/clinical-panel-reading-smoke.spec.ts e2e/census-sync-history-navigation.spec.ts e2e/dicom-viewer.spec.ts e2e/clinical-carryover-preview.spec.ts --project=chromium'
  );
  expect(scripts['ci:preview-gate'].split(' && ')).toEqual([
    'npm run check:bundle-budget',
    'npm run check:chunk-graph',
    'npm run check:runtime-asset-margin',
    'npm run ci:preview-smoke:built',
  ]);
  // CI runs the same pack in parallel lanes and merges one canonical report.
  expect(fs.existsSync('.github/workflows/preview.yml')).toBe(false);
  const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
  const lanes = jobs['preview-smoke-lanes'];
  expect(lanes.needs).toEqual(['ci-scope']);
  expect(lanes.strategy?.['fail-fast']).toBe(false);
  expect(lanes.strategy?.matrix.lane).toEqual(PREVIEW_SMOKE_LANE_NAMES);
  const laneRuns = lanes.steps.map(step => step.run ?? '');
  expect(laneRuns.indexOf('npm run build')).toBeLessThan(
    laneRuns.indexOf('node scripts/run-preview-smoke-lane.mjs --lane=${{ matrix.lane }}')
  );
  for (const lane of PREVIEW_SMOKE_LANE_NAMES) {
    const upload = lanes.steps.find(step => step.with?.name === `preview-smoke-blob-${lane}`);
    expect(upload?.if).toBe(`always() && matrix.lane == '${lane}'`);
    expect(upload?.with?.path).toBe(`reports/e2e/preview-blobs/${lane}/${lane}.zip`);
    expect(
      jobs['preview-smoke'].steps.some(
        step =>
          step.with?.name === `preview-smoke-blob-${lane}` &&
          step.with?.path === 'reports/e2e/preview-blobs'
      )
    ).toBe(true);
  }
  expect(JSON.stringify(jobs.build)).not.toContain('preview');
  const mergeRuns = jobs['preview-smoke'].steps.map(step => step.run ?? '');
  const merge = mergeRuns.findIndex(run => run.startsWith('npx playwright merge-reports'));
  expect(merge).toBeGreaterThanOrEqual(0);
  expect(mergeRuns.indexOf('test "$PREVIEW_LANES_RESULT" = success')).toBeGreaterThan(merge);
  expect(mergeRuns.indexOf('node scripts/check-preview-smoke-completeness.mjs')).toBeGreaterThan(
    merge
  );
});

it('splits the canonical preview pack into lanes that cover every spec', () => {
  const specs = readPreviewSmokeSpecs();
  const lanes = buildPreviewSmokeLanes(specs);
  const laneSpecs = Object.values(lanes).flatMap(args =>
    args.filter(arg => arg.endsWith('.spec.ts'))
  );

  expect(new Set(laneSpecs)).toEqual(new Set(specs));
  expect(lanes.app).not.toContain(DICOM_PREVIEW_SPEC);
  expect(lanes['dicom-graphics-stress']).toEqual([
    DICOM_PREVIEW_SPEC,
    '--grep',
    GRAPHICS_STRESS_TAG,
  ]);
  for (const shard of ['1/2', '2/2']) {
    expect(lanes[`dicom-${shard[0]}`]).toEqual([
      DICOM_PREVIEW_SPEC,
      '--fully-parallel',
      '--grep-invert',
      GRAPHICS_STRESS_TAG,
      `--shard=${shard}`,
    ]);
  }
  expect(fs.readFileSync(DICOM_PREVIEW_SPEC, 'utf8')).toContain(
    `{ tag: '${GRAPHICS_STRESS_TAG}' }`
  );
});

it('requires every listed preview test to run exactly once across lanes', () => {
  const report = (...ids: string[]) => ({
    suites: [
      {
        specs: ids.map(id => ({
          id,
          file: 'dicom-viewer.spec.ts',
          line: 1,
          title: id,
          tests: [{ projectName: 'chromium', results: [{ status: 'passed' }] }],
        })),
      },
    ],
  });
  const listed = {
    suites: [
      {
        specs: ['a', 'b'].map(id => ({
          id,
          file: 'dicom-viewer.spec.ts',
          line: 1,
          title: id,
          tests: [{ projectName: 'chromium', results: [] }],
        })),
      },
    ],
  };

  expect(collectPreviewSmokeCompletenessIssues({ listed, merged: report('a', 'b') })).toEqual([]);
  expect(collectPreviewSmokeCompletenessIssues({ listed, merged: report('a') })).toEqual([
    'Preview test did not run in any lane: dicom-viewer.spec.ts:1 b',
  ]);
  expect(
    collectPreviewSmokeCompletenessIssues({ listed, merged: report('a', 'b', 'b') })
  ).toContain('Preview test appears more than once in the merged report: dicom-viewer.spec.ts:1 b');
  expect(collectPreviewSmokeCompletenessIssues({ listed, merged: report('a', 'b', 'c') })).toEqual([
    'Merged report has a test outside the canonical pack: dicom-viewer.spec.ts:1 c',
  ]);
  expect(
    collectPreviewSmokeCompletenessIssues({ listed: { suites: [] }, merged: report() })
  ).toEqual(['The canonical preview pack lists no tests.']);
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
              spec('clinical-panel-reading-smoke.spec.ts', 'keeps clinical reading', 'expected'),
              spec('dicom-viewer.spec.ts', 'blocks wrong patient', 'expected'),
            ],
          },
        ],
      },
    ],
  });
  expect(summary).toContain('Censo: navegación adaptable | ✅ 1/1 | 1.0 s');
  expect(summary).toContain('Censo: arranque y recargas | ⚠️ 0/1');
  expect(summary).toContain('Biblioteca: documentos y herramientas | ⚠️ 0/1');
  expect(summary).toContain('Ficha clínica: lectura y navegación | ✅ 1/1');
  expect(summary).toContain('Radiología: DICOM y anexos | ✅ 1/1');
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
  for (const workflow of ['ci-cd.yml']) {
    expect(fs.readFileSync(`.github/workflows/${workflow}`, 'utf8')).toContain(
      'name: Summarize census and library results\n        if: always()\n        run: node scripts/report-preview-summary.mjs'
    );
  }
});
