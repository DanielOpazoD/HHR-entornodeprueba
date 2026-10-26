import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  A,
  E,
  harnessState,
  reconnect,
} from '@/tests/services/storage/specialistHandoffOutboxHarness';
import {
  local,
  cribNote,
  note,
  queue,
  readStored,
  remote,
  resetNoteDay,
  saveWholeDay,
  MODES,
} from '@/tests/services/storage/specialistHandoffNoteDaySupport';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';
// Use the real authority handler via the existing synthetic network boundary for direct saves.
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async importOriginal => ({
  ...(await importOriginal<object>()),
  saveRecordToFirestore: vi.fn(async (record, expectedLastUpdated, options) => {
    const { saveDailyRecordWithClinicalAuthorityCallable } =
      await import('@/services/storage/firestore/dailyRecordAuthorityCallableClient');
    return saveDailyRecordWithClinicalAuthorityCallable({
      date: record.date,
      record,
      expectedLastUpdated,
      mode: 'enforced',
      origin: options?.origin ?? 'direct_save',
      syncContract: options?.syncContract,
    });
  }),
}));
const OWNER = 'user:synthetic-discard-base-probe';
const h = harnessState();
beforeEach(() => resetNoteDay(OWNER));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const discard = async () => {
  await readStored({ R4: A('R4'), R6: E() });
  await note('R4', 'entry-A', 'Nota descartada');
  const stale = await local();
  h.role = 'doctor_specialist';
  await reconnect();
  const task = (await queue()).find(task => task.type === 'UPDATE_SPECIALIST_HANDOFF')!;
  expect(task.status).toBe('CONFLICT');
  expect(await createDexieSyncQueueStore().discardQuarantinedTask!(task.id!, OWNER)).toBe(true);
  expect(await queue()).toEqual([]);
  h.role = 'admin';
  return stale;
};
describe.each(MODES)('whole-save note writer base (%s)', (_mode, enforced) => {
  beforeEach(() => {
    h.authorityMode = enforced;
  });
  it.each(
    (['omitted', 'replaced', 'clinicalCrib'] as const).flatMap(removal =>
      [false, true].map(fresh => ({ removal, fresh }))
    )
  )(
    'checks the note base of a removed occupant ($removal, fresh base: $fresh)',
    async ({ removal, fresh }) => {
      const mother = A('R4', {
        patientName: 'Madre sintética',
        rut: '33.333.333-3',
        clinicalEpisodeId: 'ep-mother',
        clinicalCrib: A('R4'),
      });
      const stale = await readStored({
        R4: removal === 'clinicalCrib' ? mother : A('R4'),
        R6: E(),
      });
      if (removal === 'clinicalCrib') await cribNote('R4', 'entry-A', 'Nota aceptada más reciente');
      else await note('R4', 'entry-A', 'Nota aceptada más reciente');
      const before = await local();
      const tasks = await queue();
      const base = fresh ? before : stale;
      const incoming = structuredClone(base);
      if (removal === 'omitted') delete incoming.beds.R4;
      else if (removal === 'clinicalCrib') delete incoming.beds.R4.clinicalCrib;
      else
        incoming.beds.R4 = A('R4', {
          patientName: 'Paciente B sintético',
          rut: '88.888.888-8',
          clinicalEpisodeId: 'ep-B',
        });
      if (fresh) {
        await expect(saveWholeDay(incoming, undefined, base)).resolves.toMatchObject({
          savedLocally: true,
        });
        expect((await queue()).filter(task => task.type === 'UPDATE_SPECIALIST_HANDOFF')).toEqual(
          tasks
        );
      } else {
        await expect(saveWholeDay(incoming, undefined, base)).rejects.toMatchObject({
          name: 'ConcurrencyError',
        });
        expect(await local()).toEqual(before);
        expect(await queue()).toEqual(tasks);
      }
    }
  );

  it.each([false, true])(
    'does not let an older in-flight note replace a newer note (already confirmed: %s)',
    async confirmed => {
      await readStored({ R4: A('R4'), R6: E() });
      await note('R4', 'entry-A', 'Nota anterior');
      const stale = await local();
      const now = Date.parse('2026-10-24T10:31:00.000Z');
      const store = createDexieSyncQueueStore();
      const transport = createFirestoreSyncTransport();
      const claimed = await store.claimReadyPending(now, 1, OWNER, {
        leaseOwner: 'synthetic-note-publication',
        leaseUntil: now + 600_000,
        attemptId: 'synthetic-first-note',
      });
      expect(claimed).toHaveLength(1);
      // The first write may have committed while its response/ACK is still outstanding.
      if (confirmed) {
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        await transport.run(claimed[0]);
      }
      await note('R4', 'entry-A', 'Nota más reciente', '2026-10-24T10:32:00.000Z');
      if (confirmed) {
        const claim = {
          leaseOwner: 'synthetic-later-note',
          leaseUntil: now + 600_000,
          attemptId: 'later-note',
        };
        const [later] = await store.claimReadyPending(now + 120_000, 1, OWNER, claim);
        expect(later.id).not.toBe(claimed[0].id);
        const result = await transport.run(later);
        expect(await store.deleteClaimed(later.id!, claim, result?.authoritativeRecord)).toBe(true);
        expect(remote().beds.R4.medicalHandoffNote).toBe('Nota más reciente');
      }
      const before = await local();
      const tasks = await queue();
      expect(tasks).toHaveLength(confirmed ? 1 : 2);
      expect(before.beds.R4.medicalHandoffNote).toBe('Nota más reciente');

      await expect(
        saveWholeDay(
          { ...stale, handoffNovedadesDayShift: 'Edición independiente' },
          undefined,
          stale
        )
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(await local()).toEqual(before);
      expect(await queue()).toEqual(tasks);
    }
  );

  it('does not treat a retained refused note as permission to restore its released projection', async () => {
    await readStored({ R4: A('R4'), R6: E() });
    await note('R4', 'entry-A', 'Nota rechazada conservada');
    const stale = await local();
    h.role = 'doctor_specialist';
    await reconnect();
    h.role = 'admin';
    const before = await local();
    const tasks = await queue();
    expect(tasks).toMatchObject([{ status: 'CONFLICT' }]);
    expect(before.beds.R4.medicalHandoffNote).toBe('');
    await expect(
      saveWholeDay(
        { ...stale, handoffNovedadesDayShift: 'Edición independiente' },
        undefined,
        stale
      )
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(await local()).toEqual(before);
    expect(await queue()).toEqual(tasks);
  });

  it.each([false, true])(
    'refuses a stale discarded projection before accepting the new save (writer base: %s)',
    async withBase => {
      const stale = await discard();
      const before = await local();
      const incoming = {
        ...stale,
        beds: { ...stale.beds, R6: { ...stale.beds.R6, handoffNote: 'Entrega E' } },
      };
      await expect(
        saveWholeDay(incoming, undefined, withBase ? stale : undefined)
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(await local()).toEqual(before);
      expect(await queue()).toEqual([]);
      await reconnect();
      expect(remote().beds.R4.medicalHandoffNote).toBe('');
      // The caller can rebuild its separate edit from the actual stored base.
      await saveWholeDay(
        {
          ...before,
          beds: { ...before.beds, R6: { ...before.beds.R6, handoffNote: 'Entrega E' } },
        },
        undefined,
        before
      );
      await reconnect();
      expect(remote().beds.R6.handoffNote).toBe('Entrega E');
      expect(remote().beds.R4.medicalHandoffNote).toBe('');
      expect(await queue()).toEqual([]);
    }
  );
  it.each([false, true])(
    'does not revive a discarded note after the patient already left (writer base: %s)',
    async withBase => {
      const stale = await discard();
      await readStored({ R6: E() });
      const before = await local();
      const incoming = { ...stale, handoffNovedadesDayShift: 'Edición independiente' };
      await expect(
        saveWholeDay(incoming, undefined, withBase ? stale : undefined)
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(await local()).toEqual(before);
      expect(await queue()).toEqual([]);
      await reconnect();
      expect(remote().beds.R4?.medicalHandoffNote || '').toBe('');
    }
  );

  it.each(['bed', 'clinicalCrib'] as const)(
    'still refuses the stale note when the same patient and episode move to a %s',
    async slot => {
      const stale = await discard();
      const before = await local();
      const movedPatient = { ...stale.beds.R4, bedId: 'R8' };
      const incoming = {
        ...stale,
        beds: {
          ...stale.beds,
          R4: { ...E(), patientName: '', rut: '', clinicalEpisodeId: undefined },
          R8: slot === 'bed' ? movedPatient : { ...E(), clinicalCrib: movedPatient },
        },
      };
      await expect(saveWholeDay(incoming, undefined, stale)).rejects.toMatchObject({
        name: 'ConcurrencyError',
      });
      expect(await local()).toEqual(before);
      expect(await queue()).toEqual([]);
      await reconnect();
      expect(remote().beds.R4.medicalHandoffNote).toBe('');
      expect(remote().beds.R8).toBeUndefined();
    }
  );

  it('allows the same words to be deliberately written again from the fresh base', async () => {
    await discard();
    const fresh = await local();
    const { fields: noteFields } = buildMedicalEntryNoteFields(
      fresh.beds.R4,
      'entry-A',
      'Nota descartada',
      null,
      fresh.date,
      '2026-10-24T10:46:00.000Z'
    );
    await saveWholeDay(
      { ...fresh, beds: { ...fresh.beds, R4: { ...fresh.beds.R4, ...noteFields } } },
      undefined,
      fresh
    );
    await reconnect();
    expect(remote().beds.R4.medicalHandoffNote).toBe('Nota descartada');
    expect(await queue()).toEqual([]);
  });
  it.each([false, true])(
    'refuses online publication before any local or remote acceptance (authority first: %s)',
    async authorityFirst => {
      const stale = await discard();
      const before = await local();
      const beforeRemote = structuredClone(remote());
      const incoming = {
        ...stale,
        beds: { ...stale.beds, R6: { ...stale.beds.R6, handoffNote: 'Entrega E' } },
      };
      await expect(
        saveDetailed(incoming, incoming.lastUpdated, {
          baseRecord: stale,
          rayenStructuralWriteGuard: authorityFirst,
        })
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(await local()).toEqual(before);
      expect(remote()).toEqual(beforeRemote);
      expect(await queue()).toEqual([]);
    }
  );
});
