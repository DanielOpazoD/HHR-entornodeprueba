import type { ClinicalAntecedentEntry } from '@/features/rayen-import/clinical-panel';

export const clinicalAntecedentEntryKey = (
  entry: Pick<ClinicalAntecedentEntry, 'source' | 'id'>
): string => JSON.stringify([entry.source, entry.id]);

/** Keep the first source/id occurrence, including its original object and position. */
export const uniqueClinicalAntecedentEntries = (
  entries: readonly ClinicalAntecedentEntry[]
): ClinicalAntecedentEntry[] => {
  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = clinicalAntecedentEntryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
