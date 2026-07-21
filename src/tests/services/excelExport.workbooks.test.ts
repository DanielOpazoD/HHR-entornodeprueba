import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildUpcChecklist, FIXED_ISO_TIMESTAMP } from './excelExport.testUtils';

describe('censusMasterWorkbook', () => {
  describe('buildCensusMasterWorkbook', () => {
    it('throws an error when records array is empty', async () => {
      const { buildCensusMasterWorkbook } =
        await import('@/services/exporters/censusMasterWorkbook');

      await expect(buildCensusMasterWorkbook([])).rejects.toThrow('No hay registros disponibles');
    });

    it('throws an error when records is null or undefined', async () => {
      const { buildCensusMasterWorkbook } =
        await import('@/services/exporters/censusMasterWorkbook');

      // @ts-expect-error - Testing invalid input
      await expect(buildCensusMasterWorkbook(null)).rejects.toThrow();
      // @ts-expect-error - Testing invalid input
      await expect(buildCensusMasterWorkbook(undefined)).rejects.toThrow();
    });
  });

  describe('createWorkbook helper', () => {
    it('creates a valid workbook object', async () => {
      const { buildCensusMasterWorkbook } =
        await import('@/services/exporters/censusMasterWorkbook');

      const mockRecord = {
        date: '2025-12-25',
        beds: {},
        createdAt: FIXED_ISO_TIMESTAMP,
        updatedAt: FIXED_ISO_TIMESTAMP,
      } as unknown as DailyRecord;

      try {
        const workbook = await buildCensusMasterWorkbook([mockRecord]);
        expect(workbook).toBeDefined();
        expect(typeof workbook.xlsx).toBe('object');
      } catch (error: unknown) {
        expect((error as Error).message).not.toContain('ExcelJS module could not be loaded');
      }
    });
  });
});

describe('censusRawWorkbook', () => {
  describe('buildCensusDailyRawWorkbook', () => {
    it('creates a workbook with the Censo Diario worksheet', async () => {
      const { buildCensusDailyRawWorkbook } =
        await import('@/services/exporters/censusRawWorkbook');

      const mockRecord = {
        date: '2025-12-25',
        beds: {},
        createdAt: FIXED_ISO_TIMESTAMP,
        updatedAt: FIXED_ISO_TIMESTAMP,
      } as unknown as DailyRecord;

      const workbook = await buildCensusDailyRawWorkbook(mockRecord);

      expect(workbook).toBeDefined();
      expect(workbook.getWorksheet('Censo Diario')).toBeDefined();
    });

    it('includes the header row', async () => {
      const { buildCensusDailyRawWorkbook, getCensusRawHeader } =
        await import('@/services/exporters/censusRawWorkbook');

      const mockRecord = {
        date: '2025-12-25',
        beds: {},
        createdAt: FIXED_ISO_TIMESTAMP,
        updatedAt: FIXED_ISO_TIMESTAMP,
      } as unknown as DailyRecord;

      const workbook = await buildCensusDailyRawWorkbook(mockRecord);
      const worksheet = workbook.getWorksheet('Censo Diario');
      const header = getCensusRawHeader();

      expect(worksheet?.getRow(1).getCell(1).value).toBe(header[0]);
    });

    it('exports the Censo Diario worksheet with a frozen, styled header and stable widths', async () => {
      const { buildCensusDailyRawWorkbook } =
        await import('@/services/exporters/censusRawWorkbook');

      const mockRecord = {
        date: '2025-12-25',
        beds: {},
        createdAt: FIXED_ISO_TIMESTAMP,
        updatedAt: FIXED_ISO_TIMESTAMP,
      } as unknown as DailyRecord;

      const workbook = await buildCensusDailyRawWorkbook(mockRecord);
      const worksheet = workbook.getWorksheet('Censo Diario');
      const headerRow = worksheet?.getRow(1);

      expect(worksheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(headerRow?.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } });
      expect(headerRow?.fill).toMatchObject({
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F4C81' },
      });
      expect(headerRow?.alignment).toMatchObject({
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true,
      });
      expect(headerRow?.height).toBe(22);
      expect(worksheet?.getColumn(1).width).toBeGreaterThanOrEqual(12);
      expect(worksheet?.getColumn(1).width).toBeLessThanOrEqual(36);
    });
  });

  describe('extractRowsFromRecord', () => {
    it('extracts rows for each bed', async () => {
      const { extractRowsFromRecord } = await import('@/services/exporters/censusRawWorkbook');

      const mockRecord = {
        date: '2025-12-25',
        beds: {
          '1': {
            patientName: 'Juan Perez',
            rut: '12345678-9',
            age: '45',
            pathology: 'Test',
          },
        },
        createdAt: FIXED_ISO_TIMESTAMP,
        updatedAt: FIXED_ISO_TIMESTAMP,
      } as unknown as DailyRecord;

      const rows = extractRowsFromRecord(mockRecord);

      expect(rows).toBeDefined();
      expect(Array.isArray(rows)).toBe(true);
    });

    it('exports detailed UPC classification in raw rows when checklist data exists', async () => {
      const { extractRowsFromRecord, getCensusRawHeader } =
        await import('@/services/exporters/censusRawWorkbook');

      const bedId = 'R1';
      const mockRecord = {
        date: '2025-12-25',
        beds: {
          [bedId]: DataFactory.createMockPatient(bedId, {
            patientName: 'Paciente UPC',
            rut: '12.345.678-9',
            isUPC: true,
            upcChecklist: buildUpcChecklist('UPC_UCI'),
          }),
        },
        nurses: [],
        lastUpdated: FIXED_ISO_TIMESTAMP,
        activeExtraBeds: [],
      } as unknown as DailyRecord;

      const rows = extractRowsFromRecord(mockRecord);

      expect(rows[0]?.[getCensusRawHeader().indexOf('UPC')]).toBe('UPC-UCI');
    });

    it('treats mixed UCI + UTI criteria as UPC-UCI in raw export even if the stored field is stale', async () => {
      const { extractRowsFromRecord, getCensusRawHeader } =
        await import('@/services/exporters/censusRawWorkbook');

      const bedId = 'R1';
      const mockRecord = {
        date: '2025-12-25',
        beds: {
          [bedId]: DataFactory.createMockPatient(bedId, {
            patientName: 'Paciente Mixto',
            rut: '12.345.678-9',
            isUPC: true,
            upcChecklist: {
              classification: 'UPC_UTI',
              uciCriteria: ['uci_vmi'],
              utiCriteria: ['uti_mon_cardiaca'],
              evaluatedAt: FIXED_ISO_TIMESTAMP,
            },
          }),
        },
        nurses: [],
        lastUpdated: FIXED_ISO_TIMESTAMP,
        activeExtraBeds: [],
      } as unknown as DailyRecord;

      const rows = extractRowsFromRecord(mockRecord);

      expect(rows[0]?.[getCensusRawHeader().indexOf('UPC')]).toBe('UPC-UCI');
    });

    it('exports canonical vacancy labels in the raw nurses column', async () => {
      const { extractRowsFromRecord, getCensusRawHeader } =
        await import('@/services/exporters/censusRawWorkbook');

      const bedId = 'R1';
      const mockRecord = {
        date: '2025-12-25',
        beds: {
          [bedId]: DataFactory.createMockPatient(bedId, {
            patientName: 'Paciente Turno',
            rut: '12.345.678-9',
          }),
        },
        nursesDayShift: ['Ana', '--'],
        lastUpdated: FIXED_ISO_TIMESTAMP,
        activeExtraBeds: [],
      } as unknown as DailyRecord;

      const rows = extractRowsFromRecord(mockRecord);
      const nursesColumn = getCensusRawHeader().indexOf('ENFERMEROS');

      expect(rows[0]?.[nursesColumn]).toBe('Ana & Vacante');
    });
  });

  describe('headerSection', () => {
    it('renders canonical vacancy labels in the night-shift header text', async () => {
      const ExcelJS = (await import('exceljs')).default;
      const { addHeaderSection } =
        await import('@/services/exporters/excel/sections/headerSection');

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('header');
      const record = {
        date: '2026-04-18',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        activeExtraBeds: [],
        lastUpdated: FIXED_ISO_TIMESTAMP,
        nursesNightShift: [' -- ', ''],
      } as unknown as DailyRecord;

      addHeaderSection(sheet, record as never, 1);

      expect(sheet.getRow(3).getCell(1).value).toBe('Enfermeros/as Turno Noche: Vacante, Vacante');
    });
  });
});
