import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { FIELD_CHANGED_ELSEWHERE_MESSAGE } from '@/services/storage/syncErrorCatalog';

import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { hasSameNoteValue } from './dayTaskReplayGuard';
import { resolveOptionalBaseRevision } from './syncTaskContractPolicy';

const MERGEABLE_MOVEMENT_ARRAY_ROOTS = new Set(['discharges', 'transfers', 'cma']);
const MEDICAL_HANDOFF_SUMMARY_PATH = 'medicalHandoffNovedades';
const MEDICAL_HANDOFF_SPECIALTY_PREFIX = 'medicalHandoffBySpecialty.';
const MEDICAL_HANDOFF_ENTRIES_PATH_PATTERN = /^beds\.([^.]+)\.medicalHandoffEntries$/;

const normalizeChangedPaths = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    : [];

const pathsOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

const getPathRoot = (path: string): string => path.split('.')[0] || '';

const isMergeableMovementArrayOverlap = (left: string, right: string): boolean => {
  const leftRoot = getPathRoot(left);
  const rightRoot = getPathRoot(right);
  return (
    leftRoot === rightRoot &&
    MERGEABLE_MOVEMENT_ARRAY_ROOTS.has(leftRoot) &&
    pathsOverlap(left, right)
  );
};

const resolveMedicalHandoffEntryBedId = (path: string): string | undefined =>
  path.match(MEDICAL_HANDOFF_ENTRIES_PATH_PATTERN)?.[1];

const getMedicalHandoffEntryIds = (record: DailyRecord, bedId: string): Set<string> =>
  new Set(
    (Array.isArray(record.beds?.[bedId]?.medicalHandoffEntries)
      ? record.beds[bedId].medicalHandoffEntries
      : []
    )
      .map(entry => String(entry?.id || '').trim())
      .filter(Boolean)
  );

const hasIdOverlap = (left: Set<string>, right: Set<string>): boolean => {
  for (const id of left) {
    if (right.has(id)) return true;
  }
  return false;
};

const isMergeableMedicalHandoffEntriesOverlap = (
  left: string,
  right: string,
  remoteRecord: DailyRecord,
  localRecord: DailyRecord
): boolean => {
  const leftBedId = resolveMedicalHandoffEntryBedId(left);
  const rightBedId = resolveMedicalHandoffEntryBedId(right);
  if (!leftBedId || !rightBedId || leftBedId !== rightBedId) {
    return false;
  }

  const remoteIds = getMedicalHandoffEntryIds(remoteRecord, leftBedId);
  const localIds = getMedicalHandoffEntryIds(localRecord, leftBedId);
  return remoteIds.size > 0 && localIds.size > 0 && !hasIdOverlap(remoteIds, localIds);
};

const extractMedicalHandoffSpecialties = (paths: string[]): Set<string> =>
  new Set(
    paths
      .filter(path => path.startsWith(MEDICAL_HANDOFF_SPECIALTY_PREFIX))
      .map(path => path.slice(MEDICAL_HANDOFF_SPECIALTY_PREFIX.length).split('.')[0])
      .filter(Boolean)
  );

const hasSpecialtyOverlap = (left: Set<string>, right: Set<string>): boolean => {
  for (const specialty of left) {
    if (right.has(specialty)) return true;
  }
  return false;
};

const isMergeableMedicalHandoffSummaryOverlap = (
  left: string,
  right: string,
  leftPaths: string[],
  rightPaths: string[]
): boolean => {
  if (left !== MEDICAL_HANDOFF_SUMMARY_PATH || right !== MEDICAL_HANDOFF_SUMMARY_PATH) {
    return false;
  }
  const leftSpecialties = extractMedicalHandoffSpecialties(leftPaths);
  const rightSpecialties = extractMedicalHandoffSpecialties(rightPaths);
  return (
    leftSpecialties.size > 0 &&
    rightSpecialties.size > 0 &&
    !hasSpecialtyOverlap(leftSpecialties, rightSpecialties)
  );
};

const isAllowedOverlappingChangedPath = (
  leftPath: string,
  rightPath: string,
  leftPaths: string[],
  rightPaths: string[],
  remoteRecord: DailyRecord,
  localRecord: DailyRecord
): boolean =>
  isMergeableMovementArrayOverlap(leftPath, rightPath) ||
  isMergeableMedicalHandoffSummaryOverlap(leftPath, rightPath, leftPaths, rightPaths) ||
  isMergeableMedicalHandoffEntriesOverlap(leftPath, rightPath, remoteRecord, localRecord);

const hasBlockingOverlappingChangedPath = (
  left: string[],
  right: string[],
  remoteRecord: DailyRecord,
  localRecord: DailyRecord
): boolean =>
  left.some(leftPath =>
    right.some(
      rightPath =>
        pathsOverlap(leftPath, rightPath) &&
        !isAllowedOverlappingChangedPath(
          leftPath,
          rightPath,
          left,
          right,
          remoteRecord,
          localRecord
        )
    )
  );

export const hasRemoteAppliedMutation = (
  task: SyncTask,
  remoteMeta: Record<string, unknown> | undefined
): boolean => {
  const remoteMutationId =
    typeof remoteMeta?.lastMutationId === 'string' ? remoteMeta.lastMutationId : undefined;
  const localMutationId = task.syncContract?.mutationId;
  return Boolean(remoteMutationId && localMutationId && remoteMutationId === localMutationId);
};

/** A stored stamp as one comparable value: a Firestore timestamp to the nanosecond, or its text. */
const stampOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  const { seconds, nanoseconds } = (value ?? {}) as { seconds?: unknown; nanoseconds?: unknown };
  return typeof seconds === 'number' && typeof nanoseconds === 'number'
    ? `${seconds}.${nanoseconds}`
    : undefined;
};

/**
 * The task with the stored values as its base at the fields that an earlier edit folded into it
 * wrote, when the stored day is exactly the version that edit produced: its answer was lost and a
 * correction joined the task meanwhile. Credited by that edit's own mutation id (one of this task's
 * earlier ids), by the version it produced (every server write stamps `meta.updatedAt` with the
 * day's `lastUpdated`, so any later write, even one that keeps the meta, breaks the match) and by
 * the fields it changed. The correction then rebases on that first save under the replay's version
 * checks. Otherwise the task as it is: an equal text from another computer is not this task's.
 */
export const withOwnEarlierWriteAsBase = (
  task: SyncTask,
  remoteData: Record<string, unknown>
): SyncTask => {
  const meta = remoteData.meta as Record<string, unknown> | undefined;
  const contract = task.syncContract;
  const base = task.patchBaseValues;
  const earlierId = meta?.lastMutationId;
  const stamp = stampOf(remoteData.lastUpdated);
  if (
    !base ||
    typeof earlierId !== 'string' ||
    earlierId === contract?.mutationId ||
    !contract?.mutationIds?.includes(earlierId) ||
    !stamp ||
    stamp !== stampOf(meta?.updatedAt)
  )
    return task;
  const changedPaths = normalizeChangedPaths(contract.changedPaths);
  const written = normalizeChangedPaths(meta?.lastChangedPaths).filter(
    path => changedPaths.includes(path) && Object.hasOwn(base, path)
  );
  if (!written.length) return task;
  return {
    ...task,
    patchBaseValues: {
      ...base,
      ...Object.fromEntries(written.map(path => [path, getValueAtPath(remoteData, path)])),
    },
  };
};

export const assertNoSamePathRemoteMutation = (
  task: SyncTask,
  remoteData: Record<string, unknown>,
  remoteRecord: DailyRecord,
  localRecord: DailyRecord,
  appliedPaths: string[] = []
): void => {
  const remoteMeta = remoteData.meta as Record<string, unknown> | undefined;
  if (hasRemoteAppliedMutation(task, remoteMeta)) {
    return;
  }

  const remoteChangedPaths = normalizeChangedPaths(remoteMeta?.lastChangedPaths);
  const localChangedPaths = normalizeChangedPaths(task.syncContract?.changedPaths).filter(
    path => !appliedPaths.includes(path)
  );
  if (
    remoteChangedPaths.length > 0 &&
    localChangedPaths.length > 0 &&
    hasBlockingOverlappingChangedPath(
      remoteChangedPaths,
      localChangedPaths,
      remoteRecord,
      localRecord
    )
  ) {
    throw new ConcurrencyError(
      `Sync queue: remote mutation changed the same changed path for ${String(task.key || 'daily record')}.`
    );
  }
};

const withTrimmedText = (value: unknown): unknown => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(withTrimmedText);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, withTrimmedText(entry)])
  );
};

/**
 * Two stored values say the same: key order and a null or absent leaf do not count (the existing
 * base-vs-current tolerance), and neither do spaces around a text.
 */
const hasEquivalentReplayValue = (left: unknown, right: unknown): boolean =>
  hasSameNoteValue({ value: withTrimmedText(left) }, { value: withTrimmedText(right) });

/** Hydration pads staffing arrays: the stored or the hydrated value may carry the match. */
const remoteHolds = (
  remoteData: Record<string, unknown>,
  remoteRecord: DailyRecord,
  path: string,
  expected: unknown
): boolean =>
  hasEquivalentReplayValue(getValueAtPath(remoteData, path), expected) ||
  hasEquivalentReplayValue(getValueAtPath(remoteRecord, path), expected);

/**
 * Whether another computer wrote a field after this task's base: the stored day's last write named
 * it, came after the task's base revision and is none of the task's own edits (`queued`, the task
 * as queued: a part published or detached from it carries none of its earlier identifiers). Only
 * that last write's meta tells, and a write naming a whole bed or day (`beds.R1`, `*`) does not
 * say it wrote the field.
 */
const writtenElsewhereSinceBase = (
  queued: SyncTask,
  remoteData: Record<string, unknown>
): ((path: string) => boolean) => {
  const meta = remoteData.meta as Record<string, unknown> | undefined;
  const contract = queued.syncContract;
  const revision = resolveOptionalBaseRevision(meta?.revision);
  const writer = meta?.lastMutationId;
  if (
    contract?.baseRevision === undefined ||
    revision === undefined ||
    revision <= contract.baseRevision ||
    writer === contract.mutationId ||
    (typeof writer === 'string' && contract.mutationIds?.includes(writer))
  )
    return () => false;
  const named = normalizeChangedPaths(meta?.lastChangedPaths);
  return path => named.some(written => written === path || written.startsWith(`${path}.`));
};

/**
 * The captured fields another computer changed: the server holds neither the edit's base nor its
 * pending value, or it holds the base again after another computer wrote the field (an explicit
 * restore of the original value is a change too). `queued` is the task as queued, whose
 * identifiers tell this computer's own writes.
 */
export const pathsChangedElsewhere = (
  task: SyncTask,
  remoteData: Record<string, unknown>,
  remoteRecord: DailyRecord,
  localRecord: DailyRecord,
  queued: SyncTask
): string[] => {
  const base = task.patchBaseValues ?? {};
  const writtenElsewhere = writtenElsewhereSinceBase(queued, remoteData);
  return normalizeChangedPaths(task.syncContract?.changedPaths).filter(
    path =>
      Object.hasOwn(base, path) &&
      !remoteHolds(remoteData, remoteRecord, path, getValueAtPath(localRecord, path)) &&
      (writtenElsewhere(path) || !remoteHolds(remoteData, remoteRecord, path, base[path]))
  );
};

/**
 * Compare each captured field with its edit base even when a direct writer left no changed-path
 * metadata. A field conflicts when another computer changed it (`pathsChangedElsewhere`).
 * Returns the captured fields the server already holds as the pending value.
 */
export const assertUnchangedReplayPatchBase = (
  task: SyncTask,
  remoteData: Record<string, unknown>,
  remoteRecord: DailyRecord,
  localRecord: DailyRecord,
  queued: SyncTask
): string[] => {
  const base = task.patchBaseValues;
  if (!base) return [];
  const paths = normalizeChangedPaths(task.syncContract?.changedPaths);
  const captured = paths.filter(path => Object.hasOwn(base, path));
  // Defaults from hydration permit replay but do not prove the pending write was stored.
  const applied = captured.filter(path =>
    hasEquivalentReplayValue(getValueAtPath(remoteData, path), getValueAtPath(localRecord, path))
  );
  const remotePaths = pathsChangedElsewhere(task, remoteData, remoteRecord, localRecord, queued);
  if (hasBlockingOverlappingChangedPath(remotePaths, paths, remoteRecord, localRecord)) {
    throw new ConcurrencyError(FIELD_CHANGED_ELSEWHERE_MESSAGE);
  }
  return applied;
};
