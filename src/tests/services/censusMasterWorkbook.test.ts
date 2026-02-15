import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { BEDS } from '@/constants';
import { buildCensusMasterBuffer, buildCensusMasterWorkbook } from '@/services/exporters/censusMasterWorkbook';
import { PatientStatus, Specialty, type DailyRecord, type PatientData } from '@/types';

const buildPatient = (bedId: string, patientName: string): PatientData => ({
    bedId,
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName,
    rut: '11.111.111-1',
    age: '30',
    pathology: 'Patología de prueba',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '2024-05-01',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
});

const buildRecord = (date: string, patientName: string): DailyRecord => ({
    date,
    beds: {
        [BEDS[0].id]: buildPatient(BEDS[0].id, patientName),
        [BEDS[1].id]: {
            ...buildPatient(BEDS[1].id, ''),
            patientName: '',
            rut: '',
            age: ''
        }
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T00:00:00Z`,
    nurses: [],
    activeExtraBeds: [],
});

describe('census master workbook builder', () => {
    it('creates one sheet per day sorted by date with header content intact', async () => {
        const records = [buildRecord('2024-05-02', 'Paciente Dos'), buildRecord('2024-05-01', 'Paciente Uno')];

        const workbook = await buildCensusMasterWorkbook(records);

        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['01-05-2024', '02-05-2024']);
        const firstSheet = workbook.worksheets[0];

        // Header Section
        expect(firstSheet.getCell('A1').value).toBe('CENSO CAMAS DIARIO - HOSPITAL HANGA ROA');

        // Date Section
        let foundDate = false;
        firstSheet.eachRow(row => {
            row.eachCell(cell => {
                if (typeof cell.value === 'string' && cell.value.includes('Fecha: 01-05-2024')) foundDate = true;
            });
        });
        expect(foundDate).toBe(true);

        // Census Table - specifically look for identifying text before checking row
        let censusHeaderRow = -1;
        firstSheet.eachRow((row, rowNumber) => {
            if (row.getCell(1).value === 'TABLA DE PACIENTES HOSPITALIZADOS') {
                censusHeaderRow = rowNumber + 1; // Header is next row
            }
        });
        expect(censusHeaderRow).toBeGreaterThan(0);

        const censusFirstDataRow = censusHeaderRow + 1;
        expect(firstSheet.getCell(`B${censusFirstDataRow}`).value).toBe(BEDS[0].id);

        const cellValueI = firstSheet.getCell(`I${censusFirstDataRow}`).value as string;
        expect(['01-05-2024', '30-04-2024']).toContain(cellValueI);

        // Discharges Section - Search for title
        let dischargeTitleRow = -1;
        firstSheet.eachRow((row, rowNumber) => {
            if (row.getCell(1).value === 'ALTAS DEL DÍA') dischargeTitleRow = rowNumber;
        });
        expect(dischargeTitleRow).toBeGreaterThan(0);

        const dischargeEmptyRow = dischargeTitleRow + 2;
        expect(firstSheet.getCell(`A${dischargeEmptyRow}`).value).toBe('Sin altas registradas');
    });

    it('returns a Buffer that can be reopened as Excel and preserves sheet names', async () => {
        const records = [buildRecord('2024-05-03', 'Paciente Tres')];
        const buffer = await buildCensusMasterBuffer(records);

        expect(Buffer.isBuffer(buffer)).toBe(true);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);

        expect(workbook.worksheets[0]?.name).toBe('03-05-2024');
    });
});
