import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { assertDailyRecordPartialUpdateAccepted } from '@/services/repositories/dailyRecordRepositoryWriteOutcome';
import type { SpecialtyIntent } from '@/types/domain/specialtyDecision';
import type { DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { loadCIE10Database } from '@/services/terminology/cie10SpanishDatabase';
import pilotConfig from '../../../config/specialty-jev-pilot.hhr-pruebas.json';

const REGION = 'southamerica-east1';

export class JevSuggestionUnavailableError extends Error {}
export class JevSuggestionPendingError extends Error {}

export const describeSpecialtySetupError = (error: unknown): string => {
  if (error instanceof JevSuggestionUnavailableError) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'permission-denied' || code === 'firestore/permission-denied' ||
      code === 'functions/permission-denied') {
    return 'Sin permiso para leer el catálogo de especialidades.';
  }
  if (code === 'functions/not-found') {
    return 'El servidor de especialidades aún no está actualizado en este entorno.';
  }
  if (code === 'functions/failed-precondition') {
    return 'El piloto de especialidades no está activado en el servidor.';
  }
  if (code === 'unavailable' || code === 'firestore/unavailable' ||
      code === 'functions/unavailable') {
    return 'No se pudo conectar con el catálogo. Reintenta cuando vuelva la conexión.';
  }
  return 'No se pudo leer el catálogo de especialidades. Comprueba la conexión y vuelve a abrir el panel.';
};

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

export const resolveSpecialtyJevLabel = (
  labels: Record<string, string>, code: string
): string | null => {
  const canonical = labels[code];
  if (canonical) return canonical;
  return /^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/.test(code) ? `CIE-10 ${code}` : null;
};

export interface SpecialtyCatalogRule {
  id: string;
  kind: 'assign' | 'review';
  cie10Code: string;
  specialty?: string;
  scope: 'all';
  revision: number;
}

export interface SpecialtyRoundSetup {
  labels: Record<string, string>;
  policy: {
    revision: number;
    autoEnabled: boolean;
    memoryEnabled: boolean;
    aiMode: 'off' | 'consultative';
    rules: SpecialtyCatalogRule[];
  };
}

const loadSpecialtyPolicy = async (): Promise<SpecialtyRoundSetup['policy']> => {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions(REGION);
  const callable = httpsCallable<void, SpecialtyRoundSetup['policy']>(
    functions, 'readSpecialtyPolicy', { timeout: 30_000 });
  const { data } = await callable();
  if (!Number.isInteger(data?.revision) ||
      !['off', 'consultative'].includes(data.aiMode) || !Array.isArray(data.rules)) {
    throw new JevSuggestionUnavailableError('Catálogo inválido.');
  }
  return data;
};

/** Read-only policy and complete CIE-10 catalog; the server checks the same packaged labels. */
export const loadSpecialtyRoundSetup = async (): Promise<SpecialtyRoundSetup> => {
  await defaultFirestoreServiceRuntime.ready;
  if (defaultFirestoreServiceRuntime.getDb().app.options.projectId !== 'hhr-pruebas') {
    throw new JevSuggestionUnavailableError('La consulta Jev sólo está habilitada en hhr-pruebas.');
  }
  const policy = await loadSpecialtyPolicy();
  const entries = await loadCIE10Database();
  return {
    labels: Object.fromEntries(entries.map(entry => [entry.code, entry.description])),
    policy,
  };
};

export const loadSpecialtyJevCatalog = async (): Promise<Record<string, string>> => {
  const setup = await loadSpecialtyRoundSetup();
  if (setup.policy.aiMode !== 'consultative') {
    throw new JevSuggestionUnavailableError('Jev no está disponible.');
  }
  return setup.labels;
};

export const saveSpecialtyRules = async (
  policy: SpecialtyRoundSetup['policy'], rules: SpecialtyCatalogRule[], autoEnabled: boolean,
  activateJev = false
): Promise<void> => {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions(REGION);
  const callable = httpsCallable(functions, 'configureSpecialtyPolicy', { timeout: 30_000 });
  await callable({ confirmed: true, expectedRevision: policy.revision, rules,
    autoEnabled, memoryEnabled: policy.memoryEnabled,
    aiMode: activateJev ? 'consultative' : policy.aiMode,
    ...(activateJev ? { aiMonthlyLimit: pilotConfig.aiMonthlyLimit,
      aiRubrics: pilotConfig.aiRubrics } : {}) });
};

/** Read-only preflight. The provider receives only this approved code/label after confirmation. */
export const prepareSpecialtyJevConsultation = async (
  cie10Code: string
): Promise<JevConsultationPreparation> => {
  const labels = await loadSpecialtyJevCatalog();
  const code = cie10Code.trim().toUpperCase().replace(/\s+/g, '');
  const canonicalLabel = resolveSpecialtyJevLabel(labels, code);
  if (!/^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/.test(code) || !canonicalLabel) {
    throw new JevSuggestionUnavailableError('El diagnóstico no está habilitado en el catálogo Jev.');
  }
  return { code, canonicalLabel };
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
  await writeSpecialtyIntent(scope, value, intent);
};

export const assignSpecialtyManually = async (
  scope: SpecialtyTarget,
  value: string,
  expectedDecisionId: string | null
): Promise<void> => {
  const intent: SpecialtyIntent = { kind: 'manual', ...scope, value, expectedDecisionId };
  await writeSpecialtyIntent(scope, value, intent);
};

const writeSpecialtyIntent = async (
  scope: SpecialtyTarget,
  value: string,
  intent: SpecialtyIntent
): Promise<void> => {
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
  const { revision: expectedRevision } = await loadSpecialtyPolicy();
  const functions = await defaultFunctionsRuntime.getRegionalFunctions(REGION);
  const callable = httpsCallable<SpecialtyTarget & {
    specialty: string; expectedCie10Code: string; expectedDecisionId: string;
    expectedRevision: number; confirmed: true;
  }, { status: string }>(functions, 'publishSpecialtyMemory', { timeout: 30_000 });
  await callable({ ...scope, specialty, expectedCie10Code, expectedDecisionId,
    expectedRevision, confirmed: true });
};
