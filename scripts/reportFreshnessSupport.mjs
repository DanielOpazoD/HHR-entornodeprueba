import { getEvidenceNode, getEvidenceReportDependencyFiles } from './evidenceDependencyGraph.mjs';

export const PRIMARY_EVIDENCE_REPORT_IDS = [
  'critical-coverage',
  'sync-convergence',
  'operational-health',
];

export const REPORT_FRESHNESS_CONTRACTS = PRIMARY_EVIDENCE_REPORT_IDS.map(id => {
  const node = getEvidenceNode(id);
  if (!node) throw new Error(`Evidence graph has no node for ${id}.`);
  const file = node.artifacts.find(artifact => artifact.endsWith('.json'));
  return {
    id,
    file,
    field: 'gitSha',
    refreshScript: node.command,
    dependsOn: getEvidenceReportDependencyFiles(id),
  };
});
