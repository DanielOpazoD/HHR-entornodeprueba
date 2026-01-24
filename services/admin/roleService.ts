import { db } from '../infrastructure/db';
import { functions } from '../../firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { deleteField } from 'firebase/firestore';

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
            // Use updateDoc to add/update the key in the map document
            await db.updateDoc('config', 'roles', {
                [cleanEmail]: role
            });
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
            // Use updateDoc with deleteField to remove the key from the map
            await db.updateDoc('config', 'roles', {
                [cleanEmail]: deleteField()
            });
        } catch (error) {
            console.error(`[RoleService] Failed to remove role for ${email}:`, error);
            throw error;
        }
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
