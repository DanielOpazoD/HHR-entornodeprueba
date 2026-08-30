import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createRemoteWriteState } from '@/services/repositories/dailyRecordWriteState';
import { buildGuardedDailyRecordPatchPolicy } from '@/services/repositories/dailyRecordGuardedCommandPolicy';
import { DataFactory } from '@/tests/factories/DataFactory';

const { saveToIndexedDBMock, isFirestoreEnabledMock, resolveRemoteWriteRecoveryMock } = vi.hoisted(
  () => ({
    saveToIndexedDBMock: vi.fn(),
    isFirestoreEnabledMock: vi.fn(),
    resolveRemoteWriteRecoveryMock: vi.fn(),
  })
);

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  saveRecord: saveToIndexedDBMock,
  saveRecordStrict: saveToIndexedDBMock,
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: isFirestoreEnabledMock,
}));

vi.mock('@/services/repositories/dailyRecordRemoteWriteController', () => ({
  resolveRemoteWriteRecovery: resolveRemoteWriteRecoveryMock,
}));

import { persistLocalAndAttemptRemoteSync } from '@/services/repositories/dailyRecordRemotePersistenceController';

const buildRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T10:00:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

const buildAuthorityReceipt = () => ({
  recordState: {
    lastUpdated: '2026-05-23T10:30:00.000Z',
    meta: {
      revision: 2,
      lastMutationId: 'mutation-2',
      updatedAt: '2026-05-23T10:30:00.000Z',
    },
    record: {
      ...buildRecord('2026-05-23'),
      lastUpdated: '2026-05-23T10:30:00.000Z',
    },
  },
});

describe('guarded remote-first daily-record persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFirestoreEnabledMock.mockReturnValue(true);
    saveToIndexedDBMock.mockResolvedValue({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: ['2026-05-23'],
    });
  });

  it('never waits for or acknowledges an outbox task that it did not create', async () => {
    const state = createRemoteWriteState();
    const ackLocalAfterRemote = vi.fn(() => new Promise<void>(() => {}));

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['beds.R1.clinicalCrib'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue(buildAuthorityReceipt()),
      onRemoteFailure: vi.fn(),
      ackLocalAfterRemote,
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('continue');
    expect(ackLocalAfterRemote).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      savedRemotely: true,
      savedLocally: true,
      consistencyState: 'persisted_and_synced',
      confirmedRecord: expect.any(Object),
    });
  });

  it('routes an explicit manual clinical crib command through remote authority first', () => {
    const baseRecord = DataFactory.createMockDailyRecord('2026-05-23', {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'parent-episode',
          clinicalCrib: undefined,
        }),
      },
    });
    const newCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      clinicalEpisodeId: 'crib-new',
      patientName: 'RN nuevo',
      devices: ['VVP'],
    });
    const patch = { 'beds.R1.clinicalCrib': newCrib };

    const policy = buildGuardedDailyRecordPatchPolicy({
      patch,
      mergedPatches: patch,
      baseRecord,
      options: {
        clinicalCribCreate: {
          bedId: 'R1',
          confirmedLastUpdated: baseRecord.lastUpdated,
          confirmedParent: { clinicalEpisodeId: 'parent-episode' },
        },
      },
      readRemoteRecord: vi.fn(),
    });

    expect(policy.remoteAuthorityFirst).toBe(true);
    expect(policy.requireAtomicCas).toBe(true);
    expect(policy.requireConfirmedRecord).toBe(true);
    expect(policy.clinicalCribCreate).toMatchObject({
      bedId: 'R1',
      confirmedLastUpdated: baseRecord.lastUpdated,
      confirmedParent: { clinicalEpisodeId: 'parent-episode' },
    });
    expect(Object.keys(policy.remoteAuthorityPatch)).not.toContain('beds.R1.clinicalCrib.devices');
  });

  it('does not sanitize a first crib object written by guarded Rayen enrichment', () => {
    const baseRecord = DataFactory.createMockDailyRecord('2026-05-23', {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'parent-episode',
          clinicalCrib: undefined,
        }),
      },
    });
    const newCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      clinicalEpisodeId: 'crib-rayen',
      patientName: 'RN desde Rayen',
      devices: ['VVP'],
    });
    const patch = { 'beds.R1.clinicalCrib': newCrib };

    const policy = buildGuardedDailyRecordPatchPolicy({
      patch,
      mergedPatches: patch,
      baseRecord,
      options: {
        rayenClinicalWriteGuard: {
          runId: 'rayen-run',
          importMode: 'preview',
          clinicalBatchMode: 'shadow',
          revision: 1,
          sourceDate: '2026-05-23',
          recordScope: 'run',
        },
      },
      readRemoteRecord: vi.fn(),
    });

    expect(policy.remoteAuthorityFirst).toBe(true);
    expect(policy.clinicalCribCreate).toBeUndefined();
    expect(policy.remoteAuthorityPatch).toEqual(patch);
  });

  it('adopts the authoritative record when a guarded command was already applied', async () => {
    const rejection = new Error('stale expected version');
    const authoritativeRecord = {
      ...buildRecord('2026-05-23'),
      lastUpdated: '2026-05-23T10:30:00.000Z',
    };
    const state = createRemoteWriteState();
    const onRemoteFailure = vi.fn();
    const resolveAlreadyAppliedRemoteRecord = vi.fn().mockResolvedValue(authoritativeRecord);
    const localProjection = {
      ...authoritativeRecord,
      lastUpdated: '2026-05-23T10:31:00.000Z',
    };
    const adoptRemoteAuthorityRecord = vi.fn().mockResolvedValue(localProjection);

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['beds.R1.clinicalCrib'],
      remoteState: state,
      remoteWrite: vi.fn().mockRejectedValue(rejection),
      onRemoteFailure,
      resolveAlreadyAppliedRemoteRecord,
      adoptRemoteAuthorityRecord,
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('continue');
    expect(resolveAlreadyAppliedRemoteRecord).toHaveBeenCalledWith(rejection);
    expect(adoptRemoteAuthorityRecord).toHaveBeenCalledWith(authoritativeRecord);
    expect(saveToIndexedDBMock).not.toHaveBeenCalled();
    expect(onRemoteFailure).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      savedLocally: true,
      savedRemotely: true,
      consistencyState: 'persisted_and_synced',
      confirmedRecord: authoritativeRecord,
      localProjectionRecord: localProjection,
      observabilityTags: ['daily_record', 'write', 'persisted_and_synced', 'already_applied'],
    });
  });
});
