import { getDoc } from 'firebase/firestore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import { archiveCudyrHistory } from '@/services/cudyr/cudyrHistoryService';
import { assertCudyrArchiveAcknowledged } from '@/services/cudyr/cudyrArchiveAcknowledgement';
import type { CudyrArchiveOutboxPayload } from '@/types/domain/cudyrHistory';
import { guardAuthoringSession } from '@/services/storage/authoringSession';

export const replayCudyrArchive = async (
  task: SyncTask,
  runtime: FirestoreServiceRuntimePort
): Promise<void> => {
  // Only the owner this tab admitted sends their archive; anyone else's stays queued as it is.
  const guard = guardAuthoringSession({
    message: 'La sesión cambió; el archivo CUDYR conserva su propietario original.',
  });
  const assertOwner = () => {
    if (!task.ownerKey || task.ownerKey !== guard.session.ownerKey)
      throw new Error('La sesión cambió; el archivo CUDYR conserva su propietario original.');
    guard.check();
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
  assertCudyrArchiveAcknowledged(rebound, await archiveCudyrHistory(rebound, guard));
};
