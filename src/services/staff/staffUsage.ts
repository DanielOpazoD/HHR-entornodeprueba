import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';
import { collectRecordedStaffNames } from './dailyRecordStaffing';
import { isVacancySelection } from './staffSelectionPresentation';
import {
  listedStaffPerson,
  staffRowKey,
  type EloisaStaffIdentity,
  type NursingRole,
} from './eloisaStaffIdentity';

/** Censuses per person (`listedStaffPerson` key), so two IDs that spell alike count apart. */
export type StaffUsage = Record<NursingRole, Record<string, number>>;
export const countStaffUsage = (
  records: Partial<DailyRecordStaffingState>[],
  identities: EloisaStaffIdentity[]
): StaffUsage => {
  const usage: StaffUsage = { nurse: {}, tens: {} };
  for (const record of records) {
    const names = collectRecordedStaffNames(record);
    for (const role of ['nurse', 'tens'] as const) {
      const daily = new Set(
        (role === 'nurse' ? names.nurseNames : names.tensNames)
          .filter(name => typeof name === 'string' && !isVacancySelection(name))
          .map(name => listedStaffPerson(name.trim(), identities, role))
      );
      // One occurrence per census, not per patient, alias or copied shift slot.
      for (const key of daily) usage[role][key] = (usage[role][key] ?? 0) + 1;
    }
  }
  return usage;
};

export const partitionStaffOptions = (
  options: string[],
  selected: string[],
  usage: Record<string, number> = {},
  /** The person an option or selection stands for; the same key `countStaffUsage` counts. */
  personOf: (name: string) => string = name => staffRowKey(name)
) => {
  const names = options.filter(name => !isVacancySelection(name));
  const protectedNames = new Set(selected.map(personOf));
  const count =
    names.length >= 4 && names.some(name => (usage[personOf(name)] ?? 0) > 0)
      ? Math.round(names.length * 0.25)
      : 0;
  const hidden = [...names]
    .filter(name => !protectedNames.has(personOf(name)))
    .sort(
      (a, b) => (usage[personOf(a)] ?? 0) - (usage[personOf(b)] ?? 0) || a.localeCompare(b, 'es')
    )
    .slice(0, count);
  const hiddenSet = new Set(hidden);
  return { visible: options.filter(name => !hiddenSet.has(name)), hidden };
};
