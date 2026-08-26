import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';

const require = createRequire(import.meta.url);
const {
  RAYEN_CLINICAL_FIELDS,
  preserveRayenClinicalFields,
} = require('../../../functions/lib/dailyRecordClinicalFieldPreservation.js');

describe('daily-record authoritative clinical field fence', () => {
  it('keeps the client ownership contract aligned with the server fence', () => {
    expect([...RAYEN_OWNED_CLINICAL_FIELDS]).toEqual([...RAYEN_CLINICAL_FIELDS]);
  });

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
        { date: remote.date, mode: 'shadow', record: incoming },
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
      { date: remote.date, mode: 'enforced', record: incoming },
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
    const { admin, set, docRef } = createAdminMock({
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
        date: remote.date,
        mode: 'enforced',
        patch: {
          'beds.R1.patientName': 'Nombre estructural actualizado',
        },
      },
      makeContext()
    );

    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        beds: {
          R1: expect.objectContaining({
            patientName: 'Nombre estructural actualizado',
            vitalSigns: { systolic: 118 },
            evaluationScores: { braden: { total: 17 } },
          }),
        },
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

  it('applies a legacy clinical patch only when policy and frozen run match atomically', async () => {
    const policy = {
      schemaVersion: 2,
      mode: 'preview',
      clinicalBatchMode: 'shadow',
      revision: 4,
    };
    const remote = {
      ...makeRecord(),
      rayenSyncHistory: [
        {
          id: 'run-1',
          status: 'applied',
          sourceDate: '2026-05-13',
          policy: { mode: 'preview', clinicalBatchMode: 'shadow', revision: 4 },
        },
      ],
      beds: { R1: { ...makeRecord().beds.R1, vitalSigns: { systolic: 118 } } },
    };
    const { admin, set, docRef, historyDoc } = createAdminMock({
      remoteData: remote,
      policyData: policy,
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await functionsApi.patchDailyRecordWithClinicalAuthority.run(
      {
        date: remote.date,
        mode: 'shadow',
        expectedLastUpdated: remote.lastUpdated,
        historyPolicy: 'skip',
        patch: { 'beds.R1.vitalSigns': { systolic: 120 } },
        rayenClinicalWriteGuard: {
          runId: 'run-1',
          importMode: 'preview',
          clinicalBatchMode: 'shadow',
          revision: 4,
          sourceDate: remote.date,
          recordScope: 'run',
        },
      },
      makeContext()
    );

    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        beds: { R1: expect.objectContaining({ vitalSigns: { systolic: 120 } }) },
      })
    );
    expect(set).toHaveBeenCalledWith(
      historyDoc,
      expect.objectContaining({
        beds: { R1: expect.objectContaining({ vitalSigns: { systolic: 118 } }) },
      })
    );
  });

  it('rejects a legacy clinical patch after the global policy revision changes', async () => {
    const remote = {
      ...makeRecord(),
      rayenSyncHistory: [
        {
          id: 'run-1',
          status: 'applied',
          sourceDate: '2026-05-13',
          policy: { mode: 'preview', clinicalBatchMode: 'shadow', revision: 4 },
        },
      ],
    };
    const { admin, set } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'shadow', revision: 5 },
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
          mode: 'shadow',
          expectedLastUpdated: remote.lastUpdated,
          patch: { 'beds.R1.vitalSigns': { systolic: 120 } },
          rayenClinicalWriteGuard: {
            runId: 'run-1',
            importMode: 'preview',
            clinicalBatchMode: 'shadow',
            revision: 4,
            sourceDate: remote.date,
            recordScope: 'run',
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects nurse structural edits to a legacy record outside the derived calendar window', async () => {
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
          date: '2026-05-13',
          mode: 'enforced',
          patch: { beds: {} },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(set).not.toHaveBeenCalled();
  });

  it('matches authoritative clinical fields by episode when the patient changes bed', () => {
    const remote = {
      beds: {
        R1: {
          clinicalEpisodeId: 'episode-1',
          vitalSigns: { systolic: 121 },
        },
      },
    };
    const incoming = {
      beds: {
        R2: {
          clinicalEpisodeId: 'episode-1',
          patientName: 'Paciente trasladado',
          vitalSigns: { systolic: 80 },
        },
      },
    };

    expect(preserveRayenClinicalFields({ remoteRecord: remote, incomingRecord: incoming })).toEqual(
      {
        beds: {
          R2: {
            clinicalEpisodeId: 'episode-1',
            patientName: 'Paciente trasladado',
            vitalSigns: { systolic: 121 },
          },
        },
      }
    );
  });

  it('removes client-supplied batch fields from episodes not present in the remote record', () => {
    const result = preserveRayenClinicalFields({
      remoteRecord: { beds: {} },
      incomingRecord: {
        beds: {
          R1: {
            clinicalEpisodeId: 'new-episode',
            patientName: 'Paciente nuevo',
            vitalSigns: { systolic: 70 },
            clinicalSyncCheckpoint: { version: 2 },
          },
        },
      },
    });

    expect(result.beds.R1).toEqual({
      clinicalEpisodeId: 'new-episode',
      patientName: 'Paciente nuevo',
    });
  });
});
