import { reconcileNurseCatalogNames } from './nurseIdentity';
import {
  resolveEloisaStaffIdentity,
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
  const fullName = identity?.name ?? name;
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
  return shortAliases.length === 1 ? shortAliases[0] : fullName;
};
