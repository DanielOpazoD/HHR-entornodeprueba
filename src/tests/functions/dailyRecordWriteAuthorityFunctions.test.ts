import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

describe('dailyRecordWriteAuthorityFunctions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes daily records in a transaction after clinical authority validation', async () => {
    const { admin, set, docRef, historyDoc, telemetryAdd } = createAdminMock({
      remoteData: {
        date: '2026-05-13',
        lastUpdated: '2026-05-13T10:00:00.000Z',
        beds: {},
      },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    const result = await functionsApi.saveDailyRecordWithClinicalAuthority.run(
      {
        date: '2026-05-13',
        expectedLastUpdated: '2026-05-13T10:00:05.000Z',
        mode: 'enforced',
        origin: 'outbox',
        syncContract: {
          expectedVersion: '2026-05-13T10:00:05.000Z',
          changedPaths: ['beds.R1.pathology'],
        },
        record: makeRecord(),
      },
      makeContext()
    );

    expect(set).toHaveBeenCalledWith(
      historyDoc,
      expect.objectContaining({
        date: '2026-05-13',
        snapshotTimestamp: expect.anything(),
      })
    );
    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        date: '2026-05-13',
        beds: expect.objectContaining({
          R1: expect.objectContaining({ clinicalEpisodeId: 'ep-uno' }),
        }),
        lastUpdated: expect.anything(),
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        date: '2026-05-13',
        mode: 'enforced',
        authorityStatus: 'ok',
        coverage: {
          activePatients: 1,
          canonicalEpisodeIds: 1,
          fallbackEpisodeKeys: 0,
          degenerateFallbackEpisodeKeys: 0,
        },
        violations: [],
      })
    );
    expect(telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'dailyRecordWriteAuthority',
        operation: 'saveDailyRecordWithClinicalAuthority',
        status: 'success',
        context: expect.objectContaining({
          date: '2026-05-13',
          mode: 'enforced',
          origin: 'outbox',
          authorityStatus: 'ok',
          violationTypes: '',
          changedPathsCount: 1,
          activePatients: 1,
          canonicalEpisodeIds: 1,
          fallbackEpisodeKeys: 0,
          degenerateFallbackEpisodeKeys: 0,
        }),
      })
    );
    expect(JSON.stringify(telemetryAdd.mock.calls[0]?.[0])).not.toContain('11.111.111-1');
    expect(JSON.stringify(telemetryAdd.mock.calls[0]?.[0])).not.toContain('Paciente Uno');
  });

  it('applies partial patches inside the authority transaction against the current remote record', async () => {
    const { admin, set, docRef, historyDoc, telemetryAdd } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        lastUpdated: '2026-05-13T10:00:05.000Z',
        meta: {
          revision: 4,
          lastMutationId: 'previous-mutation',
        },
        beds: {
          R1: {
            ...makeRecord().beds.R1,
            pathology: 'Diagnostico remoto base',
            status: 'Grave',
          },
        },
      },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    const result = await functionsApi.patchDailyRecordWithClinicalAuthority.run(
      {
        date: '2026-05-13',
        expectedLastUpdated: '2026-05-13T10:00:05.000Z',
        mode: 'enforced',
        origin: 'direct_partial_update',
        syncContract: {
          expectedVersion: '2026-05-13T10:00:05.000Z',
          changedPaths: ['beds.R1.pathology'],
          mutationId: 'mutation-1',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
        patch: {
          'beds.R1.pathology': 'Diagnostico local nuevo',
        },
      },
      makeContext()
    );

    expect(set).toHaveBeenCalledWith(
      historyDoc,
      expect.objectContaining({
        date: '2026-05-13',
        snapshotTimestamp: expect.anything(),
      })
    );
    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        date: '2026-05-13',
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            pathology: 'Diagnostico local nuevo',
            status: 'Grave',
          }),
        }),
        meta: expect.objectContaining({
          revision: 5,
          lastMutationId: 'mutation-1',
          lastWriterClientId: 'client-1',
          lastWriterTabId: 'tab-1',
          lastChangedPaths: ['beds.R1.pathology'],
        }),
        lastUpdated: expect.anything(),
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        date: '2026-05-13',
        mode: 'enforced',
        authorityStatus: 'ok',
        revision: 5,
        mutationId: 'mutation-1',
      })
    );
    expect(telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'patchDailyRecordWithClinicalAuthority',
        status: 'success',
        context: expect.objectContaining({
          changedPathsCount: 1,
          mutationId: 'mutation-1',
        }),
      })
    );
  });

  it('applies Qx and derived UPC bed type patches inside the authority transaction', async () => {
    const { admin, set, docRef } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        bedTypeOverrides: {},
        beds: {
          R1: {
            ...makeRecord().beds.R1,
            surgicalComplication: false,
            isUPC: false,
          },
        },
      },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await functionsApi.patchDailyRecordWithClinicalAuthority.run(
      {
        date: '2026-05-13',
        expectedLastUpdated: '2026-05-13T10:00:00.000Z',
        mode: 'enforced',
        origin: 'direct_partial_update',
        syncContract: {
          expectedVersion: '2026-05-13T10:00:00.000Z',
          changedPaths: [
            'beds.R1.surgicalComplication',
            'beds.R1.upcChecklist',
            'beds.R1.isUPC',
            'bedTypeOverrides.R1',
          ],
          mutationId: 'mutation-upc-qx-1',
        },
        patch: {
          'beds.R1.surgicalComplication': true,
          'beds.R1.upcChecklist': {
            uciCriteria: ['uci_vmi'],
            utiCriteria: [],
            classification: 'UPC_UCI',
            evaluatedAt: '2026-05-13T10:05:00.000Z',
          },
          'beds.R1.isUPC': true,
          'bedTypeOverrides.R1': 'UCI',
        },
      },
      makeContext()
    );

    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            surgicalComplication: true,
            isUPC: true,
            upcChecklist: expect.objectContaining({
              classification: 'UPC_UCI',
            }),
          }),
        }),
        bedTypeOverrides: expect.objectContaining({
          R1: 'UCI',
        }),
      })
    );
  });

  it('rejects authority patches that target non-clinical census paths', async () => {
    const { admin, set } = createAdminMock({
      remoteData: makeRecord(),
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
          origin: 'direct_partial_update',
          patch: {
            'beds.R1.patientName': 'Nombre alterado desde callable',
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'invalid-argument',
    });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects authority patches for beds that are not present in the current remote record', async () => {
    const { admin, set } = createAdminMock({
      remoteData: makeRecord(),
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_urgency'),
    });

    await expect(
      functionsApi.patchDailyRecordWithClinicalAuthority.run(
        {
          date: '2026-05-13',
          mode: 'enforced',
          origin: 'direct_partial_update',
          patch: {
            'beds.R9.pathology': 'Diagnostico en cama inexistente',
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects partial authority patches when expectedLastUpdated is older than the remote record', async () => {
    const { admin, set } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        lastUpdated: '2026-05-13T10:30:00.000Z',
        beds: {
          R1: {
            ...makeRecord().beds.R1,
            pathology: 'Diagnostico remoto actualizado',
          },
        },
      },
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
          expectedLastUpdated: '2026-05-13T10:00:00.000Z',
          mode: 'enforced',
          origin: 'direct_partial_update',
          patch: {
            'beds.R1.pathology': 'Diagnostico stale desde cliente',
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'aborted',
    });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects partial authority patches when baseRevision is stale', async () => {
    const { admin, set } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        lastUpdated: '2026-05-13T10:00:00.000Z',
        meta: {
          revision: 8,
        },
      },
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
          expectedLastUpdated: '2026-05-13T10:00:00.000Z',
          mode: 'enforced',
          origin: 'direct_partial_update',
          syncContract: {
            expectedVersion: '2026-05-13T10:00:00.000Z',
            baseRevision: 7,
            changedPaths: ['beds.R1.pathology'],
            mutationId: 'stale-revision-mutation',
          },
          patch: {
            'beds.R1.pathology': 'Diagnostico con revision obsoleta',
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'aborted',
      message: expect.stringContaining('revision_mismatch'),
    });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects full saves that duplicate an active clinical episode', async () => {
    const { admin, set } = createAdminMock();
    const record = makeRecord();
    record.beds.R2 = {
      ...record.beds.R1,
      bedId: 'R2',
    };
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });

    await expect(
      functionsApi.saveDailyRecordWithClinicalAuthority.run(
        {
          date: '2026-05-13',
          record,
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects stale expected versions inside the transaction', async () => {
    const { admin, set } = createAdminMock({
      remoteData: {
        date: '2026-05-13',
        lastUpdated: '2026-05-13T10:30:00.000Z',
        beds: {},
      },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_urgency'),
    });

    await expect(
      functionsApi.saveDailyRecordWithClinicalAuthority.run(
        {
          date: '2026-05-13',
          expectedLastUpdated: '2026-05-13T10:00:00.000Z',
          record: makeRecord(),
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'aborted',
    });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects viewer role even when authenticated', async () => {
    const { admin, set } = createAdminMock();
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('viewer'),
    });

    await expect(
      functionsApi.saveDailyRecordWithClinicalAuthority.run(
        {
          date: '2026-05-13',
          record: makeRecord(),
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });

    expect(set).not.toHaveBeenCalled();
  });
});
