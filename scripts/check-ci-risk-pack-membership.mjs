#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  normalizePatterns,
  patternExcludesFile,
  resolveUnitSuiteExcludePatterns,
} from './ciRiskPackMembershipSupport.mjs';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'scripts/config/ci-test-risk-packs.json');
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');

const fail = message => {
  console.error(`[ci-risk-pack-membership] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(CONFIG_PATH)) {
  fail('Missing scripts/config/ci-test-risk-packs.json');
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const criticalFiles = Array.isArray(config.criticalFiles) ? config.criticalFiles : [];
const configuredExcludedPatterns = Array.isArray(config.excludedFromUnitSuite)
  ? config.excludedFromUnitSuite
  : [];
const unitSuiteScript = typeof config.unitSuiteScript === 'string' ? config.unitSuiteScript : '';

if (criticalFiles.length === 0) {
  fail('criticalFiles is empty');
}

if (!unitSuiteScript) {
  fail('unitSuiteScript must name the npm script that runs the sharded unit suite');
}

const scriptCommand = packageJson.scripts?.[unitSuiteScript];
if (typeof scriptCommand !== 'string') {
  fail(`package.json is missing scripts.${unitSuiteScript}`);
}

const actualExcludedPatterns = resolveUnitSuiteExcludePatterns({ root: ROOT, scriptCommand });
const configured = normalizePatterns(configuredExcludedPatterns);
const actual = normalizePatterns(actualExcludedPatterns);

if (JSON.stringify(configured) !== JSON.stringify(actual)) {
  fail(
    [
      `excludedFromUnitSuite does not match package.json scripts.${unitSuiteScript}`,
      `configured: ${configured.join(', ') || '(none)'}`,
      `actual: ${actual.join(', ') || '(none)'}`,
    ].join('\n')
  );
}

const missingFiles = criticalFiles.filter(file => !fs.existsSync(path.join(ROOT, file)));
if (missingFiles.length > 0) {
  fail(`Critical risk files do not exist:\n${missingFiles.map(file => `- ${file}`).join('\n')}`);
}

const excludedCriticalFiles = criticalFiles.filter(file =>
  actualExcludedPatterns.some(pattern => patternExcludesFile(pattern, file))
);
if (excludedCriticalFiles.length > 0) {
  fail(
    `Critical risk files are excluded from ${unitSuiteScript}:\n${excludedCriticalFiles
      .map(file => `- ${file}`)
      .join('\n')}`
  );
}

console.log(`[ci-risk-pack-membership] OK (${criticalFiles.length} critical files covered)`);
