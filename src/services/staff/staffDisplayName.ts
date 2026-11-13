import { reconcileNurseCatalogNames, preferredStaffName, nurseIdentityKey } from './nurseIdentity';
import {
  resolveEloisaStaffIdentity,
  resolveEloisaStaffName,
  staffNameMatches,
  type EloisaStaffIdentity,
  type NursingRole,
} from './eloisaStaffIdentity';

/** A short label is not an identity key: retain canonical names in stored selections. */
export const formatStaffDisplayName = (
  name: string,
  entries: EloisaStaffIdentity[],
  role?: NursingRole | null
): string => {
  const identity = resolveEloisaStaffIdentity(name, entries, role);
  const fullName = resolveEloisaStaffName(name, entries, role);
  if (!identity) return fullName;
  const shortAliases = reconcileNurseCatalogNames(identity.aliases).filter(
    alias =>
      alias.split(' ').length === 2 &&
      !entries.some(
        other =>
          other.key !== identity.key &&
          other.role === identity.role &&
          staffNameMatches(other, alias)
      )
  );
  // Without structured evidence, the second word could be another given name.
  return shortAliases.length === 1
    ? nurseIdentityKey(shortAliases[0]) === nurseIdentityKey(fullName)
      ? preferredStaffName(fullName, shortAliases[0])
      : shortAliases[0]
    : fullName;
};
