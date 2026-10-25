/**
 * Synthetic-only: a specialist note queued offline is its own sync unit. Real write service,
 * queue engine, transport and server handler; only Firestore, Functions and the role are faked.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { createRequire } from 'node:module';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  remote: null as Record<string, any> | null,
  handler: null as any,
  role: 'admin',
  offline: false,
}));
const clone = <T,>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const mergeDeep = (target: Record<string, any>, source: Record<string, any>) => {
  for (const [key, value] of Object.entries(source)) {
    if (value === '__delete__') delete target[key];
    else if (isObject(value) && isObject(target[key])) mergeDeep(target[key], value);
    else target[key] = clone(value);
  }
};
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDoc: vi.fn(async () => ({
    exists: () => Boolean(h.remote),
    data: () => clone(h.remote),
    metadata: {},
  })),
  runTransaction: vi.fn(async (_db: unknown, run: (transaction: unknown) => unknown) =>
    run({
      get: async () => ({
        exists: () => Boolean(h.remote),
        data: () => clone(h.remote),
        metadata: {},
      }),
      set: (_ref: unknown, data: Record<string, any>, options?: { merge?: boolean }) => {
        if (options?.merge && h.remote) mergeDeep(h.remote, data);
        else h.remote = clone(data);
      },
      update: (_ref: unknown, data: Record<string, any>) => mergeDeep(h.remote ?? {}, data),
    })
  ),
  deleteField: () => '__delete__',
}));
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({}),
}));
vi.mock(
  '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    isServerClinicalWriteFenceActive: async () => false,
    resolveEffectiveDailyRecordAuthorityMode: async () => 'client_only',
  })
);
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: async () => ({}),
    getRegionalFunctions: async () => ({}),
  },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: unknown) => {
    try {
      const context = {
        auth: { uid: 'synthetic', token: { email: 'specialist@example.invalid' } },
      };
      return { data: await h.handler.updateSpecialistMedicalHandoff.run(data, context) };
    } catch (error) {
      const failure = error as { message: string; code: string };
      throw Object.assign(new Error(failure.message), { code: `functions/${failure.code}` });
    }
  },
}));
vi.mock(
  '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    shouldRouteSpecialistPatchViaCallable: vi.fn(async () => true),
  })
);
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<object>()),
  isFirestoreEnabled: vi.fn(() => !h.offline),
  getFirestoreSyncState: vi.fn(() =>
    h.offline ? { mode: 'local_only', reason: 'offline' } : { mode: 'enabled', reason: 'ready' }
  ),
}));

import { hospitalDB } from '@/services/storage/indexedDBService';
import {
  listRecentSyncQueueOperations,
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
} from '@/services/storage/sync';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { readMedicalHandoffDrafts } from '@/services/storage/medicalHandoffDraftStorage';
import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { MedicalHandoffDraftsPanel } from '@/features/handoff/components/MedicalHandoffDraftsPanel';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const require = createRequire(import.meta.url);
const setPath = (target: Record<string, any>, path: string, value: unknown) => {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(current[part])) current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
};
const createHandler = () => {
  const {
    createSpecialistMedicalHandoffFunctions,
  } = require('../../../../functions/lib/specialistMedicalHandoffFunctions.js');
  return createSpecialistMedicalHandoffFunctions({
    firestore: {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
      runTransaction: async (run: (transaction: unknown) => unknown) => {
        let staged: Record<string, unknown> | undefined;
        const result = await run({
          get: async () => ({ exists: Boolean(h.remote), data: () => clone(h.remote) }),
          update: (_ref: unknown, patch: Record<string, unknown>) => {
            staged = patch;
          },
        });
        for (const [path, value] of Object.entries(staged ?? {}))
          setPath(h.remote ?? {}, path, value);
        return result;
      },
    },
    Timestamp: { now: () => '2026-10-24T12:00:00.000Z' },
    resolveRoleForEmail: async () => h.role,
  });
};

const OWNER = 'user:synthetic-specialist';
const T0 = '2026-10-24T10:00:00.000Z';
const patient = (bedId: string, name: string, extra: Partial<PatientData> = {}) =>
  DataFactory.createMockPatient(bedId, {
    patientName: name,
    rut: '99.999.999-9',
    documentType: 'RUT',
    admissionDate: '2026-10-20',
    medicalHandoffNote: '',
    ...extra,
  });
const entry = (id: string) => [{ id, specialty: 'Medicina Interna', note: '' }];
const A = (bedId = 'R4', extra: Partial<PatientData> = {}) =>
  patient(bedId, 'Paciente A Sintético', {
    clinicalEpisodeId: 'ep-A',
    medicalHandoffEntries: entry('entry-A'),
    ...extra,
  });
const B = () =>
  patient('R4', 'Paciente B Sintético', { rut: '88.888.888-8', clinicalEpisodeId: 'ep-B' });
const C = (extra: Partial<PatientData> = {}) =>
  patient('H1C1', 'Paciente C Sintético', {
    rut: '77.777.777-7',
    clinicalEpisodeId: 'ep-C',
    medicalHandoffEntries: entry('entry-C'),
    ...extra,
  });
const E = (extra: Partial<PatientData> = {}) =>
  patient('R6', 'Paciente E Sintético', {
    rut: '66.666.666-6',
    clinicalEpisodeId: 'ep-E',
    pathology: 'Dx E',
    ...extra,
  });
const day = (date: string, beds: Record<string, PatientData>, lastUpdated = T0): DailyRecord =>
  DataFactory.createMockDailyRecord(date, { lastUpdated, beds });

/** The specialist writes one entry while offline, through the real write path. */
const writeOffline = async (record: DailyRecord, bedId: string, entryId: string, value: string) => {
  const occupant = record.beds[bedId];
  const { fields } = buildMedicalEntryNoteFields(occupant, entryId, value, null, record.date, T0);
  const patch = Object.fromEntries(
    Object.entries(fields).map(([field, fieldValue]) => [`beds.${bedId}.${field}`, fieldValue])
  );
  h.offline = true;
  const result = await updatePartialDetailed(record.date, patch, { baseRecord: record });
  h.offline = false;
  return {
    result,
    record: { ...record, beds: { ...record.beds, [bedId]: { ...occupant, ...fields } } },
  };
};
const reconnect = async () => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  await processSyncQueue();
  await new Promise(resolve => setTimeout(resolve, 20));
  await processSyncQueue();
};
const draftsFor = (name: string) =>
  readMedicalHandoffDrafts()
    .filter(draft => draft.patientName === name)
    .map(draft => [draft.date, draft.entryId, draft.value]);

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', OWNER);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.handler = createHandler();
  h.role = 'admin';
  h.offline = false;
});
afterEach(() => cleanup());

describe('a specialist note is its own sync unit', () => {
  it('lets the day, and a valid note on another bed, sync when one note conflicts', async () => {
    const DATE = '2026-10-24';
    const base = day(DATE, { R4: A(), H1C1: C(), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    const first = await writeOffline(base, 'R4', 'entry-A', 'Nota de A');
    expect(first.result).toMatchObject({ queuedForRetry: true, updatedRemotely: false });
    const second = await writeOffline(first.record, 'H1C1', 'entry-C', 'Nota de C');
    expect(second.result).toMatchObject({ queuedForRetry: true });
    const fixed = {
      ...second.record,
      beds: { ...second.record.beds, R6: E({ pathology: 'Dx E corregido' }) },
    };
    await queueDailyRecordSyncTaskWithLocalRecord(fixed, {
      contexts: ['clinical'],
      origin: 'direct_queue',
      syncContract: { changedPaths: ['beds.R6.pathology'], expectedVersion: T0, mutationId: 'm-E' },
    });

    // Another device discharged A and admitted B, then a third one edited R7.
    h.remote = day(
      DATE,
      {
        R4: B(),
        H1C1: C(),
        R6: E(),
        R7: patient('R7', 'Paciente F Sintético', {
          rut: '55.555.555-5',
          clinicalEpisodeId: 'ep-F',
        }),
      },
      '2026-10-24T11:30:00.000Z'
    );
    await reconnect();

    const remote = h.remote as unknown as DailyRecord;
    expect(remote.beds.R6.pathology).toBe('Dx E corregido');
    expect(remote.beds.H1C1.medicalHandoffEntries?.[0]?.note).toBe('Nota de C');
    expect(remote.beds.R4.patientName).toBe('Paciente B Sintético');
    expect(JSON.stringify(remote.beds.R4)).not.toContain('Nota de A');
    expect((await hospitalDB.dailyRecords.get(DATE))?.beds.R6.pathology).toBe('Dx E corregido');
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'CONFLICT' });
    expect(JSON.stringify(tasks[0].payload)).toContain('Nota de A');
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
  });

  it('keeps a note refused after the clinical day closed as a dated draft that cannot overwrite another day', async () => {
    const DATE = '2026-10-20';
    h.role = 'doctor_specialist';
    const base = day(DATE, { R4: A() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeOffline(base, 'R4', 'entry-A', 'Nota antes de las 08:00');
    await reconnect();

    expect(JSON.stringify(h.remote)).not.toContain('Nota antes de las 08:00');
    expect(draftsFor('Paciente A Sintético')).toEqual([
      [DATE, 'entry-A', 'Nota antes de las 08:00'],
    ]);
    render(<MedicalHandoffDraftsPanel />);
    fireEvent.click(screen.getByText(/Revisar borradores de entrega/));
    expect(screen.getByText('Nota de entrega de Paciente A Sintético · 20-10-2026')).toBeVisible();
    expect(screen.queryByText('Restaurar y guardar borrador')).not.toBeInTheDocument();
  });

  it('restores a refused legacy note into the same patient editor after a bed move, without duplicates', async () => {
    const DATE = '2026-10-24';
    const legacy = A('R4', { medicalHandoffNote: 'Nota previa', medicalHandoffEntries: undefined });
    const base = day(DATE, { R4: legacy });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeOffline(base, 'R4', 'legacy-primary', 'Nota nueva de A');
    h.remote = day(DATE, { H2C1: { ...legacy, bedId: 'H2C1' } }, '2026-10-24T11:00:00.000Z');
    await reconnect();

    expect(draftsFor('Paciente A Sintético')).toEqual([
      [DATE, 'legacy-primary', 'Nota nueva de A'],
    ]);
    const save = vi.fn();
    render(
      <table>
        <tbody>
          <tr>
            <HandoffMedicalObservationsCell
              patient={{ ...legacy, bedId: 'H2C1' }}
              reportDate={DATE}
              isFieldReadOnly={false}
              primaryNoteValue="Nota previa"
              onPrimaryNoteChange={vi.fn()}
              onEntryNoteChange={save}
            />
          </tr>
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByText('Revisar borrador'));
    fireEvent.click(screen.getByText('Restaurar y guardar borrador'));
    expect(save).toHaveBeenCalledWith('legacy-primary', 'Nota nueva de A');
    expect(draftsFor('Paciente A Sintético')).toEqual([
      [DATE, 'legacy-primary', 'Nota nueva de A'],
    ]);
  });

  it('names a refused note in the sync panel and offers a confirmed discard instead of a retry that always fails', async () => {
    const DATE = '2026-10-24';
    const base = day(DATE, { R4: A() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeOffline(base, 'R4', 'entry-A', 'Nota de A');
    h.remote = day(DATE, { R4: B() }, '2026-10-24T11:00:00.000Z');
    await reconnect();

    const operations = await listRecentSyncQueueOperations(20);
    const stats = {
      pending: 0,
      failed: 0,
      conflict: 1,
      retrying: 0,
      readState: 'ok',
    } as SyncQueueStats;
    render(
      <RayenSyncQueueDetails
        stats={stats}
        operations={operations}
        refresh={vi.fn(async () => {})}
        working={false}
      />
    );
    expect(
      screen.getByText('Nota de entrega de Paciente A Sintético · 24-10-2026')
    ).toBeInTheDocument();
    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Descartar'));
    expect(await hospitalDB.syncQueue.count()).toBe(1);
    fireEvent.click(screen.getByText('Sí, descartar envío'));
    await vi.waitFor(async () => expect(await hospitalDB.syncQueue.count()).toBe(0));
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
  });
});
