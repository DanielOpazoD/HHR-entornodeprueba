import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import {
  buildCudyrEssentialWorkbook,
  downloadCudyrEssential,
} from '@/features/cudyr/export/cudyrEssentialWorkbook';
import { confirmedReportInput } from './reportFixtures';
import type { CudyrSourceSheet } from '@/features/cudyr/export/cudyrSourceTypes';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/features/cudyr/export/cudyrSourceLoader', () => ({ loadCudyrSourceSheets: mocks.load }));
vi.mock('@/utils/downloadBlob', () => ({ downloadBlob: mocks.save }));
vi.mock('@/features/cudyr/export/cudyrSourceWorkbook', () => {
  throw new Error('Source presentation unavailable');
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue([]);
});

describe('optional source presentation during monthly Excel export', () => {
  it('builds without an attachment even when source presentation cannot load', async () => {
    const data = buildCudyrReport(confirmedReportInput());
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    const sheetNames = workbook.worksheets.map(sheet => sheet.name);
    expect(sheetNames[0]).toBe('Resumen CUDYR Mensual');
    expect(sheetNames.filter(name => name.startsWith('Eloísa'))).toEqual([]);
  });

  it('downloads an empty-source result without loading source presentation', async () => {
    const data = buildCudyrReport(confirmedReportInput());
    const { workbook } = await buildCudyrEssentialWorkbook(data, []);
    expect(workbook.worksheets[1].name).toBe('Eloísa · sin archivo');
    await downloadCudyrEssential(data);
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('does not offer a file when its attached source cannot be rendered', async () => {
    mocks.load.mockResolvedValue([{} as CudyrSourceSheet]);
    await expect(
      downloadCudyrEssential(buildCudyrReport(confirmedReportInput()))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Source presentation unavailable' }),
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('does not offer a file when the archive lookup fails', async () => {
    mocks.load.mockRejectedValue(new Error('Archive unavailable'));
    await expect(downloadCudyrEssential(buildCudyrReport(confirmedReportInput()))).rejects.toThrow(
      'Archive unavailable'
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
