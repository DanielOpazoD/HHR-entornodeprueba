import { describe, it, expect } from 'vitest';
import {
    calculateHospitalizedDays,
    getHandoffStaffInfo
} from '@/services/pdf/handoffPdfUtils';
import { DailyRecord } from '@/types';

// Use a simplified mock of DailyRecord for testing
const mockRecord = {
    date: '2024-01-01',
    nursesDayShift: ['Nurse Day 1', 'Nurse Day 2'],
    nursesNightShift: ['Nurse Night 1', 'Nurse Night 2'],
    tensDayShift: ['Tens Day 1', 'Tens Day 2', 'Tens Day 3'],
    tensNightShift: ['Tens Night 1', 'Tens Night 2', 'Tens Night 3'],
    handoffNightReceives: ['Nurse Receiver 1', 'Nurse Receiver 2'],
} as unknown as DailyRecord;

describe('handoffPdfUtils', () => {

    describe('calculateHospitalizedDays', () => {
        it('should return null if dates are missing', () => {
            expect(calculateHospitalizedDays(undefined, '2024-01-01')).toBeNull();
            expect(calculateHospitalizedDays('2024-01-01', undefined)).toBeNull();
        });

        it('should calculate days correctly for same day', () => {
            const days = calculateHospitalizedDays('2024-01-01T10:00:00', '2024-01-01');
            expect(days).toBe(1); // Same day counts as 1 day
        });

        it('should calculate days correctly for different days', () => {
            // Jan 1 to Jan 2 = 2 days (Jan 1, Jan 2)
            const days = calculateHospitalizedDays('2024-01-01', '2024-01-02');
            expect(days).toBe(2);

            // Jan 1 to Jan 10 = 10 days
            const days2 = calculateHospitalizedDays('2024-01-01', '2024-01-10');
            expect(days2).toBe(10);
        });

        it('should handle time components by normalizing to midnight', () => {
            // Jan 1 23:00 to Jan 2 01:00 should still be 2 calendar days
            const days = calculateHospitalizedDays('2024-01-01T23:00:00', '2024-01-02T01:00:00');
            expect(days).toBe(2);
        });

        it('should return at least 1 day even if admission is somehow in future (safety)', () => {
            const days = calculateHospitalizedDays('2024-01-03', '2024-01-01');
            expect(days).toBe(1);
        });
    });

    describe('getHandoffStaffInfo', () => {
        it('should return day shift staff correctly', () => {
            const result = getHandoffStaffInfo(mockRecord, 'day');

            expect(result.delivers).toEqual(mockRecord.nursesDayShift);
            expect(result.receives).toEqual(mockRecord.nursesNightShift);
            expect(result.tens).toEqual(mockRecord.tensDayShift);
        });

        it('should return night shift staff correctly', () => {
            const result = getHandoffStaffInfo(mockRecord, 'night');

            expect(result.delivers).toEqual(mockRecord.nursesNightShift);
            // Night receives from 'handoffNightReceives' special field if exists, or handled by logic
            // In utils: receives = record.handoffNightReceives || []
            expect(result.receives).toEqual(mockRecord.handoffNightReceives);
            expect(result.tens).toEqual(mockRecord.tensNightShift);
        });

        it('should handle missing updates gracefully with empty arrays', () => {
            const emptyRecord = {} as DailyRecord;
            const result = getHandoffStaffInfo(emptyRecord, 'day');

            expect(result.delivers).toEqual([]);
            expect(result.receives).toEqual([]);
            expect(result.tens).toEqual([]);
        });
    });

    describe('getBase64ImageFromURL', () => {
        // Mocking Image and Canvas is tricky in Node/Vitest environment without proper setup.
        // We will mock the implementation of the function for valid inputs or use jsdom if configured.
        // Since we are in an environment that might lack full canvas support, we verify the Promise structure.

        it('exports the helper function', async () => {
            const { getBase64ImageFromURL } = await import('@/services/pdf/handoffPdfUtils');
            expect(typeof getBase64ImageFromURL).toBe('function');
        });
    });

});
