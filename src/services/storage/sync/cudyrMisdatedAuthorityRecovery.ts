import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CudyrArchiveOutboxPayload } from '@/types/domain/cudyrHistory';
import type { SyncQueueStorePort } from './syncQueuePorts';
import { isPolicyBlockedCudyrArchive } from './cudyrPolicyBlockedRecovery';

/** Repairs the former clinical-day/authority-day mix-up only when the original run
 * is found in the immediately preceding census. Source observations remain immutable.
 */
export const createMisdatedCudyrAuthorityRecovery =
  (deps: {
    store: SyncQueueStorePort;
    getOwner: () => string | null;
    getGeneration: () => string | null;
    readConfirmedCensus: (date: string) => Promise<DailyRecord | null>;
  }) =>
  async (expectedGeneration: string, isAuthorized: () => boolean): Promise<number> => {
    const owner = deps.getOwner();
    const valid = () =>
      Boolean(
        owner &&
        owner === deps.getOwner() &&
        expectedGeneration === deps.getGeneration() &&
        isAuthorized()
      );
    if (!valid() || !deps.store.withEnqueueTransaction || !deps.store.requeueQuarantinedTask)
      return 0;
    const tasks = (await deps.store.listAll(owner)).filter(task => {
      const request = (task.payload as Partial<CudyrArchiveOutboxPayload> | null)?.request;
      return (
        task.ownerKey === owner &&
        task.type === 'ARCHIVE_CUDYR' &&
        task.status === 'FAILED' &&
        (isPolicyBlockedCudyrArchive(task) ||
          task.error?.endsWith(
            'No se pudo verificar la ejecución del censo para archivar CUDYR.'
          )) &&
        request?.schemaVersion === 1 &&
        typeof request.runId === 'string' &&
        request.runId.length > 0 &&
        request.capture?.sourceRunId === request.runId &&
        /^\d{4}-\d{2}-\d{2}$/.test(request.authorityDate)
      );
    });
    const records = new Map<string, DailyRecord | null>();
    const repairs = new Map<number, CudyrArchiveOutboxPayload>();
    for (const task of tasks) {
      const payload = task.payload as CudyrArchiveOutboxPayload;
      const day = Date.parse(`${payload.request.authorityDate}T12:00:00Z`);
      if (
        !Number.isFinite(day) ||
        new Date(day).toISOString().slice(0, 10) !== payload.request.authorityDate
      )
        continue;
      const date = new Date(day - 86_400_000).toISOString().slice(0, 10);
      if (!records.has(date)) records.set(date, await deps.readConfirmedCensus(date));
      if (!valid()) return 0;
      const record = records.get(date);
      const originalRun = record?.rayenSyncHistory?.find(
        event => event.id === payload.request.runId
      );
      if (
        task.id !== undefined &&
        record?.date === date &&
        originalRun?.sourceDate === date &&
        ['applied', 'complete', 'partial'].includes(originalRun.status)
      ) {
        repairs.set(task.id, { ...payload, request: { ...payload.request, authorityDate: date } });
        // Bound verified writes, so unverifiable older entries cannot starve later captures.
        if (repairs.size === 50) break;
      }
    }
    return deps.store.withEnqueueTransaction(async () => {
      let repaired = 0;
      const currentTasks = await deps.store.listAll(owner);
      for (const task of tasks) {
        if (!valid()) throw new Error('La sesión cambió durante la recuperación CUDYR.');
        const current = currentTasks.find(t => t.id === task.id);
        const payload = task.id === undefined ? undefined : repairs.get(task.id);
        if (
          !payload ||
          current?.status !== 'FAILED' ||
          current.ownerKey !== owner ||
          JSON.stringify(current.payload) !== JSON.stringify(task.payload)
        )
          continue;
        await deps.store.update(task.id!, { payload });
        if (await deps.store.requeueQuarantinedTask!(task.id!, owner)) repaired++;
      }
      if (!valid()) throw new Error('La sesión cambió durante la recuperación CUDYR.');
      return repaired;
    });
  };
