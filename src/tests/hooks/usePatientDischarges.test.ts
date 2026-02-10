import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePatientDischarges } from '@/hooks/usePatientDischarges';
import { DailyRecord, PatientData } from '@/types';
import * as auditService from '@/services/admin/auditService';

// Mock dependencies
vi.mock('@/services/admin/auditService', () => ({
    logPatientDischarge: vi.fn(),
}));

vi.mock('@/services/factories/patientFactory', () => ({
    createEmptyPatient: (bedId: string) => ({
        bedId,
        patientName: '',
        rut: '',
        location: '',
    }),
}));

describe('usePatientDischarges', () => {
    let mockRecord: DailyRecord;
    let mockSaveAndUpdate: (updatedRecord: DailyRecord) => void;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSaveAndUpdate = vi.fn();
        mockRecord = {
            date: '2024-12-28',
            beds: {
                'R1': {
                    bedId: 'R1',
                    patientName: 'Test Patient',
                    rut: '12345678-9',
                    pathology: 'Test Diagnosis',
                    age: '30',
                    location: 'Room 1',
                } as PatientData,
                'R2': {
                    bedId: 'R2',
                    patientName: '',
                    location: 'Room 2',
                } as PatientData,
            },
            discharges: [],
            transfers: [],
            cma: [],
        } as unknown as DailyRecord;
    });

    it('should return all discharge functions', () => {
        const { result } = renderHook(() =>
            usePatientDischarges(mockRecord, mockSaveAndUpdate)
        );

        expect(typeof result.current.addDischarge).toBe('function');
        expect(typeof result.current.updateDischarge).toBe('function');
        expect(typeof result.current.deleteDischarge).toBe('function');
        expect(typeof result.current.undoDischarge).toBe('function');
    });

    it('should not add discharge when record is null', () => {
        const { result } = renderHook(() =>
            usePatientDischarges(null, mockSaveAndUpdate)
        );

        act(() => {
            result.current.addDischarge('R1', 'Vivo');
        });

        expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    });

    it('should not add discharge for empty bed', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        const { result } = renderHook(() =>
            usePatientDischarges(mockRecord, mockSaveAndUpdate)
        );

        act(() => {
            result.current.addDischarge('R2', 'Vivo');
        });

        expect(mockSaveAndUpdate).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should add discharge for occupied bed', () => {
        const { result } = renderHook(() =>
            usePatientDischarges(mockRecord, mockSaveAndUpdate)
        );

        act(() => {
            result.current.addDischarge('R1', 'Vivo', undefined, 'Alta Médica');
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
        expect(auditService.logPatientDischarge).toHaveBeenCalled();
    });

    it('should update discharge', () => {
        const recordWithDischarge = {
            ...mockRecord,
            discharges: [{ id: 'discharge-1', patientName: 'Test', status: 'Vivo', time: '' }]
        } as unknown as DailyRecord;

        const { result } = renderHook(() =>
            usePatientDischarges(recordWithDischarge, mockSaveAndUpdate)
        );

        act(() => {
            result.current.updateDischarge('discharge-1', 'Fallecido');
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });

    it('should delete discharge', () => {
        const recordWithDischarge = {
            ...mockRecord,
            discharges: [{ id: 'discharge-1', patientName: 'Test' }]
        } as unknown as DailyRecord;

        const { result } = renderHook(() =>
            usePatientDischarges(recordWithDischarge, mockSaveAndUpdate)
        );

        act(() => {
            result.current.deleteDischarge('discharge-1');
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });

    it('should handle mother-only discharge', () => {
        const recordWithCrib = {
            ...mockRecord,
            beds: {
                ...mockRecord.beds,
                'R1': {
                    ...mockRecord.beds['R1'],
                    clinicalCrib: { patientName: 'Baby', rut: '98765432-1' }
                }
            }
        } as unknown as DailyRecord;

        const { result } = renderHook(() =>
            usePatientDischarges(recordWithCrib, mockSaveAndUpdate)
        );

        act(() => {
            result.current.addDischarge('R1', 'Vivo', undefined, 'Alta Médica', undefined, undefined, 'mother');
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });
});
