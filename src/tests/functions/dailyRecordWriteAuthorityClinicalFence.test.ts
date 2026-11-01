import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';
// Freeze only Date: the callable guards and fixtures must share the same instant.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('daily-record authoritative clinical field fence', () => {
  it.each(['off', 'shadow', 'enforced'] as const)(
    'preserves server clinical fields after schema-v2 migration in %s mode',
    async clinicalBatchMode => {
      const remote = {
        ...makeRecord(),
        dateTimestamp: Date.now(),
        beds: {
          R1: {
            ...makeRecord().beds.R1,
            vitalSigns: { systolic: 118 },
          },
        },
      };
      const incoming = {
        ...makeRecord(),
        dateTimestamp: remote.dateTimestamp,
        beds: {
          R1: {
            ...makeRecord().beds.R1,
            pathology: 'Cambio estructural',
            vitalSigns: { systolic: 60 },
          },
        },
      };
      const { admin, set, docRef } = createAdminMock({
        remoteData: remote,
        policyData: { schemaVersion: 2, clinicalBatchMode, mode: 'preview', revision: 4 },
      });
      const functionsApi = createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
      });

      await functionsApi.saveDailyRecordWithClinicalAuthority.run(
        {
          expectedLastUpdated: remote.lastUpdated,
          date: remote.date,
          mode: 'shadow',
          record: incoming,
        },
        makeContext()
      );

      expect(set).toHaveBeenCalledWith(
        docRef,
        expect.objectContaining({
          beds: {
            R1: expect.objectContaining({
              pathology: 'Cambio estructural',
              vitalSigns: { systolic: 118 },
            }),
          },
        })
      );
    }
  );

  it('preserves server clinical fields when a full structural save runs under enforced policy', async () => {
    const remote = {
      ...makeRecord(),
      dateTimestamp: Date.now(),
      beds: {
        R1: {
          ...makeRecord().beds.R1,
          vitalSigns: { systolic: 118 },
          evaluationScores: { braden: { total: 17 } },
        },
      },
    };
    const incoming = {
      ...makeRecord(),
      dateTimestamp: remote.dateTimestamp,
      beds: {
        R1: {
          ...makeRecord().beds.R1,
          pathology: 'Cambio estructural válido',
          vitalSigns: { systolic: 60 },
          evaluationScores: { braden: { total: 5 } },
        },
      },
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

    const result = await functionsApi.saveDailyRecordWithClinicalAuthority.run(
      {
        expectedLastUpdated: remote.lastUpdated,
        date: remote.date,
        mode: 'enforced',
        record: incoming,
      },
      makeContext()
    );

    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        beds: {
          R1: expect.objectContaining({
            pathology: 'Cambio estructural válido',
            vitalSigns: { systolic: 118 },
            evaluationScores: { braden: { total: 17 } },
          }),
        },
      })
    );
    expect(result.recordState.record).toEqual(
      expect.objectContaining({
        beds: {
          R1: expect.objectContaining({
            pathology: 'Cambio estructural válido',
            vitalSigns: { systolic: 118 },
          }),
        },
      })
    );
  });

  it('applies nurse structural patches while preserving server-owned clinical fields', async () => {
    const remote = {
      ...makeRecord(),
      dateTimestamp: Date.now(),
      beds: {
        R1: {
          ...makeRecord().beds.R1,
          vitalSigns: { systolic: 118 },
          evaluationScores: { braden: { total: 17 } },
        },
      },
    };
    const { admin, update, docRef } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await functionsApi.patchDailyRecordWithClinicalAuthority.run(
      {
        expectedLastUpdated: remote.lastUpdated,
        date: remote.date,
        mode: 'enforced',
        patch: {
          'beds.R1.patientName': 'Nombre estructural actualizado',
        },
      },
      makeContext()
    );

    // La transacción escribe sólo el path tocado; los campos server-owned no
    // viajan porque no cambiaron (viven intactos en el documento).
    expect(update).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        'beds.R1.patientName': 'Nombre estructural actualizado',
      })
    );
  });

  it('rejects direct Rayen clinical patches instead of acknowledging discarded values', async () => {
    const remote = {
      ...makeRecord(),
      dateTimestamp: Date.now(),
      beds: {
        R1: {
          ...makeRecord().beds.R1,
          vitalSigns: { systolic: 118 },
        },
      },
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
          expectedLastUpdated: remote.lastUpdated,
          date: remote.date,
          mode: 'enforced',
          patch: { 'beds.R1.vitalSigns': { systolic: 60 } },
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('authoritative clinical batch'),
    });

    expect(set).not.toHaveBeenCalled();
  });

  it.each(['off', 'shadow'] as const)(
    'rejects unguarded clinical patches after rollback to %s',
    async clinicalBatchMode => {
      const remote = {
        ...makeRecord(),
        dateTimestamp: Date.now(),
        beds: { R1: { ...makeRecord().beds.R1, vitalSigns: { systolic: 118 } } },
      };
      const { admin, set } = createAdminMock({
        remoteData: remote,
        policyData: { schemaVersion: 2, clinicalBatchMode, mode: 'preview', revision: 4 },
      });
      const functionsApi = createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
      });

      await expect(
        functionsApi.patchDailyRecordWithClinicalAuthority.run(
          {
            expectedLastUpdated: remote.lastUpdated,
            date: remote.date,
            mode: 'shadow',
            patch: { 'beds.R1.vitalSigns': { systolic: 60 } },
          },
          makeContext()
        )
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(set).not.toHaveBeenCalled();
    }
  );

  it.each(['off', 'shadow', 'enforced', null, 'malformed'])(
    'rejects a retired guard (%j) even on an otherwise writable operational patch',
    async clinicalBatchMode => {
      const remote = makeRecord();
      const { admin, set, update } = createAdminMock({
        remoteData: remote,
        policyData: {
          schemaVersion: 2,
          mode: 'preview',
          clinicalBatchMode: 'enforced',
          revision: 7,
        },
      });
      const api = createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
      });
      const request = {
        date: remote.date,
        expectedLastUpdated: remote.lastUpdated,
        patch: { 'beds.R1.devices': ['VVP'] },
      };
      await api.patchDailyRecordWithClinicalAuthority.run(request, makeContext());
      set.mockClear();
      update.mockClear();

      await expect(
        api.patchDailyRecordWithClinicalAuthority.run(
          {
            ...request,
            rayenClinicalWriteGuard:
              clinicalBatchMode === null
                ? null
                : {
                    runId: 'run-1',
                    importMode: 'preview',
                    clinicalBatchMode,
                    revision: 7,
                    sourceDate: remote.date,
                    recordScope: 'run',
                  },
          },
          makeContext()
        )
      ).rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Legacy Rayen clinical write guards are no longer supported.',
      });
      expect(set).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    }
  );

  it('rejects nurse structural edits to a legacy record outside the derived calendar window', async () => {
    vi.setSystemTime(new Date('2026-05-16T12:00:00.000Z'));
    const remote = {
      ...makeRecord(),
      date: '2026-05-13',
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
          expectedLastUpdated: remote.lastUpdated,
          date: remote.date,
          mode: 'enforced',
          patch: { 'beds.R1.patientName': 'Edición histórica fuera de ventana' },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects arbitrary document roots even for nurses with structural bed authority', async () => {
    const { admin, set } = createAdminMock({
      remoteData: makeRecord(),
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
          expectedLastUpdated: makeRecord().lastUpdated,
          date: '2026-05-13',
          mode: 'enforced',
          patch: { 'rayenSyncHistory.0.status': 'complete' },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects replacement of the complete beds tree before applying the patch', async () => {
    const { admin, set } = createAdminMock({
      remoteData: makeRecord(),
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
          expectedLastUpdated: makeRecord().lastUpdated,
          date: '2026-05-13',
          mode: 'enforced',
          patch: { beds: {} },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(set).not.toHaveBeenCalled();
  });
});
