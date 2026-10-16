import { describe, expect, it, vi } from 'vitest';
import {
  cudyrExcelDate,
  cudyrExcelDateText,
  cudyrExcelMoment,
} from '@/services/cudyr/cudyrExcelDates';
import { exportSheet, row, source } from './cudyrSourceTable.fixtures';
import { confirmedReportInput } from './reportFixtures';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { buildCudyrEssentialWorkbook } from '@/services/cudyr/cudyrEssentialWorkbook';
vi.mock('@/services/cudyr/cudyrSupplementService', () => ({}));

describe('CUDYR Excel dates', () => {
  it('uses a full year without shifting calendar-only dates', () => {
    expect(cudyrExcelDate('2026-10-01')).toBe('01-10-2026');
    expect(cudyrExcelMoment('2026-10-01')).toBe('01-10-2026');
    expect(cudyrExcelMoment('2026-10-01T02:47:00Z')).toBe('30-09-2026 21:47');
    expect(cudyrExcelMoment('2026-06-01T06:47:00Z')).toBe('01-06-2026 00:47');
    expect(cudyrExcelMoment('')).toBe('No informado');
    expect(cudyrExcelDateText('Revisión 2026-10-01; impresión 02/10/2026.')).toBe(
      'Revisión 01-10-2026; impresión 02-10-2026.'
    );
  });
  it('formats all source notes, exclusion dates and printing date after XLSX serialization', async () => {
    const current = source();
    current.matrix.rows[0].push('Fecha Hora Impresión: 2026-10-03 10:30');
    const excluded = row();
    excluded.eligibility = 'no_elegible';
    excluded.modality = 'cuna';
    const sheet = await exportSheet([excluded], current);
    expect(sheet.getCell('I1').note).toContain('01-10-2026');
    expect(sheet.getCell('I1').note).toContain('30-09-2026');
    expect(sheet.getCell('F2').note).toContain('01-10-2026 01:47');
    expect(sheet.getCell('J2').note).toContain('02-10-2026 01:47');
    expect(sheet.getCell('D2').note).toContain('30-09-2026');
    expect(sheet.getCell('A8').text).toBe('Fecha Hora Impresión: 03-10-2026 10:30');
    sheet.eachRow(r =>
      r.eachCell(cell => {
        if (cell.note) expect(JSON.stringify(cell.note)).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      })
    );
  });
  it('uses the same date format in admission and author/date details without altering data', async () => {
    const data = buildCudyrReport(confirmedReportInput());
    data.rows[0].evaluation!.recordedAt = '2026-10-03T06:47:00Z';
    const before = JSON.stringify(data);
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    const sheet = workbook.getWorksheet('02-10-2026')!;
    expect(sheet.getCell('F25').text).toBe('20-09-2026 10:00');
    expect(sheet.getCell('G25').text).toContain('03-10-2026 01:47');
    expect(JSON.stringify(data)).toBe(before);
  });
});
