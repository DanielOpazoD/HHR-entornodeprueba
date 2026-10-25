import { httpsCallable } from 'firebase/functions';
import { getDoc } from 'firebase/firestore';
import { getRecordDocRef } from './firestoreShared';
import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
} from './specialistMedicalHandoffIdentity';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import {
  confirmSpecialistHandoffDrafts,
  publishSpecialistHandoffConflict,
} from '@/services/storage/medicalHandoffDraftStorage';
import type { DailyRecord } from '@/types/domain/dailyRecord';

/**
 * Only path for a specialist note: in one transaction the server checks the expected occupants
 * and that the stored note is still the one the edit started from, and acknowledges a replay of
 * a write it already took. Loaded on demand, for the online save and for the queued replay.
 */
export const updateSpecialistMedicalHandoffViaCallable = async ({
  date,
  patch,
  expectedOccupants,
  mutationId,
}: SpecialistHandoffSyncPayload): Promise<void> => {
  const conflict = () =>
    new ConcurrencyError(
      `El paciente, el episodio o la nota de la cama ${expectedOccupants.map(target => target.bedId).join(', ')} cambió o no se pudo confirmar. El texto se conserva como borrador del paciente original; revísalo antes de recargar.`,
      'semantic_conflict'
    );
  if (
    !expectedOccupants.length ||
    expectedOccupants.some(target => !target.clinicalEpisodeId || !target.patientName)
  ) {
    throw conflict();
  }
  // Re-read on EVERY attempt, including retries after ambiguous transport failures: a server
  // deployed before this client still writes by bed, so the client refuses a changed occupant too.
  const snapshot = await getDoc(getRecordDocRef(date));
  const actual = snapshot.exists()
    ? buildSpecialistHandoffTargets(snapshot.data() as DailyRecord, patch)
    : [];
  if (
    expectedOccupants.some(
      expected => !actual.some(target => sameSpecialistHandoffTarget(target, expected))
    )
  )
    throw conflict();
  const functions = await defaultFunctionsRuntime.getFunctions();
  const callable = httpsCallable<
    SpecialistHandoffSyncPayload,
    { success: boolean; date: string; bedId: string }
  >(functions, 'updateSpecialistMedicalHandoff', { timeout: 45_000 });

  try {
    await callable({ date, patch, expectedOccupants, ...(mutationId ? { mutationId } : {}) });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'functions/failed-precondition' || error.code === 'failed-precondition')
    ) {
      throw conflict();
    }
    if (error instanceof Error && error.message.includes('current clinical day')) {
      throw new ConcurrencyError(
        'Cambió el día clínico. La entrega pendiente se conserva para revisión manual; no fue publicada.',
        'semantic_conflict'
      );
    }
    throw error;
  }
};

/**
 * Replays one queued specialist note through the same callable. It never touches the day task:
 * a refused note becomes this task's CONFLICT, with its text kept as drafts.
 */
export const replaySpecialistHandoff = async (task: SyncTask): Promise<void> => {
  const payload = task.payload as SpecialistHandoffSyncPayload;
  try {
    await updateSpecialistMedicalHandoffViaCallable(payload);
  } catch (error) {
    if (error instanceof ConcurrencyError) publishSpecialistHandoffConflict(payload);
    throw error;
  }
  confirmSpecialistHandoffDrafts(payload);
};
