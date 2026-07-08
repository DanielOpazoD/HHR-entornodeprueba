import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';

import { BEDS } from '@/constants/beds';
import {
  buildCensusMasterBinary,
  buildCensusMasterBuffer,
  buildCensusMasterWorkbook,
} from '@/services/exporters/censusMasterWorkbook';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const getVisibleSheets = (workbook: ExcelJS.Workbook) =>
  workbook.worksheets.filter(sheet => sheet.state !== 'hidden');

const getVisibleDaySheets = (workbook: ExcelJS.Workbook) =>
  getVisibleSheets(workbook).filter(sheet => /^\d{2}-\d{2}-\d{4}$/.test(sheet.name));

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
      age: '',
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T00:00:00Z`,
  nurses: [],
  activeExtraBeds: [],
});

describe('census master workbook builder', () => {
  it('creates hidden census summary sheets first and keeps visible day sheets sorted', async () => {
    const records = [
      buildRecord('2024-05-02', 'Paciente Dos'),
      buildRecord('2024-05-01', 'Paciente Uno'),
    ];

    const workbook = await buildCensusMasterWorkbook(records);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'RESUMEN MAYO 2024',
      'UPC PAC MAYO 2024',
      'UPC DET',
      '01-05-2024',
      '02-05-2024',
    ]);
    expect(workbook.worksheets.slice(0, 3).map(sheet => sheet.state)).toEqual([
      'hidden',
      'visible',
      'visible',
    ]);
    expect(workbook.views[0]).toEqual(
      expect.objectContaining({
        firstSheet: 4,
        activeTab: 4,
        visibility: 'visible',
      })
    );

    const firstDaySheet = getVisibleDaySheets(workbook)[0];

    // Header Section
    expect(firstDaySheet?.getCell('A1').value).toBe('CENSO CAMAS DIARIO - HOSPITAL HANGA ROA');

    // Date Section
    let foundDate = false;
    firstDaySheet?.eachRow(row => {
      row.eachCell(cell => {
        if (typeof cell.value === 'string' && cell.value.includes('Fecha: 01-05-2024'))
          foundDate = true;
      });
    });
    expect(foundDate).toBe(true);

    // Census Table - specifically look for identifying text before checking row
    let censusHeaderRow = -1;
    firstDaySheet?.eachRow((row, rowNumber) => {
      if (row.getCell(1).value === 'TABLA DE PACIENTES HOSPITALIZADOS') {
        censusHeaderRow = rowNumber + 1; // Header is next row
      }
    });
    expect(censusHeaderRow).toBeGreaterThan(0);

    const censusFirstDataRow = censusHeaderRow + 1;
    expect(firstDaySheet?.getCell(`B${censusFirstDataRow}`).value).toBe(BEDS[0].id);

    const cellValueI = firstDaySheet?.getCell(`I${censusFirstDataRow}`).value as string;
    expect(['01-05-2024', '30-04-2024']).toContain(cellValueI);

    // Discharges Section - Search for title
    let dischargeTitleRow = -1;
    firstDaySheet?.eachRow((row, rowNumber) => {
      if (row.getCell(1).value === 'ALTAS DEL DÍA') dischargeTitleRow = rowNumber;
    });
    expect(dischargeTitleRow).toBeGreaterThan(0);

    const dischargeEmptyRow = dischargeTitleRow + 2;
    expect(firstDaySheet?.getCell(`A${dischargeEmptyRow}`).value).toBe('Sin altas registradas');
  });

  it('returns a Buffer that can be reopened as Excel and preserves sheet names', async () => {
    const records = [buildRecord('2024-05-03', 'Paciente Tres')];
    const buffer = await buildCensusMasterBuffer(records);

    expect(Buffer.isBuffer(buffer)).toBe(true);

    const workbook = new ExcelJS.Workbook();
    const loadInput = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(loadInput);

    expect(getVisibleDaySheets(workbook)[0]?.name).toBe('03-05-2024');
    expect(workbook.worksheets.slice(0, 3).map(sheet => sheet.state)).toEqual([
      'hidden',
      'visible',
      'visible',
    ]);
  });

  it('applies stable column widths to the daily census sheet', async () => {
    const records = [buildRecord('2024-05-03', 'Paciente Tres')];

    const workbook = await buildCensusMasterWorkbook(records);
    const sheet = getVisibleDaySheets(workbook)[0];

    expect(sheet?.getColumn(1).width).toBe(4);
    expect(sheet?.getColumn(4).width).toBe(24);
    expect(sheet?.getColumn(7).width).toBe(28);
    expect(sheet?.getColumn(15).width).toBe(18);
  });

  it('supports duplicated day sheets via recordLookupIndex descriptors', async () => {
    const records = [
      buildRecord('2024-05-03', 'Paciente Corte'),
      buildRecord('2024-05-03', 'Paciente Actual'),
    ];

    const workbook = await buildCensusMasterWorkbook(records, {
      sheetDescriptors: [
        {
          recordDate: '2024-05-03',
          recordLookupIndex: 0,
          sheetName: '03-05-2024 23-59',
          snapshotLabel: '23:59',
        },
        {
          recordDate: '2024-05-03',
          recordLookupIndex: 1,
          sheetName: '03-05-2024 01-10',
          snapshotLabel: 'Hora actual 01:10',
        },
      ],
    });

    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'RESUMEN MAYO 2024',
      'UPC PAC MAYO 2024',
      'UPC DET',
      '03-05-2024 23-59',
      '03-05-2024 01-10',
    ]);
  });

  it('serializes workbook structure protection into workbook.xml', async () => {
    const records = [buildRecord('2024-05-03', 'Paciente Tres')];
    const binary = await buildCensusMasterBinary(records);
    const zip = new PizZip(binary);
    const workbookXml = zip.file('xl/workbook.xml')?.asText();

    expect(workbookXml).toContain('<workbookProtection');
    expect(workbookXml).toContain('lockStructure="1"');
    expect(workbookXml).toMatch(/workbookPassword="[0-9A-F]{4}"/);
    expect(workbookXml).toContain('activeTab="3"');
    expect(workbookXml).toContain('firstSheet="3"');
  });
});
