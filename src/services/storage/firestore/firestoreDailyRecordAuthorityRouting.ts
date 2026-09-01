import { httpsCallable } from 'firebase/functions';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import {
  evaluateDailyRecordClinicalAuthority,
  recordClinicalAuthorityTelemetry,
  recordClinicalEpisodeIdCoverageTelemetry,
} from '@/services/repositories/dailyRecordClinicalAuthorityPolicy';
import { CLINICAL_CENSUS_EDITABLE_FIELDS } from '@/services/repositories/explicitLocalCensusPatchPolicy';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { firestoreWriteLogger } from '@/services/storage/storageLoggers';
import { resolveFirebaseUserRole } from '@/services/auth/authAccessResolution';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { shouldShadowDailyRecordAuthorityCallable } from '@/services/storage/firestore/dailyRecordAuthorityMode';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import {
  isServerClinicalWriteFenceActive,
  resolveEffectiveDailyRecordAuthorityMode,
} from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';
import {
  patchDailyRecordWithClinicalAuthorityCallable,
  saveDailyRecordWithClinicalAuthorityCallable,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import type { UserRole } from '@/types/authRoleTypes';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import type {
  ClinicalCribCreateRequest,
  IntentionalBedClearRequest,
} from '@/types/domain/intentionalBedClear';
import { isE2EDailyRecordAuthorityCallableForced } from '@/shared/runtime/e2eRuntime';

export interface DailyRecordPartialWriteOptions {
  syncContract?: SyncTaskContract;
  /** Enforces the base version inside the same transaction as the multi-field patch. */
  requireAtomicCas?: boolean;
  /** See PartialUpdateDailyRecordOptions.historyPolicy. Defaults to the safe `snapshot` behavior. */
  historyPolicy?: 'snapshot' | 'skip';
  /** Frozen Rayen run policy revalidated atomically with the legacy clinical write. */
  rayenClinicalWriteGuard?: RayenClinicalWriteGuard;
  /** Explicit, CAS-protected request to replace exactly one occupied bed with an empty bed. */
  intentionalBedClear?: IntentionalBedClearRequest;
  /** Explicit create-only command whose empty Rayen fields must not overwrite server authority. */
  clinicalCribCreate?: ClinicalCribCreateRequest;
}

export interface DailyRecordSaveWriteOptions {
  syncContract?: SyncTaskContract;
  /** Returns the exact submitted record only after the direct Firestore transaction commits. */
  returnCommittedRecord?: boolean;
  /**
   * Optional guard invoked inside the save transaction with the freshly-read remote document.
   * It may throw (e.g. DataRegressionError) to abort the commit atomically.
   */
  assertSafeOverwrite?: (remoteData: Record<string, unknown>) => void;
}

interface SpecialistMedicalHandoffCallablePayload {
  date: string;
  patch: Record<string, unknown>;
}

const CLINICAL_AUTHORITY_PATCH_FIELDS = new Set<string>(CLINICAL_CENSUS_EDITABLE_FIELDS);

const isClinicalAuthorityPatchPath = (path: string): boolean => {
  const [root, bedId, field, ...rest] = path.split('.');
  return (
    root === 'beds' &&
    Boolean(bedId) &&
    Boolean(field) &&
    rest.length === 0 &&
    CLINICAL_AUTHORITY_PATCH_FIELDS.has(field)
  );
};

const isClinicalAuthorityBedTypeOverridePath = (path: string): boolean => {
  const [root, bedId, ...rest] = path.split('.');
  return root === 'bedTypeOverrides' && Boolean(bedId) && rest.length === 0;
};

export const isClinicalAuthorityCallablePatchPath = (path: string): boolean =>
  isClinicalAuthorityPatchPath(path) || isClinicalAuthorityBedTypeOverridePath(path);

const isClinicalAuthorityDerivedPatchPath = (path: string): boolean => {
  if (path === 'dateTimestamp') {
    return true;
  }

  const [root, bedId, field, nestedField, ...rest] = path.split('.');
  if (root !== 'beds' || !bedId || !field) {
    return false;
  }

  // El acompañante FHIR llega APLANADO por prepareFirestorePartialData, con
  // sub-paths de profundidad arbitraria (p.ej. beds.R3.fhir_resource.meta.profile).
  // Reconocer sólo el primer nivel dejaba el resto clasificado como estructural,
  // convirtiendo cada patch clínico de una cama con paciente en una "mezcla"
  // rechazada — y degradando cada cambio de estado/especialidad a
  // auto-merge + guardado del registro completo.
  if (field === 'fhir_resource') {
    return true;
  }
  if (field === 'clinicalCrib' && nestedField === 'fhir_resource') {
    return true;
  }

  return field === 'clinicalEpisodeId' && nestedField === undefined && rest.length === 0;
};

const isDoctorSpecialistRole = (role: UserRole | null): role is 'doctor_specialist' =>
  role === 'doctor_specialist';

export const isClinicalAuthorityPatch = (patch: Record<string, unknown>): boolean => {
  const paths = Object.keys(patch);
  return paths.length > 0 && paths.every(isClinicalAuthorityPatchPath);
};

export const extractClinicalAuthorityPatch = (
  patch: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(patch).filter(([path]) => isClinicalAuthorityCallablePatchPath(path))
  );

export const shouldRouteClinicalAuthorityPatch = (patch: Record<string, unknown>): boolean => {
  const paths = Object.keys(patch);
  if (paths.length === 0 || !paths.some(isClinicalAuthorityPatchPath)) {
    return false;
  }

  return paths.every(
    path => isClinicalAuthorityCallablePatchPath(path) || isClinicalAuthorityDerivedPatchPath(path)
  );
};

/**
 * Firestore fences the complete patient tree once the server owns Rayen clinical fields.
 * Structural edits that share that tree must therefore use the preserving authority callable too.
 */
export const isDailyRecordBedTreePath = (path: string): boolean => {
  const [root] = path.split('.');
  return root === 'beds' || root === 'bedTypeOverrides';
};

export const touchesDailyRecordBedTree = (patch: Record<string, unknown>): boolean =>
  Object.keys(patch).some(isDailyRecordBedTreePath);

export const extractDailyRecordBedTreePatch = (
  patch: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(patch).filter(([path]) => isDailyRecordBedTreePath(path)));

export const shouldRouteSpecialistPatchViaCallable = async (): Promise<boolean> => {
  try {
    await defaultAuthRuntime.ready;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    if (!firebaseUser || firebaseUser.isAnonymous) {
      return false;
    }

    return isDoctorSpecialistRole(await resolveFirebaseUserRole(firebaseUser));
  } catch (error) {
    firestoreWriteLogger.warn('Specialist callable routing role check failed', { error });
    return false;
  }
};

export const updateSpecialistMedicalHandoffViaCallable = async (
  date: string,
  patch: Record<string, unknown>
): Promise<void> => {
  const functions = await defaultFunctionsRuntime.getFunctions();
  const callable = httpsCallable<
    SpecialistMedicalHandoffCallablePayload,
    { success: boolean; date: string; bedId: string }
  >(functions, 'updateSpecialistMedicalHandoff', { timeout: 45_000 });

  await callable({
    date,
    patch,
  });
};

export const shouldRouteDailyRecordSaveViaCallable = async (): Promise<boolean> => {
  const [mode, writeFenceActive] = await Promise.all([
    resolveEffectiveDailyRecordAuthorityMode(),
    isServerClinicalWriteFenceActive(defaultFirestoreServiceRuntime),
  ]);
  if (mode !== 'enforced' && !writeFenceActive) {
    return false;
  }

  try {
    await defaultAuthRuntime.ready;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    return Boolean(firebaseUser && !firebaseUser.isAnonymous);
  } catch (error) {
    firestoreWriteLogger.warn('Daily record authority callable routing check failed', { error });
    return false;
  }
};

export const resolveAuthenticatedDailyRecordAuthorityMode = async (): Promise<
  'shadow' | 'enforced' | null
> => {
  if (isE2EDailyRecordAuthorityCallableForced()) return 'enforced';
  const mode = await resolveEffectiveDailyRecordAuthorityMode();
  if (mode === 'client_only') return null;
  try {
    await defaultAuthRuntime.ready;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    return firebaseUser && !firebaseUser.isAnonymous ? mode : null;
  } catch (error) {
    firestoreWriteLogger.warn('Daily record authority callable routing check failed', { error });
    return null;
  }
};

/** Structural bed routing is owned by the schema-v2 server fence, never by the legacy flag. */
export const shouldRouteStructuralBedPatchViaCallable = async (): Promise<boolean> => {
  if (isE2EDailyRecordAuthorityCallableForced()) return true;
  if (!(await isServerClinicalWriteFenceActive(defaultFirestoreServiceRuntime))) return false;
  try {
    await defaultAuthRuntime.ready;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    return Boolean(firebaseUser && !firebaseUser.isAnonymous);
  } catch (error) {
    firestoreWriteLogger.warn('Rayen structural callable routing check failed', { error });
    return false;
  }
};

export const tryShadowDailyRecordSaveViaCallable = async (
  record: DailyRecord,
  expectedLastUpdated?: string,
  syncContract?: SyncTaskContract
): Promise<void> => {
  if (!shouldShadowDailyRecordAuthorityCallable()) {
    return;
  }

  try {
    await defaultAuthRuntime.ready;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    if (!firebaseUser || firebaseUser.isAnonymous) {
      return;
    }

    await saveDailyRecordWithClinicalAuthorityCallable({
      date: record.date,
      record,
      expectedLastUpdated,
      mode: 'shadow',
      origin: 'shadow_save',
      syncContract,
      dryRun: true,
    });
  } catch (error) {
    firestoreWriteLogger.warn('Daily record authority shadow validation failed', {
      date: record.date,
      error,
    });
  }
};

export const tryShadowDailyRecordPatchViaCallable = async (
  date: string,
  patch: Record<string, unknown>,
  expectedLastUpdated?: string,
  syncContract?: SyncTaskContract
): Promise<void> => {
  if (!shouldShadowDailyRecordAuthorityCallable()) {
    return;
  }

  try {
    await defaultAuthRuntime.ready;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    if (!firebaseUser || firebaseUser.isAnonymous) {
      return;
    }

    await patchDailyRecordWithClinicalAuthorityCallable({
      date,
      patch,
      expectedLastUpdated,
      mode: 'shadow',
      origin: 'shadow_partial_update',
      syncContract,
      dryRun: true,
    });
  } catch (error) {
    firestoreWriteLogger.warn('Daily record authority shadow patch validation failed', {
      date,
      error,
    });
  }
};

export const assertDailyRecordClinicalAuthority = (record: DailyRecord): void => {
  const authority = evaluateDailyRecordClinicalAuthority(record, {
    date: record.date,
    phase: 'persistence',
  });
  recordClinicalAuthorityTelemetry(authority);
  recordClinicalEpisodeIdCoverageTelemetry(record, {
    date: record.date,
    phase: 'persistence',
  });

  if (authority.status === 'blocked') {
    throw new ConcurrencyError(
      `Daily record clinical authority blocked write for ${record.date}: ` +
        authority.violations.map(violation => violation.message).join(' ')
    );
  }
};
