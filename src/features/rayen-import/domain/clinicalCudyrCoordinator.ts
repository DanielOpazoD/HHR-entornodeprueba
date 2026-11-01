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
  DailyCudyrRecoveryResult,
} from '../contracts/clinicalFillContracts';
import { buildClinicalFillError } from '../observability/rayenSyncDiagnostics';
import { readPersistenceFailureEvidence } from '../hooks/clinicalEnrichmentBatchExecutionSupport';
import type { ClinicalCudyrSource } from './clinicalCudyrPreflight';
import { clinicalValuesEqual } from './clinicalIncrementalSync';
import {
  CUDYR_DOCUMENTARY_SOURCE,
  hasAcceptedCudyr,
} from '@/domain/evaluationScales/documentaryCudyr';

interface ClinicalCudyrCoordinatorInput {
  censusDate: string;
  clinicalEpisodeIds: string[];
  source: ClinicalCudyrSource;
  recovery?: DailyCudyrRecoveryResult;
  applyBatch?: (
    censusDay: string,
    items: HistoricalCudyrBatchItem[]
  ) => Promise<HistoricalCudyrBatchItemResult[] | HistoricalCudyrBatchExecutionResult>;
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
  recovery,
  applyBatch,
  enqueueWrite,
  onPersistenceEvidence,
  onRetries,
  onHistoricalPatch,
  onAdministrativeOverridePreserved,
  onError,
}: ClinicalCudyrCoordinatorInput) => {
  const priorCensusDay = previousCensusIsoDay(censusDate);
  const priorValue = (id: string) => {
    const row = source.map.get(id);
    return (
      (source.historyAvailable && row?.source === 'gestion_camas'
        ? buildImportedCudyr(row, priorCensusDay)
        : null) ??
      recovery?.previous.find(item => item.clinicalEpisodeId === id)?.cudyr ??
      null
    );
  };
  const batchResults: Promise<SharedBatchOutcome> | null =
    applyBatch && (source.historyAvailable || recovery?.previous.length)
      ? Promise.resolve()
          .then(() => {
            const items = clinicalEpisodeIds.flatMap<HistoricalCudyrBatchItem>(
              clinicalEpisodeId => {
                const cudyr = priorValue(clinicalEpisodeId);
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

  const handledHistoricalEpisodes = new Set<string>();
  const applyPrevious = async (clinicalEpisodeId: string, bedId: string) => {
    handledHistoricalEpisodes.add(clinicalEpisodeId);
    const priorCudyr = priorValue(clinicalEpisodeId);
    let priorPersisted = !priorCudyr;
    let historicalChanged = false;

    if (priorCudyr && (batchResults || priorCudyr.source === CUDYR_DOCUMENTARY_SOURCE)) {
      try {
        if (!batchResults) throw new Error('No hay escritor autorizado para el censo histórico.');
        const batchOutcome = await batchResults;
        if (batchOutcome.status === 'rejected') throw batchOutcome.error;
        const result = batchOutcome.results.get(clinicalEpisodeId);
        const notApplicable =
          result?.applicable === false && priorCudyr.source !== CUDYR_DOCUMENTARY_SOURCE;
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

    return { priorPersisted, historicalChanged };
  };

  const apply = async (
    patient: PatientData,
    clinicalEpisodeId: string,
    bedId: string
  ): Promise<{ patient: PatientData; historicalChanged: boolean }> => {
    const row = source.map.get(clinicalEpisodeId);
    const currentCudyr =
      (row ? buildImportedCudyr(row, censusDate) : null) ??
      (!hasAcceptedCudyr(patient) ? recovery?.current.get(clinicalEpisodeId) : undefined);
    const episodeHistoryAuthoritative =
      source.historyAvailable &&
      (row
        ? row.source === 'gestion_camas'
        : source.captureContract === 1 && source.observedEpisodeIds?.includes(clinicalEpisodeId));
    const { priorPersisted, historicalChanged } = await applyPrevious(clinicalEpisodeId, bedId);

    const existingCudyr = patient.evaluationScores?.cudyr;
    if (existingCudyr?.source === CUDYR_DOCUMENTARY_SOURCE) return { patient, historicalChanged };
    if (
      isAdministrativeCudyrAdjustment(existingCudyr) &&
      (currentCudyr
        ? !clinicalValuesEqual(existingCudyr, currentCudyr)
        : source.historyAvailable && (!row || episodeHistoryAuthoritative))
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

  const completeHistorical = async (): Promise<number> => {
    const pending = [...new Set(clinicalEpisodeIds)].filter(
      id => !handledHistoricalEpisodes.has(id)
    );
    const results = await Promise.all(pending.map(id => applyPrevious(id, '*')));
    return results.filter(result => result.historicalChanged).length;
  };

  return { apply, completeHistorical };
};
