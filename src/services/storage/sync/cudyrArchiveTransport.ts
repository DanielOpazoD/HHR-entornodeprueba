import { getDoc } from 'firebase/firestore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import { archiveCudyrHistory } from '@/services/cudyr/cudyrHistoryService';
import { assertCudyrArchiveAcknowledged } from '@/services/cudyr/cudyrArchiveAcknowledgement';
import type { CudyrArchiveOutboxPayload } from '@/types/domain/cudyrHistory';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

export const replayCudyrArchive = async (
  task: SyncTask,
  runtime: FirestoreServiceRuntimePort
): Promise<void> => {
  const generation = getSessionGeneration();
  const assertOwner = () => {
    if (
      !task.ownerKey ||
      task.ownerKey !== getStoredSessionOwnerKey() ||
      !generation ||
      generation !== getSessionGeneration()
    ) {
      throw new Error('La sesión cambió; el archivo CUDYR conserva su propietario original.');
    }
  };
  assertOwner();
  const { request } = task.payload as CudyrArchiveOutboxPayload;
  const snapshot = await getDoc(getRecordDocRef(request.authorityDate, runtime));
  assertOwner();
  const runId = snapshot.data()?.rayenSync?.runId;
  if (!snapshot.exists() || typeof runId !== 'string' || !runId) {
    throw new Error('No se pudo verificar la ejecución del censo para archivar CUDYR.');
  }
  // Rebind only the write authority. The original source run and source observation time remain
  // immutable; the server rechecks the same episode in this census or its active movements.
  const rebound = { ...request, runId };
  assertCudyrArchiveAcknowledged(rebound, await archiveCudyrHistory(rebound));
};
