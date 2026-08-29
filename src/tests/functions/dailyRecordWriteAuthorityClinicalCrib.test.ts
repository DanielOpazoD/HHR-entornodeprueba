import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const makeRecordWithClinicalCrib = () => {
  const record = makeRecord();
  const parent = record.beds.R1;
  return {
    ...record,
    beds: {
      R1: {
        ...parent,
        bedMode: 'Cama' as const,
        clinicalCrib: {
          ...parent,
          bedMode: 'Cuna' as const,
          identityStatus: 'provisional' as const,
          patientName: 'RN Uno',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'crib-ep-r1',
        },
      },
    },
  };
};

const makeIntentionalClinicalCribClear = (
  remote: ReturnType<typeof makeRecordWithClinicalCrib>
) => {
  const occupant = remote.beds.R1.clinicalCrib!;
  return {
    bedId: 'R1',
    target: 'clinicalCrib',
    confirmedLastUpdated: remote.lastUpdated,
    confirmedOccupant: {
      clinicalEpisodeId: occupant.clinicalEpisodeId,
      rut: occupant.rut,
      patientName: occupant.patientName,
    },
  };
};

describe('dailyRecordWriteAuthorityFunctions clinical crib erasure guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows an exact-version clear of only the declared clinical crib', async () => {
    const remote = {
      ...makeRecordWithClinicalCrib(),
      dateTimestamp: Date.now(),
      meta: { revision: 4, lastMutationId: 'previous' },
    };
    const { admin, set, docRef } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await expect(
      functionsApi.patchDailyRecordWithClinicalAuthority.run(
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          mode: 'enforced',
          origin: 'direct_partial_update',
          intentionalBedClear: makeIntentionalClinicalCribClear(remote),
          syncContract: {
            expectedVersion: remote.lastUpdated,
            changedPaths: ['beds.R1.clinicalCrib'],
            mutationId: 'clear-r1-crib',
          },
          patch: { 'beds.R1.clinicalCrib': null },
        },
        makeContext()
      )
    ).resolves.toMatchObject({ success: true, mutationId: 'clear-r1-crib' });

    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        beds: {
          R1: expect.objectContaining({
            patientName: 'Paciente Uno',
            clinicalCrib: null,
          }),
        },
      })
    );
  });

  it('keeps blocking a clinical crib erasure without its explicit clear intent', async () => {
    const remote = {
      ...makeRecordWithClinicalCrib(),
      dateTimestamp: Date.now(),
    };
    const { admin, set } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await expect(
      functionsApi.patchDailyRecordWithClinicalAuthority.run(
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          mode: 'enforced',
          patch: { 'beds.R1.clinicalCrib': null },
        },
        makeContext()
      )
    ).rejects.toBeDefined();

    expect(set).not.toHaveBeenCalled();
  });
});
