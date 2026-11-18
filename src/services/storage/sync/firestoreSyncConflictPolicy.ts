import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { FIELD_CHANGED_ELSEWHERE_MESSAGE } from '@/services/storage/syncErrorCatalog';

import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { hasSameNoteValue } from './dayTaskReplayGuard';
import { resolveRecordBaseRevision } from './syncTaskContractPolicy';
import {
  isLastWrittenBy,
  isWrittenElsewhereSince,
  storedFieldWrites,
} from './fieldWriteAttribution';

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

/**
 * The task with the stored values as its base at the fields an earlier edit folded into it wrote:
 * its answer was lost and a correction joined the task meanwhile. A field counts when the newest
 * write touching it is that edit's own (one of this task's earlier identifiers), credible and left
 * the value it stored (`isLastWrittenBy`). Another computer's save of another field leaves the
 * attribution in place; a writer that leaves the record of field writes as it was ends it. The
 * correction then rebases on that first save under the replay's version checks. Otherwise the
 * task as it is: an equal text from another computer is not this task's.
 */
export const withOwnEarlierWriteAsBase = (
  task: SyncTask,
  remoteData: Record<string, unknown>
): SyncTask => {
  const contract = task.syncContract;
  const base = task.patchBaseValues;
  const earlier = (contract?.mutationIds ?? []).filter(id => id !== contract?.mutationId);
  if (!base || !earlier.length) return task;
  const writes = storedFieldWrites(remoteData);
  const written = normalizeChangedPaths(contract?.changedPaths).filter(
    path => Object.hasOwn(base, path) && isLastWrittenBy(writes, path, earlier, remoteData)
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
 * Whether another computer wrote a field after this computer saw it (`isWrittenElsewhereSince`):
 * after the revision its base was read at, or, for an edit queued without it, the newest revision
 * the task knows. `queued` is the task as queued: its payload is the day as shown at its last edit,
 * and a part published or detached from it carries none of its earlier identifiers. A write the
 * person had already read is the value they edited over, not a change. A day with no known
 * revision counts from 0, as the server does.
 */
const writtenElsewhereSinceBase = (
  queued: SyncTask,
  remoteData: Record<string, unknown>
): ((path: string) => boolean) => {
  const contract = queued.syncContract;
  const ids = [contract?.mutationId, ...(contract?.mutationIds ?? [])].filter(
    (id): id is string => typeof id === 'string'
  );
  const seen = Math.max(
    contract?.baseRevision ?? 0,
    resolveRecordBaseRevision(queued.payload as DailyRecord) ?? 0
  );
  const writes = storedFieldWrites(remoteData);
  return path =>
    isWrittenElsewhereSince(
      writes,
      path,
      queued.patchBaseRevisions?.[path] ?? seen,
      ids,
      contract?.clientId
    );
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
