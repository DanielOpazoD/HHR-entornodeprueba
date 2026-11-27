// @vitest-environment node
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { collectE2eOwnershipIssues } from '../../../scripts/testExecutionManifestSupport.mjs';
import { renderPreviewSummary } from '../../../scripts/report-preview-summary.mjs';
import {
  buildPreviewSmokeLanes,
  collectPreviewSmokeCompletenessIssues,
  DICOM_BALANCED_LANE_TITLES,
  DICOM_PREVIEW_SPEC,
  GRAPHICS_STRESS_TAG,
  PREVIEW_SMOKE_LANE_NAMES,
  readPreviewSmokeSpecs,
} from '../../../scripts/previewSmokeLaneSupport.mjs';
import { parseWorkflow } from './workflowYamlTestSupport';

it('runs census, library, pharmacy, clinical-panel, sync-navigation and DICOM/carryover/laboratory preview smoke together against the existing build', () => {
  const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;

  expect(scripts['ci:preview-smoke:built']).toContain('PLAYWRIGHT_SKIP_PREVIEW_BUILD=1');
  expect(scripts['ci:preview-smoke:built']).toContain('-c playwright.preview.config.ts');
  expect(readPreviewSmokeSpecs().length).toBeGreaterThanOrEqual(9);
  // CI runs the same pack in parallel lanes and merges one canonical report.
  expect(fs.existsSync('.github/workflows/preview.yml')).toBe(false);
  const ownership = JSON.parse(fs.readFileSync('scripts/config/e2e-test-ownership.json', 'utf8'));
  expect(
    collectE2eOwnershipIssues(
      [
        ...new Set([
          ...ownership.specs.map((entry: { file: string }) => entry.file),
          ...readPreviewSmokeSpecs(),
        ]),
      ],
      ownership,
      process.cwd()
    )
  ).toEqual([]);
  const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
  // One job builds the production bundle; every preview lane serves that same dist artifact.
  expect(jobs['preview-build']).toBeUndefined();
  const buildJob = jobs.build;
  expect(buildJob.needs).toEqual(['ci-scope']);
  const buildRuns = buildJob.steps.map(step => step.run ?? '');
  const bundleUpload = buildJob.steps.findIndex(step => step.with?.name === 'dist');
  expect(buildRuns.indexOf('npm run build')).toBeGreaterThanOrEqual(0);
  expect(buildRuns.indexOf('npm run build')).toBeLessThan(bundleUpload);
  expect(buildJob.steps[bundleUpload]).toMatchObject({
    uses: 'actions/upload-artifact@v7',
    with: { path: 'dist/', 'if-no-files-found': 'error' },
  });
  const lanes = jobs['preview-smoke-lanes'];
  expect(lanes.needs).toEqual(['ci-scope', 'build']);
  expect(lanes.strategy?.['fail-fast']).toBe(false);
  expect(lanes.strategy?.matrix.lane).toEqual(PREVIEW_SMOKE_LANE_NAMES);
  const laneRuns = lanes.steps.map(step => step.run ?? '');
  expect(laneRuns).not.toContain('npm run build');
  const bundleDownload = lanes.steps.findIndex(step => step.with?.name === 'dist');
  expect(lanes.steps[bundleDownload]).toMatchObject({
    uses: 'actions/download-artifact@v7',
    with: { path: 'dist' },
  });
  expect(bundleDownload).toBeLessThan(
    laneRuns.indexOf('node scripts/run-preview-smoke-lane.mjs --lane=${{ matrix.lane }}')
  );
  // A failed bundle fails every lane instead of skipping them, which would look green.
  expect(lanes.if).toBe("${{ !cancelled() && needs.ci-scope.outputs.scope == 'full' }}");
  expect(lanes.steps[0]).toMatchObject({ if: "needs.build.result != 'success'" });
  expect(lanes.steps[0].run).toContain('exit 1');

  expect(fs.readFileSync('playwright.preview.config.ts', 'utf8')).toContain(
    'preview-smoke-blob-${previewLane}.zip'
  );

  for (const lane of PREVIEW_SMOKE_LANE_NAMES) {
    // Playwright blobs are zips already: upload them as-is and download without
    // decompressing, so download-artifact never stream-unzips a zip within a zip.
    const blob = `preview-smoke-blob-${lane}.zip`;
    const upload = lanes.steps.find(step => step.with?.name === blob);
    expect(upload?.if).toBe(`always() && matrix.lane == '${lane}'`);
    expect(upload?.uses).toBe('actions/upload-artifact@v7');
    expect(upload?.with).toMatchObject({
      path: `reports/e2e/preview-blobs/${lane}/${blob}`,
      archive: false,
      'if-no-files-found': 'error',
    });
    const download = jobs['final-confidence-and-readiness'].steps.find(
      step => step.with?.name === blob
    );
    expect(download?.uses).toBe('actions/download-artifact@v8');
    expect(download?.with).toEqual({
      name: blob,
      path: 'reports/e2e/preview-blobs',
      'skip-decompress': true,
    });
  }
  expect(JSON.stringify(jobs.build)).not.toContain('preview');
  const mergeRuns = jobs['final-confidence-and-readiness'].steps.map(step => step.run ?? '');
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
  expect(lanes.app).toContain('e2e/clinical-library-pharmacy.spec.ts');
  expect(lanes.app).toContain('e2e/census-laboratory-inbox.spec.ts');
  expect(lanes.app).toContain('e2e/mmrad-history-recovery.spec.ts');
  expect(lanes.app).not.toContain(DICOM_PREVIEW_SPEC);
  expect(lanes['dicom-graphics-stress']).toEqual([
    DICOM_PREVIEW_SPEC,
    '--grep',
    GRAPHICS_STRESS_TAG,
  ]);
  const explicitDicomLanes = ['dicom-1', 'dicom-2'] as const;
  const allExplicitTitles = explicitDicomLanes.flatMap(lane => DICOM_BALANCED_LANE_TITLES[lane]);
  expect(new Set(allExplicitTitles).size).toBe(allExplicitTitles.length);

  for (const lane of explicitDicomLanes) {
    const args = lanes[lane];
    expect(args.slice(0, 5)).toEqual([
      DICOM_PREVIEW_SPEC,
      '--fully-parallel',
      '--grep-invert',
      GRAPHICS_STRESS_TAG,
      '--grep',
    ]);
    expect(args).toHaveLength(6);
    expect(() => new RegExp(args[5])).not.toThrow();
  }

  expect(lanes['dicom-3'].slice(0, 3)).toEqual([
    DICOM_PREVIEW_SPEC,
    '--fully-parallel',
    '--grep-invert',
  ]);
  expect(lanes['dicom-3']).toHaveLength(4);
  expect(() => new RegExp(lanes['dicom-3'][3])).not.toThrow();

  // Prove exact 1x partitioning across all four DICOM lanes, including any future test
  // not listed in DICOM_BALANCED_LANE_TITLES (which must fall cleanly into dicom-3).
  const dicomLaneNames = ['dicom-graphics-stress', 'dicom-1', 'dicom-2', 'dicom-3'] as const;
  const matchesLane = (laneName: (typeof dicomLaneNames)[number], fullTitle: string) => {
    const args = lanes[laneName];
    const grepIdx = args.indexOf('--grep');
    const invertIdx = args.indexOf('--grep-invert');
    if (grepIdx !== -1 && !new RegExp(args[grepIdx + 1]).test(fullTitle)) return false;
    if (invertIdx !== -1 && new RegExp(args[invertIdx + 1]).test(fullTitle)) return false;
    return true;
  };

  for (const lane of explicitDicomLanes) {
    for (const title of DICOM_BALANCED_LANE_TITLES[lane]) {
      const fullTitle = `dicom-viewer.spec.ts DICOM viewer and Salvador annexes ${title}`;
      const matched = dicomLaneNames.filter(name => matchesLane(name, fullTitle));
      expect(matched, title).toEqual([lane]);
    }
  }

  expect(
    dicomLaneNames.filter(name =>
      matchesLane(
        name,
        `dicom-viewer.spec.ts DICOM viewer and Salvador annexes stress case ${GRAPHICS_STRESS_TAG}`
      )
    )
  ).toEqual(['dicom-graphics-stress']);

  expect(
    dicomLaneNames.filter(name =>
      matchesLane(
        name,
        'dicom-viewer.spec.ts DICOM viewer and Salvador annexes newly added future dicom test'
      )
    )
  ).toEqual(['dicom-3']);

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
  const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
  const summarize = jobs['final-confidence-and-readiness'].steps.find(
    step => step.name === 'Summarize census and library results'
  );
  expect(summarize?.if).toBe('always()');
  expect(summarize?.run?.startsWith('node scripts/report-preview-summary.mjs')).toBe(true);
});
