import { describe, it, expect } from 'vitest';
import {
    getNurseAuthors,
    getCurrentShift,
    getAttributedAuthors,
    isSharedNursingAccount,
    SHARED_NURSING_ACCOUNT
} from '@/services/admin/attributionService';
import { DailyRecord } from '@/types';

describe('attributionService', () => {
    const mockRecord: DailyRecord = {
        date: '2025-12-28',
        nursesDayShift: ['Enfermero 1', 'Enfermero 2'],
        nursesNightShift: ['Enfermero Noche'],
        nurses: [],
        beds: {},
        activeExtraBeds: [],
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: new Date().toISOString()
    };

    describe('isSharedNursingAccount', () => {
        it('should return true for the shared official email', () => {
            expect(isSharedNursingAccount(SHARED_NURSING_ACCOUNT)).toBe(true);
        });

        it('should return false for other emails', () => {
            expect(isSharedNursingAccount('otro@gmail.com')).toBe(false);
            expect(isSharedNursingAccount(undefined)).toBe(false);
        });
    });

    describe('getCurrentShift', () => {
        it('should identify day shift correctly on a working day (starts at 08:00)', () => {
            // 2025-01-02 is a Thursday (Working Day)
            const morningHabil = new Date('2025-01-02T08:01:00');
            expect(getCurrentShift(morningHabil)).toBe('day');

            const earlyMorningHabil = new Date('2025-01-02T07:59:00');
            expect(getCurrentShift(earlyMorningHabil)).toBe('night');
        });

        it('should identify day shift correctly on a non-working day (starts at 09:00)', () => {
            // 2025-01-01 is a Holiday (Non-working Day)
            const morningInhabil = new Date('2025-01-01T09:01:00');
            expect(getCurrentShift(morningInhabil)).toBe('day');

            const morningInhabilLimit = new Date('2025-01-01T08:30:00');
            expect(getCurrentShift(morningInhabilLimit)).toBe('night');
        });

        it('should identify night shift correctly at 20:00 for both', () => {
            const nightStartHabil = new Date('2025-01-02T20:01:00');
            expect(getCurrentShift(nightStartHabil)).toBe('night');

            const nightStartInhabil = new Date('2025-01-01T20:01:00');
            expect(getCurrentShift(nightStartInhabil)).toBe('night');
        });
    });

    describe('getNurseAuthors', () => {
        it('should return day shift nurses when inferred', () => {
            // Mocking current time is complex, so we pass explicit shift to test extraction logic
            expect(getNurseAuthors(mockRecord, 'day')).toBe('Enfermero 1, Enfermero 2');
        });

        it('should return night shift nurses when inferred', () => {
            expect(getNurseAuthors(mockRecord, 'night')).toBe('Enfermero Noche');
        });

        it('should return undefined if record is null', () => {
            expect(getNurseAuthors(null)).toBeUndefined();
        });

        it('should return undefined if shift has no nurses', () => {
            const emptyRecord = { ...mockRecord, nursesDayShift: [] };
            expect(getNurseAuthors(emptyRecord, 'day')).toBeUndefined();
        });

        it('should filter out empty strings in nurses list', () => {
            const messyRecord = { ...mockRecord, nursesDayShift: ['Nurse A', '', '  ', 'Nurse B'] };
            expect(getNurseAuthors(messyRecord, 'day')).toBe('Nurse A, Nurse B');
        });
    });

    describe('getAttributedAuthors', () => {
        it('should return authors for shared account', () => {
            expect(getAttributedAuthors(SHARED_NURSING_ACCOUNT, mockRecord, 'day')).toBe('Enfermero 1, Enfermero 2');
        });

        it('should return undefined for individual account', () => {
            expect(getAttributedAuthors('personal@hospital.cl', mockRecord, 'day')).toBeUndefined();
        });
    });
});
