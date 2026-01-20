import {
    collection,
    doc,
    setDoc,
    getDoc,
    addDoc,
    query,
    getDocs,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db, firebaseReady } from '../../firebaseConfig';
import {
    CensusAccessInvitation,
    CensusAccessUser,
    CensusAccessRole,
    CensusAccessLog,
    CensusAuthorizedEmail
} from '../../types/censusAccess';

const INVITATIONS_COLLECTION = 'census-access-invitations';
const USERS_COLLECTION = 'census-access-users';
const LOGS_COLLECTION = 'census-access-logs';
const AUTHORIZED_EMAILS_COLLECTION = 'census-authorized-emails';

/**
 * Normalizes a field that could be a Firestore Timestamp or a Date
 */
const toDate = (ts: Timestamp | Date | { toDate: () => Date } | undefined | null): Date => {
    if (!ts) return new Date();
    if (ts instanceof Date) return ts;
    if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate?: unknown }).toDate === 'function') {
        return (ts as { toDate: () => Date }).toDate();
    }
    return new Date(ts as unknown as string | number);
};

/**
 * Calculates the end of the next month relative to today
 */
export const calculateDefaultExpiration = (): Date => {
    const now = new Date();
    // Go to first day of 2 months ahead, then back 1 day to get last day of next month
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
    return endOfNextMonth;
};

/**
 * Creates a new invitation link
 */
export const createInvitation = async (
    createdBy: string,
    role: CensusAccessRole = 'viewer',
    email?: string
): Promise<string> => {
    await firebaseReady;
    if (!db) throw new Error('Firestore not initialized');

    const invitation: Omit<CensusAccessInvitation, 'id'> = {
        email: email?.toLowerCase(),
        role,
        createdAt: new Date(),
        createdBy,
        expiresAt: calculateDefaultExpiration(),
        status: 'pending'
    };

    const docRef = await addDoc(collection(db, INVITATIONS_COLLECTION), invitation);
    return docRef.id;
};

/**
 * Verifies if an invitation is valid
 */
export const verifyInvitation = async (invitationId: string): Promise<CensusAccessInvitation | null> => {
    await firebaseReady;
    if (!db) throw new Error('Firestore not initialized');

    const docRef = doc(db, INVITATIONS_COLLECTION, invitationId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) return null;

    const data = docSnap.data() as CensusAccessInvitation;
    const now = new Date();
    const expiresAt = toDate(data.expiresAt);

    if (data.status !== 'pending' || expiresAt < now) {
        if (data.status === 'pending') {
            await updateDoc(docRef, { status: 'expired' });
        }
        return null;
    }

    return { ...data, id: docSnap.id };
};

/**
 * Registers a user from an invitation
 */
export const registerUserFromInvitation = async (
    invitationId: string,
    user: { uid: string; email: string; displayName: string }
): Promise<boolean> => {
    await firebaseReady;
    if (!db) throw new Error('Firestore not initialized');

    const invitation = await verifyInvitation(invitationId);
    if (!invitation) return false;

    // Check if invitation is restricted to a specific email
    if (invitation.email && invitation.email !== user.email.toLowerCase()) {
        throw new Error('Esta invitación está restringida a otro correo electrónico.');
    }

    // 1. Mark invitation as used
    await updateDoc(doc(db, INVITATIONS_COLLECTION, invitationId), {
        status: 'used',
        usedBy: user.uid,
        usedAt: serverTimestamp()
    });

    // 2. Create or update access user
    const userDoc: CensusAccessUser = {
        id: user.uid,
        email: user.email.toLowerCase(),
        displayName: user.displayName || '',
        role: invitation.role,
        createdAt: new Date(),
        createdBy: invitation.createdBy,
        expiresAt: invitation.expiresAt,
        isActive: true
    };

    await setDoc(doc(db, USERS_COLLECTION, user.uid), userDoc);
    return true;
};

/**
 * Checks if a user has active access
 */
export const checkUserAccess = async (userId: string): Promise<CensusAccessUser | null> => {
    await firebaseReady;
    if (!db) throw new Error('Firestore not initialized');

    const docRef = doc(db, USERS_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) return null;

    const data = docSnap.data() as CensusAccessUser;
    const now = new Date();
    const expiresAt = toDate(data.expiresAt);

    if (!data.isActive || expiresAt < now) {
        return null;
    }

    return data;
};

/**
 * Logs an access action
 */
export const logAccess = async (config: Omit<CensusAccessLog, 'id' | 'timestamp'>): Promise<void> => {
    try {
        await firebaseReady;
        if (!db) return;

        await addDoc(collection(db, LOGS_COLLECTION), {
            ...config,
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent
        });
    } catch (error) {
        console.error('[CensusAccess] Error logging access:', error);
    }
};

/**
 * AUTHORIZED EMAILS (WHITELIST)
 */

export const getAuthorizedEmails = async (): Promise<CensusAuthorizedEmail[]> => {
    try {
        await firebaseReady;
        if (!db) return [];
        const q = query(collection(db, AUTHORIZED_EMAILS_COLLECTION));
        const snap = await getDocs(q);
        return snap.docs.map(doc => doc.data() as CensusAuthorizedEmail);
    } catch (err) {
        console.error('Error getting authorized emails', err);
        return [];
    }
};

export const addAuthorizedEmail = async (email: string, role: CensusAccessRole, addedBy: string): Promise<void> => {
    try {
        await firebaseReady;
        if (!db) return;
        const normalizedEmail = email.toLowerCase().trim();
        await setDoc(doc(db, AUTHORIZED_EMAILS_COLLECTION, normalizedEmail), {
            email: normalizedEmail,
            role,
            addedAt: serverTimestamp(),
            addedBy
        });
    } catch (err) {
        console.error('Error adding authorized email', err);
        throw err;
    }
};

export const removeAuthorizedEmail = async (email: string): Promise<void> => {
    try {
        await firebaseReady;
        if (!db) return;
        await deleteDoc(doc(db, AUTHORIZED_EMAILS_COLLECTION, email.toLowerCase().trim()));
    } catch (err) {
        console.error('Error removing authorized email', err);
        throw err;
    }
};

export const checkEmailAuthorization = async (email: string): Promise<CensusAuthorizedEmail | null> => {
    try {
        await firebaseReady;
        if (!db) return null;
        const docRef = doc(db, AUTHORIZED_EMAILS_COLLECTION, email.toLowerCase().trim());
        const snap = await getDoc(docRef);

        if (snap.exists()) {
            return snap.data() as CensusAuthorizedEmail;
        }
        return null;
    } catch (err) {
        console.error('Error checking email authorization', err);
        return null;
    }
};

/**
 * Extends checkUserAccess to also check for email authorization
 */
export const checkUserAccessWithWhitelist = async (
    userId: string,
    email: string,
    displayName: string
): Promise<CensusAccessUser | null> => {
    try {
        // 1. Check if user already exists in access list
        const existingUser = await checkUserAccess(userId);
        if (existingUser) return existingUser;

        // 2. If not, check if their email is authorized in whitelist
        const authInfo = await checkEmailAuthorization(email);
        if (authInfo) {
            // 3. Auto-register them!
            const newUser: CensusAccessUser = {
                id: userId,
                email: email.toLowerCase(),
                displayName,
                role: authInfo.role,
                createdAt: new Date(),
                createdBy: authInfo.addedBy,
                expiresAt: calculateDefaultExpiration(),
                isActive: true
            };

            await firebaseReady;
            if (!db) return null;
            await setDoc(doc(db, USERS_COLLECTION, userId), newUser);

            return newUser;
        }

        return null;
    } catch (err) {
        console.error('Error in checkUserAccessWithWhitelist', err);
        return null;
    }
};
