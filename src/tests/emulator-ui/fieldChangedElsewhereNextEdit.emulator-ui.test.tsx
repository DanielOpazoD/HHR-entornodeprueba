/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { setDailyRecordQueryData } from '@/hooks/controllers/dailyRecordQueryController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { reconcileAuthorizedSessionOwner } from '@/services/storage/sessionScopedStorageService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';

/**
 * What the census does after «El campo cambió en otro equipo» (W12-CW5): the screen keeps this
 * computer's text, and the person's next edit of that field must again meet the other computer's
 * text instead of replacing it unseen. The edits run through the census hook, whose base is the
 * record on screen, against the real rules in the Firestore emulator.
 */
vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return h.db;
  },
  auth: {
    currentUser: {
      uid: 'synthetic-B',
      email: 'synthetic-B@example.invalid',
      isAnonymous: false,
      getIdTokenResult: async () => ({ claims: { role: 'nurse_hospital' } }),
    },
  },
  firebaseReady: Promise.resolve(),
  storage: {},
  functions: {},
  getStorageInstance: vi.fn(),
  getFunctionsInstance: vi.fn(async () => ({})),
  getRegionalFunctionsInstance: vi.fn(async () => ({})),
  mountConfigWarning: vi.fn(),
}));

const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-field-changed-elsewhere';
const night = 'handoffNovedadesNightShift';
const base = (): DailyRecord =>
  JSON.parse(
    JSON.stringify(
      DataFactory.createMockDailyRecord(date, {
        lastUpdated: new Date(Date.now() - 60_000).toISOString(),
        handoffNovedadesDayShift: 'DIA BASE',
        handoffNovedadesNightShift: 'NOCHE BASE',
        activeExtraBeds: [],
      })
    )
  );

let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
const server = async () => (await admin.doc(dayPath).get()).data() as DailyRecord;

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = initializeApp({ projectId }, 'field-changed-elsewhere');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  h.db = env
    .authenticatedContext('synthetic-B', {
      role: 'nurse_hospital',
      email: 'synthetic-B@example.invalid',
    })
    .firestore();
  setFirestoreEnabled(true);
});
afterAll(async () => {
  await env?.cleanup();
  await deleteApp(app);
});

it('meets the other computer’s text again on the next edit after the notice', async () => {
  await admin.doc(dayPath).set(base());
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
  await hospitalDB.dailyRecords.put(base());
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  client.mount();
  setDailyRecordQueryData(client, date, base());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DefaultRepositoryProvider>{children}</DefaultRepositoryProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      useDailyRecordQuery(date, false, 'local_only');
      return usePatchDailyRecordMutation(date);
    },
    { wrapper }
  );
  const edit = async (field: keyof DailyRecord, value: string) => {
    let payload: { result?: { updatedRemotely?: boolean; observabilityTags?: string[] } } = {};
    await act(async () => {
      payload = (await hook.result.current.mutateAsync({
        date,
        partial: { [field]: value },
      } as never)) as typeof payload;
    });
    return payload.result;
  };

  // The other computer writes first; this screen has not received it yet.
  await admin.doc(dayPath).update({ [night]: 'A1', lastUpdated: Timestamp.now() });

  const first = await edit(night, 'B2');
  expect(first?.updatedRemotely).toBe(false);
  expect(first?.observabilityTags).toContain('field_changed_elsewhere');

  const second = await edit(night, 'B3');
  expect((await server())[night]).toBe('A1');
  expect(second?.updatedRemotely).toBe(false);
  expect(second?.observabilityTags).toContain('field_changed_elsewhere');

  // A field nobody else changed is still saved at once (#1603).
  const day = await edit('handoffNovedadesDayShift', 'B4');
  expect(day?.updatedRemotely).toBe(true);
  expect(await server()).toMatchObject({ handoffNovedadesDayShift: 'B4', [night]: 'A1' });

  hook.unmount();
  client.clear();
  client.unmount();
}, 60_000);
