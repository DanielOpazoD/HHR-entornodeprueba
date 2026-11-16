import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  evaluateDailyRecordClinicalAuthority,
  recordClinicalAuthorityTelemetry,
  recordClinicalEpisodeIdCoverageTelemetry,
} from '@/services/repositories/dailyRecordClinicalAuthorityPolicy';
import {
  isClinicalAuthorityBedScalarPath,
  isClinicalAuthorityCallablePatchPath,
} from '@/services/storage/dailyRecordAuthorityContract';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { firestoreWriteLogger } from '@/services/storage/storageLoggers';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import {
  isServerClinicalWriteFenceActive,
  resolveEffectiveDailyRecordAuthorityMode,
} from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import type {
  ClinicalCribCreateRequest,
  IntentionalBedClearRequest,
} from '@/types/domain/intentionalBedClear';
import type { SpecialtyManualIntent } from '@/types/domain/specialtyDecision';
import { isE2EDailyRecordAuthorityCallableForced } from '@/shared/runtime/e2eRuntime';

export interface DailyRecordPartialWriteOptions {
  syncContract?: SyncTaskContract;
  /**
   * The day this writer edited. A plain day field then commits over another writer's newer
   * version when that writer left this patch's fields alone; without it any newer version refuses.
   */
  baseRecord?: DailyRecord;
  /** Enforces the base version inside the same transaction as the multi-field patch. */
  requireAtomicCas?: boolean;
  /**
   * The writer's session check, from the queue's resend or the direct send: it runs before each
   * attempt, the history copy and each retry, and inside the transaction right before it writes.
   * A throw stops the write.
   */
  assertCanPublish?: () => void;
  /**
   * With requireAtomicCas, staffing or plain day fields, returns the record that transaction
   * committed. Set only for writes that need a confirmed record; a receipt sends the caller into
   * its confirm-and-adopt path.
   */
  returnCommittedRecord?: boolean;
  /** See PartialUpdateDailyRecordOptions.historyPolicy. Without it, copies follow the hourly cadence. */
  historyPolicy?: 'snapshot' | 'skip';
  /** Frozen Rayen run policy revalidated atomically with the legacy clinical write. */
  /** Explicit, CAS-protected request to replace exactly one occupied bed with an empty bed. */
  intentionalBedClear?: IntentionalBedClearRequest;
  /** Explicit create-only command whose empty Rayen fields must not overwrite server authority. */
  clinicalCribCreate?: ClinicalCribCreateRequest;
  specialtyIntent?: SpecialtyManualIntent;
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
  /** Intent reported to the clinical authority; `backup_restore` recreates a day with its clinical fields. */
  origin?: 'direct_save' | 'backup_restore';
  /**
   * 'snapshot' always copies the live document to `history` before overwriting it, as restores
   * need. Otherwise copies follow the hourly cadence (historySnapshotCadence).
   */
  historyPolicy?: 'snapshot';
  /** The writer's session check: before each attempt and retry, and inside the transaction. */
  assertCanPublish?: () => void;
}

// Clasificación de rutas: delega en el CONTRATO ÚNICO de autoridad (la
// misma definición que consumen el splitter del dispatch, el aplanador y las
// functions). Los alias locales conservan los nombres históricos.
const isClinicalAuthorityPatchPath = isClinicalAuthorityBedScalarPath;

export { isClinicalAuthorityCallablePatchPath };

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

export const STAFFING_PATH =
  /^(nurses|nurseName|nursesDayShift|nursesNightShift|tensDayShift|tensNightShift|staffingDetailsV1)(\.|$)/;

/**
 * A day field outside the bed tree and staffing. A patch of only these fields, without
 * requireAtomicCas, commits through the per-field versioned transaction of updateRecordPartial.
 */
export const isPlainDayFieldPath = (path: string): boolean =>
  !isDailyRecordBedTreePath(path) && !STAFFING_PATH.test(path);

export const touchesDailyRecordBedTree = (patch: Record<string, unknown>): boolean =>
  Object.keys(patch).some(isDailyRecordBedTreePath);

export const extractDailyRecordBedTreePatch = (
  patch: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(patch).filter(([path]) => isDailyRecordBedTreePath(path)));

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

/**
 * `null`: no enforced mode or no signed-in user. `unavailable`: the session could not be checked.
 * Routing is advisory either way; only `'enforced'` selects the callable, and the server rules
 * still reject a fenced direct write.
 */
export const resolveAuthenticatedDailyRecordAuthorityMode = async (): Promise<
  'enforced' | null | { kind: 'unavailable'; error: unknown }
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
    return { kind: 'unavailable', error };
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
