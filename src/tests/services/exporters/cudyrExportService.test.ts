import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCudyrMonthlyExcelBlob } from '@/services/cudyr/cudyrExportService';
import { loadCudyrReport } from '@/services/cudyr/cudyrReportLoader';
import { cudyrReportExcelBlob } from '@/services/cudyr/cudyrReportWorkbook';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from '../cudyr/reportFixtures';
vi.mock('@/services/cudyr/cudyrReportLoader', () => ({ loadCudyrReport: vi.fn() }));
vi.mock('@/services/cudyr/cudyrReportWorkbook', () => ({
  cudyrReportExcelBlob: vi.fn(),
}));
const data = buildCudyrReport(reportInput());
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCudyrReport).mockResolvedValue(data);
});
describe('monthly CUDYR export entrypoint', () => {
  it('uses the same persisted dataset as the explorer without merging a local unsaved record', async () => {
    const blob = new Blob(['synthetic']);
    vi.mocked(cudyrReportExcelBlob).mockResolvedValue({ blob, fileName: 'report.xlsx' });
    const result = await generateCudyrMonthlyExcelBlob(2026, 10, '2026-10-04', {
      date: '2026-10-04',
      beds: {},
      activeExtraBeds: [],
      lastUpdated: '2099-01-01',
    });
    expect(loadCudyrReport).toHaveBeenCalledWith('2026-10-01', '2026-10-04');
    expect(cudyrReportExcelBlob).toHaveBeenCalledWith(data);
    expect(result).toBe(blob);
  });
  it('calculates month end and preserves validated blob failures for backup callers', async () => {
    vi.mocked(cudyrReportExcelBlob).mockRejectedValueOnce(new Error('invalid workbook'));
    await expect(generateCudyrMonthlyExcelBlob(2026, 2)).rejects.toThrow('invalid workbook');
    expect(loadCudyrReport).toHaveBeenCalledWith('2026-02-01', '2026-02-28');
    const blob = new Blob(['synthetic']);
    vi.mocked(cudyrReportExcelBlob).mockResolvedValueOnce({ blob, fileName: 'test.xlsx' });
    expect(await generateCudyrMonthlyExcelBlob(2026, 2)).toBe(blob);
  });
  it('rejects invalid months and cross-month cutoff without reading any patient data', async () => {
    await expect(generateCudyrMonthlyExcelBlob(2026, 13)).rejects.toThrow('Mes CUDYR inválido.');
    await expect(generateCudyrMonthlyExcelBlob(2026, 10, '2026-11-01')).rejects.toThrow(
      'La fecha final no pertenece al mes solicitado.'
    );
    expect(loadCudyrReport).not.toHaveBeenCalled();
  });
});
