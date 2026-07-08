import type { ConflictResolutionTraceContext } from '@/services/repositories/conflictResolutionTrace';

const resolveItemId = (item: unknown): string => {
  if (item && typeof item === 'object' && 'id' in item) {
    return String((item as { id?: string | number }).id ?? JSON.stringify(item));
  }
  return JSON.stringify(item);
};

const isDeletedMovement = (item: unknown): boolean =>
  Boolean(
    item &&
    typeof item === 'object' &&
    String((item as { deletedAt?: unknown }).deletedAt || '').trim()
  );

const chooseMovementByPolicy = <T>(remote: T, local: T, preferLocal: boolean): T => {
  const remoteDeleted = isDeletedMovement(remote);
  const localDeleted = isDeletedMovement(local);

  if (remoteDeleted && !localDeleted) return remote;
  if (localDeleted && !remoteDeleted) return local;
  return preferLocal ? local : remote;
};

const mergeMovementUnionById = <T>(
  remote: T[] = [],
  local: T[] = [],
  preferLocal: boolean
): T[] => {
  const remoteById = new Map<string, T>();
  const localById = new Map<string, T>();
  const seen = new Set<string>();
  const sequence: string[] = [];

  const remember = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      sequence.push(id);
    }
  };

  remote.forEach(item => {
    const id = resolveItemId(item);
    remoteById.set(id, item);
    remember(id);
  });
  local.forEach(item => {
    const id = resolveItemId(item);
    localById.set(id, item);
    remember(id);
  });

  return sequence
    .map(id => {
      const remoteItem = remoteById.get(id);
      const localItem = localById.get(id);
      if (remoteItem && localItem) {
        return chooseMovementByPolicy(remoteItem, localItem, preferLocal);
      }
      return (localItem ?? remoteItem) as T | undefined;
    })
    .filter((item): item is T => item !== undefined);
};

export const mergeMovementArrayById = <T>(
  remote: T[] = [],
  local: T[] = [],
  preferLocal: boolean,
  traceContext?: ConflictResolutionTraceContext,
  path = ''
): T[] => {
  traceContext?.add({
    path,
    strategy: 'merge_array_by_id',
    winner: 'merged',
    reason: preferLocal
      ? 'local_changed_path_preserve_remote_tombstones'
      : 'remote_snapshot_priority_preserve_local_movements',
  });
  return mergeMovementUnionById(remote, local, preferLocal);
};
