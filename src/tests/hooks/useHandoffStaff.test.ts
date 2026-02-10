import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHandoffStaff } from '@/hooks/useHandoffStaff';
import { DailyRecord } from '@/types';

describe('useHandoffStaff', () => {
    const mockRecord: Partial<DailyRecord> = {
        nursesDayShift: ['Nurse A', 'Nurse B'],
        nursesNightShift: ['Nurse C', 'Nurse D'],
        handoffNightReceives: ['Nurse E'],
        tensDayShift: ['TENS 1'],
        tensNightShift: ['TENS 2'],
    };

    it('should return empty lists when record is null', () => {
        const { result } = renderHook(() => useHandoffStaff(null, 'day'));

        expect(result.current.deliversList).toEqual([]);
        expect(result.current.receivesList).toEqual([]);
        expect(result.current.tensList).toEqual([]);
    });

    it('should return day shift staff for day shift', () => {
        const { result } = renderHook(() =>
            useHandoffStaff(mockRecord as DailyRecord, 'day')
        );

        expect(result.current.deliversList).toEqual(['Nurse A', 'Nurse B']);
        expect(result.current.receivesList).toEqual(['Nurse C', 'Nurse D']);
        expect(result.current.tensList).toEqual(['TENS 1']);
    });

    it('should return night shift staff for night shift', () => {
        const { result } = renderHook(() =>
            useHandoffStaff(mockRecord as DailyRecord, 'night')
        );

        expect(result.current.deliversList).toEqual(['Nurse C', 'Nurse D']);
        expect(result.current.receivesList).toEqual(['Nurse E']);
        expect(result.current.tensList).toEqual(['TENS 2']);
    });

    it('should handle missing arrays gracefully', () => {
        const incompleteRecord: Partial<DailyRecord> = {
            nursesDayShift: ['Nurse X'],
        };

        const { result } = renderHook(() =>
            useHandoffStaff(incompleteRecord as DailyRecord, 'day')
        );

        expect(result.current.deliversList).toEqual(['Nurse X']);
        expect(result.current.receivesList).toEqual([]);
        expect(result.current.tensList).toEqual([]);
    });
});
