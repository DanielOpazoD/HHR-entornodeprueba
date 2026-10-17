// @vitest-environment node
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('manual specialty classification commits as one decision', () => {
  it.each([
    ['bed', 'Med Interna'],
    ['clinicalCrib', 'Med Interna'],
    ['bed', 'Ginecobstetricia'],
    ['clinicalCrib', 'Ginecobstetricia'],
  ] as const)(
    'commits dependent classification atomically for %s selecting %s',
    async (target, value) => {
      vi.stubEnv('HHR_SPECIALTY_EPISODE_ASSIGNMENT', 'enabled');
      const patient = {
        ...makeRecord().beds.R1,
        specialty: 'Ginecobstetricia',
        secondarySpecialty: 'Cirugía',
        ginecobstetriciaType: 'Obstétrica',
        deliveryRoute: 'Cesárea',
        deliveryDate: '2026-05-13',
        deliveryCesareanLabor: 'Con trabajo de parto',
      };
      const remote = {
        ...makeRecord(),
        meta: { revision: 2 },
        beds: {
          R1:
            target === 'bed'
              ? patient
              : { ...makeRecord().beds.R1, clinicalEpisodeId: 'ep-parent', clinicalCrib: patient },
        },
      };
      const { admin, docRef, update, set } = createAdminMock({
        remoteData: remote,
        policyData: { schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced' },
        specialtyPolicyData: {
          schemaVersion: 1,
          revision: 1,
          autoEnabled: false,
          memoryEnabled: false,
          aiMode: 'off',
          rules: [],
          memory: [],
        },
      });
      const api = createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
      });
      const prefix = target === 'bed' ? 'beds.R1' : 'beds.R1.clinicalCrib';
      const request = {
        date: remote.date,
        patch: { [`${prefix}.specialty`]: value },
        syncContract: {
          mutationId: 'manual-classification',
          baseRevision: 2,
          changedPaths: [`${prefix}.specialty`],
        },
        specialtyIntent: {
          kind: 'manual',
          bedId: 'R1',
          target,
          episodeId: 'ep-uno',
          value,
          expectedDecisionId: null,
        },
      };
      const context = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
      const response = await api.patchDailyRecordWithClinicalAuthority.run(request, context);
      expect(response.success).toBe(true);
      expect(update).toHaveBeenCalledExactlyOnceWith(
        docRef,
        expect.objectContaining({
          [`${prefix}.specialty`]: value,
          [`${prefix}.specialtyAssignment`]: expect.objectContaining({
            decisionId: 'manual-classification',
            source: 'manual',
          }),
          [`${prefix}.secondarySpecialty`]: null,
          ...(value !== 'Ginecobstetricia'
            ? {
                [`${prefix}.ginecobstetriciaType`]: null,
                [`${prefix}.deliveryRoute`]: null,
                [`${prefix}.deliveryDate`]: null,
                [`${prefix}.deliveryCesareanLabor`]: null,
              }
            : {}),
        })
      );
      if (value === 'Ginecobstetricia') {
        expect(Object.keys(update.mock.calls[0][1])).not.toContain(
          `${prefix}.ginecobstetriciaType`
        );
        expect(Object.keys(update.mock.calls[0][1])).not.toContain(`${prefix}.deliveryRoute`);
      }
      expect(set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ decisionId: 'manual-classification' })
      );
      expect(Object.keys(update.mock.calls[0][1]).filter(path => path.startsWith('beds.'))).toEqual(
        expect.arrayContaining([`${prefix}.specialty`, `${prefix}.specialtyAssignment`])
      );
      expect(
        Object.keys(update.mock.calls[0][1])
          .filter(path => path.startsWith('beds.'))
          .every(path => path.startsWith(`${prefix}.`))
      ).toBe(true);

      update.mockClear();
      await expect(
        api.patchDailyRecordWithClinicalAuthority.run(
          {
            ...request,
            patch: { ...request.patch, [`${prefix}.pathology`]: 'Another change' },
          },
          context
        )
      ).rejects.toThrow('only change');
      expect(update).not.toHaveBeenCalled();
    }
  );
});
