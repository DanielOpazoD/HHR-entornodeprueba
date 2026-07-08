#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  extractBootstrapTelemetrySignals,
  selectFrontendStartupCriticalAssets,
  summarizeFrontendStartupHealth,
  summarizePreviewGate,
} from './operationalHealthSupport.mjs';
import { classifyBuildAssetBudget, classifyBudgetStatus } from './bundleBudgetSupport.mjs';
import { buildEvidenceProvenance } from './evidenceProvenanceSupport.mjs';
import { getGitReportState } from './gitReportState.mjs';

const workspaceRoot = process.cwd();
const read = relativePath => fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');

const systemHealthBudgetContent = read('src/services/admin/systemHealthOperationalBudgets.ts');
const syncDomainPolicyContent = read('src/services/storage/sync/syncDomainPolicy.ts');
const conflictDomainContent = read('src/services/repositories/conflictResolutionDomainPolicy.ts');
const indexedDbRecoveryBudgetsContent = read(
  'src/services/storage/indexeddb/indexedDbRecoveryBudgets.ts'
);
const authConfigContent = read('functions/lib/auth/authConfig.js');
const authHelpersContent = read('functions/lib/auth/authHelpersFactory.js');
const operationalRuntimeStateContent = read(
  'src/services/observability/operationalRuntimeState.ts'
);
const bootstrapRuntimeTelemetryContent = read(
  'src/app-shell/bootstrap/bootstrapRuntimeTelemetry.ts'
);
const authBootstrapBudgetContent = read('src/services/auth/authBootstrapBudgets.ts');
const syncQueueBudgetContent = read('src/services/storage/sync/syncQueueOperationalBudgets.ts');
const repositoryFiles = [
  'src/services/repositories/dailyRecordRepositoryReadService.ts',
  'src/services/repositories/dailyRecordRepositoryInitializationService.ts',
  'src/services/repositories/dailyRecordRepositorySyncService.ts',
  'src/services/repositories/monthIntegrity.ts',
  'src/services/repositories/legacyRecordBridgeService.ts',
  'src/services/repositories/dailyRecordRemoteLoader.ts',
];

const extractConstNumber = (content, name) => {
  const match = content.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`, 'm'));
  return match ? Number(match[1]) : null;
};

const extractObjectNumbers = (content, objectName) => {
  const match = content.match(
    new RegExp(`${objectName}(?::[^=]+)?\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm')
  );
  if (!match) return {};

  return Object.fromEntries(
    [...match[1].matchAll(/([A-Za-z0-9_]+):\s*(\d+)/g)].map(item => [item[1], Number(item[2])])
  );
};

const extractConstArrayNumbers = (content, name) => {
  const match = content.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]+)\\]`, 'm'));
  if (!match) return [];

  return match[1]
    .split(',')
    .map(part => Number(part.trim()))
    .filter(value => Number.isFinite(value));
};

const extractConstArrayStrings = (content, name) => {
  const match = content.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
  if (!match) return [];

  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
};

const extractSetStrings = (content, name) => {
  const match = content.match(new RegExp(`const\\s+${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`, 'm'));
  if (!match) return [];

  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
};

const extractRoleNormalizationBridges = content =>
  [
    ...content.matchAll(
      /role\s*===\s*'([^']+)'\s*\?\s*'([^']+)'\s*:\s*role/g
    ),
  ].map(match => ({
    from: match[1],
    to: match[2],
  }));

const extractConstTupleStrings = (content, name) => {
  const match = content.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
  if (!match) return [];

  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
};

const extractSyncDomainProfiles = content =>
  [
    ...content.matchAll(
      /id:\s*'([^']+)'\s*,[\s\S]*?retryBudget:\s*(\d+)\s*,[\s\S]*?delayMultiplier:\s*([\d.]+)\s*,[\s\S]*?conflictAction:\s*'([^']+)'/g
    ),
  ].map(match => ({
    id: match[1],
    retryBudget: Number(match[2]),
    delayMultiplier: Number(match[3]),
    conflictAction: match[4],
  }));

const extractConflictRunbookActions = content => {
  const block = content.match(/CONFLICT_CONTEXT_RUNBOOK_ACTIONS:[\s\S]*?=\s*\{([\s\S]*?)\n\}/m);
  if (!block) return {};

  return Object.fromEntries(
    [...block[1].matchAll(/([A-Za-z0-9_]+):\s*'([^']+)'/g)].map(match => [match[1], match[2]])
  );
};

const readJsonReport = relativePath => {
  const filePath = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const readJsonConfig = relativePath => {
  const filePath = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const extractEntryAssetsFromHtml = (htmlContent, { entryMaxBytes }) =>
  [...htmlContent.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g)].map(match => {
    const file = `dist/assets/${match[1]}`;
    const fullPath = path.join(workspaceRoot, file);
    const sizeBytes = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
    return {
      file,
      sizeBytes,
      maxBytes: entryMaxBytes,
      status: classifyBudgetStatus({
        actual: sizeBytes,
        target: entryMaxBytes,
        enforced: entryMaxBytes,
      }),
    };
  });

const collectLargestBuildAssets = (relativeDir, limit = 8) => {
  const assetsDir = path.join(workspaceRoot, relativeDir);
  if (!fs.existsSync(assetsDir)) return [];

  return fs
    .readdirSync(assetsDir)
    .filter(name => name.endsWith('.js'))
    .map(name => ({
      file: path.posix.join(relativeDir, name),
      sizeBytes: fs.statSync(path.join(assetsDir, name)).size,
    }))
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, limit);
};

const collectThresholds = () => {
  const thresholds = [];
  for (const relativePath of repositoryFiles) {
    const content = read(relativePath);
    const matches = [
      ...content.matchAll(
        /measureRepositoryOperation\([\s\S]*?thresholdMs:\s*(\d+)[\s\S]*?(?:context:\s*'([^']+)')?/g
      ),
    ];
    for (const match of matches) {
      thresholds.push({
        file: relativePath,
        thresholdMs: Number(match[1]),
        context: match[2] || null,
      });
    }
  }
  return thresholds;
};

const syncConfig = {
  batchSize: extractConstNumber(syncQueueBudgetContent, 'SYNC_QUEUE_BATCH_SIZE'),
  maxRetries: extractConstNumber(syncQueueBudgetContent, 'MAX_RETRIES'),
  baseRetryDelayMs: extractConstNumber(syncQueueBudgetContent, 'BASE_RETRY_DELAY_MS'),
  maxRetryDelayMs: extractConstNumber(syncQueueBudgetContent, 'MAX_RETRY_DELAY_MS'),
  runtimeThresholds: extractObjectNumbers(syncQueueBudgetContent, 'SYNC_QUEUE_RUNTIME_THRESHOLDS'),
};

const versionContent = read('src/constants/version.ts');
const currentVersionMatch = versionContent.match(/CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/);
const legacyVersionMatch = versionContent.match(/LEGACY_SCHEMA_VERSION\s*=\s*(\d+)/);
const thresholds = collectThresholds();
const systemHealthBudgets = extractObjectNumbers(
  systemHealthBudgetContent,
  'DEFAULT_SYSTEM_HEALTH_THRESHOLDS'
);
const syncDomainProfiles = extractSyncDomainProfiles(syncDomainPolicyContent);
const conflictContexts = extractConflictRunbookActions(conflictDomainContent);
const legacyBridgeReport = readJsonReport('reports/legacy-bridge-governance.json');
const compatibilityGovernanceReport = readJsonReport('reports/compatibility-governance.json');
const compatibilityImportGovernanceReport = readJsonReport(
  'reports/compatibility-import-governance.json'
);
const prolongedOfflineUserAgeMs = extractConstNumber(
  systemHealthBudgetContent,
  'PROLONGED_OFFLINE_USER_AGE_MS'
);
const localPersistence = {
  openTimeoutMs: extractConstNumber(indexedDbRecoveryBudgetsContent, 'INDEXED_DB_OPEN_TIMEOUT_MS'),
  deleteTimeoutMs: extractConstNumber(
    indexedDbRecoveryBudgetsContent,
    'INDEXED_DB_DELETE_TIMEOUT_MS'
  ),
  maxBackgroundRecoveryAttempts: extractConstNumber(
    indexedDbRecoveryBudgetsContent,
    'MAX_BACKGROUND_RECOVERY_ATTEMPTS'
  ),
  recoveryRetryDelaysMs: extractConstArrayNumbers(
    indexedDbRecoveryBudgetsContent,
    'INDEXED_DB_RECOVERY_RETRY_DELAYS_MS'
  ),
};
const authAccess = {
  generalLoginRoles: extractSetStrings(authConfigContent, 'GENERAL_LOGIN_ROLES'),
  managedAssignableRoles: extractSetStrings(authConfigContent, 'MANAGED_ASSIGNABLE_ROLES'),
  roleNormalizationBridges: extractRoleNormalizationBridges(authHelpersContent),
  canonicalModelDoc: 'docs/AUTH_ACCESS_MODEL.md',
  authIncidentRunbook: 'docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md',
};
const operationalRuntimeStates = {
  contract: 'src/services/observability/operationalRuntimeState.ts',
  states: extractConstTupleStrings(operationalRuntimeStateContent, 'OPERATIONAL_RUNTIME_STATES'),
};
const authBootstrap = {
  pendingTtlMs: extractConstNumber(authBootstrapBudgetContent, 'AUTH_BOOTSTRAP_PENDING_TTL_MS'),
  timeoutsMs: extractObjectNumbers(authBootstrapBudgetContent, 'AUTH_BOOTSTRAP_TIMEOUTS_MS'),
};
const runbooks = [
  'docs/RUNBOOK_SYNC_RESILIENCE.md',
  'docs/RUNBOOK_SUPPORT_OPERATIONS.md',
  'docs/RUNBOOK_OPERATIONAL_BUDGETS.md',
  authAccess.authIncidentRunbook,
  'docs/RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md',
  'docs/RUNBOOK_AI_PROVIDER_OPERATIONS.md',
  'docs/SERVERLESS_SENSITIVE_CONTRACTS.md',
];
const flowPerformanceSummary = readJsonReport('reports/e2e/flow-performance-budget-summary.json');
const criticalCoverageSummary = readJsonReport('reports/critical-coverage.json');
const bundleBudgetConfig = readJsonConfig('scripts/config/bundle-budget.json');
const entryMaxBytes = bundleBudgetConfig?.entryMaxBytes ?? null;
const previewBootstrapReport = readJsonReport('reports/e2e/preview-bootstrap/report.json');
const indexHtmlContent = fs.existsSync(path.join(workspaceRoot, 'dist', 'index.html'))
  ? read('dist/index.html')
  : '';
const largestBuildAssets = collectLargestBuildAssets('dist/assets');
const chunkMaxBytes = bundleBudgetConfig?.chunkMaxBytes ?? null;
const entryBuildAssets = extractEntryAssetsFromHtml(indexHtmlContent, { entryMaxBytes });
const buildAssets = largestBuildAssets.map(asset =>
  classifyBuildAssetBudget({
    file: asset.file,
    sizeBytes: asset.sizeBytes,
    budgetConfig: bundleBudgetConfig,
  })
);
const bootstrapTelemetrySignals = extractBootstrapTelemetrySignals(bootstrapRuntimeTelemetryContent);
const frontendStartup = summarizeFrontendStartupHealth({
  previewGate: summarizePreviewGate(previewBootstrapReport),
  criticalAssets: selectFrontendStartupCriticalAssets({
    buildAssets,
    entryAssets: entryBuildAssets,
  }),
  bootstrapTelemetrySignals,
});
const gitState = getGitReportState(workspaceRoot);

const summary = {
  generatedAt: new Date().toISOString(),
  gitSha: gitState.gitSha,
  gitDirty: gitState.gitDirty,
  generatedFor: buildEvidenceProvenance({
    root: workspaceRoot,
    reportId: 'operational-health',
    gitState,
  }),
  schema: {
    current: currentVersionMatch ? Number(currentVersionMatch[1]) : null,
    legacy: legacyVersionMatch ? Number(legacyVersionMatch[1]) : null,
  },
  syncQueue: syncConfig,
  systemHealth: {
    ...systemHealthBudgets,
    ...syncConfig.runtimeThresholds,
    prolongedOfflineUserAgeMs,
  },
  syncDomainProfiles,
  conflictContexts,
  legacyBridge: legacyBridgeReport,
  compatibilityGovernance: compatibilityGovernanceReport
    ? {
        policyVersion: compatibilityGovernanceReport.policyVersion ?? 'unknown',
        trackedEntries: compatibilityGovernanceReport.trackedEntries ?? 0,
        missingEntries: Array.isArray(compatibilityGovernanceReport.missingEntries)
          ? compatibilityGovernanceReport.missingEntries
          : [],
        restrictedEntries: Array.isArray(compatibilityImportGovernanceReport?.entries)
          ? compatibilityImportGovernanceReport.entries.length
          : 0,
        unauthorizedImportCount: Array.isArray(compatibilityImportGovernanceReport?.issues)
          ? compatibilityImportGovernanceReport.issues.length
          : 0,
      }
    : null,
  localPersistence,
  authAccess,
  authBootstrap,
  operationalRuntimeStates,
  flowPerformance: flowPerformanceSummary
    ? {
        status: flowPerformanceSummary.summary?.status ?? 'unknown',
        blockingCount: flowPerformanceSummary.summary?.blockingCount ?? 0,
        targetMissCount: flowPerformanceSummary.summary?.targetMissCount ?? 0,
        nearLimitCount: flowPerformanceSummary.summary?.nearLimitCount ?? 0,
        flows: Array.isArray(flowPerformanceSummary.flows)
          ? flowPerformanceSummary.flows.map(flow => ({
              flow: flow.flow,
              actualMs: flow.actualMs,
              targetMs: flow.targetMs,
              enforcedMaxMs: flow.enforcedMaxMs,
              status: flow.status,
            }))
          : [],
      }
    : null,
  criticalCoverage: criticalCoverageSummary
    ? {
        status: criticalCoverageSummary.status ?? 'unknown',
        mode: criticalCoverageSummary.mode ?? 'unknown',
        zones: Array.isArray(criticalCoverageSummary.criticalZones)
          ? criticalCoverageSummary.criticalZones.map(zone => ({
              root: zone.root,
              status: zone.passed ? 'PASS' : 'FAIL',
              lines: zone.coverage?.lines?.pct ?? null,
              functions: zone.coverage?.functions?.pct ?? null,
              branches: zone.coverage?.branches?.pct ?? null,
            }))
          : [],
      }
    : null,
  buildAssets: {
    entryMaxBytes,
    chunkMaxBytes,
    entryAssets: entryBuildAssets,
    largestAssets: buildAssets,
  },
  frontendStartup,
  repositoryPerformance: {
    monitoredOperations: thresholds.length,
    maxThresholdMs: thresholds.reduce((max, item) => Math.max(max, item.thresholdMs), 0),
    minThresholdMs:
      thresholds.length > 0
        ? thresholds.reduce((min, item) => Math.min(min, item.thresholdMs), thresholds[0].thresholdMs)
        : 0,
    thresholds,
  },
  runbooks,
};

const reportDir = path.join(workspaceRoot, 'reports');
fs.mkdirSync(reportDir, { recursive: true });

fs.writeFileSync(
  path.join(reportDir, 'operational-health.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8'
);

const markdown = `# Operational Health Snapshot

- Generated: ${summary.generatedAt}
- Git SHA: ${summary.gitSha}
- Schema current: v${summary.schema.current ?? 'unknown'}
- Schema legacy: v${summary.schema.legacy ?? 'unknown'}

## Sync Queue

- Batch size: ${summary.syncQueue.batchSize ?? 'unknown'}
- Max retries: ${summary.syncQueue.maxRetries ?? 'unknown'}
- Base retry delay (ms): ${summary.syncQueue.baseRetryDelayMs ?? 'unknown'}
- Max retry delay (ms): ${summary.syncQueue.maxRetryDelayMs ?? 'unknown'}
- Warning queue age (ms): ${summary.syncQueue.runtimeThresholds.warningOldestPendingAgeMs ?? 'unknown'}
- Critical queue age (ms): ${summary.syncQueue.runtimeThresholds.criticalOldestPendingAgeMs ?? 'unknown'}
- Warning retrying tasks: ${summary.syncQueue.runtimeThresholds.warningRetryingSyncTasks ?? 'unknown'}
- Critical retrying tasks: ${summary.syncQueue.runtimeThresholds.criticalRetryingSyncTasks ?? 'unknown'}

## System Health Budgets

- Warning queue age (ms): ${summary.systemHealth.warningOldestPendingAgeMs ?? 'unknown'}
- Critical queue age (ms): ${summary.systemHealth.criticalOldestPendingAgeMs ?? 'unknown'}
- Warning retrying tasks: ${summary.systemHealth.warningRetryingSyncTasks ?? 'unknown'}
- Critical retrying tasks: ${summary.systemHealth.criticalRetryingSyncTasks ?? 'unknown'}
- Warning slow repository op (ms): ${summary.systemHealth.warningSlowRepositoryOperationMs ?? 'unknown'}
- Critical slow repository op (ms): ${summary.systemHealth.criticalSlowRepositoryOperationMs ?? 'unknown'}
- Prolonged offline user age (ms): ${summary.systemHealth.prolongedOfflineUserAgeMs ?? 'unknown'}

## Sync Domain Recovery Profiles

| Profile | Retry budget | Delay multiplier | Conflict action |
| --- | ---: | ---: | --- |
${summary.syncDomainProfiles
  .map(
    profile =>
      `| \`${profile.id}\` | ${profile.retryBudget} | ${profile.delayMultiplier} | ${profile.conflictAction} |`
  )
  .join('\n')}

## Conflict Context Runbook Actions

| Context | Action |
| --- | --- |
${Object.entries(summary.conflictContexts)
  .map(([context, action]) => `| \`${context}\` | ${action} |`)
  .join('\n')}

## Legacy Bridge Governance

- Policy version: ${summary.legacyBridge?.policyVersion ?? 'unknown'}
- Allowed modes: ${
  Array.isArray(summary.legacyBridge?.allowedModes)
    ? summary.legacyBridge.allowedModes.join(', ')
    : 'unknown'
}
- Hot path policy: ${summary.legacyBridge?.hotPathPolicy ?? 'unknown'}

## Compatibility Governance

- Policy version: ${summary.compatibilityGovernance?.policyVersion ?? 'unknown'}
- Tracked entries: ${summary.compatibilityGovernance?.trackedEntries ?? 'unknown'}
- Missing entries: ${
  Array.isArray(summary.compatibilityGovernance?.missingEntries) &&
  summary.compatibilityGovernance.missingEntries.length > 0
    ? summary.compatibilityGovernance.missingEntries.join(', ')
    : 'none'
}
- Restricted import surfaces: ${summary.compatibilityGovernance?.restrictedEntries ?? 'unknown'}
- Unauthorized importers: ${summary.compatibilityGovernance?.unauthorizedImportCount ?? 'unknown'}

## Local Persistence Recovery Budgets

- IndexedDB open timeout (ms): ${summary.localPersistence.openTimeoutMs ?? 'unknown'}
- IndexedDB delete timeout (ms): ${summary.localPersistence.deleteTimeoutMs ?? 'unknown'}
- Max background recovery attempts: ${summary.localPersistence.maxBackgroundRecoveryAttempts ?? 'unknown'}
- Recovery retry delays (ms): ${
  summary.localPersistence.recoveryRetryDelaysMs.length > 0
    ? summary.localPersistence.recoveryRetryDelaysMs.join(', ')
    : 'unknown'
}

## Auth Access Snapshot

- Login general roles: ${
  summary.authAccess.generalLoginRoles.length > 0
    ? summary.authAccess.generalLoginRoles.join(', ')
    : 'unknown'
}
- Roles asignables: ${
  summary.authAccess.managedAssignableRoles.length > 0
    ? summary.authAccess.managedAssignableRoles.join(', ')
    : 'unknown'
}
- Puentes de rol legacy: ${
  summary.authAccess.roleNormalizationBridges.length > 0
    ? summary.authAccess.roleNormalizationBridges
        .map(bridge => `${bridge.from} -> ${bridge.to}`)
        .join(', ')
    : 'none'
}
- Modelo canónico: \`${summary.authAccess.canonicalModelDoc}\`
- Runbook auth: \`${summary.authAccess.authIncidentRunbook}\`

## Auth Bootstrap Budgets

- Pending TTL (ms): ${summary.authBootstrap.pendingTtlMs ?? 'unknown'}
- Timeouts (ms): recent logout ${summary.authBootstrap.timeoutsMs.recentManualLogout ?? 'unknown'} · offline ${summary.authBootstrap.timeoutsMs.offline ?? 'unknown'} · default ${summary.authBootstrap.timeoutsMs.default ?? 'unknown'} · redirect pending ${summary.authBootstrap.timeoutsMs.redirectPending ?? 'unknown'}

## Operational Runtime Taxonomy

- Contrato: \`${summary.operationalRuntimeStates.contract}\`
- Estados canónicos: ${
  summary.operationalRuntimeStates.states.length > 0
    ? summary.operationalRuntimeStates.states.map(state => `\`${state}\``).join(', ')
    : 'unknown'
}

## Frontend Startup Health

- Status: ${summary.frontendStartup?.status ?? 'unknown'}
- Preview gate: ${summary.frontendStartup?.previewGate?.status ?? 'unknown'}
- Preview tests: ${summary.frontendStartup?.previewGate?.total ?? 'unknown'}
- Preview unexpected: ${summary.frontendStartup?.previewGate?.unexpected ?? 'unknown'}
- Preview flaky: ${summary.frontendStartup?.previewGate?.flaky ?? 'unknown'}
- Preview skipped: ${summary.frontendStartup?.previewGate?.skipped ?? 'unknown'}
- Preview duration (ms): ${summary.frontendStartup?.previewGate?.durationMs ?? 'unknown'}
- Bootstrap signals: ${
  Array.isArray(summary.frontendStartup?.bootstrapTelemetrySignals) &&
  summary.frontendStartup.bootstrapTelemetrySignals.length > 0
    ? summary.frontendStartup.bootstrapTelemetrySignals.map(signal => `\`${signal}\``).join(', ')
    : 'unknown'
}
- Startup issues: ${
  Array.isArray(summary.frontendStartup?.issues) && summary.frontendStartup.issues.length > 0
    ? summary.frontendStartup.issues.join(' | ')
    : 'none'
}

| Critical startup asset | Size (bytes) | Max (bytes) | Utilization | Budget | Status |
| --- | ---: | ---: | ---: | --- | --- |
${
  summary.frontendStartup?.criticalAssets?.length
    ? summary.frontendStartup.criticalAssets
        .map(
          asset =>
            `| \`${asset.file}\` | ${asset.sizeBytes} | ${asset.maxBytes ?? '-'} | ${
              typeof asset.budgetUtilizationPct === 'number'
                ? `${asset.budgetUtilizationPct}%`
                : '-'
            } | ${asset.budgetLabel ?? asset.budgetSource ?? '-'} | ${asset.status} |`
        )
        .join('\n')
    : '| `unavailable` | - | - | - | - | missing |'
}

## Incident Signals To Watch

- Realtime null recuperado: \`recovered_null_realtime_record\`
- Realtime null confirmado: \`confirmed_null_realtime_record\`
- Telemetría sync no disponible: \`sync_queue_telemetry_unavailable\`, \`sync_queue_stats_unavailable\`, \`sync_queue_recent_operations_unavailable\`, \`sync_queue_domain_metrics_unavailable\`
- Fallback IndexedDB: \`indexeddb_fallback_mode\`
- Timeout bootstrap auth: \`bootstrap_timeout\`
- Bootstrap frontend: ${
  Array.isArray(summary.frontendStartup?.bootstrapTelemetrySignals) &&
  summary.frontendStartup.bootstrapTelemetrySignals.length > 0
    ? summary.frontendStartup.bootstrapTelemetrySignals.map(signal => `\`${signal}\``).join(', ')
    : 'unknown'
}

## Flow Performance Budgets

- Status: ${summary.flowPerformance?.status ?? 'unknown'}
- Blocking flows: ${summary.flowPerformance?.blockingCount ?? 'unknown'}
- Target misses: ${summary.flowPerformance?.targetMissCount ?? 'unknown'}
- Near-limit flows: ${summary.flowPerformance?.nearLimitCount ?? 'unknown'}

| Flow | Actual (ms) | Target (ms) | Enforced (ms) | Status |
| --- | ---: | ---: | ---: | --- |
${
  summary.flowPerformance?.flows?.length
    ? summary.flowPerformance.flows
        .map(
          flow =>
            `| \`${flow.flow}\` | ${flow.actualMs} | ${flow.targetMs} | ${flow.enforcedMaxMs} | ${flow.status} |`
        )
        .join('\n')
    : '| `unavailable` | - | - | - | missing |'
}

## Critical Coverage

- Status: ${summary.criticalCoverage?.status ?? 'unknown'}
- Mode: ${summary.criticalCoverage?.mode ?? 'unknown'}

| Zone | Lines | Functions | Branches | Status |
| --- | ---: | ---: | ---: | --- |
${
  summary.criticalCoverage?.zones?.length
    ? summary.criticalCoverage.zones
        .map(
          zone =>
            `| \`${zone.root}\` | ${zone.lines ?? '-'} | ${zone.functions ?? '-'} | ${zone.branches ?? '-'} | ${zone.status} |`
        )
        .join('\n')
    : '| `unavailable` | - | - | - | missing |'
}

## Largest Build Assets

- Chunk budget max (bytes): ${summary.buildAssets.chunkMaxBytes ?? 'unknown'}

| Asset | Size (bytes) | Max (bytes) | Utilization | Budget | Status |
| --- | ---: | ---: | ---: | --- | --- |
${
  summary.buildAssets.largestAssets.length > 0
    ? summary.buildAssets.largestAssets
        .map(
          asset =>
            `| \`${asset.file}\` | ${asset.sizeBytes} | ${asset.maxBytes ?? '-'} | ${
              typeof asset.budgetUtilizationPct === 'number'
                ? `${asset.budgetUtilizationPct}%`
                : '-'
            } | ${asset.budgetLabel ?? asset.budgetSource ?? '-'} | ${asset.status} |`
        )
        .join('\n')
    : '| `unavailable` | - | - | - | - | missing |'
}

## Repository Performance Thresholds

- Monitored operations: ${summary.repositoryPerformance.monitoredOperations}
- Min threshold (ms): ${summary.repositoryPerformance.minThresholdMs}
- Max threshold (ms): ${summary.repositoryPerformance.maxThresholdMs}

| File | Threshold (ms) | Context |
| --- | ---: | --- |
${summary.repositoryPerformance.thresholds
  .map(item => `| \`${item.file}\` | ${item.thresholdMs} | ${item.context ?? '-'} |`)
  .join('\n')}

## Runbooks

${summary.runbooks.map(runbook => `- \`${runbook}\``).join('\n')}
`;

fs.writeFileSync(path.join(reportDir, 'operational-health.md'), `${markdown}\n`, 'utf8');

console.log('[operational-health] Report generated at reports/operational-health.{md,json}');
