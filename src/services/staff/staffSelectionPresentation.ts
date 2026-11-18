import { preferredStaffName, sameStaffText } from './nurseIdentity';
export const VACANCY_LABEL = 'Vacante';

export const normalizeStaffSelectionValue = (value?: string | null): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' || trimmed === '--' ? VACANCY_LABEL : trimmed;
};

export const isVacancySelection = (value?: string | null): boolean =>
  normalizeStaffSelectionValue(value) === VACANCY_LABEL;

export const shouldOmitExtraStaffSelection = (value?: string | null): boolean => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' || trimmed === '--' || isVacancySelection(trimmed);
};

/** A saved name that names two or more Eloísa people of the role, so it chooses none of them. */
export const isAmbiguousStaffName = (
  value: string | undefined,
  identities: EloisaStaffIdentity[],
  role?: NursingRole
): boolean => staffPerson(normalizeStaffSelectionValue(value), identities, role).ambiguous;

/**
 * One option per person, with that person's preferred spelling: two Eloísa IDs are two options
 * even when their names fold alike. A saved shift name two people share adds no option of its own.
 */
export const buildResolvedStaffSelectionOptions = (
  catalog: string[],
  selectedValues: string[],
  identities: EloisaStaffIdentity[] = [],
  role?: NursingRole
): string[] => {
  const people = new Map<string, string>([['', VACANCY_LABEL]]);
  const place = (key: string, value: string) => {
    const name = resolveStaffSelectionValue(value, identities, role);
    if (name === VACANCY_LABEL) return;
    const kept = people.get(key);
    people.set(key, kept === undefined ? name : preferredStaffName(kept, name));
  };
  catalog
    .filter(Boolean)
    .forEach(value => place(listedStaffPerson(value, identities, role), value));
  selectedValues
    .filter(value => !isAmbiguousStaffName(value, identities, role))
    .forEach(value => place(staffPerson(value, identities, role).key, value));
  return [...new Map([...people.values()].map(name => [sameStaffText(name), name])).values()];
};

export const resolveStaffSelectionValue = (
  value: string | undefined,
  identities: EloisaStaffIdentity[],
  role?: NursingRole,
  catalog: string[] = []
): string => {
  const resolved = normalizeStaffSelectionValue(
    resolveEloisaStaffName(normalizeStaffSelectionValue(value), identities, role)
  );
  // The option written the same (apart from case and spacing) is that option; a name two
  // Eloísa people share otherwise stays as written: no spelling may turn it into one of them.
  const exact = exactStaffOption(resolved, catalog);
  if (exact !== resolved || isAmbiguousStaffName(resolved, identities, role)) return exact;
  const person = staffPerson(resolved, identities, role).key;
  const known = catalog.find(name => listedStaffPerson(name, identities, role) === person);
  return known === undefined ? resolved : preferredStaffName(known, resolved);
};

/** The option written like a saved name, apart from case and spacing; else the name itself. */
export const exactStaffOption = (name: string, options: readonly string[]): string =>
  options.find(option => sameStaffText(option) === sameStaffText(name)) ?? name;
import {
  listedStaffPerson,
  resolveEloisaStaffName,
  staffPerson,
  type EloisaStaffIdentity,
  type NursingRole,
} from './eloisaStaffIdentity';
