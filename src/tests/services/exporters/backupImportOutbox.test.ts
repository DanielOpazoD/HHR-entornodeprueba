import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { day, harnessState, writeNote, A } from '../storage/specialistHandoffOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';

const dates = ['2026-10-24', '2026-10-25'];
const records = () => dates.map(date => day(date, { R4: A() }));
const file = () =>
  new File([JSON.stringify(Object.fromEntries(records().map(r => [r.date, r])))], 'synthetic.json');
beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  harnessState().offline = true;
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});
afterEach(() => vi.restoreAllMocks());
it('queues every imported day offline with backup origin', async () => {
  expect(await importDataJSONDetailed(file())).toMatchObject({ success: true, importedCount: 2 });
  expect(await hospitalDB.syncQueue.count()).toBe(2);
  expect((await hospitalDB.syncQueue.toArray()).map(t => t.origin)).toEqual([
    'backup_restore',
    'backup_restore',
  ]);
});
it.each(['daily', 'specialist'])('rejects the whole file with a live %s task', async kind => {
  const record = records()[1];
  await hospitalDB.dailyRecords.put(record);
  if (kind === 'daily') await saveDetailed(record);
  else await writeNote(record, 'R4', 'entry-A', 'Edición sin enviar');
  const before = await hospitalDB.dailyRecords.toArray();
  const queue = await hospitalDB.syncQueue.toArray();
  expect(await importDataJSONDetailed(file())).toMatchObject({
    success: false,
    importedCount: 0,
    pendingDates: [record.date],
  });
  expect(await hospitalDB.dailyRecords.toArray()).toEqual(before);
  expect(await hospitalDB.syncQueue.toArray()).toEqual(queue);
});
it('rolls back the first day and task if the second enqueue fails', async () => {
  const changed = vi.fn();
  window.addEventListener('daily-record-store-changed', changed);
  const add = hospitalDB.syncQueue.add.bind(hospitalDB.syncQueue);
  vi.spyOn(hospitalDB.syncQueue, 'add')
    .mockImplementationOnce((...args) => add(...args))
    .mockRejectedValueOnce(new Error('synthetic second enqueue failure'));
  expect(await importDataJSONDetailed(file())).toMatchObject({ success: false, importedCount: 0 });
  expect(await hospitalDB.dailyRecords.count()).toBe(0);
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  window.removeEventListener('daily-record-store-changed', changed);
  expect(changed).not.toHaveBeenCalled();
});

it.each(['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT'] as const)(
  'rejects a file for %s work owned by another session',
  async status => {
    const record = records()[1];
    await saveDetailed(record);
    const task = (await hospitalDB.syncQueue.toArray())[0];
    await hospitalDB.syncQueue.update(task.id!, { status, ownerKey: 'user:other' });
    expect(await importDataJSONDetailed(file())).toMatchObject({
      success: false,
      pendingDates: [record.date],
    });
    expect(await hospitalDB.dailyRecords.get(dates[0])).toBeUndefined();
  }
);
it('preserves the imported base rather than manufacturing one from the current server', async () => {
  const result = await importDataJSONDetailed(file());
  expect(result.success).toBe(true);
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(tasks[0].syncContract?.expectedVersion).toBe(records()[0].lastUpdated);
  expect(tasks[0].syncContract?.changedPaths).toEqual(['*']);
});
it('characterizes the retained legacy migration: overwrites a local day without a task', async () => {
  const { migrateFromLocalStorage } =
    await import('@/services/storage/indexeddb/indexedDbMigrationService');
  const record = records()[0];
  await hospitalDB.dailyRecords.put({ ...record, nursesDayShift: ['Local vigente'] });
  const original = JSON.stringify({
    [record.date]: { ...record, nursesDayShift: ['Copia heredada'] },
  });
  localStorage.setItem('hanga_roa_hospital_data', original);
  expect(await migrateFromLocalStorage()).toBe(true);
  expect((await hospitalDB.dailyRecords.get(record.date))?.nursesDayShift).toEqual([
    'Copia heredada',
  ]);
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  expect(localStorage.getItem('hanga_roa_hospital_data')).toBe(original);
});
it('exposes D3 dates through the application outcome', async () => {
  const { executeImportJsonBackup } =
    await import('@/application/backup-export/backupExportMaintenanceUseCases');
  await saveDetailed(records()[1]);
  const outcome = await executeImportJsonBackup(file());
  expect(outcome.status).toBe('failed');
  expect(outcome.issues[0]?.message).toContain(dates[1]);
  expect(outcome.data).toMatchObject({ importedCount: 0, pendingDates: [dates[1]] });
});

it.each(['user:synthetic', 'user:other'])(
  'rejects a file whose entry is keyed by one date but holds a day with unsent work of %s',
  async ownerKey => {
    const [keyDate, writtenDate] = dates;
    await saveDetailed({
      ...day(writtenDate, { R4: A() }),
      nursesDayShift: ['Edición sin enviar'],
    });
    const [task] = await hospitalDB.syncQueue.toArray();
    await hospitalDB.syncQueue.update(task!.id!, { ownerKey });
    const before = await hospitalDB.dailyRecords.toArray();
    const queue = await hospitalDB.syncQueue.toArray();
    const mismatched = new File(
      [JSON.stringify({ [keyDate]: day(writtenDate, { R4: A() }) })],
      'synthetic.json'
    );
    expect(await importDataJSONDetailed(mismatched)).toMatchObject({
      success: false,
      importedCount: 0,
      pendingDates: [writtenDate],
    });
    expect(await hospitalDB.dailyRecords.toArray()).toEqual(before);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(queue);
  }
);
