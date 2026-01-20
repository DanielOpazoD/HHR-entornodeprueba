/**
 * LocalStorage Service
 * Handles all localStorage operations for the application.
 * Provides a clean abstraction over browser localStorage API.
 */

import { DailyRecord } from '../../types';

import {
    saveDemoRecord as saveDemoToIndexedDB,
    clearAllDemoRecords,
    deleteDemoRecord as deleteDemoToIndexedDB,
} from './indexedDBService';

// Storage keys
export const STORAGE_KEY = 'hanga_roa_hospital_data';
export const NURSES_STORAGE_KEY = 'hanga_roa_nurses_list';

// ============================================================================
// Daily Records Storage
// ============================================================================

/**
 * Retrieves all DailyRecords stored in the local storage.
 * 
 * @returns Object mapping local ISO date strings to DailyRecord objects
 */
export const getStoredRecords = (): Record<string, DailyRecord> => {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return {};
        const data = window.localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error("Failed to load data from localStorage:", e);
        return {};
    }
};

/**
 * Saves a DailyRecord to the local storage, updating the existing record collection.
 * 
 * @param record - The DailyRecord object to save
 */
export const saveRecordLocal = (record: DailyRecord): void => {
    const allRecords = getStoredRecords();
    allRecords[record.date] = record;
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(allRecords));
    }
};

/**
 * Retrieves a DailyRecord from local storage for a specific date.
 * 
 * @param date - Date identifier in YYYY-MM-DD format
 * @returns The DailyRecord if found, null otherwise
 */
export const getRecordForDate = (date: string): DailyRecord | null => {
    const records = getStoredRecords();
    return records[date] || null;
};

/**
 * Get all available dates from localStorage.
 * 
 * @returns Array of date strings in YYYY-MM-DD format, sorted descending.
 */
export const getAllDates = (): string[] => {
    const records = getStoredRecords();
    return Object.keys(records).sort().reverse();
};

/**
 * Find the closest previous day's record relative to the provided date.
 * 
 * @param currentDate - The reference date in YYYY-MM-DD format.
 * @returns The closest previous DailyRecord or null if none exist.
 */
export const getPreviousDayRecord = (currentDate: string): DailyRecord | null => {
    const records = getStoredRecords();
    const dates = Object.keys(records).sort();

    let closestDate: string | null = null;
    for (const d of dates) {
        if (d < currentDate) {
            closestDate = d;
        } else {
            break;
        }
    }

    return closestDate ? records[closestDate] : null;
};

// ============================================================================
// Nurse List Storage
// ============================================================================

/**
 * Get the stored list of nurse names from localStorage.
 * 
 * @returns Array of nurse name strings.
 */
export const getStoredNurses = (): string[] => {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return ["Enfermero/a 1", "Enfermero/a 2"];
        const data = window.localStorage.getItem(NURSES_STORAGE_KEY);
        return data ? JSON.parse(data) : ["Enfermero/a 1", "Enfermero/a 2"];
    } catch {
        return [];
    }
};

/**
 * Save the provided nurse list to localStorage.
 * 
 * @param nurses - Array of nurse name strings to persist.
 */
export const saveStoredNurses = (nurses: string[]): void => {
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(NURSES_STORAGE_KEY, JSON.stringify(nurses));
    }
};

// ============================================================================
// Storage Utilities
// ============================================================================

/**
 * Delete a specific daily record from local storage.
 * 
 * @param date - The date identifier (YYYY-MM-DD) to remove.
 */
export const deleteRecordLocal = (date: string): void => {
    const allRecords = getStoredRecords();
    delete allRecords[date];
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(allRecords));
    }
};

/**
 * Clear all application data from localStorage
 */
export const clearAllData = (): void => {
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(NURSES_STORAGE_KEY);
    }
};

/**
 * Verifies if the browser's localStorage is available and functional.
 * 
 * @returns True if available, false otherwise.
 */
export const isLocalStorageAvailable = (): boolean => {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return false;
        const testKey = '__test__';
        window.localStorage.setItem(testKey, testKey);
        window.localStorage.removeItem(testKey);
        return true;
    } catch {
        return false;
    }
};

// ============================================================================
// Demo Mode Storage (Isolated from Production)
// ============================================================================

const DEMO_STORAGE_KEY = 'hhr_demo_records';

/**
 * Get all demo records from localStorage
 */
export const getDemoRecords = (): Record<string, DailyRecord> => {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return {};
        const data = window.localStorage.getItem(DEMO_STORAGE_KEY);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error("Failed to load demo data:", e);
        return {};
    }
};

/**
 * Save a single demo record
 */
export const saveDemoRecord = (record: DailyRecord): void => {
    saveDemoToIndexedDB(record);
    // Backward compatibility: keep in localStorage for now to avoid breaking existing users until migration
    const allRecords = getDemoRecords();
    allRecords[record.date] = record;
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(allRecords));
};

/**
 * Save multiple demo records at once
 */
export const saveDemoRecords = (records: DailyRecord[]): void => {
    records.forEach(record => {
        saveDemoToIndexedDB(record);
    });
    // Backward compatibility
    const allRecords = getDemoRecords();
    records.forEach(record => {
        allRecords[record.date] = record;
    });
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(allRecords));
    }
};

/**
 * Get demo record for a specific date
 */
export const getDemoRecordForDate = (date: string): DailyRecord | null => {
    // We already have a migrator in indexedDBService, but let's be safe
    return getDemoRecordForDateLegacy(date);
};

const getDemoRecordForDateLegacy = (date: string): DailyRecord | null => {
    const records = getDemoRecords();
    return records[date] || null;
};

/**
 * Get all demo dates
 */
export const getAllDemoDates = (): string[] => {
    const records = getDemoRecords();
    return Object.keys(records).sort().reverse();
};

/**
 * Delete a specific demo record by date
 */
export const deleteDemoRecord = (date: string): void => {
    deleteDemoToIndexedDB(date);
    const allRecords = getDemoRecords();
    delete allRecords[date];
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(allRecords));
    }
};

/**
 * Clear all demo data
 */
export const clearAllDemoData = (): void => {
    clearAllDemoRecords();
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(DEMO_STORAGE_KEY);
    }
};

/**
 * Get previous demo day record
 */
export const getPreviousDemoDayRecord = (currentDate: string): DailyRecord | null => {
    // Logic moved to IndexedDB in Repository
    return getPreviousDemoDayRecordLegacy(currentDate);
};

const getPreviousDemoDayRecordLegacy = (currentDate: string): DailyRecord | null => {
    const records = getDemoRecords();
    const dates = Object.keys(records).sort();

    let closestDate: string | null = null;
    for (const d of dates) {
        if (d < currentDate) {
            closestDate = d;
        } else {
            break;
        }
    }

    return closestDate ? records[closestDate] : null;
};
