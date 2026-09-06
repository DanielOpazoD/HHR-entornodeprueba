import { nurseIdentityKey } from './nurseIdentity';

export type NursingRole = 'nurse' | 'tens';
export interface StaffObservation {
  author: string;
  role: string;
  practitionerId?: string;
  authorIdentity?: { firstGivenName: string; firstSurname: string };
  recordedAt: string;
  archived?: boolean;
  crossedOut?: boolean;
}
export interface EloisaStaffIdentity {
  key: string;
  role: NursingRole;
  name: string;
  practitionerId?: string;
  aliases: string[];
  manuallyCatalogued?: boolean;
}
export const nursingRole = (role: string): NursingRole | null =>
  /\btens\b|param[eé]dic|t[eé]cnic[oa]|auxiliar/i.test(role)
    ? 'tens'
    : /enfermer/i.test(role)
      ? 'nurse'
      : null;
export const uniqueStaffNames = (names: string[]) => [
  ...new Map(names.map(name => [nurseIdentityKey(name), name])).values(),
];
export const staffNameMatches = (entry: EloisaStaffIdentity, name: string) =>
  [entry.name, ...entry.aliases].some(alias => nurseIdentityKey(alias) === nurseIdentityKey(name));

export const resolveEloisaStaffIdentity = (
  name: string,
  entries: EloisaStaffIdentity[],
  role?: NursingRole | null,
  practitionerId?: string
): EloisaStaffIdentity | undefined => {
  const candidates = entries.filter(
    entry =>
      (!role || entry.role === role) &&
      (practitionerId ? entry.practitionerId === practitionerId : staffNameMatches(entry, name))
  );
  return candidates.length === 1 ? candidates[0] : undefined;
};

export const resolveEloisaStaffName = (
  name: string,
  entries: EloisaStaffIdentity[],
  role?: NursingRole | null,
  practitionerId?: string
): string => resolveEloisaStaffIdentity(name, entries, role, practitionerId)?.name ?? name;

export const mergeStaffCatalog = (
  manual: string[],
  entries: EloisaStaffIdentity[],
  role: NursingRole
): string[] =>
  uniqueStaffNames([
    ...manual.map(name => resolveEloisaStaffName(name, entries, role)),
    ...entries.filter(entry => entry.role === role).map(entry => entry.name),
  ]);
