#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();

const fail = message => {
  console.error(`[operational-runbooks] ${message}`);
  process.exit(1);
};

const read = relativePath => {
  const absolutePath = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(
      `Required artifact missing: ${relativePath}. ` +
        `Regenerate operational artifacts with "npm run report:operational-health" ` +
        `(and the matching report:* commands listed in package.json) before running this check.`
    );
  }
  return fs.readFileSync(absolutePath, 'utf8');
};

const readJson = relativePath => {
  const raw = read(relativePath);
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`Cannot parse JSON at ${relativePath}: ${error.message}`);
  }
};

const requiredDocs = [
  {
    file: 'docs/RUNBOOK_SYNC_RESILIENCE.md',
    patterns: [
      'reports/operational-health.md',
      'legacy bridge',
      'conflictos por contexto',
      'RUNBOOK_OPERATIONAL_BUDGETS.md',
    ],
  },
  {
    file: 'docs/RUNBOOK_SUPPORT_OPERATIONS.md',
    patterns: [
      'report:operational-health',
      'report:legacy-bridge',
      'check:operational-runbooks',
      'legacy bridge',
    ],
  },
  {
    file: 'docs/RUNBOOK_OPERATIONAL_BUDGETS.md',
    patterns: [
      'warningOldestPendingAgeMs',
      'criticalOldestPendingAgeMs',
      'legacy-bridge-governance.md',
      'reports/operational-health.md',
    ],
  },
  {
    file: 'docs/RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md',
    patterns: [
      'reports/serverless-runtime-governance.md',
      'check:serverless-runtime-governance',
      'check:netlify-functions-bundle',
      'docs/SERVERLESS_SENSITIVE_CONTRACTS.md',
    ],
  },
  {
    file: 'docs/RUNBOOK_AI_PROVIDER_OPERATIONS.md',
    patterns: [
      'AI_PROVIDER',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'DEEPSEEK_API_KEY',
    ],
  },
  {
    file: 'docs/SERVERLESS_SENSITIVE_CONTRACTS.md',
    patterns: ['send-census-email', 'fhir-api', 'clinical-ai-summary', 'cie10-ai-search'],
  },
];

for (const doc of requiredDocs) {
  const content = read(doc.file);
  const missing = doc.patterns.filter(pattern => !content.includes(pattern));
  if (missing.length > 0) {
    fail(`${doc.file} is missing references to: ${missing.join(', ')}`);
  }
}

const report = readJson('reports/operational-health.json');
const requiredKeys = [
  'systemHealth',
  'syncQueue',
  'syncDomainProfiles',
  'conflictContexts',
  'legacyBridge',
  'compatibilityGovernance',
  'localPersistence',
  'frontendStartup',
  'repositoryPerformance',
  'runbooks',
];
const missingKeys = requiredKeys.filter(key => !(key in report));
if (missingKeys.length > 0) {
  fail(`reports/operational-health.json is missing keys: ${missingKeys.join(', ')}`);
}

if (!Array.isArray(report.syncDomainProfiles) || report.syncDomainProfiles.length === 0) {
  fail('reports/operational-health.json must include syncDomainProfiles entries');
}

if (!report.legacyBridge || typeof report.legacyBridge !== 'object') {
  fail('reports/operational-health.json must include legacyBridge summary');
}

if (!report.compatibilityGovernance || typeof report.compatibilityGovernance !== 'object') {
  fail('reports/operational-health.json must include compatibilityGovernance summary');
}

if (!Array.isArray(report.runbooks) || report.runbooks.length < 6) {
  fail('reports/operational-health.json must list the operational runbooks');
}

console.log('[operational-runbooks] OK');
