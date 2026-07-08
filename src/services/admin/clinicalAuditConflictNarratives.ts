import type { AuditLogEntry } from '@/types/auditLogTypes';

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asTextArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map(item => asText(item))
        .filter(Boolean)
        .slice(0, 3)
    : [];

const getRecordLabel = (log: AuditLogEntry): string => asText(log.entityId) || 'registro';

const getRiskLabel = (value: unknown): string => {
  const risk = asText(value).toLowerCase();
  if (risk === 'low') return 'bajo';
  if (risk === 'medium') return 'medio';
  if (risk === 'high') return 'alto';
  return 'no especificado';
};

const getDecisionSamples = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return '';
      const decision = item as Record<string, unknown>;
      const path = asText(decision.path);
      const winner = asText(decision.winner);
      if (!path || !winner) return '';
      return `${path} -> ${winner}`;
    })
    .filter(Boolean)
    .slice(0, 3);
};

const getSnapshotRecoveryLabel = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const recovery = value as Record<string, unknown>;
  const status = asText(recovery.status);
  if (status === 'saved') {
    const count = Array.isArray(recovery.snapshotIds) ? recovery.snapshotIds.length : 0;
    return count > 0 ? `${count} snapshots guardados` : 'snapshots guardados';
  }
  if (status === 'failed') return 'snapshots no guardados';
  return '';
};

const getConflictTruthContractLabel = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const summary = value as Record<string, unknown>;
  if (summary.truthSource !== 'authority_intent_invariants' || summary.lastWriteWins !== false) {
    return '';
  }

  const mergedPaths = asTextArray(summary.mergedPaths);
  const blockedPaths = asTextArray(summary.blockedPaths);
  const invariantChecks = asTextArray(summary.invariantChecks);

  return (
    'Verdad seleccionada por autoridad transaccional, intención clínica e invariantes; ' +
    'no por el último navegador' +
    (mergedPaths.length > 0 ? `. Intención fusionada: ${mergedPaths.join(', ')}` : '') +
    (blockedPaths.length > 0 ? `. Rutas protegidas: ${blockedPaths.join(', ')}` : '') +
    (invariantChecks.length > 0 ? `. Invariantes aplicadas: ${invariantChecks.join(', ')}` : '')
  );
};

interface ClinicalAuditNarrative {
  title: string;
  narrative: string;
  affectedSubject: string;
}

export const buildConflictAutoMergedAuditNarrative = (
  log: AuditLogEntry,
  details: Record<string, unknown>
): ClinicalAuditNarrative | null => {
  if (log.action !== 'CONFLICT_AUTO_MERGED') return null;

  const entryCount = Number(details.entryCount || 0);
  const changedPaths = asTextArray(details.changedPaths);
  const samplePaths = asTextArray(details.samplePaths);
  const paths = changedPaths.length > 0 ? changedPaths : samplePaths;
  const assessment =
    details.assessment && typeof details.assessment === 'object'
      ? (details.assessment as Record<string, unknown>)
      : {};
  const riskLabel = getRiskLabel(assessment.riskLevel);
  const reviewRecommended =
    typeof assessment.reviewRecommended === 'boolean' ? assessment.reviewRecommended : undefined;
  const decisionLabel = entryCount === 1 ? '1 decisión' : `${entryCount} decisiones`;
  const decisionSamples = getDecisionSamples(details.sampleDecisions);
  const snapshotRecoveryLabel = getSnapshotRecoveryLabel(details.snapshotRecovery);
  const truthContractLabel = getConflictTruthContractLabel(details.conflictResolutionSummary);

  return {
    title: 'Conflicto sincronizado automáticamente',
    narrative:
      `Se resolvió automáticamente un conflicto de datos en ${getRecordLabel(log)}` +
      (entryCount > 0 ? ` con ${decisionLabel}` : '') +
      (paths.length > 0 ? ` sobre ${paths.join(', ')}` : '') +
      `. Riesgo ${riskLabel}` +
      (decisionSamples.length > 0 ? `. Decisiones: ${decisionSamples.join('; ')}` : '') +
      (truthContractLabel ? `. ${truthContractLabel}` : '') +
      (snapshotRecoveryLabel ? `. Recuperación: ${snapshotRecoveryLabel}` : '') +
      (reviewRecommended ? '; se recomienda revisión administrativa.' : '.'),
    affectedSubject: getRecordLabel(log),
  };
};
