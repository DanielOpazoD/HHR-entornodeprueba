import {
  isSpellingOf,
  nurseIdentityKey,
  preferredStaffName,
  reconcileNurseCatalogNames,
  sameStaffText,
  uniqueStaffNames,
} from './nurseIdentity';

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
export const staffNameMatches = (entry: EloisaStaffIdentity, name: string) =>
  [entry.name, ...entry.aliases].some(alias => nurseIdentityKey(alias) === nurseIdentityKey(name));

/** The shared catalog's people, keeping only well-formed entries. */
export const readStaffIdentities = (value: unknown): EloisaStaffIdentity[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is EloisaStaffIdentity =>
          v &&
          typeof v.key === 'string' &&
          typeof v.name === 'string' &&
          ['nurse', 'tens'].includes(v.role) &&
          Array.isArray(v.aliases) &&
          v.aliases.every((a: unknown) => typeof a === 'string')
      )
    : [];

const peopleNamed = (
  name: string,
  entries: EloisaStaffIdentity[],
  role?: NursingRole | null,
  practitionerId?: string
) =>
  entries.filter(
    entry =>
      (!role || entry.role === role) &&
      (practitionerId ? entry.practitionerId === practitionerId : staffNameMatches(entry, name))
  );

export const resolveEloisaStaffIdentity = (
  name: string,
  entries: EloisaStaffIdentity[],
  role?: NursingRole | null,
  practitionerId?: string
): EloisaStaffIdentity | undefined => {
  const candidates = peopleNamed(name, entries, role, practitionerId);
  return candidates.length === 1 ? candidates[0] : undefined;
};

/** Who a staff name stands for in a role. */
export interface StaffPerson {
  /** The Eloísa person it names (an ID beats spelling), else its own name's identity. */
  key: string;
  /** It names two or more Eloísa people, so it stands for none of them. */
  ambiguous: boolean;
}

/**
 * The one staff identity that selection, catalog saves and Eloísa share: a name is the Eloísa
 * person it names, or itself when Eloísa knows nobody by it, and nobody when it names two.
 */
export const staffPerson = (
  name: string,
  entries: EloisaStaffIdentity[],
  role?: NursingRole | null
): StaffPerson => {
  const [person, ...others] = peopleNamed(name, entries, role);
  return {
    key: person && others.length === 0 ? person.key : `text:${nurseIdentityKey(name)}`,
    ambiguous: others.length > 0,
  };
};

/**
 * The person a row of the role list stands for. Rows are written from a person's own name, so a
 * row whose name two people share stands for the one whose name or alias it is written as; a
 * saved shift name is never read this way (see `staffPerson`).
 */
export const listedStaffPerson = (
  name: string,
  entries: EloisaStaffIdentity[],
  role?: NursingRole | null
): string => {
  const person = staffPerson(name, entries, role);
  if (!person.ambiguous) return person.key;
  const [written, ...others] = peopleNamed(name, entries, role).filter(entry =>
    [entry.name, ...entry.aliases].some(alias => sameStaffText(alias) === sameStaffText(name))
  );
  return written && others.length === 0 ? written.key : person.key;
};

/**
 * The row of the role list a text stands for, when only the list is known (shift proposals).
 * The list has one row per person: the same text (apart from case and spacing) is that row; a
 * spelling that folds like exactly one row is that row; one that folds like two rows is neither
 * (its own key), and one the list does not hold is its folded name.
 */
export const staffRowKey = (name: string, list: readonly string[] = []): string => {
  const exact = list.find(row => sameStaffText(row) === sameStaffText(name));
  if (exact !== undefined) return `row:${sameStaffText(exact)}`;
  const [row, ...others] = list.filter(row => nurseIdentityKey(row) === nurseIdentityKey(name));
  if (row === undefined) return `text:${nurseIdentityKey(name)}`;
  return others.length === 0 ? `row:${sameStaffText(row)}` : `ambiguous:${sameStaffText(name)}`;
};

/** Whether two texts name the same person of a role list (see `staffRowKey`). */
export const sameStaffMember = (left: string, right: string, list: readonly string[] = []) =>
  staffRowKey(left, list) === staffRowKey(right, list);

/** The key of a name without source ID (a registry record), under the identity rule. */
export const staffNameKey = (name: string): string => nurseIdentityKey(name);

/** One spelling per name of a single, already identified person (its aliases). */
export const personSpellings = (names: string[]): string[] => uniqueStaffNames(names);

/** A single person's aliases as shown: re-capitalized, one spelling per name. */
export const personDisplaySpellings = (names: string[]): string[] =>
  reconcileNurseCatalogNames(names);

/** The words of a name under the identity rule, to compare the parts of two names. */
export const staffNameTokens = (name: string): string[] =>
  nurseIdentityKey(name).split(' ').filter(Boolean);

/**
 * A row of one person corrected by hand to another spelling of the same letters («Maria Pena» →
 * «María Pena») stays that person's row: the new text becomes an alias of that person, unless it
 * already names someone else. Returns the people to keep, or undefined when nothing changes.
 */
export const withRespelledRow = (
  people: EloisaStaffIdentity[],
  before: string,
  after: string,
  role: NursingRole
): EloisaStaffIdentity[] | undefined => {
  const owner = people.find(entry => entry.key === listedStaffPerson(before, people, role));
  const afterPerson = listedStaffPerson(after, people, role);
  if (!owner || !isSpellingOf(before, after) || afterPerson === owner.key) return undefined;
  if (people.some(entry => entry.key === afterPerson)) return undefined;
  return people.map(entry =>
    entry === owner ? { ...entry, aliases: [...entry.aliases, after] } : entry
  );
};

/**
 * The name shown for a name already resolved to `identity`: the person's Eloísa name, keeping the
 * name's own spelling of the same letters unless Eloísa's carries more marks; itself without one.
 */
export const identityStaffName = (name: string, identity: EloisaStaffIdentity | undefined) =>
  identity === undefined
    ? name
    : isSpellingOf(identity.name, name)
      ? preferredStaffName(name, identity.name)
      : identity.name;

export const resolveEloisaStaffName = (
  name: string,
  entries: EloisaStaffIdentity[],
  role?: NursingRole | null,
  practitionerId?: string
): string =>
  identityStaffName(name, resolveEloisaStaffIdentity(name, entries, role, practitionerId));

/** A shown row and the exact saved texts it was built from (none for a name only Eloísa gives). */
export interface StaffCatalogRow {
  name: string;
  saved: string[];
}

/**
 * The rows the screen shows: one per person (`staffPerson`), so two Eloísa IDs stay two rows even
 * when their names fold alike. Rows with the same text are one entry of the list, whoever they name.
 */
export const staffCatalogRows = (
  manual: string[],
  entries: EloisaStaffIdentity[],
  role: NursingRole
): StaffCatalogRow[] => {
  const people = entries.filter(entry => entry.role === role);
  const rows = new Map<string, StaffCatalogRow>();
  // Preserve the saved spelling on ties and keep exact texts for conflict detection.
  const place = (key: string, name: string, saved: string[]) => {
    const row = rows.get(key);
    rows.set(key, {
      name: row ? preferredStaffName(row.name, name) : name,
      saved: [...(row?.saved ?? []), ...saved],
    });
  };
  manual.forEach(name =>
    place(listedStaffPerson(name, people, role), resolveEloisaStaffName(name, people, role), [name])
  );
  // A signature without ID that names two other people is left for review, never a third row.
  people
    .filter(
      entry =>
        entry.practitionerId ||
        !staffPerson(
          entry.name,
          people.filter(other => other !== entry),
          role
        ).ambiguous
    )
    .forEach(entry => place(entry.key, entry.name, []));
  const byText = new Map<string, StaffCatalogRow>();
  for (const row of rows.values()) {
    const text = sameStaffText(row.name);
    const same = byText.get(text);
    byText.set(text, same ? { name: same.name, saved: [...same.saved, ...row.saved] } : row);
  }
  return [...byText.values()];
};

/**
 * The saved texts of a role list, one per person (its preferred saved spelling), without people
 * only Eloísa reports: the curated roster shift proposals compare against.
 */
export const savedStaffRows = (
  manual: string[],
  entries: EloisaStaffIdentity[],
  role: NursingRole
): string[] =>
  staffCatalogRows(manual, entries, role).flatMap(({ saved: [first, ...rest] }) =>
    first === undefined ? [] : [rest.reduce(preferredStaffName, first)]
  );

export const mergeStaffCatalog = (
  manual: string[],
  entries: EloisaStaffIdentity[],
  role: NursingRole
): string[] => staffCatalogRows(manual, entries, role).map(row => row.name);

/** The saved texts behind a shown name; a display may restyle the name but keeps its identity. */
export const savedTextsOfRow =
  (rows: readonly StaffCatalogRow[]) =>
  (shown: string): readonly string[] =>
    rows.find(row => sameStaffText(row.name) === sameStaffText(shown))?.saved ?? [];
