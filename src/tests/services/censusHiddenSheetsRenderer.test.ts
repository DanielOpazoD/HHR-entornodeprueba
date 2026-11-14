import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';

import { renderSummarySheet } from '@/services/exporters/excel/censusHiddenSummarySheet';
import {
  renderUpcDailyMatrixSheet,
  renderUpcPatientsSheet,
} from '@/services/exporters/excel/censusHiddenUpcSheets';
import type {
  SummaryDayRow,
  UpcPatientPresentation,
} from '@/services/exporters/excel/censusHiddenSheetsContracts';

const buildUpcPatient = (
  overrides: Partial<UpcPatientPresentation> = {}
): UpcPatientPresentation => ({
  key: 'patient-1',
  patientName: 'Paciente UPC',
  rut: '12.345.678-9',
  age: '45',
  diagnosis: 'Diagnóstico UPC',
  specialty: 'Med Interna',
  admissionDate: '2026-03-01',
  firstSeenDate: '2026-03-24',
  dailyRecords: [
    { date: '2026-03-24', bedCode: 'R1', classification: 'UTI' },
    { date: '2026-03-25', bedCode: 'R2', classification: 'UCI' },
  ],
  totalDays: 2,
  daysDetail: '24-03-2026\n25-03-2026',
  history: 'R1 (24-03-2026) → R2 (25-03-2026)',
  changedBed: true,
  uciDays: 1,
  utiDays: 1,
  periodLabel: 'Mixto',
  ...overrides,
});

const getSolidFillArgb = (worksheet: ExcelJS.Worksheet, address: string) => {
  const fill = worksheet.getCell(address).fill;
  return fill && 'fgColor' in fill ? fill.fgColor?.argb : undefined;
};

describe('censusHiddenSheetsRenderer', () => {
  it('renders summary sheet layout and occupancy styling', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('RESUMEN MARZO 2026');
    const rows: SummaryDayRow[] = [
      {
        displaySheetName: '24-03-2026 10-15',
        occupiedBeds: 18,
        availableCapacity: 1,
        blockedBeds: 0,
        cribs: 0,
        occupancyRate: 18 / 19,
        discharges: 1,
        transfers: 2,
        cma: 0,
        deceased: 0,
        specialtyCounts: {
          'Med Interna': 10,
          Cirugía: 2,
          Psiquiatría: 1,
          Ginecobstetricia: 2,
          Pediatría: 2,
          Traumatología: 1,
        },
      },
    ];

    renderSummarySheet({
      sheet,
      rows,
      firstDate: '2026-03-01',
      lastDate: '2026-03-24',
      monthName: 'MARZO',
      year: '2026',
    });

    expect(sheet.getCell('A1').value).toBe(
      'RESUMEN CENSO DIARIO — HOSPITAL HANGA ROA — MARZO 2026'
    );
    expect(sheet.getCell('A6').value).toBe('Fecha');
    expect(sheet.getCell('F7').numFmt).toBe('0%');
    expect(sheet.getCell('F7').font?.color?.argb).toBe('FFC00000');
    expect(sheet.getCell('F7').fill).toEqual(sheet.getCell('A7').fill);
    expect(sheet.getCell('A9').value).toBe('INDICADORES CONSOLIDADOS');
    expect(sheet.getCell('A10').value).toBe('Promedio');
    expect(getSolidFillArgb(sheet, 'A10')).toBe('FF5B9BD5');
    expect(getSolidFillArgb(sheet, 'B10')).toBe('FFFFFFFF');
    expect(sheet.views[0]).toEqual(
      expect.objectContaining({ state: 'frozen', ySplit: 6, topLeftCell: 'A7' })
    );
    expect(sheet.columns[0]?.width).toBe(14);
  });

  it('renders UPC sheets visible and without sheet protection', async () => {
    const workbook = new ExcelJS.Workbook();
    const upcSheet = workbook.addWorksheet('UPC PAC MARZO 2026');
    const matrixSheet = workbook.addWorksheet('UPC DET');
    const patients = [buildUpcPatient()];

    renderUpcPatientsSheet({
      sheet: upcSheet,
      patients,
      monthName: 'MARZO',
      year: '2026',
    });
    renderUpcDailyMatrixSheet({
      sheet: matrixSheet,
      patients,
      monthName: 'MARZO',
      year: '2026',
      daysInMonth: 31,
    });

    expect(upcSheet.getCell('A1').value).toBe('UPC PAC');
    expect(upcSheet.getCell('G5').value).toBe('Mixto');
    expect(upcSheet.getCell('H5').value).toBe(1);
    expect(upcSheet.getCell('I5').value).toBe(1);
    expect(upcSheet.getCell('J5').value).toBe(2);
    expect(upcSheet.getCell('K5').value).toBe('R1 (24-03-2026) → R2 (25-03-2026)');
    expect(upcSheet.getCell('N5').value).toBe('Sí');
    expect(matrixSheet.getCell('Y5').value).toBe('UTI');
    expect(getSolidFillArgb(matrixSheet, 'Y5')).toBe('FFD6B656');
    expect(matrixSheet.getCell('Z5').value).toBe('UCI');
    expect(getSolidFillArgb(matrixSheet, 'Z5')).toBe('FFC00000');
    expect(matrixSheet.getCell('AH5').value).toBe('R1 (24-03-2026) → R2 (25-03-2026)');
    expect(matrixSheet.getCell('AH5').font?.bold).toBeFalsy();
    expect(matrixSheet.getCell('AH5').font?.color?.argb).toBe('FF333333');
    expect(matrixSheet.views[0]).toEqual(
      expect.objectContaining({ state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' })
    );

    expect(upcSheet.state).toBe('visible');
    expect(matrixSheet.state).toBe('visible');
    expect(upcSheet.getRow(5).hidden).toBe(false);
    expect(matrixSheet.getRow(5).hidden).toBe(false);
    expect(upcSheet.getColumn(1).hidden).toBe(false);
    expect(matrixSheet.getColumn(1).hidden).toBe(false);

    const zip = new PizZip(await workbook.xlsx.writeBuffer());
    const upcSheetXml = zip.file('xl/worksheets/sheet1.xml')?.asText() ?? '';
    const matrixSheetXml = zip.file('xl/worksheets/sheet2.xml')?.asText() ?? '';
    expect(upcSheetXml).not.toContain('<sheetProtection');
    expect(matrixSheetXml).not.toContain('<sheetProtection');
  });

  it('expands UPC rows for wrapped content so text is not truncated', () => {
    const workbook = new ExcelJS.Workbook();
    const upcSheet = workbook.addWorksheet('UPC PAC MARZO 2026');
    const matrixSheet = workbook.addWorksheet('UPC DET');
    const longPatient = buildUpcPatient({
      patientName: 'Paciente UPC con nombre extremadamente largo para forzar salto de línea',
      diagnosis:
        'Diagnóstico clínico muy extenso que necesita varias líneas para mostrarse completo en la hoja',
      history: 'R1 (24-03-2026) → R2 (25-03-2026) → R3 (26-03-2026)',
      daysDetail: '24-03-2026\n25-03-2026\n26-03-2026\n27-03-2026',
    });

    renderUpcPatientsSheet({
      sheet: upcSheet,
      patients: [longPatient],
      monthName: 'MARZO',
      year: '2026',
    });
    renderUpcDailyMatrixSheet({
      sheet: matrixSheet,
      patients: [longPatient],
      monthName: 'MARZO',
      year: '2026',
      daysInMonth: 31,
    });

    expect(upcSheet.getRow(5).height).toBeGreaterThan(30);
    expect(upcSheet.getCell('B5').alignment?.wrapText).toBe(true);
    expect(upcSheet.getCell('E5').alignment?.wrapText).toBe(true);
    expect(upcSheet.getCell('K5').alignment?.wrapText).toBe(true);
    expect(upcSheet.getCell('M5').alignment?.wrapText).toBe(true);

    expect(matrixSheet.getRow(5).height).toBeGreaterThan(22);
    expect(matrixSheet.getCell('A5').alignment?.wrapText).toBe(true);
    expect(matrixSheet.getCell('AH5').alignment?.wrapText).toBe(true);
  });
});
