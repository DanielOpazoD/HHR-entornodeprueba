#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import {
  buildPreviewSmokeLanes,
  PREVIEW_SMOKE_CONFIG,
  readPreviewSmokeSpecs,
} from './previewSmokeLaneSupport.mjs';

const laneArg = process.argv.find(arg => arg.startsWith('--lane='));
const lane = laneArg ? laneArg.slice('--lane='.length) : '';
const lanes = buildPreviewSmokeLanes(readPreviewSmokeSpecs());

if (!Object.hasOwn(lanes, lane)) {
  console.error(
    `[preview-smoke] Unknown lane "${lane || 'missing'}". Expected one of: ${Object.keys(lanes).join(', ')}.`
  );
  process.exit(1);
}

const args = [
  'playwright',
  'test',
  '-c',
  PREVIEW_SMOKE_CONFIG,
  ...lanes[lane],
  '--project=chromium',
];
console.log(`[preview-smoke] Lane ${lane}: npx ${args.join(' ')}`);
const result = spawnSync('npx', args, {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_SKIP_PREVIEW_BUILD: '1', PLAYWRIGHT_PREVIEW_LANE: lane },
});
process.exit(result.status ?? 1);
