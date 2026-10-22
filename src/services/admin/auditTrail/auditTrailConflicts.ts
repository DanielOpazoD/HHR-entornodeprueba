import {
  asAuditText,
  resolveAuditTrailFieldLabel,
} from '@/services/admin/auditTrail/auditTrailValues';

const MAX_PATHS = 3;

/** `beds.H2C3.clinicalCrib.pathology` → `H2C3 · cuna · Diagnóstico`; the raw path stays technical. */
export const humanizeAuditTrailPath = (path: string): string => {
  const [root, bedId, ...rest] = path.split('.');
  if (root !== 'beds' || !bedId) return resolveAuditTrailFieldLabel(path);
  const crib = rest[0] === 'clinicalCrib';
  const field = (crib ? rest.slice(1) : rest).join('.');
  return [bedId, crib ? 'cuna' : '', field ? resolveAuditTrailFieldLabel(field) : '']
    .filter(Boolean)
    .join(' · ');
};

const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(asAuditText).filter(Boolean).slice(0, MAX_PATHS).map(humanizeAuditTrailPath)
    : [];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const RISK_LABELS: Record<string, string> = { low: 'bajo', medium: 'medio', high: 'alto' };

export interface AuditTrailConflictReading {
  detail?: string;
  notes: string[];
  review: boolean;
}

/**
 * Why an automatic merge kept what it kept. The selected truth comes from transactional
 * authority, clinical intention and invariants, not from the last browser that wrote.
 */
export const describeConflictAutoMerge = (
  details: Record<string, unknown>
): AuditTrailConflictReading => {
  const assessment = asRecord(details.assessment);
  const truth = asRecord(details.conflictResolutionSummary);
  const recovery = asRecord(details.snapshotRecovery);
  const decisions = Number(details.entryCount || 0);
  const risk = RISK_LABELS[asAuditText(assessment.riskLevel).toLowerCase()];

  const notes: string[] = [];
  if (truth.truthSource === 'authority_intent_invariants' && truth.lastWriteWins === false) {
    notes.push(
      'Verdad elegida por autoridad transaccional, intención clínica e invariantes; no por el último navegador'
    );
  }
  const merged = texts(truth.mergedPaths);
  if (merged.length > 0) notes.push(`Fusionado: ${merged.join('; ')}`);
  const protectedPaths = texts(truth.blockedPaths);
  if (protectedPaths.length > 0) notes.push(`Protegido: ${protectedPaths.join('; ')}`);
  if (recovery.status === 'failed') notes.push('Respaldo de versiones no guardado');

  return {
    detail:
      [
        decisions > 0 ? `${decisions} ${decisions === 1 ? 'decisión' : 'decisiones'}` : '',
        risk ? `riesgo ${risk}` : '',
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    notes,
    review: assessment.reviewRecommended === true || recovery.status === 'failed',
  };
};
