import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import {
  getValueAtPath,
  hasSameValuesAtPaths,
  normalizeChangedPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { NOTE_FIELDS, hasSameNoteValue } from './dayTaskReplayGuard';
import { resolveRecordBaseRevision, UNKNOWN_SERVER_VERSION } from './syncTaskContractPolicy';

const CONTEXT_FIELDS = [
  'patientName',
  'rut',
  'documentType',
  'clinicalEpisodeId',
  'admissionDate',
  'admissionTime',
  'firstSeenDate',
  ...NOTE_FIELDS,
] as const;

/** The original day's occupants and notes, including the newborn independently of the mother. */
export const capturePatchBaseContext = (record: DailyRecord): Record<string, unknown> =>
  Object.fromEntries(
    ['medicalHandoffNovedades', 'medicalHandoffBySpecialty']
      .map(path => [path, getValueAtPath(record, path)])
      .concat(
        Object.keys(record.beds ?? {}).flatMap(bedId =>
          [`beds.${bedId}`, `beds.${bedId}.clinicalCrib`].flatMap(slot => {
            const fields = CONTEXT_FIELDS.map(field => {
              const path = `${slot}.${field}`;
              return [path, getValueAtPath(record, path)];
            });
            // Server hydration can add empty bed rows. They have no occupant or note to own.
            const hasContext = CONTEXT_FIELDS.some(field => {
              if (field === 'documentType') return false;
              const value = getValueAtPath(record, `${slot}.${field}`);
              return value != null && value !== '' && (!Array.isArray(value) || value.length > 0);
            });
            return hasContext ? fields : [];
          })
        )
      )
  );

/** Keep the narrow automatic lane out of identity changes, movements and handoff writes. */
const isOrdinaryClinicalPatchPath = (path: string): boolean =>
  /^beds\.[^.]+\.(?:clinicalCrib\.)?(?:pathology|status)$/.test(path);

const hasOriginalPatchContext = (
  context: Record<string, unknown> | undefined,
  local: DailyRecord,
  remote: DailyRecord
): boolean =>
  Boolean(
    context &&
    hasSameNoteValue(context, capturePatchBaseContext(local)) &&
    hasSameNoteValue(context, capturePatchBaseContext(remote))
  );

/** Original values alone cannot prove that a field still belongs to the same patient episode. */
export const hasUnchangedPatchBase = (
  task: SyncTask,
  remote: DailyRecord,
  local: DailyRecord
): boolean => {
  const paths = normalizeChangedPaths(task.syncContract?.changedPaths);
  const base = task.patchBaseValues;
  const expectedTime = Date.parse(task.syncContract?.expectedVersion ?? '');
  const remoteTime = Date.parse(remote.lastUpdated ?? '');
  return Boolean(
    !task.nursingHandoffRecovery &&
    task.syncContract?.expectedVersion !== UNKNOWN_SERVER_VERSION &&
    Number.isFinite(expectedTime) &&
    Number.isFinite(remoteTime) &&
    remoteTime >= expectedTime &&
    (task.syncContract?.baseRevision === undefined ||
      (resolveRecordBaseRevision(remote) ?? -1) >= task.syncContract.baseRevision) &&
    base &&
    paths.length &&
    paths.every(path => {
      if (!isOrdinaryClinicalPatchPath(path) || !Object.hasOwn(base, path)) return false;
      const slot = path.slice(0, path.lastIndexOf('.'));
      return ['rut', 'clinicalEpisodeId'].every(field => {
        const value = getValueAtPath(local, `${slot}.${field}`);
        return typeof value === 'string' && value.trim().length > 0;
      });
    }) &&
    hasOriginalPatchContext(task.patchBaseContext, local, remote) &&
    hasSameValuesAtPaths(remote, Object.fromEntries(paths.map(path => [path, base?.[path]])))
  );
};
