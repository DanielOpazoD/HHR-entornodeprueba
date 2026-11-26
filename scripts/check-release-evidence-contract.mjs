#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { getGitReportState, getReusedEvidenceSource } from './gitReportState.mjs';
import { collectReleaseEvidenceContractIssues } from './releaseEvidenceContract.mjs';
import { collectReleaseEvidenceManifestIssues } from './releaseEvidenceManifestSupport.mjs';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const issues = collectReleaseEvidenceContractIssues();

if (strict) {
  const manifestPath = path.join(root, 'reports', 'release-evidence-contract.json');
  if (!fs.existsSync(manifestPath)) {
    issues.push(`${path.relative(root, manifestPath)} is missing.`);
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      issues.push(
        ...collectReleaseEvidenceManifestIssues({
          manifest,
          currentGitState: getGitReportState(root),
          reusedEvidence: getReusedEvidenceSource(root),
        })
      );
    } catch (error) {
      issues.push(
        `${path.relative(root, manifestPath)} is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

if (issues.length > 0) {
  console.error('[release-evidence-contract] Contract violations:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`[release-evidence-contract] OK${strict ? ' (freshness enforced)' : ''}`);
