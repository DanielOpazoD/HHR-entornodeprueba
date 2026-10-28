import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, E, day, harnessState, reconnect } from './specialistHandoffOutboxHarness';
import {
  asQueuedBeforeFix,
  cribNote,
  DATE,
  dayTasks,
  expectRefusedNoteKept,
  local,
  MODES,
  note,
  queue,
  readStored,
  remote,
  resetNoteDay,
  saveWholeDay,
  writeDay,
} from './specialistHandoffNoteDaySupport';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { buildTaskClaim } from '@/services/storage/sync/syncQueueTaskFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { reconcileSpecialistHandoffProjections } from '@/services/storage/sync/dexieDailyRecordOutbox';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { runTransaction } from 'firebase/firestore';

const OWNER = 'user:synthetic-projection-failures';
const h = harnessState();
beforeEach(() => resetNoteDay(OWNER));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const queueNote = async () => {
  await readStored({ R4: A('R4'), R6: E() });
  await note('R4', 'entry-A', 'Nota de A');
  return (await queue())[0];
};

it.each(MODES)(
  'settles an explicitly retried note and retains a later stale whole-day save (%s)',
  async (_mode, enforced) => {
    h.authorityMode = enforced;
    const task = await queueNote();
    h.role = 'doctor_specialist';
    await reconnect();
    expect((await local()).beds.R4.medicalHandoffNote).toBe('');
    expect((await hospitalDB.syncQueue.get(task.id!))?.status).toBe('CONFLICT');
    h.role = 'admin';
    const store = createDexieSyncQueueStore();
    expect(await store.requeueQuarantinedTask!(task.id!, OWNER)).toBe(true);
    await reconnect();

    expect(remote().beds.R4.medicalHandoffNote).toBe('Nota de A');
    expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota de A');
    expect(await queue()).toEqual([]);
    const shown = await local();
    await saveWholeDay({
      ...shown,
      beds: { ...shown.beds, R6: { ...shown.beds.R6, handoffNote: 'Entrega E' } },
    });
    const [pending] = await dayTasks();
    await reconnect();
    expect(remote().beds.R4.medicalHandoffNote).toBe('Nota de A');
    expect(remote().beds.R6.handoffNote).toBe('');
    expect((await local()).beds.R6.handoffNote).toBe('Entrega E');
    expect(await dayTasks()).toMatchObject([
      {
        id: pending.id,
        status: 'CONFLICT',
        payload: pending.payload,
        syncContract: pending.syncContract,
      },
    ]);
    for (const held of await dayTasks())
      expect((held.payload as DailyRecord).beds.R4.medicalHandoffNote).toBe('Nota de A');
  }
);

it.each(MODES)(
  'settles an already accepted pre-refusal day copy after note retry (%s)',
  async (_mode, enforced) => {
    h.authorityMode = enforced;
    const task = await queueNote();
    const stale = await local();
    await saveWholeDay({
      ...stale,
      beds: { ...stale.beds, R6: { ...stale.beds.R6, handoffNote: 'Entrega E' } },
    });
    await note('R4', 'entry-A', 'Nota confirmada', '2026-10-24T10:50:00.000Z');
    h.role = 'doctor_specialist';
    await reconnect();
    h.role = 'admin';
    const store = createDexieSyncQueueStore();
    expect(await store.requeueQuarantinedTask!(task.id!, OWNER)).toBe(true);
    await reconnect();
    expect(remote().beds.R4.medicalHandoffNote).toBe('Nota confirmada');
    expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota confirmada');
    const pending = await dayTasks();
    for (const dayTask of pending)
      expect((dayTask.payload as DailyRecord).beds.R4.medicalHandoffNote).toBe('Nota confirmada');
    expect(
      remote().beds.R6.handoffNote === 'Entrega E' ||
        pending.some(
          dayTask => (dayTask.payload as DailyRecord).beds.R6.handoffNote === 'Entrega E'
        )
    ).toBe(true);
  }
);

it('settles a quarantined note whose server response was lost when its receipt is retried', async () => {
  const task = await queueNote();
  h.loseNextResponse = true;
  await reconnect();
  expect(remote().beds.R4.medicalHandoffNote).toBe('Nota de A');
  await hospitalDB.syncQueue.update(task.id!, { status: 'FAILED' });
  await reconnect();
  expect((await local()).beds.R4.medicalHandoffNote).toBe('');
  const store = createDexieSyncQueueStore();
  expect(await store.requeueQuarantinedTask!(task.id!, OWNER)).toBe(true);
  await reconnect();
  expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota de A');
  expect(remote().beds.R4.medicalHandoffNote).toBe('Nota de A');
  expect(await queue()).toEqual([]);
});

it('preserves a newer local note while acknowledging an explicitly retried note', async () => {
  const task = await queueNote();
  h.role = 'doctor_specialist';
  await reconnect();
  h.role = 'admin';
  const store = createDexieSyncQueueStore();
  expect(await store.requeueQuarantinedTask!(task.id!, OWNER)).toBe(true);
  const [claimed] = await store.claimReadyPending(Date.now() + 60_000, 1, OWNER, {
    leaseOwner: 'synthetic-retry-worker',
    leaseUntil: Date.now() + 120_000,
    attemptId: 'synthetic-retry-attempt',
  });
  const claim = buildTaskClaim(claimed)!;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  await createFirestoreSyncTransport().run(claimed);
  await note('R4', 'entry-A', 'Nota local más reciente', '2026-10-24T10:55:00.000Z');
  expect(await store.deleteClaimed(claimed.id!, claim)).toBe(true);
  expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota local más reciente');
  expect(remote().beds.R4.medicalHandoffNote).toBe('Nota de A');
  const [newer] = await queue();
  expect(newer.id).not.toBe(claimed.id);
  expect(JSON.stringify(newer.payload)).toContain('Nota local más reciente');
  await hospitalDB.syncQueue.update(newer.id!, { status: 'CONFLICT' });
  await reconnect();
  expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota de A');
});

it('does not replay any day task when legacy projection repair fails, and retries the repair', async () => {
  const noteTask = await queueNote();
  await asQueuedBeforeFix('CONFLICT');
  await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
  const before = structuredClone(remote());
  const failure = vi
    .spyOn(hospitalDB.syncQueue, 'update')
    .mockRejectedValue(new Error('synthetic IndexedDB repair failure'));

  await reconnect();

  expect(remote()).toEqual(before);
  expect((await dayTasks()).map(task => task.status)).toEqual(['PENDING']);
  expect((await hospitalDB.syncQueue.get(noteTask.id!))?.handoffProjection).toBeUndefined();
  failure.mockRestore();
  await reconnect();
  expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de A');
  expect(remote().beds.R6.pathology).toBe('Dx E corregido');
  expect(await dayTasks()).toEqual([]);
});

it('keeps both the note and its projection metadata if discard restoration fails', async () => {
  const noteTask = await queueNote();
  await hospitalDB.syncQueue.update(noteTask.id!, { status: 'CONFLICT' });
  const before = await local();
  const storedNote = await hospitalDB.syncQueue.get(noteTask.id!);
  const store = createDexieSyncQueueStore();
  const failure = vi
    .spyOn(hospitalDB.dailyRecords, 'put')
    .mockRejectedValueOnce(new Error('synthetic IndexedDB discard failure'));

  await expect(store.discardQuarantinedTask!(noteTask.id!, OWNER)).rejects.toThrow(
    'synthetic IndexedDB discard failure'
  );

  expect(await hospitalDB.syncQueue.get(noteTask.id!)).toEqual(storedNote);
  expect(await local()).toEqual(before);
  failure.mockRestore();
  expect(await store.discardQuarantinedTask!(noteTask.id!, OWNER)).toBe(true);
  expect(await queue()).toEqual([]);
  expect((await local()).beds.R4.medicalHandoffNote).toBe('');
});

it('retries a refused note cleanup after a storage failure without losing its text', async () => {
  await queueNote();
  h.role = 'doctor_specialist';
  const failure = vi
    .spyOn(hospitalDB.dailyRecords, 'put')
    .mockRejectedValueOnce(new Error('synthetic IndexedDB refusal failure'));

  await reconnect().catch(error => {
    expect(error.message).toContain('synthetic IndexedDB refusal failure');
  });

  expect((await queue())[0].handoffProjection?.projected).not.toEqual({});
  expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota de A');
  expect(remote().beds.R4.medicalHandoffNote).toBe('');
  failure.mockRestore();
  // A failed transaction may retain its processing lease. The next pass runs after it expires.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 31_000);
  await reconnect();

  expect((await local()).beds.R4.medicalHandoffNote).toBe('');
  await expectRefusedNoteKept();
});

it('repairs a previously quarantined projection before later day tasks can replay', async () => {
  const noteTask = await queueNote();
  await hospitalDB.syncQueue.update(noteTask.id!, { status: 'CONFLICT' });
  const failure = vi
    .spyOn(hospitalDB.dailyRecords, 'put')
    .mockRejectedValue(new Error('synthetic IndexedDB quarantined cleanup failure'));

  await reconnect();

  expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota de A');
  expect((await hospitalDB.syncQueue.get(noteTask.id!))?.handoffProjection?.projected).not.toEqual(
    {}
  );
  failure.mockRestore();
  await reconnect();
  expect((await local()).beds.R4.medicalHandoffNote).toBe('');
  const retained = await hospitalDB.syncQueue.get(noteTask.id!);
  expect(retained?.status).toBe('CONFLICT');
  expect(JSON.stringify(retained?.payload)).toContain('Nota de A');
  expect(retained?.handoffProjection).toEqual({ ...noteTask.handoffProjection, released: true });
  expect(await reconcileSpecialistHandoffProjections()).toEqual([]);
});

it('settles a confirmed note and its queued day copies atomically with the local ACK', async () => {
  await queueNote();
  await saveWholeDay(await local());
  await note('R4', 'entry-A', 'Nota confirmada', '2026-10-24T10:50:00.000Z');
  await saveWholeDay(await local(), '2026-10-24T10:55:00.000Z');
  const store = createDexieSyncQueueStore();
  const tasks = await store.claimReadyPending(Date.now() + 60 * 60 * 1000, 25, OWNER, {
    leaseOwner: 'synthetic-confirmation-worker',
    leaseUntil: Date.now() + 2 * 60 * 60 * 1000,
    attemptId: 'synthetic-confirmation-attempt',
  });
  const noteTask = tasks.find(task => task.type === 'UPDATE_SPECIALIST_HANDOFF')!;
  const claim = buildTaskClaim(noteTask)!;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  await createFirestoreSyncTransport().run(noteTask);
  expect(remote().beds.R4.medicalHandoffNote).toBe('Nota confirmada');
  const beforeDay = await local();
  const beforeTasks = await queue();
  const failure = vi
    .spyOn(hospitalDB.syncQueue, 'delete')
    .mockRejectedValueOnce(new Error('synthetic IndexedDB ACK failure'));

  await expect(store.deleteClaimed(noteTask.id!, claim)).rejects.toThrow(
    'synthetic IndexedDB ACK failure'
  );

  expect(await local()).toEqual(beforeDay);
  expect(await queue()).toEqual(beforeTasks);
  failure.mockRestore();
  expect(await store.deleteClaimed(noteTask.id!, claim)).toBe(true);
  expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota confirmada');
  expect(await hospitalDB.syncQueue.get(noteTask.id!)).toBeUndefined();
  expect(
    (await dayTasks()).map(task => (task.payload as DailyRecord).beds.R4.medicalHandoffNote)
  ).toEqual(['Nota confirmada']);
});

it('does not let a retired legacy note change the base of current pending work', async () => {
  const retired = await queueNote();
  await hospitalDB.syncQueue.update(retired.id!, {
    status: 'RETIRED',
    handoffProjection: undefined,
  });
  await readStored({ R4: A('R4'), R6: E() });
  await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
  const beforeDay = await local();
  const beforeQueue = await queue();

  expect(await reconcileSpecialistHandoffProjections()).toEqual([]);

  expect(await local()).toEqual(beforeDay);
  expect(await queue()).toEqual(beforeQueue);
});

it('invalidates a legacy cached-day version while preserving held edits until explicit discard', async () => {
  await queueNote();
  await asQueuedBeforeFix('CONFLICT');
  await writeDay({ 'beds.R6.pathology': 'Dx E conservado' });
  const [heldDay] = await dayTasks();
  await hospitalDB.syncQueue.update(heldDay.id!, { status: 'CONFLICT' });
  const payloadBefore = (await dayTasks())[0].payload;

  await reconcileSpecialistHandoffProjections();

  expect((await local()).lastUpdated).toBe('1970-01-01T00:00:00.000Z');
  expect((await dayTasks())[0].payload).toEqual(payloadBefore);
  expect(await createDexieSyncQueueStore().discardQuarantinedTask!(heldDay.id!, OWNER)).toBe(true);
  h.remote = day(
    DATE,
    {
      R4: A('R4', {
        patientName: 'Paciente B Sintético',
        rut: '88.888.888-8',
        clinicalEpisodeId: 'ep-B',
      }),
      R6: E(),
    },
    '2026-10-24T10:15:00.000Z'
  );
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  await syncWithFirestoreDetailed(DATE);

  expect((await local()).beds.R4.patientName).toBe('Paciente B Sintético');
  expect((await local()).beds.R4.medicalHandoffNote).toBe('');
  expect(JSON.stringify((await queue())[0].payload)).toContain('Nota de A');
});

it('keeps a newer local edit when ACK sees an invalidated version with different content', async () => {
  await queueNote();
  await asQueuedBeforeFix('CONFLICT');
  await writeDay({ 'beds.R6.pathology': 'Dx E conservado' });
  await reconcileSpecialistHandoffProjections();
  const store = createDexieSyncQueueStore();
  const [task] = await store.claimReadyPending(Date.now() + 60 * 60 * 1000, 25, OWNER, {
    leaseOwner: 'synthetic-legacy-worker',
    leaseUntil: Date.now() + 2 * 60 * 60 * 1000,
    attemptId: 'synthetic-legacy-attempt',
  });
  const claim = buildTaskClaim(task)!;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  const result = await createFirestoreSyncTransport().run(task);
  expect(result?.authoritativeRecord).toBeDefined();
  const current = await local();
  await hospitalDB.dailyRecords.put({
    ...current,
    beds: { ...current.beds, R6: { ...current.beds.R6, handoffNote: 'Edición local posterior' } },
  });

  await expect(
    store.deleteClaimed(task.id!, claim, result?.authoritativeRecord)
  ).rejects.toMatchObject({
    code: 'sync_ack_projection_conflict',
  });

  expect((await local()).beds.R6.handoffNote).toBe('Edición local posterior');
  expect(await hospitalDB.syncQueue.get(task.id!)).toBeDefined();
});

it('acknowledges an already committed whole-day mutation even when its legacy base was invalidated', async () => {
  await readStored({ R4: A('R4'), R6: E() });
  await saveWholeDay(await local());
  const [pending] = await dayTasks();
  await hospitalDB.syncQueue.update(pending.id!, {
    syncContract: { ...pending.syncContract, expectedVersion: '1970-01-01T00:00:00.000Z' },
  });
  await hospitalDB.dailyRecords.put({
    ...(await local()),
    lastUpdated: '1970-01-01T00:00:00.000Z',
  });
  h.remote = Object.assign({}, pending.payload as DailyRecord, {
    meta: { lastMutationId: pending.syncContract!.mutationId },
  });
  const store = createDexieSyncQueueStore();
  const [task] = await store.claimReadyPending(Date.now() + 60 * 60 * 1000, 25, OWNER, {
    leaseOwner: 'synthetic-receipt-worker',
    leaseUntil: Date.now() + 2 * 60 * 60 * 1000,
    attemptId: 'synthetic-receipt-attempt',
  });
  const claim = buildTaskClaim(task)!;
  vi.mocked(runTransaction).mockClear();

  const result = await createFirestoreSyncTransport().run(task);

  expect(result?.authoritativeRecord).toBeDefined();
  expect(runTransaction).not.toHaveBeenCalled();
  expect(await store.deleteClaimed(task.id!, claim, result?.authoritativeRecord)).toBe(true);
  expect(await dayTasks()).toEqual([]);
});

it.each(['bed', 'clinicalCrib'] as const)(
  'does not restore an old patients note on a newly read %s occupant with identical text',
  async slot => {
    const bedWith = (patient: DailyRecord['beds'][string]) =>
      slot === 'bed'
        ? patient
        : A('R4', {
            patientName: 'Madre Sintética',
            rut: '33.333.333-3',
            clinicalEpisodeId: 'ep-mother',
            medicalHandoffNote: 'Entrega madre',
            clinicalCrib: patient,
          });
    const occupant = (record: DailyRecord) =>
      slot === 'bed' ? record.beds.R4 : record.beds.R4.clinicalCrib!;
    await readStored({ R4: bedWith(A('R4')), R6: E() });
    if (slot === 'bed') await note('R4', 'entry-A', 'Nota de A');
    else await cribNote('R4', 'entry-A', 'Nota de A');
    h.remote = day(
      DATE,
      {
        R4: bedWith(
          A('R4', {
            patientName: 'Paciente B Sintético',
            rut: '88.888.888-8',
            clinicalEpisodeId: 'ep-B',
            medicalHandoffNote: 'Nota de A',
          })
        ),
        R6: E(),
      },
      '2026-10-24T10:15:00.000Z'
    );
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await syncWithFirestoreDetailed(DATE);
    expect(occupant(await local()).patientName).toBe('Paciente B Sintético');

    await reconnect();

    expect(occupant(await local())).toMatchObject({
      patientName: 'Paciente B Sintético',
      medicalHandoffNote: 'Nota de A',
    });
    if (slot === 'clinicalCrib')
      expect((await local()).beds.R4.medicalHandoffNote).toBe('Entrega madre');
    await expectRefusedNoteKept();
  }
);
