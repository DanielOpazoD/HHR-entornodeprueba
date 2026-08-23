import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import type { RayenSyncStage } from './rayenSyncExecutionState';
import type { RayenImportState } from './rayenImportState';
import { isRayenStructuralPlanChangedError } from './confirmRayenImport';
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
          : 'Solo se puede reconciliar el censo vigente o uno de los siete días clínicos anteriores.',
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

export const returnRayenReplanToReview = ({
  error,
  preparedContext,
  preparedContextRef,
  transition,
  setState,
}: {
  error: unknown;
  preparedContext: PreparedRayenSyncContext;
  preparedContextRef: RefObject<PreparedRayenSyncContext | null>;
  transition: (stage: RayenSyncStage) => void;
  setState: Dispatch<SetStateAction<RayenImportState>>;
}): boolean => {
  if (!isRayenStructuralPlanChangedError(error)) return false;
  preparedContextRef.current = { ...preparedContext, record: error.freshRecord };
  transition(
    error.replannedDiff.conflicts.length > 0
      ? { type: 'needs_review', scope: 'structure' }
      : { type: 'awaiting_review' }
  );
  setState({
    diff: error.replannedDiff,
    isPreviewOpen: true,
    isBusy: false,
    isSyncing: false,
    result: null,
    hasSkippedItems: false,
    error: error.message,
  });
  return true;
};
