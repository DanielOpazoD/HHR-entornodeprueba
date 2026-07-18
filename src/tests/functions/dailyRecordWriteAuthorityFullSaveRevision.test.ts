import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

describe('dailyRecordWriteAuthorityFunctions full save revisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects full saves when baseRevision is stale even if expectedLastUpdated matches', async () => {
    const { admin, set } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        lastUpdated: '2026-05-13T10:00:00.000Z',
        meta: { revision: 9 },
      },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await expect(
      functionsApi.saveDailyRecordWithClinicalAuthority.run(
        {
          date: '2026-05-13',
          expectedLastUpdated: '2026-05-13T10:00:00.000Z',
          mode: 'enforced',
          origin: 'direct_save',
          syncContract: {
            expectedVersion: '2026-05-13T10:00:00.000Z',
            baseRevision: 8,
            changedPaths: ['*'],
            mutationId: 'stale-full-save-mutation',
          },
          record: makeRecord(),
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'aborted',
      message: expect.stringContaining('revision_mismatch'),
    });

    expect(set).not.toHaveBeenCalled();
  });
});
