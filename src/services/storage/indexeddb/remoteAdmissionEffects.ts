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
  for (let occurrence = 0; occurrence < occurrences; occurrence += 1)
    recordOperationalTelemetry({
      category: 'indexeddb',
      operation: 'indexeddb_save_records',
      status: 'degraded',
      context: {
        reason: 'unheld_newer_local_replaced',
        count: 1,
      },
    });
  if (owner === getStoredSessionOwnerKey() && epoch === getSessionEpoch())
    detached.forEach(publishSpecialistHandoffConflict);
};
