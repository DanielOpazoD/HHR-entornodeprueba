import { describe, expect, it } from 'vitest';
import type { StoredCensusFile } from '@/services/backup/censusStorageService';
import {
  executeLoadSharedCensusFilesController,
  filterSharedCensusFilesByTerm,
  resolveSharedCensusDownloadPermission,
  resolveSharedCensusMonthWindow,
  selectLatestSharedCensusFiles,
} from '@/features/census/controllers/sharedCensusFilesController';

const buildFile = (date: string): StoredCensusFile => ({
  name: `${date} - Censo Diario.xlsx`,
  fullPath: `/censo/${date}.xlsx`,
  downloadUrl: `https://example.com/${date}.xlsx`,
  date,
  createdAt: `${date}T08:00:00.000Z`,
  size: 1024,
});

describe('sharedCensusFilesController', () => {
  it('resolves month window including january year rollover', () => {
    expect(resolveSharedCensusMonthWindow(new Date('2026-02-13T10:00:00.000Z'))).toEqual({
      currentYear: '2026',
      currentMonth: '02',
      previousYear: '2026',
      previousMonth: '01',
    });

    expect(resolveSharedCensusMonthWindow(new Date('2026-01-05T10:00:00.000Z'))).toEqual({
      currentYear: '2026',
      currentMonth: '01',
      previousYear: '2025',
      previousMonth: '12',
    });
  });

  it('selects latest current and previous files by date', () => {
    const selected = selectLatestSharedCensusFiles({
      currentFiles: [buildFile('2026-02-03'), buildFile('2026-02-10')],
      previousFiles: [buildFile('2026-01-15'), buildFile('2026-01-29')],
    });

    expect(selected.map(file => file.date)).toEqual(['2026-02-10', '2026-01-29']);
  });

  it('filters files by normalized term in name or date', () => {
    const files = [buildFile('2026-02-10'), buildFile('2026-01-29')];

    expect(filterSharedCensusFilesByTerm(files, '  2026-01  ').map(file => file.date)).toEqual([
      '2026-01-29',
    ]);
    expect(filterSharedCensusFilesByTerm(files, 'CENSO DIARIO').length).toBe(2);
    expect(filterSharedCensusFilesByTerm(files, '   ').length).toBe(2);
  });

  it('loads and selects latest files with explicit controller result', async () => {
    const listFilesInMonth = async (year: string, month: string): Promise<StoredCensusFile[]> => {
      if (`${year}-${month}` === '2026-02') {
        return [buildFile('2026-02-10'), buildFile('2026-02-03')];
      }
      return [buildFile('2026-01-29'), buildFile('2026-01-15')];
    };

    const result = await executeLoadSharedCensusFilesController({
      now: new Date('2026-02-15T10:00:00.000Z'),
      listFilesInMonth,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files.map(file => file.date)).toEqual(['2026-02-10', '2026-01-29']);
    }
  });

  it('returns typed error when file loading fails', async () => {
    const result = await executeLoadSharedCensusFilesController({
      now: new Date('2026-02-15T10:00:00.000Z'),
      listFilesInMonth: async () => {
        throw new Error('boom');
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LIST_FILES_FAILED');
    }
  });

  it('validates download permission from role', () => {
    const denied = resolveSharedCensusDownloadPermission('viewer');
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe('DOWNLOAD_PERMISSION_REQUIRED');
    }

    const allowed = resolveSharedCensusDownloadPermission('downloader');
    expect(allowed.ok).toBe(true);
  });
});
