#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { formatLegacyRetirementDebtMarkdown, loadLegacyRetirementDebtReport } from './legacyRetirementDebtSupport.mjs';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');

let report;
try {
  report = loadLegacyRetirementDebtReport(ROOT);
} catch (error) {
  console.error(`[legacy-retirement-debt] ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    '[legacy-retirement-debt] Run npm run report:legacy-bridge and npm run report:compatibility-governance before generating this report.'
  );
  process.exit(1);
}

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(
  path.join(REPORTS_DIR, 'legacy-retirement-debt.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(REPORTS_DIR, 'legacy-retirement-debt.md'),
  `${formatLegacyRetirementDebtMarkdown(report)}\n`,
  'utf8'
);

console.log('[legacy-retirement-debt] Report generated at reports/legacy-retirement-debt.{md,json}');
