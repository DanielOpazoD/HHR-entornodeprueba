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
import {
  shouldShadowDailyRecordAuthorityCallable,
  shouldUseDailyRecordAuthorityCallable,
} from '@/services/storage/firestore/dailyRecordAuthorityMode';
import {
  patchDailyRecordWithClinicalAuthorityCallable,
  saveDailyRecordWithClinicalAuthorityCallable,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import type { UserRole } from '@/types/authRoleTypes';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';

export interface DailyRecordPartialWriteOptions {
  syncContract?: SyncTaskContract;
  /** Enforces the base version inside the same transaction as the multi-field patch. */
  requireAtomicCas?: boolean;
  /** See PartialUpdateDailyRecordOptions.historyPolicy. Defaults to the safe `snapshot` behavior. */
  historyPolicy?: 'snapshot' | 'skip';
}

export interface DailyRecordSaveWriteOptions {
  syncContract?: SyncTaskContract;
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

const isClinicalAuthorityCallablePatchPath = (path: string): boolean =>
  isClinicalAuthorityPatchPath(path) || isClinicalAuthorityBedTypeOverridePath(path);

const isClinicalAuthorityDerivedPatchPath = (path: string): boolean => {
  if (path === 'dateTimestamp') {
    return true;
  }

  const [root, bedId, field, nestedField, ...rest] = path.split('.');
  if (root !== 'beds' || !bedId || rest.length > 0) {
    return false;
  }

  return (
    field === 'fhir_resource' ||
    field === 'clinicalEpisodeId' ||
    (field === 'clinicalCrib' && nestedField === 'fhir_resource')
  );
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
  >(functions, 'updateSpecialistMedicalHandoff');

  await callable({
    date,
    patch,
  });
};

export const shouldRouteDailyRecordSaveViaCallable = async (): Promise<boolean> => {
  if (!shouldUseDailyRecordAuthorityCallable()) {
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
