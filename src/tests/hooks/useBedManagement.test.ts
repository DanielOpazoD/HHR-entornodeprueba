import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { logPatientAdmission } from '@/services/admin/auditService';
import { useBedManagement } from '@/hooks/useBedManagement';
import { DailyRecord, PatientData, Specialty, PatientStatus } from '@/types';
import { mockAuditContextValue } from '../setup';

// Mock dependencies
vi.mock('@/services/factories/patientFactory', () => ({
    createEmptyPatient: vi.fn((bedId: string) => ({
        bedId,
        patientName: '',
        rut: '',
        age: '',
        pathology: '',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '',
        hasWristband: false,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
        isBlocked: false,
        bedMode: 'Cama' as const,
        hasCompanionCrib: false
    })),
    clonePatient: vi.fn((patient: PatientData, newBedId: string) => ({
        ...patient,
        bedId: newBedId
    }))
}));

vi.mock('@/services/admin/auditService', () => ({
    logPatientAdmission: vi.fn(),
    logPatientCleared: vi.fn()
}));

vi.mock('@/services/admin/attributionService', () => ({
    getAttributedAuthors: vi.fn(() => 'Test Author')
}));

describe('useBedManagement', () => {
    const mockSaveAndUpdate = vi.fn();
    const mockPatchRecord = vi.fn().mockResolvedValue(undefined);

    const createMockPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
        bedId,
        patientName: 'Test Patient',
        rut: '12.345.678-9',
        age: '45',
        pathology: 'Test Diagnosis',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2025-01-01',
        hasWristband: true,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        ...overrides
    });

    const createMockRecord = (beds: Record<string, PatientData> = {}): DailyRecord => ({
        date: '2025-01-01',
        beds,
        discharges: [],
        transfers: [],
        lastUpdated: new Date().toISOString(),
        nurses: [],
        activeExtraBeds: [],
        cma: []
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('updatePatient', () => {
        it('should update a single patient field via patchRecord', () => {
            const patient = createMockPatient('R1');
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updatePatient('R1', 'age', '50');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.age': '50'
            });
        });

        it('should log patient admission when patientName is set for the first time', () => {
            const emptyPatient = createEmptyPatient('R1');
            const record = createMockRecord({ R1: emptyPatient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updatePatient('R1', 'patientName', 'New Name');
            });

            expect(logPatientAdmission).toHaveBeenCalled();
        });

        it('should log PATIENT_MODIFIED when patientName changes', () => {
            const patient = createMockPatient('R1', { patientName: 'Old Name' });
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updatePatient('R1', 'patientName', 'New Name');
            });

            expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalledWith(
                'PATIENT_MODIFIED',
                'patient',
                'R1',
                expect.objectContaining({ patientName: 'New Name' }),
                patient.rut,
                record.date
            );
        });

        it('should log PATIENT_MODIFIED for critical fields', () => {
            const patient = createMockPatient('R1');
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updatePatient('R1', 'status', PatientStatus.GRAVE);
            });

            expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalledWith(
                'PATIENT_MODIFIED',
                'patient',
                'R1',
                expect.objectContaining({
                    changes: expect.objectContaining({
                        status: expect.objectContaining({ old: PatientStatus.ESTABLE, new: PatientStatus.GRAVE })
                    })
                }),
                patient.rut,
                record.date
            );
        });

        it('should log PATIENT_MODIFIED when devices change', () => {
            const patient = createMockPatient('R1', {
                deviceDetails: { VMI: { installationDate: '2025-01-01' } }
            });
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updatePatient('R1', 'deviceDetails', {
                    VMI: { installationDate: '2025-01-01' },
                    CVC: { installationDate: '2025-01-02' }
                });
            });

            expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalled();
        });

        it('should handle validation failure', () => {
            const patient = createMockPatient('R1');
            const record = createMockRecord({ R1: patient });
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                // Future date should fail validation in dateUtils/validation
                result.current.updatePatient('R1', 'admissionDate', '2099-01-01');
            });

            expect(mockPatchRecord).not.toHaveBeenCalled();
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('should update multiple patient fields', () => {
            const patient = createMockPatient('R1');
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updatePatientMultiple('R1', {
                    age: '50',
                    pathology: 'New Diagnosis'
                });
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.age': '50',
                'beds.R1.pathology': 'New Diagnosis'
            });
        });
    });

    describe('updateCudyr', () => {
        it('should update Cudyr field and log modification', () => {
            const patient = createMockPatient('R1');
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updateCudyr('R1', 'changeClothes', 3);
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.cudyr.changeClothes': 3
            });
            expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalledWith(
                'CUDYR_MODIFIED',
                'dailyRecord',
                record.date,
                expect.objectContaining({ field: 'changeClothes', value: 3 }),
                patient.rut,
                record.date,
                'Test Author'
            );
        });
    });

    describe('Clinical Crib', () => {
        it('should handle updateClinicalCrib create/remove', () => {
            const record = createMockRecord({ R1: createMockPatient('R1') });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updateClinicalCrib('R1', 'create');
            });
        });

        it('should update clinical crib CUDYR', () => {
            const patient = createMockPatient('R1', {
                clinicalCrib: { patientName: 'Baby', rut: '1-1', cudyr: {} } as PatientData
            });
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updateClinicalCribCudyr('R1', 'feeding', 2);
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.clinicalCrib.cudyr.feeding': 2
            });
            expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalled();
        });

        it('should update multiple clinical crib fields', () => {
            const patient = createMockPatient('R1', {
                clinicalCrib: { patientName: 'Baby', rut: '1-1', bedMode: 'Cuna' } as PatientData
            });
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updateClinicalCribMultiple('R1', {
                    patientName: 'New Baby Name',
                    age: '1'
                });
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.clinicalCrib.patientName': 'New Baby Name',
                'beds.R1.clinicalCrib.age': '1'
            });
        });

        it('should handle updateClinicalCrib remove', () => {
            const patient = createMockPatient('R1', {
                clinicalCrib: { patientName: 'Baby', rut: '1-1' } as PatientData
            });
            const record = createMockRecord({ R1: patient });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updateClinicalCrib('R1', 'remove');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.clinicalCrib': null
            });
        });
    });

    describe('Bulk and UI Actions', () => {
        it('should handle moveOrCopyPatient move', () => {
            const patient = createMockPatient('R1');
            const targetEmpty = createMockPatient('R2', { patientName: '' });
            const record = createMockRecord({ R1: patient, R2: targetEmpty });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.moveOrCopyPatient('move', 'R1', 'R2');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith(expect.objectContaining({
                'beds.R2': expect.any(Object),
                'beds.R1': expect.objectContaining({ patientName: '' })
            }));
        });

        it('should handle moveOrCopyPatient copy', () => {
            const patient = createMockPatient('R1');
            const targetEmpty = createMockPatient('R2', { patientName: '' });
            const record = createMockRecord({ R1: patient, R2: targetEmpty });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.moveOrCopyPatient('copy', 'R1', 'R2');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith(expect.objectContaining({
                'beds.R2': expect.any(Object)
            }));
        });

        it('should handle clearAllBeds', () => {
            const record = createMockRecord({ R1: createMockPatient('R1'), R2: createMockPatient('R2') });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.clearAllBeds();
            });

            expect(mockPatchRecord).toHaveBeenCalled();
        });

        it('should toggle block bed and update reason', () => {
            const record = createMockRecord({ R1: createMockPatient('R1') });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.toggleBlockBed('R1', 'Maintenance');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.isBlocked': true,
                'beds.R1.blockedReason': 'Maintenance'
            });

            act(() => {
                result.current.updateBlockedReason('R1', 'New Reason');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.blockedReason': 'New Reason'
            });
        });

        it('should toggle extra bed', () => {
            const record = createMockRecord({ R1: createMockPatient('R1') });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.toggleExtraBed('R10');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'activeExtraBeds': expect.arrayContaining(['R10'])
            });
        });

        it('should toggle bed type', () => {
            const record = createMockRecord({ 'R1': createMockPatient('R1') });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                // 'R1' is a valid ID in BEDS
                result.current.toggleBedType('R1');
            });

            expect(mockPatchRecord).toHaveBeenCalled();
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should ignore actions when record is null', () => {
            const { result } = renderHook(() => useBedManagement(null, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updatePatient('R1', 'age', '50');
            });

            expect(mockPatchRecord).not.toHaveBeenCalled();
        });

        it('should handle dispatch errors gracefully', () => {
            const record = createMockRecord({ R1: createMockPatient('R1') });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            // Mock audit or reducer to throw
            vi.mocked(mockAuditContextValue.logDebouncedEvent).mockImplementationOnce(() => {
                throw new Error('Audit fail');
            });

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            act(() => {
                result.current.updatePatient('R1', 'age', '50');
            });

            expect(consoleSpy).toHaveBeenCalledWith('Audit logging failed', expect.any(Error));
            consoleSpy.mockRestore();
        });

        it('should handle clearPatient audit when name is present', () => {
            const patient = createMockPatient('R1', { patientName: 'John' });
            const record = createMockRecord({ R1: patient });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.clearPatient('R1');
            });

            expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalledWith(
                'PATIENT_CLEARED',
                expect.any(String),
                expect.any(String),
                expect.any(Object),
                patient.rut,
                record.date
            );
        });

        it('should handle multiple clinical crib update and audit', () => {
            const patient = createMockPatient('R1', {
                clinicalCrib: { patientName: 'Baby', rut: '1-1' } as PatientData
            });
            const record = createMockRecord({ R1: patient });
            const { result } = renderHook(() => useBedManagement(record, mockSaveAndUpdate, mockPatchRecord));

            act(() => {
                result.current.updateClinicalCribMultiple('R1', { patientName: 'New' });
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.R1.clinicalCrib.patientName': 'New'
            });
        });
    });
});
