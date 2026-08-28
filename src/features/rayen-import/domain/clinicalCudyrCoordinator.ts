import {
  buildImportedCudyr,
  isAdministrativeCudyrAdjustment,
  previousCensusIsoDay,
} from '@/domain/evaluationScales/importedCudyr';
import type { PatientData } from '../contracts/rayenDomainContracts';
import type {
  ClinicalPersistenceEvidence,
  ClinicalFillError,
  HistoricalCudyrApplyResult,
  HistoricalCudyrBatchExecutionResult,
  HistoricalCudyrBatchItem,
  HistoricalCudyrBatchItemResult,
} from '../contracts/clinicalFillContracts';
import { buildClinicalFillError } from '../observability/rayenSyncDiagnostics';
import { readPersistenceFailureEvidence } from '../hooks/clinicalEnrichmentBatchExecutionSupport';
import type { ClinicalCudyrSource } from './clinicalCudyrPreflight';
import { clinicalValuesEqual } from './clinicalIncrementalSync';

interface ClinicalCudyrCoordinatorInput {
  censusDate: string;
  clinicalEpisodeIds: string[];
  source: ClinicalCudyrSource;
  applyBatch?: (
    censusDay: string,
    items: HistoricalCudyrBatchItem[]
  ) => Promise<HistoricalCudyrBatchItemResult[] | HistoricalCudyrBatchExecutionResult>;
  applySingle?: (
    clinicalEpisodeId: string,
    censusDay: string,
    cudyr: HistoricalCudyrBatchItem['cudyr']
  ) => Promise<HistoricalCudyrApplyResult>;
  enqueueWrite: <T>(operation: () => Promise<T>) => Promise<T>;
  onPersistenceEvidence: (evidence: ClinicalPersistenceEvidence) => void;
  onRetries: (count: number) => void;
  onHistoricalPatch: () => void;
  onAdministrativeOverridePreserved: () => void;
  onError: (error: ClinicalFillError) => void;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const batchRetryCount = (error: unknown): number => {
  const retries = Number((error as { clinicalBatchRetries?: unknown })?.clinicalBatchRetries);
  return Number.isFinite(retries) && retries > 0 ? Math.floor(retries) : 0;
};

const indexBatchResults = (
  results: HistoricalCudyrBatchItemResult[]
): Map<string, HistoricalCudyrApplyResult> =>
  new Map(results.map(({ clinicalEpisodeId, ...result }) => [clinicalEpisodeId, result]));

type SharedBatchOutcome =
  | { status: 'fulfilled'; results: Map<string, HistoricalCudyrApplyResult> }
  | { status: 'rejected'; error: unknown };

/** Shares one historical CUDYR read/write across every patient in a synchronization run. */
export const createClinicalCudyrCoordinator = ({
  censusDate,
  clinicalEpisodeIds,
  source,
  applyBatch,
  applySingle,
  enqueueWrite,
  onPersistenceEvidence,
  onRetries,
  onHistoricalPatch,
  onAdministrativeOverridePreserved,
  onError,
}: ClinicalCudyrCoordinatorInput) => {
  const priorCensusDay = previousCensusIsoDay(censusDate);
  const batchResults: Promise<SharedBatchOutcome> | null =
    applyBatch && source.historyAvailable
      ? Promise.resolve()
          .then(() => {
            const items = clinicalEpisodeIds.flatMap<HistoricalCudyrBatchItem>(
              clinicalEpisodeId => {
                const row = source.map.get(clinicalEpisodeId);
                // A fallback-only row has no official history and cannot be archived retrospectively.
                const cudyr =
                  row?.source === 'gestion_camas' ? buildImportedCudyr(row, priorCensusDay) : null;
                return cudyr ? [{ clinicalEpisodeId, cudyr }] : [];
              }
            );
            if (items.length === 0) return new Map<string, HistoricalCudyrApplyResult>();
            return enqueueWrite(() => applyBatch(priorCensusDay, items)).then(outcome => {
              if (Array.isArray(outcome)) return indexBatchResults(outcome);
              if (outcome.persistence) onPersistenceEvidence(outcome.persistence);
              else onRetries(outcome.retries ?? 0);
              return indexBatchResults(outcome.results);
            });
          })
          .then<SharedBatchOutcome>(results => ({ status: 'fulfilled', results }))
          .catch(error => {
            const persistenceEvidence = readPersistenceFailureEvidence(error);
            if (persistenceEvidence) onPersistenceEvidence(persistenceEvidence);
            const clientRetries = batchRetryCount(error);
            if (!persistenceEvidence) onRetries(clientRetries);
            return { status: 'rejected', error };
          })
      : null;

  const apply = async (
    patient: PatientData,
    clinicalEpisodeId: string,
    bedId: string
  ): Promise<{ patient: PatientData; historicalChanged: boolean }> => {
    const row = source.map.get(clinicalEpisodeId);
    const currentCudyr = row ? buildImportedCudyr(row, censusDate) : null;
    const priorCudyr =
      source.historyAvailable && row?.source === 'gestion_camas'
        ? buildImportedCudyr(row, priorCensusDay)
        : null;
    const episodeHistoryAuthoritative =
      source.historyAvailable && (!row || row.source === 'gestion_camas');
    let priorPersisted = !priorCudyr;
    let historicalChanged = false;

    if (priorCudyr && (batchResults || applySingle)) {
      try {
        const batchOutcome = batchResults ? await batchResults : null;
        if (batchOutcome?.status === 'rejected') throw batchOutcome.error;
        const result = batchOutcome
          ? batchOutcome.results.get(clinicalEpisodeId)
          : await enqueueWrite(() => applySingle!(clinicalEpisodeId, priorCensusDay, priorCudyr));
        const notApplicable = result?.applicable === false;
        const administrativeOverridePreserved = Boolean(result?.administrativeOverridePreserved);
        priorPersisted = Boolean(result?.persisted || administrativeOverridePreserved);
        historicalChanged = Boolean(result?.changed);
        if (historicalChanged) onHistoricalPatch();
        if (administrativeOverridePreserved) onAdministrativeOverridePreserved();
        if (!result?.persisted && !administrativeOverridePreserved && !notApplicable) {
          onError(
            buildClinicalFillError({
              bedId,
              clinicalEpisodeId,
              source: 'cudyr',
              reason: 'historical_archive_failed',
              error: `No se pudo archivar el CUDYR en el turno noche ${priorCensusDay}.`,
            })
          );
        }
      } catch (error) {
        onError(
          buildClinicalFillError({
            bedId,
            clinicalEpisodeId,
            source: 'cudyr',
            reason: 'historical_archive_failed',
            error: `No se pudo archivar el CUDYR en el turno noche ${priorCensusDay}: ${errorMessage(error)}`,
          })
        );
      }
    }

    const existingCudyr = patient.evaluationScores?.cudyr;
    if (
      isAdministrativeCudyrAdjustment(existingCudyr) &&
      (currentCudyr
        ? !clinicalValuesEqual(existingCudyr, currentCudyr)
        : episodeHistoryAuthoritative)
    ) {
      onAdministrativeOverridePreserved();
      return { patient, historicalChanged };
    }
    if (currentCudyr && !clinicalValuesEqual(existingCudyr, currentCudyr)) {
      return {
        patient: {
          ...patient,
          evaluationScores: { ...patient.evaluationScores, cudyr: currentCudyr },
        },
        historicalChanged,
      };
    }
    if (!currentCudyr && episodeHistoryAuthoritative && existingCudyr && priorPersisted) {
      const { cudyr: _removed, ...evaluationScores } = patient.evaluationScores ?? {};
      return { patient: { ...patient, evaluationScores }, historicalChanged };
    }
    return { patient, historicalChanged };
  };

  return { apply };
};
