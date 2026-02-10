import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNurseSignature } from '@/hooks/useNurseSignature';
import { DailyRecord } from '@/types';

describe('useNurseSignature', () => {
    it('should return empty string when record is null', () => {
        const { result } = renderHook(() => useNurseSignature(null));
        expect(result.current).toBe('');
    });

    it('should return night shift nurses when available', () => {
        const mockRecord = {
            nursesNightShift: ['Nurse A', 'Nurse B'],
            nurses: ['Nurse C']
        } as unknown as DailyRecord;

        const { result } = renderHook(() => useNurseSignature(mockRecord));
        expect(result.current).toBe('Nurse A / Nurse B');
    });

    it('should filter out empty nurse names from night shift', () => {
        const mockRecord = {
            nursesNightShift: ['Nurse A', '', '  ', 'Nurse B'],
            nurses: ['Nurse C']
        } as unknown as DailyRecord;

        const { result } = renderHook(() => useNurseSignature(mockRecord));
        expect(result.current).toBe('Nurse A / Nurse B');
    });

    it('should fall back to nurses array when night shift is empty', () => {
        const mockRecord = {
            nursesNightShift: [],
            nurses: ['Nurse C', 'Nurse D']
        } as unknown as DailyRecord;

        const { result } = renderHook(() => useNurseSignature(mockRecord));
        expect(result.current).toBe('Nurse C / Nurse D');
    });

    it('should return empty string when all nurse arrays are empty', () => {
        const mockRecord = {
            nursesNightShift: [],
            nurses: []
        } as unknown as DailyRecord;

        const { result } = renderHook(() => useNurseSignature(mockRecord));
        expect(result.current).toBe('');
    });

    it('should handle missing arrays gracefully', () => {
        const mockRecord = {} as DailyRecord;

        const { result } = renderHook(() => useNurseSignature(mockRecord));
        expect(result.current).toBe('');
    });
});
