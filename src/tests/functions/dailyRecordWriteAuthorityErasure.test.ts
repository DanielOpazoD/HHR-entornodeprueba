import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

describe('dailyRecordWriteAuthorityFunctions erasure guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects full saves that would erase a patient present in the cloud', async () => {
    const { admin, set } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        lastUpdated: '2026-05-13T10:00:00.000Z',
        beds: {
          R1: makeRecord().beds.R1,
          R2: {
            bedId: 'R2',
            patientName: 'Paciente Dos',
            rut: '22.222.222-2',
            admissionDate: '2026-05-13',
            admissionTime: '09:00',
            clinicalEpisodeId: 'ep-dos',
            isBlocked: false,
          },
        },
      },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    // The incoming record only has R1, so R2's cloud patient would be erased — and there is no
    // movement accounting for it. The in-transaction guard must block the write.
    await expect(
      functionsApi.saveDailyRecordWithClinicalAuthority.run(
        {
          date: '2026-05-13',
          expectedLastUpdated: '2026-05-13T10:00:00.000Z',
          mode: 'enforced',
          origin: 'outbox',
          record: makeRecord(),
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    expect(set).not.toHaveBeenCalled();
  });
});
