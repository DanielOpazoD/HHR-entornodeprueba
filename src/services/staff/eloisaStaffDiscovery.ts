import { nurseIdentityKey } from './nurseIdentity';
import {
  nursingRole,
  uniqueStaffNames,
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

export const mergeStaffRegistries = (
  incoming: EloisaStaffIdentity[],
  previous: EloisaStaffIdentity[]
): EloisaStaffIdentity[] => {
  const records = new Map(previous.map(entry => [entry.key, entry]));
  for (const entry of incoming) {
    const known = records.get(entry.key);
    records.set(
      entry.key,
      known
        ? {
            ...entry,
            ...known,
            name: entry.name.length > known.name.length ? entry.name : known.name,
            aliases: uniqueStaffNames([...known.aliases, ...entry.aliases, known.name, entry.name]),
          }
        : entry
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
    const key = `${role}:${practitionerId ? `id:${practitionerId}` : `name:${nurseIdentityKey(name)}`}`;
    const previous = records.get(key);
    const parts = observation.authorIdentity;
    const structured =
      parts && clean(parts.firstGivenName) && clean(parts.firstSurname)
        ? clean(`${parts.firstGivenName} ${parts.firstSurname}`)
        : '';
    const aliases = uniqueStaffNames([
      ...(previous?.aliases ?? []),
      ...(previous ? [previous.name] : []),
      name,
      ...(structured && validName(structured) ? [structured] : []),
    ]);
    records.set(key, {
      ...previous,
      key,
      role,
      name: previous && previous.name.length > name.length ? previous.name : name,
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
    if (targets.length !== 1) continue;
    const target = targets[0];
    if (entry.manuallyCatalogued) target.manuallyCatalogued = true;
    target.aliases = uniqueStaffNames([...target.aliases, entry.name, ...entry.aliases]);
    records.delete(key);
  }
  return [...records.values()].sort((a, b) => a.key.localeCompare(b.key));
};
