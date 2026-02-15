import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBedManagement } from '@/hooks/useBedManagement';
import { DailyRecord, Specialty, PatientStatus } from '@/types';

// Mock audit context
vi.mock('../../context/AuditContext', () => ({
    useAuditContext: () => ({
        logDebouncedEvent: vi.fn(),
        userId: 'test-user'
    })
}));

// Mock hook dependencies
vi.mock('../../hooks/usePatientValidation', () => ({
    usePatientValidation: () => ({
        processFieldValue: (field: string, value: any) => ({ valid: true, value })
    })
}));

vi.mock('../../hooks/useBedOperations', () => ({
    useBedOperations: () => ({
        clearPatient: vi.fn(),
        clearAllBeds: vi.fn(),
        moveOrCopyPatient: vi.fn(),
        toggleBlockBed: vi.fn(),
        updateBlockedReason: vi.fn(),
        toggleExtraBed: vi.fn()
    })
}));

vi.mock('../../hooks/useClinicalCrib', () => ({
    useClinicalCrib: () => ({
        createCrib: vi.fn(),
        removeCrib: vi.fn(),
        updateCribField: vi.fn(),
        updateCribMultiple: vi.fn(),
        updateCribCudyr: vi.fn(),
        updateCribMultipleFields: vi.fn()
    })
}));

describe('Identity-based Diagnosis Clearing', () => {
    let mockRecord: DailyRecord;
    let patchRecord: any;
    let saveAndUpdate: any;

    beforeEach(() => {
        mockRecord = {
            date: '2026-01-18',
            beds: {
                'R1': {
                    bedId: 'R1',
                    patientName: 'Patient A',
                    rut: '11.111.111-1',
                    age: '30',
                    pathology: 'Old Pathology',
                    cie10Code: 'A00',
                    cie10Description: 'Old Diagnosis',
                    specialty: Specialty.MEDICINA,
                    status: PatientStatus.ESTABLE,
                    admissionDate: '2026-01-10',
                    devices: [],
                    isBlocked: false,
                    bedMode: 'Cama',
                    hasCompanionCrib: false,
                    hasWristband: true,
                    surgicalComplication: false,
                    isUPC: false,
                    clinicalEvents: []
                } as any
            },
            lastUpdated: new Date().toISOString()
        } as unknown as DailyRecord;

        patchRecord = vi.fn().mockResolvedValue(undefined);
        saveAndUpdate = vi.fn();
    });

    it('should clear diagnosis fields when RUT changes', async () => {
        const { result } = renderHook(() => useBedManagement(mockRecord, saveAndUpdate, patchRecord));

        // Update RUT to a different one
        act(() => {
            result.current.updatePatient('R1', 'rut', '22.222.222-2');
        });

        // Check if patchRecord was called with cleared diagnosis fields
        expect(patchRecord).toHaveBeenCalledWith(expect.objectContaining({
            [`beds.R1.rut`]: '22.222.222-2',
            [`beds.R1.cie10Code`]: undefined,
            [`beds.R1.cie10Description`]: undefined,
            [`beds.R1.pathology`]: '',
            [`beds.R1.clinicalEvents`]: [],
            [`beds.R1.cudyr`]: undefined,
            [`beds.R1.deviceDetails`]: {},
            [`beds.R1.devices`]: []
        }));
    });

    it('should ALSO clear diagnosis fields when patientName changes significantly', async () => {
        const { result } = renderHook(() => useBedManagement(mockRecord, saveAndUpdate, patchRecord));

        // Update Name to a different one
        act(() => {
            result.current.updatePatient('R1', 'patientName', 'Different Patient');
        });

        // Check if patchRecord was called with cleared diagnosis fields
        expect(patchRecord).toHaveBeenCalledWith(expect.objectContaining({
            [`beds.R1.patientName`]: 'Different Patient',
            [`beds.R1.cie10Code`]: undefined,
            [`beds.R1.cie10Description`]: undefined,
            [`beds.R1.pathology`]: '',
            [`beds.R1.clinicalEvents`]: [],
            [`beds.R1.cudyr`]: undefined,
            [`beds.R1.deviceDetails`]: {},
            [`beds.R1.devices`]: []
        }));
    });
});
