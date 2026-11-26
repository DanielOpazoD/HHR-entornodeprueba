#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildReleaseEvidenceManifest,
  formatReleaseEvidenceManifestMarkdown,
} from './releaseEvidenceManifestSupport.mjs';

const root = process.cwd();
const reportsDir = path.join(root, 'reports');
const manifest = buildReleaseEvidenceManifest({ root });
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'release-evidence-contract.json'), manifestJson);
fs.writeFileSync(
  path.join(reportsDir, 'release-evidence-contract.md'),
  formatReleaseEvidenceManifestMarkdown(manifest)
);

console.log(
  `[release-evidence-contract] ${manifest.status}: ${manifest.summary.currentReports}/${manifest.summary.decisionReports} decision reports current for ${manifest.gitSha}`
);
