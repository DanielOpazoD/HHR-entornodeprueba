#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildReleaseEvidenceManifest,
  buildRuntimeReleaseEvidenceManifest,
  formatReleaseEvidenceManifestMarkdown,
} from './releaseEvidenceManifestSupport.mjs';

const root = process.cwd();
const reportsDir = path.join(root, 'reports');
const runtimeDir = path.join(reportsDir, 'release-evidence-runtime');
const manifest = buildReleaseEvidenceManifest({ root });

fs.mkdirSync(runtimeDir, { recursive: true });
fs.writeFileSync(
  path.join(reportsDir, 'release-evidence-contract.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
fs.writeFileSync(
  path.join(runtimeDir, 'release-evidence-contract.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
fs.writeFileSync(
  path.join(reportsDir, 'release-evidence-contract.md'),
  formatReleaseEvidenceManifestMarkdown(manifest)
);
fs.writeFileSync(
  path.join(runtimeDir, 'release-evidence.json'),
  `${JSON.stringify(buildRuntimeReleaseEvidenceManifest(manifest), null, 2)}\n`
);

console.log(
  `[release-evidence-contract] ${manifest.status}: ${manifest.summary.currentReports}/${manifest.summary.decisionReports} decision reports current for ${manifest.gitSha}`
);
