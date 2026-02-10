import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHandoffVisibility } from '@/hooks/useHandoffVisibility';
import { DailyRecord, PatientData } from '@/types';

// Mock constants
vi.mock('@/constants', () => ({
    BEDS: [
        { id: 'R1', name: 'Room 1', isExtra: false },
        { id: 'R2', name: 'Room 2', isExtra: false },
        { id: 'E1', name: 'Extra 1', isExtra: true },
    ],
}));

// Mock dateUtils
vi.mock('@/utils/dateUtils', () => ({
    isAdmittedDuringShift: vi.fn().mockReturnValue(true),
}));

describe('useHandoffVisibility', () => {
    const mockRecord: Partial<DailyRecord> = {
        date: '2024-12-28',
        beds: {
            'R1': { bedId: 'R1', patientName: 'Patient A', admissionDate: '2024-12-27' } as PatientData,
            'R2': { bedId: 'R2', patientName: '', isBlocked: true } as PatientData,
            'E1': { bedId: 'E1', patientName: '' } as PatientData,
        },
        activeExtraBeds: [],
    };

    it('should return empty arrays when record is null', () => {
        const { result } = renderHook(() => useHandoffVisibility(null, 'day'));

        expect(result.current.visibleBeds).toEqual([]);
        expect(result.current.hasAnyPatients).toBe(false);
    });

    it('should filter out extra beds when not active', () => {
        const { result } = renderHook(() =>
            useHandoffVisibility(mockRecord as DailyRecord, 'day')
        );

        const bedIds = result.current.visibleBeds.map(b => b.id);
        expect(bedIds).toContain('R1');
        expect(bedIds).toContain('R2');
        expect(bedIds).not.toContain('E1');
    });

    it('should include active extra beds', () => {
        const recordWithExtraBed = {
            ...mockRecord,
            activeExtraBeds: ['E1']
        } as DailyRecord;

        const { result } = renderHook(() =>
            useHandoffVisibility(recordWithExtraBed, 'day')
        );

        const bedIds = result.current.visibleBeds.map(b => b.id);
        expect(bedIds).toContain('E1');
    });

    it('should show blocked beds', () => {
        const { result } = renderHook(() =>
            useHandoffVisibility(mockRecord as DailyRecord, 'day')
        );

        expect(result.current.shouldShowPatient('R2')).toBe(true);
    });

    it('should detect if there are any patients', () => {
        const { result } = renderHook(() =>
            useHandoffVisibility(mockRecord as DailyRecord, 'day')
        );

        expect(result.current.hasAnyPatients).toBe(true);
    });

    it('should return false for empty bed', () => {
        const recordWithEmptyBed = {
            date: '2024-12-28',
            beds: {
                'R1': { bedId: 'R1', patientName: '' } as PatientData,
            },
            activeExtraBeds: [],
        } as unknown as DailyRecord;

        const { result } = renderHook(() =>
            useHandoffVisibility(recordWithEmptyBed, 'day')
        );

        expect(result.current.shouldShowPatient('R1')).toBe(false);
    });
});
