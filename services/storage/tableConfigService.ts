/**
 * Table Configuration Service
 * Manages table column widths with Firebase sync and export/import
 */

import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { COLLECTIONS, getActiveHospitalId, HOSPITAL_COLLECTIONS, SETTINGS_DOCS, getSettingsDocPath } from '../../constants/firestorePaths';

// ============================================================================
// Types
// ============================================================================

export interface TableColumnConfig {
    actions: number; // Column for action buttons (demo, menu)
    bed: number;
    type: number;
    name: number;
    rut: number;
    age: number;
    diagnosis: number;
    specialty: number;
    status: number;
    admission: number;
    dmi: number;
    cqx: number;
    upc: number;
}

export interface TableConfig {
    columns: TableColumnConfig;
    pageMargin: number; // margin in pixels for the page container
    lastUpdated: string;
    version: number;
}

// ============================================================================
// Configuration
// ============================================================================

let firestoreEnabled = true;

export const setFirestoreEnabled = (enabled: boolean): void => {
    firestoreEnabled = enabled;
};

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_COLUMN_WIDTHS: TableColumnConfig = {
    actions: 32,
    bed: 48,
    type: 56,
    name: 110,
    rut: 96,
    age: 48,
    diagnosis: 140,
    specialty: 64,
    status: 64,
    admission: 96,
    dmi: 64,
    cqx: 32,
    upc: 32
};

export const DEFAULT_PAGE_MARGIN = 16; // px (corresponds to p-4)

export const getDefaultConfig = (): TableConfig => ({
    columns: { ...DEFAULT_COLUMN_WIDTHS },
    pageMargin: DEFAULT_PAGE_MARGIN,
    lastUpdated: new Date().toISOString(),
    version: 1
});

// ============================================================================
// Firebase Operations
// ============================================================================

const getDocRef = () =>
    doc(db, getSettingsDocPath(SETTINGS_DOCS.TABLE_CONFIG));

/**
 * Load table configuration from Firestore
 */
export const loadTableConfig = async (): Promise<TableConfig> => {
    if (!firestoreEnabled) return getDefaultConfig();
    try {
        const docSnap = await getDoc(getDocRef());
        if (docSnap.exists()) {
            const data = docSnap.data() as TableConfig;
            // Merge with defaults to handle missing columns
            return {
                ...getDefaultConfig(),
                ...data,
                columns: {
                    ...DEFAULT_COLUMN_WIDTHS,
                    ...data.columns
                },
                pageMargin: data.pageMargin ?? DEFAULT_PAGE_MARGIN
            };
        }
        return getDefaultConfig();
    } catch (error) {
        console.error('Error loading table config:', error);
        return getDefaultConfig();
    }
};

/**
 * Save table configuration to Firestore
 */
export const saveTableConfig = async (config: TableConfig): Promise<void> => {
    if (!firestoreEnabled) return;
    try {
        await setDoc(getDocRef(), {
            ...config,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error saving table config:', error);
        throw error;
    }
};

/**
 * Subscribe to table configuration changes
 */
export const subscribeToTableConfig = (
    callback: (config: TableConfig) => void
): (() => void) => {
    if (!firestoreEnabled) {
        callback(getDefaultConfig());
        return () => { };
    }
    return onSnapshot(
        getDocRef(),
        (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as TableConfig;
                callback({
                    ...getDefaultConfig(),
                    ...data,
                    columns: {
                        ...DEFAULT_COLUMN_WIDTHS,
                        ...data.columns
                    },
                    pageMargin: data.pageMargin ?? DEFAULT_PAGE_MARGIN
                });
            } else {
                callback(getDefaultConfig());
            }
        },
        (error) => {
            console.error('Error subscribing to table config:', error);
            callback(getDefaultConfig());
        }
    );
};

// ============================================================================
// Export / Import
// ============================================================================

/**
 * Export configuration to JSON file
 */
export const exportTableConfig = (config: TableConfig): void => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

/**
 * Import configuration from JSON file
 */
export const importTableConfig = (file: File): Promise<TableConfig> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const config = JSON.parse(content) as TableConfig;

                // Validate structure
                if (!config.columns || typeof config.columns !== 'object') {
                    throw new Error('Invalid config format: missing columns');
                }

                // Merge with defaults
                const validConfig: TableConfig = {
                    ...getDefaultConfig(),
                    ...config,
                    columns: {
                        ...DEFAULT_COLUMN_WIDTHS,
                        ...config.columns
                    },
                    pageMargin: config.pageMargin ?? DEFAULT_PAGE_MARGIN
                };

                resolve(validConfig);
            } catch (error) {
                reject(new Error('Invalid JSON file'));
            }
        };
        reader.onerror = () => reject(new Error('Error reading file'));
        reader.readAsText(file);
    });
};
