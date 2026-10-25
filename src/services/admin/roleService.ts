import { firestoreDb, type IDatabaseProvider } from '@/services/storage/firestore';
import {
  isGeneralLoginRole,
  isManagedUserRole,
  type ManagedUserRole,
} from '@/shared/access/roleAccessMatrix';
import type { UserRole } from '@/types/authRoleTypes';
import { roleServiceLogger } from '@/services/admin/adminLoggers';
import {
  defaultFunctionsRuntime,
  type FunctionsRuntime,
} from '@/services/firebase-runtime/functionsRuntime';

const LEGACY_ROLE_ALIASES = {
  viewer_census: 'viewer',
} as const;

export interface UserRoleMap {
  [email: string]: UserRole;
}

export interface RoleSnapshot {
  roles: UserRoleMap;
  migratedLegacyEntries: string[];
}

const normalizeConfiguredRole = (
  role: unknown
): { role: UserRole | null; migratedLegacyRole: boolean } => {
  if (typeof role !== 'string' || !role.trim()) {
    return { role: null, migratedLegacyRole: false };
  }

  const canonicalRole = LEGACY_ROLE_ALIASES[role as keyof typeof LEGACY_ROLE_ALIASES] ?? role;
  return {
    role: isGeneralLoginRole(canonicalRole) ? canonicalRole : null,
    migratedLegacyRole: canonicalRole !== role,
  };
};

/**
 * Service for managing user roles dynamically via Firestore.
 */
export interface RoleService {
  getRolesSnapshot: () => Promise<RoleSnapshot>;
  getRoles: () => Promise<UserRoleMap>;
  setRole: (email: string, role: string) => Promise<void>;
  removeRole: (email: string) => Promise<void>;
  hasNestedProperty: (obj: Record<string, unknown>, key: string) => boolean;
  forceSyncUser: (
    email: string,
    role: ManagedUserRole | 'unauthorized'
  ) => Promise<{ success?: boolean; message?: string }>;
}

export const createRoleService = (
  database: Pick<IDatabaseProvider, 'getDoc' | 'setDoc'> = firestoreDb,
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
): RoleService => ({
  async getRolesSnapshot(): Promise<RoleSnapshot> {
    try {
      const rawRoles = (await database.getDoc<Record<string, unknown>>('config', 'roles')) || {};
      const roles: UserRoleMap = {};
      const migratedLegacyEntries: string[] = [];
      const nextRawRoles = { ...rawRoles };

      for (const [email, configuredRole] of Object.entries(rawRoles)) {
        const { role, migratedLegacyRole } = normalizeConfiguredRole(configuredRole);
        if (!role) {
          continue;
        }

        roles[email] = role;

        if (migratedLegacyRole) {
          nextRawRoles[email] = role;
          migratedLegacyEntries.push(email);
        }
      }

      if (migratedLegacyEntries.length > 0) {
        await database.setDoc('config', 'roles', nextRawRoles);
        roleServiceLogger.warn(
          `Normalized legacy role aliases for ${migratedLegacyEntries.length} account(s).`,
          {
            migratedLegacyEntries,
          }
        );
      }

      return {
        roles,
        migratedLegacyEntries,
      };
    } catch (error) {
      roleServiceLogger.error('Failed to fetch roles', error);
      throw error;
    }
  },

  /**
   * Fetch all configured roles from Firestore.
   */
  async getRoles(): Promise<UserRoleMap> {
    const snapshot = await this.getRolesSnapshot();
    return snapshot.roles;
  },

  /**
   * Add or Update a role for a specific email.
   */
  async setRole(email: string, role: string): Promise<void> {
    try {
      const cleanEmail = email.toLowerCase().trim();
      if (!isManagedUserRole(role)) {
        throw new Error(`Rol no asignable: ${role}`);
      }

      // We fetch the entire map, modify it locally, and replace it.
      // This is 100% safe against Firestore dot-notation (splitting emails into nested objects).
      const currentRoles =
        (await database.getDoc<Record<string, unknown>>('config', 'roles')) || {};
      const updatedRoles = { ...currentRoles, [cleanEmail]: role };

      for (const [emailKey, configuredRole] of Object.entries(updatedRoles)) {
        const { role: normalizedRole, migratedLegacyRole } =
          normalizeConfiguredRole(configuredRole);
        if (migratedLegacyRole && normalizedRole) {
          updatedRoles[emailKey] = normalizedRole;
        }
      }

      await database.setDoc('config', 'roles', updatedRoles);
      roleServiceLogger.info(`Successfully updated roles map for ${cleanEmail}`);
    } catch (error) {
      roleServiceLogger.error(`Failed to set role for ${email}`, error);
      throw error;
    }
  },

  /**
   * Revoke access explicitly so stale role claims cannot become the fallback authority.
   */
  async removeRole(email: string): Promise<void> {
    try {
      const cleanEmail = email.toLowerCase().trim();

      const currentRoles =
        (await database.getDoc<Record<string, unknown>>('config', 'roles')) || {};
      if (
        currentRoles[cleanEmail] !== undefined ||
        this.hasNestedProperty(currentRoles, cleanEmail)
      ) {
        const updatedRoles = { ...currentRoles };
        updatedRoles[cleanEmail] = 'unauthorized';

        // Also clean up any truncated/nested garbage if it exists
        const truncated = cleanEmail.split('.')[0];
        if (updatedRoles[truncated]) delete updatedRoles[truncated];

        for (const [emailKey, configuredRole] of Object.entries(updatedRoles)) {
          const { role: normalizedRole, migratedLegacyRole } =
            normalizeConfiguredRole(configuredRole);
          if (migratedLegacyRole && normalizedRole) {
            updatedRoles[emailKey] = normalizedRole;
          }
        }

        await database.setDoc('config', 'roles', updatedRoles);
        roleServiceLogger.info(`Successfully removed role for ${cleanEmail}`);
      }
    } catch (error) {
      roleServiceLogger.error(`Failed to remove role for ${email}`, error);
      throw error;
    }
  },

  /** Helper to check if a key exists even if it was nested by mistake */
  hasNestedProperty(obj: Record<string, unknown>, key: string): boolean {
    return key in obj;
  },

  /**
   * Force sync a user's role by calling the Cloud Function.
   * Useful when changing a role for a user who is already authorized.
   */
  async forceSyncUser(
    email: string,
    role: ManagedUserRole | 'unauthorized'
  ): Promise<{ success?: boolean; message?: string }> {
    const functions = await functionsRuntime.getFunctions();
    const { httpsCallable } = await import('firebase/functions');
    const setUserRole = httpsCallable(functions, 'setUserRole');
    const result = await setUserRole({ email, role });
    return (result as { data?: { success?: boolean; message?: string } }).data || {};
  },
});

export const roleService: RoleService = createRoleService();
