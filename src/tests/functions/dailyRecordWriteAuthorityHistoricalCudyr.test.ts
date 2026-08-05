import { describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';

const policy = {
  schemaVersion: 2,
  mode: 'preview',
  clinicalBatchMode: 'shadow',
  revision: 4,
};

const historicalGuard = {
  runId: 'run-historical',
  importMode: 'preview',
  clinicalBatchMode: 'shadow',
  revision: 4,
  sourceDate: '2026-05-13',
  recordScope: 'historical',
};

const historicalRecord = () => ({
  ...makeRecord(),
  date: '2026-05-12',
  rayenSyncHistory: [
    {
      id: 'run-historical',
      status: 'applied',
      sourceDate: '2026-05-13',
      policy: { mode: 'preview', clinicalBatchMode: 'shadow', revision: 4 },
    },
  ],
});

const cudyrPatch = {
  'beds.R1.evaluationScores.cudyr': {
    category: 'C1',
    recordedDate: '2026-05-12',
    source: 'Eloísa',
  },
};

const createFunctionsApi = (admin: ReturnType<typeof createAdminMock>['admin'], role: string) =>
  createDailyRecordWriteAuthorityFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue(role),
  });

describe('daily-record historical CUDYR authority', () => {
  it('restricts historical guarded writes to administrators', async () => {
    const remote = historicalRecord();
    const { admin, set } = createAdminMock({ remoteData: remote, policyData: policy });
    const functionsApi = createFunctionsApi(admin, 'nurse_hospital');

    await expect(
      functionsApi.patchDailyRecordWithClinicalAuthority.run(
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          patch: cudyrPatch,
          rayenClinicalWriteGuard: historicalGuard,
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });

    expect(set).not.toHaveBeenCalled();
  });

  it('allows an administrator to persist canonical historical CUDYR evidence', async () => {
    const remote = historicalRecord();
    const { admin, set, docRef } = createAdminMock({ remoteData: remote, policyData: policy });
    const functionsApi = createFunctionsApi(admin, 'admin');

    await functionsApi.patchDailyRecordWithClinicalAuthority.run(
      {
        date: remote.date,
        expectedLastUpdated: remote.lastUpdated,
        patch: cudyrPatch,
        rayenClinicalWriteGuard: historicalGuard,
      },
      makeContext()
    );

    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        beds: {
          R1: expect.objectContaining({
            evaluationScores: { cudyr: cudyrPatch['beds.R1.evaluationScores.cudyr'] },
          }),
        },
      })
    );
  });

  it('rejects non-CUDYR clinical data in historical guarded writes', async () => {
    const remote = historicalRecord();
    const { admin, set } = createAdminMock({ remoteData: remote, policyData: policy });
    const functionsApi = createFunctionsApi(admin, 'admin');

    await expect(
      functionsApi.patchDailyRecordWithClinicalAuthority.run(
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          patch: { 'beds.R1.vitalSigns': { systolic: 120 } },
          rayenClinicalWriteGuard: historicalGuard,
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(set).not.toHaveBeenCalled();
  });
});
