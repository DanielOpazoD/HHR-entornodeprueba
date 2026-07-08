#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildClinicalReleaseSignoffReport,
  formatClinicalReleaseSignoffMarkdown,
} from './clinicalReleaseSignoffSupport.mjs';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const JSON_OUTPUT = path.join(REPORTS_DIR, 'clinical-release-signoff.json');
const MD_OUTPUT = path.join(REPORTS_DIR, 'clinical-release-signoff.md');

const report = buildClinicalReleaseSignoffReport(ROOT, { requirePassed: true });

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(MD_OUTPUT, `${formatClinicalReleaseSignoffMarkdown(report)}\n`, 'utf8');

console.log('[clinical-release-signoff] Report generated at reports/clinical-release-signoff.{md,json}');
