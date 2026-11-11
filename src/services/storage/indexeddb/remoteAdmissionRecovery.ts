import type { DailyRecord } from '@/types/domain/dailyRecord';
import { hospitalDB } from './indexedDbCore';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';

const PREFIX = 'remote-admission-recovery:';
const LIMIT = 50;

/** Runs inside admission's transaction. A failed backup aborts the replacement. */
export const preserveAdmissionRecovery = async (record: DailyRecord): Promise<void> => {
  const rows = await hospitalDB.settings.where('id').startsWith(PREFIX).toArray();
  if (rows.some(row => arePatchValuesDeepEqual(row.value, record))) return;
  await hospitalDB.settings.put({ id: `${PREFIX}${crypto.randomUUID()}`, value: record });
  if (rows.length >= LIMIT) {
    await hospitalDB.settings.bulkDelete(rows.slice(0, rows.length - LIMIT + 1).map(row => row.id));
  }
};

import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
import { publishSpecialistHandoffConflict } from '@/services/storage/medicalHandoffDraftStorage';
import type { SpecialistHandoffSyncPayload } from '@/services/storage/syncQueueTypes';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

export const publishAdmissionEffects = ({
  owner,
  epoch,
  detached,
  recoveries,
}: {
  owner: string | null;
  epoch: number;
  detached: SpecialistHandoffSyncPayload[];
  recoveries: number;
}): void => {
  if (recoveries)
    recordOperationalTelemetry({
      category: 'indexeddb',
      operation: 'indexeddb_save_records',
      status: 'degraded',
      context: { policy: 'queue_evidence_v1', reason: 'unheld_local_replaced', count: recoveries },
    });
  if (owner === getStoredSessionOwnerKey() && epoch === getSessionEpoch())
    detached.forEach(publishSpecialistHandoffConflict);
};
