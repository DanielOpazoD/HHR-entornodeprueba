/**
 * Tests for localStorageService.ts
 * Tests localStorage operations for daily records and nurses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    saveDemoRecords,
    getDemoRecordForDate,
    getAllDemoDates,
    deleteDemoRecord,
    clearAllDemoData,
    getPreviousDemoDayRecord,
} from '@/services/storage/localStorageService';
import { DailyRecord } from '@/types';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
        clear: vi.fn(() => { store = {}; }),
        get length() { return Object.keys(store).length; },
        key: vi.fn((i: number) => Object.keys(store)[i] || null),
    };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Helper to create mock record
const createMockRecord = (date: string): DailyRecord => ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: new Date().toISOString(),
    nurses: ['Enfermera 1', 'Enfermera 2'],
    activeExtraBeds: [],
});

describe('localStorageService', () => {
    beforeEach(() => {
        localStorageMock.clear();
        vi.clearAllMocks();
    });

    describe('getStoredRecords', () => {
        it('should return empty object when no records stored', () => {
            const records = getStoredRecords();
            expect(records).toEqual({});
        });

        it('should return stored records', () => {
            const mockRecords = { '2026-01-15': createMockRecord('2026-01-15') };
            localStorageMock.setItem('hanga_roa_hospital_data', JSON.stringify(mockRecords));

            const records = getStoredRecords();
            expect(records['2026-01-15']).toBeDefined();
        });
    });

    describe('saveRecordLocal', () => {
        it('should save a record to localStorage', () => {
            const record = createMockRecord('2026-01-15');
            saveRecordLocal(record);

            expect(localStorageMock.setItem).toHaveBeenCalled();
        });

        it('should update existing record collection', () => {
            const record1 = createMockRecord('2026-01-14');
            const record2 = createMockRecord('2026-01-15');

            saveRecordLocal(record1);
            saveRecordLocal(record2);

            const records = getStoredRecords();
            expect(records['2026-01-14']).toBeDefined();
            expect(records['2026-01-15']).toBeDefined();
        });
    });

    describe('getRecordForDate', () => {
        it('should return null when record not found', () => {
            const record = getRecordForDate('2026-01-15');
            expect(record).toBeNull();
        });

        it('should return record for specific date', () => {
            const mockRecord = createMockRecord('2026-01-15');
            saveRecordLocal(mockRecord);

            const record = getRecordForDate('2026-01-15');
            expect(record?.date).toBe('2026-01-15');
        });
    });

    describe('getAllDates', () => {
        it('should return empty array when no records', () => {
            const dates = getAllDates();
            expect(dates).toEqual([]);
        });

        it('should return sorted dates descending', () => {
            saveRecordLocal(createMockRecord('2026-01-10'));
            saveRecordLocal(createMockRecord('2026-01-15'));
            saveRecordLocal(createMockRecord('2026-01-12'));

            const dates = getAllDates();
            expect(dates[0]).toBe('2026-01-15');
            expect(dates[dates.length - 1]).toBe('2026-01-10');
        });
    });

    describe('getPreviousDayRecord', () => {
        it('should return null when no previous records', () => {
            const record = getPreviousDayRecord('2026-01-15');
            expect(record).toBeNull();
        });

        it('should return closest previous day record', () => {
            saveRecordLocal(createMockRecord('2026-01-10'));
            saveRecordLocal(createMockRecord('2026-01-14'));

            const record = getPreviousDayRecord('2026-01-15');
            expect(record?.date).toBe('2026-01-14');
        });
    });

    describe('getStoredNurses', () => {
        it('should return default nurse list when no nurses stored', () => {
            const nurses = getStoredNurses();
            expect(nurses).toHaveLength(2);
            expect(nurses).toContain('Enfermero/a 1');
        });

        it('should return stored nurse list', () => {
            localStorageMock.setItem('hanga_roa_nurses_list', JSON.stringify(['Nurse 1', 'Nurse 2']));

            const nurses = getStoredNurses();
            expect(nurses).toHaveLength(2);
            expect(nurses).toContain('Nurse 1');
        });
    });

    describe('saveStoredNurses', () => {
        it('should save nurse list to localStorage', () => {
            saveStoredNurses(['Nurse A', 'Nurse B', 'Nurse C']);

            expect(localStorageMock.setItem).toHaveBeenCalled();
            const nurses = getStoredNurses();
            expect(nurses).toHaveLength(3);
        });
    });

    describe('deleteRecordLocal', () => {
        it('should delete specific record', () => {
            saveRecordLocal(createMockRecord('2026-01-14'));
            saveRecordLocal(createMockRecord('2026-01-15'));

            deleteRecordLocal('2026-01-14');

            expect(getRecordForDate('2026-01-14')).toBeNull();
            expect(getRecordForDate('2026-01-15')).not.toBeNull();
        });
    });

    describe('clearAllData', () => {
        it('should clear all localStorage data', () => {
            saveRecordLocal(createMockRecord('2026-01-15'));
            saveStoredNurses(['Nurse 1']);

            clearAllData();

            expect(localStorageMock.removeItem).toHaveBeenCalled();
        });
    });

    describe('isLocalStorageAvailable', () => {
        it('should return true when localStorage is available', () => {
            expect(isLocalStorageAvailable()).toBe(true);
        });
    });

    // Demo mode tests
    describe('getDemoRecords', () => {
        it('should return empty object when no demo records', () => {
            const records = getDemoRecords();
            expect(records).toEqual({});
        });
    });

    describe('saveDemoRecord', () => {
        it('should save demo record', () => {
            const record = createMockRecord('2026-01-15');
            saveDemoRecord(record);

            expect(localStorageMock.setItem).toHaveBeenCalled();
        });
    });

    describe('saveDemoRecords', () => {
        it('should save multiple demo records', () => {
            const records = [
                createMockRecord('2026-01-14'),
                createMockRecord('2026-01-15'),
            ];
            saveDemoRecords(records);

            expect(localStorageMock.setItem).toHaveBeenCalled();
        });
    });

    describe('getDemoRecordForDate', () => {
        it('should return null when no demo record found', () => {
            const record = getDemoRecordForDate('2026-01-15');
            expect(record).toBeNull();
        });
    });

    describe('getAllDemoDates', () => {
        it('should return empty array when no demo records', () => {
            const dates = getAllDemoDates();
            expect(dates).toEqual([]);
        });
    });

    describe('deleteDemoRecord', () => {
        it('should delete specific demo record', () => {
            saveDemoRecord(createMockRecord('2026-01-15'));
            deleteDemoRecord('2026-01-15');

            expect(getDemoRecordForDate('2026-01-15')).toBeNull();
        });
    });

    describe('clearAllDemoData', () => {
        it('should clear all demo data', () => {
            saveDemoRecord(createMockRecord('2026-01-15'));
            clearAllDemoData();

            expect(localStorageMock.removeItem).toHaveBeenCalled();
        });
    });

    describe('getPreviousDemoDayRecord', () => {
        it('should return null when no previous demo records', () => {
            const record = getPreviousDemoDayRecord('2026-01-15');
            expect(record).toBeNull();
        });
    });
});
