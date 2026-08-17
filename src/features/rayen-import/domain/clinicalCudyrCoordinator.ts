import { buildImportedCudyr, previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import type { PatientData } from '../contracts/rayenDomainContracts';
import type {
  HistoricalCudyrApplyResult,
  HistoricalCudyrBatchItem,
  HistoricalCudyrBatchItemResult,
} from '../contracts/clinicalFillContracts';
import type { ClinicalCudyrSource } from './clinicalCudyrPreflight';
import { clinicalValuesEqual } from './clinicalIncrementalSync';

interface ClinicalCudyrCoordinatorInput {
  censusDate: string;
  clinicalEpisodeIds: string[];
  source: ClinicalCudyrSource;
  applyBatch?: (
    censusDay: string,
    items: HistoricalCudyrBatchItem[]
  ) => Promise<HistoricalCudyrBatchItemResult[]>;
  applySingle?: (
    clinicalEpisodeId: string,
    censusDay: string,
    cudyr: HistoricalCudyrBatchItem['cudyr']
  ) => Promise<HistoricalCudyrApplyResult>;
  enqueueWrite: <T>(operation: () => Promise<T>) => Promise<T>;
  onHistoricalPatch: () => void;
  onError: (bedId: string, clinicalEpisodeId: string, message: string) => void;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
  onHistoricalPatch,
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
            return enqueueWrite(() => applyBatch(priorCensusDay, items)).then(indexBatchResults);
          })
          .then<SharedBatchOutcome>(results => ({ status: 'fulfilled', results }))
          .catch(error => ({ status: 'rejected', error }))
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
        priorPersisted = Boolean(result?.persisted);
        historicalChanged = Boolean(result?.changed);
        if (historicalChanged) onHistoricalPatch();
        if (!result?.persisted && !notApplicable) {
          onError(
            bedId,
            clinicalEpisodeId,
            `No se pudo archivar el CUDYR en el turno noche ${priorCensusDay}.`
          );
        }
      } catch (error) {
        onError(
          bedId,
          clinicalEpisodeId,
          `No se pudo archivar el CUDYR en el turno noche ${priorCensusDay}: ${errorMessage(error)}`
        );
      }
    }

    const existingCudyr = patient.evaluationScores?.cudyr;
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
