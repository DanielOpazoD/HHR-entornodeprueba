import { db } from '../infrastructure/db';
import { functions } from '../../firebaseConfig';
import { httpsCallable } from 'firebase/functions';

export interface UserRoleMap {
    [email: string]: 'admin' | 'nurse_hospital' | 'doctor_urgency' | 'viewer';
}

/**
 * Service for managing user roles dynamically via Firestore.
 */
export const roleService = {
    /**
     * Fetch all configured roles from Firestore.
     */
    async getRoles(): Promise<UserRoleMap> {
        try {
            const data = await db.getDoc<UserRoleMap>('config', 'roles');
            return data || {};
        } catch (error) {
            console.error('[RoleService] Failed to fetch roles:', error);
            throw error;
        }
    },

    /**
     * Add or Update a role for a specific email.
     */
    async setRole(email: string, role: string): Promise<void> {
        try {
            const cleanEmail = email.toLowerCase().trim();

            // We fetch the entire map, modify it locally, and replace it.
            // This is 100% safe against Firestore dot-notation (splitting emails into nested objects).
            const currentRoles = await this.getRoles();
            const updatedRoles = { ...currentRoles, [cleanEmail]: role as any };

            await db.setDoc('config', 'roles', updatedRoles);
            console.log(`[RoleService] Successfully updated roles map. Added ${cleanEmail}`);
        } catch (error) {
            console.error(`[RoleService] Failed to set role for ${email}:`, error);
            throw error;
        }
    },

    /**
     * Remove a role configuration (User becomes unauthorized unless in hardcoded list).
     */
    async removeRole(email: string): Promise<void> {
        try {
            const cleanEmail = email.toLowerCase().trim();

            const currentRoles = await this.getRoles();
            if (currentRoles[cleanEmail] !== undefined || this.hasNestedProperty(currentRoles, cleanEmail)) {
                const updatedRoles = { ...currentRoles };
                delete updatedRoles[cleanEmail];

                // Also clean up any truncated/nested garbage if it exists
                const truncated = cleanEmail.split('.')[0];
                if (updatedRoles[truncated]) delete updatedRoles[truncated];

                await db.setDoc('config', 'roles', updatedRoles);
                console.log(`[RoleService] Successfully removed role for ${cleanEmail}`);
            }
        } catch (error) {
            console.error(`[RoleService] Failed to remove role for ${email}:`, error);
            throw error;
        }
    },

    /** Helper to check if a key exists even if it was nested by mistake */
    hasNestedProperty(obj: any, key: string): boolean {
        return key in obj;
    },

    /**
     * Force sync a user's role by calling the Cloud Function.
     * Useful when changing a role for a user who is already authorized.
     */
    async forceSyncUser(email: string, role: string): Promise<any> {
        const setUserRole = httpsCallable(functions, 'setUserRole');
        return setUserRole({ email, role });
    }
};
