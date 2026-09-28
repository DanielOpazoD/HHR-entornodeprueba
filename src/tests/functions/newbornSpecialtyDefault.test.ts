import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
const require = createRequire(import.meta.url);
const { applyPendingSpecialtyRules } = require('../../../functions/lib/specialtyRules.js');
const {
  protectSpecialtyDecisions,
} = require('../../../functions/lib/specialtyDecisionContract.js');
const pending = () => ({
  clinicalEpisodeId: 'synthetic-child',
  patientName: 'Synthetic RN',
  specialty: '',
});
const applyDefault = (candidate: object, extra: object = {}) =>
  applyPendingSpecialtyRules({
    remoteRecord: { beds: {} },
    candidate,
    policy: null,
    actorUid: 'synthetic-user',
    mutationId: 'synthetic-default',
    now: '2026-09-28T15:00:00Z',
    catalogEnabled: false,
    ...extra,
  });

describe('server-owned newborn specialty default', () => {
  afterEach(() => {
    delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
    vi.clearAllMocks();
  });

  it.each(['bed', 'clinicalCrib'])(
    'defaults a pending %s to Pediatrics without an active diagnosis catalog',
    target => {
      const child = { ...pending(), ...(target === 'bed' ? { bedMode: 'Cuna' } : {}) };
      const candidate = {
        date: '2026-09-27',
        beds: { R1: target === 'bed' ? child : { clinicalCrib: child } },
      };
      const events = applyDefault(candidate);
      expect(child.specialty).toBe('Pediatría');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        target,
        value: 'Pediatría',
        source: 'rule',
        catalogRevision: 0,
        metadata: { rule: { id: 'default_newborn_pediatrics', revision: 1, catalogRevision: 0 } },
      });
      // A retry or subsequent census does not issue another decision.
      expect(applyDefault(candidate, { remoteRecord: structuredClone(candidate) })).toEqual([]);
    }
  );

  it.each(['', 'Otro'])('respects a manual decision made after the default (%s)', specialty => {
    const remote = { date: '2026-09-27', beds: { R1: { ...pending(), bedMode: 'Cuna' } } };
    applyDefault(remote);
    const candidate = structuredClone(remote);
    const existing = remote.beds.R1 as Record<string, unknown>;
    const meta = existing.specialtyAssignment as Record<string, unknown>;
    protectSpecialtyDecisions({
      remoteRecord: remote,
      candidate,
      intent: {
        kind: 'manual',
        target: 'bed',
        bedId: 'R1',
        episodeId: 'synthetic-child',
        value: specialty,
        expectedDecisionId: meta.decisionId,
      },
      patch: { 'beds.R1.specialty': specialty },
      actorUid: 'synthetic-user',
      mutationId: 'synthetic-manual',
      now: '2026-09-28T16:00:00Z',
    });
    expect(applyDefault(candidate, { remoteRecord: candidate })).toEqual([]);
    expect(candidate.beds.R1.specialty).toBe(specialty);
    expect((candidate.beds.R1 as Record<string, unknown>).specialtyAssignment).toMatchObject({
      source: 'manual',
    });
  });

  it('leaves protected legacy values and ordinary adult beds unchanged', () => {
    const candidate = {
      date: '2026-09-27',
      beds: {
        R1: { ...pending(), bedMode: 'Cuna', specialty: 'Otro' },
        R2: { ...pending(), clinicalEpisodeId: 'adult' },
        R3: { ...pending(), bedMode: 'Cuna', isBlocked: true },
        R4: { ...pending(), bedMode: 'Cuna', clinicalEpisodeId: '' },
      },
    };
    expect(applyDefault(candidate)).toEqual([]);
    expect(candidate.beds.R1.specialty).toBe('Otro');
    expect(candidate.beds.R2.specialty).toBe('');
  });

  it('limits default decisions to eligible beds and keeps historical diagnosis rules disabled', () => {
    const candidate = {
      date: '2026-09-27',
      beds: {
        R1: { ...pending(), bedMode: 'Cuna' },
        R2: { ...pending(), clinicalEpisodeId: 'adult', cie10Code: 'J18.9' },
      },
    };
    const policy = {
      schemaVersion: 1,
      revision: 1,
      autoEnabled: true,
      memoryEnabled: false,
      aiMode: 'off',
      rules: [
        {
          id: 'adult-rule',
          kind: 'assign',
          cie10Code: 'J18.9',
          specialty: 'Med Interna',
          scope: 'all',
          revision: 1,
        },
      ],
      memory: [],
    };
    expect(applyDefault(candidate, { policy, eligibleBedIds: ['R2'] })).toEqual([]);
    expect(candidate.beds.R1.specialty).toBe('');
    expect(candidate.beds.R2.specialty).toBe('');
  });

  it.each(['save', 'patch'])(
    'persists the default and audit through the %s callable on a previous day',
    async mode => {
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      const remote = {
        ...makeRecord(),
        meta: { revision: 2 },
        beds: {
          R1: { ...makeRecord().beds.R1, bedMode: 'Cuna', specialty: '' },
          R2: {
            ...makeRecord().beds.R1,
            bedId: 'R2',
            clinicalEpisodeId: 'other-crib',
            bedMode: 'Cuna',
            specialty: '',
          },
        },
      };
      const { admin, docRef, update, set } = createAdminMock({ remoteData: remote });
      const api = createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });
      const common = {
        date: remote.date,
        expectedLastUpdated: remote.lastUpdated,
        mode: 'enforced',
        origin: 'rayen',
        syncContract: {
          mutationId: 'synthetic-write',
          baseRevision: 2,
          changedPaths: ['beds.R1.pathology'],
        },
      };
      const result =
        mode === 'save'
          ? await api.saveDailyRecordWithClinicalAuthority.run(
              {
                ...common,
                record: {
                  ...remote,
                  beds: { ...remote.beds, R1: { ...remote.beds.R1, pathology: 'Updated' } },
                },
              },
              makeContext()
            )
          : await api.patchDailyRecordWithClinicalAuthority.run(
              { ...common, patch: { 'beds.R1.pathology': 'Updated' } },
              makeContext()
            );
      expect(result.success).toBe(true);
      expect(
        set.mock.calls.some(([, data]) => data?.bedId === 'R2' && data?.value === 'Pediatría')
      ).toBe(false);
      if (mode === 'save')
        expect(set).toHaveBeenCalledWith(
          docRef,
          expect.objectContaining({
            beds: {
              R1: expect.objectContaining({ specialty: 'Pediatría', pathology: 'Updated' }),
              R2: expect.objectContaining({ specialty: '' }),
            },
          })
        );
      else
        expect(update).toHaveBeenCalledWith(
          docRef,
          expect.objectContaining({
            'beds.R1.specialty': 'Pediatría',
            'beds.R1.specialtyAssignment': expect.objectContaining({ source: 'rule' }),
          })
        );
      expect(set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ value: 'Pediatría', ruleId: 'default_newborn_pediatrics' })
      );
    }
  );
});
