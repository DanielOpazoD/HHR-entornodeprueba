import { httpsCallable } from 'firebase/functions';
import { getDoc } from 'firebase/firestore';
import { getRecordDocRef } from './firestoreShared';
import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
  type SpecialistHandoffTarget,
} from './specialistMedicalHandoffIdentity';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';

/**
 * Only path for a specialist note: the server checks the expected occupants and writes in one
 * transaction. Loaded on demand, for the online save and for the queued replay alike.
 */
export const updateSpecialistMedicalHandoffViaCallable = async (
  date: string,
  patch: Record<string, unknown>,
  expectedOccupants: SpecialistHandoffTarget[]
): Promise<void> => {
  const conflict = () =>
    new ConcurrencyError(
      `El paciente o episodio de la cama ${expectedOccupants.map(target => target.bedId).join(', ')} cambió o no se pudo confirmar. El texto se conserva como borrador del paciente original; revísalo antes de recargar.`,
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
    { date: string; patch: Record<string, unknown>; expectedOccupants: SpecialistHandoffTarget[] },
    { success: boolean; date: string; bedId: string }
  >(functions, 'updateSpecialistMedicalHandoff', { timeout: 45_000 });

  try {
    await callable({ date, patch, expectedOccupants });
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
