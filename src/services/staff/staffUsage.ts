import type { DailyRecordStaffingState } from '@/services/contracts/dailyRecordServiceContracts';
import { collectRecordedStaffNames } from './dailyRecordStaffing';
import { nurseIdentityKey } from './nurseIdentity';
import { resolveStaffSelectionValue, isVacancySelection } from './staffSelectionPresentation';
import type { EloisaStaffIdentity, NursingRole } from './eloisaStaffIdentity';

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
          .map(name => nurseIdentityKey(resolveStaffSelectionValue(name, identities, role)))
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
  usage: Record<string, number> = {}
) => {
  const names = options.filter(name => !isVacancySelection(name));
  const protectedNames = new Set(selected.map(nurseIdentityKey));
  const count =
    names.length >= 4 && names.some(name => (usage[nurseIdentityKey(name)] ?? 0) > 0)
      ? Math.round(names.length * 0.25)
      : 0;
  const hidden = [...names]
    .filter(name => !protectedNames.has(nurseIdentityKey(name)))
    .sort(
      (a, b) =>
        (usage[nurseIdentityKey(a)] ?? 0) - (usage[nurseIdentityKey(b)] ?? 0) ||
        a.localeCompare(b, 'es')
    )
    .slice(0, count);
  const hiddenSet = new Set(hidden);
  return { visible: options.filter(name => !hiddenSet.has(name)), hidden };
};
