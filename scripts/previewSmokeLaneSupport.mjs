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

/**
 * Lanes are balanced by observed duration, not test count: the DICOM spec is
 * most of the pack and a single tagged software-WebGL stress test takes about
 * as long as each remaining DICOM half. The merge job proves the union of all
 * lanes is exactly the canonical pack, so a lane change cannot drop a test.
 *
 * @param {string[]} specs
 * @returns {Record<string, string[]>} Playwright arguments per lane.
 */
export const buildPreviewSmokeLanes = specs => {
  const appSpecs = specs.filter(spec => spec !== DICOM_PREVIEW_SPEC);
  const dicomHalf = shard => [
    DICOM_PREVIEW_SPEC,
    '--fully-parallel',
    '--grep-invert',
    GRAPHICS_STRESS_TAG,
    `--shard=${shard}/2`,
  ];
  return {
    app: appSpecs,
    'dicom-graphics-stress': [DICOM_PREVIEW_SPEC, '--grep', GRAPHICS_STRESS_TAG],
    'dicom-1': dicomHalf(1),
    'dicom-2': dicomHalf(2),
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
