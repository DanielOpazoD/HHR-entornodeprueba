import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHandoffVisibility } from '../../hooks/useHandoffVisibility';
import { BEDS } from '../../constants';
import * as dateUtils from '../../utils/dateUtils';

vi.mock('../../utils/dateUtils', () => ({
    isAdmittedDuringShift: vi.fn()
}));

describe('useHandoffVisibility', () => {
    const mockRecord = {
        date: '2026-01-19',
        activeExtraBeds: ['E1'],
        beds: {
            'R1': { patientName: 'Patient 1', admissionDate: '2026-01-19', admissionTime: '10:00' },
            'R2': { isBlocked: true },
            'E1': { patientName: 'Extra Patient', admissionDate: '2026-01-19', admissionTime: '11:00' },
            'E2': { patientName: 'Extra Hidden', admissionDate: '2026-01-19', admissionTime: '12:00' }
        }
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return empty visibleBeds if record is null', () => {
        const { result } = renderHook(() => useHandoffVisibility(null, 'day'));
        expect(result.current.visibleBeds).toEqual([]);
        expect(result.current.hasAnyPatients).toBe(false);
    });

    it('should filter visibleBeds based on activeExtraBeds', () => {
        const { result } = renderHook(() => useHandoffVisibility(mockRecord, 'day'));

        const normalBeds = BEDS.filter(b => !b.isExtra);
        expect(result.current.visibleBeds.length).toBe(normalBeds.length + 1); // E1 is active
        expect(result.current.visibleBeds.find(b => b.id === 'E1')).toBeDefined();
        expect(result.current.visibleBeds.find(b => b.id === 'E2')).toBeUndefined();
    });

    it('should show patient based on isAdmittedDuringShift result', () => {
        vi.mocked(dateUtils.isAdmittedDuringShift).mockReturnValue(true);
        const { result } = renderHook(() => useHandoffVisibility(mockRecord, 'day'));

        expect(result.current.shouldShowPatient('R1')).toBe(true);
        expect(dateUtils.isAdmittedDuringShift).toHaveBeenCalledWith(
            '2026-01-19', '2026-01-19', '10:00', 'day'
        );
    });

    it('should always show blocked beds', () => {
        const { result } = renderHook(() => useHandoffVisibility(mockRecord, 'day'));
        vi.clearAllMocks(); // Clear calls from hasAnyPatients computation
        expect(result.current.shouldShowPatient('R2')).toBe(true);
        expect(dateUtils.isAdmittedDuringShift).not.toHaveBeenCalled();
    });

    it('should correctly calculate hasAnyPatients', () => {
        // Case 1: No patients visible in shift
        vi.mocked(dateUtils.isAdmittedDuringShift).mockReturnValue(false);
        const { result: res1 } = renderHook(() => useHandoffVisibility({ ...mockRecord, beds: { 'R1': mockRecord.beds.R1 } }, 'day'));
        expect(res1.current.hasAnyPatients).toBe(false);

        // Case 2: Blocked bed exists
        const { result: res2 } = renderHook(() => useHandoffVisibility(mockRecord, 'day'));
        expect(res2.current.hasAnyPatients).toBe(true); // Because R2 is blocked

        // Case 3: Patient visible in shift
        vi.mocked(dateUtils.isAdmittedDuringShift).mockReturnValue(true);
        const { result: res3 } = renderHook(() => useHandoffVisibility({ ...mockRecord, beds: { 'R1': mockRecord.beds.R1 } }, 'day'));
        expect(res3.current.hasAnyPatients).toBe(true);
    });
});
