// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
const violations = async (code: string, filePath = 'src/services/storage/newResetPath.ts') =>
  (await eslint.lintText(code, { filePath }))[0].messages.filter(
    message => message.ruleId === 'queue/removal-home'
  );

describe('SAVE-03: only the queue modules remove queue tasks or the local database', () => {
  it.each([
    'await hospitalDB.syncQueue.delete(taskId);',
    'await db.syncQueue.bulkDelete(ids);',
    'await hospitalDB.syncQueue.clear();',
    "await hospitalDB.syncQueue.where('status').equals('FAILED').delete();",
    'await hospitalDB?.syncQueue!.delete(taskId);',
    "await hospitalDB['syncQueue'].clear();",
    "await hospitalDB.table('syncQueue').clear();",
    'await hospitalDB.delete();',
    "await Dexie.delete('HangaRoaDB');",
    "window.indexedDB.deleteDatabase('HangaRoaDB');",
  ])('rejects a new removal route and names the fix: %s', async code => {
    const [message] = await violations(code);
    expect(message?.message).toContain(
      'Solo dexieSyncQueueStore, dexieSyncQueueAuthorityAck, dexieSyncQueueQuarantine e indexedDbDeleteController borran tareas de la cola'
    );
  });

  it('keeps reads, updates and other stores available everywhere', async () => {
    expect(
      await violations(`
      await hospitalDB.syncQueue.update(taskId, { status: 'PENDING' });
      await hospitalDB.syncQueue.where('status').equals('PENDING').toArray();
      await hospitalDB.errorLogs.where('timestamp').below(cutoff).delete();
      pendingByDate.clear();
      registry.delete(key);
    `)
    ).toEqual([]);
  });

  it('lets the queue modules remove tasks', async () => {
    expect(
      await violations(
        'await hospitalDB.syncQueue.delete(taskId);',
        'src/services/storage/sync/dexieSyncQueueQuarantine.ts'
      )
    ).toEqual([]);
  });
});
