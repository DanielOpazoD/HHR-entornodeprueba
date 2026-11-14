import { captureAuthoringSession } from '@/services/storage/authoringSession';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
/* @flake-safe: Synthetic current-day record; no production Firebase configuration. */
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { type ReactNode } from 'react';

import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest';

import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';

import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';

import { reconcileAuthorizedSessionOwner } from '@/services/storage/sessionScopedStorageService';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';

vi.mock('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting', async original => ({
  ...(await original<object>()),
  shouldRouteSpecialistPatchViaCallable: async () => true,
}));
vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');
const activeDb = {};
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: {
    currentUser: {
      uid: 'n4d',
      email: 'n4d@example.invalid',
      isAnonymous: false,
      getIdTokenResult: async () => ({ claims: { role: 'doctor_specialist' } }),
    },
  },
  firebaseReady: Promise.resolve(),
  storage: {},
  functions: {},
  getStorageInstance: vi.fn(),
  getFunctionsInstance: vi.fn(),
  mountConfigWarning: vi.fn(),
}));
const date = getTodayISO();
const owner = 'user:n4d';
const text = 'Nota sintética N4d sin conexión';
const base = DataFactory.createMockDailyRecord(date, {
  beds: {
    R4: DataFactory.createMockPatient('R4', {
      patientName: 'PACIENTE SINTETICO N4D',
      clinicalEpisodeId: 'episode-n4d',
      admissionDate: date,
      medicalHandoffNote: '',
      medicalHandoffEntries: [{ id: 'entry-n4d', specialty: 'Medicina Interna', note: '' }],
    }),
  },
});
const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <DefaultRepositoryProvider>{children}</DefaultRepositoryProvider>
  </QueryClientProvider>
);
beforeAll(async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  onlineManager.setOnline(false);
  setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
  await reconcileAuthorizedSessionOwner(owner);
});
beforeEach(async () => {
  // Reset only the synthetic fixture owned by this suite.
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.put(base);
  clearPendingDailyRecordPatchesForTests();
});
afterEach(() => {
  cleanup();
  client.clear();
});
afterAll(() => {
  onlineManager.setOnline(true);
  hospitalDB.close();
});
it('successive specialist edits persist the final authored task without remote acknowledgement', async () => {
  await hospitalDB.dailyRecords.put(base);
  setDailyRecordQueryData(client, date, base);
  const hook = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
  let originalServerBase: string | undefined;
  for (const note of [text, text + ' final']) {
    const visible = client.getQueryData<DailyRecordQueryResult>(
      getDailyRecordQueryKey(date)
    )!.record!;
    const next = buildMedicalEntryNoteFields(
      visible.beds.R4,
      'entry-n4d',
      note,
      null,
      date,
      base.lastUpdated
    ).fields;
    await act(async () => {
      await hook.result.current.mutateAsync(
        Object.fromEntries(
          Object.entries(next).map(([k, v]) => [`beds.R4.${k}`, v])
        ) as DailyRecordPatch
      );
    });
    await waitFor(() =>
      expect(hook.result.current.isSuccess || hook.result.current.isError).toBe(true)
    );
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.isPaused).toBe(false);
    expect(hook.result.current.data?.result).toMatchObject({
      savedLocally: true,
      updatedRemotely: false,
      queuedForRetry: true,
    });
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    const target = (tasks[0].payload as { expectedOccupants: Array<{ handoffBases: string[] }> })
      .expectedOccupants[0];
    originalServerBase ??= target.handoffBases[0];
    expect(target.handoffBases[0]).toBe(originalServerBase);
    expect(tasks[0]).toMatchObject({
      ownerKey: owner,
      type: 'UPDATE_SPECIALIST_HANDOFF',
      payload: {
        expectedOccupants: [
          expect.objectContaining({
            clinicalEpisodeId: 'episode-n4d',
            patientName: base.beds.R4.patientName,
            rut: base.beds.R4.rut,
          }),
        ],
        patch: { 'beds.R4.medicalHandoffNote': note },
      },
    });
    expect((await hospitalDB.dailyRecords.get(date))?.beds.R4.medicalHandoffNote).toBe(note);
  }
});
it('rejects a stale tab after another tab accepted a different note', async () => {
  const { defaultDailyRecordRepositoryPort } = await import('@/application/ports/dailyRecordPort');
  const visible = (await hospitalDB.dailyRecords.get(date))!;
  setDailyRecordQueryData(client, date, visible);
  const hook = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
  const patchFor = (note: string): DailyRecordPatch =>
    Object.fromEntries(
      Object.entries(
        buildMedicalEntryNoteFields(
          visible.beds.R4,
          'entry-n4d',
          note,
          null,
          date,
          visible.lastUpdated
        ).fields
      ).map(([key, value]) => [`beds.R4.${key}`, value])
    ) as DailyRecordPatch;
  await defaultDailyRecordRepositoryPort.updatePartialDetailed(date, patchFor('OTRA PESTAÑA'), {
    authoringSession: captureAuthoringSession(),
    baseRecord: visible,
  });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(patchFor('MI EDICION OBSOLETA'))).rejects.toThrow(
      'Otra pestaña'
    );
  });
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R4.medicalHandoffNote).toBe(
    'OTRA PESTAÑA'
  );
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    { payload: { patch: { 'beds.R4.medicalHandoffNote': 'OTRA PESTAÑA' } } },
  ]);
});
it('leaves a newer visible record alone when the local save returns after it', async () => {
  const { defaultDailyRecordRepositoryPort: port } =
    await import('@/application/ports/dailyRecordPort');
  setDailyRecordQueryData(client, date, base);
  const hook = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
  const next = buildMedicalEntryNoteFields(
    base.beds.R4,
    'entry-n4d',
    'MI NOTA',
    null,
    date,
    base.lastUpdated
  ).fields;
  const save = port.updatePartialDetailed.bind(port);
  // Another team's note reaches the screen while this tab's accepted local save is returning.
  const spy = vi.spyOn(port, 'updatePartialDetailed').mockImplementation(async (...args) => {
    const result = await save(...args);
    setDailyRecordQueryData(client, date, {
      ...base,
      beds: {
        ...base.beds,
        R4: {
          ...base.beds.R4,
          medicalHandoffNote: 'OTRO EQUIPO',
          medicalHandoffEntries: [
            { id: 'entry-n4d', specialty: 'Medicina Interna', note: 'OTRO EQUIPO' },
          ],
        },
      },
    });
    return result;
  });
  try {
    await act(async () => {
      await hook.result.current.mutateAsync(
        Object.fromEntries(
          Object.entries(next).map(([k, v]) => [`beds.R4.${k}`, v])
        ) as DailyRecordPatch
      );
    });
  } finally {
    spy.mockRestore();
  }
  expect(
    client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))!.record!.beds.R4
      .medicalHandoffNote
  ).toBe('OTRO EQUIPO');
});
