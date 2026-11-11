import { writeFileSync } from 'node:fs';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  A,
  B,
  C,
  clone,
  day,
  harnessState,
  writeNote,
  draftsFor,
} from './specialistHandoffOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { admitRemoteDailyRecords } from '@/services/repositories/dailyRecordLocalCachePersistence';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';

const DATE = '2026-10-24';
const NOTE = 'Nota pendiente sintética de especialista';
const note = (r: DailyRecord | null | undefined) => r?.beds.R4.medicalHandoffEntries?.[0]?.note;
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-admission');
  resetMedicalHandoffDraftMemoryForTests();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetMedicalHandoffDraftMemoryForTests();
});
async function prepare() {
  const remote = day(DATE, { R4: A(), H1C1: C() });
  await hospitalDB.dailyRecords.put(remote);
  harnessState().remote = clone(remote);
  await writeNote(remote, 'R4', 'entry-A', NOTE);
  return remote;
}
const admit = async (
  remote: Parameters<typeof admitRemoteDailyRecords>[0][number]['record'],
  candidate = remote
) => (await admitRemoteDailyRecords([{ record: candidate, remoteRecord: remote }]))[0];
it('projects active note, returns durable row and keeps pure remote evidence and exact task', async () => {
  const remote = await prepare();
  const tasks = await hospitalDB.syncQueue.toArray();
  const result = await admit(remote);
  expect(note(result.record ?? undefined)).toBe(NOTE);
  expect(result.record).toEqual(await hospitalDB.dailyRecords.get(DATE));
  expect(result.remoteRecord).toEqual(remote);
  expect(note(result.remoteRecord ?? undefined)).toBe('');
  expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
});
for (const scenario of ['other', 'empty', 'episode', 'crib', 'mother-RN'] as const) {
  it(`identity before text: ${scenario}, including local-selected candidate`, async () => {
    const remote = await prepare();
    const local = clone(remote);
    local.lastUpdated = '2026-10-24T14:00:00.000Z';
    if (scenario === 'other') local.beds.R4 = B();
    if (scenario === 'empty')
      local.beds.R4 = A('R4', { patientName: '', rut: '', clinicalEpisodeId: '' });
    if (scenario === 'episode') local.beds.R4.clinicalEpisodeId = 'reentry';
    if (scenario === 'crib' || scenario === 'mother-RN') {
      local.beds.R4 = B();
      local.beds.R4.clinicalCrib = A('R4', { clinicalEpisodeId: 'newborn' });
    }
    await hospitalDB.dailyRecords.put(local);
    const tasks = await hospitalDB.syncQueue.toArray();
    const result = await admit(remote, local);
    expect(result.record).toEqual(local);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
    expect(draftsFor('Paciente A Sintético').flat()).toContain(NOTE);
  });
}
for (const colleague of [
  'Mejor',
  'Nota posterior de colega mucho más larga que la nota pendiente sintética',
]) {
  it(`original remote colleague wins: ${colleague}`, async () => {
    const remote = await prepare();
    const candidate = (await hospitalDB.dailyRecords.get(DATE))!;
    remote.beds.R4.medicalHandoffNote = colleague;
    remote.beds.R4.medicalHandoffEntries![0].note = colleague;
    const tasks = await hospitalDB.syncQueue.toArray();
    const result = await admit(remote, candidate);
    expect(note(result.record ?? undefined)).toBe(colleague);
    expect(note(await hospitalDB.dailyRecords.get(DATE))).toBe(colleague);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
    expect(draftsFor('Paciente A Sintético').flat()).toContain(NOTE);
  });
}
it('repeated reads perform zero writes and emit zero store events', async () => {
  const remote = await prepare();
  await admit(remote);
  const put = vi.spyOn(hospitalDB.dailyRecords, 'put');
  const bulkPut = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
  const events = vi.fn();
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, events);
  try {
    for (let i = 0; i < 3; i++) expect((await admit(remote)).status).toBe('projected_note');
    expect(put).not.toHaveBeenCalled();
    expect(bulkPut).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, events);
  }
});
for (const reverse of [false, true])
  it(`two patients independent of queue order ${reverse}`, async () => {
    const remote = await prepare();
    await writeNote((await hospitalDB.dailyRecords.get(DATE))!, 'H1C1', 'entry-C', 'Nota C');
    const tasks = await hospitalDB.syncQueue.toArray();
    await hospitalDB.syncQueue.clear();
    for (const task of reverse ? [...tasks].reverse() : tasks)
      await hospitalDB.syncQueue.add({ ...task, id: undefined });
    const before = await hospitalDB.syncQueue.toArray();
    const result = await admit(remote);
    expect(note(result.record ?? undefined)).toBe(NOTE);
    expect(result.record?.beds.H1C1.medicalHandoffEntries?.[0].note).toBe('Nota C');
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
  });

for (const reverse of [false, true])
  it(`two specialties independent of queue order ${reverse}`, async () => {
    const remote = day(DATE, {
      R4: A('R4', {
        medicalHandoffEntries: [
          { id: 'entry-A', specialty: 'Medicina Interna', note: '' },
          { id: 'entry-B', specialty: 'Cirugía', note: '' },
        ],
      }),
    });
    await hospitalDB.dailyRecords.put(remote);
    harnessState().remote = clone(remote);
    await writeNote(remote, 'R4', 'entry-A', NOTE);
    const first = (await hospitalDB.syncQueue.toArray())[0];
    await hospitalDB.syncQueue.update(first.id!, { status: 'PROCESSING' });
    await writeNote((await hospitalDB.dailyRecords.get(DATE))!, 'R4', 'entry-B', 'Nota B');
    const tasks = await hospitalDB.syncQueue.toArray();
    await hospitalDB.syncQueue.clear();
    for (const task of reverse ? [...tasks].reverse() : tasks)
      await hospitalDB.syncQueue.add({ ...task, id: undefined });
    const result = await admit(remote);
    expect(result.record?.beds.R4.medicalHandoffEntries?.map(entry => entry.note)).toEqual([
      NOTE,
      'Nota B',
    ]);
  });
for (const status of ['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT', 'RETIRED'] as const) {
  for (const released of ['none', 'handoff', 'task'])
    it(`task unchanged: ${status}, released ${released}`, async () => {
      const remote = await prepare();
      const [task] = await hospitalDB.syncQueue.toArray();
      await hospitalDB.syncQueue.put({
        ...task,
        status,
        ...(released === 'task' ? { projectionReleased: true as const } : {}),
        handoffProjection: {
          ...task.handoffProjection!,
          ...(released === 'handoff' ? { released: true as const } : {}),
        },
      });
      const tasks = await hospitalDB.syncQueue.toArray();
      const result = await admit(remote, (await hospitalDB.dailyRecords.get(DATE))!);
      expect(note(result.record ?? undefined)).toBe(
        released === 'none' && ['PENDING', 'PROCESSING'].includes(status) ? NOTE : ''
      );
      expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
    });
}
it('daily holder precedes note projection and CAS', async () => {
  const remote = await prepare();
  const local = (await hospitalDB.dailyRecords.get(DATE))!;
  await hospitalDB.syncQueue.add({
    opId: 'day',
    key: `daily:${DATE}`,
    type: 'UPDATE_DAILY_RECORD',
    status: 'PENDING',
    payload: local,
    timestamp: 1,
    retryCount: 0,
  });
  const tasks = await hospitalDB.syncQueue.toArray();
  const [result] = await admitRemoteDailyRecords([
    { record: remote, remoteRecord: remote, expectedBase: { kind: 'unknown' } },
  ]);
  expect(result.status).toBe('retained_pending');
  expect(result.record).toEqual(local);
  expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
});
it('366 days use a single queue query', async () => {
  const records = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].flatMap((days, month) =>
    Array.from({ length: days }, (_, i) =>
      day(`2024-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`, {
        R4: A(),
      })
    )
  );
  const query = vi.spyOn(hospitalDB.syncQueue, 'where');
  const start = performance.now();
  await admitRemoteDailyRecords(records.map(record => ({ record, remoteRecord: record })));
  writeFileSync(
    '/tmp/m6-batch-timing.json',
    JSON.stringify({
      days: records.length,
      milliseconds: performance.now() - start,
      queueQueries: query.mock.calls.length,
    })
  );
  expect(query).toHaveBeenCalledTimes(1);
});

for (const scenario of ['newborn-replaced', 'mother-and-newborn'] as const)
  it(scenario, async () => {
    const remote = day(DATE, {
      R4: A('R4', {
        clinicalCrib: A('R4', { patientName: 'RN sintético', clinicalEpisodeId: 'rn-A' }),
      }),
    });
    await hospitalDB.dailyRecords.put(remote);
    harnessState().remote = clone(remote);
    const { buildMedicalEntryNoteFields } = await import('@/domain/handoff/patientEntryMutations');
    const { updatePartialDetailed } =
      await import('@/services/repositories/dailyRecordRepositoryWriteService');
    const { fields } = buildMedicalEntryNoteFields(
      remote.beds.R4.clinicalCrib!,
      'entry-A',
      'Nota RN',
      null,
      DATE,
      '2026-10-24T10:00:00.000Z'
    );
    harnessState().offline = true;
    await updatePartialDetailed(
      DATE,
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [`beds.R4.clinicalCrib.${key}`, value])
      ) as DailyRecordPatch,
      { baseRecord: remote }
    );
    harnessState().offline = false;
    if (scenario === 'newborn-replaced') remote.beds.R4.clinicalCrib!.clinicalEpisodeId = 'rn-B';
    const tasks = await hospitalDB.syncQueue.toArray();
    const result = await admit(remote);
    expect(note(result.record ?? undefined)).toBe('');
    expect(result.record?.beds.R4.clinicalCrib?.medicalHandoffEntries?.[0].note).toBe(
      scenario === 'newborn-replaced' ? '' : 'Nota RN'
    );
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
  });
it('incompatible repeated reads neither write nor report retained work', async () => {
  const remote = await prepare();
  remote.beds.R4.medicalHandoffNote = 'Colega';
  remote.beds.R4.medicalHandoffEntries![0].note = 'Colega';
  await admit(remote);
  const writes = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
  const event = vi.fn();
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
  try {
    for (let i = 0; i < 3; i++) expect((await admit(remote)).status).toBe('admitted');
    expect(writes).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
  }
});
it('explicit sync exposes a local projection without acknowledging its payload', async () => {
  const remote = await prepare();
  harnessState().remote = clone(remote);
  const before = await hospitalDB.syncQueue.toArray();
  const { syncWithFirestoreDetailed } =
    await import('@/services/repositories/dailyRecordRepositorySyncService');
  const result = await syncWithFirestoreDetailed(DATE);
  expect(result?.sourceOfTruth).toBe('local');
  expect(note(result?.record ?? undefined)).toBe(NOTE);
  expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
  expect(note(harnessState().remote ?? undefined)).toBe('');
});
it('a failed batch commits neither a note overlay nor a draft or store event', async () => {
  const remote = await prepare();
  const before = await hospitalDB.dailyRecords.get(DATE);
  const tasks = await hospitalDB.syncQueue.toArray();
  const event = vi.fn();
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
  vi.spyOn(hospitalDB.dailyRecords, 'bulkPut').mockRejectedValueOnce(
    new Error('synthetic write failure')
  );
  try {
    remote.nursesDayShift = ['Changed'];
    await expect(admit(remote)).rejects.toThrow('synthetic write failure');
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(before);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
    expect(event).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
  }
});
