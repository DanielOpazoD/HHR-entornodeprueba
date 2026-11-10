import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';

const text = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim() : 'desconocido';

/** Local diagnosis only. Never look up a bed: it may now belong to another episode. */
export const buildSyncQueueFailureContext = (task: SyncTask) => {
  const common = {
    clinicalDate: task.key || 'desconocido',
    action: task.type,
    fieldLabel: task.syncContract?.changedPaths?.join(', ') || 'desconocido',
  };
  const context = (slot: string, source: unknown) => ({
    ...common,
    bedLabel: slot,
    patientName: text(getValueAtPath(source, 'patientName')),
    clinicalEpisodeId: text(getValueAtPath(source, 'clinicalEpisodeId')),
  });
  if (task.type === 'UPDATE_SPECIALIST_HANDOFF') {
    const targets = getValueAtPath(task.payload, 'expectedOccupants');
    if (Array.isArray(targets) && targets.length) {
      return {
        localSyncFailure: targets.map(target =>
          context(
            `${text(getValueAtPath(target, 'bedId'))}.${text(getValueAtPath(target, 'target'))}`,
            target
          )
        ),
      };
    }
  }
  if (task.type === 'UPDATE_PATIENT') {
    return { localSyncFailure: [context('desconocido', task.payload)] };
  }
  if (task.type === 'UPDATE_DAILY_RECORD') {
    const slots = [
      ...new Set(
        (task.syncContract?.changedPaths || []).flatMap(path => {
          const match = /^(beds\.[^.]+(?:\.clinicalCrib)?)(?:\.|$)/.exec(path);
          return match?.[1] ? [match[1]] : [];
        })
      ),
    ];
    if (slots.length) {
      return {
        localSyncFailure: slots.map(slot => {
          // Presence of original context forbids borrowing identity from a newer projection.
          const source = task.patchBaseContext
            ? Object.fromEntries(
                ['patientName', 'clinicalEpisodeId'].map(field => [
                  field,
                  task.patchBaseContext?.[`${slot}.${field}`],
                ])
              )
            : getValueAtPath(task.payload, slot);
          return context(slot, source);
        }),
      };
    }
    // A day-level write has no single patient. Keep captured keys without choosing an occupant.
    if (task.syncContract?.clinicalEpisodeKeys?.length) {
      return {
        localSyncFailure: task.syncContract.clinicalEpisodeKeys.map(clinicalEpisodeId => ({
          ...context('desconocido', undefined),
          clinicalEpisodeId,
        })),
      };
    }
  }
  return { localSyncFailure: [context('desconocido', undefined)] };
};
