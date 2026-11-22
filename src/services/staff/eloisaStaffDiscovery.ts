import { isSpellingOf, preferredStaffName } from './nurseIdentity';
import {
  nursingRole,
  personSpellings,
  staffNameKey,
  staffNameMatches,
  type EloisaStaffIdentity,
  type StaffObservation,
} from './eloisaStaffIdentity';

const clean = (value: string) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const validName = (value: string) =>
  /^\p{L}[\p{L}\s.'’-]+$/u.test(value) &&
  value.split(' ').length >= 2 &&
  !/^(no informad|sin informaci|enfermer[oa] |tens )/i.test(value);

/**
 * The record a person is kept under: by source ID, else by name under today's rule. A record
 * without ID is found by its name, never by a key an older name fold wrote.
 */
const recordOf = (
  records: Map<string, EloisaStaffIdentity>,
  {
    key,
    role,
    name,
    practitionerId,
  }: Pick<EloisaStaffIdentity, 'key' | 'role' | 'name' | 'practitionerId'>
): EloisaStaffIdentity | undefined =>
  practitionerId
    ? records.get(key)
    : [...records.values()].find(
        record =>
          !record.practitionerId &&
          record.role === role &&
          staffNameKey(record.name) === staffNameKey(name)
      );

/** A new person's key: one an older fold already gave another person («ana franca») stays theirs. */
const freeKey = (records: Map<string, EloisaStaffIdentity>, key: string): string =>
  records.has(key) ? key.replace(':name:', ':spelling:') : key;

/** One person's name: a richer spelling of the same letters, else the longer name. */
const personName = (kept: string, incoming: string, incomingWinsTie: boolean): string =>
  isSpellingOf(kept, incoming)
    ? preferredStaffName(kept, incoming)
    : incoming.length > kept.length || (incomingWinsTie && incoming.length === kept.length)
      ? incoming
      : kept;

export const mergeStaffRegistries = (
  incoming: EloisaStaffIdentity[],
  previous: EloisaStaffIdentity[]
): EloisaStaffIdentity[] => {
  const records = new Map(previous.map(entry => [entry.key, entry]));
  for (const entry of incoming) {
    const known = recordOf(records, entry);
    const key = known?.key ?? freeKey(records, entry.key);
    records.set(
      key,
      known
        ? {
            ...entry,
            ...known,
            name: personName(known.name, entry.name, false),
            aliases: personSpellings([...known.aliases, ...entry.aliases, known.name, entry.name]),
          }
        : { ...entry, key }
    );
  }
  return mergeEloisaStaff([...records.values()], []);
};
/** Only source IDs and explicit structured aliases establish equality, never fuzzy prefixes. */
export const mergeEloisaStaff = (
  existing: EloisaStaffIdentity[],
  observations: StaffObservation[]
): EloisaStaffIdentity[] => {
  const records = new Map(
    existing.map(entry => [entry.key, { ...entry, aliases: [...entry.aliases] }])
  );
  for (const observation of observations) {
    const role = nursingRole(observation.role);
    const name = clean(observation.author ?? '');
    if (
      !role ||
      !validName(name) ||
      observation.archived ||
      observation.crossedOut ||
      !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(observation.recordedAt)
    )
      continue;
    const sourceId = clean(observation.practitionerId ?? '');
    const practitionerId = sourceId && sourceId !== '0' ? sourceId : undefined;
    const ownKey = `${role}:${practitionerId ? `id:${practitionerId}` : `name:${staffNameKey(name)}`}`;
    const previous = recordOf(records, { key: ownKey, role, name, practitionerId });
    const key = previous?.key ?? freeKey(records, ownKey);
    const parts = observation.authorIdentity;
    const structured =
      parts && clean(parts.firstGivenName) && clean(parts.firstSurname)
        ? clean(`${parts.firstGivenName} ${parts.firstSurname}`)
        : '';
    const aliases = personSpellings([
      ...(previous?.aliases ?? []),
      ...(previous ? [previous.name] : []),
      name,
      ...(structured && validName(structured) ? [structured] : []),
    ]);
    records.set(key, {
      ...previous,
      key,
      role,
      name: previous ? personName(previous.name, name, true) : name,
      ...(practitionerId ? { practitionerId } : {}),
      aliases,
    });
  }
  // Promote an un-ID'd legacy spelling only when exactly one stronger source identity owns it.
  for (const [key, entry] of records) {
    if (entry.practitionerId) continue;
    const targets = [...records.values()].filter(
      candidate =>
        candidate.key !== key &&
        candidate.role === entry.role &&
        (candidate.practitionerId || candidate.name.length > entry.name.length) &&
        staffNameMatches(candidate, entry.name)
    );
    const [target] = targets;
    if (targets.length !== 1 || !target) continue;
    if (entry.manuallyCatalogued) target.manuallyCatalogued = true;
    target.aliases = personSpellings([...target.aliases, entry.name, ...entry.aliases]);
    records.delete(key);
  }
  return [...records.values()].sort((a, b) => a.key.localeCompare(b.key));
};
