/**
 * Integration Tests for Census → Excel Export
 * Tests the complete flow from DailyRecord to Excel workbook generation.
 * 
 * This is a CRITICAL flow that must be protected from regressions.
 */

import { describe, it, expect } from 'vitest';
import { DailyRecord, PatientData, DischargeData, TransferData, CMAData, Specialty, PatientStatus } from '@/types';
import { buildCensusMasterWorkbook, getCensusMasterFilename } from '@/services/exporters/censusMasterWorkbook';

// ============================================================================
// Mock Data Factories
// ============================================================================

const createMockPatient = (
    bedId: string,
    name: string,
    overrides: Partial<PatientData> = {}
): PatientData => ({
    bedId,
    patientName: name,
    rut: `${Math.floor(Math.random() * 99999999)}-${Math.floor(Math.random() * 9)}`,
    pathology: 'Diagnóstico de prueba',
    specialty: Specialty.MEDICINA,
    age: String(Math.floor(Math.random() * 80) + 18),
    insurance: 'Fonasa',
    origin: 'Residente',
    isRapanui: true,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    isBlocked: false,
    status: PatientStatus.ESTABLE,
    admissionDate: '2024-12-20',
    devices: ['VVP#1'],
    hasWristband: true,
    surgicalComplication: false,
    isUPC: false,
    ...overrides
});

const createEmptyBed = (bedId: string): PatientData => ({
    bedId,
    patientName: '',
    bedMode: 'Cama',
    hasCompanionCrib: false,
    isBlocked: false,
} as unknown as PatientData);

const createMockDischarge = (
    bedId: string,
    patientName: string
): DischargeData => ({
    id: crypto.randomUUID(),
    bedId,
    bedName: `Cama ${bedId}`,
    bedType: 'UTI',
    patientName,
    rut: '12345678-9',
    diagnosis: 'Alta médica',
    status: 'Vivo',
    dischargeType: 'Domicilio (Habitual)',
    time: '10:30',
    isNested: false,
});

const createMockTransfer = (
    bedId: string,
    patientName: string,
    destination: string
): TransferData => ({
    id: crypto.randomUUID(),
    bedId,
    bedName: `Cama ${bedId}`,
    bedType: 'UTI',
    patientName,
    rut: '12345678-9',
    diagnosis: 'Traslado por complejidad',
    evacuationMethod: 'Avión FACH',
    receivingCenter: destination,
    time: '14:00',
    isNested: false,
});

const createMockCMA = (patientName: string, procedure: string): CMAData => ({
    id: crypto.randomUUID(),
    bedName: 'Sala CMA',
    patientName,
    rut: '99999999-9',
    age: '45',
    diagnosis: procedure,
    specialty: 'Cirugía',
    interventionType: 'Cirugía Mayor Ambulatoria',
});

const createMockDailyRecord = (
    date: string,
    options: {
        occupiedBeds?: number;
        discharges?: number;
        transfers?: number;
        cma?: number;
    } = {}
): DailyRecord => {
    const beds: Record<string, PatientData> = {};
    const {
        occupiedBeds = 5,
        discharges = 1,
        transfers = 0,
        cma = 2
    } = options;

    // Create 12 beds (R1-R12)
    for (let i = 1; i <= 12; i++) {
        const bedId = `R${i}`;
        if (i <= occupiedBeds) {
            beds[bedId] = createMockPatient(bedId, `Paciente ${i}`);
        } else {
            beds[bedId] = createEmptyBed(bedId);
        }
    }

    // Create discharges
    const dischargesList: DischargeData[] = [];
    for (let i = 0; i < discharges; i++) {
        dischargesList.push(createMockDischarge(`D${i + 1}`, `Alta ${i + 1}`));
    }

    // Create transfers
    const transfersList: TransferData[] = [];
    for (let i = 0; i < transfers; i++) {
        transfersList.push(createMockTransfer(`T${i + 1}`, `Traslado ${i + 1}`, 'Hospital Regional'));
    }

    // Create CMA
    const cmaList: CMAData[] = [];
    for (let i = 0; i < cma; i++) {
        cmaList.push(createMockCMA(`CMA ${i + 1}`, `Procedimiento ${i + 1}`));
    }

    return {
        date,
        beds,
        discharges: dischargesList,
        transfers: transfersList,
        cma: cmaList,
        lastUpdated: new Date().toISOString(),
        nurses: ['Enfermera Día 1', 'Enfermera Día 2'],
        nursesDayShift: ['ED1', 'ED2'],
        nursesNightShift: ['EN1', 'EN2'],
        tensDayShift: ['TD1'],
        tensNightShift: ['TN1'],
        activeExtraBeds: [],
    };
};

// ============================================================================
// Tests
// ============================================================================

describe('Census → Excel Export Integration', () => {
    describe('buildCensusMasterWorkbook', () => {
        it('should throw error when no records provided', async () => {
            await expect(buildCensusMasterWorkbook([])).rejects.toThrow(
                'No hay registros disponibles para generar el Excel maestro.'
            );
        });

        it('should generate workbook with single day record', async () => {
            const record = createMockDailyRecord('2024-12-23');

            const workbook = await buildCensusMasterWorkbook([record]);

            expect(workbook).toBeDefined();
            expect(workbook.worksheets.length).toBe(1);
            expect(workbook.worksheets[0].name).toContain('23');
        });

        it('should generate workbook with multiple days sorted', async () => {
            const records = [
                createMockDailyRecord('2024-12-25'),
                createMockDailyRecord('2024-12-23'),
                createMockDailyRecord('2024-12-24'),
            ];

            const workbook = await buildCensusMasterWorkbook(records);

            expect(workbook.worksheets.length).toBe(3);
            // Should be sorted ascending by date
            expect(workbook.worksheets[0].name).toContain('23');
            expect(workbook.worksheets[1].name).toContain('24');
            expect(workbook.worksheets[2].name).toContain('25');
        });

        it('should include all patient data in worksheet', async () => {
            const record = createMockDailyRecord('2024-12-23', {
                occupiedBeds: 3,
                discharges: 2,
                transfers: 1,
                cma: 2
            });

            const workbook = await buildCensusMasterWorkbook([record]);
            const sheet = workbook.worksheets[0];

            // Sheet should have content
            expect(sheet.rowCount).toBeGreaterThan(10);

            // Check that some cells have content
            const row1Values = sheet.getRow(1).values;
            const row5Values = sheet.getRow(5).values;
            const hasPatientData = (Array.isArray(row1Values) && row1Values.length > 0) ||
                (Array.isArray(row5Values) && row5Values.length > 0);
            expect(hasPatientData).toBe(true);
        });

        it('should handle record with no discharges/transfers/cma', async () => {
            const record = createMockDailyRecord('2024-12-23', {
                occupiedBeds: 10,
                discharges: 0,
                transfers: 0,
                cma: 0
            });

            const workbook = await buildCensusMasterWorkbook([record]);

            expect(workbook).toBeDefined();
            expect(workbook.worksheets.length).toBe(1);
        });

        it('should handle record with empty beds only', async () => {
            const record = createMockDailyRecord('2024-12-23', {
                occupiedBeds: 0,
                discharges: 0,
                transfers: 0,
                cma: 0
            });

            const workbook = await buildCensusMasterWorkbook([record]);

            expect(workbook).toBeDefined();
            // Should still create the sheet even with empty beds
            expect(workbook.worksheets.length).toBe(1);
        });

        it('should set workbook metadata', async () => {
            const record = createMockDailyRecord('2024-12-23');

            const workbook = await buildCensusMasterWorkbook([record]);

            expect(workbook.creator).toBe('Hospital Hanga Roa');
            expect(workbook.created).toBeInstanceOf(Date);
        });
    });

    describe('getCensusMasterFilename', () => {
        it('should generate correct filename format', () => {
            const filename = getCensusMasterFilename('2024-12-23');

            // Format: "Censo diario HHR DD-MM-YYYY.xlsx"
            expect(filename).toContain('2024');
            expect(filename).toContain('HHR');
            expect(filename).toContain('.xlsx');
        });

        it('should include date in DD-MM-YYYY format', () => {
            const filename = getCensusMasterFilename('2024-12-15');

            // Should include "15-12-2024"
            expect(filename).toContain('15-12-2024');
        });
    });

    describe('Full Month Export Simulation', () => {
        it('should handle 15 consecutive days export', async () => {
            const records: DailyRecord[] = [];

            for (let day = 1; day <= 15; day++) {
                const date = `2024-12-${String(day).padStart(2, '0')}`;
                records.push(createMockDailyRecord(date, {
                    occupiedBeds: 5 + (day % 5), // Varying occupancy
                    discharges: day % 3,
                    transfers: day % 4 === 0 ? 1 : 0,
                    cma: day % 2
                }));
            }

            const workbook = await buildCensusMasterWorkbook(records);

            expect(workbook.worksheets.length).toBe(15);
            // First sheet should be day 1
            expect(workbook.worksheets[0].name).toContain('1');
            // Last sheet should be day 15
            expect(workbook.worksheets[14].name).toContain('15');
        });

        it('should handle month transition correctly', async () => {
            const records = [
                createMockDailyRecord('2024-11-30'),
                createMockDailyRecord('2024-12-01'),
            ];

            const workbook = await buildCensusMasterWorkbook(records);

            expect(workbook.worksheets.length).toBe(2);
        });
    });

    describe('Edge Cases', () => {
        it('should handle patient with clinical crib', async () => {
            const record = createMockDailyRecord('2024-12-23', { occupiedBeds: 1 });

            // Add clinical crib to patient
            record.beds['R1'].clinicalCrib = {
                bedId: 'R1-crib',
                patientName: 'Bebé López',
                rut: '33333333-3',
                age: '0',
                pathology: 'RN Sano',
            } as PatientData;

            const workbook = await buildCensusMasterWorkbook([record]);

            expect(workbook).toBeDefined();
            expect(workbook.worksheets.length).toBe(1);
        });

        it('should handle blocked beds', async () => {
            const record = createMockDailyRecord('2024-12-23', { occupiedBeds: 3 });

            // Block some beds
            record.beds['R10'].isBlocked = true;
            record.beds['R11'].isBlocked = true;

            const workbook = await buildCensusMasterWorkbook([record]);

            expect(workbook).toBeDefined();
        });

        it('should handle UPC patients', async () => {
            const record = createMockDailyRecord('2024-12-23', { occupiedBeds: 2 });

            // Set UPC flag on patient
            record.beds['R1'].isUPC = true;

            const workbook = await buildCensusMasterWorkbook([record]);

            expect(workbook).toBeDefined();
        });

        it('should exclude empty extra beds and include occupied ones', async () => {
            const record = createMockDailyRecord('2024-12-23', { occupiedBeds: 0 });

            // Add an extra bed with a patient
            record.beds['E1'] = createMockPatient('E1', 'Paciente Extra');

            // E2 is an extra bed but it's empty
            record.beds['E2'] = createEmptyBed('E2');

            const workbook = await buildCensusMasterWorkbook([record]);
            const sheet = workbook.worksheets[0];

            // Helper to find text in sheet
            let foundE1 = false;
            let foundE2 = false;

            sheet.eachRow(row => {
                row.eachCell(cell => {
                    const val = cell.value?.toString() || '';
                    if (val.includes('E1')) foundE1 = true;
                    if (val.includes('E2')) foundE2 = true;
                });
            });

            expect(foundE1).toBe(true);
            expect(foundE2).toBe(false);
        });
    });
});
