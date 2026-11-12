/* @flake-safe: Synthetic current-day record; emulator only. */
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import React, { type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
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
import { buildSpecialistHandoffTargets } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { resolvePatchOutcomeFeedback } from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { processSyncQueue } from '@/services/storage/sync';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';

vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

const h = vi.hoisted(() => ({
  activeDb: undefined as unknown,
  specialist: true,
  calls: [] as Array<{ name: string; data: unknown }>,
  server: undefined as undefined | ((name: string, data: unknown) => Promise<unknown>),
}));
vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    h.calls.push({ name, data: JSON.parse(JSON.stringify(data)) });
    if (!h.server) throw new Error('no server');
    return { data: await h.server(name, data) };
  },
}));
vi.mock('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting', async original => ({
  ...(await original<object>()),
  shouldRouteSpecialistPatchViaCallable: async () => h.specialist,
}));
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return h.activeDb;
  },
  auth: {
    currentUser: {
      uid: 'n4d',
      email: 'n4d@example.invalid',
      isAnonymous: false,
      getIdTokenResult: async () => ({
        claims: { role: h.specialist ? 'doctor_specialist' : 'admin' },
      }),
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
const projectId = 'demo-hhr-n4d-review';
const owner = 'user:n4d';
const patientA = (bedId: string) =>
  DataFactory.createMockPatient(bedId, {
    patientName: 'PACIENTE SINTETICO A',
    rut: '11111111-1',
    clinicalEpisodeId: 'episode-a',
    admissionDate: date,
    medicalHandoffNote: '',
    medicalHandoffEntries: [
      { id: 'entry-x', specialty: 'Medicina Interna', note: '' },
      { id: 'entry-y', specialty: 'Cirugía', note: '' },
    ],
  });
const base = (): DailyRecord =>
  JSON.parse(
    JSON.stringify(
      DataFactory.createMockDailyRecord(date, {
        lastUpdated: new Date(Date.now() - 60_000).toISOString(),
        beds: {
          R4: patientA('R4'),
          R3: DataFactory.createMockPatient('R3', {
            patientName: 'PACIENTE SINTETICO C',
            rut: '33333333-3',
            clinicalEpisodeId: 'episode-c',
            admissionDate: date,
            medicalHandoffNote: '',
            medicalHandoffEntries: [{ id: 'entry-z', specialty: 'Pediatría', note: '' }],
          }),
          R2: DataFactory.createMockPatient('R2', { patientName: '', rut: '' }),
        },
      })
    )
  );

let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
let specialistDb: unknown;
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <DefaultRepositoryProvider>{children}</DefaultRepositoryProvider>
  </QueryClientProvider>
);
const readServer = async () => {
  const data = (await admin.doc(dayPath).get()).data() as DailyRecord;
  return data;
};
const notesOf = (record: DailyRecord | undefined, bedId: string) =>
  (record?.beds?.[bedId]?.medicalHandoffEntries ?? []).map(entry => `${entry.id}=${entry.note}`);
const drafts = () =>
  readMedicalHandoffDrafts().map(d => ({
    entryId: d.entryId,
    value: d.value,
    durable: d.durable,
    episode: d.clinicalEpisodeId,
    conflict: (d as { conflict?: unknown }).conflict ?? null,
  }));

const offline = async () => {
  await disableNetwork(h.activeDb as never);
  await new Promise(resolve => setTimeout(resolve, 10000));
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  onlineManager.setOnline(false);
  setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
};
const online = async () => {
  await enableNetwork(h.activeDb as never);
  await new Promise(resolve => setTimeout(resolve, 10000));
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  setFirestoreSyncState({ mode: 'enabled', reason: 'ready' });
  await act(async () => {
    onlineManager.setOnline(true);
  });
};
const publish = async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20_000);
  try {
    await act(async () => {
      await processSyncQueue();
    });
  } finally {
    clock.mockRestore();
  }
};

type Save = { bedId: string; entryId: string; text: string; ms?: number; outcome?: unknown };
const saves: Save[] = [];

const Harness: React.FC<{
  mutate: (input: unknown) => Promise<unknown>;
  cells: Array<{ bedId: string; entryId: string }>;
}> = ({ mutate, cells }) => {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => client.getQueryCache().subscribe(() => force()), []);
  const record = client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record;
  if (!record) return null;
  return (
    <>
      {cells.map(({ bedId, entryId }) => {
        const patient = record.beds[bedId];
        const stored = patient.medicalHandoffEntries?.find(e => e.id === entryId)?.note ?? '';
        return (
          <div key={`${bedId}:${entryId}`} data-testid={`${bedId}:${entryId}`}>
            <MedicalHandoffDraftTextarea
              patient={patient}
              reportDate={date}
              entryId={entryId}
              value={stored}
              onChangeValue={text => {
                // Same shape as the app: fields from the visible record, targets from it too.
                const visible = client.getQueryData<DailyRecordQueryResult>(
                  getDailyRecordQueryKey(date)
                )!.record!;
                const { fields } = buildMedicalEntryNoteFields(
                  visible.beds[bedId],
                  entryId,
                  text,
                  null,
                  date,
                  new Date().toISOString()
                );
                const partial = Object.fromEntries(
                  Object.entries(fields).map(([key, value]) => [`beds.${bedId}.${key}`, value])
                ) as DailyRecordPatch;
                const save: Save = { bedId, entryId, text };
                saves.push(save);
                const started = performance.now();
                return mutate({
                  date,
                  partial,
                  options: {
                    specialistHandoffTargets: buildSpecialistHandoffTargets(visible, partial),
                  },
                }).then(
                  payload => {
                    save.ms = Math.round(performance.now() - started);
                    const result = (payload as { result: Record<string, unknown> }).result;
                    save.outcome = {
                      updatedRemotely: result?.updatedRemotely,
                      savedLocally: result?.savedLocally,
                      queuedForRetry: result?.queuedForRetry,
                      outcome: result?.outcome,
                      toast: resolvePatchOutcomeFeedback(result as never),
                    };
                    return payload;
                  },
                  error => {
                    save.ms = Math.round(performance.now() - started);
                    save.outcome = { error: String((error as Error)?.message ?? error) };
                    throw error;
                  }
                );
              }}
            />
          </div>
        );
      })}
    </>
  );
};

const type = async (bedId: string, entryId: string, text: string) => {
  const box = within(
    document.querySelector(`[data-testid="${bedId}:${entryId}"]`) as HTMLElement
  ).getByRole('textbox');
  await act(async () => {
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: text } });
    fireEvent.blur(box);
  });
};
const settle = async (count: number, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (saves.length >= count && saves.slice(0, count).every(s => s.outcome !== undefined)) return;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  }
};
const status = (bedId: string, entryId: string) =>
  within(document.querySelector(`[data-testid="${bedId}:${entryId}"]`) as HTMLElement)
    .queryAllByRole('status')
    .map(node => node.textContent)
    .join(' | ');
const mount = (cells: Array<{ bedId: string; entryId: string }>) => {
  const hook = renderHook(
    () => {
      useDailyRecordQuery(date, false, 'local_only');
      return usePatchDailyRecordMutation(date);
    },
    { wrapper }
  );
  render(
    <QueryClientProvider client={client}>
      <Harness mutate={input => hook.result.current.mutateAsync(input as never)} cells={cells} />
    </QueryClientProvider>
  );
  return hook;
};
beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = initializeApp({ projectId }, 'n4d-review');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  const require = createRequire(import.meta.url);
  const {
    createSpecialistMedicalHandoffFunctions,
  } = require('../../../functions/lib/specialistMedicalHandoffFunctions.js');
  const api = createSpecialistMedicalHandoffFunctions({
    firestore: admin,
    Timestamp,
    resolveRoleForEmail: async () => 'doctor_specialist',
  });
  h.server = async (name, data) => {
    if (name !== 'updateSpecialistMedicalHandoff') throw new Error(`unexpected callable ${name}`);
    try {
      return await api.updateSpecialistMedicalHandoff.run(data, {
        auth: { uid: 'n4d', token: { email: 'n4d@example.invalid' } },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw Object.assign(new Error((error as Error).message), {
        code: code ? `functions/${code}` : 'functions/internal',
      });
    }
  };
  specialistDb = env
    .authenticatedContext('n4d', { role: 'doctor_specialist', email: 'n4d@example.invalid' })
    .firestore();
});
beforeEach(async () => {
  await clearSessionScopedClientState('manual');
  readMedicalHandoffDrafts();
  h.calls.length = 0;
  saves.length = 0;
  h.specialist = true;
  h.activeDb = specialistDb;
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  client.mount();
  await env.clearFirestore();
  await admin.doc(dayPath).set(base());
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  localStorage.clear();
  resetMedicalHandoffDraftMemoryForTests();
  await reconcileAuthorizedSessionOwner(owner);
  await hospitalDB.dailyRecords.put(base());
  setDailyRecordQueryData(client, date, base());
});
afterEach(async () => {
  cleanup();
  client.clear();
  client.unmount();
  try {
    await enableNetwork(h.activeDb as never);
  } catch {
    /* already enabled */
  }
  onlineManager.setOnline(true);
  setFirestoreSyncState({ mode: 'enabled', reason: 'ready' });
});
afterAll(async () => {
  await env?.cleanup();
  await deleteApp(app);
  hospitalDB.close();
});

it('S1 offline: same entry saved twice, then online', async () => {
  mount([{ bedId: 'R4', entryId: 'entry-x' }]);
  await offline();
  await type('R4', 'entry-x', 'T1 primera');
  await settle(1);
  await type('R4', 'entry-x', 'T2 segunda');
  await settle(2);
  expect(status('R4', 'entry-x')).toContain('Pendiente de confirmar');
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  expect(h.calls).toHaveLength(0);
  expect(drafts().length).toBeGreaterThan(0);
  await online();
  await publish();
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.REVIEW_WAIT_MS ?? 3000)));
  });
  expect(notesOf(await readServer(), 'R4')).toContain('entry-x=T2 segunda');
  expect(h.calls).toHaveLength(1);
  await publish();
  expect(h.calls).toHaveLength(1);
  expect(drafts()).toEqual([]);
}, 60_000);

it('S2 offline: two specialties of the same patient, then online', async () => {
  mount([
    { bedId: 'R4', entryId: 'entry-x' },
    { bedId: 'R4', entryId: 'entry-y' },
  ]);
  await offline();
  await type('R4', 'entry-x', 'TX medicina');
  await settle(1);
  await type('R4', 'entry-y', 'TY cirugia');
  await settle(2);
  expect(status('R4', 'entry-x')).toContain('Pendiente de confirmar');
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  expect(h.calls).toHaveLength(0);
  expect(drafts().length).toBeGreaterThan(0);
  await online();
  await publish();
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.REVIEW_WAIT_MS ?? 3000)));
  });
  expect(notesOf(await readServer(), 'R4')).toEqual(['entry-x=TX medicina', 'entry-y=TY cirugia']);
  expect(h.calls).toHaveLength(1);
  await publish();
  expect(h.calls).toHaveLength(1);
  expect(drafts()).toEqual([]);
}, 60_000);

it('S10 offline: keeps typing in one note with a pause (debounced saves, no blur)', async () => {
  mount([{ bedId: 'R4', entryId: 'entry-x' }]);
  await offline();
  const box = within(document.querySelector('[data-testid="R4:entry-x"]') as HTMLElement).getByRole(
    'textbox'
  );
  await act(async () => {
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'Paciente estable' } });
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 2500));
  });
  await settle(1);
  await act(async () => {
    fireEvent.change(box, { target: { value: 'Paciente estable, control mañana' } });
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 2500));
  });
  await settle(2);
  expect(status('R4', 'entry-x')).toContain('Pendiente de confirmar');
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  expect(h.calls).toHaveLength(0);
  expect(drafts().length).toBeGreaterThan(0);
  await online();
  await publish();
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.REVIEW_WAIT_MS ?? 3000)));
  });
  await settle(2, 20000);
  expect(notesOf(await readServer(), 'R4')).toContain('entry-x=Paciente estable, control mañana');
  expect(h.calls).toHaveLength(1);
  await publish();
  expect(h.calls).toHaveLength(1);
  expect(drafts()).toEqual([]);
}, 90_000);

it('S3 offline: two beds, then online', async () => {
  mount([
    { bedId: 'R4', entryId: 'entry-x' },
    { bedId: 'R3', entryId: 'entry-z' },
  ]);
  await offline();
  await type('R4', 'entry-x', 'T4 cama cuatro');
  await settle(1);
  await type('R3', 'entry-z', 'T5 cama cinco');
  await settle(2);
  expect(await hospitalDB.syncQueue.count()).toBe(2);
  expect(h.calls).toHaveLength(0);
  await online();
  await publish();
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.REVIEW_WAIT_MS ?? 3000)));
  });
  expect(notesOf(await readServer(), 'R4')).toContain('entry-x=T4 cama cuatro');
  expect(notesOf(await readServer(), 'R3')).toContain('entry-z=T5 cama cinco');
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  expect(h.calls).toHaveLength(2);
  await publish();
  expect(h.calls).toHaveLength(2);
  expect(drafts()).toEqual([]);
}, 60_000);

it.each(['turnover', 'episode', 'moved'] as const)(
  'S4 ID-01 %s while the note waits',
  async change => {
    mount([{ bedId: 'R4', entryId: 'entry-x' }]);
    await offline();
    await type('R4', 'entry-x', 'NOTA PARA A');
    await settle(1);
    const record = base();
    if (change === 'turnover') {
      await admin.doc(dayPath).update({
        'beds.R4': {
          ...record.beds.R4,
          patientName: 'PACIENTE SINTETICO B',
          rut: '22222222-2',
          clinicalEpisodeId: 'episode-b',
        },
        lastUpdated: new Date().toISOString(),
      });
    } else if (change === 'episode') {
      await admin.doc(dayPath).update({
        'beds.R4.clinicalEpisodeId': 'episode-a2',
        lastUpdated: new Date().toISOString(),
      });
    } else {
      await admin.doc(dayPath).update({
        'beds.R2': { ...record.beds.R4, bedId: 'R2' },
        'beds.R4': { ...record.beds.R2, bedId: 'R4' },
        lastUpdated: new Date().toISOString(),
      });
    }
    await type('R4', 'entry-x', 'NOTA PARA A FINAL');
    await settle(2);
    await online();
    await publish();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, Number(process.env.REVIEW_WAIT_MS ?? 3000)));
    });
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([{ status: 'CONFLICT' }]);
    expect(JSON.stringify(await readServer())).not.toContain('NOTA PARA A');
    expect(drafts()).toEqual([expect.objectContaining({ value: 'NOTA PARA A FINAL' })]);
  },
  60_000
);

it('S5 another team wrote the same entry meanwhile', async () => {
  mount([{ bedId: 'R4', entryId: 'entry-x' }]);
  await offline();
  await type('R4', 'entry-x', 'MIA sin conexion');
  await settle(1);
  const record = base();
  await admin.doc(dayPath).update({
    'beds.R4.medicalHandoffEntries': [
      { ...record.beds.R4.medicalHandoffEntries![0], note: 'OTRO EQUIPO' },
      record.beds.R4.medicalHandoffEntries![1],
    ],
    lastUpdated: new Date().toISOString(),
  });
  await type('R4', 'entry-x', 'MIA final');
  await settle(2);
  await online();
  await publish();
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.REVIEW_WAIT_MS ?? 3000)));
  });
  expect(notesOf(await readServer(), 'R4')).toContain('entry-x=OTRO EQUIPO');
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  expect(drafts()).toEqual([expect.objectContaining({ value: 'MIA final' })]);
}, 60_000);
