import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { applyPatches } from '@/utils/patchUtils';
import {
  PENDING_LOCAL_CENSUS_PATCH_FIELDS,
  isSameEpisodeForExplicitCensusPatch,
} from '@/services/repositories/explicitLocalCensusPatchPolicy';
import { buildSyncMutationIdentity } from '@/services/storage/sync/syncMutationIdentity';

export const PENDING_DAILY_RECORD_PATCH_STORAGE_KEY = 'hhr_pending_daily_record_patches_v1';
export const PENDING_DAILY_RECORD_PATCH_TTL_MS = 5 * 60 * 1000;

interface PendingPatchEntry {
  id: string;
  patch: DailyRecordPatch;
  createdAt: number;
  expiresAt: number;
  mutationId: string;
  clientId: string;
  tabId: string;
}

type PendingPatchStore = Record<string, PendingPatchEntry[]>;

const pendingPatchRegistry = new Map<string, Map<string, PendingPatchEntry>>();
let pendingPatchSequence = 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const getNow = (): number => Date.now();

const isTrackableExplicitCensusPath = (path: string): boolean => {
  const [root, bedId, field] = path.split('.');
  return Boolean(root === 'beds' && bedId && field && PENDING_LOCAL_CENSUS_PATCH_FIELDS.has(field));
};

const filterTrackableExplicitCensusPatch = (patch: DailyRecordPatch): DailyRecordPatch => {
  const filteredPatch: Record<string, unknown> = {};
  Object.entries(patch as Record<string, unknown>).forEach(([path, value]) => {
    if (isTrackableExplicitCensusPath(path)) {
      filteredPatch[path] = value;
    }
  });
  return filteredPatch as DailyRecordPatch;
};

const normalizePersistedEntry = (value: unknown, now: number): PendingPatchEntry | undefined => {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const patch = isPlainObject(value.patch)
    ? filterTrackableExplicitCensusPatch(value.patch as DailyRecordPatch)
    : {};
  if (Object.keys(patch).length === 0) {
    return undefined;
  }

  const id = typeof value.id === 'string' && value.id ? value.id : undefined;
  const expiresAt = typeof value.expiresAt === 'number' ? value.expiresAt : 0;
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : now;
  const mutationId =
    typeof value.mutationId === 'string' && value.mutationId ? value.mutationId : id;
  const clientId = typeof value.clientId === 'string' && value.clientId ? value.clientId : '';
  const tabId = typeof value.tabId === 'string' && value.tabId ? value.tabId : '';

  if (!id || !mutationId || expiresAt <= now) {
    return undefined;
  }

  return {
    id,
    patch,
    createdAt,
    expiresAt,
    mutationId,
    clientId,
    tabId,
  };
};

const writePersistedStore = (store: PendingPatchStore): void => {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }

    if (Object.keys(store).length === 0) {
      localStorage.removeItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY);
      return;
    }

    localStorage.setItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort hydration guard; IndexedDB/outbox remains the durable source
    // of retryable writes when localStorage is unavailable.
  }
};

const readPersistedStore = (): PendingPatchStore => {
  try {
    if (typeof localStorage === 'undefined') {
      return {};
    }

    const rawStore = localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY);
    if (!rawStore) {
      return {};
    }

    const parsed = JSON.parse(rawStore);
    if (!isPlainObject(parsed)) {
      localStorage.removeItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY);
      return {};
    }

    const now = getNow();
    const store = Object.entries(parsed).reduce<PendingPatchStore>((acc, [date, entries]) => {
      if (!Array.isArray(entries)) {
        return acc;
      }
      const normalizedEntries = entries
        .map(entry => normalizePersistedEntry(entry, now))
        .filter((entry): entry is PendingPatchEntry => Boolean(entry));
      if (normalizedEntries.length > 0) {
        acc[date] = normalizedEntries;
      }
      return acc;
    }, {});
    writePersistedStore(store);
    return store;
  } catch {
    try {
      localStorage.removeItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
    return {};
  }
};

const getMemoryEntriesForDate = (date: string): PendingPatchEntry[] =>
  Array.from(pendingPatchRegistry.get(date)?.values() ?? []);

const writeMemoryEntriesForDate = (date: string, entries: PendingPatchEntry[]): void => {
  if (entries.length === 0) {
    pendingPatchRegistry.delete(date);
    return;
  }
  pendingPatchRegistry.set(date, new Map(entries.map(entry => [entry.id, entry])));
};

const writePersistedEntriesForDate = (date: string, entries: PendingPatchEntry[]): void => {
  const store = readPersistedStore();
  if (entries.length === 0) {
    delete store[date];
  } else {
    store[date] = entries;
  }
  writePersistedStore(store);
};

const getPendingEntriesForDate = (date: string): PendingPatchEntry[] => {
  const now = getNow();
  const memoryEntries = getMemoryEntriesForDate(date)
    .map(entry => normalizePersistedEntry(entry, now))
    .filter((entry): entry is PendingPatchEntry => Boolean(entry));
  const persistedEntries = readPersistedStore()[date] ?? [];
  const entriesById = new Map<string, PendingPatchEntry>();

  [...memoryEntries, ...persistedEntries].forEach(entry => {
    entriesById.set(entry.id, entry);
  });

  const entries = Array.from(entriesById.values());
  writeMemoryEntriesForDate(date, entries);
  writePersistedEntriesForDate(date, entries);
  return entries;
};

const removePendingEntry = (date: string, id: string): void => {
  const entries = getPendingEntriesForDate(date).filter(entry => entry.id !== id);
  writeMemoryEntriesForDate(date, entries);
  writePersistedEntriesForDate(date, entries);
};

const getPatchPathValue = (record: DailyRecord, path: string): unknown =>
  path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, record);

const findIncomingBedIdForSameEpisode = (
  incomingRecord: DailyRecord,
  previousRecord: DailyRecord,
  previousBedId: string
): string | undefined => {
  const previousPatient = previousRecord.beds[previousBedId];
  if (!previousPatient) {
    return undefined;
  }

  return Object.keys(incomingRecord.beds).find(
    incomingBedId =>
      incomingBedId !== previousBedId &&
      isSameEpisodeForExplicitCensusPatch(incomingRecord.beds[incomingBedId], previousPatient)
  );
};

export const registerPendingDailyRecordPatch = (
  date: string,
  patch: DailyRecordPatch
): (() => void) => {
  const trackedPatch = filterTrackableExplicitCensusPatch(patch);
  if (Object.keys(trackedPatch).length === 0) {
    return () => {};
  }

  const now = getNow();
  const mutationIdentity = buildSyncMutationIdentity();
  const entry: PendingPatchEntry = {
    id: `${mutationIdentity.mutationId}_${++pendingPatchSequence}`,
    patch: trackedPatch,
    createdAt: now,
    expiresAt: now + PENDING_DAILY_RECORD_PATCH_TTL_MS,
    ...mutationIdentity,
  };
  const entries = [...getPendingEntriesForDate(date), entry];
  writeMemoryEntriesForDate(date, entries);
  writePersistedEntriesForDate(date, entries);

  return () => removePendingEntry(date, entry.id);
};

export const clearPendingDailyRecordPatchesForTests = (): void => {
  pendingPatchRegistry.clear();
  writePersistedStore({});
};

const collectPendingExplicitCensusPatch = (
  date: string,
  incomingRecord: DailyRecord,
  previousRecord: DailyRecord | undefined
): DailyRecordPatch => {
  const pendingPatches = getPendingEntriesForDate(date);
  if (pendingPatches.length === 0 || !previousRecord) {
    return {};
  }

  const resolvedPatch: Record<string, unknown> = {};
  pendingPatches.forEach(({ patch }) => {
    Object.entries(patch as Record<string, unknown>).forEach(([path, value]) => {
      const [root, bedId, field] = path.split('.');
      if (root !== 'beds' || !bedId || !field || !PENDING_LOCAL_CENSUS_PATCH_FIELDS.has(field)) {
        return;
      }

      if (
        isSameEpisodeForExplicitCensusPatch(incomingRecord.beds[bedId], previousRecord.beds[bedId])
      ) {
        resolvedPatch[path] = value;
        return;
      }

      const movedBedId = findIncomingBedIdForSameEpisode(incomingRecord, previousRecord, bedId);
      if (movedBedId) {
        resolvedPatch[`beds.${movedBedId}.${field}`] = value;
      }
    });
  });

  return resolvedPatch as DailyRecordPatch;
};

export const releaseConfirmedPendingDailyRecordPatches = (
  date: string,
  incomingRecord: DailyRecord,
  previousRecord: DailyRecord | undefined
): void => {
  const pendingPatches = getPendingEntriesForDate(date);
  if (pendingPatches.length === 0 || !previousRecord) {
    return;
  }

  const nextEntries = pendingPatches.flatMap(entry => {
    const patchRecord = { ...(entry.patch as Record<string, unknown>) };
    const trackedEntries = Object.entries(patchRecord).filter(([path]) =>
      isTrackableExplicitCensusPath(path)
    );

    if (trackedEntries.length === 0) {
      return [];
    }

    trackedEntries.forEach(([path, value]) => {
      const [, bedId, field] = path.split('.');
      if (
        bedId &&
        !isSameEpisodeForExplicitCensusPatch(incomingRecord.beds[bedId], previousRecord.beds[bedId])
      ) {
        if (field) {
          const movedBedId = findIncomingBedIdForSameEpisode(incomingRecord, previousRecord, bedId);
          if (movedBedId) {
            const movedPath = `beds.${movedBedId}.${field}`;
            if (getPatchPathValue(incomingRecord, movedPath) === value) {
              delete patchRecord[path];
            }
            return;
          }
        }
        delete patchRecord[path];
      }
    });

    const remainingTrackedEntries = Object.entries(patchRecord).filter(([path]) =>
      isTrackableExplicitCensusPath(path)
    );

    const isRemoteConfirmed =
      remainingTrackedEntries.length > 0 &&
      remainingTrackedEntries.every(
        ([path, value]) => getPatchPathValue(incomingRecord, path) === value
      );
    if (remainingTrackedEntries.length === 0 || isRemoteConfirmed) {
      return [];
    }

    return [
      {
        ...entry,
        patch: patchRecord as DailyRecordPatch,
      },
    ];
  });

  writeMemoryEntriesForDate(date, nextEntries);
  writePersistedEntriesForDate(date, nextEntries);
};

export const applyPendingExplicitCensusPatch = (
  date: string,
  incomingRecord: DailyRecord,
  previousRecord: DailyRecord | undefined
): DailyRecord => {
  const patch = collectPendingExplicitCensusPatch(date, incomingRecord, previousRecord);
  if (Object.keys(patch).length === 0) {
    return incomingRecord;
  }

  return applyPatches(incomingRecord, patch);
};
