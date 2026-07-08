/**
 * Multi-tab regression integration tests.
 *
 * Covers the bug class where two tabs of the same app modify the same
 * daily record concurrently, with one holding a stale snapshot. Each
 * test simulates a "Tab A" attempting an operation while "Tab B" has
 * already advanced the remote/local state, and asserts that the
 * system either:
 *   - rejects the stale write with a typed error
 *     (DataRegressionError / VersionMismatchError), OR
 *   - auto-merges into the queue (the legitimate concurrency path),
 *     OR
 *   - blocks field-shrinkage writes so a stale diagnosis snapshot cannot
 *     replace a longer current value.
 *
 * Existing coverage validates each piece in isolation
 * (integrityGuard math, recovery controllers, error→feedback mapping).
 * These specs exercise the integration view: the full updatePartial /
 * saveDetailed path under multi-tab scenarios.
 */

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

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
  updateRecordPartial: vi.fn(),
}));

vi.mock('@/services/storage/sync', () => ({
  ackDailyRecordSyncTask: vi.fn().mockResolvedValue(true),
  isRetryableSyncError: vi.fn(() => false),
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

vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  PatientMasterRepository: {
    upsertPatient: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/repositories/ports/repositoryAuditPort', () => ({
  logRepositoryConflictAutoMerged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/repositories/dailyRecordConflictAutoMergeController', () => ({
  attemptConflictAutoMergeRecovery: vi.fn(),
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

import {
  saveDetailed,
  updatePartial,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: `Paciente ${bedId}`,
  rut: '11.111.111-1',
  age: '40a',
  pathology: 'Diagnostico',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-18',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const buildDenseRecord = (date: string): DailyRecord => ({
  date,
  beds: {
    R1: buildPatient('R1', { handoffNote: 'long handoff note R1', cudyr: { score: 5 } as never }),
    R2: buildPatient('R2', { handoffNote: 'long handoff note R2', cudyr: { score: 4 } as never }),
    R3: buildPatient('R3', { handoffNote: 'long handoff note R3', cudyr: { score: 3 } as never }),
    R4: buildPatient('R4', { handoffNote: 'long handoff note R4', cudyr: { score: 6 } as never }),
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-02-19T10:00:00.000Z',
  nurses: ['Enf. A', 'Enf. B'],
  nursesDayShift: ['Enf. A'],
  nursesNightShift: ['Enf. B'],
  tensDayShift: ['TENS A'],
  tensNightShift: ['TENS B'],
  activeExtraBeds: [],
  schemaVersion: 1,
  handoffNovedadesDayShift: 'novedades del día',
  handoffNovedadesNightShift: 'novedades nocturnas',
});

const buildSparseRecord = (date: string): DailyRecord => ({
  date,
  beds: { R1: buildPatient('R1') },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-02-19T10:00:00.000Z',
  nurses: [],
  activeExtraBeds: [],
  schemaVersion: 1,
});

describe('Multi-tab regression — stale snapshot writes are detected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy.mockClear();
  });

  it('blocks a stale full save when the remote record is significantly denser (DataRegressionError)', async () => {
    // Tab A loaded a sparse snapshot. Meanwhile, Tab B added 3 patients
    // and handoff context. Tab A now tries to save its old sparse view
    // — the integrity guard should detect the density drop.
    const date = '2026-02-19';
    const remoteDense = buildDenseRecord(date);
    const localStale = buildSparseRecord(date);

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(localStale);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remoteDense);

    const result = await saveDetailed(localStale);

    expect(result.savedRemotely).toBe(false);
    expect(result.consistencyState).toBe('blocked_regression');
    expect(result.blockingError).toBeDefined();
    expect(result.blockingError?.name).toBe('DataRegressionError');
  });

  it('blocks a save when the remote record uses a newer schema version (VersionMismatchError)', async () => {
    // Tab A is on an older app version; the remote record on Firestore
    // was written by a newer build. Saving anyway would silently
    // downgrade structured data, so the integrity guard rejects it.
    const date = '2026-02-19';
    const remoteNewer = { ...buildSparseRecord(date), schemaVersion: 999 };
    const local = buildSparseRecord(date);

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(local);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remoteNewer);

    const result = await saveDetailed(local);

    expect(result.savedRemotely).toBe(false);
    expect(result.consistencyState).toBe('blocked_version_mismatch');
    expect(result.blockingError).toBeDefined();
    expect(result.blockingError?.name).toBe('VersionMismatchError');
  });

  it('preserves both tabs’ work when concurrent partial updates target disjoint paths', async () => {
    // Tab A patches beds.R1.pathology, Tab B patches beds.R2.pathology.
    // Both should land — there is no real conflict because the patches
    // touch different fields. We exercise this by issuing two
    // sequential updatePartial calls against the same baseline; both
    // should reach Firestore unchanged.
    const date = '2026-02-19';
    const baseline = buildDenseRecord(date);

    vi.mocked(getRecordFromIndexedDB).mockResolvedValue(baseline);
    vi.mocked(getRecordFromFirestore).mockResolvedValue(baseline);
    vi.mocked(updateRecordPartialToFirestore).mockResolvedValue(undefined);

    await updatePartial(date, { 'beds.R1.pathology': 'Diagnostico actualizado por Tab A' });
    await updatePartial(date, { 'beds.R2.pathology': 'Diagnostico actualizado por Tab B' });

    const calls = vi.mocked(updateRecordPartialToFirestore).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatchObject({
      'beds.R1.pathology': 'Diagnostico actualizado por Tab A',
    });
    expect(calls[1][1]).toMatchObject({
      'beds.R2.pathology': 'Diagnostico actualizado por Tab B',
    });
  });

  it('blocks field-shrinkage when a stale snapshot patch would overwrite a long diagnosis', async () => {
    // Classic DebouncedInput-style multi-tab regression: Tab A holds
    // a stale token while the remote record has already advanced with
    // a long pathology note. The shorter stale commit should be
    // blocked before it overwrites the remote text.
    const date = '2026-02-19';
    const longPathology =
      'Insuficiencia respiratoria aguda con requerimiento de soporte ventilatorio invasivo y monitoreo hemodinámico continuo';
    const current = {
      ...buildSparseRecord(date),
      beds: { R1: buildPatient('R1', { pathology: longPathology }) },
    };
    const remote = {
      ...current,
      lastUpdated: '2026-02-19T10:01:00.000Z',
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);
    vi.mocked(updateRecordPartialToFirestore).mockResolvedValueOnce(undefined);

    const result = await updatePartialDetailed(date, { 'beds.R1.pathology': 'NAC' });

    expect(result.outcome).toBe('blocked');
    expect(result.consistencyState).toBe('blocked_regression');
    expect(result.blockingError?.name).toBe('DataRegressionError');

    const shrinkageCall = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Field shrinkage')
    );
    expect(shrinkageCall).toBeDefined();
    expect(shrinkageCall?.[0]).toContain('beds.R1.pathology');
    expect(shrinkageCall?.[1]).toMatchObject({
      path: 'beds.R1.pathology',
      prevLength: longPathology.length,
      nextLength: 3,
    });
  });

  it('auto-merges partial updates when Firestore raises ConcurrencyError', async () => {
    // Tab A and Tab B both held the same lastUpdated; Firestore
    // accepted Tab B first, so Tab A's update fails with a
    // ConcurrencyError. The recovery controller should resolve via
    // auto-merge instead of dropping the patch.
    const date = '2026-02-19';
    const baseline = buildDenseRecord(date);

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(baseline);
    const concurrencyError = new Error('Concurrency conflict');
    concurrencyError.name = 'ConcurrencyError';
    vi.mocked(updateRecordPartialToFirestore).mockReset();
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(concurrencyError);
    vi.mocked(attemptConflictAutoMergeRecovery).mockResolvedValueOnce({ status: 'auto_merged' });

    const result = await updatePartialDetailed(date, {
      'beds.R1.pathology': 'Diagnostico actualizado por Tab A',
    });

    expect(attemptConflictAutoMergeRecovery).toHaveBeenCalledWith(
      date,
      expect.objectContaining({ date }),
      expect.arrayContaining(['beds.R1.pathology'])
    );
    expect(result.outcome).not.toBe('failed');
    expect(result.autoMerged).toBe(true);
    expect(result.conflictSummary?.kind).toBe('concurrency');
  });
});
