import type { ConflictResolutionTraceContext } from '@/services/repositories/conflictResolutionTrace';
import { hasSameComparableValue } from '@/services/repositories/conflictResolutionUtils';

/** A movement's identity in its list: its id, or the whole item when it has none. */
export const resolveItemId = (item: unknown): string => {
  if (item && typeof item === 'object' && 'id' in item) {
    return String((item as { id?: string | number }).id ?? JSON.stringify(item));
  }
  return JSON.stringify(item);
};

const indexMovementsByExplicitId = <T>(
  raw: unknown
): { byId: Map<string, T>; order: string[] } | null => {
  const items = raw == null ? [] : Array.isArray(raw) ? (raw as T[]) : null;
  if (!items) return null;
  const byId = new Map<string, T>();
  const order: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !('id' in item)) {
      return null;
    }
    const rawId = (item as { id?: unknown }).id;
    const id =
      typeof rawId === 'string'
        ? rawId.trim()
        : typeof rawId === 'number' && Number.isFinite(rawId)
          ? String(rawId)
          : '';
    if (!id || byId.has(id)) return null;
    byId.set(id, item);
    order.push(id);
  }
  return { byId, order };
};

/**
 * Three-way per-item reconciliation for movement lists (`discharges`, `transfers`, `cma`) under
 * SAVE-02. Edits, additions, or removals on distinct movement IDs combine cleanly without losing
 * either writer's work; any conflicting edit to the same movement ID (or any entry lacking a
 * unique explicit ID) returns `null` so the caller fails closed into conflict review.
 */
export const reconcileMovementListThreeWay = <T = Record<string, unknown>>(
  baseRaw: unknown,
  storedRaw: unknown,
  incomingRaw: unknown
): T[] | null => {
  const base = indexMovementsByExplicitId<T>(baseRaw);
  const stored = indexMovementsByExplicitId<T>(storedRaw);
  const incoming = indexMovementsByExplicitId<T>(incomingRaw);
  if (!base || !stored || !incoming) return null;

  const unionOrder: string[] = [...stored.order];
  for (const id of incoming.order) {
    if (!stored.byId.has(id)) unionOrder.push(id);
  }

  const merged: T[] = [];
  for (const id of unionOrder) {
    const baseItem = base.byId.get(id);
    const storedItem = stored.byId.get(id);
    const incomingItem = incoming.byId.get(id);
    const incomingChanged = !hasSameComparableValue(incomingItem, baseItem);
    const storedChanged = !hasSameComparableValue(storedItem, baseItem);

    if (!incomingChanged) {
      if (storedItem !== undefined) merged.push(storedItem);
      continue;
    }
    if (!storedChanged) {
      if (incomingItem !== undefined) merged.push(incomingItem);
      continue;
    }
    if (hasSameComparableValue(storedItem, incomingItem)) {
      if (storedItem !== undefined) merged.push(storedItem);
      continue;
    }
    return null;
  }

  return merged;
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
