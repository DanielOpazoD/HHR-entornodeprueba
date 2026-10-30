import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: storage.read,
  saveRecordsStrict: storage.save,
}));

import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';

const DATE = '2026-10-24';
const day = { date: DATE, beds: {}, nursesDayShift: ['SYNTHETIC NURSE'] };
const file = (content: unknown) =>
  new File([JSON.stringify(content)], 'synthetic.json', { type: 'application/json' });

beforeEach(() => {
  vi.clearAllMocks();
  storage.read.mockResolvedValue(null);
  storage.save.mockResolvedValue({
    ok: true,
    operation: 'save_many',
    store: 'indexeddb',
    dates: [],
  });
});

it('refuses the copy of a discarded send instead of storing its fields as days', async () => {
  const taskCopy = {
    schemaVersion: 1,
    remotelyConfirmed: false,
    task: { type: 'UPDATE_DAILY_RECORD', key: `daily:${DATE}`, payload: day },
  };

  const result = await importDataJSONDetailed(file(taskCopy));

  expect(result).toMatchObject({ success: false, outcome: 'blocked', importedCount: 0 });
  expect(result.skippedEntries).toEqual(['schemaVersion', 'remotelyConfirmed', 'task']);
  expect(storage.save).not.toHaveBeenCalled();
});

it('imports the days of a backup and reports what is not a day', async () => {
  const result = await importDataJSONDetailed(file({ [DATE]: day, notes: {} }));

  expect(result).toMatchObject({ importedCount: 1, skippedEntries: ['notes'] });
  expect(storage.save.mock.calls[0][0].map((saved: { date: string }) => saved.date)).toEqual([
    DATE,
  ]);
});
