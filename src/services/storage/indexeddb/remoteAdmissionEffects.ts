import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
import { publishSpecialistHandoffConflict } from '@/services/storage/medicalHandoffDraftStorage';
import type { SpecialistHandoffSyncPayload } from '@/services/storage/syncQueueTypes';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

export const publishAdmissionEffects = ({
  owner,
  epoch,
  detached,
  occurrences,
}: {
  owner: string | null;
  epoch: number;
  detached: SpecialistHandoffSyncPayload[];
  occurrences: number;
}): void => {
  // One event per admission with the number of days: a range of hundreds must not flood the
  // receiver, whose rate limit would drop most of them and undercount.
  if (occurrences > 0)
    recordOperationalTelemetry({
      category: 'indexeddb',
      operation: 'indexeddb_save_records',
      status: 'degraded',
      context: {
        reason: 'unheld_newer_local_replaced',
        count: occurrences,
      },
    });
  if (owner === getStoredSessionOwnerKey() && epoch === getSessionEpoch())
    detached.forEach(publishSpecialistHandoffConflict);
};
