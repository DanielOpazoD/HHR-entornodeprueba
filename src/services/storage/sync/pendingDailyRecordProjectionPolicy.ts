import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecordPendingProjectionRebase } from '@/services/storage/sync/syncQueuePorts';
import { hasSamePatientEpisodeIdentity } from '@/application/patient-flow/patientEpisodeIdentityPolicy';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { applyPatches } from '@/utils/patchUtils';

/**
 * A day's pending truth is its local projection plus the unresolved write that holds it. A write
 * computed from another base must land on top of that projection: its changed paths take its
 * values and every other pending path keeps the value another accepted write gave it.
 */

// Same mergeable roots as the publish-time same-path check (firestoreSyncConflictPolicy).
const MOVEMENT_LOG_PATHS = new Set(['discharges', 'transfers', 'cma']);
const BED_SLOT_FIELDS = new Set(['isBlocked', 'blockedReason']);
const BED_FIELD_PATH = /^beds\.([^.]+)\.([^.]+)/;

export const readRecordPath = (source: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);

/** Key order and absent-vs-undefined do not change a value. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry)])
  );
};

export const isSameRecordValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const pathsOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

/** A legacy or whole-record write does not say which paths it owns. */
export const isOpaqueChangedPaths = (paths: readonly string[]): boolean =>
  paths.length === 0 || paths.includes('*');

export const carriesProjectionValuesAt = (
  source: DailyRecord,
  projection: DailyRecord,
  paths: readonly string[]
): boolean =>
  paths.every(path =>
    isSameRecordValue(readRecordPath(source, path), readRecordPath(projection, path))
  );

const hasIdentity = (patient: PatientData | undefined): boolean =>
  Boolean(
    patient &&
    [patient.clinicalEpisodeId, patient.rut, patient.patientName].some(value =>
      String(value ?? '').trim()
    )
  );

const documentOf = (patient: PatientData): string =>
  `${patient.documentType ?? 'RUT'}:${String(patient.rut ?? '')
    .trim()
    .toUpperCase()}`;

/** Both slots empty, or the same patient and episode. A RUT never matches a passport. */
const hasSameOccupant = (
  left: PatientData | undefined,
  right: PatientData | undefined
): boolean => {
  if (!hasIdentity(left) && !hasIdentity(right)) return true;
  return Boolean(
    left &&
    right &&
    hasIdentity(left) &&
    hasIdentity(right) &&
    hasSamePatientEpisodeIdentity(left, right) &&
    documentOf(left) === documentOf(right)
  );
};

/** A field edit belongs to the occupant it was written for; a whole-bed value compares by value. */
export const assertSameOccupantAtPath = (
  path: string,
  writtenFor: DailyRecord,
  projection: DailyRecord
): void => {
  const match = BED_FIELD_PATH.exec(path);
  if (!match || BED_SLOT_FIELDS.has(match[2])) return;
  const [, bedId, field] = match;
  const writtenBed = writtenFor.beds?.[bedId];
  const projectedBed = projection.beds?.[bedId];
  if (
    hasSameOccupant(writtenBed, projectedBed) &&
    (field !== 'clinicalCrib' ||
      hasSameOccupant(writtenBed?.clinicalCrib, projectedBed?.clinicalCrib))
  ) {
    return;
  }
  throw new ConcurrencyError(
    'La cama o la cuna cambió de paciente en otra pestaña. Recargue el censo antes de continuar.'
  );
};

/** Movement logs are bitácoras by id: both writes keep their entries. */
export const mergeMovementLogValue = (
  path: string,
  value: unknown,
  projected: unknown
): unknown[] | null =>
  MOVEMENT_LOG_PATHS.has(path) && Array.isArray(value) && Array.isArray(projected)
    ? mergeMovementArrayById(projected, value, true)
    : null;

/**
 * Default for a record queued without its base (a retry or an auto-merge of a write that already
 * reached the outbox): its changed paths are that write's latest intent.
 */
export const buildRecordOverlayRebase = (
  record: DailyRecord,
  changedPaths: readonly string[] | undefined
): DailyRecordPendingProjectionRebase | undefined => {
  const ownPaths = (changedPaths ?? []).filter(Boolean);
  if (isOpaqueChangedPaths(ownPaths)) return undefined;
  return ({ projection, pendingChangedPaths }) => {
    const otherPendingPaths = pendingChangedPaths.filter(
      pendingPath => !ownPaths.some(ownPath => pathsOverlap(ownPath, pendingPath))
    );
    if (
      record.lastUpdated === projection.lastUpdated ||
      (!isOpaqueChangedPaths(pendingChangedPaths) &&
        carriesProjectionValuesAt(record, projection, otherPendingPaths))
    ) {
      return null;
    }
    const patch: DailyRecordPatch = {};
    ownPaths.forEach(path => {
      assertSameOccupantAtPath(path, record, projection);
      const value = readRecordPath(record, path);
      patch[path] = mergeMovementLogValue(path, value, readRecordPath(projection, path)) ?? value;
    });
    return { ...applyPatches(projection, patch), lastUpdated: record.lastUpdated };
  };
};
