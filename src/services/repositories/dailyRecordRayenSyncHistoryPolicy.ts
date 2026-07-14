import { MAX_RAYEN_SYNC_HISTORY, type RayenSyncEvent } from '@/types/domain/rayenSync';

/** Merge append-only audit evidence against the freshest record without losing concurrent runs. */
export const mergeRayenSyncHistory = (
  current: RayenSyncEvent[] | null | undefined,
  incoming: RayenSyncEvent[] | null | undefined
): RayenSyncEvent[] => {
  const byId = new Map((current ?? []).map(event => [event.id, event]));
  for (const event of incoming ?? []) byId.set(event.id, event);
  return Array.from(byId.values())
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, MAX_RAYEN_SYNC_HISTORY);
};
