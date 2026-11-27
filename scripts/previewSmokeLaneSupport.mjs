import fs from 'node:fs';
import path from 'node:path';

export const PREVIEW_SMOKE_SCRIPT = 'ci:preview-smoke:built';
export const PREVIEW_SMOKE_CONFIG = 'playwright.preview.config.ts';
export const DICOM_PREVIEW_SPEC = 'e2e/dicom-viewer.spec.ts';
export const GRAPHICS_STRESS_TAG = '@graphics-stress';

/**
 * The canonical preview pack is the spec list of `ci:preview-smoke:built`.
 *
 * @returns {string[]}
 */
export const readPreviewSmokeSpecs = (root = process.cwd()) => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const command = scripts?.[PREVIEW_SMOKE_SCRIPT];
  if (typeof command !== 'string') {
    throw new Error(`package.json is missing the ${PREVIEW_SMOKE_SCRIPT} script.`);
  }
  const specs = command.split(/\s+/).filter(token => /^e2e\/.+\.spec\.ts$/.test(token));
  if (!specs.includes(DICOM_PREVIEW_SPEC)) {
    throw new Error(`${PREVIEW_SMOKE_SCRIPT} no longer includes ${DICOM_PREVIEW_SPEC}.`);
  }
  return specs;
};

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildExactTitlePattern = titles =>
  `(?:${titles.map(title => `(?:^|\\s)${escapeRegex(title)}(?:\\s|$)`).join('|')})`;

/**
 * Duration-balanced DICOM lane assignments based on observed CI runs (run 45918459117).
 * Each of the four heaviest 3D/WebGL tests (29–41 s) gets its own lane (`dicom-1`..`dicom-4`);
 * `dicom-5` is the complement of `@graphics-stress` and `dicom-1`..`dicom-4` so it stays
 * slightly lighter (~89 s vs ~95–99 s) and automatically absorbs any newly added test without
 * dropping coverage.
 */
export const DICOM_BALANCED_LANE_TITLES = Object.freeze({
  'dicom-1': [
    'cancels a 3D MP4 and restores the camera',
    'lists measurements by slice, jumps to them and copies plain text',
    'rotates MPR about a shared physical point and projects full-width slabs safely',
    'cine exports an ordered inclusive MP4 with direct download and cancellation',
    'draws an Original measurement into the MP4 frame of its own slice only',
    'handles gap sources without losing Original or hiding selection',
    'quantitative MPR blocks uncalibrated intensities',
    'renews expired study access silently and completes the series',
  ],
  'dicom-2': [
    'turns the 3D view into a downloadable MP4 about a chosen axis and restores the camera',
    'handles localizer sources without losing Original or hiding selection',
    'recovers only failed cuts and plays a bounded available interval while incomplete',
    'dismisses tool menus outside and previews the report inside the viewer at 1280px',
    'measures cold DICOM startup with controlled metadata and module latency',
    'comparison safely handles foreign frame',
    'compacts controls, exposes keyboard navigation and reuses sequential prefetched series',
    'blocks an original from another patient before rendering or allowing captures',
  ],
  'dicom-3': [
    'loads only on explicit open, renders original/MPR/3D, captures PNG and appends patient-bound Word annexes',
    'compares verified series by physical position and reuses one series for independent windows',
    'draws the measurements, but not the crosshairs, into the PNG capture',
    'draws an MPR measurement into the sweep frame of its own slice only',
    'reuses originals across verified studies and releases them when the patient review closes',
    'comparison safely handles foreign patient',
    'explains incompatible reference frames in MPR and 3D and preserves the original view',
    'shows verified cuts progressively and prioritizes navigation before the volume is complete',
  ],
  'dicom-4': [
    'links MPR coordinates and renders reversible 3D tissue controls',
    'measures dragged millimetres in Original and keeps them across views',
    'labels radiograph distances by where they were calibrated',
    'Original reports HU on validated CT',
    'quantitative MPR measures calibrated HU and ROI',
    'comparison safely handles perpendicular',
    'rejects unsafe heterogeneous padding and recovers original',
    'supports manual entry at mobile width without horizontal overflow',
  ],
});

/**
 * Lanes are balanced by observed duration, not file-order test count. The stress lane
 * runs only the tagged software-WebGL stress loop (~120 s in CI); the remaining DICOM
 * tests are partitioned across five duration-balanced lanes (`dicom-1`..`dicom-4` by
 * explicit title sets and `dicom-5` as their exact complement) so no two heavy 3D MP4
 * tests share a lane and newly added tests automatically land in `dicom-5`.
 * The merge job proves the union of all lanes is exactly the canonical pack, so
 * a lane change cannot drop or duplicate a test.
 *
 * @param {string[]} specs
 * @returns {Record<string, string[]>} Playwright arguments per lane.
 */
export const buildPreviewSmokeLanes = specs => {
  const appSpecs = specs.filter(spec => spec !== DICOM_PREVIEW_SPEC);
  const explicitDicomTitles = Object.values(DICOM_BALANCED_LANE_TITLES).flat();
  const dicomExplicitLane = titles => [
    DICOM_PREVIEW_SPEC,
    '--fully-parallel',
    '--grep-invert',
    GRAPHICS_STRESS_TAG,
    '--grep',
    buildExactTitlePattern(titles),
  ];
  const dicomComplementInvertPattern = `(?:${escapeRegex(GRAPHICS_STRESS_TAG)}|${buildExactTitlePattern(explicitDicomTitles)})`;

  return {
    app: appSpecs,
    'dicom-graphics-stress': [DICOM_PREVIEW_SPEC, '--grep', GRAPHICS_STRESS_TAG],
    'dicom-1': dicomExplicitLane(DICOM_BALANCED_LANE_TITLES['dicom-1']),
    'dicom-2': dicomExplicitLane(DICOM_BALANCED_LANE_TITLES['dicom-2']),
    'dicom-3': dicomExplicitLane(DICOM_BALANCED_LANE_TITLES['dicom-3']),
    'dicom-4': dicomExplicitLane(DICOM_BALANCED_LANE_TITLES['dicom-4']),
    'dicom-5': [
      DICOM_PREVIEW_SPEC,
      '--fully-parallel',
      '--grep-invert',
      dicomComplementInvertPattern,
    ],
  };
};

export const PREVIEW_SMOKE_LANE_NAMES = Object.keys(buildPreviewSmokeLanes([DICOM_PREVIEW_SPEC]));

const collectTests = report => {
  const tests = [];
  const walk = suite => {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        tests.push({
          id: `${spec.id}:${test.projectName || test.projectId || ''}`,
          label: `${spec.file}:${spec.line} ${spec.title}`,
          results: Array.isArray(test.results) ? test.results.length : 0,
        });
      }
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const suite of report?.suites || []) walk(suite);
  return tests;
};

/** Compare the merged lane report against `playwright test --list` of the full pack. */
export const collectPreviewSmokeCompletenessIssues = ({ listed, merged }) => {
  const expected = collectTests(listed);
  const actual = collectTests(merged);
  const issues = [];

  if (expected.length === 0) {
    issues.push('The canonical preview pack lists no tests.');
  }

  const actualById = new Map();
  for (const test of actual) {
    if (actualById.has(test.id)) {
      issues.push(`Preview test appears more than once in the merged report: ${test.label}`);
    }
    actualById.set(test.id, test);
  }

  const expectedIds = new Set(expected.map(test => test.id));
  for (const test of expected) {
    const ran = actualById.get(test.id);
    if (!ran) {
      issues.push(`Preview test did not run in any lane: ${test.label}`);
    } else if (ran.results !== 1) {
      issues.push(`Preview test ran ${ran.results} times instead of once: ${test.label}`);
    }
  }
  for (const test of actual) {
    if (!expectedIds.has(test.id)) {
      issues.push(`Merged report has a test outside the canonical pack: ${test.label}`);
    }
  }

  return issues;
};
