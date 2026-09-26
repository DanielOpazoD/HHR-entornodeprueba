#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const documentationMap = path.join(workspaceRoot, 'docs', 'DOCUMENTATION_MAP.md');
const docsDirectory = path.join(workspaceRoot, 'docs');
const localLinkPattern = /\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']+["'])?\)/g;

const checks = [
  {
    file: 'src/services/repositories/README.md',
    patterns: [
      'legacyRecordBridgeService.ts',
      'legacyBridgeGovernance.ts',
      'reports/legacy-bridge-governance.md',
      'schemaEvolutionPolicy.ts',
      'migrationLedger.ts',
      'runtimeContractGovernance.ts',
      'reports/runtime-contracts.md',
      'dailyRecordAggregate.ts',
      'reports/schema-evolution.md',
      'docs/RUNBOOK_OPERATIONAL_BUDGETS.md',
      'reports/operational-health.md',
    ],
  },
  {
    file: 'src/services/storage/README.md',
    patterns: [
      'sync/syncQueueEngine.ts',
      'firestore/firestoreQuerySupport.ts',
      'firestore/firestoreWriteSupport.ts',
      'storage/sync',
      'docs/RUNBOOK_OPERATIONAL_BUDGETS.md',
      'check:operational-runbooks',
      'reports/operational-health.md',
    ],
  },
];

const fail = message => {
  console.error(`[docs-drift] ${message}`);
  process.exit(1);
};

for (const check of checks) {
  const filePath = path.join(workspaceRoot, check.file);
  const content = fs.readFileSync(filePath, 'utf8');
  const missing = check.patterns.filter(pattern => !content.includes(pattern));
  if (missing.length > 0) {
    fail(`${check.file} is missing references to: ${missing.join(', ')}`);
  }
}

const getLocalLinks = filePath => {
  const content = fs.readFileSync(filePath, 'utf8');
  return [...content.matchAll(localLinkPattern)]
    .map(match => match[1].replace(/^<|>$/g, ''))
    .filter(target => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target))
    .map(target => decodeURIComponent(target.split(/[?#]/)[0]))
    .filter(Boolean)
    .map(target => path.resolve(path.dirname(filePath), target));
};

const indexedFiles = getLocalLinks(documentationMap);
const indexedPaths = new Set(indexedFiles);
const missing = [];

for (const fileName of fs.readdirSync(docsDirectory)) {
  if (!/^(?:ADR_|RUNBOOK_).+\.md$/.test(fileName)) continue;
  const absolutePath = path.join(docsDirectory, fileName);
  if (!indexedPaths.has(absolutePath)) missing.push(`Not indexed: docs/${fileName}`);
}

const activeDocuments = new Set([
  documentationMap,
  ...indexedFiles.filter(filePath => filePath.endsWith('.md') && fs.existsSync(filePath)),
]);
for (const filePath of activeDocuments) {
  for (const target of getLocalLinks(filePath)) {
    if (!fs.existsSync(target)) {
      missing.push(
        `${path.relative(workspaceRoot, filePath)} links to missing ${path.relative(workspaceRoot, target)}`
      );
    }
  }
}
if (missing.length > 0) fail(missing.join('\n- '));

console.log('[docs-drift] OK');
