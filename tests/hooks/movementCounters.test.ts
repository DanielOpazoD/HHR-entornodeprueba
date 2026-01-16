import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePatientDischarges } from '../../hooks/usePatientDischarges';
import { usePatientTransfers } from '../../hooks/usePatientTransfers';
import { useCMA } from '../../hooks/useCMA';
import { DailyRecord, PatientData, Specialty, PatientStatus } from '../../types';

// Mock audit service
vi.mock('../../services/admin/auditService', () => ({
    logPatientDischarge: vi.fn().mockResolvedValue(undefined),
    logPatientTransfer: vi.fn().mockResolvedValue(undefined),
    logAuditEvent: vi.fn().mockResolvedValue(undefined),
    AUDIT_ACTION_LABELS: {},
}));

const createMockPatient = (name: string, bedId: string): PatientData => ({
    bedId,
    patientName: name,
    rut: '12345678-9',
    pathology: 'Test Diagnosis',
    age: '30',
    insurance: 'Fonasa',
    origin: 'Residente',
    isRapanui: true,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    isBlocked: false,
    admissionDate: '2024-01-01',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
});

// Helper to create mock record with patients
const createMockRecord = (dischargesCount = 0, transfersCount = 0, cmaCount = 0): DailyRecord => ({
    date: '2024-12-23',
    beds: {
        'bed-1': createMockPatient('Paciente 1', 'bed-1'),
        'bed-2': createMockPatient('Paciente 2', 'bed-2'),
        'bed-3': {
            bedId: 'bed-3',
            patientName: '',
            rut: '',
            age: '',
            admissionDate: '',
            pathology: '',
            specialty: Specialty.EMPTY,
            status: PatientStatus.EMPTY,
            hasWristband: false,
            devices: [],
            surgicalComplication: false,
            isUPC: false,
            bedMode: 'Cama',
            hasCompanionCrib: false,
            isBlocked: false
        } as PatientData,
    },
    discharges: Array(dischargesCount).fill(null).map((_, i) => ({
        id: `discharge-${i}`,
        bedId: 'bed-x',
        bedName: 'Cama X',
        bedType: 'Adulto',
        patientName: `Alta ${i}`,
        rut: '12345678-k',
        diagnosis: 'Test Diagnosis',
        status: 'Vivo' as const,
        time: '10:00',
        isNested: false,
    })),
    transfers: Array(transfersCount).fill(null).map((_, i) => ({
        id: `transfer-${i}`,
        bedId: 'bed-x',
        bedName: 'Cama X',
        bedType: 'Adulto',
        patientName: `Traslado ${i}`,
        rut: '12345678-k',
        diagnosis: 'Test Diagnosis',
        evacuationMethod: 'Avión Comercial',
        receivingCenter: 'Hospital Santiago',
        time: '10:00',
        isNested: false,
    })),
    cma: Array(cmaCount).fill(null).map((_, i) => ({
        id: `cma-${i}`,
        bedName: 'CMA-1',
        patientName: `CMA ${i}`,
        rut: '11111111-1',
        diagnosis: 'Test Diagnosis',
        specialty: 'Medicina',
        interventionType: 'Cirugía Mayor Ambulatoria',
        age: '40',
    })),
    lastUpdated: new Date().toISOString(),
    nurses: ['Nurse 1', 'Nurse 2'],
    activeExtraBeds: [],
});

describe('Movement Counters', () => {
    let saveAndUpdate: any;
    let lastSavedRecord: DailyRecord | null;

    beforeEach(() => {
        lastSavedRecord = null;
        saveAndUpdate = vi.fn((record: DailyRecord) => {
            lastSavedRecord = record;
        });
    });

    describe('Discharge Counter (Altas)', () => {
        it('should start with 0 discharges when array is empty', () => {
            const record = createMockRecord(0, 0, 0);
            expect(record.discharges.length).toBe(0);
        });

        it('should increase discharge count by 1 when adding a discharge', () => {
            const record = createMockRecord(0, 0, 0);
            const { result } = renderHook(() => usePatientDischarges(record, saveAndUpdate));

            act(() => {
                result.current.addDischarge('bed-1', 'Vivo');
            });

            expect(saveAndUpdate).toHaveBeenCalled();
            expect(lastSavedRecord?.discharges.length).toBe(1);
        });

        it('should correctly count multiple discharges', () => {
            const record = createMockRecord(3, 0, 0);
            expect(record.discharges.length).toBe(3);
        });

        it('should decrease discharge count when deleting', () => {
            const record = createMockRecord(2, 0, 0);
            const { result } = renderHook(() => usePatientDischarges(record, saveAndUpdate));

            act(() => {
                result.current.deleteDischarge('discharge-0');
            });

            expect(lastSavedRecord?.discharges.length).toBe(1);
        });

        it('should not add discharge for empty bed', () => {
            const record = createMockRecord(0, 0, 0);
            const { result } = renderHook(() => usePatientDischarges(record, saveAndUpdate));

            act(() => {
                result.current.addDischarge('bed-3', 'Vivo'); // bed-3 is empty
            });

            expect(saveAndUpdate).not.toHaveBeenCalled();
        });
    });

    describe('Transfer Counter (Traslados)', () => {
        it('should start with 0 transfers when array is empty', () => {
            const record = createMockRecord(0, 0, 0);
            expect(record.transfers.length).toBe(0);
        });

        it('should increase transfer count by 1 when adding a transfer', () => {
            const record = createMockRecord(0, 0, 0);
            const { result } = renderHook(() => usePatientTransfers(record, saveAndUpdate));

            act(() => {
                result.current.addTransfer('bed-1', 'Avión Comercial', 'Hospital Santiago', '');
            });

            expect(saveAndUpdate).toHaveBeenCalled();
            expect(lastSavedRecord?.transfers.length).toBe(1);
        });

        it('should correctly count multiple transfers', () => {
            const record = createMockRecord(0, 5, 0);
            expect(record.transfers.length).toBe(5);
        });

        it('should decrease transfer count when deleting', () => {
            const record = createMockRecord(0, 3, 0);
            const { result } = renderHook(() => usePatientTransfers(record, saveAndUpdate));

            act(() => {
                result.current.deleteTransfer('transfer-1');
            });

            expect(lastSavedRecord?.transfers.length).toBe(2);
        });

        it('should not add transfer for empty bed', () => {
            const record = createMockRecord(0, 0, 0);
            const { result } = renderHook(() => usePatientTransfers(record, saveAndUpdate));

            act(() => {
                result.current.addTransfer('bed-3', 'Avión', 'Hospital', ''); // bed-3 is empty
            });

            expect(saveAndUpdate).not.toHaveBeenCalled();
        });
    });

    describe('CMA Counter (Hospitalizaciones Diurnas)', () => {
        it('should start with 0 CMA when array is empty', () => {
            const record = createMockRecord(0, 0, 0);
            expect(record.cma.length).toBe(0);
        });

        it('should increase CMA count by 1 when adding', () => {
            const record = createMockRecord(0, 0, 0);
            const { result } = renderHook(() => useCMA(record, saveAndUpdate));

            act(() => {
                result.current.addCMA({
                    patientName: 'Nuevo CMA',
                    rut: '99999999-9',
                    diagnosis: 'Procedimiento Test',
                    age: '25',
                    specialty: 'Medicina',
                    bedName: 'CMA-1',
                    interventionType: 'Cirugía Mayor Ambulatoria'
                });
            });

            expect(saveAndUpdate).toHaveBeenCalled();
            expect(lastSavedRecord?.cma.length).toBe(1);
        });

        it('should correctly count multiple CMA entries', () => {
            const record = createMockRecord(0, 0, 4);
            expect(record.cma.length).toBe(4);
        });

        it('should decrease CMA count when deleting', () => {
            const record = createMockRecord(0, 0, 3);
            const { result } = renderHook(() => useCMA(record, saveAndUpdate));

            act(() => {
                result.current.deleteCMA('cma-0');
            });

            expect(lastSavedRecord?.cma.length).toBe(2);
        });
    });
});
