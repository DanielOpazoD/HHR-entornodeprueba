import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import { updateSpecialistMedicalHandoffViaCallable } from '@/services/storage/firestore/specialistMedicalHandoffClient';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

/**
 * Replays one queued specialist note through the occupant-bound callable. It never touches the
 * day record task: a refused note becomes this task's CONFLICT, with its text kept as drafts.
 */
export const replaySpecialistHandoff = async (task: SyncTask): Promise<void> => {
  const payload = task.payload as SpecialistHandoffSyncPayload;
  const drafts = () => import('@/services/storage/medicalHandoffDraftStorage');
  try {
    await updateSpecialistMedicalHandoffViaCallable(
      payload.date,
      payload.patch,
      payload.expectedOccupants
    );
  } catch (error) {
    if (error instanceof ConcurrencyError)
      (await drafts()).publishSpecialistHandoffConflict(payload);
    throw error;
  }
  (await drafts()).confirmSpecialistHandoffDrafts(payload);
};
