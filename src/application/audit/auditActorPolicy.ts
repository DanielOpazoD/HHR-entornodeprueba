import type { AuditAction } from '@/types/auditActionTypes';

/**
 * Sentinel value used when no authenticated user is in scope (login page,
 * public routes, anonymous services). Persisting a clinical audit event with
 * this actor would break traceability, which is the policy below enforces.
 */
export const ANONYMOUS_AUDIT_ACTOR = 'anon';

/**
 * Returns true when the actor identifier cannot be attributed to a real
 * authenticated user. Treated as missing: empty string, whitespace-only,
 * the explicit `'anon'` sentinel, or anything else recognized as anonymous
 * by upstream auditing helpers (`anonymous`, `anonymous_user`).
 */
export const isAnonymousActor = (actor: string | null | undefined): boolean => {
  if (actor == null) return true;
  const normalized = actor.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === ANONYMOUS_AUDIT_ACTOR ||
    normalized === 'anonymous' ||
    normalized === 'anonymous_user'
  );
};

/**
 * Audit actions that mutate clinical state or affect the integrity of clinical
 * traceability. Persisting any of these without an attributable actor is a
 * release-blocker: the auditor needs to know *who* moved a patient, signed a
 * handoff, modified CUDYR or imported/exported data.
 *
 * Excluded by design: passive view actions (`VIEW_*`, `PATIENT_VIEWED`),
 * authentication lifecycle (`USER_LOGIN`, `USER_LOGOUT`) and operational
 * telemetry (`SYSTEM_ERROR`) — those occur before or independent of an
 * authenticated session.
 */
export const CLINICAL_AUDIT_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'PATIENT_ADMITTED',
  'PATIENT_DISCHARGED',
  'PATIENT_TRANSFERRED',
  'PATIENT_MODIFIED',
  'PATIENT_BED_CHANGED',
  'PATIENT_DIAGNOSIS_CHANGED',
  'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED',
  'PATIENT_DISCHARGE_RECLASSIFIED',
  'PATIENT_NOTE_UPDATED',
  'PATIENT_CLEARED',
  'PATIENT_HARMONIZED',
  'PATIENT_SPECIALTY_CHANGED',
  'CLINICAL_EVENT_ADDED',
  'CLINICAL_EVENT_UPDATED',
  'CLINICAL_EVENT_DELETED',
  'DAILY_RECORD_DELETED',
  'DAILY_RECORD_CREATED',
  'NURSE_HANDOFF_MODIFIED',
  'MEDICAL_HANDOFF_MODIFIED',
  'HANDOFF_NOVEDADES_MODIFIED',
  'MEDICAL_HANDOFF_SIGNED',
  'MEDICAL_HANDOFF_RESTORED',
  'CUDYR_MODIFIED',
  'BED_BLOCKED',
  'BED_UNBLOCKED',
  'EXTRA_BED_TOGGLED',
  'CLINICAL_DOCUMENT_CREATED',
  'CLINICAL_DOCUMENT_DELETED',
  'CLINICAL_DOCUMENT_EDITED',
  'CLINICAL_DOCUMENT_EXPORTED',
  'CLINICAL_DOCUMENT_PRINTED',
  'PRESCRIPTION_MANUAL_DELETED',
  'MEDICAL_INDICATION_RECORD_CREATED',
  'MEDICAL_INDICATION_TEMPLATE_CREATED',
  'MEDICAL_INDICATION_TEMPLATE_UPDATED',
  'MEDICAL_INDICATION_TEMPLATE_ARCHIVED',
  'MEDICAL_INDICATION_TEMPLATE_USED',
  'WOUND_CARE_PHOTO_UPLOADED',
  'DATA_IMPORTED',
  'DATA_EXPORTED',
  'DATA_ADMISSION_DATES_BACKFILLED',
  'CONFLICT_AUTO_MERGED',
  'CONFLICT_VERSION_RESTORED',
]);

export const isClinicalAuditAction = (action: AuditAction): boolean =>
  CLINICAL_AUDIT_ACTIONS.has(action);
