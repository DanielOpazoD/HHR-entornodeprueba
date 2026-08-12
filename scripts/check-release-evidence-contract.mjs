#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { getGitReportState } from './gitReportState.mjs';
import { collectReleaseEvidenceContractIssues } from './releaseEvidenceContract.mjs';
import {
  collectBuiltReleaseEvidenceIssues,
  collectReleaseEvidenceManifestIssues,
} from './releaseEvidenceManifestSupport.mjs';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const builtAsset = process.argv.includes('--built-asset');
const issues = collectReleaseEvidenceContractIssues();
let manifest;

if (strict) {
  const manifestPath = path.join(root, 'reports', 'release-evidence-contract.json');
  if (!fs.existsSync(manifestPath)) {
    issues.push('reports/release-evidence-contract.json is missing.');
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      issues.push(
        ...collectReleaseEvidenceManifestIssues({
          manifest,
          currentGitState: getGitReportState(root),
        })
      );
    } catch (error) {
      issues.push(
        `reports/release-evidence-contract.json is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

if (builtAsset) {
  const builtAssetPath = path.join(root, 'dist', 'release-evidence.json');
  if (!manifest) {
    issues.push('Cannot validate the built release evidence without a valid strict manifest.');
  } else if (!fs.existsSync(builtAssetPath)) {
    issues.push('dist/release-evidence.json is missing.');
  } else {
    try {
      const runtimeManifest = JSON.parse(fs.readFileSync(builtAssetPath, 'utf8'));
      issues.push(...collectBuiltReleaseEvidenceIssues({ runtimeManifest, manifest }));
    } catch (error) {
      issues.push(
        `dist/release-evidence.json is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

if (issues.length > 0) {
  console.error('[release-evidence-contract] Contract violations:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(
  `[release-evidence-contract] OK${strict ? ' (freshness enforced)' : ''}${builtAsset ? ' (built asset verified)' : ''}`
);
