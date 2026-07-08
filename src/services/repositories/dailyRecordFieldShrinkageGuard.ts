import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { dailyRecordWriteLogger } from '@/services/repositories/repositoryLoggers';

// Field shrinkage guard.
// Catches stale snapshot writes that replace a longer clinical note with a
// much shorter value while allowing intentional full clears.
const FIELD_SHRINKAGE_MIN_PREV_LENGTH = 20;
const FIELD_SHRINKAGE_RATIO_THRESHOLD = 0.5;

export type FieldShrinkage = { path: string; prevLength: number; nextLength: number };

const resolvePathOnRecord = (record: DailyRecord, path: string): unknown => {
  const segments = path.split('.');
  let current: unknown = record;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const isProtectedClinicalTextPath = (path: string): boolean =>
  /^beds\.[^.]+(\.clinicalCrib)?\.(pathology|handoffNote|handoffNoteDayShift|handoffNoteNightShift|medicalHandoffNote)$/.test(
    path
  );

const isMedicalHandoffEntriesPath = (path: string): boolean =>
  /^beds\.[^.]+(\.clinicalCrib)?\.medicalHandoffEntries$/.test(path);

const isSuspiciousTextShrinkage = (prevValue: string, nextValue: string): boolean => {
  if (nextValue.length === 0) return false;
  if (prevValue.length < FIELD_SHRINKAGE_MIN_PREV_LENGTH) return false;
  return nextValue.length / prevValue.length < FIELD_SHRINKAGE_RATIO_THRESHOLD;
};

const resolveEntryId = (entry: unknown, fallback: number): string =>
  String((entry as { id?: string | number } | null)?.id ?? fallback);

const reportMedicalEntryNoteShrinkage = (
  path: string,
  prevValue: unknown,
  nextValue: unknown
): FieldShrinkage[] => {
  if (!Array.isArray(prevValue) || !Array.isArray(nextValue)) return [];

  const previousEntries = new Map<string, unknown>();
  prevValue.forEach((entry, index) => previousEntries.set(resolveEntryId(entry, index), entry));

  return nextValue.flatMap((entry, index) => {
    const entryId = resolveEntryId(entry, index);
    const previousEntry = previousEntries.get(entryId);
    const previousNote = (previousEntry as { note?: unknown } | undefined)?.note;
    const nextNote = (entry as { note?: unknown } | undefined)?.note;
    if (typeof previousNote !== 'string' || typeof nextNote !== 'string') return [];
    if (!isSuspiciousTextShrinkage(previousNote, nextNote)) return [];
    return [
      {
        path: `${path}.${entryId}.note`,
        prevLength: previousNote.length,
        nextLength: nextNote.length,
      },
    ];
  });
};

const reportFieldShrinkage = (
  date: string,
  current: DailyRecord,
  patches: DailyRecordPatch
): FieldShrinkage[] => {
  const suspiciousShrinkages: FieldShrinkage[] = [];

  for (const [path, nextValue] of Object.entries(patches)) {
    const prevValue = resolvePathOnRecord(current, path);

    if (isMedicalHandoffEntriesPath(path)) {
      const entryShrinkages = reportMedicalEntryNoteShrinkage(path, prevValue, nextValue);
      entryShrinkages.forEach(shrinkage =>
        dailyRecordWriteLogger.warn(
          `Field shrinkage detected at ${shrinkage.path} for ${date}: ${shrinkage.prevLength} -> ${shrinkage.nextLength} chars`,
          { ...shrinkage, date }
        )
      );
      suspiciousShrinkages.push(...entryShrinkages);
      continue;
    }

    if (typeof nextValue !== 'string' || typeof prevValue !== 'string') continue;
    if (!isSuspiciousTextShrinkage(prevValue, nextValue)) continue;
    dailyRecordWriteLogger.warn(
      `Field shrinkage detected at ${path} for ${date}: ${prevValue.length} -> ${nextValue.length} chars`,
      { path, date, prevLength: prevValue.length, nextLength: nextValue.length }
    );
    if (isProtectedClinicalTextPath(path)) {
      suspiciousShrinkages.push({
        path,
        prevLength: prevValue.length,
        nextLength: nextValue.length,
      });
    }
  }

  return suspiciousShrinkages;
};

const hasRemoteVersionAdvanced = (remote: DailyRecord, current: DailyRecord): boolean => {
  const remoteUpdatedAt = new Date(remote.lastUpdated || '').getTime();
  const currentUpdatedAt = new Date(current.lastUpdated || '').getTime();
  if (!Number.isFinite(remoteUpdatedAt) || !Number.isFinite(currentUpdatedAt)) {
    return remote.lastUpdated !== current.lastUpdated;
  }
  return remoteUpdatedAt > currentUpdatedAt;
};

export const resolveBlockingFieldShrinkages = async (
  date: string,
  current: DailyRecord,
  patches: DailyRecordPatch
): Promise<FieldShrinkage[]> => {
  const localShrinkages = reportFieldShrinkage(date, current, patches);
  if (localShrinkages.length === 0 || !isFirestoreEnabled()) {
    return [];
  }

  const remoteRecord = await getRecordFromFirestore(date);
  if (!remoteRecord || !hasRemoteVersionAdvanced(remoteRecord, current)) {
    return [];
  }

  const remoteShrinkages = reportFieldShrinkage(date, remoteRecord, patches);
  return remoteShrinkages.length > 0 ? remoteShrinkages : localShrinkages;
};
