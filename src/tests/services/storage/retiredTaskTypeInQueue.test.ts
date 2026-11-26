// @vitest-environment node
/**
 * Synthetic-only: a browser may still hold a specialist note task queued before the old medical
 * handoff was retired. The queue no longer knows that type: it keeps the row exactly as it was,
 * never deletes or publishes it, and the census day's own edits still sync.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, E, reconnect } from './dayRecordOutboxHarness';
import { DATE, local, queue, readStored, remote, resetDay, writeDay } from './dayRecordDaySupport';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const OWNER = 'user:synthetic-retired-task';
const legacyNote = {
  opId: 'UPDATE_SPECIALIST_HANDOFF:synthetic-legacy',
  type: 'UPDATE_SPECIALIST_HANDOFF',
  key: `handoff:${DATE}:[["R4","bed","RUT","99.999.999-9","Paciente A Sintético","ep-A"]]`,
  ownerKey: OWNER,
  payload: {
    date: DATE,
    patch: { 'beds.R4.medicalHandoffNote': 'Nota antigua sin enviar' },
    expectedOccupants: [
      {
        bedId: 'R4',
        target: 'bed',
        documentType: 'RUT',
        rut: '99.999.999-9',
        patientName: 'Paciente A Sintético',
        clinicalEpisodeId: 'ep-A',
      },
    ],
  },
  handoffProjection: {
    replaced: { 'beds.R4.medicalHandoffNote': '' },
    projected: { 'beds.R4.medicalHandoffNote': 'Nota antigua sin enviar' },
  },
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  contexts: ['handoff'],
} as unknown as SyncTask;

beforeEach(() => resetDay(OWNER));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('keeps a leftover specialist note task untouched while the day edits sync', async () => {
  await readStored({ R4: A('R4'), R6: E() });
  const legacyId = (await hospitalDB.syncQueue.add(legacyNote)) as number;
  await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });

  await reconnect();

  expect(remote().beds.R6.pathology).toBe('Dx E corregido');
  expect(remote().beds.R4.medicalHandoffNote).toBe('');
  expect((await local()).beds.R6.pathology).toBe('Dx E corregido');
  const tasks = await queue();
  expect(tasks.map(task => task.id)).toEqual([legacyId]);
  const [kept] = tasks;
  // Refused as an unknown type, never deleted, retired or published.
  expect(kept).toMatchObject({
    type: 'UPDATE_SPECIALIST_HANDOFF',
    key: legacyNote.key,
    ownerKey: OWNER,
    payload: legacyNote.payload,
  });
  expect(kept.status).not.toBe('RETIRED');
  expect(kept.error).toContain('Unsupported task type');
});
