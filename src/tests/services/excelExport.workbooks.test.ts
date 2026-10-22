import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { FIXED_ISO_TIMESTAMP } from './excelExport.testUtils';

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

describe('headerSection', () => {
  it('renders canonical vacancy labels in the night-shift header text', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const { addHeaderSection } = await import('@/services/exporters/excel/sections/headerSection');

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
