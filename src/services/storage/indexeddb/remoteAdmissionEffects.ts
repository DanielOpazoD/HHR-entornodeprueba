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
  if (occurrences)
    recordOperationalTelemetry({
      category: 'indexeddb',
      operation: 'indexeddb_save_records',
      status: 'degraded',
      context: {
        policy: 'queue_evidence_v1',
        reason: 'unheld_newer_local_replaced',
        count: occurrences,
      },
    });
  if (owner === getStoredSessionOwnerKey() && epoch === getSessionEpoch())
    detached.forEach(publishSpecialistHandoffConflict);
};
