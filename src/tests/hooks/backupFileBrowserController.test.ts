// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  type BackupBrowserItem,
  buildInitialBackupBrowserPath,
  filterBackupBrowserItems,
  resolveBackupModuleLabel,
  resolveCanRunMagicBackfill,
} from '@/hooks/backupFileBrowserController';

describe('backupFileBrowserController', () => {
  it('builds the initial browser path from the current month', () => {
    expect(buildInitialBackupBrowserPath(new Date('2026-03-05T10:00:00.000Z'))).toEqual([
      '2026',
      'Marzo',
    ]);
  });

  it('filters folders and files using a trimmed query', () => {
    const items: BackupBrowserItem[] = [
      { type: 'folder' as const, data: { name: '2026', type: 'year' as const } },
      {
        type: 'file' as const,
        data: {
          name: '05-03-2026 - Censo Diario.xlsx',
          date: '2026-03-05',
        } as never,
      },
    ];

    expect(filterBackupBrowserItems(items, '  censo  ')).toHaveLength(1);
    expect(filterBackupBrowserItems(items, '')).toHaveLength(2);
  });

  it('resolves backup affordances consistently', () => {
    expect(resolveCanRunMagicBackfill('admin', ['2026', 'Marzo'], false)).toBe(true);
    expect(resolveCanRunMagicBackfill('nurse_hospital', ['2026', 'Marzo'], false)).toBe(false);
    expect(resolveCanRunMagicBackfill('viewer', ['2026', 'Marzo'], false)).toBe(false);
    expect(resolveCanRunMagicBackfill('admin', ['2026'], false)).toBe(false);
    expect(resolveBackupModuleLabel('handoff')).toBe('Entregas');
    expect(resolveBackupModuleLabel('census')).toBe('Censo');
    expect(resolveBackupModuleLabel('cudyr')).toBe('CUDYR');
  });
});
