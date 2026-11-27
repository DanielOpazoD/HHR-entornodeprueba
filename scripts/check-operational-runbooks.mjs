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
      'conflictos por contexto',
      'RUNBOOK_OPERATIONAL_BUDGETS.md',
    ],
  },
  {
    file: 'docs/RUNBOOK_SUPPORT_OPERATIONS.md',
    patterns: ['report:operational-health', 'check:operational-runbooks'],
  },
  {
    file: 'docs/RUNBOOK_OPERATIONAL_BUDGETS.md',
    patterns: [
      'warningOldestPendingAgeMs',
      'criticalOldestPendingAgeMs',
      'reports/operational-health.md',
    ],
  },
  {
    file: 'docs/RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md',
    patterns: [
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
    patterns: ['send-census-email', 'cie10-ai-search'],
  },
];

for (const doc of requiredDocs) {
  const content = read(doc.file);
  const missing = doc.patterns.filter(pattern => !content.includes(pattern));
  if (missing.length > 0) {
    fail(`${doc.file} is missing references to: ${missing.join(', ')}`);
  }
}

const collectRunbookFiles = () => {
  const files = new Set(requiredDocs.map(doc => doc.file));
  const docsDir = path.join(workspaceRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
      if (entry.isFile() && /^RUNBOOK.*\.md$/i.test(entry.name)) {
        files.add(`docs/${entry.name}`);
      }
    }
    const nestedRunbooksDir = path.join(docsDir, 'runbooks');
    if (fs.existsSync(nestedRunbooksDir)) {
      for (const entry of fs.readdirSync(nestedRunbooksDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          files.add(`docs/runbooks/${entry.name}`);
        }
      }
    }
  }
  return [...files].sort();
};

const rootScripts = readJson('package.json').scripts || {};
const functionsPkgPath = path.join(workspaceRoot, 'functions', 'package.json');
const functionsScripts = fs.existsSync(functionsPkgPath)
  ? readJson('functions/package.json').scripts || {}
  : {};

const brokenCommands = [];
const NPM_RUN_PATTERN = /(?:cd\s+functions\s*&&\s*)?npm\s+run(?:\s+-s)?\s+([a-zA-Z0-9:_-]+)/g;

for (const relativeFile of collectRunbookFiles()) {
  const content = read(relativeFile);
  for (const match of content.matchAll(NPM_RUN_PATTERN)) {
    const fullMatch = match[0];
    const scriptName = match[1];
    const isFunctionsScoped = /^cd\s+functions\b/.test(fullMatch);
    const targetScripts = isFunctionsScoped ? functionsScripts : rootScripts;
    const targetPkg = isFunctionsScoped ? 'functions/package.json' : 'package.json';
    if (!Object.prototype.hasOwnProperty.call(targetScripts, scriptName)) {
      brokenCommands.push(`${relativeFile}: "npm run ${scriptName}" is missing from ${targetPkg}`);
    }
  }
}

if (brokenCommands.length > 0) {
  fail(
    `Unexecutable npm commands found in operational runbooks:\n  - ${[...new Set(brokenCommands)].join('\n  - ')}`
  );
}

const report = readJson('reports/operational-health.json');
const requiredKeys = [
  'systemHealth',
  'syncQueue',
  'syncDomainProfiles',
  'conflictContexts',
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

if (!Array.isArray(report.runbooks) || report.runbooks.length < 6) {
  fail('reports/operational-health.json must list the operational runbooks');
}

console.log('[operational-runbooks] OK');
