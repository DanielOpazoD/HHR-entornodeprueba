import {
    saveCatalog,
    getCatalog
} from '../storage/indexedDBService';
import {
    saveNurseCatalogToFirestore,
    saveTensCatalogToFirestore,
    subscribeToNurseCatalog,
    subscribeToTensCatalog,
    getNurseCatalogFromFirestore,
    getTensCatalogFromFirestore,
    getProfessionalsCatalogFromFirestore,
    saveProfessionalsCatalogToFirestore,
    subscribeToProfessionalsCatalog
} from '../storage/firestoreService';
import { getLegacyNurseCatalog, getLegacyTensCatalog } from '../storage/legacyFirebaseService';
import { isFirestoreEnabled, isDemoModeActive } from '@/services/repositories/repositoryConfig';
import { ProfessionalCatalogItem } from '@/types';

export interface ICatalogRepository {
    getNurses(): Promise<string[]>;
    saveNurses(nurses: string[]): Promise<void>;
    subscribeNurses(callback: (nurses: string[]) => void): () => void;
    getTens(): Promise<string[]>;
    saveTens(tens: string[]): Promise<void>;
    subscribeTens(callback: (tens: string[]) => void): () => void;
    getProfessionals(): Promise<ProfessionalCatalogItem[]>;
    saveProfessionals(professionals: ProfessionalCatalogItem[]): Promise<void>;
    subscribeProfessionals(callback: (professionals: ProfessionalCatalogItem[]) => void): () => void;
}

// ============================================================================
// Nurses Catalog
// ============================================================================

/**
 * Retrieves the list of nurses from local storage.
 * Returns default placeholder values if no nurses have been configured.
 */
export const getNurses = async (): Promise<string[]> => {
    // 1. Try local
    const localList = await getCatalog('nurses');
    if (localList.length > 0) return localList;

    // 2. Try Beta Firestore
    if (isFirestoreEnabled() && !isDemoModeActive()) {
        try {
            const remoteList = await getNurseCatalogFromFirestore();
            if (remoteList.length > 0) {
                await saveCatalog('nurses', remoteList);
                return remoteList;
            }

            // 3. Fallback to Legacy Production
            const legacyList = await getLegacyNurseCatalog();
            if (legacyList.length > 0) {
                console.warn('[Catalog] 🎯 Migrated nurse catalog from legacy');
                await saveCatalog('nurses', legacyList);
                // Also save to Beta so it persists there
                await saveNurseCatalogToFirestore(legacyList);
                return legacyList;
            }
        } catch (err) {
            console.warn('[Catalog] Failed to fetch nurses from remote:', err);
        }
    }

    return ["Enfermero/a 1", "Enfermero/a 2"];
};

/**
 * Saves the nurses list to local storage and syncs to Firestore if enabled.
 */
export const saveNurses = async (nurses: string[]): Promise<void> => {
    await saveCatalog('nurses', nurses);
    if (isFirestoreEnabled() && !isDemoModeActive()) {
        await saveNurseCatalogToFirestore(nurses);
    }
};

/**
 * Subscribes to real-time updates for the nurses catalog from Firestore.
 */
export const subscribeNurses = (callback: (nurses: string[]) => void): (() => void) => {
    if (isDemoModeActive()) return () => { };
    return subscribeToNurseCatalog(async (nurses) => {
        await saveCatalog('nurses', nurses);
        callback(nurses);
    });
};

// ============================================================================
// TENS Catalog
// ============================================================================

/**
 * Retrieves the list of TENS from local storage.
 */
export const getTens = async (): Promise<string[]> => {
    // 1. Try local
    const localList = await getCatalog('tens');
    if (localList.length > 0) return localList;

    // 2. Try Beta Firestore
    if (isFirestoreEnabled() && !isDemoModeActive()) {
        try {
            const remoteList = await getTensCatalogFromFirestore();
            if (remoteList.length > 0) {
                await saveCatalog('tens', remoteList);
                return remoteList;
            }

            // 3. Fallback to Legacy Production
            const legacyList = await getLegacyTensCatalog();
            if (legacyList.length > 0) {
                console.warn('[Catalog] 🎯 Migrated TENS catalog from legacy');
                await saveCatalog('tens', legacyList);
                // Also save to Beta
                await saveTensCatalogToFirestore(legacyList);
                return legacyList;
            }
        } catch (err) {
            console.warn('[Catalog] Failed to fetch TENS from remote:', err);
        }
    }

    return ["TENS 1", "TENS 2", "TENS 3"];
};

/**
 * Saves the TENS list to local storage and syncs to Firestore if enabled.
 */
export const saveTens = async (tens: string[]): Promise<void> => {
    await saveCatalog('tens', tens);
    if (isFirestoreEnabled() && !isDemoModeActive()) {
        await saveTensCatalogToFirestore(tens);
    }
};

/**
 * Subscribes to real-time updates for the TENS catalog from Firestore.
 */
export const subscribeTens = (callback: (tens: string[]) => void): (() => void) => {
    if (isDemoModeActive()) return () => { };
    return subscribeToTensCatalog(async (tens) => {
        await saveCatalog('tens', tens);
        callback(tens);
    });
};

// ============================================================================
// Professionals Catalog
// ============================================================================

/**
 * Retrieves the list of professionals from local storage.
 */
export const getProfessionals = async (): Promise<ProfessionalCatalogItem[]> => {
    // 1. Try local
    const localList = await getCatalog('professionals');
    const parsedList = (localList as unknown as ProfessionalCatalogItem[]) || [];
    if (parsedList.length > 0) return parsedList;

    // 2. Try Beta Firestore
    if (isFirestoreEnabled() && !isDemoModeActive()) {
        try {
            const remoteList = await getProfessionalsCatalogFromFirestore();
            if (remoteList.length > 0) {
                await saveCatalog('professionals', remoteList as unknown as string[]);
                return remoteList;
            }
        } catch (err) {
            console.warn('[Catalog] Failed to fetch professionals from remote:', err);
        }
    }

    return [];
};

/**
 * Saves the professionals list to local storage and syncs to Firestore if enabled.
 */
export const saveProfessionals = async (professionals: ProfessionalCatalogItem[]): Promise<void> => {
    await saveCatalog('professionals', professionals as unknown as string[]);
    if (isFirestoreEnabled() && !isDemoModeActive()) {
        await saveProfessionalsCatalogToFirestore(professionals);
    }
};

/**
 * Subscribes to real-time updates for the professionals catalog from Firestore.
 */
export const subscribeProfessionals = (callback: (professionals: ProfessionalCatalogItem[]) => void): (() => void) => {
    if (isDemoModeActive()) return () => { };
    return subscribeToProfessionalsCatalog(async (professionals) => {
        await saveCatalog('professionals', professionals as unknown as string[]);
        callback(professionals);
    });
};

// ============================================================================
// Repository Object Export
// ============================================================================

export const CatalogRepository: ICatalogRepository = {
    getNurses,
    saveNurses,
    subscribeNurses,
    getTens,
    saveTens,
    subscribeTens,
    getProfessionals,
    saveProfessionals,
    subscribeProfessionals
};
