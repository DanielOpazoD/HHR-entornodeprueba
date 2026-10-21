#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { PREVIEW_BOOTSTRAP_REPORT } from './previewBootstrapEvidenceSupport.mjs';
import {
  collectPreviewSmokeCompletenessIssues,
  PREVIEW_SMOKE_CONFIG,
  readPreviewSmokeSpecs,
} from './previewSmokeLaneSupport.mjs';

// `--list` only collects tests; it neither starts the preview server nor a browser.
const listing = spawnSync(
  'npx',
  [
    'playwright',
    'test',
    '-c',
    PREVIEW_SMOKE_CONFIG,
    ...readPreviewSmokeSpecs(),
    '--project=chromium',
    '--list',
    '--reporter=json',
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
if (listing.status !== 0) {
  process.stderr.write(listing.stderr || '');
  console.error('[preview-smoke] Could not list the canonical preview pack.');
  process.exit(1);
}

const issues = collectPreviewSmokeCompletenessIssues({
  listed: JSON.parse(listing.stdout),
  merged: JSON.parse(fs.readFileSync(PREVIEW_BOOTSTRAP_REPORT, 'utf8')),
});

if (issues.length > 0) {
  console.error('[preview-smoke] Merged lanes do not match the canonical preview pack:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('[preview-smoke] Every canonical preview test ran exactly once across the lanes.');
