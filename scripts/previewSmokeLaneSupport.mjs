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
 * Duration-balanced DICOM lane assignments based on observed CI runs (run 45944646023).
 * Non-stress DICOM tests (~482 s total) are partitioned across three lanes (`dicom-1`,
 * `dicom-2` by explicit title sets ~163–166 s each, and `dicom-3` as their exact complement
 * at ~153 s) so no two 3D MP4 export tests share a lane, every lane stays within the wall-clock
 * window of `app` (~243 s total), and `dicom-3` automatically absorbs newly added tests without
 * dropping coverage.
 */
export const DICOM_BALANCED_LANE_TITLES = Object.freeze({
  'dicom-1': [
    'cancels a 3D MP4 and restores the camera',
    'reconstructs heterogeneous physical matrices with calibrated intensities and preserves originals',
    'handles localizer sources without losing Original or hiding selection',
    'draws the measurements, but not the crosshairs, into the PNG capture',
    'recovers only failed cuts and plays a bounded available interval while incomplete',
    'sweeps an MPR plane with its MIP slab into a back-and-forth MP4 and restores the view',
    'draws an Original measurement into the MP4 frame of its own slice only',
    'reuses originals across verified studies and releases them when the patient review closes',
    'comparison cancels secondary requests when leaving the viewer',
    'dismisses tool menus outside and previews the report inside the viewer at 390px',
    'compacts controls, exposes keyboard navigation and reuses sequential prefetched series',
    'comparison safely handles foreign patient',
    'supports manual entry at mobile width without horizontal overflow',
  ],
  'dicom-2': [
    'turns the 3D view into a downloadable MP4 about a chosen axis and restores the camera',
    'loads only on explicit open, renders original/MPR/3D, captures PNG and appends patient-bound Word annexes',
    'lists measurements by slice, jumps to them and copies plain text',
    'labels radiograph distances by where they were calibrated',
    'Original reports HU on validated CT',
    'cine exports an ordered inclusive MP4 with direct download and cancellation',
    'draws an MPR measurement into the sweep frame of its own slice only',
    'handles unmarked sources without losing Original or hiding selection',
    'handles gap sources without losing Original or hiding selection',
    'explains incompatible reference frames in MPR and 3D and preserves the original view',
    'comparison safely handles foreign frame',
    'shows verified cuts progressively and prioritizes navigation before the volume is complete',
    'renews expired study access silently and completes the series',
    'blocks an original from another patient before rendering or allowing captures',
  ],
});

/**
 * Lanes are balanced by observed duration, not file-order test count. The stress lane
 * runs only the tagged software-WebGL stress loop (~96 s in CI); the remaining DICOM
 * tests are partitioned across three duration-balanced lanes (`dicom-1` and `dicom-2` by
 * explicit title sets and `dicom-3` as their exact complement) so no two heavy 3D MP4
 * tests share a lane and newly added tests automatically land in `dicom-3`.
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
    'dicom-3': [
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
