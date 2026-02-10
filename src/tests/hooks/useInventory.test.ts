import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInventory } from '@/hooks/useInventory';
import { DailyRecord, PatientData } from '@/types';

describe('useInventory', () => {
    it('should return default values when record is null', () => {
        const { result } = renderHook(() => useInventory(null));

        expect(result.current.occupiedCount).toBe(0);
        expect(result.current.blockedCount).toBe(0);
        expect(result.current.occupancyRate).toBe(0);
        expect(result.current.isFull).toBe(false);
        expect(result.current.occupiedBeds).toEqual([]);
        expect(result.current.blockedBeds).toEqual([]);
    });

    it('should calculate occupied beds correctly', () => {
        const mockRecord = {
            beds: {
                'R1': { bedId: 'R1', patientName: 'Patient A' } as PatientData,
                'R2': { bedId: 'R2', patientName: 'Patient B' } as PatientData,
                'R3': { bedId: 'R3', patientName: '' } as PatientData,
            }
        } as unknown as DailyRecord;

        const { result } = renderHook(() => useInventory(mockRecord));

        expect(result.current.occupiedBeds).toContain('R1');
        expect(result.current.occupiedBeds).toContain('R2');
        expect(result.current.occupiedCount).toBe(2);
    });

    it('should calculate blocked beds correctly', () => {
        const mockRecord = {
            beds: {
                'R1': { bedId: 'R1', patientName: '', isBlocked: true } as PatientData,
                'R2': { bedId: 'R2', patientName: '', isBlocked: false } as PatientData,
            }
        } as unknown as DailyRecord;

        const { result } = renderHook(() => useInventory(mockRecord));

        expect(result.current.blockedBeds).toContain('R1');
        expect(result.current.blockedCount).toBe(1);
    });

    it('should calculate free beds correctly', () => {
        const mockRecord = {
            beds: {
                'R1': { bedId: 'R1', patientName: '' } as PatientData,
                'R2': { bedId: 'R2', patientName: '' } as PatientData,
            }
        } as unknown as DailyRecord;

        const { result } = renderHook(() => useInventory(mockRecord));

        expect(result.current.freeBeds.length).toBeGreaterThan(0);
    });

    it('should handle empty beds object', () => {
        const mockRecord = { beds: {} } as DailyRecord;

        const { result } = renderHook(() => useInventory(mockRecord));

        expect(result.current.occupiedCount).toBe(0);
        expect(result.current.blockedCount).toBe(0);
    });

    it('should calculate occupancy rate correctly', () => {
        const mockRecord = {
            beds: {
                'R1': { bedId: 'R1', patientName: 'Patient A' } as PatientData,
            }
        } as unknown as DailyRecord;

        const { result } = renderHook(() => useInventory(mockRecord));

        expect(result.current.occupancyRate).toBeGreaterThan(0);
    });
});
