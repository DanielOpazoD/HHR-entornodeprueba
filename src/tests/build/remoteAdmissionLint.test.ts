// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
const filePath = 'src/services/repositories/dailyRecordReadProbe.ts';
const violations = async (code: string) =>
  (await eslint.lintText(code, { filePath }))[0].messages.filter(
    message => message.ruleId === 'admission/remote-reads'
  );

describe('remote reads use the admission boundary', () => {
  it.each([
    "import { HangaRoaDatabase } from '@/services/storage/indexeddb/indexedDbDatabase';",
    "import { HangaRoaDatabase as Store } from '../storage/indexeddb/indexedDbDatabase.ts';",
    "import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';",
    "import { createMockDatabase } from '@/services/storage/indexeddb/indexedDbMockFactory';",
    "import Dexie from 'dexie';",
    "import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';",
    "import { saveRecordStrict as write } from '@/services/storage/indexeddb/indexedDbRecordService';",
    "import * as storage from '@/services/storage/indexeddb/indexedDbRecordService';",
    "export { HangaRoaDatabase } from '@/services/storage/indexeddb/indexedDbDatabase';",
    "const module = import('../storage/indexeddb/indexedDbDatabase');",
    "const module = require('@/services/storage/indexeddb/indexedDbCore');",
    "indexedDB.open('HangaRoaDB');",
    "window.indexedDB.open('HangaRoaDB');",
    "globalThis['indexedDB'].open('HangaRoaDB');",
  ])('rejects a raw storage route: %s', async code => {
    expect(await violations(code)).not.toHaveLength(0);
  });

  it('keeps reads, admission, types and explicit user commands available', async () => {
    expect(
      await violations(`
      import { getRecordForDate, captureLocalRecordBase, inspectLocalRecordAdmission, admitLocalRecords, type LocalRecordBase } from '@/services/storage/indexeddb/indexedDbRecordService';
      import { save } from './dailyRecordRepositoryWriteService';
    `)
    ).toEqual([]);
    const [command] = await eslint.lintText(
      "import { saveRecordStrict } from '@/services/storage/indexeddb/indexedDbRecordService';",
      { filePath: 'src/services/repositories/dailyRecordRepositoryWriteService.ts' }
    );
    expect(command.messages.filter(message => message.ruleId === 'admission/remote-reads')).toEqual(
      []
    );
  });
});
