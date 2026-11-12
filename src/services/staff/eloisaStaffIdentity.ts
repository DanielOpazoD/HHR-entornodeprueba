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

/** A shown row and the exact saved texts it was built from (none for a name only Eloísa gives). */
export interface StaffCatalogRow {
  name: string;
  saved: string[];
}

/** The rows the screen shows: saved names resolved through Eloísa, grouped by identity. */
export const staffCatalogRows = (
  manual: string[],
  entries: EloisaStaffIdentity[],
  role: NursingRole
): StaffCatalogRow[] => {
  const rows = new Map<string, StaffCatalogRow>();
  // Same grouping as uniqueStaffNames: first position, last name.
  const place = (name: string, saved: string[]) => {
    const key = nurseIdentityKey(name);
    const row = rows.get(key);
    rows.set(key, { name, saved: [...(row?.saved ?? []), ...saved] });
  };
  manual.forEach(name => place(resolveEloisaStaffName(name, entries, role), [name]));
  entries.filter(entry => entry.role === role).forEach(entry => place(entry.name, []));
  return [...rows.values()];
};

export const mergeStaffCatalog = (
  manual: string[],
  entries: EloisaStaffIdentity[],
  role: NursingRole
): string[] => staffCatalogRows(manual, entries, role).map(row => row.name);

/** The saved texts behind a shown name; a display may restyle the name but keeps its identity. */
export const savedTextsOfRow =
  (rows: readonly StaffCatalogRow[]) =>
  (shown: string): readonly string[] =>
    rows.find(row => nurseIdentityKey(row.name) === nurseIdentityKey(shown))?.saved ?? [];
