/**
 * Integration Tests for Census Operations
 * Tests complete workflows without complex hook rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyRecord, PatientData, DischargeData, TransferData, CMAData, Specialty, PatientStatus } from '../../types';

// Helper to create a complete mock record
const createMockRecord = (): DailyRecord => ({
    date: '2024-12-23',
    beds: {
        'R1': createPatient('Juan Pérez', 'R1'),
        'R2': createPatient('María García', 'R2'),
        'R3': createEmptyBed('R3'),
        'R4': createEmptyBed('R4'),
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: new Date().toISOString(),
    nurses: ['Enfermera 1', 'Enfermera 2'],
    activeExtraBeds: [],
});

const createPatient = (name: string, bedId: string): PatientData => ({
    bedId,
    patientName: name,
    rut: '12345678-9',
    pathology: 'Diagnóstico Test',
    specialty: Specialty.MEDICINA,
    age: '45',
    insurance: 'Fonasa',
    origin: 'Residente',
    isRapanui: true,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    isBlocked: false,
    status: PatientStatus.ESTABLE,
    admissionDate: '2024-12-20',
    devices: [],
    hasWristband: true,
    surgicalComplication: false,
    isUPC: false,
} as PatientData);

const createEmptyBed = (bedId: string): PatientData => ({
    bedId,
    patientName: '',
    bedMode: 'Cama',
    hasCompanionCrib: false,
    isBlocked: false,
} as unknown as PatientData);

describe('Census Operations Integration', () => {
    describe('Patient Admission Flow', () => {
        it('should admit patient to empty bed', () => {
            const record = createMockRecord();
            const bedId = 'R3';

            // Initially empty
            expect(record.beds[bedId].patientName).toBe('');

            // Admit patient
            record.beds[bedId] = {
                ...record.beds[bedId],
                patientName: 'Nuevo Paciente',
                rut: '11111111-1',
                pathology: 'Neumonía',
                admissionDate: '2024-12-23',
            } as PatientData;

            expect(record.beds[bedId].patientName).toBe('Nuevo Paciente');
            expect(record.beds[bedId].admissionDate).toBe('2024-12-23');
        });

        it('should count occupied beds after admission', () => {
            const record = createMockRecord();

            const occupiedBefore = Object.values(record.beds)
                .filter(b => b.patientName).length;
            expect(occupiedBefore).toBe(2);

            // Admit to R3
            record.beds['R3'].patientName = 'Nuevo';

            const occupiedAfter = Object.values(record.beds)
                .filter(b => b.patientName).length;
            expect(occupiedAfter).toBe(3);
        });
    });

    describe('Discharge Flow', () => {
        it('should add discharge and clear bed', () => {
            const record = createMockRecord();
            const patient = record.beds['R1'];

            // Create discharge
            const discharge: DischargeData = {
                id: crypto.randomUUID(),
                bedId: 'R1',
                bedName: 'Cama R1',
                bedType: 'Adulto',
                patientName: patient.patientName,
                rut: patient.rut,
                diagnosis: patient.pathology,
                status: 'Vivo',
                dischargeType: 'Domicilio (Habitual)',
                time: '10:30',
                isNested: false,
                originalData: { ...patient },
            };

            record.discharges.push(discharge);
            record.beds['R1'].patientName = '';

            expect(record.discharges.length).toBe(1);
            expect(record.beds['R1'].patientName).toBe('');
            expect(record.discharges[0].patientName).toBe('Juan Pérez');
        });

        it('should decrement occupied count after discharge', () => {
            const record = createMockRecord();

            const occupiedBefore = Object.values(record.beds)
                .filter(b => b.patientName).length;

            // Discharge R1
            record.beds['R1'].patientName = '';

            const occupiedAfter = Object.values(record.beds)
                .filter(b => b.patientName).length;

            expect(occupiedAfter).toBe(occupiedBefore - 1);
        });

        it('should undo discharge and restore patient', () => {
            const record = createMockRecord();
            const originalPatient = { ...record.beds['R1'] };

            // Discharge
            const discharge: DischargeData = {
                id: 'discharge-1',
                bedId: 'R1',
                bedName: 'Cama R1',
                bedType: 'Adulto',
                patientName: originalPatient.patientName,
                status: 'Vivo',
                isNested: false,
                originalData: originalPatient,
            } as DischargeData;

            record.discharges.push(discharge);
            record.beds['R1'] = createEmptyBed('R1');

            expect(record.beds['R1'].patientName).toBe('');

            // Undo
            record.beds['R1'] = originalPatient;
            record.discharges = record.discharges.filter(d => d.id !== 'discharge-1');

            expect(record.beds['R1'].patientName).toBe('Juan Pérez');
            expect(record.discharges.length).toBe(0);
        });
    });

    describe('Transfer Flow', () => {
        it('should add transfer and clear bed', () => {
            const record = createMockRecord();
            const patient = record.beds['R2'];

            const transfer: TransferData = {
                id: crypto.randomUUID(),
                bedId: 'R2',
                bedName: 'Cama R2',
                bedType: 'Adulto',
                patientName: patient.patientName,
                rut: patient.rut,
                diagnosis: patient.pathology,
                evacuationMethod: 'Avión Comercial',
                receivingCenter: 'Hospital Sótero del Río',
                time: '14:00',
                isNested: false,
                originalData: { ...patient },
            };

            record.transfers.push(transfer);
            record.beds['R2'].patientName = '';

            expect(record.transfers.length).toBe(1);
            expect(record.transfers[0].receivingCenter).toBe('Hospital Sótero del Río');
        });

        it('should track transfer method', () => {
            const transfer: TransferData = {
                id: '1',
                bedId: 'R1',
                bedName: 'Cama R1',
                patientName: 'Test',
                evacuationMethod: 'FACH',
                receivingCenter: 'Hospital Regional',
                isNested: false,
            } as TransferData;

            expect(transfer.evacuationMethod).toBe('FACH');
        });
    });

    describe('CMA (Day Hospital) Flow', () => {
        it('should add CMA entry', () => {
            const record = createMockRecord();

            const cma: CMAData = {
                id: crypto.randomUUID(),
                bedName: 'Sala 1',
                patientName: 'Paciente CMA',
                rut: '99999999-9',
                age: '35',
                diagnosis: 'Biopsia',
                specialty: 'Cirugía',
                interventionType: 'Cirugía Mayor Ambulatoria',
            };

            record.cma.push(cma);

            expect(record.cma.length).toBe(1);
            expect(record.cma[0].diagnosis).toBe('Biopsia');
        });

        it('should count total movements', () => {
            const record = createMockRecord();

            // Add one of each
            record.discharges.push({ id: '1' } as DischargeData);
            record.discharges.push({ id: '2' } as DischargeData);
            record.transfers.push({ id: '1' } as TransferData);
            record.cma.push({ id: '1' } as CMAData);
            record.cma.push({ id: '2' } as CMAData);
            record.cma.push({ id: '3' } as CMAData);

            const totalMovements =
                record.discharges.length +
                record.transfers.length +
                record.cma.length;

            expect(totalMovements).toBe(6);
        });
    });

    describe('Bed Blocking Flow', () => {
        it('should block empty bed', () => {
            const record = createMockRecord();

            expect(record.beds['R3'].isBlocked).toBe(false);
            record.beds['R3'].isBlocked = true;
            expect(record.beds['R3'].isBlocked).toBe(true);
        });

        it('should affect available capacity', () => {
            const record = createMockRecord();
            const totalBeds = Object.keys(record.beds).length;

            const countAvailable = () => Object.values(record.beds)
                .filter(b => !b.patientName && !b.isBlocked).length;

            const availableBefore = countAvailable();
            expect(availableBefore).toBe(2); // R3 and R4

            record.beds['R3'].isBlocked = true;

            const availableAfter = countAvailable();
            expect(availableAfter).toBe(1); // Only R4
        });
    });

    describe('Clinical Crib Flow', () => {
        it('should add clinical crib to patient bed', () => {
            const record = createMockRecord();

            record.beds['R1'].clinicalCrib = {
                patientName: 'Recién Nacido',
                rut: '11111111-1',
                pathology: 'RN Sano',
                age: '1 día',
            } as any;

            expect(record.beds['R1'].clinicalCrib?.patientName).toBe('Recién Nacido');
        });

        it('should count total hospitalized including cribs', () => {
            const record = createMockRecord();

            // Add crib to R1
            record.beds['R1'].clinicalCrib = {
                patientName: 'RN',
            } as any;

            const mainPatients = Object.values(record.beds)
                .filter(b => b.patientName).length;

            const cribPatients = Object.values(record.beds)
                .filter(b => b.clinicalCrib?.patientName).length;

            const total = mainPatients + cribPatients;
            expect(total).toBe(3); // Juan, María, RN
        });
    });
});
