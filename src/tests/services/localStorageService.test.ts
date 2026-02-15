/**
 * LocalStorage Service Tests
 * Tests for local storage operations including records and demo mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getStoredRecords,
    saveRecordLocal,
    getRecordForDate,
    getAllDates,
    getPreviousDayRecord,
    getStoredNurses,
    saveStoredNurses,
    deleteRecordLocal,
    clearAllData,
    isLocalStorageAvailable,
    getDemoRecords,
    saveDemoRecord,
    getDemoRecordForDate,
    getAllDemoDates,
    deleteDemoRecord,
    clearAllDemoData,
    getPreviousDemoDayRecord,
    STORAGE_KEY,
    NURSES_STORAGE_KEY
} from '@/services/storage/localStorageService';
import { DailyRecord } from '@/types';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => delete store[key],
        clear: () => { store = {}; }
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true
});

// Helper to create a mock DailyRecord
const createMockRecord = (date: string): DailyRecord => ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: ["", ""],
    lastUpdated: new Date().toISOString(),
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    activeExtraBeds: []
});

describe('localStorageService', () => {
    beforeEach(() => {
        localStorageMock.clear();
    });

    afterEach(() => {
        localStorageMock.clear();
    });

    describe('getStoredRecords', () => {
        it('returns empty object when no data', () => {
            expect(getStoredRecords()).toEqual({});
        });

        it('returns parsed data when records exist', () => {
            const testRecords = { '2024-12-28': createMockRecord('2024-12-28') };
            localStorageMock.setItem(STORAGE_KEY, JSON.stringify(testRecords));

            const result = getStoredRecords();
            expect(result['2024-12-28']).toBeDefined();
            expect(result['2024-12-28'].date).toBe('2024-12-28');
        });

        it('returns empty object on parse error', () => {
            localStorageMock.setItem(STORAGE_KEY, 'invalid json');
            expect(getStoredRecords()).toEqual({});
        });
    });

    describe('saveRecordLocal', () => {
        it('saves record to localStorage', () => {
            const record = createMockRecord('2024-12-28');
            saveRecordLocal(record);

            const stored = JSON.parse(localStorageMock.getItem(STORAGE_KEY) || '{}');
            expect(stored['2024-12-28']).toBeDefined();
        });

        it('appends to existing records', () => {
            saveRecordLocal(createMockRecord('2024-12-27'));
            saveRecordLocal(createMockRecord('2024-12-28'));

            const stored = getStoredRecords();
            expect(Object.keys(stored)).toHaveLength(2);
        });
    });

    describe('getRecordForDate', () => {
        it('returns null when record does not exist', () => {
            expect(getRecordForDate('2024-12-28')).toBeNull();
        });

        it('returns record when it exists', () => {
            const record = createMockRecord('2024-12-28');
            saveRecordLocal(record);

            const result = getRecordForDate('2024-12-28');
            expect(result?.date).toBe('2024-12-28');
        });
    });

    describe('getAllDates', () => {
        it('returns empty array when no records', () => {
            expect(getAllDates()).toEqual([]);
        });

        it('returns dates sorted in reverse chronological order', () => {
            saveRecordLocal(createMockRecord('2024-12-25'));
            saveRecordLocal(createMockRecord('2024-12-28'));
            saveRecordLocal(createMockRecord('2024-12-26'));

            const dates = getAllDates();
            expect(dates).toEqual(['2024-12-28', '2024-12-26', '2024-12-25']);
        });
    });

    describe('getPreviousDayRecord', () => {
        it('returns null when no previous records', () => {
            saveRecordLocal(createMockRecord('2024-12-28'));
            expect(getPreviousDayRecord('2024-12-28')).toBeNull();
        });

        it('returns closest previous day record', () => {
            saveRecordLocal(createMockRecord('2024-12-25'));
            saveRecordLocal(createMockRecord('2024-12-27'));

            const result = getPreviousDayRecord('2024-12-28');
            expect(result?.date).toBe('2024-12-27');
        });
    });

    describe('Nurse Storage', () => {
        it('returns default nurses when no data', () => {
            const nurses = getStoredNurses();
            expect(nurses).toEqual(["Enfermero/a 1", "Enfermero/a 2"]);
        });

        it('saves and retrieves nurse list', () => {
            const nurses = ['Juan Pérez', 'María García'];
            saveStoredNurses(nurses);
            expect(getStoredNurses()).toEqual(nurses);
        });
    });

    describe('deleteRecordLocal', () => {
        it('removes specific record', () => {
            saveRecordLocal(createMockRecord('2024-12-27'));
            saveRecordLocal(createMockRecord('2024-12-28'));

            deleteRecordLocal('2024-12-27');

            expect(getRecordForDate('2024-12-27')).toBeNull();
            expect(getRecordForDate('2024-12-28')).not.toBeNull();
        });
    });

    describe('clearAllData', () => {
        it('removes all records and nurses', () => {
            saveRecordLocal(createMockRecord('2024-12-28'));
            saveStoredNurses(['Test Nurse']);

            clearAllData();

            expect(localStorageMock.getItem(STORAGE_KEY)).toBeNull();
            expect(localStorageMock.getItem(NURSES_STORAGE_KEY)).toBeNull();
        });
    });

    describe('isLocalStorageAvailable', () => {
        it('returns true when localStorage works', () => {
            expect(isLocalStorageAvailable()).toBe(true);
        });
    });

    describe('Demo Mode Storage', () => {
        it('getDemoRecords returns empty object when no data', () => {
            expect(getDemoRecords()).toEqual({});
        });

        it('saveDemoRecord saves to demo storage', () => {
            const record = createMockRecord('2024-12-28');
            saveDemoRecord(record);

            const result = getDemoRecordForDate('2024-12-28');
            expect(result?.date).toBe('2024-12-28');
        });

        it('getAllDemoDates returns sorted dates', () => {
            saveDemoRecord(createMockRecord('2024-12-25'));
            saveDemoRecord(createMockRecord('2024-12-28'));

            expect(getAllDemoDates()).toEqual(['2024-12-28', '2024-12-25']);
        });

        it('deleteDemoRecord removes specific demo record', () => {
            saveDemoRecord(createMockRecord('2024-12-28'));
            deleteDemoRecord('2024-12-28');

            expect(getDemoRecordForDate('2024-12-28')).toBeNull();
        });

        it('clearAllDemoData removes all demo records', () => {
            saveDemoRecord(createMockRecord('2024-12-28'));
            clearAllDemoData();

            expect(getDemoRecords()).toEqual({});
        });

        it('getPreviousDemoDayRecord returns closest previous', () => {
            saveDemoRecord(createMockRecord('2024-12-25'));
            saveDemoRecord(createMockRecord('2024-12-27'));

            const result = getPreviousDemoDayRecord('2024-12-28');
            expect(result?.date).toBe('2024-12-27');
        });
    });
});
