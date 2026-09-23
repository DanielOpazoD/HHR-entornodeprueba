import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import { getSettingsDocPath } from '@/constants/firestorePaths';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { assertDailyRecordPartialUpdateAccepted } from '@/services/repositories/dailyRecordRepositoryWriteOutcome';
import type { SpecialtyIntent } from '@/types/domain/specialtyDecision';
import type { DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';

const REGION = 'southamerica-east1';

export class JevSuggestionUnavailableError extends Error {}

export interface JevSuggestion {
  model: string;
  promptVersion: string;
  choice: string;
  specialty: string | null;
  confidence: number;
}

export interface SpecialtyTarget {
  date: string;
  bedId: string;
  target: 'bed' | 'clinicalCrib';
  episodeId: string;
}

export const requestSpecialtySuggestion = async (
  scope: SpecialtyTarget,
  requestId: string
): Promise<JevSuggestion> => {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions(REGION);
  const callable = httpsCallable<SpecialtyTarget & { requestId: string },
    { status: string; result?: JevSuggestion }>(
    functions, 'requestSpecialtyJevSuggestion', { timeout: 30_000 }
  );
  const { data } = await callable({ ...scope, requestId });
  if (data.status !== 'complete' || !data.result) {
    if (data.status !== 'pending') {
      throw new JevSuggestionUnavailableError('Jev no entregó una sugerencia vigente.');
    }
    throw new Error('La consulta Jev sigue pendiente.');
  }
  return data.result;
};

export const acceptSpecialtySuggestion = async (
  scope: SpecialtyTarget,
  requestId: string,
  value: string,
  expectedDecisionId: string | null
): Promise<void> => {
  const intent: SpecialtyIntent = { kind: 'accept_ai', ...scope, requestId,
    value, expectedDecisionId };
  const path = scope.target === 'clinicalCrib'
    ? `beds.${scope.bedId}.clinicalCrib.specialty`
    : `beds.${scope.bedId}.specialty`;
  const result = await updatePartialDetailed(scope.date, { [path]: value } as DailyRecordPatch, {
    specialtyIntent: intent,
    requireAtomicCas: true,
    requireRemoteAuthorityFirst: true,
    requireConfirmedRecord: true,
  });
  assertDailyRecordPartialUpdateAccepted(result);
  if (!result.updatedRemotely || result.queuedForRetry) {
    throw new Error('No se confirmó la especialidad en el censo remoto.');
  }
};

export const publishSpecialtyMemory = async (
  scope: SpecialtyTarget,
  specialty: string,
  expectedCie10Code: string,
  expectedDecisionId: string
): Promise<void> => {
  const snapshot = await getDoc(doc(defaultFirestoreServiceRuntime.getDb(),
    getSettingsDocPath('specialtyAssignment')));
  const expectedRevision = snapshot.exists() ? snapshot.data().revision : 0;
  if (!Number.isInteger(expectedRevision)) throw new Error('Catálogo de especialidades no disponible.');
  const functions = await defaultFunctionsRuntime.getRegionalFunctions(REGION);
  const callable = httpsCallable<SpecialtyTarget & {
    specialty: string; expectedCie10Code: string; expectedDecisionId: string;
    expectedRevision: number; confirmed: true;
  }, { status: string }>(functions, 'publishSpecialtyMemory', { timeout: 30_000 });
  await callable({ ...scope, specialty, expectedCie10Code, expectedDecisionId,
    expectedRevision, confirmed: true });
};
