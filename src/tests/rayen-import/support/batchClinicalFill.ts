import { runClinicalFill as run } from '@/features/rayen-import/clinicalFillRunner';
import type {
  ClinicalFillDeps as RunnerDeps,
  ClinicalFillPatchTarget,
  HistoricalCudyrApplyResult,
} from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';

/** Synthetic batch sink: exposes prepared values to the source/identity regression assertions. */
export type ClinicalFillDeps = Omit<RunnerDeps, 'persistenceStrategy'> & {
  persistenceStrategy?: RunnerDeps['persistenceStrategy'];
  applyPatch: (patch: DailyRecordPatch, target: ClinicalFillPatchTarget) => Promise<void>;
  applyHistoricalCudyr?: (
    episode: string,
    day: string,
    cudyr: ImportedCudyr
  ) => Promise<HistoricalCudyrApplyResult>;
};

export const runClinicalFill = (
  record: Parameters<typeof run>[0],
  date: Parameters<typeof run>[1],
  deps: ClinicalFillDeps,
  onProgress?: Parameters<typeof run>[3]
) =>
  run(
    record,
    date,
    {
      ...deps,
      applyHistoricalCudyrBatch:
        deps.applyHistoricalCudyrBatch ??
        (deps.applyHistoricalCudyr
          ? async (day, items) =>
              Promise.all(
                items.map(async item => ({
                  clinicalEpisodeId: item.clinicalEpisodeId,
                  ...(await deps.applyHistoricalCudyr!(item.clinicalEpisodeId, day, item.cudyr)),
                }))
              )
          : undefined),
      persistenceStrategy: deps.persistenceStrategy ?? {
        disposition: 'deferred',
        persist: async operations => {
          let historySnapshots = 0;
          for (const operation of operations) {
            const captureHistorySnapshot =
              (operation.clinicalFieldCount ?? 1) > 0 && historySnapshots === 0;
            await deps.applyPatch(operation.patch, { ...operation.target, captureHistorySnapshot });
            if (captureHistorySnapshot) historySnapshots = 1;
          }
          return { patientWrites: Number(operations.length > 0), historySnapshots };
        },
      },
    },
    onProgress
  );
