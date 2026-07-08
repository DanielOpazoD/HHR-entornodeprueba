#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildClinicalReleaseValidationReport,
  formatClinicalReleaseValidationMarkdown,
} from './clinicalReleaseValidationSupport.mjs';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const JSON_OUTPUT = path.join(REPORTS_DIR, 'clinical-release-validation.json');
const MD_OUTPUT = path.join(REPORTS_DIR, 'clinical-release-validation.md');

const report = buildClinicalReleaseValidationReport(ROOT);

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(MD_OUTPUT, `${formatClinicalReleaseValidationMarkdown(report)}\n`, 'utf8');

console.log('[clinical-release-validation] Report generated at reports/clinical-release-validation.{md,json}');
