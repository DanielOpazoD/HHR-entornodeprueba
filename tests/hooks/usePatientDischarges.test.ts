import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePatientDischarges } from '@/hooks/usePatientDischarges';
import { DailyRecord, PatientData, PatientStatus, Specialty } from '@/types';

// Mock the factory to be 100% sure it works as expected
const createEmptyPatientMock = (bedId: string) => ({
    bedId: bedId,
    patientName: '',
    rut: '',
    pathology: '',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    isBlocked: false,
    admissionDate: '',
    devices: [],
    hasWristband: false,
    surgicalComplication: false,
    isUPC: false
});

vi.mock('@/services/factories/patientFactory', () => ({
    createEmptyPatient: vi.fn().mockImplementation((bedId: string) => createEmptyPatientMock(bedId))
}));

vi.mock('../services/factories/patientFactory', () => ({
    createEmptyPatient: vi.fn().mockImplementation((bedId: string) => createEmptyPatientMock(bedId))
}));

describe('usePatientDischarges', () => {
    const mockSaveAndUpdate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockRecord = (bedId: string): DailyRecord => {
        return {
            date: '2023-01-01',
            beds: {
                [bedId]: {
                    bedId,
                    patientName: '',
                    rut: '',
                    age: '',
                    pathology: '',
                    specialty: Specialty.MEDICINA,
                    status: PatientStatus.ESTABLE,
                    bedMode: 'Cama',
                    hasCompanionCrib: false,
                    isBlocked: false,
                    admissionDate: '',
                    devices: [],
                    hasWristband: false,
                    surgicalComplication: false,
                    isUPC: false
                }
            },
            discharges: [],
            transfers: [],
            lastUpdated: new Date().toISOString(),
            nurses: [],
            activeExtraBeds: [],
            cma: []
        };
    };

    it('should undo a discharge successfully if bed is empty', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId); // Bed is definitely empty ('')

        const originalData: PatientData = {
            bedId,
            patientName: 'Juan Perez',
            rut: '12345678-9',
            pathology: 'Test Pathology',
            specialty: Specialty.MEDICINA,
            age: '30',
            status: PatientStatus.ESTABLE,
            admissionDate: '2023-01-01',
            devices: [],
            isBlocked: false,
            bedMode: 'Cama',
            clinicalCrib: undefined,
            hasWristband: true,
            surgicalComplication: false,
            isUPC: false,
            hasCompanionCrib: false
        };

        const discharge = {
            id: 'disc-1',
            bedId: bedId,
            bedName: 'R1',
            patientName: 'Juan Perez',
            status: 'Vivo',
            originalData: originalData,
            isNested: false
        } as any;
        record.discharges = [discharge];

        const { undoDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        undoDischarge('disc-1');

        expect(mockSaveAndUpdate).toHaveBeenCalled();
        const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;

        // Final name check
        expect(updatedRecord.beds[bedId].patientName).toBe('Juan Perez');
    });

    it('should add a discharge for a patient', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId].patientName = 'María González';
        record.beds[bedId].rut = '11.111.111-1';
        record.beds[bedId].pathology = 'Neumonía';

        const { addDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        addDischarge(bedId, 'Vivo');

        expect(mockSaveAndUpdate).toHaveBeenCalled();
        const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;

        // Bed should be cleared
        expect(updatedRecord.beds[bedId].patientName).toBe('');
        // Discharge should be added
        expect(updatedRecord.discharges.length).toBe(1);
        expect(updatedRecord.discharges[0].patientName).toBe('María González');
        expect(updatedRecord.discharges[0].status).toBe('Vivo');
    });

    it('should add discharge for patient with clinical crib', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId].patientName = 'Madre López';
        record.beds[bedId].rut = '22.222.222-2';
        record.beds[bedId].clinicalCrib = {
            bedId: `${bedId}-crib`,
            patientName: 'Bebé López',
            rut: '33.333.333-3',
            age: '0',
            pathology: 'RN',
            specialty: Specialty.PEDIATRIA,
            status: PatientStatus.ESTABLE,
            admissionDate: '2023-01-01',
            devices: [],
            isBlocked: false,
            bedMode: 'Cuna',
            hasWristband: true,
            surgicalComplication: false,
            isUPC: false,
            hasCompanionCrib: false
        };

        const { addDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        addDischarge(bedId, 'Vivo', 'Vivo');

        expect(mockSaveAndUpdate).toHaveBeenCalled();
        const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;

        // Two discharges: mother + baby
        expect(updatedRecord.discharges.length).toBe(2);
        expect(updatedRecord.discharges[0].patientName).toBe('Madre López');
        expect(updatedRecord.discharges[1].patientName).toBe('Bebé López');
        expect(updatedRecord.discharges[1].isNested).toBe(true);
    });

    it('should NOT add discharge for empty bed', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId].patientName = ''; // Empty bed

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const { addDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        addDischarge(bedId, 'Vivo');

        expect(mockSaveAndUpdate).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith('Attempted to discharge empty bed:', bedId);
        consoleSpy.mockRestore();
    });

    it('should delete a discharge', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.discharges = [
            { id: 'disc-1', patientName: 'Patient 1' } as any,
            { id: 'disc-2', patientName: 'Patient 2' } as any
        ];

        const { deleteDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        deleteDischarge('disc-1');

        expect(mockSaveAndUpdate).toHaveBeenCalled();
        const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;

        expect(updatedRecord.discharges.length).toBe(1);
        expect(updatedRecord.discharges[0].id).toBe('disc-2');
    });

    it('should update a discharge', () => {
        const record = createMockRecord('R1');
        record.discharges = [{ id: 'disc-1', status: 'Vivo' } as any];
        const { updateDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        updateDischarge('disc-1', 'Fallecido');

        expect(mockSaveAndUpdate).toHaveBeenCalled();
        expect(mockSaveAndUpdate.mock.calls[0][0].discharges[0].status).toBe('Fallecido');
    });

    it('should discharge only mother and promote baby', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId] = {
            ...record.beds[bedId],
            patientName: 'Mother',
            clinicalCrib: { patientName: 'Baby', age: '0' } as any
        };

        const { addDischarge } = usePatientDischarges(record, mockSaveAndUpdate);
        addDischarge(bedId, 'Vivo', undefined, undefined, undefined, undefined, 'mother');

        const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;
        expect(updatedRecord.beds[bedId].patientName).toBe('Baby');
        expect(updatedRecord.beds[bedId].clinicalCrib).toBeUndefined();
        expect(updatedRecord.discharges).toHaveLength(1);
    });

    it('should discharge only baby', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId] = {
            ...record.beds[bedId],
            patientName: 'Mother',
            clinicalCrib: { patientName: 'Baby', age: '0' } as any
        };

        const { addDischarge } = usePatientDischarges(record, mockSaveAndUpdate);
        addDischarge(bedId, 'Vivo', 'Vivo', undefined, undefined, undefined, 'baby');

        const updatedRecord = mockSaveAndUpdate.mock.calls[0][0] as DailyRecord;
        expect(updatedRecord.beds[bedId].patientName).toBe('Mother');
        expect(updatedRecord.beds[bedId].clinicalCrib).toBeUndefined();
        expect(updatedRecord.discharges).toHaveLength(1);
    });

    it('should alert if undoing non-nested discharge but bed is occupied', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId].patientName = 'Occupant';
        const discharge = { id: 'd1', bedId, patientName: 'Original', originalData: {}, isNested: false } as any;
        record.discharges = [discharge];

        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        const { undoDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        undoDischarge('d1');

        expect(alertSpy).toHaveBeenCalled();
        expect(mockSaveAndUpdate).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('should alert if undoing nested discharge but main patient is missing', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId].patientName = ''; // Missing
        const discharge = { id: 'd1', bedId, patientName: 'Baby', originalData: {}, isNested: true } as any;
        record.discharges = [discharge];

        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        const { undoDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        undoDischarge('d1');

        expect(alertSpy).toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('should alert if undoing nested discharge but clinical crib already occupied', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId].patientName = 'Mother';
        record.beds[bedId].clinicalCrib = { patientName: 'New Baby' } as any;
        const discharge = { id: 'd1', bedId, patientName: 'Old Baby', originalData: {}, isNested: true } as any;
        record.discharges = [discharge];

        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        const { undoDischarge } = usePatientDischarges(record, mockSaveAndUpdate);

        undoDischarge('d1');

        expect(alertSpy).toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('should discharge mother and PROMOTE baby if baby exists', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId] = {
            ...record.beds[bedId],
            patientName: 'Mother',
            clinicalCrib: { patientName: 'Baby', age: '0' } as any
        };

        const { addDischarge } = usePatientDischarges(record, mockSaveAndUpdate);
        addDischarge(bedId, 'Vivo', undefined, undefined, undefined, undefined, 'mother');

        const updatedRecord = mockSaveAndUpdate.mock.calls[0][0];
        expect(updatedRecord.beds[bedId].patientName).toBe('Baby');
        expect(updatedRecord.beds[bedId].clinicalCrib).toBeUndefined();
    });

    it('should discharge mother and just clear bed if NO baby exists', () => {
        const bedId = 'R1';
        const record = createMockRecord(bedId);
        record.beds[bedId].patientName = 'Mother';
        record.beds[bedId].clinicalCrib = undefined;

        const { addDischarge } = usePatientDischarges(record, mockSaveAndUpdate);
        addDischarge(bedId, 'Vivo', undefined, undefined, undefined, undefined, 'mother');

        const updatedRecord = mockSaveAndUpdate.mock.calls[0][0];
        expect(updatedRecord.beds[bedId].patientName).toBe('');
    });
});
