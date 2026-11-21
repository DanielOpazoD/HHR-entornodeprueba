import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { toIsoReportDate } from './reportDateHelpers';
import { elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import {
  validatePreparedRayenSyncContextAtCompletion,
  type PreparedRayenSyncContext,
} from './rayenSyncTemporalContext';

type EvidencePreparation =
  | { valid: false; error: string }
  | { valid: true; isHistoricalDay: boolean; reportDate: string };

export const createRayenPlanningMetrics = () => {
  let historicalEvidenceMs = 0;
  return {
    reconciliationStartedAt: Date.now(),
    counters: { requests: 0, cacheHits: 0, timeouts: 0 },
    measureEvidence: async <T>(operation: () => Promise<T>): Promise<T> => {
      const startedAt = Date.now();
      try {
        return await operation();
      } finally {
        historicalEvidenceMs += elapsedMilliseconds(startedAt);
      }
    },
    getHistoricalEvidenceMs: () => historicalEvidenceMs,
  };
};

export const prepareRayenSnapshotEvidence = (
  context: PreparedRayenSyncContext,
  snapshot: RayenCensusSnapshot,
  bundle: RayenSyncBundle
): EvidencePreparation => {
  const temporalValidation = validatePreparedRayenSyncContextAtCompletion(context);
  if (!temporalValidation.valid) {
    return {
      valid: false,
      error:
        temporalValidation.reason === 'clinical_day_changed'
          ? 'El turno de enfermería cambió durante la captura. Vuelve a sincronizar para usar un único corte temporal.'
          : 'Selecciona una fecha de censo válida, actual o pasada.',
    };
  }
  const matchesRequest =
    bundle.facilityId === snapshot.facilityId &&
    bundle.fichaMedicoCapturedAt === snapshot.capturedAt &&
    bundle.dateStart === context.range.dateStart &&
    bundle.dateEnd === context.range.dateEnd;
  return matchesRequest
    ? {
        valid: true,
        isHistoricalDay: context.target.kind === 'historical',
        reportDate: toIsoReportDate(context.record),
      }
    : {
        valid: false,
        error:
          'La evidencia de Ficha Médico y Gestión de Camas no corresponde al mismo censo. Vuelve a sincronizar.',
      };
};
