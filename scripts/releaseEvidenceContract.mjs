import { getEvidenceNode, getEvidenceReportDependencyFiles } from './evidenceDependencyGraph.mjs';

export const RELEASE_EVIDENCE_CONTRACT_VERSION = 1;

const RELEASE_READINESS_SCORECARD_ID = 'release-readiness-scorecard';
const RELEASE_READINESS_FINALIZER_COMMAND =
  'report:release-readiness-scorecard:from-current-inputs';

const decisionReport = ({ id, label, owner, consumers }) => ({
  id,
  label,
  owner,
  consumers,
  role: 'release-decision',
  freshnessPolicy: 'every-pr-and-main',
});

const supportingReport = ({ id, label, owner, consumers }) => ({
  id,
  label,
  owner,
  consumers,
  role: 'supporting-input',
  freshnessPolicy: 'refresh-before-consumer',
});

export const RELEASE_EVIDENCE_INVENTORY = [
  decisionReport({
    id: 'critical-coverage',
    label: 'Cobertura crítica',
    owner: 'Quality Engineering',
    consumers: ['CI de PR', 'salud operacional', 'scorecard de release'],
  }),
  decisionReport({
    id: 'quality-metrics',
    label: 'Métricas de calidad',
    owner: 'Platform Engineering',
    consumers: ['CI de PR', 'confianza del sistema', 'scorecard de release'],
  }),
  decisionReport({
    id: 'sync-convergence',
    label: 'Convergencia de sincronización',
    owner: 'Clinical Sync',
    consumers: ['CI de PR', 'decisión de release clínico'],
  }),
  decisionReport({
    id: 'operational-health',
    label: 'Salud operacional',
    owner: 'Platform Engineering',
    consumers: ['confianza del sistema', 'scorecard de release'],
  }),
  decisionReport({
    id: 'system-confidence',
    label: 'Confianza del sistema',
    owner: 'Platform Engineering',
    consumers: ['scorecard de release', 'post-merge'],
  }),
  decisionReport({
    id: 'clinical-release-validation',
    label: 'Validación clínica de release',
    owner: 'Clinical Safety',
    consumers: ['release gate', 'post-merge'],
  }),
  decisionReport({
    id: 'clinical-release-signoff',
    label: 'Aprobación clínica',
    owner: 'Clinical Safety',
    consumers: ['release gate', 'post-merge'],
  }),
  decisionReport({
    id: 'release-confidence-matrix',
    label: 'Matriz de confianza',
    owner: 'Release Engineering',
    consumers: ['scorecard de release', 'post-merge'],
  }),
  decisionReport({
    id: 'maintenance-debt-scorecard',
    label: 'Deuda de mantenimiento',
    owner: 'Architecture',
    consumers: ['release gate', 'planificación técnica'],
  }),
  decisionReport({
    id: 'release-readiness-scorecard',
    label: 'Preparación de release',
    owner: 'Release Engineering',
    consumers: ['decisión de merge', 'post-merge', 'panel técnico'],
  }),
  supportingReport({
    id: 'bundle-risk-ledger',
    label: 'Riesgo del bundle',
    owner: 'Frontend Platform',
    consumers: ['scorecard de release'],
  }),
  supportingReport({
    id: 'legacy-bridge',
    label: 'Puentes legacy',
    owner: 'Architecture',
    consumers: ['scorecard de release'],
  }),
  supportingReport({
    id: 'compatibility-governance',
    label: 'Gobernanza de compatibilidad',
    owner: 'Architecture',
    consumers: ['scorecard de release'],
  }),
  supportingReport({
    id: 'legacy-retirement-debt',
    label: 'Retiro de deuda legacy',
    owner: 'Architecture',
    consumers: ['deuda de mantenimiento', 'scorecard de release'],
  }),
  supportingReport({
    id: 'compatibility-import-governance',
    label: 'Compatibilidad de importaciones',
    owner: 'Architecture',
    consumers: ['scorecard de release'],
  }),
  supportingReport({
    id: 'technical-ownership-map',
    label: 'Mapa de ownership',
    owner: 'Architecture',
    consumers: ['scorecard de release', 'runbook'],
  }),
  supportingReport({
    id: 'guardrail-governance',
    label: 'Gobernanza de guardrails',
    owner: 'Quality Engineering',
    consumers: ['scorecard de release'],
  }),
];

export const RELEASE_DECISION_REPORT_IDS = RELEASE_EVIDENCE_INVENTORY.filter(
  report => report.role === 'release-decision'
).map(report => report.id);

export const RELEASE_EVIDENCE_REPORT_IDS = RELEASE_EVIDENCE_INVENTORY.map(report => report.id);

const reportIds = new Set(RELEASE_EVIDENCE_REPORT_IDS);

export const collectReleaseEvidenceContractIssues = () => {
  const issues = [];
  const seen = new Set();

  for (const report of RELEASE_EVIDENCE_INVENTORY) {
    if (seen.has(report.id)) issues.push(`Duplicate release evidence id ${report.id}.`);
    seen.add(report.id);
    const node = getEvidenceNode(report.id);
    if (!node?.command) issues.push(`Evidence graph has no producer for ${report.id}.`);
    if (!node?.artifacts?.some(artifact => artifact.endsWith('.json'))) {
      issues.push(`Evidence graph has no JSON artifact for ${report.id}.`);
    }
    if (!report.owner || report.consumers.length === 0 || !report.freshnessPolicy) {
      issues.push(`Release evidence inventory is incomplete for ${report.id}.`);
    }
  }

  return issues;
};

/** @param {{ skipReportIds?: string[] }} [options] */
export const getReleaseEvidenceRefreshSteps = ({ skipReportIds = [] } = {}) => {
  const skipped = new Set(skipReportIds);
  const temporary = new Set();
  const permanent = new Set();
  const ordered = [];

  const visit = id => {
    if (permanent.has(id) || skipped.has(id)) return;
    if (temporary.has(id)) throw new Error(`Release evidence dependency cycle at ${id}.`);
    temporary.add(id);
    const node = getEvidenceNode(id);
    if (!node) throw new Error(`Release evidence graph has no node for ${id}.`);
    for (const dependency of node.dependencies || []) {
      if (reportIds.has(dependency)) visit(dependency);
    }
    temporary.delete(id);
    permanent.add(id);
    ordered.push({
      id,
      // The refresh plan already generated every scorecard input in dependency
      // order. Running the standalone producer here would regenerate those
      // inputs and make earlier consumers stale again.
      command:
        id === RELEASE_READINESS_SCORECARD_ID
          ? RELEASE_READINESS_FINALIZER_COMMAND
          : node.command,
      artifacts: node.artifacts,
    });
  };

  for (const id of RELEASE_EVIDENCE_REPORT_IDS) visit(id);
  return ordered;
};

export const getReleaseEvidenceFreshnessContracts = () =>
  RELEASE_DECISION_REPORT_IDS.map(id => {
    const node = getEvidenceNode(id);
    if (!node) throw new Error(`Release evidence graph has no node for ${id}.`);
    const file = node.artifacts.find(artifact => artifact.endsWith('.json'));
    return {
      id,
      file,
      field: 'gitSha',
      refreshScript: node.command,
      dependsOn: getEvidenceReportDependencyFiles(id),
    };
  });
