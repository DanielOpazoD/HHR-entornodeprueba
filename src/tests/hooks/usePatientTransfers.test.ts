import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import { DailyRecord, PatientData } from '@/types';
import * as auditService from '@/services/admin/auditService';

// Mock dependencies
vi.mock('@/services/admin/auditService', () => ({
    logPatientTransfer: vi.fn(),
}));

vi.mock('@/services/factories/patientFactory', () => ({
    createEmptyPatient: (bedId: string) => ({
        bedId,
        patientName: '',
        rut: '',
        location: '',
    }),
}));

describe('usePatientTransfers', () => {
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
            transfers: [],
            discharges: [],
            cma: [],
        } as unknown as DailyRecord;
    });

    it('should return all transfer functions', () => {
        const { result } = renderHook(() =>
            usePatientTransfers(mockRecord, mockSaveAndUpdate)
        );

        expect(typeof result.current.addTransfer).toBe('function');
        expect(typeof result.current.updateTransfer).toBe('function');
        expect(typeof result.current.deleteTransfer).toBe('function');
        expect(typeof result.current.undoTransfer).toBe('function');
    });

    it('should not add transfer when record is null', () => {
        const { result } = renderHook(() =>
            usePatientTransfers(null, mockSaveAndUpdate)
        );

        act(() => {
            result.current.addTransfer('R1', 'Ambulance', 'Hospital X', '');
        });

        expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    });

    it('should not add transfer for empty bed', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        const { result } = renderHook(() =>
            usePatientTransfers(mockRecord, mockSaveAndUpdate)
        );

        act(() => {
            result.current.addTransfer('R2', 'Ambulance', 'Hospital X', '');
        });

        expect(mockSaveAndUpdate).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should add transfer for occupied bed', () => {
        const { result } = renderHook(() =>
            usePatientTransfers(mockRecord, mockSaveAndUpdate)
        );

        act(() => {
            result.current.addTransfer('R1', 'Ambulance', 'Hospital X', '');
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
        expect(auditService.logPatientTransfer).toHaveBeenCalled();
    });

    it('should update transfer', () => {
        const recordWithTransfer = {
            ...mockRecord,
            transfers: [{ id: 'transfer-1', patientName: 'Test', time: '' }]
        } as unknown as DailyRecord;

        const { result } = renderHook(() =>
            usePatientTransfers(recordWithTransfer, mockSaveAndUpdate)
        );

        act(() => {
            result.current.updateTransfer('transfer-1', { time: '10:00' });
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });

    it('should delete transfer', () => {
        const recordWithTransfer = {
            ...mockRecord,
            transfers: [{ id: 'transfer-1', patientName: 'Test' }]
        } as unknown as DailyRecord;

        const { result } = renderHook(() =>
            usePatientTransfers(recordWithTransfer, mockSaveAndUpdate)
        );

        act(() => {
            result.current.deleteTransfer('transfer-1');
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });
});
