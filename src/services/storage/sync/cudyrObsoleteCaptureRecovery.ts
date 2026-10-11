import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueStorePort } from './syncQueuePorts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CudyrArchiveOutboxPayload } from '@/types/domain/cudyrHistory';
import { collectCudyrDailyFacts } from '@/services/cudyr/cudyrReportFacts';

const ABSENT_CONTEXT = 'CUDYR episode is absent from the authoritative census and movements.';

/** Only an empty, complete, single-part check rejected for this exact reason.
 * Actual evaluations, bed history, incomplete reads and every other failure stay pending.
 */
export const isObsoleteEmptyCudyrCandidate = (task: SyncTask): boolean => {
  const request = (task.payload as Partial<CudyrArchiveOutboxPayload> | null)?.request;
  const capture = request?.capture;
  return Boolean(
    task.type === 'ARCHIVE_CUDYR' &&
    task.status === 'FAILED' &&
    task.lastErrorCode === 'functions/failed-precondition' &&
    task.error?.endsWith(ABSENT_CONTEXT) &&
    request?.schemaVersion === 1 &&
    /^\d{4}-\d{2}-\d{2}$/.test(request.authorityDate) &&
    Array.isArray(request.evaluations) &&
    request.evaluations.length === 0 &&
    capture?.clinicalEpisodeId &&
    capture.id &&
    capture.sourceRunId &&
    Number.isFinite(Date.parse(capture.observedAt)) &&
    capture.status === 'not_observed' &&
    capture.metadataStatus === 'complete' &&
    capture.totalEvaluations === 0 &&
    capture.part === 0 &&
    capture.totalParts === 1 &&
    (capture.sourcePlacements === undefined ||
      (Array.isArray(capture.sourcePlacements) && capture.sourcePlacements.length === 0))
  );
};

const verifiedAbsent = (task: SyncTask, record: DailyRecord | null): boolean => {
  const { request } = task.payload as CudyrArchiveOutboxPayload;
  const run = record?.rayenSyncHistory?.find(event => event.id === record.rayenSync?.runId);
  return Boolean(
    record &&
    record.date === request.authorityDate &&
    record.beds &&
    Array.isArray(record.discharges) &&
    Array.isArray(record.transfers) &&
    Array.isArray(record.cma) &&
    run?.status === 'complete' &&
    run.structuralReview?.snapshotComplete === true &&
    run.sourceDate === request.authorityDate &&
    !collectCudyrDailyFacts(record).some(
      f => f.patient.clinicalEpisodeId === request.capture!.clinicalEpisodeId
    )
  );
};

/** Called only after the normal sync. Preserve original payload/error as a reversible local
 * record; RETIRED is not a Firebase acknowledgement and carries no report evidence.
 */
export const createObsoleteCudyrCaptureRecovery =
  (deps: {
    store: SyncQueueStorePort;
    getOwner: () => string | null;
    getGeneration: () => string | null;
    readConfirmedCensus: (date: string) => Promise<DailyRecord | null>;
    now: () => Date;
  }) =>
  async (generation: string, isAuthorized: () => boolean): Promise<number> => {
    const owner = deps.getOwner();
    const valid = () =>
      Boolean(
        owner && owner === deps.getOwner() && generation === deps.getGeneration() && isAuthorized()
      );
    if (!valid() || !deps.store.withEnqueueTransaction) return 0;
    const candidates = (await deps.store.listAll(owner))
      .filter(t => t.ownerKey === owner && isObsoleteEmptyCudyrCandidate(t))
      .slice(0, 50);
    const records = new Map<string, DailyRecord | null>();
    for (const task of candidates) {
      if (!valid()) return 0;
      const date = (task.payload as CudyrArchiveOutboxPayload).request.authorityDate;
      if (!records.has(date)) records.set(date, await deps.readConfirmedCensus(date));
    }
    if (!valid()) return 0;
    return deps.store.withEnqueueTransaction(async () => {
      let retired = 0;
      const rows = await deps.store.listAll(owner);
      for (const candidate of candidates) {
        if (!valid()) throw new Error('La sesión o autorización cambió durante la revisión local.');
        const task = rows.find(row => row.id === candidate.id && row.opId === candidate.opId);
        if (
          !task ||
          task.id === undefined ||
          task.ownerKey !== owner ||
          !isObsoleteEmptyCudyrCandidate(task) ||
          JSON.stringify(task.payload) !== JSON.stringify(candidate.payload)
        )
          continue;
        const date = (task.payload as CudyrArchiveOutboxPayload).request.authorityDate;
        const record = records.get(date) ?? null;
        if (!verifiedAbsent(task, record)) continue;
        await deps.store.update(task.id, {
          status: 'RETIRED',
          retirement: {
            reason: 'empty_capture_without_census_context',
            retiredAt: deps.now().toISOString(),
            authorityDate: date,
            verifiedRunId: record!.rayenSync!.runId!,
          },
        });
        retired++;
      }
      if (!valid()) throw new Error('La sesión o autorización cambió durante la revisión local.');
      return retired;
    });
  };
