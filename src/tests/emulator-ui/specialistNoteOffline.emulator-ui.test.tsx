/* @flake-safe: Synthetic current-day record; no production Firebase configuration. */
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import React, { type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork } from 'firebase/firestore';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { setDailyRecordQueryData } from '@/hooks/controllers/dailyRecordQueryController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { waitForFirestoreSdkSource } from '@/tests/utils/firestoreSdkSource';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { MedicalHandoffDraftTextarea } from '@/features/handoff/components/MedicalHandoffDraftTextarea';
import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';
import {
  readMedicalHandoffDrafts,
  resetMedicalHandoffDraftMemoryForTests,
} from '@/services/storage/medicalHandoffDraftStorage';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { resolveDailyRecordSyncStatus } from '@/hooks/controllers/dailyRecordSyncStatusController';

vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');
let activeDb: unknown;
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
const { fields } = buildMedicalEntryNoteFields(
  base.beds.R4,
  'entry-n4d',
  text,
  null,
  date,
  base.lastUpdated
);
const patch = Object.fromEntries(
  Object.entries(fields).map(([key, value]) => [`beds.R4.${key}`, value])
) as DailyRecordPatch;
let env: RulesTestEnvironment;
const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <DefaultRepositoryProvider>{children}</DefaultRepositoryProvider>
  </QueryClientProvider>
);
beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-hhr-n4d',
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  const db = env
    .authenticatedContext('n4d', { role: 'doctor_specialist', email: 'n4d@example.invalid' })
    .firestore();
  activeDb = db;
  await env.withSecurityRulesDisabled(async context => {
    await context
      .firestore()
      .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
      .set(JSON.parse(JSON.stringify(base)));
  });
  await disableNetwork(db);
  await waitForFirestoreSdkSource(db, `hospitals/hanga_roa/dailyRecords/${date}`, 'cache');
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  onlineManager.setOnline(false);
  setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
  await reconcileAuthorizedSessionOwner(owner);
});
afterEach(() => {
  cleanup();
  client.clear();
});
afterAll(async () => {
  onlineManager.setOnline(true);
  await env?.cleanup();
  hospitalDB.close();
});
it('control: the real repository already commits the specialist row and authored queue offline', async () => {
  await hospitalDB.dailyRecords.put(base);
  const result = await defaultDailyRecordRepositoryPort.updatePartialDetailed(date, patch, {
    baseRecord: base,
  });
  expect(result).toMatchObject({
    savedLocally: true,
    updatedRemotely: false,
    queuedForRetry: true,
  });
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    { ownerKey: owner, type: 'UPDATE_SPECIALIST_HANDOFF' },
  ]);
  // Clear only this synthetic fixture before exercising the editor independently.
  await hospitalDB.syncQueue.clear();
});
it('the editor commits offline, then retains its note and task across reopen and same-owner logout', async () => {
  await hospitalDB.dailyRecords.put(base);
  setDailyRecordQueryData(client, date, base);
  const hook = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
  render(
    <MedicalHandoffDraftTextarea
      patient={base.beds.R4}
      reportDate={date}
      entryId="entry-n4d"
      value=""
      onChangeValue={() => hook.result.current.mutateAsync(patch)}
    />
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.blur(screen.getByRole('textbox'));
  await waitFor(() =>
    expect(readMedicalHandoffDrafts()).toEqual([
      expect.objectContaining({ value: text, durable: true }),
    ])
  );
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.isPaused).toBe(false);
  expect(resolveDailyRecordSyncStatus([hook.result.current])).toBe('local');
  expect(hook.result.current.data?.result).toMatchObject({
    savedLocally: true,
    updatedRemotely: false,
    queuedForRetry: true,
  });
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(tasks).toMatchObject([
    {
      ownerKey: owner,
      type: 'UPDATE_SPECIALIST_HANDOFF',
      status: 'PENDING',
      payload: {
        expectedOccupants: [expect.objectContaining({ clinicalEpisodeId: 'episode-n4d' })],
      },
    },
  ]);
  expect(tasks[0].key).toMatch(new RegExp(`^handoff:${date}:`));
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R4.medicalHandoffNote).toBe(text);
  expect(screen.getByRole('status').textContent).toContain('Pendiente de confirmar');
  cleanup();
  client.clear();
  hospitalDB.close();
  await hospitalDB.open();
  resetMedicalHandoffDraftMemoryForTests();
  expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R4.medicalHandoffNote).toBe(text);
  render(
    <MedicalHandoffDraftTextarea
      patient={base.beds.R4}
      reportDate={date}
      entryId="entry-n4d"
      value={text}
      onChangeValue={vi.fn()}
    />
  );
  expect(screen.getByRole('status').textContent).toContain('Guardado en este equipo');
  cleanup();
  await act(async () => {
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(owner);
  });
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    { ownerKey: owner, payload: tasks[0].payload },
  ]);
  resetMedicalHandoffDraftMemoryForTests();
  expect(readMedicalHandoffDrafts()).toEqual([
    expect.objectContaining({ value: text, durable: true }),
  ]);
  render(
    <MedicalHandoffDraftTextarea
      patient={base.beds.R4}
      reportDate={date}
      entryId="entry-n4d"
      value=""
      onChangeValue={vi.fn()}
    />
  );
  expect(screen.getByText('Revisar borrador')).toBeTruthy();
  cleanup();
  hospitalDB.close();
  vi.resetModules();
  const { hospitalDB: reloadedDB } = await import('@/services/storage/indexeddb/indexedDbCore');
  const reloadedDrafts = await import('@/services/storage/medicalHandoffDraftStorage');
  expect(await reloadedDB.syncQueue.toArray()).toMatchObject([
    { ownerKey: owner, payload: tasks[0].payload },
  ]);
  expect(reloadedDrafts.readMedicalHandoffDrafts()).toEqual([
    expect.objectContaining({ value: text, durable: true }),
  ]);
  reloadedDB.close();
});
