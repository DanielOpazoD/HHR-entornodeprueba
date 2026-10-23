import { describe, expect, it, vi } from 'vitest';
import {
  buildGuardedDailyRecordPatchPolicy,
  buildGuardedDailyRecordRemoteWriteOptions,
} from '@/services/repositories/dailyRecordGuardedCommandPolicy';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { DataFactory } from '@/tests/factories/DataFactory';

const DATE = '2026-05-23';

const buildOptions = (
  patch: DailyRecordPatch,
  options: PartialUpdateDailyRecordOptions,
  isReclassification = false
) => {
  const baseRecord = DataFactory.createMockDailyRecord(DATE, {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        clinicalEpisodeId: 'parent-episode',
        clinicalCrib: undefined,
      }),
    },
  });
  const policy = buildGuardedDailyRecordPatchPolicy({
    patch,
    mergedPatches: patch,
    baseRecord,
    options,
    readRemoteRecord: vi.fn(),
  });
  return buildGuardedDailyRecordRemoteWriteOptions({
    options,
    policy,
    syncContract: buildDailyRecordSyncContract(baseRecord, { changedPaths: Object.keys(patch) }),
    isReclassification,
  });
};

// A receipt makes the controller adopt the returned record; only confirmed writes may get one.
describe('guarded remote write options: committed record receipt', () => {
  it('asks the atomic write for its committed record when the command needs confirmation', () => {
    const rayenCheckpoint = buildOptions(
      { rayenSync: { at: 'now', by: 'rayen' } },
      { requireAtomicCas: true, requireConfirmedRecord: true, requireRemoteAuthorityFirst: true }
    );
    const cribCreation = buildOptions(
      {
        'beds.R1.clinicalCrib': DataFactory.createMockPatient('R1', {
          bedMode: 'Cuna',
          clinicalEpisodeId: 'crib-episode',
          patientName: 'RN Sintético',
        }),
      },
      {
        clinicalCribCreate: {
          bedId: 'R1',
          confirmedLastUpdated: `${DATE}T10:00:00.000Z`,
          confirmedParent: { clinicalEpisodeId: 'parent-episode' },
        },
      }
    );

    expect(rayenCheckpoint).toMatchObject({ requireAtomicCas: true, returnCommittedRecord: true });
    expect(cribCreation).toMatchObject({ requireAtomicCas: true, returnCommittedRecord: true });
  });

  it('keeps plain local-first writes, including reclassification, receipt-less', () => {
    const reclassification = buildOptions(
      { discharges: [], cma: [] } as DailyRecordPatch,
      {},
      true
    );
    const plainEdit = buildOptions({ 'beds.R1.pathology': 'Dx sintético' }, {});

    expect(reclassification.requireAtomicCas).toBe(true);
    expect(reclassification).not.toHaveProperty('returnCommittedRecord');
    expect(plainEdit).not.toHaveProperty('returnCommittedRecord');
  });
});
