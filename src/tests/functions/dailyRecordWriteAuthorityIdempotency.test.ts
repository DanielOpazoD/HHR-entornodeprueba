import { describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

describe('dailyRecordWriteAuthorityFunctions idempotency', () => {
  it('returns idempotent success for duplicate patch mutationId before revision checks', async () => {
    const { admin, set, telemetryAdd } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        lastUpdated: '2026-05-13T10:30:00.000Z',
        meta: {
          revision: 8,
          lastMutationId: 'mutation-duplicate-patch',
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
        expectedLastUpdated: '2026-05-13T10:00:00.000Z',
        mode: 'enforced',
        origin: 'direct_partial_update',
        syncContract: {
          expectedVersion: '2026-05-13T10:00:00.000Z',
          baseRevision: 7,
          changedPaths: ['beds.R1.pathology'],
          mutationId: 'mutation-duplicate-patch',
        },
        patch: {
          'beds.R1.pathology': 'Diagnostico ya aplicado previamente',
        },
      },
      makeContext()
    );

    expect(set).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      date: '2026-05-13',
      mode: 'enforced',
      authorityStatus: 'idempotent',
      revision: 8,
      mutationId: 'mutation-duplicate-patch',
    });
    expect(telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'patchDailyRecordWithClinicalAuthority',
        status: 'success',
        context: expect.objectContaining({
          authorityStatus: 'idempotent',
          mutationId: 'mutation-duplicate-patch',
        }),
      })
    );
  });

  it('returns idempotent success for duplicate full-save mutationId before stale checks', async () => {
    const { admin, set, telemetryAdd } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        lastUpdated: '2026-05-13T10:30:00.000Z',
        meta: {
          revision: 6,
          lastMutationId: 'mutation-duplicate-save',
        },
      },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_urgency'),
    });

    const result = await functionsApi.saveDailyRecordWithClinicalAuthority.run(
      {
        date: '2026-05-13',
        expectedLastUpdated: '2026-05-13T10:00:00.000Z',
        mode: 'enforced',
        origin: 'outbox',
        syncContract: {
          expectedVersion: '2026-05-13T10:00:00.000Z',
          baseRevision: 5,
          changedPaths: ['beds.R1.pathology'],
          mutationId: 'mutation-duplicate-save',
        },
        record: makeRecord(),
      },
      makeContext()
    );

    expect(set).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      date: '2026-05-13',
      mode: 'enforced',
      authorityStatus: 'idempotent',
      revision: 6,
      mutationId: 'mutation-duplicate-save',
    });
    expect(telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'saveDailyRecordWithClinicalAuthority',
        status: 'success',
        context: expect.objectContaining({
          authorityStatus: 'idempotent',
          mutationId: 'mutation-duplicate-save',
        }),
      })
    );
  });
});
