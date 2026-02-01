/**
 * Legacy Firebase Connection (Read-Only)
 * 
 * This module provides a secondary Firebase connection to the production
 * database (hospital-hanga-roa) for reading legacy data.
 * 
 * ⚠️ IMPORTANT: This connection is READ-ONLY by design.
 * All write operations MUST go through the primary app (hhr-pruebas).
 */

import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore, collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { DailyRecord } from '@/types';
import { parseDailyRecordWithDefaults } from '@/schemas/zodSchemas';

// Production Firebase configuration (READ-ONLY)
const LEGACY_CONFIG = {
    apiKey: 'AIzaSyB0MKYu-efNbYEZnyTy7KHqWVQvBVwozwM',
    authDomain: 'hospital-hanga-roa.firebaseapp.com',
    projectId: 'hospital-hanga-roa',
    storageBucket: 'hospital-hanga-roa.firebasestorage.app',
    messagingSenderId: '955583524000',
    appId: '1:955583524000:web:78384874fe6c4a08d82dc5'
};

let legacyApp: FirebaseApp | null = null;
let legacyDb: Firestore | null = null;

/**
 * Initialize the legacy Firebase app (production, read-only)
 */
export const initLegacyFirebase = (): Firestore => {
    if (legacyDb) return legacyDb;

    try {
        legacyApp = initializeApp(LEGACY_CONFIG, 'legacy-production');
        legacyDb = getFirestore(legacyApp);
        // eslint-disable-next-line no-console
        console.log('[LegacyFirebase] ✅ Connected to hospital-hanga-roa (READ-ONLY)');
        return legacyDb;
    } catch (error) {
        console.error('[LegacyFirebase] ❌ Failed to connect to production:', error);
        throw error;
    }
};

/**
 * Get the legacy Firestore instance
 */
export const getLegacyDb = (): Firestore | null => {
    if (!legacyDb) {
        try {
            return initLegacyFirebase();
        } catch {
            return null;
        }
    }
    return legacyDb;
};

/**
 * Read a daily record from production (legacy data)
 * Returns null if not found or connection fails
 */
export const getLegacyRecord = async (date: string): Promise<DailyRecord | null> => {
    const db = getLegacyDb();
    if (!db) {
        console.warn('[LegacyFirebase] No connection available');
        return null;
    }

    try {
        // Try different possible paths for legacy data
        const possiblePaths = [
            // Current structure with hospitalId
            `hospitals/hanga_roa/dailyRecords/${date}`,
            // Alternative hospitalId formats
            `hospitals/hhr/dailyRecords/${date}`,
            `hospitals/hospital-hanga-roa/dailyRecords/${date}`,
            // Root level (no hospital nesting)
            `dailyRecords/${date}`,
            `records/${date}`
        ];

        for (const path of possiblePaths) {
            try {
                // eslint-disable-next-line no-console
                console.log(`[LegacyFirebase] 🧪 Testing path: ${path}`);
                const docRef = doc(db, path);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    // eslint-disable-next-line no-console
                    console.log(`[LegacyFirebase] 🎯 Found record at: ${path}`);
                    const data = docSnap.data();
                    return parseDailyRecordWithDefaults(data, date);
                }
            } catch (err) {
                console.warn(`[LegacyFirebase] ❌ Error testing path ${path}:`, err);
            }
        }

        // eslint-disable-next-line no-console
        console.log(`[LegacyFirebase] No legacy record found for ${date}`);
        return null;
    } catch (error) {
        console.error('[LegacyFirebase] Error reading legacy record:', error);
        return null;
    }
};

/**
 * Get all legacy records for a date range
 */
export const getLegacyRecordsRange = async (startDate: string, endDate: string): Promise<DailyRecord[]> => {
    const db = getLegacyDb();
    if (!db) return [];

    try {
        // Try different collection paths
        const possibleCollections = [
            'hospitals/hanga_roa/dailyRecords',
            'hospitals/hhr/dailyRecords',
            'dailyRecords'
        ];

        for (const collPath of possibleCollections) {
            try {
                const colRef = collection(db, collPath);
                const q = query(
                    colRef,
                    where('date', '>=', startDate),
                    where('date', '<=', endDate),
                    orderBy('date', 'asc')
                );

                const snapshot = await getDocs(q);

                if (!snapshot.empty) {
                    // eslint-disable-next-line no-console
                    console.log(`[LegacyFirebase] 📚 Found ${snapshot.size} records in ${collPath}`);
                    return snapshot.docs.map(d => parseDailyRecordWithDefaults(d.data(), d.id));
                }
            } catch {
                // Collection doesn't exist or no permission
            }
        }

        return [];
    } catch (error) {
        console.error('[LegacyFirebase] Error reading legacy range:', error);
        return [];
    }
};

/**
 * Subscribe to a legacy record in real-time (read-only)
 */
export const subscribeLegacyRecord = (
    date: string,
    callback: (record: DailyRecord | null) => void
): (() => void) => {
    const db = getLegacyDb();
    if (!db) {
        callback(null);
        return () => { };
    }

    // Default path - can be made configurable
    const docRef = doc(db, 'hospitals/hanga_roa/dailyRecords', date);

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(parseDailyRecordWithDefaults(docSnap.data(), date));
        } else {
            callback(null);
        }
    }, (error) => {
        console.error('[LegacyFirebase] Subscription error:', error);
        callback(null);
    });
};

/**
 * Check if legacy Firebase is available
 */
export const isLegacyAvailable = (): boolean => {
    return legacyDb !== null;
};

/**
 * Discover the correct path for legacy data by testing common patterns
 */
export const discoverLegacyDataPath = async (): Promise<string | null> => {
    const db = getLegacyDb();
    if (!db) return null;

    const testPaths = [
        'hospitals/hanga_roa/dailyRecords',
        'hospitals/hhr/dailyRecords',
        'hospitals/hospital-hanga-roa/dailyRecords',
        'dailyRecords',
        'records'
    ];

    for (const path of testPaths) {
        try {
            const colRef = collection(db, path);
            const q = query(colRef, orderBy('date', 'desc'));
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                // eslint-disable-next-line no-console
                console.log(`[LegacyFirebase] 🎯 Discovered data path: ${path} (${snapshot.size} records)`);
                return path;
            }
        } catch {
            // Path doesn't work, try next
        }
    }

    console.warn('[LegacyFirebase] Could not discover any valid data path');
    return null;
};
/**
 * Get the nurse catalog from production (legacy data)
 */
export const getLegacyNurseCatalog = async (): Promise<string[]> => {
    const db = getLegacyDb();
    if (!db) return [];

    const possiblePaths = [
        'hospitals/hanga_roa/settings/nurses',
        'hospitals/hhr/settings/nurses',
        'hospitals/hospital-hanga-roa/settings/nurses',
        'settings/nurses'
    ];

    for (const path of possiblePaths) {
        try {
            const docRef = doc(db, path);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                const list = (data.list as string[]) || [];
                if (list.length > 0) {
                    // console.warn(`[LegacyFirebase] 🎯 Found nurse catalog at: ${path}`);
                    return list;
                }
            }
        } catch (_error) {
            // Path not found, keep trying
        }
    }

    return [];
};

/**
 * Get the TENS catalog from production (legacy data)
 */
export const getLegacyTensCatalog = async (): Promise<string[]> => {
    const db = getLegacyDb();
    if (!db) return [];

    const possiblePaths = [
        'hospitals/hanga_roa/settings/tens',
        'hospitals/hhr/settings/tens',
        'hospitals/hospital-hanga-roa/settings/tens',
        'settings/tens'
    ];

    for (const path of possiblePaths) {
        try {
            const docRef = doc(db, path);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                const list = (data.list as string[]) || [];
                if (list.length > 0) {
                    // console.warn(`[LegacyFirebase] 🎯 Found TENS catalog at: ${path}`);
                    return list;
                }
            }
        } catch (_error) {
            // Path not found, keep trying
        }
    }

    return [];
};
