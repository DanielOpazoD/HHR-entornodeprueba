import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBedAudit } from '@/hooks/useBedAudit';
import { useAuditContext } from '@/context/AuditContext';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { logPatientAdmission } from '@/services/admin/auditService';

vi.mock('../../context/AuditContext', () => ({
    useAuditContext: vi.fn()
}));

vi.mock('../../services/admin/attributionService', () => ({
    getAttributedAuthors: vi.fn()
}));

vi.mock('../../services/admin/auditService', () => ({
    logPatientAdmission: vi.fn()
}));

describe('useBedAudit', () => {
    const mockLogDebouncedEvent = vi.fn();
    const mockRecord = {
        date: '2026-01-19',
        beds: {
            'B1': { patientName: 'John Doe', rut: '123-4', cudyr: { mobilization: 1 } },
            'B2': { clinicalCrib: { patientName: 'Baby Doe', rut: '567-8', cudyr: { feeding: 2 } } }
        }
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAuditContext).mockReturnValue({
            logDebouncedEvent: mockLogDebouncedEvent,
            userId: 'user123'
        } as any);
    });

    it('should log patient admission when name is added', () => {
        const { result } = renderHook(() => useBedAudit(mockRecord));
        const oldPatient = { patientName: '' };

        result.current.auditPatientChange('B1', 'patientName', oldPatient as any, 'New Patient');

        expect(logPatientAdmission).toHaveBeenCalledWith('B1', 'New Patient', undefined, undefined, '2026-01-19');
    });

    it('should log PATIENT_MODIFIED when name is changed', () => {
        const { result } = renderHook(() => useBedAudit(mockRecord));
        const oldPatient = { patientName: 'Old Name', rut: '111' };

        result.current.auditPatientChange('B1', 'patientName', oldPatient as any, 'New Name');

        expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
            'PATIENT_MODIFIED', 'patient', 'B1',
            expect.objectContaining({ patientName: 'New Name' }),
            '111', '2026-01-19'
        );
    });

    it('should log device changes', () => {
        const { result } = renderHook(() => useBedAudit(mockRecord));
        const oldPatient = {
            patientName: 'John',
            deviceDetails: { 'CVP': { installationDate: '2026-01-18' } }
        };
        const newDetails = {
            'CVP': { installationDate: '2026-01-18', notes: 'Changed' }
        };

        result.current.auditPatientChange('B1', 'deviceDetails', oldPatient as any, newDetails as any);

        expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
            'PATIENT_MODIFIED', 'patient', 'B1',
            expect.objectContaining({
                changes: expect.objectContaining({
                    deviceDetails: expect.any(Object)
                })
            }),
            undefined, '2026-01-19'
        );
    });

    it('should log critical field changes', () => {
        const { result } = renderHook(() => useBedAudit(mockRecord));
        const oldPatient = { patientName: 'John', status: 'Estable' };

        result.current.auditPatientChange('B1', 'status', oldPatient as any, 'Grave');

        expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
            'PATIENT_MODIFIED', 'patient', 'B1',
            expect.objectContaining({
                changes: { status: { old: 'Estable', new: 'Grave' } }
            }),
            undefined, '2026-01-19'
        );
    });

    it('should log CUDYR changes with attributed authors', () => {
        vi.mocked(getAttributedAuthors).mockReturnValue('Author 1');
        const { result } = renderHook(() => useBedAudit(mockRecord));

        result.current.auditCudyrChange('B1', 'mobilization', 3);

        expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
            'CUDYR_MODIFIED', 'dailyRecord', '2026-01-19',
            expect.objectContaining({ value: 3, oldValue: 1 }),
            '123-4', '2026-01-19', 'Author 1'
        );
    });

    it('should log Crib CUDYR changes', () => {
        vi.mocked(getAttributedAuthors).mockReturnValue('Author 1');
        const { result } = renderHook(() => useBedAudit(mockRecord));

        result.current.auditCribCudyrChange('B2', 'feeding', 5);

        expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
            'CUDYR_MODIFIED', 'dailyRecord', '2026-01-19',
            expect.objectContaining({ patientName: 'Baby Doe', value: 5, oldValue: 2 }),
            '567-8', '2026-01-19', 'Author 1'
        );
    });
});
