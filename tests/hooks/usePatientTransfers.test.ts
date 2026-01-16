import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import { DailyRecord, PatientData, TransferData, Specialty, PatientStatus } from '@/types';

describe('usePatientTransfers', () => {
    const mockSaveAndUpdate = vi.fn();

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
        devices: ['VVP#1'],
        surgicalComplication: false,
        isUPC: false,
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        insurance: 'Fonasa',
        origin: 'Residente',
        isRapanui: true,
        ...overrides
    });

    const createMockRecord = (
        beds: Record<string, PatientData> = {},
        transfers: TransferData[] = []
    ): DailyRecord => ({
        date: '2025-01-01',
        beds,
        discharges: [],
        transfers,
        lastUpdated: new Date().toISOString(),
        nurses: [],
        activeExtraBeds: [],
        cma: []
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('addTransfer', () => {
        it('should add a transfer and clear the patient from bed', () => {
            const patient = createMockPatient('R1');
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.addTransfer('R1', 'Avión Ambulancia', 'H. Regional Valdivia', '');
            });

            expect(mockSaveAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    beds: expect.objectContaining({
                        R1: expect.objectContaining({
                            patientName: ''
                        })
                    }),
                    transfers: expect.arrayContaining([
                        expect.objectContaining({
                            patientName: 'Test Patient',
                            evacuationMethod: 'Avión Ambulancia'
                        })
                    ])
                })
            );
        });
    });

    describe('undoTransfer', () => {
        it('should restore patient to original bed', () => {
            const originalPatient = createMockPatient('R1');
            const emptyBed = createMockPatient('R1', { patientName: '' });
            const transfer: TransferData = {
                id: 'transfer-1',
                bedId: 'R1',
                bedName: 'R1',
                bedType: 'UTI',
                patientName: 'Test Patient',
                rut: '12.345.678-9',
                diagnosis: 'Test',
                time: '',
                evacuationMethod: 'Avión',
                receivingCenter: 'Hospital',
                originalData: originalPatient
            };
            const record = createMockRecord({ R1: emptyBed }, [transfer]);

            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.undoTransfer('transfer-1');
            });

            expect(mockSaveAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    beds: expect.objectContaining({
                        R1: expect.objectContaining({
                            patientName: 'Test Patient'
                        })
                    })
                })
            );
        });
    });

    describe('addTransfer with clinical crib', () => {
        it('should transfer both mother and baby when clinical crib exists', () => {
            const patient = createMockPatient('R1', {
                patientName: 'Madre López',
                clinicalCrib: {
                    bedId: 'R1-crib',
                    patientName: 'Bebé López',
                    rut: '33.333.333-3',
                    age: '0',
                    pathology: 'RN',
                    specialty: Specialty.PEDIATRIA,
                    status: PatientStatus.ESTABLE,
                    admissionDate: '2025-01-01',
                    devices: [],
                    hasWristband: true,
                    surgicalComplication: false,
                    isUPC: false,
                    isBlocked: false,
                    bedMode: 'Cuna',
                    hasCompanionCrib: false
                }
            });
            const record = createMockRecord({ R1: patient });

            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.addTransfer('R1', 'Avión FACH', 'Hospital Sótero del Río', '');
            });

            expect(mockSaveAndUpdate).toHaveBeenCalled();
            const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;

            // Two transfers: mother + baby
            expect(updatedRecord.transfers.length).toBe(2);
            expect(updatedRecord.transfers[0].patientName).toBe('Madre López');
            expect(updatedRecord.transfers[1].patientName).toBe('Bebé López');
            expect(updatedRecord.transfers[1].isNested).toBe(true);
        });
    });

    describe('addTransfer validation', () => {
        it('should NOT transfer empty bed', () => {
            const emptyBed = createMockPatient('R1', { patientName: '' });
            const record = createMockRecord({ R1: emptyBed });

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.addTransfer('R1', 'Avión', 'Hospital', '');
            });

            expect(mockSaveAndUpdate).not.toHaveBeenCalled();
            expect(consoleSpy).toHaveBeenCalledWith('Attempted to transfer empty bed:', 'R1');
            consoleSpy.mockRestore();
        });
    });

    describe('deleteTransfer', () => {
        it('should remove a transfer from the list', () => {
            const emptyBed = createMockPatient('R1', { patientName: '' });
            const transfers: TransferData[] = [
                { id: 'transfer-1', patientName: 'Patient 1' } as TransferData,
                { id: 'transfer-2', patientName: 'Patient 2' } as TransferData
            ];
            const record = createMockRecord({ R1: emptyBed }, transfers);

            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.deleteTransfer('transfer-1');
            });

            expect(mockSaveAndUpdate).toHaveBeenCalled();
            const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;

            expect(updatedRecord.transfers.length).toBe(1);
            expect(updatedRecord.transfers[0].id).toBe('transfer-2');
        });
    });

    describe('updateTransfer', () => {
        it('should update transfer properties', () => {
            const emptyBed = createMockPatient('R1', { patientName: '' });
            const transfer: TransferData = {
                id: 'transfer-1',
                bedId: 'R1',
                bedName: 'R1',
                bedType: 'UTI',
                patientName: 'Test Patient',
                rut: '12.345.678-9',
                diagnosis: 'Test',
                time: '',
                evacuationMethod: 'Avión Comercial',
                receivingCenter: 'Hospital Regional'
            };
            const record = createMockRecord({ R1: emptyBed }, [transfer]);

            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.updateTransfer('transfer-1', {
                    evacuationMethod: 'FACH',
                    time: '14:30'
                });
            });

            expect(mockSaveAndUpdate).toHaveBeenCalled();
            const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;

            expect(updatedRecord.transfers[0].evacuationMethod).toBe('FACH');
            expect(updatedRecord.transfers[0].time).toBe('14:30');
        });
    });

    describe('undoTransfer edge cases', () => {
        it('should alert if bed is already occupied when undoing main transfer', () => {
            const transfer: TransferData = { id: 't1', bedId: 'R1', patientName: 'P1', originalData: {} } as any;
            const record = createMockRecord({ R1: createMockPatient('R1', { patientName: 'Occupant' }) }, [transfer]);

            const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.undoTransfer('t1');
            });

            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('ya está ocupada'));
            expect(mockSaveAndUpdate).not.toHaveBeenCalled();
            alertSpy.mockRestore();
        });

        it('should alert if main bed is empty when undoing nested transfer', () => {
            const transfer: TransferData = { id: 't1', bedId: 'R1', patientName: 'Baby', originalData: {}, isNested: true } as any;
            const record = createMockRecord({ R1: createMockPatient('R1', { patientName: '' }) }, [transfer]);

            const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.undoTransfer('t1');
            });

            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('primero debe estar ocupada la cama principal'));
            expect(mockSaveAndUpdate).not.toHaveBeenCalled();
            alertSpy.mockRestore();
        });

        it('should alert if crib is already occupied when undoing nested transfer', () => {
            const transfer: TransferData = { id: 't1', bedId: 'R1', patientName: 'Baby', originalData: {}, isNested: true } as any;
            const patientWithCrib = createMockPatient('R1', {
                patientName: 'Mother',
                clinicalCrib: { patientName: 'Existing Baby' } as any
            });
            const record = createMockRecord({ R1: patientWithCrib }, [transfer]);

            const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
            const { result } = renderHook(() => usePatientTransfers(record, mockSaveAndUpdate));

            act(() => {
                result.current.undoTransfer('t1');
            });

            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('ya existe una cuna clínica ocupada'));
            expect(mockSaveAndUpdate).not.toHaveBeenCalled();
            alertSpy.mockRestore();
        });
    });
});
