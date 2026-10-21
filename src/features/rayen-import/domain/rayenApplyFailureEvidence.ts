import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import { normalizeDateOnly } from '@/utils/clinicalDayUtils';
import {
  MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES,
  type RayenSyncStructuralIssue,
  type RayenSyncStructuralReviewEvidence,
} from '@/types/domain/rayenSync';
import { classifyRayenSyncError } from '../observability/rayenSyncDiagnostics';

/** Freeze known failure evidence, never a raw exception or the bed's later occupant. */
export const buildRayenApplyFailureEvidence = (
  error: unknown,
  censusDate: string
): RayenSyncStructuralReviewEvidence | undefined => {
  if (error === undefined) return undefined;
  const issues: RayenSyncStructuralIssue[] = [];
  if (error instanceof AdmissionDatePolicyViolationError) {
    for (const violation of error.violations.slice(0, MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES)) {
      const bedId = /^beds\.([^.]+)/.exec(violation.path)?.[1] ?? null;
      const diagnosticBed =
        bedId && violation.path.endsWith('.clinicalCrib') ? `C-${bedId}` : bedId;
      issues.push({
        bedId,
        reason: 'admission-date-policy',
        diagnostic: {
          patientName: violation.patientName.slice(0, 240),
          document: violation.rut.slice(0, 80),
          ...(diagnosticBed ? { bedId: diagnosticBed } : {}),
          censusDate,
          source: 'hhr/admission-date-policy',
          detail: [
            'La validación rechazó un cambio de fecha de ingreso.',
            `Fecha guardada: ${normalizeDateOnly(violation.currentAdmissionDate) ?? 'no registrada'}.`,
            `Fecha propuesta: ${normalizeDateOnly(violation.attemptedAdmissionDate) ?? 'no registrada'}.`,
            `Primera aparición: ${normalizeDateOnly(violation.firstSeenDate) ?? 'no registrada'}.`,
            'No se confirmó el guardado del censo.',
          ].join(' '),
        },
      });
    }
  }
  if (issues.length === 0) {
    issues.push({
      bedId: null,
      reason: 'structural-write-rejected',
      diagnostic: {
        censusDate,
        source: 'hhr/structural-persistence',
        detail: `El guardado del censo no se confirmó. Categoría técnica: ${classifyRayenSyncError(error)}.`,
      },
    });
  }
  return {
    structureConfirmed: false,
    historicalCorrectionsPending: false,
    historicalCorrectionsRequireFreshCapture: false,
    isolatedConflicts:
      error instanceof AdmissionDatePolicyViolationError
        ? Math.max(issues.length, error.violations.length)
        : issues.length,
    issues,
  };
};
