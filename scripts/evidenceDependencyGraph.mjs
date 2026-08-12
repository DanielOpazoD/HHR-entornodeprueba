const reportNode = ({ command, artifacts, dependencies = [], fileDependencies = [] }) => ({
  command,
  artifacts,
  dependencies,
  fileDependencies,
});

export const EVIDENCE_DEPENDENCY_GRAPH = {
  'quality-metrics': reportNode({
    command: 'report:quality-metrics',
    artifacts: ['reports/quality-metrics.json', 'reports/quality-metrics.md'],
  }),
  'bundle-risk-ledger': reportNode({
    command: 'report:bundle-risk-ledger',
    artifacts: ['reports/bundle-risk-ledger.json', 'reports/bundle-risk-ledger.md'],
  }),
  'legacy-bridge': reportNode({
    command: 'report:legacy-bridge',
    artifacts: ['reports/legacy-bridge-governance.json', 'reports/legacy-bridge-governance.md'],
  }),
  'compatibility-governance': reportNode({
    command: 'report:compatibility-governance',
    artifacts: ['reports/compatibility-governance.json', 'reports/compatibility-governance.md'],
  }),
  'legacy-retirement-debt': reportNode({
    command: 'report:legacy-retirement-debt',
    artifacts: ['reports/legacy-retirement-debt.json', 'reports/legacy-retirement-debt.md'],
    dependencies: ['quality-metrics'],
  }),
  'compatibility-import-governance': reportNode({
    command: 'report:compatibility-import-governance',
    artifacts: [
      'reports/compatibility-import-governance.json',
      'reports/compatibility-import-governance.md',
    ],
  }),
  'critical-coverage': reportNode({
    command: 'report:critical-coverage',
    artifacts: ['reports/critical-coverage.json', 'reports/critical-coverage.md'],
    fileDependencies: [
      'scripts/config/critical-coverage-thresholds.json',
      'scripts/criticalCoverageSupport.mjs',
      'scripts/report-critical-coverage.mjs',
      'scripts/run-critical-coverage.mjs',
      'vitest.critical-coverage.config.ts',
    ],
  }),
  'operational-health': reportNode({
    command: 'report:operational-health',
    artifacts: ['reports/operational-health.json', 'reports/operational-health.md'],
    dependencies: [
      'critical-coverage',
    ],
    fileDependencies: [
      'reports/e2e/preview-bootstrap/report.json',
      'reports/e2e/preview-bootstrap/ci-provenance.json',
    ],
  }),
  'system-confidence': reportNode({
    command: 'report:system-confidence',
    artifacts: ['reports/system-confidence.json', 'reports/system-confidence.md'],
    dependencies: ['quality-metrics', 'critical-coverage', 'operational-health'],
  }),
  'release-confidence-matrix': reportNode({
    command: 'report:release-confidence-matrix',
    artifacts: ['reports/release-confidence-matrix.json', 'reports/release-confidence-matrix.md'],
    dependencies: ['critical-coverage'],
  }),
  'technical-ownership-map': reportNode({
    command: 'report:technical-ownership-map',
    artifacts: ['reports/technical-ownership-map.json', 'reports/technical-ownership-map.md'],
  }),
  'guardrail-governance': reportNode({
    command: 'report:guardrail-governance',
    artifacts: ['reports/guardrail-governance.json', 'reports/guardrail-governance.md'],
  }),
  'clinical-release-signoff': reportNode({
    command: 'report:clinical-release-signoff',
    artifacts: ['reports/clinical-release-signoff.json', 'reports/clinical-release-signoff.md'],
    fileDependencies: ['scripts/config/clinical-release-signoff.json'],
  }),
  'clinical-release-validation': reportNode({
    command: 'report:clinical-release-validation',
    artifacts: ['reports/clinical-release-validation.json', 'reports/clinical-release-validation.md'],
  }),
  'runtime-contracts': reportNode({
    command: 'report:runtime-contracts',
    artifacts: ['reports/runtime-contracts.json', 'reports/runtime-contracts.md'],
  }),
  'sync-convergence': reportNode({
    command: 'report:sync-convergence',
    artifacts: ['reports/sync-convergence.json', 'reports/sync-convergence.md'],
    fileDependencies: [
      'docs/CLINICAL_SYNC_SIMULATOR_CONTRACT.md',
      'docs/clinical-sync-simulator.md',
      'scripts/check-sync-convergence-evidence.mjs',
      'scripts/report-sync-convergence-evidence.mjs',
      'scripts/syncConvergenceEvidenceSupport.mjs',
      'src/services/observability/syncConvergenceDiagnosticTypes.ts',
      'src/services/observability/syncConvergenceDiagnostics.ts',
      'src/services/observability/syncConvergenceHandoffDiagnostics.ts',
      'src/services/observability/syncRecoveryPlanner.ts',
      'src/services/repositories/dailyRecordConflictAutoMergeController.ts',
      'src/services/storage/sync/firestoreSyncTransport.ts',
      'src/services/storage/sync/syncQueueTaskFactory.ts',
      'src/services/storage/sync/syncQueueTelemetryController.ts',
      'src/tests/features/admin/systemHealthSyncConvergencePanel.test.ts',
      'src/tests/hooks/controllers/systemHealthReporterController.test.ts',
      'src/tests/services/observability/syncConvergenceDiagnostics.test.ts',
      'src/tests/services/observability/syncRecoveryPlanner.test.ts',
      'src/tests/services/storage/syncQueueMutationConflict.test.ts',
      'src/tests/services/storage/syncQueueTelemetryController.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.census.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.dmi-episode.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.handoff.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.rayen-acceptance.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.test.ts',
      'src/tests/support/clinicalSyncSimulator/rayenSyncAcceptanceFixtures.ts',
    ],
  }),
  'test-runtime-governance': reportNode({
    command: 'report:test-runtime-governance',
    artifacts: ['reports/test-runtime-governance.json', 'reports/test-runtime-governance.md'],
    fileDependencies: [
      '.github/workflows/ci-cd.yml',
      '.github/workflows/nightly-test-runtime.yml',
      'scripts/check-test-runtime-governance.mjs',
      'scripts/config/test-runtime-governance.json',
      'scripts/report-test-runtime-governance.mjs',
      'scripts/testRuntimeGovernanceSupport.mjs',
      'src/tests/build/testRuntimeGovernanceSupport.test.ts',
      'src/tests/build/ciWorkflowGovernance.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.census.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.dmi-episode.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.rayen-acceptance.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.test.ts',
      'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulatorFixtures.ts',
      'src/tests/support/clinicalSyncSimulator/rayenSyncAcceptanceFixtures.ts',
    ],
  }),
  'unit-shard-runtime-profile': reportNode({
    command: 'report:unit-shard-runtime-profile',
    artifacts: ['reports/unit-shard-runtime-profile.json', 'reports/unit-shard-runtime-profile.md'],
    fileDependencies: [
      'scripts/check-unit-shard-balance.mjs',
      'scripts/config/unit-shard-balance.json',
      'scripts/profile-unit-shard-runtime.mjs',
      'scripts/report-unit-shard-runtime-profile.mjs',
      'scripts/run-unit-shard.mjs',
      'scripts/unitShardBalanceSupport.mjs',
      'src/tests/build/unitShardBalanceSupport.test.ts',
    ],
  }),
  'ci-runtime-observed-profile': reportNode({
    command: 'report:ci-runtime-observed-profile',
    artifacts: ['reports/ci-runtime-observed-profile.json', 'reports/ci-runtime-observed-profile.md'],
    dependencies: [
      'unit-shard-runtime-profile',
    ],
    fileDependencies: [
      'scripts/collect-github-actions-runtime.mjs',
      'scripts/check-ci-runtime-telemetry.mjs',
      'scripts/ciRuntimeTelemetrySupport.mjs',
      'scripts/report-ci-runtime-observed-profile.mjs',
      'src/tests/build/collectGithubActionsRuntime.test.ts',
      'src/tests/build/ciRuntimeTelemetrySupport.test.ts',
    ],
  }),
  'serverless-runtime-governance': reportNode({
    command: 'report:serverless-runtime-governance',
    artifacts: [
      'reports/serverless-runtime-governance.json',
      'reports/serverless-runtime-governance.md',
    ],
  }),
  'serverless-sensitive-coverage': reportNode({
    command: 'report:serverless-sensitive-coverage',
    artifacts: [
      'reports/serverless-sensitive-coverage.json',
      'reports/serverless-sensitive-coverage.md',
    ],
  }),
  'sustainable-change-policy': reportNode({
    command: 'report:sustainable-change-policy',
    artifacts: ['reports/sustainable-change-policy.json', 'reports/sustainable-change-policy.md'],
  }),
  'maintenance-debt-scorecard': reportNode({
    command: 'report:maintenance-debt-scorecard',
    artifacts: ['reports/maintenance-debt-scorecard.json', 'reports/maintenance-debt-scorecard.md'],
    dependencies: ['quality-metrics', 'legacy-retirement-debt'],
  }),
  'release-readiness-scorecard': reportNode({
    command: 'report:release-readiness-scorecard',
    artifacts: ['reports/release-readiness-scorecard.json', 'reports/release-readiness-scorecard.md'],
    dependencies: [
      'quality-metrics',
      'bundle-risk-ledger',
      'legacy-bridge',
      'compatibility-governance',
      'legacy-retirement-debt',
      'compatibility-import-governance',
      'critical-coverage',
      'operational-health',
      'system-confidence',
      'release-confidence-matrix',
      'technical-ownership-map',
      'guardrail-governance',
    ],
  }),
};

export const getEvidenceNode = id => EVIDENCE_DEPENDENCY_GRAPH[id] || null;

export const getEvidenceReportDependencies = id => getEvidenceNode(id)?.dependencies || [];

export const getEvidenceReportFileDependencies = id =>
  getEvidenceNode(id)?.fileDependencies || [];

export const getEvidenceReportArtifacts = id => getEvidenceNode(id)?.artifacts || [];

export const getEvidenceReportCommand = id => getEvidenceNode(id)?.command || '';

export const resolveEvidenceDependencyFiles = dependency => {
  const node = getEvidenceNode(dependency);
  if (!node) throw new Error(`Evidence graph has no report node for ${dependency}.`);
  return node.artifacts;
};

const appendUnique = (target, values) => {
  for (const value of values) {
    if (value && !target.includes(value)) {
      target.push(value);
    }
  }
};

export const getEvidenceReportDependencyFiles = (id, { transitive = true } = {}) => {
  const files = [];
  const visitedNodes = new Set();

  const visitNode = nodeId => {
    const node = getEvidenceNode(nodeId);
    if (!node) throw new Error(`Evidence graph has no report node for ${nodeId}.`);
    appendUnique(files, node.fileDependencies || []);
    if (visitedNodes.has(nodeId)) {
      return;
    }

    visitedNodes.add(nodeId);
    for (const childDependency of node.dependencies || []) {
      const childNode = getEvidenceNode(childDependency);
      if (!childNode) {
        throw new Error(`Evidence graph has no report node for ${childDependency}.`);
      }
      appendUnique(files, childNode.artifacts);
      if (transitive) visitNode(childDependency);
    }
  };

  visitNode(id);

  return files;
};
