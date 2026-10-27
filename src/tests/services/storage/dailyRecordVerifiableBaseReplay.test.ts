import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  A,
  B,
  E,
  harnessState,
  reconnect,
} from '@/tests/services/storage/specialistHandoffOutboxHarness';
import {
  local,
  queue,
  readStored,
  remote,
  remoteWrite,
  resetNoteDay,
  writeDay,
} from '@/tests/services/storage/specialistHandoffNoteDaySupport';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { persistHydratedRecordToLocalCache } from '@/services/repositories/dailyRecordLocalCachePersistence';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { extractClinicalAuthorityPatch } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { normalizeDailyRecordAuthorityError } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { retryQuarantinedSyncTask } from '@/services/storage/sync';

// Local repository and durable queue are real. Execute the production server handler at the
// simulated network boundary and keep the same error translation as the callable transport.
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async importOriginal => ({
  ...(await importOriginal<object>()),
  updateRecordPartial: vi.fn(async (date, patch, expectedLastUpdated, options) => {
    const { createAdminMock, createDailyRecordWriteAuthorityFunctions, makeContext } =
      await import('@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support');
    const { admin } = createAdminMock({ remoteData: JSON.parse(JSON.stringify(remote())) });
    try {
      const response = await createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: async () => 'admin',
      }).patchDailyRecordWithClinicalAuthority.run(
        {
          date,
          patch: extractClinicalAuthorityPatch(patch),
          expectedLastUpdated,
          syncContract: options?.syncContract,
          mode: 'enforced',
        },
        makeContext()
      );
      h.remote = JSON.parse(JSON.stringify(response.recordState.record));
      return response;
    } catch (error) {
      throw normalizeDailyRecordAuthorityError(error);
    }
  }),
}));
const h = harnessState();
beforeEach(async () => {
  await resetNoteDay('user:synthetic-r04-replay');
  h.authorityMode = true;
  vi.mocked(updateRecordPartial).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([false, true])(
  'keeps a baseless patch durable after reconnect and hydration (other occupant changed: %s)',
  async otherOccupantChanged => {
    await readStored({ R4: A('R4'), R6: E() });
    const base = { ...(await local()), lastUpdated: '' };
    await hospitalDB.dailyRecords.put(base);
    const result = await updatePartialDetailed(
      base.date,
      { 'beds.R6.pathology': 'PENDIENTE SINTETICO' },
      { baseRecord: base }
    );
    expect(result.updatedRemotely).toBe(false);
    expect(remote().beds.R6.pathology).toBe('Dx E');
    const [pending] = await queue();
    expect(pending.syncContract?.expectedVersion).toBe('');
    expect(pending.payload).toMatchObject({ beds: { R6: { pathology: 'PENDIENTE SINTETICO' } } });
    if (otherOccupantChanged) {
      // Force the existing identity-aware merge, which must not invent the missing write base.
      h.remote = { ...remote(), beds: { ...remote().beds, R4: B() } };
    }
    await reconnect();
    const [refused] = await queue();
    expect(remote().beds.R6.pathology).toBe('Dx E');
    expect(refused).toMatchObject({ id: pending.id, status: 'FAILED', payload: pending.payload });
    // Replaying an unchanged, baseless write cannot supply its original remote version.
    expect(refused.id).toEqual(expect.any(Number));
    if (refused.id === undefined) throw new Error('Expected a durable queue id');
    hospitalDB.close();
    await hospitalDB.open();
    await expect(retryQuarantinedSyncTask(refused.id)).resolves.toBe(false);
    expect(await queue()).toEqual([refused]);
    expect(await queue()).toHaveLength(1);
    const hydrated = await persistHydratedRecordToLocalCache(remote(), base.date);
    expect(hydrated.beds.R6.pathology).toBe('PENDIENTE SINTETICO');
    expect(await queue()).toEqual([refused]);
    await expect(retryQuarantinedSyncTask(refused.id)).resolves.toBe(false);
    await reconnect();
    expect(remote().beds.R6.pathology).toBe('Dx E');
    expect(await queue()).toEqual([refused]);
    expect(updateRecordPartial).toHaveBeenCalledOnce();
  }
);

it('publishes a patch whose writer keeps the actual stored version', async () => {
  const base = await readStored({ R4: A('R4'), R6: E() });
  const result = await updatePartialDetailed(
    base.date,
    { 'beds.R6.pathology': 'ACEPTADO SINTETICO' },
    { baseRecord: base }
  );
  expect(result.updatedRemotely).toBe(true);
  expect(remote().beds.R6.pathology).toBe('ACEPTADO SINTETICO');
  expect(await queue()).toHaveLength(0);
});

it.each([false, true])(
  'retains a conflicting base even when the remote clock moved backwards (revision: %s)',
  async withRevision => {
    await readStored(
      { R4: A('R4'), R6: E() },
      undefined,
      withRevision ? { revision: 1 } : undefined
    );
    await writeDay({ 'beds.R6.pathology': 'PENDIENTE SINTETICO' });
    const [pending] = await queue();
    remoteWrite(
      { R4: A('R4', { pathology: 'OTRA EDICION REMOTA' }), R6: E() },
      '2026-10-24T09:50:00.000Z',
      withRevision ? { revision: 2 } : undefined
    );

    await reconnect();

    expect(remote().beds.R6.pathology).toBe('Dx E');
    expect(remote().beds.R4.pathology).toBe('OTRA EDICION REMOTA');
    expect(await queue()).toMatchObject([
      { id: pending.id, status: 'CONFLICT', payload: pending.payload },
    ]);
  }
);

it('retains the task when the remote changes after the read even at the same timestamp', async () => {
  await readStored({ R4: A('R4'), R6: E() }, undefined, { revision: 1 });
  await writeDay({ 'beds.R6.pathology': 'PENDIENTE SINTETICO' });
  const [pending] = await queue();
  const commit = authority.saveDailyRecordWithClinicalAuthorityCallable;
  vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementationOnce(
    async payload => {
      expect(payload.expectedLastUpdated).toBe('2026-10-24T10:00:00.000Z');
      expect(payload.syncContract?.baseRevision).toBe(1);
      remoteWrite(
        { R4: A('R4', { pathology: 'GANADOR DE LA CARRERA' }), R6: E() },
        '2026-10-24T10:00:00.000Z',
        { revision: 2 }
      );
      return commit(payload);
    }
  );

  await reconnect();

  expect(remote().beds.R4.pathology).toBe('GANADOR DE LA CARRERA');
  expect(remote().beds.R6.pathology).toBe('Dx E');
  expect(await queue()).toMatchObject([
    { id: pending.id, status: 'CONFLICT', payload: pending.payload },
  ]);
});
