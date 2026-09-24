import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import { getSpecialtyPolicyDocPath } from '@/constants/firestorePaths';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { assertDailyRecordPartialUpdateAccepted } from '@/services/repositories/dailyRecordRepositoryWriteOutcome';
import type { SpecialtyIntent } from '@/types/domain/specialtyDecision';
import type { DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';

const REGION = 'southamerica-east1';

export class JevSuggestionUnavailableError extends Error {}
export class JevSuggestionPendingError extends Error {}

/** Reuse a reservation only when the result of the previous call is uncertain. */
export const shouldRetainJevRequestId = (error: unknown): boolean => {
  if (error instanceof JevSuggestionPendingError) return true;
  if (error instanceof JevSuggestionUnavailableError) return false;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return true;
  return ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal',
    'unavailable', 'deadline-exceeded', 'internal'].includes(code);
};

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

export interface JevConsultationPreparation {
  code: string;
  canonicalLabel: string;
}

/** Read-only preflight. The provider receives only this approved code/label after confirmation. */
export const prepareSpecialtyJevConsultation = async (
  cie10Code: string
): Promise<JevConsultationPreparation> => {
  await defaultFirestoreServiceRuntime.ready;
  const db = defaultFirestoreServiceRuntime.getDb();
  if (db.app.options.projectId !== 'hhr-pruebas') {
    throw new JevSuggestionUnavailableError('La consulta Jev sólo está habilitada en hhr-pruebas.');
  }
  const snapshot = await getDoc(doc(db, getSpecialtyPolicyDocPath()));
  const policy = snapshot.data();
  const code = cie10Code.trim().toUpperCase().replace(/\s+/g, '');
  const canonicalLabel = policy?.diagnosisLabels?.[code];
  if (policy?.aiMode !== 'consultative' || typeof canonicalLabel !== 'string' ||
      !canonicalLabel.trim()) {
    throw new JevSuggestionUnavailableError('El diagnóstico no está habilitado en el catálogo Jev.');
  }
  return { code, canonicalLabel: canonicalLabel.trim() };
};

export const requestSpecialtySuggestion = async (
  scope: SpecialtyTarget,
  requestId: string,
  preparation: JevConsultationPreparation
): Promise<JevSuggestion> => {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions(REGION);
  const callable = httpsCallable<SpecialtyTarget & { requestId: string; expectedCode: string; expectedCanonicalLabel: string },
    { status: string; result?: JevSuggestion }>(
    functions, 'requestSpecialtyJevSuggestion', { timeout: 30_000 }
  );
  const { data } = await callable({ ...scope, requestId,
    expectedCode: preparation.code, expectedCanonicalLabel: preparation.canonicalLabel });
  if (data.status !== 'complete' || !data.result) {
    if (data.status !== 'pending') {
      throw new JevSuggestionUnavailableError('Jev no entregó una sugerencia vigente.');
    }
    throw new JevSuggestionPendingError('La consulta Jev sigue pendiente.');
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
    getSpecialtyPolicyDocPath()));
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
