// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HangaRoaDatabase } from '@/services/storage/indexeddb/indexedDbDatabase';

describe('indexedDbDatabase', () => {
  it('keeps the HangaRoaDB schema isolated from runtime recovery logic', () => {
    const database = new HangaRoaDatabase();

    expect(database.name).toBe('HangaRoaDB');
    expect(database.tables.map(table => table.name).sort()).toEqual([
      'auditLogs',
      'catalogs',
      'dailyRecords',
      'errorLogs',
      'settings',
      'syncQueue',
    ]);

    database.close();
  });
});
