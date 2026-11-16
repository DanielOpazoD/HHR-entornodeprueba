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
    'const q = db.syncQueue; await q.clear();',
    'const { syncQueue } = db; await syncQueue.clear();',
    'const { syncQueue: queue = db.syncQueue } = db; await queue.delete(taskId);',
    "const q = db.table('syncQueue'); await q.bulkDelete(ids);",
    'const q = hospitalDB.syncQueue as Table; const r = q; await r.delete(taskId);',
    "const q = db.syncQueue; const r = q; await r.where('status').equals('FAILED').delete();",
    'const run = () => { const r = q; r.clear(); }; const q = db.syncQueue; run();',
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
      const logs = db.errorLogs; await logs.clear();
      const { errorLogs } = db; await errorLogs.clear();
    `)
    ).toEqual([]);
  });

  it('tells a queue alias apart from a same-named store in another scope', async () => {
    expect(
      await violations(`
      const read = () => { const q = db.syncQueue; return q.toArray(); };
      const reset = (q: Map<string, number>) => q.clear();
    `)
    ).toEqual([]);
  });

  it.each([
    'let q = db.syncQueue; q = new Map(); q.clear();',
    'let q = new Map(); q.clear(); q = db.syncQueue;',
  ])('does not follow let bindings, so a reassigned Map stays clear: %s', async code => {
    expect(await violations(code)).toEqual([]);
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
