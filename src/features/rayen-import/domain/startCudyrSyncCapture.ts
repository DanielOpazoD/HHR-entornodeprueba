import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import { captureClinicalCudyrSource } from './clinicalCudyrPreflight';
import { persistCudyrSyncCapture } from './persistCudyrSyncCapture';

/** One source fetch supplies both the daily projection and the independent permanent archive. */
export const startCudyrSyncCapture = (input: {
  record: DailyRecord;
  censusDate: string;
  deps: ClinicalFillDeps;
  captureEpisodes: string[];
  needsRead: boolean;
  trackRequest: Parameters<typeof captureClinicalCudyrSource>[0]['trackRequest'];
  recordTimeout: (value: unknown) => void;
}) => {
  const { deps, record } = input;
  const preflight = input.needsRead
    ? captureClinicalCudyrSource({
        fetch: deps.fetchCudyrCategories,
        trackRequest: input.trackRequest,
        recordTimeout: input.recordTimeout,
        requireCompleteMetadata: Boolean(deps.archiveCudyrCapture),
      })
    : Promise.resolve({
        source: { map: new Map(), historyAvailable: false },
        unavailableError: undefined,
      });
  const archive =
    deps.archiveCudyrCapture && input.captureEpisodes.length
      ? preflight.then(({ source }) =>
          persistCudyrSyncCapture({
            censusDate: input.censusDate,
            runId: deps.diagnosticRunId ?? record.rayenSync?.runId ?? '',
            captureId: deps.createId(),
            observedAt: deps.now().toISOString(),
            episodes: input.captureEpisodes,
            source,
            write: deps.archiveCudyrCapture!,
          })
        )
      : Promise.resolve([]);
  return { preflight, archive };
};
