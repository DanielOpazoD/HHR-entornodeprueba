import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  saveRecord: vi.fn(),
  saveRecordStrict: vi.fn(record =>
    Promise.resolve({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: [record.date],
    })
  ),
}));

vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  updateRecordPartial: vi.fn(),
  saveRecordToFirestore: vi.fn(),
}));

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

vi.mock('@/services/storage/sync', () => ({
  ackDailyRecordSyncTask: vi.fn().mockResolvedValue(true),
  isRetryableSyncError: vi.fn(),
  queueSyncTask: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
  queueDailyRecordSyncTaskWithLocalRecord: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
  releaseDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
  renewDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

vi.mock('@/utils/recordInvariants', () => ({
  normalizeDailyRecordInvariants: vi.fn((record: DailyRecord) => ({ record, patches: {} })),
}));

vi.mock('@/services/repositories/helpers/validationHelper', () => ({
  validateAndSalvageRecord: vi.fn((record: DailyRecord) => record),
}));

vi.mock('@/services/utils/fhirMappers', () => ({
  mapPatientToFhir: vi.fn(() => ({})),
}));

const warnSpy = vi.fn();
vi.mock('@/services/repositories/repositoryLoggers', () => ({
  dailyRecordWriteLogger: {
    warn: (...args: unknown[]) => warnSpy(...args),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { saveRecordStrict as saveToIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { queueDailyRecordSyncTaskWithLocalRecord as queueSyncTask } from '@/services/storage/sync';

const longText = (chars: number) => 'a'.repeat(chars);

const buildPatient = (
  bedId: string,
  pathology: string,
  overrides: Partial<PatientData> = {}
): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Demo',
  rut: '11.111.111-1',
  age: '40a',
  pathology,
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-18',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const buildRecord = (date: string, pathology: string): DailyRecord => ({
  date,
  beds: { R1: buildPatient('R1', pathology) },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-02-19T00:00:00.000Z',
  nurses: [],
  activeExtraBeds: [],
});

describe('dailyRecordRepositoryWriteService field shrinkage telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy.mockClear();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    vi.mocked(updateRecordPartialToFirestore).mockResolvedValue(undefined);
  });

  it('accepts a suspicious diagnosis shrink when the remote version still matches the local token', async () => {
    const current = buildRecord('2026-02-11', longText(80));
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(current);

    const result = await updatePartialDetailed('2026-02-11', {
      'beds.R1.pathology': longText(20),
    });

    expect(result.outcome).toBe('clean');
    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-02-11' }),
      expect.objectContaining({ origin: 'direct_queue' }),
      expect.objectContaining({ preOutboxHoldReason: 'awaiting_remote_ack' })
    );
    expect(updateRecordPartialToFirestore).toHaveBeenCalled();
  });

  it('blocks a suspicious diagnosis shrink when the remote token moved ahead', async () => {
    const current = buildRecord('2026-02-11', longText(80));
    const remote = {
      ...current,
      lastUpdated: '2026-02-19T00:01:00.000Z',
      beds: { R1: buildPatient('R1', longText(90)) },
    };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

    const result = await updatePartialDetailed('2026-02-11', {
      'beds.R1.pathology': longText(20),
    });

    expect(result.outcome).toBe('blocked');
    expect(result.consistencyState).toBe('blocked_regression');
    expect(result.blockingError?.name).toBe('DataRegressionError');
    expect(saveToIndexedDB).not.toHaveBeenCalled();
    expect(updateRecordPartialToFirestore).not.toHaveBeenCalled();

    const shrinkageCall = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Field shrinkage')
    );
    expect(shrinkageCall).toBeDefined();
    expect(shrinkageCall?.[0]).toContain('beds.R1.pathology');
    expect(shrinkageCall?.[1]).toMatchObject({
      path: 'beds.R1.pathology',
      prevLength: 80,
      nextLength: 20,
    });
  });

  it('blocks a suspicious nursing handoff note shrink before it overwrites local or remote data', async () => {
    const current = buildRecord('2026-02-11', 'Diagnostico base');
    current.beds.R1.handoffNoteDayShift = longText(90);
    const remote = {
      ...current,
      lastUpdated: '2026-02-19T00:01:00.000Z',
      beds: {
        R1: {
          ...current.beds.R1,
          handoffNoteDayShift: longText(95),
        },
      },
    };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

    const result = await updatePartialDetailed('2026-02-11', {
      'beds.R1.handoffNoteDayShift': longText(25),
    });

    expect(result.outcome).toBe('blocked');
    expect(result.consistencyState).toBe('blocked_regression');
    expect(result.blockingError?.name).toBe('DataRegressionError');
    expect(saveToIndexedDB).not.toHaveBeenCalled();
    expect(updateRecordPartialToFirestore).not.toHaveBeenCalled();

    const shrinkageCall = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Field shrinkage')
    );
    expect(shrinkageCall).toBeDefined();
    expect(shrinkageCall?.[1]).toMatchObject({
      path: 'beds.R1.handoffNoteDayShift',
      prevLength: 90,
      nextLength: 25,
    });
  });

  it('blocks a suspicious medical handoff note shrink before it overwrites local or remote data', async () => {
    const current = buildRecord('2026-02-11', 'Diagnostico base');
    current.beds.R1.medicalHandoffNote = longText(110);
    const remote = {
      ...current,
      lastUpdated: '2026-02-19T00:01:00.000Z',
      beds: {
        R1: {
          ...current.beds.R1,
          medicalHandoffNote: longText(115),
        },
      },
    };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

    const result = await updatePartialDetailed('2026-02-11', {
      'beds.R1.medicalHandoffNote': longText(30),
    });

    expect(result.outcome).toBe('blocked');
    expect(result.consistencyState).toBe('blocked_regression');
    expect(result.blockingError?.name).toBe('DataRegressionError');
    expect(saveToIndexedDB).not.toHaveBeenCalled();
    expect(updateRecordPartialToFirestore).not.toHaveBeenCalled();

    const shrinkageCall = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Field shrinkage')
    );
    expect(shrinkageCall).toBeDefined();
    expect(shrinkageCall?.[1]).toMatchObject({
      path: 'beds.R1.medicalHandoffNote',
      prevLength: 110,
      nextLength: 30,
    });
  });

  it('blocks a suspicious medical handoff entry note shrink inside entry arrays', async () => {
    const current = buildRecord('2026-02-11', 'Diagnostico base');
    current.beds.R1.medicalHandoffEntries = [
      {
        id: 'entry-1',
        specialty: 'medicina',
        note: longText(120),
        updatedAt: '2026-02-11T08:00:00.000Z',
      },
    ] as never;
    const remote = {
      ...current,
      lastUpdated: '2026-02-19T00:01:00.000Z',
      beds: {
        R1: {
          ...current.beds.R1,
          medicalHandoffEntries: [
            {
              id: 'entry-1',
              specialty: 'medicina',
              note: longText(130),
              updatedAt: '2026-02-11T08:01:00.000Z',
            },
          ] as never,
        },
      },
    };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

    const result = await updatePartialDetailed('2026-02-11', {
      'beds.R1.medicalHandoffEntries': [
        {
          id: 'entry-1',
          specialty: 'medicina',
          note: longText(35),
          updatedAt: '2026-02-11T08:05:00.000Z',
        },
      ] as never,
    });

    expect(result.outcome).toBe('blocked');
    expect(result.consistencyState).toBe('blocked_regression');
    expect(result.blockingError?.name).toBe('DataRegressionError');
    expect(saveToIndexedDB).not.toHaveBeenCalled();
    expect(updateRecordPartialToFirestore).not.toHaveBeenCalled();

    const shrinkageCall = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Field shrinkage')
    );
    expect(shrinkageCall).toBeDefined();
    expect(shrinkageCall?.[1]).toMatchObject({
      path: 'beds.R1.medicalHandoffEntries.entry-1.note',
      prevLength: 120,
      nextLength: 35,
    });
  });

  it('does NOT log when shrinkage stays at or above the 50% ratio', async () => {
    const current = buildRecord('2026-02-11', longText(80));
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(current);

    await updatePartialDetailed('2026-02-11', {
      'beds.R1.pathology': longText(60),
    });

    const shrinkageCall = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Field shrinkage')
    );
    expect(shrinkageCall).toBeUndefined();
  });

  it('does NOT log when the previous value is shorter than the 20-char floor', async () => {
    const current = buildRecord('2026-02-11', 'short');
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(current);

    await updatePartialDetailed('2026-02-11', {
      'beds.R1.pathology': 'a',
    });

    const shrinkageCall = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Field shrinkage')
    );
    expect(shrinkageCall).toBeUndefined();
  });

  it('does NOT log when the new value is empty (clearing a field is not shrinkage)', async () => {
    const current = buildRecord('2026-02-11', longText(80));
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(current);

    await updatePartialDetailed('2026-02-11', {
      'beds.R1.pathology': '',
    });

    const shrinkageCall = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Field shrinkage')
    );
    expect(shrinkageCall).toBeUndefined();
  });
});
