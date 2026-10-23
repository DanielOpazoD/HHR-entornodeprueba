import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('write authority protects newborn identity during full saves', () => {
  it.each(['canonical', 'legacy', 'missing'] as const)(
    'blocks a dropped newborn sharing its mother document with %s episode ids',
    async kind => {
      const mother = {
        ...makeRecord().beds.R1,
        patientName: 'Madre Sintetica',
        clinicalEpisodeId:
          kind === 'canonical' ? 'ep_mother' : kind === 'legacy' ? 'legacy_ep_shared' : '',
      };
      const newborn = {
        ...mother,
        patientName: 'RN Sintetico',
        clinicalEpisodeId: kind === 'canonical' ? 'ep_newborn' : mother.clinicalEpisodeId,
      };
      const remote = { ...makeRecord(), beds: { R1: { ...mother, clinicalCrib: newborn } } };
      const incoming = { ...makeRecord(), beds: { R1: mother } };
      const { admin, set, update, historySet } = createAdminMock({ remoteData: remote });
      const api = createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });

      await expect(
        api.saveDailyRecordWithClinicalAuthority.run(
          {
            date: remote.date,
            expectedLastUpdated: remote.lastUpdated,
            mode: 'enforced',
            origin: 'outbox',
            record: incoming,
          },
          makeContext()
        )
      ).rejects.toMatchObject({
        code: 'failed-precondition',
        message: expect.stringContaining('R1 (cuna RN)'),
      });
      expect(set).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(historySet).not.toHaveBeenCalled();
    }
  );

  it('persists a valid mother and newborn relocation through the full-save callable', async () => {
    const mother = {
      ...makeRecord().beds.R1,
      patientName: 'Madre Sintetica',
      clinicalEpisodeId: 'ep_mother',
    };
    const newborn = {
      ...mother,
      patientName: 'RN Sintetico',
      clinicalEpisodeId: 'legacy_ep_newborn',
    };
    const remote = { ...makeRecord(), beds: { R1: { ...mother, clinicalCrib: newborn } } };
    const relocated = {
      ...mother,
      bedId: 'R2',
      clinicalCrib: { ...newborn, bedId: 'R2', clinicalEpisodeId: 'ep_newborn' },
    };
    const { admin, set, docRef } = createAdminMock({ remoteData: remote });
    const api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    const result = await api.saveDailyRecordWithClinicalAuthority.run(
      {
        date: remote.date,
        expectedLastUpdated: remote.lastUpdated,
        mode: 'enforced',
        origin: 'outbox',
        record: { ...makeRecord(), beds: { R2: relocated } },
      },
      makeContext()
    );
    expect(result).toMatchObject({ success: true });
    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        beds: {
          R2: expect.objectContaining({
            clinicalEpisodeId: 'ep_mother',
            clinicalCrib: expect.objectContaining({ clinicalEpisodeId: 'ep_newborn' }),
          }),
        },
      })
    );
  });
});
