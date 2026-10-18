import { explainRayenStructuralIssue } from './rayenStructuralIssueExplanation';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import type { RayenSyncDiagnosticContext, RayenSyncEvent } from '@/types/domain/rayenSync';
import { buildRayenSyncSessionReport } from './rayenSyncSessionReport';

const context = (value?: RayenSyncDiagnosticContext) => ({
  patientName: value?.patientName || null,
  document: value?.document || null,
  clinicalEpisodeId: value?.clinicalEpisodeId || null,
  bedId: value?.bedId || null,
  censusDate: value?.censusDate || null,
  source: value?.source || null,
  sourceTimestamp: value?.sourceTimestamp || null,
  sourceClinicalDay: value?.sourceClinicalDay || null,
  detail: value?.detail || null,
});

/** Explicit user export, separate from aggregate telemetry. No raw payloads or credentials. */
export const buildRayenSyncDiagnosticReport = (history: RayenSyncEvent[]) => ({
  format: 'hhr.sync-diagnostic-report.v1',
  timeZone: CLINICAL_TIME_ZONE,
  interpretation:
    'Contiene identificación clínica. null significa no registrado, no ausencia de error. Las identidades corresponden al intento, nunca al ocupante actual de la cama. Los eventos antiguos pueden carecer de detalle. Cada turno incluye su madrugada siguiente; conservar la fecha clínica de la fuente. Un intento posterior completo no borra el fallo histórico.',
  attempts: history.map(event => ({
    runId: event.id,
    censusDate: event.sourceDate ?? null,
    startedAt: event.startedAt,
    completedAt: event.completedAt ?? null,
    status: event.status,
    failureReason: event.failureReason ?? null,
    source: event.source
      ? {
          extensionVersion: event.source.extensionVersion,
          protocolVersion: event.source.protocolVersion,
          fichaMedico: event.source.fichaMedico,
          gestionCamas: event.source.gestionCamas,
        }
      : null,
    policy: event.policy
      ? {
          mode: event.policy.mode,
          clinicalBatchMode: event.policy.clinicalBatchMode,
          revision: event.policy.revision,
        }
      : null,
    changes: event.changes
      ? {
          admissions: event.changes.admissions,
          updates: event.changes.updates,
          moves: event.changes.moves,
          discharges: event.changes.discharges,
          unchanged: event.changes.unchanged,
        }
      : null,
    structureConfirmed: event.structuralReview?.structureConfirmed ?? null,
    snapshotComplete: event.structuralReview?.snapshotComplete ?? null,
    historicalCorrectionsPending: event.structuralReview?.historicalCorrectionsPending ?? null,
    historicalCorrectionsRequireFreshCapture:
      event.structuralReview?.historicalCorrectionsRequireFreshCapture ?? null,
    clinicalCoverage: event.coverage
      ? {
          total: event.coverage.total,
          completed: event.coverage.completed,
          errors: event.coverage.errors,
          sourceErrors: event.coverage.sourceErrors,
        }
      : null,
    issues: [
      ...(event.structuralReview?.issues ?? []).map(issue => ({
        stage: 'census',
        code: `HHR-SYNC-1/census/${issue.reason}`,
        reason: issue.reason,
        explanation: explainRayenStructuralIssue(issue.reason),
        disposition: 'No aplicado; requiere revisión',
        ...context(issue.diagnostic),
        bedId: issue.diagnostic?.bedId || issue.caseContext?.bedId || issue.bedId || null,
        patientName: issue.diagnostic?.patientName || issue.caseContext?.patientName || null,
        censusDate:
          issue.diagnostic?.censusDate || issue.caseContext?.censusDate || event.sourceDate || null,
      })),
      ...(event.coverage?.issues ?? []).map(issue => ({
        stage: 'clinical',
        code: `HHR-SYNC-1/${issue.source}/${issue.reason}`,
        reason: issue.reason,
        disposition: 'Lectura o persistencia no confirmada',
        ...context(issue.diagnostic),
        source: issue.source,
        bedId: issue.diagnostic?.bedId || issue.bedId || null,
        censusDate: issue.diagnostic?.censusDate || event.sourceDate || null,
      })),
    ],
    performance: buildRayenSyncSessionReport([event]),
  })),
  performanceSummary: buildRayenSyncSessionReport(history),
});
