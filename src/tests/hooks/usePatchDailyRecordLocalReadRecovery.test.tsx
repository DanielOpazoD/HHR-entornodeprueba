vi.unmock('@/application/ports/dailyRecordPort');
import 'fake-indexeddb/auto';
import { it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecordPartialWriteOptions } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
const transport = vi.hoisted(() => ({
  record: null as (DailyRecord & { meta: { revision: number } }) | null,
  writes: 0,
  revision: 1,
  reject: false,
}));
vi.mock('@/services/repositories/repositoryConfig', async original => ({
  ...(await original<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => true,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordFromFirestore: async () => transport.record,
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
  updateRecordPartial: async (
    _date: string,
    _patch: unknown,
    _version: string,
    options: DailyRecordPartialWriteOptions
  ) => {
    transport.writes++;
    expect(options.requireAtomicCas).toBe(true);
    expect(options.returnCommittedRecord).toBe(true);
    expect(options.specialtyIntent?.episodeId).toBe('synthetic');
    if (transport.reject || options.syncContract?.baseRevision !== transport.revision)
      throw new ConcurrencyError('Synthetic competing decision', 'semantic_conflict');
    return {
      recordState: {
        record: transport.record,
        lastUpdated: transport.record!.lastUpdated,
        meta: transport.record!.meta,
      },
    };
  },
}));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import {
  setDailyRecordQueryData,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { queryClient as appClient } from '@/config/queryClient';
import { Specialty } from '@/types/domain/patientClassification';
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});
it.each(['present', 'absent', 'once', 'always', 'competing'] as const)(
  'confirms only the authority accepted specialty after local read %s',
  async mode => {
    const date = '2026-10-24';
    const base = Object.assign(
      DataFactory.createMockDailyRecord(date, {
        lastUpdated: date + 'T10:00:00.000Z',
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'synthetic',
            specialty: Specialty.MEDICINA,
          }),
        },
      }),
      { meta: { revision: 1 } }
    );
    const local = structuredClone(base);
    if (mode === 'once') local.meta = { revision: 2 };
    if (mode !== 'absent') await hospitalDB.dailyRecords.put(local);
    const committed = structuredClone(base);
    committed.beds.R1.specialty = Specialty.CIRUGIA;
    committed.lastUpdated = date + 'T11:00:00.000Z';
    committed.meta = { revision: 3 };
    transport.record = committed;
    transport.writes = 0;
    transport.revision = mode === 'once' ? 2 : 1;
    transport.reject = mode === 'competing';
    const { wrapper, queryClient } = createQueryClientTestWrapper({
      config: { defaultOptions: appClient.getDefaultOptions() },
    });
    setDailyRecordQueryData(queryClient, date, base);
    const view = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
    const spy = vi.spyOn(hospitalDB.dailyRecords, 'get');
    if (mode === 'once') spy.mockRejectedValueOnce(new Error('LOCAL_FAIL'));
    if (mode === 'always' || mode === 'competing') spy.mockRejectedValue(new Error('LOCAL_FAIL'));
    let failure: unknown;
    await act(async () => {
      try {
        const response = await view.result.current.mutateAsync({
          date,
          partial: { 'beds.R1.specialty': Specialty.CIRUGIA },
          options: {
            baseRecord: base,
            requireAtomicCas: true,
            requireConfirmedRecord: true,
            requireRemoteAuthorityFirst: true,
            specialtyIntent: {
              kind: 'manual',
              bedId: 'R1',
              target: 'bed',
              episodeId: 'synthetic',
              value: Specialty.CIRUGIA,
              expectedDecisionId: null,
            },
          },
        });
        expect(response.result?.updatedRemotely).toBe(true);
      } catch (error) {
        failure = error;
      }
    });
    const visible = queryClient.getQueryData<DailyRecordQueryResult>(
      getDailyRecordQueryKey(date)
    )?.record;
    if (mode === 'competing') {
      expect(failure).toBeInstanceOf(ConcurrencyError);
      expect(view.result.current.error).toBe(failure);
      expect(visible?.beds.R1.specialty).toBe(Specialty.MEDICINA);
    } else {
      expect(failure).toBeUndefined();
      expect(visible?.beds.R1.specialty).toBe(Specialty.CIRUGIA);
    }
    expect(transport.writes).toBe(1);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    spy.mockRestore();
    expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.specialty).toBe(
      mode === 'competing' ? Specialty.MEDICINA : Specialty.CIRUGIA
    );
    cleanup();
    queryClient.clear();
  }
);
