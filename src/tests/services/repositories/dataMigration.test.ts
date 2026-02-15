import { describe, it, expect } from 'vitest';
import { migrateLegacyData } from '@/services/repositories/dataMigration';

describe('Data Migration Service - Staff Fields', () => {
    const mockDate = '2025-01-01';

    it('should migrate legacy nurses array to nursesDayShift', () => {
        const legacyRecord = {
            date: mockDate,
            nurses: ['Nurse A', 'Nurse B'],
            beds: {}
        } as any;

        const migrated = migrateLegacyData(legacyRecord, mockDate);

        expect(migrated.nursesDayShift).toEqual(['Nurse A', 'Nurse B']);
    });

    it('should migrate legacy nurseName to first element of nursesDayShift', () => {
        const legacyRecord = {
            date: mockDate,
            nurseName: 'Nurse Single',
            beds: {}
        } as any;

        const migrated = migrateLegacyData(legacyRecord, mockDate);

        expect(migrated.nursesDayShift?.[0]).toBe('Nurse Single');
    });

    it('should migrate legacy tens array to tensDayShift', () => {
        const legacyRecord = {
            date: mockDate,
            tens: ['TENS 1', 'TENS 2'],
            beds: {}
        } as any;

        const migrated = migrateLegacyData(legacyRecord, mockDate);

        expect(migrated.tensDayShift).toEqual(['TENS 1', 'TENS 2', '']);
    });

    it('should not overwrite existing nursesDayShift with legacy data', () => {
        const record = {
            date: mockDate,
            nurses: ['Old Nurse'],
            nursesDayShift: ['New Nurse', 'Second Nurse'],
            beds: {}
        } as any;

        const migrated = migrateLegacyData(record, mockDate);

        expect(migrated.nursesDayShift).toEqual(['New Nurse', 'Second Nurse']);
    });

    it('should handle empty/missing staff fields gracefully', () => {
        const record = {
            date: mockDate,
            beds: {}
        } as any;

        const migrated = migrateLegacyData(record, mockDate);

        expect(migrated.nursesDayShift).toEqual(['', '']);
        expect(migrated.nursesNightShift).toEqual(['', '']);
        expect(migrated.tensDayShift).toEqual(['', '', '']);
        expect(migrated.tensNightShift).toEqual(['', '', '']);
    });
});
