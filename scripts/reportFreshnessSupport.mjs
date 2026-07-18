import { getEvidenceNode, getEvidenceReportDependencyFiles } from './evidenceDependencyGraph.mjs';

const STRICT_FRESHNESS_REPORT_IDS = [
  'quality-metrics',
  'sync-convergence',
  'system-confidence',
  'operational-health',
  'clinical-release-signoff',
  'release-confidence-matrix',
  'release-readiness-scorecard',
  'maintenance-debt-scorecard',
];

export const REPORT_FRESHNESS_CONTRACTS = STRICT_FRESHNESS_REPORT_IDS.map(id => {
  const node = getEvidenceNode(id);
  const file = node?.artifacts.find(artifact => artifact.endsWith('.json'));
  if (!node?.command || !file) {
    throw new Error(`Evidence graph cannot produce strict freshness report ${id}`);
  }

  return {
    id,
    file,
    field: 'gitSha',
    refreshScript: node.command,
    dependsOn: getEvidenceReportDependencyFiles(id),
  };
});
