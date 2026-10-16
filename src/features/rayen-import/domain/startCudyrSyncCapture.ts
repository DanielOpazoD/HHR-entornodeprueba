import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import { captureClinicalCudyrSource } from './clinicalCudyrPreflight';
import { persistCudyrSyncCapture } from './persistCudyrSyncCapture';
import { collectCudyrDailyFacts } from '@/services/cudyr/cudyrReportFacts';

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
      ? preflight.then(({ source }) => {
          const observedAt = deps.now().toISOString();
          return persistCudyrSyncCapture({
            censusDate: input.censusDate,
            runId: deps.diagnosticRunId ?? record.rayenSync?.runId ?? '',
            captureId: deps.createId(),
            observedAt,
            episodes: input.captureEpisodes,
            source,
            write: deps.archiveCudyrCapture!,
            signal: deps.signal,
            ...(deps.recoverCudyrPlacements
              ? {
                  recoverPlacements: (episode: string) => {
                    const facts = collectCudyrDailyFacts(record).filter(
                      f => f.patient.clinicalEpisodeId === episode
                    );
                    const maternalFor = (fact: (typeof facts)[number]) => {
                      const parent = record.beds[fact.placement.bedId ?? ''];
                      const decision = fact.patient.neonatalPlacementDecision;
                      const storedMaternal = fact.patient.neonatalMaternalRut;
                      const reviewedMaternal =
                        decision?.clinicalEpisodeId === episode ? decision.maternalRut : undefined;
                      if (reviewedMaternal || storedMaternal)
                        return reviewedMaternal || storedMaternal!;
                      if (decision?.clinicalEpisodeId === episode) {
                        if (decision.parentEpisodeId !== parent?.clinicalEpisodeId) return '';
                      }
                      return fact.placement.section === 'crib' &&
                        parent?.clinicalCrib?.clinicalEpisodeId === episode
                        ? parent.rut
                        : decision?.clinicalEpisodeId === episode
                          ? decision.maternalRut || fact.patient.neonatalMaternalRut || ''
                          : fact.patient.neonatalMaternalRut || '';
                    };
                    const key = (rut: string) => rut.replace(/[^0-9kK]/g, '').toUpperCase();
                    const identities = new Set(
                      facts.map(f => key(f.patient.rut || maternalFor(f))).filter(Boolean)
                    );
                    if (identities.size !== 1)
                      return Promise.reject(new Error('Identidad de episodio ambigua.'));
                    const maternal = facts.every(
                      f =>
                        f.placement.section === 'crib' ||
                        f.placement.isClinicalCrib ||
                        f.patient.bedMode === 'Cuna' ||
                        Boolean(f.patient.neonatalMaternalRut) ||
                        (f.patient.neonatalPlacementDecision?.clinicalEpisodeId === episode &&
                          Boolean(f.patient.neonatalPlacementDecision.maternalRut))
                    );
                    const parents = new Set(facts.map(f => key(maternalFor(f))).filter(Boolean));
                    return deps.recoverCudyrPlacements!(
                      episode,
                      [...identities][0],
                      observedAt,
                      maternal ? 'maternal' : 'patient',
                      maternal && parents.size === 1 ? [...parents][0] : undefined
                    );
                  },
                }
              : {}),
          });
        })
      : Promise.resolve([]);
  return { preflight, archive };
};
