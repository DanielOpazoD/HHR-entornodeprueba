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
            // Note: We use the generic db provider but typed as any here to access raw Firestore methods
            // depending on implementation. If db is FirestoreProvider, it should return QuerySnapshot
            const doc = await db.collection('config').doc('roles').get();
            if (doc.exists) {
                return doc.data() as UserRoleMap;
            }
            return {};
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
            // Use set with merge to update specific fields in the map
            await db.collection('config').doc('roles').set({
                [cleanEmail]: role
            }, { merge: true });
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
            // Use deleteField to remove the key from the map
            await db.collection('config').doc('roles').update({
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
