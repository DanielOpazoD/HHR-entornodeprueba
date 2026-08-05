import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
const { mockAuthorityCallable } = vi.hoisted(() => ({
  mockAuthorityCallable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
  };
});

vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>();
  return {
    ...actual,
    getRecordDocRef: vi.fn(() => ({ id: 'sync-test-doc-ref' })),
    sanitizeForFirestore: vi.fn(value => value),
  };
});

vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: (...args: unknown[]) =>
    mockAuthorityCallable(...args),
}));

import { getDoc, setDoc } from 'firebase/firestore';
import { processSyncQueue, queueSyncTask } from '@/services/storage/sync';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (date: string, marker: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: marker,
  nurses: [],
  activeExtraBeds: [],
});

const makePatient = (
  bedId: string,
  extras: Partial<DailyRecord['beds'][string]> = {}
): DailyRecord['beds'][string] =>
  ({
    bedId,
    patientName: 'Paciente Handoff',
    rut: '12.345.678-9',
    admissionDate: '2025-01-24',
    clinicalEpisodeId: 'ep-handoff-sync',
    pathology: 'Diagnostico base',
    specialty: 'Medicina',
    status: 'Estable',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    ...extras,
  }) as DailyRecord['beds'][string];

describe('sync queue mutation conflicts', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    vi.clearAllMocks();
    mockAuthorityCallable.mockImplementation(async ({ record }: { record: DailyRecord }) => ({
      recordState: { record, lastUpdated: record.lastUpdated, meta: {} },
    }));
    delete (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE;
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    } as Awaited<ReturnType<typeof getDoc>>);
    vi.mocked(setDoc).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  it('keeps stale tasks in conflict when the remote mutation changed the same path', async () => {
    const local = makeRecord('2025-01-22', '2025-01-22T10:10:00.000Z');
    local.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente Sync',
      rut: '11.111.111-1',
      age: '40a',
      pathology: 'Diagnostico local same-path',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2025-01-22',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    } as DailyRecord['beds'][string];

    const remote = makeRecord('2025-01-22', '2025-01-22T10:20:00.000Z');
    remote.beds.R1 = {
      ...local.beds.R1,
      pathology: 'Diagnostico remoto same-path',
    };
    (remote as DailyRecord & { meta: Record<string, unknown> }).meta = {
      revision: 5,
      lastMutationId: 'remote-mutation',
      lastChangedPaths: ['beds.R1.pathology'],
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-22T10:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
        mutationId: 'local-mutation',
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(setDoc).not.toHaveBeenCalled();
    const [task] = await hospitalDB.syncQueue.toArray();
    expect(task.status).toBe('CONFLICT');
    expect(task.lastErrorCategory).toBe('conflict');
    expect(task.error).toContain('same changed path');
  });

  it('revalidates overlapping movement arrays by id and publishes the merged record through authority', async () => {
    const local = makeRecord('2025-01-23', '2025-01-23T10:10:00.000Z');
    local.discharges = [
      { id: 'discharge-local', bedId: 'R1', patientName: 'Alta local' },
    ] as unknown as DailyRecord['discharges'];
    local.transfers = [
      { id: 'transfer-local', bedId: 'R2', patientName: 'Traslado local' },
    ] as unknown as DailyRecord['transfers'];
    local.cma = [
      { id: 'cma-local', bedName: 'R3', originalBedId: 'R3', patientName: 'CMA local' },
    ] as unknown as DailyRecord['cma'];

    const remote = makeRecord('2025-01-23', '2025-01-23T10:20:00.000Z');
    remote.discharges = [
      { id: 'discharge-remote', bedId: 'R4', patientName: 'Alta remota' },
    ] as unknown as DailyRecord['discharges'];
    remote.transfers = [
      { id: 'transfer-remote', bedId: 'R5', patientName: 'Traslado remoto' },
    ] as unknown as DailyRecord['transfers'];
    remote.cma = [
      { id: 'cma-remote', bedName: 'R6', originalBedId: 'R6', patientName: 'CMA remoto' },
    ] as unknown as DailyRecord['cma'];
    (remote as DailyRecord & { meta: Record<string, unknown> }).meta = {
      revision: 5,
      lastMutationId: 'remote-movement-mutation',
      lastChangedPaths: ['discharges', 'transfers', 'cma'],
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['movements', 'clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-23T10:00:00.000Z',
        changedPaths: ['discharges', 'transfers', 'cma'],
        mutationId: 'local-movement-mutation',
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(setDoc).not.toHaveBeenCalled();
    expect(mockAuthorityCallable).toHaveBeenCalledTimes(1);
    const authorityPayload = mockAuthorityCallable.mock.calls[0]?.[0] as {
      record: DailyRecord;
      mode: string;
    };
    expect(authorityPayload.mode).toBe('enforced');
    expect(authorityPayload.record.discharges.map(item => item.id)).toEqual([
      'discharge-remote',
      'discharge-local',
    ]);
    expect(authorityPayload.record.transfers.map(item => item.id)).toEqual([
      'transfer-remote',
      'transfer-local',
    ]);
    expect(authorityPayload.record.cma.map(item => item.id)).toEqual(['cma-remote', 'cma-local']);
    const [task] = await hospitalDB.syncQueue.toArray();
    expect(task).toBeUndefined();
  });

  it('replays stale restarted nursing handoff notes without dropping the remote shift note', async () => {
    const local = makeRecord('2025-01-24', '2025-01-24T10:10:00.000Z');
    local.beds.R1 = makePatient('R1', {
      handoffNoteNightShift: 'Nota local pendiente tras reinicio',
    });

    const remote = makeRecord('2025-01-24', '2025-01-24T10:20:00.000Z');
    remote.beds.R1 = makePatient('R1', {
      handoffNoteDayShift: 'Nota remota ya aceptada',
    });
    (remote as DailyRecord & { meta: Record<string, unknown> }).meta = {
      revision: 8,
      lastMutationId: 'remote-nursing-handoff',
      lastChangedPaths: ['beds.R1.handoffNoteDayShift'],
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['handoff'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-24T10:00:00.000Z',
        changedPaths: ['beds.R1.handoffNoteNightShift'],
        mutationId: 'local-nursing-handoff-after-restart',
        tabId: 'tab-before-restart',
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(mockAuthorityCallable).toHaveBeenCalledTimes(1);
    const authorityPayload = mockAuthorityCallable.mock.calls[0]?.[0] as {
      record: DailyRecord;
    };
    expect(authorityPayload.record.beds.R1.handoffNoteDayShift).toBe('Nota remota ya aceptada');
    expect(authorityPayload.record.beds.R1.handoffNoteNightShift).toBe(
      'Nota local pendiente tras reinicio'
    );
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
  });

  it('replays distinct medical specialty handoff notes and recomputes the derived summary', async () => {
    const local = makeRecord('2025-01-25', '2025-01-25T10:10:00.000Z');
    local.medicalHandoffBySpecialty = {
      medicinaInterna: {
        note: 'Ajustar antihipertensivos',
        updatedAt: '2025-01-25T10:10:00.000Z',
      },
    } as DailyRecord['medicalHandoffBySpecialty'];
    local.medicalHandoffNovedades = 'Medicina Interna\nAjustar antihipertensivos';

    const remote = makeRecord('2025-01-25', '2025-01-25T10:20:00.000Z');
    remote.medicalHandoffBySpecialty = {
      cirugia: {
        note: 'Control quirurgico',
        updatedAt: '2025-01-25T10:20:00.000Z',
      },
    } as DailyRecord['medicalHandoffBySpecialty'];
    remote.medicalHandoffNovedades = 'Cirugía\nControl quirurgico';
    (remote as DailyRecord & { meta: Record<string, unknown> }).meta = {
      revision: 9,
      lastMutationId: 'remote-specialty-handoff',
      lastChangedPaths: ['medicalHandoffBySpecialty.cirugia', 'medicalHandoffNovedades'],
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['handoff'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-25T10:00:00.000Z',
        changedPaths: ['medicalHandoffBySpecialty.medicinaInterna', 'medicalHandoffNovedades'],
        mutationId: 'local-specialty-handoff-after-restart',
        tabId: 'tab-before-restart',
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(mockAuthorityCallable).toHaveBeenCalledTimes(1);
    const authorityPayload = mockAuthorityCallable.mock.calls[0]?.[0] as {
      record: DailyRecord;
    };
    expect(authorityPayload.record.medicalHandoffBySpecialty).toEqual(
      expect.objectContaining({
        cirugia: expect.objectContaining({ note: 'Control quirurgico' }),
        medicinaInterna: expect.objectContaining({ note: 'Ajustar antihipertensivos' }),
      })
    );
    expect(authorityPayload.record.medicalHandoffNovedades).toContain('Cirugía');
    expect(authorityPayload.record.medicalHandoffNovedades).toContain('Medicina Interna');
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
  });

  it('replays concurrent medical handoff entries with distinct ids for the same episode', async () => {
    const local = makeRecord('2025-01-26', '2025-01-26T10:10:00.000Z');
    local.beds.R1 = makePatient('R1', {
      medicalHandoffEntries: [
        { id: 'entry-local', specialty: 'medicinaInterna', note: 'Entrada local' },
      ] as never,
    });

    const remote = makeRecord('2025-01-26', '2025-01-26T10:20:00.000Z');
    remote.beds.R1 = makePatient('R1', {
      medicalHandoffEntries: [
        { id: 'entry-remote', specialty: 'cirugia', note: 'Entrada remota' },
      ] as never,
    });
    (remote as DailyRecord & { meta: Record<string, unknown> }).meta = {
      revision: 10,
      lastMutationId: 'remote-medical-entry',
      lastChangedPaths: ['beds.R1.medicalHandoffEntries'],
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['handoff'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-26T10:00:00.000Z',
        changedPaths: ['beds.R1.medicalHandoffEntries'],
        mutationId: 'local-medical-entry-after-restart',
        tabId: 'tab-before-restart',
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(mockAuthorityCallable).toHaveBeenCalledTimes(1);
    const authorityPayload = mockAuthorityCallable.mock.calls[0]?.[0] as {
      record: DailyRecord;
    };
    expect(authorityPayload.record.beds.R1.medicalHandoffEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'entry-remote' }),
        expect.objectContaining({ id: 'entry-local' }),
      ])
    );
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
  });

  it('converges three clients across census movements and handoff after stale restart replay', async () => {
    const local = makeRecord('2025-01-27', '2025-01-27T10:10:00.000Z');
    local.beds.R1 = makePatient('R1', {
      pathology: 'Diagnostico basal antes del reinicio',
      handoffNoteNightShift: 'B: vigilar fiebre en turno noche',
      medicalHandoffEntries: [
        { id: 'entry-b', specialty: 'medicinaInterna', note: 'B: control antihipertensivo' },
      ] as never,
    });
    local.discharges = [
      { id: 'discharge-b', bedId: 'R2', patientName: 'Alta cliente B' },
    ] as unknown as DailyRecord['discharges'];
    local.transfers = [
      { id: 'transfer-b', bedId: 'R3', patientName: 'Traslado cliente B' },
    ] as unknown as DailyRecord['transfers'];
    local.cma = [
      { id: 'cma-b', bedName: 'R4', originalBedId: 'R4', patientName: 'CMA cliente B' },
    ] as unknown as DailyRecord['cma'];
    local.medicalHandoffBySpecialty = {
      medicinaInterna: {
        note: 'B: control antihipertensivo',
        updatedAt: '2025-01-27T10:10:00.000Z',
      },
    } as DailyRecord['medicalHandoffBySpecialty'];
    local.medicalHandoffNovedades = 'Medicina Interna\nB: control antihipertensivo';

    const remote = makeRecord('2025-01-27', '2025-01-27T10:35:00.000Z');
    remote.beds.R1 = makePatient('R1', {
      pathology: 'C: diagnostico remoto ya aceptado',
      handoffNoteDayShift: 'A: indicaciones de dia ya aceptadas',
      medicalHandoffEntries: [
        { id: 'entry-a', specialty: 'cirugia', note: 'A: control quirurgico' },
      ] as never,
    });
    remote.discharges = [
      { id: 'discharge-a', bedId: 'R5', patientName: 'Alta cliente A' },
    ] as unknown as DailyRecord['discharges'];
    remote.transfers = [
      { id: 'transfer-a', bedId: 'R6', patientName: 'Traslado cliente A' },
    ] as unknown as DailyRecord['transfers'];
    remote.cma = [
      { id: 'cma-a', bedName: 'R7', originalBedId: 'R7', patientName: 'CMA cliente A' },
    ] as unknown as DailyRecord['cma'];
    remote.medicalHandoffBySpecialty = {
      cirugia: {
        note: 'A: control quirurgico',
        updatedAt: '2025-01-27T10:30:00.000Z',
      },
    } as DailyRecord['medicalHandoffBySpecialty'];
    remote.medicalHandoffNovedades = 'Cirugía\nA: control quirurgico';
    (remote as DailyRecord & { meta: Record<string, unknown> }).meta = {
      revision: 11,
      lastMutationId: 'client-c-accepted-census-handoff',
      lastChangedPaths: [
        'beds.R1.pathology',
        'beds.R1.handoffNoteDayShift',
        'discharges',
        'transfers',
        'cma',
        'medicalHandoffBySpecialty.cirugia',
        'medicalHandoffNovedades',
        'beds.R1.medicalHandoffEntries',
      ],
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical', 'movements', 'handoff'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-27T10:00:00.000Z',
        changedPaths: [
          'beds.R1.handoffNoteNightShift',
          'discharges',
          'transfers',
          'cma',
          'medicalHandoffBySpecialty.medicinaInterna',
          'medicalHandoffNovedades',
          'beds.R1.medicalHandoffEntries',
        ],
        mutationId: 'client-b-stale-restart-replay',
        tabId: 'tab-before-restart',
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(mockAuthorityCallable).toHaveBeenCalledTimes(1);
    const authorityPayload = mockAuthorityCallable.mock.calls[0]?.[0] as {
      record: DailyRecord;
      syncContract: { mutationId?: string; tabId?: string; changedPaths?: string[] };
    };
    const resolved = authorityPayload.record;
    expect(authorityPayload.syncContract).toMatchObject({
      mutationId: 'client-b-stale-restart-replay',
      tabId: 'tab-before-restart',
    });
    expect(authorityPayload.syncContract.changedPaths).toContain('beds.R1.handoffNoteNightShift');
    expect(resolved.beds.R1.pathology).toBe('C: diagnostico remoto ya aceptado');
    expect(resolved.beds.R1.handoffNoteDayShift).toBe('A: indicaciones de dia ya aceptadas');
    expect(resolved.beds.R1.handoffNoteNightShift).toBe('B: vigilar fiebre en turno noche');
    expect(resolved.discharges.map(item => item.id)).toEqual(['discharge-a', 'discharge-b']);
    expect(resolved.transfers.map(item => item.id)).toEqual(['transfer-a', 'transfer-b']);
    expect(resolved.cma.map(item => item.id)).toEqual(['cma-a', 'cma-b']);
    expect(resolved.medicalHandoffBySpecialty).toEqual(
      expect.objectContaining({
        cirugia: expect.objectContaining({ note: 'A: control quirurgico' }),
        medicinaInterna: expect.objectContaining({ note: 'B: control antihipertensivo' }),
      })
    );
    expect(resolved.medicalHandoffNovedades).toContain('Cirugía');
    expect(resolved.medicalHandoffNovedades).toContain('Medicina Interna');
    expect(resolved.beds.R1.medicalHandoffEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'entry-a' }),
        expect.objectContaining({ id: 'entry-b' }),
      ])
    );
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
  });
});
